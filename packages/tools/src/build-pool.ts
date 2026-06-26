/*
 * Bake the committed opponent pool. Generates a curated, deterministic `BoardSnapshot[]` and writes it to
 * `packages/sim/src/opponentPool.data.ts`, which the app loads at startup — so every player faces real,
 * buildable boards (not procedural blobs). Run: `npm run pool`.
 *
 * Sources (merged + curated):
 *   1. SYNTHETIC boards — generated straight from the card set, banded to the tuned enemy curve across ALL
 *      waves 1–20 (`synthesizeWaveFromCurve`). Replaces the old house bot, which only survived to ~wave 9 and
 *      left waves 10–20 empty. Tagged origin:'synthetic'.
 *   2. IMPORTED boards — any `*.json` files dropped in `docs/board-exports/`, each shaped
 *      `{ "author": "Sam", "origin": "self" | "friend", "boards": BoardSnapshot[] }` (or a raw
 *      BoardSnapshot[]). This is how YOUR exported localStorage boards + friends' boards get committed:
 *      export `localStorage.getItem('ascent.boards')` to a file there, then re-run this. Real boards are
 *      PREFERRED over synthetic during curation, so the pool faces people wherever player data exists.
 *
 * Curation: drop empty / unservable boards (cardId must exist in this build), dedupe identical boards, and
 * cap per wave with an even spread across the power range so the difficulty curve stays covered without the
 * file ballooning. Output is sorted (wave, power) for a stable, review-friendly diff.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { buildWaveLadders, isServableBoard, opponentBoard, rateBoardForWave, ratingBand, synthesizeWaveFromCurve, BAND_COUNT, type BoardSnapshot } from '@game/sim';

const EXPORTS_DIR = join(process.cwd(), 'docs', 'board-exports');
const OUT_FILE = join(process.cwd(), 'packages', 'sim', 'src', 'opponentPool.data.ts');
const CAP_PER_WAVE = 24; // keep up to N boards per wave, spread across the power range
const MAX_WAVE = 20; // synthesize a pool spanning every wave a run can reach
const SYNTH_PER_WAVE = 8; // boards generated per wave, spread weak→strong across the wave's power band
const PROC_SEEDS = 4; // procedural reference seeds per threat (the band sampler + the rating ladder)
const TODAY = new Date().toISOString().slice(0, 10);
// The build these boards are baked under — `<pkg version>+<short git sha>` (mirrors apps/web/vite.config.ts).
const PKG_VERSION = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;
const GIT_SHA = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; } })();
const PATCH = `${PKG_VERSION}+${GIT_SHA}`;

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

/** Keep up to `cap` boards for a wave, PREFERRING real (player/friend) boards over synthetic — fill with all
 *  the real ones first (power-spread if they overflow), then top up with synthetic. So the shipped pool is
 *  real-heavy wherever player data exists, and matchmaking faces people, not generated boards. */
function curateWave(boards: BoardSnapshot[], cap: number): BoardSnapshot[] {
  const real = boards.filter((s) => s.origin === 'self' || s.origin === 'friend');
  const rest = boards.filter((s) => s.origin !== 'self' && s.origin !== 'friend');
  if (real.length >= cap) return spreadByPower(real, cap);
  return [...real, ...spreadByPower(rest, cap - real.length)];
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

// ── Calibration ladders: the tuned PROCEDURAL enemy curve at every wave 1–20 (no bot — it tops out at ~wave 9)
// PLUS any imported real boards folded in for a real high-wave ceiling. This is what bands the synthetic pool.
console.log(`  building wave calibration ladders (procedural enemy curve 1–${MAX_WAVE} + ${imported.length} imported)…`);
const ladders = buildWaveLadders([], [], imported, { proceduralWaves: MAX_WAVE, proceduralSeeds: PROC_SEEDS });

// ── Synthesize the pool: SYNTH_PER_WAVE boards per wave, banded to the enemy curve, filled with real tribe
// cards (so synergies/keywords/effects are real). Deterministic per-wave seed; covers waves 1–MAX_WAVE.
const synthetic: BoardSnapshot[] = [];
for (let wave = 1; wave <= MAX_WAVE; wave++) {
  synthetic.push(...synthesizeWaveFromCurve(wave, ladders, 7919 * wave + 13, {
    perWave: SYNTH_PER_WAVE, proceduralSeeds: PROC_SEEDS, patch: PATCH, capturedAt: TODAY,
  }));
}
console.log(`  synthesized ${synthetic.length} boards across waves 1–${MAX_WAVE} (${SYNTH_PER_WAVE}/wave, curve-banded)`);

// Merge → keep only servable, non-empty boards → dedupe.
const merged = [...imported, ...synthetic].filter((s) => s.minions.length > 0 && isServableBoard(s));
const seen = new Set<string>();
const deduped = merged.filter((s) => {
  const k = signature(s);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// Rate any board that doesn't already carry one (synthetic boards are pre-rated against these same ladders;
// imported real boards need it) — wave-relative, so a board that's gone weak for its wave reads as a low band.
console.log(`  rating ${deduped.filter((s) => s.rating === undefined).length} unrated boards (wave-relative)…`);
for (const s of deduped) if (s.rating === undefined) s.rating = +rateBoardForWave(opponentBoard(s), s.wave, ladders, s.tier).toFixed(3);

// Group by wave → cap per wave (prefer real boards, even power spread) → stable sort by power.
const byWave = new Map<number, BoardSnapshot[]>();
for (const s of deduped) (byWave.get(s.wave) ?? byWave.set(s.wave, []).get(s.wave)!).push(s);
const waves = [...byWave.keys()].sort((a, b) => a - b);
const pool = waves.flatMap((w) => curateWave(byWave.get(w)!, CAP_PER_WAVE).sort((a, b) => a.power - b.power));

// Band coverage: global histogram + each wave's count and band span, so an all-weak wave is obvious.
const bands = new Array<number>(BAND_COUNT).fill(0);
for (const s of pool) bands[ratingBand(s.rating ?? 0)]++;
const bandReport = bands.map((n, i) => `b${i}:${n}`).join(' ');
const perWave = waves.map((w) => {
  const bs = pool.filter((s) => s.wave === w).map((s) => ratingBand(s.rating ?? 0));
  return `w${w}:${bs.length}[b${Math.min(...bs)}–b${Math.max(...bs)}]`;
});

const poolReal = pool.filter((s) => s.origin === 'self' || s.origin === 'friend').length;
const poolSynth = pool.filter((s) => s.origin === 'synthetic').length;
const banner = `/* AUTO-GENERATED by \`npm run pool\` (build-pool.ts) — do not edit by hand.
 * ${pool.length} boards (${poolSynth} synthetic + ${poolReal} imported, baked under ${PATCH}) across waves ${waves[0]}–${waves[waves.length - 1]}.
 * Synthetic boards are generated from the card set, banded to the tuned enemy curve. Regenerate after adding
 * board exports to docs/board-exports/ or changing the card set. See docs/board-pool.md. */`;
const body = `${banner}\nimport type { BoardSnapshot } from './snapshot';\n\nexport const OPPONENT_POOL_DATA: BoardSnapshot[] = ${JSON.stringify(pool)};\n`;

if (!existsSync(EXPORTS_DIR)) mkdirSync(EXPORTS_DIR, { recursive: true });
writeFileSync(OUT_FILE, body);
console.log(`\nWrote ${OUT_FILE}`);
console.log(`  ${pool.length} boards · ${poolSynth} synthetic · ${poolReal} imported`);
console.log(`  bands (0=weak-for-wave … ${BAND_COUNT - 1}=strong): ${bandReport}`);
console.log(`  per-wave count[band span]: ${perWave.join(' ')}`);
