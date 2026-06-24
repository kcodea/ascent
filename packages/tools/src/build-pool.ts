/*
 * Bake the committed opponent pool. Generates a curated, deterministic `BoardSnapshot[]` and writes it to
 * `packages/sim/src/opponentPool.data.ts`, which the app loads at startup — so every player faces real,
 * buildable boards (not procedural blobs). Run: `npm run pool`.
 *
 * Sources (merged + curated):
 *   1. HOUSE boards — a greedy bot plays many seeded runs across every hero (deterministic), and we keep
 *      the per-wave board it fought. Tagged origin:'house'.
 *   2. IMPORTED boards — any `*.json` files dropped in `docs/board-exports/`, each shaped
 *      `{ "author": "Sam", "origin": "self" | "friend", "boards": BoardSnapshot[] }` (or a raw
 *      BoardSnapshot[]). This is how YOUR exported localStorage boards + friends' boards get committed:
 *      export `localStorage.getItem('ascent.boards')` to a file there, then re-run this.
 *
 * Curation: drop empty / unservable boards (cardId must exist in this build), dedupe identical boards, and
 * cap per wave with an even spread across the power range so the difficulty curve stays covered without the
 * file ballooning. Output is sorted (wave, power) for a stable, review-friendly diff.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBootstrapPool, dominantTribe, isServableBoard, opponentBoard, rateBoard, ratingBand, BAND_COUNT, type BoardSnapshot, type BotOptions } from '@game/sim';
import type { Tribe } from '@game/core';

const EXPORTS_DIR = join(process.cwd(), 'docs', 'board-exports');
const OUT_FILE = join(process.cwd(), 'packages', 'sim', 'src', 'opponentPool.data.ts');
const CAP_PER_WAVE = 24; // keep up to N boards per wave, spread across the power range
const HOUSE_SEEDS = Array.from({ length: 60 }, (_, i) => 1 + i * 1337);
const TRIBES: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon'];
const TODAY = new Date().toISOString().slice(0, 10);

/** A stable identity for a board, so identical captures (same wave/hero/minions) collapse to one. */
const signature = (s: BoardSnapshot): string =>
  `${s.wave}|${s.heroId}|` +
  s.minions
    .map((m) => `${m.cardId}:${m.attack}/${m.health}:${(m.keywords ?? []).slice().sort().join('')}${m.golden ? ':g' : ''}`)
    .sort()
    .join(',');

/** Keep up to `cap` boards from `list`, spread evenly across the power range (not clustered). */
function spreadByPower(list: BoardSnapshot[], cap: number): BoardSnapshot[] {
  if (list.length <= cap) return list;
  const sorted = [...list].sort((a, b) => a.power - b.power);
  const out: BoardSnapshot[] = [];
  for (let i = 0; i < cap; i++) out.push(sorted[Math.round((i * (sorted.length - 1)) / (cap - 1))]!);
  return out;
}

/** Keep up to `cap` boards for a wave, PREFERRING real (player/friend) boards over house — fill with all the
 *  real ones first (power-spread if they overflow), then top up with house boards. So the shipped pool is
 *  real-heavy wherever player data exists, and matchmaking faces people, not bots. */
function curateWave(boards: BoardSnapshot[], cap: number): BoardSnapshot[] {
  const real = boards.filter((s) => s.origin === 'self' || s.origin === 'friend');
  const house = boards.filter((s) => s.origin !== 'self' && s.origin !== 'friend');
  if (real.length >= cap) return spreadByPower(real, cap);
  return [...real, ...spreadByPower(house, cap - real.length)];
}

/** Read the optional imported-board exports (yours + friends'), stamping origin/author/date. */
function loadImported(): BoardSnapshot[] {
  if (!existsSync(EXPORTS_DIR)) return [];
  const out: BoardSnapshot[] = [];
  for (const file of readdirSync(EXPORTS_DIR).filter((f) => f.endsWith('.json'))) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(EXPORTS_DIR, file), 'utf8'));
      const isWrapped = parsed && typeof parsed === 'object' && Array.isArray((parsed as { boards?: unknown }).boards);
      const boards = (isWrapped ? (parsed as { boards: BoardSnapshot[] }).boards : (parsed as BoardSnapshot[])) ?? [];
      const meta = isWrapped ? (parsed as { author?: string; origin?: BoardSnapshot['origin'] }) : {};
      for (const b of boards) {
        out.push({
          ...b,
          origin: b.origin ?? meta.origin ?? 'self',
          author: b.author ?? meta.author,
          capturedAt: b.capturedAt ?? TODAY,
        });
      }
      console.log(`  + ${boards.length} imported boards from ${file}${meta.author ? ` (by ${meta.author})` : ''}`);
    } catch (e) {
      console.warn(`  ! skipped ${file}: ${(e as Error).message}`);
    }
  }
  return out;
}

console.log('Building committed opponent pool…');
const imported = loadImported();

// ── Frequency analysis: what do GOOD boards of each tribe look like at each wave? ──────────────
// Builds a (wave, tribe) → (cardId → total rating weight) table from real imported boards so the
// smart bot can imitate proven synergies instead of buying the first card it sees.
type FreqMap = Map<string, number>;
const analysis = new Map<string, FreqMap>();
for (const board of imported) {
  const dt = dominantTribe(board);
  if (!dt) continue;
  const w = board.rating ?? 0.5; // higher-rated boards contribute more
  const key = `${board.wave}|${dt.tribe}`;
  if (!analysis.has(key)) analysis.set(key, new Map());
  const fm = analysis.get(key)!;
  for (const m of board.minions) fm.set(m.cardId, (fm.get(m.cardId) ?? 0) + w);
}

/** Returns a card-weight function for a committed tribe. Falls back one wave when data is sparse. */
function cardWeightFor(tribe: Tribe): (cardId: string, wave: number) => number {
  return (cardId, wave) =>
    analysis.get(`${wave}|${tribe}`)?.get(cardId) ??
    analysis.get(`${Math.max(1, wave - 1)}|${tribe}`)?.get(cardId) ??
    0;
}

// ── House plan: 60 seeds with varying tribe commitment + fidelity ────────────────────────────
// First 10: pure greedy (no tribe, no fidelity) — produce weak, varied boards that fill early
// wave slots. Remaining 50: commit to a cycling tribe with fidelity rising 0.25 → 1.0, so the
// pool naturally spans weak (low-synergy drafts) through strong (near-optimal tribe boards).
// The existing rateBoard + spreadByPower/curateWave already sorts these into even bands.
const HOUSE_PLAN = HOUSE_SEEDS.map((seed, i) => {
  if (i < 10) return { seed, tribe: undefined as Tribe | undefined, fidelity: 0 };
  const tribe = TRIBES[(i - 10) % TRIBES.length]!;
  const fidelity = +(0.25 + ((i - 10) / (HOUSE_SEEDS.length - 10)) * 0.75).toFixed(2);
  return { seed, tribe, fidelity };
});

const house: BoardSnapshot[] = buildBootstrapPool(
  HOUSE_PLAN.map((p) => p.seed),
  (_, i): BotOptions => {
    const { tribe, fidelity } = HOUSE_PLAN[i]!;
    if (!tribe) return {};
    return { preferTribe: tribe, fidelity, cardWeight: cardWeightFor(tribe) };
  },
).map((s) => ({ ...s, origin: 'house' as const, capturedAt: TODAY }));
console.log(
  `  house: ${house.length} boards from ${HOUSE_PLAN.length} runs` +
  ` (10 greedy + 50 tribe-committed, fidelity 0.25–1.0)`,
);

// Merge → keep only servable, non-empty boards → dedupe → cap per wave (even power spread) → stable sort.
const merged = [...imported, ...house].filter((s) => s.minions.length > 0 && isServableBoard(s));
const seen = new Set<string>();
const deduped = merged.filter((s) => {
  const k = signature(s);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
const byWave = new Map<number, BoardSnapshot[]>();
for (const s of deduped) (byWave.get(s.wave) ?? byWave.set(s.wave, []).get(s.wave)!).push(s);
const pool = [...byWave.keys()]
  .sort((a, b) => a - b)
  .flatMap((w) => curateWave(byWave.get(w)!, CAP_PER_WAVE).sort((a, b) => a.power - b.power));

// Bake a simulate-derived strength rating (0..1) into every board — keyword/synergy-aware, the basis for
// true-strength matchmaking + band synthesis. Deterministic, so the committed data is stable across runs.
console.log(`  rating ${pool.length} boards (simulate gauntlet)…`);
const bands = new Array<number>(BAND_COUNT).fill(0);
for (const s of pool) {
  s.rating = +rateBoard(opponentBoard(s), s.tier).toFixed(3);
  bands[ratingBand(s.rating)]++;
}
const bandReport = bands.map((n, i) => `b${i}:${n}`).join(' ');

const waveCounts = [...byWave.keys()].sort((a, b) => a - b).map((w) => `w${w}:${Math.min(CAP_PER_WAVE, byWave.get(w)!.length)}`);
const banner = `/* AUTO-GENERATED by \`npm run pool\` (build-pool.ts) — do not edit by hand.
 * ${pool.length} boards (${imported.length} imported, ${house.length} house) across waves ${Math.min(...byWave.keys())}–${Math.max(...byWave.keys())}.
 * Regenerate after adding board exports to docs/board-exports/ or changing the card set. */`;
const body = `${banner}\nimport type { BoardSnapshot } from './snapshot';\n\nexport const OPPONENT_POOL_DATA: BoardSnapshot[] = ${JSON.stringify(pool)};\n`;

if (!existsSync(EXPORTS_DIR)) mkdirSync(EXPORTS_DIR, { recursive: true });
writeFileSync(OUT_FILE, body);
console.log(`\nWrote ${OUT_FILE}`);
console.log(`  ${pool.length} boards · per-wave: ${waveCounts.join(' ')}`);
console.log(`  rating bands (0=weak … ${BAND_COUNT - 1}=strong): ${bandReport}`);
