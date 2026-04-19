// ============================================================
// FAZA 3/5 BATCH 3/4 (2026-04-20) — Wash Shadow Ring Buffer (singleton)
// Decoupled from route file to avoid Next.js code-split export drift.
// FIFO ring, bounded at WASH_RING_SIZE, survives hot-reloads via globalThis.
// ============================================================
import type { WashShadowEntry } from './types';

export const WASH_RING_SIZE = 50;

const g = globalThis as unknown as { __washShadowRing?: WashShadowEntry[] };
if (!g.__washShadowRing) g.__washShadowRing = [];

export const washShadowRingBuffer: WashShadowEntry[] = g.__washShadowRing;

export function washRingPush(entry: WashShadowEntry): void {
  washShadowRingBuffer.push(entry);
  while (washShadowRingBuffer.length > WASH_RING_SIZE) {
    washShadowRingBuffer.shift();
  }
}

export function washRingSnapshot(): WashShadowEntry[] {
  // Defensive copy — consumers must not mutate the singleton.
  return washShadowRingBuffer.slice();
}
