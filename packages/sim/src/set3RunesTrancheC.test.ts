import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX } from '@game/content';
import {
  createRun, reduce, createStarform, starformOf, starformStats, starformStandIn, starformSpellAimsToken, starformConsumeShopMinion,
  starformSoulScriptBake, RED_GIANT_GAIN, buyStarform,
  equipmentAmplifiedOf, equipmentState, amplifyEquipment, consumeAmplified, EQUIPMENT_AMPLIFY_MAX,
  type Action, type BoardCard, type RunState, type ShopCard,
} from './index';
import { auraFxTargets, buffUndeadAttackEverywhere, consumeShopMinion, isTribe, socRuneReplaysOf } from './recruit';
import { socBoard } from './snapshot';

/**
 * SET 3 BATCH 2 (2026-09-16) — TRANCHE C: the cross-system runes + the two new STATES they introduce.
 *
 *   · REBIRTH (keyword `RB`) — combat behaviour is pinned in `core/src/combat/rebirth.test.ts`; here: the SHOP
 *     return, the snapshot fold, the recruit-side Rune of Rebirth replay.
 *   · AMPLIFIED (Equipment state) — set / consumed / capped / carried across the turn / the blue-charge read.
 *   · Rune of Amplification (Basic 4) · Rune of Soul Script (Basic 5) · Rune of the Grand Workshop (Epic 6) ·
 *     Rune of the Red Giant (Epic 5). (Final Gate + Dreamed Graves are combat runes → the core test file.)
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), setId: 'set3', phase: 'recruit', embers: 40, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const play = (s: RunState, uid: string, toIndex = s.board.length): RunState => act(s, { type: 'play', uid, toIndex } as Action);
const activate = (s: RunState, targetUid?: string): RunState => act(s, { type: 'activateEquipment', ...(targetUid ? { targetUid } : {}) });
/** Buy `id` from a forge stocked with exactly it — the real reward path. */
const buyRune = (s: RunState, id: string): RunState => act({ ...s, runeforgeOffer: [id], embers: 40 }, { type: 'buyRune', index: 0 });
const nextTurn = (s: RunState): RunState => {
  const next = act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
  expect(next.phase, 'the run never came back to a shop').toBe('recruit');
  return next;
};
const statsOf = (s: RunState, uid: string): [number, number] => { const c = s.board.find((b) => b.uid === uid)!; return [c.attack, c.health]; };
const offer = (s: RunState, cardId: string, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${s.uidSeq++}`, cardId, ...over });
const SRC = { cardId: 'dbg_starseed', name: 'Star Seed' };
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};

describe('the six defs ship as specced', () => {
  it('ids, pools, costs, set gate, tribe gates', () => {
    const basic = ['rune_amplification', 'rune_soul_script'];
    const epic = ['rune_grand_workshop', 'rune_red_giant', 'rune_final_gate', 'rune_dreamed_graves'];
    for (const id of basic) { expect(RUNES.some((r) => r.id === id), `${id} is Basic`).toBe(true); expect(RUNE_INDEX[id]!.epic).toBeFalsy(); }
    for (const id of epic) { expect(EPIC_RUNES.some((r) => r.id === id), `${id} is Epic`).toBe(true); expect(RUNE_INDEX[id]!.epic).toBe(true); }
    const costs: Record<string, number> = { rune_amplification: 4, rune_soul_script: 5, rune_grand_workshop: 6, rune_red_giant: 5, rune_final_gate: 6, rune_dreamed_graves: 4 };
    for (const [id, c] of Object.entries(costs)) { expect(RUNE_INDEX[id]!.cost, id).toBe(c); expect(RUNE_INDEX[id]!.sets, `${id} is set 3 only`).toEqual(['set3']); }
    expect(RUNE_INDEX['rune_amplification']!.tribes, 'Universal').toBeUndefined();
    expect(RUNE_INDEX['rune_grand_workshop']!.tribes, 'Universal').toBeUndefined();
    expect(RUNE_INDEX['rune_soul_script']!.tribes).toEqual(['undead', 'celestial']);
    expect(RUNE_INDEX['rune_red_giant']!.tribes).toEqual(['celestial']);
    expect(RUNE_INDEX['rune_final_gate']!.tribes).toEqual(['undead']);
    expect(RUNE_INDEX['rune_dreamed_graves']!.tribes, 'text names no tribe → no gate (owner rule 2026-09-10)').toBeUndefined();
  });

  it('Rune of Rebirth (id kept) now grants the Rebirth keyword — its text says so, its reward is unchanged', () => {
    const r = RUNE_INDEX['rune_rebirth']!;
    expect(r.text).toContain('**Rebirth**');
    expect(r.text).not.toMatch(/Echo/);
    expect(r.reward).toEqual({ kind: 'combatFlag', flag: 'runeRebirth' });
  });
});

describe('AMPLIFIED — the Equipment state', () => {
  /** Frank (sturdy enough to survive the wave-7 fight) on board with Bloodpot granted, plus a victim. */
  const armed = (over: Partial<RunState> = {}): RunState => {
    let s = run({ hand: [body('f', 'e3_frank', { health: 400 })], board: [body('t', 'u3_poochy', { health: 400, keywords: [] })], ...over });
    s = play(s, 'f', 1);
    expect(equipmentState(s).available.map((g) => g.equipmentId)).toEqual(['bloodpot']);
    return s;
  };

  it('set → the blue-charge read; consumed by the next activation, which triggers TWICE; not re-set by itself', () => {
    let s = armed();
    expect(equipmentAmplifiedOf(s, 'bloodpot'), 'plain to begin with').toBe(0);
    expect(amplifyEquipment(s, 'bloodpot')).toBe(true);
    expect(equipmentAmplifiedOf(s, 'bloodpot'), 'the UI paints this blue').toBe(1);
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't'), 'Bloodpot +3/+3, twice').toEqual([a + 6, h + 6]);
    expect(equipmentAmplifiedOf(s, 'bloodpot'), 'the stack is spent by the activation').toBe(0);
  });

  it('capped at one stack per Equipment', () => {
    const s = armed();
    expect(amplifyEquipment(s, 'bloodpot')).toBe(true);
    expect(amplifyEquipment(s, 'bloodpot'), 'a second stack is refused').toBe(false);
    expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(EQUIPMENT_AMPLIFY_MAX);
    expect(consumeAmplified(s, 'bloodpot')).toBe(true);
    expect(consumeAmplified(s, 'bloodpot'), 'nothing left to consume').toBe(false);
  });

  it('an Equipment not held cannot be Amplified', () => {
    const s = armed();
    expect(amplifyEquipment(s, 'titan_hammer')).toBe(false);
    expect(equipmentAmplifiedOf(s, 'titan_hammer')).toBe(0);
  });

  it('stacks with extra triggers multiplicatively: (1 + extra) × 2', () => {
    let s = armed();
    s.equipmentExtraTriggers = 1;
    amplifyEquipment(s, 'bloodpot');
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't'), '2 triggers × 2 = 4 × (+3/+3)').toEqual([a + 12, h + 12]);
  });

  it('a stack CARRIES across the turn boundary for an Equipment still held, and is pruned for one that is gone', () => {
    let s = armed();
    amplifyEquipment(s, 'bloodpot');
    s = nextTurn(s);
    expect(equipmentState(s).available.map((g) => g.equipmentId), 'Frank survived; Bloodpot rebuilt').toContain('bloodpot');
    expect(equipmentAmplifiedOf(s, 'bloodpot'), 'still Amplified next turn').toBe(1);
    // Sell Frank: next turn Bloodpot is not rebuilt, and its stack goes with it.
    s = act(s, { type: 'sell', uid: 'f' } as Action);
    s = nextTurn(s);
    expect(equipmentState(s).available.some((g) => g.equipmentId === 'bloodpot')).toBe(false);
    expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(0);
  });
});

describe('Rune of Amplification: Equipment you do NOT activate becomes Amplified (at End of Turn)', () => {
  it('an unactivated Bloodpot is Amplified after the turn; an activated one is not; the rune badge procs', () => {
    let s = run({ hand: [body('f', 'e3_frank', { health: 400 })], board: [body('t', 'u3_poochy', { health: 400, keywords: [] })] });
    s = play(s, 'f', 1);
    s = buyRune(s, 'rune_amplification');
    expect(s.runeAmplification).toBe(true);
    // Turn A: do not activate → Amplified going into turn B.
    s = nextTurn(s);
    expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(1);
    expect(s.runeProcs?.['rune_amplification'] ?? 0).toBeGreaterThan(0);
    // Turn B: activate (triggers twice, consumes the stack) → NOT Amplified going into turn C (it was used).
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't')).toEqual([a + 6, h + 6]);
    s = nextTurn(s);
    expect(equipmentAmplifiedOf(s, 'bloodpot'), 'activated this turn → no stack').toBe(0);
    // Turn C: leave it → Amplified again. Maximum 1: a second idle turn does not stack a second.
    s = nextTurn(s);
    expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(1);
    s = nextTurn(s);
    expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(1);
  });

  it('activating through the SHARED POOL still counts as activating it', () => {
    let s = run({ hand: [body('f', 'e3_frank', { health: 400 })], board: [body('t', 'u3_poochy', { health: 400, keywords: [] })] });
    s = play(s, 'f', 1);
    s = buyRune(s, 'rune_amplification');
    s.equipment!.bonusActivations = 1; // a pool charge (Equipment Charger's grant)
    s = activate(s, 't');
    expect(equipmentState(s).available[0]!.ownChargeSpent, 'the pool paid, not the own charge').toBe(false);
    s = nextTurn(s);
    expect(equipmentAmplifiedOf(s, 'bloodpot'), 'it WAS activated — no stack').toBe(0);
  });
});

describe('Rune of the Grand Workshop (Epic): Amplify your Equipment now, and every Start of Turn', () => {
  it('amplifies every held Equipment on purchase, and again after each rebuild (capped at 1)', () => {
    let s = run({ hand: [body('f', 'e3_frank', { health: 400 }), body('g', 'e3_sculptor', { health: 400 })], board: [body('t', 'u3_poochy', { health: 400, keywords: [] })] });
    s = play(s, 'f', 1);
    s = play(s, 'g', 2);
    expect(equipmentState(s).available.map((g) => g.equipmentId).sort()).toEqual(['bloodpot', 'titan_hammer']);
    s = buyRune(s, 'rune_grand_workshop');
    expect(s.runeGrandWorkshop).toBe(true);
    expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(1);
    expect(equipmentAmplifiedOf(s, 'titan_hammer')).toBe(1);
    // Spend Bloodpot's stack this turn; the Start of Turn hands it back.
    s = activate(s, 't');
    expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(0);
    s = nextTurn(s);
    expect(equipmentAmplifiedOf(s, 'bloodpot'), 'Start of Turn: repeat this').toBe(1);
    expect(equipmentAmplifiedOf(s, 'titan_hammer'), 'never above 1').toBe(1);
  });
});

describe('Rune of Soul Script: the Starform counts as Undead', () => {
  it("the token's stand-in IS Undead for every `isTribe` reader (and still a Celestial)", () => {
    let s = run();
    const sf = createStarform(s, SRC);
    expect(isTribe(starformStandIn(s, sf), 'undead'), 'not before the rune').toBe(false);
    s = buyRune(s, 'rune_soul_script');
    expect(s.runeSoulScript).toBe(true);
    const standIn = starformStandIn(s, starformOf(s)!);
    expect(isTribe(standIn, 'undead')).toBe(true);
    expect(isTribe(standIn, 'celestial')).toBe(true);
  });

  it('an Undead can Consume it — the eater takes its stats through the one Shop-consume chokepoint', () => {
    let s = run();
    createStarform(s, SRC);
    s = buyRune(s, 'rune_soul_script');
    const idx = s.shop.findIndex((o) => o.starform);
    const [sa, sh] = [starformStats(s)!.attack, starformStats(s)!.health];
    const eater = body('e', 'u3_poochy', { keywords: [] });
    s.board.push(eater);
    expect(consumeShopMinion(s, eater, idx)).toBe(true);
    expect(s.shop.some((o) => o.starform), 'the token is gone').toBe(false);
    expect([eater.attack, eater.health]).toEqual([2 + sa, 1 + sh]);
  });

  it('an Undead-aimed friendly spell may aim the token (the reticle and the reducer read one gate)', () => {
    const undeadSpell = { spell: true, target: 'friendly' as const, targetTribe: 'undead' as const };
    expect(starformSpellAimsToken(undeadSpell, { runeSoulScript: true })).toBe(true);
    expect(starformSpellAimsToken(undeadSpell, { runeSoulScript: undefined })).toBe(false);
    expect(starformSpellAimsToken(undeadSpell), 'no state → the plain Celestial gate').toBe(false);
    expect(starformSpellAimsToken({ spell: true, target: 'friendly', targetTribe: 'celestial' }, { runeSoulScript: true }), 'Star Crash unchanged').toBe(true);
  });

  it('the Undead AURA reaches the token: the standing aura is baked at purchase (once), later raises land live', () => {
    let s = run();
    createStarform(s, SRC);
    s.undeadBuyAtk = 3; // Lantern / Deathswarmer already raised the aura
    const before = starformStats(s)!;
    s = buyRune(s, 'rune_soul_script');
    expect(starformStats(s)!.attack, 'the standing +3 Attack aura, baked').toBe(before.attack + 3);
    starformSoulScriptBake(s);
    expect(starformStats(s)!.attack, 'latched — never twice').toBe(before.attack + 3);
    buffUndeadAttackEverywhere(s, 2, 'Deathswarmer');
    expect(starformStats(s)!.attack, 'a later raise lands live').toBe(before.attack + 5);
    // A NEW token inherits the standing aura at creation.
    s.shop = s.shop.filter((o) => !o.starform);
    createStarform(s, SRC);
    expect(starformStats(s)!.attack).toBe(1 + 5);
  });

  it('"your Undead +a/+h" Shop buffs land on the token (the tribe-buff chokepoint), and the Undead aura wash reaches it', () => {
    const buffer: CardDef = { id: 'dbg_undead_buffer', name: 'Undead buffer (probe)', tribe: 'undead', tier: 1, attack: 1, health: 1, keywords: [],
      effects: [{ on: 'onPlay', do: 'battlecryBuffTribe', params: { tribe: 'undead', attack: 2, health: 3 } }], text: '' };
    CARD_INDEX[buffer.id] = buffer;
    let s = run();
    createStarform(s, SRC);
    const before = starformStats(s)!;
    // Without the rune: the token is a Celestial — untouched.
    s = { ...s, hand: [body('b', 'dbg_undead_buffer')] };
    s = play(s, 'b');
    expect(starformStats(s)).toEqual(before);
    s = buyRune(s, 'rune_soul_script');
    s = { ...s, hand: [body('b2', 'dbg_undead_buffer')] };
    s = play(s, 'b2');
    expect(starformStats(s)).toEqual({ attack: before.attack + 2, health: before.health + 3 });
    expect(auraFxTargets(s, 'undead'), 'the aura wash blooms over the token').toContain(starformOf(s)!.uid);
  });
});

describe('Rune of the Red Giant (Epic): the Starform has a 50% chance to also Consume a Shop spell', () => {
  /** A run with the rune, a token, a minion offer to eat and the spell slot stocked, at a chosen rng cursor. */
  const staged = (cursor: number): { s: RunState; minionIdx: number } => {
    let s = run({ rngCursor: cursor });
    s = buyRune(s, 'rune_red_giant');
    s.rngCursor = cursor; // the buy itself draws nothing, but pin it explicitly
    createStarform(s, SRC);
    s.spell = offer(s, 'starcrash');
    const minionIdx = s.shop.findIndex((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !o.starform; });
    expect(minionIdx).toBeGreaterThanOrEqual(0);
    return { s, minionIdx };
  };

  it('seeded 50%: across many cursors roughly half the consumes also eat the spell — and each cursor replays identically', () => {
    let hits = 0;
    const N = 40;
    for (let c = 1; c <= N; c++) {
      const { s, minionIdx } = staged(c);
      const before = starformStats(s)!;
      expect(starformConsumeShopMinion(s, minionIdx)).toBe(true);
      const ate = s.spell === null;
      if (ate) {
        hits++;
        expect(s.hand.some((h) => h.cardId === 'starcrash'), 'a copy of the spell in hand').toBe(true);
        expect(starformStats(s)!.attack, '+8 Attack on top of the meal').toBeGreaterThanOrEqual(before.attack + RED_GIANT_GAIN.attack);
        expect(s.runeProcs?.['rune_red_giant'] ?? 0).toBe(1);
      } else {
        expect(s.hand.some((h) => h.cardId === 'starcrash')).toBe(false);
        expect(s.runeProcs?.['rune_red_giant'] ?? 0).toBe(0);
      }
      // Determinism: the same cursor → the same outcome.
      const again = staged(c);
      starformConsumeShopMinion(again.s, again.minionIdx);
      expect(again.s.spell === null).toBe(ate);
    }
    expect(hits, `${hits}/${N} hits — a coin, not a rig`).toBeGreaterThanOrEqual(10);
    expect(hits).toBeLessThanOrEqual(30);
  });

  it('with no Starform, or without the rune, the spell slot is never touched', () => {
    let s = run();
    s.spell = offer(s, 'starcrash');
    for (let c = 1; c <= 8; c++) { s.rngCursor = c; expect(starformConsumeShopMinion(s, 0)).toBe(false); expect(s.spell).not.toBeNull(); }
    s = run();
    createStarform(s, SRC);
    s.spell = offer(s, 'starcrash');
    for (let c = 1; c <= 8; c++) {
      const idx = s.shop.findIndex((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !o.starform; });
      if (idx < 0) break;
      s.rngCursor = c;
      starformConsumeShopMinion(s, idx);
      expect(s.spell, 'no rune → no bite').not.toBeNull();
    }
  });

  it('with the slot empty it eats the right-most spell offer in the row', () => {
    const { s, minionIdx } = staged(1);
    s.spell = null;
    const spellOffer = offer(s, 'starcrash');
    s.shop.splice(minionIdx + 1, 0, spellOffer);
    // Walk cursors until one bites.
    let bit = false;
    for (let c = 1; c <= 20 && !bit; c++) {
      const t = staged(c); t.s.spell = null; t.s.shop.splice(t.minionIdx + 1, 0, offer(t.s, 'starcrash'));
      const spellUid = t.s.shop[t.minionIdx + 1]!.uid;
      starformConsumeShopMinion(t.s, t.minionIdx);
      if (!t.s.shop.some((o) => o.uid === spellUid)) { bit = true; expect(t.s.hand.some((h) => h.cardId === 'starcrash')).toBe(true); }
    }
    expect(bit).toBe(true);
  });
});

describe('Rebirth in the SHOP + the snapshot fold + the recruit-side Rune of Rebirth replay', () => {
  it('a destroyed Rebirth body returns as it WAS (buffs, keywords, Rebirth spent); a Rise body returns printed', () => {
    let s = run({ tier: 4, board: [body('m', 'u3_poochy', { attack: 9, health: 9, keywords: ['RB', 'T'] })], hand: [body('cb', 'u3_cagebreaker')] });
    s = act(s, { type: 'play', uid: 'cb' });
    s = act(s, { type: 'battlecryTarget', targetUid: 'm' });
    s = act(s, { type: 'discover', index: 0 });
    s = act(s, { type: 'resolveShopDeath' });
    const back = s.board.find((c) => c.cardId === 'u3_poochy')!;
    expect(back, 'it came back').toBeDefined();
    expect(back.uid, 'a fresh uid (the departure diff must see it leave)').not.toBe('m');
    expect([back.attack, back.health], 'the 9/9 it had').toEqual([9, 9]);
    expect(back.keywords, 'Taunt kept, Rebirth spent').toEqual(['T']);
    // The return cue is flagged REBIRTH, so the shop plays the phoenix flame, not Rise's aqua re-form (2026-09-26).
    expect((s.shopDeathFx ?? []).filter((f) => f.kind === 'rise' && f.uid === back.uid).map((f) => f.rebirth)).toEqual([true]);
    // The Rise twin on the same body: the printed 2/1.
    let r = run({ tier: 4, board: [body('m', 'u3_poochy', { attack: 9, health: 9, keywords: ['R', 'T'] })], hand: [body('cb', 'u3_cagebreaker')] });
    r = act(r, { type: 'play', uid: 'cb' });
    r = act(r, { type: 'battlecryTarget', targetUid: 'm' });
    r = act(r, { type: 'discover', index: 0 });
    r = act(r, { type: 'resolveShopDeath' });
    const risen = r.board.find((c) => c.cardId === 'u3_poochy')!;
    expect([risen.attack, risen.health]).toEqual([2, 1]);
    expect((r.shopDeathFx ?? []).filter((f) => f.kind === 'rise' && f.uid === risen.uid).map((f) => !!f.rebirth), 'a Rise is not a Rebirth').toEqual([false]);
  });

  it('SNAPSHOT FIDELITY: a Rebirth granted at Start of Combat folds into the SoC board like any keyword grant', () => {
    const r = simulate([bm('u3_poochy', { keywords: [] }), bm('u3_poochy', { keywords: [] })], [bm('sandbag', { attack: 1, health: 50 })], makeRng(4), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['undead'], questMods: { runeRebirth: true } }), combatSide({ tier: 6 }));
    const soc = socBoard(r);
    expect(soc.filter((m) => m.keywords?.includes('RB')), 'exactly one body carries RB at Start of Combat').toHaveLength(1);
  });

  it('the recruit-side replay (Combat Prowess / Lasting Cadence) grants a PERMANENT Rebirth to one random body', () => {
    const s = run({ board: [body('a', 'u3_poochy', { keywords: [] }), body('b', 'u3_poochy', { keywords: [] })], questFlags: { runeRebirth: true } });
    const replay = socRuneReplaysOf(s).find((x) => x.id === 'rune_rebirth');
    expect(replay).toBeDefined();
    replay!.fire(s);
    expect(s.board.filter((c) => c.keywords.includes('RB'))).toHaveLength(1);
    replay!.fire(s);
    expect(s.board.filter((c) => c.keywords.includes('RB')), 'the second grant lands on the OTHER body').toHaveLength(2);
    replay!.fire(s);
    expect(s.board.filter((c) => c.keywords.includes('RB')), 'nothing eligible → no-op').toHaveLength(2);
  });
});

describe('Rune of Soul Script: the BUY-consume reaches an Undead (owner report 2026-09-16)', () => {
  it('with no Celestial on the board, buying the Starform feeds the left-most Undead under the rune — and nobody without it', () => {
    let s = run();
    createStarform(s, SRC);
    const u1 = body('u1', 'u3_poochy', { keywords: [] });
    const u2 = body('u2', 'u3_poochy', { keywords: [] });
    s = { ...s, board: [u1, u2] };
    const [sa, sh] = [starformStats(s)!.attack, starformStats(s)!.health];
    const before = buyStarform({ ...s, board: s.board.map((c) => ({ ...c })), shop: s.shop.map((o) => ({ ...o })) });
    expect(before?.receiver, 'no rune: the buy has no receiver').toBeNull();
    s = buyRune(s, 'rune_soul_script');
    const out = buyStarform(s);
    expect(out?.receiver?.uid).toBe('u1');
    const fed = s.board.find((c) => c.uid === 'u1')!;
    expect(fed.attack).toBe(u1.attack + sa);
    expect(fed.health).toBe(u1.health + sh);
  });
});
