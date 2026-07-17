import { describe, it, expect } from 'vitest';
import { aggregatePlayerReport, buildCardCsv, reconstructRunTelemetry, type RunTelemetry } from './runTelemetry';
import { createRun, type Action } from './state';
import { reduce } from './reducer';
import { CONFIG } from './config';

const blank = (over: Partial<RunTelemetry>): RunTelemetry => ({
  heroId: 'warden', heroOffer: [], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [],
  offeredCards: [], boughtCards: [], tierByWave: [], ...over,
});

describe('aggregatePlayerReport', () => {
  it('computes hero offer / pick / win / avg-wins across runs', () => {
    const rows: RunTelemetry[] = [
      blank({ heroId: 'warden', heroOffer: ['warden', 'a', 'b'], won: true, wins: 12 }),
      blank({ heroId: 'a', heroOffer: ['warden', 'a', 'b'], won: false, wins: 4 }),
      blank({ heroId: 'warden', heroOffer: ['warden', 'c', 'd'], won: false, wins: 8 }),
    ];
    const rep = aggregatePlayerReport(rows);
    expect(rep.totalRuns).toBe(3);
    const warden = rep.heroes.find((h) => h.id === 'warden')!;
    expect(warden.offered).toBe(3); // in all 3 offers
    expect(warden.picked).toBe(2); // chosen twice
    expect(warden.offerRate).toBe(100); // 3/3
    expect(warden.pickRate).toBe(67); // 2/3
    expect(warden.winRate).toBe(50); // 1 win of 2 games
    expect(warden.avgWins).toBe(10); // (12 + 8) / 2
    const a = rep.heroes.find((h) => h.id === 'a')!;
    expect(a.offered).toBe(2); // offered in the first two runs
    expect(a.picked).toBe(1);
  });

  it('computes quest pick / win / avg-turns and rune win rate', () => {
    const rows: RunTelemetry[] = [
      blank({ won: true, offeredQuests: ['q1', 'q2'], pickedQuests: ['q1'], questTurns: { q1: 5 }, offeredRunes: ['r1'], pickedRunes: ['r1'] }),
      blank({ won: false, offeredQuests: ['q1', 'q3'], pickedQuests: ['q1'], questTurns: { q1: 9 }, offeredRunes: ['r1'], pickedRunes: [] }),
    ];
    const rep = aggregatePlayerReport(rows);
    const q1 = rep.quests.find((q) => q.id === 'q1')!;
    expect(q1.offered).toBe(2);
    expect(q1.picked).toBe(2);
    expect(q1.winRate).toBe(50); // 1 win of 2 picked
    expect(q1.avgTurns).toBe(7); // (5 + 9) / 2
    const r1 = rep.runes.find((r) => r.id === 'r1')!;
    expect(r1.offered).toBe(2);
    expect(r1.picked).toBe(1);
    expect(r1.winRate).toBe(100); // the one picked run was a win
  });

  it('a picked quest that never completed shows no avg turn (→ DNF in the UI)', () => {
    const rows: RunTelemetry[] = [
      blank({ won: false, offeredQuests: ['q9'], pickedQuests: ['q9'], questTurns: {} }), // picked, never completed
    ];
    const q9 = aggregatePlayerReport(rows).quests.find((q) => q.id === 'q9')!;
    expect(q9.picked).toBe(1);
    expect(q9.avgTurns).toBe(null); // no completion → the UI renders "DNF" (picked > 0, avgTurns null)
  });

  it('cards are COUNTED, not deduped: offered/picked reflect how many times seen / bought', () => {
    const rows: RunTelemetry[] = [
      // Alleycat seen 5×, bought 3× across two runs; growth (spell) seen 2×, bought 1×.
      blank({ offeredCards: ['alley', 'alley', 'alley', 'growth'], boughtCards: ['alley', 'alley', 'growth'] }),
      blank({ offeredCards: ['alley', 'alley', 'growth'], boughtCards: ['alley'] }),
    ];
    const rep = aggregatePlayerReport(rows);
    const alley = rep.minions.find((m) => m.id === 'alley')!;
    expect(alley.offered).toBe(5); // seen 5 times total (not 2 runs)
    expect(alley.picked).toBe(3); // bought 3 times
    expect(alley.pickRate).toBe(60); // 3/5
    const growth = rep.spells.find((s) => s.id === 'growth')!;
    expect([growth.offered, growth.picked]).toEqual([2, 1]);
    expect(rep.minions.some((m) => m.id === 'growth')).toBe(false); // spell not in the minion table
  });

  it('splits card offers/picks by SOURCE (shop vs Discover); combined totals still drive ranking', () => {
    const rows: RunTelemetry[] = [
      blank({
        offeredCards: ['alley', 'alley'], boughtCards: ['alley'], // shop: seen 2, bought 1
        discoverOfferedCards: ['alley', 'alley', 'alley'], discoverBoughtCards: ['alley'], // Discover: seen 3, bought 1
      }),
    ];
    const alley = aggregatePlayerReport(rows).minions.find((m) => m.id === 'alley')!;
    expect([alley.shopOffered, alley.shopPicked]).toEqual([2, 1]);
    expect([alley.discoverOffered, alley.discoverPicked]).toEqual([3, 1]);
    expect([alley.offered, alley.picked]).toEqual([5, 2]); // combined (shop + Discover) — used for pick rate + sort
    expect(alley.pickRate).toBe(40); // 2 / 5
  });
});

describe('reconstructRunTelemetry', () => {
  it('recovers offers + picks from a greedy playthrough replay', () => {
    // Play a short greedy run, recording the action log, then reconstruct telemetry from (seed, heroId, actions).
    const seed = 7;
    let s = createRun(seed, 'warden');
    const actions: Action[] = [];
    const dispatch = (a: Action): void => { const n = reduce(s, a); if (n !== s) actions.push(a); s = n; };
    let steps = 0;
    while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 400) {
      if (s.questOffer) { dispatch({ type: 'buyQuest', index: 0 }); continue; }
      if (s.runeforgeOffer) { dispatch({ type: 'buyRune', index: 0 }); continue; }
      if (s.discover) { dispatch({ type: 'discover', index: 0 }); continue; }
      if (s.chooseOne) { dispatch({ type: 'chooseOne', index: 0 }); continue; }
      if (s.pendingTarget) { dispatch({ type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
      if (s.phase === 'combat') { dispatch({ type: 'resolveCombat' }); continue; }
      if (s.embers >= CONFIG.minionCost && s.shop.length > 0 && s.board.length + s.hand.length < CONFIG.boardMax) { dispatch({ type: 'buy', uid: s.shop[0]!.uid }); continue; }
      if (s.hand.length > 0 && s.board.length < CONFIG.boardMax) { dispatch({ type: 'play', uid: s.hand[0]!.uid }); continue; }
      dispatch({ type: 'faceOmen' });
    }
    const t = reconstructRunTelemetry({ seed, heroId: 'warden', actions }, ['warden', 'a', 'b']);
    expect(t.heroId).toBe('warden');
    expect(t.heroOffer).toEqual(['warden', 'a', 'b']);
    expect(t.offeredCards.length).toBeGreaterThan(0); // saw shop cards
    expect(t.boughtCards.length).toBeGreaterThan(0); // bought at least one
    expect(t.offeredQuests.length).toBeGreaterThan(0); // a quest turn was reached
    // Every bought card was also offered (you can only buy what's in the shop).
    for (const id of t.boughtCards) expect(t.offeredCards).toContain(id);
    // Wave-tagged buy events mirror the acquisitions: one per shop buy + Discover pick, waves in 1..17.
    const shopEvents = (t.buyEvents ?? []).filter((e) => e.src === 'shop');
    expect(shopEvents.map((e) => e.id).sort()).toEqual([...t.boughtCards].sort());
    for (const e of t.buyEvents ?? []) { expect(e.wave).toBeGreaterThanOrEqual(1); expect(e.wave).toBeLessThanOrEqual(17); }
    // Shop-leveling curve is captured: wave 1 opens at tavern tier 1, and tier is monotonic non-decreasing.
    expect(t.tierByWave[1]).toBe(1);
    for (let w = 2; w < t.tierByWave.length; w++) {
      if (t.tierByWave[w] == null || t.tierByWave[w - 1] == null) continue;
      expect(t.tierByWave[w]!).toBeGreaterThanOrEqual(t.tierByWave[w - 1]!);
    }
  });
});

describe('buildCardCsv — the per-card analytics spreadsheet', () => {
  it('splits win rates by bought-vs-seen-only, computes lift, and buckets buy turns', () => {
    const rows: RunTelemetry[] = [
      // alley bought on turns 2 and 5 across two WON runs; seen-but-skipped in a lost one.
      blank({ won: true, offeredCards: ['alley'], boughtCards: ['alley'], buyEvents: [{ id: 'alley', wave: 2, src: 'shop' }] }),
      blank({ won: true, offeredCards: ['alley'], boughtCards: ['alley'], buyEvents: [{ id: 'alley', wave: 5, src: 'shop' }] }),
      blank({ won: false, offeredCards: ['alley'], boughtCards: [] }),
    ];
    const csv = buildCardCsv(rows);
    const lines = csv.split('\n');
    const header = lines[0]!.split(',');
    const row = lines.find((l) => l.startsWith('alley,'))!.split(',');
    const col = (name: string): string => row[header.indexOf(name)]!;
    expect(col('runs_seen')).toBe('3');
    expect(col('runs_bought')).toBe('2');
    expect(col('win_pct_when_bought')).toBe('100'); // both bought runs won
    expect(col('win_pct_seen_not_bought')).toBe('0'); // the skipped run lost
    expect(col('win_lift_pct')).toBe('100');
    expect(col('shop_conversion_pct')).toBe('66.7'); // 2 of 3 sightings bought
    expect(col('avg_buy_turn')).toBe('3.5'); // (2 + 5) / 2
    expect(col('buys_t2')).toBe('1');
    expect(col('buys_t5')).toBe('1');
    expect(col('buys_t3')).toBe('0');
  });

  it('rows without buyEvents (pre-migration) still contribute counts, just no turn columns', () => {
    const rows: RunTelemetry[] = [blank({ won: true, offeredCards: ['pack'], boughtCards: ['pack'] })];
    const csv = buildCardCsv(rows);
    const lines = csv.split('\n');
    const header = lines[0]!.split(',');
    const row = lines.find((l) => l.startsWith('pack,'))!.split(',');
    const col = (name: string): string => row[header.indexOf(name)]!;
    expect(col('runs_bought')).toBe('1');
    expect(col('avg_buy_turn')).toBe(''); // no wave data
  });
});

describe('shop-leveling curve aggregation', () => {
  it('averages tavern tier by wave, split won vs lost', () => {
    const rows: RunTelemetry[] = [
      blank({ won: true, tierByWave: [0, 1, 1, 2, 3] }),    // waves 1-4
      blank({ won: true, tierByWave: [0, 1, 2, 2] }),        // waves 1-3
      blank({ won: false, tierByWave: [0, 1, 1, 1, 1, 2] }), // waves 1-5
    ];
    const c = aggregatePlayerReport(rows).shopCurve;
    expect(c.maxWave).toBe(5);
    expect(c.wonRuns).toBe(2);
    expect(c.lostRuns).toBe(1);
    expect(c.won[1]).toBe(1);       // (1+1)/2
    expect(c.won[3]).toBe(2);       // (2+2)/2
    expect(c.won[4]).toBe(3);       // only run 1 reached wave 4
    expect(c.won[5]).toBeNull();    // no won run reached wave 5
    expect(c.lost[5]).toBe(2);      // single lost run
  });

  it('averages the wave a run first reaches each tavern tier (T1 = 1; null if none got there)', () => {
    const rows: RunTelemetry[] = [
      blank({ tierByWave: [0, 1, 1, 2, 3] }), // T2 at wave 3, T3 at wave 4
      blank({ tierByWave: [0, 1, 2, 2] }),     // T2 at wave 2, never T3
    ];
    const c = aggregatePlayerReport(rows).shopCurve;
    expect(c.avgWaveToTier[1]).toBe(1);   // T1 is a given (wave 1)
    expect(c.avgWaveToTier[2]).toBe(2.5); // (3 + 2) / 2
    expect(c.avgWaveToTier[3]).toBe(4);   // only run 1 reached T3, at wave 4
    expect(c.avgWaveToTier[4]).toBeNull(); // nobody reached T4
  });
});
