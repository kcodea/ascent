import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * The 2026-07-23 spell batch — tranche A (the straightforward ones). A spell lives in hand as a BoardCard
 * whose cardId is the spell id; `play` casts it (Choose-One spells pause on `chooseOne` for the option pick).
 */
const mkSpell = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const mkMinion = (uid: string, attack: number, health: number): BoardCard =>
  ({ uid, cardId: 'sandbag', tribe: 'neutral', attack, health, keywords: [], golden: false });

describe('spell batch — tranche A (set-agnostic)', () => {
  it('Crest of the Climb: +4 Attack lands on a friendly minion, flat (no spell-power leak)', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 2, 5)], hand: [mkSpell('sp', 'crestclimb')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    expect(s.chooseOne).toBeTruthy();
    s = reduce(s, { type: 'chooseOne', index: 0 }); // option 0 = +4 Attack
    const m = s.board.find((c) => c.uid === 'm1')!;
    expect([m.attack, m.health]).toEqual([6, 5]);
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(false); // consumed
  });

  it('Crest of the Climb: +4 Health option', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 2, 5)], hand: [mkSpell('sp', 'crestclimb')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    s = reduce(s, { type: 'chooseOne', index: 1 }); // option 1 = +4 Health
    const m = s.board.find((c) => c.uid === 'm1')!;
    expect([m.attack, m.health]).toEqual([2, 9]);
  });

  it('Crest of the Climb: `any` can target a tavern offer (buffs it pre-buy)', () => {
    const base = createRun(1);
    const offer = base.shop[0]!;
    let s: RunState = { ...base, hand: [mkSpell('sp', 'crestclimb')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: offer.uid });
    expect(s.chooseOne?.targetUid).toBe(offer.uid);
    s = reduce(s, { type: 'chooseOne', index: 0 });
    const o = s.shop.find((x) => x.uid === offer.uid)!;
    expect(o.atk ?? 0).toBe(4);
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(false);
  });

  it('Turnabout: swaps a minion’s Attack and Health', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 7, 2)], hand: [mkSpell('sp', 'turnabout')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    const m = s.board.find((c) => c.uid === 'm1')!;
    expect([m.attack, m.health]).toEqual([2, 7]);
  });

  it('Insurance Policy: pays 5 Gold only after a LOSS (not on turn 1 / not on a win)', () => {
    let noLast: RunState = { ...createRun(1), hand: [mkSpell('sp', 'insurancepolicy')] };
    const g0 = noLast.embers;
    noLast = reduce(noLast, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(noLast.embers).toBe(g0); // no last combat → nothing

    let lost: RunState = { ...createRun(1), hand: [mkSpell('sp', 'insurancepolicy')], lastCombat: { result: 'lose' } as CombatResult };
    const g1 = lost.embers;
    lost = reduce(lost, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(lost.embers).toBe(g1 + 5);

    let won: RunState = { ...createRun(1), hand: [mkSpell('sp', 'insurancepolicy')], lastCombat: { result: 'win' } as CombatResult };
    const g2 = won.embers;
    won = reduce(won, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(won.embers).toBe(g2); // a win pays nothing
  });

  it('Rift-Sunk Codex: Discovers a Shop spell (every offer is a spell)', () => {
    let s: RunState = { ...createRun(3), hand: [mkSpell('sp', 'riftsunkcodex')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.discover?.length ?? 0).toBeGreaterThan(0);
    expect(s.discover!.every((id) => CARD_INDEX[id]?.spell)).toBe(true);
  });

  it('Beyond the Summit: Discovers one tier higher, reaching Tier 7 without Summit', () => {
    let s: RunState = { ...createRun(1), tier: 6, hand: [mkSpell('sp', 'beyondsummit')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.discover?.length ?? 0).toBeGreaterThan(0);
    expect(s.discover!.some((id) => CARD_INDEX[id]?.tier === 7)).toBe(true); // reaches 7
    expect(s.discover!.every((id) => (CARD_INDEX[id]?.tier ?? 0) >= 6)).toBe(true); // top-tier bias
  });

  it('Invitation Above: Discovers exactly a Tier 6 minion, regardless of tavern tier', () => {
    let s: RunState = { ...createRun(1), tier: 3, hand: [mkSpell('sp', 'invitationabove')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.discover?.length ?? 0).toBeGreaterThan(0);
    expect(s.discover!.every((id) => CARD_INDEX[id]?.tier === 6)).toBe(true);
  });
});

describe('spell batch — tranche B1 (next-combat keyword grants)', () => {
  it('Field Maneuvers: Choose One banks Ward (DS) or Flurry (W) on the target for next combat', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 3, 3)], hand: [mkSpell('sp', 'fieldmaneuvers')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    expect(s.chooseOne?.targetUid).toBe('m1');
    s = reduce(s, { type: 'chooseOne', index: 0 }); // Ward
    expect(s.pendingCombatKeywords).toEqual([{ uid: 'm1', keyword: 'DS' }]);
    expect(s.board.find((c) => c.uid === 'm1')!.keywords).not.toContain('DS'); // NOT granted on the run board

    let s2: RunState = { ...createRun(1), board: [mkMinion('m1', 3, 3)], hand: [mkSpell('sp', 'fieldmaneuvers')] };
    s2 = reduce(s2, { type: 'play', uid: 'sp', targetUid: 'm1' });
    s2 = reduce(s2, { type: 'chooseOne', index: 1 }); // Flurry
    expect(s2.pendingCombatKeywords).toEqual([{ uid: 'm1', keyword: 'W' }]);
  });

  it('Last Stand: banks Rise (Reborn) for next combat', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 3, 3)], hand: [mkSpell('sp', 'laststand')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    expect(s.pendingCombatKeywords).toEqual([{ uid: 'm1', keyword: 'R' }]);
  });

  it("Executioner's Edge: banks Critical Strike with a 50% crit chance", () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 3, 3)], hand: [mkSpell('sp', 'executionersedge')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    expect(s.pendingCombatKeywords).toEqual([{ uid: 'm1', keyword: 'CR', critChance: 0.5 }]);
  });

  it('the banked grant is spent at faceOmen (consumed by the fight, gone after)', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 3, 3)], hand: [mkSpell('sp', 'laststand')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    expect(s.pendingCombatKeywords?.length).toBe(1);
    s = reduce(s, { type: 'faceOmen' });
    expect(s.pendingCombatKeywords ?? []).toEqual([]); // spent
    expect(s.lastCombat).toBeTruthy();
  });
});

describe('spell batch — tranche A (Set 2 Ruby spells)', () => {
  const RUBY = 'ruby';

  it('Ruby Shipment: mints 2 Rubies into hand', () => {
    let s: RunState = { ...createRun(1), setId: 'set2', hand: [mkSpell('sp', 'rubyshipment')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.hand.filter((c) => c.cardId === RUBY).length).toBe(2);
    expect(s.hand.some((c) => c.cardId === 'rubyshipment')).toBe(false); // consumed
  });

  it("Facetwright's Choice: +1 Attack raises the run's Ruby bonus and grows a held Ruby", () => {
    let s: RunState = { ...createRun(1), setId: 'set2', hand: [mkSpell('r', RUBY), mkSpell('sp', 'facetwright')] };
    // seed a Ruby in hand at 1/1 so we can see it grow
    const held = s.hand.find((c) => c.uid === 'r')!;
    held.cardId = RUBY; held.attack = 1; held.health = 1;
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.chooseOne).toBeTruthy();
    s = reduce(s, { type: 'chooseOne', index: 0 }); // +1 Attack
    expect(s.rubyBonus?.attack ?? 0).toBe(1);
    const heldAfter = s.hand.find((c) => c.uid === 'r')!;
    expect([heldAfter.attack, heldAfter.health]).toEqual([2, 1]); // held Ruby grew
  });
});
