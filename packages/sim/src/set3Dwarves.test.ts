import { describe, it, expect } from 'vitest';
import { combatSide, damageMeterOf, damageMeterReading, makeRng, simulate, type BoardMinion } from '@game/core';
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
    // Through Kringle: its ends are Kneel and Brunni, and Kringle is the REPEAT form (owner 2026-09-22,
    // R-REPEAT-01) — the base tick plus one per card, 2 cards → 3 ticks — so Kneel pays once per TICK.
    let t = run({
      board: [body('k', 'dw3_kneel'), body('kr', 'dw_foreman'), body('b', 'dw_brunni')],
      hand: [body('p1', 'wo_mine', { tribe: 'neutral', attack: 0, health: 1 }), body('p2', 'wo_mine', { tribe: 'neutral', attack: 0, health: 1 })],
    });
    t = act(t, { type: 'play', uid: 'p1' });
    t = act(t, { type: 'play', uid: 'p2' });
    t = act(t, { type: 'faceOmen' });
    expect(at(t, 'b').attack).toBe(3 + 3);
    expect(at(t, 'k').health, 'Kringle: +2 from its own ticks ×3, +2 Kneel per tick ×3').toBe(6 + 3 * 2 + 3 * 2);
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

describe('Han Gover — "Pummel (40): Get a Dwarven Ale. (Max 5 per combat.)" (owner handoff 2026-09-18; Pummel keyword 2026-09-21; carry-over ruling later that day; cap 5 owner 2026-09-24)', () => {
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

  it('the card: T4 4/7 Dwarf/Undead, a passive marker capped at 5 per combat, both texts in the Pummel form (owner 2026-09-24)', () => {
    const d = CARD_INDEX['dw3_hangover']!;
    expect([d.tier, d.attack, d.health, d.tribe, d.tribe2]).toEqual([4, 4, 7, 'dwarf', 'undead']);
    expect(d.effects).toEqual([{ on: 'passive', do: 'dealtDamageAleMeter', params: { every: 40, count: 1, maxPerCombat: 5 } }]);
    expect(d.text).toBe('**Pummel (40):** Get a **Dwarven Ale**. (Max 5 per combat.)');
    expect(d.goldenText).toBe('**Pummel (40):** Get **2 Dwarven Ales**. (Max 5 per combat.)');
    expect(d.text).not.toContain('Max 2 per hit');
  });

  it('the meter is declared in core with its threshold only (every 40): no per-combat reset flag (the carry-over ruling 2026-09-21 retired it)', () => {
    expect(damageMeterOf(CARD_INDEX['dw3_hangover'])).toEqual({ do: 'dealtDamageAleMeter', every: 40 });
  });

  it('39 damage → nothing; the tally still carries back (the shop reads 39/40 and banks toward the next fight)', () => {
    // 13 Attack into three 0/13 sandbags: three clean kills, 39 damage dealt, no multiple crossed.
    const r = fight([gover({ attack: 13 })], [foe(0, 13), foe(0, 13), foe(0, 13)]);
    expect(alesGranted(r)).toEqual([]);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 39 }]);
    let s = run({ phase: 'combat', board: [body('hg', 'dw3_hangover')], hand: [], lastCombat: r });
    s = act(s, { type: 'settleCombat' });
    expect(at(s, 'hg').damageDealt).toBe(39);
    expect(damageMeterReading(at(s, 'hg').damageDealt!, damageMeterOf(CARD_INDEX['dw3_hangover'])!)).toEqual({ current: 39, total: 40 });
  });

  it('40 damage → ONE Ale, flown to hand mid-fight (a `toHand` from Han Gover) and landed at settle; the run card keeps 40 (reads 0/40)', () => {
    const r = fight([gover({ attack: 20 })], [foe(0, 20), foe(0, 20)]);
    expect(alesGranted(r).length).toBe(1);
    expect(toHandFromGover(r).length).toBe(1);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 40 }]);
    // The real settle: the Ale is in the hand and the meter PERSISTS on the run card.
    let s = run({ phase: 'combat', board: [body('hg', 'dw3_hangover')], hand: [], lastCombat: r });
    s = act(s, { type: 'settleCombat' });
    expect(s.hand.filter((c) => ALES.includes(c.cardId)).length).toBe(1);
    expect(at(s, 'hg').damageDealt).toBe(40);
    expect(damageMeterReading(at(s, 'hg').damageDealt!, damageMeterOf(CARD_INDEX['dw3_hangover'])!), 'a crossing lands on 0/40').toEqual({ current: 0, total: 40 });
  });

  it('overkill counts: a 20-Attack swing into a 1-Health body is 20 damage dealt', () => {
    const r = fight([gover({ attack: 20 })], [foe(0, 1), foe(0, 1)]);
    expect(alesGranted(r).length).toBe(1);
  });

  it('MAX 5 PER COMBAT: 80 damage in one fight (40 + 40) pays TWO Ales, one per crossing; the tally reaches 80', () => {
    const r = fight([gover({ attack: 40 })], [foe(0, 40), foe(0, 40)]);
    expect(alesGranted(r).length).toBe(2);
    expect(toHandFromGover(r).length).toBe(2);
    expect(r.events.filter((e) => e.type === 'pummelTrigger').length, 'one trigger per payout').toBe(2);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 80 }]);
  });

  it('MAX 5 PER COMBAT: seven 40-damage hits pay FIVE Ales, and no 6th (the extra crossings are spent, the tally still reaches 280)', () => {
    const r = fight([gover({ attack: 40 })], Array.from({ length: 7 }, () => foe(0, 40)));
    expect(alesGranted(r).length).toBe(5);
    expect(r.events.filter((e) => e.type === 'pummelTrigger').length).toBe(5);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 280 }]);
    // One enormous hit that crosses 6 multiples (240) pays the cap, 5, not 6.
    expect(alesGranted(fight([gover({ attack: 240 })], [foe(0, 1)])).length).toBe(5);
    // A fresh combat re-arms the cap: seeded at 280, another 40 pays again.
    expect(alesGranted(fight([gover({ attack: 40, damageDealt: 280 })], [foe(0, 1)])).length).toBe(1);
  });

  it('one enormous hit pays once PER multiple crossed (85 → two Ales, 120 → three); the next payout waits for 160', () => {
    const r = fight([gover({ attack: 85 })], [foe(0, 1)]);
    expect(alesGranted(r).length).toBe(2);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 85 }]);
    const r120 = fight([gover({ attack: 120 })], [foe(0, 1)]);
    expect(alesGranted(r120).length).toBe(3);
    expect(r120.playerDamageMeters, 'the meter advanced by the FULL 120').toEqual([{ sourceUid: 'hg', total: 120 }]);
    // Next combat, seeded at 120: 39 more (159) crosses nothing; 40 more (160) pays.
    expect(alesGranted(fight([gover({ attack: 39, damageDealt: 120 })], [foe(0, 1)]))).toEqual([]);
    const r160 = fight([gover({ attack: 40, damageDealt: 120 })], [foe(0, 1)]);
    expect(alesGranted(r160).length).toBe(1);
    expect(r160.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 160 }]);
  });

  it('GILDED: each Pummel pays TWO Ales, and nothing else doubles (the cap still counts payouts, not Ales)', () => {
    const r = fight([gover({ attack: 20, golden: true })], [foe(0, 20), foe(0, 20)]);
    expect(alesGranted(r).length).toBe(2);
    expect(toHandFromGover(r).length).toBe(2);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 40 }]);
    expect(fight([gover({ attack: 85, golden: true })], [foe(0, 1)]).playerHandGrants?.filter((id) => ALES.includes(id)).length, 'two crossings × 2 Ales').toBe(4);
  });

  it('CARRY-OVER: the tally persists ACROSS combats, seeded from the run card exactly as the reducer seeds it: 30 then 13 → 43 (one Ale), then 39 → 82 (a second Ale)', () => {
    // Fight one: seeded at 30, deals 13 → 43, crosses 40 once.
    const r1 = fight([gover({ attack: 13, damageDealt: 30 })], [foe(0, 13)]);
    expect(r1.initial.player[0]!.damageDealt, 'the seed is on the combat body').toBe(30);
    expect(alesGranted(r1).length).toBe(1);
    let s = run({ phase: 'combat', board: [body('hg', 'dw3_hangover', { damageDealt: 30 })], hand: [], lastCombat: r1 });
    s = act(s, { type: 'settleCombat' });
    expect(at(s, 'hg').damageDealt).toBe(43);
    expect(s.hand.filter((c) => ALES.includes(c.cardId)).length).toBe(1);
    // Fight two, seeded from the run card: 43 + 39 = 82, crosses 80 once — a fresh combat re-arms the latch.
    const r2 = fight([gover({ attack: 13, damageDealt: at(s, 'hg').damageDealt })], [foe(0, 13), foe(0, 13), foe(0, 13)]);
    expect(alesGranted(r2).length).toBe(1);
    expect(r2.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 82 }]);
    s = act({ ...s, phase: 'combat', lastCombat: r2, combatSettled: false } as RunState, { type: 'settleCombat' });
    expect(at(s, 'hg').damageDealt).toBe(82);
    expect(s.hand.filter((c) => ALES.includes(c.cardId)).length, 'two Ales across the two combats').toBe(2);
  });

  it('CARRY-OVER: 30 in fight one (no pay) banks toward fight two: 9 more (39) still nothing, 13 more (43) pays', () => {
    const r1 = fight([gover({ attack: 30 })], [foe(0, 30)]);
    expect(alesGranted(r1)).toEqual([]);
    let s = run({ phase: 'combat', board: [body('hg', 'dw3_hangover')], hand: [], lastCombat: r1 });
    s = act(s, { type: 'settleCombat' });
    expect(at(s, 'hg').damageDealt).toBe(30);
    expect(alesGranted(fight([gover({ attack: 9, damageDealt: at(s, 'hg').damageDealt })], [foe(0, 9)]))).toEqual([]);
    expect(alesGranted(fight([gover({ attack: 13, damageDealt: at(s, 'hg').damageDealt })], [foe(0, 13)])).length).toBe(1);
  });

  it('the badge reads progress toward the NEXT payout (owner rule 2026-09-19, reaffirmed 2026-09-21): 47 dealt → 7/40 in the shop; no clamp at 40/40; 33 more → fires', () => {
    const meter = damageMeterOf(CARD_INDEX['dw3_hangover'])!;
    const r1 = fight([gover({ attack: 47 })], [foe(0, 1)]);
    expect(alesGranted(r1).length).toBe(1);
    let s = run({ phase: 'combat', board: [body('hg', 'dw3_hangover')], hand: [], lastCombat: r1 });
    s = act(s, { type: 'settleCombat' });
    expect(at(s, 'hg').damageDealt).toBe(47);
    expect(damageMeterReading(at(s, 'hg').damageDealt!, meter)).toEqual({ current: 7, total: 40 });
    expect(damageMeterReading(27, meter)).toEqual({ current: 27, total: 40 });
    expect(damageMeterReading(40, meter), 'a crossing lands on 0/40').toEqual({ current: 0, total: 40 });
    expect(damageMeterReading(85, meter), 'never clamped at 40/40 — live progress toward the multiple that pays next combat').toEqual({ current: 5, total: 40 });
    expect(damageMeterReading(0, meter)).toEqual({ current: 0, total: 40 });
    const r2 = fight([gover({ attack: 33, damageDealt: at(s, 'hg').damageDealt })], [foe(0, 1)]);
    expect(alesGranted(r2).length).toBe(1);
    expect(r2.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 80 }]);
  });

  it('the per-combat count survives a Rise: the tally rides through the Rise on the same instance', () => {
    // 40 Attack, 1 Health, Rise: the first clash lands 40 (pays) and kills it; it rises at its printed 4 Attack and
    // lands more before the second foe finishes it. No second Ale: the latch rode through the Rise.
    const r = fight([gover({ attack: 40, health: 1, keywords: ['R'] })], [foe(1, 40), foe(1, 100)]);
    expect(alesGranted(r).length).toBe(1);
    expect(r.events.some((e) => e.type === 'death' && e.target === r.initial.player[0]!.uid && (e as { rise?: boolean }).rise)).toBe(true);
    const dealt = r.events.filter((e) => e.type === 'dmg' && e.source === r.initial.player[0]!.uid).reduce((n, e) => n + (e as { amount: number }).amount, 0);
    expect(dealt, 'the risen body kept counting on the same instance').toBeGreaterThan(40);
    expect(r.playerDamageMeters, 'the run card outlives the combat death: the whole tally carries back').toEqual([{ sourceUid: 'hg', total: dealt }]);
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
    const r = fight([gover({ attack: 1, damageDealt: snapshotBoard(s).minions[0]!.damageDealt })], [foe(0, 1)]);
    expect(alesGranted(r).length, '39 + 1 crosses 40').toBe(1);
  });

  it('a triple keeps the highest meter of the merged copies', () => {
    let s = run({ board: [body('a', 'dw3_hangover', { damageDealt: 12 }), body('b', 'dw3_hangover', { damageDealt: 33 })], hand: [body('c', 'dw3_hangover')] });
    s = act(s, { type: 'play', uid: 'c' });
    const g = [...s.board, ...s.hand].find((c) => c.cardId === 'dw3_hangover' && c.golden)!;
    expect(g.damageDealt).toBe(33);
  });
});
