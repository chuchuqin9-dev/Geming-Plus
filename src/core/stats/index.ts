/**
 * 结果统计分析（基于事件与曲线计算 DPS、峰值、构成、贡献）
 */
import type { CombatResult, CombatantId, CombatantResult } from '../types';

/** 参与伤害的最终事件（finalDamage>0 或治疗），过滤出有效伤害时间序列 */
export interface DmgPoint { tMs: number; dmg: number }

/** 取某作战单位造成的伤害事件点（按时间升序） */
export function damagePoints(result: CombatResult, id: CombatantId): DmgPoint[] {
  const pts: DmgPoint[] = [];
  for (const e of result.events) {
    if (e.sourceId !== id) continue;
    if (e.finalDamage > 0 || e.absorbedByShield > 0) {
      pts.push({ tMs: e.timestampMs, dmg: e.finalDamage + e.absorbedByShield });
    }
  }
  return pts;
}

export interface WindowDps {
  /** 全窗口跨度（毫秒） */
  windowMs: number;
  /** 窗口内累计伤害 */
  windowDamage: number;
  /** 窗口 DPS */
  dps: number;
}

/**
 * 计算覆盖窗口的滑动 DPS（峰值）。
 */
export function peakWindowDps(result: CombatResult, id: CombatantId, windowMs: number): WindowDps {
  const pts = damagePoints(result, id);
  let maxDmg = 0;
  let bestStart = 0;
  const n = pts.length;
  let right = 0;
  let sum = 0;
  for (let left = 0; left < n; left++) {
    while (right < n && pts[right].tMs - pts[left].tMs <= windowMs) {
      sum += pts[right].dmg;
      right++;
    }
    if (sum > maxDmg) { maxDmg = sum; bestStart = pts[left].tMs; }
    sum -= pts[left].dmg;
  }
  void bestStart;
  return { windowMs, windowDamage: maxDmg, dps: windowMs > 0 ? maxDmg / (windowMs / 1000) : 0 };
}

/** 到某时刻为止的累计伤害 → t 秒 DPS */
export function dpsUpTo(result: CombatResult, id: CombatantId, seconds: number): number {
  const tMs = seconds * 1000;
  let total = 0;
  for (const e of result.events) {
    if (e.sourceId !== id) continue;
    if (e.timestampMs > tMs) break;
    if (e.finalDamage > 0 || e.absorbedByShield > 0) total += e.finalDamage + e.absorbedByShield;
  }
  return seconds > 0 ? total / seconds : 0;
}

/** 全程平均 DPS */
export function avgDps(result: CombatResult, id: CombatantId): number {
  const r = result.results.find((x) => x.id === id);
  const total = r?.damage.total ?? 0;
  const sec = Math.max(result.durationMs / 1000, 0.001);
  return total / sec;
}

/** 最大单次伤害 */
export function maxSingleHit(result: CombatResult, id: CombatantId): number {
  let m = 0;
  for (const e of result.events) {
    if (e.sourceId !== id) continue;
    if (e.finalDamage > m) m = e.finalDamage;
  }
  return m;
}

export interface ShareStat {
  label: string;
  value: number;
  percent: number;
}

/** 伤害构成占比（基于 CombatantResult.damage） */
export function damageShare(r: CombatantResult): ShareStat[] {
  const total = r.damage.total || 1;
  const items: Array<[string, number]> = [
    ['普通攻击', r.damage.basicAttack],
    ['技能', r.damage.skill],
    ['装备', r.damage.item],
    ['持续伤害', r.damage.dot],
  ];
  return items
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value, percent: (value / total) * 100 }));
}

export function damageTypeShare(r: CombatantResult): ShareStat[] {
  const total = r.damage.total || 1;
  return [
    { label: '物理', value: r.damage.physical, percent: (r.damage.physical / total) * 100 },
    { label: '魔法', value: r.damage.magic, percent: (r.damage.magic / total) * 100 },
    { label: '真实', value: r.damage.trueDmg, percent: (r.damage.trueDmg / total) * 100 },
  ].filter((x) => x.value > 0);
}