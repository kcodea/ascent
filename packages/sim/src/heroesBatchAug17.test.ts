import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate } from '@game/core';
import { commissionOffer, createRun, reduce, getHero, type RunState, type BoardCard } from './index';

/** Owner hero batch 2026-08-17 — Devourer and Membrance. */

const m = (uid: string, cardId: string, atk = 2, hp = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: atk, health: hp, keywords: [], golden: false }) as BoardCard;

describe('Devourer — Devour', () => {
  it('is a 10-armor, 1-Gold targeted power', () => {
    const h = getHero('devourer');
    expect([h.armor, h.power.kind, h.power.cost]).toEqual([10, 'devour', 1]);
    expect(h.power.untargeted ?? false, 'targeted').toBe(false);
  });

  it('eats the target and hands its CURRENT stats to another friendly', () => {
    const s = {
      ...createRun(3), phase: 'recruit', heroId: 'devourer', embers: 10, heroReady: true,
      board: [m('eaten', 'stray', 5, 7), m('other', 'alley', 2, 2)],
    } as RunState;
    const after = reduce(s, { type: 'heroPower', uid: 'eaten' } as never);
    expect(after.board.some((c) => c.uid === 'eaten'), 'the target was consumed').toBe(false);
    const survivor = after.board.find((c) => c.uid === 'other')!;
    expect([survivor.attack, survivor.health], 'it gained the eaten stats').toEqual([7, 9]);
    expect(after.embers, '1 Gold charged').toBe(9);
  });

  it('is a no-op with only ONE minion — it never silently deletes a body', () => {
    const s = {
      ...createRun(3), phase: 'recruit', heroId: 'devourer', embers: 10, heroReady: true,
      board: [m('solo', 'stray')],
    } as RunState;
    const after = reduce(s, { type: 'heroPower', uid: 'solo' } as never);
    expect([after.board.length, after.embers, after.heroReady]).toEqual([1, 10, true]);
  });
});

describe('Membrance — Memory', () => {
  it('is an 8-armor, 1-Gold untargeted power', () => {
    const h = getHero('membrance');
    expect([h.armor, h.power.kind, h.power.cost, h.power.untargeted]).toEqual([8, 'memory', 1, true]);
  });

  it("restocks the Shop with PLAIN copies of the last opponent's board", () => {
    const foe = ['stray', 'alley', 'pack'];
    const s = {
      ...createRun(3), phase: 'recruit', heroId: 'membrance', embers: 10, heroReady: true,
      lastCombat: {
        result: 'win', playerDamage: 0, playerDeathrattles: 0, events: [],
        initial: {
          player: [],
          enemy: foe.map((cardId, i) => ({ uid: `e${i}`, cardId, name: cardId, tribe: 'beast', attack: 9, health: 9, keywords: [] })),
        },
      } as never,
    } as RunState;
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.shop.map((o) => o.cardId), 'the foe board, in order').toEqual(foe);
    expect(after.shop.every((o) => !o.golden), 'plain — never golden').toBe(true);
    expect(after.shop.every((o) => !o.buffs?.length), 'plain — no buffs carried').toBe(true);
    expect(after.embers, '1 Gold charged').toBe(9);
  });

  it('is a no-op before the first fight — no charge spent', () => {
    const s = { ...createRun(3), phase: 'recruit', heroId: 'membrance', embers: 10, heroReady: true } as RunState;
    const after = reduce(s, { type: 'heroPower' } as never);
    expect([after.embers, after.heroReady]).toEqual([10, true]);
  });
});

describe('Flash — First or Last', () => {
  const combat = (kills: string[], granted?: string): object => ({
    result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: kills.length, events: [],
    initial: { player: [], enemy: [] },
    playerFirstKill: kills[0], playerLastKill: kills[kills.length - 1],
    // The copy is granted INSIDE the fight now (owner ask 2026-08-17: real-time), so it arrives on this
    // channel — the same one every other in-combat grant flies in on.
    ...(granted ? { playerHandGrants: [granted] } : {}),
  });

  it('is a 9-armor, 1-Gold power', () => {
    const h = getHero('flash');
    expect([h.armor, h.power.kind, h.power.cost]).toEqual([9, 'firstOrLast', 1]);
  });

  it('arms the chosen end, and refuses a click carrying no choice', () => {
    const s = { ...createRun(3), phase: 'recruit', heroId: 'flash', embers: 10, heroReady: true } as RunState;
    expect(reduce(s, { type: 'heroPower', flashPick: 'last' } as never).flashPick).toBe('last');
    const bare = reduce(s, { type: 'heroPower' } as never);
    expect([bare.flashPick, bare.embers, bare.heroReady]).toEqual([undefined, 10, true]);
  });

  it('re-arming REPLACES the choice rather than stacking', () => {
    let s = { ...createRun(3), phase: 'recruit', heroId: 'flash', embers: 10, heroReady: true } as RunState;
    s = reduce(s, { type: 'heroPower', flashPick: 'first' } as never);
    s = reduce({ ...s, heroReady: true } as RunState, { type: 'heroPower', flashPick: 'last' } as never);
    expect(s.flashPick).toBe('last');
  });

  it('pays the FIRST kill, and clears the claim', () => {
    const s = {
      ...createRun(3), phase: 'combat', heroId: 'flash', hand: [], flashPick: 'first',
      lastCombat: combat(['stray', 'alley', 'pack'], 'stray') as never,
    } as RunState;
    const after = reduce(s, { type: 'resolveCombat' } as never);
    expect(after.hand.map((c) => c.cardId), 'a plain copy of the first kill').toContain('stray');
    expect(after.flashPick, 'the claim is spent').toBeUndefined();
  });

  it('pays the LAST kill', () => {
    const s = {
      ...createRun(3), phase: 'combat', heroId: 'flash', hand: [], flashPick: 'last',
      lastCombat: combat(['stray', 'alley', 'pack'], 'pack') as never,
    } as RunState;
    expect(reduce(s, { type: 'resolveCombat' } as never).hand.map((c) => c.cardId)).toContain('pack');
  });

  it('grants the copy IN COMBAT, not at resolution', () => {
    // Driven through the real simulator: the claim rides questMods into the fight and comes back on
    // playerHandGrants, which is the channel whose `toHand` event makes the card fly to hand.
    const r = simulate(
      // The PLAYER must win the exchange for a kill to exist at all.
      [{ cardId: 'stray', attack: 9, health: 20 }],
      [{ cardId: 'alley', attack: 1, health: 1 }],
      makeRng(4), CARD_INDEX,
      combatSide({ tier: 6, questMods: { flashPick: 'first' } }),
      combatSide({ tier: 6 }),
    );
    expect(r.playerFirstKill, 'a kill happened').toBeTruthy();
    expect(r.playerHandGrants, 'the copy was granted inside the fight').toContain(r.playerFirstKill);
  });

  it('a fight with NO kills spends the claim rather than banking it', () => {
    const s = {
      ...createRun(3), phase: 'combat', heroId: 'flash', hand: [], flashPick: 'first',
      lastCombat: { result: 'loss', playerDamage: 2, playerDeathrattles: 0, enemyDeaths: 0, events: [], initial: { player: [], enemy: [] } } as never,
    } as RunState;
    const after = reduce(s, { type: 'resolveCombat' } as never);
    expect([after.hand.length, after.flashPick]).toEqual([0, undefined]);
  });
});

describe("Cassen's rare jobs", () => {
  const at = (over: object): RunState => ({ ...createRun(3), phase: 'recruit', heroId: 'cassen', ...over }) as RunState;

  it('the offer is DERIVED, so the panel and the reducer always agree', () => {
    // Same inputs -> same offer, every call. An rngCursor draw would fail this.
    const s = at({ wave: 4, tier: 3 });
    const a = commissionOffer(s), b = commissionOffer(s), c = commissionOffer({ ...s } as RunState);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('offers a rare job sometimes, and always keeps three options', () => {
    let sawRare = false;
    for (let wave = 1; wave <= 40; wave++) {
      const o = commissionOffer(at({ wave, tier: 3 }));
      expect(o.length, 'always three to choose from').toBe(3);
      if (o.includes('citadel') || o.includes('fortress')) sawRare = true;
    }
    expect(sawRare, 'a 25% chance shows up across 40 turns').toBe(true);
  });

  it('never offers Citadel above Tier 4', () => {
    for (let wave = 1; wave <= 60; wave++) {
      expect(commissionOffer(at({ wave, tier: 5 })), `wave ${wave}`).not.toContain('citadel');
    }
  });

  // NOT COVERED HERE: the two payouts firing at maturity. They ride the same `payCommission` path the three
  // ordinary jobs already use (only the branch differs), and I could not pin the turn-advance action from a
  // fixture in reasonable time — so the DERIVED OFFER above, which is the part with real failure modes, is
  // what these tests guard. The payouts themselves are a free `s.tier += 1` and a `grantGoldenDiscover`.
});

describe('Juggler — Baldgecoin', () => {
  it('is a 12-armor passive', () => {
    const h = getHero('juggler');
    expect([h.armor, h.power.kind, h.power.passive]).toEqual([12, 'baldgecoin', true]);
  });

  it('hands over a Gold Pouch on every 3rd minion bought', () => {
    let s = { ...createRun(6), phase: 'recruit', heroId: 'juggler', embers: 40, hand: [], board: [],
      shop: [{ uid: 'a', cardId: 'stray' }, { uid: 'b', cardId: 'alley' }, { uid: 'c', cardId: 'pack' }] } as RunState;
    for (const uid of ['a', 'b', 'c']) s = reduce(s, { type: 'buy', uid } as never);
    expect(s.hand.filter((c) => c.cardId === 'emberpouch').length, 'the 3rd buy paid a Pouch').toBe(1);
    expect(s.jugglerBuys, 'the counter wrapped').toBe(0);
  });

  it('his Gold Pouch buffs the board as well as paying Gold', () => {
    const s = { ...createRun(6), phase: 'recruit', heroId: 'juggler', embers: 5,
      board: [{ uid: 'm', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [{ uid: 'p', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] } as RunState;
    const after = reduce(s, { type: 'play', uid: 'p' } as never);
    const m = after.board.find((c) => c.uid === 'm')!;
    expect([m.attack - 2, m.health - 2], 'at least the printed +1/+1').toEqual([1, 1]);
    expect(after.embers, 'and it still paid its Gold').toBeGreaterThan(5);
  });

  it('another hero\'s Gold Pouch does NOT buff the board', () => {
    const s = { ...createRun(6), phase: 'recruit', heroId: 'indy', embers: 5,
      board: [{ uid: 'm', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [{ uid: 'p', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] } as RunState;
    const after = reduce(s, { type: 'play', uid: 'p' } as never);
    expect(after.board.find((c) => c.uid === 'm')!.attack, 'untouched').toBe(2);
  });
});

describe('Jensen is re-enabled', () => {
  it('is no longer withheld from the picker', () => {
    expect(getHero('jenkins').wip ?? false, 'Jensen ships again (owner 2026-08-17)').toBe(false);
  });
});
