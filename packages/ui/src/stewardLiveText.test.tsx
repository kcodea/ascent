// @vitest-environment jsdom
/**
 * STEWARD OF SPELLS: live "(X)" suffix (owner 2026-10-09, verbatim: "steward of spells text always needs to say
 * 'End of Turn: Get a copy of the last spell cast. (X)' with X being the last spell cast").
 *
 * X is the run's `lastSpellCastId`, the exact field `spellCopyRecent` reads at End of Turn, so the printed name
 * is always the spell the card would actually copy. Before any cast there is nothing to name and the base text
 * stands with no parentheses. Pinned on the shop chain (`liveBoardView`) after REAL casts through the reducer,
 * and on the combat chain (the real `Unit`) for the player and the foe side. Rule R-TEXT-STEWARD-01.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import { enemyScalersOf, type CombatResult, type Keyword } from '@game/core';
import { createRun, reduce, sideFromSnapshot, snapshotBoard, type BoardCard, type RunState } from '@game/sim';
import { Unit } from './Unit';
import { liveBoardView } from './instView';
import { stewardText } from './cardText';
import { useGame } from './store';
import { descTextOf, mount, plainOf } from './renderedText.mount';

const BASE = '**End of Turn:** Get a copy of the last spell cast.';
const BASE_GOLDEN = '**End of Turn:** Get **2** copies of the last spell cast.';

const steward = (golden = false): BoardCard => ({
  uid: 'st', cardId: 'stewardofspells', tribe: 'neutral', attack: 5, health: 7, keywords: [], golden,
});
const handSpell = (uid: string, cardId: string): BoardCard => ({
  uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false,
});
const sandbag: BoardCard = { uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 40, keywords: [], golden: false };

const textOf = (s: RunState, golden = false): string => {
  const v = liveBoardView(steward(golden), s);
  return (golden ? v.goldenText ?? v.text : v.text);
};

describe('Steward of Spells: printed base text', () => {
  it('reads exactly the owner wording, normal and golden', () => {
    expect(CARD_INDEX['stewardofspells']!.text).toBe(BASE);
    expect(CARD_INDEX['stewardofspells']!.goldenText).toBe(BASE_GOLDEN);
  });
  it('the helper is null with no spell (static surfaces / before any cast) and for other cards', () => {
    expect(stewardText('stewardofspells', false, undefined)).toBeNull();
    expect(stewardText('sporebat', false, 'Growth')).toBeNull();
  });
  it('the helper appends the highlighted name to the printed rule', () => {
    expect(stewardText('stewardofspells', false, 'Growth')).toBe(`${BASE} ({{Growth}})`);
    expect(stewardText('stewardofspells', true, 'Growth')).toBe(`${BASE_GOLDEN} ({{Growth}})`);
  });
});

describe('Steward of Spells: shop chain follows real casts', () => {
  it('no suffix before any spell has been cast', () => {
    const s: RunState = { ...createRun(1), board: [steward(), sandbag] };
    expect(s.lastSpellCastId).toBeUndefined();
    expect(textOf(s)).toBe(BASE);
    expect(textOf(s)).not.toContain('(');
  });

  it('names the spell just cast, updates on the next cast, and matches what End of Turn copies', () => {
    let s: RunState = {
      ...createRun(1), board: [steward(), sandbag],
      hand: [handSpell('sp1', 'spiritfire'), handSpell('sp2', 'growth')],
    };
    s = reduce(s, { type: 'play', uid: 'sp1', targetUid: 'm' });
    expect(textOf(s)).toBe(`${BASE} ({{${CARD_INDEX['spiritfire']!.name}}})`);
    s = reduce(s, { type: 'play', uid: 'sp2', targetUid: 'm' });
    const name = CARD_INDEX['growth']!.name;
    expect(textOf(s)).toBe(`${BASE} ({{${name}}})`);
    expect(textOf(s, true)).toBe(`${BASE_GOLDEN} ({{${name}}})`);
    // The printed X is the field `spellCopyRecent` copies at End of Turn (the copy itself: run.test.ts).
    expect(s.lastSpellCastId).toBe('growth');
  });
});

describe('Steward of Spells: combat chain (Unit) prints the same suffix', () => {
  const m = mount(null);
  afterAll(() => m.unmount());
  const def = CARD_INDEX['stewardofspells']!;
  const frame = {
    uid: 'u-st', cardId: def.id, name: def.name, tribe: def.tribe, attack: def.attack, health: def.health,
    keywords: [...def.keywords] as Keyword[], divineShield: false, alive: true, golden: false, summonBonus: 0,
    baseAttack: def.attack, baseHealth: def.health,
  };

  it('player side: suffix after a cast, none before', () => {
    const withSpell = { ...createRun(7), lastSpellCastId: 'growth' } as RunState;
    act(() => { useGame.setState({ run: withSpell, compactCards: false }); });
    m.render(<Unit u={frame} side="you" />);
    expect(descTextOf(m.container)).toBe(plainOf(`${BASE} ({{${CARD_INDEX['growth']!.name}}})`));

    act(() => { useGame.setState({ run: createRun(7), compactCards: false }); });
    m.render(<Unit u={{ ...frame }} side="you" />);
    expect(descTextOf(m.container)).toBe(plainOf(BASE));
  });

  it("foe side: an enemy Steward names its OWNER's last spell", () => {
    const owner = { ...createRun(7), board: [steward()], lastSpellCastId: 'spiritfire' } as RunState;
    const scalers = enemyScalersOf(sideFromSnapshot(snapshotBoard(owner), owner.tier, []));
    const me = createRun(7);
    const lastCombat = { ...(me.lastCombat ?? {}), enemyScalers: scalers } as unknown as CombatResult;
    act(() => { useGame.setState({ run: { ...me, lastCombat } as RunState, compactCards: false }); });
    m.render(<Unit u={frame} side="foe" />);
    expect(descTextOf(m.container)).toBe(plainOf(`${BASE} ({{${CARD_INDEX['spiritfire']!.name}}})`));
  });
});
