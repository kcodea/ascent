/**
 * DOC BOT — COVERAGE-GUIDED CORPUS BUILDER (handoff §9.1, PR 8).
 *
 * A deterministic seeded sweep through the real reducer (the invariant-fuzz action policy via
 * `driveTrajectory`), retaining ONE `QaScenarioV1` per newly-reached semantic coverage key set: whenever a
 * step reaches a key no earlier step (any seed) reached, the step's (pinned pre-state, single action) pair
 * is retained as a fixture. Because the sweep order is canonical (seeds ascending, steps ascending) and
 * every retained scenario is a SINGLE action from a serialized state, "the smallest scenario that adds a
 * key" is by construction the earliest-and-shortest one the sweep can express.
 *
 * Retained fixtures live under the reviewed directory `packages/sim/src/docbot/corpus/` (regenerate with
 * `npm run docbot:corpus`; the manifest carries the per-fixture new-key report). `coverageCorpus.test.ts`
 * asserts (a) generation is deterministic — same config, byte-identical corpus, sabotage-proven by a
 * doctored seed list alarming; (b) every checked-in fixture still validates + runs green.
 *
 * Sweep dimensions: seeds are the exploration axis; heroes and sets CYCLE deterministically across the
 * seed list (sorted rosters, index-modulo) so the sweep touches several hero-power families and both live
 * sets without a Cartesian sweep. The §8.1 pairwise covering array was considered here and deliberately
 * NOT used: its dimensions (board/hand/Gold/tier boundaries) are reachability *inputs*, which the recruit
 * covering-array lane already drives directly — the corpus's job is the *output* side (which semantics
 * actually fired), and a seeded free-play sweep reaches strictly more of those per CPU-second.
 */
import { SETS } from '@game/content';
import { stableStringify, type QaScenarioV1 } from '../qaScenario';
import type { Action } from '../state';
import { HEROES } from '../heroes';
import { driveTrajectory } from './trajectory';

export interface CorpusConfig {
  seeds: readonly number[];
  /** Fuzz steps per seed. */
  steps: number;
}

/** The canonical checked-in corpus config — the CLI and the test lane must agree on it. */
export const CORPUS_CONFIG: CorpusConfig = {
  seeds: [11, 23, 37, 53, 71, 89, 107, 131, 149, 173, 191, 211, 233, 257, 277, 307, 331, 353, 379, 401, 421, 443, 463, 487],
  steps: 200,
};

export interface CorpusEntry {
  scenario: QaScenarioV1;
  /** The semantic keys THIS fixture was first to reach (the §9.1 coverage report). */
  newKeys: string[];
}

export interface CorpusBuildResult {
  entries: CorpusEntry[];
  /** Every key the sweep reached, sorted. */
  keys: string[];
  stepsExecuted: number;
}

/** Stable rosters: live heroes and sets in sorted-id order, cycled by seed index. */
const heroRoster = (): string[] => HEROES.filter((h) => !h.wip).map((h) => h.id).sort();
const setRoster = (): string[] => Object.keys(SETS).filter((id) => SETS[id as keyof typeof SETS].own.length > 0).sort();

/** Build the corpus. Pure function of the config + content — no wall clock, no ambient randomness. */
export function buildCoverageCorpus(cfg: CorpusConfig): CorpusBuildResult {
  const heroes = heroRoster();
  const sets = setRoster();
  const entries: CorpusEntry[] = [];
  const globalKeys = new Set<string>();
  let stepsExecuted = 0;

  cfg.seeds.forEach((seed, i) => {
    const heroId = heroes[i % heroes.length]!;
    const setId = sets[i % sets.length]!;
    const retained: Array<{ step: number; action: Action; serializedBefore: string; newKeys: string[] }> = [];

    const outcome = driveTrajectory({
      seed,
      heroId,
      setId,
      generate: { steps: cfg.steps, rngSeed: 0xc0de + seed },
      collectCoverage: true,
      onStep: (info) => {
        // `newKeysPossible` is already deduplicated against THIS trajectory; dedupe against the global set
        // accumulated across earlier seeds so a key keeps exactly one (earliest) owner.
        const fresh = info.newKeysPossible.filter((k) => !globalKeys.has(k));
        if (fresh.length === 0) return;
        retained.push({ step: info.step, action: info.action, serializedBefore: info.serializedBefore, newKeys: fresh });
      },
    });
    stepsExecuted += outcome.steps;
    for (const k of outcome.coverageKeys ?? []) globalKeys.add(k);

    for (const r of retained) {
      const parsed = JSON.parse(r.serializedBefore) as { seed: number; setId?: string };
      entries.push({
        newKeys: r.newKeys,
        scenario: {
          schemaVersion: 1,
          id: `corpus-s${seed}-t${r.step}`,
          title: `coverage corpus — seed ${seed} step ${r.step} (${r.action.type}, ${heroId}, ${setId})`,
          source: 'generated',
          seed: parsed.seed,
          setId: parsed.setId ?? setId,
          mode: 'recruit',
          state: r.serializedBefore,
          action: r.action,
          // Every corpus fixture asserts the structural invariants — enough to prove "runs green" without
          // pinning exact outcomes (outcome pins belong to the golden/regression lanes, not coverage).
          expectations: [
            { kind: 'invariant', id: 'embers-non-negative' },
            { kind: 'invariant', id: 'board-within-cap' },
            { kind: 'invariant', id: 'stats-finite' },
          ],
          metadata: { notes: `coverage keys first reached here: ${r.newKeys.join(', ')}` },
        },
      });
    }
  });

  return { entries, keys: [...globalKeys].sort(), stepsExecuted };
}

/** FNV-1a 32-bit (the guard/findings hash — local copy by repo convention: no shared util module). */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** One hash over the ENTIRE corpus (fixtures + key report) — the determinism alarm: two builds of the same
 *  config must digest identically, and a doctored config must not. */
export const corpusDigest = (r: CorpusBuildResult): string => fnv1a(stableStringify(r));
