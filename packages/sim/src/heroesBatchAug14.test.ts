import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type Tribe } from '@game/core';
import { HEROES } from './heroes';
import { createRun, reduce, type RunState } from './index';

const ALL_TRIBES: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon'];

/** Owner batch 2026-08-14: Tiff re-added; new heroes Merrin / Gambler / Xerox (the active-power tranche). */

describe('Tiff is back in the selectable pool', () => {
  it('is no longer flagged wip', () => {
    const tiff = HEROES.find((h) => h.id === 'tiff');
    expect(tiff, 'Tiff exists').toBeTruthy();
    expect(tiff!.wip, 'Tiff is offered again').toBeFalsy();
  });
});

describe('Merrin — Pocket Magic', () => {
  it('gets a random Shop spell to hand for 1 Gold', () => {
    let s: RunState = { ...createRun(3, 'merrin'), embers: 5, heroReady: true, hand: [] };
    s = reduce(s, { type: 'heroPower' });
    expect(s.hand.length, 'a card landed in hand').toBe(1);
    expect(CARD_INDEX[s.hand[0]!.cardId]?.spell, 'and it is a spell').toBe(true);
    expect(s.embers, '1 Gold spent').toBe(4);
  });
});

describe('Gambler — Dice', () => {
  it('rolls 1-6 and locks the power for that many turns', () => {
    let s: RunState = { ...createRun(3, 'gambler'), embers: 5, maxEmbers: 20, heroReady: true };
    const wave0 = s.wave;
    const before = s.embers;
    s = reduce(s, { type: 'heroPower' });
    const roll = (s.heroDiceLockUntil ?? 0) - wave0; // lockUntil = wave + roll
    expect(roll, 'a die was rolled (1-6)').toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(6);
    expect(s.embers, 'gained Gold from the roll (net of the 1-Gold cost)').toBe(before - 1 + roll);

    // Still on cooldown next attempt (heroReady recharged, but the lock holds) → no charge, no roll.
    const locked = reduce({ ...s, heroReady: true, embers: 5 }, { type: 'heroPower' });
    expect(locked.embers, 'locked: nothing happens').toBe(5);
  });
});

describe('Xerox — Copy Machine', () => {
  it('summons an EXACT copy beside the target — stats, buffs, keywords, golden and all', () => {
    let s: RunState = {
      ...createRun(3, 'xerox'), heroReady: true, hand: [],
      board: [{
        uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 9, health: 11,
        keywords: ['T', 'DS'], golden: true, summonBonus: 3, attachments: 2,
        buffs: [{ source: 'Spirit Fire', attack: 2, health: 3, count: 1 }],
      } as never],
    };
    s = reduce(s, { type: 'heroPower', uid: 'b1' });
    expect(s.board.length, 'the copy was summoned to the board').toBe(2);
    expect(s.hand.length, 'nothing went to hand').toBe(0);
    const orig = s.board.find((c) => c.uid === 'b1')!;
    const copy = s.board.find((c) => c.uid !== 'b1')!;
    // EXACT: everything but the uid matches the original.
    expect({ ...copy, uid: 'b1', resummon: undefined }).toEqual({ ...orig, resummon: undefined });
    expect([copy.attack, copy.health], 'the BUFFED stats, not the base 2/2').toEqual([9, 11]);
    expect(copy.golden, 'gilded carries').toBe(true);
    expect(copy.keywords, 'granted keywords carry').toEqual(['T', 'DS']);
    expect(copy.buffs, 'the buff breakdown carries').toEqual([{ source: 'Spirit Fire', attack: 2, health: 3, count: 1 }]);
    expect(copy.summonBonus, 'accrued counters carry').toBe(3);
    expect(s.heroPowerSpent, 'once per game — spent').toBe(true);
  });

  it('the copy is INDEPENDENT — buffing one does not move the other', () => {
    let s: RunState = {
      ...createRun(3, 'xerox'), heroReady: true, hand: [],
      board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 4, health: 4, keywords: ['T'], golden: false, buffs: [{ source: 'x', attack: 2, health: 2, count: 1 }] } as never],
    };
    s = reduce(s, { type: 'heroPower', uid: 'b1' });
    const copy = s.board.find((c) => c.uid !== 'b1')!;
    copy.keywords.push('R' as never);
    copy.buffs!.push({ source: 'later', attack: 1, health: 1, count: 1 });
    const orig = s.board.find((c) => c.uid === 'b1')!;
    expect(orig.keywords, 'the original kept its own keyword array').toEqual(['T']);
    expect(orig.buffs!.length, 'the original kept its own buff list').toBe(1);
  });

  it('is unusable with a full board (needs a slot)', () => {
    const full = Array.from({ length: 7 }, (_, i) => ({ uid: `f${i}`, cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }));
    const s: RunState = { ...createRun(3, 'xerox'), heroReady: true, hand: [], board: full } as RunState;
    const after = reduce(s, { type: 'heroPower', uid: 'f0' });
    expect(after.board.length, 'no eighth body').toBe(7);
    expect(after.heroPowerSpent, 'the once-per-game charge is NOT spent').toBeFalsy();
  });
});

describe('Hunch — Rounded Spellbook', () => {
  it('copies the last spell cast, at a cost that drops 1 per turn', () => {
    const spell = CARD_INDEX['spiritfire']!;
    // Wave 1, never used → full 3 Gold.
    let s: RunState = { ...createRun(3, 'hunch'), embers: 10, maxEmbers: 20, heroReady: true, hand: [], wave: 1, lastSpellCastId: spell.id };
    const before = s.embers;
    s = reduce(s, { type: 'heroPower' });
    expect(s.hand.some((c) => c.cardId === spell.id), 'a copy of the last spell').toBe(true);
    expect(before - s.embers, 'cost 3 on the first turn').toBe(3);
    expect(s.hunchResetWave, 'the countdown re-bases to this wave').toBe(1);

    // Two turns later the cost has fallen to 1 (3 − 2 turns elapsed since the use).
    const later: RunState = { ...s, wave: 3, heroReady: true, embers: 10, hand: [] };
    const after = reduce(later, { type: 'heroPower' });
    expect(10 - after.embers, 'cost 1 two turns after the last use').toBe(1);
  });

  it('no-ops with no spell cast yet', () => {
    const s: RunState = { ...createRun(3, 'hunch'), embers: 10, heroReady: true, hand: [], lastSpellCastId: undefined };
    const after = reduce(s, { type: 'heroPower' });
    expect(after.hand.length).toBe(0);
    expect(after.embers, 'no Gold spent').toBe(10);
  });
});

describe('Frantic Frank — Clearance', () => {
  it('refreshes the Shop and makes its minions cost 2 Gold this turn', () => {
    let s: RunState = { ...createRun(3, 'frank'), embers: 10, maxEmbers: 20, heroReady: true, tier: 3 };
    s = reduce(s, { type: 'heroPower' });
    expect(s.frankClearanceTurn, 'clearance armed for this turn').toBe(s.wave);
    const offer = s.shop.find((o) => { const d = CARD_INDEX[o.cardId]; return d && !d.spell && !d.ruby && !(o.cost != null); });
    expect(offer, 'a normal Shop minion to buy').toBeTruthy();
    const before = s.embers;
    const after = reduce(s, { type: 'buy', uid: offer!.uid });
    expect(before - after.embers, 'that minion cost 2 Gold under Clearance').toBe(2);
  });
});

describe('Foreman Flint — Company Rate', () => {
  it('Dwarf minions cost 2 Gold; others cost the normal price', () => {
    const s: RunState = {
      ...createRun(5, 'flint'), embers: 20, maxEmbers: 20, tier: 3, hand: [],
      shop: [{ uid: 'd0', cardId: 'dw_brunni' }, { uid: 'n0', cardId: 'stray' }],
    };
    const dwarf = reduce(s, { type: 'buy', uid: 'd0' });
    expect(s.embers - dwarf.embers, 'a Dwarf costs 2').toBe(2);
    const other = reduce(s, { type: 'buy', uid: 'n0' });
    expect(s.embers - other.embers, 'a non-Dwarf is not discounted').toBeGreaterThan(2);
  });
});

describe('Emissary Vale — United Front', () => {
  it('Start of Combat gives one minion of each tribe +tier/+tier', () => {
    const p: BoardMinion[] = [
      { cardId: 'stray', attack: 2, health: 20 },    // beast
      { cardId: 'dm_clerk', attack: 2, health: 20 }, // demon
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 60 }];
    const r = simulate(p, e, makeRng(1), CARD_INDEX,
      combatSide({ tier: 4, tribes: ALL_TRIBES, questMods: { unitedFront: 4 } }), combatSide({ tier: 1 }));
    const banners = r.events.filter((ev) => ev.type === 'buff' && ev.attack === 4 && ev.health === 4);
    expect(banners.length, 'one banner per tribe (beast + demon) at +4/+4').toBe(2);
  });

  it('grants a Fatecarver when the Shop reaches Tier 6', () => {
    let s: RunState = { ...createRun(5, 'vale'), embers: 50, maxEmbers: 50, tier: 5, hand: [] };
    s = reduce(s, { type: 'upgrade' });
    expect(s.tier, 'upgraded to Tier 6').toBe(6);
    expect(s.hand.some((c) => c.cardId === 'n2_fatecarver'), 'a Fatecarver arrived').toBe(true);
  });
});

describe('Quillen — Archive', () => {
  it('archives 3 Shop minions (once/turn) then Discovers from their types', () => {
    let s: RunState = {
      ...createRun(5, 'quillen'), tier: 5, heroReady: true,
      shop: [{ uid: 'a', cardId: 'stray' }, { uid: 'b', cardId: 'alley' }, { uid: 'c', cardId: 'dm_clerk' }], // beast, beast, demon
    };
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.archivedTribes, 'first type recorded').toEqual(['beast']);
    expect(s.shop.find((o) => o.uid === 'a'), 'the archived offer left the Shop').toBeUndefined();
    s = reduce({ ...s, heroReady: true }, { type: 'heroPower', uid: 'b' });
    s = reduce({ ...s, heroReady: true }, { type: 'heroPower', uid: 'c' });
    expect(s.archivedTribes, 'archive reset after the 3rd').toEqual([]);
    expect(s.discover?.length, 'a Discover of one minion per archived type').toBe(3);
    const isTribe = (id: string, t: string): boolean => CARD_INDEX[id]?.tribe === t || CARD_INDEX[id]?.tribe2 === t;
    expect(s.discover!.filter((id) => isTribe(id, 'beast')).length, 'two Beasts (from the two archived Beasts)').toBe(2);
    expect(s.discover!.filter((id) => isTribe(id, 'demon')).length, 'one Demon').toBe(1);
  });

  it('can also archive a FRIENDLY board minion', () => {
    const s: RunState = {
      ...createRun(5, 'quillen'), tier: 5, heroReady: true, shop: [],
      board: [{ uid: 'm1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    };
    const after = reduce(s, { type: 'heroPower', uid: 'm1' });
    expect(after.board.length, 'the archived friendly left the board').toBe(0);
    expect(after.archivedTribes, 'its type was recorded').toEqual(['beast']);
  });
});

describe('Pete — Contrabanana', () => {
  it('every 3rd refresh makes the RIGHT-MOST offer a tier above (no extra offer added)', () => {
    let s: RunState = { ...createRun(4, 'pete'), embers: 50, maxEmbers: 50, heroReady: true, tier: 3, freeRolls: 99 };
    s = reduce(s, { type: 'roll' });
    const widthAfter1 = s.shop.length;
    s = reduce(s, { type: 'roll' });
    s = reduce(s, { type: 'roll' });
    expect(s.refreshCount).toBe(3);
    expect(s.shop.length, 'the row is the same width — an offer is UPGRADED, not appended').toBe(widthAfter1);
    // The right-most MINION offer is from the tier above.
    const minions = s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return d && !d.spell && !d.ruby; });
    expect(CARD_INDEX[minions[minions.length - 1]!.cardId]?.tier, 'right-most is Tier 4').toBe(4);
  });
});
