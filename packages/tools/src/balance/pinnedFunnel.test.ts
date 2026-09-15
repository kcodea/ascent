/**
 * The pinned lobby's ACQUISITION FUNNEL reaches the report. Regression for the "bought 0" defect (2026-09-15): the
 * pinned runner fell through to the runner's lean `targetId` diff while the aggregate reads the recorder's
 * attributer (`sourceId` + `route`), so every real pinned job's minion / spell table read `bought 0`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import { renderReport } from './report';
import { NOOP_RECORDER, PINNED_FIXTURE_SHUFFLED, pilotFor, registerOpponents, runPinnedLobby, type ExperimentIdentity, type ExperimentManifest, type LobbyRecord } from './deps';

const identity: ExperimentIdentity = { schemaVersion: 1, engineRevision: 'test', dirtyDigest: '', contentDigest: '', poolDigest: '', effectDigest: '', manifestDigest: '' };
const manifest: ExperimentManifest = {
  schemaVersion: 1, name: 'pinned funnel', mode: 'pinnedLobby', setId: 'set2',
  policy: { id: 'greedy', budget: { depth: 1, beam: 1, maxNodes: 1, positionCandidates: 1 } },
  seeds: { start: 1, count: 3 }, corpus: { name: 'fixture', digest: 'fixture' }, fightRules: 'shipped',
};

describe('pinned lobby → aggregate: the offer → buy → played funnel', () => {
  let records: LobbyRecord[];
  beforeAll(() => {
    registerOpponents(PINNED_FIXTURE_SHUFFLED);
    records = [1, 2, 3].map((seed) => runPinnedLobby(manifest, seed, pilotFor('greedy'), NOOP_RECORDER, identity));
  });

  it('every buy the pilot made is a bought copy of a minion or spell row', () => {
    const agg = aggregate(records, { bootstrapReps: 50 });
    expect(agg.coverage.lobbies.failed).toBe(0);
    const buys = records.flatMap((r) => r.actions).filter((a) => a.seatId === 's0' && a.action.type === 'buy').length;
    expect(buys).toBeGreaterThan(0);
    const bought = [...agg.minions, ...agg.spells].reduce((n, row) => n + row.bought, 0);
    expect(bought).toBe(buys);
    const offered = [...agg.minions, ...agg.spells].reduce((n, row) => n + row.offered, 0);
    expect(offered).toBeGreaterThanOrEqual(bought);
    expect(agg.minions.some((m) => m.bought > 0 && m.played > 0)).toBe(true);
    // The rendered tables never print a `bought 0` row for a card the pilot bought.
    const md = renderReport(agg, { format: 'md', manifest, identity });
    for (const row of agg.minions.filter((m) => m.bought > 0)) expect(md).toContain(row.name);
  });
});
