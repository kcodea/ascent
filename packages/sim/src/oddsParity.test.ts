/**
 * ODDS PARITY (R-ODDS-ALL-MODES-01, owner 2026-11-17: "are our combat sims accurate still with ancients?").
 *
 * The Combat Summary's win / draw / loss odds re-run the stashed `oddsInput` on the odds seeds. They are only honest if
 * that input IS the fight: re-simulating it on the REAL fight's seed must reproduce the real fight event for event. This
 * pins that for the solo game with combat-time Ancients live (Indy x War / Time, Warden x Bonds / Genesis), for a
 * Practice bot fight (its damage multiplier rides the input), and for the server-resolved Versus 1v1 and Versus Duos
 * tag-team fights (each seat's view carries the same inputs, read from its own chair).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { makeRng, simulate, type CombatResult } from '@game/core';
import {
  ANCIENT_IDS, computeCombatOdds, createRun, enableAncients, mixSeed, reduce, resolveVersusDuosRound, resolveVersusFight, TAG,
  versusCombatSeed, versusDuosCombatSeed, duosMemberView,
  type AncientId, type BoardCard, type BoardSnapshot, type CombatOddsInput, type RunState,
} from './index';

const card = (uid: string, cardId: string, attack: number, health: number, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack, health, keywords: [], golden: false, ...extra };
};
// Distinct effect-less bodies (no triples fold them into goldens).
const board = (): BoardCard[] => [
  card('a', 'hm_test_squire', 6, 9, { golden: true }),
  card('b', 'shaper', 4, 7, { keywords: ['DS'] }),
  card('c', 'beetle', 5, 5, { keywords: ['DS'], golden: true }),
  card('v', 'n2_spellsword', 3, 8),
];
const foe = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 4, triples: 0, tribes: [], threat: 'glass', power: 60,
  minions: [
    { cardId: 'sandbag', attack: 5, health: 12, keywords: ['DS'] },
    { cardId: 'sandbag', attack: 7, health: 9, keywords: [] },
    { cardId: 'sandbag', attack: 4, health: 14, keywords: ['T'] },
  ],
  seed: 1, origin: 'self',
});
const withAncient = (s: RunState, id: AncientId): RunState => {
  let r = enableAncients(s);
  r = { ...r, ancients: { ...r.ancients!, points: r.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  r = reduce(r, { type: 'pickAncient', id });
  expect(r.ancients!.picked).toBe(id);
  return r;
};
const run = (heroId: string, ancient: AncientId | null, mode?: 'practice'): RunState => {
  const s = { ...createRun(31, heroId, mode), phase: 'recruit', embers: 0, hand: [], board: board() } as RunState;
  return ancient ? withAncient(s, ancient) : s;
};
/** The fight's outcome-bearing core: result, damage, every event (the replay the player watches). */
const core = (r: CombatResult): unknown => ({ result: r.result, events: r.events, enemyDamage: r.enemyDamage });

describe('solo: the stashed odds input re-runs to the real fight (Ancients live)', () => {
  // [hero, Ancient, the combat mod it rides, does it change THIS fight's outcome log] — the Warden pairings here pay out
  // from the fight (Ward-break tallies, Bonds on a stat gain) rather than reshape it, and still must ride the input.
  const pairings: [string, AncientId, string, boolean][] = [
    ['indy', 'war', 'ancientWar', true], ['indy', 'time', 'ancientTimeGild', true],
    ['warden', 'bonds', 'ancientBonds', false], ['warden', 'genesis', 'ancientWardCopy', false],
  ];
  it.each(pairings)('%s x %s: the Ancient rides the input, and the input on the combat seed IS the fight', (hero, ancient, mod, reshapes) => {
    const s0 = run(hero, ancient);
    const s = reduce({ ...s0, servedBoards: { [s0.wave]: foe(s0.wave) } }, { type: 'faceOmen' });
    const lc = s.lastCombat!;
    const input = lc.oddsInput!;
    expect(input, 'stashed').toBeTruthy();
    expect((input.playerState.questMods as Record<string, unknown>)[mod], `${mod} is in the probe's side`).toBeTruthy();
    const before = JSON.stringify(input);
    const again = simulate(input.player, input.enemy, makeRng(mixSeed(s.seed, s.wave, TAG.COMBAT)), CARD_INDEX, input.playerState, input.enemyState, input.config);
    expect(core(again)).toEqual(core(lc));
    const { [mod]: _gone, ...noAncient } = input.playerState.questMods as Record<string, unknown>;
    const without = simulate(input.player, input.enemy, makeRng(mixSeed(s.seed, s.wave, TAG.COMBAT)), CARD_INDEX, { ...input.playerState, questMods: noAncient as typeof input.playerState.questMods }, input.enemyState, input.config);
    if (reshapes) expect(core(without), 'the Ancient really shapes this fight, so parity is not vacuous').not.toEqual(core(lc));
    expect(Math.min(again.playerDamage, lc.damageCap ?? Infinity)).toBe(lc.playerDamage);
    // Settling the fight (carry-backs, Ancient payouts) never touches the input the probe reads mid-replay.
    const settled = reduce(s, { type: 'settleCombat' });
    expect(JSON.stringify(settled.lastCombat!.oddsInput)).toBe(before);
    expect(JSON.stringify(input), 'the re-run did not mutate it either').toBe(before);
  });

  it('a Practice bot fight carries its loss multiplier, so the typical loss is the real blow', () => {
    const s0 = { ...run('indy', null, 'practice'), practiceConfig: { opponents: 'bots', botDifficulty: 10, health: 'normal', timeMult: 1 } } as RunState;
    const s = reduce({ ...s0, servedBoards: { [s0.wave]: foe(s0.wave) } }, { type: 'faceOmen' });
    const input = s.lastCombat!.oddsInput!;
    expect(input.lossDamageMult ?? 1).toBeGreaterThan(1);
    const plain = computeCombatOdds({ ...input, lossDamageMult: undefined }, s.seed, s.wave, Infinity);
    const scaled = computeCombatOdds(input, s.seed, s.wave, Infinity);
    expect([scaled.win, scaled.draw, scaled.lose]).toEqual([plain.win, plain.draw, plain.lose]); // the chance never moves
    if (plain.lose > 0) expect(scaled.avgLossDamage).toBeGreaterThan(plain.avgLossDamage);
  });
});

/** Odds read from the other chair: win and loss swap, the damages swap with them. */
const flipped = (o: ReturnType<typeof computeCombatOdds>) => ({ win: o.lose, draw: o.draw, lose: o.win });

describe('server-resolved fights carry the exact inputs, from each seat\'s chair', () => {
  const side = (hero: string, ancient: AncientId | null, seed: number) => {
    const s0 = { ...run(hero, ancient), seed };
    return reduce(s0, { type: 'faceOmen', deferFight: true }).pendingCombatSide!;
  };

  it('Versus 1v1: p1 and p2 views re-run to the one fight; p2 reads it mirrored', () => {
    const p1 = side('indy', 'war', 5), p2 = side('warden', 'bonds', 6);
    for (const round of [1, 2]) {
      const out = resolveVersusFight({ matchSeed: 77, round, p1, p2 });
      const i1 = out.p1.oddsInput!, i2 = out.p2.oddsInput!;
      expect(i1.perspective ?? 'player').toBe('player');
      expect(i2.perspective).toBe('enemy');
      const again = simulate(i1.player, i1.enemy, makeRng(versusCombatSeed(77, round)), CARD_INDEX, i1.playerState, i1.enemyState, i1.config);
      expect(again.events).toEqual(out.p1.events);
      expect(again.result).toBe(out.p1.result);
      const o1 = computeCombatOdds(i1 as CombatOddsInput, 3, round), o2 = computeCombatOdds(i2 as CombatOddsInput, 3, round);
      expect({ win: o2.win, draw: o2.draw, lose: o2.lose }).toEqual(flipped(o1));
      expect(o2.avgWinDamage).toBeCloseTo(o1.avgLossDamage, 9);
    }
  });

  it('Versus Duos: the TEAM fight (leads + reserves) re-runs exactly; each member keeps its team\'s odds', () => {
    const sides = { p1: side('indy', 'time', 11), p2: side('warden', 'genesis', 12), p3: side('indy', null, 13), p4: side('warden', null, 14) };
    const out = resolveVersusDuosRound({ matchSeed: 91, round: 3, sides });
    const ia = out.aResult.oddsInput!;
    expect(ia.config.reserve?.player && ia.config.reserve?.enemy, 'both reserves ride the input').toBeTruthy();
    const again = simulate(ia.player, ia.enemy, makeRng(versusDuosCombatSeed(91, 3)), CARD_INDEX, ia.playerState, ia.enemyState, ia.config);
    expect(again.events).toEqual(out.aResult.events);
    expect(again.result).toBe(out.aResult.result);
    // A member's own view (its carry-backs only) still carries the team's input: the chance is the team's.
    expect(duosMemberView(out.aResult, 1).oddsInput).toEqual(ia);
    const oa = computeCombatOdds(ia as CombatOddsInput, 3, 3), ob = computeCombatOdds(out.bResult.oddsInput as CombatOddsInput, 3, 3);
    expect({ win: ob.win, draw: ob.draw, lose: ob.lose }).toEqual(flipped(oa));
  });
});
