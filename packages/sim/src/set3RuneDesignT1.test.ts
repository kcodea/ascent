/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 1 (owner 2026-09-27): the Undead runes, SHOP / END OF TURN / settle halves, through
 * the real reducer and the real Shop chokepoints. The combat halves are `packages/core/src/combat/set3RuneDesignT1.test.ts`.
 *
 * Owner rulings honoured: Rune of the Soul Toll is built instead of the Unquiet (and no Mortal Coil).
 */
import { describe, expect, it } from 'vitest';
import { soulFurnaceHealth, type CardDef } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { applyEndOfTurn, destroyMinionInShop, displayedStatsOf, makeContext, raiseUndeadAuraShop, settlePendingDeath, syncSoulFurnace } from './recruit';
import { questCombatMods } from './reducer';
import { createRun, reduce, type BoardCard, type BoardSnapshot, type RunState } from './index';

const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'undead', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const ECHO_UNDEAD = probe('dbg_t1s_echo', { effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 1, health: 1 } }] });
const RISER = probe('dbg_t1s_rise', { attack: 2, health: 2, keywords: ['R'] });
const RISE_ECHO = probe('dbg_t1s_rise_echo', { attack: 2, health: 2, keywords: ['R'], effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 1, health: 1 } }] });
const PLAIN = probe('dbg_t1s_plain', { attack: 3, health: 3 });
const NEUTRAL = probe('dbg_t1s_neutral', { tribe: 'neutral', attack: 3, health: 3 });
for (const c of [ECHO_UNDEAD, RISER, RISE_ECHO, PLAIN, NEUTRAL]) CARD_INDEX[c.id] = c;

const card = (id: string, uid: string): BoardCard => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as BoardCard;
};
const run = (board: BoardCard[], runes: string[]): RunState => {
  let s: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', embers: 0, hand: [], board } as RunState;
  for (const id of runes) s = reduce(s, { type: 'devGrant', kind: 'rune', id });
  return { ...s, discover: undefined, discoverQueue: undefined };
};
const at = (s: RunState, cardId: string) => s.board.find((c) => c.cardId === cardId)!;

describe('the tranche 1 roster (owner 2026-09-27)', () => {
  it('eight Undead runes at the doc costs, Set 3 only, Undead-gated; Soul Toll replaces the Unquiet', () => {
    const want: [string, number, boolean][] = [
      ['rune_lantern_keeper', 4, false], ['rune_wake', 4, false], ['rune_second_wind', 3, false], ['rune_soul_toll', 3, false],
      ['rune_gravedigger', 3, false], ['rune_soul_furnace', 5, true], ['rune_restless', 5, true], ['rune_open_grave', 4, true],
    ];
    for (const [id, cost, epic] of want) {
      const r = RUNE_INDEX[id]!;
      expect([r.cost, !!r.epic, r.sets, r.tribes], id).toEqual([cost, epic, ['set3'], ['undead']]);
      expect(r.text, `${id}: no em dash`).not.toMatch(/—|--/);
    }
    for (const gone of ['rune_unquiet', 'rune_mortal_coil']) expect(RUNE_INDEX[gone], gone).toBeUndefined();
    expect(RUNE_INDEX['rune_soul_toll']!.text).toBe('**Avenge (4):** give your **Undead Aura +1 Attack**.');
  });
});

describe('Rune of the Lantern Keeper', () => {
  it('gets a Lantern of Souls now and arms the every-2-turns cadence (the badge counts x/2 turns)', () => {
    const s = run([], ['rune_lantern_keeper']);
    expect(s.hand.map((c) => c.cardId)).toContain('lanternofsouls');
    expect(s.runeCadenceGrants).toContainEqual(expect.objectContaining({ cardId: 'lanternofsouls', everyTurns: 2, sourceId: 'rune_lantern_keeper' }));
  });
});

describe('Rune of the Wake — Shop, End of Turn, settle', () => {
  it('Shop: destroying an Undead with an Echo raises the Undead Aura +1 Attack (shown on every Undead)', () => {
    const s = run([card(ECHO_UNDEAD.id, 'e'), card(PLAIN.id, 'p')], ['rune_wake']);
    destroyMinionInShop(makeContext(s), at(s, ECHO_UNDEAD.id));
    expect(s.undeadAttackBonus).toBe(1);
    // The plain Undead shows its stored stats + the fold (+1 from the Echo's buff-all, +1 from the Aura).
    const p = at(s, PLAIN.id);
    expect(displayedStatsOf(s, p).attack).toBe(p.attack + 1);
  });
  it('End of Turn: a forced Echo (Rune of the Reliquary\'s effect) counts too', () => {
    const s = run([card(ECHO_UNDEAD.id, 'e'), card(PLAIN.id, 'p')], ['rune_wake']);
    s.questRecurringEndOfTurn = ['triggerLeftmostEcho'];
    applyEndOfTurn(s);
    expect(s.undeadAttackBonus).toBe(1);
  });
  it('combat: the fight\'s Undead Echoes carry back to the run Aura at settle', () => {
    let s = run([card(ECHO_UNDEAD.id, 'e'), card(PLAIN.id, 'p')], ['rune_wake']);
    const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 50, health: 500, keywords: [] }], seed: 1, origin: 'self' };
    s = reduce({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.undeadAttackBonus).toBeGreaterThanOrEqual(1);
    expect(s.undeadAttackBonus).toBe(s.lastCombat?.playerUndeadAuraGain?.attack);
  });
});

describe('Rune of the Soul Furnace — the one Aura fold', () => {
  it('the Aura\'s Health term (ceil(Attack / 2)) lives inside undeadHealthBonus and follows the Aura live', () => {
    const s = run([card(PLAIN.id, 'p'), card(NEUTRAL.id, 'n')], ['rune_soul_furnace']);
    expect(s.undeadHealthBonus).toBe(0);
    raiseUndeadAuraShop(s, 5);
    expect(s.undeadHealthBonus).toBe(3);
    expect(s.soulFurnaceHp).toBe(3);
    // The buy channel (Deathswarmer's) is part of the same Aura: the boundary sync picks it up.
    s.undeadBuyAtk = (s.undeadBuyAtk ?? 0) + 2;
    syncSoulFurnace(s);
    expect(s.undeadHealthBonus).toBe(soulFurnaceHealth(7, 1));
    const p = at(s, PLAIN.id);
    expect(displayedStatsOf(s, p).health).toBe(p.health + 4);
    expect(displayedStatsOf(s, at(s, NEUTRAL.id)).health, 'non-Undead unaffected').toBe(3);
    // Combat is seeded with the term inside undeadHp, and re-derives live (the mods flag).
    expect(questCombatMods(s).runeSoulFurnace).toBe(true);
  });
  it('any reducer action re-syncs (a Lantern cast from hand)', () => {
    let s = run([card(PLAIN.id, 'p')], ['rune_soul_furnace', 'rune_lantern_keeper']);
    s = { ...s, embers: 10 };
    const lantern = s.hand.find((c) => c.cardId === 'lanternofsouls')!;
    s = reduce(s, { type: 'play', uid: lantern.uid });
    expect(s.undeadAttackBonus).toBeGreaterThanOrEqual(5);
    expect(s.undeadHealthBonus).toBe(soulFurnaceHealth(s.undeadAttackBonus + (s.undeadBuyAtk ?? 0), 1));
  });
});

describe('Rune of the Gravedigger — both Shop destroy paths', () => {
  it('an immediate destroy gives your other Undead +2/+2; non-Undead unchanged', () => {
    const s = run([card(PLAIN.id, 'v'), card(PLAIN.id, 'u'), card(NEUTRAL.id, 'n')], ['rune_gravedigger']);
    destroyMinionInShop(makeContext(s), s.board[0]!);
    expect([s.board.find((c) => c.uid === 'u')!.attack, s.board.find((c) => c.uid === 'u')!.health]).toEqual([5, 5]);
    expect(s.board.find((c) => c.uid === 'n')!.attack).toBe(3);
  });
  it('the deferred destroy (a pending death) pays the same, and never buffs the dying body', () => {
    const s = run([card(PLAIN.id, 'v'), card(PLAIN.id, 'u')], ['rune_gravedigger']);
    s.pendingDeath = { uid: 'v', kind: 'destroy' };
    settlePendingDeath(s);
    expect(s.board.map((c) => c.uid)).toEqual(['u']);
    expect(s.board[0]!.attack).toBe(5);
  });
});

describe('Rune of the Open Grave', () => {
  it('the first Shop destroy each turn gains Rise and comes back; the second does not', () => {
    const s = run([card(PLAIN.id, 'a'), card(PLAIN.id, 'b')], ['rune_open_grave']);
    destroyMinionInShop(makeContext(s), s.board.find((c) => c.uid === 'a')!);
    expect(s.openGraveUsedThisTurn).toBe(true);
    expect(s.board).toHaveLength(2); // 'b' + the risen 'a' (fresh uid, printed body at 1 Health)
    const risen = s.board.find((c) => c.uid !== 'b')!;
    expect([risen.cardId, risen.health]).toEqual([PLAIN.id, 1]);
    destroyMinionInShop(makeContext(s), s.board.find((c) => c.uid === 'b')!);
    expect(s.board.map((c) => c.uid)).not.toContain('b');
    expect(s.board).toHaveLength(1);
  });
  it('a body that already has Rise does not spend the charge', () => {
    const s = run([card(RISER.id, 'r'), card(PLAIN.id, 'p')], ['rune_open_grave']);
    destroyMinionInShop(makeContext(s), s.board[0]!);
    expect(s.openGraveUsedThisTurn).toBeFalsy();
  });
});

describe('Rune of the Second Wind / the Restless — Shop Rise', () => {
  it('Second Wind: a Shop Rise returns +2/+2 (printed 2 Attack, 1 Health, then the grant)', () => {
    const s = run([card(RISER.id, 'r')], ['rune_second_wind']);
    destroyMinionInShop(makeContext(s), s.board[0]!);
    const risen = s.board[0]!;
    expect([risen.attack, risen.health]).toEqual([4, 3]);
  });
  it('Restless: the risen body\'s Echo fires again (the wall gets the Echo twice); the Wake hears both', () => {
    const s = run([card(RISE_ECHO.id, 'r'), card(NEUTRAL.id, 'w')], ['rune_restless', 'rune_wake']);
    destroyMinionInShop(makeContext(s), s.board[0]!);
    const w = s.board.find((c) => c.uid === 'w')!;
    expect([w.attack, w.health]).toEqual([5, 5]);
    expect(s.undeadAttackBonus, 'two Undead Echo triggers').toBe(2);
  });
});
