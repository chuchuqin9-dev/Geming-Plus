/**
 * 冷却缩减公式
 *
 * 实际冷却 = 基础冷却 × (1 - 冷却缩减)
 * cooldownReduction 以 0-100（如 20 表示 20%）传入。
 */
export function effectiveCooldownMs(
  baseSeconds: number,
  cooldownReductionPercent: number,
): number {
  const cdr = clampPercent(cooldownReductionPercent);
  const seconds = baseSeconds * (1 - cdr);
  // 最小时长下限，避免 0 导致死循环
  return Math.max(1, seconds * 1000);
}

export function clampPercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, p)) / 100;
}