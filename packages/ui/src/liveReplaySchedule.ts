/**
 * LIVE REPLAY, the pure half: turn a recorded game (its action log + its v2 replay frames) into the list of steps
 * the live driver (`liveReplay.ts`) performs, each with the time the player did it, and compare a live shop with the
 * recorded one so a replay that has drifted stops instead of playing a different game.
 *
 * No DOM, no store: everything here is plain data in, plain data out, so it is unit-tested directly.
 */
import type { Action } from '@game/sim';

/** The parts of a recorded v2 frame the driver reads. Frames come from the server as JSON, so every field is loose. */
export interface RecordedFrame {
  kind: string; // 'shop' (a turn's opening shop) | 'shopDelta' (one shop action) | 'combat' (a fight)
  tMs: number;
  cause?: string; // the action type that produced a shopDelta frame
  wave?: number;
  view?: RecordedShopView;
}
export interface RecordedCard { cardId: string; attack?: number; health?: number }
export interface RecordedShopView {
  shop?: RecordedCard[];
  hand?: RecordedCard[];
  board?: RecordedCard[];
  embers?: number;
  tier?: number;
  wave?: number;
}

/**
 * One thing the driver does. `tMs` is when the player did it (ms on the recording's clock), or null when the
 * recording has no frame for it (an action that changed nothing): the driver then fires it right after the last one.
 *  - `action`    a shop-phase action, dispatched through the store exactly as a click dispatches it
 *  - `endTurn`   the player pressed End Turn: the driver presses the real button, so End of Turn plays as it does live
 *  - `endCombat` the player pressed End Combat: the driver presses the real button once the fight has finished
 *                playing; `shop` is the recorded shop that opened next, checked against the live one
 * Actions the game plays on its own (`AUTOMATIC_ACTIONS`: the fight's settle and previews, the shop clock running
 * out) are never steps: the live screen dispatches them itself, at its own moment.
 */
export type LiveReplayStep =
  | { kind: 'action'; action: Action; tMs: number | null }
  | { kind: 'endTurn'; tMs: number | null; wave: number | null }
  | { kind: 'endCombat'; tMs: number | null; shop: RecordedFrame | null };

/** Actions the GAME dispatches, not the player (the same list Versus holds while a shop is paused, minus End Turn
 *  and End Combat, which the driver presses as buttons). Recorded in the action log, but replaying them would
 *  double what the live screen already does. */
export const AUTOMATIC_ACTIONS: ReadonlySet<string> = new Set([
  'landCombat', 'settleCombat', 'resolveShopDeath', 'shopClockExpired', 'sellWindowExpired',
  'combatEscalationPreview', 'combatSpellPowerPreview', 'combatSpellCastPreview', 'combatFriendlyDeathPreview',
  'combatBladeAttackPreview', 'combatScoutPreview', 'receivePass', 'passRefunded', 'noteMateTribes',
]);

/** Build the step list. Frames are matched to actions in order: a shopDelta whose `cause` is the action's type, the
 *  next combat frame for End Turn, the shop frame right after a fight for End Combat. */
export function buildLiveReplaySchedule(actions: readonly Action[], frames: readonly RecordedFrame[]): LiveReplayStep[] {
  const steps: LiveReplayStep[] = [];
  // Frame 0 is the run's opening shop (tMs 0): the clock starts there.
  let fi = frames[0]?.kind === 'shop' ? 1 : 0;
  for (const action of actions) {
    if (AUTOMATIC_ACTIONS.has(action.type)) {
      // Skip its frame too (a shop-phase one records a shopDelta), so the next player action lines up with its own.
      if (frames[fi]?.kind === 'shopDelta' && frames[fi]!.cause === action.type) fi++;
      continue;
    }
    if (action.type === 'faceOmen') {
      let j = fi;
      while (j < frames.length && frames[j]!.kind !== 'combat') j++;
      const f = frames[j];
      if (f) fi = j + 1;
      steps.push({ kind: 'endTurn', tMs: f ? f.tMs : null, wave: f?.wave ?? null });
      continue;
    }
    if (action.type === 'resolveCombat') {
      const f = frames[fi]?.kind === 'shop' ? frames[fi]! : null;
      if (f) fi++;
      steps.push({ kind: 'endCombat', tMs: f ? f.tMs : null, shop: f });
      continue;
    }
    const f = frames[fi];
    if (f && f.kind === 'shopDelta' && f.cause === action.type) {
      fi++;
      steps.push({ kind: 'action', action, tMs: f.tMs });
    } else {
      steps.push({ kind: 'action', action, tMs: null });
    }
  }
  return steps;
}

/** When a step should fire on the LIVE clock. The clock is re-anchored at every shop opening (`anchorLive` is when
 *  the live shop opened, `anchorRec` when the recorded one did), because a fight's length on screen is the
 *  animation's, not the recording's. `speed` > 1 compresses the player's gaps (more actions per minute). A step
 *  with no recorded time fires right after the previous one. */
export function liveFireAt(stepTMs: number | null, anchorRec: number, anchorLive: number, prevFiredAt: number, speed: number, minGapMs = 40): number {
  const earliest = prevFiredAt + minGapMs;
  if (stepTMs === null) return earliest;
  return Math.max(earliest, anchorLive + Math.max(0, stepTMs - anchorRec) / Math.max(0.01, speed));
}

const cards = (xs: readonly RecordedCard[] | undefined, withStats: boolean): string =>
  (xs ?? []).map((m) => (withStats ? `${m.cardId}:${m.attack}/${m.health}` : m.cardId)).join(',');

/** Compare the live shop phase with the recorded one. Returns the fields that differ (empty = the same game). */
export function shopDifferences(rec: RecordedShopView, live: { shop: readonly RecordedCard[]; hand: readonly RecordedCard[]; board: readonly RecordedCard[]; embers: number; tier: number }): string[] {
  const out: string[] = [];
  const check = (name: string, a: string, b: string): void => { if (a !== b) out.push(`${name}: recorded [${a}] live [${b}]`); };
  check('shop', cards(rec.shop, false), cards(live.shop, false));
  check('hand', cards(rec.hand, false), cards(live.hand, false));
  check('board', cards(rec.board, true), cards(live.board, true));
  if (rec.embers !== undefined) check('gold', String(rec.embers), String(live.embers));
  if (rec.tier !== undefined) check('tier', String(rec.tier), String(live.tier));
  return out;
}
