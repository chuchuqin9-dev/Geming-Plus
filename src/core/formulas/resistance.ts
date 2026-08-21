/**
 * 减伤公式
 *
 * 护甲/魔抗减伤率：rate = 数值×0.06 / (1 + 数值×0.06)
 * 实际伤害 = 原始伤害 × (1 - rate)
 */
import type { DamageType } from '../types';

export function armorReductionRate(armor: number): number {
  const x = armor * 0.06;
  return x / (1 + x);
}

export function magicReductionRate(magicResist: number): number {
  return armorReductionRate(magicResist);
}

/**
 * 对任意伤害类型应用抗性减伤。
 * true 伤害默认无视抗性。
 */
export function applyResistance(
  raw: number,
  damageType: DamageType,
  finalResist: number,
): { mitigated: number; reductionRate: number } {
  if (damageType === 'true') {
    return { mitigated: raw, reductionRate: 0 };
  }
  const rate =
    damageType === 'physical'
      ? armorReductionRate(finalResist)
      : magicReductionRate(finalResist);
  return { mitigated: raw * (1 - rate), reductionRate: rate };
}