/**
 * RETRO CATALOG — the PR-gate half of the forward catch-rate loop (2026-09-11).
 *
 * The harness (`npm run docbot:retro`) is weekly; this lane runs on every PR and guards the two things that
 * used to rot silently in reinject.py:
 *  1. every patch still ANCHORS on today's source (a refactor that moves the line used to surface as
 *     ANCHOR_MISS weeks later, on an attended run nobody scheduled);
 *  2. the ledger is structurally honest — measured dates, no CAUGHT without a red lane, no regression pin
 *     credited as generic evidence, catch rate derived not typed.
 *
 * Sabotage proofs are in-file: a drifted anchor and a pin-credited CAUGHT both fail.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RETRO_CATALOG, RETRO_SUITE_EXTRA, applyPatchOp, retroCatalogErrors, retroCatchRate, type RetroCatalogEntry,
} from './retroCatalog';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

describe('retro catalog — structure', () => {
  it('is structurally honest (unique ids, ISO dates, no unearned CAUGHT)', () => {
    expect(retroCatalogErrors()).toEqual([]);
  });

  it('every cited lane and suite extra exists on disk (a renamed lane un-cites its bugs loudly)', () => {
    for (const e of RETRO_CATALOG) {
      for (const l of [...e.lanes, ...(e.regressionLanes ?? [])]) {
        expect(existsSync(join(REPO_ROOT, l)), `${e.id} cites ${l}`).toBe(true);
      }
      if (e.verifiedBy.kind === 'reinject-run') {
        for (const l of e.verifiedBy.caughtBy ?? []) expect(existsSync(join(REPO_ROOT, l)), `${e.id} was caught by ${l}`).toBe(true);
      }
    }
    for (const l of RETRO_SUITE_EXTRA) expect(existsSync(join(REPO_ROOT, l)), l).toBe(true);
  });

  it('every patch anchors on TODAY\'s source — exactly once unless `all`', () => {
    for (const e of RETRO_CATALOG) {
      for (const op of e.patch) {
        const path = join(REPO_ROOT, op.file);
        expect(existsSync(path), `${e.id}: ${op.file}`).toBe(true);
        const res = applyPatchOp(readFileSync(path, 'utf8'), op);
        expect(res.ok, `${e.id}: ${res.error ?? ''}`).toBe(true);
        expect(res.text).not.toBe(readFileSync(path, 'utf8'));
      }
    }
  });

  it('SABOTAGE — a drifted anchor is refused, and so is an ambiguous one', () => {
    expect(applyPatchOp('a b c', { file: 'x', find: 'z', replace: 'q' }).ok).toBe(false);
    expect(applyPatchOp('a a', { file: 'x', find: 'a', replace: 'q' }).ok).toBe(false);
    expect(applyPatchOp('a a', { file: 'x', find: 'a', replace: 'q', all: true })).toMatchObject({ ok: true, text: 'q q', matches: [2] });
  });

  it('SABOTAGE — a CAUGHT credited to the bug\'s own regression pin is refused', () => {
    const doctored: RetroCatalogEntry = {
      ...RETRO_CATALOG[0]!,
      id: 'zz-sabotage',
      regressionLanes: ['packages/sim/src/gifts.test.ts'],
      verifiedBy: { kind: 'reinject-run', date: '2026-09-11', verdict: 'CAUGHT', caughtBy: ['packages/sim/src/gifts.test.ts'] },
    };
    expect(retroCatalogErrors([doctored]).some((m) => m.includes('regression pin'))).toBe(true);
    const undated: RetroCatalogEntry = { ...doctored, verifiedBy: { kind: 'reinject-run', date: 'yesterday', verdict: 'MISSED' } };
    expect(retroCatalogErrors([undated]).some((m) => m.includes('not YYYY-MM-DD'))).toBe(true);
  });
});

describe('retro catalog — the forward catch rate is derived', () => {
  it('counts generic measured entries only, and windows by REPORT date', () => {
    const mk = (id: string, reportDate: string, verdict: 'CAUGHT' | 'MISSED', generic = true): RetroCatalogEntry => ({
      id, title: id, fixCommits: ['x'], reportDate, patch: [{ file: 'packages/x.ts', find: 'a', replace: 'b' }], lanes: [],
      scope: generic ? { kind: 'generic' } : { kind: 'out-of-scope', reason: 'test' },
      verifiedBy: { kind: 'reinject-run', date: '2026-09-11', verdict, caughtBy: verdict === 'CAUGHT' ? ['packages/sim/src/docbot/x.test.ts'] : undefined },
    });
    const cat = [
      mk('old-caught', '2026-07-01', 'CAUGHT'),
      mk('new-caught', '2026-09-01', 'CAUGHT'),
      mk('new-missed', '2026-09-05', 'MISSED'),
      mk('edge-out', '2026-08-12', 'MISSED'), // exactly 30 days before → outside (window is (start, end])
      mk('oos-missed', '2026-09-06', 'MISSED', false),
    ];
    const r = retroCatchRate(cat, '2026-09-11');
    expect(r.overall).toEqual({ caught: 2, total: 4 });
    expect(r.trailing).toMatchObject({ caught: 1, total: 2, days: 30, from: '2026-08-12', to: '2026-09-11' });
    expect(r.missed).toEqual(['edge-out', 'new-missed']);
    expect(r.outOfScope).toBe(1);
    expect(r.pending).toBe(0);
  });

  it('the live catalog has at least one entry in the generic remit and every entry carries a report date', () => {
    const r = retroCatchRate(RETRO_CATALOG, '2026-09-11');
    expect(r.overall.total).toBeGreaterThan(0);
    expect(r.overall.caught).toBeLessThanOrEqual(r.overall.total);
  });
});
