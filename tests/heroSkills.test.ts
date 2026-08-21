import { describe, it, expect } from 'vitest';
import type { Hero, Skill } from '../src/core/types';
import {
  describeSkillSegments,
  isEmbeddedSkillField,
  migrateHeroSkillRefs,
  normalizeHeroSkillIds,
  resolveHeroSkills,
} from '../src/core/heroSkills';
import { uid } from '../src/core/defaults';

function skill(id: string, type: 'active' | 'passive' = 'active'): Skill {
  return {
    id,
    name: id,
    type,
    active: type === 'active' ? { cooldownSeconds: 5, priority: 1, manaCost: 0 } : undefined,
    passive: type === 'passive' ? { trigger: { kind: 'on_combat_start' }, procCooldownSeconds: 0 } : undefined,
    segments: [{ kind: 'damage', delaySeconds: 0, baseDamage: 100, scaling: [], damageType: 'physical', canCrit: false, critFamily: 'physical', canLifesteal: true, canTriggerItems: true, sourceKind: 'skill', isSkillBoost: true, useMagicDamageBoost: true }],
  };
}

function hero(id: string, skills: string[]): Hero {
  return { id, name: id, type: 'melee', baseStats: { currentHp: 1 } as Hero['baseStats'], skills, defaultItems: [], talents: [] };
}

describe('英雄技能引用模型（skillId 关联技能库）', () => {
  it('resolveHeroSkills 按 id 解析并保持顺序，跳过被删除的引用', () => {
    const library = [skill('a'), skill('b'), skill('c')];
    const h = hero('h', ['c', 'a', 'ghost']); // ghost 不存在于技能库
    const resolved = resolveHeroSkills(h, library);
    expect(resolved.map((s) => s.id)).toEqual(['c', 'a']);
  });

  it('normalizeHeroSkillIds 只保留技能库真实存在的 id', () => {
    const library = [skill('a'), skill('b')];
    const h = hero('h', ['a', 'ghost', 'b']);
    expect(normalizeHeroSkillIds(h, library)).toEqual(['a', 'b']);
  });

  it('migrateHeroSkillRefs：旧版内嵌对象格式 → 并入技能库并转为 id 引用', () => {
    const embedded = skill('old-1');
    const oldHero = { ...hero('h', []), skills: [embedded] as unknown as string[] };
    const { heroes, library } = migrateHeroSkillRefs([oldHero], []);
    expect(isEmbeddedSkillField(oldHero.skills)).toBe(true);
    expect(heroes[0].skills).toEqual(['old-1']); // 转为 id 引用
    expect(library.map((s) => s.id)).toContain('old-1'); // 定义并入技能库
  });

  it('migrateHeroSkillRefs：已存在的同名 id 以技能库定义为准，避免重复', () => {
    const defined = skill('old-1'); // 技能库已有
    const oldHero = { ...hero('h', []), skills: [{ ...defined, name: '不同名' }] as unknown as string[] };
    const { heroes, library } = migrateHeroSkillRefs([oldHero], [defined]);
    expect(library).toHaveLength(1); // 未重复加入
    expect(heroes[0].skills).toEqual(['old-1']);
    expect(library[0].name).toBe('old-1'); // 以技能库定义为准
  });

  it('migrateHeroSkillRefs：已为 id 数组时保留顺序并剔除失效引用', () => {
    const library = [skill('a'), skill('b')];
    const h = hero('h', ['b', 'ghost', 'a']);
    const { heroes } = migrateHeroSkillRefs([h], library);
    expect(heroes[0].skills).toEqual(['b', 'a']);
  });

  it('describeSkillSegments 生成可读摘要', () => {
    expect(describeSkillSegments(skill('s').segments)).toContain('物理伤害');
    expect(describeSkillSegments([{ kind: 'heal', delaySeconds: 0, basePower: 120, scaling: [] }])).toContain('治疗 120');
    expect(describeSkillSegments(undefined)).toBe('无效果');
  });
});