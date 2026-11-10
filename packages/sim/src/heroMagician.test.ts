/**
 * MAGICIAN (owner 2026-11-10, R-DUOS-MAGICIAN-01): "magician - 8 armor, magic hat - when you buy 5 cards, your hat is
 * activated. The next card you buy, your teammate gets a copy of it." + "Add a twice per turn max to magician". A
 * Duos-only passive hero. Every case runs through the real reducer, on two teammates' runs where a copy travels.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { makeRng } from '@game/core';
import { reduce } from './reducer';
import { handCap, serialize, type BoardCard, type RunState, type ShopCard } from './state';
import { getHero, playableHeroes, powerDiscoverPool, practiceHeroes } from './heroes';
import { createVersusRun, buildVersusCandidate, versusHeroRerollCandidates } from './versus/run';
import { versusDisjointHeroOffers, versusHeroShuffle } from './versus/heroOffers';
import { resolveVersusDuosRound } from './versus/duos';
import type { VersusRoomOptions } from './versus/options';
import { duosWaitingCount, duosWireOf } from './duosPass';
import { heroPowerText } from './recruit';
import { snapshotBoard } from './snapshot';
import { sideFromSnapshot } from './boardSide';
import { MAGIC_HAT_BUYS, MAGIC_HAT_PER_TURN, magicHatView } from './magicHat';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };

/** Distinct plain Tier 1 minions (no effects), so six buys never make a triple and nothing else moves. */
const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.tier <= 2 && c.effects.length === 0).map((c) => c!.id);
const SPELL = Object.values(CARD_INDEX).find((c) => c && c.spell && !c.ruby && !c.token && !c.duos && (c.cost ?? 0) <= 3)!.id;
const offer = (i: number, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${i}`, cardId: PLAIN[i % PLAIN.length]!, ...over });
const offers = (n: number): ShopCard[] => Array.from({ length: n }, (_, i) => offer(i));

function magician(over: Partial<RunState> = {}, seed = 11): RunState {
  return { ...createVersusRun(seed, 'magician', 'set2', DUOS), hand: [], board: [], embers: 100, shop: offers(7), spell: null, ...over };
}
function mate(over: Partial<RunState> = {}, seed = 12): RunState {
  return { ...createVersusRun(seed, 'warden', 'set2', DUOS), hand: [], board: [], embers: 10, ...over };
}
/** Buy the offer `uid`, then empty the hand (so the hand cap never stops the next buy). */
const buy = (s: RunState, uid: string): RunState => ({ ...reduce(s, { type: 'buy', uid }), hand: [] });
/** Buy offers `s<from>` .. `s<to - 1>` of a fresh row each. */
function buyN(s: RunState, n: number, start = 0): RunState {
  let out = s;
  for (let i = 0; i < n; i++) out = buy({ ...out, shop: [offer(start + i)] }, `s${start + i}`);
  return out;
}
function ship(from: RunState, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: 'p1', seq: e.seq, card: duosWireOf(e) });
  return out;
}
const nextTurn = (s: RunState): RunState => ({ ...s, wave: s.wave + 1 });

describe('the hero: Duos only, 8 Armor, a passive power', () => {
  it('prints what the owner asked for', () => {
    const h = getHero('magician');
    expect(h.id).toBe('magician');
    expect(h.name).toBe('Magician');
    expect(h.armor).toBe(8);
    expect(h.duosOnly).toBe(true);
    expect(h.power).toMatchObject({ name: 'Magic Hat', kind: 'magicHat', passive: true });
    expect(h.power.text).not.toMatch(/—|--|Oath|climb/);
    expect(MAGIC_HAT_BUYS).toBe(5);
    expect(MAGIC_HAT_PER_TURN).toBe(2);
  });

  it('is never offered outside a team mode: not solo, Practice, Mimic, Void or Power Shifter', () => {
    expect(playableHeroes().some((h) => h.id === 'magician')).toBe(false);
    expect(practiceHeroes().some((h) => h.id === 'magician')).toBe(false);
    expect(powerDiscoverPool('mimic')).not.toContain('magician'); // Mimic, and the Power Shifter spell (the same list)
    expect(powerDiscoverPool('void')).not.toContain('magician');
    expect(versusHeroShuffle(5, 6, 'set2')).not.toContain('magician');
    expect(versusHeroRerollCandidates(6, 'set2', [])).not.toContain('magician');
  });

  it('joins the deal, and the re-roll list, of a team mode only', () => {
    expect(playableHeroes(undefined, { duos: true }).map((h) => h.id)).toEqual([...playableHeroes().map((h) => h.id), 'priestess', 'magician']);
    expect(versusHeroShuffle(5, 6, 'set2', { duos: true })).toContain('magician');
    expect(versusHeroRerollCandidates(6, 'set2', [], { duos: true })).toContain('magician');
    const seats = (n: number): { heroSeed: number; runSeed: number }[] => Array.from({ length: 4 }, (_, i) => ({ heroSeed: n + i, runSeed: 100 + i }));
    const offered = (duos: boolean): boolean => Array.from({ length: 60 }, (_, n) => versusDisjointHeroOffers(seats(n * 7), 'set2', undefined, { duos }).flat()).flat().includes('magician');
    expect(offered(true)).toBe(true);
    expect(offered(false)).toBe(false);
  });

  it('a solo deal is the deal of before', () => {
    expect(versusHeroShuffle(5, 6, 'set2', { duos: false })).toEqual(versusHeroShuffle(5, 6, 'set2'));
  });

  it('a heroPower action does nothing (a passive power: no free Fortify, no charge spent)', () => {
    const s = magician({ board: [{ uid: 'm0', cardId: PLAIN[0]!, tribe: CARD_INDEX[PLAIN[0]!]!.tribe, attack: 1, health: 1, keywords: [], golden: false }] });
    const after = reduce(s, { type: 'heroPower', uid: 'm0' });
    expect(after.board[0]).toMatchObject({ attack: 1, health: 1 });
  });
});

describe('the counter: Shop buys only, across turns, to 5', () => {
  it('each Shop buy counts one; the count carries across turns and the hat activates at 5', () => {
    let s = magician();
    expect(magicHatView(s)).toMatchObject({ count: 0, active: false });
    s = buyN(s, 3);
    expect(magicHatView(s)).toMatchObject({ count: 3, active: false });
    s = nextTurn(s);
    expect(magicHatView(s).count).toBe(3); // carried
    s = buyN(s, 2, 3);
    expect(magicHatView(s)).toMatchObject({ count: 5, active: true, left: 2 });
    expect(s.duos!.outbox).toEqual([]); // five buys sent nothing
  });

  it('a spell bought from the slot and one bought from the row both count', () => {
    let s = magician({ spell: { uid: 'sp0', cardId: SPELL } });
    s = buy(s, 'sp0');
    expect(magicHatView(s).count).toBe(1);
    s = buy({ ...s, shop: [{ uid: 'sp1', cardId: SPELL }] }, 'sp1');
    expect(magicHatView(s).count).toBe(2);
  });

  it('nothing but a Shop buy counts: a received pass, a sale, a play, a roll', () => {
    const base = magician();
    const card: BoardCard = { uid: 'x0', cardId: PLAIN[0]!, tribe: CARD_INDEX[PLAIN[0]!]!.tribe, attack: 1, health: 1, keywords: [], golden: false };
    let s = reduce(base, { type: 'receivePass', from: 'p2', seq: 0, card: { ...card, passFrom: 'hand' } as BoardCard });
    expect(s.hand.length).toBe(1);
    s = reduce({ ...s, board: [{ ...card, uid: 'x1' }] }, { type: 'sell', uid: 'x1' });
    expect(s.board).toEqual([]);
    s = reduce(s, { type: 'roll' });
    expect(magicHatView(s).count).toBe(0);
  });

  it('a refused buy (no Gold) does not count', () => {
    const s = magician({ embers: 0 });
    expect(magicHatView(reduce(s, { type: 'buy', uid: 's0' })).count).toBe(0);
  });

  it('another hero buying cards has no hat', () => {
    let s: RunState = { ...mate(), embers: 100, shop: offers(7), spell: null };
    s = buyN(s, 6);
    expect(s.magicHatBuys).toBeUndefined();
    expect(s.duos!.outbox).toEqual([]);
  });
});

describe('the copy: the next buy after the hat activates', () => {
  it('sends the teammate a copy of the card as it was bought, and the count restarts at 0', () => {
    let ann = buyN(magician(), 5);
    ann = reduce({ ...ann, shop: [offer(5, { atk: 3, hp: 4, buffs: [{ source: 'Fortify', attack: 3, health: 4, count: 1 }] })] }, { type: 'buy', uid: 's5' });
    const mine = ann.hand.at(-1)!;
    const def = CARD_INDEX[PLAIN[5 % PLAIN.length]!]!;
    expect(mine).toMatchObject({ cardId: def.id, attack: def.attack + 3, health: def.health + 4, golden: false });
    expect(magicHatView(ann)).toMatchObject({ count: 0, active: false, left: 1 }); // the firing buy does not count toward the next 5
    expect(ann.duos!.outbox).toHaveLength(1);
    const e = ann.duos!.outbox[0]!;
    expect(e).toMatchObject({ hat: true, via: 'sale', paid: 0, src: { uid: 's5' } });
    expect(e.card).toMatchObject({ cardId: def.id, attack: mine.attack, health: mine.health, golden: false });
    expect(e.card.buffs).toEqual(mine.buffs);
    expect(e.card.uid).not.toBe(mine.uid); // the Magician keeps their own card
    // It costs neither teammate anything extra.
    let bob = mate();
    const gold = bob.embers;
    bob = ship(ann, bob);
    expect(bob.embers).toBe(gold);
    expect(bob.hand).toHaveLength(1);
    expect(bob.hand[0]).toMatchObject({ cardId: def.id, attack: mine.attack, health: mine.health, golden: false, passKey: 'p1:0' });
    expect((bob.hand[0] as unknown as Record<string, unknown>).passHat).toBeUndefined();
    expect((bob.hand[0] as unknown as Record<string, unknown>).passFrom).toBeUndefined();
  });

  it('a Golden offer is copied Golden; a plain one is never Golden', () => {
    let ann = buyN(magician(), 5);
    ann = reduce({ ...ann, shop: [offer(5, { golden: true })] }, { type: 'buy', uid: 's5' });
    expect(ann.hand.at(-1)!.golden).toBe(true);
    expect(ann.duos!.outbox[0]!.card.golden).toBe(true);
    expect(duosWireOf(ann.duos!.outbox[0]!)).toMatchObject({ passFrom: 'sale', passHat: true, golden: true });
  });

  it('a bought spell is copied as a spell', () => {
    let ann = buyN(magician(), 5);
    ann = reduce({ ...ann, spell: { uid: 'sp0', cardId: SPELL } }, { type: 'buy', uid: 'sp0' });
    expect(ann.duos!.outbox[0]).toMatchObject({ hat: true, src: { uid: 'sp0' } });
    expect(ann.duos!.outbox[0]!.card.cardId).toBe(SPELL);
    const bob = ship(ann, mate());
    expect(bob.hand.map((c) => c.cardId)).toEqual([SPELL]);
    // ...and so is one bought out of the minion row.
    let cy = buyN(magician(), 5);
    cy = reduce({ ...cy, shop: [{ uid: 'sp1', cardId: SPELL }] }, { type: 'buy', uid: 'sp1' });
    expect(cy.duos!.outbox[0]!.card.cardId).toBe(SPELL);
  });

  it('is repeatable: five more buys activate it again', () => {
    let ann = buyN(magician(), 6); // 5 + the copy
    expect(ann.duos!.outbox).toHaveLength(1);
    ann = buyN(nextTurn(ann), 5, 6);
    expect(magicHatView(ann)).toMatchObject({ count: 5, active: true });
    ann = buyN(ann, 1, 11);
    expect(ann.duos!.outbox).toHaveLength(2);
    expect(magicHatView(ann).count).toBe(0);
  });

  it('a buy that completes a triple still copies the plain card that was bought', () => {
    const id = PLAIN[0]!;
    const d = CARD_INDEX[id]!;
    const own = (uid: string): BoardCard => ({ uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false });
    const ann = reduce({ ...buyN(magician(), 5, 1), hand: [own('h0'), own('h1')], shop: [{ uid: 'sx', cardId: id }] }, { type: 'buy', uid: 'sx' });
    expect(ann.hand.some((c) => c.cardId === id && c.golden)).toBe(true);
    expect(ann.duos!.outbox[0]!.card).toMatchObject({ cardId: id, golden: false, attack: d.attack, health: d.health });
  });

  it('is not a pass: no pass watcher fires on either run', () => {
    // Hitchhiker-style watchers fire from `fireTeamPassTriggers`; a manual pass is the control.
    const watcher = Object.values(CARD_INDEX).find((c) => c && c.effects.some((e) => e.on === 'teamPassedCard' || e.on === 'passedCard'));
    expect(watcher, 'a pass watcher exists to test against').toBeTruthy();
    const w: BoardCard = { uid: 'w0', cardId: watcher!.id, tribe: watcher!.tribe, attack: watcher!.attack, health: watcher!.health, keywords: [...watcher!.keywords], golden: false };
    const strip = (r: RunState): string => serialize({ ...r, duos: undefined, hand: [], shop: [], embers: 0, goldSpent: 0, goldSpentThisTurn: 0 });
    // Sender: the hat's send leaves the watcher's board exactly as a plain sixth buy by a hatless run would.
    const ready = { ...buyN(magician(), 5), board: [structuredClone(w)] };
    const sent = reduce({ ...ready, shop: [offer(5)] }, { type: 'buy', uid: 's5' });
    expect(sent.duos!.outbox).toHaveLength(1);
    expect(sent.board).toEqual(ready.board);
    // Receiver: landing the copy leaves a watcher untouched; the same card as a manual pass does not.
    const bobBase = mate({ board: [structuredClone(w)] });
    const viaHat = ship(sent, bobBase);
    expect(viaHat.hand).toHaveLength(1);
    expect(viaHat.board).toEqual(bobBase.board);
    const asPass = reduce(bobBase, { type: 'receivePass', from: 'p1', seq: 0, card: { ...duosWireOf(sent.duos!.outbox[0]!), passHat: undefined, passFrom: 'spell' } as BoardCard });
    expect(strip(asPass), 'the control: a real pass DOES move the watcher').not.toBe(strip(viaHat));
  });

  it('is deterministic: the same buys give the same bytes', () => {
    const go = (): string => serialize(buyN(magician(), 6));
    expect(go()).toBe(go());
  });
});

describe('twice per turn', () => {
  /** Three full cycles of buys (18) in one turn. */
  const threeCycles = (): RunState => buyN(magician(), 18);

  it('the third activation in one turn does not fire: exactly 2 copies reach the teammate', () => {
    const ann = threeCycles();
    expect(ann.duos!.outbox).toHaveLength(2);
    const bob = ship(ann, mate());
    expect(bob.hand).toHaveLength(2);
    expect(bob.duos!.received).toEqual(['p1:0', 'p1:1']);
  });

  it('progress banks to 5 and stops there while capped; the hat is not active', () => {
    const ann = threeCycles(); // 6 + 6 = two copies, then 6 more buys
    expect(magicHatView(ann)).toMatchObject({ count: 5, active: false, capped: true, left: 0 });
    expect(magicHatView(buyN(ann, 3, 18))).toMatchObject({ count: 5, active: false, capped: true });
  });

  it('a full hat turns active at the start of the next turn, and the per-turn count is back to 0', () => {
    const next = nextTurn(threeCycles());
    expect(magicHatView(next)).toMatchObject({ count: 5, active: true, capped: false, left: 2 });
    const fired = buyN(next, 1, 30);
    expect(fired.duos!.outbox).toHaveLength(3);
    expect(magicHatView(fired)).toMatchObject({ count: 0, left: 1 });
  });
});

describe('the teammate cannot take it', () => {
  /** A full hand that cannot triple with what is copied. */
  const fullHand = (): BoardCard[] => Object.values(CARD_INDEX)
    .filter((c) => c && !c.spell && !c.token && !c.duos && !PLAIN.includes(c.id) && c.tier <= 2).slice(0, 10)
    .map((d, i) => ({ uid: `h${i}`, cardId: d!.id, tribe: d!.tribe, attack: d!.attack, health: d!.health, keywords: [...d!.keywords], golden: false }));

  it('a full hand holds the copy until there is room (the effect pass rule), never refused', () => {
    const ann = buyN(magician(), 6);
    let bob = mate({ hand: fullHand() });
    expect(bob.hand.length).toBe(handCap(bob));
    bob = ship(ann, bob);
    expect(duosWaitingCount(bob)).toBe(1);
    expect(bob.duos!.refused).toEqual([]);
    bob = reduce(bob, { type: 'passCard', uid: 'h0' }); // room: it lands the moment an action makes some
    expect(duosWaitingCount(bob)).toBe(0);
    expect(bob.hand.at(-1)).toMatchObject({ cardId: ann.duos!.outbox[0]!.card.cardId, passKey: 'p1:0' });
  });

  it('a room refusal (the teammate is away or out) drops the copy: nothing comes back, the buy stands', () => {
    const ann = buyN(magician(), 6);
    const back = reduce(ann, { type: 'passRefunded', seq: 0 });
    expect(back.duos!.outbox[0]!.refunded).toBe(true);
    expect(back.hand).toEqual(ann.hand);
    expect(back.embers).toBe(ann.embers);
    expect(magicHatView(back)).toEqual(magicHatView(ann)); // the hat was spent
  });

  it('a copy lands exactly once, whatever is delivered again', () => {
    const ann = buyN(magician(), 6);
    const bob = ship(ann, mate());
    expect(ship(ann, bob)).toBe(bob);
  });

  it('with no Duos state there is no teammate: the hat still counts and resets, the copy is dropped', () => {
    let solo: RunState = { ...createVersusRun(11, 'magician', 'set2'), hand: [], board: [], embers: 100, shop: offers(7), spell: null };
    expect(solo.duos).toBeUndefined();
    solo = buyN(solo, 5);
    expect(magicHatView(solo).active).toBe(true);
    solo = buyN(solo, 1, 5);
    expect(magicHatView(solo)).toMatchObject({ count: 0, left: 1 });
  });
});

describe('a reload: the copy the server holds is never sent again past the cap', () => {
  it('restoreEffectPass (hat) counts the copy against the turn and restarts the hat, nothing leaves', () => {
    const locked = buyN(magician(), 5); // the last lock: hat active, nothing sent
    const rest = (r: RunState): unknown => JSON.parse(serialize({ ...r, duos: undefined, magicHatBuys: 0, magicHatSent: 0, magicHatSentWave: 0 }));
    const before = rest(locked);
    const r1 = reduce(locked, { type: 'restoreEffectPass', uid: 'hat9', cardId: PLAIN[5]!, via: 'sale', hat: true });
    expect(magicHatView(r1)).toMatchObject({ count: 0, active: false, left: 1 });
    expect(r1.duos!.outbox[0]).toMatchObject({ hat: true, restored: true, via: 'sale' });
    expect(rest(r1)).toEqual(before); // nothing else on the run moved
    const r2 = reduce(r1, { type: 'restoreEffectPass', uid: 'hat15', cardId: PLAIN[5]!, via: 'sale', hat: true });
    expect(magicHatView(r2).left).toBe(0);
    expect(reduce(r2, { type: 'restoreEffectPass', uid: 'hat21', cardId: PLAIN[5]!, via: 'sale', hat: true })).toBe(r2);
    // Capped for the turn: six more buys send nothing.
    expect(buyN(r2, 6).duos!.outbox).toHaveLength(2);
  });
});

describe('the live text', () => {
  const text = (s: RunState): string => heroPowerText(s);

  it('prints the count toward 5 as it moves', () => {
    expect(text(magician())).toContain('**0/5**');
    expect(text(buyN(magician(), 3))).toContain('**3/5**');
    expect(text(buyN(magician(), 3))).toContain('**2** left this turn');
  });

  it('says ACTIVE when the next buy is copied', () => {
    const t = text(buyN(magician(), 5));
    expect(t).toContain('Your hat is **active**');
    expect(t).not.toContain('/5');
  });

  it('says the cap, the copies left, and when a capped hat comes back', () => {
    expect(text(buyN(magician(), 6))).toContain('**0/5**');
    expect(text(buyN(magician(), 6))).toContain('**1** left this turn');
    const capped = text(buyN(magician(), 18));
    expect(capped).toContain('**5/5**, active next turn');
    expect(capped).toContain('**0** left this turn');
    expect(capped).not.toContain('Your hat is **active**');
  });

  it('follows the player text rules', () => {
    for (const s of [magician(), buyN(magician(), 5), buyN(magician(), 18)]) {
      expect(text(s)).toContain('Twice per turn');
      expect(text(s)).not.toMatch(/—|--|Oath|climb/);
    }
  });
});

describe('a recorded duo that includes the Magician', () => {
  it('its board snapshot round-trips into a combat side (a recorded seat needs no live teammate)', () => {
    const d = CARD_INDEX[PLAIN[0]!]!;
    const body = (uid: string): BoardCard => ({ uid, cardId: d.id, tribe: d.tribe, attack: d.attack + 2, health: d.health + 2, keywords: [...d.keywords], golden: false });
    const ann = { ...buyN(magician(), 6), board: [body('m0'), body('m1')] };
    const snap = snapshotBoard(ann);
    expect(snap.heroId).toBe('magician');
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap); // plain data: it stores and reads back
    const side = sideFromSnapshot(JSON.parse(JSON.stringify(snap)) as typeof snap, ann.tier, []);
    expect(side).toBeTruthy();
  });

  it('a Duos round with a Magician seat resolves, and resolves the same way twice', () => {
    const d = CARD_INDEX[PLAIN[0]!]!;
    const body = (uid: string): BoardCard => ({ uid, cardId: d.id, tribe: d.tribe, attack: d.attack + 2, health: d.health + 2, keywords: [...d.keywords], golden: false });
    const prepared = (heroId: string, seed: number, hatBuys: number): unknown => {
      let run: RunState = { ...createVersusRun(seed, heroId, 'set2', DUOS), hand: [], board: [], embers: 100, shop: offers(7), spell: null };
      if (hatBuys) run = buyN(run, hatBuys);
      return buildVersusCandidate({ ...run, board: [body('m0'), body('m1')] }, makeRng(seed));
    };
    const sides = { p1: prepared('magician', 21, 6), p2: prepared('warden', 22, 0), p3: prepared('indy', 23, 0), p4: prepared('magician', 24, 5) };
    expect(sides.p1).toBeTruthy();
    const go = (): string => JSON.stringify(resolveVersusDuosRound({ matchSeed: 77, round: 2, sides }));
    const once = go();
    expect(JSON.parse(once).refused).toEqual({});
    expect(go()).toBe(once);
  });

  it('a recorded run replays to the same bytes from its actions', () => {
    const actions = Array.from({ length: 7 }, (_, i) => ({ type: 'buy' as const, uid: `s${i}` }));
    const replay = (): string => {
      let s = magician({ shop: offers(7) });
      for (const a of actions) s = reduce({ ...s, hand: s.hand.slice(-1) }, a);
      return serialize(s);
    };
    expect(replay()).toBe(replay());
    expect(JSON.parse(replay()).duos.outbox).toHaveLength(1);
  });
});
