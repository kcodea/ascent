/**
 * A LOCAL DUOS TEAMMATE: the narrow seam the Scene Builder's placeholder teammate plugs into (DEV, owner ask
 * 2026-10-31, R-SB-DUOS-01: "scene builder needs a duo toggle which gives a placeholder teammate to view their board and
 * pass things to").
 *
 * Real Duos reads its teammate off the Versus match (`useVersus`, the spectate frames). The Scene Builder has no match:
 * its teammate is a second run held in the browser (`sbDuos.ts`, the DEV chunk). The Duos UI (the teammate portrait,
 * the view swap, the pass drag's refusal, the combat team-effect release) asks this seam first and otherwise runs
 * exactly as it does in a match. Nothing installs it outside the DEV Scene Builder, so every function here is a
 * null read in a real game.
 */
import { create } from 'zustand';
import type { Action } from '@game/sim';

/** Who a portrait shows: a hero and a name pill. */
export interface LocalMateFace { hero: string; name: string }

export interface LocalMateApi {
  /** The run NOT on screen has no hand room (its hand plus the effect passes waiting for room fill it). */
  handFull(): boolean;
  /** Swap the screen to the teammate's run / back to mine (run inside the view swap's cross-fade). */
  enter(): void;
  exit(): void;
  /** Back to my own board WITH the cross-fade (`exitTeammateView`). */
  back(): void;
  /** The screen shows the teammate's run right now. */
  viewing(): boolean;
  /** The combat replay reached these `teamSend` beats of the run on screen (R-DUOS-RUNES-02): send them now. */
  releaseCombatFx(wave: number, idx: readonly number[]): void;
}

/** The two faces (mine and the teammate's), for the portrait. Null = no local teammate. */
export const useLocalMate = create<{ me: LocalMateFace | null; mate: LocalMateFace | null }>(() => ({ me: null, mate: null }));

let api: LocalMateApi | null = null;

/** Install (or remove, `null`) the local teammate. */
export function installLocalMate(next: LocalMateApi | null): void {
  api = next;
  if (!next) useLocalMate.setState({ me: null, mate: null });
}

/** The local teammate, when the Scene Builder has one. */
export const localMate = (): LocalMateApi | null => api;

/**
 * While the screen shows the placeholder teammate's run, it never ends a turn: their run does not fight (tag-team
 * combat is out of scope for the rig). End Turn there, or the shop clock running out, takes you back to your own
 * board instead, where End Turn works as usual.
 */
export function localMateRefuses(action: Action): boolean {
  if (!api || !api.viewing()) return false;
  if (action.type !== 'faceOmen' && action.type !== 'shopClockExpired') return false;
  api.back();
  return true;
}
