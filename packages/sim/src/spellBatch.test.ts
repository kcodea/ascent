import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { spellDisplayText } from './recruit';

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

describe('spell batch — tranche B2 (shop / economy)', () => {
  it('Quick Sale: the next minion sold this turn is worth +2 Gold, one-shot', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 2, 2), mkMinion('m2', 2, 2)], hand: [mkSpell('sp', 'quicksale')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.nextSellBonus).toBe(2);
    const before = s.embers;
    s = reduce(s, { type: 'sell', uid: 'm1' });
    expect(s.embers).toBe(before + 1 + 2); // base sell value (1) + the Quick Sale bonus
    expect(s.nextSellBonus).toBe(0); // spent
    const mid = s.embers;
    s = reduce(s, { type: 'sell', uid: 'm2' });
    expect(s.embers).toBe(mid + 1); // second sell gets base only
  });

  it('Sigil of Kinship: refreshes the shop with minions of the chosen minion’s type (board OR a shop offer)', () => {
    const base = createRun(3);
    const tribe = base.tribes[0]!; // an ACTIVE tribe (its cards have pool copies)
    let s: RunState = { ...base, board: [{ uid: 'm1', cardId: 'sandbag', tribe, attack: 2, health: 2, keywords: [], golden: false }], hand: [mkSpell('sp', 'sigilkinship')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    expect(s.shop.length).toBeGreaterThan(0);
    expect(s.shop.every((o) => { const d = CARD_INDEX[o.cardId]!; return d.tribe === tribe || d.tribe2 === tribe; })).toBe(true);

    // usable on a SHOP offer too (target 'any') — refreshes to that offer's type
    const base2 = createRun(3);
    const offer = base2.shop[0]!;
    const offerTribe = CARD_INDEX[offer.cardId]!.tribe;
    let s2: RunState = { ...base2, hand: [mkSpell('sp', 'sigilkinship')] };
    s2 = reduce(s2, { type: 'play', uid: 'sp', targetUid: offer.uid });
    expect(s2.shop.length).toBeGreaterThan(0);
    expect(s2.shop.every((o) => { const d = CARD_INDEX[o.cardId]!; return d.tribe === offerTribe || d.tribe2 === offerTribe; })).toBe(true);
  });

  it('Elevation Ritual: upgrades EACH offer to a random minion one tier higher than itself', () => {
    let s: RunState = { ...createRun(3), tier: 3, hand: [mkSpell('sp', 'elevationritual')] };
    const before = s.shop.map((o) => CARD_INDEX[o.cardId]!.tier);
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    const after = s.shop.map((o) => CARD_INDEX[o.cardId]!.tier);
    expect(after.length).toBe(before.length);
    // at tier 3 (offers ≤ 3, cap 6) every offer climbs exactly one tier
    after.forEach((t, i) => expect(t).toBe(before[i]! + 1));
  });
});

describe('spell batch — tranche B3 (offer / minion manipulation)', () => {
  it('Layaway: keeps a shop offer through rerolls and cuts its cost by 1', () => {
    const base = createRun(1);
    const offer = base.shop[0]!;
    let s: RunState = { ...base, embers: 100, hand: [mkSpell('sp', 'layaway')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: offer.uid });
    const kept = s.shop.find((o) => o.uid === offer.uid)!;
    expect(kept.kept).toBe(true);
    expect(kept.cost).toBe(2); // minionCost 3 − 1
    s = reduce(s, { type: 'roll' });
    expect(s.shop.some((o) => o.uid === offer.uid && o.kept && o.cost === 2)).toBe(true); // survived the reroll
  });

  it('Layaway fizzles on a board minion (it needs a shop offer), kept in hand', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 2, 2)], hand: [mkSpell('sp', 'layaway')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(true);
  });

  it('Second Draft: returns a friendly minion to hand INTACT (buffs kept), consuming the spell', () => {
    const m: BoardCard = { ...mkMinion('m1', 5, 5), buffs: [{ source: 'Test', attack: 3, health: 3, count: 1 }] };
    let s: RunState = { ...createRun(1), board: [m], hand: [mkSpell('sp', 'seconddraft')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    expect(s.board.find((c) => c.uid === 'm1')).toBeUndefined(); // left the board
    const inHand = s.hand.find((c) => c.uid === 'm1');
    expect(inHand && [inHand.attack, inHand.health]).toEqual([5, 5]);
    expect(inHand!.buffs).toHaveLength(1); // buffs preserved
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(false); // spell consumed
  });

  it('Second Draft fizzles on a Gilded (golden) minion', () => {
    const m: BoardCard = { ...mkMinion('m1', 5, 5), golden: true };
    let s: RunState = { ...createRun(1), board: [m], hand: [mkSpell('sp', 'seconddraft')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    expect(s.board.find((c) => c.uid === 'm1')).toBeTruthy(); // stayed on the board
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(true); // spell kept
  });
});

describe('spell batch — tranche B4 (transform / combat-pending)', () => {
  it('Strange Revision: transforms into a random same-tier minion, keeping bonus stats', () => {
    // sandbag is Tier 1, base 0/4. Give it +3/+3 above base (3/7), then transform.
    const m: BoardCard = { uid: 'm1', cardId: 'sandbag', tribe: 'neutral', attack: 3, health: 7, keywords: [], golden: false, buffs: [{ source: 'X', attack: 3, health: 3, count: 1 }] };
    let s: RunState = { ...createRun(1), board: [m], hand: [mkSpell('sp', 'strangerevision')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    const t = s.board.find((c) => c.uid === 'm1')!;
    expect(t.cardId).not.toBe('sandbag'); // became something else
    const nd = CARD_INDEX[t.cardId]!;
    expect(nd.tier).toBe(1); // same tier
    expect([t.attack, t.health]).toEqual([nd.attack + 3, nd.health + 3]); // new base + the old +3/+3 bonus
  });

  it('Marked Target: the enemy right-most minion enters combat with Taunt, then the mark clears', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 4, 4)], hand: [mkSpell('sp', 'markedtarget')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.markEnemyRightmostTaunt).toBe(true);
    s = reduce(s, { type: 'faceOmen' });
    const enemy = s.lastCombat!.initial.enemy;
    expect(enemy.length).toBeGreaterThan(0);
    expect(enemy[enemy.length - 1]!.keywords).toContain('T'); // right-most got Taunt
    expect(s.markEnemyRightmostTaunt).toBe(false); // spent by the fight
  });
});

describe('spell batch — Veinstorm + Hoardflame (live-scaling)', () => {
  it('Veinstorm: buffs every shop offer by your Ruby stats (1/1 + rubyBonus)', () => {
    let s: RunState = { ...createRun(1), setId: 'set2', rubyBonus: { attack: 2, health: 3 }, hand: [mkSpell('sp', 'veinstorm')] };
    const n = s.shop.length;
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.shop.length).toBe(n);
    expect(s.shop.every((o) => (o.atk ?? 0) === 3 && (o.hp ?? 0) === 4)).toBe(true); // 1+2 / 1+3
  });

  it('Veinstorm live text greens to the current Ruby value (base when no bonus)', () => {
    expect(spellDisplayText('veinstorm', 0, 0, 0, 0, 0, 0, { rubyBonus: { attack: 2, health: 3 } })).toContain('{{+3/+4}}');
    expect(spellDisplayText('veinstorm', 0)).toBe(CARD_INDEX['veinstorm']!.text);
  });

  it('Hoardflame: +4/+4 plus +1/+1 per Dragon played this turn', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 1, 1)], hand: [mkSpell('sp', 'hoardflame')], playedThisTurn: ['emissary', 'cinder'] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' });
    const m = s.board.find((c) => c.uid === 'm1')!;
    expect([m.attack, m.health]).toEqual([1 + 6, 1 + 6]); // +4/+4 base + 2 dragons × +1/+1
  });

  it('Hoardflame live text folds in dragons played this turn', () => {
    expect(spellDisplayText('hoardflame', 0, 0, 0, 0, 0, 0, { playedThisTurn: ['emissary', 'cinder'] })).toContain('{{+6/+6}}');
    expect(spellDisplayText('hoardflame', 0)).toBe(CARD_INDEX['hoardflame']!.text); // no dragons → base
  });
});

describe('spell batch — Encore + Open the Gates', () => {
  it("Encore: re-triggers a friendly minion's Echo (Deathrattle) out of combat", () => {
    let s: RunState = { ...createRun(1), board: [{ uid: 'p', cardId: 'pack', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false }], hand: [mkSpell('sp', 'encore')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'p' });
    // Mama Pup's Deathrattle summons 2 Pups without destroying it → board grows from 1 to 3.
    expect(s.board.filter((c) => c.cardId === 'pup').length).toBe(2);
    expect(s.board.some((c) => c.uid === 'p')).toBe(true); // the minion itself survives
  });

  it('Open the Gates: banks 3 Imps that enter the next combat', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1', 2, 2)], hand: [mkSpell('sp', 'openthegates')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.pendingSCImps).toBe(3);
    s = reduce(s, { type: 'faceOmen' });
    expect(s.lastCombat!.initial.player.filter((m) => m.cardId === 'impscrap').length).toBe(3);
    expect(s.pendingSCImps).toBe(0); // spent
  });

  it('Open the Gates respects the 7-slot cap', () => {
    // golden so 6 identical sandbags don't triple-combine (which would shrink the board and defeat the test)
    const board = Array.from({ length: 6 }, (_, i) => ({ ...mkMinion('m' + i, 1, 1), golden: true }));
    let s: RunState = { ...createRun(1), board, hand: [mkSpell('sp', 'openthegates')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    s = reduce(s, { type: 'faceOmen' });
    expect(s.lastCombat!.initial.player.filter((m) => m.cardId === 'impscrap').length).toBe(1); // only 1 free slot
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
