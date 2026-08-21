import { describe, it, expect } from 'vitest';
import { finalArmor, finalMagicResist } from '../src/core/formulas/penetration';
import { armorReductionRate, magicReductionRate } from '../src/core/formulas/resistance';
import { effectiveCooldownMs } from '../src/core/formulas/cooldown';
import { resolveCrit } from '../src/core/formulas/crit';
import { Rng } from '../src/core/engine/rng';

describe('护甲穿透 finalArmor', () => {
  it('面板 <= 18 直接减固定穿透', () => {
    expect(finalArmor(18, 5, 0)).toBe(13);
    expect(finalArmor(10, 3, 0)).toBe(7);
  });
  it('面板 18 精确边界走 <= 分支', () => {
    expect(finalArmor(18, 0, 0.5)).toBe(18); // 不应用百分比
  });
  it('面板 18.0001 走 > 分支', () => {
    expect(finalArmor(18.0001, 0, 0.5)).toBeCloseTo((18.0001 - 18) * 0.5 + 18, 6);
  });
  it('面板 > 18 应用混合公式', () => {
    expect(finalArmor(100, 10, 0.3)).toBeCloseTo((100 - 18) * 0.7 + 18 - 10, 6); // 65.4
  });
  it('穿透不能使护甲低于 0', () => {
    expect(finalArmor(10, 30, 0)).toBe(0);
    expect(finalArmor(100, 200, 0.9)).toBe(0);
  });
});

describe('法术穿透 finalMagicResist', () => {
  it('阈值 12 精确边界', () => {
    expect(finalMagicResist(12, 2, 0)).toBe(10);
    expect(finalMagicResist(12.0001, 0, 0.25)).toBeCloseTo((12.0001 - 12) * 0.75 + 12, 6);
  });
  it('> 12 应用百分比', () => {
    expect(finalMagicResist(60, 8, 0.3)).toBeCloseTo((60 - 12) * 0.7 + 12 - 8, 6); // 37.6
  });
  it('不低于 0', () => {
    expect(finalMagicResist(5, 20, 0)).toBe(0);
  });
});

describe('减伤公式', () => {
  it('护甲减伤率', () => {
    expect(armorReductionRate(18)).toBeCloseTo(18 * 0.06 / (1 + 18 * 0.06), 6);
    expect(armorReductionRate(0)).toBe(0);
    // 护甲 33.33 → 50% 减伤
    expect(armorReductionRate(50 / 3)).toBeCloseTo(0.5, 4);
  });
  it('魔抗与护甲同公式', () => {
    expect(magicReductionRate(12)).toBeCloseTo(12 * 0.06 / (1 + 12 * 0.06), 6);
  });
});

describe('冷却缩减', () => {
  it('10s 基础 * 20% 缩减 = 8s', () => {
    expect(effectiveCooldownMs(10, 20)).toBe(8000);
  });
  it('0 缩减不变；超出范围被截断到下限 1ms', () => {
    expect(effectiveCooldownMs(5, 0)).toBe(5000);
    expect(effectiveCooldownMs(5, 200)).toBe(1);
  });
});

describe('暴击', () => {
  it('期望模式：100% 暴击伤害 200% → 2 倍', () => {
    const r = resolveCrit(100, 200, 'expectation', new Rng(1));
    expect(r.crit).toBe(false);
    expect(r.multiplier).toBe(2);
  });
  it('期望模式：0% 暴击 → 1 倍', () => {
    const r = resolveCrit(0, 175, 'expectation', new Rng(1));
    expect(r.multiplier).toBe(1);
  });
  it('种子模式：0% 暴击率永不暴击', () => {
    const rng = new Rng(123);
    for (let i = 0; i < 50; i++) {
      const r = resolveCrit(0, 175, 'seeded', rng);
      expect(r.crit).toBe(false);
    }
  });
  it('相同种子产生相同序列（可复现）', () => {
    const a = new Rng(99), b = new Rng(99);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
    const c = new Rng(99), d = new Rng(99);
    for (let i = 0; i < 20; i++) expect(resolveCrit(50, 175, 'seeded', c)).toEqual(resolveCrit(50, 175, 'seeded', d));
  });
});