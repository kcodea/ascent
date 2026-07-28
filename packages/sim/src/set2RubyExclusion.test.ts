import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, rubyCastCount, type BoardCard, type RunState } from './index';

/**
 * Owner ruling 2026-07-24: "Every Dragon effect intended to exclude Rubies must explicitly say Shop spell."
 * Living Grimoire and Runefire are the two exceptions — they work with ALL spells, Shop and Ruby alike.
 *
 * The behaviour side was already correct for the excluding cards: a Ruby never routes through `castSpell`, so it
 * touches no `spellCast` hook, never records `firstSpellThisTurnId` / `lastSpellCastId`, moves no Shop-spell
 * tally, and takes its stats from `rubyBonus` rather than spell power. These tests LOCK that in — "already
 * correct" is exactly the kind of property a later refactor breaks quietly, and the printed text is now a
 * promise to the player rather than an accident of plumbing.
 */

const minion = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'dragon', attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden: false });
const spellInHand = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const ruby = (uid: string): BoardCard =>
  ({ uid, cardId: 'ruby', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false });

describe('set 2 — Ruby exclusion matches the printed text', () => {
  /** Every card whose text promises Shop-spell-only behaviour. */
  const SHOP_ONLY = [
    // Scalefeather Drake dropped OFF this list in the 2026-07-25 rework — its Echo no longer touches spells
    // at all. Scalechanter joined it: its new text promises "Shop spell", so it owes the same exclusion.
    'd2_ashscribe', 'd2_mirrorwing', 'd2_spellkeeper', 'd2_scalechanter',
    'd2_recaller', 'd2_spellvault', 'd2_broodlord', 'd2_archivist',
  ];

  it('every excluding card SAYS "Shop spell", in its text and its golden text', () => {
    for (const id of SHOP_ONLY) {
      const c = CARD_INDEX[id]!;
      expect(c.text, `${id} text`).toMatch(/Shop spell/i);
      if (c.goldenText) expect(c.goldenText, `${id} goldenText`).toMatch(/Shop spell/i);
    }
    // Orivax's Spellweave OPTION carries the wording, not the card's own text.
    const weave = CARD_INDEX['d2_orivax']!.chooseOne!.find((o) => /3 times/.test(o.text));
    expect(weave?.text).toMatch(/Shop spell/i);
    // Rune of Scales is on the same ruling, and lives in the rune list rather than CARD_INDEX.
    const scales = [...RUNES, ...EPIC_RUNES].find((r) => r.id === 'rune_scales');
    expect(scales, 'rune_scales exists').toBeTruthy();
    expect(scales!.text).toMatch(/Shop spell/i);
  });

  it('the two INCLUDING cards deliberately do NOT say "Shop spell"', () => {
    // The inverse assertion, so a well-meaning consistency sweep can't quietly restrict them later.
    for (const id of ['d2_grimoire', 'd2_runefire']) {
      expect(CARD_INDEX[id]!.text, `${id} text`).not.toMatch(/Shop spell/i);
    }
  });

  it('a Ruby does not tick Ashscribe Whelp', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('aw', 'd2_ashscribe', 'dragon', 1, 3), minion('tgt', 'k_chipwick', 'kobold', 1, 2)],
      hand: [ruby('rb')],
    };
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'tgt' });
    const aw = s.board.find((c) => c.uid === 'aw')!;
    expect([aw.attack, aw.health]).toEqual([1, 3]); // untouched
  });

  it('a Ruby does not trip Mirrorwing — nor silently eat its once-per-turn slot', () => {
    // The subtle half. Even though Mirrorwing ignores Rubies, a Ruby landing on it must not consume the "first
    // spell each turn" slot — otherwise playing a Ruby would effectively DISABLE the card for that turn, which
    // is worse than either intended behaviour. This is why Rubies get their own per-instance counter.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('mw', 'd2_mirrorwing', 'dragon', 2, 6)],
      hand: [ruby('rb'), spellInHand('sf', 'spiritfire')],
    };
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'mw' }); // Ruby first
    const afterRuby = s.board.find((c) => c.uid === 'mw')!;
    const [a1, h1] = [afterRuby.attack, afterRuby.health];
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'mw' }); // then a Shop spell
    const after = s.board.find((c) => c.uid === 'mw')!;
    // Spirit Fire is +2/+3 and Mirrorwing re-casts it, so the Shop spell must land TWICE (+4/+6). A single
    // +2/+3 here would mean the Ruby had eaten the slot.
    expect([after.attack - a1, after.health - h1]).toEqual([4, 6]);
  });

  it('a Ruby arms neither Recaller nor Spellvault nor Archivist', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('tgt', 'k_chipwick', 'kobold', 1, 2)],
      hand: [ruby('rb')],
    };
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'tgt' });
    expect(s.lastSpellCastId).toBeUndefined();      // Recaller has nothing to copy
    expect(s.firstSpellThisTurnId).toBeUndefined(); // Spellvault + Archivist likewise
    expect(s.spellsThisTurn).toBe(0);               // and no Shop-spell tally moved
  });

  it('Rune of Scales does not fire on a Ruby', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80, runeScales: true,
      board: [minion('d', 'd2_ashscribe', 'dragon', 1, 3), minion('tgt', 'k_chipwick', 'kobold', 1, 2)],
      hand: [ruby('rb')],
    };
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'tgt' });
    const d = s.board.find((c) => c.uid === 'd')!;
    expect([d.attack, d.health]).toEqual([1, 3]); // no Dragon buff from a Ruby
  });
});

describe('set 2 — Runefire works with Rubies as well as Shop spells', () => {
  it('a RUBY played on Runefire also lands on its adjacent Dragons', () => {
    // The gap this closes: a Ruby never routes through `castSpell`, so it could never reach the
    // `spellCastOnThis` hook — Runefire did nothing at all for Rubies despite not saying "Shop spell".
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [
        minion('L', 'd2_ashscribe', 'dragon', 1, 3),
        minion('rf', 'd2_runefire', 'dragon', 5, 8),
        minion('R', 'd2_ashscribe', 'dragon', 1, 3),
      ],
      hand: [ruby('rb')],
    };
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'rf' });
    const rf = s.board.find((c) => c.uid === 'rf')!;
    const L = s.board.find((c) => c.uid === 'L')!;
    const R = s.board.find((c) => c.uid === 'R')!;
    expect([rf.attack, rf.health]).toEqual([6, 9]); // the Ruby's own +1/+1
    expect([L.attack, L.health]).toEqual([2, 4]);   // spread to the left neighbour
    expect([R.attack, R.health]).toEqual([2, 4]);   // …and the right
  });

  it('only the FIRST spell-or-Ruby each turn spreads — the two share one slot', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      // `bronzewarden` (Guardian Drake) has NO effects — an inert neighbour. Using a reactive Dragon here
      // (Ashscribe self-buffs on a Shop spell) would move its stats for reasons unrelated to the spread.
      board: [minion('rf', 'd2_runefire', 'dragon', 5, 8), minion('R', 'bronzewarden', 'dragon', 1, 3)],
      hand: [ruby('rb'), spellInHand('sf', 'spiritfire')],
    };
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'rf' }); // spreads (+1/+1 to R)
    const afterRuby = s.board.find((c) => c.uid === 'R')!;
    expect([afterRuby.attack, afterRuby.health]).toEqual([2, 4]);
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'rf' }); // must NOT spread again
    const R = s.board.find((c) => c.uid === 'R')!;
    expect([R.attack, R.health]).toEqual([2, 4]); // unchanged — the slot was already spent
  });

  it('a non-Dragon neighbour is skipped', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('rf', 'd2_runefire', 'dragon', 5, 8), minion('K', 'k_chipwick', 'kobold', 1, 2)],
      hand: [ruby('rb')],
    };
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'rf' });
    const K = s.board.find((c) => c.uid === 'K')!;
    expect([K.attack, K.health]).toEqual([1, 2]); // Kobold neighbour untouched
  });
});

/**
 * `rubyCastCount` is the number a Ruby actually resolves — extracted from the reducer so the UI's ×N badge can
 * preview it (owner 2026-07-24: Rubies had no multicast badge, because the count only existed inline at the cast
 * site). These pin that the shared helper agrees with what the reducer does.
 */
describe('set 2 — a Ruby cast count is previewable and matches what resolves', () => {
  it('is 1 with a bare board', () => {
    const s: RunState = { ...createRun(1), phase: 'recruit', board: [], hand: [] };
    expect(rubyCastCount(s)).toBe(1);
  });

  it('adds one per Prismcaster, doubled for a golden one', () => {
    const base: RunState = { ...createRun(1), phase: 'recruit', hand: [] };
    expect(rubyCastCount({ ...base, board: [minion('p', 'k_prismcaster', 'kobold', 3, 3)] })).toBe(2);
    expect(rubyCastCount({ ...base, board: [{ ...minion('p', 'k_prismcaster', 'kobold', 6, 6), golden: true }] })).toBe(3);
    expect(rubyCastCount({
      ...base,
      board: [minion('p1', 'k_prismcaster', 'kobold', 3, 3), minion('p2', 'k_prismcaster', 'kobold', 3, 3)],
    })).toBe(3); // 1 + 1 + 1
  });

  it('multiplies by a live Living Grimoire charge', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', hand: [],
      board: [minion('p', 'k_prismcaster', 'kobold', 3, 3), minion('lg', 'd2_grimoire', 'dragon', 7, 9)],
      grimoireMult: 2,
    };
    expect(rubyCastCount(s)).toBe(4); // (1 + 1) x 2
  });

  it('agrees with what the reducer actually resolves', () => {
    // The whole point of sharing the helper: the badge can't promise a number the cast doesn't deliver. A 1/1
    // Ruby buffs its target by its stats per cast, so the delta IS the count.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('p', 'k_prismcaster', 'kobold', 3, 3), minion('tgt', 'k_chipwick', 'kobold', 1, 2)],
      hand: [ruby('rb')],
    };
    const predicted = rubyCastCount(s);
    const t0 = s.board.find((c) => c.uid === 'tgt')!;
    const [a0, h0] = [t0.attack, t0.health];
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'tgt' });
    const t1 = s.board.find((c) => c.uid === 'tgt')!;
    expect(t1.attack - a0).toBe(predicted); // a 1/1 Ruby x `predicted` casts
    expect(t1.health - h0).toBe(predicted);
  });
});
