/** 默认数据工厂：新建空模板时采用，保证字段不为空、不崩 */
import {
  type CombatConfig, type DummyConfig, type Equipment, type EquipmentEffect,
  type Hero, type HeroStats, type Skill, emptyStats,
} from './types';

export function uid(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${r}` : r;
}

export function newHero(): Hero {
  return {
    id: uid('hero'),
    name: '新英雄',
    type: 'melee',
    baseStats: emptyStats(),
    skills: [],
    defaultItems: [],
  };
}

export function newEquipment(): Equipment {
  return {
    id: uid('eq'),
    name: '新装备',
    favorite: false,
    tags: [],
    stats: {},
    effects: [],
  };
}

/** 一段标准伤害片段（用于新技能/效果） */
export function damageSegmentFactory(baseDamage: number, damageType: 'physical' | 'magic' | 'true') {
  return {
    kind: 'damage' as const,
    delaySeconds: 0,
    baseDamage,
    scaling: [],
    damageType,
    canCrit: false,
    critFamily: 'physical' as const,
    canLifesteal: true,
    canTriggerItems: true,
    sourceKind: 'skill' as const,
    isSkillBoost: true,
    useMagicDamageBoost: true,
    useAllVamp: true,
  };
}

export function newSkill(): Skill {
  return {
    id: uid('skill'),
    name: '新技能',
    type: 'active',
    active: { cooldownSeconds: 5, priority: 1, manaCost: 0 },
    segments: [damageSegmentFactory(80, 'magic')],
  };
}

export function newEquipmentEffect(): EquipmentEffect {
  return {
    id: uid('eff'),
    name: '触发效果',
    trigger: { kind: 'on_basic_attack_hit' },
    limit: { type: 'cooldown', seconds: 3 },
    segments: [damageSegmentFactory(70, 'physical')],
  };
}

export function newDummy(config?: Partial<DummyConfig>): DummyConfig {
  return {
    infiniteHp: true,
    maxHp: 10000,
    armor: 30,
    magicResist: 30,
    damageReduction: 0,
    ...config,
  };
}

/** 初始化一份可用的 CombatConfig */
export function newCombatConfig(partial?: Partial<CombatConfig>): CombatConfig {
  return {
    schemaVersion: 1,
    mode: 'dummy',
    durationSeconds: 30,
    randomMode: 'seeded',
    seed: 12345,
    trueDamageIgnoresReduction: true,
    combos: [],
    dummy: newDummy(),
    skillPriority: {},
    ...partial,
  };
}