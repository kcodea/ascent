/**
 * DOC BOT LANE `missDrivenOracles` — oracles born directly from retro-validation misses (2026-08-26).
 *
 * Method: seven out-of-sample historical bugs were REINJECTED (reverted at the source line) and run against
 * the whole Doc Bot suite. Zero were caught. Three misses built the `combatModLane` lane; the four
 * here each encode the GENERIC contract their miss exposed — not a re-specific regression test (each fix
 * already shipped one of those), but the class rule that would have caught the next bug of its shape.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatCastable, combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from '../index';

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);

describe('Doc Bot — miss-driven oracles', () => {
  /** #933 — COPY SEMANTICS: a temporary keyword does not survive a triple; a real one does. */
  it('a triple keeps REAL keywords and drops TEMPORARY ones (#933: a one-combat Rise came out permanent)', () => {
    const base = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby
      && !c.keywords.includes('DS') && (c.effects?.length ?? 0) === 0)
      ?? Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && !c.keywords.includes('DS'))!;
    const copy = (uid: string, extra: Partial<BoardCard>): BoardCard => ({
      uid, cardId: base!.id, tribe: base!.tribe, attack: base!.attack, health: base!.health,
      keywords: [...base!.keywords], golden: false, ...extra,
    } as BoardCard);
    const run = (temp: boolean): BoardCard => {
      const s0: RunState = {
        ...createRun(0x717e, 'aster'),
        embers: 30,
        board: [
          copy('a', { keywords: [...base!.keywords, 'DS'], ...(temp ? { tempShield: true } : {}) } as Partial<BoardCard>),
          copy('b', {}),
        ],
        hand: [copy('c', {})],
        shop: [],
      } as RunState;
      const s1 = reduce(s0, { type: 'play', uid: 'c' });
      // The formed golden goes to HAND (a triple is re-played), not the board.
      const golden = [...s1.board, ...s1.hand].find((c) => c.golden);
      expect(golden, `${base!.id}: playing the third copy must form a triple`).toBeTruthy();
      return golden!;
    };
    expect(run(false).keywords.includes('DS'), 'a REAL Ward on a combined copy survives the triple').toBe(true);
    expect(run(true).keywords.includes('DS'), 'a TEMPORARY (tempShield-marked) Ward must NOT survive the triple — #933 made it permanent').toBe(false);
  });

  /** #986 — ORDERING: onSummon watchers fire in CURRENT board order, left→right. Oona (double stats) and
   *  Beardsley (+3/+3) do not commute, so the summoned token's stats state the order arithmetically. */
  it('onSummon watchers fire left→right: Oona-then-Beardsley = double-then-add (#986)', () => {
    const echoer = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token
      && c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'
        && CARD_INDEX[(e.params as { tokenId?: string }).tokenId ?? '']?.tribe === 'beast'))!;
    const eff = echoer.effects.find((e) => e.do === 'deathrattleSummon')!.params as { tokenId: string };
    const token = CARD_INDEX[eff.tokenId]!;
    const r = simulate(
      [bm(echoer.id, 'p0', 1, 1), bm('b2_oona', 'p1', 1, 30), bm('b2_beardsley', 'p2', 1, 30, ['DS'])],
      [bm('cryptwolf', 'e0', 6, 40)],
      makeRng(13), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 5 }));
    // The watchers land as ORDERED buff events on the summoned token — order is directly observable.
    // Oona (LEFT, doubling: emitted as +currentStats) must buff before Beardsley (RIGHT, +3/+3): a token
    // summoned at 1/1 reads +1/+1 then +3/+3 = 5/5; the reversed order would read +3/+3 then +4/+4 = 8/8.
    const events = r.events as { type?: string; minion?: { uid?: string; cardId?: string }; target?: string; source?: string; attack?: number; health?: number; key?: string }[];
    const summonEv = events.find((e) => e.type === 'summon' && e.minion?.cardId === token.id);
    expect(summonEv, 'the echo token must arrive').toBeTruthy();
    const tokenUid = summonEv!.minion!.uid!;
    const buffs = events.filter((e) => e.type === 'buff' && e.target === tokenUid && /onSummon/.test(e.key ?? ''));
    expect(buffs.length, 'both watchers must react to the summon').toBe(2);
    expect(buffs[0]!.key, `the FIRST onSummon buff came from '${buffs[0]!.key}' — the LEFT watcher (Oona, onSummonTribeBuffThenDouble) must fire first; right-before-left is the #986 class (bus order drifting from board order)`)
      .toContain('onSummonTribeBuffThenDouble');
    expect([buffs[0]!.attack, buffs[0]!.health], 'Oona firing FIRST doubles the base 1/1 (+1/+1); a bigger delta means it fired after Beardsley').toEqual([token.attack, token.health]);
  });

  /** #897 — MULTIPLIERS THROUGH CHAINS: an Echo PROC'd by Echohorn honours Sylus exactly like a real death. */
  it("an Echohorn-proc'd Echo honours the Echo multiplier (#897: the chain dropped Sylus entirely)", () => {
    const pack = CARD_INDEX['pack']!; // Mama Pup: Echo summon two pups
    const count = (withMultiplier: boolean): number => {
      const third = withMultiplier ? bm('sylus', 'p2', 1, 30) : bm('cryptwolf', 'p2', 1, 30);
      const r = simulate(
        [bm('b2_echohorn', 'p0', 3, 20, [...CARD_INDEX['b2_echohorn']!.keywords]), bm(pack.id, 'p1', 1, 20), third],
        [bm('nanobot', 'e0', 1, 12)],
        makeRng(17), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 5 }));
      return r.events.filter((e) => (e as { type?: string; minion?: { cardId?: string } }).type === 'summon'
        && (e as { minion?: { cardId?: string } }).minion?.cardId === 'pup').length;
    };
    const plain = count(false);
    const doubled = count(true);
    expect(plain, "the fixture must actually proc the Stag's Echo re-fire").toBeGreaterThanOrEqual(2);
    expect(doubled, `Sylus on board: the proc'd Echo must summon exactly 2× (${plain} → ${plain * 2}); it summoned ${doubled} — #897's shape was byte-identical counts with or without Sylus`)
      .toBe(plain * 2);
  });

  /** #1111 — COMBAT-CASTABLE REGISTRY: spells that combat effects cast BY NAME must pass `combatCastable`,
   *  or they fizzle without counting. Grown whenever a new named combat cast ships. */
  it('every registered combat-cast spell passes combatCastable (#1111: Beefy and Lantern Light fizzled)', () => {
    const REQUIRED = ['sp_beefy', 'lanternlight', 'sp_dragonflame'];
    for (const id of REQUIRED) {
      const def = CARD_INDEX[id];
      expect(def, `registry names unknown spell '${id}'`).toBeTruthy();
      expect(combatCastable(def!), `'${id}' fails combatCastable — its combat cast will FIZZLE WITHOUT COUNTING (#1111). Add its cast dos to COMBAT_CASTABLE_SPELL_DOS with a combat implementation.`).toBe(true);
    }
  });
});
