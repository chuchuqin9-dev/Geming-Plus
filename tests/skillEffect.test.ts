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

/** 木桩魔抗 = 0，使技能伤害 = 公式原值，方便断言 */
function runDummy(heroA: Hero, opts: { duration?: number; seed?: number; randomMode?: CombatConfig['randomMode'] } = {}) {
  const lib = [skillE()];
  const byId = new Map();
  const config = buildCombatConfig({
    mode: 'dummy',
    durationSeconds: opts.duration ?? 3,
    randomMode: opts.randomMode ?? 'expectation',
    seed: opts.seed,
    skills: lib,
    heroA,
    itemsA: [],
    dummy: { infiniteHp: true, maxHp: 1000000, armor: 0, magicResist: 0, damageReduction: 0 },
    skillPriorityA: heroA.skills,
  });
  return runCombat(config, byId);
}

describe('技能E 专项：触发与计算', () => {
  it('测试1+2：携带技能E 的英雄能触发技能，伤害 = baseDamage + 攻击×0.8', () => {
    const heroA = heroWithSkillE(200); // 40 + 200×0.8 = 200 魔法
    const r = runDummy(heroA, { duration: 3 }); // 2s 冷却 → 0s、2s 各一次 = 2 次
    const ra = r.results.find((x) => x.id === 'A')!;
    const row = ra.skills.find((s) => s.name === '技能E')!;
    expect(row.castCount).toBe(2);
    expect(row.damage).toBe(400); // 2 × 200
    expect(ra.damage.skill).toBe(400); // 技能伤害独立入桶（普攻另计物理桶）
    // 战斗日志记录技能释放
    expect(r.events.some((e) => e.eventType === 'skill_cast' && e.skillName === '技能E')).toBe(true);
  });

  it('测试3：提升英雄攻击后，技能E 按 0.8 倍率重新计算', () => {
    const before = runDummy(heroWithSkillE(200), { duration: 3 });
    const bRow = before.results.find((x) => x.id === 'A')!.skills.find((s) => s.name === '技能E')!;
    const after = runDummy(heroWithSkillE(500), { duration: 3 }); // 40 + 500×0.8 = 440
    const aRow = after.results.find((x) => x.id === 'A')!.skills.find((s) => s.name === '技能E')!;
    expect(bRow.damage).toBe(400); // (40+160)×2
    expect(aRow.damage).toBe(880); // (40+400)×2 —— 属性加成随攻击变化重新计算
    expect(aRow.avgDamage).toBe(440);
  });

  it('测试4：固定种子多次模拟，技能E 结果稳定一致', () => {
    const heroA = heroWithSkillE(300);
    const run1 = runDummy(heroA, { duration: 5, randomMode: 'seeded', seed: 7 });
    const run2 = runDummy(heroA, { duration: 5, randomMode: 'seeded', seed: 7 });
    const row1 = run1.results.find((x) => x.id === 'A')!;
    const row2 = run2.results.find((x) => x.id === 'A')!;
    expect(row1).toEqual(row2);
    const s1 = row1.skills.find((s) => s.name === '技能E')!;
    // 5s：0/2/4 三次
    expect(s1.castCount).toBe(3);
    expect(s1.damage).toBe((40 + 300 * 0.8) * 3);
  });
});