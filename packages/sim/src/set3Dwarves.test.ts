import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EQUIPMENT_INDEX, SETS, poolFor } from '@game/content';
import { createRun, reduce, equipmentUsesLeft, type Action, type BoardCard, type RunState } from './index';
import { snapshotBoard } from './snapshot';

/**
 * SET 3 — DWARVES (owner roster 2026-09-09). Eight new cards; the fourteen carried-over set-2 Dwarves are
 * pinned by `set3Scaffold.test.ts` and exercised by `set2Dwarves.test.ts` (same definitions).
 *
 * These assert the MECHANICS, and specifically the owner's rulings from the roster review:
 *  - Shift Broker: ANY sold minion, any tribe.
 *  - Striker: any-tribe neighbours, Kringle's counter, its own play counts.
 *  - Hank Pepe: three random OTHER Dwarves on the board; never on his own arrival, never himself.
 *  - Tromboneer: Gold next turn, NOT capped, both phases.
 *  - Kneel / Tankerchief: shop AND combat, board only, per Dwarf, own gain excluded, no watcher ping-pong.
 *  - Pourman's Keg: a real Ale cast (Edward doubles it). Thymepiece (reworked 2026-09-12): all cards cost 1
 *    less Gold for the next 8 clock-seconds — the full contract lives in `thymepiece.test.ts`.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;

describe('the roster', () => {
  it('every new Dwarf is a set-3 card, and Dwarf is a set-3 tribe', () => {
    const ids = ['dw3_shiftbroker', 'dw3_striker', 'dw3_pourman', 'dw3_hankpepe', 'dw3_tromboneer', 'dw3_kneel', 'dw3_thymes', 'dw3_tankerchief', 'dw3_hangover'];
    const pool = poolFor('set3');
    for (const id of ids) expect(pool.buyable.some((c) => c.id === id), id).toBe(true);
    expect(SETS.set3.tribes).toContain('dwarf');
    // …and none of them leaked into set 2 — new set-3 cards live in set-3 files only.
    for (const id of ids) expect(poolFor('set2').all.some((c) => c.id === id), id + ' leaked into set 2').toBe(false);
  });

  it('the Keg and the Thymepiece resolve as Equipment, named by their sources', () => {
    expect(EQUIPMENT_INDEX['pourmans_keg']?.baseCost).toBe(1);
    expect(EQUIPMENT_INDEX['thymepiece']?.baseCost).toBe(3);
  });
});

describe('Shift Broker — when you sell a minion, gain +1 Attack', () => {
  it('fires for ANY sold minion, any tribe, and stacks per sale', () => {
    let s = run({ board: [body('sb', 'dw3_shiftbroker'), body('d', 'dw_brunni'), body('n', 'e3_frank')] });
    s = act(s, { type: 'sell', uid: 'd' });
    expect(at(s, 'sb').attack).toBe(2);
    s = act(s, { type: 'sell', uid: 'n' }); // a neutral counts too
    expect(at(s, 'sb').attack).toBe(3);
  });
  it('golden gains +2, and selling the Broker itself is a clean no-op', () => {
    let s = run({ board: [body('sb', 'dw3_shiftbroker', { golden: true }), body('d', 'dw_brunni')] });
    s = act(s, { type: 'sell', uid: 'd' });
    expect(at(s, 'sb').attack).toBe(3);
    s = act(s, { type: 'sell', uid: 'sb' });
    expect(s.board.length).toBe(0);
  });
});

describe('Striker — End of Turn: adjacent minions +1 Attack per card played', () => {
  it('buffs BOTH neighbours (any tribe) by the full played count, its own play included', () => {
    let s = run({
      board: [body('l', 'e3_frank'), body('r', 'dw_brunni')],
      hand: [body('st', 'dw3_striker'), body('sp', 'growth', { tribe: 'neutral', attack: 0, health: 1 })],
    });
    s = act(s, { type: 'play', uid: 'st', toIndex: 1 }); // sits between l and r
    s = act(s, { type: 'play', uid: 'sp' }); // a spell counts as a card played
    expect(s.playedThisTurn?.length).toBe(2);
    const l0 = at(s, 'l').attack;
    const r0 = at(s, 'r').attack;
    s = act(s, { type: 'faceOmen' });
    expect(at(s, 'l').attack - l0, 'left neighbour (neutral)').toBe(2);
    expect(at(s, 'r').attack - r0, 'right neighbour (Dwarf)').toBe(2);
    expect(at(s, 'st').attack, 'never itself (Growth gave it +1, Striker gave it nothing)').toBe(3 + 1); // Striker 3/3 since 2026-09-18
    expect(at(s, 'st').buffs?.some((b) => b.source === 'Striker')).toBeFalsy();
  });
  it('REPEATS per card played as separate instances — Kneel pays once per card (owner 2026-09-09)', () => {
    // Kneel sits beside Striker: each of the 3 waves lifts Kneel's Attack (own gain — excluded) and Brunni's
    // (a Dwarf gaining Attack → Kneel +2 Health). Three waves, three separate triggers: +6 Health, not +2.
    let s = run({
      board: [body('k', 'dw3_kneel'), body('st', 'dw3_striker'), body('b', 'dw_brunni')],
      hand: [body('p1', 'wo_mine', { tribe: 'neutral', attack: 0, health: 1 }), body('p2', 'wo_mine', { tribe: 'neutral', attack: 0, health: 1 }), body('p3', 'wo_mine', { tribe: 'neutral', attack: 0, health: 1 })],
    });
    s = act(s, { type: 'play', uid: 'p1' });
    s = act(s, { type: 'play', uid: 'p2' });
    s = act(s, { type: 'play', uid: 'p3' });
    expect(s.playedThisTurn?.length).toBe(3);
    s = act(s, { type: 'faceOmen' });
    expect(at(s, 'b').attack).toBe(3 + 3);
    expect(at(s, 'k').attack).toBe(4 + 3);
    expect(at(s, 'k').health, 'one Kneel trigger per wave').toBe(6 + 3 * 2);
    // The same three waves through Kringle: its ends are Kneel and Brunni, so Kneel again pays once per wave.
    let t = run({
      board: [body('k', 'dw3_kneel'), body('kr', 'dw_foreman'), body('b', 'dw_brunni')],
      hand: [body('p1', 'wo_mine', { tribe: 'neutral', attack: 0, health: 1 }), body('p2', 'wo_mine', { tribe: 'neutral', attack: 0, health: 1 })],
    });
    t = act(t, { type: 'play', uid: 'p1' });
    t = act(t, { type: 'play', uid: 'p2' });
    t = act(t, { type: 'faceOmen' });
    expect(at(t, 'b').attack).toBe(3 + 2);
    expect(at(t, 'k').health, 'Kringle: +2 from its own waves ×2, +2 Kneel per wave ×2').toBe(6 + 2 * 2 + 2 * 2);
  });
  it('does nothing when nothing was played', () => {
    let s = run({ board: [body('l', 'e3_frank'), body('st', 'dw3_striker'), body('r', 'dw_brunni')] });
    const l0 = at(s, 'l').attack;
    s = act(s, { type: 'faceOmen' });
    expect(at(s, 'l').attack).toBe(l0);
  });
});

describe("Pourman's Keg — cast a random Dwarven Ale", () => {
  const armed = (golden = false, extra: BoardCard[] = []): RunState =>
    act(run({ board: extra, hand: [body('p', 'dw3_pourman', { golden })] }), { type: 'play', uid: 'p', toIndex: 0 });

  it('playing Pourman grants the Keg; using it costs 1 Gold, an allowance, and casts ONE real Ale', () => {
    const s = armed();
    expect(s.equipment?.available.some((g) => g.equipmentId === 'pourmans_keg')).toBe(true);
    const uses = equipmentUsesLeft(s);
    const t = act(s, { type: 'activateEquipment' });
    // Golden Ale pays 2 Gold back, so the cost is asserted net of the Ale that was poured.
    expect(t.embers).toBe(s.embers - 1 + (t.lastSpellCastId === 'wo_mine' ? 2 : 0));
    expect(equipmentUsesLeft(t)).toBe(uses - 1);
    expect(t.alesCastThisTurn ?? 0, 'it is a genuine Ale cast').toBe(1);
    expect(t.playedThisTurn?.length ?? 0, 'but never a card PLAYED').toBe(s.playedThisTurn?.length ?? 0);
    expect(t.rngCursor, 'the pick is seeded').not.toBe(s.rngCursor);
  });
  it('stamps the Ale it poured onto the use cue, so the UI can play that Ale\'s cast presentation', () => {
    const t = act(armed(), { type: 'activateEquipment' });
    const use = (t.equipFx ?? []).find((c) => c.kind === 'use');
    expect(use?.spellIds).toEqual([t.lastSpellCastId]);
    const two = act(armed(true), { type: 'activateEquipment' });
    expect((two.equipFx ?? []).find((c) => c.kind === 'use')?.spellIds?.length, 'Gilded: two pours, two cues').toBe(2);
  });
  it('is one of the five Ales, and it is deterministic for a seed', () => {
    const a = act(armed(), { type: 'activateEquipment' });
    const b = act(armed(), { type: 'activateEquipment' });
    expect(a.lastSpellCastId).toBe(b.lastSpellCastId);
    expect(['wo_mine', 'wo_reinforcement', 'wo_champion', 'wo_health', 'wo_attack']).toContain(a.lastSpellCastId);
  });
  it('Edward Keg-hands doubles the pour, exactly as a hand-cast Ale', () => {
    const t = act(armed(false, [body('ed', 'dw_edward')]), { type: 'activateEquipment' });
    expect(t.alesCastThisTurn ?? 0).toBe(2);
  });
  it('a Gilded Pourman pours two', () => {
    const t = act(armed(true), { type: 'activateEquipment' });
    expect(t.alesCastThisTurn ?? 0).toBe(2);
  });
});

describe('Hank Pepe — when you play a Dwarf, give 3 other Dwarves +1/+1', () => {
  it('buffs exactly three OTHER Dwarves, never Hank, and the arriving Dwarf is eligible', () => {
    let s = run({
      // Distinct Dwarves on purpose — three of a kind would triple into one golden body before Hank looks.
      board: [body('h', 'dw3_hankpepe'), body('a', 'dw_brunni'), body('b', 'dw_coinfire'), body('c', 'dw_pimm'), body('n', 'e3_frank')],
      hand: [body('d', 'dw_gangplank')],
    });
    s = act(s, { type: 'play', uid: 'd' });
    const buffed = s.board.filter((c) => c.buffs?.some((b) => b.source === 'Hank Pepe'));
    expect(buffed.length).toBe(3);
    expect(buffed.some((c) => c.uid === 'h'), 'never himself').toBe(false);
    expect(buffed.some((c) => c.uid === 'n'), 'never a non-Dwarf').toBe(false);
    for (const c of buffed) expect(c.buffs!.find((b) => b.source === 'Hank Pepe')).toMatchObject({ attack: 1, health: 1 });
    expect(at(s, 'h').attack).toBe(2);
  });
  it('does not fire on his own arrival, nor for a non-Dwarf play', () => {
    let s = run({ board: [body('a', 'dw_brunni'), body('b', 'dw_coinfire')], hand: [body('h', 'dw3_hankpepe'), body('n', 'e3_frank')] });
    s = act(s, { type: 'play', uid: 'h' });
    s = act(s, { type: 'play', uid: 'n' });
    expect(s.board.some((c) => c.buffs?.some((b) => b.source === 'Hank Pepe'))).toBe(false);
  });
  it('is seeded, and buffs fewer than three if fewer are there', () => {
    let s = run({ board: [body('h', 'dw3_hankpepe')], hand: [body('d', 'dw_brunni')] });
    const before = s.rngCursor;
    s = act(s, { type: 'play', uid: 'd' });
    expect(at(s, 'd').attack).toBe(CARD_INDEX['dw_brunni']!.attack + 1);
    expect(s.rngCursor).not.toBe(before);
  });
});

describe('Kneel / Tankerchief — when a Dwarf gains Attack', () => {
  // Warhorn Captain's Shout: "give your other Dwarves +3 Attack" — one action that lifts every Dwarf at once.
  const shout = (board: BoardCard[]): RunState =>
    act(run({ board, hand: [body('cap', 'dw_ironlung')] }), { type: 'play', uid: 'cap' });

  it('SHOP: pays once PER Dwarf that gained, excludes its own gain, and never re-fires off a watcher grant', () => {
    const s = shout([body('k', 'dw3_kneel'), body('t', 'dw3_tankerchief'), body('b', 'dw_brunni'), body('c', 'dw_coinfire')]);
    // Four Dwarves gained +3 (the Captain is new, not a gain). Kneel fires for the other three: +6 Health.
    expect(at(s, 'k').attack).toBe(4 + 3);
    expect(at(s, 'k').health).toBe(6 + 3 * 2);
    // Tankerchief fires for the other three: +3/+12 — and its own +3 from those grants is NOT a fresh gain, so
    // Kneel does not pay a fourth time and nothing loops.
    expect(at(s, 't').attack).toBe(8 + 3 + 3);
    expect(at(s, 't').health).toBe(14 + 3 * 4);
  });
  it('SHOP: two Tankerchiefs settle — each pays for the other exactly once, no ping-pong', () => {
    const s = shout([body('t1', 'dw3_tankerchief'), body('t2', 'dw3_tankerchief')]);
    expect(at(s, 't1').attack).toBe(8 + 3 + 1);
    expect(at(s, 't1').health).toBe(14 + 4);
    expect(at(s, 't2').attack).toBe(8 + 3 + 1);
    expect(at(s, 't2').health).toBe(14 + 4);
  });
  it('SHOP: ignores a non-Dwarf gaining Attack, and a watcher in HAND never pays', () => {
    let s = run({ board: [body('k', 'dw3_kneel'), body('n', 'e3_frank')], hand: [body('k2', 'dw3_kneel'), body('sp', 'growth', { tribe: 'neutral', attack: 0, health: 1 })] });
    // Growth is untargeted board-wide (+1/+1 to your minions): Frank gains Attack (not a Dwarf), Kneel gains
    // Attack (its OWN gain — excluded). So Kneel gets Growth's +1/+1 and nothing from itself.
    s = act(s, { type: 'play', uid: 'sp' });
    expect(at(s, 'k').health).toBe(6 + 1);
    expect(s.hand.find((c) => c.uid === 'k2')!.health, 'hand copy untouched').toBe(6);
  });
  it('golden Kneel gains +4 Health per Dwarf', () => {
    const s = shout([body('k', 'dw3_kneel', { golden: true, attack: 8, health: 12 }), body('b', 'dw_brunni')]);
    expect(at(s, 'k').health).toBe(12 + 4);
  });

  // ── COMBAT: Lieutenant Thane's Rally gives its Attack to 2 other friendly minions — two gains in one swing.
  const foe = (attack: number, health: number): BoardMinion =>
    ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
  const mine = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
    const d = CARD_INDEX[cardId]!;
    return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
  };
  const fight = (board: BoardMinion[], foes: BoardMinion[]) =>
    simulate(board, foes, makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));
  /** Self-sourced buff events (a watcher paying itself): `source === target`. */
  const selfBuffs = (r: { events: readonly { type: string }[] }, attack: number, health: number) =>
    r.events.filter((e) => e.type === 'buff')
      .map((e) => e as unknown as { target: string; source: string; attack: number; health: number })
      .filter((e) => e.source === e.target && e.attack === attack && e.health === health);

  it('COMBAT: a Thane Rally that lifts two Dwarves pays Kneel per Dwarf — excluding its own gain', () => {
    // Harmless foes (0 Attack) so nobody dies before Thane's Rally lifts Kneel and Brunni. Kneel pays once
    // (for Brunni) — its own +9 is excluded.
    const r = fight([mine('dw_thane'), mine('dw3_kneel'), mine('dw_brunni')], [foe(0, 1), foe(0, 1), foe(0, 1)]);
    expect(selfBuffs(r, 0, 2).length).toBe(1);
  });
  it('COMBAT: two Tankerchiefs pay each other exactly once and the fight terminates', () => {
    const r = fight([mine('dw_thane'), mine('dw3_tankerchief'), mine('dw3_tankerchief')], [foe(0, 1), foe(0, 1), foe(0, 1)]);
    expect(selfBuffs(r, 1, 4).length).toBe(2);
  });
  it('COMBAT: an ENEMY Dwarf gaining Attack does not pay a friendly watcher', () => {
    const r = fight([mine('dw3_kneel')], [mine('dw_thane', { attack: 1 }), mine('dw_brunni'), mine('dw_brunni')]);
    expect(selfBuffs(r, 0, 2).length).toBe(0);
  });
});

describe('Tromboneer — Echo: gain 3 Gold next turn', () => {
  const foe = (attack: number, health: number): BoardMinion =>
    ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
  const mine = (cardId: string, golden = false): BoardMinion => {
    const d = CARD_INDEX[cardId]!;
    return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden } as unknown as BoardMinion;
  };
  const fight = (board: BoardMinion[], foes: BoardMinion[]) =>
    simulate(board, foes, makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));

  it('COMBAT: its death carries 3 Gold back (6 golden), two of them 6', () => {
    expect(fight([mine('dw3_tromboneer')], [foe(20, 20)]).playerBonusGold).toBe(3);
    expect(fight([mine('dw3_tromboneer', true)], [foe(20, 20)]).playerBonusGold).toBe(6);
    expect(fight([mine('dw3_tromboneer'), mine('dw3_tromboneer')], [foe(20, 20)]).playerBonusGold).toBe(6);
  });
  it('the bank lands ON TOP of the 10-Gold cap next turn', () => {
    let s = run({ board: [], hand: [], maxEmbers: 10, bonusEmbersNextTurn: 3 });
    s = act(s, { type: 'faceOmen' });
    s = act(s, { type: 'settleCombat' });
    s = act(s, { type: 'resolveCombat' });
    expect(s.embers).toBeGreaterThanOrEqual(13);
    expect(s.bonusEmbersNextTurn ?? 0, 'spent — next turn only').toBe(0);
  });
});

describe('Thymepiece — all cards cost 1 less Gold for the next 8 seconds (owner rework 2026-09-12)', () => {
  const armed = (golden = false): RunState =>
    act(run({ hand: [body('th', 'dw3_thymes', { golden })] }), { type: 'play', uid: 'th', toIndex: 0 });

  it('opens a −1 window (−2 gilded) anchored 8 seconds below the clock reading it was activated at, for 3 Gold', () => {
    const s = armed();
    const t = act(s, { type: 'activateEquipment', clockSeconds: 40 });
    expect(t.embers).toBe(s.embers - 3);
    expect(t.cardDiscountWindow).toEqual({ amount: 1, untilClock: 32 });
    expect(act(armed(true), { type: 'activateEquipment', clockSeconds: 40 }).cardDiscountWindow).toEqual({ amount: 2, untilClock: 32 });
  });
  it('an extra trigger never stacks the amount — the window is a rate, not a bank', () => {
    let s = { ...armed(), equipmentExtraTriggers: 1 } as RunState; // "triggers an additional time"
    s = act(s, { type: 'activateEquipment', clockSeconds: 40 });
    expect(s.cardDiscountWindow).toEqual({ amount: 1, untilClock: 32 });
  });
  it('the window never survives the turn flip', () => {
    let s = run({ board: [], hand: [], cardDiscountWindow: { amount: 1, untilClock: 10 } });
    s = act(s, { type: 'faceOmen' });
    expect(s.cardDiscountWindow, 'closed on combat entry').toBeUndefined();
    s = act(s, { type: 'settleCombat' });
    s = act(s, { type: 'resolveCombat' });
    expect(s.cardDiscountWindow).toBeUndefined();
  });
});

describe('Han Gover — "When this deals 40 damage, get an Ale" (owner handoff 2026-09-18)', () => {
  const ALES = ['wo_mine', 'wo_reinforcement', 'wo_champion', 'wo_health', 'wo_attack'];
  const foe = (attack: number, health: number, keywords: string[] = []): BoardMinion =>
    ({ cardId: 'sandbag', attack, health, keywords } as unknown as BoardMinion);
  const gover = (over: Partial<BoardMinion> = {}): BoardMinion => {
    const d = CARD_INDEX['dw3_hangover']!;
    return { cardId: 'dw3_hangover', attack: d.attack, health: d.health, keywords: [], sourceUid: 'hg', ...over } as unknown as BoardMinion;
  };
  const fight = (board: BoardMinion[], foes: BoardMinion[]) =>
    simulate(board, foes, makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));
  const alesGranted = (r: ReturnType<typeof fight>) => (r.playerHandGrants ?? []).filter((id) => ALES.includes(id));
  const toHandFromGover = (r: ReturnType<typeof fight>) =>
    r.events.filter((e) => e.type === 'toHand' && (e as { source?: string }).source === r.initial.player[0]!.uid);

  it('the card: T4 4/7 Dwarf/Undead, a passive marker, both texts', () => {
    const d = CARD_INDEX['dw3_hangover']!;
    expect([d.tier, d.attack, d.health, d.tribe, d.tribe2]).toEqual([4, 4, 7, 'dwarf', 'undead']);
    expect(d.effects).toEqual([{ on: 'passive', do: 'dealtDamageAleMeter', params: { every: 40, count: 1 } }]);
    expect(d.text).toContain('40 damage');
    expect(d.goldenText).toContain('2 Ales');
  });

  it('39 damage → nothing; the tally still carries back', () => {
    // 13 Attack into three 0/13 sandbags: three clean kills, 39 damage dealt, no threshold crossed.
    const r = fight([gover({ attack: 13 })], [foe(0, 13), foe(0, 13), foe(0, 13)]);
    expect(alesGranted(r)).toEqual([]);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 39 }]);
  });

  it('40 damage → ONE Ale, flown to hand mid-fight (a `toHand` from Han Gover) and landed at settle', () => {
    const r = fight([gover({ attack: 20 })], [foe(0, 20), foe(0, 20)]);
    expect(alesGranted(r).length).toBe(1);
    expect(toHandFromGover(r).length).toBe(1);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 40 }]);
    // The real settle: the Ale is in the hand and the meter persists on the run card.
    let s = run({ phase: 'combat', board: [body('hg', 'dw3_hangover')], hand: [], lastCombat: r });
    s = act(s, { type: 'settleCombat' });
    expect(s.hand.filter((c) => ALES.includes(c.cardId)).length).toBe(1);
    expect(at(s, 'hg').damageDealt).toBe(40);
  });

  it('overkill counts: a 20-Attack swing into a 1-Health body is 20 damage dealt', () => {
    const r = fight([gover({ attack: 20 })], [foe(0, 1), foe(0, 1)]);
    expect(alesGranted(r).length).toBe(1);
  });

  it('GILDED: each crossing pays TWO Ales, and nothing else doubles', () => {
    const r = fight([gover({ attack: 20, golden: true })], [foe(0, 20), foe(0, 20)]);
    expect(alesGranted(r).length).toBe(2);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 40 }]);
  });

  it('the tally persists ACROSS combats: 43 after fight one (one Ale), 82 after fight two (a second Ale)', () => {
    // Fight one: seeded at 30, deals 13 → 43, crosses 40 once.
    const r1 = fight([gover({ attack: 13, damageDealt: 30 })], [foe(0, 13)]);
    expect(alesGranted(r1).length).toBe(1);
    let s = run({ phase: 'combat', board: [body('hg', 'dw3_hangover', { damageDealt: 30 })], hand: [], lastCombat: r1 });
    s = act(s, { type: 'settleCombat' });
    expect(at(s, 'hg').damageDealt).toBe(43);
    expect(s.hand.filter((c) => ALES.includes(c.cardId)).length).toBe(1);
    // Fight two, seeded from the run card exactly as the reducer seeds it: 43 + 39 = 82, crosses 80 once.
    const r2 = fight([gover({ attack: 13, damageDealt: at(s, 'hg').damageDealt })], [foe(0, 13), foe(0, 13), foe(0, 13)]);
    expect(alesGranted(r2).length).toBe(1);
    expect(r2.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 82 }]);
    s = act({ ...s, phase: 'combat', lastCombat: r2, combatSettled: false } as RunState, { type: 'settleCombat' });
    expect(at(s, 'hg').damageDealt).toBe(82);
    expect(s.hand.filter((c) => ALES.includes(c.cardId)).length, 'two Ales across the two combats').toBe(2);
  });

  it('one enormous hit can cross two thresholds and pays both', () => {
    const r = fight([gover({ attack: 85 })], [foe(0, 1)]);
    expect(alesGranted(r).length).toBe(2);
  });

  it('"(Max 2 per hit)" (owner 2026-09-19): a 120-damage hit crosses three thresholds but pays 2 Ales, not 3', () => {
    const d = CARD_INDEX['dw3_hangover']!;
    expect(d.text).toContain('(Max 2 per hit)');
    expect(d.goldenText).toContain('(Max 2 per hit)');
    const r = fight([gover({ attack: 120 })], [foe(0, 1)]);
    expect(alesGranted(r).length).toBe(2);
    expect(toHandFromGover(r).length).toBe(2);
    // The meter still advanced by the FULL 120 — the third crossing is spent, not banked.
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 120 }]);
  });

  it('…and the next 40 pays again: after a capped 120 hit (meter 120), a 40 hit crosses 160 and pays 1', () => {
    const r = fight([gover({ attack: 40, damageDealt: 120 })], [foe(0, 1)]);
    expect(alesGranted(r).length).toBe(1);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 160 }]);
  });

  it('GILDED under the cap: one crossing pays its 2; a second crossing in the SAME hit pays nothing more', () => {
    const r = fight([gover({ attack: 85, golden: true })], [foe(0, 1)]);
    expect(alesGranted(r).length).toBe(2);
  });

  it('a hit that never lands (a Ward) adds nothing', () => {
    // First swing pops the Ward (0 damage dealt), the second kills: 40 dealt in total — one Ale, not two.
    const r = fight([gover({ attack: 40 })], [foe(0, 40, ['DS'])]);
    expect(alesGranted(r).length).toBe(1);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 40 }]);
  });

  it('a snapshot (served board) carries the meter, so a served Han Gover pays out from its real total', () => {
    const s = run({ board: [body('hg', 'dw3_hangover', { damageDealt: 39 })] });
    expect(snapshotBoard(s).minions[0]!.damageDealt).toBe(39);
  });

  it('a triple keeps the highest meter of the merged copies', () => {
    let s = run({ board: [body('a', 'dw3_hangover', { damageDealt: 12 }), body('b', 'dw3_hangover', { damageDealt: 33 })], hand: [body('c', 'dw3_hangover')] });
    s = act(s, { type: 'play', uid: 'c' });
    const g = [...s.board, ...s.hand].find((c) => c.cardId === 'dw3_hangover' && c.golden)!;
    expect(g.damageDealt).toBe(33);
  });
});
