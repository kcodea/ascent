import { describe, it, expect } from 'vitest';
import { CARD_INDEX, contentRevision, cardRevision, revisionOf } from '@game/content';
import { createRun, type Action, type RunState } from './state';
import { reduce } from './reducer';
import { BOTS } from './bots';
import { beginDerive, cardDemand, deriveRun, finishDerive, observeAction, wilson, type DerivedRun, goldCurve, upgradeShape } from './runDerive';

/**
 * The derivation is exercised against REAL PLAY, not a fixture: a bot plays full runs, we keep its action
 * log, and derive from that. A hand-built log would only prove the deriver agrees with my idea of a run —
 * this proves it agrees with the reducer, which is the whole claim the design rests on.
 */
function playRun(seed: number, maxActions = 4000): { replay: { seed: number; heroId: string; actions: Action[] }; final: RunState } {
  const heroId = 'warden';
  let s = createRun(seed, heroId);
  const actions: Action[] = [];
  const bot = BOTS[0]!;
  for (let i = 0; i < maxActions && s.phase !== 'gameover' && s.phase !== 'victory'; i++) {
    const a = bot.act(s);
    const next = reduce(s, a);
    if (next !== s) actions.push(a);
    else if (a.type === 'faceOmen') break; // wedged — stop rather than spin
    s = next;
  }
  return { replay: { seed, heroId, actions }, final: s };
}

const RUNS: DerivedRun[] = [1, 2, 3].map((seed) => deriveRun(playRun(seed).replay));

describe('card revisions', () => {
  it('are stable, per-card, and blind to property order', () => {
    const def = CARD_INDEX['pack']!;
    expect(cardRevision(def)).toBe(cardRevision({ ...def })); // a fresh object with the same content
    const reordered = Object.fromEntries(Object.entries(def).reverse()) as typeof def;
    expect(cardRevision(reordered), 'key order must not be a content change').toBe(cardRevision(def));
  });

  it('move when the definition moves, and only then', () => {
    const def = CARD_INDEX['pack']!;
    expect(cardRevision({ ...def, attack: def.attack + 1 })).not.toBe(cardRevision(def));
    expect(cardRevision({ ...def, text: `${def.text} ` })).not.toBe(cardRevision(def)); // text drives pick rate
    expect(revisionOf('pack')).toBe(cardRevision(def));
  });

  it('an unknown id degrades instead of throwing (telemetry must never break a run)', () => {
    expect(revisionOf('no-such-card')).toBe('unknown');
  });

  it('the run-level content revision is a non-empty stable hash', () => {
    expect(contentRevision()).toMatch(/^[0-9a-f]{8}$/);
    expect(contentRevision(), 'memoised — stable across calls').toBe(contentRevision());
  });
});

describe('deriveRun over real bot play', () => {
  it('derives a complete, non-diverged run', () => {
    for (const r of RUNS) {
      expect(r.diverged, 'a fresh log must replay against its own build').toBe(false);
      expect(r.contentRevision).toBe(contentRevision());
      expect(r.finalWave).toBeGreaterThan(1);
      expect(r.playerActions).toBeGreaterThan(0);
    }
  });

  it('every offer row carries its decision context', () => {
    const offers = RUNS.flatMap((r) => r.offers);
    expect(offers.length, 'a full run offers a lot of cards').toBeGreaterThan(20);
    for (const o of offers.slice(0, 50)) {
      expect(CARD_INDEX[o.cardId], 'a real card').toBeTruthy();
      expect(o.rev).toBe(revisionOf(o.cardId));
      expect(o.shopTier).toBeGreaterThanOrEqual(1);
      expect(o.gold).toBeGreaterThanOrEqual(0);
      expect(o.wave).toBeGreaterThanOrEqual(1);
    }
  });

  it('a bought offer records the Gold left after the purchase', () => {
    const bought = RUNS.flatMap((r) => r.offers).filter((o) => o.bought);
    expect(bought.length, 'the bot bought something').toBeGreaterThan(0);
    for (const o of bought) {
      expect(o.goldAfter, 'goldAfter is what makes "could it afford more?" answerable').toBeDefined();
      expect(o.goldAfter!).toBeLessThanOrEqual(o.gold);
    }
  });

  it('shop purchases appear as acquisitions with the Gold actually paid', () => {
    for (const r of RUNS) {
      const boughtOffers = r.offers.filter((o) => o.bought).length;
      const shopAcq = r.acquisitions.filter((a) => a.source === 'shop');
      expect(shopAcq.length, 'every bought copy is an acquisition').toBe(boughtOffers);
      for (const a of shopAcq) expect(a.goldPaid).toBeGreaterThan(0);
    }
  });

  it('separates GENERATED cards from bought ones — the class the old report had no name for', () => {
    const all = RUNS.flatMap((r) => r.acquisitions);
    const sources = new Set(all.map((a) => a.source));
    expect(sources.has('shop')).toBe(true);
    expect(sources.has('generated'), 'tokens/conjures/rewards must not be counted as purchases').toBe(true);
    for (const a of all.filter((x) => x.source === 'generated')) expect(a.goldPaid).toBe(0);
  });

  it('the Gold ledger balances against the run it describes', () => {
    // Every Gold movement is a diff of the real state, so the ledger cannot silently miss a source: replaying
    // the deltas from the starting purse must land exactly where the run's own Gold did.
    for (const seed of [1, 2, 3]) {
      const { replay, final } = playRun(seed);
      const derived = deriveRun(replay);
      const start = createRun(replay.seed, replay.heroId).embers;
      const net = derived.gold.reduce((n, g) => n + g.amount, 0);
      expect(start + net, 'the ledger must reconcile with the run').toBe(final.embers);
    }
  });

  it('categorises spending the way the balance question is asked', () => {
    const spends = RUNS.flatMap((r) => r.gold).filter((g) => g.amount < 0);
    expect(spends.length).toBeGreaterThan(0);
    expect(spends.every((g) => g.category !== 'income')).toBe(true);
    const cats = new Set(spends.map((g) => g.category));
    expect([...cats].some((c) => c === 'minion' || c === 'spell'), 'card buys are categorised').toBe(true);
    for (const g of spends.filter((x) => x.category === 'minion')) {
      expect(CARD_INDEX[g.sourceCard ?? ''], 'a minion spend names the card').toBeTruthy();
    }
  });

  it('records upgrades TAKEN and upgrades DECLINED — the meta question needs both', () => {
    const ups = RUNS.flatMap((r) => r.upgrades);
    expect(ups.length).toBeGreaterThan(0);
    for (const u of ups) {
      expect(u.cost).toBeGreaterThan(0);
      if (u.taken) expect(u.toTier).toBe(u.fromTier + 1);
      // A DECLINE is only recorded when it was actually affordable — otherwise it is not a decision.
      if (!u.taken) expect(u.goldBefore).toBeGreaterThanOrEqual(u.cost);
    }
  });

  it('summarises each combat once, with its keyword trigger counts', () => {
    for (const r of RUNS) {
      const waves = r.combats.map((c) => c.wave);
      expect(new Set(waves).size, 'one row per combat, not per settle step').toBe(waves.length);
      for (const c of r.combats) {
        expect(['win', 'loss', 'draw']).toContain(c.result);
        expect(c.beats).toBeGreaterThan(0);
        expect(typeof c.triggers).toBe('object');
      }
    }
  });

  it('snapshots the board at each turn boundary', () => {
    for (const r of RUNS) {
      expect(r.boards.length).toBeGreaterThan(0);
      for (const b of r.boards) {
        expect(b.totalAttack).toBe(b.cards.reduce((n, c) => n + c.attack, 0));
        for (const c of b.cards) expect(c.rev).toBe(revisionOf(c.id));
      }
    }
  });
});

describe('Avenge trigger details — "is it too slow" as a measurement', () => {
  it('every Avenge body that entered a combat gets a row explaining its outcome', () => {
    const rows = RUNS.flatMap((r) => r.triggers);
    for (const t of rows) {
      expect(t.keyword).toBe('avenge');
      expect(t.threshold).toBeGreaterThan(0);
      expect(t.triggers).toBe(Math.floor(t.deathsAvailable / t.threshold));
      // The two claims must agree: a row either paid out, or it names why it didn't.
      if (t.triggers > 0) expect(t.failure).toBeUndefined();
      else expect(['insufficientDeaths', 'diedEarly']).toContain(t.failure);
    }
  });
});

describe('the three conversion rates are separately named', () => {
  const demand = cardDemand(RUNS);

  it('reports copy, shop and run rates as DIFFERENT numbers', () => {
    const rows = demand.filter((d) => d.copiesOffered > 3);
    expect(rows.length).toBeGreaterThan(0);
    for (const d of rows) {
      expect(d.copyConversion).toBe(d.copiesBought / d.copiesOffered);
      expect(d.shopConversion).toBe(d.shopsWithCard > 0 ? d.shopsConverted / d.shopsWithCard : null);
      expect(d.runAcquisitionRate).toBe(d.runsOffered > 0 ? d.runsAcquired / d.runsOffered : null);
      // The rates are ordered by construction: a shop that converted contains ≥1 converted copy.
      expect(d.copiesBought).toBeGreaterThanOrEqual(d.shopsConverted);
    }
  });

  it('runsAcquired counts ANY source — the rename that fixes the old runs_bought lie', () => {
    // A card acquired only from a Discover still counts as acquired, and must not count as a shop purchase.
    const discoverOnly = demand.find((d) => d.bySource.discover > 0 && d.bySource.shop === 0);
    if (discoverOnly) {
      expect(discoverOnly.runsAcquired).toBeGreaterThan(0);
      expect(discoverOnly.copiesBought, 'never bought in a tavern').toBe(0);
    }
    for (const d of demand) {
      const total = Object.values(d.bySource).reduce((n, v) => n + v, 0);
      expect(total, 'every acquisition is attributed to exactly one source').toBe(d.acquisitions);
    }
  });

  it('never divides by zero — an unseen rate is null, not 0 or NaN', () => {
    for (const d of demand) {
      for (const v of [d.copyConversion, d.shopConversion, d.runAcquisitionRate, d.playRate, d.finalBoardRate]) {
        expect(v === null || Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('keys rows by card AND revision, so a changed card never pools with its old self', () => {
    for (const d of demand) expect(d.rev).toBe(revisionOf(d.cardId));
    const keys = demand.map((d) => `${d.cardId}@${d.rev}`);
    expect(new Set(keys).size, 'one row per card+revision').toBe(keys.length);
  });
});

describe('statistical guardrails', () => {
  it('Wilson intervals are honest at small N and tighten as N grows', () => {
    const small = wilson(1, 2)!;
    const large = wilson(500, 1000)!;
    expect(small.hi - small.lo, '1-of-2 must be nearly useless').toBeGreaterThan(0.7);
    expect(large.hi - large.lo, '500-of-1000 must be tight').toBeLessThan(0.07);
    expect(wilson(0, 0), 'no data is not a rate').toBeNull();
    const edge = wilson(0, 10)!;
    expect(edge.lo).toBe(0);
    expect(edge.hi).toBeGreaterThan(0); // 0-of-10 is not proof of 0%
  });
});

describe('the two feeds are ONE implementation', () => {
  it('observing live and deriving from the replay produce identical rows', () => {
    // This is the property the observer refactor exists for. The pre-existing telemetry has a reconstruct
    // path AND a live path whose comment says they "must stay in step" — kept aligned by hand, which is a
    // standing invitation to drift. Here both feeds run the same `observeAction`, so agreement is structural
    // rather than maintained; this test would catch a future edit that broke that.
    const heroId = 'warden';
    const seed = 7;
    let s: RunState = createRun(seed, heroId);
    const actions: Action[] = [];
    const live = beginDerive(s);
    const bot = BOTS[0]!;
    for (let i = 0; i < 4000 && s.phase !== 'gameover' && s.phase !== 'victory'; i++) {
      const a = bot.act(s);
      const next = reduce(s, a);
      observeAction(live, s, a, next); // the LIVE feed — exactly what the store will do per dispatch
      if (next !== s) actions.push(a);
      else if (a.type === 'faceOmen') break;
      s = next;
    }
    const fromLive = finishDerive(live, s, { heroId, seed });
    const fromReplay = deriveRun({ seed, heroId, actions });
    expect(fromReplay.offers).toEqual(fromLive.offers);
    expect(fromReplay.acquisitions).toEqual(fromLive.acquisitions);
    expect(fromReplay.gold).toEqual(fromLive.gold);
    expect(fromReplay.upgrades).toEqual(fromLive.upgrades);
    expect(fromReplay.combats).toEqual(fromLive.combats);
    expect(fromReplay.boards).toEqual(fromLive.boards);
  });

  it('the observer state survives a JSON round-trip (quit and resume mid-run)', () => {
    // A lobby run is observed across a session the player can close, so the state rides in the save file.
    const s = createRun(3, 'warden');
    const st = beginDerive(s);
    const revived = JSON.parse(JSON.stringify(st));
    expect(revived).toEqual(st);
  });
});

describe('the Balance Report curve aggregations (2026-08-06)', () => {
  const run = (gold: DerivedRun['gold'], upgrades: DerivedRun['upgrades']): DerivedRun =>
    ({ offers: [], acquisitions: [], gold, upgrades, combats: [], boards: [], heroId: 'warden', seed: 1, contentRevision: 'r' } as unknown as DerivedRun);

  it('goldCurve averages per run REACHING the wave, spends shown as outlay', () => {
    const a = run([
      { wave: 1, amount: -3, category: 'minion', goldAfter: 0, maxGoldAfter: 3 },
      { wave: 2, amount: -1, category: 'refresh', goldAfter: 3, maxGoldAfter: 4 },
    ], []);
    const b = run([{ wave: 1, amount: -3, category: 'minion', goldAfter: 0, maxGoldAfter: 3 }], []);
    const rows = goldCurve([a, b]);
    expect(rows[0]!.wave).toBe(1);
    expect(rows[0]!.runs).toBe(2);
    expect(rows[0]!.avg.minion, 'spend negated to outlay, averaged over 2 runs').toBe(3);
    expect(rows[1]!.runs, 'only one run reached wave 2 — the divisor must not count the other').toBe(1);
    expect(rows[1]!.avg.refresh).toBe(1);
  });

  it('upgradeShape reports take rate + the after-loss split', () => {
    const u = (wave: number, taken: boolean, prevResult?: 'win' | 'loss'): DerivedRun['upgrades'][number] =>
      ({ wave, fromTier: 1, toTier: 2, cost: 5, taken, goldBefore: 6, goldAfter: taken ? 1 : 6, resolve: 30, prevResult, boardSize: 3, boardAttack: 9, boardHealth: 9, cardsBoughtThisTurn: 1 });
    const rows = upgradeShape([run([], [u(3, true, 'loss'), u(3, false, 'loss')]), run([], [u(3, true, 'win')])]);
    expect(rows[0]!.offered).toBe(3);
    expect(rows[0]!.takeRate).toBeCloseTo(2 / 3, 3);
    expect(rows[0]!.avgCost).toBe(5);
    expect(rows[0]!.afterLossN).toBe(2);
    expect(rows[0]!.afterLossTakeRate).toBeCloseTo(0.5, 3);
  });
});
