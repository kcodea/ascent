import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commitFlipDeltas, type CommitSweep } from './commitFlip';

// Owner report 2026-09-24: "when casting growth it randomly moves the warband, please fix that".
// Reproduced live: the last row sweep was taken under a wider layout (the viewport changed after it), then a Growth
// dragged up out of the hand and released flipped the FLIP key (the drag's lift flag) with NO row change, and the
// commit branch slid all seven warband cards in from 147..479 px to the right.

const BOARD = 's1,s2,s3|sp|b4,b5,b6,b7,b16,b17,b18';
const uids = ['b4', 'b5', 'b6', 'b7', 'b16', 'b17', 'b18'];
/** A warband laid out from `left` with `pitch` px between card lefts. */
const row = (left: number, pitch: number, ids: readonly string[] = uids): Map<string, number> =>
  new Map(ids.map((u, i) => [u, left + i * pitch]));

describe('commit FLIP deltas (the Growth warband slide)', () => {
  // The two sweeps measured in the repro: the 2560 px layout, then the 1600 px one.
  const wide: CommitSweep = { key: BOARD, lefts: row(490, 184) };
  const narrow: CommitSweep = { key: BOARD, lefts: row(343, 128.5) };

  it('a commit that changed no row moves nothing, however the layout shifted since the last sweep', () => {
    expect(commitFlipDeltas(wide, narrow).size).toBe(0);
  });

  it('same rows and same layout: nothing moves', () => {
    expect(commitFlipDeltas(narrow, { ...narrow }).size).toBe(0);
  });

  it('no earlier sweep (first commit, or dropped on a resize): nothing moves', () => {
    expect(commitFlipDeltas(null, narrow).size).toBe(0);
  });

  it('a real row change still glides the survivors (a sell re-centres the row)', () => {
    // b7 sold: the six survivors re-centre by half a slot.
    const after = uids.filter((u) => u !== 'b7');
    const sold: CommitSweep = { key: 's1,s2,s3|sp|b4,b5,b6,b16,b17,b18', lefts: row(343 + 64.25, 128.5, after) };
    const d = commitFlipDeltas(narrow, sold);
    expect(d.get('b4')).toBeCloseTo(-64.25);
    expect(d.get('b16')).toBeCloseTo(128.5 * 4 - (128.5 * 3 + 64.25));
    expect(d.has('b7')).toBe(false); // gone: no delta
    expect(d.size).toBe(6);
  });

  it('a card that arrived has no "from" and is left to its own entrance', () => {
    const summoned: CommitSweep = { key: `${BOARD},b30`, lefts: row(279, 128.5, [...uids, 'b30']) };
    const d = commitFlipDeltas(narrow, summoned);
    expect(d.has('b30')).toBe(false);
    expect(d.get('b4')).toBeCloseTo(64);
  });

  it('sub-pixel rounding is not a move', () => {
    const nudged: CommitSweep = { key: 'other', lefts: row(343.3, 128.5) };
    expect(commitFlipDeltas(narrow, nudged).size).toBe(0);
  });
});

describe('RowFlip wiring', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');

  it('the commit branch diffs through commitFlipDeltas with the row key, and stores the sweep with it', () => {
    expect(src).toContain('commitFlipDeltas(commitRectsRef.current, { key: rowsKey, lefts: commitLefts })');
    expect(src).toContain('commitRectsRef.current = { key: rowsKey, lefts: commitLefts }');
  });

  it('a window resize drops the stale sweep', () => {
    expect(src).toMatch(/addEventListener\('resize', drop\)/);
  });
});
