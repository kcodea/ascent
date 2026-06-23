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
import { CARD_INDEX } from '@game/content';
import { HEROES } from './heroes';
import { createRun, type Action, type RunState } from './state';
import { reduce } from './reducer';
import type { ThreatId } from './threats';

export interface BoardSnapshot {
  /** Schema version — bump on a breaking shape change so stored snapshots can be migrated or dropped. */
  v: 1;
  wave: number;
  heroId: string;
  /** The run's Resolve (HP) at capture — shown on the opponent frame. */
  resolve: number;
  /** Tavern tier at capture — opponent-frame intel. */
  tier: number;
  /** Triples (goldens) formed this run by capture — opponent-frame intel. */
  triples: number;
  /** The run's 5 active tribes — context for matchmaking / filtering. */
  tribes: Tribe[];
  threat: ThreatId;
  /** The fight's outcome at capture, if known (lets the library filter to e.g. boards that won). */
  result?: CombatOutcome;
  /** Σ(attack + health) over the board — the strength index used to match opponents by wave + power. */
  power: number;
  /** The board it fought: cardId + final (recruit-buffed) stats + keywords (+ golden / summonBonus).
   *  Run-specific instance refs (sourceUid, resummon) are dropped — they don't transfer. */
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
    ...(c.rallyMechAtk ? { rallyMechAtk: c.rallyMechAtk } : {}),
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
    resolve: s.resolve,
    tier: s.tier,
    triples: s.triplesMade,
    tribes: [...s.tribes],
    threat: s.threat,
    result: s.lastCombat?.result,
    power: sumPower(minions),
    minions,
    seed: s.seed,
  };
}

/**
 * The most-represented tribe on a snapshot's board, with its count — the "5 undead" intel for the
 * opponent frame. Dual-types count for both their tribes; ties resolve to the first seen on the board.
 * Null for an empty board. Looks tribes up via CARD_INDEX (snapshot minions carry only cardId).
 */
export function dominantTribe(snap: BoardSnapshot): { tribe: Tribe; count: number } | null {
  const counts = new Map<Tribe, number>();
  for (const m of snap.minions) {
    const def = CARD_INDEX[m.cardId];
    if (!def) continue;
    for (const t of [def.tribe, def.tribe2]) {
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  let best: { tribe: Tribe; count: number } | null = null;
  for (const [tribe, count] of counts) {
    if (!best || count > best.count) best = { tribe, count };
  }
  return best;
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

/**
 * The bootstrap opponent pool. A greedy bot plays a fixed set of seeded runs and we capture the per-wave
 * board it fought on — real, buildable boards (the stand-in until captured player / friend boards grow the
 * pool in step 3). Deterministic (fixed seeds + the seeded engine), so it's a *static* pool the way
 * `OPPONENT_POOL` requires (replay-faithful). The app injects it at startup; the headless harnesses + tests
 * leave the pool empty (procedural baseline) and only call this explicitly. Generate it while `OPPONENT_POOL`
 * is still empty so the bot itself faces the procedural baseline — don't bootstrap off an already-served pool.
 */
const BOOTSTRAP_SEEDS = [1, 2, 3, 7, 11, 42, 101, 777, 1000, 2024, 31337, 90210];
const BOOTSTRAP_HEROES = HEROES.map((h) => h.id); // vary the hero per seed → varied boards + opponent portraits

/** Greedily auto-play one seeded run as a given hero, capturing the board snapshot at each combat. Deterministic. */
function autoplayRun(seed: number, heroId?: string): BoardSnapshot[] {
  let s = createRun(seed, heroId);
  const snaps: BoardSnapshot[] = [];
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 5000) {
    if (s.discover) { s = reduce(s, { type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { s = reduce(s, { type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') { s = reduce(s, { type: 'resolveCombat' }); continue; }
    if (s.hand.length > 0 && s.board.length < 7) { s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); continue; }
    if (s.embers >= 3 && s.board.length + s.hand.length < 7 && s.shop[0]) { s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid }); continue; }
    if (s.tier < 6 && s.embers >= s.upgradeCost) { s = reduce(s, { type: 'upgrade' }); continue; }
    const before = s;
    s = reduce(s, { type: 'faceOmen' });
    if (s === before) break; // no progress (e.g. a blocked state) — bail rather than spin
    if (s.lastCombat) snaps.push(snapshotBoard(s));
  }
  return snaps;
}

/**
 * Build the bootstrap opponent pool: every per-wave board from the greedy bot's seeded runs. Deterministic
 * — same seeds → an identical pool. Call this once at startup, while `OPPONENT_POOL` is still empty.
 */
export function buildBootstrapPool(seeds: number[] = BOOTSTRAP_SEEDS): BoardSnapshot[] {
  return seeds.flatMap((seed, i) => autoplayRun(seed, BOOTSTRAP_HEROES[i % BOOTSTRAP_HEROES.length]));
}
