import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type RunState } from './state';
import { reduce } from './reducer';
import { mintRubies } from './recruit';

/**
 * Owner batch 2026-07-31 (evening): three new runes (Contraband / Cadence / Gemscript), five set-agnostic
 * spells, and the gold "(Spell Name)" temporary-grant display on next-combat spells.
 */
const spell = (uid: string, cardId: string): RunState['hand'][number] =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const minion = (uid: string, cardId: string, attack = 2, health = 2): RunState['board'][number] =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
/** A SET-2 recruit state (Rubies + Ales live there) — `setId` pinned explicitly so the pool draws Ales
 * regardless of which set is live-flipped at test time. */
const set2 = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(11), setId: 'set2', phase: 'recruit', embers: 20, board: [], hand: [], ...over });

describe('Rune of Contraband', () => {
  it('first Ruby each turn pays an Ale; first Ale pays a Ruby; both latch once', () => {
    let s = set2({ runeContraband: true, board: [minion('m', 'stray')] });
    mintRubies(s, 2);
    const [r1, r2] = s.hand.filter((c) => c.cardId === 'ruby');
    s = reduce(s, { type: 'play', uid: r1!.uid, targetUid: 'm' });
    const ales = (st: RunState): number => st.hand.filter((c) => ['wo_mine', 'wo_reinforcement', 'wo_champion', 'wo_health', 'wo_attack'].includes(c.cardId)).length;
    expect(ales(s), 'the first Ruby should smuggle back an Ale').toBe(1);
    s = reduce(s, { type: 'play', uid: r2!.uid, targetUid: 'm' });
    expect(ales(s), 'the SECOND Ruby must not pay again').toBe(1);
    // Cast the Ale → a Ruby comes back (once).
    const ale = s.hand.find((c) => ['wo_mine', 'wo_reinforcement', 'wo_champion', 'wo_health', 'wo_attack'].includes(c.cardId))!;
    const rubiesBefore = s.hand.filter((c) => c.cardId === 'ruby').length;
    s = reduce(s, { type: 'play', uid: ale.uid, targetUid: CARD_INDEX[ale.cardId]?.target ? 'm' : undefined as never });
    expect(s.hand.filter((c) => c.cardId === 'ruby').length, 'the first Ale should smuggle back a Ruby').toBe(rubiesBefore + 1);
  });
});

describe('Rune of Cadence', () => {
  it('buying a minion arms a 1-Gold spell discount; casting a spell arms a 1-Gold minion discount', () => {
    let s = set2({ runeCadence: true, shop: [{ uid: 'o1', cardId: 'stray' }, { uid: 'o2', cardId: 'stray' }] });
    const goldBefore = s.embers;
    s = reduce(s, { type: 'buy', uid: 'o1' });
    expect(goldBefore - s.embers, 'the first minion pays full price').toBe(3);
    expect(s.cadenceSpellOff, 'buying armed the spell discount').toBe(true);
    // Cast a spell from hand: arms the minion discount…
    s = { ...s, hand: [...s.hand, spell('sp', 'growth')], board: [minion('m', 'stray')] };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.cadenceMinionOff, 'casting armed the minion discount').toBe(true);
    // …and the next minion is 1 cheaper.
    const g2 = s.embers;
    s = reduce(s, { type: 'buy', uid: 'o2' });
    expect(g2 - s.embers, 'the armed discount should knock 1 off').toBe(2);
    expect(s.cadenceMinionOff, 'the discount is one-shot').toBeUndefined();
  });
});

describe('Rune of Gemscript', () => {
  it('first spell/turn raises Ruby power (+held Rubies); first Ruby/turn raises spell power', () => {
    let s = set2({ runeGemscript: true, board: [minion('m', 'stray')] });
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => c.cardId === 'ruby')!;
    expect([ruby.attack, ruby.health]).toEqual([1, 1]);
    s = { ...s, hand: [...s.hand, spell('sp', 'growth')] };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.rubyBonus).toEqual({ attack: 1, health: 1 });
    expect([s.hand.find((c) => c.cardId === 'ruby')!.attack, s.hand.find((c) => c.cardId === 'ruby')!.health],
      'the held Ruby should grow with the bonus').toEqual([2, 2]);
    // First Ruby cast → spell power +1/+1.
    s = reduce(s, { type: 'play', uid: ruby.uid, targetUid: 'm' });
    expect(s.spellBonus).toEqual({ attack: 1, health: 1 });
  });
});

describe('the five new spells', () => {
  it('Decoy Sigil banks a next-combat dummy; Weaken banks a next-combat weaken', () => {
    let s = set2({ hand: [spell('d', 'decoysigil'), spell('w', 'weaken')] });
    s = reduce(s, { type: 'play', uid: 'd' });
    s = reduce(s, { type: 'play', uid: 'w' });
    expect(s.pendingDecoys).toBe(1);
    expect(s.pendingWeaken).toBe(1);
  });

  it('On the House pours 3 Ales (set 2)', () => {
    let s = set2({ hand: [spell('o', 'onthehouse')] });
    s = reduce(s, { type: 'play', uid: 'o' });
    expect(s.hand.filter((c) => ['wo_mine', 'wo_reinforcement', 'wo_champion', 'wo_health', 'wo_attack'].includes(c.cardId))).toHaveLength(3);
  });

  it('Ruby Excavation plays 2 Rubies on every friendly minion', () => {
    let s = set2({ board: [minion('a', 'stray'), minion('b', 'stray')], hand: [spell('x', 'rubyexcavation')] });
    s = reduce(s, { type: 'play', uid: 'x' });
    for (const uid of ['a', 'b']) {
      const m = s.board.find((c) => c.uid === uid)!;
      expect([m.attack, m.health], `${uid} should carry 2 Rubies (2/2 at base strength)`).toEqual([4, 4]);
    }
  });

  it('Quick Study (the spell) raises spell power +1/+1', () => {
    let s = set2({ hand: [spell('q', 'quickstudy')] });
    s = reduce(s, { type: 'play', uid: 'q' });
    expect(s.spellBonus).toEqual({ attack: 1, health: 1 });
  });
});

describe('the steal spells (set 2)', () => {
  it('Deep Delve Writ steals a random DWARF minion from the shop, buffs included', () => {
    let s = set2({
      shop: [{ uid: 'o1', cardId: 'dw_brunni', atk: 2, hp: 1 }, { uid: 'o2', cardId: 'stray' }],
      hand: [spell('w', 'deepdelvewrit')],
    });
    s = reduce(s, { type: 'play', uid: 'w' });
    const stolen = s.hand.find((c) => c.cardId === 'dw_brunni');
    expect(stolen, 'the Dwarf should be in hand').toBeTruthy();
    expect(s.shop.some((o) => o.cardId === 'dw_brunni')).toBe(false);
    expect(s.shop.some((o) => o.cardId === 'stray'), 'the non-Dwarf stays').toBe(true);
    // The offer buff rode in (steal = a free buy, not a fresh copy).
    expect(stolen!.attack).toBeGreaterThanOrEqual(CARD_INDEX['dw_brunni']!.attack + 2);
  });

  it('Ironclad Requisition steals one random card per friendly Dwarf', () => {
    let s = set2({
      board: [minion('d1', 'dw_brunni'), minion('d2', 'dw_brunni')],
      shop: [{ uid: 'o1', cardId: 'stray' }, { uid: 'o2', cardId: 'alley' }, { uid: 'o3', cardId: 'sandbag' }],
      hand: [spell('q', 'ironcladreq')],
    });
    s = reduce(s, { type: 'play', uid: 'q' });
    expect(s.shop).toHaveLength(1); // 2 Dwarves → 2 steals
    expect(s.hand.filter((c) => ['stray', 'alley', 'sandbag'].includes(c.cardId))).toHaveLength(2);
  });
});

describe('temporary next-combat grants display (Last Stand & friends)', () => {
  it('casting Last Stand tags the minion (gold label + 0/0 buff entry), and faceOmen clears it', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', embers: 20,
      board: [minion('m', 'stray')], hand: [spell('ls', 'laststand')] };
    s = reduce(s, { type: 'play', uid: 'ls', targetUid: 'm' });
    const m = s.board[0]!;
    expect(m.tempGrants).toEqual([{ label: 'Last Stand', keyword: 'R' }]);
    expect(m.buffs?.some((b) => b.source === '(Last Stand)' && b.attack === 0 && b.health === 0)).toBe(true);
    expect(s.pendingCombatKeywords?.some((k) => k.uid === 'm' && k.keyword === 'R')).toBe(true);
    // Entering combat spends the promise — the display tag and its buff entry go with it.
    const fought = reduce(s, { type: 'faceOmen' });
    const after = fought.board.find((c) => c.uid === 'm')!;
    expect(after.tempGrants).toBeUndefined();
    expect(after.buffs?.some((b) => b.source === '(Last Stand)')).toBeFalsy();
  });
});
