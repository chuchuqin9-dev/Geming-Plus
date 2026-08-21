import { describe, it, expect } from 'vitest';
import {
  type CombatConfig, type Equipment, type Hero, type HeroStats,
  emptyStats,
} from '../src/core/types';
import { runCombat } from '../src/core/engine/combatEngine';
import { buildCombatConfig } from '../src/core/combatConfig';
import { uid } from '../src/core/defaults';

function hero(name: string, overrides: Partial<HeroStats> = {}): Hero {
  return {
    id: uid('h'),
    name,
    type: 'melee',
    baseStats: { ...emptyStats(), maxHp: 5000, currentHp: 5000, attack: 100, armor: 30, magicResist: 30, ...overrides },
    skills: [],
    defaultItems: [],
  };
}

function combatant(hero: Hero, itemIds: string[] = [], label?: string) {
  return { label: label || hero.name, hero, itemIds };
}

function run(
  opts: {
    heroes: Hero[]; items?: Equipment[]; itemsA?: string[]; itemsB?: string[];
    duration?: number; randomMode?: CombatConfig['randomMode']; seed?: number;
    dummyArmor?: number; dummyMr?: number; infinite?: boolean;
  },
) {
  const byId = new Map<string, Equipment>((opts.items || []).map((e) => [e.id, e]));
  const config: CombatConfig = buildCombatConfig({
    mode: opts.heroes.length >= 2 ? 'vs' : 'dummy',
    durationSeconds: opts.duration ?? 3,
    randomMode: opts.randomMode ?? 'expectation',
    seed: opts.seed,
    heroA: opts.heroes[0],
    itemsA: opts.itemsA ?? [],
    heroB: opts.heroes[1],
    itemsB: opts.itemsB,
    dummy: { infiniteHp: opts.infinite ?? true, maxHp: 100000, armor: opts.dummyArmor ?? 0, magicResist: opts.dummyMr ?? 0, damageReduction: 0 },
  });
  return runCombat(config, byId);
}

describe('战斗引擎：普攻时间轴', () => {
  it('3s 内攻击 0/1/2/3 共 4 次，攻击 100 → 总伤 400', () => {
    const result = run({ heroes: [hero('A')], duration: 3 });
    const r = result.results.find((x) => x.id === 'A')!;
    expect(r.damage.hitCount).toBe(4);
    expect(r.damage.total).toBe(400);
  });
  it('种子模式 100% 物理暴击 200% 伤害，攻击 100 → 每次 200 且都暴击', () => {
    const h = hero('A', { physicalCritRate: 100, physicalCritDamage: 200 });
    const result = run({ heroes: [h], duration: 2, randomMode: 'seeded', seed: 1 });
    const r = result.results.find((x) => x.id === 'A')!;
    expect(r.damage.total).toBe(3 * 200); // 0/1/2
    expect(r.damage.critCount).toBe(3);
  });
});

describe('战斗引擎：护甲/穿透', () => {
  it('护甲 300 时减伤 ~64.3%，总伤约 100×3×减伤', () => {
    const result = run({ heroes: [hero('A')], duration: 2, dummyArmor: 300 });
    const r = result.results.find((x) => x.id === 'A')!;
    const rate = 300 * 0.06 / (1 + 300 * 0.06);
    expect(r.damage.total).toBeCloseTo(3 * 100 * (1 - rate), 1);
  });
  it('固定穿透超过护甲 → 最终护甲 0 → 全额伤害', () => {
    const h = hero('A', { flatArmorPen: 50 });
    const result = run({ heroes: [h], duration: 2, dummyArmor: 20 });
    const r = result.results.find((x) => x.id === 'A')!;
    expect(r.damage.total).toBe(300);
  });
});

describe('战斗引擎：可复现与真实伤害', () => {
  it('相同种子运行两次 → 完全相同', () => {
    const h = hero('A', { attack: 100, physicalCritRate: 50, physicalCritDamage: 175 });
    const a = run({ heroes: [h], duration: 5, randomMode: 'seeded', seed: 12345 });
    const b = run({ heroes: [h], duration: 5, randomMode: 'seeded', seed: 12345 });
    expect(a.results.find((x) => x.id === 'A')!.damage.total)
      .toBe(b.results.find((x) => x.id === 'A')!.damage.total);
  });
  it('真实伤害无视护甲', () => {
    const h = hero('A');
    // 构造一个真实伤害技能
    h.skills = [{ id: 's1', name: '真伤', type: 'active', active: { cooldownSeconds: 1, priority: 1, manaCost: 0 },
      segments: [{ kind: 'damage', delaySeconds: 0, baseDamage: 100, scaling: [], damageType: 'true', canCrit: false, critFamily: 'physical', canLifesteal: true, canTriggerItems: true, sourceKind: 'skill', isSkillBoost: true, useMagicDamageBoost: true }] }];
    const result = run({ heroes: [h], duration: 2, dummyArmor: 1000 });
    const r = result.results.find((x) => x.id === 'A')!;
    // 护甲 1000 下普攻几乎免疫；真伤 100×3=300 全量生效
    expect(r.damage.trueDmg).toBe(300);
    expect(r.damage.total).toBeGreaterThanOrEqual(300);
  });
});

describe('战斗引擎：1V1', () => {
  it('高攻击低血量英雄应在超时前击杀对手', () => {
    const a = hero('射手', { attack: 1000, maxHp: 3000, currentHp: 3000 });
    const b = hero('脆皮', { maxHp: 1500, currentHp: 1500, armor: 0 });
    const result = run({ heroes: [a, b], duration: 10, randomMode: 'expectation' });
    expect(result.endReason).toBe('victory');
    const rb = result.results.find((x) => x.id === 'B')!;
    expect(rb.alive).toBe(false);
  });
});