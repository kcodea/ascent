/**
 * ANCIENTS × DARAH (owner pairings 2026-10-06). Swap = "Swap a friendly minion with a random minion in the Shop." (free,
 * once per turn). Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, ANCIENT_SWAP_CHARGE_FLAG, ancientCombatMods, ancientOfferText, ancientSwapUsesBadge, createRun, enableAncients, heldOfferPrice,
  heroPowerText, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState, type ShopCard,
} from './index';

const BASE = 'Swap a friendly minion with a random minion in the Shop.';
const plain = (c: (typeof CARD_INDEX)[string]) => !!c && !c.spell && !c.ruby && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe;
const NEUTRALS = Object.values(CARD_INDEX).filter((c) => plain(c) && c.tribe === 'neutral' && !c.tribe2 && !c.henchman).map((c) => c.id);
const N = (i: number) => NEUTRALS[i % NEUTRALS.length]!;
/** A minion whose ONLY effect is an Echo that summons (so a fired Echo is visible as new board bodies). */
const ECHO = Object.values(CARD_INDEX).find((c) => !!c && !c.spell && !c.token && !c.ruby && c.effects.length === 1
  && c.effects[0]!.on === 'onDeath' && c.effects[0]!.do === 'deathrattleSummon')!.id;

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const offer = (uid: string, cardId: string): ShopCard => ({ uid, cardId } as ShopCard);
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'darah'), phase: 'recruit', embers: 99, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const swap = (s: RunState, uid: string): RunState => reduce(s, { type: 'heroPower', uid });
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const events = (s: RunState): CombatEvent[] => s.lastCombat!.events as CombatEvent[];
const chargeFlags = (s: RunState) => events(s).filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === ANCIENT_SWAP_CHARGE_FLAG);
/** One friendly minion `a` and one Shop minion `o` (so the random pick is forced). */
const scene = (id: AncientId, mine: BoardCard, shopId = N(1), over: Partial<RunState> = {}): RunState =>
  picked(id, { wave: 3, board: [mine], shop: [offer('o', shopId)], ...over });
const heldOf = (s: RunState) => s.shop.find((o) => o.held)!;

describe('Darah × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('darah', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('darah', id)).not.toMatch(/—|--/);
    }
  });
  it('without Ancients, Swap is unchanged: no Echo, no copy, the held offer costs the flat price, once per turn', () => {
    let s = base({ wave: 3, board: [card('a', ECHO)], shop: [offer('o', N(1)), offer('p', N(2))] });
    s = swap(s, 'a');
    expect(s.board.length).toBe(1);
    expect(s.hand.length).toBe(0);
    expect(heldOfferPrice(s, heldOf(s))).toBe(3);
    expect(swap(s, s.board[0]!.uid)).toBe(s);
  });
});

describe('Darah × DEATH: "Swapping an Echo minion triggers its effect first."', () => {
  it('an Echo minion fires its Echo (its summons land on the board) before it leaves for the Shop', () => {
    const s0 = scene('death', card('a', ECHO));
    expect(heroPowerText(s0)).toBe(`${BASE} If it has an **Echo**, its **Echo** triggers first.`);
    const s = swap(s0, 'a');
    expect(heldOf(s).held!.cardId).toBe(ECHO);
    expect(s.board.some((c) => c.cardId === N(1))).toBe(true);
    expect(s.board.length).toBeGreaterThan(1); // the Echo's summons stayed
    expect(s.deathrattlesTriggered).toBeGreaterThan(s0.deathrattlesTriggered ?? 0);
  });
  it('a minion without an Echo swaps plainly', () => {
    const s = swap(scene('death', card('a', N(0))), 'a');
    expect(s.board.map((c) => c.cardId)).toEqual([N(1)]);
  });
  it('a swap that cannot happen (no Shop minion) discards the Echo with it: nothing changes, the power stays ready', () => {
    const s0 = scene('death', card('a', ECHO), N(1), { shop: [] });
    expect(swap(s0, 'a')).toBe(s0);
  });
});

describe('Darah × FORTUNE: "Swapped minions are free."', () => {
  it('the minion Swap sends to the Shop buys back for 0 Gold (the coin and the buy agree), intact', () => {
    let s = swap(scene('fortune', card('a', N(0), { attack: 9, health: 9 })), 'a');
    const held = heldOf(s);
    expect(held.swapFree).toBe(true);
    expect(heldOfferPrice(s, held)).toBe(0);
    const gold = s.embers;
    s = reduce(s, { type: 'buy', uid: held.uid });
    expect(s.embers).toBe(gold);
    expect(s.hand.find((c) => c.cardId === N(0))).toMatchObject({ attack: 9, health: 9 });
  });
  it('another pairing leaves the held offer at the flat price', () => {
    const s = swap(scene('genesis', card('a', N(0))), 'a');
    expect(heldOfferPrice(s, heldOf(s))).toBe(3);
  });
});

describe('Darah × WAR: "Pummel (140): Get a charge of Swap. (Once per combat.)"', () => {
  it('the first 140 crossed in a fight pays ONE charge (live flag), later crossings are spent; the tally carries', () => {
    let s = picked('war', { wave: 3, board: [card('a', N(0), { attack: 100, health: 900 }), card('b', N(1), { attack: 100, health: 900 })] });
    expect(heroPowerText(s)).toBe(`${BASE} **Pummel (140):** get a charge of Swap. Once per combat. Counts damage dealt by all your minions (**0/140**). Each charge is one more Swap (**0** banked).`);
    expect(ancientCombatMods(s).ancientPummelCharge).toEqual({ every: 140, dealt: 0, flag: ANCIENT_SWAP_CHARGE_FLAG, label: 'Ancient of War' });
    s = fightNow(s, 1, 3000);
    const dealt = s.lastCombat!.playerAncientPummelDealt!;
    expect(dealt).toBeGreaterThanOrEqual(280); // crossed at least twice
    expect(chargeFlags(s).length).toBe(1);
    expect(heroPowerText(s, 0, { swapCharges: 1 })).toContain('(**1** banked)');
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.pummelDealt).toBe(dealt);
    expect(s.ancients!.darahCharges).toBe(1);
    expect(heroPowerText(s)).toContain(`(**${dealt % 140}/140**)`);
    expect(heroPowerText(s, 0, { friendlyDamage: 1 })).toContain(`(**${(dealt + 1) % 140}/140**)`);
  });
  it('a banked charge is one more Swap once the turn\'s own is spent; with none left the power is refused', () => {
    let s = picked('war', { wave: 3, board: [card('a', N(0)), card('b', N(2))], shop: [offer('o', N(1)), offer('p', N(3)), offer('q', N(4))] });
    s = { ...s, ancients: { ...s.ancients!, darahCharges: 1 } };
    expect(ancientSwapUsesBadge(s)).toBe(2);
    s = swap(s, 'a');
    expect(s.heroReady).toBe(false);
    expect(s.ancients!.darahCharges).toBe(1);
    s = swap(s, 'b');
    expect(s.ancients!.darahCharges).toBe(0);
    expect(s.board.map((c) => c.cardId)).not.toContain(N(2));
    expect(swap(s, s.board[0]!.uid)).toBe(s);
  });
  it('the tally carried in counts toward the crossing', () => {
    let s = picked('war', { wave: 3, board: [card('a', N(0), { attack: 10, health: 500 })] });
    s = { ...s, ancients: { ...s.ancients!, pummelDealt: 135 } };
    s = fightNow(s, 1, 10);
    expect(chargeFlags(s).length).toBe(1);
  });
});

describe('Darah × GENESIS: "Swap grants a copy of the minion swapped with."', () => {
  it('Swap also gives a plain copy of the minion it brought in from the Shop', () => {
    const s = swap(scene('genesis', card('a', N(0))), 'a');
    expect(s.board.map((c) => c.cardId)).toEqual([N(1)]);
    expect(s.hand.map((c) => c.cardId)).toEqual([N(1)]);
    expect(s.hand[0]!.attack, 'plain').toBe(CARD_INDEX[N(1)]!.attack);
    expect(heroPowerText(s)).toBe(`${BASE} You also get a plain copy of the minion it brings in.`);
  });
});

describe('Darah × TIME: "End of Turn: Get a copy of the minion you swapped."', () => {
  it('End of Turn: a plain copy of the minion Swap sent to the Shop this turn; no Swap, nothing', () => {
    let s = scene('time', card('a', N(0), { attack: 20, health: 20 }));
    expect(heroPowerText(s)).toContain('Nothing swapped this turn.');
    s = swap(s, 'a');
    expect(heroPowerText(s)).toContain(`This turn: **${CARD_INDEX[N(0)]!.name}**.`);
    s = fightNow(s);
    expect(s.hand.map((c) => c.cardId)).toEqual([N(0)]);
    expect(s.hand[0]!.attack, 'plain').toBe(CARD_INDEX[N(0)]!.attack);
    expect(fightNow(scene('time', card('a', N(0)))).hand.length).toBe(0);
  });
  it('two Swaps in a turn copy the LAST minion sent away', () => {
    let s = picked('time', { wave: 3, board: [card('a', N(0)), card('b', N(2))], shop: [offer('o', N(1))] });
    s = swap(s, 'a');
    s = { ...s, heroReady: true }; // a second Swap this turn (as War's charge would allow)
    s = swap(s, 'b');
    expect(s.ancients!.darahSwapped).toEqual({ wave: 3, cardId: N(2) });
  });
});

describe('Darah × BONDS: "Swapped minions gain each others stats."', () => {
  it('the incoming minion gains the outgoing\'s stats and the outgoing (held) body gains the incoming\'s', () => {
    const inDef = CARD_INDEX[N(1)]!;
    let s = swap(scene('bonds', card('a', N(0), { attack: 7, health: 11 })), 'a');
    expect(s.board[0]).toMatchObject({ cardId: N(1), attack: inDef.attack + 7, health: inDef.health + 11 });
    expect(heldOf(s).held).toMatchObject({ attack: 7 + inDef.attack, health: 11 + inDef.health });
    s = reduce(s, { type: 'buy', uid: heldOf(s).uid });
    expect(s.hand.find((c) => c.cardId === N(0))).toMatchObject({ attack: 7 + inDef.attack, health: 11 + inDef.health });
  });
});

describe('Darah × save / restore and determinism', () => {
  it('the counters survive a JSON round trip', () => {
    let s = swap(scene('time', card('a', N(0))), 'a');
    s = JSON.parse(JSON.stringify(s)) as RunState;
    expect(heroPowerText(s)).toContain(`This turn: **${CARD_INDEX[N(0)]!.name}**.`);
    let w = picked('war', { wave: 3 });
    w = JSON.parse(JSON.stringify({ ...w, ancients: { ...w.ancients!, darahCharges: 2 } })) as RunState;
    expect(heroPowerText(w)).toContain('(**2** banked)');
  });
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, board: [card('a', ECHO, { attack: 80, health: 3 }), card('b', N(6), { attack: 80, health: 2 })], shop: [offer('o', N(1)), offer('p', N(2)), offer('q', N(3))] });
        s = { ...s, ancients: { ...s.ancients!, pummelDealt: 130 } };
        s = swap(s, 'a');
        return reduce(fightNow(s, 60, 1000), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
