/**
 * 运行时 Buff / Debuff 管理（见 #162-170，同时服务于#134-136 / #164-170）
 *
 * - 临时 Buff（攻速/减速/禁疗/增伤/易伤/控制免疫/攻速上限突破）只写入
 *   CombatantRuntimeState.buffs，绝不修改 HeroStats / HeroTemplate（见 #176）。
 * - 支持叠层、最大层数、整体刷新（overall）与独立计时（independent）刷新（见 #135-136）。
 * - 区分结束原因（自然结束/移除/驱散/次数耗尽，见 #163），供后续触发不同结束效果。
 */
import {
  type BuffCategory, type BuffEndReason, type BuffInstance, type BuffRefreshMode,
  type BuffType, type CombatantRuntimeState,
} from '../types';
import { uid } from '../defaults';

/** Buff 分组键：按 来源 + 类型（+分类）聚合叠层 */
function buffKey(source: string, type: BuffType, category?: BuffCategory): string {
  return `${source}:${type}:${category || ''}`;
}

export interface ApplyBuffInput {
  source: string;
  buffType: BuffType;
  value: number;
  category?: BuffCategory;
  durationSeconds: number;
  maxStacks: number;
  refreshMode: BuffRefreshMode;
  stackDurationSeconds?: number;
  expiresOnUse?: boolean;
  maxUses?: number;
  controlTypes?: string[];
}

/**
 * 施加一个 Buff。返回 true 表示新增/叠加发生变化。
 * 叠层规则见 #135：已达到最大层数后不再增加，但刷新持续时间（overall）或新增一层（independent）。
 */
export function applyBuff(runtime: CombatantRuntimeState, input: ApplyBuffInput, atMs: number): BuffInstance | null {
  const key = buffKey(input.source, input.buffType, input.category);
  const existing = runtime.buffs.find((b) => buffKey(b.source, b.buffType, b.category) === key);

  if (!existing) {
    const inst: BuffInstance = {
      id: uid('bf'),
      source: input.source,
      owner: 'A',
      buffType: input.buffType,
      value: input.value,
      perStackValue: input.value,
      stacks: 1,
      maxStacks: Math.max(1, input.maxStacks),
      category: input.category,
      controlTypes: input.controlTypes,
      createTime: atMs,
      expireTime: input.durationSeconds > 0 ? atMs + Math.round(input.durationSeconds * 1000) : 0,
      refreshMode: input.refreshMode,
      stackEndTimes: input.refreshMode === 'independent' ? [atMs + Math.round((input.stackDurationSeconds ?? input.durationSeconds) * 1000)] : undefined,
      expiresOnUse: input.expiresOnUse,
      uses: input.maxUses,
    };
    runtime.buffs.push(inst);
    return inst;
  }

  // 已有同源同类型：叠层 / 刷新
  const newStack = existing.stacks < existing.maxStacks;
  if (newStack) existing.stacks += 1;
  existing.value = existing.perStackValue * existing.stacks;

  if (existing.refreshMode === 'independent') {
    // 独立计时：为新增/刷新的这一层单独计时
    const dMs = Math.round((input.stackDurationSeconds ?? input.durationSeconds) * 1000);
    existing.stackEndTimes = existing.stackEndTimes || [];
    if (newStack) existing.stackEndTimes.push(atMs + dMs);
    else existing.stackEndTimes[existing.stackEndTimes.length - 1] = atMs + dMs;
    existing.expireTime = existing.stackEndTimes.length ? Math.max(...existing.stackEndTimes) : atMs + dMs;
  } else {
    // 整体刷新：所有层的结束时间重新计算（见 #136）
    existing.expireTime = input.durationSeconds > 0 ? atMs + Math.round(input.durationSeconds * 1000) : 0;
  }
  return existing;
}

/** 消耗一次可用次数（maxTriggerCount，见 #140）。用尽返回 true（应移除） */
export function consumeUse(buff: BuffInstance): boolean {
  if (buff.uses === undefined || buff.uses === null) return false;
  buff.uses -= 1;
  if (buff.uses <= 0) {
    buff.endReason = 'consumed';
    return true;
  }
  return false;
}

/**
 * 清扫过期 Buff。返回被移除的实例列表（含结束原因）。
 * overall：expireTime 到期整体移除；independent：逐层移除已到期的层。
 */
export function sweepExpired(runtime: CombatantRuntimeState, atMs: number): BuffInstance[] {
  const removed: BuffInstance[] = [];
  runtime.buffs = runtime.buffs.filter((b) => {
    if (b.expireTime > 0 && b.expireTime <= atMs) {
      b.endReason = 'expired';
      removed.push(b);
      return false;
    }
    if (b.refreshMode === 'independent' && b.stackEndTimes && b.stackEndTimes.length) {
      // 移除已到期的层
      b.stackEndTimes = b.stackEndTimes.filter((t) => t > atMs);
      if (b.stackEndTimes.length) {
        b.expireTime = Math.max(...b.stackEndTimes);
        b.stacks = b.stackEndTimes.length;
        b.value = b.perStackValue * b.stacks;
        return true;
      }
      b.endReason = 'expired';
      removed.push(b);
      return false;
    }
    return true;
  });
  return removed;
}

/** 主动移除单个 Buff（指定结束原因） */
export function removeBuff(runtime: CombatantRuntimeState, id: string, reason: BuffEndReason): BuffInstance | null {
  const idx = runtime.buffs.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  const b = runtime.buffs[idx];
  b.endReason = reason;
  runtime.buffs.splice(idx, 1);
  return b;
}

/** 汇总某类型 Buff 的有效百分比（同一分类累加） */
export function buffTotal(runtime: CombatantRuntimeState, type: BuffType, category?: BuffCategory): number {
  let sum = 0;
  for (const b of runtime.buffs) {
    if (b.buffType === type && (category === undefined || b.category === undefined || b.category === category)) {
      sum += b.value;
    }
  }
  return sum;
}

/** 当前某类型的层数（用于 buffStack 条件 / 调试日志） */
export function buffStacks(runtime: CombatantRuntimeState, type: BuffType, category?: BuffCategory): number {
  let n = 0;
  for (const b of runtime.buffs) {
    if (b.buffType === type && (category === undefined || b.category === undefined || b.category === category)) {
      n += b.stacks;
    }
  }
  return n;
}

/** 是否拥有指定控制免疫（未指定类型时表示免疫全部控制，见 #170） */
export function hasControlImmunity(runtime: CombatantRuntimeState, controlType?: string): boolean {
  return runtime.buffs.some(
    (b) => b.buffType === 'control_immune' && (!controlType || !b.controlTypes || !b.controlTypes.length || b.controlTypes.includes(controlType)),
  );
}