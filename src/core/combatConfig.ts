/**
 * CombatConfig 构建与校验（纯函数）。UI 与引擎之间通过它衔接。
 */
import {
  type CombatConfig, type CombatantConfig, type DummyConfig, type Hero,
  type RandomMode, type SimMode, type Talent,
  MAX_EQUIPMENT,
} from './types';
import { newDummy } from './defaults';

export interface BuildOptions {
  mode: SimMode;
  durationSeconds: number;
  randomMode: RandomMode;
  seed?: number;
  trueDamageIgnoresReduction?: boolean;
  /** 真实伤害是否可被全类型护盾吸收 */
  trueDamageAffectsShield?: boolean;
  heroA: Hero;
  itemsA: string[];
  talentsA?: Talent[];
  labelA?: string;
  heroB?: Hero;
  itemsB?: string[];
  talentsB?: Talent[];
  labelB?: string;
  dummy?: DummyConfig;
  skillPriorityA?: string[];
  skillPriorityB?: string[];
}

export function buildCombatConfig(opts: BuildOptions): CombatConfig {
  const combos: CombatantConfig[] = [];
  combos.push({
    label: opts.labelA || opts.heroA.name, hero: opts.heroA,
    itemIds: opts.itemsA.slice(0, MAX_EQUIPMENT), talents: opts.talentsA || [],
  });
  if (opts.mode === 'vs' && opts.heroB) {
    combos.push({
      label: opts.labelB || opts.heroB.name, hero: opts.heroB,
      itemIds: (opts.itemsB || []).slice(0, MAX_EQUIPMENT), talents: opts.talentsB || [],
    });
  }
  const skillPriority: Record<string, string[]> = {};
  if (opts.skillPriorityA) skillPriority['A'] = opts.skillPriorityA;
  if (opts.skillPriorityB) skillPriority['B'] = opts.skillPriorityB;

  const config: CombatConfig = {
    schemaVersion: 2,
    mode: opts.mode,
    durationSeconds: Math.max(0.1, opts.durationSeconds),
    randomMode: opts.randomMode,
    seed: opts.seed,
    trueDamageIgnoresReduction: opts.trueDamageIgnoresReduction ?? true,
    trueDamageAffectsShield: opts.trueDamageAffectsShield ?? false,
    combos,
    dummy: opts.dummy || newDummy(),
    skillPriority,
  };
  return config;
}

export interface ConfigError { path: string; message: string }

/** 校验配置，返回错误列表（不会抛异常） */
export function validateConfig(config: CombatConfig, equipmentNames: Record<string, string>): ConfigError[] {
  const errors: ConfigError[] = [];
  if (config.combos.length === 0) {
    errors.push({ path: 'combos', message: '请至少配置一个英雄' });
    return errors;
  }
  config.combos.forEach((c, i) => {
    const tag = config.mode === 'vs' ? (i === 0 ? '英雄A' : '英雄B') : `英雄${i + 1}`;
    if (!c.hero.name.trim()) errors.push({ path: 'name', message: `${tag}名称为空` });
    const s = c.hero.baseStats;
    if (s.maxHp <= 0) errors.push({ path: 'maxHp', message: `${tag} 生命值必须 > 0` });
    if (s.attackInterval <= 0) errors.push({ path: 'attackInterval', message: `${tag} 攻击间隔必须 > 0` });
    if (c.itemIds.length > 9) errors.push({ path: 'items', message: `${tag} 最多携带 9 件装备` });
    for (const id of c.itemIds) {
      if (!(id in equipmentNames)) errors.push({ path: 'items', message: `${tag} 引用了不存在的装备 ${id}` });
    }
  });
  if (config.mode === 'dummy' && config.dummy.maxHp <= 0) {
    errors.push({ path: 'dummy.maxHp', message: '木桩血量必须 > 0' });
  }
  return errors;
}