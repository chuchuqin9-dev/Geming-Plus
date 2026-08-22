/**
 * 原始伤害来源分类 + 普攻次数统计 专项回归。
 *
 * 覆盖用户报告场景：
 *  1) 技能E 通过「原始伤害 → 普通攻击」读取英雄最近一次普攻的原始伤害；
 *  2) 普通攻击次数统计与战斗日志攻击次数一致；
 *  3) 敌方护甲正确参与伤害（vs 模式回归锁定）。
 */
import { describe, it, expect } from 'vitest';
import type { CombatConfig, Hero, HeroStats, Skill, Talent } from '../src/core/types';
import { emptyStats } from '../src/core/types';
import { runCombat } from '../src/core/engine/combatEngine';
import { buildCombatConfig } from '../src/core/combatConfig';
import { uid } from '../src/core/defaults';

function hero(name: string, o: Partial<HeroStats> = {}): Hero {
  return {
    id: uid('h'), name, type: 'melee',
    baseStats: { ...emptyStats(), maxHp: 100000, currentHp: 100000, attack: 100, armor: 30, magicResist: 30, ...o },
    skills: [], defaultItems: [],
  };
}

/** 构造「技能E」：被动，普攻命中时触发，伤害 = 100% × 最近一次普攻原始伤害（真实伤害，便于断言） */
function skillErawFromBasicAttack(): Skill {
  return {
    id: uid('s'),
    name: '技能E',
    type: 'passive',
    passive: { trigger: { kind: 'on_basic_attack_hit' }, procCooldownSeconds: 0, priority: 0 },
    segments: [{
      kind: 'damage', delaySeconds: 0, baseDamage: 0,
      scaling: [{ stat: 'rawBasicAttackDamage', ratio: 1 }],
      damageType: 'true', canCrit: false, critFamily: 'physical', canLifesteal: false,
      canTriggerItems: false, sourceKind: 'skill', isSkillBoost: true, useMagicDamageBoost: true,
    }],
  };
}

function runDummy(h: Hero, skills: Skill[]): CombatConfig {
  const config = buildCombatConfig({
    mode: 'dummy', durationSeconds: 3, randomMode: 'expectation',
    skills,
    heroA: h, itemsA: [],
    dummy: { infiniteHp: true, maxHp: 1000000, armor: 0, magicResist: 0, damageReduction: 0 },
    skillPriorityA: h.skills,
  });
  return config;
}

describe('原始伤害来源分类：原始伤害 → 普通攻击', () => {
  it('技能E 被动（普攻命中触发）读取最近一次普攻原始伤害：4 次普攻 → 4×100 真伤', () => {
    const lib = [skillErawFromBasicAttack()];
    const h = hero('A', { attack: 100 });
    h.skills = lib.map((s) => s.id);
    const cfg = runDummy(h, lib);
    const result = runCombat(cfg, new Map());
    const ra = result.results.find((x) => x.id === 'A')!;
    expect(ra.damage.basicAttack).toBe(400);       // 4 次普攻 × 100
    expect(ra.damage.basicAttackCount).toBe(4);    // 普通攻击次数统计
    const skillRow = ra.skills.find((s) => s.name === '技能E')!;
    expect(skillRow.castCount).toBe(4);            // 每次普攻命中各触发一次
    expect(skillRow.damage).toBe(400);             // 每次 = 100% × 普攻原始伤害 100
  });

  it('普通攻击次数 = 战斗日志 attack 事件数量', () => {
    const lib = [skillErawFromBasicAttack()];
    const h = hero('A', { attack: 50 });
    h.skills = lib.map((s) => s.id);
    const result = runCombat(runDummy(h, lib), new Map());
    const ra = result.results.find((x) => x.id === 'A')!;
    const attackEvents = result.events.filter((e) => e.eventType === 'attack' && e.sourceId === 'A').length;
    expect(ra.damage.basicAttackCount).toBe(attackEvents);
    expect(attackEvents).toBe(4);
  });
});

describe('原始伤害来源分类：原始伤害 → 技能伤害', () => {
  it('技能触发后读取最近一次技能造成的原始伤害', () => {
    // 被动E2：技能命中触发，伤害 = 100% × 最近一次技能造成的原始伤害
    const e2Skill: Skill = {
      id: uid('s'), name: '技能E2', type: 'passive',
      passive: { trigger: { kind: 'on_skill_hit' }, procCooldownSeconds: 0, priority: 0 },
      segments: [{ kind: 'damage', delaySeconds: 0, baseDamage: 0, scaling: [{ stat: 'rawSkillDamage', ratio: 1 }], damageType: 'true', canCrit: false, critFamily: 'physical', canLifesteal: false, canTriggerItems: true, sourceKind: 'skill', isSkillBoost: true, useMagicDamageBoost: true }],
    };
    const lib: Skill[] = [
      e2Skill,
      {
        id: uid('s'), name: '主伤害', type: 'active', active: { cooldownSeconds: 100, priority: 1, manaCost: 0 },
        segments: [{ kind: 'damage', delaySeconds: 0, baseDamage: 200, scaling: [], damageType: 'true', canCrit: false, critFamily: 'physical', canLifesteal: false, canTriggerItems: true, sourceKind: 'skill', isSkillBoost: true, useMagicDamageBoost: true }],
      },
    ];
    const h = hero('B', { attack: 0 });
    h.skills = lib.map((s) => s.id);
    const result = runCombat(runDummy(h, lib), new Map());
    const ra = result.results.find((x) => x.id === 'A')!;
    // 「主伤害」200 触发「技能E2」→ 200×100% = 200
    expect(ra.damage.skill).toBe(400); // 200(主) + 200(E2)
    const e2 = ra.skills.find((s) => s.name === '技能E2')!;
    expect(e2.damage).toBe(200);
  });
});

describe('敌方护甲（vs 模式）回归锁定', () => {
  it('英雄A 普攻对敌方护甲 0 / 300 按统一减伤公式受减伤', () => {
    const run = (enemyArmor: number) => {
      const a = hero('A');
      const b = hero('B', { attack: 0, armor: enemyArmor, maxHp: 500000, currentHp: 500000 });
      const cfg = buildCombatConfig({
        mode: 'vs', durationSeconds: 2, randomMode: 'expectation',
        heroA: a, itemsA: [], heroB: b, itemsB: [],
        dummy: { infiniteHp: true, maxHp: 1000000, armor: 0, magicResist: 0, damageReduction: 0 },
      });
      return runCombat(cfg, new Map());
    };
    const rate = (r: number) => (r * 0.06) / (1 + r * 0.06);
    const r0 = run(0).results.find((x) => x.id === 'A')!;
    const r300 = run(300).results.find((x) => x.id === 'A')!;
    expect(r0.damage.total).toBe(3 * 100); // 0 护甲不减免
    expect(r300.damage.total).toBeCloseTo(3 * 100 * (1 - rate(300)), 1); // 300 护甲减免
    expect(r300.damage.total).toBeLessThan(r0.damage.total);
  });
});