// ============================================================================
// 核心领域模型 —— MOBA 对战模拟器
// 所有纯类型定义集中在此，供引擎 / 存储 / UI 共用。
// ============================================================================

export type HeroType = 'melee' | 'ranged';

export type DamageType = 'physical' | 'magic' | 'true';

export type EffectType = 'damage' | 'heal' | 'shield';

// 伤害成长倍率所引用的属性来源
export type ScalerStat =
  | 'attack' // 自身攻击力
  | 'ap' // 自身法强
  | 'maxHp' // 自身最大生命
  | 'targetAttack' // 目标攻击力
  | 'targetAp' // 目标法强
  | 'targetMaxHp'; // 目标最大生命

export interface DamageScaling {
  stat: ScalerStat;
  ratio: number; // 0.25 = 25%
}

// ---------------------------------------------------------------------------
// 基础属性
// ---------------------------------------------------------------------------
export interface BaseStats {
  hp: number; // 生命值
  attack: number; // 攻击力
  ap: number; // 法强
  armor: number; // 护甲
  magicResist: number; // 魔抗
  moveSpeed: number; // 移动速度
  attackInterval: number; // 攻击间隔（秒）
}

export interface CritStats {
  physicalCritRate: number; // 物理暴击率 0-1
  physicalCritDamage: number; // 物理暴击伤害倍数（1.5 = 150%）
  magicCritRate: number;
  magicCritDamage: number;
}

export interface PenStats {
  flatArmorPen: number; // 固定护甲穿透
  percentArmorPen: number; // 百分比护甲穿透 0-1
  flatMagicPen: number; // 固定法术穿透
  percentMagicPen: number; // 百分比法术穿透 0-1
}

export interface SustainStats {
  physicalVamp: number; // 物理吸血 0-1
  magicVamp: number; // 法术吸血 0-1
  allVamp: number; // 全能吸血 0-1
  onHitHp: number; // 击中生命恢复
}

export interface DamageBoostStats {
  physicalSkillDmg: number; // 物理技能伤害提升 0-1
  attackDmg: number; // 普通攻击伤害提升 0-1
  magicDmg: number; // 法术伤害提升 0-1
}

export interface DefenseStats {
  damageReduction: number; // 伤害减免 0-1
  shieldBonus: number; // 护盾加成 0-1
}

export interface SkillStats {
  cooldownReduction: number; // 冷却缩减 0-1（上限 0.4）
}

export interface Stats {
  base: BaseStats;
  crit: CritStats;
  pen: PenStats;
  sustain: SustainStats;
  damageBoost: DamageBoostStats;
  defense: DefenseStats;
  skill: SkillStats;
}

// ---------------------------------------------------------------------------
// 技能系统（完整技能编辑器）
// ---------------------------------------------------------------------------
export type ProcTrigger =
  | 'on_hit' // 命中触发（普攻/可叠 on-hit 的技能造成伤害后）
  | 'on_attack' // 攻击后触发（出手即触发）
  | 'on_damage_taken' // 受到伤害后触发
  | 'periodic' // 周期性触发
  | 'none'; // 主动技能

export interface SkillSegment {
  id: string;
  name: string; // 段名，如 "第1段" / "治疗"
  effectType: EffectType;
  delaySeconds: number; // 该段从施放起的延迟（0 表示立即）
  damageType: DamageType; // effectType=damage 时有效
  baseDamage: number; // 固定数值（heal/shield 表示固定恢复/护盾值）
  scaling: DamageScaling[]; // 属性倍率（damage 或 heal 生效）
  critable: boolean; // 该段伤害是否可暴击
  applyOnHit: boolean; // 该段伤害是否触发命中类效果/装备 on-hit
}

export interface Skill {
  id: string;
  name: string;
  type: 'active' | 'passive';
  cooldown: number; // 秒；被动时为内置冷却
  autoCast: boolean; // 主动技能：冷却好了自动释放
  trigger: ProcTrigger; // 被动生效触发时机
  segments: SkillSegment[];
}

// ---------------------------------------------------------------------------
// 装备系统
// ---------------------------------------------------------------------------
export interface ItemStatBonus {
  base?: Partial<BaseStats>;
  crit?: Partial<CritStats>;
  pen?: Partial<PenStats>;
  sustain?: Partial<SustainStats>;
  damageBoost?: Partial<DamageBoostStats>;
  defense?: Partial<DefenseStats>;
  skill?: Partial<SkillStats>;
}

export interface ItemOnHit {
  id: string;
  name: string;
  trigger: 'on_hit' | 'periodic'; // 触发方式
  baseDamage: number; // 固定伤害（如 [70]）
  scaling: DamageScaling[]; // 成长倍率（如 [25%] × 敌方法强）
  damageType: DamageType;
  cooldown: number; // 触发后内置冷却（秒）
  critable: boolean;
  healFromDamageRatio: number; // 0-1，造成伤害的吸血补充比例（可跨装备叠加到全能吸血特殊情况）
}

export interface Item {
  id: string;
  name: string;
  description: string;
  stats: ItemStatBonus;
  onHits: ItemOnHit[];
}

// ---------------------------------------------------------------------------
// 木桩目标配置
// ---------------------------------------------------------------------------
export interface DummyConfig {
  name: string;
  armor: number;
  magicResist: number;
  hp: number; // 木桩生命（用于"无限生命"时填一个极大值）
  infiniteHp: boolean;
}

// ---------------------------------------------------------------------------
// 战斗方案
// ---------------------------------------------------------------------------
export interface BattlePlan {
  id: string;
  name: string;
  mode: 'dummy' | 'vs';
  duration: number; // 模拟时长（秒）
  heroId: string;
  itemIds: string[]; // 最多 9 件
  dummy: DummyConfig;
  enemy: {
    heroId: string;
    itemIds: string[];
  };
  seedUsed?: number; // 用于随机数（可复现）
}

// ---------------------------------------------------------------------------
// 战斗事件 / 结果
// ---------------------------------------------------------------------------
export interface BattleActor {
  refId: string; // 英雄/木桩唯一引用
  label: string;
  isHero: boolean;
  stats: Stats; // 已含装备加成的最终属性
  hp: number;
}

export interface BattleEvent {
  time: number;
  type:
    | 'attack_start'
    | 'attack_hit'
    | 'skill_cast'
    | 'skill_hit'
    | 'item_proc'
    | 'dot'
    | 'heal'
    | 'shield'
    | 'cooldown_ready'
    | 'death'
    | 'fight_start'
    | 'fight_end';
  sourceId: string;
  targetId: string;
  damageType?: DamageType;
  value: number; // 伤害/恢复/护盾数值（原始或结算后视情而定）
  wasCrit: boolean;
  sourceName?: string;
  targetName?: string;
}

export interface DamageBreakdown {
  autoAttack: number;
  skill: number;
  item: number;
  crit: number;
  trueDamage: number;
  recovered: number;
  shielded: number;
  physicalHits: number;
  magicHits: number;
  critCount: number;
  totalHits: number;
}

export interface CombatantResult {
  refId: string;
  label: string;
  isHero: boolean;
  totalDamage: number;
  avgDps: number;
  maxBurst: number; // 1 秒窗口内最大爆发伤害
  maxSingleHit: number;
  survivalTime: number; // 存活时间
  remainingHp: number;
  breakdown: DamageBreakdown;
  // DPS 曲线：每个采样点的累计伤害 / 该采样点时刻
  dpsCurve: { time: number; cumulativeDamage: number; dps: number }[];
}

export interface BattleResult {
  plan: BattlePlan;
  durationSimulated: number;
  events: BattleEvent[];
  combattants: CombatantResult[];
  winnerId?: string;
  endedEarly: boolean;
  seedUsed: number;
}

// ---------------------------------------------------------------------------
// 便捷工具
// ---------------------------------------------------------------------------
export function makeEmptyStats(): Stats {
  return {
    base: {
      hp: 1000,
      attack: 100,
      ap: 100,
      armor: 30,
      magicResist: 30,
      moveSpeed: 350,
      attackInterval: 1.0,
    },
    crit: {
      physicalCritRate: 0.2,
      physicalCritDamage: 1.5,
      magicCritRate: 0.1,
      magicCritDamage: 1.5,
    },
    pen: {
      flatArmorPen: 0,
      percentArmorPen: 0,
      flatMagicPen: 0,
      percentMagicPen: 0,
    },
    sustain: { physicalVamp: 0, magicVamp: 0, allVamp: 0, onHitHp: 0 },
    damageBoost: { physicalSkillDmg: 0, attackDmg: 0, magicDmg: 0 },
    defense: { damageReduction: 0, shieldBonus: 0 },
    skill: { cooldownReduction: 0 },
  };
}

export function emptyBreakdown(): DamageBreakdown {
  return {
    autoAttack: 0,
    skill: 0,
    item: 0,
    crit: 0,
    trueDamage: 0,
    recovered: 0,
    shielded: 0,
    physicalHits: 0,
    magicHits: 0,
    critCount: 0,
    totalHits: 0,
  };
}

export function uid(prefix = ''): string {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 9)
  );
}

// 深合并两个 Stats（用于把装备加成叠加到英雄基础属性上）
export function mergeStats(hero: Stats, itemBonuses: Stats[]): Stats {
  const out = makeEmptyStats();
  out.base = { ...hero.base };
  out.crit = { ...hero.crit };
  out.pen = { ...hero.pen };
  out.sustain = { ...hero.sustain };
  out.damageBoost = { ...hero.damageBoost };
  out.defense = { ...hero.defense };
  out.skill = { ...hero.skill };

  for (const bonus of itemBonuses) {
    for (const key of Object.keys(bonus.base)) {
      (out.base as any)[key] = ((out.base as any)[key] ?? 0) + (bonus.base as any)[key] ?? 0;
    }
    for (const key of Object.keys(bonus.crit)) {
      (out.crit as any)[key] = ((out.crit as any)[key] ?? 0) + (bonus.crit as any)[key] ?? 0;
    }
    for (const key of Object.keys(bonus.pen)) {
      (out.pen as any)[key] = ((out.pen as any)[key] ?? 0) + (bonus.pen as any)[key] ?? 0;
    }
    for (const key of Object.keys(bonus.sustain)) {
      (out.sustain as any)[key] = ((out.sustain as any)[key] ?? 0) + (bonus.sustain as any)[key] ?? 0;
    }
    for (const key of Object.keys(bonus.damageBoost)) {
      (out.damageBoost as any)[key] = ((out.damageBoost as any)[key] ?? 0) + (bonus.damageBoost as any)[key] ?? 0;
    }
    for (const key of Object.keys(bonus.defense)) {
      (out.defense as any)[key] = ((out.defense as any)[key] ?? 0) + (bonus.defense as any)[key] ?? 0;
    }
    for (const key of Object.keys(bonus.skill)) {
      (out.skill as any)[key] = ((out.skill as any)[key] ?? 0) + (bonus.skill as any)[key] ?? 0;
    }
  }

  // 钳制：暴击率 0-1，冷却缩减上限 0.4，吸血 0-1
  out.crit.physicalCritRate = clamp(out.crit.physicalCritRate, 0, 1);
  out.crit.magicCritRate = clamp(out.crit.magicCritRate, 0, 1);
  out.skill.cooldownReduction = clamp(out.skill.cooldownReduction, 0, 0.4);
  out.sustain.physicalVamp = clamp(out.sustain.physicalVamp, 0, 1);
  out.sustain.magicVamp = clamp(out.sustain.magicVamp, 0, 1);
  out.sustain.allVamp = clamp(out.sustain.allVamp, 0, 1);
  out.sustain.onHitHp = Math.max(0, out.sustain.onHitHp);
  out.sustain.allVamp = clamp(out.sustain.allVamp, 0, 1);
  return out;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function baseStatsFromHero(h: Hero): BaseStats {
  return { ...h.baseStats };
}

import type { Hero } from './types';