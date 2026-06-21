/**
 * Board snapshots + run replays (M3 — "difficulty learns from real player boards").
 *
 * A `BoardSnapshot` is the atom the game learns from: a normalized, serializable copy of the board a run
 * fought on a given wave. It's what gets stored in the board library and served back as a strength-matched
 * enemy — and since it's a plain `BoardMinion[]` + metadata, it drops straight into `simulate` for the
 * fight (the cardId carries the combat effects, so a served board behaves like the real one).
 *
 * A `Replay` is the *whole run* as `(seed, heroId, action-log)`. Because the engine is fully seeded, a
 * replay re-runs byte-identically — so every round's board is reconstructable headlessly from a few KB,
 * no need to store each board live. `replayRun` turns a replay into the per-wave snapshots.
 */
import type { BoardMinion, CombatOutcome, Tribe } from '@game/core';
import { createRun, type Action, type RunState } from './state';
import { reduce } from './reducer';
import type { ThreatId } from './threats';

export interface BoardSnapshot {
  /** Schema version — bump on a breaking shape change so stored snapshots can be migrated or dropped. */
  v: 1;
  wave: number;
  heroId: string;
  /** The run's 5 active tribes — context for matchmaking / filtering. */
  tribes: Tribe[];
  threat: ThreatId;
  /** The fight's outcome at capture, if known (lets the library filter to e.g. boards that won). */
  result?: CombatOutcome;
  /** Σ(attack + health) over the board — the strength index used to match opponents by wave + power. */
  power: number;
  /** The board it fought: cardId + final (recruit-buffed) stats + keywords (+ golden / summonBonus).
   *  Run-specific instance refs (linkUid, sourceUid, resummon) are dropped — they don't transfer. */
  minions: BoardMinion[];
  /** Run seed — provenance, and (with the action log) lets the exact run be replayed. */
  seed: number;
}

const sumPower = (b: BoardMinion[]): number => b.reduce((s, m) => s + m.attack + m.health, 0);

/** A clean, transferable copy of the run's board (drops run-specific instance refs). */
function cleanBoard(s: RunState): BoardMinion[] {
  return s.board.map((c) => ({
    cardId: c.cardId,
    attack: c.attack,
    health: c.health,
    keywords: [...c.keywords],
    ...(c.golden ? { golden: true } : {}),
    ...(c.summonBonus ? { summonBonus: c.summonBonus } : {}),
  }));
}

/**
 * Snapshot the board a run fought this wave. Call right after a combat is set up (`faceOmen`), when the
 * board is final and `lastCombat.result` is known. Pure — the caller stamps any wall-clock time.
 */
export function snapshotBoard(s: RunState): BoardSnapshot {
  const minions = cleanBoard(s);
  return {
    v: 1,
    wave: s.wave,
    heroId: s.heroId,
    tribes: [...s.tribes],
    threat: s.threat,
    result: s.lastCombat?.result,
    power: sumPower(minions),
    minions,
    seed: s.seed,
  };
}

export interface Replay {
  seed: number;
  heroId: string;
  actions: Action[];
}

/**
 * Re-run a recorded action log from its seed and collect a board snapshot at each wave's combat. This is
 * how `(seed, action-log)` from real play becomes the per-wave board library, headlessly + deterministically.
 */
export function replayRun(replay: Replay): { final: RunState; snapshots: BoardSnapshot[] } {
  let s = createRun(replay.seed, replay.heroId);
  const snapshots: BoardSnapshot[] = [];
  for (const action of replay.actions) {
    const before = s;
    s = reduce(s, action);
    // A snapshot is the board that *fought* — captured the moment a combat is set up (board final,
    // result computed). Rejected actions return the same ref, so guard on a real transition.
    if (action.type === 'faceOmen' && s !== before && s.lastCombat) snapshots.push(snapshotBoard(s));
  }
  return { final: s, snapshots };
}
