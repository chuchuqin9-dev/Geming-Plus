/**
 * 事件驱动战斗引擎（核心，纯 TS，不依赖 DOM）
 *
 * 设计要点：
 *  - 时间统一毫秒；用最小堆按时间取出最早事件，绝不按 1ms 暴力循环。
 *  - 同刻事件按 (timeMs, seq) 确定顺序，保证可复现。
 *  - 伤害走模块化流水线：原始→增伤→暴击→穿透→抗性→减伤→护盾→扣血→吸血→触发。
 *  - 技能/装备均为「片段(EffectSegment)」统一解析，普攻是内置技能。
 */
import {
  type CombatConfig, type CombatEvent, type CombatResult, type CombatSnapshot,
  type CombatantId, type DamageSegment, type DamageSourceKind, type DamageType,
  type DotSegment, type EffectSegment, type Equipment, type EquipmentEffect,
  type EquipmentTrigger, type EventType, type RuntimeCombatant, type HeroStats,
  type ShieldSegment, type Skill, type StatKey, type StatScaling,
  BASIC_ATTACK_SKILL_MARKER,
} from '../types';
import { clampPercent } from '../formulas/cooldown';
import { createRng, Rng } from './rng';
import { resolveCrit } from '../formulas/crit';
import { finalArmor, finalMagicResist } from '../formulas/penetration';
import { buildDummyCombatant, buildHeroCombatant, clampHp } from './stats';

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
  basicAttack: DamageSegment;
  /** 技能就绪时间（毫秒） */
  skillCds: Map<string, number>;
  /** 装备效果/被动技能内部冷却就绪时间 */
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
  defense: { damageTaken: number; physicalTaken: number; magicTaken: number; trueTaken: number; shieldAbsorbed: number; shieldGenerated: number };
  skills: Map<string, { id: string; name: string; cast: number; hits: number; dmg: number; crits: number; heal: number; shield: number }>;
  items: Map<string, { id: string; name: string; procs: number; dmg: number; heal: number; shield: number; times: number[] }>;
}

interface SegmentMeta {
  sourceKind: DamageSourceKind;
  sourceType: 'basic_attack' | 'skill' | 'item' | 'dot';
  skillId?: string;
  skillName?: string;
  itemId?: string;
  itemName?: string;
}

type PassivePollKind =
  | 'on_damage_dealt' | 'on_damage_taken' | 'on_kill'
  | 'on_basic_attack_hit' | 'on_attack' | 'on_hit';

function f(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
}
function damageTypeLabel(d: DamageType): string {
  return d === 'physical' ? '物理' : d === 'magic' ? '魔法' : '真实';
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
    // 循环按时间从小到大弹出事件；只处理 timeMs <= endMs 的事件，
    // 保证边界时刻（timeMs === endMs）的事件全部执行完再结束，
    // 避免同刻多事件（普攻+技能就绪）被截断。
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
      defense: { damageTaken: 0, physicalTaken: 0, magicTaken: 0, trueTaken: 0, shieldAbsorbed: 0, shieldGenerated: 0 },
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
      this.scheduleIntervalEquipment(unit);
    }
  }

  // ---------------------------------------------------------------- 工具
  private schedule(ms: number, run: () => void): void {
    this.heap.push({ timeMs: ms, seq: this.seq++, run });
  }

  private emit(
    eventType: EventType,
    sourceId: CombatantId,
    targetId: CombatantId,
    partial: Partial<CombatEvent> = {},
  ): void {
    // 我们在 this.emit 推送时需基于当前 this.now
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
    // 注意：不在此处处理「超时」。超时由 run() 循环在时间边界统一收尾，
    // 否则同刻（timeMs === endMs）的剩余事件会被提前截断。
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

  // ---------------------------------------------------------------- 普攻
  private autoAttack(unit: Unit, atMs: number): void {
    if (!unit.combatant.alive) return;
    const target = this.enemyOf(unit.id);
    if (!target || !target.combatant.alive) return;
    this.applySegment(atMs, unit, target, unit.hero!.basicAttack, {
      sourceKind: 'basic_attack', sourceType: 'basic_attack',
      skillId: BASIC_ATTACK_SKILL_MARKER, skillName: '普通攻击',
    });
    this.firePassives(unit, 'on_basic_attack_hit', undefined, atMs);
    this.firePassives(unit, 'on_attack', undefined, atMs);
    const next = atMs + Math.max(1, unit.combatant.stats.attackInterval * 1000);
    this.schedule(next, () => this.autoAttack(unit, next));
  }

  // ---------------------------------------------------------------- 技能
  private castReadySkill(unit: Unit, skill: Skill, atMs: number): void {
    if (!unit.hero || !skill.active) return;
    if (!unit.combatant.alive) return;
    const readyAt = unit.hero.skillCds.get(skill.id) ?? 0;
    if (atMs < readyAt) return;
    unit.hero.skillCds.set(skill.id, atMs);
    const cdMs = Math.max(1, skill.active.cooldownSeconds * 1000 * (1 - this.cdrOf(unit)));
    const target = this.enemyOf(unit.id);
    this.emit('skill_cast', unit.id, target?.id ?? unit.id, {
      skillId: skill.id, skillName: skill.name,
      description: `释放技能「${skill.name}」`,
    });
    this.skillOf(this.accum.get(unit.id)!, skill.id, skill.name).cast++;
    if (target) {
      for (const seg of skill.segments) {
        this.scheduleSegment(atMs, unit, target, seg, {
          sourceKind: 'skill', sourceType: 'skill', skillId: skill.id, skillName: skill.name,
        });
      }
    }
    this.schedule(atMs + cdMs, () => this.skillReadyEvent(unit, skill, atMs + cdMs, cdMs));
  }

  private skillReadyEvent(unit: Unit, skill: Skill, atMs: number, cdMs: number): void {
    if (!unit.hero) return;
    unit.hero.skillCds.set(skill.id, atMs);
    this.emit('cooldown_ready', unit.id, unit.id, {
      skillId: skill.id, skillName: skill.name,
      description: `技能「${skill.name}」冷却完成（${(cdMs / 1000).toFixed(1)}s）`,
    });
    if (unit.combatant.alive) this.castReadySkill(unit, skill, atMs);
  }

  // ---------------------------------------------------------------- 片段
  private scheduleSegment(
    baseMs: number, source: Unit, target: Unit, seg: EffectSegment, meta: SegmentMeta,
  ): void {
    const at = baseMs + Math.round((seg.delaySeconds || 0) * 1000);
    if (at === baseMs) {
      // 零延迟片段同步解析，避免边界时刻被 checkEnd 截断
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
        if (meta?.skillId) {
          this.skillOf(this.accum.get(source.id)!, meta.skillId, meta.skillName || '').cast += 0;
        }
        break;
      }
      case 'shield': {
        const amount = this.evalFormula(source, target, seg.basePower, seg.scaling, atMs);
        this.gainShield(atMs, source.combatant, amount, source.id);
        if (meta?.skillId) this.itemOfNope(meta);
        break;
      }
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

  // 无用占位，仅为避免未使用告警（segments heal/shield 规划字段）
  private itemOfNope(_meta: SegmentMeta): void {}

  // ---------------------------------------------------------------- 伤害流水线
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

    // 4) 穿透 + 抗性
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

    // 7) 护盾吸收
    let absorbed = 0;
    if (target.combatant.shield > 0 && afterResist > 0) {
      absorbed = Math.min(target.combatant.shield, afterResist);
      target.combatant.shield -= absorbed;
      afterResist -= absorbed;
      if (absorbed > 0) {
        this.emit('shield_absorbed', source.id, target.id, { absorbedByShield: absorbed, targetRemainingHp: target.combatant.hp, description: `护盾吸收 ${f(absorbed)} 伤害` });
        this.accum.get(target.id)!.defense.shieldAbsorbed += absorbed;
      }
    }

    // 8) 扣生命
    const hpLoss = Math.max(0, afterResist);
    target.combatant.hp = clampHp(target.combatant.hp - hpLoss);
    const priorAlive = target.combatant.alive;
    target.combatant.alive = target.combatant.hp > 0;

    this.emit(crit ? 'crit' : seg.kind === 'dot' ? 'dot_tick' : 'damage', source.id, target.id, {
      skillId: meta.skillId, skillName: meta.skillName, itemId: meta.itemId, itemName: meta.itemName,
      damageType, rawDamage: raw, crit, finalDamage: hpLoss, absorbedByShield: absorbed,
      targetRemainingHp: target.combatant.hp,
      description: `${source.combatant.label}${crit ? ' 暴击！' : ''} 造成${damageTypeLabel(damageType)}伤害 ${f(hpLoss)}（原伤害 ${f(raw)}）`,
      details: { finalResist, reductionRate: resistRate },
    });

    // 统计
    this.accDamage(source, meta, damageType, raw, hpLoss, crit, seg.kind === 'dot' ? 'dot' : meta.sourceKind);
    this.accTaken(target, damageType, hpLoss);

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

    // 11) 装备/被动触发
    if (seg.canTriggerItems && hpLoss > 0) {
      this.evaluateEquipment(source, atMs, { kind: 'on_damage_dealt', damageType });
      if (meta.sourceKind === 'basic_attack') {
        this.evaluateEquipment(source, atMs, { kind: 'on_basic_attack_hit' });
        if (crit) this.evaluateEquipment(source, atMs, { kind: 'on_basic_attack_crit' });
        this.firePassives(source, 'on_hit', undefined, atMs);
      } else if (meta.sourceKind === 'skill' || meta.sourceKind === 'dot') {
        this.evaluateEquipment(source, atMs, { kind: 'on_skill_hit', damageType });
        this.firePassives(source, 'on_hit', undefined, atMs);
      }
      this.firePassives(source, 'on_damage_dealt', { damageType }, atMs);
    }

    // 受击方触发
    if (hpLoss > 0) {
      this.evaluateEquipment(target, atMs, { kind: 'on_damage_taken' });
      this.firePassives(target, 'on_damage_taken', undefined, atMs);
      const pct = target.combatant.maxHp > 0 ? (target.combatant.hp / target.combatant.maxHp) * 100 : 0;
      this.evaluateHpBelow(target, atMs, pct);
    }

    // 12) 死亡
    if (priorAlive && !target.combatant.alive) {
      this.emit('death', source.id, target.id, { targetRemainingHp: 0, description: `${target.combatant.label} 阵亡` });
      if (!target.isDummy) {
        this.evaluateEquipment(source, atMs, { kind: 'on_kill' });
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

  private gainShield(atMs: number, target: RuntimeCombatant, amount: number, sourceId: CombatantId): void {
    if (!target.alive || amount <= 0) return;
    const value = amount * (1 + clampPercent(target.stats.shieldBonus));
    target.shield = Math.max(target.shield, value);
    const a = this.accum.get(sourceId)!;
    a.defense.shieldGenerated += value;
    this.emit('shield_gain', sourceId, target.id, {
      shield: value, targetRemainingHp: target.hp, description: `获得护盾 ${f(value)}`,
    });
  }

  // ---------------------------------------------------------------- 公式
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

  // ---------------------------------------------------------------- 装备触发
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
        if (!this.triggerMatches(effect.trigger, ctx)) continue;
        this.triggerEquip(owner, item, effect, atMs);
      }
    }
  }

  private triggerMatches(trigger: EquipmentTrigger, ctx: { kind: EquipmentTrigger['kind']; damageType?: DamageType }): boolean {
    if (trigger.kind !== ctx.kind) return false;
    if (trigger.kind === 'on_skill_hit' || trigger.kind === 'on_damage_dealt') {
      const dt = (trigger as { damageType?: DamageType }).damageType;
      if (dt) return dt === ctx.damageType;
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

  // ---------------------------------------------------------------- 被动技能
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

  // ---------------------------------------------------------------- 统计
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

  private accTaken(target: Unit, damageType: DamageType, landed: number): void {
    const acc = this.accum.get(target.id)!;
    const D = acc.defense;
    D.damageTaken += landed;
    D.physicalTaken += damageType === 'physical' ? landed : 0;
    D.magicTaken += damageType === 'magic' ? landed : 0;
    D.trueTaken += damageType === 'true' ? landed : 0;
  }

  // ---------------------------------------------------------------- 结果
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
      schemaVersion: 1,
      config: this.config,
      combatants: [...this.units.values()].map((u) => ({ ...u.combatant, stats: { ...u.combatant.stats } })),
      simVersion: '0.1.0',
    };
    return {
      schemaVersion: 1,
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