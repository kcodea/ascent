/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 2 (owner 2026-09-27): the Celestial runes, SHOP / END OF TURN / settle halves,
 * through the real reducer and the Shop chokepoints. The combat halves are
 * `packages/core/src/combat/set3RuneDesignT2.test.ts`. The Event Horizon slot is left empty (owner).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { applyEndOfTurn, castSpell, destroyMinionInShop, makeContext } from './recruit';
import { createStarform, destroyStarform, starformConsumeShopMinion, starformStats } from './starform';
import { createRun, reduce, type BoardCard, type BoardSnapshot, type RunState } from './index';

const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'celestial', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const SHOUT_CEL = probe('dbg_t2s_shout', { effects: [{ on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 1, health: 1 } }] });
const ECHO_CEL = probe('dbg_t2s_echo', { attack: 1, health: 1, effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 0, health: 1 } }] });
const SHOUT_NEU = probe('dbg_t2s_shoutn', { tribe: 'neutral', effects: [{ on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 1, health: 1 } }] });
const CEL = probe('dbg_t2s_cel', { attack: 2, health: 2 });
const CEL_B = probe('dbg_t2s_celb', { attack: 2, health: 2 });
const CEL_C = probe('dbg_t2s_celc', { attack: 2, health: 2 });
const NEU = probe('dbg_t2s_neu', { tribe: 'neutral', attack: 2, health: 2 });
for (const c of [SHOUT_CEL, SHOUT_NEU, CEL, CEL_B, CEL_C, NEU, ECHO_CEL]) CARD_INDEX[c.id] = c;

const card = (id: string, uid: string): BoardCard => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as BoardCard;
};
const run = (board: BoardCard[], runes: string[], hand: BoardCard[] = []): RunState => {
  let s: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', embers: 30, hand: [], board } as RunState;
  for (const id of runes) s = reduce(s, { type: 'devGrant', kind: 'rune', id });
  return { ...s, discover: undefined, discoverQueue: undefined, hand };
};
const SRC = { cardId: 'dbg_t2s', name: 'Test' };
const sf = (s: RunState): [number, number] | null => { const st = starformStats(s); return st ? [st.attack, st.health] : null; };
const at = (s: RunState, uid: string) => s.board.find((c) => c.uid === uid)!;

describe('the tranche 2 roster (owner 2026-09-27)', () => {
  it('seven Celestial runes at the doc costs, Set 3 only, Celestial-gated; no Event Horizon', () => {
    const want: [string, number, boolean][] = [
      ['rune_heralding_star', 3, false], ['rune_stellar_echoes', 3, false], ['rune_scattered_light', 3, false], ['rune_gravity', 4, false],
      ['rune_afterglow', 3, false], ['rune_starsong', 4, true], ['rune_guiding_star', 5, true],
    ];
    for (const [id, cost, epic] of want) {
      const r = RUNE_INDEX[id]!;
      expect([r.cost, !!r.epic, r.sets, r.tribes], id).toEqual([cost, epic, ['set3'], ['celestial']]);
      expect(r.text, `${id}: no em dash`).not.toMatch(/—|--/);
    }
    expect(RUNE_INDEX['rune_event_horizon']).toBeUndefined();
    // The owner's pick for the Event Horizon slot (2026-09-27), renamed: "Meteor Shower" is an existing Set 3 rune's name.
    expect([RUNE_INDEX['rune_meteor_storm']!.cost, RUNE_INDEX['rune_meteor_storm']!.epic, RUNE_INDEX['rune_meteor_storm']!.tribes]).toEqual([5, true, ['celestial']]);
    expect(RUNE_INDEX['rune_meteor_shower']!.name).toBe('Rune of the Meteor Shower'); // the existing E2, untouched
  });
});

describe('Rune of the Heralding Star / the Starsong — Shop Shouts', () => {
  it('playing a Celestial Shout gives the Starform +3/+3 and your Celestials +2/+2; a neutral Shout does neither', () => {
    let s = run([card(CEL.id, 'c'), card(NEU.id, 'n')], ['rune_heralding_star', 'rune_starsong'], [card(SHOUT_CEL.id, 'h'), card(SHOUT_NEU.id, 'hn')]);
    createStarform(s, SRC);
    const before = sf(s)!;
    s = reduce(s, { type: 'play', uid: 'h', toIndex: 0 });
    expect(sf(s)).toEqual([before[0] + 3, before[1] + 3]);
    // The Starsong: every board Celestial (+2/+2), on top of the Shout's own +1/+1 to its neighbour 'c'.
    expect([at(s, 'c').attack, at(s, 'c').health]).toEqual([5, 5]);
    expect(at(s, 'n').attack, 'neutral untouched by the Starsong').toBeLessThanOrEqual(3);
    const mid = sf(s)!;
    s = reduce(s, { type: 'play', uid: 'hn', toIndex: 0 });
    expect(sf(s)).toEqual(mid);
  });
  it('no Starform: the Heralding Star simply has nothing to feed', () => {
    let s = run([], ['rune_heralding_star'], [card(SHOUT_CEL.id, 'h')]);
    s = reduce(s, { type: 'play', uid: 'h', toIndex: 0 });
    expect(sf(s)).toBeNull();
  });
});

describe('Rune of Stellar Echoes — the graft, Shop and settle', () => {
  it('every friendly Celestial carries the Echo (board + hand, later arrivals); a Shop destroy feeds the Starform', () => {
    const s = run([card(CEL.id, 'c'), card(NEU.id, 'n')], ['rune_stellar_echoes']);
    expect(at(s, 'c').grantedEffects?.some((e) => e.do === 'deathrattleBuffStarform')).toBe(true);
    expect(at(s, 'n').grantedEffects?.some((e) => e.do === 'deathrattleBuffStarform') ?? false).toBe(false);
    createStarform(s, SRC);
    const before = sf(s)!;
    destroyMinionInShop(makeContext(s), at(s, 'c'));
    expect(sf(s)).toEqual([before[0] + 2, before[1] + 2]);
  });
  it('combat: the banked gain lands on the Starform at settle', () => {
    let s = run([card(CEL.id, 'c')], ['rune_stellar_echoes']);
    createStarform(s, SRC);
    const before = sf(s)!;
    const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 50, health: 500, keywords: [] }], seed: 1, origin: 'self' };
    s = reduce({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.lastCombat?.playerStarformGain).toEqual([{ source: 'Rune of Stellar Echoes', attack: 2, health: 2 }]);
    expect(sf(s)).toEqual([before[0] + 2, before[1] + 2]);
  });
});

describe('Rune of Scattered Light', () => {
  it('buying the Starform Collapses it: half its stats (rounded up) to each of 3 Celestials, not all to the left-most', () => {
    // Three DIFFERENT Celestials (three copies of one card would triple).
    let s = run([card(CEL.id, 'a'), card(CEL_B.id, 'b'), card(CEL_C.id, 'c')], ['rune_scattered_light']);
    const offer = createStarform(s, SRC);
    const [fa, fh] = sf(s)!;
    s = reduce(s, { type: 'buy', uid: offer.uid });
    expect(sf(s)).toBeNull();
    for (const uid of ['a', 'b', 'c']) expect([at(s, uid).attack, at(s, uid).health], uid).toEqual([2 + Math.ceil(fa / 2), 2 + Math.ceil(fh / 2)]);
  });
});

describe('Rune of Gravity', () => {
  it('each Starform consume gives your Celestials +2/+2 (the consume meter, per 1)', () => {
    const s = run([card(CEL.id, 'c'), card(NEU.id, 'n')], ['rune_gravity']);
    s.shop = [{ uid: 'o1', cardId: 'sandbag' }];
    createStarform(s, SRC); // the row is not full: it is created without eating
    const cBefore = at(s, 'c').attack;
    // The Starform eats the Shop minion (the Starform consume path the Celestial cards use).
    const ate = starformConsumeShopMinion(s, s.shop.findIndex((o) => o.uid === 'o1'));
    expect(ate).toBe(true);
    expect(at(s, 'c').attack).toBe(cBefore + 2);
    expect(at(s, 'n').attack, 'non-Celestial unchanged').toBe(2);
  });
});

describe('Rune of the Afterglow', () => {
  it('the Starform leaving the Shop (a buy) gets a Star Crash; the Star Destroyer\'s silent exit does not', () => {
    let s = run([card(CEL.id, 'c')], ['rune_afterglow']);
    const offer = createStarform(s, SRC);
    s = reduce(s, { type: 'buy', uid: offer.uid });
    expect(s.hand.map((c) => c.cardId)).toContain('starcrash');
    const s2 = run([card(CEL.id, 'c')], ['rune_afterglow']);
    createStarform(s2, SRC);
    destroyStarform(s2);
    expect(s2.hand.map((c) => c.cardId)).not.toContain('starcrash');
  });
});

describe('Rune of the Guiding Star — Shop and End of Turn', () => {
  it('a Shop destroy of a Celestial with an Echo casts a Star Crash on ANOTHER friendly Celestial (+5/+7)', () => {
    const s = run([card(CEL.id, 'dying'), card(CEL.id, 'other')], ['rune_guiding_star', 'rune_stellar_echoes']);
    const spells = s.spellsCast ?? 0;
    destroyMinionInShop(makeContext(s), at(s, 'dying'));
    const o = at(s, 'other');
    expect(o.attack).toBeGreaterThanOrEqual(2 + 5);
    expect((s.spellsCast ?? 0) - spells, 'a real cast').toBeGreaterThanOrEqual(1);
  });
  it('End of Turn: a forced Echo (Rune of the Reliquary\'s effect) casts too', () => {
    const s = run([card(ECHO_CEL.id, 'e'), card(CEL.id, 'other')], ['rune_guiding_star']);
    s.questRecurringEndOfTurn = ['triggerLeftmostEcho'];
    const before = at(s, 'other').attack;
    applyEndOfTurn(s);
    expect(at(s, 'other').attack).toBeGreaterThanOrEqual(before + 5);
  });
});

describe('Rune of the Meteor Storm — Shop (owner pick 2026-09-27)', () => {
  it('a Star Crash cast is cast again on a different friendly Celestial, once (the echo never echoes)', () => {
    const s = run([card(CEL.id, 'a'), card(CEL_B.id, 'b')], ['rune_meteor_storm']);
    const spells = s.spellsCast ?? 0;
    castSpell(s, CARD_INDEX['starcrash']!, at(s, 'a'));
    // 'b' is the only different Celestial: it takes the echo's aimed +5/+7 (plus maybe a random-friend landing).
    expect(at(s, 'b').attack).toBeGreaterThanOrEqual(2 + 5);
    expect((s.spellsCast ?? 0) - spells, 'the cast + exactly one echo').toBe(2);
  });
  it('no other friendly Celestial: nothing extra', () => {
    const s = run([card(CEL.id, 'a'), card(NEU.id, 'n')], ['rune_meteor_storm']);
    const spells = s.spellsCast ?? 0;
    castSpell(s, CARD_INDEX['starcrash']!, at(s, 'a'));
    expect((s.spellsCast ?? 0) - spells).toBe(1);
  });
  it('a Star Crash cast on the Starform echoes onto a board Celestial', () => {
    const s = run([card(CEL.id, 'a')], ['rune_meteor_storm']);
    createStarform(s, SRC);
    const tok = s.shop.find((o) => o.starform)!;
    const before = at(s, 'a').attack;
    castSpell(s, CARD_INDEX['starcrash']!, { uid: tok.uid, cardId: tok.cardId, tribe: 'celestial', attack: 1, health: 1, keywords: [], golden: false } as BoardCard);
    expect(at(s, 'a').attack).toBeGreaterThanOrEqual(before + 5);
  });
});

