/**
 * 端到端战斗链路演示（可复现的验证输出）
 *
 * 运行同前端一致的代码路径：buildCombatConfig + runCombat。
 * 场景：英雄A（attack=100，携带「技能E」：物理 50 + 80%攻击）打木桩，
 *       分别测试木桩护甲 0 与 300，打印可读战斗日志，验证：
 *        原始伤害 → 技能/普攻 → 护甲减伤 → 最终伤害 → 扣血
 *       以及「普通攻击次数」。每次运行输出一行，便于人工核对。
 */
import { describe, it, expect } from 'vitest';
import type { CombatConfig, Hero, HeroStats, Skill } from '../src/core/types';
import { emptyStats } from '../src/core/types';
import { runCombat } from '../src/core/engine/combatEngine';
import { buildCombatConfig } from '../src/core/combatConfig';
import { uid } from '../src/core/defaults';

const skillE: Skill = {
  id: 'skill_e_demo', name: '技能E', type: 'active',
  active: { cooldownSeconds: 2, priority: 0, manaCost: 0 },
  segments: [{
    kind: 'damage', delaySeconds: 0, baseDamage: 50,
    scaling: [{ stat: 'attack', ratio: 0.8 }],
    damageType: 'physical', canCrit: false, critFamily: 'physical',
    canLifesteal: true, canTriggerItems: true, sourceKind: 'skill',
    isSkillBoost: true, useMagicDamageBoost: true,
  }],
};

function hero(): Hero {
  return {
    id: uid('h'), name: '英雄A', type: 'melee',
    baseStats: { ...emptyStats(), attack: 100, maxHp: 5000, currentHp: 5000, armor: 30, magicResist: 30 },
    skills: [skillE.id], defaultItems: [],
  };
}

function run(armor: number): CombatConfig {
  return buildCombatConfig({
    mode: 'dummy', durationSeconds: 5, randomMode: 'expectation',
    skills: [skillE], heroA: hero(), itemsA: [],
    dummy: { infiniteHp: true, maxHp: 1000000, armor, magicResist: 0, damageReduction: 0 },
    skillPriorityA: ['skill_e_demo'],
  });
}

describe('战斗链路端到端演示', () => {
  it('0 护甲：普攻=100/次、技能E=50+80%×100=130，技能贡献区显示普通攻击次数', () => {
    const r = runCombat(run(0), new Map());
    const a = r.results.find((x) => x.id === 'A')!;
    const e = a.skills.find((s) => s.name === '技能E')!;
    const hits = r.events.filter((ev) => ev.eventType === 'attack' && ev.sourceId === 'A').length;
    // eslint-disable-next-line no-console
    console.log(`\n第1场景（木桩护甲=0）: 普攻次数屏显=basicAttackCount(${a.damage.basicAttackCount}) | 攻击事件数(${hits}) | 普攻总伤=${a.damage.basicAttack} | 技能E 释放=${e.castCount} 总伤=${e.damage}\n`);
    expect(a.damage.basicAttackCount).toBe(hits);
    expect(hits).toBe(6);               // 5s 攻速100%→0,1,2,3,4,5 共6次
    expect(a.damage.basicAttack).toBeCloseTo(600, 4);
    expect(e.damage).toBeCloseTo(130 * e.castCount, 4);
  });

  it('300 护甲：减伤率 94.74%，普攻100→每击5.26；技能E 130→每击6.84', () => {
    const rate = (300 * 0.06) / (1 + 300 * 0.06);
    const r = runCombat(run(300), new Map());
    const a = r.results.find((x) => x.id === 'A')!;
    const e = a.skills.find((s) => s.name === '技能E')!;
    // eslint-disable-next-line no-console
    console.log(`\n第2场景（木桩护甲=300）: 减伤率=${(rate * 100).toFixed(2)}% | 每次普攻=${(a.damage.basicAttack / a.damage.basicAttackCount).toFixed(2)} | 技能E 每击=${(e.damage / e.castCount).toFixed(2)} | 普攻总伤=${a.damage.basicAttack} | 技能E总伤=${e.damage}\n`);
    expect(a.damage.basicAttack / a.damage.basicAttackCount).toBeCloseTo(100 * (1 - rate), 2);
    expect(e.damage / e.castCount).toBeCloseTo(130 * (1 - rate), 2);
  });
});