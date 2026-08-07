import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type CombatSideState } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * RUNE OF THE CHEF (owner 2026-08-07) — "Your Chef Gary Toasts gain Rally: buff a random Dwarf for the
 * combined stats this granted last turn."
 *
 * Two halves: the SHOP banks what each Chef handed out (per instance, summed across every recipient), and the
 * turn rollover moves that into `chefGrantedLast`; COMBAT spends the banked figure on the Chef's attack.
 */
const rune = () => [...RUNES, ...EPIC_RUNES].find((r) => r.id === 'rune_chef')!;
const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });
const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

describe('the def', () => {
  it('is Epic, 6, and set-2 scoped (Dwarves)', () => {
    expect([rune().cost, rune().epic, rune().sets]).toEqual([6, true, ['set2']]);
  });
});

describe('the shop half — banking what the Chef handed out', () => {
  /** Play `n` Dwarves beside a Chef on a board that already holds `others` Dwarves, and report the tally. */
  // DISTINCT Dwarf ids on purpose: three copies of one id would triple into a golden mid-test and eat the
  // very plays being counted (the same trap the Transcription test hit).
  const DWARVES = ['dw_orin', 'dw_ironlung', 'dw_brunni'];
  const tallyAfterPlays = (extraDwarves: number): number => {
    let s: RunState = {
      ...createRun(3), phase: 'recruit', embers: 0, shop: [],
      board: [bm('chef', 'dw_chef', 6, 7), bm('d0', 'dw_wardkeeper', 1, 1)],
      hand: Array.from({ length: extraDwarves }, (_, i) => bm(`h${i}`, DWARVES[i]!, 1, 1)),
    };
    for (let i = 0; i < extraDwarves; i++) s = reduce(s, { type: 'play', uid: `h${i}` }) as RunState;
    return s.board.find((c) => c.uid === 'chef')!.chefGranted ?? 0;
  };

  it('sums across every recipient — a wider Dwarf board banks more', () => {
    // 1 play: the Chef + 1 Dwarf + the arriver are all Dwarves, so +3 lands on 3 bodies = 9.
    const one = tallyAfterPlays(1);
    const two = tallyAfterPlays(2);
    expect(one, 'nothing was banked').toBeGreaterThan(0);
    expect(two, 'a second play (onto a wider board) must bank strictly more').toBeGreaterThan(one);
  });

  it('the turn rollover banks it as LAST turn and resets the running tally', () => {
    let s: RunState = {
      ...createRun(3), phase: 'recruit', embers: 0, shop: [],
      board: [bm('chef', 'dw_chef', 6, 7), bm('d0', 'dw_wardkeeper', 1, 1)],
      hand: [bm('h0', 'dw_orin', 1, 1)],
    };
    s = reduce(s, { type: 'play', uid: 'h0' }) as RunState;
    const banked = s.board.find((c) => c.uid === 'chef')!.chefGranted ?? 0;
    expect(banked).toBeGreaterThan(0);
    s = reduce({ ...s, phase: 'combat', lastCombat: win } as RunState, { type: 'resolveCombat' }) as RunState;
    const chef = s.board.find((c) => c.uid === 'chef')!;
    expect(chef.chefGrantedLast, 'the turn total did not carry').toBe(banked);
    expect(chef.chefGranted, 'the running tally did not reset').toBe(0);
  });
});

/**
 * THE END-TO-END PATH — buy the rune, bank a tally, fight. The per-mechanism tests below inject `questMods`
 * straight into `simulate`, which proves the COMBAT behaviour but bypasses the reducer entirely: the flag
 * writer and the board→BoardMinion mapper are both invisible to them. Two real defects hid in exactly that
 * blind spot (the flag was never written; `chefGrantedLast` never reached the combat body), so this test
 * drives the whole chain through `reduce` and nothing else.
 */
describe('end to end, through the reducer', () => {
  it('buying the rune and fighting actually pays the Rally out', () => {
    let s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: ['rune_chef'] };
    s = reduce(s, { type: 'buyRune', index: 0 }) as RunState;
    expect(s.questFlags?.runeChef, 'the rune never armed its flag').toBe(true);
    s = {
      ...s, embers: 0, shop: [], hand: [],
      board: [{ ...bm('chef', 'dw_chef', 6, 40), chefGrantedLast: 12 }, bm('d0', 'dw_wardkeeper', 1, 40)],
    } as RunState;
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    const r = s.lastCombat!;
    const chef = r.initial.player.find((m) => m.cardId === 'dw_chef')!;
    const buffs = r.events.filter((e) => e.type === 'buff' && e.source === chef.uid);
    expect(buffs.length, 'the Rally never fired through the real path').toBeGreaterThan(0);
    expect(buffs.every((b) => b.type === 'buff' && b.attack === 12 && b.health === 12)).toBe(true);
  });
});

describe('the combat half — the Rally spends the banked figure', () => {
  const mods = (m: Partial<CombatSideState['questMods']>) => ({ questMods: m as CombatSideState['questMods'] });
  const fight = (armed: boolean, banked: number) => simulate(
    [{ cardId: 'dw_chef', attack: 4, health: 400, chefGrantedLast: banked },
     { cardId: 'dw_soldier', attack: 1, health: 400 }],
    [{ cardId: 'sandbag', attack: 0, health: 40000 }], makeRng(4), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['dwarf'], ...(armed ? mods({ runeChef: true }) : {}) }), combatSide({ tier: 1 }));
  const chefBuffs = (r: ReturnType<typeof simulate>) => {
    const chef = r.initial.player.find((m) => m.cardId === 'dw_chef')!;
    return r.events.filter((e) => e.type === 'buff' && e.source === chef.uid);
  };

  it('does nothing without the rune', () => {
    expect(chefBuffs(fight(false, 12)).length).toBe(0);
  });

  it('buffs a Dwarf by exactly the banked total when armed', () => {
    const buffs = chefBuffs(fight(true, 12));
    expect(buffs.length, 'the Rally never fired').toBeGreaterThan(0);
    expect(buffs.every((b) => b.type === 'buff' && b.attack === 12 && b.health === 12)).toBe(true);
  });

  it('a Chef that banked nothing pays nothing — no 0/0 buffs', () => {
    expect(chefBuffs(fight(true, 0)).length).toBe(0);
  });
});
