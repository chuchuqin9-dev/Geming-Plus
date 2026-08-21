/**
 * 领域模型类型定义（纯 TS，不依赖 DOM）
 *
 * 单位约定：
 *  - 所有事件时间内部统一使用「毫秒 ms」（字段命名带 ms），避免浮点累计误差
 *  - 百分比类叠加属性：critRate / vamp / damageBonus / damageReduction / shieldBonus / cooldownReduction
 *    以「0-100」存储（如 25 表示 25%）
 *  - 穿透里的百分比特（percentArmorPen / percentMagicPen）以「0-1」小数存储（满足多头规则）
 *  - 公式倍率（ratio）统一以「0-1」小数存储
 *  - 攻击间隔 / 冷却时长以「秒」存储（引擎内转毫秒）
 */

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// 基础枚举
// ---------------------------------------------------------------------------

/** 伤害类型 */
export type DamageType = 'physical' | 'magic' | 'true';

/** 英雄类型 */
export type HeroType = 'melee' | 'ranged';

/** 暴击类型归属 */
export type CritFamily = 'physical' | 'magic';

/** 模拟模式 */
export type SimMode = 'dummy' | 'vs';

/** 随机模式：seeded=按种子抽样复现；expectation=按数学期望不抽样 */
export type RandomMode = 'seeded' | 'expectation';

/** 一段效果的类型：伤害 / 持续伤害(Dot) / 治疗 / 护盾 */
export type EffectSegmentKind = 'damage' | 'dot' | 'heal' | 'shield';

/** 伤害来源（用于伤害构成拆分） */
export type DamageSourceKind = 'basic_attack' | 'skill' | 'item' | 'dot';

// ---------------------------------------------------------------------------
// 属性系统
// ---------------------------------------------------------------------------

/**
 * 英雄/装备属性。装备的 stats 为 Partial，可叠加。
 * 全部字段均有安全默认值，避免空值报错。
 */
export interface HeroStats {
  /** 最大生命值 */
  maxHp: number;
  /** 当前生命值（仅英雄模板记录初始值，战斗中的实时生命值由引擎维护） */
  currentHp: number;
  /** 攻击力 */
  attack: number;
  /** 法强 */
  ap: number;
  /** 护甲 */
  armor: number;
  /** 魔抗 */
  magicResist: number;
  /** 移动速度（保留，暂不参与结算） */
  moveSpeed: number;
  /** 攻击间隔（秒，>0） */
  attackInterval: number;
  /** 攻击距离（保留，为后续移动/射程埋点） */
  attackRange: number;

  /** 物理暴击率（0-100） */
  physicalCritRate: number;
  /** 物理暴击伤害（0-100+，如 175 表示暴击造成 1.75 倍） */
  physicalCritDamage: number;
  /** 魔法暴击率（0-100） */
  magicCritRate: number;
  /** 魔法暴击伤害 */
  magicCritDamage: number;

  /** 固定护甲穿透 */
  flatArmorPen: number;
  /** 百分比护甲穿透（0-1 小数） */
  percentArmorPen: number;
  /** 固定法术穿透 */
  flatMagicPen: number;
  /** 百分比法术穿透（0-1 小数） */
  percentMagicPen: number;

  /** 物理吸血（0-100） */
  physicalVamp: number;
  /** 法术吸血（0-100） */
  magicVamp: number;
  /** 全能吸血（0-100） */
  allVamp: number;
  /** 击中生命恢复（0-100） */
  onHitHp: number;

  /** 物理技能伤害提升（0-100） */
  physicalSkillDamage: number;
  /** 普通攻击伤害提升（0-100） */
  attackDamage: number;
  /** 法术伤害提升（0-100） */
  magicDamage: number;

  /** 伤害减免（0-100，独立于抗性） */
  damageReduction: number;
  /** 护盾加成（0-100，生成的护盾量放大） */
  shieldBonus: number;

  /** 冷却缩减（0-100） */
  cooldownReduction: number;
}

/** 属性键（用于公式倍率引用自身/目标属性） */
export type StatKey =
  | 'maxHp' | 'currentHp' | 'lostHp'
  | 'attack' | 'ap' | 'armor' | 'magicResist' | 'moveSpeed'
  | 'targetMaxHp' | 'targetCurrentHp' | 'targetLostHp'
  | 'targetAttack' | 'targetAp';

/** 公式中的一项：伤害 += 属性值 × ratio */
export interface StatScaling {
  stat: StatKey;
  /** 倍率（0-1 小数）。percent 参数如「25%」也归一化为 0.25 存储 */
  ratio: number;
}

// ---------------------------------------------------------------------------
// 效果片段（伤害 / 持续伤害 / 治疗 / 护盾）
// ---------------------------------------------------------------------------

/** 单段即时伤害 */
export interface DamageSegment {
  kind: 'damage';
  /** 相对技能释放/触发的延迟（秒），用于多段技能 0.00/0.40/0.80 的独立时间轴 */
  delaySeconds: number;
  /** 基础伤害（公式中的固定值，如公式的 [70]） */
  baseDamage: number;
  /** 属性倍率（如 25% × 敌方法强） */
  scaling: StatScaling[];
  damageType: DamageType;
  /** 该伤害是否可暴击（独立于角色暴击率，由伤害实例自身决定） */
  canCrit: boolean;
  /** 可暴击时的归属类型（物理/魔法），决定用哪套暴击率与暴击伤害 */
  critFamily: CritFamily;
  /** 自定义暴击率（0-100，覆盖角色暴击率，可选） */
  critChanceOverride?: number;
  /** 是否触发吸血 */
  canLifesteal: boolean;
  /** 是否触发装备 on_hit / 造成伤害类触发 */
  canTriggerItems: boolean;
  /** 伤害来源类别（参与构成统计） */
  sourceKind: DamageSourceKind;
  /** 参与普攻增伤？ */
  isBasicAttackBoost?: boolean;
  /** 参与技能增伤？ */
  isSkillBoost?: boolean;
  /** 参与法术增伤？（伤害类型为 magic 时） */
  useMagicDamageBoost?: boolean;
  /** 允许全能吸血 */
  useAllVamp?: boolean;
}

/** 持续伤害（按固定间隔生成多个独立伤害事件） */
export interface DotSegment {
  kind: 'dot';
  /** 相对释放/触发的延迟（秒），首跳时间 */
  delaySeconds: number;
  /** 持续总时长（秒） */
  totalSeconds: number;
  /** 每次跳的间隔（秒） */
  tickSeconds: number;
  /** 每次跳的基础伤害 */
  baseDamagePerTick: number;
  scaling: StatScaling[];
  damageType: DamageType;
  canCrit: boolean;
  critFamily: CritFamily;
  critChanceOverride?: number;
  canTriggerItems: boolean;
  useAllVamp?: boolean;
}

/** 治疗效果 */
export interface HealSegment {
  kind: 'heal';
  /** 延迟（秒） */
  delaySeconds: number;
  /** 基础治疗量 */
  basePower: number;
  scaling: StatScaling[];
}

/** 护盾效果 */
export interface ShieldSegment {
  kind: 'shield';
  /** 延迟（秒） */
  delaySeconds: number;
  /** 基础护盾量（受护盾加成放大） */
  basePower: number;
  scaling: StatScaling[];
  /** 持续时长（秒）；0 表示永久直到被消耗 */
  durationSeconds: number;
}

/** 效果片段的联合类型 */
export type EffectSegment = DamageSegment | DotSegment | HealSegment | ShieldSegment;

// ---------------------------------------------------------------------------
// 技能系统
// ---------------------------------------------------------------------------

/** 主动技能需配置冷却与释放优先级；被动技能需配置触发条件 */
export type SkillType = 'active' | 'passive';

/** 被动触发条件 */
export type PassiveTrigger =
  | { kind: 'on_basic_attack_hit' }
  | { kind: 'on_attack' }
  | { kind: 'on_hit' }
  | { kind: 'on_damage_dealt'; damageType?: DamageType }
  | { kind: 'on_damage_taken' }
  | { kind: 'on_combat_start' }
  | { kind: 'on_interval'; everySeconds: number }
  | { kind: 'on_kill' };

export interface Skill {
  id: string;
  name: string;
  type: SkillType;
  /** 主动技能参数 */
  active?: {
    /** 基础冷却（秒） */
    cooldownSeconds: number;
    /** 释放优先级（数字越小越优先释放；仅 vs 自动对战使用） */
    priority: number;
    /** 消耗（保留字段，暂不纳入资源结算） */
    manaCost: number;
  };
  /** 被动技能参数 */
  passive?: {
    trigger: PassiveTrigger;
    /** 内部冷却（秒），0 表示无冷却，每次触发都生效 */
    procCooldownSeconds: number;
  };
  /** 技能包含的多段/多效果片段（按时间轴独立事件处理） */
  segments: EffectSegment[];
}

/** 普攻在引擎内部视为一个特殊技能（由引擎基于 attackInterval 自动调度） */
export const BASIC_ATTACK_SKILL_MARKER = '__basic_attack__';

// ---------------------------------------------------------------------------
// 装备系统
// ---------------------------------------------------------------------------

/** 装备触发条件 */
export type EquipmentTrigger =
  | { kind: 'on_basic_attack_hit' }
  | { kind: 'on_basic_attack_crit' }
  | { kind: 'on_skill_hit'; damageType?: DamageType }
  | { kind: 'on_damage_dealt'; damageType?: DamageType }
  | { kind: 'on_damage_taken' }
  | { kind: 'on_hp_below'; hpBelowPercent: number }
  | { kind: 'on_combat_start' }
  | { kind: 'on_interval'; everySeconds: number }
  | { kind: 'on_kill' };

/** 触发限制：内部冷却 */
export interface ProcLimit {
  type: 'cooldown';
  seconds: number;
  /** 同源同类型的限制是否共享冷却（保留） */
  shared?: boolean;
}

/** 一个装备效果 = 触发条件 + 限制 + 一段或多段效果 */
export interface EquipmentEffect {
  id: string;
  name: string;
  trigger: EquipmentTrigger;
  /** 无限制可省略；0 秒表示无限冷却（只能触发一次）也可用 */
  limit?: ProcLimit;
  segments: EffectSegment[];
}

export interface Equipment {
  id: string;
  name: string;
  favorite: boolean;
  tags: string[];
  /** 属性加成（可任意加多条） */
  stats: Partial<HeroStats>;
  /** 被动/触发效果 */
  effects: EquipmentEffect[];
}

/** 最大装备携带数 */
export const MAX_EQUIPMENT = 9;

// ---------------------------------------------------------------------------
// 英雄系统
// ---------------------------------------------------------------------------

export interface Hero {
  id: string;
  name: string;
  type: HeroType;
  /** 基础属性（健康默认值，由 defaults 提供） */
  baseStats: HeroStats;
  /** 技能列表（数量不限）。普攻由引擎内置，不在此定义 */
  skills: Skill[];
  /** 默认装备方案（装备 id 列表，最多 MAX_EQUIPMENT） */
  defaultItems: string[];
}

// ---------------------------------------------------------------------------
// 木桩
// ---------------------------------------------------------------------------

export interface DummyConfig {
  /** 是否无限生命（避免木桩提前死亡中断测试） */
  infiniteHp: boolean;
  maxHp: number;
  armor: number;
  magicResist: number;
  /** 木桩伤害减免（0-100） */
  damageReduction: number;
}

// ---------------------------------------------------------------------------
// 战斗配置
// ---------------------------------------------------------------------------

export interface CombatantConfig {
  label: string;
  hero: Hero;
  itemIds: string[]; // <= MAX_EQUIPMENT
}

export interface CombatConfig {
  schemaVersion: number;
  mode: SimMode;
  /** 模拟时长（秒）；vs 模式下为最长时长，任一方死亡即提前结束 */
  durationSeconds: number;
  randomMode: RandomMode;
  /** 随机模式下的种子；expectation 模式下忽略 */
  seed?: number;
  /** 真实伤害是否受「伤害减免」影响 */
  trueDamageIgnoresReduction: boolean;
  combos: CombatantConfig[];
  /** 模式为 dummy 时生效 */
  dummy: DummyConfig;
  /** 自动化战斗策略：CombatantId → 技能优先级排序 */
  skillPriority: Record<string, string[]>;
}

/** 战斗快照（模拟开始时冻结的用户配置，保证结果不随模板改动而漂移） */
export interface CombatSnapshot {
  schemaVersion: number;
  config: CombatConfig;
  /** 参与战斗的每个实体的最终属性（含装备叠加） */
  combatants: RuntimeCombatant[];
  simVersion: string;
}

// ---------------------------------------------------------------------------
// 运行时战斗实体
// ---------------------------------------------------------------------------

export type CombatantId = 'A' | 'B' | 'dummy';

/** 引擎内的战斗实体：属性已合并装备、生命值为运行时状态 */
export interface RuntimeCombatant {
  id: CombatantId;
  label: string;
  isDummy: boolean;
  isHero: boolean;
  /** 合并后的最终面板属性 */
  stats: HeroStats;
  maxHp: number;
  hp: number;
  alive: boolean;
  /** 盾条（护盾对下一次伤害先吸收） */
  shield: number;
  shieldSourceId?: string;
  /** 累积承伤统计（引擎内即时累计，用于曲线） */
  _uiDamageTaken?: number;
}

// ---------------------------------------------------------------------------
// 战斗事件（时间轴最小单元）
// ---------------------------------------------------------------------------

export type EventType =
  | 'combat_start'
  | 'basic_attack'
  | 'skill_cast'
  | 'item_proc'
  | 'dot_tick'
  | 'damage'
  | 'crit'
  | 'heal'
  | 'shield_gain'
  | 'shield_absorbed'
  | 'death'
  | 'cooldown_ready'
  | 'combat_end';

export interface CombatEvent {
  eventId: number;
  /** 毫秒时间戳 */
  timestampMs: number;
  sourceId: CombatantId;
  targetId: CombatantId;
  eventType: EventType;
  skillId?: string;
  skillName?: string;
  itemId?: string;
  itemName?: string;
  /* --- 伤害相关 --- */
  damageType?: DamageType;
  /** 抗性减免前的伤害（已含增伤与暴击） */
  rawDamage: number;
  crit: boolean;
  /** 实际扣除生命（含抗性/减伤/护盾后，但不含吸血） */
  finalDamage: number;
  /** 护盾吸收量 */
  absorbedByShield: number;
  /* --- 生命类 --- */
  healing: number;
  overheal: number;
  shield: number;
  /* --- 详细模式用于复算的中间量 --- */
  details?: {
    /** 计算原伤害时引用的倍率明细 */
    scalingBreakdown?: Array<{ stat: StatKey; value: number; product: number }>;
    /** 抗性穿透后的最终抗性值（受伤害方视角） */
    finalResist?: number;
    /** 减伤率 */
    reductionRate?: number;
  };
  /** 目标剩余生命 */
  targetRemainingHp: number;
  description: string;
}

// ---------------------------------------------------------------------------
// 统计结果
// ---------------------------------------------------------------------------

export interface DmgStat {
  total: number;
  physical: number;
  magic: number;
  trueDmg: number;
  basicAttack: number;
  skill: number;
  item: number;
  dot: number;
  critDamage: number;
  critCount: number;
  hitCount: number;
}

export interface LifestealStat {
  totalHealing: number;
  overheal: number;
  physicalVamp: number;
  magicVamp: number;
  allVamp: number;
  onHitHp: number;
}

export interface DefenseStat {
  damageTaken: number;
  physicalTaken: number;
  magicTaken: number;
  trueTaken: number;
  shieldAbsorbed: number;
  shieldGenerated: number;
}

export interface PerSkillStat {
  skillId: string;
  name: string;
  castCount: number;
  hitCount: number;
  damage: number;
  critCount: number;
  heal: number;
  shield: number;
  avgDamage: number;
}

export interface PerItemStat {
  itemId: string;
  name: string;
  procCount: number;
  damage: number;
  heal: number;
  shield: number;
  /** 触发时间序列（毫秒） */
  procTimesMs: number[];
}

export interface CombatantResult {
  id: CombatantId;
  label: string;
  isDummy: boolean;
  isHero: boolean;
  /** 存活时长（毫秒） */
  survivedMs: number;
  finalHp: number;
  maxHp: number;
  alive: boolean;
  damage: DmgStat;
  lifesteal: LifestealStat;
  defense: DefenseStat;
  skills: PerSkillStat[];
  items: PerItemStat[];
}

export interface CurvePointMs {
  tMs: number;
  cumulativeDamage: number;
  /** 该点时的瞬时/区间伤害（用于基于窗口的 DPS 计算） */
  sourceId: CombatantId;
}

export interface CombatResult {
  schemaVersion: number;
  /** 模拟配置 */
  config: CombatConfig;
  /** 战斗快照（用于已保存结果与模板解耦） */
  snapshot: CombatSnapshot;
  /** 事件列表（时间戳升序） */
  events: CombatEvent[];
  /** 战斗实际时长（毫秒） */
  durationMs: number;
  endReason: 'timeout' | 'victory' | 'all_dead';
  results: CombatantResult[];
  /** 每 250ms 采样一次的全场累计伤害曲线（用于 DPS 曲线绘制） */
  damageCurve: CurvePointMs[];
  /** 每 250ms 采样一次的生命值曲线 */
  hpCurve: Array<{ tMs: number; A: number; B: number }>;
  /** 战斗开始时间（用于历史/回放） */
  createdAt?: string;
}

/** 已保存的模拟结果（含快照，可独立于模板回放与对比） */
export interface SavedSimulation {
  id: string;
  name: string;
  createdAt: string;
  result: CombatResult;
  tags: string[];
  favorite: boolean;
}

/** 供方案对比使用的轻量名目 */
export interface CompareMetric {
  key: string;
  label: string;
  unit: 'damage' | 'sustain' | 'seconds' | 'percent' | 'count' | 'healing';
}

// ---------------------------------------------------------------------------
// 模板包装（可持久化 / 导入导出的统一结构）
// ---------------------------------------------------------------------------

export interface HeroTemplate {
  kind: 'hero';
  schemaVersion: number;
  data: Hero;
}

export interface EquipmentTemplate {
  kind: 'equipment';
  schemaVersion: number;
  data: Equipment;
}

export interface SkillTemplate {
  kind: 'skill';
  schemaVersion: number;
  data: Skill;
}

export interface BattlePreset {
  id: string;
  name: string;
  createdAt: string;
  config: CombatConfig;
  tags: string[];
  favorite: boolean;
}

/** 战斗方案模板（含双方配置、模式、时间、木桩属性） */
export interface BattlePresetTemplate {
  kind: 'battle';
  schemaVersion: number;
  data: BattlePreset;
}

export type AnyTemplate =
  | HeroTemplate
  | EquipmentTemplate
  | SkillTemplate
  | BattlePresetTemplate;

/** 备份文件整体结构 */
export interface BackupFile {
  kind: 'moba-simulator-backup';
  schemaVersion: number;
  exportedAt: string;
  heroes: Hero[];
  equipment: Equipment[];
  skills: Skill[];
  battlePresets: BattlePreset[];
  savedSimulations: SavedSimulation[];
}

/** 功能默认值：新增空模板时使用 */
export function emptyStats(): HeroStats {
  return {
    maxHp: 1000,
    currentHp: 1000,
    attack: 100,
    ap: 0,
    armor: 30,
    magicResist: 30,
    moveSpeed: 350,
    attackInterval: 1.0,
    attackRange: 1,

    physicalCritRate: 0,
    physicalCritDamage: 175,
    magicCritRate: 0,
    magicCritDamage: 150,

    flatArmorPen: 0,
    percentArmorPen: 0,
    flatMagicPen: 0,
    percentMagicPen: 0,

    physicalVamp: 0,
    magicVamp: 0,
    allVamp: 0,
    onHitHp: 0,

    physicalSkillDamage: 0,
    attackDamage: 0,
    magicDamage: 0,

    damageReduction: 0,
    shieldBonus: 0,

    cooldownReduction: 0,
  };
}