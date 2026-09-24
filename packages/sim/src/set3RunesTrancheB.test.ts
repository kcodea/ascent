import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type EffectDef } from '@game/core';
import { BLOODPOT, CARD_INDEX, EPIC_RUNES, EQUIPMENT_INDEX, RUNES, RUNE_INDEX, RUNE_DUP_SWEETENER, TITAN_HAMMER } from '@game/content';
import {
  CONFIG, createRun, reduce, createStarform, destroyStarform, hasStarform, starformOf, starformStats, buffStarform,
  starformConsumeShopMinion, starformConsumeTimes, collapseHits, equipmentCostOf, equipmentState, equipmentPermanentlyAmplified, equipmentWillAmplify, ENDLESS_MARCH_TOKEN,
  type Action, type BoardCard, type RunState,
} from './index';
import { castSpell, fireEquipmentTriggers, makeContext } from './recruit';

/**
 * SET 3 BATCH 2 — TRANCHE B (owner sheet 2026-09-16): the Starform / Equipment / Undead runes. Every rune is
 * bought through the REAL Runeforge path (`buyRune`) and its effect driven through `reduce` wherever an action
 * exists; the exported engine helpers otherwise. Each block pins: the effect fires with the printed value, the
 * once-per-turn guard holds where the text says "first … each turn", and the badge (`runeProcs`) burst.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a);
/** A set-3 recruit run at the Runesmith's forge, with `id` on offer; buys it through the real path. */
const armed = (id: string, over: Partial<RunState> = {}): RunState => act(
  { ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set3'), tribes: ['celestial', 'undead', 'kobold', 'dwarf', 'spirit'], wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...over } as RunState,
  { type: 'buyRune', index: 0 },
);
/** Open one shop slot (buy the first offer) so a created Starform starts as a plain 1/1 (+ the rune). */
const openSlot = (s: RunState): RunState => act(s, { type: 'buy', uid: s.shop[0]!.uid });
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const procs = (s: RunState, id: string): number => s.runeProcs?.[id] ?? 0;
const nextTurn = (s: RunState): RunState => {
  const settled = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
  const next = act(settled, { type: 'resolveCombat' });
  expect(next.phase).toBe('recruit');
  return next;
};
const SRC = { cardId: 'dbg', name: 'probe' };

// ── probes ──────────────────────────────────────────────────────────────────────────────────────────────
const CEL: CardDef = { id: 'dbg_tb_cel', name: 'Celestial (probe)', tribe: 'celestial', tier: 1, attack: 1, health: 20, keywords: [], effects: [], text: '' };
const CEL2: CardDef = { ...CEL, id: 'dbg_tb_cel2', name: 'Celestial B (probe)' };
const CEL3: CardDef = { ...CEL, id: 'dbg_tb_cel3', name: 'Celestial C (probe)' };
const UNDEAD2: CardDef = { id: 'dbg_tb_undead', name: 'Undead (probe)', tribe: 'undead', tier: 1, attack: 2, health: 2, keywords: [], effects: [], text: '' };
const STAT_SPELL: CardDef = { id: 'dbg_tb_fortify', name: 'Fortify (probe)', tribe: 'neutral', tier: 1, attack: 0, health: 0, keywords: [], spell: true, target: 'friendly', cost: 1,
  effects: [{ on: 'cast', do: 'spellBuffTarget', params: { attack: 2, health: 3 } }], text: 'Give a friendly minion +2/+3.' };
for (const c of [CEL, CEL2, CEL3, UNDEAD2, STAT_SPELL]) CARD_INDEX[c.id] = c;

// ── the roster ──────────────────────────────────────────────────────────────────────────────────────────
const BASIC: [string, number][] = [
  ['rune_first_light', 4], ['rune_accretion', 5], ['rune_eventide', 4], ['rune_efficient_tooling', 3],
  ['rune_quick_release', 4], ['rune_resonant_arms', 5], ['rune_last_rites', 4], ['rune_crowded_crypt', 4],
];
const EPIC: [string, number][] = [
  ['rune_open_constellation', 6], ['rune_supernova', 6], ['rune_stolen_constellations', 6], ['rune_spellweaving', 3],
  ['rune_overcharge', 5], ['rune_dismantling', 4], ['rune_counterrotation', 5], ['rune_empty_hands', 4],
  ['rune_last_tool', 5], ['rune_endless_march', 5], ['rune_grave_orbit', 5],
];

describe('tranche B — the roster', () => {
  it('8 Basic in RUNES, 11 Epic in EPIC_RUNES, at the sheet costs, every one set-3 only', () => {
    for (const [id, cost] of BASIC) {
      const r = RUNE_INDEX[id]!;
      expect(RUNES.some((x) => x.id === id), `${id} lives in RUNES`).toBe(true);
      expect([r.cost, r.epic ?? false, r.sets], id).toEqual([cost, false, ['set3']]);
    }
    for (const [id, cost] of EPIC) {
      const r = RUNE_INDEX[id]!;
      // the Grave Orbit was ARCHIVED 2026-09-24 (owner rulings: "remove them") — out of EPIC_RUNES, into ARCHIVED_RUNES
      expect(EPIC_RUNES.some((x) => x.id === id), `${id} lives in EPIC_RUNES`).toBe(id !== 'rune_grave_orbit');
      // the Grave Orbit CUT FROM SET 3 2026-09-24 (owner): offered in no set
      expect([r.cost, r.epic, r.sets], id).toEqual([cost, true, id === 'rune_grave_orbit' ? [] : ['set3']]);
    }
  });
  it('tribe-gates exactly the runes whose text names a tribe on the board', () => {
    const gate = (id: string) => RUNE_INDEX[id]!.tribes;
    for (const id of ['rune_first_light', 'rune_accretion', 'rune_eventide', 'rune_open_constellation', 'rune_supernova', 'rune_stolen_constellations', 'rune_spellweaving']) expect(gate(id), id).toEqual(['celestial']);
    for (const id of ['rune_last_rites', 'rune_endless_march']) expect(gate(id), id).toEqual(['undead']);
    expect(gate('rune_grave_orbit')).toEqual(['undead', 'celestial']);
    for (const id of ['rune_efficient_tooling', 'rune_quick_release', 'rune_resonant_arms', 'rune_crowded_crypt', 'rune_overcharge', 'rune_dismantling', 'rune_counterrotation', 'rune_empty_hands', 'rune_last_tool']) expect(gate(id), id).toBeUndefined();
  });
  it('the three idempotent runes pay the duplicate sweetener; the Skeleton token exists out of every pool', () => {
    for (const id of ['rune_supernova', 'rune_last_tool', 'rune_quick_release']) expect(RUNE_DUP_SWEETENER.has(id), id).toBe(true);
    expect(CARD_INDEX['u3_skeleton']).toMatchObject({ name: 'Skeleton', tribe: 'undead', attack: 1, health: 1, token: true });
    expect(createRun(1).pool['u3_skeleton']).toBeUndefined();
  });
});

// ── Starform runes ──────────────────────────────────────────────────────────────────────────────────────
describe('Rune of First Light', () => {
  it('creates a Starform on purchase that starts +8/+8, and re-seeds one at Start of Turn when none is out', () => {
    const s0 = openSlot({ ...createRun(3, 'runesmith'), setId: 'set3', wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: ['rune_first_light'] } as RunState);
    const s = act(s0, { type: 'buyRune', index: 0 });
    expect(hasStarform(s)).toBe(true);
    expect(starformStats(s)).toEqual({ attack: 9, health: 9 }); // 1/1 + 8/+8
    expect(procs(s, 'rune_first_light')).toBe(1);
    // Every LATER creation carries it too (any creator).
    destroyStarform(s);
    createStarform(s, SRC);
    expect(starformStats(s)).toEqual({ attack: 9, health: 9 });
    // Start of Turn: none out → one is created (a full row eats its right-most minion, so only the floor is pinned).
    destroyStarform(s);
    const next = nextTurn(s);
    expect(hasStarform(next)).toBe(true);
    expect(starformStats(next)!.attack).toBeGreaterThanOrEqual(9);
    // …and never a second one when one already stands.
    const again = nextTurn(next);
    expect(again.shop.filter((o) => o.starform)).toHaveLength(1);
  });
});

describe('Rune of Accretion', () => {
  it('the Starform eats Shop minions for TWICE their stats (×3 with a duplicate)', () => {
    const s = openSlot(armed('rune_accretion'));
    expect(starformConsumeTimes(s)).toBe(2);
    createStarform(s, SRC);
    const victim = s.shop.findIndex((o) => !o.starform && !CARD_INDEX[o.cardId]?.spell);
    const d = CARD_INDEX[s.shop[victim]!.cardId]!;
    expect(starformConsumeShopMinion(s, victim)).toBe(true);
    expect(starformStats(s)).toEqual({ attack: 1 + 2 * d.attack, health: 1 + 2 * d.health });
    expect(procs(s, 'rune_accretion')).toBe(1);
    expect(starformConsumeTimes({ ...s, runeStacks: { rune_accretion: 2 } } as RunState)).toBe(3);
  });
});

describe('Rune of Eventide', () => {
  // Owner rework 2026-09-18: the 2 random Shop spells are gone — only the +1/+1 spell power remains, once per turn.
  it('the FIRST Consume or Collapse each turn gives Shop spells +1/+1 (no spells handed over); the second pays nothing', () => {
    let s = openSlot(armed('rune_eventide', { board: [body('c', CEL.id)] }));
    createStarform(s, SRC);
    const sf = starformOf(s)!;
    const handBefore = s.hand.length;
    s = act(s, { type: 'buy', uid: sf.uid }); // the buy = your left-most Celestial CONSUMES it
    expect(s.hand.length - handBefore, 'no spells are granted any more (2026-09-18)').toBe(0);
    expect(s.spellBonus).toEqual({ attack: 1, health: 1 });
    expect(procs(s, 'rune_eventide')).toBe(1);
    // A second exit this turn: nothing more.
    createStarform(s, SRC);
    s = act(s, { type: 'buy', uid: starformOf(s)!.uid });
    expect(s.spellBonus).toEqual({ attack: 1, health: 1 });
    expect(procs(s, 'rune_eventide')).toBe(1);
    // Next turn re-arms.
    expect(nextTurn(s).eventideUsedThisTurn).toBeUndefined();
  });
});

describe('Rune of the Open Constellation', () => {
  it('the first Consume each turn re-creates a Starform carrying the consumed stats; the second does not', () => {
    let s = openSlot(armed('rune_open_constellation', { board: [body('c', CEL.id)] }));
    createStarform(s, SRC);
    buffStarform(s, 4, 6, 'probe'); // 5/7
    s = act(s, { type: 'buy', uid: starformOf(s)!.uid });
    expect(at(s, 'c').attack).toBe(1 + 5); // the Celestial ate the whole token…
    expect(hasStarform(s), '…and a new one stands').toBe(true);
    expect(starformStats(s)).toEqual({ attack: 5, health: 7 });
    expect(procs(s, 'rune_open_constellation')).toBe(1);
    s = act(s, { type: 'buy', uid: starformOf(s)!.uid });
    expect(hasStarform(s), 'the second Consume this turn re-creates nothing').toBe(false);
  });
});

describe('Rune of the Supernova', () => {
  it('a Collapse hits EVERY friendly Celestial instead of two', () => {
    const s = armed('rune_supernova', { board: [body('a', CEL.id), body('b', CEL2.id), body('c', CEL3.id), body('n', 'e3_frank')] });
    const hits = collapseHits(s, 2, 0);
    expect(hits.map((c) => c.uid)).toEqual(['a', 'b', 'c']);
    expect(collapseHits({ ...s, runeSupernova: undefined } as RunState, 2, 0)).toHaveLength(2);
  });
});

describe('Rune of Stolen Constellations', () => {
  it('every minion the Starform Consumes hands a plain copy to hand', () => {
    const s = openSlot(armed('rune_stolen_constellations'));
    createStarform(s, SRC);
    const victim = s.shop.findIndex((o) => !o.starform && !CARD_INDEX[o.cardId]?.spell);
    const id = s.shop[victim]!.cardId;
    const before = s.hand.length;
    expect(starformConsumeShopMinion(s, victim)).toBe(true);
    expect(s.hand.length).toBe(before + 1);
    expect(s.hand[s.hand.length - 1]).toMatchObject({ cardId: id, golden: false });
    expect(procs(s, 'rune_stolen_constellations')).toBe(1);
  });
});

describe('Rune of Spellweaving', () => {
  it('the first 3 stat-granting Shop spells each turn also feed the Starform what they granted; the 4th does not', () => {
    const s = openSlot(armed('rune_spellweaving', { board: [body('t', 'e3_frank')] }));
    createStarform(s, SRC);
    for (let i = 0; i < 4; i++) castSpell(s, STAT_SPELL, at(s, 't'));
    expect(at(s, 't').attack).toBe(3 + 4 * 2);
    expect(starformStats(s)).toEqual({ attack: 1 + 3 * 2, health: 1 + 3 * 3 });
    expect(procs(s, 'rune_spellweaving')).toBe(3);
    expect(s.spellweavingCastsThisTurn).toBe(3);
  });
});

// ── Equipment runes ─────────────────────────────────────────────────────────────────────────────────────
/** Frank (Bloodpot, 1 Gold, friendly) and the Sculptor (Titan Hammer, 3 Gold, friendly) in hand, ready to play. */
const smiths = (id: string, extra: Partial<RunState> = {}): RunState => {
  let s = armed(id, { hand: [body('f', 'e3_frank'), body('h', 'e3_sculptor')], board: [body('x', CEL.id)], ...extra });
  s = act(s, { type: 'play', uid: 'f', toIndex: 0 });
  s = act(s, { type: 'play', uid: 'h', toIndex: 0 });
  return s;
};
const select = (s: RunState, equipmentId: string): RunState => act(s, { type: 'selectEquipment', equipmentId });

describe('Rune of Efficient Tooling', () => {
  it('the first activation each turn costs 2 less (a 3-Gold Hammer is 1; a 1-Gold Bloodpot is 0), later ones full price', () => {
    let s = select(smiths('rune_efficient_tooling'), TITAN_HAMMER.id);
    expect(equipmentCostOf(s, TITAN_HAMMER)).toBe(1);
    expect(equipmentCostOf(s, BLOODPOT)).toBe(0);
    const gold = s.embers;
    s = act(s, { type: 'activateEquipment', targetUid: 'x' });
    expect(gold - s.embers).toBe(1);
    expect(procs(s, 'rune_efficient_tooling')).toBe(1);
    expect(equipmentCostOf(s, BLOODPOT), 'the second activation is full price').toBe(1);
    expect(equipmentCostOf(nextTurn(s), BLOODPOT), 'next turn re-arms').toBe(0);
  });
});

describe('Rune of Quick Release', () => {
  it('selling an Equip minion makes the next activation this turn cost 0, once', () => {
    let s = select(smiths('rune_quick_release'), TITAN_HAMMER.id);
    expect(equipmentCostOf(s, TITAN_HAMMER)).toBe(3);
    s = act(s, { type: 'sell', uid: 'f' });
    expect(s.quickReleaseArmed).toEqual({ excludeEquipmentId: BLOODPOT.id });
    expect(equipmentCostOf(s, TITAN_HAMMER)).toBe(0);
    const gold = s.embers;
    s = act(s, { type: 'activateEquipment', targetUid: 'x' });
    expect(s.embers).toBe(gold);
    expect(at(s, 'x').attack).toBe(50);
    expect(procs(s, 'rune_quick_release')).toBe(1);
    expect(s.quickReleaseArmed).toBeUndefined();
    expect(equipmentCostOf(select(s, BLOODPOT.id), BLOODPOT)).toBe(1);
  });
  // Owner 2026-09-18: "(Doesn't discount its own Equipment)" — the sold minion's own Equipment is never the free one.
  it("does NOT discount the sold minion's OWN Equipment, and activating it leaves the arm for another", () => {
    let s = smiths('rune_quick_release');
    s = act(s, { type: 'sell', uid: 'f' }); // Frank sold → its Bloodpot is excluded
    expect(equipmentCostOf(select(s, BLOODPOT.id), BLOODPOT), 'its own Equipment stays full price').toBe(1);
    expect(equipmentCostOf(select(s, TITAN_HAMMER.id), TITAN_HAMMER), 'another Equipment is free').toBe(0);
    const gold = s.embers;
    s = act(select(s, BLOODPOT.id), { type: 'activateEquipment', targetUid: 'x' });
    expect(gold - s.embers, 'the Bloodpot cost its 1 Gold').toBe(1);
    expect(procs(s, 'rune_quick_release'), 'the badge did not burst for its own Equipment').toBe(0);
    expect(s.quickReleaseArmed, 'the arm survives an own-Equipment activation').toEqual({ excludeEquipmentId: BLOODPOT.id });
    s = act(select(s, TITAN_HAMMER.id), { type: 'activateEquipment', targetUid: 'x' });
    expect(s.embers, 'the Hammer was the free one').toBe(gold - 1);
    expect(procs(s, 'rune_quick_release')).toBe(1);
    expect(s.quickReleaseArmed).toBeUndefined();
  });
});

describe('Rune of Resonant Arms', () => {
  it('every third Equipment TRIGGER gives your minions +8/+5 (repeats count), keeping the remainder', () => {
    const s = smiths('rune_resonant_arms');
    expect(s.runeResonantArms).toEqual({ per: 3, attack: 8, health: 5, tick: 0 });
    const a0 = at(s, 'x').attack, h0 = at(s, 'x').health;
    fireEquipmentTriggers(s, BLOODPOT, 'plain', at(s, 'f'), at(s, 'x'), 2); // 2 triggers: banked
    expect(procs(s, 'rune_resonant_arms')).toBe(0);
    fireEquipmentTriggers(s, BLOODPOT, 'plain', at(s, 'f'), at(s, 'x'), 2); // trigger 3 pays, 4 banks
    expect(procs(s, 'rune_resonant_arms')).toBe(1);
    expect(s.runeResonantArms!.tick).toBe(1);
    expect([at(s, 'x').attack - a0, at(s, 'x').health - h0]).toEqual([4 * 3 + 8, 4 * 3 + 5]);
    expect(at(s, 'h').buffs?.some((b) => b.source === 'Rune of Resonant Arms')).toBe(true);
  });
});

describe('Rune of Overcharge', () => {
  it('the first activation each turn is free and spends no charge; the second pays and spends', () => {
    let s = select(smiths('rune_overcharge'), TITAN_HAMMER.id);
    expect(equipmentCostOf(s, TITAN_HAMMER)).toBe(0);
    const gold = s.embers;
    s = act(s, { type: 'activateEquipment', targetUid: 'x' });
    expect(s.embers).toBe(gold);
    expect(equipmentState(s).available.find((g) => g.equipmentId === TITAN_HAMMER.id)!.ownChargeSpent).toBe(false);
    expect(procs(s, 'rune_overcharge')).toBe(1);
    expect(equipmentCostOf(s, TITAN_HAMMER)).toBe(3);
    s = act(s, { type: 'activateEquipment', targetUid: 'x' });
    expect(gold - s.embers).toBe(3);
    expect(equipmentState(s).available.find((g) => g.equipmentId === TITAN_HAMMER.id)!.ownChargeSpent).toBe(true);
  });
});

describe('Rune of Dismantling', () => {
  // Owner 2026-09-18: the per-turn cap is gone — EVERY Equip minion sold fires, and every fire stamps its own cue.
  it('EVERY Equip minion sold fires its Equipment free at a random OTHER friendly minion, each with its own use cue', () => {
    let s = smiths('rune_dismantling');
    const gold = s.embers;
    s = act(s, { type: 'sell', uid: 'f' }); // Frank → Bloodpot +3/+3 on the Sculptor or the Celestial
    const frankName = CARD_INDEX['e3_frank']!.name; // an Equipment buff is itemised under its SOURCE body's name
    const hit = s.board.find((c) => c.uid !== 'f' && c.buffs?.some((b) => b.source === frankName && b.attack === 3 && b.health === 3));
    expect(hit).toBeDefined();
    expect(s.embers - gold, 'the sale paid and the Equipment cost nothing').toBe(1);
    expect(procs(s, 'rune_dismantling')).toBe(1);
    expect(equipmentState(s).available.find((g) => g.equipmentId === BLOODPOT.id)!.ownChargeSpent, 'no charge spent').toBe(false);
    const cue1 = (s.equipFx ?? []).find((f) => f.kind === 'use');
    expect(cue1, 'the fire stamped a use cue').toMatchObject({ uid: 'f', equipmentId: BLOODPOT.id, targetUid: hit!.uid });
    const seq1 = s.equipFxSeq;
    s = act(s, { type: 'sell', uid: 'h' }); // the Sculptor: the SECOND sale fires too (no cap)
    expect(at(s, 'x').attack, 'the Hammer landed on the one body left').toBeGreaterThanOrEqual(50);
    expect(procs(s, 'rune_dismantling')).toBe(2);
    const cue2 = (s.equipFx ?? []).find((f) => f.kind === 'use');
    expect(cue2, 'the second fire stamped its own cue').toMatchObject({ uid: 'h', equipmentId: TITAN_HAMMER.id, targetUid: 'x' });
    expect(s.equipFxSeq, 'a fresh FX sequence for the second fire').not.toBe(seq1);
  });
});

describe('Rune of Counterrotation', () => {
  it('after activating 3 different Equipment they all trigger again, then the set resets', () => {
    let s = smiths('rune_counterrotation', { hand: [body('f', 'e3_frank'), body('h', 'e3_sculptor'), body('k', 'k3_blastsurveyor')] });
    s = act(s, { type: 'play', uid: 'k', toIndex: 0 });
    s = act(select(s, BLOODPOT.id), { type: 'activateEquipment', targetUid: 'x' });
    s = act(select(s, TITAN_HAMMER.id), { type: 'activateEquipment', targetUid: 'x' });
    expect(s.counterrotationIds).toEqual([BLOODPOT.id, TITAN_HAMMER.id]);
    expect(procs(s, 'rune_counterrotation')).toBe(0);
    s = act(select(s, 'blast_pump'), { type: 'activateEquipment' });
    expect(procs(s, 'rune_counterrotation')).toBe(1);
    expect(s.counterrotationIds).toEqual([]);
    const bloodpots = s.board.flatMap((c) => (c.buffs ?? []).filter((b) => b.source === CARD_INDEX['e3_frank']!.name && b.attack === 3));
    expect(bloodpots.length, 'Bloodpot fired twice — the activation and the re-fire').toBe(2);
  });
});

describe('Rune of Empty Hands', () => {
  it('Discovers an Equip minion; that CARD\'s Equipment costs 0 for the run', () => {
    let s = armed('rune_empty_hands');
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.effects.some((e) => e.on === 'equip'), id).toBe(true);
    const pick = s.discover![0]!;
    s = act(s, { type: 'discover', index: 0 });
    expect(s.equipmentFreeCards).toEqual([pick]);
    expect(procs(s, 'rune_empty_hands')).toBe(1);
    const taken = s.hand.find((c) => c.cardId === pick)!;
    s = act(s, { type: 'play', uid: taken.uid, toIndex: 0 });
    const eq = s.equipment!.available[0]!;
    expect(equipmentCostOf(s, EQUIPMENT_INDEX[eq.equipmentId]!)).toBe(0);
    // …and PERMANENTLY Amplified (owner 2026-09-18): read as Amplified with no stack banked.
    expect(s.equipmentAmplifiedCards).toEqual([pick]);
    expect(equipmentPermanentlyAmplified(s, eq.equipmentId)).toBe(true);
    expect(equipmentWillAmplify(s, eq.equipmentId)).toBe(true);
    expect(equipmentState(s).amplified?.[eq.equipmentId], 'no per-id stack — it is permanent').toBeUndefined();
    // Sold and re-granted later (a fresh body of the same card) — still 0 and still Amplified.
    s = act(s, { type: 'sell', uid: taken.uid });
    s = act({ ...s, hand: [...s.hand, body('again', pick)] } as RunState, { type: 'play', uid: 'again', toIndex: 0 });
    expect(equipmentCostOf(s, EQUIPMENT_INDEX[eq.equipmentId]!)).toBe(0);
    expect(equipmentWillAmplify(s, eq.equipmentId)).toBe(true);
  });
  it('the permanent Amplification doubles EVERY activation and is never spent', () => {
    // Frank's Bloodpot (+3/+3 on a friendly) stamped as an Empty Hands pick by hand: the same run fields the pick writes.
    let s = smiths('rune_efficient_tooling', { equipmentFreeCards: ['e3_frank'], equipmentAmplifiedCards: ['e3_frank'] });
    s = select(s, BLOODPOT.id);
    expect(equipmentWillAmplify(s, BLOODPOT.id)).toBe(true);
    s = act(s, { type: 'activateEquipment', targetUid: 'x' });
    expect(at(s, 'x').attack, 'two triggers: +3 twice').toBe(1 + 6);
    expect(equipmentWillAmplify(s, BLOODPOT.id), 'still Amplified after the activation').toBe(true);
    // A fresh charge (as the next turn's rebuild grants): doubled again — nothing was spent.
    equipmentState(s).available.find((g) => g.equipmentId === BLOODPOT.id)!.ownChargeSpent = false;
    s = act(select(s, BLOODPOT.id), { type: 'activateEquipment', targetUid: 'x' });
    expect(at(s, 'x').attack).toBe(1 + 12);
  });
});
describe('Rune of the Last Tool', () => {
  it('grafts the Echo onto every Equip minion; a shop Echo banks the Equipment free for NEXT turn', () => {
    // Robinson is an UNDEAD Equip minion (Coffin Flop) — the Deathfibrillator only aims at Undead.
    let s = smiths('rune_last_tool', { hand: [body('f', 'e3_frank'), body('h', 'e3_sculptor'), body('r', 'u3_robinson'), body('e', 'u3_ems')] });
    expect(at(s, 'f').grantedEffects?.some((e) => e.do === 'deathrattleEquipmentFreeNextTurn')).toBe(true);
    expect(at(s, 'x').grantedEffects ?? [], 'a non-Equip body carries nothing').toEqual([]);
    s = act(s, { type: 'play', uid: 'r', toIndex: 0 });
    s = act(s, { type: 'play', uid: 'e', toIndex: 0 }); // the Deathfibrillator: Rise + destroy a friendly Undead
    const coffin = EQUIPMENT_INDEX['coffin_flop']!;
    s = act(select(s, 'deathfibrillator'), { type: 'activateEquipment', targetUid: 'r' });
    s = act(s, { type: 'resolveShopDeath' });
    expect(s.equipmentFreeNextTurn).toEqual([coffin.id]);
    expect(procs(s, 'rune_last_tool')).toBe(1);
    expect(equipmentCostOf(s, coffin), 'this turn still pays').toBe(coffin.baseCost);
    const next = nextTurn(s);
    // The fight in between may kill the other Equip bodies — their COMBAT Echoes bank too — so the promoted list
    // CONTAINS the shop bank rather than equalling it.
    expect(next.equipmentFreeThisTurn).toContain(coffin.id);
    expect(next.equipmentFreeNextTurn).toBeUndefined();
    if (next.board.some((c) => c.cardId === 'u3_robinson')) expect(equipmentCostOf(next, coffin)).toBe(0);
  });
  it('in combat the graft is a real Echo: its questTrigger carry-back names the Equipment', () => {
    const frank: BoardMinion = { cardId: 'e3_frank', attack: 1, health: 1, sourceUid: 'f', keywords: [], grantedEffects: [{ on: 'onDeath', do: 'deathrattleEquipmentFreeNextTurn', params: {} }] };
    const r = simulate([frank], [{ cardId: 'sandbag', attack: 50, health: 50 }], makeRng(7), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(r.events.some((e) => e.type === 'questTrigger' && e.flag === 'runeLastTool' && e.side === 'player' && e.srcCard === 'e3_frank')).toBe(true);
  });
});

// ── Undead runes ────────────────────────────────────────────────────────────────────────────────────────
describe('Rune of Last Rites', () => {
  it('the first Undead destroyed in the Shop each turn returns a plain copy to hand; the second does not', () => {
    let s = armed('rune_last_rites', { board: [body('p', 'u3_poochy', { attack: 9, keywords: ['T'] }), body('q', UNDEAD2.id)], hand: [body('e', 'u3_ems')] });
    s = act(s, { type: 'play', uid: 'e', toIndex: 0 });
    s = act(select(s, 'deathfibrillator'), { type: 'activateEquipment', targetUid: 'p' });
    s = act(s, { type: 'resolveShopDeath' });
    const copy = s.hand.find((c) => c.cardId === 'u3_poochy');
    expect(copy, 'a plain copy came to hand').toBeTruthy();
    expect([copy!.attack, copy!.golden], 'the PRINTED card, not the 9-Attack body').toEqual([CARD_INDEX['u3_poochy']!.attack, false]);
    expect(procs(s, 'rune_last_rites')).toBe(1);
    // Next turn, the second Undead: the latch re-armed — but this turn a second destroy pays nothing.
    s = { ...s, equipment: { ...s.equipment!, available: s.equipment!.available.map((g) => ({ ...g, ownChargeSpent: false })) } } as RunState;
    s = act(select(s, 'deathfibrillator'), { type: 'activateEquipment', targetUid: 'q' });
    s = act(s, { type: 'resolveShopDeath' });
    expect(s.hand.filter((c) => c.cardId === UNDEAD2.id)).toHaveLength(0);
    expect(procs(s, 'rune_last_rites')).toBe(1);
  });
});

describe('Rune of the Crowded Crypt', () => {
  it('arms the combat flag at +1 and pays +1/+1 TWICE on a shop overflow', () => {
    // Seven DISTINCT bodies — three of a kind would gild into one (checkTriples) and shrink the board.
    const ids = [CEL.id, CEL2.id, CEL3.id, UNDEAD2.id, 'e3_frank', 'e3_sculptor', 'k3_blastsurveyor'];
    const full = ids.map((id, i) => body(`b${i}`, id, { attack: 1, health: 20 }));
    const s = armed('rune_crowded_crypt', { board: full });
    expect(s.questFlags?.runeOverflow).toBe(1);
    expect(s.runeCrowdedCrypt).toEqual({ attack: 1, health: 1, times: 2 });
    makeContext(s).summon(CARD_INDEX['u3_skeleton']!, '');
    expect(s.board).toHaveLength(7);
    for (const c of s.board) expect([c.attack, c.health]).toEqual([1 + 2, 20 + 2]);
    expect(procs(s, 'rune_crowded_crypt')).toBe(1);
  });
});

describe('Rune of the Endless March', () => {
  // Owner 2026-09-18: the Rise now summons a SPEAR WARDEN (the set-1 card, `knit`) instead of a 1/1 Skeleton.
  it('SHOP: a friendly Undead that Rises summons a Spear Warden beside it', () => {
    let s = armed('rune_endless_march', { board: [body('p', 'u3_poochy', { keywords: ['T'] })], hand: [body('e', 'u3_ems')] });
    expect(at(s, 'p').grantedEffects?.some((e) => e.do === 'onRiseSelfSummonToken')).toBe(true);
    s = act(s, { type: 'play', uid: 'e', toIndex: 0 });
    s = act(select(s, 'deathfibrillator'), { type: 'activateEquipment', targetUid: 'p' });
    s = act(s, { type: 'resolveShopDeath' });
    const risen = s.board.find((c) => c.cardId === 'u3_poochy')!;
    expect(risen.grantedEffects?.some((e) => e.do === 'onRiseSelfSummonToken'), 'the risen body is re-grafted').toBe(true);
    expect(risen.grantedEffects?.find((e) => e.do === 'onRiseSelfSummonToken')?.params?.tokenId).toBe(ENDLESS_MARCH_TOKEN);
    expect(ENDLESS_MARCH_TOKEN).toBe('knit');
    expect(s.board.filter((c) => c.cardId === 'u3_skeleton'), 'no Skeleton any more').toHaveLength(0);
    const warden = s.board.filter((c) => c.cardId === 'knit');
    expect(warden).toHaveLength(1);
    expect(warden[0]!.attack).toBe(CARD_INDEX['knit']!.attack);
    expect(warden[0]!.health).toBe(CARD_INDEX['knit']!.health);
    expect(s.board.indexOf(warden[0]!), 'beside the riser').toBe(s.board.indexOf(risen) + 1);
    expect(procs(s, 'rune_endless_march')).toBe(1);
  });
  it('COMBAT: the riser itself summons the Spear Warden after its Rise; its neighbours stay quiet', () => {
    const graft: EffectDef[] = [{ on: 'onRise', do: 'onRiseSelfSummonToken', params: { tokenId: ENDLESS_MARCH_TOKEN, count: 1 } }];
    const pup: BoardMinion = { cardId: 'u3_poochy', attack: 1, health: 1, sourceUid: 'p', keywords: ['R'], grantedEffects: graft };
    const other: BoardMinion = { cardId: 'u3_poochy', attack: 0, health: 40, sourceUid: 'o', keywords: [], grantedEffects: graft };
    const r = simulate([pup, other], [{ cardId: 'sandbag', attack: 5, health: 3 }], makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes: ['undead'] }), combatSide({ tier: 1 }));
    const reborn = r.events.findIndex((e) => e.type === 'reborn');
    expect(reborn, 'the Pup rose').toBeGreaterThanOrEqual(0);
    const wardens = r.events.filter((e, i) => i > reborn && e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'knit');
    expect(wardens, 'exactly ONE Spear Warden — the riser answered, the other graft did not').toHaveLength(1);
  });
});

describe('Rune of the Grave Orbit', () => {
  it('after combat the Starform gains +15/+15 per friendly Undead that Rose (read off the reborn events)', () => {
    let s = armed('rune_grave_orbit', { board: Array.from({ length: 5 }, (_, i) => body(`p${i}`, 'u3_poochy')) });
    createStarform(s, SRC);
    const before = starformStats(s)!;
    s = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
    const rose = (s.lastCombat?.events ?? []).filter((e) => e.type === 'reborn').length;
    const after = starformStats(s)!;
    expect([after.attack - before.attack, after.health - before.health]).toEqual([15 * rose, 15 * rose]);
    expect(procs(s, 'rune_grave_orbit')).toBe(rose > 0 ? 1 : 0);
  });
});
