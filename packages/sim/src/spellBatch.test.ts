import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';
import { createRun, maxTierFor, poolOf, reduce, type BoardCard, type RunState } from './index';
import { offerBuyStats, spellDisplayText } from './recruit';

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

  it('Beyond the Summit: WITHOUT Tier-7 access it stops at Tier 6 (owner gate 2026-07-28)', () => {
    // It used to reach 7 in any run. The owner's ruling: Tier 7 needs the Summit rift, or a hero/quest that
    // grants access. A plain run gets the "one tier higher" Discover, capped at the normal ceiling.
    let s: RunState = { ...createRun(1), tier: 6, hand: [mkSpell('sp', 'beyondsummit')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.discover?.length ?? 0).toBeGreaterThan(0);
    expect(s.discover!.some((id) => CARD_INDEX[id]?.tier === 7), 'offered a Tier 7 with no access').toBe(false);
    expect(s.discover!.every((id) => (CARD_INDEX[id]?.tier ?? 0) >= 6)).toBe(true); // still top-tier biased
  });

  it('…and WITH access (the hero/quest flag) it reaches Tier 7 again', () => {
    // The control: without it, the assertion above would pass just as well against a Beyond the Summit that
    // was broken outright, or a Tier-7 pool that had gone empty.
    let s: RunState = { ...createRun(1), tier: 6, tier7Access: true, hand: [mkSpell('sp', 'beyondsummit')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.discover!.some((id) => CARD_INDEX[id]?.tier === 7), 'access granted but no Tier 7 offered').toBe(true);
  });

  it('…and the SUMMIT rift is the other route in', () => {
    let s: RunState = { ...createRun(1), tier: 6, rift: 'summit', hand: [mkSpell('sp', 'beyondsummit')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.discover!.some((id) => CARD_INDEX[id]?.tier === 7), 'Summit should reach Tier 7').toBe(true);
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

  it('Elevation Ritual: an offer AT the tier cap is re-rolled in place, not left untouched', () => {
    // The bug (owner 2026-07-24): a Tier-6 offer with no Tier 7 available fell through the "can't upgrade"
    // branch and was pushed back UNCHANGED — so the spell silently did nothing at the top of the curve.
    const base = createRun(6);
    const cap = maxTierFor(base.rift); // 6 without the Summit rift
    const t6 = poolOf(base).buyable.filter((c) => c.tier === cap && (c.tribe === 'neutral' || base.tribes.includes(c.tribe)));
    expect(t6.length).toBeGreaterThan(1); // needs room to roll something, else the assertion is vacuous
    let s: RunState = {
      ...base, tier: cap, hand: [mkSpell('sp', 'elevationritual')],
      shop: [{ uid: 'o1', cardId: t6[0]!.id }, { uid: 'o2', cardId: t6[1]!.id }],
    };
    const beforeUids = s.shop.map((o) => o.uid);
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.shop.length).toBe(2);
    // Still at the cap — it re-rolls within its own tier rather than climbing past it.
    expect(s.shop.every((o) => CARD_INDEX[o.cardId]!.tier === cap)).toBe(true);
    // Every slot REFRESHED: a fresh uid even if the card id happens to repeat (the owner's explicit ruling —
    // rolling the same minion still counts as a refresh, so uid is the honest signal, not cardId).
    expect(s.shop.every((o) => !beforeUids.includes(o.uid))).toBe(true);
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
    expect(s.shop.some((o) => o.uid === offer.uid && o.kept && o.cost === 2)).toBe(true); // survived the reroll THIS phase
  });

  it('Layaway: the keep does NOT persist through combat (cleared at faceOmen)', () => {
    const base = createRun(1);
    const offer = base.shop[0]!;
    let s: RunState = { ...base, embers: 100, hand: [mkSpell('sp', 'layaway')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: offer.uid });
    expect(s.shop.find((o) => o.uid === offer.uid)!.kept).toBe(true);
    s = reduce(s, { type: 'faceOmen' }); // go to combat
    // the offer's keep is cleared, so the next post-combat refresh would sweep it (it's no longer kept)
    expect(s.shop.find((o) => o.uid === offer.uid)?.kept ?? false).toBe(false);
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

describe('spell batch — Common Ground (two-target)', () => {
  it("averages two friendly minions' Attack and Health", () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('A', 6, 2), mkMinion('B', 2, 8)], hand: [mkSpell('sp', 'commonground')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'A' });
    expect(s.pendingTarget?.spellFirstUid).toBe('A'); // deferred for the second pick
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(true); // still in hand
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'B' });
    const A = s.board.find((c) => c.uid === 'A')!, B = s.board.find((c) => c.uid === 'B')!;
    expect([A.attack, A.health]).toEqual([4, 5]); // avg(6,2)=4 / avg(2,8)=5
    expect([B.attack, B.health]).toEqual([4, 5]);
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(false); // consumed
    expect(s.pendingTarget).toBeUndefined();
  });

  it('fizzles with no second minion (kept in hand)', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('A', 6, 2)], hand: [mkSpell('sp', 'commonground')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'A' });
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(true);
    expect(s.pendingTarget).toBeUndefined();
  });
});

describe('spell batch — tranche C (Discover-based)', () => {
  it('Hourglass Reserve: Discovers from your tier, locked until next turn', () => {
    let s: RunState = { ...createRun(3), tier: 3, hand: [mkSpell('sp', 'hourglassreserve')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.discover?.length ?? 0).toBeGreaterThan(0);
    expect(s.discover!.every((id) => CARD_INDEX[id]!.tier === 3)).toBe(true);
    s = reduce(s, { type: 'discover', index: 0 });
    const picked = s.hand[s.hand.length - 1]!;
    expect(picked.lockedUntilWave).toBe(s.wave + 1);
    const before = s.board.length;
    s = reduce(s, { type: 'play', uid: picked.uid, targetUid: undefined });
    expect(s.board.length).toBe(before); // play blocked this turn
    expect(s.hand.some((c) => c.uid === picked.uid)).toBe(true); // still in hand
  });

  it('Funeral on Loan: a borrowed Echo minion triggers its Deathrattle and is destroyed on play', () => {
    const borrowed: BoardCard = { uid: 'b', cardId: 'pack', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false, borrowed: true };
    let s: RunState = { ...createRun(1), board: [], hand: [borrowed] };
    s = reduce(s, { type: 'play', uid: 'b', targetUid: undefined });
    expect(s.board.some((c) => c.cardId === 'pack')).toBe(false); // never boarded
    expect(s.board.filter((c) => c.cardId === 'pup').length).toBe(2); // its Echo fired
    expect(s.hand.some((c) => c.uid === 'b')).toBe(false); // consumed
  });

  it('Funeral on Loan: a borrowed minion also fires its SHOUT — it is played, then destroyed', () => {
    // Owner 2026-07-24: only the Echo used to fire, so a Discovered minion carrying BOTH silently lost half
    // its text. Imp Overseer has both — Shout: your Imps get +2/+2; Echo: summon an Imp.
    const imp: BoardCard = { uid: 'i1', cardId: 'impscrap', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false };
    const borrowed: BoardCard = { uid: 'b', cardId: 'impoverseer', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false, borrowed: true };
    let s: RunState = { ...createRun(1), board: [imp], hand: [borrowed] };
    const [a0, h0] = [imp.attack, imp.health];

    s = reduce(s, { type: 'play', uid: 'b', targetUid: undefined });

    const survivor = s.board.find((c) => c.uid === 'i1')!;
    expect([survivor.attack - a0, survivor.health - h0]).toEqual([2, 2]); // the SHOUT fired
    expect(s.board.filter((c) => c.cardId === 'impscrap').length).toBe(2); // the ECHO fired (one summoned)
    expect(s.board.some((c) => c.cardId === 'impoverseer')).toBe(false); // still never boarded
    expect(s.hand.some((c) => c.uid === 'b')).toBe(false); // still consumed
  });

  it('Funeral on Loan: the Discover carries the borrowed flag onto an Echo minion', () => {
    let s: RunState = { ...createRun(4), tier: 4, hand: [mkSpell('sp', 'funeralonloan')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    if (s.discover?.length) {
      s = reduce(s, { type: 'discover', index: 0 });
      const picked = s.hand[s.hand.length - 1]!;
      expect(picked.borrowed).toBe(true);
      expect(CARD_INDEX[picked.cardId]!.effects.some((e) => e.on === 'onDeath')).toBe(true);
    }
  });

  it("Farseer's Report: scouts minions from the next opponent's warband", () => {
    const next = { v: 1, wave: 3, heroId: 'warden', resolve: 30, tier: 2, triples: 0, tribes: [], threat: 'glass', power: 4, minions: [{ cardId: 'alley', attack: 2, health: 2, keywords: [] }, { cardId: 'sandbag', attack: 0, health: 4, keywords: [] }], seed: 1, origin: 'synthetic' } as never;
    let s: RunState = { ...createRun(3), wave: 3, servedBoards: { 3: next }, hand: [mkSpell('sp', 'farseersreport')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.scoutedNextOpponent?.length).toBe(2); // board has 2 minions (< the 3 requested)
    expect(s.scoutedNextOpponent!.map((m) => m.cardId).sort()).toEqual(['alley', 'sandbag']);
    // the scout reveal is a modal (blocks the board) until dismissed via closeScout
    s = reduce(s, { type: 'closeScout' });
    expect(s.scoutedNextOpponent).toBeUndefined();
  });

  it("Rival's Reflection: Discovers a plain copy from the last opponent's board", () => {
    const last = { v: 1, wave: 1, heroId: 'warden', resolve: 30, tier: 2, triples: 0, tribes: [], threat: 'glass', power: 4, minions: [{ cardId: 'alley', attack: 2, health: 2, keywords: [] }], seed: 1, origin: 'synthetic' } as never;
    let s: RunState = { ...createRun(2), wave: 2, servedBoards: { 1: last }, hand: [mkSpell('sp', 'rivalsreflection')] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.discover).toEqual(['alley']);
  });
});

describe('spell batch — Veinstorm + Hoardflame (live-scaling)', () => {
  it('Veinstorm: PERMANENTLY buffs the Shop by your Ruby stats — current offers and future ones', () => {
    // Owner 2026-07-24: it's a permanent tavern buff, not a one-shot on the offers standing at cast time.
    // It routes through `tavernBuyBonus`, so a reroll no longer wipes it — the failure mode before this.
    let s: RunState = { ...createRun(1), setId: 'set2', embers: 99, rubyBonus: { attack: 2, health: 3 }, hand: [mkSpell('sp', 'veinstorm')] };
    const n = s.shop.length;
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: undefined });
    expect(s.shop.length).toBe(n);
    expect(s.tavernBuyBonus).toEqual({ atk: 3, hp: 4 }); // 1+2 / 1+3

    // Every CURRENT offer already reads the buff through `offerBuyStats`…
    for (const o of s.shop) {
      const def = CARD_INDEX[o.cardId]!;
      const st = offerBuyStats(s, o);
      expect([st.attack - def.attack, st.health - def.health]).toEqual([3, 4]);
    }
    // …and so does a shop drawn AFTER a reroll, which used to lose it entirely.
    s = reduce(s, { type: 'roll' });
    expect(s.tavernBuyBonus).toEqual({ atk: 3, hp: 4 });
    for (const o of s.shop) {
      const def = CARD_INDEX[o.cardId]!;
      const st = offerBuyStats(s, o);
      expect([st.attack - def.attack, st.health - def.health]).toEqual([3, 4]);
    }
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

describe('spell batch — Open the Gates', () => {
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

describe('run-wide card-type auras survive stat-setting spells (owner ruling 2026-07-29)', () => {
  /**
   * A `buffCardTypeRunWide` accrual (Spear Warden's "+X/+X to all Spear Wardens") belongs to the CARD TYPE for
   * the rest of the run, and it is baked into the instance's displayed stats. A spell that SETS stats used to
   * overwrite that total, silently eating the accrual — so casting Perfect Vision on a heavily-buffed Warden
   * made it WEAKER than an unbuffed copy. The rule: the spell writes TRUE stats, the aura re-applies on top.
   */
  const wardenWithAura = (auraAtk: number, auraHp: number, trueAtk = 3, trueHp = 3): RunState => {
    const warden: BoardCard = {
      uid: 'w', cardId: 'knit', tribe: 'undead',
      attack: trueAtk + auraAtk, health: trueHp + auraHp, // displayed = true + aura, as the run bakes it
      keywords: [], golden: false,
      buffs: [{ source: 'Spear Warden', attack: auraAtk, health: auraHp, count: 1 }],
    };
    return { ...createRun(1), board: [warden], cardBuffs: { knit: { attack: auraAtk, health: auraHp } } };
  };

  it("Perfect Vision on a 20/20 aura'd Spear Warden leaves it at 37/37, not 20/20", () => {
    // The owner's worked example: 3/3 of its own + 17/17 aura reads as 20/20; Perfect Vision sets TRUE stats
    // to 20/20, then the aura lifts it to 37/37.
    let s = wardenWithAura(17, 17);
    const pv = CARD_INDEX['perfectvision']!;
    s.hand = [{ uid: 'pv', cardId: pv.id, tribe: pv.tribe, attack: 0, health: 1, keywords: [], golden: false }];
    s = reduce(s, { type: 'play', uid: 'pv', targetUid: 'w' });
    const w = s.board.find((c) => c.uid === 'w')!;
    expect(w.attack, 'the aura was eaten by the set').toBe(37);
    expect(w.health).toBe(37);
  });

  it('Common Ground averages DISPLAYED stats, then re-applies each aura', () => {
    // Warden shows 20/20 (3/3 + 17/17), partner is a 1/1 with no aura. Average is 10/10 (rounded 10.5 → 11
    // for the raw average of 21; the assertion pins whatever the shared rounding produces, plus the aura).
    let s = wardenWithAura(17, 17);
    const partner: BoardCard = { uid: 'p', cardId: 'impscrap', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false };
    s = { ...s, board: [...s.board, partner] };
    const cg = CARD_INDEX['commonground']!;
    s.hand = [{ uid: 'cg', cardId: cg.id, tribe: cg.tribe, attack: 0, health: 1, keywords: [], golden: false }];
    s = reduce(s, { type: 'play', uid: 'cg', targetUid: 'w' });
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'p' });
    const w = s.board.find((c) => c.uid === 'w')!;
    const p = s.board.find((c) => c.uid === 'p')!;
    const avg = Math.round((20 + 1) / 2);
    expect(p.attack, 'the un-aura’d partner should sit at the plain average').toBe(avg);
    expect(w.attack, 'the Warden should be the average PLUS its aura').toBe(avg + 17);
  });

  it('a minion with no run-wide aura is unaffected by the rule', () => {
    // Guard against the fix leaking a phantom bonus onto ordinary minions.
    let s: RunState = { ...createRun(1), board: [{ uid: 'm', cardId: 'impscrap', tribe: 'demon', attack: 5, health: 5, keywords: [], golden: false }] };
    const pv = CARD_INDEX['perfectvision']!;
    s.hand = [{ uid: 'pv', cardId: pv.id, tribe: pv.tribe, attack: 0, health: 1, keywords: [], golden: false }];
    s = reduce(s, { type: 'play', uid: 'pv', targetUid: 'm' });
    expect(s.board.find((c) => c.uid === 'm')!.attack).toBe(20);
  });
});

describe('Funeral on Loan keeps an unplayed borrowed card (owner 2026-07-29)', () => {
  it('a borrowed card survives end of turn and is still playable later', () => {
    // It used to be filtered out of hand at turn end, so Discovering an Echo minion you could not use that
    // turn simply destroyed it. The loan has no deadline now — only playing it consumes it.
    const borrowed: BoardCard = { uid: 'b', cardId: 'pack', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false, borrowed: true };
    let s: RunState = { ...createRun(1), board: [], hand: [borrowed] };
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'settleCombat' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.some((c) => c.uid === 'b'), 'the borrowed card was discarded at turn end').toBe(true);
    expect(s.hand.find((c) => c.uid === 'b')!.borrowed, 'it should still be a loan').toBe(true);
    // …and playing it on this later turn still triggers the Echo and consumes it.
    s = reduce(s, { type: 'play', uid: 'b', targetUid: undefined });
    expect(s.hand.some((c) => c.uid === 'b')).toBe(false);
    expect(s.board.filter((c) => c.cardId === 'pup').length).toBe(2);
  });
});
