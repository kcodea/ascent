import { useSyncExternalStore } from 'react';
import type { AncientId } from '@game/sim';

/**
 * The Ancients' PRESENTATION bus (proof of concept 2026-09-25). Three pieces of UI take part in one orchestrated
 * beat and live in different trees (the meter in the status bar, the offer in Recruit's overlays, the split inside
 * the hero-power button), so they meet here instead of through props:
 *
 *  · `ringSettled` — the meter has finished its drain and its completion flash for offer #N. The offer overlay
 *    waits for it (with a safety timeout), so the Discover never rises over a ring that is still draining.
 *  · `pickSource` — where the chosen Ancient's face stood when it was clicked. The split reads it once, to fly
 *    the face from there into the hero power (the triple's `gild-trail`).
 *  · `demo` — the tuner's ▶: play the whole pick beat for an Ancient without touching run state.
 *
 * Pure presentation: nothing here reads or writes the run.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let ringSettledSeq = 0;
let demo: { id: AncientId; seq: number } | null = null;
let pickSource: { x: number; y: number; w: number } | null = null;

function emit(): void { for (const fn of listeners) fn(); }
function subscribe(fn: Listener): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function markRingSettled(offerSeq: number): void {
  if (offerSeq <= ringSettledSeq) return;
  ringSettledSeq = offerSeq;
  emit();
}
export function useRingSettledSeq(): number {
  return useSyncExternalStore(subscribe, () => ringSettledSeq, () => ringSettledSeq);
}

/** THE GATE (see `AncientGate`): the offer rises once the gate has opened for offer #N; while any gate is up the
 *  offer drops its own dim (the gate IS the backdrop); the tuner's ▶ Play gate. */
let gateOpenSeq = 0;
let gateActive = false;
let gateDemo: { seq: number } | null = null;
let gateDemoSeq = 0;
export function markGateOpen(seq: number): void {
  if (seq <= gateOpenSeq) return;
  gateOpenSeq = seq;
  emit();
}
export function useGateOpenSeq(): number {
  return useSyncExternalStore(subscribe, () => gateOpenSeq, () => gateOpenSeq);
}
export function setGateActive(on: boolean): void {
  if (gateActive === on) return;
  gateActive = on;
  emit();
}
export function useGateActive(): boolean {
  return useSyncExternalStore(subscribe, () => gateActive, () => gateActive);
}
export function playGateDemo(): void {
  gateDemo = { seq: ++gateDemoSeq };
  emit();
}
export function useGateDemo(): { seq: number } | null {
  return useSyncExternalStore(subscribe, () => gateDemo, () => gateDemo);
}

export function notePickSource(el: Element | null): void {
  const r = el?.getBoundingClientRect();
  pickSource = r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } : null;
}
export function takePickSource(): { x: number; y: number; w: number } | null {
  const s = pickSource;
  pickSource = null;
  return s;
}

let demoSeq = 0;
/** DEV (✦ tuner ▶): play the awakening pick beat for `id` on the hero power, run state untouched. */
let demoTimer = 0;
export function playAwakenDemo(id: AncientId, holdMs = 3600): void {
  const mine = { id, seq: ++demoSeq };
  demo = mine;
  emit();
  window.clearTimeout(demoTimer);
  demoTimer = window.setTimeout(() => { if (demo === mine) { demo = null; emit(); } }, holdMs);
}
export function useAwakenDemo(): { id: AncientId; seq: number } | null {
  return useSyncExternalStore(subscribe, () => demo, () => demo);
}

/** Gap-gate for the drain tick, so a multi-point drain never stacks clips into a buzz. */
let lastTickAt = 0;
export function tickAllowed(minGapMs = 70): boolean {
  const now = performance.now();
  if (now - lastTickAt < minGapMs) return false;
  lastTickAt = now;
  return true;
}

export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
