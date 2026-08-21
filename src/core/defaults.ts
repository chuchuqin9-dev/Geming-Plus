/** 默认数据工厂：新建空模板时采用，保证字段不为空、不崩 */
import {
  type CombatConfig, type DummyConfig, type Equipment, type EquipmentEffect,
  type Hero, type HeroStats, type Skill, type Talent, type TalentBook, emptyStats,
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
    talents: [],
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

/** 新建天赋模板 */
export function newTalent(): Talent {
  return {
    id: uid('talent'),
    name: '新天赋',
    description: '',
    icon: '',
    type: 'attribute',
    heroId: null,
    statBonus: { attack: 20 },
    effects: [],
  };
}

/** 新建天赋页（方案） */
export function newTalentBook(): TalentBook {
  return {
    id: uid('tb'),
    name: '新天赋页',
    description: '',
    talentIds: [],
  };
}

/** 一段标准护盾片段（含类型/刷新/优先级） */
export function shieldSegmentFactory(basePower: number, durationSeconds = 0): import('./types').ShieldSegment {
  return {
    kind: 'shield',
    delaySeconds: 0,
    basePower,
    scaling: [],
    durationSeconds,
    shieldType: 'all',
    refresh: 'overwrite',
    priority: 0,
  };
}

/** 一段标准冷却减少片段 */
export function cooldownReduceSegmentFactory(seconds = 1, target: import('./types').CooldownTarget = 'ALL_SKILLS'): import('./types').CooldownReduceSegment {
  return {
    kind: 'cooldown_reduce',
    delaySeconds: 0,
    target,
    seconds,
    allowOvershoot: false,
  };
}

/** 初始化一份可用的 CombatConfig */
export function newCombatConfig(partial?: Partial<CombatConfig>): CombatConfig {
  return {
    schemaVersion: 2,
    mode: 'dummy',
    durationSeconds: 30,
    randomMode: 'seeded',
    seed: 12345,
    trueDamageIgnoresReduction: true,
    trueDamageAffectsShield: false,
    combos: [],
    dummy: newDummy(),
    skillPriority: {},
    ...partial,
  };
}