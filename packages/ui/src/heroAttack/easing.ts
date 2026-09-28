/**
 * The easing and small geometry every hero attack shares (moved out of the Blast, 2026-09-28, when Quake joined it).
 * Pure, allocation-light, safe on NaN (a bad input clamps to 0).
 */
export type Pt = { x: number; y: number };

export const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - clamp01(t), 5);
export const easeInOutSine = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
/** Back-out: overshoot, then settle. */
export const easeOutBack = (t: number, k = 2.2): number => { const x = clamp01(t) - 1; return 1 + (k + 1) * x * x * x + k * x * x; };
/** Back-in: a small pull away first (anticipation), then commit. */
export const easeInBack = (t: number, k = 1.6): number => { const x = clamp01(t); return (k + 1) * x * x * x - k * x * x; };
/** A damped spring from 1 to 0: rings `hz` times a second and dies with time constant `tau` ms. */
export const spring = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/** The quadratic arc a number flies on: bowed sideways by `arc` x the distance. */
export function arcPoint(a: Pt, b: Pt, arc: number, t: number): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const c = { x: (a.x + b.x) / 2 + (-dy / d) * arc * d, y: (a.y + b.y) / 2 + (dx / d) * arc * d };
  const m = 1 - t;
  return { x: m * m * a.x + 2 * m * t * c.x + t * t * b.x, y: m * m * a.y + 2 * m * t * c.y + t * t * b.y };
}

/** Blend 0xRRGGBB toward white by `t`. */
export function whiten(c: number, t: number): number {
  const k = clamp01(t);
  const ch = (s: number): number => { const v = (c >> s) & 0xff; return Math.round(v + (255 - v) * k) & 0xff; };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Blend two 0xRRGGBB colours: `t` = 0 is `a`, 1 is `b`. */
export function mixColor(a: number, b: number, t: number): number {
  const k = clamp01(t);
  const ch = (s: number): number => { const va = (a >> s) & 0xff, vb = (b >> s) & 0xff; return Math.round(va + (vb - va) * k) & 0xff; };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** '#rrggbb' -> 0xRRGGBB (bad input = white). */
export function hexToNum(hex: string): number {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(v) ? v : 0xffffff;
}

/**
 * A tiny seeded generator (mulberry32) for presentation scatter, so the same fight throws the same sparks (a replay
 * looks identical). Added 2026-09-28 with Arcana; presentation only, never gameplay.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The OS "reduce motion" preference (false where it cannot be read). */
export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
