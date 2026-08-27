/**
 * DOC BOT — COVERAGE-GUIDED CORPUS (handoff §9.1 + §15 nightly/fuzz tests, PR 8).
 *
 * Three contracts:
 *   1. DETERMINISM — the same config builds a byte-identical corpus, twice. This is what makes a corpus
 *      fixture trustworthy evidence: nothing about it depends on machine, ordering, or wall clock.
 *   2. SABOTAGE (§3.5) — a doctored seed list must ALARM (different digest). The digest is the alarm the
 *      determinism assertion rests on, so the test proves the alarm can actually ring: if `corpusDigest`
 *      ever degenerates into a constant, this goes red for the intended reason.
 *   3. The CHECKED-IN corpus (regenerate: `npm run docbot:corpus`) still validates and runs green — every
 *      fixture parses, passes schema validation against CURRENT content, and its invariant expectations
 *      hold when executed through the real engine. Content drift that invalidates a fixture fails HERE
 *      with the validator's actionable message (regenerate the corpus in that PR).
 *
 * Deliberately NOT asserted: that the checked-in corpus byte-matches a fresh build. Any content change
 * shifts shop rolls and would force a regeneration on nearly every content PR — the corpus is coverage
 * evidence, not a golden. Fixtures stay useful as long as they validate and run; the nightly's coverage
 * count is the freshness signal.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stableStringify, parseQaScenario, runQaScenario } from '../qaScenario';
import { buildCoverageCorpus, corpusDigest, CORPUS_CONFIG, type CorpusConfig } from './corpusBuilder';

const CORPUS_DIR = join(process.cwd(), 'packages', 'sim', 'src', 'docbot', 'corpus');

/** A trimmed config for the double-build determinism proof — same machinery, PR-gate-sized. */
const SMALL: CorpusConfig = { seeds: CORPUS_CONFIG.seeds.slice(0, 6), steps: CORPUS_CONFIG.steps };

describe('Doc Bot — coverage-guided corpus (§9.1)', () => {
  it('same config → byte-identical corpus (fixtures, key report, digest)', () => {
    const a = buildCoverageCorpus(SMALL);
    const b = buildCoverageCorpus(SMALL);
    expect(corpusDigest(b)).toBe(corpusDigest(a));
    expect(stableStringify(b)).toBe(stableStringify(a));
    expect(a.entries.length).toBeGreaterThan(0);
  });

  it('SABOTAGE: a doctored seed list alarms — the digest moves', () => {
    const a = buildCoverageCorpus(SMALL);
    const doctored = buildCoverageCorpus({ ...SMALL, seeds: [...SMALL.seeds.slice(0, -1), SMALL.seeds[SMALL.seeds.length - 1]! + 1] });
    expect(corpusDigest(doctored)).not.toBe(corpusDigest(a));
  });

  it('every retained scenario is the FIRST owner of at least one key, and keys have exactly one owner', () => {
    const a = buildCoverageCorpus(SMALL);
    const owners = new Map<string, string>();
    for (const e of a.entries) {
      expect(e.newKeys.length, `${e.scenario.id} retained without new keys`).toBeGreaterThan(0);
      for (const k of e.newKeys) {
        expect(owners.has(k), `key ${k} owned by both ${owners.get(k)} and ${e.scenario.id}`).toBe(false);
        owners.set(k, e.scenario.id);
      }
    }
    expect([...owners.keys()].sort()).toEqual(a.keys.filter((k) => owners.has(k)).sort());
  });

  it('the checked-in corpus still validates and runs green against current content', () => {
    const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
    expect(files.length, `no fixtures in ${CORPUS_DIR} — run npm run docbot:corpus`).toBeGreaterThan(0);
    for (const f of files) {
      const { scenario, errors } = parseQaScenario(readFileSync(join(CORPUS_DIR, f), 'utf8'));
      expect(errors, `${f} failed validation — regenerate the corpus (npm run docbot:corpus)`).toEqual([]);
      const result = runQaScenario(scenario!);
      expect(result.ok, `${f} ran RED:\n${result.summary}`).toBe(true);
    }
  });

  it('the manifest names exactly the checked-in fixtures', () => {
    const manifest = JSON.parse(readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8')) as { entries: Array<{ id: string }> };
    const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json').map((f) => f.replace(/\.json$/, '')).sort();
    expect(manifest.entries.map((e) => e.id).sort()).toEqual(files);
  });
});
