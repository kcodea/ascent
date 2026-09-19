import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import { renderReport } from './report';
import { synthesizeJob, syntheticIdentity, syntheticManifest, type LobbyRecord } from './deps';

const ROSTER = ['warden', 'drakko', 'nadja', 'gorr', 'midas', 'pete', 'harlan', 'fibbsy'];
const job = (count: number, start = 1, extra: Parameters<typeof syntheticManifest>[2] = {}) => {
  const m = syntheticManifest('set3', { start, count }, { heroes: ROSTER, ...extra });
  return synthesizeJob(m, syntheticIdentity(m));
};

describe('aggregate (synthetic fixture)', () => {
  const records = job(30);
  const agg = aggregate(records, { bootstrapReps: 300 });

  it('is deterministic given the same records', () => {
    const again = aggregate(records, { bootstrapReps: 300 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(agg));
  });

  it('coverage ledger comes first and counts every lobby and run', () => {
    expect(agg.coverage.lobbies).toEqual({ planned: 30, started: 30, complete: 30, failed: 0, censored: 0, capped: 0 });
    expect(agg.coverage.runs.started).toBe(240);
    expect(agg.coverage.runs.placed).toBe(240);
    expect(agg.coverage.modes).toEqual(['selfPlayLobby']);
    expect(agg.coverage.identityDigests).toHaveLength(1);
    // Symmetric self-play: the population mean placement is mechanically 4.5.
    expect(agg.populationPlacement.est).toBeCloseTo(4.5, 6);
  });

  it('headline numbers snapshot (regenerate deliberately when the fixture changes)', () => {
    const heroes = agg.heroes.filter((h) => h.assigned > 0).map((h) => `${h.heroId}:${h.assigned}:${h.placement.est?.toFixed(2)}`);
    expect(heroes).toMatchInlineSnapshot(`
      [
        "drakko:30:5.03",
        "fibbsy:30:4.13",
        "gorr:30:4.57",
        "harlan:30:4.93",
        "midas:30:4.60",
        "nadja:30:3.50",
        "pete:30:4.30",
        "warden:30:4.93",
      ]
    `);
    expect(agg.minions.length).toBeGreaterThan(50);
    expect(agg.spells.length).toBeGreaterThan(10);
    expect(agg.runes.length).toBeGreaterThan(5);
    expect(agg.pacing.tierByRound[0].mean).toBe(1);
    expect(agg.pacing.results.win).toBe(agg.pacing.results.loss);
  });

  it('every hero has the full support of the roster rotation and is not suppressed at 30 lobbies', () => {
    for (const h of agg.heroes.filter((x) => x.assigned > 0)) {
      expect(h.placement.n).toBe(30);
      expect(h.placement.lobbies).toBe(30);
      expect(h.suppressed).toBe(false);
      expect(h.eligible).toBe(240);
    }
  });

  it('CI widths shrink with more lobbies', () => {
    const small = aggregate(job(10), { bootstrapReps: 300 });
    const large = aggregate(job(60), { bootstrapReps: 300 });
    const width = (a: typeof small, id: string) => { const h = a.heroes.find((x) => x.heroId === id)!; return h.placement.hi! - h.placement.lo!; };
    let shrank = 0;
    for (const id of ROSTER) if (width(large, id) < width(small, id)) shrank++;
    expect(shrank).toBeGreaterThanOrEqual(7);
  });

  it('sparse rows are suppressed below minSupport and never flagged as problems', () => {
    const sparseIds = agg.minions.filter((m) => m.runsHeld < 20).map((m) => m.cardId);
    expect(sparseIds.length).toBeGreaterThan(0);
    for (const m of agg.minions) expect(m.suppressed).toBe(m.runsHeld < 20);
    for (const p of agg.problems) {
      if (p.kind === 'minion') expect(sparseIds).not.toContain(p.id);
      expect(p.evidenceLevel).toBe(1);
    }
    const strict = aggregate(records, { bootstrapReps: 100, minSupport: 1000 });
    expect(strict.problems).toHaveLength(0);
    expect(strict.heroes.every((h) => h.suppressed)).toBe(true);
  });

  it('funnels are consistent: bought ≤ offered sightings, played ≤ bought + generated, casts by route sum', () => {
    for (const m of agg.minions) { expect(m.bought).toBeLessThanOrEqual(m.offered); expect(m.finalBoard).toBeLessThanOrEqual(m.runsHeld + 8); }
    for (const s of agg.spells) expect(s.castShop + s.castGenerated + s.castOther + s.repeats).toBe(s.cast);
    for (const r of agg.runes) expect(r.picked).toBeLessThanOrEqual(r.offered);
  });

  it('censors failed lobbies from outcome tables but keeps them in coverage', () => {
    const m = syntheticManifest('set3', { start: 500, count: 20 }, { heroes: ROSTER });
    const recs = synthesizeJob(m, syntheticIdentity(m), { failRate: 0.3 });
    const a = aggregate(recs, { bootstrapReps: 100 });
    expect(a.coverage.lobbies.failed).toBeGreaterThan(0);
    expect(a.coverage.lobbies.censored).toBe(a.coverage.lobbies.failed);
    expect(a.coverage.lobbies.started).toBe(20);
    expect(a.coverage.runs.failed).toBe(a.coverage.lobbies.failed * 8);
    expect(a.populationPlacement.lobbies).toBe(20 - a.coverage.lobbies.failed);
    expect(Object.values(a.coverage.failureByHero).some((v) => v.failed > 0)).toBe(true);
  });

  it('refuses to pool a legacy-course record into lobby tables', () => {
    const legacy: LobbyRecord = { ...records[0], manifest: { ...records[0].manifest, mode: 'legacyCourse' } };
    const a = aggregate([...records.slice(0, 5), legacy], { bootstrapReps: 50 });
    expect(a.coverage.refusedModes).toEqual(['legacyCourse']);
    expect(a.coverage.runs.started).toBe(40);
  });

  it('renders markdown with coverage first, then problems, then the four tables, then pacing; every number carries a count', () => {
    const md = renderReport(agg, { format: 'md', jobId: 'test', manifest: records[0].manifest, identity: records[0].identity });
    const order = ['## Coverage', '## Likely problems', '## Heroes', '## Runes', '## Minions', '## Spells', '## Pacing'].map((h) => md.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(md).toContain(records[0].identity.contentDigest);
    expect(md).toContain(records[0].identity.manifestDigest);
    expect(md).toMatch(/\(n=30, 30 lobbies\)/);
    const json = JSON.parse(renderReport(agg, { format: 'json' }));
    expect(json.aggregate.coverage.lobbies.started).toBe(30);
    // Deterministic regeneration.
    expect(renderReport(aggregate(records, { bootstrapReps: 300 }), { format: 'md', jobId: 'test' })).toBe(renderReport(agg, { format: 'md', jobId: 'test' }));
  });
});
