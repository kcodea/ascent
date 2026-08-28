/**
 * DOC BOT LANE `tribePredicates` — the raw-tribe-comparison ratchet. Doctrine + pinned counts live in `tribeRatchet.ts`
 * (pure data — it is re-exported through the public sim entrypoint); the node-only SCANNER lives here with
 * its consumer. A count above its pin fails (use the predicate); a count below its pin fails the OTHER way
 * (you converted sites — bank the progress by lowering the pin, or the freed slack can be silently re-spent).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREDICATE_FILES, RAW_TRIBE_COMPARE_SOURCE, TRIBE_RATCHET } from './tribeRatchet';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('Doc Bot — tribe predicate ratchet', () => {
  const raw = new RegExp(RAW_TRIBE_COMPARE_SOURCE); // deliberately not /g/: .test() with a global regex carries lastIndex
  const scan = PREDICATE_FILES.map((file) => ({
    file,
    count: readFileSync(join(ROOT, file), 'utf8').split('\n').filter((l) => raw.test(l)).length,
    pinned: TRIBE_RATCHET[file]!,
  }));

  it('no correctness-critical file grows a new raw `.tribe ===` comparison', () => {
    const grew = scan.filter((r) => r.count > r.pinned);
    expect(grew.map((r) => `${r.file}: ${r.count} > pinned ${r.pinned} — use isTribe/defIsTribe (shop) or isTribeOf (combat); raw compares miss all-types (owner ruling 2026-08-26)`)).toEqual([]);
  });

  it('conversions are banked: a count below its pin means the pin must come down too', () => {
    const slack = scan.filter((r) => r.count < r.pinned);
    expect(slack.map((r) => `${r.file}: ${r.count} < pinned ${r.pinned} — nice work; lower TRIBE_RATCHET so the freed slack cannot be silently re-spent`)).toEqual([]);
  });
});
