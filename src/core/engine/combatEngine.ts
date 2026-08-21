/**
 * 事件驱动战斗引擎（核心，纯 TS，不依赖 DOM）
 *
 * 设计要点：
 *  - 时间统一毫秒；用最小堆按时间取出最早事件，绝不按 1ms 暴力循环。
 *  - 同刻事件按 (timeMs, seq) 确定顺序，保证可复现。
 *  - 伤害走模块化流水线：原始→增伤→暴击→穿透→抗性→减伤→护盾→扣血→吸血→触发。
 *  - 技能/装备/天赋均为「效果片段(EffectSegment)」统一解析，普攻是内置技能。
 *  - 所有触发器统一收敛到 fireTrigger(s)，实现 Trigger + Effect + Parameter 机制，
 *    技能被动 / 装备效果 / 天赋触发不再针对单一对象写死。
 */
import {
  type CombatConfig, type CombatEvent, type CombatResult, type CombatSnapshot,
  type CombatantId, type CombatantRuntimeState, type CooldownReduceSegment, type DamageSegment,
  type DamageSourceKind, type DamageType, type DotSegment, type EffectSegment,
  type Equipment, type EquipmentEffect, type EquipmentTrigger, type EventType,
  type PassiveTrigger, type RuntimeCombatant, type HeroStats, type ShieldInstance,
  type ShieldSegment, type ShieldType, type Skill, type StatKey, type StatScaling, type StateTag,
  type Talent, type TalentType, type TriggerConditionKind, type TriggerEvent, type BuffType,
  type BuffSegment, type OnHitDamageSegment, type DamageTag, type CritFamily,
  type DamageDistanceScaling, type DamageHpBonus, type BuffCategory,
  BASIC_ATTACK_SKILL_MARKER,
} from '../types';
import { clampPercent } from '../formulas/cooldown';
import { createRng, Rng } from './rng';
import { resolveCrit } from '../formulas/crit';
import { finalArmor, finalMagicResist } from '../formulas/penetration';
import { buildDummyCombatant, buildHeroCombatant, clampHp } from './stats';
import { uid } from '../defaults';
import { computeEffectiveAttackInterval } from './attackSpeed';
import { applyBuff, buffStacks, buffTotal, hasControlImmunity, removeBuff, sweepExpired } from './buffs';

const SAMPLE_MS = 250;

/** 触发链最大深度（见 #161）：超过后终止继续触发并记录调试日志 */
const MAX_TRIGGER_DEPTH = 8;
/** 默认禁止效果通过自己产生的事件反复触发自己（见 #161） */
const ALLOW_SELF_TRIGGER = false;

/** 伤害结算的附加选项（见 #154-158）：附加伤害独立实例的各项开关 */
interface DamageOptions {
  /** 是否为独立结算的附加伤害实例（On-hit，见 #154） */
  independent?: boolean;
  /** 附加伤害标签（见 #157），写进事件供链式校验 */
  tags?: DamageTag[];
  /** 是否允许暴击（独立于角色暴击属性，见 #156） */
  allowCrit?: boolean;
  /** 暴击归属（物理/魔法暴击体系，见 #156） */
  critFamily?: CritFamily;
  /** 独立暴击倍率（覆盖角色暴击伤害，见 #156） */
  critDamageOverride?: number;
  /** 独立暴击率（0-100，覆盖角色暴击率，见 #156） */
  critChanceOverride?: number;
  /** 是否触发吸血（见 #158） */
  canLifesteal?: boolean;
  /** 允许全能吸血（见 #158） */
  useAllVamp?: boolean;
  /** 是否触发装备（见 #158） */
  triggerEquip?: boolean;
  /** 是否触发天赋/被动/其他 On-hit（见 #158） */
  triggerTalent?: boolean;
  triggerPassive?: boolean;
  triggerOnHit?: boolean;
}

/**
 * 触发来源链（见 #159-161）：追踪「这个效果由什么事件触发」。
 * rootEventId 根事件；depth 触发深度；path 记录已执行的效果键，用于防自触发/防递归。
 */
interface TriggerChain {
  rootEventId: number;
  depth: number;
  path: string[];
}

/** 属性快照（#152）：效果生成时冻结的双方属性 */
interface DamageSnapshot {
  source: HeroStats;
  target: HeroStats;
}

/** 距离/生命条件中通用的比较结果 */
function cmp(a: number, op: '>' | '>=' | '<' | '<=' | 'between', value: number, value2?: number): boolean {
  switch (op) {
    case '>': return a > value;
    case '>=': return a >= value;
    case '<': return a < value;
    case '<=': return a <= value;
    case 'between': return a >= value && a <= (value2 ?? value);
    default: return false;
  }
}

/** 最小堆（按 timeMs 优先，其次 seq） */
class MinHeap<T> {
  private a: T[] = [];
  constructor(private less: (x: T, y: T) => boolean) {}
  push(item: T): void {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let s = i;
        if (l < n && this.less(a[l], a[s])) s = l;
        if (r < n && this.less(a[r], a[s])) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s], a[i]];
        i = s;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

interface SchedAction { timeMs: number; seq: number; run: () => void }

/** 基本攻击内置技能片段：伤害=攻击力，吃普攻增伤 */
function buildBasicAttackSegment(stats: HeroStats): DamageSegment {
  return {
    kind: 'damage',
    delaySeconds: 0,
    baseDamage: Math.max(0, stats.attack),
    scaling: [],
    damageType: 'physical',
    canCrit: true,
    critFamily: 'physical',
    canLifesteal: true,
    canTriggerItems: true,
    sourceKind: 'basic_attack',
    isBasicAttackBoost: true,
    useAllVamp: true,
  };
}

/** 新建运行时状态（见 #176）：战斗中的临时改造全部集中于此 */
function makeRuntimeState(id: CombatantId): CombatantRuntimeState {
  return {
    buffs: [],
    counters: new Map<string, number>(),
    stateTags: new Set<StateTag>(),
    attackSequence: 0,
    consecutive: { current: 0, lastAttackTimeMs: -1, allowedGapMs: 1500, isAttacking: false },
    tempAttackSpeed: 0,
    tempCapBreakthrough: 0,
  };
}

interface UnitHero {
  skills: Skill[];
  items: Equipment[];
  talents: Talent[];
  basicAttack: DamageSegment;
  /** 技能就绪时间（毫秒） */
  skillCds: Map<string, number>;
  /** 装备效果/被动技能/天赋内部冷却就绪时间 */
  procCds: Map<string, number>;
  /** 运行时状态（见 #176）：Buff/计数器/状态标签/攻速叠层等，与模板分离 */
  runtime: CombatantRuntimeState;
}

interface Unit {
  id: CombatantId;
  isDummy: boolean;
  combatant: RuntimeCombatant;
  hero?: UnitHero;
}

interface RunAccum {
  damage: {
    total: number; physical: number; magic: number; trueDmg: number;
    basicAttack: number; skill: number; item: number; dot: number;
    critDamage: number; critCount: number; hitCount: number;
  };
  lifesteal: { totalHealing: number; overheal: number; physicalVamp: number; magicVamp: number; allVamp: number; onHitHp: number };
  defense: {
    damageTaken: number; physicalTaken: number; magicTaken: number; trueTaken: number;
    shieldAbsorbed: number; shieldGenerated: number;
    shieldsGained: number; shieldTotal: number; shieldMaxSingle: number;
    physicalShieldAbsorbed: number; magicShieldAbsorbed: number; allShieldAbsorbed: number;
    shieldBroken: number; shieldExpired: number;
  };
  skills: Map<string, { id: string; name: string; cast: number; hits: number; dmg: number; crits: number; heal: number; shield: number }>;
  items: Map<string, { id: string; name: string; procs: number; dmg: number; heal: number; shield: number; times: number[] }>;
  buffs: { gained: number; expired: number; activeAtEnd: number; maxAttackSpeedStacks: number; attackSpeedStacksAtEnd: number };
}

interface SegmentMeta {
  sourceKind: DamageSourceKind;
  sourceType: 'basic_attack' | 'skill' | 'item' | 'talent' | 'dot';
  skillId?: string;
  skillName?: string;
  itemId?: string;
  itemName?: string;
  talentId?: string;
  talentName?: string;
}

type PassivePollKind =
  | 'on_damage_dealt' | 'on_damage_taken' | 'on_kill'
  | 'on_basic_attack_hit' | 'on_basic_attack_crit' | 'on_attack' | 'on_hit'
  | 'on_cast_skill' | 'on_skill_hit'
  | 'on_shield_created' | 'on_shield_damaged' | 'on_shield_broken' | 'on_shield_expired';

function f(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
}
function damageTypeLabel(d: DamageType): string {
  switch (d) {
    case 'raw': return '原始';
    case 'physical': return '物理';
    case 'magic': return '魔法';
    default: return '真实';
  }
}
function shieldTypeLabel(t: ShieldType): string {
  return t === 'physical' ? '物理' : t === 'magic' ? '魔法' : '全类型';
}
function buffTypeLabel(t: BuffType): string {
  switch (t) {
    case 'attack_speed': return '攻速提升';
    case 'slow': return '减速';
    case 'grievous': return '禁疗';
    case 'damage_bonus': return '增伤';
    case 'vulnerable': return '易伤';
    case 'control_immune': return '控制免疫';
    case 'attack_cap_break': return '攻速上限突破';
    case 'lifesteal_boost': return '吸血提升';
    default: return t;
  }
}

export class CombatEngine {
  private config: CombatConfig;
  private equipmentById: Map<string, Equipment>;
  private rng: Rng;
  private seq = 0;
  private events: CombatEvent[] = [];
  private heap = new MinHeap<SchedAction>((a, b) => (a.timeMs !== b.timeMs ? a.timeMs < b.timeMs : a.seq < b.seq));
  private units = new Map<CombatantId, Unit>();
  private accum = new Map<CombatantId, RunAccum>();
  private now = 0;
  private endMs: number;
  private ended = false;
  private endReason: CombatResult['endReason'] = 'timeout';
  private lastSampleMs = 0;
  private damageCurve: Array<{ tMs: number; cumulativeDamage: number; sourceId: CombatantId }> = [];
  private hpCurve: Array<{ tMs: number; A: number; B: number }> = [];
  private cumDmgById = new Map<CombatantId, number>();
  /** 触发链超深被截断的次数（见 #161），供调试日志统计 */
  private cappedTriggers = 0;
  /** 因 allowSelfTrigger=false 被拦截的自触发次数（见 #161） */
  private selfBlockedTriggers = 0;

  constructor(config: CombatConfig, equipmentById: Map<string, Equipment>) {
    this.config = config;
    this.equipmentById = equipmentById;
    this.endMs = Math.max(1, Math.round(config.durationSeconds * 1000));
    this.rng = createRng(config.randomMode, config.seed);
  }

  run(): CombatResult {
    this.initUnits();
    this.initEvents();
    this.sampleAt(0);
    while (this.heap.size > 0 && !this.ended) {
      const action = this.heap.pop()!;
      if (action.timeMs > this.endMs) break;
      this.advanceSamples(action.timeMs);
      this.now = action.timeMs;
      action.run();
      this.checkEnd();
    }
    this.advanceSamples(this.endMs);
    if (!this.ended) {
      this.now = this.endMs;
      this.finish();
    }
    return this.buildResult();
  }

  // ---------------------------------------------------------------- 初始化
  private initUnits(): void {
    const combos = this.config.combos;
    const ids: CombatantId[] = combos.length >= 2 ? ['A', 'B'] : ['A'];
    combos.slice(0, ids.length).forEach((cfg, i) => {
      const id = ids[i];
      const combatant = buildHeroCombatant(id, cfg.label, cfg, this.equipmentById);
      const items = cfg.itemIds
        .map((itId) => this.equipmentById.get(itId))
        .filter((x): x is Equipment => !!x);
      this.units.set(id, {
        id, isDummy: false, combatant,
        hero: {
          skills: cfg.hero.skills,
          items,
          talents: cfg.talents || [],
          basicAttack: buildBasicAttackSegment(combatant.stats),
          skillCds: new Map(),
          procCds: new Map(),
          runtime: makeRuntimeState(id),
        },
      });
      this.accum.set(id, this.emptyAccum());
      this.cumDmgById.set(id, 0);
    });
    if (this.config.mode === 'dummy') {
      const dummy = buildDummyCombatant(this.config, this.equipmentById);
      this.units.set('dummy', { id: 'dummy', isDummy: true, combatant: dummy });
      this.accum.set('dummy', this.emptyAccum());
      this.cumDmgById.set('dummy', 0);
    }
  }

  private emptyAccum(): RunAccum {
    return {
      damage: { total: 0, physical: 0, magic: 0, trueDmg: 0, basicAttack: 0, skill: 0, item: 0, dot: 0, critDamage: 0, critCount: 0, hitCount: 0 },
      lifesteal: { totalHealing: 0, overheal: 0, physicalVamp: 0, magicVamp: 0, allVamp: 0, onHitHp: 0 },
      defense: { damageTaken: 0, physicalTaken: 0, magicTaken: 0, trueTaken: 0, shieldAbsorbed: 0, shieldGenerated: 0, shieldsGained: 0, shieldTotal: 0, shieldMaxSingle: 0, physicalShieldAbsorbed: 0, magicShieldAbsorbed: 0, allShieldAbsorbed: 0, shieldBroken: 0, shieldExpired: 0 },
      skills: new Map(),
      items: new Map(),
      buffs: { gained: 0, expired: 0, activeAtEnd: 0, maxAttackSpeedStacks: 0, attackSpeedStacksAtEnd: 0 },
    };
  }

  private initEvents(): void {
    this.emit('combat_start', 'A', 'A', { description: '战斗开始' });
    for (const unit of this.units.values()) {
      if (!unit.hero) continue;
      this.schedule(this.now, () => this.autoAttack(unit, this.now));
      for (const skill of unit.hero.skills) {
        if (skill.type === 'active' && skill.active) {
          this.schedule(this.now, () => this.castReadySkill(unit, skill, this.now));
        }
      }
      this.fireCombatStartPassives(unit);
      this.fireCombatStartTalents(unit);
      this.scheduleIntervalEquipment(unit);
      this.scheduleIntervalTalents(unit);
    }
  }

  // ------------------------------------------------------------- 工具
  private schedule(ms: number, run: () => void): void {
    this.heap.push({ timeMs: ms, seq: this.seq++, run });
  }

  private emit(
    eventType: EventType,
    sourceId: CombatantId,
    targetId: CombatantId,
    partial: Partial<CombatEvent> = {},
  ): void {
    this.events.push({
      eventId: this.events.length,
      timestampMs: this.now,
      eventType,
      sourceId, targetId,
      rawDamage: 0, finalDamage: 0, healing: 0, overheal: 0, shield: 0,
      absorbedByShield: 0, targetRemainingHp: 0, description: '',
      ...partial,
    } as CombatEvent);
  }

  private enemyOf(id: CombatantId): Unit | undefined {
    if (this.config.mode === 'dummy') {
      if (id === 'dummy') return undefined;
      return this.units.get('dummy');
    }
    return id === 'A' ? this.units.get('B') : this.units.get('A');
  }

  private cdrOf(unit: Unit): number {
    return clampPercent(unit.combatant.stats.cooldownReduction);
  }

  // ----------------------------------------------------------- Counter / 状态标签
  private runtimeOf(unit: Unit): CombatantRuntimeState {
    if (!unit.hero) throw new Error('非英雄实体无运行时状态');
    return unit.hero.runtime;
  }

  private incCounter(unit: Unit, key: string, by = 1): number {
    const r = this.runtimeOf(unit);
    const next = (r.counters.get(key) ?? 0) + by;
    r.counters.set(key, next);
    return next;
  }

  private setStateTag(unit: Unit, tag: StateTag, present: boolean): void {
    const r = this.runtimeOf(unit);
    if (present) r.stateTags.add(tag);
    else r.stateTags.delete(tag);
  }

  /** 刷新自动维护的 State Tag（见 #171）：护盾存在、连续攻击等 */
  private refreshStateTags(unit: Unit): void {
    if (!unit.hero) return;
    const c = unit.combatant;
    const has = (t: ShieldType) => c.shields.some((s) => s.type === t);
    this.setStateTag(unit, 'HAS_SHIELD', c.shields.length > 0);
    this.setStateTag(unit, 'HAS_PHYSICAL_SHIELD', has('physical'));
    this.setStateTag(unit, 'HAS_MAGIC_SHIELD', has('magic'));
    this.setStateTag(unit, 'HAS_ALL_SHIELD', has('all'));
  }

  /**
   * 施加一段 buff 效果（#134/#162）。攻速/突破会体现在 temp 累计上，不写回 stats（#176）。
   */
  private applyBuffSegment(atMs: number, source: Unit, target: Unit, seg: BuffSegment, meta: SegmentMeta): void {
    const owner = seg.target === 'self' ? source : target;
    if (!owner.hero) return;
    const r = this.runtimeOf(owner);
    const sourceLabel = meta.skillName || meta.itemName || meta.talentName || '效果';
    const totalBefore = buffTotal(r, seg.buffType, seg.category);

    const inst = applyBuff(r, {
      source: sourceLabel,
      buffType: seg.buffType,
      value: seg.value,
      category: seg.category,
      durationSeconds: seg.durationSeconds,
      maxStacks: seg.maxStacks,
      refreshMode: seg.refreshMode,
      stackDurationSeconds: seg.stackDurationSeconds,
      expiresOnUse: seg.expiresOnUse,
      maxUses: seg.maxUses,
      controlTypes: seg.controlTypes,
    }, atMs);
    if (!inst) return;

    this.recomputeTempBuffs(r); // 攻速/突破体现在 temp 上，不写回 stats（#176）

    const totalAfter = buffTotal(r, seg.buffType, seg.category);
    const action = inst.stacks > 1 ? 'stack' : totalAfter > totalBefore ? 'created' : 'refreshed';

    this.emit('buff', owner.id, owner.id, {
      buffType: seg.buffType, buffStacks: inst.stacks,
      buffAction: action,
      description: `${owner.combatant.label}${action === 'created' ? '获得' : action === 'stack' ? '叠层' : '刷新'}「${buffTypeLabel(seg.buffType)}」${inst.stacks > 1 ? `×${inst.stacks}` : ''}${seg.durationSeconds > 0 ? `（${seg.durationSeconds}s）` : ''}`,
      debug: this.debugInfo(owner),
    });

    this.accBuff(owner, true);
  }

  /** 采集调试日志字段（见 #177） */
  private debugInfo(unit: Unit): CombatEvent['debug'] {
    if (!unit.hero) return undefined;
    const stats = unit.combatant.stats;
    const r = this.runtimeOf(unit);
    const as = computeEffectiveAttackInterval(stats, r);
    const counters: Record<string, number> = {};
    r.counters.forEach((v, k) => { counters[k] = v; });
    return {
      attackSpeed: stats.attackSpeedBonus + r.tempAttackSpeed,
      theoreticalInterval: as.theoreticalInterval,
      minInterval: as.minInterval,
      capBroken: !as.capped,
      attackSpeedStacks: buffStacks(r, 'attack_speed'),
      buffs: r.buffs.map((b) => `${b.buffType}×${b.stacks}`),
      shields: this.totalShield(unit.combatant),
      counters,
      stateTags: [...r.stateTags],
    };
  }

  private checkEnd(): void {
    if (this.ended) return;
    const heroes = [...this.units.values()].filter((u) => !!u.hero);
    const aliveHeroes = heroes.filter((u) => u.combatant.alive);
    if (!aliveHeroes.length) { this.ended = true; this.endReason = 'all_dead'; return; }
    if (this.config.mode === 'vs' && aliveHeroes.length < heroes.length) {
      this.ended = true; this.endReason = 'victory'; return;
    }
    const dummy = this.units.get('dummy');
    if (dummy && !this.config.dummy.infiniteHp && !dummy.combatant.alive) {
      this.ended = true; this.endReason = 'victory'; return;
    }
  }

  private finish(): void {
    this.emit('combat_end', 'A', 'A', { description: '战斗结束' });
    this.ended = true;
  }

  private sampleAt(tMs: number): void {
    const t = Math.min(tMs, this.endMs);
    this.damageCurve.push({ tMs: t, cumulativeDamage: this.cumDmgById.get('A') ?? 0, sourceId: 'A' });
    const a = this.units.get('A');
    const b = this.units.get('B') ?? this.units.get('dummy');
    this.hpCurve.push({ tMs: t, A: a?.combatant.hp ?? 0, B: b?.combatant.hp ?? 0 });
  }

  private advanceSamples(targetMs: number): void {
    while (this.lastSampleMs + SAMPLE_MS <= Math.min(targetMs, this.endMs)) {
      this.lastSampleMs += SAMPLE_MS;
      this.sampleAt(this.lastSampleMs);
    }
  }

  // --------------------------------------------------------------- 普攻
  private autoAttack(unit: Unit, atMs: number): void {
    if (!unit.combatant.alive) return;
    this.sweepUnitBuffs(unit, atMs);           // 过期攻速/突破 Buff 实时回收
    const target = this.enemyOf(unit.id);
    if (!target || !target.combatant.alive) return;
    const hero = unit.hero!;
    const r = this.runtimeOf(unit);

    // 计数器 / 攻击序号 / 连续攻击（#138 / #139 / #141）
    const n = ++r.attackSequence;
    this.incCounter(unit, 'basic_attack_total');
    const gapMs = (r.consecutive.lastAttackTimeMs < 0) ? 0 : (atMs - r.consecutive.lastAttackTimeMs);
    r.consecutive.current = (gapMs > r.consecutive.allowedGapMs) ? 1 : r.consecutive.current + 1;
    r.consecutive.lastAttackTimeMs = atMs;
    r.counters.set('consecutive_attacks', r.consecutive.current);
    this.setStateTag(unit, 'IS_CONSECUTIVE_ATTACKING', r.consecutive.current >= 2);
    this.setStateTag(unit, 'HAS_ATTACKED', true);

    this.emit('attack', unit.id, target.id, { description: `Attack #${n}` });

    this.applySegment(atMs, unit, target, hero.basicAttack, {
      sourceKind: 'basic_attack', sourceType: 'basic_attack',
      skillId: BASIC_ATTACK_SKILL_MARKER, skillName: '普通攻击',
    });
    this.fireTriggers(unit, 'basic_attack_hit', atMs, {});
    this.fireTriggers(unit, 'on_attack', atMs, {}); // 兼容旧枚举：攻击时

    // 攻速上限解析（#131-133）：最终间隔受最低间隔约束，攻速来自 buff（#134）且不写回模板
    const interval = computeEffectiveAttackInterval(unit.combatant.stats, r);
    const nextMs = atMs + Math.round(interval.final * 1000);
    this.schedule(Math.max(atMs + 1, nextMs), () => this.autoAttack(unit, nextMs));
    // 消耗「前N次攻击」类攻速 Buff 的可用次数（#137/#140），下一击起不再计入
    this.consumeOnUseAttackBuffs(unit);
  }

  /** 对 expiresOnUse 攻速类 Buff 每次攻击消耗一次，用尽后移除（#137/#140） */
  private consumeOnUseAttackBuffs(unit: Unit): void {
    const r = this.runtimeOf(unit);
    const consumed = new Set<string>();
    for (const b of r.buffs) {
      if (!b.expiresOnUse) continue;
      b.uses = (b.uses ?? 1) - 1;
      if ((b.uses ?? 0) <= 0) consumed.add(b.id);
    }
    for (const id of consumed) removeBuff(r, id, 'consumed');
    if (consumed.size) {
      this.emit('buff', unit.id, unit.id, {
        buffAction: 'consumed',
        description: `${unit.combatant.label}的攻速效果使用次数耗尽`,
      });
    }
    this.recomputeTempBuffs(r);
  }

  /** 重算临时攻速/突破：expiresOnUse 且次数耗尽者不计入 */
  private recomputeTempBuffs(r: CombatantRuntimeState): void {
    const sum = (type: BuffType) => {
      let s = 0;
      for (const b of r.buffs) {
        if (b.buffType !== type) continue;
        if (b.expiresOnUse && (b.uses ?? 1) <= 0) continue;
        s += b.value;
      }
      return s;
    };
    r.tempAttackSpeed = sum('attack_speed');
    r.tempCapBreakthrough = sum('attack_cap_break');
  }

  // --------------------------------------------------------------- 技能
  private castReadySkill(unit: Unit, skill: Skill, atMs: number): void {
    if (!unit.hero || !skill.active) return;
    if (!unit.combatant.alive) return;
    const readyAt = unit.hero.skillCds.get(skill.id) ?? 0;
    if (atMs < readyAt) return;
    const cdMs = Math.max(1, skill.active.cooldownSeconds * 1000 * (1 - this.cdrOf(unit)));
    unit.hero.skillCds.set(skill.id, atMs + cdMs); // skillCds 记录「下一次可释放时间」
    const target = this.enemyOf(unit.id);
    this.emit('skill_cast', unit.id, target?.id ?? unit.id, {
      skillId: skill.id, skillName: skill.name,
      description: `释放技能「${skill.name}」`,
    });
    this.skillOf(this.accum.get(unit.id)!, skill.id, skill.name).cast++;
    // 释放技能触发：cast_skill
    this.fireTriggers(unit, 'cast_skill', atMs, { skillId: skill.id });
    if (target) {
      for (const seg of skill.segments) {
        this.scheduleSegment(atMs, unit, target, seg, {
          sourceKind: 'skill', sourceType: 'skill', skillId: skill.id, skillName: skill.name,
        });
      }
    }
    this.schedule(atMs + cdMs, () => this.skillReadyEvent(unit, skill, atMs + cdMs));
  }

  /**
   * 技能就绪事件。若当前 skillCds 中有更晚/更早的就绪时间已覆盖本次事件（如冷却被减少后的
   * 提前就绪事件已先触发并刷新 chain），则本次为过期事件，直接忽略，避免把就绪时间回拨。
   */
  private skillReadyEvent(unit: Unit, skill: Skill, atMs: number): void {
    if (!unit.hero) return;
    const existing = unit.hero.skillCds.get(skill.id) ?? 0;
    if (existing > atMs) return; // 已由更早的就绪事件接管（冷却减少），忽略过期事件
    unit.hero.skillCds.set(skill.id, atMs);
    this.emit('cooldown_ready', unit.id, unit.id, {
      skillId: skill.id, skillName: skill.name,
      description: `技能「${skill.name}」冷却完成（${(atMs / 1000).toFixed(1)}s）`,
    });
    if (unit.combatant.alive) this.castReadySkill(unit, skill, atMs);
  }

  // -------------------------------------------------------------- 片段
  private scheduleSegment(
    baseMs: number, source: Unit, target: Unit, seg: EffectSegment, meta: SegmentMeta, chain?: TriggerChain,
  ): void {
    const at = baseMs + Math.round((seg.delaySeconds || 0) * 1000);
    // 属性快照（#152）：snapshot=用「效果生成时」的属性（在调度/释放节点冻结双方属性）
    let snap: DamageSnapshot | undefined;
    if (seg.kind === 'damage' && seg.snapshot === 'snapshot') {
      snap = { source: { ...source.combatant.stats }, target: { ...target.combatant.stats } };
    } else if (seg.kind === 'dot' && seg.snapshot === 'snapshot') {
      snap = { source: { ...source.combatant.stats }, target: { ...target.combatant.stats } };
    }
    const run = () => this.applySegment(at, source, target, seg, meta, snap, chain);
    if (at === baseMs) run();
    else this.schedule(at, run);
  }

  private applySegment(
    atMs: number, source: Unit, target: Unit, seg: EffectSegment, meta: SegmentMeta,
    snap?: DamageSnapshot, chain?: TriggerChain,
  ): void {
    if (!source.combatant.alive) return;
    switch (seg.kind) {
      case 'damage':
        this.dealDamage(atMs, source, target, seg, meta, undefined, snap, chain);
        break;
      case 'dot':
        this.scheduleDot(atMs, source, target, seg, meta, snap, chain);
        break;
      case 'heal': {
        const amount = this.evalFormula(source, target, seg.basePower, seg.scaling, atMs, snap);
        this.healCombatant(atMs, source.combatant, amount, source, `${seg.basePower} 治疗量`, meta);
        break;
      }
      case 'shield':
        // 护盾作为自身增益，作用于来源单位（与 heal 一致）；伤害类效果仍作用于 target
        this.gainShield(atMs, source, source, seg, meta);
        break;
      case 'cooldown_reduce':
        this.reduceCooldowns(atMs, source, seg, meta);
        break;
      case 'buff':
        this.applyBuffSegment(atMs, source, target, seg, meta);
        break;
      case 'on_hit_damage':
        this.applyOnHitDamage(atMs, source, target, seg, meta, chain);
        break;
    }
  }

  /** 附加伤害：独立 Damage Instance（#153-158），各自经历护甲/魔抗/暴击/吸血/增伤/减伤 */
  private applyOnHitDamage(atMs: number, source: Unit, target: Unit, seg: OnHitDamageSegment, meta: SegmentMeta, chain?: TriggerChain): void {
    this.dealDamage(atMs, source, target, seg, {
      ...meta, sourceKind: meta.sourceKind, sourceType: meta.sourceType,
    }, {
      independent: true, tags: seg.tags, allowCrit: seg.canCrit, critFamily: seg.critFamily,
      critDamageOverride: seg.critDamageOverride, critChanceOverride: seg.critChanceOverride,
      canLifesteal: seg.canPhysicalLifesteal || seg.canMagicLifesteal || seg.canAllVamp,
      useAllVamp: seg.canAllVamp,
      triggerEquip: seg.canTriggerEquip, triggerTalent: seg.canTriggerTalent,
      triggerPassive: seg.canTriggerPassive, triggerOnHit: seg.canTriggerOnHit,
    }, undefined, chain);
  }

  private scheduleDot(
    baseMs: number, source: Unit, target: Unit, seg: DotSegment, meta: SegmentMeta,
    snap?: DamageSnapshot, chain?: TriggerChain,
  ): void {
    const firstRelMs = Math.round((seg.delaySeconds || 0) * 1000);
    const tickMs = Math.max(1, seg.tickSeconds * 1000);
    const totalMs = Math.max(0, seg.totalSeconds * 1000);
    const tickCount = totalMs > 0 ? Math.floor(totalMs / tickMs) : 0;
    for (let i = 0; i <= tickCount; i++) {
      const at = baseMs + firstRelMs + i * tickMs;
      this.schedule(at, () => this.dealDamage(at, source, target, seg, { ...meta, sourceKind: 'dot', sourceType: 'dot' }, undefined, snap, chain));
    }
  }

  // -------------------------------------------------------------- 伤害流水线
  private dealDamage(
    atMs: number, source: Unit, target: Unit, seg: DamageSegment | DotSegment | OnHitDamageSegment, meta: SegmentMeta,
    opt: DamageOptions = {}, snap?: DamageSnapshot, chain?: TriggerChain,
  ): void {
    const base = seg.kind === 'dot' ? seg.baseDamagePerTick : seg.baseDamage;
    const scaling: StatScaling[] = seg.scaling || [];
    const damageType: DamageType = seg.damageType;
    // 属性快照（#152）：snapshot 模式下用冻结属性，否则用实时属性
    const src = snap ? snap.source : source.combatant.stats;
    const tgt = snap ? snap.target : target.combatant.stats;
    const sourceKind = meta.sourceKind;

    // 1) 原始伤害
    let raw = this.evalFormula(source, target, base, scaling, atMs, snap);

    // 2) 距离伤害（#146-148）：随投射物实际飞行距离增加，封顶
    if (seg.kind === 'damage' && seg.distanceScaling) {
      const d = this.distanceFor(seg);
      const db = this.distanceBonus(seg.distanceScaling, d);
      raw += db.add;
      if (db.addMul) raw *= 1 + db.addMul;
    }

    // 3) 生命值相关增伤（#149-151）：满足条件增伤、阶梯递增并封顶
    if (seg.kind === 'damage' && seg.hpBonus) {
      const bonus = this.hpBonusPercent(seg.hpBonus, src, tgt);
      if (bonus > 0) raw *= 1 + bonus / 100;
    }

    // 4) 增伤(自身愿意) / 易伤(目标愿意) Buff（#167-169），分类独立计算
    raw *= this.buffDamageMultiplier(source, damageType, sourceKind);
    raw *= this.buffVulnerableMultiplier(target, damageType, sourceKind);

    // 5) 常规增伤：普攻/技能/法强加成
    if (seg.kind === 'damage' && seg.isBasicAttackBoost) raw *= 1 + clampPercent(src.attackDamage);
    if (seg.kind === 'damage' && seg.isSkillBoost) {
      raw *= 1 + clampPercent(damageType === 'physical' ? src.physicalSkillDamage : src.magicDamage);
    }
    if (damageType === 'magic' && (seg as DamageSegment).useMagicDamageBoost !== false) {
      raw *= 1 + clampPercent(src.magicDamage);
    }

    // 6) 暴击（#156：附加伤害可独立设置暴击归属/倍率）
    let crit = false;
    const critAllowed = opt.allowCrit ?? (seg as DamageSegment).canCrit;
    if (critAllowed) {
      const family = opt.critFamily ?? (seg as DamageSegment).critFamily ?? 'physical';
      const rate = opt.critChanceOverride ?? (seg as DamageSegment).critChanceOverride ?? (family === 'physical' ? src.physicalCritRate : src.magicCritRate);
      const baseDmg = opt.critDamageOverride ?? (family === 'physical' ? src.physicalCritDamage : src.magicCritDamage);
      const res = resolveCrit(rate, baseDmg, this.config.randomMode, this.rng);
      crit = res.crit;
      raw *= res.multiplier;
    }
    if (crit) { this.setStateTag(source, 'LAST_ATTACK_CRITICAL', true); this.setStateTag(source, 'HAS_CRIT_THIS_COMBAT', true); }
    else if (sourceKind === 'basic_attack') this.setStateTag(source, 'LAST_ATTACK_CRITICAL', false);

    // 7) BEFORE_DAMAGE（#142-143）：伤害已产生、尚未扣护盾/生命，允许技能/装备/天赋生成护盾等防御
    // 仅当确实产生伤害（raw>0）时触发，避免 0 伤害的命中触发无效防御（见 #142「伤害已经产生」）
    if (raw > 0) {
      this.fireTriggers(source, 'before_damage', atMs, { damageType }, chain);
      this.fireTriggers(target, 'before_damage', atMs, { damageType }, chain);
      this.refreshStateTags(target); // 刷新护盾状态标签供条件判断
    }

    // 8) 穿透 + 抗性（原始/真实伤害默认不计算护甲/魔抗/穿透）
    let finalResist = 0;
    let resistRate = 0;
    if (damageType === 'physical') {
      finalResist = finalArmor(tgt.armor, src.flatArmorPen, src.percentArmorPen);
      resistRate = finalResist * 0.06 / (1 + finalResist * 0.06);
    } else if (damageType === 'magic') {
      finalResist = finalMagicResist(tgt.magicResist, src.flatMagicPen, src.percentMagicPen);
      resistRate = finalResist * 0.06 / (1 + finalResist * 0.06);
    }
    const rawBypasses = damageType === 'raw' || damageType === 'true';
    let afterResist = rawBypasses ? raw : raw * (1 - resistRate);

    // 9) 伤害减免（原始/真实伤害根据配置无视；原始伤害恒无视减伤）
    const skipReduction = damageType === 'raw' || (damageType === 'true' && this.config.trueDamageIgnoresReduction);
    if (!skipReduction) {
      afterResist *= 1 - clampPercent(tgt.damageReduction);
    }

    // 10) 护盾吸收（原始伤害为未结算基础，默认不吸收；真实伤害是否可吸收由 trueDamageAffectsShield 决定）
    let absorbed = 0;
    if (afterResist > 0 && damageType !== 'raw' && (damageType !== 'true' || this.config.trueDamageAffectsShield)) {
      absorbed = this.absorbIntoShields(atMs, target, damageType, afterResist);
      afterResist -= absorbed;
      if (absorbed > 0) {
        this.accum.get(target.id)!.defense.shieldAbsorbed += absorbed;
        this.emit('shield_absorbed', source.id, target.id, { absorbedByShield: absorbed, targetRemainingHp: target.combatant.hp, description: `护盾吸收 ${f(absorbed)} 伤害` });
      }
    }

    // 11) 扣生命（先判致命伤害前事件，见 #144）
    let hpLoss = Math.max(0, afterResist);
    if (target.combatant.hp > 0 && target.combatant.hp - hpLoss <= 0) {
      this.fireTriggers(target, 'before_lethal_damage', atMs, { damageType }, chain);
      this.fireTriggers(source, 'before_lethal_damage', atMs, { damageType }, chain);
      // 若在致命伤害前生成了护盾，将其吸收进本击
      const rescued = this.absorbIntoShields(atMs, target, damageType, hpLoss);
      if (rescued > 0) { hpLoss = Math.max(0, hpLoss - rescued); absorbed += rescued; }
    }
    const appliedLoss = Math.max(0, hpLoss);
    target.combatant.hp = clampHp(target.combatant.hp - appliedLoss);
    const priorAlive = target.combatant.alive;
    target.combatant.alive = target.combatant.hp > 0;

    this.emit(crit ? 'crit' : seg.kind === 'dot' ? 'dot_tick' : 'damage', source.id, target.id, {
      skillId: meta.skillId, skillName: meta.skillName, itemId: meta.itemId, itemName: meta.itemName,
      talentId: meta.talentId, talentName: meta.talentName,
      damageType, rawDamage: raw, crit, finalDamage: appliedLoss, absorbedByShield: absorbed,
      targetRemainingHp: target.combatant.hp,
      rootEventId: chain?.rootEventId, parentEventId: this.events.length, sourceEffectId: chain ? chain.path[chain.path.length - 1] : undefined, triggerDepth: chain?.depth,
      description: `${source.combatant.label}${crit ? ' 暴击！' : ''} 造成【原始伤害 ${f(raw)} → ${damageTypeLabel(damageType)} ${f(appliedLoss)}最终伤害】${absorbed > 0 ? `（护盾吸收 ${f(absorbed)}）` : ''}`,
      details: { finalResist, reductionRate: resistRate },
    });

    // 统计
    this.accDamage(source, meta, damageType, raw, appliedLoss, crit, seg.kind === 'dot' ? 'dot' : sourceKind);
    this.accTaken(target, damageType, appliedLoss, absorbed, damageType);

    // 12) 吸血/回血（附加伤害按 #158 开关）
    const canLifesteal = opt.canLifesteal ?? (seg.kind === 'damage' && seg.canLifesteal);
    if (canLifesteal && appliedLoss > 0) {
      if (damageType === 'physical' && src.physicalVamp > 0) this.vamp(source, appliedLoss, clampPercent(src.physicalVamp), 'physicalVamp');
      else if (damageType === 'magic' && src.magicVamp > 0) this.vamp(source, appliedLoss, clampPercent(src.magicVamp), 'magicVamp');
      const useAll = opt.useAllVamp ?? (seg.kind === 'damage' && !!seg.useAllVamp);
      if (useAll && src.allVamp > 0) this.vamp(source, appliedLoss, clampPercent(src.allVamp), 'allVamp');
      if (sourceKind === 'basic_attack' && src.onHitHp > 0) this.vamp(source, src.onHitHp, 1, 'onHitHp', true);
    }

    // 13) 触发链（#158-161）：附加伤害通过 options 开关控制是否继续触发
    const trigEquip = opt.triggerEquip ?? (seg.kind === 'damage' ? seg.canTriggerItems : true);
    const trigPassive = opt.triggerPassive ?? true;
    const trigTalent = opt.triggerTalent ?? true;
    if (trigEquip && appliedLoss > 0) {
      this.fireTriggers(source, 'damage_dealt', atMs, { damageType }, chain);
      if (sourceKind === 'basic_attack') {
        this.fireTriggers(source, 'basic_attack_hit', atMs, { damageType }, chain);
        if (crit) this.fireTriggers(source, 'basic_attack_crit', atMs, {}, chain);
        if (trigPassive) this.firePassives(source, 'on_hit', undefined, atMs, chain);
      } else if (sourceKind === 'skill' || sourceKind === 'dot') {
        this.setStateTag(source, 'LAST_SKILL_HIT', true);
        this.setStateTag(source, 'HAS_SKILL_HIT_THIS_COMBAT', true);
        this.fireTriggers(source, 'skill_hit', atMs, { damageType, skillId: meta.skillId }, chain);
        if (trigPassive) this.firePassives(source, 'on_hit', undefined, atMs, chain);
      }
      this.firePassives(source, 'on_damage_dealt', { damageType }, atMs, chain);
      if (crit) this.firePassives(source, 'on_basic_attack_crit', undefined, atMs, chain);
    }

    // 受击方触发
    if (appliedLoss > 0) {
      this.fireTriggers(target, 'damage_taken', atMs, { damageType }, chain);
      this.firePassives(target, 'on_damage_taken', undefined, atMs, chain);
      const pct = target.combatant.maxHp > 0 ? (target.combatant.hp / target.combatant.maxHp) * 100 : 0;
      this.evaluateHpBelow(target, atMs, pct);
    }

    // 14) 死亡
    if (priorAlive && !target.combatant.alive) {
      this.emit('death', source.id, target.id, { targetRemainingHp: 0, description: `${target.combatant.label} 阵亡` });
      if (!target.isDummy) {
        this.fireTriggers(source, 'kill', atMs, {}, chain);
        this.firePassives(source, 'on_kill', undefined, atMs, chain);
      }
    }
  }

  /** 投射物/距离字段取值（见 #148）：默认取投射物实际飞行距离 */
  private distanceFor(seg: DamageSegment): number {
    if (seg.distanceScaling) return seg.travelDistance ?? seg.distanceScaling.minDistance;
    return 0;
  }

  /** 距离伤害加成（见 #147）：低于最小距离无加成，超过最大距离封顶 */
  private distanceBonus(ds: DamageDistanceScaling, distance: number): { add: number; addMul: number } {
    const out = { add: 0, addMul: 0 };
    if (distance <= ds.minDistance) return out;
    const units = Math.max(0, Math.min(distance, ds.maxDistance) - ds.minDistance);
    if (ds.perDistancePerUnit) out.add = units * ds.perDistancePerUnit;
    if (ds.perDistancePercent) out.addMul = units * (ds.perDistancePercent / 100);
    if (ds.maxBonusDamage != null) out.add = Math.min(out.add, ds.maxBonusDamage);
    if (ds.maxMultiplier != null) out.addMul = Math.min(out.addMul, Math.max(0, ds.maxMultiplier - 1));
    return out;
  }

  /** 生命值条件值来源（见 #150） */
  private hpConditionValue(stat: DamageHpBonus['stat'], src: HeroStats, tgt: HeroStats): number {
    switch (stat) {
      case 'targetMaxHp': return tgt.maxHp;
      case 'targetCurrentHp': return tgt.currentHp;
      case 'targetHpPercent': return tgt.maxHp > 0 ? (tgt.currentHp / tgt.maxHp) * 100 : 0;
      case 'targetLostHp': return tgt.maxHp - tgt.currentHp;
      case 'targetLostHpPercent': return tgt.maxHp > 0 ? ((tgt.maxHp - tgt.currentHp) / tgt.maxHp) * 100 : 0;
      case 'selfMaxHp': return src.maxHp;
      case 'selfCurrentHp': return src.currentHp;
      default: return 0;
    }
  }

  /** 生命值阶梯增伤（见 #149-151）：满足条件增伤，每多 perUnit 额外加，封顶 */
  private hpBonusPercent(hb: DamageHpBonus, src: HeroStats, tgt: HeroStats): number {
    const v = this.hpConditionValue(hb.stat, src, tgt);
    if (!cmp(v, hb.op, hb.value, hb.value2)) return 0;
    let bonus = hb.bonusPercent;
    if (hb.perUnit && hb.perBonusPercent) {
      const excess = Math.max(0, v - hb.value);
      bonus += Math.floor(excess / hb.perUnit) * hb.perBonusPercent;
    }
    return Math.min(bonus, hb.maxBonusPercent);
  }

  /** 增伤分类匹配（见 #169）：all 恒匹配；物理/魔法/真实按伤害类型；basic_attack/skill 按来源 */
  private buffCategoryMatches(cat: BuffCategory | undefined, damageType: DamageType, sourceKind: DamageSourceKind): boolean {
    const c = cat ?? 'all';
    if (c === 'all' || c === damageType) return true;
    if (c === 'basic_attack') return sourceKind === 'basic_attack';
    if (c === 'skill') return sourceKind === 'skill' || sourceKind === 'dot';
    return false;
  }

  /** 增伤 Buff（#167）：自身造成的伤害增加 */
  private buffDamageMultiplier(unit: Unit, damageType: DamageType, sourceKind: DamageSourceKind): number {
    if (!unit.hero) return 1;
    let mult = 1;
    for (const b of unit.hero.runtime.buffs) {
      if (b.buffType !== 'damage_bonus') continue;
      if (this.buffCategoryMatches(b.category, damageType, sourceKind)) mult *= 1 + b.value / 100;
    }
    return mult;
  }

  /** 易伤 Buff（#168）：自身受到的伤害增加 */
  private buffVulnerableMultiplier(unit: Unit, damageType: DamageType, sourceKind: DamageSourceKind): number {
    if (!unit.hero) return 1;
    let mult = 1;
    for (const b of unit.hero.runtime.buffs) {
      if (b.buffType !== 'vulnerable') continue;
      if (this.buffCategoryMatches(b.category, damageType, sourceKind)) mult *= 1 + b.value / 100;
    }
    return mult;
  }

  private vamp(
    source: Unit, basis: number, rate: number,
    attr: 'physicalVamp' | 'magicVamp' | 'allVamp' | 'onHitHp', isFlat = false,
  ): void {
    const amount = isFlat ? basis : basis * rate;
    if (amount <= 0) return;
    const a = this.accum.get(source.id)!;
    const { healApplied } = this.healCombatant(this.now, source.combatant, amount, source, '', undefined, true);
    if (attr === 'physicalVamp') a.lifesteal.physicalVamp += healApplied;
    else if (attr === 'magicVamp') a.lifesteal.magicVamp += healApplied;
    else if (attr === 'allVamp') a.lifesteal.allVamp += healApplied;
    else a.lifesteal.onHitHp += healApplied;
  }

  private healCombatant(
    atMs: number, target: RuntimeCombatant, amount: number, source: Unit, label: string,
    meta?: SegmentMeta, silent = false,
  ): { healApplied: number; overheal: number } {
    if (!target.alive || amount <= 0) return { healApplied: 0, overheal: 0 };
    // 禁疗（#166）：被治疗者身上的 grievous 降低治疗效果。0%=100 治疗→100；40%→60；100%→0。
    let reduced = amount;
    let grieve = 0;
    const targetUnit = this.units.get(target.id);
    if (targetUnit?.hero) {
      grieve = buffTotal(this.runtimeOf(targetUnit), 'grievous');
      if (grieve > 0) reduced = amount * (1 - clampPercent(grieve));
    }
    const room = target.maxHp - target.hp;
    const applied = Math.min(room, reduced);
    const over = reduced - applied;
    target.hp = Math.min(target.maxHp, target.hp + applied);
    const a = this.accum.get(source.id)!;
    a.lifesteal.totalHealing += applied;
    a.lifesteal.overheal += over;
    if (!silent) {
      this.emit('heal', source.id, target.id, {
        healing: applied, overheal: over, targetRemainingHp: target.hp,
        description: `${target.label} ${label}恢复 ${f(applied)}${over > 0 ? `（溢出 ${f(over)}）` : ''}${reduced < amount ? `（禁疗 ${f(clampPercent(grieve) * 100)}%）` : ''}`,
      });
    }
    if (meta?.skillId) {
      const s = this.skillOf(a, meta.skillId, meta.skillName || '');
      s.heal += applied;
    }
    return { healApplied: applied, overheal: over };
  }

  // -------------------------------------------------------------- 护盾系统
  private totalShield(c: RuntimeCombatant): number {
    let s = 0;
    for (const sh of c.shields) s += sh.value;
    return s;
  }

  /** 生成护盾：支持类型、刷新规则、优先级、持续时间与护盾事件 */
  private gainShield(atMs: number, source: Unit, target: Unit, seg: ShieldSegment, meta: SegmentMeta): void {
    const tgt = target.combatant;
    if (!tgt.alive) return;
    if (tgt.maxHp > 0 && this.totalShield(tgt) >= tgt.maxHp * 99) return; // 安全阀，防止极端堆叠溢出
    const amount = this.evalFormula(source, target, seg.basePower, seg.scaling, atMs);
    if (amount <= 0) return;
    const value = amount * (1 + clampPercent(tgt.stats.shieldBonus));
    const sourceLabel = meta.skillName || meta.itemName || meta.talentName || '护盾';
    const expMs = seg.durationSeconds > 0 ? atMs + Math.round(seg.durationSeconds * 1000) : 0;

    const acc = this.accum.get(source.id)!;
    acc.defense.shieldGenerated += value;
    acc.defense.shieldsGained++;
    acc.defense.shieldTotal += value;
    if (value > acc.defense.shieldMaxSingle) acc.defense.shieldMaxSingle = value;

    // 同来源（技能/装备/天赋 + 类型）护盾的刷新规则
    const key = `${sourceLabel}:${seg.shieldType}`;
    const existing = tgt.shields.find((s) => `${s.source}:${s.type}` === key);
    let created: ShieldInstance | null = null;
    if (existing && seg.refresh !== 'stack') {
      if (seg.refresh === 'max') {
        if (existing.value >= value) {
          // 已有护盾更大，不刷新
          this.emit('shield_gain', source.id, target.id, {
            shieldId: existing.id, shieldType: seg.shieldType, shieldSource: sourceLabel,
            shield: existing.value, targetRemainingHp: tgt.hp,
            description: `护盾刷新（取最大值）保持 ${f(existing.value)}`,
          });
          return;
        }
        existing.value = value; existing.maxValue = value; existing.priority = seg.priority;
        if (expMs) existing.expireTime = expMs;
        created = existing;
      } else if (seg.refresh === 'extend') {
        if (expMs) existing.expireTime = expMs;
        this.emit('shield_gain', source.id, target.id, {
          shieldId: existing.id, shieldType: seg.shieldType, shieldSource: sourceLabel,
          shield: existing.value, targetRemainingHp: tgt.hp,
          description: `护盾刷新（延续时长）${f(existing.value)}，延时至 ${this.msDisplay(expMs)}`,
        });
        return;
      } else {
        // overwrite
        const idx = tgt.shields.indexOf(existing);
        if (idx >= 0) tgt.shields.splice(idx, 1);
        created = this.makeShield(tgt, sourceLabel, seg.shieldType, value, atMs, expMs, seg.priority);
        tgt.shields.push(created);
      }
    } else {
      created = this.makeShield(tgt, sourceLabel, seg.shieldType, value, atMs, expMs, seg.priority);
      tgt.shields.push(created);
    }

    this.emit('shield_gain', source.id, target.id, {
      shieldId: created.id, shieldType: seg.shieldType, shieldSource: sourceLabel,
      shield: value, targetRemainingHp: tgt.hp,
      description: `${target.combatant.label}获得${shieldTypeLabel(seg.shieldType)}护盾 ${f(value)}${seg.durationSeconds > 0 ? `（持续 ${seg.durationSeconds}s）` : ''}`,
    });
    if (meta?.skillId) this.skillOf(acc, meta.skillId, meta.skillName || '').shield += value;
    if (meta?.itemId) this.itemOf(acc, meta.itemId, meta.itemName || '').shield += value;

    // 护盾自然消失调度
    if (expMs > 0) {
      this.schedule(expMs, () => this.expireShield(target, created.id, atMs, expMs));
    }
    // 生成事件触发
    const ownerUnit = this.units.get(tgt.id);
    if (ownerUnit?.hero) this.fireTriggers(ownerUnit, 'shield_created', atMs, {});
  }

  private makeShield(owner: RuntimeCombatant, source: string, type: ShieldType, value: number, nowMs: number, expireMs: number, priority: number): ShieldInstance {
    return {
      id: uid('shd'), source, owner: owner.id, type,
      value, maxValue: value, createTime: nowMs, expireTime: expireMs, priority,
    };
  }

  private msDisplay(expMs: number): string {
    if (expMs <= 0) return '∞';
    return `${(expMs / 1000).toFixed(1)}s`;
  }

  private expireShield(owner: Unit, shieldId: string, _createMs: number, expMs: number): void {
    const c = owner.combatant;
    const idx = c.shields.findIndex((s) => s.id === shieldId);
    if (idx < 0) return; // 已被消耗/覆盖
    const sh = c.shields[idx];
    if (sh.value <= 0) return;
    c.shields.splice(idx, 1);
    const acc = this.accum.get(owner.id)!;
    acc.defense.shieldExpired++;
    this.emit('shield_expired', owner.id, owner.id, {
      shieldId: sh.id, shieldType: sh.type, shieldSource: sh.source,
      targetRemainingHp: c.hp, description: `${c.label}的${shieldTypeLabel(sh.type)}护盾自然消失`,
    });
    this.fireTriggers(owner, 'shield_expired', this.now, {});
  }

  /**
   * 将伤害吸收进可吸收的护盾。
   * 多护盾规则：优先级高者优先，同优先级按生成时间先进先出（FIFO）。
   * 护盾归零 → 计入被击破，触发 shield_broken。
   */
  private absorbIntoShields(atMs: number, target: Unit, damageType: DamageType, amount: number): number {
    const c = target.combatant;
    if (amount <= 0 || c.shields.length === 0) return 0;
    // 可吸收的护盾类型
    let isAbsorbable: (t: ShieldType) => boolean;
    if (damageType === 'physical') isAbsorbable = (t) => t === 'all' || t === 'physical';
    else if (damageType === 'magic') isAbsorbable = (t) => t === 'all' || t === 'magic';
    else isAbsorbable = (t) => t === 'all'; // true 伤害只进全类型盾
    const acc = this.accum.get(target.id)!;
    let remaining = amount;
    let absorbedTotal = 0;
    // 排序：priority 高优先，同优先级 createTime 先进先出
    const usable = c.shields
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => isAbsorbable(s.type) && s.value > 0)
      .sort((a, b) => (b.s.priority - a.s.priority) || (a.s.createTime - b.s.createTime));
    for (const { s } of usable) {
      if (remaining <= 0) break;
      const take = Math.min(s.value, remaining);
      s.value -= take;
      remaining -= take;
      absorbedTotal += take;
      if (take > 0) {
        acc.defense.shieldAbsorbed += take;
        if (s.type === 'physical') acc.defense.physicalShieldAbsorbed += take;
        else if (s.type === 'magic') acc.defense.magicShieldAbsorbed += take;
        else acc.defense.allShieldAbsorbed += take;
        // 受到伤害事件（护盾受苦）
        const damaged = take > 0;
        void damaged;
        this.fireTriggers(target, 'shield_damaged', atMs, {});
        if (s.value <= 0) {
          // 击破
          const idx = c.shields.indexOf(s);
          if (idx >= 0) c.shields.splice(idx, 1);
          acc.defense.shieldBroken++;
          this.emit('shield_broken', target.id, target.id, {
            shieldId: s.id, shieldType: s.type, shieldSource: s.source,
            targetRemainingHp: c.hp, description: `${c.label}的${shieldTypeLabel(s.type)}护盾被击破`,
          });
          this.fireTriggers(target, 'shield_broken', atMs, {});
        }
      }
    }
    c.shields = c.shields.filter((s) => s.value > 0);
    return absorbedTotal;
  }

  // -------------------------------------------------------------- 冷却减少
  private reduceCooldowns(atMs: number, source: Unit, seg: CooldownReduceSegment, meta: SegmentMeta): void {
    const hero = source.hero;
    if (!hero) return;
    const reduceMs = Math.max(0, seg.seconds * 1000);
    if (reduceMs <= 0) return;
    const triggerSkillId = meta.skillId;
    const ids = this.reduceScope(source, seg.target, triggerSkillId, seg.skillIds);
    const applied: string[] = [];
    for (const id of ids) {
      const readyAt = hero.skillCds.get(id) ?? 0;
      if (readyAt <= atMs) continue; // 已在冷却等待完成，无需减少
      const remaining = readyAt - atMs;
      const newRemaining = Math.max(0, remaining - reduceMs);
      hero.skillCds.set(id, atMs + newRemaining);
      applied.push(id);
      // 提前就绪事件：使冷却减少实时影响「下一次可释放时间」，而不是等原始就绪事件才释放
      if (newRemaining < remaining) {
        const skill = hero.skills.find((s) => s.id === id);
        if (skill) {
          this.schedule(atMs + newRemaining, () => this.skillReadyEvent(source, skill, atMs + newRemaining));
        }
      }
    }
    this.emit('cooldown_reduce', source.id, source.id, {
      skillId: triggerSkillId,
      description: `冷却减少：${seg.target === 'SELF_SKILL' ? '该技能' : seg.target === 'OTHER_SKILLS' ? '其他技能' : '所有技能'} ${f(seg.seconds)}s${applied.length ? `（命中 ${applied.length} 个技能）` : ''}`,
    });
  }

  private reduceScope(unit: Unit, target: CooldownReduceSegment['target'], triggerSkillId: string | undefined, skillIds?: string[]): string[] {
    const hero = unit.hero!;
    const all = hero.skills.filter((s) => s.type === 'active' && s.id !== BASIC_ATTACK_SKILL_MARKER).map((s) => s.id);
    let pool: string[] = [];
    if (skillIds && skillIds.length) {
      pool = skillIds;
    } else if (target === 'SELF_SKILL') {
      if (triggerSkillId && triggerSkillId !== BASIC_ATTACK_SKILL_MARKER) pool = [triggerSkillId];
      else pool = [];
    } else if (target === 'OTHER_SKILLS') {
      pool = all.filter((id) => id !== triggerSkillId);
    } else {
      pool = all;
    }
    return pool;
  }

  // -------------------------------------------------------------- 公式
  private evalFormula(unit0: Unit, unit1: Unit, base: number, scaling: StatScaling[], _atMs: number, snap?: DamageSnapshot): number {
    let value = base || 0;
    for (const s of scaling) value += this.resolveStat(unit0, unit1, s.stat, snap) * s.ratio;
    return value;
  }

  private resolveStat(source: Unit, target: Unit, stat: StatKey, snap?: DamageSnapshot): number {
    const src = snap ? snap.source : source.combatant.stats;
    const tgt = snap ? snap.target : target.combatant.stats;
    switch (stat) {
      case 'maxHp': return src.maxHp;
      case 'currentHp': return src.currentHp;
      case 'lostHp': return src.maxHp - src.currentHp;
      case 'attack': return src.attack;
      case 'extraAttack': return src.extraAttack;
      case 'ap': return src.ap;
      case 'armor': return src.armor;
      case 'magicResist': return src.magicResist;
      case 'moveSpeed': return src.moveSpeed;
      case 'targetMaxHp': return tgt.maxHp;
      case 'targetCurrentHp': return tgt.currentHp;
      case 'targetLostHp': return tgt.maxHp - tgt.currentHp;
      case 'targetAttack': return tgt.attack;
      case 'targetAp': return tgt.ap;
      default: return 0;
    }
  }

  // -------------------------------------------------------------- 装备触发
  private scheduleIntervalEquipment(owner: Unit): void {
    if (!owner.hero) return;
    for (const item of owner.hero.items) {
      for (const effect of item.effects) {
        if (effect.trigger.kind !== 'on_interval') continue;
        const every = effect.trigger.everySeconds * 1000;
        this.schedule(this.now + every, () => this.fireIntervalEquip(owner, item, effect, every, this.now + every));
      }
    }
  }

  private fireIntervalEquip(owner: Unit, item: Equipment, effect: EquipmentEffect, every: number, atMs: number): void {
    if (!owner.hero || !owner.combatant.alive) return;
    this.triggerEquip(owner, item, effect, atMs);
    this.schedule(atMs + every, () => this.fireIntervalEquip(owner, item, effect, every, atMs + every));
  }

  private evaluateEquipment(owner: Unit, atMs: number, ctx: { kind: EquipmentTrigger['kind']; damageType?: DamageType }, chain?: TriggerChain): void {
    if (!owner.hero) return;
    for (const item of owner.hero.items) {
      for (const effect of item.effects) {
        if (effect.trigger.kind === 'on_interval') continue;
        // 兼容旧的专用枚举：on_skill_hit 对应统一事件 skill_hit；on_basic_attack_crit 对应 basic_attack_crit
        if (effect.trigger.kind === 'on_cast_skill') {
          if (ctx.kind === 'on_cast_skill') this.triggerEquip(owner, item, effect, atMs, chain);
          continue;
        }
        if (!this.triggerMatches(eventKindOf(effect.trigger.kind), ctx)) continue;
        this.triggerEquip(owner, item, effect, atMs, chain);
      }
    }
  }

  private triggerMatches(triggerKind: EquipmentTrigger['kind'] | null, ctx: { kind: EquipmentTrigger['kind']; damageType?: DamageType }): boolean {
    if (!triggerKind) return false;
    if (triggerKind !== ctx.kind) return false;
    if (triggerKind === 'on_skill_hit' || triggerKind === 'on_damage_dealt') {
      const dt = (ctx as { damageType?: DamageType }).damageType;
      return true;
    }
    return true;
  }

  private evaluateHpBelow(owner: Unit, atMs: number, hpPercent: number): void {
    if (!owner.hero) return;
    for (const item of owner.hero.items) {
      for (const effect of item.effects) {
        if (effect.trigger.kind !== 'on_hp_below') continue;
        if (hpPercent <= effect.trigger.hpBelowPercent) this.triggerEquip(owner, item, effect, atMs);
      }
    }
    // 条件型天赋：生命低于条件触发
    for (const talent of owner.hero.talents) {
      if (!talent.trigger) continue;
      if (talent.trigger.event !== 'hp_below') continue;
      const cond = talent.trigger.condition;
      const below = cond && cond.type === 'hpBelow' ? cond.hpBelowPercent : 30;
      if (hpPercent <= below) this.fireTalent(owner, talent, atMs);
    }
  }

  private triggerEquip(owner: Unit, item: Equipment, effect: EquipmentEffect, atMs: number, chain?: TriggerChain): void {
    if (!owner.hero) return;
    const key = `e:${effect.id}`;
    if (owner.hero.procCds.has(key) && owner.hero.procCds.get(key)! > atMs) return;
    const child = this.nextTriggerChain(chain, `${item.id}:${effect.id}`);
    if (!child) return;
    if (effect.limit) owner.hero.procCds.set(key, atMs + effect.limit.seconds * 1000);
    const acc = this.accum.get(owner.id)!;
    const it = this.itemOf(acc, item.id, item.name);
    it.procs++; it.times.push(atMs);
    const target = this.enemyOf(owner.id);
    this.emit('item_proc', owner.id, target?.id ?? owner.id, {
      itemId: item.id, itemName: item.name, rootEventId: child.rootEventId, triggerDepth: child.depth, sourceEffectId: `${item.id}:${effect.id}`,
      description: `装备「${item.name}」触发：${effect.name}`,
    });
    if (target) {
      for (const seg of effect.segments) {
        this.scheduleSegment(atMs, owner, target, seg, {
          sourceKind: 'item', sourceType: 'item', itemId: item.id, itemName: item.name,
        }, child);
      }
    }
  }

  // -------------------------------------------------------------- 统一触发器（Effect Engine）
  /**
   * 统一触发器：技能被动、装备效果、天赋触发全部收敛到这里。
   * event 使用统一 TriggerEvent；同时兼容旧式 PassiveTrigger/EquipmentTrigger 命名（on_*）。
   */
  private fireTriggers(unit: Unit, event: TriggerEvent | string, atMs: number, ctx: { damageType?: DamageType; skillId?: string }, chain?: TriggerChain): void {
    if (!unit.hero || !unit.combatant.alive) return;
    if (chain && chain.depth >= MAX_TRIGGER_DEPTH) { this.cappedTriggers++; return; }
    // 1) 被动技能
    this.firePassives(unit, toPassiveKind(event), ctx, atMs, chain);
    // 2) 装备效果
    this.evaluateEquipment(unit, atMs, { kind: toEquipKind(event), damageType: ctx.damageType }, chain);
    // 3) 天赋
    const enemy = this.enemyOf(unit.id);
    for (const talent of unit.hero.talents) {
      if (!talent.trigger || talent.type === 'attribute') continue;
      if (talent.trigger.event !== event) continue;
      if (talent.trigger.condition && !this.evaluateCondition(talent.trigger.condition, unit, enemy, ctx, event)) continue;
      this.fireTalent(unit, talent, atMs, chain);
    }
  }

  /** 条件求值（#172-174）：支持 AND/OR/NOT 组合、状态标签、Buff 层数、生命值比较 */
  private evaluateCondition(cond: TriggerConditionKind, unit: Unit, target: Unit | undefined, ctx: { damageType?: DamageType; skillId?: string }, event: string): boolean {
    const hasRuntime = !!unit.hero;
    switch (cond.type) {
      case 'none': return true;
      case 'and': return cond.conditions.every((c) => this.evaluateCondition(c, unit, target, ctx, event));
      case 'or': return cond.conditions.some((c) => this.evaluateCondition(c, unit, target, ctx, event));
      case 'not': return !this.evaluateCondition(cond.condition, unit, target, ctx, event);
      case 'damageType':
        if (event !== 'damage_dealt' && event !== 'skill_hit' && event !== 'damage_taken') return true;
        return cond.damageType === ctx.damageType;
      case 'hpBelow': {
        const hp = unit.combatant.maxHp > 0 ? (unit.combatant.hp / unit.combatant.maxHp) * 100 : 0;
        return hp <= cond.hpBelowPercent;
      }
      case 'state':
        return cond.present === (hasRuntime ? unit.hero!.runtime.stateTags.has(cond.state) : false);
      case 'buffStack': {
        const st = hasRuntime ? buffStacks(unit.hero!.runtime, cond.buffType) : 0;
        return cmp(st, cond.op, cond.value);
      }
      case 'hpCompare': {
        if (!target) return false;
        const v = this.hpConditionValue(cond.stat, unit.combatant.stats, target.combatant.stats);
        return cmp(v, cond.op, cond.value, cond.value2);
      }
      case 'every': // 由定时器调度，无需条件判断
        return true;
      default:
        return true;
    }
  }

  /**
   * 触发链推进（#159-161）：
   *  - 超过 MAX_TRIGGER_DEPTH → 返回 null（终止继续触发）
   *  - allowSelfTrigger=false 时，若效果键已在祖先路径中出现 → 返回 null（防止 A→B→A 循环）
   */
  private nextTriggerChain(chain: TriggerChain | undefined, effectKey: string): TriggerChain | null {
    const depth = chain ? chain.depth + 1 : 1;
    if (depth > MAX_TRIGGER_DEPTH) { this.cappedTriggers++; return null; }
    const path = chain ? [...chain.path, effectKey] : [effectKey];
    if (!ALLOW_SELF_TRIGGER && path.slice(0, -1).includes(effectKey)) {
      this.selfBlockedTriggers++;
      return null;
    }
    return { rootEventId: chain ? chain.rootEventId : (this.events.length || 1), depth, path };
  }

  private fireTalent(unit: Unit, talent: Talent, atMs: number, chain?: TriggerChain): void {
    if (!unit.hero || !unit.combatant.alive) return;
    const key = `t:${talent.id}`;
    if (unit.hero.procCds.has(key) && unit.hero.procCds.get(key)! > atMs) return;
    const child = this.nextTriggerChain(chain, talent.id);
    if (!child) return;
    const target = this.enemyOf(unit.id);
    this.emit('talent_proc', unit.id, target?.id ?? unit.id, {
      talentId: talent.id, talentName: talent.name, rootEventId: child.rootEventId, triggerDepth: child.depth, sourceEffectId: talent.id,
      description: `天赋「${talent.name}」触发`,
    });
    if (target) {
      for (const seg of talent.effects) {
        this.scheduleSegment(atMs, unit, target, seg, {
          sourceKind: 'skill', sourceType: 'talent',
          talentId: talent.id, talentName: talent.name,
        }, child);
      }
    }
  }

  private fireCombatStartTalents(unit: Unit): void {
    if (!unit.hero) return;
    for (const talent of unit.hero.talents) {
      if (talent.type === 'attribute' || !talent.trigger) continue;
      const event = talent.trigger.event;
      if (event === 'combat_start') this.fireTalent(unit, talent, this.now);
    }
  }

  private scheduleIntervalTalents(unit: Unit): void {
    if (!unit.hero) return;
    for (const talent of unit.hero.talents) {
      if (!talent.trigger || talent.trigger.event !== 'interval') continue;
      const cond = talent.trigger.condition;
      const every = (cond && cond.type === 'every' ? cond.everySeconds : 1) * 1000;
      this.schedule(this.now + every, () => this.fireIntervalTalent(unit, talent, every, this.now + every));
    }
  }

  private fireIntervalTalent(unit: Unit, talent: Talent, every: number, atMs: number): void {
    if (!unit.hero || !unit.combatant.alive) return;
    this.fireTalent(unit, talent, atMs);
    this.schedule(atMs + every, () => this.fireIntervalTalent(unit, talent, every, atMs + every));
  }

  // -------------------------------------------------------------- 被动技能（兼容旧式）
  private fireCombatStartPassives(unit: Unit): void {
    if (!unit.hero) return;
    for (const skill of unit.hero.skills) {
      if (skill.type !== 'passive' || !skill.passive) continue;
      if (skill.passive.trigger.kind === 'on_combat_start') this.firePassive(unit, skill, this.now);
      else if (skill.passive.trigger.kind === 'on_interval') {
        const every = skill.passive.trigger.everySeconds * 1000;
        this.schedule(this.now + every, () => this.fireIntervalPassive(unit, skill, every, this.now + every));
      }
    }
  }

  private fireIntervalPassive(unit: Unit, skill: Skill, every: number, atMs: number): void {
    if (!unit.hero || !unit.combatant.alive) return;
    this.firePassive(unit, skill, atMs);
    this.schedule(atMs + every, () => this.fireIntervalPassive(unit, skill, every, atMs + every));
  }

  private firePassive(unit: Unit, skill: Skill, atMs: number, chain?: TriggerChain): void {
    if (!unit.hero || !skill.passive || !unit.combatant.alive) return;
    const key = `p:${skill.id}`;
    if (unit.hero.procCds.has(key) && unit.hero.procCds.get(key)! > atMs) return;
    if (skill.passive.procCooldownSeconds > 0) {
      unit.hero.procCds.set(key, atMs + skill.passive.procCooldownSeconds * 1000);
    }
    const child = this.nextTriggerChain(chain, skill.id);
    if (!child) return;
    const target = this.enemyOf(unit.id);
    this.emit('skill_cast', unit.id, target?.id ?? unit.id, {
      skillId: skill.id, skillName: skill.name, rootEventId: child.rootEventId, triggerDepth: child.depth, sourceEffectId: skill.id,
      description: `被动「${skill.name}」触发`,
    });
    this.skillOf(this.accum.get(unit.id)!, skill.id, skill.name).cast++;
    this.fireTriggers(unit, 'cast_skill', atMs, { skillId: skill.id }, child);
    if (target) {
      for (const seg of skill.segments) {
        this.scheduleSegment(atMs, unit, target, seg, {
          sourceKind: 'skill', sourceType: 'skill', skillId: skill.id, skillName: skill.name,
        }, child);
      }
    }
  }

  private firePassives(
    unit: Unit, kind: PassivePollKind, ctx: { damageType?: DamageType } | undefined, atMs: number, chain?: TriggerChain,
  ): void {
    if (!unit.hero) return;
    for (const skill of unit.hero.skills) {
      if (skill.type !== 'passive' || !skill.passive) continue;
      if (skill.passive.trigger.kind !== kind) continue;
      if (
        kind === 'on_damage_dealt' && 'damageType' in skill.passive.trigger &&
        skill.passive.trigger.damageType && skill.passive.trigger.damageType !== ctx?.damageType
      ) continue;
      this.firePassive(unit, skill, atMs, chain);
    }
  }

  // -------------------------------------------------------------- 统计
  private skillOf(acc: RunAccum, id: string, name: string) {
    let s = acc.skills.get(id);
    if (!s) { s = { id, name, cast: 0, hits: 0, dmg: 0, crits: 0, heal: 0, shield: 0 }; acc.skills.set(id, s); }
    return s;
  }
  private itemOf(acc: RunAccum, id: string, name: string) {
    let it = acc.items.get(id);
    if (!it) { it = { id, name, procs: 0, dmg: 0, heal: 0, shield: 0, times: [] }; acc.items.set(id, it); }
    return it;
  }

  private accBuff(unit: Unit, gained: boolean): void {
    const acc = this.accum.get(unit.id)!;
    if (gained) acc.buffs.gained++;
    const r = this.runtimeOf(unit);
    const asStacks = buffStacks(r, 'attack_speed');
    if (asStacks > acc.buffs.maxAttackSpeedStacks) acc.buffs.maxAttackSpeedStacks = asStacks;
  }

  /** 扫除过期 Buff：攻速/突破重算，统计过期数（见 #136/#163） */
  private sweepUnitBuffs(unit: Unit, atMs: number): void {
    if (!unit.hero) return;
    const r = this.runtimeOf(unit);
    const removed = sweepExpired(r, atMs);
    if (removed.length) {
      this.accum.get(unit.id)!.buffs.expired += removed.length;
      for (const b of removed) {
        this.emit('buff', unit.id, unit.id, {
          buffType: b.buffType, buffStacks: 0, buffAction: 'expired',
          description: `${unit.combatant.label}的「${buffTypeLabel(b.buffType)}」自然结束`,
        });
      }
    }
    // 重算临时攻速 / 突破（随 Buff 生命周期实时变化）
    r.tempAttackSpeed = buffTotal(r, 'attack_speed');
    r.tempCapBreakthrough = buffTotal(r, 'attack_cap_break');
  }

  private accDamage(
    source: Unit, meta: SegmentMeta, damageType: DamageType, _raw: number, landed: number,
    crit: boolean, bucket: DamageSourceKind,
  ): void {
    const acc = this.accum.get(source.id)!;
    const D = acc.damage;
    D.total += landed;
    D.physical += damageType === 'physical' ? landed : 0;
    D.magic += damageType === 'magic' ? landed : 0;
    D.trueDmg += damageType === 'true' ? landed : 0;
    if (bucket === 'basic_attack') D.basicAttack += landed;
    else if (bucket === 'skill') D.skill += landed;
    else if (bucket === 'item') D.item += landed;
    else D.dot += landed;
    if (crit) { D.critCount++; D.critDamage += landed; }
    D.hitCount++;
    this.cumDmgById.set(source.id, (this.cumDmgById.get(source.id) ?? 0) + landed);
    if (meta.skillId && meta.skillId !== BASIC_ATTACK_SKILL_MARKER) {
      const s = this.skillOf(acc, meta.skillId, meta.skillName || '');
      s.hits++; s.dmg += landed; if (crit) s.crits++;
    }
    if (meta.itemId) {
      const it = this.itemOf(acc, meta.itemId, meta.itemName || '');
      it.dmg += landed;
    }
  }

  private accTaken(target: Unit, damageType: DamageType, landed: number, absorbed: number, dmgType: DamageType): void {
    const acc = this.accum.get(target.id)!;
    const D = acc.defense;
    D.damageTaken += landed;
    D.physicalTaken += damageType === 'physical' ? landed : 0;
    D.magicTaken += damageType === 'magic' ? landed : 0;
    D.trueTaken += damageType === 'true' ? landed : 0;
    // 护盾吸收量在吸吸收环节已计入 shieldAbsorbed 与分类型
    void absorbed; void dmgType;
  }

  // -------------------------------------------------------------- 结果
  private buildResult(): CombatResult {
    const results: CombatResult['results'] = [];
    for (const unit of this.units.values()) {
      const acc = this.accum.get(unit.id)!;
      const c = unit.combatant;
      results.push({
        id: unit.id, label: c.label, isDummy: c.isDummy, isHero: !!unit.hero,
        survivedMs: this.endMs, finalHp: Math.round(c.hp), maxHp: c.maxHp, alive: c.alive,
        damage: { ...acc.damage },
        lifesteal: { ...acc.lifesteal },
        defense: { ...acc.defense },
        skills: [...acc.skills.values()].map((s) => ({
          skillId: s.id, name: s.name, castCount: s.cast, hitCount: s.hits, damage: s.dmg,
          critCount: s.crits, heal: s.heal, shield: s.shield, avgDamage: s.hits ? s.dmg / s.hits : 0,
        })),
        items: [...acc.items.values()].map((it) => ({
          itemId: it.id, name: it.name, procCount: it.procs, damage: it.dmg, heal: it.heal,
          shield: it.shield, procTimesMs: it.times,
        })),
        buffs: unit.hero
          ? {
              gained: acc.buffs.gained, expired: acc.buffs.expired,
              activeAtEnd: unit.hero.runtime.buffs.length,
              maxAttackSpeedStacks: acc.buffs.maxAttackSpeedStacks,
              attackSpeedStacksAtEnd: buffStacks(unit.hero.runtime, 'attack_speed'),
            }
          : { gained: 0, expired: 0, activeAtEnd: 0, maxAttackSpeedStacks: 0, attackSpeedStacksAtEnd: 0 },
        counters: unit.hero ? Object.fromEntries(unit.hero.runtime.counters) : {},
      });
    }
    const snapshot: CombatSnapshot = {
      schemaVersion: 2,
      config: this.config,
      combatants: [...this.units.values()].map((u) => ({ ...u.combatant, stats: { ...u.combatant.stats }, shields: u.combatant.shields.map((s) => ({ ...s })) })),
      simVersion: '0.2.0',
    };
    return {
      schemaVersion: 2,
      config: this.config,
      snapshot,
      events: this.events,
      durationMs: this.now,
      endReason: this.endReason,
      results,
      damageCurve: this.damageCurve,
      hpCurve: this.hpCurve,
    };
  }
}

/** 入口：运行一次战斗 */
export function runCombat(config: CombatConfig, equipmentById: Map<string, Equipment>): CombatResult {
  return new CombatEngine(config, equipmentById).run();
}

// ---------------------------------------------------------------- 枚举映射
/** 统一 TriggerEvent → 旧式 PassiveTrigger.kind */
function toPassiveKind(event: TriggerEvent | string): PassivePollKind {
  switch (event) {
    case 'basic_attack_hit': return 'on_basic_attack_hit';
    case 'basic_attack_crit': return 'on_basic_attack_crit';
    case 'skill_hit': return 'on_skill_hit';
    case 'damage_dealt': return 'on_damage_dealt';
    case 'damage_taken': return 'on_damage_taken';
    case 'kill': return 'on_kill';
    case 'cast_skill': return 'on_cast_skill';
    case 'shield_created': return 'on_shield_created';
    case 'shield_damaged': return 'on_shield_damaged';
    case 'shield_broken': return 'on_shield_broken';
    case 'shield_expired': return 'on_shield_expired';
    case 'on_attack':
    case 'on_hit':
    case 'on_basic_attack_hit':
    case 'on_basic_attack_crit':
    case 'on_damage_dealt':
    case 'on_damage_taken':
    case 'on_kill':
      return event as PassivePollKind;
    default: return 'on_hit';
  }
}

/** 统一 TriggerEvent → 旧式 EquipmentTrigger.kind */
function toEquipKind(event: TriggerEvent | string): EquipmentTrigger['kind'] {
  switch (event) {
    case 'basic_attack_hit': return 'on_basic_attack_hit';
    case 'basic_attack_crit': return 'on_basic_attack_crit';
    case 'skill_hit': return 'on_skill_hit';
    case 'damage_dealt': return 'on_damage_dealt';
    case 'damage_taken': return 'on_damage_taken';
    case 'kill': return 'on_kill';
    case 'cast_skill': return 'on_cast_skill';
    case 'shield_created': return 'on_shield_created';
    case 'shield_damaged': return 'on_shield_damaged';
    case 'shield_broken': return 'on_shield_broken';
    case 'shield_expired': return 'on_shield_expired';
    case 'on_basic_attack_hit':
    case 'on_basic_attack_crit':
    case 'on_skill_hit':
    case 'on_damage_dealt':
    case 'on_damage_taken':
    case 'on_kill':
    case 'on_cast_skill':
    case 'on_shield_created':
    case 'on_shield_damaged':
    case 'on_shield_broken':
    case 'on_shield_expired':
      return event as EquipmentTrigger['kind'];
    default: return 'on_damage_taken';
  }
}

/** 任意触发事件 kind → 设备触发 kind（供 triggerMatches 使用） */
function eventKindOf(kind: EquipmentTrigger['kind']): EquipmentTrigger['kind'] | null {
  return kind;
}