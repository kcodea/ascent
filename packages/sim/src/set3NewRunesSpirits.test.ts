/**
 * SET 3 NEW-CONCEPT RUNES, SPIRITS (owner review board 2026-11-23): the SHOP halves through the real reducer.
 * Last Dance, Welcome Party and Bonfire are Shop-only (selling and buying); Deep Slumber's Shop / End of Turn half
 * rides the reducer's per-action hand diff. Kindred Rally and Deep Slumber's combat half are
 * `packages/core/src/combat/set3NewRunesSpirits.test.ts`.
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

describe('Rune of the Deep Slumber — Shop half', () => {
  it('a hand gain from a Spirit played (Chosen Vessel +2/+2) lands doubled', () => {
    const go = (runes: string[]) => reduce(run([], ['rune_chosen_vessel', ...runes], [card(NEU.id, 'h'), card(SPIRIT.id, 'p')]), { type: 'play', uid: 'p', toIndex: 0 });
    expect(stats(go([]), 'h')).toEqual([4, 4]);
    const on = go(['rune_deep_slumber']);
    expect(stats(on, 'h')).toEqual([6, 6]);
    expect(on.runeProcs?.['rune_deep_slumber']).toBe(1);
  });
  it('a board gain is never doubled', () => {
    const go = (runes: string[]) => reduce(run([card(SPIRIT_B.id, 'b')], ['rune_deep_currents', ...runes], [card(SPIRIT.id, 'p')]), { type: 'play', uid: 'p', toIndex: 0 });
    expect(stats(go(['rune_deep_slumber']), 'b')).toEqual(stats(go([]), 'b'));
  });
  it('the Handy Flame chain is bounded: one doubling pass after the reactors, never re-diffed', () => {
    // Two Handy Flames in hand. Chosen Vessel grows the left-most (+2/+2); its reactor pays the other +6/+4; the
    // second Flame's own gain does not re-fire this action. Deep Slumber then pays every hand gain once more.
    const go = (runes: string[]) => reduce(run([], ['rune_chosen_vessel', ...runes], [card('sp3_handyflame', 'f1'), card('sp3_handyflame', 'f2'), card(SPIRIT.id, 'p')]), { type: 'play', uid: 'p', toIndex: 0 });
    const off = go([]);
    expect([stats(off, 'f1'), stats(off, 'f2')]).toEqual([[4, 15], [8, 17]]);
    const on = go(['rune_deep_slumber']);
    expect([stats(on, 'f1'), stats(on, 'f2')]).toEqual([[6, 17], [14, 21]]);
  });
  it('Dream Mirror reads the doubled gain', () => {
    const go = (runes: string[]) => reduce(run([card(NEU.id, 'b')], ['rune_chosen_vessel', 'rune_dream_mirror', ...runes], [card(NEU.id, 'h'), card(SPIRIT.id, 'p')]), { type: 'play', uid: 'p', toIndex: 0 });
    // The board holds the neutral and the played Spirit; the mirror lands on one of them (seeded). Sum the board.
    const total = (s: RunState) => s.board.reduce((n, c) => n + c.attack + c.health, 0);
    expect(total(go(['rune_deep_slumber'])) - total(go([]))).toBe(4); // +4/+4 mirrored instead of +2/+2
  });
});
