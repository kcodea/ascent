/**
 * The Balance Report's date range (owner ask 2026-11-19): the local-day to UTC mapping (inclusive end), the presets,
 * the patch markers, the remembered range, and that every view reads the same filtered rows.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ancientOutliers, applyReportFilters, cardImpact, heroImpact, outliersFromCards, outliersFromHeroes, questOutliers, rateRows, runeImpact,
  scopeReport, ALL_EPOCHS, type RunTelemetryRow,
} from '@game/sim';
import { ALL_TIME, loadRange, patchMarkers, rangeBounds, rangeLabel, saveRange } from './dateRange';

const NOW = new Date(2026, 10, 19, 15, 30); // local Nov 19, 15:30

describe('rangeBounds: local days to UTC instants', () => {
  it('a custom pick is inclusive on both local days: From at local midnight, To at the NEXT local midnight (exclusive)', () => {
    const b = rangeBounds({ kind: 'custom', from: '2026-11-12', to: '2026-11-19' }, NOW);
    expect(b.fromIso).toBe(new Date(2026, 10, 12, 0, 0).toISOString());
    expect(b.toIso).toBe(new Date(2026, 10, 20, 0, 0).toISOString());
    // A run at 23:59 local on the To day is in; one at 00:00 the next day is out.
    expect(Date.parse(new Date(2026, 10, 19, 23, 59).toISOString()) < Date.parse(b.toIso!)).toBe(true);
    expect(Date.parse(new Date(2026, 10, 20, 0, 0).toISOString()) < Date.parse(b.toIso!)).toBe(false);
  });

  it('a single day, an open end, and a reversed pick', () => {
    const one = rangeBounds({ kind: 'custom', from: '2026-11-17', to: '2026-11-17' }, NOW);
    expect(Date.parse(one.toIso!) - Date.parse(one.fromIso!)).toBeGreaterThanOrEqual(23 * 3600_000); // 23 to 25 h across DST
    expect(rangeBounds({ kind: 'custom', from: '2026-11-17', to: '' }, NOW)).toEqual({ fromIso: new Date(2026, 10, 17).toISOString(), toIso: null });
    expect(rangeBounds({ kind: 'custom', from: '2026-11-19', to: '2026-11-12' }, NOW)).toEqual(rangeBounds({ kind: 'custom', from: '2026-11-12', to: '2026-11-19' }, NOW));
  });

  it('presets roll back from now; Since a patch starts at that local midnight; All time is open', () => {
    expect(rangeBounds({ kind: 'preset', preset: '24h' }, NOW)).toEqual({ fromIso: new Date(NOW.getTime() - 24 * 3600_000).toISOString(), toIso: null });
    expect(rangeBounds({ kind: 'preset', preset: '7d' }, NOW).fromIso).toBe(new Date(NOW.getTime() - 7 * 24 * 3600_000).toISOString());
    expect(rangeBounds({ kind: 'since', day: '2026-11-17', label: 'x' }, NOW)).toEqual({ fromIso: new Date(2026, 10, 17).toISOString(), toIso: null });
    expect(rangeBounds(ALL_TIME, NOW)).toEqual({ fromIso: null, toIso: null });
  });

  it('labels, markers and the remembered range', () => {
    expect(rangeLabel({ kind: 'custom', from: '2026-11-12', to: '2026-11-19' })).toBe('Nov 12 to Nov 19');
    expect(rangeLabel({ kind: 'since', day: '2026-11-17', label: 'Ancients' })).toBe('Since Ancients (Nov 17)');
    const m = patchMarkers(5);
    expect(m.length).toBeGreaterThan(0);
    expect(new Set(m.map((x) => x.day)).size, 'one marker per ship date').toBe(m.length);
    expect(m.every((x) => !/—/.test(x.label))).toBe(true);
  });
});

describe('the remembered range', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* no storage in this environment */ } });
  it('round-trips, and a malformed value reads as All time', () => {
    saveRange({ kind: 'preset', preset: '3d' });
    if (typeof localStorage !== 'undefined') {
      expect(loadRange()).toEqual({ kind: 'preset', preset: '3d' });
      localStorage.setItem('ascent.balance.range', '{"kind":"preset","preset":"bogus"}');
    }
    expect(loadRange()).toEqual(ALL_TIME);
  });
});

describe('every view reads the same filtered rows', () => {
  const base = (o: Partial<RunTelemetryRow>): RunTelemetryRow => ({
    id: null, createdAt: null, patch: null, author: null, playerKey: 'p', contentRevision: 'r', derived: null,
    mode: 'lobby', source: 'ladder', setId: 'set2', heroId: 'warden', heroOffer: ['warden', 'drakko', 'fi'], won: false, wins: 0,
    offeredQuests: ['qa'], pickedQuests: ['qa'], questTurns: {}, offeredRunes: ['rune_x'], pickedRunes: ['rune_x'],
    offeredCards: [], boughtCards: [], tierByWave: [], ...o,
  });
  const inside = base({ id: 1, createdAt: new Date(2026, 10, 18, 12).toISOString(), placement: 2, heroId: 'warden', ancients: true, ancient: { id: 'war', heroId: 'warden', wave: 6 }, ancientOffer: ['war', 'time', 'death'], ancientOfferWave: 6 });
  const outside = base({ id: 2, createdAt: new Date(2026, 10, 10, 12).toISOString(), placement: 7, heroId: 'drakko', ancients: true, ancient: { id: 'time', heroId: 'drakko', wave: 6 }, ancientOffer: ['war', 'time', 'death'], ancientOfferWave: 6 });

  it('the scope drops the out-of-range run, and no view sees it', () => {
    const b = rangeBounds({ kind: 'custom', from: '2026-11-12', to: '2026-11-19' }, NOW);
    const scoped = scopeReport(applyReportFilters([inside, outside], 'set2'), { epoch: ALL_EPOCHS, from: null, to: null, fromIso: b.fromIso, toIso: b.toIso });
    expect(scoped.rows.map((r) => r.id)).toEqual([1]);
    const rows = scoped.rows;
    expect(heroImpact(rows).map((h) => h.id).sort(), 'heroes: only the in-range pick and its trio').not.toContain(undefined);
    expect(heroImpact(rows).find((h) => h.id === 'drakko')?.runs ?? 0).toBe(0);
    expect(outliersFromHeroes(heroImpact(rows)).reduce((n, h) => n + h.taken, 0)).toBe(1);
    expect(runeImpact(rows).find((r) => r.id === 'rune_x')?.offered).toBe(1);
    expect(questOutliers(rows).find((q) => q.id === 'qa')?.offered).toBe(1);
    const anc = ancientOutliers(rows);
    expect(anc.ancients.find((a) => a.id === 'time')?.taken).toBe(0);
    expect(anc.ancients.find((a) => a.id === 'war')?.taken).toBe(1);
    expect(rateRows(anc.ancients).every((r) => r.item.shown <= 1)).toBe(true);
    expect(outliersFromCards(cardImpact(rows))).toEqual([]);
  });
});
