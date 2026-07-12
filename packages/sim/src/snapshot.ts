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
import { makeRng, type BoardMinion, type CombatOutcome, type Rng, type Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { HEROES } from './heroes';
import { createRun, type Action, type RunState, type ShopCard } from './state';
import { reduce } from './reducer';
import { spellAttackBonus, spellHealthBonus } from './recruit';
import type { ThreatId } from './threats';

/** Where a pool board came from. 'self' = your own captured run; 'friend' = a friend's imported board;
 *  'house' = a board shipped with the game (seeded bot runs); 'synthetic' = computer-generated within a
 *  power band. Missing on a legacy snapshot → treat as 'house'. */
export type BoardOrigin = 'self' | 'friend' | 'house' | 'synthetic';

export interface BoardSnapshot {
  /** Schema version — bump on a breaking shape change so stored snapshots can be migrated or dropped. */
  v: 1;
  /** Stable client-stamped identity (a UUID), set by the UI capture layer when a finished run's boards are
   *  saved/uploaded — the key the fight-result ledger (`board_results`) attributes wins/losses to. Travels in
   *  the snapshot jsonb, so a board served as an opponent carries the id its owner stamped; the run's final board
   *  reuses its wave's id so the leaderboard slot and the served round-17 opponent share one identity. Absent on
   *  committed/synthetic boards + legacy captures (those are simply untracked). Never read by combat/matchmaking. */
  id?: string;
  wave: number;
  /** Combats WON before this board fought — the matchmaking key. You face a board with the same win count
   *  (the same point in its owner's climb), not the same wave. Optional for back-compat (missing → wave). */
  wins?: number;
  heroId: string;
  /** The run's Resolve (HP) at capture — shown on the opponent frame. */
  resolve: number;
  /** The run's Armor (extra effective HP) at capture — opponent-frame intel. Optional for back-compat:
   *  legacy captures + synthetic boards lack it → treated as 0 (no "+armor" shown). */
  armor?: number;
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
  /** Provenance of this board in the opponent pool (self / friend / house / synthetic). Optional for
   *  back-compat with legacy captures; missing → treated as 'house'. Stamped by the capture/build layer. */
  origin?: BoardOrigin;
  /** True for boards pulled from the live Supabase shared pool this session (stamped in `fetchAndRegisterPool`).
   *  `origin` can't distinguish these — another player's uploaded board and your own local capture are both
   *  `'self'` — so `pickOpponent` uses this flag to prefer the live shared pool. Absent for committed +
   *  local-captured boards. */
  remote?: boolean;
  /** Display name of the board's author — you or a friend. Shown on the opponent frame ("by Sam"). */
  author?: string;
  /** ISO date (YYYY-MM-DD) the board was captured or generated. Wall-clock, so it's stamped by the UI/tool
   *  layer (never inside the pure `snapshotBoard`, which must stay deterministic). */
  capturedAt?: string;
  /** The build this board was captured / baked under (`<pkg version>+<short git sha>`, e.g. `0.1.0+a1b2c3d`).
   *  Lets us identify + prune boards from old patches once the meta shifts. Stamped by the UI/tool layer (the
   *  pure `snapshotBoard` stays deterministic). Optional for back-compat (legacy boards lack it). */
  patch?: string;
  /** Wave-relative strength rating (0..1) — fraction of THIS WAVE's calibration ladder the board beats (see
   *  `rateBoardForWave`). Keyword/synergy-aware AND wave-relative (a strong wave-3 board ≠ a strong wave-15
   *  board), unlike `power`. Baked by `npm run pool`; the basis for pool curation / pruning weak boards.
   *  Optional (legacy/runtime boards may lack it). */
  rating?: number;
  /** The owner's run-LEVEL combat scalers at capture — so when this board is served as an opponent, its
   *  Grim / Taragosa / Watcher / Hoardbreaker / Pack Leader / Runescale scale with the value THIS run had, not
   *  the current player's (threaded per-side into `simulate` as `enemyScalers`). All optional / omitted when 0;
   *  legacy + procedural boards lack them → treated as 0 (the card's printed base, which is then accurate). */
  spellPower?: { attack: number; health: number }; // hero amplify + card spell bonus (Taragosa/Watcher/Hoardbreaker)
  deathrattles?: number; // Deathrattles triggered this game so far (Grim)
  spellsThisTurn?: number; // spells cast this recruit turn (Runescale Drake)
  beastsPlayed?: number; // Beasts played this recruit turn (Pack Leader)
}

/**
 * Controls the smart bot's card-picking behaviour in `autoplayRun`. All fields optional so callers
 * can mix-and-match: tribe commitment alone already produces far better boards than the pure greedy
 * bot; layering in `cardWeight` (from real-board frequency analysis) and `fidelity` lets you dial the
 * output anywhere from "weak early board" to "peak tribe synergy".
 */
export interface BotOptions {
  /** Commit to this tribe: tribe-matching cards score +3, neutrals +1, off-tribe +0. */
  preferTribe?: Tribe;
  /**
   * Per-card frequency weight derived from real board analysis — higher = more preferred.
   * Called with `(cardId, wave)` so the bot can prefer different cards as the run progresses.
   */
  cardWeight?: (cardId: string, wave: number) => number;
  /**
   * 0..1 — how often the bot takes the highest-scored shop card instead of a random one.
   * 1.0 = always optimal (peak power); 0.0 = always random (current greedy baseline).
   * Values in between spread output across the power spectrum without any extra logic.
   */
  fidelity?: number;
}

function scoreCard(cardId: string, wave: number, opts: BotOptions): number {
  const def = CARD_INDEX[cardId];
  if (!def) return 0;
  let score = 0;
  if (opts.preferTribe) {
    score += def.tribe === opts.preferTribe || def.tribe2 === opts.preferTribe ? 3
      : def.tribe === 'neutral' ? 1
      : 0;
  }
  if (opts.cardWeight) score += opts.cardWeight(cardId, wave);
  return score;
}

function pickBuyTarget(shop: ShopCard[], wave: number, opts: BotOptions, rng: Rng): string {
  const fidelity = opts.fidelity ?? 1;
  if (fidelity <= 0) return shop[0]!.uid; // no preference — greedy first-card
  const scored = [...shop]
    .map((c) => ({ uid: c.uid, score: scoreCard(c.cardId, wave, opts) }))
    .sort((a, b) => b.score - a.score);
  // With probability `fidelity` take the best-scored card; otherwise pick uniformly at random.
  if (rng.int(100) < Math.round(fidelity * 100)) return scored[0]!.uid;
  return scored[rng.int(scored.length)]!.uid;
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
    ...(c.addedTribes && c.addedTribes.length ? { addedTribes: [...c.addedTribes] } : {}), // Anomaly Reactor: a spell-added tribe (combat folds it into tribe2; the display badge reads it)
    ...(c.bloodlust ? { bloodlust: true } : {}), // Bloodlust: a pending Start-of-Combat immune out-of-turn strike
    ...(c.summonBonus ? { summonBonus: c.summonBonus } : {}),
    ...(c.rallyMechAtk ? { rallyMechAtk: c.rallyMechAtk } : {}),
    ...(c.rallySpellWeld ? { rallySpellWeld: c.rallySpellWeld } : {}),
    // Per-minion accruals, so a board served as an opponent is as strong AND reads as accurately as the board
    // it was captured from (combat seeds each from the BoardMinion — see minion.ts; `opponentBoard` restores
    // them symmetrically): Sergeant's improved Deathrattle HP-grant, Tara's ascend progress, Guel's on-board
    // spell tally, Flowing Monk's triple-combine bonus. Without these a served minion showed its printed base
    // rule text and fought weaker than the real board did.
    ...(c.hpGrantBonus ? { hpGrantBonus: c.hpGrantBonus } : {}),
    ...(c.ascendProgress ? { ascendProgress: c.ascendProgress } : {}),
    ...(c.spellProgress ? { spellProgress: c.spellProgress } : {}), // Archmagus Guel: on-board spell tally
    ...(c.overflowBonus ? { overflowBonus: c.overflowBonus } : {}), // Flowing Monk: flat triple-combine grant bonus
    // Per-source recruit-buff breakdown ("Spirit Fire ×2: +6/+6") — carried so a captured board can show
    // HOW its minions were buffed in the right-click inspect (leaderboard / served opponent). Cloned so the
    // snapshot never shares the run board's arrays.
    ...(c.buffs && c.buffs.length ? { buffs: c.buffs.map((b) => ({ ...b })) } : {}),
  }));
}

/**
 * Snapshot the board a run fought this wave. Call right after a combat is set up (`faceOmen`), when the
 * board is final and `lastCombat.result` is known. Pure — the caller stamps any wall-clock time.
 */
export function snapshotBoard(s: RunState): BoardSnapshot {
  const minions = cleanBoard(s);
  // Run-LEVEL combat scalers at capture, so a served opponent's Grim / Taragosa / Pack Leader / Runescale
  // scales with the value THIS run had (threaded per-side into simulate as `enemyScalers`). Beasts-played
  // mirrors the reducer's own combat derivation (playedThisTurn, filtered to Beasts). Each field is omitted
  // when 0 so plain boards stay lean and legacy captures (no field → 0) read the card's accurate printed base.
  const spellPowerAtk = spellAttackBonus(s);
  const spellPowerHp = spellHealthBonus(s);
  const beastsPlayed = (s.playedThisTurn ?? []).filter((id) => {
    const d = CARD_INDEX[id];
    return !!d && (d.tribe === 'beast' || d.tribe2 === 'beast');
  }).length;
  return {
    v: 1,
    wave: s.wave,
    wins: s.history.reduce((n, r) => (r === 'win' ? n + 1 : n), 0),
    heroId: s.heroId,
    resolve: s.resolve,
    ...(s.armor ? { armor: s.armor } : {}),
    tier: s.tier,
    triples: s.triplesMade,
    tribes: [...s.tribes],
    threat: s.threat,
    result: s.lastCombat?.result,
    power: sumPower(minions),
    minions,
    seed: s.seed,
    ...(spellPowerAtk || spellPowerHp ? { spellPower: { attack: spellPowerAtk, health: spellPowerHp } } : {}),
    ...(s.deathrattlesTriggered ? { deathrattles: s.deathrattlesTriggered } : {}),
    ...(s.spellsThisTurn ? { spellsThisTurn: s.spellsThisTurn } : {}),
    ...(beastsPlayed ? { beastsPlayed } : {}),
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
function autoplayRun(seed: number, heroId?: string, opts?: BotOptions): BoardSnapshot[] {
  let s = createRun(seed, heroId);
  // Separate RNG for bot pick decisions — doesn't touch the game's own seeded stream.
  const botRng: Rng | null = opts?.preferTribe || opts?.cardWeight ? makeRng(seed ^ 0xb07b07) : null;
  const snaps: BoardSnapshot[] = [];
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 5000) {
    if (s.questOffer) { s = reduce(s, { type: 'buyQuest', index: 0 }); continue; } // quest shop (waves 4/8/12) → buy to open the turn
    if (s.discover) {
      let idx = 0;
      if (opts?.preferTribe) {
        // Pick the first discover option that matches the committed tribe; default to 0.
        for (let i = 0; i < s.discover.length; i++) {
          const def = CARD_INDEX[s.discover[i]!];
          if (def?.tribe === opts.preferTribe || def?.tribe2 === opts.preferTribe) { idx = i; break; }
        }
      }
      s = reduce(s, { type: 'discover', index: idx });
      continue;
    }
    if (s.chooseOne) { s = reduce(s, { type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') { s = reduce(s, { type: 'resolveCombat' }); continue; }
    if (s.hand.length > 0 && s.board.length < 7) { s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); continue; }
    if (s.embers >= 3 && s.board.length + s.hand.length < 7 && s.shop.length > 0) {
      const uid = opts && botRng ? pickBuyTarget(s.shop, s.wave, opts, botRng) : s.shop[0]!.uid;
      s = reduce(s, { type: 'buy', uid });
      continue;
    }
    if (s.tier < 6 && s.embers >= s.upgradeCost) { s = reduce(s, { type: 'upgrade' }); continue; }
    const before = s;
    s = reduce(s, { type: 'faceOmen' });
    if (s === before) break; // no progress — bail rather than spin
    if (s.lastCombat) snaps.push(snapshotBoard(s));
  }
  return snaps;
}

/**
 * Build the bootstrap opponent pool: every per-wave board from the greedy bot's seeded runs. Deterministic
 * — same seeds → an identical pool. Call this once at startup, while `OPPONENT_POOL` is still empty.
 *
 * `optsFor` is optional: when provided, it returns per-run `BotOptions` (tribe commitment, frequency
 * weights, fidelity) so `build-pool.ts` can produce boards across the full power spectrum instead of
 * pure greedy output. Omitting it (or returning `{}`) preserves the original greedy behaviour.
 */
export function buildBootstrapPool(
  seeds: number[] = BOOTSTRAP_SEEDS,
  optsFor?: (seed: number, idx: number) => BotOptions,
): BoardSnapshot[] {
  return seeds.flatMap((seed, i) =>
    autoplayRun(seed, BOOTSTRAP_HEROES[i % BOOTSTRAP_HEROES.length], optsFor?.(seed, i)),
  );
}
