/**
 * 确定性随机数。相同种子 → 完全相同的序列，用于复现战斗。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** mulberry32：返回 [0,1) 的伪随机数 */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [0, n) 的整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}

/** 由字符串/数字派生出稳定种子 */
export function hashSeed(seed: number): number {
  return seed >>> 0;
}

export function createRng(randomMode: 'seeded' | 'expectation', seed?: number): Rng {
  if (randomMode === 'expectation') {
    // 期望模式不抽样，用一个固定序列长度的占位（实际不会消费随机数）
    return new Rng(1);
  }
  return new Rng(hashSeed(seed ?? Date.now()));
}