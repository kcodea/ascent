import { describe, it, expect } from 'vitest';
import { applyReportFilters, buildBalanceExport, cardImpact, exportReadme, goldEconomy, heroImpact, runeImpact, tierImpact, toExportedRun, EXPORT_SCHEMA_VERSION, type RunTelemetryRow } from './playerReport';
import { epochsOf, tierDecisions } from './reportCohorts';
import { aggregatePlayerReport } from './runTelemetry';
import { upgradeShape, type DerivedRun } from './runDerive';

/**
 * EXPORT ALL (owner ask 2026-09-22: "make the export export everything so that an ai can analyze all of the
 * data for me at once"). ONE JSON object from the SAME filtered rows the screen renders: every section the
 * panel shows, every raw row, every derived stream, a readme that explains every key, and the id → name
 * dictionaries. The counts in the file must equal the aggregates over the same rows, so screen and file can
 * never disagree.
 */
const row = (o: Partial<RunTelemetryRow>): RunTelemetryRow => ({
  id: null, createdAt: null, patch: null, author: null, playerKey: null, contentRevision: null, derived: null,
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
  // The live ledger shape: wave 1 opens on 3 Gold with no event; the buy, then the refill that closes the wave
  // (an income stamped wave 1 whose goldAfter is wave 2's opening Gold).
  gold: [{ wave: 1, amount: -3, category: 'minion', goldAfter: 0, maxGoldAfter: 3 }, { wave: 1, amount: 4, category: 'income', goldAfter: 4, maxGoldAfter: 4 }],
  upgrades: [{ wave: 2, fromTier: 1, toTier: 2, cost: 4, taken: true, goldBefore: 4, goldAfter: 0, resolve: 30, prevResult: 'loss', boardSize: 1, boardAttack: 1, boardHealth: 1, cardsBoughtThisTurn: 0 }],
  combats: [], triggers: [], boards: [], playerActions: 7,
});

/** The account keys as the backend generates them: md5 of the user id, one per account. */
const KEV = 'c4ca4238a0b923820dcc509a6f75849b';
const MIKE = 'c81e728d9d4c2f636f067f89cc14862c';
const ROWS: RunTelemetryRow[] = [
  row({ id: 3, createdAt: '2026-09-22T10:00:00Z', patch: '0.1.0+bbb', author: 'Kev', playerKey: KEV, placement: 1, offeredCards: ['alley', 'drummer'], boughtCards: ['alley'], pickedRunes: ['rune_warpath'], offeredRunes: ['rune_warpath'], derived: derivedFor(3) }),
  row({ id: 2, createdAt: '2026-09-21T10:00:00Z', patch: '0.1.0+aaa', author: 'Mike', playerKey: MIKE, heroId: 'drakko', placement: 5, offeredCards: ['alley', 'growth'], boughtCards: ['growth'], discoverOfferedCards: ['joker', 'drummer', 'alley'], discoverBoughtCards: ['joker'], derived: derivedFor(2) }),
  row({ id: 1, createdAt: '2026-09-20T10:00:00Z', patch: '0.1.0+aaa', author: 'Kev', playerKey: KEV, placement: 8, offeredCards: ['alley'] }), // no derived
];

const FETCH = { flatCap: 5000, flatPageSize: 1000, flatFetched: 3, flatTruncated: false, derivedCap: 2000, derivedRequested: 3, derivedFetched: 2, derivedDropped: 1 };
const INFO = {
  activeSet: { id: 'set2' as const, name: 'Set 2' },
  appVersion: '0.1.0+test',
  generatedAt: '2026-09-22T12:00:00.000Z',
  contentRevision: 'buildrev',
  counts: applyReportFilters(ROWS, 'set2').counts,
  filters: applyReportFilters(ROWS, 'set2').applied,
  scope: { epoch: 'all', from: null, to: null },
  epochs: epochsOf(ROWS),
  fetch: FETCH,
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
    expect(x.aggregates.heroImpact).toEqual(heroImpact(ROWS));
    expect(x.aggregates.runeImpact).toEqual(runeImpact(ROWS));
    expect(x.aggregates.byForge.length).toBe(1);
    expect(x.aggregates.tierImpact).toEqual(tierImpact(ROWS));
    expect(x.aggregates.tierDecisions).toEqual(tierDecisions(ROWS));
    expect(x.aggregates.economy).toEqual(goldEconomy(ROWS));
    expect(x.aggregates.economy.runs.all, 'the two rows with a ledger').toBe(2);
    expect(x.aggregates.upgrades).toEqual(upgradeShape(derived));
    expect(Object.keys(x.aggregates)).not.toContain('demand');
  });

  it('carries every raw row in full and every derived stream, joined by row id', () => {
    expect(x.runs).toHaveLength(3);
    expect(x.runs.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(x.runs[0]).toEqual(toExportedRun(ROWS[0]!, 'player 1'));
    expect(x.runs[1]!.discoverBoughtCards).toEqual(['joker']);
    expect(x.runs[2]!.set, 'the set the report READ the row as').toBe('set2');
    expect(x.derived).toHaveLength(2);
    expect(x.derived.map((d) => d.rowId)).toEqual([3, 2]);
    expect(x.derived[0]!.offers).toHaveLength(2);
    expect(x.derived[0]!.setId).toBe('set2');
  });

  it('never carries an account id, a display name or a raw player key; runs carry a per-file player alias that keeps the unique-player count', () => {
    const text = JSON.stringify(x);
    expect(text).not.toContain('user_id');
    expect(text).not.toContain('userId');
    for (const r of x.runs) {
      expect(Object.keys(r)).not.toContain('user_id');
      expect(Object.keys(r), 'the display name never leaves the report').not.toContain('author');
      expect(Object.keys(r), 'the raw key never leaves the report either: it is stable across files and would join them on a player').not.toContain('playerKey');
    }
    expect(text, 'no display name anywhere in the file').not.toMatch(/"Kev"|"Mike"/);
    expect(text, 'no raw player key anywhere in the file').not.toContain(KEV);
    expect(text).not.toContain(MIKE);
    expect(x.runs.map((r) => r.player), 'aliased in order of first appearance; the same key keeps its alias').toEqual(['player 1', 'player 2', 'player 1']);
    for (const r of x.runs) {
      expect(ROWS.map((s) => s.author), 'an alias is never a display name').not.toContain(r.player);
      expect(ROWS.map((s) => s.playerKey), 'an alias is never a raw key').not.toContain(r.player);
    }
    expect(new Set(x.runs.map((r) => r.player)).size, 'the alias re-derives the unique-player count').toBe(x.meta.coverage.uniquePlayers);
    expect(toExportedRun({ ...ROWS[0]!, playerKey: null }, null).player, 'no key stays null, never player 0').toBeNull();
  });

  it('keys players by player_key: a rename is the same player, a shared name is two, and the display name is only the un-migrated fallback', () => {
    // Kev renames between runs; a second account picks the name "Mike".
    const rows = [
      { ...ROWS[0]!, author: 'Kev' }, { ...ROWS[1]!, author: 'Mike' }, { ...ROWS[2]!, author: 'Kevin' },
      { ...ROWS[1]!, id: 0, author: 'Mike', playerKey: 'e4da3b7fbbce2345d7772b0674a318d5' },
    ];
    const byKey = buildBalanceExport(rows, INFO);
    expect(byKey.meta.playerKey.basis).toBe('playerKey');
    expect(byKey.meta.coverage.uniquePlayers, 'three accounts').toBe(3);
    expect(byKey.runs.map((r) => r.player), 'the renamed run keeps its alias; the second Mike gets its own').toEqual(['player 1', 'player 2', 'player 1', 'player 3']);
    expect(byKey.aggregates.heroImpact.find((h) => h.id === 'drakko')!.players, 'the tables count the same way').toBe(2);
    const byName = buildBalanceExport(rows, { ...INFO, playerKeyBasis: 'displayName' });
    expect(byName.meta.playerKey.basis).toBe('displayName');
    expect(byName.meta.playerKey.note, 'the fallback says why').toContain('migration');
    expect(byName.meta.coverage.uniquePlayers, 'the proxy: three names').toBe(3);
    expect(byName.runs.map((r) => r.player), 'aliased by name on the fallback, never the name itself').toEqual(['player 1', 'player 2', 'player 3', 'player 2']);
    expect(JSON.stringify(byName)).not.toMatch(/"Kev"|"Kevin"|"Mike"/);
    expect(buildBalanceExport(rows.map((r) => ({ ...r, playerKey: null })), INFO).meta.coverage.uniquePlayers, 'no key on a migrated backend is n/a, never a count of names').toBeNull();
  });

  it('meta states the schema version, the set, the counts before and after every filter, the filters and the patch range', () => {
    expect(x.meta.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(EXPORT_SCHEMA_VERSION, 'bumped by the honest-associations pass; a column is never redefined under a shipped version').toBe(2);
    expect(x.meta.activeSet).toEqual({ id: 'set2', name: 'Set 2' });
    expect(x.meta.counts).toEqual({ fetched: 3, ladder: 3, inSet: 3, unstamped: 0, withDerived: 2, duplicateIds: 0, placementMalformed: 0, inScope: 3, exportedRuns: 3, exportedDerived: 2, heroes: 2 });
    expect(x.meta.filters).toHaveLength(3);
    expect(x.meta.patches, 'newest row first, as fetched').toEqual(['0.1.0+bbb', '0.1.0+aaa']);
    expect(x.meta.dateRange).toEqual({ oldest: '2026-09-20T10:00:00Z', newest: '2026-09-22T10:00:00Z' });
    expect(x.meta.appVersion).toBe('0.1.0+test');
    expect(x.meta.contentRevision).toBe('buildrev');
    expect(x.meta.sampleGates.preliminary).toBe(20);
  });

  it('meta carries the scope, the epochs, the quality counts, the fetch coverage, the cohort coverage, the player-key basis, the thresholds and the per-metric exclusions', () => {
    expect(x.meta.scope).toEqual({ epoch: 'all', from: null, to: null, epochRuns: 3, revisionsIncluded: ['unknown'] });
    expect(x.meta.epochs).toEqual(epochsOf(ROWS));
    expect(x.meta.quality).toMatchObject({ rows: 3, placementMissing: 0, placementMalformed: 0, duplicateIds: 0, withDerived: 2, diverged: 0, stackedStreams: 0, revisionMissing: 3 });
    expect(x.meta.fetch).toEqual(FETCH);
    expect(x.meta.coverage).toEqual({ runs: 3, placed: 3, withDerived: 2, excludedNoDerived: 1, stacked: 0, uniquePlayers: 2 });
    expect(x.meta.playerKey.basis, 'the account key by default').toBe('playerKey');
    expect(x.meta.playerKey.note).toContain('hash');
    expect(x.readme.meta, 'the readme names both bases').toHaveProperty('playerKey', expect.stringContaining('displayName'));
    expect(x.meta.excludedProlificRuns).toBe(0);
    expect(x.meta.thresholds.welchMinN).toBe(5);
    expect(x.meta.thresholds.evidenceGates.supported.players).toBe(5);
    expect(Object.keys(x.meta.exclusions).sort()).toEqual(['adjusted', 'economy', 'exposed', 'heroes', 'raw', 'runes', 'tierDecisions', 'tiers']);
    expect(x.meta.exclusions.exposed).toContain('2 runs with a usable derived payload');
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
    // Every column of every aggregate table is NAMED in its section's prose (the promise the readme makes; a
    // review of the live export found the shop curve's fields, totalRuns and the economy categories missing).
    const named = (section: string, keys: string[]): void => {
      for (const key of keys) expect(aggDoc[section], `readme.aggregates.${section} does not name ${key}`).toContain(key);
    };
    named('report', Object.keys(x.aggregates.report));
    named('report', Object.keys(x.aggregates.report.shopCurve));
    named('report', Object.keys(x.aggregates.report.heroes[0]!));
    const minion = x.aggregates.impact.minions[0]!;
    named('impact', Object.keys(minion));
    named('impact', Object.keys(minion.exposed));
    named('impact', Object.keys(minion.episodeExclusions));
    named('impact', Object.keys(minion.adjusted));
    named('impact', Object.keys(minion.role));
    named('impact', ['key', 'buyers', 'skippers', 'buyerAvg', 'skipperAvg', 'delta']); // adjusted.supported rows
    named('byTier', Object.keys(x.aggregates.byTier.minions[0]!));
    named('byTribe', Object.keys(x.aggregates.byTribe.minions[0]!));
    named('heroImpact', Object.keys(x.aggregates.heroImpact[0]!));
    named('runeImpact', Object.keys(x.aggregates.runeImpact[0]!));
    named('byForge', Object.keys(x.aggregates.byForge[0]!));
    named('tierImpact', Object.keys(x.aggregates.tierImpact[0]!));
    named('tierDecisions', Object.keys(x.aggregates.tierDecisions[0]!));
    named('tierDecisions', Object.keys(x.aggregates.tierDecisions[0]!.adjusted));
    named('economy', Object.keys(x.aggregates.economy));
    named('economy', Object.keys(x.aggregates.economy.runs));
    named('economy', Object.keys(x.aggregates.economy.waves.all[0]!));
    named('economy', Object.keys(x.aggregates.economy.waves.all[0]!.split));
    named('upgrades', Object.keys(x.aggregates.upgrades[0]!));
    const text = JSON.stringify(readme);
    expect(text).not.toContain('—');
    expect(text).not.toContain('--');
    expect(text, 'no unconditional verdict anywhere in the readme').not.toMatch(/candidate for overpowered|means underpowered/);
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
