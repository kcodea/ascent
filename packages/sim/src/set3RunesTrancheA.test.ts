import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, REVELER_IDS, RUNES, RUNE_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { offerBuyPrice } from './reducer';
import { revelerValue, spellCasts, spellDisplayText } from './recruit';
import { runeTally } from '../../ui/src/runeTally';

/**
 * SET 3 BATCH 2 (2026-09-16) — TRANCHE A: the Spirit / Celestial / Undead runes from the owner's sheet, plus the
 * Handy Flame rune token. Every rune is bought through the REAL Runeforge path and then driven with the real
 * `reduce`, so a rune that forgets a link fails here rather than shipping inert.
 *
 * Two sheet runes were deferred from this tranche — Rune of the Open Hand and Rune of the Waking Reserve — because
 * their effect lives in combat. Tranche D shipped them (`set3RunesTrancheD.test.ts`, core + sim); the roster below
 * is still tranche A's own 11 + 13.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', wave: 7, embers: 40, tier: 6, tribes: ['spirit', 'celestial', 'undead', 'kobold', 'dwarf'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), shop: [], board: [], hand: [], ...over } as RunState);
/** Buy `id` through the real Runeforge path on top of `over`. */
const armed = (id: string, over: Partial<RunState> = {}): RunState =>
  reduce(run({ ...over, runeforgeOffer: [id] }), { type: 'buyRune', index: 0 } as Action) as RunState;
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const play = (s: RunState, uid: string, targetUid?: string): RunState => act(s, { type: 'play', uid, toIndex: s.board.length, targetUid } as Action);
const sell = (s: RunState, uid: string): RunState => act(s, { type: 'sell', uid } as Action);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const inHand = (s: RunState, uid: string): BoardCard => s.hand.find((c) => c.uid === uid)!;
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const handIds = (s: RunState): string[] => s.hand.map((c) => c.cardId);
const isTribeId = (id: string, tribe: string): boolean => { const d = CARD_INDEX[id]; return d?.tribe === tribe || d?.tribe2 === tribe || !!d?.universalTribe; };
/** Drive the phase machine to the NEXT shop (faceOmen → settleCombat → resolveCombat), so turn setup runs. */
const nextTurn = (s: RunState): RunState => {
  const next = act(act(act(s, { type: 'faceOmen' } as Action), { type: 'settleCombat' } as Action), { type: 'resolveCombat' } as Action);
  expect(next.phase, 'the run never came back to a shop').toBe('recruit');
  return next;
};

// ── the roster ───────────────────────────────────────────────────────────────────────────────────────────
// tribes: undefined = no gate — the text names no tribe (owner rule: gate only where the text names a tribe on the board)
const BASIC: [string, number, string[] | undefined][] = [
  ['rune_basic_spirit', 3, ['spirit']], ['rune_basic_celestial', 3, ['celestial']], ['rune_basic_undead', 3, ['undead']],
  ['rune_full_hand', 4, ['spirit']], ['rune_chosen_vessel', 3, ['spirit']], ['rune_deep_currents', 4, ['spirit']],
  ['rune_traveling_festival', 4, ['spirit']], ['rune_growing_chorus', 4, ['spirit']], ['rune_charted_skies', 2, undefined], // 4 → 2 (2026-09-18)
  ['rune_falling_embers', 4, ['celestial']], ['rune_festival_wages', 3, ['spirit']],
];
const EPIC: [string, number, string[] | undefined][] = [
  ['rune_epic_celestial', 3, ['celestial']], ['rune_epic_spirit', 3, ['spirit']], ['rune_epic_undead', 3, ['undead']],
  ['rune_meteor_shower', 2, ['celestial']], ['rune_astral_refrain', 5, undefined], ['rune_astral_draft', 4, undefined], // Draft 6 → 4 (2026-09-18)
  ['rune_dream_mirror', 5, undefined], ['rune_waking_dreams', 5, undefined], ['rune_shared_revelry', 5, ['spirit']],
  ['rune_grand_procession', 6, ['spirit']], ['rune_festival_circuit', 4, ['spirit', 'celestial']], // Circuit 5 → 4 (2026-09-18)
  ['rune_spirit_crown', 6, ['spirit']], ['rune_handy_flame', 5, ['spirit']], // Handy Flame is a Spirit body → gated (tag pass 2026-09-18)
];

describe('tranche A — pool membership, cost, scope and tribe gates', () => {
  it('the sweep sees 11 Basic + 13 Epic; the two combat-side sheet runes shipped in tranche D', () => {
    expect(BASIC).toHaveLength(11);
    expect(EPIC).toHaveLength(13);
    expect(Object.values(RUNE_INDEX).filter((r) => /Open Hand|Waking Reserve/.test(r.name)), 'tranche D landed both').toHaveLength(2);
  });
  it.each(BASIC)('%s is BASIC, set 3 only, gated to %s', (id, cost, tribes) => {
    const r = RUNE_INDEX[id]!;
    expect(RUNES.some((x) => x.id === id)).toBe(true);
    expect(EPIC_RUNES.some((x) => x.id === id)).toBe(false);
    expect(r.epic).toBeFalsy();
    expect(r.cost).toBe(cost);
    expect(r.sets).toEqual(id === 'rune_full_hand' ? [] : ['set3']); // the Full Hand CUT FROM SET 3 2026-09-24 (owner): offered in no set
    expect(r.tribes).toEqual(tribes);
    expect(CARD_INDEX[id]).toBeUndefined();
  });
  it.each(EPIC)('%s is EPIC, set 3 only, gated to %s', (id, cost, tribes) => {
    const r = RUNE_INDEX[id]!;
    expect(EPIC_RUNES.some((x) => x.id === id)).toBe(true);
    expect(RUNES.some((x) => x.id === id)).toBe(false);
    expect(r.epic).toBe(true);
    expect(r.cost).toBe(cost);
    expect(r.sets).toEqual(['set3']);
    expect(r.tribes).toEqual(tribes);
  });
  it('the Crown rename: the sheet\'s "Rune of the Crown" ships as Rune of the Spirit Crown beside the existing Crown', () => {
    expect(RUNE_INDEX['rune_crown']!.name).toBe('Rune of the Crown');
    expect(RUNE_INDEX['rune_spirit_crown']!.name).toBe('Rune of the Spirit Crown');
  });
  it('tribe drips never say "up to your Shop Tier" — the Dwarf/Kobold verbiage, and the cap is in the engine', () => {
    for (const id of ['rune_basic_spirit', 'rune_basic_celestial', 'rune_basic_undead', 'rune_epic_spirit', 'rune_epic_celestial', 'rune_epic_undead']) {
      expect(RUNE_INDEX[id]!.text).not.toMatch(/Shop Tier/);
      expect(RUNE_INDEX[id]!.text).toMatch(/Repeat every \*\*Start of Turn\*\*/);
    }
  });
});

// ── the tribe drips ──────────────────────────────────────────────────────────────────────────────────────
describe('Rune of Basic / Epic Spirits, Celestials, Undead', () => {
  it.each([
    ['rune_basic_spirit', 'spirit', 1], ['rune_basic_celestial', 'celestial', 1], ['rune_basic_undead', 'undead', 1],
    ['rune_epic_spirit', 'spirit', 2], ['rune_epic_celestial', 'celestial', 2], ['rune_epic_undead', 'undead', 2],
  ] as const)('%s pays %s ×%i now and again at the next turn setup', (id, tribe, n) => {
    let s = armed(id);
    expect(s.hand).toHaveLength(n);
    for (const c of s.hand) expect(isTribeId(c.cardId, tribe), `${c.cardId} is a ${tribe}`).toBe(true);
    expect(s.runeProcs?.[id]).toBe(1);
    s = nextTurn(s);
    expect(s.hand).toHaveLength(2 * n);
  });
  it('is capped at the SHOP TIER (`payTribeDrip` filters `tier <= s.tier`) — a Tier-1 shop only ever gets Tier-1 Spirits', () => {
    let s = armed('rune_epic_spirit', { tier: 1 });
    s = nextTurn(nextTurn(s));
    expect(s.hand.length).toBeGreaterThanOrEqual(2);
    for (const c of s.hand) expect(CARD_INDEX[c.cardId]!.tier, c.cardId).toBe(1);
  });
});

// ── the Spirit-play runes ────────────────────────────────────────────────────────────────────────────────
describe('Rune of the Full Hand', () => {
  it('after every 3rd Spirit played, the minions in your hand get +4/+4 (spells untouched); the tally counts up', () => {
    // three DIFFERENT Spirits — three copies of one would triple into a golden on the buy and vanish from the hand
    let s = armed('rune_full_hand', { hand: [body('a', 'sp3_kindled'), body('b', 'sp3_flamereveler'), body('c', 'sp3_tidereveler'), body('h', 'venom'), body('g', 'growth')] });
    expect(runeTally(s, 'rune_full_hand')).toBe('0/3');
    s = play(s, 'a'); s = play(s, 'b');
    expect(runeTally(s, 'rune_full_hand')).toBe('2/3');
    expect(stats(inHand(s, 'h'))).toEqual([1, 1]);
    s = play(s, 'c');
    expect(stats(inHand(s, 'h'))).toEqual([5, 5]);
    expect(stats(inHand(s, 'g')), 'a spell in hand has no stats to take').toEqual([CARD_INDEX['growth']!.attack, CARD_INDEX['growth']!.health]);
    expect(runeTally(s, 'rune_full_hand')).toBe('0/3');
    expect(s.runeProcs?.['rune_full_hand']).toBe(1);
  });
});

describe('Rune of the Chosen Vessel', () => {
  it('each Spirit played gives the LEFT-MOST minion in hand +2/+2 — a spell on the left is skipped', () => {
    let s = armed('rune_chosen_vessel', { hand: [body('g', 'growth'), body('h', 'venom'), body('h2', 'venom'), body('a', 'sp3_kindled')] });
    s = play(s, 'a');
    expect(stats(inHand(s, 'h'))).toEqual([3, 3]);
    expect(stats(inHand(s, 'h2'))).toEqual([1, 1]);
    expect(s.runeProcs?.['rune_chosen_vessel']).toBe(1);
  });
  it('a non-Spirit play pays nothing', () => {
    let s = armed('rune_chosen_vessel', { hand: [body('h', 'venom'), body('v', 'venom')] });
    s = play(s, 'v');
    expect(stats(inHand(s, 'h'))).toEqual([1, 1]);
  });
});

describe('Rune of Deep Currents', () => {
  it('each Spirit played gives 2 random friendly Spirits +2/+2 (the played body is eligible)', () => {
    let s = armed('rune_deep_currents', { board: [body('k', 'sp3_kindled'), body('v', 'venom')], hand: [body('a', 'sp3_tidereveler')] });
    s = play(s, 'a');
    // exactly two Spirits on the board → both are the picks
    expect(stats(at(s, 'k'))).toEqual([1 + 2, 3 + 2]); // Kindled Sprite is 1/3 (2026-09-18)
    expect(stats(at(s, 'a'))).toEqual([3 + 2, 4 + 2]); // Tide Reveler 3/4 since 2026-09-18
    expect(stats(at(s, 'v')), 'not a Spirit').toEqual([1, 1]);
  });
});

describe('Rune of the Traveling Festival', () => {
  it('a random Reveler now and every turn setup; Revelers pay +2 more on the stat(s) they grant', () => {
    let s = armed('rune_traveling_festival', { board: [body('k', 'sp3_kindled'), body('f', 'sp3_flamereveler')] });
    expect(s.hand).toHaveLength(1);
    expect(REVELER_IDS).toContain(s.hand[0]!.cardId);
    expect(runeTally(s, 'rune_traveling_festival'), 'what a sale pays right now: 1 + 2').toBe('+3/+3');
    s = sell(s, 'f');
    expect(stats(at(s, 'k')), 'Flame: value 1 + the rune\'s 2 extra Attack, no Health').toEqual([1 + 3, 3]);
    expect(revelerValue(s), 'the shared value still rises by one').toBe(2);
    expect(runeTally(s, 'rune_traveling_festival')).toBe('+4/+4');
    s = nextTurn(s);
    expect(s.hand.filter((c) => REVELER_IDS.includes(c.cardId))).toHaveLength(2);
  });
});

describe('Rune of the Growing Chorus', () => {
  it('after a Flame, Tide AND Grove are played: board + hand +5/+5, the Reveler value +2, then a reset', () => {
    let s = armed('rune_growing_chorus', {
      board: [body('v', 'venom')],
      hand: [body('f', 'sp3_flamereveler'), body('t', 'sp3_tidereveler'), body('g', 'sp3_grovereveler'), body('h', 'venom'), body('f2', 'sp3_flamereveler')],
    });
    s = play(s, 'f');
    expect(runeTally(s, 'rune_growing_chorus')).toBe('1/3');
    s = play(s, 'f2');
    expect(runeTally(s, 'rune_growing_chorus'), 'a second Flame is not a second type').toBe('1/3');
    s = play(s, 't');
    expect(runeTally(s, 'rune_growing_chorus')).toBe('2/3');
    expect(stats(at(s, 'v'))).toEqual([1, 1]);
    s = play(s, 'g');
    expect(stats(at(s, 'v'))).toEqual([6, 6]);
    expect(stats(inHand(s, 'h'))).toEqual([6, 6]);
    expect(revelerValue(s)).toBe(3);
    expect(runeTally(s, 'rune_growing_chorus'), 'reset').toBe('0/3');
    expect(s.runeProcs?.['rune_growing_chorus']).toBe(1);
  });
});

// ── the Celestial spell runes ────────────────────────────────────────────────────────────────────────────
// Owner rework 2026-09-18: EVERY spell counts (Shop spells, Rubies, Clues, Gifts); the 3rd cast each turn hands over a
// seeded-random copy of one of those three. Once per turn.
describe('Rune of Charted Skies', () => {
  it('the 3rd spell each turn hands over a copy of one of the three (seeded); once per turn; the tally counts every spell', () => {
    let s = armed('rune_charted_skies', { board: [body('v', 'venom')], hand: [body('g1', 'growth'), body('g2', 'growth'), body('g3', 'growth'), body('g4', 'growth')] });
    s = play(s, 'g1'); s = play(s, 'g2');
    expect(runeTally(s, 'rune_charted_skies')).toBe('2/3');
    expect(s.hand.map((c) => c.cardId).filter((id) => id === 'growth')).toHaveLength(2);
    s = play(s, 'g3');
    expect(s.discover, 'no Discover any more').toBeUndefined();
    expect(handIds(s).filter((id) => id === 'growth'), 'one copy of one of the three (all Growth here) landed').toHaveLength(2);
    expect(runeTally(s, 'rune_charted_skies')).toBe('3/3');
    expect(s.runeProcs?.['rune_charted_skies']).toBe(1);
    s = play(s, 'g4'); // the 4th: nothing more this turn
    expect(s.runeProcs?.['rune_charted_skies']).toBe(1);
    expect(handIds(s).filter((id) => id === 'growth')).toHaveLength(1);
    // Determinism: the same seed picks the same copy.
    const a = armed('rune_charted_skies', { board: [body('v', 'venom')], hand: [body('g1', 'growth'), body('r', 'ruby'), body('g3', 'growth')] });
    const runIt = (x: RunState): string[] => { let t = play(x, 'g1'); t = play(t, 'r', 'v'); t = play(t, 'g3'); return handIds(t); };
    expect(runIt(a)).toEqual(runIt(a));
  });
  it('a Ruby, a Clue and a Gift all count toward the 3; a Gift is never the copy', () => {
    const gift = CARD_INDEX['gift_encore']!; // an untargeted Gift ("your Shouts trigger an extra time this turn")
    expect(gift.gift).toBe(true);
    let s = armed('rune_charted_skies', { board: [body('v', 'venom')], hand: [body('r', 'ruby'), body('gf', gift.id), body('g', 'growth')] });
    s = play(s, 'r', 'v');
    expect(runeTally(s, 'rune_charted_skies'), 'a Ruby counts').toBe('1/3');
    s = play(s, 'gf');
    expect(runeTally(s, 'rune_charted_skies'), 'a Gift counts').toBe('2/3');
    s = play(s, 'g');
    expect(s.runeProcs?.['rune_charted_skies']).toBe(1);
    const copy = s.hand[s.hand.length - 1]!;
    expect(['ruby', 'growth'], 'the copy is the Ruby or the Growth — never the Gift').toContain(copy.cardId);
    expect(handIds(s)).not.toContain(gift.id);
  });
});

describe('Rune of Falling Embers', () => {
  it('a Star Crash now and every turn setup; every Star Crash lands +2/+2 more on BOTH its targets', () => {
    let s = armed('rune_falling_embers', { board: [body('c', 'ce3_wishingstar')] });
    expect(handIds(s)).toEqual(['starcrash']);
    const sc = s.hand[0]!;
    s = play(s, sc.uid, 'c');
    // one body on the board: the aimed landing AND the random-friendly landing both hit it → 2 × (5+2)/(7+2)
    expect(stats(at(s, 'c'))).toEqual([CARD_INDEX['ce3_wishingstar']!.attack + 14, CARD_INDEX['ce3_wishingstar']!.health + 18]);
    s = nextTurn(s);
    expect(handIds(s)).toEqual(['starcrash']);
    expect(s.runeProcs?.['rune_falling_embers']).toBeGreaterThanOrEqual(2);
  });
  it('the Star Crash card prints the value it grants (base + power + the rune), in place', () => {
    const s = armed('rune_falling_embers');
    expect(spellDisplayText('starcrash', 0, 0, 0, 0, 0, 0, { starCrashBonus: s.starCrashBonus })).toContain('{{+7/+9}}');
    expect(spellDisplayText('starcrash', 1, 0, 1, 0, 0, 0, { starCrashBonus: s.starCrashBonus }), 'spell power stacks on top').toContain('{{+8/+10}}');
    expect(spellDisplayText('starcrash', 0, 0, 0), 'no rune: the printed base').toContain('+5/+7**');
    expect(runeTally(s, 'rune_falling_embers')).toBe('+2/+2');
  });
});

// Owner rework 2026-09-18: "after you sell 3 Revelers" — every third Reveler sold THIS TURN (the Festival Circuit's
// per-turn scope) arms the free card; the meter resets at the flip.
describe('Rune of Festival Wages', () => {
  it('every 3rd Reveler sold this turn makes the next card free — minion or spell; the meter resets next turn', () => {
    let s = armed('rune_festival_wages', {
      board: [body('f', 'sp3_flamereveler'), body('t', 'sp3_tidereveler'), body('g', 'sp3_grovereveler'), body('f2', 'sp3_flamereveler'), body('t2', 'sp3_tidereveler'), body('g2', 'sp3_grovereveler')],
      shop: [{ uid: 'o1', cardId: 'venom' }, { uid: 'o2', cardId: 'venom' }],
    });
    expect(offerBuyPrice(s, s.shop[0]!).cost).toBe(3);
    s = sell(s, 'f'); s = sell(s, 't');
    expect(s.nextCardFree ?? 0, 'two sales: not yet').toBe(0);
    expect(runeTally(s, 'rune_festival_wages')).toBe('2/3');
    s = sell(s, 'g');
    expect(s.nextCardFree).toBe(1);
    expect(runeTally(s, 'rune_festival_wages')).toBe('next card free');
    expect(offerBuyPrice(s, s.shop[0]!).cost).toBe(0);
    const gold = s.embers;
    s = act(s, { type: 'buy', uid: 'o1' } as Action);
    expect(s.embers, 'the buy cost nothing').toBe(gold);
    expect(s.nextCardFree, 'spent').toBe(0);
    expect(offerBuyPrice(s, s.shop[0]!).cost).toBe(3);
    expect(runeTally(s, 'rune_festival_wages'), 'the meter wrapped').toBe('0/3');
    s = sell(s, 'f2'); s = sell(s, 't2'); s = sell(s, 'g2');
    expect(s.nextCardFree, 'the 6th sale pays again').toBe(1);
    expect(s.runeProcs?.['rune_festival_wages'], 'armed twice + spent once').toBe(3);
    s = nextTurn(s);
    expect(s.revelersSoldThisTurn, 'the meter resets at the flip').toBe(0);
    expect(s.nextCardFree, 'an armed free card carries').toBe(1);
    s = { ...s, board: [body('g', 'sp3_grovereveler')], spell: { uid: 'sp', cardId: 'growth' } };
    const g2 = s.embers;
    s = act(s, { type: 'buy', uid: 'sp' } as Action);
    expect(s.embers, 'a spell counts as "your next card"').toBe(g2);
    expect(handIds(s)).toContain('growth');
  });
});

describe('Rune of the Meteor Shower', () => {
  it('the first Star Crash cast each turn hands over another; the second does not', () => {
    let s = armed('rune_meteor_shower', { board: [body('c', 'ce3_wishingstar')], hand: [body('s1', 'starcrash'), body('s2', 'starcrash')] });
    s = play(s, 's1', 'c');
    expect(handIds(s).filter((id) => id === 'starcrash')).toHaveLength(2);
    const extra = s.hand.find((c) => c.cardId === 'starcrash' && c.uid !== 's2')!;
    s = play(s, 's2', 'c');
    expect(handIds(s).filter((id) => id === 'starcrash')).toHaveLength(1);
    s = play(s, extra.uid, 'c');
    expect(handIds(s).filter((id) => id === 'starcrash')).toHaveLength(0);
    expect(s.runeProcs?.['rune_meteor_shower']).toBe(1);
  });
});

// Owner rework 2026-09-18: EVERY spell counts; the 3rd cast each turn hands over 2 copies of the SECOND one.
describe('Rune of the Astral Refrain', () => {
  it('after the 3rd spell each turn: 2 copies of the SECOND land in hand; once per turn', () => {
    let s = armed('rune_astral_refrain', { board: [body('c', 'ce3_wishingstar')], hand: [body('g1', 'growth'), body('s1', 'starcrash'), body('s2', 'starcrash'), body('g4', 'growth')] });
    s = play(s, 'g1');
    s = play(s, 's1', 'c');
    expect(handIds(s)).toEqual(['starcrash', 'growth']);
    s = play(s, 's2', 'c');
    expect(handIds(s).sort(), 'two Star Crashes — the second spell — arrived').toEqual(['growth', 'starcrash', 'starcrash']);
    expect(runeTally(s, 'rune_astral_refrain')).toBe('3/3');
    expect(s.runeProcs?.['rune_astral_refrain']).toBe(1);
    s = play(s, 'g4');
    expect(s.runeProcs?.['rune_astral_refrain'], 'the 4th pays nothing').toBe(1);
  });
  it('a Ruby in second place is copied as 2 Rubies at the run\'s current line', () => {
    let s = armed('rune_astral_refrain', { board: [body('c', 'ce3_wishingstar')], hand: [body('g1', 'growth'), body('r', 'ruby'), body('g3', 'growth')] });
    s = play(s, 'g1'); s = play(s, 'r', 'c'); s = play(s, 'g3');
    expect(handIds(s)).toEqual(['ruby', 'ruby']);
    expect(s.runeProcs?.['rune_astral_refrain']).toBe(1);
  });
});

describe('Rune of the Astral Draft', () => {
  it('a Shop-spell Discover now and at every turn setup; the pick casts an additional time (the badge sees it)', () => {
    let s = armed('rune_astral_draft');
    expect(s.discover, 'paid immediately — the forge opens after this turn\'s setup').toBeDefined();
    expect(s.discoverExtraCasts).toBe(1);
    s = act(s, { type: 'discover', index: 0 } as Action);
    expect(s.hand).toHaveLength(1);
    const pick = s.hand[0]!;
    expect(pick.extraCasts).toBe(1);
    expect(s.discoverExtraCasts, 'consumed with the offer').toBeUndefined();
    const def = CARD_INDEX[pick.cardId]!;
    if (!def.singleCast) {
      expect(spellCasts(s, def, pick)).toBe(spellCasts(s, def) + 1);
    }
    s = nextTurn(s);
    expect(s.discover, 'again at the next turn setup').toBeDefined();
    expect(s.discoverExtraCasts).toBe(1);
  });
});

// ── the hand-gain runes ──────────────────────────────────────────────────────────────────────────────────
/** Tidebud's Shout: a random Spirit on the board (none here — it excludes itself) and a random Spirit in hand
 *  +2 Health. With ONE Spirit in hand the hand recipient is deterministic. */
const tidebudSetup = (over: Partial<RunState> = {}): Partial<RunState> => ({
  board: [body('v', 'venom')],
  hand: [body('tb', 'sp3_tidebud'), body('k', 'sp3_kindled'), body('n', 'venom')],
  ...over,
});
// Owner rework 2026-09-18: EVERY hand gain is mirrored (the per-turn latch is gone).
describe('Rune of the Dream Mirror', () => {
  it('every hand-minion gain is mirrored — the same stats — onto a random board minion', () => {
    let s = armed('rune_dream_mirror', tidebudSetup());
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = play(s, 'tb');
    expect(stats(inHand(s, 'k')), 'Tidebud paid the hand Spirit').toEqual([1, 3 + 2]);
    const after = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    expect(after - before, 'exactly +0/+2 landed on ONE board minion (Tidebud\'s own base stats aside)').toBe(CARD_INDEX['sp3_tidebud']!.attack + CARD_INDEX['sp3_tidebud']!.health + 2);
    expect(s.runeProcs?.['rune_dream_mirror']).toBe(1);
    // a second hand gain this turn: mirrored again
    s = { ...s, hand: [...s.hand, body('tb2', 'sp3_tidebud')] };
    const mid = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    s = play(s, 'tb2');
    // Tidebud #2 also pays a random board Spirit (+2 Health) now that Spirits sit on the board — plus the mirror's +2
    const boardSpiritGain = 2;
    const end = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    expect(end - mid).toBe(CARD_INDEX['sp3_tidebud']!.attack + CARD_INDEX['sp3_tidebud']!.health + boardSpiritGain + 2);
    expect(s.runeProcs?.['rune_dream_mirror']).toBe(2);
  });
});

describe('Rune of Waking Dreams', () => {
  it('every hand-minion gain gives your board minions +4/+3', () => {
    let s = armed('rune_waking_dreams', tidebudSetup());
    s = play(s, 'tb');
    expect(stats(at(s, 'v'))).toEqual([1 + 4, 1 + 3]);
    expect(stats(at(s, 'tb')), 'the played Tidebud is on the board by then').toEqual([2 + 4, 3 + 3]); // Tidebud 2/3 since 2026-09-18
    expect(stats(inHand(s, 'n')), 'a hand minion that did not gain is not a gainer').toEqual([1, 1]);
    expect(s.runeProcs?.['rune_waking_dreams']).toBe(1);
  });
});

describe('Handy Flame + Rune of the Handy Flame', () => {
  it('the rune hands over the token; the token is never drawable', () => {
    const s = armed('rune_handy_flame');
    expect(handIds(s)).toEqual(['sp3_handyflame']);
    expect(CARD_INDEX['sp3_handyflame']).toMatchObject({ tribe: 'spirit', tier: 5, attack: 2, health: 13, token: true });
    expect(poolFor('set3').buyable.some((c) => c.id === 'sp3_handyflame')).toBe(false);
  });
  it('whenever the Flame gains stats (in hand), a random OTHER minion in your hand gets +6/+4 — and a chain with Waking Dreams is bounded', () => {
    let s = armed('rune_waking_dreams', { board: [body('v', 'venom')], hand: [body('tb', 'sp3_tidebud'), body('hf', 'sp3_handyflame'), body('n', 'venom')] });
    s = play(s, 'tb');
    expect(stats(inHand(s, 'hf')), 'Tidebud paid the Flame (the only Spirit in hand)').toEqual([2, 13 + 2]);
    expect(stats(inHand(s, 'n')), 'the Flame paid the other hand minion').toEqual([1 + 6, 1 + 4]);
    // Waking Dreams saw TWO hand gainers (the Flame and the venom it fed) → the board took +4/+3 twice
    expect(stats(at(s, 'v'))).toEqual([1 + 8, 1 + 6]);
  });
  it('on the board, a gain fires it too (a Growth cast) and it never feeds itself', () => {
    let s = run({ board: [body('hf', 'sp3_handyflame')], hand: [body('g', 'growth'), body('n', 'venom')] });
    s = play(s, 'g');
    expect(stats(at(s, 'hf'))).toEqual([3, 14]);
    expect(stats(inHand(s, 'n'))).toEqual([7, 5]);
  });
});

// ── the Reveler-sold / Reveler-played runes ──────────────────────────────────────────────────────────────
describe('Rune of Shared Revelry', () => {
  it('the first Flame, Tide and Grove sold each turn trigger twice (value 1 then 2); a second Flame fires once', () => {
    let s = armed('rune_shared_revelry', { board: [body('k', 'sp3_kindled'), body('f', 'sp3_flamereveler'), body('f2', 'sp3_flamereveler'), body('t', 'sp3_tidereveler')] });
    s = sell(s, 'f');
    expect(stats(at(s, 'k')), '+1 then +2 Attack').toEqual([1 + 3, 3]);
    expect(revelerValue(s)).toBe(3);
    s = sell(s, 'f2');
    expect(stats(at(s, 'k')), 'the second Flame pays once (+3)').toEqual([4 + 3, 3]);
    s = sell(s, 't');
    expect(stats(at(s, 'k')), 'the first Tide doubles: +4 then +5 Health').toEqual([7, 3 + 9]);
    expect(s.runeProcs?.['rune_shared_revelry']).toBe(2);
  });
});

describe('Rune of the Grand Procession (Epic)', () => {
  it('the first 2 Revelers PLAYED each turn return a plain copy to hand; the third does not; re-arms next turn', () => {
    let s = armed('rune_grand_procession', { hand: [body('f', 'sp3_flamereveler'), body('t', 'sp3_tidereveler'), body('g', 'sp3_grovereveler')] });
    s = play(s, 'f');
    expect(handIds(s).filter((id) => id === 'sp3_flamereveler')).toHaveLength(1);
    expect(runeTally(s, 'rune_grand_procession')).toBe('1/2');
    s = play(s, 't');
    expect(handIds(s).filter((id) => id === 'sp3_tidereveler')).toHaveLength(1);
    s = play(s, 'g');
    expect(handIds(s).filter((id) => id === 'sp3_grovereveler')).toHaveLength(0);
    expect(runeTally(s, 'rune_grand_procession')).toBe('2/2');
    s = nextTurn(s);
    expect(runeTally(s, 'rune_grand_procession')).toBe('0/2');
  });
});

// Owner rework 2026-09-18: every 3 Revelers sold this turn pay ONE random Celestial; the Revelers also buff Celestials.
describe('Rune of the Festival Circuit', () => {
  it('every 3rd Reveler SOLD this turn hands over a random Celestial (the 4th does not; the 6th does)', () => {
    let s = armed('rune_festival_circuit', { board: [body('f', 'sp3_flamereveler'), body('t', 'sp3_tidereveler'), body('g', 'sp3_grovereveler'), body('f2', 'sp3_flamereveler'), body('t2', 'sp3_tidereveler'), body('g2', 'sp3_grovereveler')] });
    s = sell(s, 'f'); s = sell(s, 't');
    expect(s.hand).toHaveLength(0);
    expect(runeTally(s, 'rune_festival_circuit')).toBe('2/3');
    s = sell(s, 'g');
    expect(s.hand).toHaveLength(1);
    for (const c of s.hand) expect(isTribeId(c.cardId, 'celestial'), c.cardId).toBe(true);
    expect(runeTally(s, 'rune_festival_circuit'), 'the meter wraps once it pays').toBe('0/3');
    s = sell(s, 'f2');
    expect(s.hand).toHaveLength(1);
    s = sell(s, 't2'); s = sell(s, 'g2');
    expect(s.hand, 'the 6th sale pays again').toHaveLength(2);
    expect(s.runeProcs?.['rune_festival_circuit']).toBe(2);
    expect(nextTurn(s).revelersSoldThisTurn).toBe(0);
  });
  it('while held, a Reveler\'s sell buff reaches your Celestials as well as your Spirits', () => {
    const cel = [...Object.values(CARD_INDEX)].find((c) => c.tribe === 'celestial' && !c.spell && !c.token && !c.effects.length)?.id
      ?? [...Object.values(CARD_INDEX)].find((c) => c.tribe === 'celestial' && !c.spell && !c.token)!.id;
    const setup = { board: [body('f', 'sp3_flamereveler'), body('c', cel), body('k', 'sp3_kindled'), body('v', 'venom')] };
    // Without the rune: only the Spirit.
    let plain = run(setup);
    plain = sell(plain, 'f');
    expect(at(plain, 'c').attack).toBe(CARD_INDEX[cel]!.attack);
    expect(at(plain, 'k').attack).toBe(CARD_INDEX['sp3_kindled']!.attack + 1);
    // With the rune: the Spirit AND the Celestial, never the Neutral.
    let s = armed('rune_festival_circuit', setup);
    s = sell(s, 'f');
    expect(at(s, 'c').attack, 'the Celestial got the Reveler\'s +1 Attack').toBe(CARD_INDEX[cel]!.attack + 1);
    expect(at(s, 'k').attack).toBe(CARD_INDEX['sp3_kindled']!.attack + 1);
    expect(at(s, 'v').attack, 'a Neutral is still not an audience').toBe(CARD_INDEX['venom']!.attack);
  });
});

describe('Rune of the Spirit Crown', () => {
  it('every 3 Spirits played improves the run\'s Shop spells by +1/+1 (the spell-power channel every stat spell prints)', () => {
    let s = armed('rune_spirit_crown', { hand: [body('a', 'sp3_kindled'), body('b', 'sp3_flamereveler'), body('c', 'sp3_tidereveler')] });
    s = play(s, 'a'); s = play(s, 'b');
    expect(s.spellBonus ?? { attack: 0, health: 0 }).toEqual({ attack: 0, health: 0 });
    expect(runeTally(s, 'rune_spirit_crown')).toBe('2/3');
    s = play(s, 'c');
    expect(s.spellBonus).toEqual({ attack: 1, health: 1 });
    expect(s.runeProcs?.['rune_spirit_crown']).toBe(1);
  });
});
