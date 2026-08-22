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

export const SCHEMA_VERSION = 3;

// ---------------------------------------------------------------------------
// 基础枚举
// ---------------------------------------------------------------------------

/**
 * 伤害类型（见设计文档第 95 项）。
 *
 * 类型分类：
 *  - raw      原始伤害 Raw Damage：未经过护甲/魔抗/穿透/减伤等防御计算之前的基础伤害数值。
 *             用于技能基础伤害、装备基础伤害、计算公式展示与战斗日志记录。
 *             伤害计算流程：原始伤害 → 根据伤害类型转换：
 *               物理 → 计算护甲、穿透；魔法 → 计算魔抗、法穿；真实 → 无视抗性 → 最终伤害。
 *  - physical 物理伤害：进入护甲/物穿结算
 *  - magic    魔法伤害：进入魔抗/法穿结算
 *  - true     真实伤害：无视抗性与减伤
 */
export type DamageType = 'raw' | 'physical' | 'magic' | 'true';

/** 英雄类型 */
export type HeroType = 'melee' | 'ranged';

/** 暴击类型归属 */
export type CritFamily = 'physical' | 'magic';

/** 模拟模式 */
export type SimMode = 'dummy' | 'vs';

/** 随机模式：seeded=按种子抽样复现；expectation=按数学期望不抽样 */
export type RandomMode = 'seeded' | 'expectation';

/** 一段效果的类型：伤害 / 持续伤害(Dot) / 治疗 / 护盾 / 冷却减少 */
export type EffectSegmentKind = 'damage' | 'dot' | 'heal' | 'shield' | 'cooldown_reduce' | 'buff' | 'on_hit_damage';

/** 伤害来源（用于伤害构成拆分） */
export type DamageSourceKind = 'basic_attack' | 'skill' | 'item' | 'dot';

/**
 * 附加伤害标签（见 #157）：一个伤害实例可拥有多个标签。
 * basic_attack 普通攻击伤害 / on_hit On-hit 伤害 / skill 技能伤害 / item 装备伤害 / talent 天赋伤害
 */
export type DamageTag = 'basic_attack' | 'on_hit' | 'skill' | 'item' | 'talent';

/**
 * 状态标签系统（见 #171-173）：战斗引擎自动维护，标签可作为 Condition 条件。
 */
export type StateTag =
  | 'HAS_SHIELD'            // 是否存在护盾
  | 'HAS_PHYSICAL_SHIELD'   // 是否存在物理护盾
  | 'HAS_MAGIC_SHIELD'      // 是否存在魔法护盾
  | 'HAS_ALL_SHIELD'        // 是否存在全类型护盾
  | 'LAST_ATTACK_CRITICAL'  // 上一次普攻是否暴击
  | 'HAS_CRIT_THIS_COMBAT'  // 本场是否曾暴击
  | 'LAST_SKILL_HIT'        // 上一次技能是否命中
  | 'HAS_SKILL_HIT_THIS_COMBAT' // 本场是否曾技能命中
  | 'IS_CONSECUTIVE_ATTACKING'  // 是否处于连续攻击状态
  | 'HAS_ATTACKED';         // 本场是否曾普攻

/**
 * Buff / Debuff 类型（见 #162-170）。百分比 value 统一以 0-100 存储。
 */
export type BuffType =
  | 'attack_speed'     // 攻击速度 +X%（叠层/时长/刷新）
  | 'slow'             // 移动速度 -X%
  | 'grievous'         // 禁疗：治疗效果降低 X%（100 治疗 * (1-40%)）
  | 'damage_bonus'     // 增伤：自身造成的伤害 +X%（可分类，见 BuffCategory）
  | 'vulnerable'       // 易伤：自身受到的伤害 +X%
  | 'control_immune'   // 控制免疫（见 #170）
  | 'attack_cap_break' // 攻速上限突破（见 #133）
  | 'lifesteal_boost'  // 吸血提升（保留）;

/** 增伤/易伤的伤害分类（见 #169）：all=全部伤害 */
export type BuffCategory = 'all' | 'physical' | 'magic' | 'true' | 'basic_attack' | 'skill';

/** Buff 层数刷新方式（见 #136）：overall=整体刷新；independent=独立计时 */
export type BuffRefreshMode = 'overall' | 'independent';

/** Buff 结束原因（见 #163），用于区分不同结束方式触发不同效果 */
export type BuffEndReason = 'expired' | 'removed' | 'dispelled' | 'consumed' | 'overwritten';

/**
 * 统一触发-效果-参数（Trigger + Effect + Parameter）机制的事件类型。
 * 所有技能被动 / 装备效果 / 天赋触发统一走该枚举，禁止针对单一对象写死逻辑。
 */
export type TriggerEvent =
  /** 释放技能（主动释放 / 被动触发） */
  | 'cast_skill'
  /** 技能命中 */
  | 'skill_hit'
  /** 普通攻击命中 */
  | 'basic_attack_hit'
  /** 普通攻击暴击 */
  | 'basic_attack_crit'
  /** 造成伤害 */
  | 'damage_dealt'
  /** 击杀目标 */
  | 'kill'
  /** 受到伤害 */
  | 'damage_taken'
  /** 生命值低于条件 */
  | 'hp_below'
  /** 战斗开始 */
  | 'combat_start'
  /** 固定间隔 */
  | 'interval'
  /** 护盾生成 */
  | 'shield_created'
  /** 护盾受到伤害 */
  | 'shield_damaged'
  /** 护盾被击破 */
  | 'shield_broken'
  /** 护盾时间结束消失 */
  | 'shield_expired'
  /** 伤害已产生但尚未扣除护盾/生命（BEFORE_DAMAGE，允许生成新防御效果） */
  | 'before_damage'
  /** 致命伤害前（预计使 HP<=0，预留） */
  | 'before_lethal_damage';

/** 触发条件（Key 值，默认无附加条件） */
export type TriggerConditionKind =
  | { type: 'none' }
  | { type: 'damageType'; damageType: DamageType }
  | { type: 'hpBelow'; hpBelowPercent: number }
  | { type: 'every'; everySeconds: number }
  /* --- 状态标签条件（State Tag 作 Condition，见 #171-173） --- */
  | { type: 'state'; state: StateTag; present: boolean }
  /* --- 生命值条件比较（见 #150-151）：op 为 >,>=,<,<=,between --- */
  | { type: 'hpCompare'; stat: 'targetMaxHp' | 'targetCurrentHp' | 'targetHpPercent' | 'targetLostHpPercent' | 'selfMaxHp' | 'selfCurrentHp'; op: '>' | '>=' | '<' | '<=' | 'between'; value: number; value2?: number }
  /* --- 条件组合 AND / OR / NOT（见 #174） --- */
  | { type: 'and'; conditions: TriggerConditionKind[] }
  | { type: 'or'; conditions: TriggerConditionKind[] }
  | { type: 'not'; condition: TriggerConditionKind }
  /* --- Buff 层数条件，如 BUFF层数>=3 --- */
  | { type: 'buffStack'; buffType: BuffType; op: '>' | '>=' | '<' | '<='; value: number };

/** 触发抽象模型：事件 + 条件 */
export interface Trigger {
  event: TriggerEvent;
  condition?: TriggerConditionKind;
}

// ---------------------------------------------------------------------------
// 统一效果（Effect）抽象模型
//
// 每个「效果」= id + 类型 + 参数。所有技能 / 装备 / 天赋的被执行效果统一表示为
// Effect（底层由 EffectSegment 承载），由 Effect Engine 统一解析执行。
// ---------------------------------------------------------------------------

/** 效果类型（与 EffectSegment.kind 对齐） */
export type EffectType = 'damage' | 'dot' | 'heal' | 'shield' | 'cooldown_reduce';

/** 通用效果模型（数据层描述；可执行解析见 EffectSegment / ShieldInstance） */
export interface Effect {
  id: string;
  type: EffectType;
  params: Record<string, unknown>;
}

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
  /** 额外攻击力（运行时 = 最终攻击 - 基础攻击；供「额外攻击力」倍率引用） */
  extraAttack: number;
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
  /** 基础攻速值（攻速 RATING，见 #131；用于通过 AttackSpeedCapResolver 求得最低攻击间隔） */
  baseAttackSpeed: number;
  /** 攻速加成（0-100，见 #134；临时攻速由 Modifier/Buff 提供，不直接改模板） */
  attackSpeedBonus: number;
  /** 攻速上限突破（0-100，见 #133；降低最低攻击间隔，独立于攻速加成） */
  attackCapBreakthrough: number;

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
  | 'attack' | 'extraAttack' | 'ap' | 'armor' | 'magicResist' | 'moveSpeed'
  | 'targetMaxHp' | 'targetCurrentHp' | 'targetLostHp'
  | 'targetAttack' | 'targetAp'
  /** 原始伤害（Raw Damage）：当前效果段的基础伤害/基础数值，随原始伤害成长 */
  | 'rawDamage'
  /** 原始伤害 → 普通攻击：引用来源英雄最近一次普通攻击产生的原始伤害（#原始伤害来源） */
  | 'rawBasicAttackDamage'
  /** 原始伤害 → 技能伤害：引用来源英雄最近一次技能造成的原始伤害（#原始伤害来源） */
  | 'rawSkillDamage';

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
  /** 额外触发的吸血开关（见 #158） */
  canMagicLifesteal?: boolean;
  /** 是否触发天赋/被动等后续效果（见 #158） */
  canTriggerPassives?: boolean;
  canTriggerTalents?: boolean;
  /** 附加伤害标签（见 #157）：一个伤害实例可有多个标签 */
  tags?: DamageTag[];
  /** 是否为「独立结算」的附加 On-hit 伤害实例（见 #154） */
  isIndependentInstance?: boolean;
  /** maxTriggerCount：该效果最多触发次数（见 #140），用完自动失效 */
  maxTriggers?: number;
  /* --- 投射物 / 距离伤害（见 #146-148） --- */
  /** 投射物实际飞行距离（ProjectileTravelDistance，默认取该值作为距离参数） */
  travelDistance?: number;
  /** 距离伤害配置（距离越远伤害越高，封顶） */
  distanceScaling?: DamageDistanceScaling;
  /* --- 生命值相关增伤（见 #149-151） --- */
  /** 目标满足指定生命值条件时增伤，可阶梯式递增、封顶 */
  hpBonus?: DamageHpBonus;
  /* --- 属性快照（见 #152） --- */
  /** snapshot=使用效果生成时属性；dynamic=命中/触发时实时属性（默认 dynamic） */
  snapshot?: 'dynamic' | 'snapshot';
}

/** 距离伤害配置（见 #147）：在基础伤害之外随飞行距离累加 */  
export interface DamageDistanceScaling {
  /** 最小距离：低于该距离无距离加成 */
  minDistance: number;
  /** 最大距离：超过后不再增加（封顶） */
  maxDistance: number;
  /** 每 X 距离增加固定 Y */
  perDistancePerUnit?: number;
  /** 每 X 距离增加 Y%（0-1 小数，作用于基础伤害） */
  perDistancePercent?: number;
  /** 最大额外伤害（绝对封顶） */
  maxBonusDamage?: number;
  /** 最大伤害倍率（相对基础伤害的封顶，如 2 = 最多 200%） */
  maxMultiplier?: number;
}

/** 生命值阶梯增伤（见 #149-151） */
export interface DamageHpBonus {
  stat: 'targetMaxHp' | 'targetCurrentHp' | 'targetHpPercent' | 'targetLostHp' | 'targetLostHpPercent' | 'selfMaxHp' | 'selfCurrentHp';
  /** 比较目标值；op=between 时 value 为下界、value2 为上界 */
  op: '>' | '>=' | '<' | '<=' | 'between';
  /** 触发下限 */
  value: number;
  value2?: number;
  /** 基础增伤百分比（0-100，超过条件即获得） */
  bonusPercent: number;
  /** 每多 Y 单位额外增加 Z%（0-100） */
  perUnit?: number;
  /** 每 perUnit 额外增加的百分比（0-100） */
  perBonusPercent?: number;
  /** 最高增伤百分比（0-100，封顶） */
  maxBonusPercent: number;
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
  /** 属性快照（见 #152）：snapshot=用效果生成时属性；dynamic=跳伤时实时属性（默认） */
  snapshot?: 'dynamic' | 'snapshot';
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

/** 护盾类型：物理 / 魔法 / 全类型 */
export type ShieldType = 'physical' | 'magic' | 'all';

/** 护盾刷新规则：覆盖 / 叠加 / 取最大值 / 延长时间 */
export type ShieldRefreshRule = 'overwrite' | 'stack' | 'max' | 'extend';

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
  /** 护盾类型（决定可吸收哪些伤害） */
  shieldType: ShieldType;
  /** 再次获得同来源护盾时的刷新规则 */
  refresh: ShieldRefreshRule;
  /** 护盾优先级（越大越优先被消耗；默认同优先级按先进先出） */
  priority: number;
}

// ---------------------------------------------------------------------------
// 冷却减少效果
// ---------------------------------------------------------------------------

/** 冷却减少的目标范围 */
export type CooldownTarget = 'SELF_SKILL' | 'OTHER_SKILLS' | 'ALL_SKILLS';

/** 冷却减少效果：减少目标技能范围 N 秒冷却 */
export interface CooldownReduceSegment {
  kind: 'cooldown_reduce';
  /** 延迟（秒） */
  delaySeconds: number;
  /** 目标技能范围 */
  target: CooldownTarget;
  /** 减少的冷却秒数 */
  seconds: number;
  /** 是否允许超过当前剩余冷却（false＝剩余 2s 减 5s 结果=0；true＝可减到负数为 0） */
  allowOvershoot: boolean;
  /** 可选：限定命中技能 id（为空则按 target 作用全部） */
  skillIds?: string[];
}

/** Buff/Debuff 效果：给来源或目标施加一个可叠层、有时长、可刷新的模组（见 #134/#162-170） */
export interface BuffSegment {
  kind: 'buff';
  /** 延迟（秒） */
  delaySeconds: number;
  /** 施加对象：self=来源自身；enemy=目标敌方 */
  target: 'self' | 'enemy';
  buffType: BuffType;
  /** 每层数值（百分比 0-100）。如 attack_speed=20 表示攻速 +20% */
  value: number;
  /** 增伤/易伤的伤害分类（见 #169）；非增伤/易伤类型可省略 */
  category?: BuffCategory;
  /** 控制免疫的具体控制类型（见 #170，control_immune 时可用） */
  controlTypes?: string[];
  /** 持续时间（秒）；0=永久直到被移除/消耗 */
  durationSeconds: number;
  /** 最大层数（1=不叠层） */
  maxStacks: number;
  /** 层数刷新方式（见 #136） */
  refreshMode: BuffRefreshMode;
  /** 独立计时时每层独立时长（整体刷新使用 durationSeconds） */
  stackDurationSeconds?: number;
  /** 是否可被消耗（作为 maxTriggerCount 次数用尽时自动失效，见 #140） */
  expiresOnUse?: boolean;
  /** 可用次数（maxTriggerCount，见 #140） */
  maxUses?: number;
  /** 施加期间/结束时的效果列表（如护盾附带的被动效果） */
  passiveEffects?: EffectSegment[];
}

/** 附加伤害片段（On-hit 额外伤害，独立 Damage Instance，见 #153-158） */
export interface OnHitDamageSegment {
  kind: 'on_hit_damage';
  delaySeconds: number;
  baseDamage: number;
  scaling: StatScaling[];
  damageType: DamageType;
  /** 是否允许暴击（独立配置，见 #156） */
  canCrit: boolean;
  /** 使用物理暴击或魔法暴击（见 #156） */
  critFamily: CritFamily;
  /** 独立暴击倍率（覆盖角色暴击伤害，可选，见 #156） */
  critChanceOverride?: number;
  critDamageOverride?: number;
  /** 吸血开关（见 #158） */
  canPhysicalLifesteal: boolean;
  canMagicLifesteal: boolean;
  canAllVamp: boolean;
  /** 是否继续触发装备/天赋/被动/其他 On-hit（见 #158） */
  canTriggerEquip: boolean;
  canTriggerTalent: boolean;
  canTriggerPassive: boolean;
  canTriggerOnHit: boolean;
  /** 附加伤害标签（见 #157） */
  tags: DamageTag[];
}

/** 效果片段的联合类型 */
export type EffectSegment = DamageSegment | DotSegment | HealSegment | ShieldSegment | CooldownReduceSegment | BuffSegment | OnHitDamageSegment;

// ---------------------------------------------------------------------------
// 技能系统
// ---------------------------------------------------------------------------

/** 主动技能需配置冷却与释放优先级；被动技能需配置触发条件 */
export type SkillType = 'active' | 'passive';

/** 被动触发条件 */
export type PassiveTrigger =
  | { kind: 'on_basic_attack_hit' }
  | { kind: 'on_basic_attack_crit' }
  | { kind: 'on_attack' }
  | { kind: 'on_hit' }
  | { kind: 'on_cast_skill' }
  | { kind: 'on_skill_hit'; damageType?: DamageType }
  | { kind: 'on_damage_dealt'; damageType?: DamageType }
  | { kind: 'on_damage_taken' }
  | { kind: 'on_hp_below'; hpBelowPercent: number }
  | { kind: 'on_combat_start' }
  | { kind: 'on_interval'; everySeconds: number }
  | { kind: 'on_kill' }
  | { kind: 'on_shield_created' }
  | { kind: 'on_shield_damaged' }
  | { kind: 'on_shield_broken' }
  | { kind: 'on_shield_expired' };

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
  | { kind: 'on_cast_skill' }
  | { kind: 'on_skill_hit'; damageType?: DamageType }
  | { kind: 'on_damage_dealt'; damageType?: DamageType }
  | { kind: 'on_damage_taken' }
  | { kind: 'on_hp_below'; hpBelowPercent: number }
  | { kind: 'on_combat_start' }
  | { kind: 'on_interval'; everySeconds: number }
  | { kind: 'on_kill' }
  | { kind: 'on_shield_created' }
  | { kind: 'on_shield_damaged' }
  | { kind: 'on_shield_broken' }
  | { kind: 'on_shield_expired' };

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
  /**
   * 技能列表（数量不限）：保存「技能库」中技能的 id（引用，不复制技能定义）。
   * 普攻由引擎内置，不在此定义。实际技能由技能库经 skillId 关联解析。
   */
  skills: string[];
  /** 默认装备方案（装备 id 列表，最多 MAX_EQUIPMENT） */
  defaultItems: string[];
  /** 绑定天赋（英雄专属天赋模板 id 列表） */
  talents: string[];
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
// 天赋系统
// ---------------------------------------------------------------------------

/** 天赋类型 */
export type TalentType = 'attribute' | 'passive' | 'triggered' | 'conditional';

/** 天赋：Trigger + Effect + Parameter 的封装，可复用装备/技能效果系统 */
export interface Talent {
  id: string;
  name: string;
  description: string;
  icon?: string;
  type: TalentType;
  /** 绑定英雄：null 表示通用天赋（所有英雄可选）；否则为指定 heroId 专属天赋 */
  heroId: string | null;
  /** 属性型天赋：直接加成的属性（战斗开始时合并进面板） */
  statBonus?: Partial<HeroStats>;
  /** 触发条件（被动/触发/条件型天赋使用） */
  trigger?: Trigger;
  /** 执行的效果片段（与装备/技能效果复用同一套参数化机制） */
  effects: EffectSegment[];
}

/** 天赋页（方案）：选择一组天赋的组合，进入战斗前加载 */
export interface TalentBook {
  id: string;
  name: string;
  description?: string;
  /** 已选中天赋 id 列表（有序） */
  talentIds: string[];
}

// ---------------------------------------------------------------------------
// 战斗配置
// ---------------------------------------------------------------------------

export interface CombatantConfig {
  label: string;
  hero: Hero;
  /**
   * 该英雄实际携带的技能（由 hero.skills 的 skillId 从技能库解析后的完整对象），
   * 供战斗引擎直接使用。解析在建配置时完成，与模板解耦。
   */
  skills: Skill[];
  itemIds: string[]; // <= MAX_EQUIPMENT
  /** 本英雄佩戴的天赋（已解析为完整对象，便于战斗隔离） */
  talents: Talent[];
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
  /** 真实伤害是否可以被「全类型护盾」吸收（false＝真实伤害无视护盾直接扣生命） */
  trueDamageAffectsShield: boolean;
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

/**
 * 运行时护盾实例：每个独立护盾单独记录（类型/来源/数值/时长/优先级）。
 * 符合「护盾系统扩展」要求：带 id、来源、类型、现值/初值、生成/结束时间。
 */
export interface ShieldInstance {
  id: string;
  /** 来源标签（技能/装备/天赋名） */
  source: string;
  owner: CombatantId;
  type: ShieldType;
  /** 当前剩余护盾值 */
  value: number;
  /** 初始护盾值 */
  maxValue: number;
  /** 生成时间（毫秒） */
  createTime: number;
  /** 自然结束时间（毫秒）；0 表示永久 */
  expireTime: number;
  priority: number;
}

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
  shields: ShieldInstance[];
  /** 累积承伤统计（引擎内即时累计，用于曲线） */
  _uiDamageTaken?: number;
}

/**
 * 运行时 Buff/Debuff 实例（见 #162/#105）。战斗中的临时效果只能修改它，
 * 不能直接修改 HeroTemplate（见 #176）。
 */
export interface BuffInstance {
  id: string;
  /** 来源标签（技能/装备/天赋/Buff 名） */
  source: string;
  owner: CombatantId;
  buffType: BuffType;
  /** 当前有效叠加值（百分比 0-100，= stacks × perStackValue + 基础） */
  value: number;
  /** 每层数值 */
  perStackValue: number;
  /** 当前层数 */
  stacks: number;
  /** 最大层数（0/1=不叠层） */
  maxStacks: number;
  /** 增伤/易伤分类（可选） */
  category?: BuffCategory;
  /** 控制免疫的具体控制类型 */
  controlTypes?: string[];
  /** 创建时间（毫秒） */
  createTime: number;
  /** 结束时间（毫秒）；0=永久 */
  expireTime: number;
  /** 刷新方式 */
  refreshMode: BuffRefreshMode;
  /** 独立计时时每层的结束时间 */
  stackEndTimes?: number[];
  /** 是否可被消耗（maxTriggerCount） */
  expiresOnUse?: boolean;
  /** 剩余可用次数（maxTriggerCount） */
  uses?: number;
  /** 结束原因（见 #163） */
  endReason?: BuffEndReason;
  /** 附带/结束效果 */
  passiveEffects?: EffectSegment[];
}

/** 连续攻击状态（见 #141）：记录连续普攻 */
export interface ConsecutiveAttackState {
  current: number;
  lastAttackTimeMs: number;
  /** 允许间隔（毫秒）；超过则中断 */
  allowedGapMs: number;
  isAttacking: boolean;
}

/**
 * 运行时状态（见 #176）：战斗中所有临时改造（Buff/Debuff/攻速层数/护盾/临时属性/
 * Counter/State Tag）都集中于此处，与 HeroTemplate 完全分离。
 */
export interface CombatantRuntimeState {
  /** 运行时 Buff/Debuff 实例列表 */
  buffs: BuffInstance[];
  /** 计数器（见 #138）：内置 key + 自定义 key */
  counters: Map<string, number>;
  /** 状态标签（见 #171） */
  stateTags: Set<StateTag>;
  /** 攻击序号（见 #139）：每一次普攻自增，从 1 开始 */
  attackSequence: number;
  /** 连续攻击状态（见 #141） */
  consecutive: ConsecutiveAttackState;
  /** 临时攻速加成（百分比 0-100，来自 Buff 叠加，不写回 stats） */
  tempAttackSpeed: number;
  /** 临时攻速上限突破（百分比 0-100） */
  tempCapBreakthrough: number;
  /** 最近一次普攻产生的原始伤害（原始伤害→普通攻击 的数据源） */
  lastBasicAttackRaw: number;
  /** 最近一次技能造成的原始伤害（原始伤害→技能伤害 的数据源） */
  lastSkillRaw: number;
}

// ---------------------------------------------------------------------------
// 战斗事件（时间轴最小单元）
// ---------------------------------------------------------------------------

export type EventType =
  | 'combat_start'
  | 'basic_attack'
  | 'skill_cast'
  | 'item_proc'
  | 'talent_proc'
  | 'dot_tick'
  | 'damage'
  | 'crit'
  | 'heal'
  | 'shield_gain'
  | 'shield_absorbed'
  | 'shield_broken'
  | 'shield_expired'
  | 'cooldown_reduce'
  | 'death'
  | 'cooldown_ready'
  | 'buff'
  | 'attack'
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
  /** 天赋触发专属字段 */
  talentId?: string;
  talentName?: string;
  /** 护盾事件专属字段 */
  shieldId?: string;
  shieldType?: ShieldType;
  shieldSource?: string;
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
    /** 本次伤害是否经过抗性减免及其对象（物理→护甲 / 魔法→魔抗；原始/真实不减免） */
    resist?: { type: 'armor' | 'magic_resist'; value: number };
    /** 抗性减免后、减伤/护盾前的伤害 */
    afterResist?: number;
  };
  /** 目标剩余生命 */
  targetRemainingHp: number;
  description: string;
  /* --- Buff 事件专属（见 #162-164） --- */
  buffType?: BuffType;
  buffStacks?: number;
  buffAction?: 'created' | 'stack' | 'refreshed' | 'expired' | 'removed' | 'dispelled' | 'consumed';
  /* --- 触发链追踪（见 #160-161） --- */
  rootEventId?: number;
  parentEventId?: number;
  sourceEffectId?: string;
  triggerDepth?: number;
  /* --- 调试日志（见 #177） → 详细模式字段 --- */
  debug?: {
    attackSpeed?: number;
    theoreticalInterval?: number;
    minInterval?: number;
    capBroken?: boolean;
    attackSpeedStacks?: number;
    buffs?: string[];
    shields?: number;
    counters?: Record<string, number>;
    stateTags?: string[];
  };
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
  /** 普通攻击次数 */
  basicAttackCount: number;
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
  /** 获得护盾次数 */
  shieldsGained: number;
  /** 总护盾量（各次护盾初始值之和） */
  shieldTotal: number;
  /** 最大单次护盾 */
  shieldMaxSingle: number;
  /** 物理护盾吸收量 */
  physicalShieldAbsorbed: number;
  /** 魔法护盾吸收量 */
  magicShieldAbsorbed: number;
  /** 全类型护盾吸收量 */
  allShieldAbsorbed: number;
  /** 护盾被击破次数 */
  shieldBroken: number;
  /** 护盾自然消失次数 */
  shieldExpired: number;
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
  /** Buff/Debuff 统计（见 #162/#164） */
  buffs: {
    gained: number;
    expired: number;
    activeAtEnd: number;
    /** 攻速叠层峰值 */
    maxAttackSpeedStacks: number;
    attackSpeedStacksAtEnd: number;
  };
  /** 计数器快照（见 #138） */
  counters: Record<string, number>;
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

export interface TalentTemplate {
  kind: 'talent';
  schemaVersion: number;
  data: Talent;
}

export interface TalentBookTemplate {
  kind: 'talentBook';
  schemaVersion: number;
  data: TalentBook;
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
  | TalentTemplate
  | TalentBookTemplate
  | BattlePresetTemplate;

/** 备份文件整体结构 */
export interface BackupFile {
  kind: 'moba-simulator-backup';
  schemaVersion: number;
  exportedAt: string;
  heroes: Hero[];
  equipment: Equipment[];
  skills: Skill[];
  talents: Talent[];
  talentBooks: TalentBook[];
  battlePresets: BattlePreset[];
  savedSimulations: SavedSimulation[];
}

/** 功能默认值：新增空模板时使用 */
export function emptyStats(): HeroStats {
  return {
    maxHp: 1000,
    currentHp: 1000,
    attack: 100,
    extraAttack: 0,
    ap: 0,
    armor: 30,
    magicResist: 30,
    moveSpeed: 350,
    attackInterval: 1.0,
    attackRange: 1,
    baseAttackSpeed: 1500,
    attackSpeedBonus: 0,
    attackCapBreakthrough: 0,

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