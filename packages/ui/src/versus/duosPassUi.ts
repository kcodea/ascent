/**
 * VERSUS DUOS — the pass drag's decisions on screen (R-DUOS-PASS-01): whether a card can be passed right now and, if
 * not, why, in plain player text; the refusal note the teammate's portrait shows.
 * Pure reads of the run, the teammate's live frame and the match; nothing here touches the network.
 */
import { create } from 'zustand';
import { duosPassBlocked, handCap, type RunState } from '@game/sim';
import { teammateViewOf } from './spectate';
import { useVersus } from './versusStore';
import { localMate } from './localMate';

/** The refusal shown on the teammate's portrait (player text: short, plain, no em dashes). */
const REASON_TEXT: Record<string, string> = {
  hand_full: 'Their hand is full',
  gold: 'You need 1 Gold',
  board: 'Pass from your hand',
  golden: 'Golden minions cannot be passed',
  phase: 'Passing is closed',
  no_card: 'Passing is closed',
  not_duos: 'Passing is closed',
  teammate_away: 'Your teammate is away',
};

/** Is my teammate's hand full, by their live frame (unknown = not full; the server checks too). */
export function mateHandFull(): boolean {
  const lm = localMate();
  if (lm) return lm.handFull(); // the Scene Builder's placeholder teammate (DEV, R-SB-DUOS-01)
  const mate = useVersus.getState().match?.group?.duos?.mate;
  const view = mate ? teammateViewOf(mate) : null;
  const hand = view && Array.isArray((view as unknown as { hand?: unknown }).hand) ? (view as unknown as { hand: unknown[] }).hand : null;
  if (!view || !hand) return false;
  return hand.length >= handCap(view as unknown as Pick<RunState, 'runeforgeOffer'>);
}

/** My teammate is away: disconnected past the grace (their seat plays on auto), or the match is paused for them. */
export function mateAway(): boolean {
  if (localMate()) return false; // the Scene Builder's placeholder teammate is always there
  const g = useVersus.getState().match?.group;
  const mate = g?.duos?.mate;
  if (!g || !mate) return false;
  const row = g.raw.seats.find((x) => x.seat === mate);
  return !!row?.auto || (!!g.raw.paused_at && g.raw.paused_seat === mate);
}

/** Why `uid` cannot be passed right now, as the portrait says it (null = it can). */
export function duosPassRefusal(run: RunState, uid: string): string | null {
  if (!localMate() && !useVersus.getState().match?.group?.duos?.mate) return REASON_TEXT.not_duos!;
  // A teammate who dropped out (their board plays on auto) cannot take a card: it would wait on the server, with my
  // Gold paid, until they came back (phase-3 live test, 2026-10-25). The server refuses it too.
  if (mateAway()) return REASON_TEXT.teammate_away!;
  const why = duosPassBlocked(run, uid, mateHandFull());
  return why ? REASON_TEXT[why] ?? REASON_TEXT.phase! : null;
}

/**
 * THE PASS HIT (owner 2026-10-25: "Passing a minion or spell should require the player to release it over their
 * teammates frame", R-DUOS-PASS-03): the point is over the teammate portrait's VISIBLE frame, the round disc (the
 * circle inscribed in its box), not the box's corners and nothing near it. Hover uses it for the glow; only a real
 * release (`pointerup`, mouse or touch alike) at a point inside it passes. A cancelled pointer never passes.
 */
export function overMateFrame(r: { left: number; top: number; right: number; bottom: number }, x: number, y: number): boolean {
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  const rad = Math.min(r.right - r.left, r.bottom - r.top) / 2;
  return rad > 0 && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad;
}

/** Does this pointer event, ending a drag at (x, y), pass the card? Only a release over the frame. */
export const passOnRelease = (r: { left: number; top: number; right: number; bottom: number } | null, e: { type: string; clientX: number; clientY: number }): boolean =>
  !!r && e.type === 'pointerup' && overMateFrame(r, e.clientX, e.clientY);

/** The latest refusal, for the portrait's note (keyed so the same reason twice shows twice). */
export const useDuosPassNote = create<{ text: string | null; n: number }>(() => ({ text: null, n: 0 }));
let noteTimer: number | null = null;
export function notePassRefused(text: string): void {
  useDuosPassNote.setState((s) => ({ text, n: s.n + 1 }));
  if (noteTimer != null) window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => { noteTimer = null; useDuosPassNote.setState({ text: null }); }, 1800);
}
