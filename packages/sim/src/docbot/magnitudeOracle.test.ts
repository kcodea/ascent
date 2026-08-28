/**
 * DOC BOT LANE `magnitudeOracle` — magnitude oracles: the effect grants EXACTLY what its params say (roadmap L2).
 *
 * The presence differentials (9/10) prove an effect acts; this proves it acts CORRECTLY, for the contracts
 * whose semantics are exact and param-derivable. A +2/+2 coded as +4/+2 passes every presence lane and fails
 * here with both numbers named. Three contracts, chosen as the largest families whose meaning is unambiguous:
 *
 *   · `cast:spellBuffTarget`   — the TARGET gains exactly (attack + spellPower, health + spellPowerH).
 *   · `onPlay:battlecryBuffTarget` — the TARGET gains exactly (attack, health) × golden.
 *   · `onDeath:deathrattleSummon`  — combat produces exactly `count` × golden summons of the named token.
 *
 * Every content user of each contract is asserted — a new card joining a family is covered the day it is
 * authored, and a rebalance that edits params without editing behaviour (or vice versa) fails immediately.
 * Growth path: add a contract per family as each is ruled unambiguous; never stretch a contract over a
 * family whose semantics vary (that is what the presence lanes are for).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from '../index';

const target = (): BoardCard => ({ uid: 'tgt', cardId: 'pup', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false } as BoardCard);

const base = (): RunState => ({
  ...createRun(0x0c1e, 'aster'),
  embers: 60,
  board: [target()],
  hand: [],
  shop: [],
} as RunState);

describe('Doc Bot — magnitude oracles', () => {
  it('cast:spellBuffTarget — the target gains exactly params (+spell power, none in fixture)', () => {
    const users = Object.values(CARD_INDEX).filter((c) => c?.spell
      && c.effects.some((e) => e.on === 'cast' && e.do === 'spellBuffTarget'));
    expect(users.length).toBeGreaterThanOrEqual(4); // surface check
    for (const spell of users) {
      // SUM the family's effects: Blessing carries spellBuffTarget TWICE ("+3/+4 twice") — reading only the
      // first entry mis-stated the contract on the oracle's first run.
      const effs = spell!.effects.filter((e) => e.on === 'cast' && e.do === 'spellBuffTarget');
      const expA = effs.reduce((n, e) => n + ((e.params?.attack as number) ?? 0), 0);
      const expH = effs.reduce((n, e) => n + ((e.params?.health as number) ?? 0), 0);
      const s0 = base();
      const s1 = reduce({ ...s0, hand: [{ uid: 'sp', cardId: spell!.id, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard] },
        { type: 'play', uid: 'sp', targetUid: 'tgt' });
      const t = s1.board.find((c) => c.uid === 'tgt')!;
      expect([t.attack - 1, t.health - 1], `${spell!.id}: params sum to +${expA}/+${expH}, the cast granted +${t.attack - 1}/+${t.health - 1}`)
        .toEqual([expA, expH]);
    }
  });

  it('onPlay:battlecryBuffTarget — the target gains exactly params, ×2 golden', () => {
    const users = Object.values(CARD_INDEX).filter((c) => c && !c.spell
      && c.effects.some((e) => e.on === 'onPlay' && e.do === 'battlecryBuffTarget'));
    expect(users.length).toBeGreaterThanOrEqual(2);
    for (const def of users) {
      const p = def!.effects.find((e) => e.do === 'battlecryBuffTarget')!.params as { attack?: number; health?: number };
      for (const golden of [false, true] as const) {
        const mult = golden ? 2 : 1;
        // The target must satisfy the card's own gate: Emissary demands a friendly DRAGON, and offering it a
        // Beast produced a CORRECT no-op on the oracle's first run. The fixture target wears the demanded tribe.
        const tgtTribe = (def as { targetTribe?: string }).targetTribe ?? 'beast';
        const s0 = base();
        s0.board = [{ ...target(), tribe: tgtTribe } as BoardCard];
        // Minion battlecries aim in TWO steps: play opens `pendingTarget`, `battlecryTarget` resolves it —
        // the play action's `targetUid` is the SPELL path (found by this oracle's first run: the inline
        // target was silently ignored and the grant never happened).
        let s1 = reduce({ ...s0, hand: [{ uid: 'm', cardId: def!.id, tribe: def!.tribe, attack: def!.attack * mult, health: def!.health * mult, keywords: [...def!.keywords], golden } as BoardCard] },
          { type: 'play', uid: 'm' });
        expect(s1.pendingTarget?.uid, `${def!.id}: playing a targeted battlecry with a valid board target must open the picker`).toBe('m');
        s1 = reduce(s1, { type: 'battlecryTarget', targetUid: 'tgt' });
        const t = s1.board.find((c) => c.uid === 'tgt')!;
        expect([t.attack - 1, t.health - 1], `${def!.id}${golden ? ' (golden)' : ''}: params say +${(p.attack ?? 0) * mult}/+${(p.health ?? 0) * mult}, the play granted +${t.attack - 1}/+${t.health - 1}`)
          .toEqual([(p.attack ?? 0) * mult, (p.health ?? 0) * mult]);
      }
    }
  });

  it('onDeath:deathrattleSummon — combat produces exactly count × golden summons of the named token', () => {
    const users = Object.values(CARD_INDEX).filter((c) => c && !c.spell
      && c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'));
    expect(users.length).toBeGreaterThanOrEqual(8);
    const bm = (cardId: string, uid: string, attack: number, health: number, golden = false): BoardMinion =>
      ({ cardId, attack, health, sourceUid: uid, keywords: [], golden } as unknown as BoardMinion);
    for (const def of users) {
      const eff = def!.effects.find((e) => e.do === 'deathrattleSummon')!;
      const p = eff.params as { count?: number; tokenId?: string };
      const tokenId = p.tokenId ?? '';
      if (!CARD_INDEX[tokenId]) continue; // token-less variants are another contract
      const px = eff.params as { fixed?: boolean; goldenTokens?: boolean };
      for (const golden of [false, true] as const) {
        // `fixed: true` = golden does NOT double the count (it gilds the tokens instead when `goldenTokens`)
        // — Manasaber taught this oracle its own contract on the first run.
        const expected = (p.count ?? 1) * (golden && !px.fixed ? 2 : 1);
        // The subject dies to a big enemy on an otherwise empty board — full room for its summons.
        const r = simulate([bm(def!.id, 'pS', 1, 1, golden)], [bm('cryptwolf', 'e0', 9, 40)],
          makeRng(3), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 5 }));
        const summoned = r.events.filter((e) => (e as { type?: string }).type === 'summon'
          && ((e as { minion?: { cardId?: string } }).minion?.cardId === tokenId)).length;
        expect(summoned, `${def!.id}${golden ? ' (golden)' : ''}: params say ${expected}× '${tokenId}', combat summoned ${summoned}`)
          .toBe(expected);
        if (golden && px.goldenTokens) {
          const gilded = r.events.filter((e) => (e as { type?: string }).type === 'summon'
            && (e as { minion?: { cardId?: string; golden?: boolean } }).minion?.cardId === tokenId
            && (e as { minion?: { golden?: boolean } }).minion?.golden).length;
          expect(gilded, `${def!.id} (golden, goldenTokens): the summoned '${tokenId}'s must arrive GILDED`).toBe(expected);
        }
      }
    }
  });
});
