import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE ANCIENTS' PIXI DEFS ACTUALLY PLAY. The coloured smoke shipped with every layer `muted: true` (copied from a
 * muted template), so `playDef` silently dropped it: no error, no warning, just no smoke (found 2026-09-25 while
 * re-doing the dust/smoke pass). And no layer is star-shaped (owner 2026-09-25: "i dont want stars, id rather dust").
 */
const DEFS = join(__dirname, '..', 'fx', 'defs');

describe('the Ancients fx defs', () => {
  const files = readdirSync(DEFS).filter((f) => f.startsWith('ancient-') && f.endsWith('.json'));
  it('exist', () => expect(files.length).toBeGreaterThan(0));
  it('have no muted layer and no star-shaped particles', () => {
    const problems: string[] = [];
    for (const f of files) {
      const def = JSON.parse(readFileSync(join(DEFS, f), 'utf8')) as { layers: { name?: string; muted?: boolean; params?: { shape?: string } }[] };
      def.layers.forEach((l, i) => {
        if (l.muted) problems.push(`${f} layer ${i} (${l.name ?? '?'}) is muted`);
        if (l.params?.shape === 'star') problems.push(`${f} layer ${i} (${l.name ?? '?'}) is star-shaped`);
      });
    }
    expect(problems).toEqual([]);
  });
});
