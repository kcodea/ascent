/**
 * ANCIENT TRIGGER PROCS, the table test (owner 2026-11-17, R-FX-ANCIENT-PROC-01): every event-fired pairing emits
 * EXACTLY one proc per fire, in every phase it fires in (Shop, combat, Start of Turn, End of Turn), driven through the real
 * reducer and simulator. The classification (`ANCIENT_PROC_PHASES`) names the rows; each group's case file supplies one
 * scenario per row, and a row with no case fails the coverage check.
 */
import { describe, expect, it } from 'vitest';
import { ANCIENT_PROC_FLAG } from '@game/core';
import { ANCIENT_PROC_PHASES, expectedProcRows, pickedRun, shopProcs, type ProcCase } from './ancientProcs.testkit';
import { ANCIENT_PROC_FLAGS, isAncientProcFlag } from './ancientProcs';
import { CASES as G1 } from './ancientProcCases.g1.testkit';
import { CASES as G2 } from './ancientProcCases.g2.testkit';
import { CASES as G3 } from './ancientProcCases.g3.testkit';
import { CASES as G4 } from './ancientProcCases.g4.testkit'; // the Duos heroes

const CASES: ProcCase[] = [...G1, ...G2, ...G3, ...G4];
const keyOf = (c: { hero: string; ancient: string; phase: string }): string => `${c.hero}.${c.ancient}:${c.phase}`;

describe('Ancient trigger procs: one proc per fire (R-FX-ANCIENT-PROC-01)', () => {
  it.each(CASES.map((c) => [keyOf(c), c] as const))('%s', (_k, c) => {
    expect(c.fires, 'a case must make the pairing fire').toBeGreaterThan(0);
    expect(c.run(), c.note ?? '').toBe(c.fires);
  });

  it('every event-fired (pairing, phase) in the classification has a case', () => {
    const have = new Set(CASES.map(keyOf));
    const missing = expectedProcRows().map(keyOf).filter((k) => !have.has(k));
    expect(missing).toEqual([]);
  });

  it('no case names a row the classification does not list (a stale case)', () => {
    const rows = new Set(expectedProcRows().map(keyOf));
    expect(CASES.map(keyOf).filter((k) => !rows.has(k))).toEqual([]);
  });

  it('the shared combat flag is an Ancient proc; ordinary flags are not', () => {
    expect(isAncientProcFlag(ANCIENT_PROC_FLAG)).toBe(true);
    expect(isAncientProcFlag('runeFury')).toBe(false);
    expect(isAncientProcFlag(undefined)).toBe(false);
    for (const f of ANCIENT_PROC_FLAGS) expect(f.startsWith('ancient'), f).toBe(true);
  });

  it('every classified primitive is a real Ancient primitive', async () => {
    const { ANCIENT_PAIRINGS } = await import('./ancients');
    const used = new Set(Object.values(ANCIENT_PAIRINGS).flatMap((row) => Object.values(row ?? {}).flatMap((p) => p!.effects.map((e) => e.do as string))));
    expect(Object.keys(ANCIENT_PROC_PHASES).filter((d) => !used.has(d))).toEqual([]);
  });

  it('a passive pairing never procs: Warden × War (a modifier of Aegis) stamps nothing on a Shop action', () => {
    const s = pickedRun('warden', 'war');
    expect(shopProcs(s, { type: 'roll' }).procs).toBe(0);
  });
});
