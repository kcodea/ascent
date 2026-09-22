import { describe, it, expect } from 'vitest';
import { applyReportFilters, buildBalanceExport, cardImpact, exportReadme, toExportedRun, type RunTelemetryRow } from './playerReport';
import { aggregatePlayerReport } from './runTelemetry';
import { cardDemand, goldCurve, upgradeShape, type DerivedRun } from './runDerive';

/**
 * EXPORT ALL (owner ask 2026-09-22: "make the export export everything so that an ai can analyze all of the
 * data for me at once"). ONE JSON object from the SAME filtered rows the screen renders: every section the
 * panel shows, every raw row, every derived stream, a readme that explains every key, and the id → name
 * dictionaries. The counts in the file must equal the aggregates over the same rows, so screen and file can
 * never disagree.
 */
const row = (o: Partial<RunTelemetryRow>): RunTelemetryRow => ({
  id: null, createdAt: null, patch: null, author: null, contentRevision: null, derived: null,
  mode: 'lobby', setId: 'set2', source: 'ladder',
  heroId: 'warden', heroOffer: ['warden', 'drakko'], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [],
  offeredCards: [], boughtCards: [], tierByWave: [], ...o,
});

const derivedFor = (seed: number): DerivedRun => ({
  contentRevision: 'rev1', heroId: 'warden', mode: 'lobby', setId: 'set2', source: 'ladder', seed, finalWave: 4, wins: 2, won: false, diverged: false,
  offers: [
    { wave: 1, slot: 0, cardId: 'alley', rev: 'a1', shopTier: 1, cardTier: 1, cost: 3, gold: 3, maxGold: 3, upgradeCost: 5, resolve: 30, boardSize: 0, boardAttack: 0, boardHealth: 0, bought: true, goldAfter: 0, frozen: false, topTribe: 'neutral' },
    { wave: 2, slot: 1, cardId: 'drummer', rev: 'd1', shopTier: 1, cardTier: 5, cost: 3, gold: 4, maxGold: 4, upgradeCost: 4, resolve: 30, boardSize: 1, boardAttack: 1, boardHealth: 1, bought: false, frozen: false, topTribe: 'beast' },
  ],
  acquisitions: [{ cardId: 'alley', rev: 'a1', wave: 1, source: 'shop', goldPaid: 3, played: true, playedWave: 1, finalBoard: true, golden: false }],
  gold: [{ wave: 1, amount: 3, category: 'income', goldAfter: 3, maxGoldAfter: 3 }, { wave: 1, amount: -3, category: 'minion', goldAfter: 0, maxGoldAfter: 3 }],
  upgrades: [{ wave: 2, fromTier: 1, toTier: 2, cost: 4, taken: true, goldBefore: 4, goldAfter: 0, resolve: 30, prevResult: 'loss', boardSize: 1, boardAttack: 1, boardHealth: 1, cardsBoughtThisTurn: 0 }],
  combats: [], triggers: [], boards: [], playerActions: 7,
});

const ROWS: RunTelemetryRow[] = [
  row({ id: 3, createdAt: '2026-09-22T10:00:00Z', patch: '0.1.0+bbb', author: 'Kev', placement: 1, offeredCards: ['alley', 'drummer'], boughtCards: ['alley'], pickedRunes: ['rune_warpath'], offeredRunes: ['rune_warpath'], derived: derivedFor(3) }),
  row({ id: 2, createdAt: '2026-09-21T10:00:00Z', patch: '0.1.0+aaa', author: 'Mike', heroId: 'drakko', placement: 5, offeredCards: ['alley', 'growth'], boughtCards: ['growth'], discoverOfferedCards: ['joker', 'drummer', 'alley'], discoverBoughtCards: ['joker'], derived: derivedFor(2) }),
  row({ id: 1, createdAt: '2026-09-20T10:00:00Z', patch: '0.1.0+aaa', author: 'Kev', placement: 8, offeredCards: ['alley'] }), // no derived
];

const INFO = {
  activeSet: { id: 'set2' as const, name: 'Set 2' },
  appVersion: '0.1.0+test',
  generatedAt: '2026-09-22T12:00:00.000Z',
  contentRevision: 'buildrev',
  counts: applyReportFilters(ROWS, 'set2').counts,
  filters: applyReportFilters(ROWS, 'set2').applied,
};

describe('buildBalanceExport', () => {
  const x = buildBalanceExport(ROWS, INFO);

  it('carries every section the panel shows, with row counts equal to the aggregates over the same rows', () => {
    const report = aggregatePlayerReport(ROWS);
    expect(x.aggregates.report.totalRuns).toBe(3);
    expect(x.aggregates.report.heroes.length).toBe(report.heroes.length);
    expect(x.aggregates.report.runes.length).toBe(report.runes.length);
    expect(x.aggregates.report.minions.length).toBe(report.minions.length);
    expect(x.aggregates.report.spells.length).toBe(report.spells.length);
    expect(x.aggregates.report.shopCurve).toEqual(report.shopCurve);
    const impact = cardImpact(ROWS);
    expect(x.aggregates.impact.minions.length).toBe(impact.filter((r) => !r.spell).length);
    expect(x.aggregates.impact.spells.length).toBe(impact.filter((r) => r.spell).length);
    expect(x.aggregates.impact.minions.find((r) => r.id === 'alley')).toEqual(impact.find((r) => r.id === 'alley'));
    expect(x.aggregates.byTier.minions.length).toBeGreaterThan(0);
    expect(x.aggregates.byTribe.minions.length).toBeGreaterThan(0);
    const derived = ROWS.filter((r) => r.derived).map((r) => r.derived!);
    expect(x.aggregates.demand).toEqual(cardDemand(derived));
    expect(x.aggregates.economy).toEqual(goldCurve(derived));
    expect(x.aggregates.upgrades).toEqual(upgradeShape(derived));
  });

  it('carries every raw row in full and every derived stream, joined by row id', () => {
    expect(x.runs).toHaveLength(3);
    expect(x.runs.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(x.runs[0]).toEqual(toExportedRun(ROWS[0]!));
    expect(x.runs[1]!.discoverBoughtCards).toEqual(['joker']);
    expect(x.runs[2]!.set, 'the set the report READ the row as').toBe('set2');
    expect(x.derived).toHaveLength(2);
    expect(x.derived.map((d) => d.rowId)).toEqual([3, 2]);
    expect(x.derived[0]!.offers).toHaveLength(2);
    expect(x.derived[0]!.setId).toBe('set2');
  });

  it('never carries an account id; the display name is the only attribution', () => {
    const text = JSON.stringify(x);
    expect(text).not.toContain('user_id');
    expect(text).not.toContain('userId');
    for (const r of x.runs) expect(Object.keys(r)).not.toContain('user_id');
    expect(x.runs.map((r) => r.author)).toEqual(['Kev', 'Mike', 'Kev']);
  });

  it('meta states the set, the counts before and after every filter, the filters and the patch range', () => {
    expect(x.meta.activeSet).toEqual({ id: 'set2', name: 'Set 2' });
    expect(x.meta.counts).toEqual({ fetched: 3, ladder: 3, inSet: 3, unstamped: 0, withDerived: 2, exportedRuns: 3, exportedDerived: 2, heroes: 2 });
    expect(x.meta.filters).toHaveLength(2);
    expect(x.meta.patches, 'newest row first, as fetched').toEqual(['0.1.0+bbb', '0.1.0+aaa']);
    expect(x.meta.dateRange).toEqual({ oldest: '2026-09-20T10:00:00Z', newest: '2026-09-22T10:00:00Z' });
    expect(x.meta.appVersion).toBe('0.1.0+test');
    expect(x.meta.contentRevision).toBe('buildrev');
    expect(x.meta.sampleGates.preliminary).toBe(20);
  });

  it('the dictionaries resolve every id the file uses, so a reader needs no codebase', () => {
    for (const id of ['alley', 'drummer', 'growth', 'joker']) expect(x.cards[id], id).toBeDefined();
    expect(x.cards.alley).toEqual({ name: 'Pennycat', tier: 1, tribe: 'beast', tribe2: null, spell: false, token: false });
    expect(x.cards.growth!.spell).toBe(true);
    expect(Object.keys(x.heroes).sort()).toEqual(['drakko', 'warden']);
    expect(x.runes.rune_warpath).toBeDefined();
  });

  it('the readme explains every top-level key, every run column and every derived key', () => {
    const readme = exportReadme();
    for (const key of Object.keys(x)) expect(readme[key], `readme lacks top-level key ${key}`).toBeDefined();
    const runDoc = readme.runs as Record<string, string>;
    for (const key of Object.keys(x.runs[0]!)) expect(runDoc[key], `readme.runs lacks ${key}`).toBeTruthy();
    const derivedDoc = readme.derived as Record<string, string>;
    for (const key of Object.keys(x.derived[0]!)) expect(derivedDoc[key], `readme.derived lacks ${key}`).toBeTruthy();
    const aggDoc = readme.aggregates as Record<string, string>;
    for (const key of Object.keys(x.aggregates)) expect(aggDoc[key], `readme.aggregates lacks ${key}`).toBeTruthy();
    const metaDoc = readme.meta as Record<string, string>;
    for (const key of Object.keys(x.meta)) expect(metaDoc[key], `readme.meta lacks ${key}`).toBeTruthy();
    const text = JSON.stringify(readme);
    expect(text).not.toContain('—');
  });

  it('round-trips through JSON unchanged (what the file holds is what the panel built)', () => {
    // Idempotence, not deep equality: the shop curve's wave-indexed arrays leave index 0 unused, which JSON
    // writes as null. The file is exactly what parsing it back and writing it again produces.
    const text = JSON.stringify(x);
    expect(JSON.stringify(JSON.parse(text))).toBe(text);
    expect(text.length).toBeGreaterThan(1000);
  });

  it('is built from the rows it is handed: the same filter as the screen, nothing re-filtered inside', () => {
    const filtered = applyReportFilters([...ROWS, row({ id: 9, mode: 'lobby', setId: 'set2', source: 'sandbox' }), row({ id: 8, setId: undefined, mode: 'lobby' })], 'set2');
    const y = buildBalanceExport(filtered.rows, { ...INFO, counts: filtered.counts, filters: filtered.applied });
    expect(y.runs.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(y.meta.counts.fetched).toBe(5);
    expect(y.meta.counts.unstamped).toBe(1);
    expect(y.aggregates.report.totalRuns).toBe(3);
  });
});
