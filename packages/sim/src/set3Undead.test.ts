import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EQUIPMENT_INDEX, SETS, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { displayedStatsOf, fireRecruitDeathrattlesForTest, spellAttackBonus } from './recruit';

/**
 * SET 3 — UNDEAD (owner roster 2026-09-09). Eleven new cards; the eleven carried-over set-1 Undead are pinned by
 * `set3Scaffold.test.ts`. The rulings under test:
 *  - `onRise` fires in BOTH phases for a FRIENDLY Rise (never an enemy's); a shop Rise pays permanently.
 *  - Rising Tide: board (a combat gain) + hand (permanent, R-HAND-02). Revenant: Ward + stats, stacking.
 *  - Squatimus: overflow → your minions +2/+2 in both phases. Noggin: a random friendly Undead only.
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
    for (const id of ['u3_poochy', 'u3_noggin', 'u3_robinson', 'u3_adeptus', 'u3_ems', 'u3_cagebreaker', 'u3_revenant', 'u3_risingtide', 'u3_squatimus', 'u3_rodrick', 'u3_hierophant']) {
      expect(pool.buyable.some((c) => c.id === id), id).toBe(true);
    }
    expect(SETS.set3.tribes).toContain('undead');
    expect([CARD_INDEX['deathswarmer']!.attack, CARD_INDEX['deathswarmer']!.health]).toEqual([0, 3]);
    expect([CARD_INDEX['mumi']!.tier, CARD_INDEX['mumi']!.attack, CARD_INDEX['mumi']!.health]).toEqual([3, 5, 2]);
    expect(CARD_INDEX['sergeant']!.name).toBe('Sergey');
    expect(CARD_INDEX['anubis']!.name).toBe('Anubis, Last Gate');
    expect(EQUIPMENT_INDEX['coffin_flop']?.baseCost).toBe(2);
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
    expect(buffsOn(r, rev).some((b) => b.attack === 4 && b.health === 5 && b.source === tide), 'Rising Tide reaches the board').toBe(true);
    expect(r.playerHandBuffs, 'Rising Tide reaches the HAND — permanently').toEqual([{ uid: 'h1', attack: 4, health: 5, source: tide }]);
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
    expect(risen.health, 'back at 1 Health, then Rising Tide +5').toBe(1 + 5);
    // Revenant: Ward + 7/7, attributed to itself — permanent (a shop buff is).
    expect(at(s, 'rev').keywords).toContain('DS');
    expect(at(s, 'rev').buffs?.find((b) => b.source === 'Revenant')).toMatchObject({ attack: 7, health: 7 });
    // Rising Tide: everyone on board (the risen Poochy included) and the hand.
    expect(at(s, 'rev').buffs?.find((b) => b.source === 'Rising Tide')).toMatchObject({ attack: 4, health: 5 });
    expect(risen.buffs?.find((b) => b.source === 'Rising Tide')).toMatchObject({ attack: 4, health: 5 });
    expect(s.hand.find((c) => c.uid === 'h1')!.buffs?.find((b) => b.source === 'Rising Tide')).toMatchObject({ attack: 4, health: 5 });
    expect(s.hand.find((c) => c.uid === 'h1')!.attack).toBe(CARD_INDEX['dw_brunni']!.attack + 4);
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
    // …but the Warden's OWN Echo fired on the way out: the Spear Warden Aura grew.
    expect(s.cardBuffs?.['knit']?.attack ?? 0).toBeGreaterThanOrEqual(3);
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
    // The Warden: printed 3 + its own Aura (+6, then +9 after its Echo grew it on the way out) + the Undead Aura.
    s = { ...s, embers: 20, equipment: s.equipment ? { ...s.equipment, activationsSpent: 0 } : s.equipment };
    s = act(s, { type: 'activateEquipment', targetUid: 'sw' });
    s = act(s, { type: 'resolveShopDeath' });
    const warden = s.board.find((c) => c.cardId === 'knit')!;
    expect(warden.uid).not.toBe('sw');
    expect(warden.attack, 'printed 3 + its own Aura 9 (stored)').toBe(3 + 9);
    expect(warden.health).toBe(1 + (4 + 2));
    expect(displayedStatsOf(s, warden).attack, '+ the Undead Aura on display').toBe(3 + 9 + 5);
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
    const hits = r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === nog) as unknown as { target: string; attack: number }[];
    expect(hits.length).toBe(1);
    expect(hits[0]!.target).toBe(uidOf(r, 'mumi'));
    expect(hits[0]!.attack).toBe(2);
    const s = run({ board: [body('n', 'u3_noggin'), body('b', 'dw_brunni'), body('m', 'mumi')] });
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect(at(s, 'm').buffs?.find((b) => b.source === 'Noggin')).toMatchObject({ attack: 2, health: 2 });
    expect(at(s, 'b').buffs).toBeUndefined();
  });
  it('Squatimus: a summon that does not fit → your minions +2/+2, shop and combat', () => {
    const full = ['u3_squatimus', 'deathlesshand', 'dw_brunni', 'dw_brunni', 'dw_coinfire', 'dw_pimm', 'e3_frank'];
    // SHOP: fire Footman Captain's Echo on a full board — the Footman finds no room.
    const s = run({ board: full.map((id, i) => body(`b${i}`, id)) });
    fireRecruitDeathrattlesForTest(s, s.board[1]!);
    expect(s.board.length).toBe(7);
    for (const c of s.board) expect(c.buffs?.find((b) => b.source === 'Squatimus'), c.cardId).toMatchObject({ attack: 2, health: 2 });
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
    expect((r.playerPermaBuffs ?? []).some((b) => b.attack >= 2 && b.health >= 2), 'and it carries back (an Engrave-style perma-gain)').toBe(true);
  });
  it('Adeptus: Echo → +1 Attack to your Shop spells, combat carry-back and shop alike', () => {
    expect(fight([bm('u3_adeptus')], [foe(20, 20)]).playerSpellPower).toEqual({ attack: 1, health: 0 });
    const s = run({ board: [body('a', 'u3_adeptus')] });
    const before = spellAttackBonus(s);
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect(spellAttackBonus(s)).toBe(before + 1);
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
