import { useSyncExternalStore } from 'react';
import type { AncientId } from '@game/sim';

/**
 * The Ancients' PRESENTATION bus (proof of concept 2026-09-25). Three pieces of UI take part in one orchestrated
 * beat and live in different trees (the meter in the status bar, the offer in Recruit's overlays, the split inside
 * the hero-power button), so they meet here instead of through props:
 *
 *  · `ringSettled` — the meter has finished its drain and its completion flash for offer #N. The offer overlay
 *    waits for it (with a safety timeout), so the Discover never rises over a ring that is still draining.
 *  · `pickRelease` — when the chosen card's slam into the hero power releases (after its hit-stop). The split
 *    reads it once, so the crack opens on that frame.
 *  · `demo` — the tuner's ▶: play the whole pick beat for an Ancient without touching run state.
 *
 * Pure presentation: nothing here reads or writes the run.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let ringSettledSeq = 0;
let demo: { id: AncientId; seq: number } | null = null;

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

/** THE AWAKENING SEQUENCE (see `AncientGate`): which beat it is on, for which offer (a demo is a negative seq); the
 *  offer overlay mounts on `reveal`, runs its own emergence and reports `settled`. A click steps it forward
 *  (`requestSkip`): omen / eruption / title → reveal, reveal → settled. */
export type AwakenStage = 'idle' | 'omen' | 'eruption' | 'title' | 'reveal' | 'settled' | 'closing';
let stage: { stage: AwakenStage; seq: number } = { stage: 'idle', seq: 0 };
let skipSeq = 0;
/** A tuner demo of the awakening. `hero` plays it in that hero's theme (and power art) instead of the run hero's;
 *  `style` previews another bloom style on that hero. */
export interface GateDemo { seq: number; mode: 'full' | 'reveal'; hero?: string; style?: string }
let gateDemo: GateDemo | null = null;
let gateDemoSeq = 0;
export function setAwakenStage(next: AwakenStage, seq: number): void {
  if (stage.stage === next && stage.seq === seq) return;
  stage = { stage: next, seq };
  emit();
}
export function getAwakenStage(): { stage: AwakenStage; seq: number } { return stage; }
export function useAwakenStage(): { stage: AwakenStage; seq: number } {
  return useSyncExternalStore(subscribe, () => stage, () => stage);
}
export function requestSkip(): void { skipSeq++; emit(); }
export function useSkipSeq(): number { return useSyncExternalStore(subscribe, () => skipSeq, () => skipSeq); }
export function playGateDemo(mode: 'full' | 'reveal' = 'full', hero?: string, style?: string): void {
  gateDemo = { seq: ++gateDemoSeq, mode, ...(hero ? { hero } : {}), ...(style ? { style } : {}) };
  emit();
}
export function useGateDemo(): GateDemo | null {
  return useSyncExternalStore(subscribe, () => gateDemo, () => gateDemo);
}

/** THE PICK'S RELEASE: when (a `performance.now()` time) the chosen card's slam releases on the hero power, noted by
 *  the flight (`ancientPickSlam.ts`) at the click. The split reads it once, so its crack opens on the release frame;
 *  with none noted (the tuner's ▶ Awaken) the split plays the impact itself. */
let pickReleaseAt: number | null = null;
export function notePickRelease(at: number): void { pickReleaseAt = at; }
export function takePickRelease(): number | null {
  const at = pickReleaseAt;
  pickReleaseAt = null;
  return at;
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

// DEV only: a console / headless-capture handle to replay the awakening without refilling the meter.
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __ancients?: unknown }).__ancients = { playGateDemo };
}
