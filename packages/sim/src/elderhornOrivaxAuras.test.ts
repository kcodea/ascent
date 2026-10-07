import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatResult, type QuestCombatMods } from '@game/core';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { fireRecruitDeathrattlesForTest } from './recruit';
import { snapshotBoard } from './snapshot';
import { sideFromSnapshot } from './boardSide';

/**
 * ELDERHORN + ORIVAX — the owner batch 2026-10-07. Both used to be a Choose One that installed a PERMANENT run mode.
 * Both are now BOARD AURAS. Owner ruling: "While on board" — the aura works only while the minion is on your board,
 * like normal card text, never permanently once played.
 *
 *   Elderhorn: "Your Beasts' Rallies and Echoes trigger an additional time." (golden: 2; every copy stacks)
 *   Orivax:    "Your Shouts trigger 2 additional times."                     (golden: 4; every copy stacks; ADDS to
 *              the run-wide Shout extras such as Rune of the Choir, in the Shop and in combat alike)
 */

const bc = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra } as BoardMinion);

// ── Elderhorn ─────────────────────────────────────────────────────────────────────────────────────────────

// A summoning Echo, so each Echo fire is countable as a summon; one Beast and one Dragon copy of it.
const echoBeast: CardDef = { id: 'eo_echobeast', name: 'EB', tribe: 'beast', tier: 2, attack: 0, health: 1, keywords: [],
  effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'stray', count: 1 } }], text: '' };
const echoDragon: CardDef = { ...echoBeast, id: 'eo_echodragon', name: 'ED', tribe: 'dragon' };
const cleaver: CardDef = { id: 'eo_cleaver', name: 'CL', tribe: 'neutral', tier: 1, attack: 5, health: 400, keywords: ['C'], effects: [], text: '' };
const CARDS = { ...CARD_INDEX, eo_echobeast: echoBeast, eo_echodragon: echoDragon, eo_cleaver: cleaver };

/** Echo fires (summons) when `dying` dies beside `others`, the player side fighting a 5-Attack wall. */
const echoSummons = (dying: string, others: BoardMinion[], seed = 3): number => {
  const r = simulate([bm(dying, 'D', 0, 1), ...others], [bm('sandbag', 'W', 5, 400)], makeRng(seed), CARDS,
    combatSide({ tier: 5 }), combatSide({ tier: 1 }));
  return r.events.filter((e) => e.type === 'summon').length;
};
// Elderhorn with 0 Attack never swings, so it only ever stands there as the aura.
const elder = (uid = 'E', golden = false): BoardMinion => bm('b2_elderhorn', uid, 0, 400, { golden });

const rallyBeastId = Object.values(CARD_INDEX).find((c) => c && c.tribe === 'beast' && !c.tribe2 && !c.token && !c.spell
  && c.keywords.includes('RL') && c.effects.some((e) => e.on === 'onAttack' && !e.combatOnly)
  && c.effects.every((e) => e.on === 'onAttack'))!.id;
const rallyOtherId = Object.values(CARD_INDEX).find((c) => c && c.tribe === 'mech' && !c.tribe2 && !c.token && !c.spell
  && c.keywords.includes('RL') && c.effects.some((e) => e.on === 'onAttack')
  && c.effects.every((e) => e.on === 'onAttack'))!.id;

/** Rally triggers per swing of a lone rallier (an Attack-0 Elderhorn beside it never swings). */
const ralliesPerSwing = (rallier: string, withElder: BoardMinion[]): number => {
  const r = simulate([bm(rallier, 'R', 1, 400), ...withElder], [bm('sandbag', 'W', 0, 400)], makeRng(11), CARDS,
    combatSide({ tier: 6 }), combatSide({ tier: 1 }));
  const rUid = r.initial.player[0]!.uid;
  const playerSwings = r.events.filter((e) => e.type === 'attack' && e.attacker === rUid).length;
  expect(playerSwings).toBeGreaterThan(0);
  return (r.playerRallies ?? 0) / playerSwings;
};

describe('Elderhorn — "Your Beasts\' Rallies and Echoes trigger an additional time" (while on board)', () => {
  it('is an aura in card data, not a Choose One', () => {
    const d = CARD_INDEX['b2_elderhorn']!;
    expect(d.chooseOne).toBeUndefined();
    expect(d.triggerMultiplier).toEqual({ families: ['rally', 'deathrattle'], extra: 1, stacks: true, tribe: 'beast' });
  });

  it('COMBAT Echo: a Beast Echo fires twice with Elderhorn on board; a non-Beast Echo is untouched', () => {
    expect(echoSummons('eo_echobeast', [])).toBe(1);
    expect(echoSummons('eo_echobeast', [elder()])).toBe(2);
    expect(echoSummons('eo_echodragon', [elder()])).toBe(1);
  });

  it('COMBAT Echo: golden is 2 additional, and copies stack (additive, like Sylus)', () => {
    expect(echoSummons('eo_echobeast', [elder('E', true)])).toBe(3);
    expect(echoSummons('eo_echobeast', [elder('E1'), elder('E2')])).toBe(3);
  });

  it('COMBAT Echo: stacks additively with Sylus', () => {
    expect(echoSummons('eo_echobeast', [elder(), bm('sylus', 'S', 0, 400)])).toBe(3);
  });

  it('COMBAT Rally: a Beast Rally fires twice per swing; a non-Beast Rally is untouched', () => {
    expect(ralliesPerSwing(rallyBeastId, [])).toBe(1);
    expect(ralliesPerSwing(rallyBeastId, [elder()])).toBe(2);
    expect(ralliesPerSwing(rallyBeastId, [elder('E', true)])).toBe(3);
    expect(ralliesPerSwing(rallyOtherId, [elder()])).toBe(1);
  });

  it('SIMULTANEOUS death (one Cleave kills both): deaths resolve left to right, so Elderhorn doubles an Echo that resolves before its own death and not one after it (the Sylus precedent)', () => {
    const fight = (order: 'beastFirst' | 'elderFirst'): number => {
      const pair = [bm('eo_echobeast', 'B', 0, 1), bm('b2_elderhorn', 'E', 0, 1)];
      if (order === 'elderFirst') pair.reverse();
      const r = simulate(pair, [bm('eo_cleaver', 'C', 5, 400, { keywords: ['C'] })], makeRng(2), CARDS, combatSide({ tier: 5 }), combatSide({ tier: 1 }));
      return r.events.filter((e) => e.type === 'summon').length;
    };
    expect(fight('beastFirst'), 'Elderhorn still standing (dying, unresolved) when the Echo fires').toBe(2);
    expect(fight('elderFirst'), 'Elderhorn already resolved as dead').toBe(1);
    // Exactly what Sylus does in the same spot.
    const sylus = (first: boolean): number => {
      const pair = [bm('eo_echobeast', 'B', 0, 1), bm('sylus', 'S', 0, 1)];
      if (!first) pair.reverse();
      const r = simulate(pair, [bm('eo_cleaver', 'C', 5, 400, { keywords: ['C'] })], makeRng(2), CARDS, combatSide({ tier: 5 }), combatSide({ tier: 1 }));
      return r.events.filter((e) => e.type === 'summon').length;
    };
    expect([sylus(true), sylus(false)]).toEqual([2, 1]);
  });

  const shopEchoBeast = Object.values(CARD_INDEX).find((c) => c && c.tribe === 'beast' && !c.tribe2 && !c.token && !c.spell
    && c.effects.length > 0 && c.effects.every((e) => e.on === 'onDeath'))!;
  const shopEchoOther = Object.values(CARD_INDEX).find((c) => c && c.tribe === 'undead' && !c.tribe2 && !c.token && !c.spell
    && c.effects.length > 0 && c.effects.every((e) => e.on === 'onDeath'))!;
  const shopEchoes = (dyingId: string, board: BoardCard[]): number => {
    const s: RunState = { ...createRun(9), tier: 6, phase: 'recruit', board: [bc('d', dyingId), ...board], hand: [] };
    const before = s.deathrattlesTriggered;
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    return s.deathrattlesTriggered - before;
  };

  it('SHOP Echo: the same aura applies to a Beast Echo in the Shop, and only while Elderhorn is on the board', () => {
    expect(shopEchoes(shopEchoBeast.id, [])).toBe(1);
    expect(shopEchoes(shopEchoBeast.id, [bc('e', 'b2_elderhorn')])).toBe(2);
    expect(shopEchoes(shopEchoBeast.id, [bc('e', 'b2_elderhorn', { golden: true })])).toBe(3);
    expect(shopEchoes(shopEchoOther.id, [bc('e', 'b2_elderhorn')])).toBe(1);
  });

  it('PLAYING it installs no run mode; SELLING it ends the aura', () => {
    let s: RunState = { ...createRun(7), tier: 7, phase: 'recruit', embers: 60, board: [], hand: [bc('e1', 'b2_elderhorn')] };
    s = reduce(s, { type: 'play', uid: 'e1' });
    expect(s.chooseOne, 'no Choose One prompt').toBeUndefined();
    expect(s.board.map((c) => c.cardId)).toEqual(['b2_elderhorn']);
    expect(s.beastHuntExtra ?? 0).toBe(0);
    expect(s.beastRitualExtra ?? 0).toBe(0);
    s = reduce(s, { type: 'sell', uid: 'e1' });
    expect(s.board).toEqual([]);
    expect(shopEchoes(shopEchoBeast.id, s.board)).toBe(1);
  });

  it('an Elderhorn that dies mid-fight stops doubling for the Echoes after it', () => {
    // Elderhorn (1 Health) dies first to the wall; the Beast behind it dies later and gets no extra.
    const r = simulate([bm('b2_elderhorn', 'E', 0, 1), bm('eo_echobeast', 'B', 0, 30)], [bm('sandbag', 'W', 5, 400)],
      makeRng(4), CARDS, combatSide({ tier: 5 }), combatSide({ tier: 1 }));
    const deaths = r.events.filter((e) => e.type === 'death');
    expect(deaths.length).toBeGreaterThanOrEqual(2);
    expect(r.events.filter((e) => e.type === 'summon').length).toBe(1);
  });

  it('the legacy run modes still resolve (old saves / replays)', () => {
    const r = simulate([bm('eo_echobeast', 'D', 0, 1)], [bm('sandbag', 'W', 5, 400)], makeRng(3), CARDS,
      combatSide({ tier: 5, beastRitualExtra: 1 }), combatSide({ tier: 1 }));
    expect(r.events.filter((e) => e.type === 'summon').length).toBe(2);
  });
});

// ── Orivax ────────────────────────────────────────────────────────────────────────────────────────────────

describe('Orivax — "Your Shouts trigger 2 additional times" (while on board)', () => {
  it('is renamed and an aura in card data, not a Choose One', () => {
    const d = CARD_INDEX['d2_orivax']!;
    expect(d.name).toBe('Orivax');
    expect(d.chooseOne).toBeUndefined();
    expect(d.chooseBothWhenGolden).toBeUndefined();
    expect(d.shoutExtraAura).toBe(2);
    expect(d.text).not.toMatch(/—|--/);
  });

  // Matriarch pays +1 Attack per Shout FIRE; Chronicler is the played Shout.
  const shopShoutFires = (board: BoardCard[], extra: Partial<RunState> = {}): number => {
    let s: RunState = {
      ...createRun(7), tier: 7, phase: 'recruit', embers: 60,
      board: [bc('mm', 'd2_matriarch', { attack: 4, health: 7 }), ...board], hand: [bc('sh', 'd2_chronicler')], ...extra,
    } as RunState;
    const before = s.board[0]!.attack;
    s = reduce(s, { type: 'play', uid: 'sh' });
    return s.board.find((c) => c.uid === 'mm')!.attack - before;
  };

  it('SHOP: a played Shout fires 3 times with Orivax on board, 5 with a golden one, 5 with two', () => {
    expect(shopShoutFires([])).toBe(1);
    expect(shopShoutFires([bc('ox', 'd2_orivax')])).toBe(3);
    expect(shopShoutFires([bc('ox', 'd2_orivax', { golden: true })])).toBe(5);
    expect(shopShoutFires([bc('o1', 'd2_orivax'), bc('o2', 'd2_orivax')])).toBe(5);
  });

  it('SHOP: ADDS to the run-wide Shout extras (Rune of the Choir / the legacy Orivax Chorus mode)', () => {
    expect(shopShoutFires([bc('ox', 'd2_orivax')], { shoutExtraAlways: 1 })).toBe(4);
  });

  it('PLAYING it installs no run mode; SELLING it ends the aura', () => {
    let s: RunState = { ...createRun(7), tier: 7, phase: 'recruit', embers: 60, board: [], hand: [bc('ox', 'd2_orivax')] };
    s = reduce(s, { type: 'play', uid: 'ox' });
    expect(s.chooseOne).toBeUndefined();
    expect(s.shoutExtraAlways ?? 0).toBe(0);
    s = reduce(s, { type: 'sell', uid: 'ox' });
    expect(s.board).toEqual([]);
    expect(shopShoutFires(s.board)).toBe(1);
  });

  // The docbot lane's combat path: Ryme's Echo re-fires its neighbour Alley Cat's Shout once.
  const combatShoutFires = (extra: BoardMinion[], mods: QuestCombatMods = {}, seed = 0xd0c5): number => {
    const r: CombatResult = simulate([bm('alley', 'p0', 1, 30), bm('ryme', 'p1', 1, 1), ...extra], [bm('cryptwolf', 'e0', 5, 60)],
      makeRng(seed), CARD_INDEX, combatSide({ tier: 6, questMods: mods } as never), combatSide({ tier: 3 }));
    return r.playerShoutFires ?? 0;
  };

  it('COMBAT: a Shout triggered mid-fight fires 3 times with Orivax on board, and each fire is its own counted `shout` beat', () => {
    expect(combatShoutFires([])).toBe(1);
    expect(combatShoutFires([bm('d2_orivax', 'p2', 0, 400)])).toBe(3);
    expect(combatShoutFires([bm('d2_orivax', 'p2', 0, 400, { golden: true })])).toBe(5);
    const r = simulate([bm('alley', 'p0', 1, 30), bm('ryme', 'p1', 1, 1), bm('d2_orivax', 'p2', 0, 400)], [bm('cryptwolf', 'e0', 5, 60)],
      makeRng(0xd0c5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 3 }));
    expect(r.events.filter((e) => e.type === 'shout').length).toBe(3);
  });

  it('COMBAT: ADDS to the run-wide Shout extras (1 + Choir 1 + Orivax 2 = 4, never multiplied)', () => {
    expect(combatShoutFires([bm('d2_orivax', 'p2', 0, 400)], { shoutExtraAlways: 1 })).toBe(4);
  });

  it('COMBAT: an enemy Orivax multiplies the enemy\'s Shouts, never yours', () => {
    expect(combatShoutFires([], {})).toBe(1);
    const r = simulate([bm('alley', 'p0', 1, 30), bm('ryme', 'p1', 1, 1)], [bm('cryptwolf', 'e0', 5, 60), bm('d2_orivax', 'e1', 0, 400)],
      makeRng(0xd0c5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 3 }));
    expect(r.playerShoutFires ?? 0).toBe(1);
  });
});

// ── snapshot fidelity + determinism ───────────────────────────────────────────────────────────────────────

describe('Elderhorn / Orivax — served boards and determinism', () => {
  it('a SNAPSHOT carries the aura with the body: a served Elderhorn doubles the served Beast Echo', () => {
    const run: RunState = {
      ...createRun(7), phase: 'recruit', embers: 0, shop: [], tier: 6, hand: [],
      board: [bc('b', 'stray', { attack: 1, health: 1 }), bc('e', 'b2_elderhorn', { attack: 0, health: 400 })],
    };
    const snap = snapshotBoard(run);
    expect(snap.minions.map((m) => m.cardId)).toContain('b2_elderhorn');
    const enemy = sideFromSnapshot(snap, 6, []);
    expect(enemy.beastHuntExtra ?? 0).toBe(0); // the aura comes from the board, not a run mode
    // The served side fights with the Elderhorn body on its board: its Beast Echo doubles.
    const served = snap.minions.map((m) => (m.cardId === 'stray' ? { ...m, cardId: 'eo_echobeast', attack: 0, health: 1 } : m));
    const r = simulate([bm('sandbag', 'W', 5, 400)], served, makeRng(3), CARDS, combatSide({ tier: 1 }), enemy);
    expect(r.events.filter((e) => e.type === 'summon').length).toBe(2);
  });

  it('is deterministic: the same seed reproduces the same event log', () => {
    const run = (): CombatResult => simulate(
      [bm('alley', 'p0', 1, 30), bm('ryme', 'p1', 1, 1), bm('d2_orivax', 'p2', 3, 40), bm('eo_echobeast', 'p3', 2, 3), bm('b2_elderhorn', 'p4', 4, 40)],
      [bm('cryptwolf', 'e0', 5, 60), bm('eo_echobeast', 'e1', 2, 2), bm('b2_elderhorn', 'e2', 3, 30)],
      makeRng(77), CARDS, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    expect(JSON.stringify(run().events)).toBe(JSON.stringify(run().events));
  });
});
