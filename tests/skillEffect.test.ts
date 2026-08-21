/**
 * 英雄技能「技能E」效果计算专项回归
 *
 * 覆盖用户报告场景：
 *  测试1：英雄A 携带技能E，进入战斗模拟能正常触发；
 *  测试2：技能E 释放后的伤害/效果正确计算；
 *  测试3：修改英雄A 属性后，技能E 按属性变化重新计算；
 *  测试4：多次模拟结果稳定。
 *
 * 约定：英雄 Hero.skills 存技能库 id（skillId 引用）；buildCombatConfig 用技能库
 * 按 id 解析出完整技能供引擎。技能公式：伤害 = baseDamage + Σ(属性 × ratio)，再经过
 * 目标物/魔抗减伤。
 */
import { describe, it, expect } from 'vitest';
import type { CombatConfig, Hero, StatScaling } from '../src/core/types';
import { emptyStats } from '../src/core/types';
import { runCombat } from '../src/core/engine/combatEngine';
import { buildCombatConfig } from '../src/core/combatConfig';
import { uid } from '../src/core/defaults';

const SCALE: StatScaling[] = [{ stat: 'attack', ratio: 0.8 }];

/** 构造「技能E」：2s 冷却、魔法单体 40 + 80% 攻击加成 */
function skillE() {
  return {
    id: 'skill_e_test',
    name: '技能E',
    type: 'active' as const,
    active: { cooldownSeconds: 2, priority: 0, manaCost: 0 },
    segments: [{
      kind: 'damage' as const,
      delaySeconds: 0,
      baseDamage: 40,
      scaling: SCALE,
      damageType: 'magic' as const,
      canCrit: false,
      critFamily: 'magic' as const,
      canLifesteal: true,
      canTriggerItems: true,
      sourceKind: 'skill' as const,
      isSkillBoost: true,
      useMagicDamageBoost: true,
    }],
  };
}

function heroWithSkillE(attack: number): Hero {
  return {
    id: uid('h'),
    name: '英雄A',
    type: 'melee',
    baseStats: { ...emptyStats(), attack, maxHp: 5000, currentHp: 5000, armor: 30, magicResist: 30, magicDamage: 0 },
    // 关键：只存技能库 id，不复制技能定义
    skills: ['skill_e_test'],
    defaultItems: [],
    talents: [],
  };
}

/** 构造一段伤害片段 */
function segOf(damageType: 'physical' | 'magic' | 'true', baseDamage: number, scaling: StatScaling[] = []) {
  return {
    kind: 'damage' as const,
    delaySeconds: 0,
    baseDamage,
    scaling,
    damageType,
    canCrit: false,
    critFamily: (damageType === 'magic' ? 'magic' : 'physical') as 'magic' | 'physical',
    canLifesteal: true,
    canTriggerItems: true,
    sourceKind: 'skill' as const,
    isSkillBoost: true,
    useMagicDamageBoost: true,
  };
}

function skillOf(name: string, seg: ReturnType<typeof segOf>) {
  return {
    id: `skill_${name}`,
    name,
    type: 'active' as const,
    active: { cooldownSeconds: 2, priority: 0, manaCost: 0 },
    segments: [seg],
  };
}

function heroWithSkill(attack: number, skillId: string): Hero {
  return {
    id: uid('h'),
    name: '英雄A',
    type: 'melee',
    baseStats: { ...emptyStats(), attack, maxHp: 5000, currentHp: 5000, armor: 30, magicResist: 30, magicDamage: 0 },
    skills: [skillId],
    defaultItems: [],
    talents: [],
  };
}

/** 木桩魔抗/护甲 = 0，使技能伤害 = 公式原值，方便断言 */
function runDummy(heroA: Hero, lib: ReturnType<typeof skillOf>[], opts: { duration?: number; seed?: number; randomMode?: CombatConfig['randomMode']; armor?: number; mr?: number } = {}) {
  const byId = new Map();
  const config = buildCombatConfig({
    mode: 'dummy',
    durationSeconds: opts.duration ?? 3,
    randomMode: opts.randomMode ?? 'expectation',
    seed: opts.seed,
    skills: lib,
    heroA,
    itemsA: [],
    dummy: { infiniteHp: true, maxHp: 1000000, armor: opts.armor ?? 0, magicResist: opts.mr ?? 0, damageReduction: 0 },
    skillPriorityA: heroA.skills,
  });
  return runCombat(config, byId);
}

/** 运行 2s 冷却的伤害技能打桩，返回技能卡（含总伤与每次均伤） */
function runSkill(damageType: 'physical' | 'magic' | 'true', baseDamage: number, dummyArmor: number, dummyMr: number, duration = 2) {
  const skill = skillOf('SK', segOf(damageType, baseDamage));
  const heroA = heroWithSkill(20, skill.id);
  const r = runDummy(heroA, [skill], { duration, armor: dummyArmor, mr: dummyMr });
  return r.results.find((x) => x.id === 'A')!.skills.find((s) => s.name === 'SK')!;
}

/** 统一抗性减伤率：r*0.06 / (1+r*0.06) */
function resistRate(r: number) { return (r * 0.06) / (1 + r * 0.06); }

describe('技能E 专项：触发与计算', () => {
  it('测试1+2：携带技能E 的英雄能触发技能，伤害 = baseDamage + 攻击×0.8', () => {
    const heroA = heroWithSkillE(200); // 40 + 200×0.8 = 200 魔法
    const r = runDummy(heroA, [skillE()], { duration: 3 }); // 2s 冷却 → 0s、2s 各一次 = 2 次
    const ra = r.results.find((x) => x.id === 'A')!;
    const row = ra.skills.find((s) => s.name === '技能E')!;
    expect(row.castCount).toBe(2);
    expect(row.damage).toBe(400); // 2 × 200
    expect(ra.damage.skill).toBe(400); // 技能伤害独立入桶（普攻另计物理桶）
    // 战斗日志记录技能释放
    expect(r.events.some((e) => e.eventType === 'skill_cast' && e.skillName === '技能E')).toBe(true);
  });

  it('测试3：提升英雄攻击后，技能E 按 0.8 倍率重新计算', () => {
    const before = runDummy(heroWithSkillE(200), [skillE()], { duration: 3 });
    const bRow = before.results.find((x) => x.id === 'A')!.skills.find((s) => s.name === '技能E')!;
    const after = runDummy(heroWithSkillE(500), [skillE()], { duration: 3 }); // 40 + 500×0.8 = 440
    const aRow = after.results.find((x) => x.id === 'A')!.skills.find((s) => s.name === '技能E')!;
    expect(bRow.damage).toBe(400); // (40+160)×2
    expect(aRow.damage).toBe(880); // (40+400)×2 —— 属性加成随攻击变化重新计算
    expect(aRow.avgDamage).toBe(440);
  });

  it('测试4：固定种子多次模拟，技能E 结果稳定一致', () => {
    const heroA = heroWithSkillE(300);
    const run1 = runDummy(heroA, [skillE()], { duration: 5, randomMode: 'seeded', seed: 7 });
    const run2 = runDummy(heroA, [skillE()], { duration: 5, randomMode: 'seeded', seed: 7 });
    const row1 = run1.results.find((x) => x.id === 'A')!;
    const row2 = run2.results.find((x) => x.id === 'A')!;
    expect(row1).toEqual(row2);
    const s1 = row1.skills.find((s) => s.name === '技能E')!;
    // 5s：0/2/4 三次
    expect(s1.castCount).toBe(3);
    expect(s1.damage).toBe((40 + 300 * 0.8) * 3);
  });
});

describe('技能E 统一伤害结算（防御计算）专项', () => {
  it('测试2/3：物理技能最终伤害随目标护甲变化（0 / 100 / 300），减伤公式一致', () => {
    const a0 = runSkill('physical', 100, 0, 0);   // 0 护甲：不减免
    const a100 = runSkill('physical', 100, 100, 0); // 护甲100 → 减伤 0.06*100/1.06
    const a300 = runSkill('physical', 100, 300, 0); // 护甲300 → 减伤 0.06*300/2.8
    const casts = 2; // 2s / 2s 冷却 = 0s、2s 两次
    expect(a0.avgDamage).toBeCloseTo(100, 4);
    expect(a100.avgDamage).toBeCloseTo(100 * (1 - resistRate(100)), 4);
    expect(a300.avgDamage).toBeCloseTo(100 * (1 - resistRate(300)), 4);
    // 低 < 高，护甲越高伤害越低
    expect(a100.damage).toBeGreaterThan(a300.damage);
    expect(a0.damage).toBe(100 * casts);
  });

  it('测试2b：魔法技能随目标魔抗变化；真实伤害无视护甲/魔抗', () => {
    const m0 = runSkill('magic', 150, 0, 0);
    const m200 = runSkill('magic', 150, 0, 200);
    expect(m0.avgDamage).toBeCloseTo(150, 4);
    expect(m200.avgDamage).toBeCloseTo(150 * (1 - resistRate(200)), 4);

    const t0 = runSkill('true', 999, 0, 0);
    const t300 = runSkill('true', 999, 300, 300); // 无视双抗
    expect(t0.avgDamage).toBeCloseTo(999, 4);
    expect(t300.avgDamage).toBeCloseTo(999, 4);
  });

  it('测试4：普攻与技能都走统一结算——同一护甲下两者按同一减伤率扣血', () => {
    // 物理技能 vs 护甲 100 的单次均伤
    const skill = runSkill('physical', 100, 100, 0);
    expect(skill.avgDamage).toBeCloseTo(100 * (1 - resistRate(100)), 4);

    // 普攻（attack=100，物理）vs 护甲100，事件里的减伤率应与技能一致
    const skillLib = skillOf('SK', segOf('physical', 100));
    const h2 = heroWithSkill(100, skillLib.id);
    const r2 = runDummy(h2, [skillLib], { duration: 1, armor: 100 });
    const dmgEvents = r2.events.filter((e) => e.eventType === 'damage' && e.finalDamage > 0);
    // 只要存在伤害事件，其减伤率必须等于统一公式
    for (const e of dmgEvents.slice(0, 3)) {
      expect(e.details?.reductionRate ?? 0).toBeCloseTo(resistRate(100), 6);
      expect(e.details?.resist?.type).toBe('armor');
    }
  });
});