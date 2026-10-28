/**
 * VERSUS DUOS — WHAT MY TEAMMATE'S PORTRAIT SIGNALS (owner 2026-10-27; R-DUOS-MATE-SIGNALS-01). Fed by the teammate's live
 * spectator stream, which a Duos player always receives and caches (`spectate.receiveSpectate`), and read by the
 * bottom-right portrait (`DuosMateDock`):
 *
 *  - THE TIER-UP ("if a teammate tiers their shop up, can you play a similar burst animation over their portrait"): their
 *    view's shop tier went UP between two frames (the Upgrade press, a free tier-up, an effect: every source). `tierPop`
 *    counts them per seat; the portrait plays the player's own `shop-tier-up` burst over the disc on each new count.
 *  - STILL WORKING ("if a teammate's end of turn effects are going off, causing an end of turn hang, can you play a glow or
 *    effect on the teammate's portrait so players know the game isnt frozen"): `mateWorking` (pure) says the round is
 *    waiting on their screen. Their End Turn's beats arrive as an `endTurn` act; while their view is still on that
 *    round's shop after the round has closed, or after they pressed End Turn with End-of-Turn beats to play, their End of
 *    Turn is still going off. And once I am back from the fight, a teammate whose fight is still playing (it started
 *    late, behind their End of Turn) holds the next shop for us both.
 *
 * Pure bookkeeping: a per-seat record written only when it CHANGES (a tier, a phase, a wave), so a frame that moves none
 * of them costs one comparison and no render.
 */
import { create } from 'zustand';
import type { VersusGroupSeat } from '@game/sim';

export interface MateSeen {
  /** The view's round and screen ('recruit' / 'combat' / ...). */
  wave: number;
  phase: string;
  /** The round whose End Turn press (with End-of-Turn beats) arrived last, or null. */
  eotWave: number | null;
}

export interface DuosMateSignalsState {
  /** Tier-ups seen per seat (a counter: each bump is one burst). */
  tierPop: Partial<Record<VersusGroupSeat, number>>;
  /** Each seat's latest view, as far as the signals need it. */
  seen: Partial<Record<VersusGroupSeat, MateSeen>>;
}

export const useDuosMateSignals = create<DuosMateSignalsState>(() => ({ tierPop: {}, seen: {} }));

const tierOf = (v: unknown): number | null => {
  const t = (v as { tier?: unknown } | null)?.tier;
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
};

/**
 * One frame of `seat`'s stream landed: `before` is the view it applied to (null for the first one, or after a reset),
 * `after` the view it produced, `acts` the actions it carried. Called for a Duos PLAYER only.
 */
export function noteMateFrame(seat: VersusGroupSeat, before: unknown, after: unknown, acts: readonly { t: string; eot?: unknown }[] | undefined): void {
  if (!after || typeof after !== 'object') return;
  const st = useDuosMateSignals.getState();
  const a = after as { wave?: unknown; phase?: unknown };
  const wave = typeof a.wave === 'number' ? a.wave : 0;
  const phase = typeof a.phase === 'string' ? a.phase : '';
  const prev = st.seen[seat];
  const pressed = !!acts?.some((x) => x.t === 'endTurn' && !!x.eot);
  // A new round forgets the last round's press.
  const eotWave = pressed ? wave : prev && prev.wave === wave ? prev.eotWave : null;
  const next: Partial<DuosMateSignalsState> = {};
  if (!prev || prev.wave !== wave || prev.phase !== phase || prev.eotWave !== eotWave) next.seen = { ...st.seen, [seat]: { wave, phase, eotWave } };
  // A tier-up: only between two frames of the same stream (never the first frame, never a drop).
  const was = tierOf(before);
  const now = tierOf(after);
  if (was != null && now != null && now > was) next.tierPop = { ...st.tierPop, [seat]: (st.tierPop[seat] ?? 0) + 1 };
  if (next.seen || next.tierPop) useDuosMateSignals.setState(next);
}

/** A new match (or none): forget everything. */
export function resetDuosMateSignals(): void {
  const st = useDuosMateSignals.getState();
  if (Object.keys(st.seen).length || Object.keys(st.tierPop).length) useDuosMateSignals.setState({ tierPop: {}, seen: {} });
}

export interface MateWorkingInput {
  /** The teammate's latest view (null: none yet). */
  seen: MateSeen | null;
  /** The match row: its round and phase ('shop' / 'resolving' / 'combat' / ...). */
  round: number;
  matchPhase: string;
  /** My own screen: the run's round and phase. */
  myWave: number;
  myPhase: string;
  /** I pressed End Combat this round (or the server row says I am back). */
  meBack: boolean;
  /** The teammate's seat row says they are back from the fight. */
  mateBack: boolean;
  /** The teammate is away (on auto, or the match is paused on them): nothing of theirs is playing. */
  away: boolean;
}

/**
 * THE ROUND IS WAITING ON MY TEAMMATE'S SCREEN (pure; see the header). True while:
 *  - their End of Turn is going off: the round has closed (or they pressed End Turn with beats to play) and their view is
 *    still on that round's shop;
 *  - or I am back from this round's fight and they are not, with their fight still playing.
 * Never while they are only shopping (a choice, not a hang), away, or before any frame of theirs.
 */
export function mateWorking(i: MateWorkingInput): boolean {
  const s = i.seen;
  if (!s || i.away || !(i.round > 0)) return false;
  const closed = i.matchPhase === 'resolving' || i.matchPhase === 'combat';
  if (s.wave === i.round && s.phase === 'recruit' && (i.matchPhase === 'combat' || (closed && s.eotWave === i.round))) return true;
  if (i.matchPhase === 'combat' && i.myWave === i.round && i.myPhase === 'combat' && i.meBack && !i.mateBack
    && s.wave === i.round && s.phase === 'combat') return true;
  return false;
}
