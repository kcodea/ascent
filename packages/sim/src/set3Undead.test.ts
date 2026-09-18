import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type SourceTriggerEvent } from '@game/core';
import { CARD_INDEX, EQUIPMENT_INDEX, SETS, poolFor } from '@game/content';
import { createRun, reduce, reduceWithPresentation, type Action, type BoardCard, type RunState } from './index';
import { displayedStatsOf, fireRecruitDeathrattlesForTest, fireSummonOverflow, spellAttackBonus, spellHealthBonus } from './recruit';

/**
 * SET 3 — UNDEAD (owner roster 2026-09-09). Eleven new cards; the eleven carried-over set-1 Undead are pinned by
 * `set3Scaffold.test.ts`. The rulings under test:
 *  - `onRise` fires in BOTH phases for a FRIENDLY Rise (never an enemy's); a shop Rise pays permanently.
 *  - Rising Tide: board (a combat gain) + hand (permanent, R-HAND-02). Revenant: Ward + stats, stacking.
 *  - Squatimus: overflow → your minions +3/+4 (owner stat pass 2026-09-18; was +2/+2) in both phases. Noggin: a random friendly Undead only.
 *  - Cage Breaker: the two-step destroy, then a Discover at the tavern tier. Coffin Flop: a real Discover.
 *  - Deathfibrillator: Rise then destroy → the body returns and the Rise watchers fire.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  // `tribes`: a Discover draws from the run's ACTIVE tribes, so the probe run must actually field Undead.
  // …and from the run's remaining POOL copies, which `createRun` sizes for the ACTIVE set — so seed set 3's.
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['undead', 'dwarf', 'kobold'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;

const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const hand = (uid: string, cardId: string) => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const fight = (mine: BoardMinion[], foes: BoardMinion[], handMinions: ReturnType<typeof hand>[] = []) =>
  simulate(mine, foes, makeRng(7), CARD_INDEX, combatSide({ tier: 6, handMinions, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));
const uidOf = (r: { initial: { player: { uid: string; cardId: string }[] } }, cardId: string) => r.initial.player.find((m) => m.cardId === cardId)!.uid;
const buffsOn = (r: { events: readonly CombatEvent[] }, target: string) =>
  r.events.filter((e) => e.type === 'buff' && (e as { target: string }).target === target) as unknown as { attack: number; health: number; source: string }[];

describe('the roster', () => {
  it('every new Undead is a set-3 card; Undead is a set-3 tribe; the set-1 re-specs landed', () => {
    const pool = poolFor('set3');
    for (const id of ['u3_poochy', 'u3_noggin', 'u3_robinson', 'u3_adeptus', 'u3_ems', 'u3_cagebreaker', 'u3_revenant', 'u3_risingtide', 'u3_squatimus', 'u3_rodrick', 'u3_hierophant', 'u3_bicyclebob']) {
      expect(pool.buyable.some((c) => c.id === id), id).toBe(true);
    }
    expect(SETS.set3.tribes).toContain('undead');
    expect([CARD_INDEX['deathswarmer']!.attack, CARD_INDEX['deathswarmer']!.health]).toEqual([0, 3]);
    expect([CARD_INDEX['mumi']!.tier, CARD_INDEX['mumi']!.attack, CARD_INDEX['mumi']!.health]).toEqual([3, 5, 2]);
    expect(CARD_INDEX['sergeant']!.name).toBe('Sergey');
    expect(CARD_INDEX['anubis']!.name).toBe('Anubis, Last Gate');
    expect(EQUIPMENT_INDEX['coffin_flop']?.baseCost).toBe(3); // 2 → 3, owner balance pass 2026-09-18
    expect(EQUIPMENT_INDEX['deathfibrillator']?.targetMode).toBe('friendly');
  });
});

describe('onRise — COMBAT: a friendly Rise wakes Revenant and Rising Tide', () => {
  it('Poochy Rises → Revenant gains Ward +7/+7, Rising Tide buffs the board AND the hand (permanent)', () => {
    // Poochy (Taunt, Rise) soaks the foe's swing, dies, returns. One friendly Rise.
    const r = fight([bm('u3_poochy'), bm('u3_revenant'), bm('u3_risingtide')], [foe(5, 60)], [hand('h1', 'dw_brunni')]);
    const rev = uidOf(r, 'u3_revenant');
    const tide = uidOf(r, 'u3_risingtide');
    expect(r.events.some((e) => e.type === 'reborn'), 'Poochy rose').toBe(true);
    expect(buffsOn(r, rev).some((b) => b.attack === 7 && b.health === 7 && b.source === rev), 'Revenant +7/+7 from itself').toBe(true);
    expect(r.events.some((e) => (e.type === 'shieldUp' || e.type === 'keyword') && (e as { target: string }).target === rev), 'Revenant gains Ward').toBe(true);
    expect(buffsOn(r, rev).some((b) => b.attack === 3 && b.health === 4 && b.source === tide), 'Rising Tide reaches the board').toBe(true); // +3/+4 since 2026-09-18
    expect(r.playerHandBuffs, 'Rising Tide reaches the HAND — permanently').toEqual([{ uid: 'h1', attack: 3, health: 4, source: tide }]);
  });
  it("an ENEMY Rise is not a friendly Rise — Revenant doesn't grow", () => {
    const r = fight([bm('u3_revenant')], [bm('u3_poochy')]);
    const rev = uidOf(r, 'u3_revenant');
    expect(r.events.some((e) => e.type === 'reborn'), 'the enemy Poochy rose').toBe(true);
    expect(buffsOn(r, rev).length).toBe(0);
  });
});

describe('onRise — SHOP: a Rise outside combat fires the watchers, and their payout is permanent', () => {
  it('Deathfibrillator on Poochy: Rise, destroy, return → Revenant + Rising Tide pay, board and hand alike', () => {
    let s = run({
      board: [body('p', 'u3_poochy', { keywords: ['T'] }), body('rev', 'u3_revenant'), body('tide', 'u3_risingtide')],
      hand: [body('ems', 'u3_ems'), body('h1', 'dw_brunni')],
    });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    expect(s.equipment?.available.some((g) => g.equipmentId === 'deathfibrillator')).toBe(true);
    s = act(s, { type: 'activateEquipment', targetUid: 'p' });
    expect(s.pendingDeath?.uid, 'marked for the two-step death').toBe('p');
    expect(at(s, 'p').keywords).toContain('R');
    s = act(s, { type: 'resolveShopDeath' });
    const risen = s.board.find((c) => c.cardId === 'u3_poochy')!;
    expect(risen.uid, 'a NEW body came back').not.toBe('p');
    expect((s.shopDeathFx ?? []).some((f) => f.kind === 'rise' && f.uid === risen.uid), 'the return is its own cue').toBe(true);
    expect(risen.health, 'back at 1 Health, then Rising Tide +4').toBe(1 + 4); // +3/+4 since 2026-09-18
    // Revenant: Ward + 7/7, attributed to itself — permanent (a shop buff is).
    expect(at(s, 'rev').keywords).toContain('DS');
    expect(at(s, 'rev').buffs?.find((b) => b.source === 'Revenant')).toMatchObject({ attack: 7, health: 7 });
    // Rising Tide: everyone on board (the risen Poochy included) and the hand.
    expect(at(s, 'rev').buffs?.find((b) => b.source === 'Rising Tide')).toMatchObject({ attack: 3, health: 4 });
    expect(risen.buffs?.find((b) => b.source === 'Rising Tide')).toMatchObject({ attack: 3, health: 4 });
    expect(s.hand.find((c) => c.uid === 'h1')!.buffs?.find((b) => b.source === 'Rising Tide')).toMatchObject({ attack: 3, health: 4 });
    expect(s.hand.find((c) => c.uid === 'h1')!.attack).toBe(CARD_INDEX['dw_brunni']!.attack + 3); // Rising Tide +3/+4 since 2026-09-18
  });
  it('the Rise is its OWN beat, after the death/Echo beat — the return never lands in the Echo commit', () => {
    let s = run({ board: [body('p', 'u3_poochy', { keywords: ['T'] }), body('rev', 'u3_revenant')], hand: [body('ems', 'u3_ems')] });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    s = act(s, { type: 'activateEquipment', targetUid: 'p' });
    const { batch, state: after } = reduceWithPresentation(s, { type: 'resolveShopDeath' }, true);
    const keys = batch!.events
      .filter((e) => (e as { type: string }).type === 'sourceTrigger')
      .map((e) => (e as SourceTriggerEvent).policyKey);
    const death = keys.indexOf('system:destroy:shopDeath');
    const rise = keys.indexOf('system:destroy:shopRise');
    expect(death, 'the death beat').toBeGreaterThanOrEqual(0);
    expect(rise, 'the rise beat').toBeGreaterThan(death);
    // Gameplay is identical with capture on and off.
    expect(JSON.stringify(after)).toBe(JSON.stringify(act(s, { type: 'resolveShopDeath' })));
  });
  it('stacks: two shop Rises pay Revenant twice', () => {
    let s = run({ board: [body('p', 'u3_poochy', { keywords: ['T'] }), body('rev', 'u3_revenant'), body('q', 'mumi', { keywords: ['R'] })], hand: [body('ems', 'u3_ems')] });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    s = act(s, { type: 'activateEquipment', targetUid: 'p' });
    s = act(s, { type: 'resolveShopDeath' });
    // Cage Breaker destroys the Rise-bearing Mumi: second Rise.
    s = { ...s, hand: [...s.hand, body('cb', 'u3_cagebreaker')], embers: 20 };
    s = act(s, { type: 'play', uid: 'cb' });
    s = act(s, { type: 'battlecryTarget', targetUid: 'q' });
    // The Discover opens with the play (Graverobber's ordering: the Shout's payoff belongs to the play); the
    // two-step death resolves once it is picked.
    s = act(s, { type: 'discover', index: 0 });
    s = act(s, { type: 'resolveShopDeath' });
    expect(at(s, 'rev').buffs?.find((b) => b.source === 'Revenant')).toMatchObject({ attack: 14, health: 14, count: 2 });
  });
});

describe("a friendly death in the shop reaches only the WATCHERS — never another body's own Echo", () => {
  it('Deathfibrillator on Spear Warden beside Footman Captain: no Footman (owner report 2026-09-09)', () => {
    let s = run({ board: [body('sw', 'knit'), body('cap', 'deathlesshand'), body('m', 'mumi')], hand: [body('ems', 'u3_ems')] });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    s = act(s, { type: 'activateEquipment', targetUid: 'sw' });
    s = act(s, { type: 'resolveShopDeath' });
    expect(s.board.some((c) => c.cardId === 'footman'), "Footman Captain's Echo stayed asleep").toBe(false);
    expect(s.board.filter((c) => c.cardId === 'knit').length, 'the Warden returned').toBe(1);
    expect(s.board.find((c) => c.cardId === 'mumi')!.keywords, "Mumi's Echo stayed asleep too").not.toContain('R');
    // …but the Warden DIED on the way out: the Spear Warden Aura grew by its +4/+2 (a shop destroy is a death —
    // "every Spear Warden that died this game", owner 2026-09-18).
    expect(s.cardBuffs?.['knit']).toEqual({ attack: 4, health: 2 });
  });
});

describe('a shop Rise returns the PRINTED body with the Auras on top (owner reports 2026-09-09)', () => {
  it('Sergey loses his accrued Echo grant; a Spear Warden comes back wearing its Aura and the Undead Aura', () => {
    let s = run({
      board: [body('sg', 'sergeant', { hpGrantBonus: 12, buffs: [{ source: 'Growth', attack: 3, health: 3, count: 1 }], attack: 9, health: 9 }), body('sw', 'knit'), body('ds', 'deathswarmer')],
      hand: [body('ems', 'u3_ems')],
      cardBuffs: { knit: { attack: 6, health: 4 } }, // the Spear Warden Aura, already grown twice
      undeadAttackBonus: 5, // the Undead Aura
    });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    s = act(s, { type: 'activateEquipment', targetUid: 'sg' });
    s = act(s, { type: 'resolveShopDeath' });
    const sergey = s.board.find((c) => c.cardId === 'sergeant')!;
    expect(sergey.hpGrantBonus, 'the Echo improvement is gone').toBeUndefined();
    expect(sergey.buffs, 'and the buffs').toBeUndefined();
    // Stored stats are the printed body at 1 Health; the Undead Aura is a DISPLAY fold (never stored), so the
    // card the player reads shows it on top — exactly as any fresh Undead does.
    expect([sergey.attack, sergey.health]).toEqual([CARD_INDEX['sergeant']!.attack, 1]);
    expect(displayedStatsOf(s, sergey).attack, 'the Undead Aura folds in on display').toBe(CARD_INDEX['sergeant']!.attack + 5);
    // The Warden: printed 4 + its own Aura (+6/+4 seeded, then +10/+6 after its shop DEATH grew it on the way out —
    // a shop destroy is a death, owner 2026-09-18) + the Undead Aura.
    s = { ...s, embers: 20, equipment: s.equipment ? { ...s.equipment, available: s.equipment.available.map((g) => ({ ...g, ownChargeSpent: false })) } : s.equipment };
    s = act(s, { type: 'activateEquipment', targetUid: 'sw' });
    s = act(s, { type: 'resolveShopDeath' });
    const warden = s.board.find((c) => c.cardId === 'knit')!;
    expect(warden.uid).not.toBe('sw');
    expect(warden.attack, 'printed 4 + its own Aura 10 (stored)').toBe(4 + 10);
    expect(warden.health).toBe(1 + (4 + 2));
    expect(displayedStatsOf(s, warden).attack, '+ the Undead Aura on display').toBe(4 + 10 + 5);
  });
});

describe('ECHO FIRST, THEN THE RISE ATTEMPTS (owner ruling 2026-09-18, reversing 2026-09-09) — Rodrick on a full board', () => {
  // Owner report 2026-09-18: a Deathfibrillated minion on a 7-body board "rises BEFORE its Echo triggers" — the
  // Rise took the freed slot and the Echo's summon overflowed. The law is now the other way round, in BOTH
  // phases and for ALL Rise/Echo interactions: the minion dies → its Echo fires (its summon takes the freed
  // slot) → THEN the minion attempts to Rise, and on a full board it is the RETURN that finds no room (an
  // overflow — Squatimus / Flowing Monk pay off on it — and the body stays dead).
  const six = ['u3_squatimus', 'dw_brunni', 'dw_coinfire', 'dw_pimm', 'e3_frank', 'u3_poochy'];
  it('SHOP (EMS / Deathfibrillator): the Spear Warden lands in the freed slot, Rodrick finds no room (Squatimus pays)', () => {
    // Grant the Equipment by playing EMS onto a 6-body board, which fills the 7th slot; then aim it at Rodrick.
    let s = run({ board: [body('rod', 'u3_rodrick'), ...six.slice(0, 5).map((id, i) => body(`b${i}`, id))], hand: [body('ems', 'u3_ems')] });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    expect(s.board.length).toBe(7);
    s = act(s, { type: 'activateEquipment', targetUid: 'rod' });
    s = act(s, { type: 'resolveShopDeath' });
    expect(s.board.length, 'still seven').toBe(7);
    expect(s.board.some((c) => c.cardId === 'knit'), "the Echo's Spear Warden took the freed slot").toBe(true);
    expect(s.board.some((c) => c.cardId === 'u3_rodrick'), 'Rodrick found no room to rise').toBe(false);
    // The Warden stands in Rodrick's old place (the Echo's summon lands "where the minion died").
    expect(s.board.findIndex((c) => c.cardId === 'knit')).toBe(1);
    // Every body standing when the RETURN overflowed wears the buff — the Warden included, it was already there.
    for (const c of s.board) expect(c.buffs?.find((b) => b.source === 'Squatimus'), c.cardId + ' got the overflow buff').toMatchObject({ attack: 3, health: 4 }); // Squatimus +3/+4 since 2026-09-18
  });
  it('SHOP: with room, both land — the Warden first, then Rodrick to its RIGHT', () => {
    let s = run({ board: [body('rod', 'u3_rodrick'), body('b0', 'dw_brunni')], hand: [body('ems', 'u3_ems')] });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    s = act(s, { type: 'activateEquipment', targetUid: 'rod' });
    s = act(s, { type: 'resolveShopDeath' });
    expect(s.board.map((c) => c.cardId)).toEqual(['u3_ems', 'knit', 'u3_rodrick', 'dw_brunni']);
  });
  it('SHOP: a Rise minion with a NON-summon Echo still rises on a full board (the freed slot is its own)', () => {
    // Sergeant's Echo grants Health (no body): the death frees a slot, nothing takes it, the Rise fits.
    let s = run({ board: [body('sg', 'sergeant'), ...six.slice(0, 5).map((id, i) => body(`b${i}`, id))], hand: [body('ems', 'u3_ems')] });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    expect(s.board.length).toBe(7);
    s = act(s, { type: 'activateEquipment', targetUid: 'sg' });
    s = act(s, { type: 'resolveShopDeath' });
    expect(s.board.length).toBe(7);
    const sergey = s.board.find((c) => c.cardId === 'sergeant')!;
    expect(sergey, 'Sergeant rose').toBeDefined();
    expect(sergey.uid).not.toBe('sg');
    expect(sergey.health).toBe(1);
  });
  it('COMBAT: the same — the Warden takes the slot, the Rise overflows (Squatimus pays), Rodrick never returns', () => {
    const r = fight([bm('u3_rodrick', { sourceUid: 'rod' } as Partial<BoardMinion>), bm('u3_squatimus', { sourceUid: 'sq', health: 60 } as Partial<BoardMinion>),
      ...[0, 1, 2, 3, 4].map((i) => ({ sourceUid: `s${i}`, cardId: 'sandbag', attack: 1, health: 60, keywords: [] } as unknown as BoardMinion))], [foe(20, 30)]);
    // Rodrick dies ONCE: the Echo's Warden fills the slot his death freed, and the Rise finds no room.
    const rod = uidOf(r, 'u3_rodrick');
    const deaths = r.events.filter((e) => e.type === 'death' && (e as { target: string }).target === rod);
    expect(deaths.length, 'one death, flagged as a Rise attempt').toBe(1);
    expect(r.events.some((e) => e.type === 'reborn'), 'no return — the Warden had the slot').toBe(false);
    const wardens = r.events.map((e, i) => [e, i] as const).filter(([e]) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'knit');
    expect(wardens.length, "the Echo's Warden landed").toBe(1);
    expect(wardens[0]![1], 'after the (rise-flagged) death').toBeGreaterThan(r.events.indexOf(deaths[0]!));
    const sq = uidOf(r, 'u3_squatimus');
    expect(r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === sq).length, 'Squatimus paid the overflow (7 standing incl. the Warden)').toBeGreaterThanOrEqual(7);
  });
  it("COMBAT: with room, both land in order — the Warden's summon, then the risen body to its RIGHT", () => {
    const r = fight([bm('u3_rodrick', { sourceUid: 'rod' } as Partial<BoardMinion>), bm('sandbag', { attack: 0, health: 60 } as Partial<BoardMinion>)], [foe(20, 30)]);
    const rod = uidOf(r, 'u3_rodrick');
    const summonIdx = r.events.findIndex((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'knit');
    const rebornIdx = r.events.findIndex((e) => e.type === 'reborn' && (e as { target: string }).target === rod);
    expect(summonIdx).toBeGreaterThanOrEqual(0);
    expect(rebornIdx, "the Rise came AFTER the Echo's summon").toBeGreaterThan(summonIdx);
    const warden = (r.events[summonIdx] as { minion: { uid: string } }).minion.uid;
    expect((r.events[rebornIdx] as { after?: string }).after, 'anchored to the Warden on its left').toBe(warden);
  });
});

describe('Cage Breaker + Coffin Flop — Discovers at the tavern tier', () => {
  it('Cage Breaker: the target dies (its Echo fires), then an Undead Discover opens at the tavern tier', () => {
    let s = run({ tier: 4, board: [body('m', 'u3_poochy', { keywords: ['T'] }), body('b', 'dw_brunni')], hand: [body('cb', 'u3_cagebreaker')] });
    s = act(s, { type: 'play', uid: 'cb' });
    expect(s.pendingTarget?.uid).toBe('cb');
    s = act(s, { type: 'battlecryTarget', targetUid: 'm' });
    expect(s.pendingDeath?.uid, 'the two-step death is armed').toBe('m');
    const opts = s.discover ?? [];
    expect(opts.length).toBeGreaterThan(0);
    for (const id of opts) {
      const d = CARD_INDEX[id]!;
      expect(d.tribe === 'undead' || d.tribe2 === 'undead', id + ' is Undead').toBe(true);
      expect(d.tier, id + ' ≤ tavern tier').toBeLessThanOrEqual(4);
    }
    s = act(s, { type: 'discover', index: 0 });
    s = act(s, { type: 'resolveShopDeath' });
    expect(s.board.some((c) => c.uid === 'm'), 'the victim is gone once the pick is made').toBe(false);
    expect(s.hand.length, 'and the pick is in hand').toBe(1);
  });
  it('Coffin Flop: using it opens an Undead Discover; a non-Undead aim is a no-op for the Deathfibrillator', () => {
    let s = run({ tier: 3, hand: [body('rob', 'u3_robinson')] });
    s = act(s, { type: 'play', uid: 'rob', toIndex: 0 });
    s = act(s, { type: 'activateEquipment' });
    expect((s.discover ?? []).length).toBeGreaterThan(0);
    for (const id of s.discover ?? []) expect(CARD_INDEX[id]!.tribe, id).toBe('undead');
    let t = run({ board: [body('b', 'dw_brunni')], hand: [body('ems', 'u3_ems')] });
    t = act(t, { type: 'play', uid: 'ems', toIndex: 0 });
    t = act(t, { type: 'activateEquipment', targetUid: 'b' });
    expect(t.pendingDeath).toBeUndefined();
    expect(at(t, 'b').keywords).not.toContain('R');
  });
});

describe('Noggin, Squatimus, Adeptus, Warden Rodrick, Hierophant', () => {
  it('Noggin: a RANDOM friendly Undead, never a non-Undead — both phases', () => {
    const r = fight([bm('u3_noggin'), bm('dw_brunni'), bm('mumi')], [foe(20, 20)]);
    const nog = uidOf(r, 'u3_noggin');
    // Noggin has Rise now: its FIRST death's Echo is the one under test (it returns, dies again, and Echoes again).
    const rebornAt = r.events.findIndex((e) => e.type === 'reborn');
    const hits = r.events.slice(0, rebornAt).filter((e) => e.type === 'buff' && (e as { source: string }).source === nog) as unknown as { target: string; attack: number }[];
    expect(hits.length).toBe(1);
    expect(hits[0]!.target).toBe(uidOf(r, 'mumi'));
    expect(hits[0]!.attack).toBe(2);
    const s = run({ board: [body('n', 'u3_noggin'), body('b', 'dw_brunni'), body('m', 'mumi')] });
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect(at(s, 'm').buffs?.find((b) => b.source === 'Noggin')).toMatchObject({ attack: 2, health: 2 });
    expect(at(s, 'b').buffs).toBeUndefined();
  });
  it('Squatimus: a summon that does not fit → your minions +3/+4 (owner 2026-09-18), shop and combat', () => {
    const full = ['u3_squatimus', 'deathlesshand', 'dw_brunni', 'dw_brunni', 'dw_coinfire', 'dw_pimm', 'e3_frank'];
    // SHOP: fire Footman Captain's Echo on a full board — the Footman finds no room.
    const s = run({ board: full.map((id, i) => body(`b${i}`, id)) });
    fireRecruitDeathrattlesForTest(s, s.board[1]!);
    expect(s.board.length).toBe(7);
    for (const c of s.board) expect(c.buffs?.find((b) => b.source === 'Squatimus'), c.cardId).toMatchObject({ attack: 3, health: 4 });
    // COMBAT: Wolves Den's Echo summons 3 Crypt Wolves into a board with one free slot (its own) — two overflow.
    // Run-board `sourceUid`s on the bodies (the perma-gain carry-back is keyed by them). Wolves Den is the ONLY body a
    // 20-Attack foe can kill, so it dies, its wolves overflow, and Squatimus + the sandbags survive to carry.
    const r = fight([
      bm('wolvesden', { sourceUid: 'wd' } as Partial<BoardMinion>), bm('u3_squatimus', { sourceUid: 'sq', health: 60 } as Partial<BoardMinion>),
      ...[0, 1, 2, 3, 4].map((i) => ({ sourceUid: `s${i}`, cardId: 'sandbag', attack: 1, health: 60, keywords: [] } as unknown as BoardMinion)),
    ], [foe(20, 25)]);
    const sq = uidOf(r, 'u3_squatimus');
    expect(r.events.some((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'cryptwolf'), 'one wolf fit').toBe(true);
    expect(r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === sq).length, 'two overflows × the living friends').toBeGreaterThanOrEqual(12);
    expect((r.playerPermaBuffs ?? []).some((b) => b.attack >= 3 && b.health >= 4), 'and it carries back (an Engrave-style perma-gain)').toBe(true);
  });
  it('Adeptus: Echo → +1/+1 to your Shop spells (owner 2026-09-18; was +1 Attack), combat carry-back and shop alike', () => {
    expect(fight([bm('u3_adeptus')], [foe(20, 20)]).playerSpellPower).toEqual({ attack: 1, health: 1 });
    const s = run({ board: [body('a', 'u3_adeptus')] });
    const beforeA = spellAttackBonus(s), beforeH = spellHealthBonus(s);
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect(spellAttackBonus(s)).toBe(beforeA + 1);
    expect(spellHealthBonus(s)).toBe(beforeH + 1);
    expect([CARD_INDEX['u3_adeptus']!.tier, CARD_INDEX['u3_adeptus']!.attack, CARD_INDEX['u3_adeptus']!.health]).toEqual([4, 5, 1]);
    expect(CARD_INDEX['u3_adeptus']!.text).toContain('+1/+1');
    expect(CARD_INDEX['u3_adeptus']!.goldenText).toContain('+2/+2');
  });
  it('Robinson: Tier 4, 5/7 (owner handoff 2026-09-18) — text unchanged', () => {
    const d = CARD_INDEX['u3_robinson']!;
    expect([d.tier, d.attack, d.health]).toEqual([4, 5, 7]);
    expect(d.text).toBe('**Equip Coffin Flop (3):** Discover an **Undead** minion.');
  });
  it('Warden Rodrick summons a real Spear Warden; the Hierophant casts Lantern of Souls on its third friendly death', () => {
    const r = fight([bm('u3_rodrick')], [foe(20, 20)]);
    expect(r.events.some((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'knit')).toBe(true);
    const h = fight([bm('sandbag', { attack: 1, health: 1 }), bm('sandbag', { attack: 1, health: 1 }), bm('sandbag', { attack: 1, health: 1 }), bm('u3_hierophant')], [foe(20, 60)]);
    expect(h.events.some((e) => e.type === 'spellcast'), 'Lantern of Souls cast').toBe(true);
    // R-AURA-02: an Aura-affecting spell cast in combat is permanent — the Lantern's +3 carries back to the run.
    expect(h.playerUndeadAuraGain?.attack, 'the Undead Aura gain carries back').toBeGreaterThanOrEqual(3);
  });
});

/**
 * BICYCLE BEN (owner handoff 2026-09-18) — Tier 4 Undead 3/9: "When a summoned minion does not fit, give a random
 * Undead +1/+1. Improves for every Undead played this turn." The grant is (1 + N)/(1 + N) for N Undead PLAYED this
 * turn, gilded ×2; permanent in both phases; never Ben himself (R-TARGET-03). The turn's Undead count reaches combat
 * on the per-tribe `tribesPlayed` side channel (`ctx.playedThisTurnFor`).
 */
describe('Bicycle Bob — overflow → a random OTHER Undead, +(1+N)/+(1+N) for N Undead played this turn', () => {
  const benBoard = (over: Partial<RunState> = {}, ben: Partial<BoardCard> = {}): RunState => run({
    board: [body('ben', 'u3_bicyclebob', ben), body('pup', 'u3_poochy'), body('b1', 'dw_brunni'), body('b2', 'dw_brunni'), body('c', 'dw_coinfire'), body('p', 'dw_pimm'), body('f', 'e3_frank')],
    ...over,
  });
  const benBuff = (c: BoardCard) => c.buffs?.find((b) => b.source === 'Bicycle Bob');

  it('SHOP: 0 Undead played → the one other Undead gets +1/+1; the Dwarves get nothing; Ben never buffs himself', () => {
    const s = benBoard();
    fireSummonOverflow(s);
    expect(benBuff(at(s, 'pup'))).toMatchObject({ attack: 1, health: 1 });
    for (const uid of ['ben', 'b1', 'b2', 'c', 'p', 'f']) expect(benBuff(at(s, uid)), uid).toBeUndefined();
  });
  it('SHOP: 2 Undead played this turn → +3/+3 (the base plus one step per Undead played)', () => {
    const s = benBoard({ playedThisTurn: ['u3_noggin', 'u3_poochy', 'dw_brunni'] }); // the Dwarf does not count
    fireSummonOverflow(s);
    expect(benBuff(at(s, 'pup'))).toMatchObject({ attack: 3, health: 3 });
  });
  it('SHOP: a played Ben counts himself — he is an Undead played this turn', () => {
    const s = benBoard({ playedThisTurn: ['u3_bicyclebob'] });
    fireSummonOverflow(s);
    expect(benBuff(at(s, 'pup'))).toMatchObject({ attack: 2, health: 2 });
  });
  it('SHOP: gilded doubles — 2 played → +6/+6', () => {
    const s = benBoard({ playedThisTurn: ['u3_noggin', 'u3_poochy'] }, { golden: true, attack: 6, health: 18 });
    fireSummonOverflow(s);
    expect(benBuff(at(s, 'pup'))).toMatchObject({ attack: 6, health: 6 });
  });
  it('SHOP: Ben as the only Undead → no grant at all (never himself, R-TARGET-03)', () => {
    const s = run({ board: [body('ben', 'u3_bicyclebob'), body('b1', 'dw_brunni'), body('b2', 'dw_brunni'), body('c', 'dw_coinfire'), body('p', 'dw_pimm'), body('f', 'e3_frank'), body('k', 'k_kobe')] });
    fireSummonOverflow(s);
    for (const c of s.board) expect(benBuff(c), c.uid).toBeUndefined();
  });
  it('SHOP: the pick is random among the OTHER Undead, and Ben is never it (many seeds)', () => {
    const hits = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = run({ rngCursor: seed, board: [body('ben', 'u3_bicyclebob'), body('n', 'u3_noggin'), body('pup', 'u3_poochy'), body('m', 'mumi'), body('b1', 'dw_brunni'), body('c', 'dw_coinfire'), body('f', 'e3_frank')] } as Partial<RunState>);
      fireSummonOverflow(s);
      for (const c of s.board) if (benBuff(c)) hits.add(c.uid);
      expect(benBuff(at(s, 'ben')), 'seed ' + seed).toBeUndefined();
    }
    expect([...hits].sort()).toEqual(['m', 'n', 'pup']);
  });
  it('COMBAT: an Echo summon that does not fit fires Ben, at the frozen Undead-played count, and the gain carries back', () => {
    // Wolves Den's Echo summons 3 Crypt Wolves into a board with one free slot (its own) — two overflow. Rising Pup
    // is the other Undead standing when they do (the Den is dead; a Crypt Wolf that fit is Undead too — so the
    // recipient is one of {pup, wolf}); Ben himself never is.
    const mine = (golden = false): BoardMinion[] => [
      bm('wolvesden', { sourceUid: 'wd' } as Partial<BoardMinion>),
      bm('u3_bicyclebob', { sourceUid: 'ben', health: 60, ...(golden ? { golden: true, attack: 6 } : {}) } as Partial<BoardMinion>),
      bm('u3_poochy', { sourceUid: 'pup', health: 60, keywords: [] } as Partial<BoardMinion>),
      ...[0, 1, 2, 3].map((i) => ({ sourceUid: `s${i}`, cardId: 'sandbag', attack: 1, health: 60, keywords: [] } as unknown as BoardMinion)),
    ];
    const pool = poolFor('set3').all.map((c) => c.id);
    const grants = (r: ReturnType<typeof simulate>) => {
      const ben = uidOf(r, 'u3_bicyclebob');
      const hits = r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === ben) as unknown as { target: string; attack: number; health: number }[];
      return { ben, hits };
    };
    const r0 = simulate(mine(), [foe(20, 25)], makeRng(7), CARD_INDEX, combatSide({ tier: 6, poolIds: pool }), combatSide({ tier: 6 }));
    const g0 = grants(r0);
    expect(g0.hits.length, 'two overflows → two grants').toBe(2);
    for (const h of g0.hits) { expect(h.target).not.toBe(g0.ben); expect([h.attack, h.health]).toEqual([1, 1]); }
    // The same fight with 2 Undead played this turn (the per-tribe channel): +3/+3 each, carried back as a perma-gain.
    const r2 = simulate(mine(), [foe(20, 25)], makeRng(7), CARD_INDEX, combatSide({ tier: 6, poolIds: pool, tribesPlayed: { undead: 2 } }), combatSide({ tier: 6 }));
    const g2 = grants(r2);
    expect(g2.hits.length).toBe(2);
    for (const h of g2.hits) { expect(h.target).not.toBe(g2.ben); expect([h.attack, h.health]).toEqual([3, 3]); }
    expect((r2.playerPermaBuffs ?? []).filter((b) => b.attack === 3 && b.health === 3 && b.sourceUid !== 'ben').length, 'carried back to the run card (never Ben)').toBeGreaterThanOrEqual(1);
    // Gilded: ×2.
    const rg = simulate(mine(true), [foe(20, 25)], makeRng(7), CARD_INDEX, combatSide({ tier: 6, poolIds: pool, tribesPlayed: { undead: 2 } }), combatSide({ tier: 6 }));
    const gg = grants(rg);
    expect(gg.hits.length).toBe(2);
    for (const h of gg.hits) expect([h.attack, h.health]).toEqual([6, 6]);
  });
  it("the per-tribe channel: the reducer freezes the turn's Undead count on the side, and combatSide reconciles both forms", () => {
    const s = run({ board: [body('ben', 'u3_bicyclebob')], playedThisTurn: ['u3_noggin', 'n2_paragon', 'dw_brunni', 'sp3_tidebud'] }); // Paragon is all-types
    const side = reduce(s, { type: 'faceOmen' }).lastCombat!.oddsInput!.playerState;
    expect(side.tribesPlayed).toEqual({ undead: 2, dwarf: 2, spirit: 2, beast: 1, mech: 1, dragon: 1, demon: 1, kobold: 1, celestial: 1, neutral: 1 }); // Paragon prints 'neutral' and counts as every real tribe (the shared predicate)
    expect(side.spiritsPlayed, 'the legacy scalar is read off the same map').toBe(2);
    expect(side.beastsPlayed).toBe(1);
    // A legacy capture with only the scalars reconstitutes the map; a map-only side derives the scalars.
    expect(combatSide({ spiritsPlayed: 3, beastsPlayed: 1 }).tribesPlayed).toEqual({ spirit: 3, beast: 1 });
    expect(combatSide({ tribesPlayed: { spirit: 2 } }).spiritsPlayed).toBe(2);
  });
});
