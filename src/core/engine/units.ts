/** 时间单位换算：内部统一用毫秒，配置用秒 */
export function secondsToMs(s: number): number {
  return (s || 0) * 1000;
}

export function msToSeconds(ms: number): number {
  return ms / 1000;
}

/** 毫秒 → 分钟:秒.毫秒（用于日志显示） */
export function formatClock(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  const secInt = Math.floor(s);
  const milli = Math.round((s - secInt) * 1000);
  return `${pad(m)}:${pad(secInt)}.${pad(milli, 3)}`;
}

/** 秒 → 秒格式化（保留若干位） */
export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}