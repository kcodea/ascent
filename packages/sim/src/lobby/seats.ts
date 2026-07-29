import type { BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { autoplayRun } from '../snapshot';
import type { PreparedBoard, SeatDriver, SeatRoundOutcome } from './types';

/**
 * The two seat drivers the prototype ships with. Both satisfy `SeatDriver`, so the lobby cannot tell them
 * apart — which is the point: if recorded snapshots don't feel right, swapping a seat to a bot is a one-line
 * change at the call site, and swapping ALL of them is a loop.
 */

/** Board-for-round lookup shared by both drivers: prefer an exact wave, else the closest earlier one. */
function boardAt(snaps: readonly BoardSnapshot[], round: number): BoardSnapshot | null {
  let best: BoardSnapshot | null = null;
  for (const s of snaps) {
    if (s.wave === round) return s;
    if (s.wave < round && (!best || s.wave > best.wave)) best = s;
  }
  return best;
}

const toPrepared = (snap: BoardSnapshot): PreparedBoard => ({
  // Strip run-specific instance refs the way `snapshotBoard` already does — a board that travels between runs
  // carries stats and keywords, not another run's uids.
  minions: snap.minions.map((m) => ({ ...m })) as BoardMinion[],
  tier: snap.tier,
});

/**
 * A RECORDED seat: a run someone already played, replayed alongside the live player.
 *
 * This is the shape the owner asked about — "their snapshot board is taken from their run and replayed in a
 * game with the player". It never reacts: its round-12 board is whatever that run actually built, no matter how
 * much damage the seat has taken in this lobby. That's the one place the illusion is genuinely thin, and it is
 * exactly why `settle` is a no-op here rather than being absent from the interface.
 *
 * `exhausted` is deliberately observable. A recorded run is finite; a lobby with no fixed round count is not.
 * What happens when it runs dry is a design decision, not an implementation detail, so the lobby resolves it
 * through `ExhaustionPolicy` instead of this driver silently repeating itself.
 */
export function recordedSeat(label: string, snaps: readonly BoardSnapshot[]): SeatDriver & { readonly lastWave: number } {
  const sorted = [...snaps].sort((a, b) => a.wave - b.wave);
  const lastWave = sorted.length ? sorted[sorted.length - 1]!.wave : 0;
  return {
    kind: 'recorded',
    label,
    heroId: sorted[0]?.heroId ?? 'warden',
    lastWave,
    prepare: (round) => {
      if (round > lastWave) return null; // out of material — the lobby decides what that means
      const snap = boardAt(sorted, round);
      return snap ? toPrepared(snap) : null;
    },
    finalBoard: () => (sorted.length ? toPrepared(sorted[sorted.length - 1]!) : null),
    settle: () => {
      /* a recording cannot react — see the note above */
    },
  };
}

/**
 * Record a run headlessly so it can hold a seat. Uses the existing autoplay + per-wave snapshot machinery, so a
 * generated seat and a real player's uploaded run are the same data shape — the prototype can prove the whole
 * loop today, and swapping in genuine uploaded runs later changes nothing but the source.
 */
export function recordRun(seed: number, heroId?: string, label?: string): SeatDriver & { readonly lastWave: number } {
  const snaps = autoplayRun(seed, heroId);
  return recordedSeat(label ?? `${heroId ?? 'run'}#${seed}`, snaps);
}

/**
 * A BOT seat.
 *
 * PROTOTYPE LIMITATION, stated plainly: this currently plays its own ordinary run and the lobby reads its board
 * each round, so it does not yet react to damage taken *in the lobby* — its own Resolve and the lobby's pool are
 * separate numbers. That makes it behaviourally identical to a recorded seat today.
 *
 * Making it genuinely reactive needs `faceOmen` split into `prepareSeatForCombat` / `settleSeatCombat` so the
 * lobby can drive the seat's recruit phase, resolve the fight itself, and settle the real result back. That is a
 * real piece of work and it is NOT what this prototype is testing — the prototype is testing whether the lobby
 * loop and the damage model feel right. The seam exists so that work lands here and nowhere else.
 */
export function botSeat(seed: number, heroId?: string, label?: string): SeatDriver {
  const inner = recordRun(seed, heroId, label ?? `bot#${seed}`);
  let seen: SeatRoundOutcome | null = null;
  return {
    kind: 'bot',
    label: inner.label,
    heroId: inner.heroId,
    prepare: (round) => inner.prepare(round),
    finalBoard: () => inner.finalBoard?.() ?? null,
    settle: (o) => { seen = o; void seen; /* a reactive seat will consume this — see the note above */ },
  };
}

/** The live player's seat: the lobby never asks it to prepare, because the real run supplies the board. */
export function playerSeat(label: string, heroId: string, boardOf: (round: number) => PreparedBoard | null): SeatDriver {
  return {
    kind: 'player',
    label,
    heroId,
    prepare: (round) => boardOf(round),
    settle: () => {
      /* the real run settles through the ordinary reducer, not through here */
    },
  };
}

/** Σ(tier) of a board's survivors — the damage formula's shape, exposed for the lobby's stall pressure. */
export function boardTierSum(minions: readonly BoardMinion[]): number {
  return minions.reduce((sum, m) => sum + (CARD_INDEX[m.cardId]?.tier ?? 1), 0);
}
