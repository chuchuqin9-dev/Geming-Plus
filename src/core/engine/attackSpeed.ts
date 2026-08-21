/**
 * 攻击速度解析器（见 #131-133）
 *
 * - 基础攻速值（baseAttackSpeed RATING）通过【配置表】Resolver 换算成最低攻击间隔，
 *   不强行写死未经确认的数学公式；后续可通过扩充 ATTACK_SPEED_CAP_TABLE 调整。
 * - 有效攻击间隔 = max(理论攻击间隔, 最低攻击间隔)。
 *   最低攻击间隔可被「攻速上限突破」独立修改（见 #133：0.42 → 0.33），
 *   突破以百分比降低最低攻击间隔，默认不叠加（示例中 0.42→0.33 由配置直接给出）。
 * - 攻速加成（Modifier/Buff，见 #134）只做临时运算，不写回英雄模板。
 */
import type { CombatantRuntimeState, HeroStats } from '../types';

/**
 * 攻速上限配置表：baseAttackSpeed(RATING) → 最低攻击间隔（秒）。
 * 未命中时按最接近的已配置条目（向上归并）或内置默认 0.42。
 */
const ATTACK_SPEED_CAP_TABLE: Array<{ rating: number; minInterval: number }> = [
  { rating: 800,  minInterval: 0.55 },
  { rating: 1000, minInterval: 0.50 },
  { rating: 1200, minInterval: 0.46 },
  { rating: 1500, minInterval: 0.42 }, // 规范示例：#131 基础攻速值 1500 → 最低间隔 0.42
  { rating: 1800, minInterval: 0.38 },
  { rating: 2000, minInterval: 0.35 },
];

const DEFAULT_MIN_INTERVAL = 0.42;

/** 通过配置表求得基础攻速值对应的最低攻击间隔（未命中时取最接近的不高于其的条目） */
export function resolveMinAttackInterval(baseAttackSpeed: number): number {
  if (!Number.isFinite(baseAttackSpeed) || baseAttackSpeed <= 0) return DEFAULT_MIN_INTERVAL;
  let best = DEFAULT_MIN_INTERVAL;
  for (const row of ATTACK_SPEED_CAP_TABLE) {
    if (row.rating <= baseAttackSpeed) best = row.minInterval;
  }
  return best;
}

export interface AttackIntervalResult {
  /** 理论攻击间隔（仅由攻速加成分摊，未受限速） */
  theoreticalInterval: number;
  /** 最低攻击间隔（受突破影响后） */
  minInterval: number;
  /** 是否发生了攻速上限截断（理论 < 最低） */
  capped: boolean;
  /** 最终生效攻击间隔（秒） */
  final: number;
}

/**
 * 计算最终普攻间隔：
 *  final = max( baseInterval / (1 + AS%),  minInterval × (1 - 突破/100) )
 */
export function computeEffectiveAttackInterval(
  stats: HeroStats,
  runtime: CombatantRuntimeState,
): AttackIntervalResult {
  const baseInterval = stats.attackInterval > 0 ? stats.attackInterval : 1.0;
  const asBonus = (stats.attackSpeedBonus || 0) + ((runtime && runtime.tempAttackSpeed) || 0);
  const breakPct = (stats.attackCapBreakthrough || 0) + ((runtime && runtime.tempCapBreakthrough) || 0);

  const theoretical = baseInterval / (1 + Math.max(0, asBonus) / 100);
  const minInterval = resolveMinAttackInterval(stats.baseAttackSpeed) * (1 - Math.max(0, Math.min(100, breakPct)) / 100);
  const final = Math.max(theoretical, minInterval) || theoretical;

  return { theoreticalInterval: theoretical, minInterval, capped: theoretical < minInterval, final };
}