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
  type CombatantId, type CooldownReduceSegment, type DamageSegment,
  type DamageSourceKind, type DamageType, type DotSegment, type EffectSegment,
  type Equipment, type EquipmentEffect, type EquipmentTrigger, type EventType,
  type PassiveTrigger, type RuntimeCombatant, type HeroStats, type ShieldInstance,
  type ShieldSegment, type ShieldType, type Skill, type StatKey, type StatScaling,
  type Talent, type TalentType, type TriggerEvent,
  BASIC_ATTACK_SKILL_MARKER,
} from '../types';
import { clampPercent } from '../formulas/cooldown';
import { createRng, Rng } from './rng';
import { resolveCrit } from '../formulas/crit';
import { finalArmor, finalMagicResist } from '../formulas/penetration';
import { buildDummyCombatant, buildHeroCombatant, clampHp } from './stats';
import { uid } from '../defaults';

const SAMPLE_MS = 250;

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

interface UnitHero {
  skills: Skill[];
  items: Equipment[];
  talents: Talent[];
  basicAttack: DamageSegment;
  /** 技能就绪时间（毫秒） */
  skillCds: Map<string, number>;
  /** 装备效果/被动技能/天赋内部冷却就绪时间 */
  procCds: Map<string, number>;
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
  return d === 'physical' ? '物理' : d === 'magic' ? '魔法' : '真实';
}
function shieldTypeLabel(t: ShieldType): string {
  return t === 'physical' ? '物理' : t === 'magic' ? '魔法' : '全类型';
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
    const target = this.enemyOf(unit.id);
    if (!target || !target.combatant.alive) return;
    this.applySegment(atMs, unit, target, unit.hero!.basicAttack, {
      sourceKind: 'basic_attack', sourceType: 'basic_attack',
      skillId: BASIC_ATTACK_SKILL_MARKER, skillName: '普通攻击',
    });
    this.fireTriggers(unit, 'basic_attack_hit', atMs, {});
    this.fireTriggers(unit, 'on_attack', atMs, {}); // 兼容旧枚举：攻击时
    const next = atMs + Math.max(1, unit.combatant.stats.attackInterval * 1000);
    this.schedule(next, () => this.autoAttack(unit, next));
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
    baseMs: number, source: Unit, target: Unit, seg: EffectSegment, meta: SegmentMeta,
  ): void {
    const at = baseMs + Math.round((seg.delaySeconds || 0) * 1000);
    if (at === baseMs) {
      this.applySegment(at, source, target, seg, meta);
      return;
    }
    this.schedule(at, () => this.applySegment(at, source, target, seg, meta));
  }

  private applySegment(
    atMs: number, source: Unit, target: Unit, seg: EffectSegment, meta: SegmentMeta,
  ): void {
    if (!source.combatant.alive) return;
    switch (seg.kind) {
      case 'damage':
        this.dealDamage(atMs, source, target, seg, meta);
        break;
      case 'dot':
        this.scheduleDot(atMs, source, target, seg, meta);
        break;
      case 'heal': {
        const amount = this.evalFormula(source, target, seg.basePower, seg.scaling, atMs);
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
    }
  }

  private scheduleDot(
    baseMs: number, source: Unit, target: Unit, seg: DotSegment, meta: SegmentMeta,
  ): void {
    const firstRelMs = Math.round((seg.delaySeconds || 0) * 1000);
    const tickMs = Math.max(1, seg.tickSeconds * 1000);
    const totalMs = Math.max(0, seg.totalSeconds * 1000);
    const tickCount = totalMs > 0 ? Math.floor(totalMs / tickMs) : 0;
    for (let i = 0; i <= tickCount; i++) {
      const at = baseMs + firstRelMs + i * tickMs;
      this.schedule(at, () => this.dealDamage(at, source, target, seg, { ...meta, sourceKind: 'dot', sourceType: 'dot' }));
    }
  }

  // -------------------------------------------------------------- 伤害流水线
  private dealDamage(
    atMs: number, source: Unit, target: Unit, seg: DamageSegment | DotSegment, meta: SegmentMeta,
  ): void {
    const base = seg.kind === 'damage' ? seg.baseDamage : seg.baseDamagePerTick;
    const scaling: StatScaling[] = seg.scaling || [];
    const damageType: DamageType = seg.damageType;
    const src = source.combatant.stats;
    const tgt = target.combatant.stats;

    // 1) 原始伤害
    let raw = this.evalFormula(source, target, base, scaling, atMs);

    // 2) 增伤
    if (seg.kind === 'damage' && seg.isBasicAttackBoost) raw *= 1 + clampPercent(src.attackDamage);
    if (seg.kind === 'damage' && seg.isSkillBoost) {
      raw *= 1 + clampPercent(damageType === 'physical' ? src.physicalSkillDamage : src.magicDamage);
    }
    if (damageType === 'magic' && (seg as DamageSegment).useMagicDamageBoost !== false) {
      raw *= 1 + clampPercent(src.magicDamage);
    }

    // 3) 暴击
    let crit = false;
    if (seg.canCrit) {
      const family = (seg as DamageSegment).critFamily || 'physical';
      const rate = (seg as DamageSegment).critChanceOverride ?? (family === 'physical' ? src.physicalCritRate : src.magicCritRate);
      const dmg = family === 'physical' ? src.physicalCritDamage : src.magicCritDamage;
      const res = resolveCrit(rate, dmg, this.config.randomMode, this.rng);
      crit = res.crit;
      raw *= res.multiplier;
    }

    // 4) 穿透 + 抗性（真实伤害默认不计算护甲/魔抗/穿透）
    let finalResist = 0;
    let resistRate = 0;
    if (damageType === 'physical') {
      finalResist = finalArmor(tgt.armor, src.flatArmorPen, src.percentArmorPen);
      resistRate = finalResist * 0.06 / (1 + finalResist * 0.06);
    } else if (damageType === 'magic') {
      finalResist = finalMagicResist(tgt.magicResist, src.flatMagicPen, src.percentMagicPen);
      resistRate = finalResist * 0.06 / (1 + finalResist * 0.06);
    }
    let afterResist = damageType === 'true' ? raw : raw * (1 - resistRate);

    // 6) 伤害减免（受伤害方视角）
    if (damageType !== 'true' || !this.config.trueDamageIgnoresReduction) {
      afterResist *= 1 - clampPercent(tgt.damageReduction);
    }

    // 7) 护盾吸收（真实伤害是否可吸收由 trueDamageAffectsShield 决定）
    let absorbed = 0;
    if (afterResist > 0 && (damageType !== 'true' || this.config.trueDamageAffectsShield)) {
      absorbed = this.absorbIntoShields(atMs, target, damageType, afterResist);
      afterResist -= absorbed;
      if (absorbed > 0) {
        this.accum.get(target.id)!.defense.shieldAbsorbed += absorbed;
        this.emit('shield_absorbed', source.id, target.id, { absorbedByShield: absorbed, targetRemainingHp: target.combatant.hp, description: `护盾吸收 ${f(absorbed)} 伤害` });
      }
    }

    // 8) 扣生命
    const hpLoss = Math.max(0, afterResist);
    target.combatant.hp = clampHp(target.combatant.hp - hpLoss);
    const priorAlive = target.combatant.alive;
    target.combatant.alive = target.combatant.hp > 0;

    this.emit(crit ? 'crit' : seg.kind === 'dot' ? 'dot_tick' : 'damage', source.id, target.id, {
      skillId: meta.skillId, skillName: meta.skillName, itemId: meta.itemId, itemName: meta.itemName,
      talentId: meta.talentId, talentName: meta.talentName,
      damageType, rawDamage: raw, crit, finalDamage: hpLoss, absorbedByShield: absorbed,
      targetRemainingHp: target.combatant.hp,
      description: `${source.combatant.label}${crit ? ' 暴击！' : ''} 造成${damageTypeLabel(damageType)}伤害 ${f(hpLoss)}（原伤害 ${f(raw)}）`,
      details: { finalResist, reductionRate: resistRate },
    });

    // 统计
    this.accDamage(source, meta, damageType, raw, hpLoss, crit, seg.kind === 'dot' ? 'dot' : meta.sourceKind);
    this.accTaken(target, damageType, hpLoss, absorbed, damageType);

    // 10) 吸血/回血
    if (seg.kind === 'damage') {
      if (seg.canLifesteal) {
        if (damageType === 'physical' && src.physicalVamp > 0) this.vamp(source, hpLoss, clampPercent(src.physicalVamp), 'physicalVamp');
        else if (damageType === 'magic' && src.magicVamp > 0) this.vamp(source, hpLoss, clampPercent(src.magicVamp), 'magicVamp');
        if (seg.useAllVamp && src.allVamp > 0) this.vamp(source, hpLoss, clampPercent(src.allVamp), 'allVamp');
        if (meta.sourceKind === 'basic_attack' && src.onHitHp > 0) {
          this.vamp(source, src.onHitHp, 1, 'onHitHp', true);
        }
      }
    }

    // 11) 装备/被动/天赋触发
    if (seg.canTriggerItems && hpLoss > 0) {
      this.fireTriggers(source, 'damage_dealt', atMs, { damageType });
      if (meta.sourceKind === 'basic_attack') {
        this.fireTriggers(source, 'basic_attack_hit', atMs, { damageType });
        if (crit) this.fireTriggers(source, 'basic_attack_crit', atMs, {});
        this.firePassives(source, 'on_hit', undefined, atMs);
      } else if (meta.sourceKind === 'skill' || meta.sourceKind === 'dot') {
        this.fireTriggers(source, 'skill_hit', atMs, { damageType, skillId: meta.skillId });
        this.firePassives(source, 'on_hit', undefined, atMs);
      }
      this.firePassives(source, 'on_damage_dealt', { damageType }, atMs);
      if (crit) this.firePassives(source, 'on_basic_attack_crit', undefined, atMs);
    }

    // 受击方触发
    if (hpLoss > 0) {
      this.fireTriggers(target, 'damage_taken', atMs, { damageType });
      this.firePassives(target, 'on_damage_taken', undefined, atMs);
      const pct = target.combatant.maxHp > 0 ? (target.combatant.hp / target.combatant.maxHp) * 100 : 0;
      this.evaluateHpBelow(target, atMs, pct);
    }

    // 12) 死亡
    if (priorAlive && !target.combatant.alive) {
      this.emit('death', source.id, target.id, { targetRemainingHp: 0, description: `${target.combatant.label} 阵亡` });
      if (!target.isDummy) {
        this.fireTriggers(source, 'kill', atMs, {});
        this.firePassives(source, 'on_kill', undefined, atMs);
      }
    }
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
    const room = target.maxHp - target.hp;
    const applied = Math.min(room, amount);
    const over = amount - applied;
    target.hp = Math.min(target.maxHp, target.hp + applied);
    const a = this.accum.get(source.id)!;
    a.lifesteal.totalHealing += applied;
    a.lifesteal.overheal += over;
    if (!silent) {
      this.emit('heal', source.id, target.id, {
        healing: applied, overheal: over, targetRemainingHp: target.hp,
        description: `${target.label} ${label}恢复 ${f(applied)}${over > 0 ? `（溢出 ${f(over)}）` : ''}`,
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
  private evalFormula(unit0: Unit, unit1: Unit, base: number, scaling: StatScaling[], _atMs: number): number {
    let value = base || 0;
    for (const s of scaling) value += this.resolveStat(unit0, unit1, s.stat) * s.ratio;
    return value;
  }

  private resolveStat(source: Unit, target: Unit, stat: StatKey): number {
    const src = source.combatant.stats;
    const tgt = target.combatant.stats;
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

  private evaluateEquipment(owner: Unit, atMs: number, ctx: { kind: EquipmentTrigger['kind']; damageType?: DamageType }): void {
    if (!owner.hero) return;
    for (const item of owner.hero.items) {
      for (const effect of item.effects) {
        if (effect.trigger.kind === 'on_interval') continue;
        // 兼容旧的专用枚举：on_skill_hit 对应统一事件 skill_hit；on_basic_attack_crit 对应 basic_attack_crit
        if (effect.trigger.kind === 'on_cast_skill') {
          if (ctx.kind === 'on_cast_skill') this.triggerEquip(owner, item, effect, atMs);
          continue;
        }
        if (!this.triggerMatches(eventKindOf(effect.trigger.kind), ctx)) continue;
        this.triggerEquip(owner, item, effect, atMs);
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

  private triggerEquip(owner: Unit, item: Equipment, effect: EquipmentEffect, atMs: number): void {
    if (!owner.hero) return;
    const key = `e:${effect.id}`;
    if (owner.hero.procCds.has(key) && owner.hero.procCds.get(key)! > atMs) return;
    if (effect.limit) owner.hero.procCds.set(key, atMs + effect.limit.seconds * 1000);
    const acc = this.accum.get(owner.id)!;
    const it = this.itemOf(acc, item.id, item.name);
    it.procs++; it.times.push(atMs);
    const target = this.enemyOf(owner.id);
    this.emit('item_proc', owner.id, target?.id ?? owner.id, {
      itemId: item.id, itemName: item.name,
      description: `装备「${item.name}」触发：${effect.name}`,
    });
    if (target) {
      for (const seg of effect.segments) {
        this.scheduleSegment(atMs, owner, target, seg, {
          sourceKind: 'item', sourceType: 'item', itemId: item.id, itemName: item.name,
        });
      }
    }
  }

  // -------------------------------------------------------------- 统一触发器（Effect Engine）
  /**
   * 统一触发器：技能被动、装备效果、天赋触发全部收敛到这里。
   * event 使用统一 TriggerEvent；同时兼容旧式 PassiveTrigger/EquipmentTrigger 命名（on_*）。
   */
  private fireTriggers(unit: Unit, event: TriggerEvent | string, atMs: number, ctx: { damageType?: DamageType; skillId?: string }): void {
    if (!unit.hero || !unit.combatant.alive) return;
    // 1) 被动技能
    this.firePassives(unit, toPassiveKind(event), ctx, atMs);
    // 2) 装备效果
    this.evaluateEquipment(unit, atMs, { kind: toEquipKind(event), damageType: ctx.damageType });
    // 3) 天赋
    for (const talent of unit.hero.talents) {
      if (!talent.trigger || talent.type === 'attribute') continue;
      if (talent.trigger.event !== event) continue;
      if (!this.conditionMatches(talent, event, ctx)) continue;
      this.fireTalent(unit, talent, atMs);
    }
  }

  private conditionMatches(talent: Talent, event: TriggerEvent | string, ctx: { damageType?: DamageType; skillId?: string }): boolean {
    const cond = talent.trigger?.condition;
    if (!cond || cond.type === 'none') return true;
    if (cond.type === 'damageType') {
      if (event !== 'damage_dealt' && event !== 'skill_hit' && event !== 'damage_taken') return true;
      return cond.damageType === ctx.damageType;
    }
    return true;
  }

  private fireTalent(unit: Unit, talent: Talent, atMs: number): void {
    if (!unit.hero || !unit.combatant.alive) return;
    const key = `t:${talent.id}`;
    if (unit.hero.procCds.has(key) && unit.hero.procCds.get(key)! > atMs) return;
    const target = this.enemyOf(unit.id);
    this.emit('talent_proc', unit.id, target?.id ?? unit.id, {
      talentId: talent.id, talentName: talent.name,
      description: `天赋「${talent.name}」触发`,
    });
    if (target) {
      for (const seg of talent.effects) {
        this.scheduleSegment(atMs, unit, target, seg, {
          sourceKind: 'skill', sourceType: 'talent',
          talentId: talent.id, talentName: talent.name,
        });
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

  private firePassive(unit: Unit, skill: Skill, atMs: number): void {
    if (!unit.hero || !skill.passive || !unit.combatant.alive) return;
    const key = `p:${skill.id}`;
    if (unit.hero.procCds.has(key) && unit.hero.procCds.get(key)! > atMs) return;
    if (skill.passive.procCooldownSeconds > 0) {
      unit.hero.procCds.set(key, atMs + skill.passive.procCooldownSeconds * 1000);
    }
    const target = this.enemyOf(unit.id);
    this.emit('skill_cast', unit.id, target?.id ?? unit.id, {
      skillId: skill.id, skillName: skill.name, description: `被动「${skill.name}」触发`,
    });
    this.skillOf(this.accum.get(unit.id)!, skill.id, skill.name).cast++;
    this.fireTriggers(unit, 'cast_skill', atMs, { skillId: skill.id });
    if (target) {
      for (const seg of skill.segments) {
        this.scheduleSegment(atMs, unit, target, seg, {
          sourceKind: 'skill', sourceType: 'skill', skillId: skill.id, skillName: skill.name,
        });
      }
    }
  }

  private firePassives(
    unit: Unit, kind: PassivePollKind, ctx: { damageType?: DamageType } | undefined, atMs: number,
  ): void {
    if (!unit.hero) return;
    for (const skill of unit.hero.skills) {
      if (skill.type !== 'passive' || !skill.passive) continue;
      if (skill.passive.trigger.kind !== kind) continue;
      if (
        kind === 'on_damage_dealt' && 'damageType' in skill.passive.trigger &&
        skill.passive.trigger.damageType && skill.passive.trigger.damageType !== ctx?.damageType
      ) continue;
      this.firePassive(unit, skill, atMs);
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