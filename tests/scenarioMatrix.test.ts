/**
 * 战斗系统数据交互 场景矩阵回归
 *
 * 一、敌方护甲值在战斗日志中的记录（问题1）：
 *   - physical → details.resist.type='armor'，value = 护甲
 *   - magic    → details.resist.type='magic_resist'，value = 魔抗
 *   - true/raw → details.resist 不设置（无视防御）
 *   - 日志每击同时输出 reductionRate / afterResist / finalDamage
 *
 * 二、技能E 读取普攻原始伤害（问题2）：不同角色状态下
 *   - 暴击：普攻被暴击放大后，rawBasicAttackDamage 读取的是暴击后的原始伤害
 *   - 高护甲：护甲只影响最终结算，不影响被读取的原始伤害（原始伤害是护甲减免前）
 *   - 连续攻击：每次普攻命中都会用「本次」原始伤害更新数据源
 */
import { describe, it, expect } from 'vitest';
import type { Hero, HeroStats, Skill } from '../src/core/types';
import { emptyStats } from '../src/core/types';
import { runCombat } from '../src/core/engine/combatEngine';
import { buildCombatConfig } from '../src/core/combatConfig';
import { uid } from '../src/core/defaults';

function hero(o: Partial<HeroStats> = {}): Hero {
  return {
    id: uid('h'), name: '英雄A', type: 'melee',
    baseStats: { ...emptyStats(), maxHp: 5000, currentHp: 5000, attack: 100, armor: 30, magicResist: 30, ...o },
    skills: [], defaultItems: [],
  };
}

/** 被动「技能E」：普攻命中触发，真实伤害 = 100% × 最近一次普攻原始伤害 */
function skillERaw(): Skill {
  return {
    id: uid('s'), name: '技能E', type: 'passive',
    passive: { trigger: { kind: 'on_basic_attack_hit' }, procCooldownSeconds: 0, priority: 0 },
    segments: [{ kind: 'damage', delaySeconds: 0, baseDamage: 0, scaling: [{ stat: 'rawBasicAttackDamage', ratio: 1 }], damageType: 'true', canCrit: false, critFamily: 'physical', canLifesteal: false, canTriggerItems: true, sourceKind: 'skill', isSkillBoost: true, useMagicDamageBoost: true }],
  };
}

function seg(damageType: 'physical' | 'magic' | 'true', base: number, dummyArmor: number, dummyMr: number) {
  const skill: Skill = {
    id: uid('s'), name: `SK_${damageType}`, type: 'active',
    active: { cooldownSeconds: 100, priority: 1, manaCost: 0 },
    segments: [{ kind: 'damage', delaySeconds: 0, baseDamage: base, scaling: [], damageType, canCrit: false, critFamily: damageType === 'magic' ? 'magic' : 'physical', canLifesteal: true, canTriggerItems: true, sourceKind: 'skill', isSkillBoost: true, useMagicDamageBoost: true }],
  };
  const h = hero({ attack: 0 });
  h.skills = [skill.id];
  const cfg = buildCombatConfig({
    mode: 'dummy', durationSeconds: 1, randomMode: 'expectation',
    skills: [skill], heroA: h, itemsA: [],
    dummy: { infiniteHp: true, maxHp: 1000000, armor: dummyArmor, magicResist: dummyMr, damageReduction: 0 },
    skillPriorityA: h.skills,
  });
  return { run: () => runCombat(cfg, new Map()) };
}

describe('问题1：战斗日志敌方护甲/魔抗记录', () => {
  it('物理伤害 → 日志记录 armor 护甲值', () => {
    const e = seg('physical', 100, 300, 0).run().events.find((x) => x.eventType === 'damage' && x.damageType === 'physical')!;
    expect(e.details?.resist).toEqual({ type: 'armor', value: 300 });
    expect(e.details?.reductionRate).toBeCloseTo((300 * 0.06) / (1 + 300 * 0.06), 6);
    expect(e.details?.afterResist).toBeDefined();
  });

  it('魔法伤害 → 日志记录 magic_resist 魔抗值', () => {
    const e = seg('magic', 100, 0, 200).run().events.find((x) => x.eventType === 'damage' && x.damageType === 'magic')!;
    expect(e.details?.resist).toEqual({ type: 'magic_resist', value: 200 });
  });

  it('真实伤害 → 不记录 resist（无视防御）', () => {
    const e = seg('true', 100, 500, 500).run().events.find((x) => x.eventType === 'damage' && x.damageType === 'true')!;
    expect(e.details?.resist).toBeUndefined();
    expect(e.finalDamage).toBe(100);
  });
});

describe('问题2：技能E 读取普攻原始伤害 — 不同角色状态', () => {
  function runERaw(heroO: Partial<HeroStats>, dummyArmor: number) {
    const lib = [skillERaw()];
    const h = hero(heroO);
    h.skills = lib.map((s) => s.id);
    const cfg = buildCombatConfig({
      mode: 'dummy', durationSeconds: 2, randomMode: 'expectation',
      skills: lib, heroA: h, itemsA: [],
      dummy: { infiniteHp: true, maxHp: 1000000, armor: dummyArmor, magicResist: 0, damageReduction: 0 },
      skillPriorityA: h.skills,
    });
    return runCombat(cfg, new Map());
  }

  it('暴击状态下：读取的是暴击放大后的普攻原始伤害', () => {
    const r = runERaw({ attack: 100, physicalCritRate: 100, physicalCritDamage: 200 }, 300);
    const a = r.results.find((x) => x.id === 'A')!;
    const e = a.skills.find((s) => s.name === '技能E')!;
    // 每次普攻暴击原始伤害 = 100×2 = 200 → 技能E 每次 = 200
    expect(a.damage.basicAttackCount).toBe(3);
    expect(e.damage / e.castCount).toBeCloseTo(200, 4);
  });

  it('高护甲状态下：技能E 读取的仍是护甲减免前的原始伤害', () => {
    const r = runERaw({ attack: 100 }, 5000);
    const a = r.results.find((x) => x.id === 'A')!;
    const e = a.skills.find((s) => s.name === '技能E')!;
    // 技能E 为真实伤害无视防御 → 每击 = 原始伤害 100（不受 5000 护甲影响）
    expect(e.damage / e.castCount).toBeCloseTo(100, 4);
    // 普攻本身被 5000 护甲大量减免（远低于 100/击）
    expect(a.damage.basicAttack).toBeLessThan(a.damage.basicAttackCount * 10);
  });

  it('连续攻击：每次普攻命中都以「本次」原始伤害更新数据源', () => {
    const r = runERaw({ attack: 100 }, 0);
    const a = r.results.find((x) => x.id === 'A')!;
    const e = a.skills.find((s) => s.name === '技能E')!;
    expect(a.damage.basicAttackCount).toBe(e.castCount); // 每次普攻命中触发一次
    expect(e.damage).toBeCloseTo(a.damage.basicAttackCount * 100, 4);
  });
});