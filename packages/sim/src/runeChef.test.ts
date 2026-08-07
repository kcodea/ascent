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

describe('the tally is SHOP-PHASE ONLY (owner ruling 2026-08-07)', () => {
  it('the Chef grant has NO combat implementation, so a combat summon can never bank stats', async () => {
    // The ruling holds structurally, not by a runtime check: `onTribeSummonedBuffTribe` lives only in the
    // RECRUIT factory table. If it is ever arena-migrated (the Shout/summon families have been, one by one)
    // the Chef would start banking mid-fight grants toward next turn's payout — silently, and only visible as
    // a payout that felt too big. This test is the tripwire: migrate the effect and it fails here first.
    const core = await import('@game/core');
    const combatFactories = (core as unknown as { FACTORIES?: Record<string, unknown> }).FACTORIES;
    if (combatFactories) {
      expect(combatFactories['onTribeSummonedBuffTribe'],
        'onTribeSummonedBuffTribe gained a COMBAT half — decide deliberately whether combat grants bank into chefGranted').toBeUndefined();
    }
    // Belt and braces via the effect data: the Chef's only effect is the recruit-side summon watcher.
    expect(CARD_INDEX['dw_chef']!.effects.map((e) => e.do)).toEqual(['onTribeSummonedBuffTribe']);
  });

  it('a combat that summons Dwarves leaves the banked tally untouched', () => {
    // Drive a real fight from a Chef board and confirm the run's tally is unchanged by anything combat did.
    let s: RunState = {
      ...createRun(3), phase: 'recruit', embers: 0, shop: [], hand: [],
      board: [{ ...bm('chef', 'dw_chef', 6, 40), chefGranted: 0 },
              bm('brawl', 'dw_chickenbrawl', 3, 3)], // its Echo summons a Dwarf mid-combat
    };
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    s = reduce(s, { type: 'settleCombat' }) as RunState;
    const chef = s.board.find((c) => c.uid === 'chef');
    if (chef) expect(chef.chefGranted ?? 0, 'combat banked into the shop tally').toBe(0);
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

  it('the turn rollover RESETS the tally — the combat just built already read the live figure', () => {
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
    // Banking into a second field is what made the payout arrive a turn late (owner report). The next shop
    // simply starts from zero; the combat that just ran already spent the live figure.
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
      // Both bodies must OUTLIVE the Chef's first swing: since the 2026-08-07 ruling the Rally targets
      // "another" Dwarf, so a fixture whose only other Dwarf dies first has no legal target and proves
      // nothing. Ward ('DS') is what makes that reliable — the served omens carry VENOM, which kills through
      // any amount of Health, so stacking HP alone did not survive contact.
      board: [
        { ...bm('chef', 'dw_chef', 6, 9000), chefGranted: 12, keywords: ['DS'] },
        { ...bm('d0', 'dw_wardkeeper', 1, 9000), keywords: ['DS'] },
      ],
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

  it('buffs ANOTHER Dwarf — never itself (owner ruling 2026-08-07)', () => {
    const r = fight(true, 12);
    const chef = r.initial.player.find((m) => m.cardId === 'dw_chef')!;
    const self = r.events.filter((e) => e.type === 'buff' && e.source === chef.uid && e.target === chef.uid);
    expect(self.length, 'the Chef fed itself').toBe(0);
    // …and it did feed the other Dwarf, so the exclusion didn't just switch the whole thing off.
    expect(chefBuffs(r).length).toBeGreaterThan(0);
  });

  it('a LONE Chef does nothing — "another" with no other Dwarf has no target', () => {
    const r = simulate(
      [{ cardId: 'dw_chef', attack: 4, health: 400, chefGrantedLast: 12 }],
      [{ cardId: 'sandbag', attack: 0, health: 40000 }], makeRng(4), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['dwarf'], ...mods({ runeChef: true }) }), combatSide({ tier: 1 }));
    const chef = r.initial.player.find((m) => m.cardId === 'dw_chef')!;
    expect(r.events.filter((e) => e.type === 'buff' && e.source === chef.uid).length).toBe(0);
  });
});
