/**
 * SET 3 NEW-CONCEPT RUNES, SPIRITS (owner review board 2026-11-23): the SHOP halves through the real reducer.
 * Last Dance, Welcome Party and Bonfire are Shop-only (selling and buying). Deep Slumber has its own file
 * (`deepSlumber.test.ts`); Kindred Rally is `packages/core/src/combat/set3NewRunesSpirits.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, offerBuyPrice, reduce, type BoardCard, type RunState } from './index';

const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'spirit', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const SPIRIT = probe('dbg_nrs_spirit', { attack: 2, health: 2 });
const SPIRIT_B = probe('dbg_nrs_spiritb', { attack: 2, health: 2 });
const NEU = probe('dbg_nrs_neu', { tribe: 'neutral', attack: 2, health: 2 });
for (const c of [SPIRIT, SPIRIT_B, NEU]) CARD_INDEX[c.id] = c;

const card = (id: string, uid: string): BoardCard => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as BoardCard;
};
const run = (board: BoardCard[], runes: string[], hand: BoardCard[] = []): RunState => {
  let s: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', embers: 30, hand: [], board } as RunState;
  for (const id of runes) s = reduce(s, { type: 'devGrant', kind: 'rune', id });
  return { ...s, discover: undefined, discoverQueue: undefined, hand };
};
const at = (s: RunState, uid: string) => [...s.board, ...s.hand].find((c) => c.uid === uid)!;
const stats = (s: RunState, uid: string): [number, number] => [at(s, uid).attack, at(s, uid).health];

describe('the Spirit new-concept roster (owner review board 2026-11-23)', () => {
  it('two Basics + three Epics, Set 3 only, Spirit-gated, at the sibling costs, house-style text', () => {
    const want: [string, string, number, boolean, string][] = [
      ['rune_last_dance', 'Last Dance', 2, false, 'After you **Sell** a **Reveler**, give your left-most Spirit **+3/+3** permanently.'],
      ['rune_welcome_party', 'Welcome Party', 2, false, 'Your first Spirit each turn costs **1** less.'],
      ['rune_bonfire', 'Bonfire', 4, true, 'Your **Reveler** bonuses also apply to the minions in your hand.'],
      ['rune_kindred_rally', 'Kindred Rally', 4, true, 'When you summon a minion from your hand in combat, trigger your left-most **Rally**.'],
      ['rune_deep_slumber', 'Deep Slumber', 4, true, 'Minions in your hand gain **double** stats from every source.'],
    ];
    for (const [id, name, cost, epic, text] of want) {
      const r = RUNE_INDEX[id]!;
      expect([r.name, r.cost, !!r.epic, r.sets, r.tribes, r.text], id).toEqual([name, cost, epic, ['set3'], ['spirit'], text]);
      expect(r.text, `${id}: no em dash`).not.toMatch(/—|--/);
    }
  });
});

describe('Rune of the Last Dance', () => {
  it('every Reveler sold gives the left-most board Spirit +3/+3 on top of the Reveler payout', () => {
    const board = () => [card(NEU.id, 'n'), card('sp3_flamereveler', 'f1'), card(SPIRIT.id, 'a'), card(SPIRIT_B.id, 'b'), card('sp3_flamereveler', 'f2')];
    let off = run(board(), []);
    let on = run(board(), ['rune_last_dance']);
    off = reduce(off, { type: 'sell', uid: 'f1' });
    on = reduce(on, { type: 'sell', uid: 'f1' });
    const [oa, oh] = stats(off, 'a');
    expect(stats(on, 'a'), 'the left-most Spirit (the neutral on its left is skipped)').toEqual([oa + 3, oh + 3]);
    expect(stats(on, 'b'), 'only the left-most').toEqual(stats(off, 'b'));
    expect(stats(on, 'n')).toEqual(stats(off, 'n'));
    // A second sale the same turn pays again (no per-turn cap).
    off = reduce(off, { type: 'sell', uid: 'f2' });
    on = reduce(on, { type: 'sell', uid: 'f2' });
    expect(stats(on, 'a')).toEqual([at(off, 'a').attack + 6, at(off, 'a').health + 6]);
    expect(on.runeProcs?.['rune_last_dance']).toBe(2);
  });
  it('a non-Reveler sale pays nothing; no Spirit on the board pays nothing', () => {
    let s = run([card(NEU.id, 'n'), card(SPIRIT.id, 'a')], ['rune_last_dance']);
    s = reduce(s, { type: 'sell', uid: 'n' });
    expect(stats(s, 'a')).toEqual([2, 2]);
    let t = run([card(NEU.id, 'n'), card('sp3_tidereveler', 't')], ['rune_last_dance']);
    t = reduce(t, { type: 'sell', uid: 't' });
    expect(t.runeProcs?.['rune_last_dance'] ?? 0).toBe(0);
  });
  it('two copies pay +6/+6', () => {
    const b = () => [card('sp3_tidereveler', 't'), card(SPIRIT.id, 'a')];
    const off = reduce(run(b(), []), { type: 'sell', uid: 't' });
    const on = reduce(run(b(), ['rune_last_dance', 'rune_last_dance']), { type: 'sell', uid: 't' });
    expect(stats(on, 'a')).toEqual([at(off, 'a').attack + 6, at(off, 'a').health + 6]);
  });
});

describe('Rune of the Welcome Party', () => {
  const shop = (s: RunState): RunState => ({ ...s, shop: [{ uid: 'o1', cardId: SPIRIT.id }, { uid: 'o2', cardId: SPIRIT_B.id }, { uid: 'o3', cardId: NEU.id }] } as RunState);
  it('the first Spirit bought each turn costs 1 less; a non-Spirit never does; the second Spirit pays full', () => {
    const base = offerBuyPrice(shop(run([], [])), { cardId: SPIRIT.id }).cost;
    let s = shop(run([], ['rune_welcome_party']));
    expect(offerBuyPrice(s, { cardId: SPIRIT.id }).cost).toBe(base - 1);
    expect(offerBuyPrice(s, { cardId: NEU.id }).cost, 'a non-Spirit').toBe(base);
    const g0 = s.embers;
    s = reduce(s, { type: 'buy', uid: 'o3' }); // the neutral first: the charge is untouched
    expect(s.embers).toBe(g0 - base);
    expect(offerBuyPrice(s, { cardId: SPIRIT.id }).cost).toBe(base - 1);
    const g1 = s.embers;
    s = reduce(s, { type: 'buy', uid: 'o1' });
    expect(s.embers, 'the first Spirit paid the discounted price').toBe(g1 - (base - 1));
    expect(s.welcomePartyUsedThisTurn).toBe(true);
    expect(offerBuyPrice(s, { cardId: SPIRIT_B.id }).cost, 'the second Spirit pays full').toBe(base);
  });
  it('the charge comes back at the turn flip', () => {
    let s = shop(run([], ['rune_welcome_party']));
    s = reduce(s, { type: 'buy', uid: 'o1' });
    expect(s.welcomePartyUsedThisTurn).toBe(true);
    s = { ...s, phase: 'combat', lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } } } as unknown as RunState;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.welcomePartyUsedThisTurn).toBeFalsy();
    expect(offerBuyPrice(shop(s), { cardId: SPIRIT.id }).cost).toBe(offerBuyPrice(shop({ ...s, questFlags: { ...s.questFlags, runeWelcomeParty: false } }), { cardId: SPIRIT.id }).cost - 1);
  });
  it('a Spirit that is free anyway (Festival Wages) does not spend it: the next Spirit takes the discount', () => {
    const base = offerBuyPrice(shop(run([], [])), { cardId: SPIRIT.id }).cost;
    let s = shop({ ...run([], ['rune_welcome_party']), nextCardFree: 1 } as RunState);
    const g0 = s.embers;
    s = reduce(s, { type: 'buy', uid: 'o1' });
    expect(s.hand.some((c) => c.cardId === SPIRIT.id)).toBe(true);
    expect(s.embers, 'the Spirit was free').toBe(g0);
    expect(s.welcomePartyUsedThisTurn).toBeFalsy();
    s = reduce(s, { type: 'buy', uid: 'o2' });
    expect(s.embers, 'the next Spirit is discounted').toBe(g0 - (base - 1));
    expect(s.welcomePartyUsedThisTurn).toBe(true);
  });
  it('two copies take 2 off', () => {
    const base = offerBuyPrice(shop(run([], [])), { cardId: SPIRIT.id }).cost;
    const s = shop(run([], ['rune_welcome_party', 'rune_welcome_party']));
    expect(offerBuyPrice(s, { cardId: SPIRIT.id }).cost).toBe(Math.max(0, base - 2));
  });
});

describe('Rune of the Bonfire', () => {
  it('a Flame Reveler pays the Spirits in hand too; a neutral or a spell in hand is not paid', () => {
    const hand = () => [card(SPIRIT.id, 'hs'), card(NEU.id, 'hn'), card('crescendo', 'sp')];
    let off = run([card('sp3_flamereveler', 'f'), card(SPIRIT_B.id, 'b')], [], hand());
    let on = run([card('sp3_flamereveler', 'f'), card(SPIRIT_B.id, 'b')], ['rune_bonfire'], hand());
    const x = on.revelerX ?? 1;
    off = reduce(off, { type: 'sell', uid: 'f' });
    on = reduce(on, { type: 'sell', uid: 'f' });
    expect(stats(off, 'hs'), 'without the rune the hand is never paid').toEqual([2, 2]);
    expect(stats(on, 'hs')).toEqual([2 + x, 2]);
    expect(stats(on, 'hn'), 'Flame pays Spirits only').toEqual([2, 2]);
    expect(stats(on, 'b'), 'the board payout is unchanged').toEqual(stats(off, 'b'));
    expect(on.runeProcs?.['rune_bonfire']).toBe(1);
  });
  it('a Grove Reveler pays every minion in hand, both stats', () => {
    let s = run([card('sp3_grovereveler', 'g')], ['rune_bonfire'], [card(SPIRIT.id, 'hs'), card(NEU.id, 'hn')]);
    const x = s.revelerX ?? 1;
    s = reduce(s, { type: 'sell', uid: 'g' });
    expect(stats(s, 'hs')).toEqual([2 + x, 2 + x]);
    expect(stats(s, 'hn')).toEqual([2 + x, 2 + x]);
  });
});

describe('Bonfire with Shared Revelry', () => {
  it('the re-fire pays the hand too, at the grown value; the second sale of that type pays once', () => {
    let s = run([card('sp3_flamereveler', 'f1'), card('sp3_flamereveler', 'f2')], ['rune_bonfire', 'rune_shared_revelry'], [card(SPIRIT.id, 'hs')]);
    const x = s.revelerX ?? 1;
    s = reduce(s, { type: 'sell', uid: 'f1' });
    expect(stats(s, 'hs'), 'X, then X + 1').toEqual([2 + x + (x + 1), 2]);
    s = reduce(s, { type: 'sell', uid: 'f2' });
    expect(stats(s, 'hs'), 'then X + 2, once').toEqual([2 + x + (x + 1) + (x + 2), 2]);
  });
  it('Last Dance pays once per SALE, not per re-fire', () => {
    const s = reduce(run([card('sp3_tidereveler', 't'), card(SPIRIT.id, 'a')], ['rune_last_dance', 'rune_shared_revelry']), { type: 'sell', uid: 't' });
    expect(s.runeProcs?.['rune_last_dance']).toBe(1);
  });
});
