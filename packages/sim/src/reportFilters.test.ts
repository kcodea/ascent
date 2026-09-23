import { describe, it, expect } from 'vitest';
import { applyReportFilters, isLadderRow, telemetrySetOf, LEGACY_SET, type RunTelemetryRow } from './playerReport';
import { telemetrySourceOf } from './runTelemetry';
import type { DerivedRun } from './runDerive';

/**
 * THE BALANCE REPORT'S DATA FILTERS (owner ask 2026-09-22: "it should only have data for the active set in it,
 * and nothing from scene builder"). The report reads ladder rows only and ONE set; a row written before the set
 * stamp existed reads as set 1 (the codebase-wide legacy default) and never as the live set. Pure functions,
 * exercised with explicit set ids so nothing here depends on which set the registry has switched on.
 */
const row = (o: Partial<RunTelemetryRow>): RunTelemetryRow => ({
  id: null, createdAt: null, patch: null, author: null, contentRevision: null, derived: null,
  heroId: 'warden', heroOffer: ['warden'], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [],
  offeredCards: [], boughtCards: [], tierByWave: [], ...o,
});

const derived = (): DerivedRun => ({
  contentRevision: 'x', heroId: 'warden', mode: 'lobby', seed: 1, finalWave: 3, wins: 1, won: false, diverged: false,
  offers: [], acquisitions: [], gold: [], upgrades: [], combats: [], triggers: [], boards: [], playerActions: 0,
});

describe('the source stamp', () => {
  it('a real lobby run is ladder; the sandbox flag wins over any mode; every other mode names itself', () => {
    expect(telemetrySourceOf({ mode: 'lobby' })).toBe('ladder');
    expect(telemetrySourceOf({ mode: 'lobby', sandbox: true }), 'a loaded bug scenario keeps its lobby mode').toBe('sandbox');
    expect(telemetrySourceOf({ mode: 'practice', sandbox: true }), 'the Scene Builder rig itself').toBe('sandbox');
    expect(telemetrySourceOf({ mode: 'practice' })).toBe('practice');
    expect(telemetrySourceOf({ mode: 'tutorial' })).toBe('tutorial');
    expect(telemetrySourceOf({ mode: 'rift' })).toBe('rift');
    expect(telemetrySourceOf({}), 'no mode = the course default').toBe('ascent');
  });
});

describe('the set a row is read as', () => {
  it('a row with no stamp is the legacy set, a stamped row is its stamp', () => {
    expect(LEGACY_SET).toBe('set1');
    expect(telemetrySetOf(row({}))).toBe('set1');
    expect(telemetrySetOf(row({ setId: 'set2' }))).toBe('set2');
    expect(telemetrySetOf(row({ setId: 'set3' }))).toBe('set3');
  });
});

describe('a ladder row', () => {
  it('is a lobby row whose source, when stamped, says ladder', () => {
    expect(isLadderRow(row({ mode: 'lobby' })), 'an unstamped lobby row (every pre-2026-09-22 row)').toBe(true);
    expect(isLadderRow(row({ mode: 'lobby', source: 'ladder' }))).toBe(true);
    expect(isLadderRow(row({ mode: 'lobby', source: 'sandbox' })), 'a sandbox row that kept its lobby mode').toBe(false);
    expect(isLadderRow(row({ mode: 'practice' }))).toBe(false);
    expect(isLadderRow(row({ mode: 'tutorial' }))).toBe(false);
    expect(isLadderRow(row({})), 'a course-era row with no mode').toBe(false);
  });
});

describe('applyReportFilters', () => {
  const legacyLobby = row({ mode: 'lobby', heroId: 'a' }); // written before the stamp: set 1 by rule
  const set2Ladder = row({ mode: 'lobby', setId: 'set2', source: 'ladder', heroId: 'b' });
  const set2WithDerived = row({ mode: 'lobby', setId: 'set2', source: 'ladder', heroId: 'c', derived: derived() });
  const set1Stamped = row({ mode: 'lobby', setId: 'set1', source: 'ladder', heroId: 'd' });
  const sandboxLobby = row({ mode: 'lobby', setId: 'set2', source: 'sandbox', heroId: 'e' });
  const practice = row({ mode: 'practice', setId: 'set2', source: 'practice', heroId: 'f' });
  const courseEra = row({ heroId: 'g' });
  const all = [legacyLobby, set2Ladder, set2WithDerived, set1Stamped, sandboxLobby, practice, courseEra];

  it('keeps only ladder rows of the requested set, and counts every step so the header can say what it read', () => {
    const f = applyReportFilters(all, 'set2');
    expect(f.rows.map((r) => r.heroId)).toEqual(['b', 'c']);
    expect(f.counts).toEqual({ fetched: 7, ladder: 4, inSet: 2, unstamped: 1, withDerived: 1, duplicateIds: 0, placementMalformed: 0, inScope: 2 });
    expect(f.applied).toHaveLength(3);
    expect(f.applied[0]).toContain('ladder');
    expect(f.applied[1]).toContain('set2');
  });

  it('a legacy row without a stamp is EXCLUDED when the active set is not set 1: it is never guessed as the live set', () => {
    const f = applyReportFilters(all, 'set2');
    expect(f.rows).not.toContain(legacyLobby);
    expect(f.counts.unstamped, 'but it is counted, so the empty-report note can name it').toBe(1);
  });

  it('the same legacy row IS read when set 1 is asked for, beside the rows stamped set 1', () => {
    const f = applyReportFilters(all, 'set1');
    expect(f.rows.map((r) => r.heroId)).toEqual(['a', 'd']);
    expect(f.counts.inSet).toBe(2);
  });

  it('a sandbox row never counts as ladder, even in the right set with lobby mode', () => {
    const f = applyReportFilters([sandboxLobby, set2Ladder], 'set2');
    expect(f.rows).toEqual([set2Ladder]);
    expect(f.counts.ladder).toBe(1);
  });

  it('the row order is preserved (newest first is the fetch order the panel relies on)', () => {
    const f = applyReportFilters([set2WithDerived, set2Ladder], 'set2');
    expect(f.rows.map((r) => r.heroId)).toEqual(['c', 'b']);
  });
});
