/**
 * DUAL-TYPE RECIPIENTS GET THE SAME BUFF FX AS SINGLE-TYPE ONES (owner report 2026-09-19).
 *
 * Gangplank ("when a card is added to your hand, give a random friendly Dwarf +1/+2") buffed HAN GOVER — a
 * Dwarf/Undead (`tribe: 'dwarf', tribe2: 'undead'`) — and the stats rose with no ribbon. The owner's ask: *"make
 * sure the dual type tribes can trigger their animations from the correct sources."*
 *
 * Two contracts pinned here, one per half of the pipeline:
 *
 *  1. The shop-side CAPTURE (`captureBuffFx`) is a uid diff — it never looks at tribe — so a dual-type recipient
 *     records the SAME `sourceUid → targetUid` entry a plain Dwarf does. The tribe-aura wash (`auraFxTargets`)
 *     goes through the shared `isTribe` / `defIsTribe` predicates, so a dual-type Undead is washed on the board
 *     AND in the shop row.
 *
 *  2. The way the report actually happened: Han Gover's Ale is a COMBAT grant (40 damage dealt), which comes
 *     home at `settleCombat` — where the reducer's hand diff re-fires Gangplank on the RUN board and captures the
 *     wave with the phase still `combat`. The recruit UI must PARK that wave until the shop is revealed (the
 *     warband is not in the DOM under the arena); this pins the sim side of that contract — the capture exists,
 *     the seq bumped, and the phase is still `combat` when it does.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { auraFxTargets, isTribe } from './recruit';

const card = (uid: string, cardId: string, attack = 3, health = 3, extra?: Partial<BoardCard>): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false, ...extra });

/** Gangplank + one recipient on the board, a neutral Tier-1 offer to buy (the card reaching hand). */
function gangplankRun(recipientId: string): RunState {
  const offer = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && !c.ruby && c.tier === 1 && c.tribe === 'neutral')!;
  return {
    ...createRun(11, 'aster'), phase: 'recruit', tier: 4, embers: 30,
    board: [card('gp', 'dw_gangplank', 3, 5), card('r', recipientId, 4, 7)],
    hand: [],
    shop: [{ uid: 'o1', cardId: offer.id }],
  };
}

describe('fixture guard', () => {
  it('Han Gover is a Dwarf/Undead dual type whose Dwarf-ness lives on tribe2-aware predicates', () => {
    const d = CARD_INDEX.dw3_hangover!;
    expect([d.tribe, d.tribe2]).toEqual(['dwarf', 'undead']);
    expect(isTribe(card('x', 'dw3_hangover'), 'dwarf')).toBe(true);
    expect(isTribe(card('x', 'dw3_hangover'), 'undead')).toBe(true);
  });
});

describe('a Gangplank trigger records the same buff-FX entry for a dual-type recipient', () => {
  const entryFor = (recipientId: string) => {
    const s = reduce(gangplankRun(recipientId), { type: 'buy', uid: 'o1' });
    const r = s.board.find((c) => c.uid === 'r')!;
    return { fx: s.recruitBuffFx, seq: s.recruitFxSeq, stats: [r.attack, r.health] };
  };

  it('plain Dwarf (Orin) and Dwarf/Undead (Han Gover) both get source uid → target uid, +1/+2, kind minion', () => {
    const plain = entryFor('dw_orin');
    const dual = entryFor('dw3_hangover');
    expect(plain.stats, 'Orin took the +1/+2').toEqual([5, 9]);
    expect(dual.stats, 'Han Gover took the +1/+2').toEqual([5, 9]);
    const expected = [{ sourceUid: 'gp', targetUid: 'r', attack: 1, health: 2, sourceCardId: 'dw_gangplank', sourceTribe: 'dwarf', kind: 'minion' }];
    expect(plain.fx).toEqual(expected);
    expect(dual.fx, 'the dual-type recipient records the IDENTICAL FX entry').toEqual(expected);
    expect(plain.seq).toBe(1);
    expect(dual.seq, 'and the seq bumped so the UI replays it').toBe(1);
  });
});

describe('a tribe-aura wash includes dual-type members', () => {
  it('the Undead aura targets a Dwarf/Undead on the board and in the shop row', () => {
    const s: RunState = {
      ...createRun(11, 'aster'), phase: 'recruit',
      board: [card('hg', 'dw3_hangover'), card('orin', 'dw_orin'), card('pack', 'pack')],
      shop: [{ uid: 'o_hg', cardId: 'dw3_hangover' }, { uid: 'o_orin', cardId: 'dw_orin' }],
    };
    const targets = auraFxTargets(s, 'undead');
    expect(targets, 'the dual-type body on the board').toContain('hg');
    expect(targets, 'the dual-type offer in the shop').toContain('o_hg');
    expect(targets, 'a plain Dwarf is not Undead').not.toContain('orin');
    expect(targets).not.toContain('o_orin');
    expect(targets).not.toContain('pack');
  });
});

describe('a COMBAT grant settling into hand re-fires Gangplank on the run board (the report as it happened)', () => {
  it('settleCombat captures Gangplank → Han Gover with the seq bumped while the phase is still combat', () => {
    // Han Gover one hit short of its 40-damage Ale, against a sandbag: the real fight grants an Ale to hand.
    const r = simulate(
      [{ cardId: 'dw_gangplank', attack: 3, health: 5 } as BoardMinion,
        { cardId: 'dw3_hangover', attack: 5, health: 9, damageDealt: 39 } as unknown as BoardMinion],
      [{ cardId: 'sandbag', attack: 0, health: 300 } as BoardMinion],
      makeRng(1), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    expect(r.playerHandGrants?.length ?? 0, 'the fight granted an Ale to hand').toBeGreaterThan(0);
    // Gangplank already paid out DURING the fight (combat FX path: a `buff` event, m0 → m1)...
    expect(r.events.some((e) => e.type === 'buff' && e.source === 'm0' && e.target === 'm1'), 'in-combat payout').toBe(true);

    // ...and pays out AGAIN, permanently, when the Ale comes home at settle — the wave the shop must show.
    let s: RunState = {
      ...createRun(11, 'aster'), phase: 'combat', tier: 4,
      board: [card('gp', 'dw_gangplank', 3, 5), card('hg', 'dw3_hangover', 5, 9, { damageDealt: 39 })],
      hand: [], shop: [],
      lastCombat: r,
    };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.phase, 'still under the arena when the capture lands').toBe('combat');
    expect(s.hand.map((c) => c.cardId), 'the Ale settled into hand').toEqual(r.playerHandGrants);
    const hg = s.board.find((c) => c.uid === 'hg')!;
    expect([hg.attack, hg.health], 'Han Gover took the settle-time +1/+2').toEqual([6, 11]);
    expect(s.recruitBuffFx, 'the wave is captured with its source → target uids').toEqual([
      { sourceUid: 'gp', targetUid: 'hg', attack: 1, health: 2, sourceCardId: 'dw_gangplank', sourceTribe: 'dwarf', kind: 'minion' },
    ]);
    expect(s.recruitFxSeq, 'and the seq bumped — the UI parks this until the shop is revealed').toBe(1);
  });
});
