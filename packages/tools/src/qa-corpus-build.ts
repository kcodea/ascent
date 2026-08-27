/**
 * `npm run docbot:corpus` — regenerate the coverage-guided scenario corpus (handoff §9.1, PR 8).
 *
 * Runs the canonical deterministic sweep (`CORPUS_CONFIG`) and rewrites the reviewed fixture directory
 * `packages/sim/src/docbot/corpus/`: one `QaScenarioV1` JSON per retained scenario plus `manifest.json`
 * (config, digest, key inventory, per-fixture new-key report). The output is a pure function of config +
 * content, so re-running without content changes is a no-op diff — and after a content change, the diff IS
 * the review surface. Never hand-edit the emitted files.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCoverageCorpus, corpusDigest, CORPUS_CONFIG } from '@game/sim';

const OUT_DIR = join(process.cwd(), 'packages', 'sim', 'src', 'docbot', 'corpus');

const result = buildCoverageCorpus(CORPUS_CONFIG);
const digest = corpusDigest(result);

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.json')) rmSync(join(OUT_DIR, f));

for (const entry of result.entries) {
  writeFileSync(join(OUT_DIR, `${entry.scenario.id}.json`), `${JSON.stringify(entry.scenario, null, 2)}\n`);
}
const manifest = {
  generatedBy: 'npm run docbot:corpus',
  config: CORPUS_CONFIG,
  digest,
  stepsExecuted: result.stepsExecuted,
  keyCount: result.keys.length,
  keys: result.keys,
  entries: result.entries.map((e) => ({ id: e.scenario.id, action: e.scenario.action?.type ?? null, newKeys: e.newKeys })),
};
writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`corpus: ${result.entries.length} scenarios · ${result.keys.length} semantic coverage keys · digest ${digest}`);
console.log(`written to ${OUT_DIR}`);
