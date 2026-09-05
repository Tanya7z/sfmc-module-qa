/**
 * 加权随机抽题 + 最近 N 题防重队列。
 */

import { RECENT_QUEUE_CAPACITY } from "./types.js";

export type Rng = () => number;

/** 默认 RNG：半开区间 [0, 1) */
export const defaultRng: Rng = () => Math.random();

/**
 * 维护固定容量的最近题目索引环形队列（默认 5）。
 */
export class RecentQueue {
  private readonly buf: number[] = [];
  private readonly capacity: number;

  constructor(capacity = RECENT_QUEUE_CAPACITY) {
    this.capacity = Math.max(0, capacity);
  }

  has(index: number): boolean {
    return this.buf.includes(index);
  }

  push(index: number): void {
    if (this.capacity <= 0) return;
    if (this.buf.includes(index)) {
      // 已在队列中则挪到队尾
      this.buf.splice(this.buf.indexOf(index), 1);
    }
    this.buf.push(index);
    while (this.buf.length > this.capacity) this.buf.shift();
  }

  clear(): void {
    this.buf.length = 0;
  }

  toArray(): number[] {
    return [...this.buf];
  }

  get size(): number {
    return this.buf.length;
  }
}

/**
 * 从权重列表中按权重抽取一个下标。
 * 排除 `exclude` 中的下标；若排除后池为空则退回全量池。
 * 全量权重合计 ≤ 0 时返回 undefined。
 */
export function pickWeightedIndex(
  weights: number[],
  exclude: ReadonlySet<number> | readonly number[],
  rng: Rng = defaultRng,
): number | undefined {
  if (weights.length === 0) return undefined;
  const excluded = exclude instanceof Set ? exclude : new Set(exclude);

  const tryPick = (useExclude: boolean): number | undefined => {
    let total = 0;
    const pool: number[] = [];
    const ends: number[] = [];
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i]!;
      if (!(w > 0)) continue;
      if (useExclude && excluded.has(i)) continue;
      total += w;
      pool.push(i);
      ends.push(total);
    }
    if (pool.length === 0 || total <= 0) return undefined;
    const r = rng() * total;
    for (let i = 0; i < ends.length; i++) {
      if (r < ends[i]!) return pool[i]!;
    }
    return pool[pool.length - 1];
  };

  // 至少保留一道可选：题目数很少时缩减排除集意义已由「先排除再回退」覆盖
  return tryPick(excluded.size > 0) ?? tryPick(false);
}

/**
 * 在 [minSec, maxSec] 秒区间内取随机间隔（含端点），返回 tick 数（×20）。
 */
export function nextIntervalTicks(
  minSec: number,
  maxSec: number,
  rng: Rng = defaultRng,
): number {
  const lo = Math.max(1, Math.floor(minSec));
  const hi = Math.max(lo, Math.floor(maxSec));
  const sec = lo + Math.floor(rng() * (hi - lo + 1));
  return sec * 20;
}
