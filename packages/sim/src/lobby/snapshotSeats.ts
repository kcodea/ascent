import type { SetId } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import type { RunCosmeticSnapshot } from '@game/progression';
import { OPPONENT_POOL } from '../opponents';
import { CONFIG } from '../config';
import { MAX_FIRST_WAVE, MAX_MISSING_WAVES, recordedSeat, type SeatPolicy } from './seats';
import type { PreparedBoard, SeatDriver } from './types';

/**
 * REAL PLAYER RUNS AS LOBBY SEATS.
 *
 * The lobby's seat drivers were built for this from the start — `recordedSeat` replays someone's actual boards
 * in wave order — but nothing ever fed them real data, so every seat was a bot. This is the wiring: group the
 * registered opponent pool back into the RUNS it came from, and hand each one to a seat.
 *
 * The boards are Ascent-mode snapshots (owner call 2026-07-29: use those for now). That is a real approximation
 * and worth naming — an Ascent board was built against the 17-round course, not against a lobby's damage race —
 * but it is a player's genuine build order, which is the part bots cannot fake.
 */

/** One player's run, reassembled from its per-wave boards. */
export interface PlayerRun {
  /** Stable identity, and the only thing a serialized seat stores — see `snapshotSeat`. */
  key: string;
  author: string;
  heroId: string;
  /** The uploading account (`BoardSnapshot.ownerId`), when the shared pool stamped it. */
  ownerId?: string;
  /** Per-wave boards, ascending. */
  snaps: BoardSnapshot[];
  /** The run's strength percentile (1-100) as the shared pool delivered it (`BoardSnapshot.runStrength`, stamped
   *  by the client from `pool_runs.strength`). Absent = unscored, which is inside every matchmaking band. */
  strength?: number;
  /** The skins the run's owner wore: the UNION of every board's scoped `cosmetics` (a card skinned on wave 9 is
   *  known to the seat from round 1). Absent for runs from before skins. */
  cosmetics?: RunCosmeticSnapshot;
}

/** Union of the boards' recorded skins (first wins per key; a run records one loadout, so they agree). */
function runCosmetics(snaps: readonly BoardSnapshot[]): RunCosmeticSnapshot | undefined {
  const hero: Record<string, string> = {};
  const minion: Record<string, string> = {};
  let attack: string | undefined;
  let title: string | undefined;
  for (const s of snaps) {
    for (const [k, v] of Object.entries(s.cosmetics?.heroSkinByHeroId ?? {})) if (!(k in hero) && typeof v === 'string') hero[k] = v;
    for (const [k, v] of Object.entries(s.cosmetics?.minionSkinByCardId ?? {})) if (!(k in minion) && typeof v === 'string') minion[k] = v;
    // The account-wide hero attack (2026-09-28): first board that recorded one wins, like the skins.
    if (attack === undefined && typeof s.cosmetics?.heroAttack === 'string') attack = s.cosmetics.heroAttack;
    if (title === undefined && typeof s.cosmetics?.title === 'string') title = s.cosmetics.title;
  }
  if (!Object.keys(hero).length && !Object.keys(minion).length && !attack && !title) return undefined;
  return {
    ...(Object.keys(hero).length ? { heroSkinByHeroId: hero } : {}), ...(Object.keys(minion).length ? { minionSkinByCardId: minion } : {}),
    ...(attack ? { heroAttack: attack } : {}), ...(title ? { title } : {}),
  };
}

/**
 * A RUN MUST COVER THE ROUNDS IT WILL BE ASKED FOR (fix 2026-09-29, R-LOBBY-07).
 *
 * `recordedSeat` serves "the board of this wave, else the closest EARLIER one, else the EARLIEST one". That is
 * right for a whole recording, but the client pool is pulled per wave (the newest N boards of each wave), and the
 * early waves hold far more rows than the late ones (every run has a wave 3, few reach wave 13). So an older run
 * keeps its late boards and loses its early ones, and the reassembled run starts at, say, wave 10. Seated in a
 * lobby, round 5 asked for a board the run did not have, fell through to "the earliest one" and served the run's
 * WAVE-10 board: a friend faced a tier-6 board of 7 Beasts on round 5 (owner report 2026-09-29).
 *
 * So a run is seated only when its recording starts by wave `MAX_FIRST_WAVE` and never skips more than
 * `MAX_MISSING_WAVES` wave in a row (a lone missing wave is normal: empty boards are not uploaded). A run that
 * fails either is incomplete material, not a player's build order, and is left out. Measured on the live pool
 * 2026-09-29: complete runs start at wave 1 or 2 (140 of 146) and never miss more than one wave in a row; the
 * runs this drops are the ones the per-wave pull cut in half (plus six that start at waves 3 to 5, which would
 * otherwise serve a later board in rounds 1 to 4).
 *
 * ROOT CAUSE FIXED the same day (R-LOBBY-08): the pool now arrives as WHOLE RUNS (`registerOpponentRuns`, the
 * `pool_runs_sample` RPC), so a cut-down run never reaches this function from the shared pool. This check stays
 * as defence in depth, and the SQL eligibility mirrors it so the server never spends a pick on a run it drops.
 */
export { MAX_FIRST_WAVE, MAX_MISSING_WAVES };
/** A run is only worth a seat if it has enough material to hold one for a while. */
export const MIN_RUN_WAVES = 4;
const MIN_WAVES = MIN_RUN_WAVES;

/** Does this run's recording (ascending, one board per wave) cover every round it could be asked for? */
export function runCoversItsRounds(ordered: readonly BoardSnapshot[]): boolean {
  return runWavesCover(ordered.map((s) => s.wave));
}

/** `runCoversItsRounds` over bare wave numbers (any order, duplicates allowed). The pool fetch's fallback path
 *  uses it to pre-screen runs from a light listing before downloading their boards, and the SQL `pool_runs`
 *  eligibility mirrors it (parity-tested in `poolRuns.db.test.ts`). */
export function runWavesCover(waves: readonly number[]): boolean {
  const ws = [...new Set(waves)].sort((a, b) => a - b);
  if (!ws.length || ws[0]! > MAX_FIRST_WAVE) return false;
  for (let i = 1; i < ws.length; i++) {
    if (ws[i]! - ws[i - 1]! - 1 > MAX_MISSING_WAVES) return false;
  }
  return true;
}

/** A run's identity, the key a seat stores: `author|heroId|seed` (GAME-RULES, "sides named by run key"). */
export const runKeyOf = (s: Pick<BoardSnapshot, 'author' | 'heroId' | 'seed'>): string => `${s.author ?? 'anon'}|${s.heroId}|${s.seed}`;

/**
 * THE PER-PLAYER SEAT CAP (owner 2026-09-29: "let's have a cap of 4 snapshots from a player i guess, so it's not
 * literally like 7 of me always or something"). Selection stays a uniform shuffle over every whole run; a run
 * whose player already holds this many seats is passed over for the next one in the shuffle (R-LOBBY-08).
 */
export const MAX_SEATS_PER_PLAYER = 4;

/** Who a run belongs to, for the seat cap: the uploading account when the pool stamped it, else the display
 *  author (a run with neither is nobody's, and is never capped). */
export function runOwnerOf(run: Pick<PlayerRun, 'ownerId' | 'author'>): string | null {
  if (run.ownerId) return `id:${run.ownerId}`;
  return run.author && run.author !== 'anon' ? `name:${run.author.toLowerCase()}` : null;
}

/**
 * The highest shop tier a board can PLAUSIBLY show at a wave: the tier a player reaches by spending every Gold of
 * the base economy on tavern-ups (start Gold, +1 per wave to the cap, the tier-up cost falling by the per-wave
 * discount), plus `TIER_SLACK` for everything that bends the economy (Gold makers, tier-up discounts, hero
 * powers, runes). Deliberately generous: it exists to reject a board no real game could have built by that wave
 * (a dev-altered run, or a board filed under the wrong wave), never to judge a strong one. The greedy curve is
 * 1,2,2,3,4,4,5,6 for waves 1 to 8, so the bound is 3 at wave 1, 4 at waves 2 and 3, 5 at wave 4 and 6 from wave
 * 5 on. The live pool's highest board against it (a Runesmith at tier 6 on wave 6) sits inside it.
 */
export const TIER_SLACK = 2;
const GREEDY_TIER: readonly number[] = (() => {
  const out = [1];
  let tier = 1;
  let cost = CONFIG.upgradeCost[2] ?? Infinity;
  for (let wave = 1; wave <= 40; wave++) {
    const gold = Math.min(CONFIG.startEmbers + (wave - 1) * CONFIG.embersPerWave, CONFIG.embersCap);
    if (wave > 1) cost = Math.max(CONFIG.upgradeCostFloor, cost - CONFIG.upgradeDiscountPerWave);
    if (tier < CONFIG.maxTier && gold >= cost) {
      tier++;
      cost = CONFIG.upgradeCost[tier + 1] ?? Infinity;
    }
    out[wave] = tier;
  }
  return out;
})();

/** See `TIER_SLACK`. */
export function maxPlausibleTier(wave: number): number {
  const w = Math.max(1, Math.min(Math.floor(wave), GREEDY_TIER.length - 1));
  return GREEDY_TIER[w]! + TIER_SLACK;
}

/** Is every board of this run one a real game could have built by its wave? */
export function runTiersPlausible(ordered: readonly BoardSnapshot[]): boolean {
  return ordered.every((s) => typeof s.tier !== 'number' || s.tier <= maxPlausibleTier(s.wave));
}

/**
 * Group snapshots back into runs.
 *
 * Synthetic boards are excluded: they are generated per-wave against a power curve and were never a single
 * player's run, so stringing them together would fake a build order that never existed.
 */
export function playerRunsFrom(
  pool: readonly BoardSnapshot[] = OPPONENT_POOL,
  minWaves = MIN_WAVES,
  /** The SET the asking run is pinned to. Boards from another set are excluded outright — their minions are
   *  that set's cards, so seating one would field set-1 bodies against a set-2 board. Filtered HERE rather than
   *  at registration for the same reason `nextOpponent` does it: the registry is shared across every run in the
   *  session, and two runs on different sets must both find their own boards. Absent = no filter, which is what
   *  the tools and tests that predate sets expect. */
  setId?: SetId,
): PlayerRun[] {
  const byRun = new Map<string, BoardSnapshot[]>();
  for (const s of pool) {
    if ((s.origin ?? 'house') === 'synthetic') continue;
    if (!s.minions?.length) continue;
    if (setId && (s.setId ?? 'set1') !== setId) continue; // legacy boards predate sets → they are set 1
    const key = runKeyOf(s);
    const list = byRun.get(key);
    if (list) list.push(s);
    else byRun.set(key, [s]);
  }
  const runs: PlayerRun[] = [];
  for (const [key, snaps] of byRun) {
    // One board per wave — a run replayed twice, or re-uploaded, can carry duplicates.
    const byWave = new Map<number, BoardSnapshot>();
    for (const s of snaps) if (!byWave.has(s.wave)) byWave.set(s.wave, s);
    const ordered = [...byWave.values()].sort((a, b) => a.wave - b.wave);
    if (ordered.length < minWaves) continue;
    // Incomplete (early waves cut off by the per-wave pull) or implausible material never takes a seat
    // (R-LOBBY-07; see `runCoversItsRounds` / `maxPlausibleTier` above).
    if (!runCoversItsRounds(ordered) || !runTiersPlausible(ordered)) continue;
    const cosmetics = runCosmetics(ordered);
    const ownerId = ordered.find((x) => x.ownerId)?.ownerId;
    const strength = snaps.find((x) => typeof x.runStrength === 'number')?.runStrength;
    runs.push({
      key, author: ordered[0]!.author ?? 'anon', heroId: ordered[0]!.heroId, snaps: ordered,
      ...(ownerId ? { ownerId } : {}), ...(cosmetics ? { cosmetics } : {}), ...(typeof strength === 'number' ? { strength } : {}),
    });
  }
  // Deterministic order — the pool's iteration order is an accident of registration, and seat selection must
  // reproduce across sessions and replays.
  return runs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Look one up by key. Returns null when the pool of this session doesn't contain that run. */
export const playerRunByKey = (key: string, pool: readonly BoardSnapshot[] = OPPONENT_POOL, setId?: SetId): PlayerRun | null =>
  playerRunsFrom(pool, MIN_WAVES, setId).find((r) => r.key === key) ?? null;

/**
 * A seat driven by a real player's run: their actual boards while the recording lasts, then a live bot.
 *
 * Same hand-off rule the generated hybrid seat uses (owner call 2026-07-29) and for the same reason — a
 * recording is finite and a lobby has no fixed length, so freezing on a stale board or vacating the seat both
 * distort the game. The bot picks up seeded from the run's own identity so the continuation has the shape of
 * the run it follows rather than dropping an unrelated board into the seat mid-lobby.
 */
export function snapshotSeat(run: PlayerRun, _policy: SeatPolicy = 'hard'): SeatDriver & { readonly lastRecordedWave: number } {
  const label = run.author && run.author !== 'anon' ? run.author : `run ${run.key.slice(-4)}`;
  const recorded = recordedSeat(label, run.snaps);
  const lastRecordedWave = recorded.lastWave;
  return {
    kind: 'recorded',
    label,
    heroId: run.heroId,
    lastRecordedWave,
    // Recording-ONLY (owner call 2026-07-31, same as the generated hybrid seat in the same day's perf fix): a
    // dried-out seat returns null and the lobby's ExhaustionPolicy (repeatFinal) decides, instead of a live
    // beam-search bot inheriting the seat and stalling End Combat. The continuation-bot seeding this replaces
    // lived here from 2026-07-29; the pure-snapshot direction retires it.
    prepare: (round) => recorded.prepare(round),
    finalBoard: (): PreparedBoard | null => recorded.finalBoard?.() ?? null,
    settle: (o) => recorded.settle(o),
  };
}
