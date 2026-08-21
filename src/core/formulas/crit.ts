/**
 * 暴击系统
 *
 * 暴击判定独立、确定、可复现：
 *  - seeded 模式：使用可复现 RNG 判断本次是否暴击。
 *  - expectation 模式：不抽样，期望倍率 = 1 + p×(mult-1)，返回 crit=false。
 *  critRate / critDamage 以 0-100（如暴击伤害 175 表示 1.75 倍）传入。
 */
import type { Rng } from '../engine/rng';

export interface CritResolution {
  /** 是否发生暴击（期望模式下恒为 false，用于展示） */
  crit: boolean;
  /** 伤害倍率（>=1） */
  multiplier: number;
}

/** 暴击伤害百分数 → 倍率（175 → 1.75） */
export function critMultiplier(critDamagePercent: number): number {
  return Math.max(1, critDamagePercent / 100);
}

export function resolveCrit(
  critRatePercent: number,
  critDamagePercent: number,
  randomMode: 'seeded' | 'expectation',
  rng: Rng,
): CritResolution {
  const mult = critMultiplier(critDamagePercent);
  if (randomMode === 'expectation') {
    const p = Math.min(100, Math.max(0, critRatePercent)) / 100;
    // 期望倍率 = 1×(1-p) + mult×p，但保证 >= 1
    const expected = 1 + (mult - 1) * p;
    return { crit: false, multiplier: Math.max(1, expected) };
  }
  const rate = Math.min(100, Math.max(0, critRatePercent)) / 100;
  const roll = rng.next();
  if (roll < rate) {
    return { crit: true, multiplier: mult };
  }
  return { crit: false, multiplier: 1 };
}