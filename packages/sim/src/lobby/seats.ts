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
 * MEMOIZED RECORDINGS. `autoplayRun` is a pure function of `(seed, heroId)` — same inputs, same boards — which is
 * exactly the property `driverFor` already leans on when it rebuilds a driver from scratch. It also costs ~100ms.
 *
 * Without a cache that cost is paid repeatedly for the SAME recording: `createRunLobby` builds each seat's driver
 * to probe it, then `resetLobbyDrivers` evicts them all so live seats start clean, so every recording is
 * immediately autoplayed a second time on first use. Caching the snapshots (not the driver, which is stateful)
 * keeps the eviction doing its job while making the rebuild free.
 */
const RECORDINGS = new Map<string, BoardSnapshot[]>();
/** Bounded so a long session of lobbies can't grow it without limit; eviction only costs a recompute. */
const RECORDING_CAP = 128;

function recordingFor(seed: number, heroId?: string): BoardSnapshot[] {
  const key = `${seed}|${heroId ?? ''}`;
  const hit = RECORDINGS.get(key);
  if (hit) return hit;
  const snaps = autoplayRun(seed, heroId);
  if (RECORDINGS.size >= RECORDING_CAP) {
    const oldest = RECORDINGS.keys().next().value;
    if (oldest !== undefined) RECORDINGS.delete(oldest);
  }
  RECORDINGS.set(key, snaps);
  return snaps;
}

/**
 * Record a run headlessly so it can hold a seat. Uses the existing autoplay + per-wave snapshot machinery, so a
 * generated seat and a real player's uploaded run are the same data shape — the prototype can prove the whole
 * loop today, and swapping in genuine uploaded runs later changes nothing but the source.
 *
 * LAZY: the autoplay doesn't run until a board is actually asked for. Constructing this driver used to be the
 * single most expensive thing in `createRunLobby` — seven recordings autoplayed synchronously before the first
 * frame of the run. Deferring it means a seat that is built only to be probed, or one whose recording is never
 * reached, costs nothing.
 */
export function recordRun(seed: number, heroId?: string, label?: string): SeatDriver & { readonly lastWave: number } {
  const name = label ?? `${heroId ?? 'run'}#${seed}`;
  let inner: (SeatDriver & { readonly lastWave: number }) | null = null;
  const rec = (): SeatDriver & { readonly lastWave: number } => (inner ??= recordedSeat(name, recordingFor(seed, heroId)));
  return {
    kind: 'recorded',
    label: name,
    // Answered from the argument when there is one, so reading it doesn't force the recording. Falling back to
    // the recording's own hero keeps the no-argument case (tests) behaving exactly as before.
    get heroId(): string { return heroId ?? rec().heroId; },
    get lastWave(): number { return rec().lastWave; },
    prepare: (round) => rec().prepare(round),
    finalBoard: () => rec().finalBoard?.() ?? null,
    settle: () => {
      /* a recording cannot react — see `recordedSeat` */
    },
  };
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
 * A recording-backed bot seat (owner call 2026-07-31: "revert to pure snapshots for bots").
 *
 * This USED to be option 3 from 2026-07-29 — play the recording while it lasts, then hand the seat to a live
 * bot. The live half turned out to be the lobby's perf regression: when Set 2 went live the recordings silently
 * died (`autoplayRun` didn't know the Runeforge and could wedge on unplayable set-2 hand cards), every seat fell
 * through to its beam-search bot from round 1, and each End Combat replayed seven bot advances on the main
 * thread — a hitch that grew with wave depth. The recordings are fixed, and the owner's call is that snapshots
 * are the destination anyway, so `prepare` is now recording-ONLY; a seat that outlives its recording is handled
 * by the lobby's `ExhaustionPolicy` (repeatFinal), not by live play.
 *
 * The live bot survives in exactly one place: `canFieldBoard`. Seat selection asks "can a bot play this hero at
 * all", and the live bot answers in ~5ms where forcing a candidate's recording costs ~100ms — and rejected
 * candidates would pay that cost for a recording nobody ever uses.
 */
export function hybridSeat(seed: number, heroId?: string, label?: string, policy: SeatPolicy = 'hard'): SeatDriver & { readonly lastRecordedWave: number } {
  const recorded = recordRun(seed, heroId, label);
  // Lazy: the probe run is only built if seat selection actually asks. A seated driver never pays for it.
  let probe: SeatDriver | null = null;
  const live = (): SeatDriver => (probe ??= botSeat(seed, heroId, label, policy));
  return {
    kind: 'recorded',
    label: recorded.label,
    // The argument when there is one (free), else the probe's — NOT the recording's, which would autoplay a
    // whole run just to name a hero.
    get heroId(): string { return heroId ?? live().heroId; },
    get lastRecordedWave(): number { return recorded.lastWave; },
    prepare: (round) => recorded.prepare(round),
    finalBoard: () => recorded.finalBoard?.() ?? null,
    canFieldBoard: () => !!(live().prepare(1) ?? live().finalBoard?.()),
    settle: (o) => recorded.settle(o),
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
