import { describe, it, expect } from 'vitest';
import {
  type CombatConfig, type Equipment, type Hero, type HeroStats, type ShieldType, type StatScaling, type Talent,
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
    talentsA?: Talent[]; talentsB?: Talent[];
    duration?: number; randomMode?: CombatConfig['randomMode']; seed?: number;
    dummyArmor?: number; dummyMr?: number; infinite?: boolean;
    trueDamageAffectsShield?: boolean;
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
    talentsA: opts.talentsA,
    heroB: opts.heroes[1],
    itemsB: opts.itemsB,
    talentsB: opts.talentsB,
    trueDamageAffectsShield: opts.trueDamageAffectsShield,
    dummy: { infiniteHp: opts.infinite ?? true, maxHp: 100000, armor: opts.dummyArmor ?? 0, magicResist: opts.dummyMr ?? 0, damageReduction: 0 },
  });
  return runCombat(config, byId);
}

/** 构造一个主动技能（可独立指定效果段） */
function skillOf({ cd = 1, delay = 0 }: { cd?: number; delay?: number } = {}): Hero['skills'][number] {
  return {
    id: uid('s'),
    name: '技能',
    type: 'active',
    active: { cooldownSeconds: cd, priority: 1, manaCost: 0 },
    segments: [{
      kind: 'damage', delaySeconds: delay, baseDamage: 100, scaling: [], damageType: 'physical',
      canCrit: false, critFamily: 'physical', canLifesteal: true, canTriggerItems: true, sourceKind: 'skill',
      isSkillBoost: true, useMagicDamageBoost: true,
    }],
  };
}

function shieldTalent(type: ShieldType, value: number): Talent {
  return {
    id: uid('t'), name: '护盾', description: '', type: 'triggered', heroId: null,
    trigger: { event: 'combat_start' },
    effects: [{ kind: 'shield', delaySeconds: 0, basePower: value, scaling: [], durationSeconds: 0, shieldType: type, refresh: 'stack', priority: 0 }],
  };
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

describe('战斗引擎：真实伤害公式（固定值 + 属性倍率）', () => {
  const trueSkill = (baseDamage: number, scaling: StatScaling[]) => ({
    kind: 'damage', delaySeconds: 0, baseDamage, scaling, damageType: 'true' as const,
    canCrit: false, critFamily: 'physical' as const, canLifesteal: true, canTriggerItems: true,
    sourceKind: 'skill' as const, isSkillBoost: true, useMagicDamageBoost: true,
  });

  it('攻击 200、100 基础真伤 + 30% 攻击倍率 → 每次 160，3 次共 480', () => {
    const h = hero('A', { attack: 200 });
    h.skills = [{ ...skillOf({ cd: 1 }), name: '真伤', segments: [trueSkill(100, [{ stat: 'attack', ratio: 0.3 }])] }];
    const result = run({ heroes: [h], duration: 2, dummyArmor: 1000 });
    const r = result.results.find((x) => x.id === 'A')!;
    expect(r.damage.trueDmg).toBe(480); // 0/1/2 共 3 次 × 160，真伤无视 1000 护甲
    expect(r.damage.skill).toBe(480);
  });

  it('敌方最大生命 10% 真伤：木桩 100000 → 10000', () => {
    const h = hero('A');
    h.skills = [{ ...skillOf({ cd: 100 }), name: '真伤%', segments: [trueSkill(0, [{ stat: 'targetMaxHp', ratio: 0.1 }])] }];
    const result = run({ heroes: [h], duration: 1, dummyArmor: 1000 });
    const r = result.results.find((x) => x.id === 'A')!;
    expect(r.damage.trueDmg).toBe(10000);
  });
});

describe('战斗引擎：天赋系统', () => {
  it('属性型天赋 攻击+20 → 攻击 100→120，普攻总伤提升', () => {
    const talent: Talent = {
      id: uid('t'), name: '强化', description: '', type: 'attribute', heroId: null,
      statBonus: { attack: 20 }, effects: [],
    };
    const h = hero('A');
    const result = run({ heroes: [h], talentsA: [talent], duration: 2 });
    const r = result.results.find((x) => x.id === 'A')!;
    expect(r.damage.total).toBe(3 * 120); // 0/1/2 共 3 次 × 120
  });

  it('触发型天赋 战斗开始获得护盾：技能命中后减少自身冷却 5s → 冷却从 10s 提前到 5s（共 2 次释放）', () => {
    const h = hero('A');
    h.skills = [skillOf({ cd: 10 })];
    const reduce: Talent = {
      id: uid('t'), name: '冷却', description: '', type: 'triggered', heroId: null,
      trigger: { event: 'skill_hit' },
      effects: [{ kind: 'cooldown_reduce', delaySeconds: 0, target: 'ALL_SKILLS', seconds: 5, allowOvershoot: false }],
    };
    const result = run({ heroes: [h], talentsA: [reduce], duration: 6 });
    const r = result.results.find((x) => x.id === 'A')!;
    // 无冷却减少：仅 0s 释放 1 次（下次 10s>6s）；减少后 0s/5s 各一次
    expect(r.skills.find((s) => s.skillId === h.skills[0].id)!.castCount).toBe(2);
  });
});

describe('战斗引擎：护盾系统', () => {
  it('全类型护盾 500 吸收物理普攻 300，护甲不参与，生命不下降', () => {
    // A 开局获得全类型护盾；B 攻击力 100 连打 A
    const a = hero('坦克', { attack: 0, armor: 0, maxHp: 5000, currentHp: 5000 });
    const b = hero('平A', { attack: 100, armor: 0 });
    const result = run({ heroes: [a, b], talentsA: [shieldTalent('all', 500)], duration: 3 });
    const ra = result.results.find((x) => x.id === 'A')!;
    expect(ra.defense.shieldGenerated).toBe(500);
    expect(ra.defense.shieldsGained).toBe(1);
    // 4 次普攻(0/1/2/3) × 100 = 400 全被护盾吸收，生命不变
    expect(ra.defense.allShieldAbsorbed).toBe(400);
    expect(ra.defense.damageTaken).toBe(0);
    expect(ra.finalHp).toBe(5000);
  });

  it('真实伤害默认无视护盾（trueDamageAffectsShield=false），全类型盾不吸收', () => {
    const a = hero('坦克', { attack: 0, armor: 0, maxHp: 5000, currentHp: 5000 });
    const b = hero('真伤', { attack: 0, armor: 0 });
    b.skills = [{ ...skillOf({ cd: 100 }), name: '真伤', segments: [{
      kind: 'damage', delaySeconds: 0, baseDamage: 200, scaling: [], damageType: 'true',
      canCrit: false, critFamily: 'physical', canLifesteal: true, canTriggerItems: true, sourceKind: 'skill', isSkillBoost: true, useMagicDamageBoost: true,
    }] }];
    const result = run({ heroes: [a, b], talentsA: [shieldTalent('all', 500)], duration: 1 });
    const ra = result.results.find((x) => x.id === 'A')!;
    expect(ra.defense.allShieldAbsorbed).toBe(0);
    expect(ra.defense.trueTaken).toBe(200);
    expect(ra.finalHp).toBe(4800);
  });
});