/**
 * 战斗实体构建与属性合并（纯函数，不依赖 DOM）
 */
import {
  type CombatantConfig, type CombatConfig, type CombatantId,
  type Equipment, type Hero, type HeroStats, type RuntimeCombatant, type Talent,
  emptyStats,
} from '../types';

/** 合并装备后的完整属性 */
export function mergeStats(base: HeroStats, items: Equipment[]): HeroStats {
  const out = emptyStats();
  const keys = Object.keys(out) as Array<keyof HeroStats>;
  for (const k of keys) {
    let v = typeof base[k] === 'number' ? (base[k] as unknown as number) : 0;
    for (const it of items) {
      const add = it.stats[k];
      if (typeof add === 'number') v += add;
    }
    (out[k] as unknown as number) = v;
  }
  // 命中值/最大生命保持一致；初始当前生命沿用基础值（若给定），否则满血
  out.currentHp = (Number.isFinite(base.currentHp) && base.currentHp > 0)
    ? Math.min(base.currentHp, out.maxHp)
    : out.maxHp;
  return out;
}

/** 合并天赋属性加成（属性型天赋 statBonus） */
export function applyTalentBuffs(stats: HeroStats, talents: Talent[]): void {
  for (const t of talents || []) {
    if (!t.statBonus) continue;
    for (const k of Object.keys(t.statBonus) as Array<keyof HeroStats>) {
      const v = t.statBonus[k];
      if (typeof v === 'number') {
        stats[k] = stats[k] + v;
      }
    }
  }
}

/** 由 CombatantConfig + 装备库构建运行时战斗实体（英雄） */
export function buildHeroCombatant(
  id: CombatantId,
  label: string,
  cfg: CombatantConfig,
  equipmentById: Map<string, Equipment>,
): RuntimeCombatant {
  const items: Equipment[] = [];
  for (const itemId of cfg.itemIds) {
    const it = equipmentById.get(itemId);
    if (it) items.push(it);
  }
  const stats = mergeStats(cfg.hero.baseStats, items);
  const baseAttack = cfg.hero.baseStats.attack || 0;
  stats.extraAttack = stats.attack - baseAttack;
  applyTalentBuffs(stats, cfg.talents || []);
  // 天赋可能加成生命上限，同步满血
  stats.maxHp = Math.max(1, stats.maxHp);
  // 尊重初始当前生命（若未显式给出则满血）
  const baseHp = cfg.hero.baseStats.currentHp;
  const initialHp = Number.isFinite(baseHp)
    ? Math.min(Math.max(0, baseHp), stats.maxHp)
    : stats.maxHp;
  stats.currentHp = initialHp > 0 ? initialHp : stats.maxHp;
  return {
    id, label,
    isDummy: false, isHero: true,
    stats,
    maxHp: stats.maxHp,
    hp: stats.currentHp,
    alive: hpAlive(stats.currentHp),
    shields: [],
  };
}

/** 构建木桩实体 */
export function buildDummyCombatant(
  cfg: CombatConfig,
  equipmentById: Map<string, Equipment>,
): RuntimeCombatant {
  const stats = emptyStats();
  stats.maxHp = cfg.dummy.maxHp;
  stats.armor = cfg.dummy.armor;
  stats.magicResist = cfg.dummy.magicResist;
  stats.damageReduction = cfg.dummy.damageReduction;
  stats.currentHp = stats.maxHp;
  const c: RuntimeCombatant = {
    id: 'dummy', label: '木桩',
    isDummy: true, isHero: false,
    stats, maxHp: stats.maxHp, hp: stats.maxHp, alive: true, shields: [],
  };
  return applyEquipmentProcsAtStart(c, equipmentById);
}

function applyEquipmentProcsAtStart(
  c: RuntimeCombatant,
  equipmentById: Map<string, Equipment>,
): RuntimeCombatant {
  // 木桩无主动装备，仅保留扩展点
  void equipmentById;
  return c;
}

export function hpAlive(hp: number): boolean {
  return hp > 0;
}

export function clampHp(v: number): number {
  return Math.max(0, v);
}