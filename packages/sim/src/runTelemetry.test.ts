import { describe, it, expect } from 'vitest';
import { aggregatePlayerReport, reconstructRunTelemetry, type RunTelemetry } from './runTelemetry';
import { createRun, type Action } from './state';
import { reduce } from './reducer';
import { CONFIG } from './config';

const blank = (over: Partial<RunTelemetry>): RunTelemetry => ({
  heroId: 'warden', heroOffer: [], won: false, wins: 0,
  offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [],
  offeredCards: [], boughtCards: [], ...over,
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

  it('cards split into minions vs spells; each gets offer + pick only (no win credit)', () => {
    const rows: RunTelemetry[] = [
      blank({ won: true, offeredCards: ['alley', 'growth'], boughtCards: ['alley', 'growth'] }), // alley=minion, growth=spell
    ];
    const rep = aggregatePlayerReport(rows);
    const alley = rep.minions.find((m) => m.id === 'alley')!;
    expect([alley.offered, alley.picked]).toEqual([1, 1]);
    expect(rep.minions.some((m) => m.id === 'growth')).toBe(false); // the spell is NOT in the minion table…
    const growth = rep.spells.find((s) => s.id === 'growth')!; // …it's in the spell table
    expect(growth, 'growth in spells').toBeDefined();
    expect([growth.offered, growth.picked]).toEqual([1, 1]);
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
  });
});
