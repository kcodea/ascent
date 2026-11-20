import { describe, it, expect } from 'vitest';
import {
  combatSide, fuzzCombatBoard, fuzzCombatSide, makeRng, simulate,
  type CombatCarryBacks, type CombatEvent, type CombatResult, type FuzzPool, type QuestCombatMods, type Side,
} from '../index';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';

/**
 * R-COMBAT-GOLD-EVENT-01 (owner 2026-11-20: "make ALL combat Gold update live"). Every Gold a fight adds to a side's
 * NEXT turn is logged the moment it happens: one-turn Gold as `bonusGold`, max Gold as `maxGold`. The events only
 * REPORT; settle keeps paying from the carry-backs. This sweep pins that the two always agree, per side, so the Gold
 * pill's live forecast lands exactly on the settled number:
 *
 *   sum(bonusGold) = carry.bonusGold                     (every `grantBonusGold`: Bounty Bot, Goldvein, Warm Up, ...)
 *                  + wardBreaks x ancientWardBreakGold   (Fortune x Warden, paid at settle)
 *                  + rises x ancientRiseGold             (Fortune x Risen, paid at settle)
 *                  + impsSummoned (Ashen Payroll held)   (paid at settle)
 *   sum(maxGold)   = carry.maxGoldGain                    (Soulsman, Bone Taxer, Rune of Soul Taxes)
 *                  + ancientMaxGoldFires x its gold       (Nadja x Death, paid at settle)
 *                  + own halves of team max-Gold sends    (Richmond, landed at settle off `teamEffects`)
 */

const SET_IDS: SetId[] = ['set1', 'set2', 'set3'];
const fp = (set: SetId): FuzzPool => ({ ...poolFor(set), tribes: SETS[set].tribes });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function carryOf(r: CombatResult, side: Side): CombatCarryBacks {
  if (side === 'enemy') return r.enemyCarry!;
  return {
    bonusGold: r.playerBonusGold, maxGoldGain: r.playerMaxGoldGain, ancientMaxGoldFires: r.playerAncientMaxGoldFires,
    wardBreaks: r.playerWardBreaks, rises: r.playerRises, impsSummoned: r.playerImpsSummoned, shoutCarry: r.playerShoutCarry,
  } as CombatCarryBacks;
}

/** Which settle sources paid, across the whole sweep (each must be exercised at least once). */
const hits: Record<string, number> = { bank: 0, ward: 0, rise: 0, ashen: 0, maxGain: 0, nadja: 0 };

function expected(c: CombatCarryBacks, m: QuestCombatMods): { next: number; max: number } {
  const add = (k: string, v: number): number => { if (v > 0) hits[k]! += 1; return v; };
  let next = add('bank', c.bonusGold ?? 0);
  if (m.ancientTrackWardBreaks && m.ancientWardBreakGold) next += add('ward', (c.wardBreaks?.length ?? 0) * m.ancientWardBreakGold);
  if (m.ancientCountRises && m.ancientRiseGold) next += add('rise', (c.rises ?? 0) * m.ancientRiseGold);
  if (m.runeAshenPayroll) next += add('ashen', c.impsSummoned ?? 0);
  let max = add('maxGain', c.maxGoldGain ?? 0);
  if (m.ancientMaxGoldAvenge) max += add('nadja', (c.ancientMaxGoldFires ?? 0) * m.ancientMaxGoldAvenge.gold);
  for (const t of c.shoutCarry?.teamEffects ?? []) if (t.self && t.effect.kind === 'maxGold') max += t.effect.amount;
  return { next, max };
}

const logged = (events: readonly CombatEvent[], side: Side): { next: number; max: number } => ({
  next: events.reduce((n, e) => n + (e.type === 'bonusGold' && e.side === side ? e.amount : 0), 0),
  max: events.reduce((n, e) => n + (e.type === 'maxGold' && e.side === side ? e.amount : 0), 0),
});

describe('combat Gold events sum to what settle pays (R-COMBAT-GOLD-EVENT-01)', () => {
  for (const set of SET_IDS) {
    it(`${set}: 300 random fights with random combat mods, both sides`, () => {
      let paying = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const r = makeRng(seed * 7919 + set.length);
        const A = fuzzCombatBoard(r, fp(set), 'A');
        const B = fuzzCombatBoard(r, fp(set), 'B');
        const sA = fuzzCombatSide(r, fp(set), 'A', A);
        const sB = fuzzCombatSide(r, fp(set), 'B', B);
        const res = simulate(clone(A), clone(B), makeRng(seed), CARD_INDEX, clone(sA), clone(sB));
        for (const [side, st] of [['player', sA], ['enemy', sB]] as const) {
          const want = expected(carryOf(res, side), st.questMods ?? {});
          const got = logged(res.events, side);
          expect(got, `${set} seed ${seed} ${side}`).toEqual(want);
          if (want.next > 0 || want.max > 0) paying++;
        }
      }
      expect(paying, 'the sweep exercises paying sources').toBeGreaterThan(5);
    });
  }

  it('every settle source was exercised by the sweep', () => {
    for (const [k, n] of Object.entries(hits)) expect(n, k).toBeGreaterThan(0);
  });

  it("Richmond's own half of a team max-Gold Shout re-fired in combat is logged on the sender", () => {
    // Ancient of Time x the Auctioneer fires the edge minions' Shouts at Start of Combat: Richmond's "+1 max Gold to
    // your team" goes out mid-fight. Its own half lands at settle off `teamEffects`; the `maxGold` reports it now.
    const board = [{ cardId: 'duo_richmond', attack: 7, health: 3, keywords: [], golden: false, sourceUid: 'rich' }];
    const foe = [{ cardId: board[0]!.cardId, attack: 1, health: 1, keywords: [], golden: false, sourceUid: 'foe' }];
    const res = simulate(clone(board), clone(foe), makeRng(5), CARD_INDEX, combatSide({ questMods: { ancientEdgeShouts: { label: 'Time' } } }), combatSide());
    const own = (res.playerShoutCarry?.teamEffects ?? []).filter((t) => t.self && t.effect.kind === 'maxGold');
    expect(own.length, 'the Shout fired').toBeGreaterThan(0);
    expect(logged(res.events, 'player').max).toBe(expected(carryOf(res, 'player'), { ancientEdgeShouts: { label: 'Time' } }).max);
    expect(logged(res.events, 'player').max).toBeGreaterThan(0);
  });

  it('Rune of Soul Taxes logs its +1 max Gold on the death that paid it', () => {
    const weak = Array.from({ length: 6 }, (_, k) => ({ cardId: 'alley', attack: 1, health: 1, keywords: [], golden: false, sourceUid: `w${k}` }));
    const big = [{ cardId: 'alley', attack: 50, health: 200, keywords: [], golden: false, sourceUid: 'big' }];
    const mods = { runeSoulTaxes: true } as QuestCombatMods;
    const res = simulate(clone(weak), clone(big), makeRng(11), CARD_INDEX, combatSide({ questMods: mods }), combatSide());
    expect(res.playerMaxGoldGain ?? 0, 'six deaths pay at the 4th').toBeGreaterThan(0);
    expect(logged(res.events, 'player').max).toBe(res.playerMaxGoldGain);
  });

  it('a fight is deterministic with the new events (same seed, same log)', () => {
    const r = makeRng(42);
    const A = fuzzCombatBoard(r, fp('set1'), 'A');
    const B = fuzzCombatBoard(r, fp('set1'), 'B');
    const a = simulate(clone(A), clone(B), makeRng(3), CARD_INDEX);
    const b = simulate(clone(A), clone(B), makeRng(3), CARD_INDEX);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
