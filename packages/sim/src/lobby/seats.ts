import type { BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { autoplayRun, snapshotBoard } from '../snapshot';
import { createRun, type RunState } from '../state';
import { reduce } from '../reducer';
import { DEFAULT_BOT } from '../bots/index';
import { createController, decide, type BotControllerState } from '../productionBots/controller';
import { DIFFICULTIES, type BotDifficultyId } from '../productionBots/difficulties';
import type { PreparedBoard, SeatDriver } from './types';

/**
 * WHICH POLICY DRIVES A SEAT.
 *
 * `botSeat` originally hardcoded `DEFAULT_BOT` — the legacy greedy policy — which meant the whole production
 * bot system was measured in Ascent mode and then never actually reached the lobby it was built for. Measured
 * over 20 seeds, legacy covers 1.80 wins against the production bot's 5.60, so every seat at the table was
 * playing several times weaker than the bot that exists.
 *
 * Passing `null` selects the legacy policy explicitly, which the lobby tests still use as a baseline.
 */
export type SeatPolicy = BotDifficultyId | 'legacy';

/** One step of whichever policy drives this seat. Returns null when the policy has nothing to offer. */
function policyStep(policy: SeatPolicy, run: RunState, ctrl: { c: BotControllerState | null }): ReturnType<typeof DEFAULT_BOT.act> | null {
  if (policy === 'legacy') return DEFAULT_BOT.act(run);
  ctrl.c ??= createController('seat', policy);
  const d = decide(run, ctrl.c);
  if (!d) return null;
  ctrl.c = d.controller;
  return d.action;
}

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
  // A round EARLIER than anything recorded (a run whose first snapshot is wave 2) serves the earliest board
  // rather than nothing — otherwise the seat silently sits out round 1 and a quarter of the table never fights.
  return best ?? (snaps.length ? snaps[0]! : null);
}

const toPrepared = (snap: BoardSnapshot): PreparedBoard => ({
  // Strip run-specific instance refs the way `snapshotBoard` already does — a board that travels between runs
  // carries stats and keywords, not another run's uids.
  minions: snap.minions.map((m) => ({ ...m })) as BoardMinion[],
  tier: snap.tier,
  // …but keep the SNAPSHOT, which carries the run-level scalers the enemy side needs (see `PreparedBoard`).
  snapshot: snap,
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
 * A LIVE bot seat: a real `RunState` in `lobby` mode, shopping and scaling for as long as the lobby lasts.
 *
 * This is what makes the owner's chosen answer to the exhaustion problem work. A recorded run is 17 waves long
 * and a lobby has no round cap, so a lobby that outlives its recordings was fighting stale boards that could no
 * longer threaten anyone — measured: `repeatFinal` lobbies ground on to the 60-round hard stop. A live seat has
 * no course clock (`mode: 'lobby'`), so its board keeps growing and late rounds stay dangerous.
 *
 * Its own Resolve is bookkeeping and is deliberately ignored: the LOBBY owns this seat's health. The run still
 * fights the ordinary opponent pool for its own progression — that is what advances its waves and grows the
 * board — while the lobby resolves the fight that actually counts.
 *
 * REMAINING LIMITATION, stated plainly: it does not yet shop differently because of damage taken *in the lobby*,
 * since its shop decisions read its own Resolve. Closing that needs `faceOmen` split into
 * `prepareSeatForCombat` / `settleSeatCombat` so the lobby can drive recruit and settle the real result back.
 * That is a further step; this one buys the scaling, which is what the pacing measurement asked for.
 */
export function botSeat(seed: number, heroId?: string, label?: string, policy: SeatPolicy = 'hard'): SeatDriver {
  let run: RunState = createRun(seed, heroId, 'lobby');
  const ctrl: { c: BotControllerState | null } = { c: null };
  const terminal = (r: RunState): boolean => r.phase === 'gameover' || r.phase === 'victory';

  /** Drive the existing bot policy until the run reaches `wave` AND has actually shopped for it. */
  const advanceTo = (wave: number): void => {
    let guard = 0;
    while (run.wave < wave && !terminal(run) && guard++ < 4000) {
      const action = policyStep(policy, run, ctrl);
      if (!action) break; // the policy considers the run finished
      const next = reduce(run, action);
      if (next === run) break; // the policy offered a no-op — stop rather than spin
      run = next;
    }
    // Reaching the wave is not enough: a run that has only just arrived has an EMPTY board, because it hasn't
    // bought anything yet. Asked for a board at that moment the seat fields nothing and sits the round out —
    // measured at round 1, where it silently removed a quarter of the table from the fight. Play the shop out
    // (the policy signals it is done by reaching for `faceOmen`) so the seat brings what it actually built.
    let shopGuard = 0;
    while (run.phase === 'recruit' && run.board.length === 0 && !terminal(run) && shopGuard++ < 60) {
      const action = policyStep(policy, run, ctrl);
      if (!action) break;
      if (action.type === 'faceOmen') break; // done shopping — an empty board here is genuinely all it has
      const next = reduce(run, action);
      if (next === run) break;
      run = next;
    }
  };

  return {
    kind: 'bot',
    label: label ?? `bot#${seed}`,
    heroId: run.heroId,
    prepare: (round) => {
      advanceTo(round);
      const snap = snapshotBoard(run);
      return snap.minions.length ? toPrepared(snap) : null;
    },
    finalBoard: () => {
      const snap = snapshotBoard(run);
      return snap.minions.length ? toPrepared(snap) : null;
    },
    settle: (o) => {
      // Sync the run to the LOBBY's health. The run also fights the ordinary opponent pool for its own
      // progression, which chips its private Resolve; overwriting it here makes the lobby the single authority
      // and stops the two numbers drifting. This is what makes a live seat genuinely REACTIVE: at 4 lobby HP it
      // now shops like a minion on 4 HP, because that is what its own state says.
      run = { ...run, resolve: o.seatResolve, armor: o.seatArmor };
    },
  };
}

/**
 * OPTION 3 (owner call 2026-07-29): play the recording while it lasts, then hand the seat to a live bot.
 *
 * The recorded run is the authentic part — a real player's actual boards, in their actual order — and it is also
 * the finite part. When it runs dry the seat doesn't freeze on a stale board or vanish from the lobby; a live
 * bot picks it up and keeps scaling. The alternatives measured worse: repeating the final board grinds the lobby
 * to its hard stop, and eliminating the seat makes lobby length depend on how long a stranger's run survived
 * rather than on play.
 *
 * The handover is deliberately seeded from the SAME seed and hero as the recording, so the bot continues a run
 * of the same shape rather than dropping an unrelated board into the seat mid-lobby.
 */
export function hybridSeat(seed: number, heroId?: string, label?: string, policy: SeatPolicy = 'hard'): SeatDriver & { readonly lastRecordedWave: number } {
  const recorded = recordRun(seed, heroId, label);
  const live = botSeat(seed, heroId, label, policy);
  return {
    kind: 'recorded', // it presents as a recording — that is what the player sees for most of the lobby
    label: recorded.label,
    heroId: recorded.heroId,
    lastRecordedWave: recorded.lastWave,
    prepare: (round) => recorded.prepare(round) ?? live.prepare(round),
    finalBoard: () => live.finalBoard?.() ?? recorded.finalBoard?.() ?? null,
    settle: (o) => { recorded.settle(o); live.settle(o); },
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
