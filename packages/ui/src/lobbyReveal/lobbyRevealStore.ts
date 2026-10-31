import { useSyncExternalStore } from 'react';
import type { RevealEntry, RevealLayout } from './lobbyRevealModel';

/**
 * THE LOBBY REVEAL — whether it is playing, and who is in it (owner ask 2026-10-31).
 *
 * A tiny external store like `goodLuckIntroStore`, for the same reason: this is presentation, not game state. Nothing
 * in the sim knows the reveal exists, nothing is saved, the reducer is never told, and the round-1 shop under it is the
 * same shop either way. While it plays the Good Luck intro waits behind it (and with it the turn clock, which that
 * intro already holds), so a reveal never costs the player turn time.
 *
 * `begin` is called by the launch curtain right after the run is built (and by the stands when they watched the Hero
 * Select), `end` by the overlay when it finishes or is skipped. A safety timer ends it regardless, so nothing can ever
 * be left waiting on a reveal that never played (no overlay mounted, a thrown animation).
 */
export interface RevealPlay {
  entries: RevealEntry[];
  layout: RevealLayout;
  /** The stands' copy: no clock or Good Luck to hand on to. */
  spectator: boolean;
}

let active = false;
let seq = 0;
let play: RevealPlay | null = null;
/** Set by a skip (click, Esc, a key): the visuals ended early. Kept for tests and telemetry; nothing else changes. */
let skipped = false;
let safety: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

/** The longest a reveal may hold anything up, whatever happens to its overlay. */
export const REVEAL_SAFETY_MS = 9000;

export const lobbyReveal = {
  isActive: (): boolean => active,
  seq: (): number => seq,
  play: (): RevealPlay | null => play,
  wasSkipped: (): boolean => skipped,
  begin: (p: RevealPlay): void => {
    if (p.entries.length < 2) return;
    active = true;
    skipped = false;
    play = p;
    seq += 1;
    if (safety) clearTimeout(safety);
    safety = setTimeout(() => lobbyReveal.end(), REVEAL_SAFETY_MS);
    emit();
  },
  /** `skip`: the player cut it short (click, Esc, a key). */
  end: (opts: { skip?: boolean } = {}): void => {
    if (safety) { clearTimeout(safety); safety = null; }
    if (!active) return;
    active = false;
    skipped = opts.skip === true;
    emit();
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Whether the reveal is up. Re-renders the caller only when it flips (twice per game start). */
export function useLobbyRevealActive(): boolean {
  return useSyncExternalStore(lobbyReveal.subscribe, lobbyReveal.isActive, lobbyReveal.isActive);
}

export function useLobbyRevealSeq(): number {
  return useSyncExternalStore(lobbyReveal.subscribe, lobbyReveal.seq, lobbyReveal.seq);
}

/** Test-only: reset the module state between specs. */
export function resetLobbyRevealForTests(): void {
  if (safety) clearTimeout(safety);
  safety = null;
  active = false;
  skipped = false;
  play = null;
  seq = 0;
  listeners.clear();
}

// ── The Settings switch ("Lobby reveal", default ON). Saved on this device, like Lobby chat. ──────────────────────
const PREF_KEY = 'ascent.lobbyRevealOn';
let prefOn: boolean = (() => {
  try { return typeof localStorage === 'undefined' || localStorage.getItem(PREF_KEY) !== 'off'; } catch { return true; }
})();
const prefListeners = new Set<() => void>();
export function lobbyRevealEnabled(): boolean {
  return prefOn;
}
export function setLobbyRevealEnabled(on: boolean): void {
  prefOn = on;
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable: lasts this session */ }
  prefListeners.forEach((l) => l());
}
const subscribePref = (l: () => void): (() => void) => {
  prefListeners.add(l);
  return () => prefListeners.delete(l);
};
export function useLobbyRevealEnabled(): boolean {
  return useSyncExternalStore(subscribePref, lobbyRevealEnabled, lobbyRevealEnabled);
}
