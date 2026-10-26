/**
 * VERSUS — WHERE THIS PLAYER IS IN THE ROUND, as one explicit state (owner 2026-10-14: "i got back from combat and was
 * set in the ready state for some reason?"). The End Turn pill ("Players ready N/2"), the shop hold and the clock all
 * read this one answer, so they cannot disagree.
 *
 *   shop    the round's shop is open and running: fully interactive, no pill.
 *   locked  I ended my turn early THIS round: held, pill (who has locked), until the fight is in.
 *   back    I am back from the fight and the next shop has not opened: held, pill (who is back), no clock.
 *   intro   round 1, my Good Luck intro is over and theirs is not: held, pill (whose intro is done), no clock.
 *   waiting held with no pill: the round's shop is not mine to play and I did nothing to be "ready" for (the clock ran
 *           out and the fight is coming, round 1 before my intro ends, or a match row that is out of date).
 *   none    nothing to do here: no Versus shop on screen (the title, a pause, the end).
 *
 * On the FIGHT screen (owner 2026-10-14: "the end combat button should not take a player back to shop until both
 * players go back to shop. it should instead enforce a 5s timer for the other player to hit end combat"):
 *   fightReady  I pressed End Combat; the other has not: I stay on the fight, pill (who is ready).
 *   foeReady    the other pressed End Combat; I have not: pill "Opponent is ready" with my seconds left (`deadline`).
 *   leave       the next shop is open: leave the fight now (pressed, or the 5 s ran out), together with the other.
 *   fight       the fight, nothing to show.
 *
 * The transitions the tests pin: shop -> (End Turn) locked -> (both locked, the fight lands) combat -> (End Combat
 * first) back -> (both back) shop of the next round, unlocked, no pill. A STALE row (the server opened the next shop
 * but this client has not heard yet: `back` past the combat cap) is `waiting`, never `back`, and asks for a re-read.
 */
import type { RunState, VersusSeat } from '@game/sim';
import type { VersusMatch } from './versusRemote';

export type VersusTurnKind = 'shop' | 'locked' | 'back' | 'intro' | 'waiting' | 'none' | 'fight' | 'fightReady' | 'foeReady' | 'leave';

export interface VersusTurn {
  kind: VersusTurnKind;
  /** Players ready, for the pill (locked / back / intro only). */
  ready?: number;
  /** Players in the count (2 in 1v1; the living seats in a group match, R-VERSUS-GROUP-01). */
  of?: number;
  /** The match row looks out of date: the caller should re-read it. */
  stale?: true;
  /** foeReady: when the 5 s run out (server time, ms). */
  deadline?: number;
  /** RANKED DUOS (lead 2026-10-26): the only other player is my TEAMMATE, so the fight pills name them. */
  mate?: string;
}

export interface VersusTurnInput {
  match: VersusMatch | null;
  seat: VersusSeat | null;
  /** The round this client locked (End Turn), or null. */
  lockedRound: number | null;
  /** The round whose End Combat this client pressed (sent before the server row says so), or null. */
  readyRound?: number | null;
  run: Pick<RunState, 'mode' | 'phase' | 'wave'>;
  /** Server-time now, ms. */
  now: number;
}

const SEATS: readonly VersusSeat[] = ['p1', 'p2'];

export function versusTurn({ match: m, seat, lockedRound, readyRound = null, run, now }: VersusTurnInput): VersusTurn {
  if (!m || !seat || run.mode !== 'versus' || m.phase === 'complete' || m.paused_at) return { kind: 'none' };
  if (run.phase === 'combat') return fightTurn(m, seat, readyRound, run.wave);
  if (run.phase !== 'recruit') return { kind: 'none' };
  /** Seats with the flag, mine counted as set; an absent seat on auto counts as ready. VERSUS GROUP: every living seat
   *  of the table (`match.group.counts`, auto included), mine counted as set. */
  const g = m.group;
  const of = g ? g.counts.living : 2;
  const groupCount = (key: 'locked' | 'ready' | 'intro', mineSet: boolean): number =>
    Math.min(of, g!.counts[key] + (mineSet ? 0 : 1));
  const count = (flag: (s: VersusSeat) => boolean | undefined, key: 'locked' | 'ready' | 'intro'): number =>
    g ? groupCount(key, !!flag(seat)) : SEATS.filter((s) => s === seat || !!flag(s) || !!m[`${s}_auto`]).length;
  const wave = run.wave;

  if (m.round === wave) {
    if (m.phase === 'shop') {
      if (!m.shop_deadline) return m[`${seat}_intro`] ? { kind: 'intro', ready: count((s) => m[`${s}_intro`], 'intro'), of } : { kind: 'waiting' };
      return lockedRound === wave ? { kind: 'locked', ready: count((s) => m[`${s}_locked`], 'locked'), of } : { kind: 'shop' };
    }
    // Resolving / the fight committed: my lock was early only if I pressed End Turn this round.
    return lockedRound === wave ? { kind: 'locked', ready: of, of } : { kind: 'waiting' };
  }

  if (m.round === wave - 1 && m.phase === 'combat') {
    // Past the combat cap the server has opened the next shop already: this row is out of date.
    const capped = !!m.combat_deadline && now >= Date.parse(m.combat_deadline);
    return capped ? { kind: 'waiting', stale: true } : { kind: 'back', ready: count((s) => m[`${s}_ready`], 'ready'), of };
  }

  // Any other gap between the run and the row is a moment the row has not caught up with.
  return { kind: 'waiting', stale: true };
}

/** The fight screen's state (see the header). */
function fightTurn(m: VersusMatch, seat: VersusSeat, readyRound: number | null, wave: number): VersusTurn {
  if ((m.phase === 'shop' || m.phase === 'resolving') && m.round > wave) return { kind: 'leave' };
  if (m.phase !== 'combat' || m.round !== wave) return { kind: 'fight' };
  const g = m.group;
  if (g) {
    // VERSUS GROUP: ready = every living seat back (auto counts); the 5 s run for the LAST one back (server rule).
    const mineG = readyRound === wave || !!m.p1_ready;
    const back = Math.min(g.counts.living, g.counts.ready + (mineG && !m.p1_ready ? 1 : 0));
    // RANKED DUOS: the one other player is my teammate (the recorded teams are never waited on): name them.
    const mateSeat = g.raw.options?.mode === 'ranked_duos' ? g.duos?.mate ?? null : null;
    const mate = mateSeat ? g.raw.seats.find((x) => x.seat === mateSeat)?.name : undefined;
    if (mineG) return { kind: 'fightReady', ready: back, of: g.counts.living, ...(mate ? { mate } : {}) };
    if (back >= g.counts.living - 1) return { kind: 'foeReady', of: g.counts.living, ...(mate ? { mate } : {}), ...(m.combat_deadline ? { deadline: Date.parse(m.combat_deadline) } : {}) };
    return { kind: 'fight' };
  }
  const other: VersusSeat = seat === 'p1' ? 'p2' : 'p1';
  const mine = readyRound === wave || !!m[`${seat}_ready`];
  const theirs = !!m[`${other}_ready`] || !!m[`${other}_auto`];
  if (mine) return { kind: 'fightReady', ready: theirs ? 2 : 1, of: 2 };
  if (theirs) return { kind: 'foeReady', ...(m.combat_deadline ? { deadline: Date.parse(m.combat_deadline) } : {}) };
  return { kind: 'fight' };
}

/** The shop is held (no input) in these states. Fight-screen states never hold the shop (it is not on screen). */
export const versusTurnHolds = (t: VersusTurn): boolean => t.kind === 'locked' || t.kind === 'back' || t.kind === 'intro' || t.kind === 'waiting';
/** The End Turn / End Combat gem's pill. `secondsLeft` feeds the opponent-ready countdown. */
export const versusTurnNote = (t: VersusTurn, secondsLeft = 0): string | null =>
  // RANKED DUOS (lead 2026-10-26): after End Combat the pills name the teammate.
  t.kind === 'fightReady' && t.mate && (t.ready ?? 0) < (t.of ?? 2) ? `Waiting for ${t.mate}`
    : t.kind === 'locked' || t.kind === 'back' || t.kind === 'intro' || t.kind === 'fightReady' ? `Players ready ${t.ready}/${t.of ?? 2}`
    : t.kind === 'foeReady' ? `${t.mate ?? (t.of && t.of > 2 ? 'Everyone else' : 'Opponent')} is ready · ${Math.max(0, secondsLeft)}s` : null;
/** The gem is spent (pressed, not pressable) while this player waits on the other. */
export const versusTurnLocksGem = (t: VersusTurn): boolean => t.kind === 'locked' || t.kind === 'back' || t.kind === 'intro' || t.kind === 'fightReady' || t.kind === 'leave';

/**
 * Does a finished match close its gate NOW? (owner 2026-10-14)
 *  - A CONCEDE (and any other end that is not a fight: missed rounds, both gone): at once, wherever the player is,
 *    mid-fight included: "if a player conceded, it should immediately shut the gates and return to lobby".
 *  - HEARTS: the deciding fight is watched first. Its End Combat gem closes the gate (`versusMatchEndsAtPress`); this
 *    says yes only once the run is past that fight (it was left another way) or there is no run on screen.
 */
export function versusEndsNow(x: { match: VersusMatch; rounds: Record<number, unknown>; run: Pick<RunState, 'mode' | 'phase' | 'wave'>; heroSelect: boolean }): boolean {
  if (x.match.phase !== 'complete') return false;
  if (x.match.end_reason !== 'hearts') return true;
  if (x.heroSelect || x.run.mode !== 'versus') return true;
  const last = Math.max(0, ...Object.keys(x.rounds).map(Number));
  return x.run.phase === 'recruit' && x.run.wave > Math.max(last, x.match.round);
}
