/**
 * MAGICIAN (owner 2026-11-10, R-DUOS-MAGICIAN-01): "magician - 8 armor, magic hat" + "Add a twice per turn max to
 * magician". Owner 2026-11-12: "Change magician to be 3 buys, and it passes a random minion from those 3 buys, so the
 * pass will come from his hat hero power instead of the minion bought area", then "The hat can send spells too, it's
 * whatever 3 cards were 'put in his hat' so to speak". A Duos-only passive hero. Every case runs through the real
 * reducer, on two teammates' runs where a copy travels.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { makeRng } from '@game/core';
import { reduce } from './reducer';
import { deserialize, handCap, serialize, type BoardCard, type RunState, type ShopCard } from './state';
import { getHero, playableHeroes, powerDiscoverPool, practiceHeroes } from './heroes';
import { createVersusRun, buildVersusCandidate, versusHeroRerollCandidates } from './versus/run';
import { versusDisjointHeroOffers, versusHeroShuffle } from './versus/heroOffers';
import { resolveVersusDuosRound } from './versus/duos';
import type { VersusRoomOptions } from './versus/options';
import { duosWaitingCount, duosWireOf } from './duosPass';
import { heroPowerText } from './recruit';
import { snapshotBoard } from './snapshot';
import { sideFromSnapshot } from './boardSide';
import { MAGIC_HAT_BUYS, MAGIC_HAT_PER_TURN, magicHatBuy, magicHatView } from './magicHat';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };

/** Distinct plain low-tier minions (no effects), so a run of buys never makes a triple and nothing else moves. */
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
/** A run cursor whose next draw of `n` is `i` (the hat's pick is one `rng.int(n)` off the run cursor). */
function cursorFor(i: number, n = 3): number {
  for (let c = 1; c < 5000; c++) if (makeRng(c).int(n) === i) return c;
  throw new Error(`no cursor draws ${i} of ${n}`);
}
/** The third buy of a hat, with the pick forced to the card in position `pick` (0 = the first card bought). */
const fire = (s: RunState, uid: string, pick: number): RunState => reduce({ ...s, rngCursor: cursorFor(pick) }, { type: 'buy', uid });
const idOf = (i: number): string => PLAIN[i % PLAIN.length]!;

describe('the hero: Duos only, 8 Armor, a passive power', () => {
  it('prints what the owner asked for', () => {
    const h = getHero('magician');
    expect(h.id).toBe('magician');
    expect(h.name).toBe('Magician');
    expect(h.armor).toBe(8);
    expect(h.duosOnly).toBe(true);
    expect(h.power).toMatchObject({ name: 'Magic Hat', kind: 'magicHat', passive: true });
    expect(h.power.text).not.toMatch(/—|--|Oath|climb/);
    expect(MAGIC_HAT_BUYS).toBe(3);
    expect(h.power.text).toBe('After you buy **3** cards, your teammate gets a copy of a random one. Twice per turn.');
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

describe('the counter: Shop buys only, across turns, to 3', () => {
  it('each Shop buy counts one and goes into the hat; the count carries across turns', () => {
    let s = magician();
    expect(magicHatView(s)).toMatchObject({ count: 0, need: 3, active: false });
    s = buyN(s, 1);
    expect(magicHatView(s)).toMatchObject({ count: 1, active: false });
    expect(s.magicHatCards!.map((c) => c.cardId)).toEqual([idOf(0)]);
    s = nextTurn(s);
    expect(magicHatView(s).count).toBe(1); // carried
    s = buyN(s, 1, 1);
    // One buy short: the next card bought sends the copy (the ready glow's meaning).
    expect(magicHatView(s)).toMatchObject({ count: 2, active: true, full: false, left: 2 });
    expect(s.magicHatCards!.map((c) => c.cardId)).toEqual([idOf(0), idOf(1)]);
    expect(s.duos!.outbox).toEqual([]); // two buys sent nothing
  });

  it('a spell bought from the slot and one bought from the row both count, and both go in', () => {
    let s = magician({ spell: { uid: 'sp0', cardId: SPELL } });
    s = buy(s, 'sp0');
    expect(magicHatView(s).count).toBe(1);
    s = buy({ ...s, shop: [{ uid: 'sp1', cardId: SPELL }] }, 'sp1');
    expect(magicHatView(s).count).toBe(2);
    expect(s.magicHatCards!.map((c) => c.cardId)).toEqual([SPELL, SPELL]);
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
    expect(s.magicHatCards).toBeUndefined();
  });

  it('a refused buy (no Gold) does not count', () => {
    const s = magician({ embers: 0 });
    const after = reduce(s, { type: 'buy', uid: 's0' });
    expect(magicHatView(after).count).toBe(0);
    expect(after.magicHatCards).toBeUndefined();
  });

  it('another hero buying cards has no hat', () => {
    let s: RunState = { ...mate(), embers: 100, shop: offers(7), spell: null };
    s = buyN(s, 6);
    expect(s.magicHatBuys).toBeUndefined();
    expect(s.magicHatCards).toBeUndefined();
    expect(s.duos!.outbox).toEqual([]);
  });
});

describe('the copy: the third buy fires the hat at once', () => {
  it('sends the teammate a copy of one of the three cards, empties the hat, and the count restarts at 0', () => {
    let ann = buyN(magician(), 2);
    expect(ann.duos!.outbox).toEqual([]);
    ann = reduce({ ...ann, shop: [offer(2)] }, { type: 'buy', uid: 's2' });
    expect(ann.hand.at(-1)!.cardId).toBe(idOf(2)); // the Magician keeps what they bought
    expect(magicHatView(ann)).toMatchObject({ count: 0, active: false, left: 1 });
    expect(ann.magicHatCards).toBeUndefined();
    expect(ann.duos!.outbox).toHaveLength(1);
    const e = ann.duos!.outbox[0]!;
    expect(e).toMatchObject({ hat: true, via: 'sale', paid: 0 });
    expect(e.src).toBeUndefined(); // it leaves from the hat, not from a Shop card
    expect([idOf(0), idOf(1), idOf(2)]).toContain(e.card.cardId);
    expect(e.card.uid).toMatch(/^hat\d+$/); // its own uid, never the uid of a card the Magician keeps
    // It costs neither teammate anything extra.
    let bob = mate();
    const gold = bob.embers;
    bob = ship(ann, bob);
    expect(bob.embers).toBe(gold);
    expect(bob.hand).toHaveLength(1);
    expect(bob.hand[0]).toMatchObject({ cardId: e.card.cardId, attack: e.card.attack, health: e.card.health, golden: false, passKey: 'p1:0' });
    expect((bob.hand[0] as unknown as Record<string, unknown>).passHat).toBeUndefined();
    expect((bob.hand[0] as unknown as Record<string, unknown>).passFrom).toBeUndefined();
  });

  it('the pick is one seeded draw over all three cards: each position can be the copy', () => {
    const two = buyN(magician(), 2);
    for (const pick of [0, 1, 2]) {
      const ann = fire({ ...two, shop: [offer(2)] }, 's2', pick);
      expect(ann.duos!.outbox[0]!.card.cardId, `position ${pick}`).toBe(idOf(pick));
      expect(ann.rngCursor, 'the draw advanced the run cursor').not.toBe(cursorFor(pick));
    }
  });

  it('a spell among the three can be the copy, and arrives as a spell in the teammate hand (no minion preference)', () => {
    // minion, spell (from the slot), minion.
    let two = buyN(magician({ spell: { uid: 'sp0', cardId: SPELL } }), 1);
    two = buy(two, 'sp0');
    expect(two.magicHatCards!.map((c) => c.cardId)).toEqual([idOf(0), SPELL]);
    const ann = fire({ ...two, shop: [offer(2)] }, 's2', 1);
    expect(ann.duos!.outbox[0]).toMatchObject({ hat: true, via: 'sale' });
    expect(ann.duos!.outbox[0]!.card.cardId).toBe(SPELL);
    expect(duosWireOf(ann.duos!.outbox[0]!)).toMatchObject({ passFrom: 'sale', passHat: true, cardId: SPELL });
    const bob = ship(ann, mate());
    expect(bob.hand.map((c) => c.cardId)).toEqual([SPELL]);
    expect(CARD_INDEX[bob.hand[0]!.cardId]!.spell).toBeTruthy();
    // With minions in the hat too, the other draws still pick them: the pick is uniform, not spell-first or minion-first.
    expect(fire({ ...two, shop: [offer(2)] }, 's2', 0).duos!.outbox[0]!.card.cardId).toBe(idOf(0));
    expect(fire({ ...two, shop: [offer(2)] }, 's2', 2).duos!.outbox[0]!.card.cardId).toBe(idOf(2));
    // A spell bought out of the minion row as the THIRD buy can be the copy as well.
    const cy = fire({ ...buyN(magician(), 2), shop: [{ uid: 'sp1', cardId: SPELL }] }, 'sp1', 2);
    expect(cy.duos!.outbox[0]!.card.cardId).toBe(SPELL);
  });

  it('three spells in the hat send a spell', () => {
    let s = magician();
    for (let i = 0; i < 3; i++) s = buy({ ...s, shop: [{ uid: `sp${i}`, cardId: SPELL }] }, `sp${i}`);
    expect(s.duos!.outbox).toHaveLength(1);
    expect(s.duos!.outbox[0]!.card.cardId).toBe(SPELL);
  });

  it('the copy is the card AS IT WAS BOUGHT: offer buffs ride it', () => {
    const def = CARD_INDEX[idOf(0)]!;
    let ann = reduce({ ...magician(), shop: [offer(0, { atk: 3, hp: 4, buffs: [{ source: 'Fortify', attack: 3, health: 4, count: 1 }] })] }, { type: 'buy', uid: 's0' });
    const mine = structuredClone(ann.hand.at(-1)!);
    expect(mine).toMatchObject({ cardId: def.id, attack: def.attack + 3, health: def.health + 4, golden: false });
    ann = buyN({ ...ann, hand: [] }, 1, 1);
    ann = fire({ ...ann, shop: [offer(2)] }, 's2', 0);
    const e = ann.duos!.outbox[0]!;
    expect(e.card).toMatchObject({ cardId: def.id, attack: mine.attack, health: mine.health, golden: false });
    expect(e.card.buffs).toEqual(mine.buffs);
    expect(e.card.uid).not.toBe(mine.uid);
  });

  it('what happens to the bought card afterwards changes nothing: a later buff, a sale', () => {
    const def = CARD_INDEX[idOf(0)]!;
    const bought = reduce(magician(), { type: 'buy', uid: 's0' });
    const kept = bought.hand.at(-1)!;
    // Buffed in hand after the buy.
    const buffed: RunState = { ...bought, hand: [{ ...kept, attack: kept.attack + 10, health: kept.health + 10, keywords: [...kept.keywords, 'T'] }] };
    let ann = buyN(buffed, 1, 1);
    ann = fire({ ...ann, shop: [offer(2)] }, 's2', 0);
    expect(ann.duos!.outbox[0]!.card).toMatchObject({ cardId: def.id, attack: def.attack, health: def.health, keywords: def.keywords });
    // On the board, then sold: the card is gone from the run, the hat still holds it.
    let sold = reduce({ ...bought, hand: [], board: [kept] }, { type: 'sell', uid: kept.uid });
    expect(sold.board).toEqual([]);
    expect(sold.magicHatCards!.map((c) => c.cardId)).toEqual([def.id]);
    sold = buyN(sold, 1, 1);
    sold = fire({ ...sold, shop: [offer(2)] }, 's2', 0);
    const hatSends = sold.duos!.outbox.filter((e) => e.hat); // (a Duos sale leaves its own team note in the outbox)
    expect(hatSends).toHaveLength(1);
    expect(hatSends[0]!.card).toMatchObject({ cardId: def.id, attack: def.attack, health: def.health, golden: false });
  });

  it('a Golden offer goes in Golden and is copied Golden; a plain one is never Golden', () => {
    let ann = reduce({ ...magician(), shop: [offer(0, { golden: true })] }, { type: 'buy', uid: 's0' });
    expect(ann.hand.at(-1)!.golden).toBe(true);
    ann = buyN({ ...ann, hand: [] }, 1, 1);
    const gold = fire({ ...ann, shop: [offer(2)] }, 's2', 0);
    expect(gold.duos!.outbox[0]!.card.golden).toBe(true);
    expect(duosWireOf(gold.duos!.outbox[0]!)).toMatchObject({ passFrom: 'sale', passHat: true, golden: true });
    expect(fire({ ...ann, shop: [offer(2)] }, 's2', 1).duos!.outbox[0]!.card.golden).toBe(false);
  });

  it('three buys that make a triple still send the plain card that was bought', () => {
    const id = PLAIN[0]!;
    const d = CARD_INDEX[id]!;
    let ann = magician();
    for (let i = 0; i < 3; i++) ann = reduce({ ...ann, shop: [{ uid: `t${i}`, cardId: id }] }, { type: 'buy', uid: `t${i}` }); // the hand is kept
    expect(ann.hand.some((c) => c.cardId === id && c.golden), 'the Magician holds the Golden').toBe(true);
    expect(ann.duos!.outbox).toHaveLength(1);
    expect(ann.duos!.outbox[0]!.card).toMatchObject({ cardId: id, golden: false, attack: d.attack, health: d.health });
  });

  it('is repeatable: three more buys fire it again', () => {
    let ann = buyN(magician(), 3);
    expect(ann.duos!.outbox).toHaveLength(1);
    ann = buyN(nextTurn(ann), 2, 3);
    expect(magicHatView(ann)).toMatchObject({ count: 2, active: true });
    ann = buyN(ann, 1, 5);
    expect(ann.duos!.outbox).toHaveLength(2);
    expect([idOf(3), idOf(4), idOf(5)]).toContain(ann.duos!.outbox[1]!.card.cardId); // only the new hat's cards
    expect(magicHatView(ann).count).toBe(0);
  });

  it('a Starform buy counts but puts nothing in; a hat full of nothing waits for the first card', () => {
    // The Starform branch calls the hook with no card (`magicHatBuy(s, null)`).
    const s = structuredClone(buyN(magician(), 1));
    magicHatBuy(s, null);
    expect(magicHatView(s).count).toBe(2);
    expect(s.magicHatCards!.map((c) => c.cardId)).toEqual([idOf(0)]);
    const done = reduce({ ...s, shop: [offer(2)] }, { type: 'buy', uid: 's2' });
    expect(done.duos!.outbox).toHaveLength(1);
    expect([idOf(0), idOf(2)]).toContain(done.duos!.outbox[0]!.card.cardId);
    // Three Starforms: full, nothing to copy, nothing sent, the hat waits.
    const e = structuredClone(magician());
    for (let i = 0; i < 3; i++) magicHatBuy(e, null);
    expect(magicHatView(e)).toMatchObject({ count: 3, full: true });
    expect(e.duos!.outbox).toEqual([]);
    const next = reduce({ ...e, shop: [offer(4)] }, { type: 'buy', uid: 's4' });
    expect(next.duos!.outbox).toHaveLength(1);
    expect(next.duos!.outbox[0]!.card.cardId).toBe(idOf(4));
    expect(magicHatView(next).count).toBe(0);
  });

  it('is not a pass: no pass watcher fires on either run', () => {
    // Hitchhiker-style watchers fire from `fireTeamPassTriggers`; a manual pass is the control.
    const watcher = Object.values(CARD_INDEX).find((c) => c && c.effects.some((e) => e.on === 'teamPassedCard' || e.on === 'passedCard'));
    expect(watcher, 'a pass watcher exists to test against').toBeTruthy();
    const w: BoardCard = { uid: 'w0', cardId: watcher!.id, tribe: watcher!.tribe, attack: watcher!.attack, health: watcher!.health, keywords: [...watcher!.keywords], golden: false };
    const strip = (r: RunState): string => serialize({ ...r, duos: undefined, hand: [], shop: [], embers: 0, goldSpent: 0, goldSpentThisTurn: 0 });
    // Sender: the hat's send leaves the watcher's board exactly as it was.
    const ready = { ...buyN(magician(), 2), board: [structuredClone(w)] };
    const sent = reduce({ ...ready, shop: [offer(2)] }, { type: 'buy', uid: 's2' });
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
});

describe('the pick is deterministic', () => {
  it('the same seed and the same buys give the same bytes, and so the same copy', () => {
    const go = (seed: number): RunState => buyN(magician({}, seed), 3);
    for (const seed of [11, 12, 13, 14]) {
      expect(serialize(go(seed))).toBe(serialize(go(seed)));
      expect(go(seed).duos!.outbox[0]!.card.cardId).toBe(go(seed).duos!.outbox[0]!.card.cardId);
    }
  });

  it('different run cursors reach every card (the pick is not fixed to one position)', () => {
    const two = buyN(magician(), 2);
    const seen = new Set<string>();
    for (let c = 1; c <= 60; c++) seen.add(reduce({ ...two, rngCursor: c, shop: [offer(2)] }, { type: 'buy', uid: 's2' }).duos!.outbox[0]!.card.cardId);
    expect([...seen].sort()).toEqual([idOf(0), idOf(1), idOf(2)].sort());
  });

  it('a run saved with cards in the hat and loaded again picks the same card', () => {
    const two = buyN(magician(), 2);
    const loaded = deserialize(serialize(two));
    expect(loaded.magicHatCards).toEqual(two.magicHatCards);
    expect(loaded.magicHatBuys).toBe(2);
    const a = reduce({ ...two, shop: [offer(2)] }, { type: 'buy', uid: 's2' });
    const b = reduce({ ...loaded, shop: [offer(2)] }, { type: 'buy', uid: 's2' });
    expect(b.duos!.outbox[0]!.card).toEqual(a.duos!.outbox[0]!.card);
    expect(b.rngCursor).toBe(a.rngCursor);
  });
});

describe('twice per turn', () => {
  /** Three full hats (9 buys) in one turn. */
  const threeHats = (): RunState => buyN(magician(), 9);

  it('the third hat in one turn does not fire: exactly 2 copies reach the teammate', () => {
    const ann = threeHats();
    expect(ann.duos!.outbox).toHaveLength(2);
    const bob = ship(ann, mate());
    expect(bob.hand).toHaveLength(2);
    expect(bob.duos!.received).toEqual(['p1:0', 'p1:1']);
  });

  it('past the cap the hat fills to 3 and stops there, keeping the cards that filled it; it is not ready', () => {
    const ann = threeHats(); // 3 + 3 = two copies, then 3 more buys
    expect(magicHatView(ann)).toMatchObject({ count: 3, full: true, active: false, capped: true, left: 0 });
    expect(ann.magicHatCards!.map((c) => c.cardId)).toEqual([idOf(6), idOf(7), idOf(8)]);
    const more = buyN(ann, 3, 9);
    expect(magicHatView(more)).toMatchObject({ count: 3, active: false, capped: true });
    expect(more.magicHatCards).toEqual(ann.magicHatCards);
    expect(more.duos!.outbox).toHaveLength(2);
    // One short of full with no copy left this turn is not ready either.
    expect(magicHatView(buyN(magician(), 8))).toMatchObject({ count: 2, active: false, capped: false, left: 0 });
  });

  it('a full capped hat fires on the first buy of the next turn, from the cards it holds; that buy starts the new hat', () => {
    const next = nextTurn(threeHats());
    expect(magicHatView(next)).toMatchObject({ count: 3, full: true, active: true, capped: false, left: 2 });
    expect(next.duos!.outbox).toHaveLength(2); // nothing ran at the turn flip
    const fired = buyN(next, 1, 30);
    expect(fired.duos!.outbox).toHaveLength(3);
    expect([idOf(6), idOf(7), idOf(8)]).toContain(fired.duos!.outbox[2]!.card.cardId); // never the card just bought
    expect(magicHatView(fired)).toMatchObject({ count: 1, left: 1 });
    expect(fired.magicHatCards!.map((c) => c.cardId)).toEqual([idOf(30)]);
    // Two more buys fill and fire the new hat: the turn's second copy. Then the cap holds again.
    const second = buyN(fired, 2, 31);
    expect(second.duos!.outbox).toHaveLength(4);
    expect([idOf(30), idOf(31), idOf(32)]).toContain(second.duos!.outbox[3]!.card.cardId);
    expect(buyN(second, 6, 33).duos!.outbox).toHaveLength(4);
  });
});

describe('the teammate cannot take it', () => {
  /** A full hand that cannot triple with what is copied. */
  const fullHand = (): BoardCard[] => Object.values(CARD_INDEX)
    .filter((c) => c && !c.spell && !c.token && !c.duos && !PLAIN.includes(c.id) && c.tier <= 2).slice(0, 10)
    .map((d, i) => ({ uid: `h${i}`, cardId: d!.id, tribe: d!.tribe, attack: d!.attack, health: d!.health, keywords: [...d!.keywords], golden: false }));

  it('a full hand holds the copy until there is room (the effect pass rule), never refused', () => {
    const ann = buyN(magician(), 3);
    let bob = mate({ hand: fullHand() });
    expect(bob.hand.length).toBe(handCap(bob));
    bob = ship(ann, bob);
    expect(duosWaitingCount(bob)).toBe(1);
    expect(bob.duos!.refused).toEqual([]);
    bob = reduce(bob, { type: 'passCard', uid: 'h0' }); // room: it lands the moment an action makes some
    expect(duosWaitingCount(bob)).toBe(0);
    expect(bob.hand.at(-1)).toMatchObject({ cardId: ann.duos!.outbox[0]!.card.cardId, passKey: 'p1:0' });
  });

  it('a room refusal (the teammate is away or out) drops the copy: nothing comes back, the buys stand', () => {
    const ann = buyN(magician(), 3);
    const back = reduce(ann, { type: 'passRefunded', seq: 0 });
    expect(back.duos!.outbox[0]!.refunded).toBe(true);
    expect(back.hand).toEqual(ann.hand);
    expect(back.embers).toBe(ann.embers);
    expect(magicHatView(back)).toEqual(magicHatView(ann)); // the hat was spent
  });

  it('a copy lands exactly once, whatever is delivered again', () => {
    const ann = buyN(magician(), 3);
    const bob = ship(ann, mate());
    expect(ship(ann, bob)).toBe(bob);
  });

  it('with no Duos state there is no teammate: the hat still counts, fires and resets, the copy is dropped', () => {
    let solo: RunState = { ...createVersusRun(11, 'magician', 'set2'), hand: [], board: [], embers: 100, shop: offers(7), spell: null };
    expect(solo.duos).toBeUndefined();
    solo = buyN(solo, 2);
    expect(magicHatView(solo).active).toBe(true);
    solo = buyN(solo, 1, 2);
    expect(magicHatView(solo)).toMatchObject({ count: 0, left: 1 });
    expect(solo.magicHatCards).toBeUndefined();
  });
});

describe('a reload: the copy the server holds is never sent again past the cap', () => {
  const restore = (uid: string) => ({ type: 'restoreEffectPass' as const, uid, cardId: PLAIN[2]!, via: 'sale' as const, hat: true as const });

  it('restoreEffectPass (hat) counts the copy against the turn and empties the hat, nothing leaves', () => {
    const locked = buyN(magician(), 2); // the last lock: two cards in the hat, nothing sent
    const rest = (r: RunState): unknown => JSON.parse(serialize({ ...r, duos: undefined, magicHatBuys: 0, magicHatCards: undefined, magicHatSent: 0, magicHatSentWave: 0 }));
    const before = rest(locked);
    const r1 = reduce(locked, restore('hat9'));
    expect(magicHatView(r1)).toMatchObject({ count: 0, active: false, left: 1 });
    expect(r1.magicHatCards).toBeUndefined(); // the cards that made the copy were spent with it
    expect(r1.duos!.outbox[0]).toMatchObject({ hat: true, restored: true, via: 'sale' });
    expect(rest(r1)).toEqual(before); // nothing else on the run moved (no draw off the run cursor either)
    const r2 = reduce(r1, restore('hat15'));
    expect(magicHatView(r2).left).toBe(0);
    expect(reduce(r2, restore('hat21'))).toBe(r2);
    // Capped for the turn: six more buys send nothing (the outbox holds the two restored entries only).
    const more = buyN(r2, 6);
    expect(more.duos!.outbox).toHaveLength(2);
    expect(more.duos!.outbox.every((e) => e.restored)).toBe(true);
  });

  it('one copy held by the server leaves exactly one more for the turn, however the buys are replayed', () => {
    const r1 = reduce(buyN(magician(), 2), restore('hat9'));
    const again = buyN(r1, 9); // re-bought cards refill the hat from 0
    expect(again.duos!.outbox.filter((e) => !e.restored)).toHaveLength(1);
    expect(again.duos!.outbox).toHaveLength(2); // the turn's two, never a third
  });

  it('a full hat held over from a capped turn cannot give a third copy through a reload either', () => {
    const locked = nextTurn(buyN(magician(), 9)); // the lock at the turn's start: a full hat, ready, two copies last turn
    expect(magicHatView(locked)).toMatchObject({ full: true, active: true, left: 2 });
    const sentBefore = locked.duos!.outbox.length;
    // The player fired it twice this turn, then reloaded: the server holds two rows for this turn.
    const r2 = reduce(reduce(locked, restore('hat40')), restore('hat41'));
    expect(magicHatView(r2)).toMatchObject({ count: 0, left: 0 });
    expect(r2.magicHatCards).toBeUndefined();
    const more = buyN(r2, 7, 40);
    expect(more.duos!.outbox.filter((e) => e.wave === more.wave && !e.restored)).toEqual([]);
    expect(more.duos!.outbox).toHaveLength(sentBefore + 2);
  });
});

describe('the live text', () => {
  const text = (s: RunState): string => heroPowerText(s);

  it('prints the count toward 3 as it moves', () => {
    expect(text(magician())).toBe('After you buy **3** cards (**0/3**), your teammate gets a copy of a random one. Twice per turn (**2** left this turn).');
    expect(text(buyN(magician(), 1))).toContain('**1/3**');
    expect(text(buyN(magician(), 1))).toContain('**2** left this turn');
  });

  it('says READY when the next buy sends the copy', () => {
    const t = text(buyN(magician(), 2));
    expect(t).toContain('Your hat is **ready** (**2/3**)');
    expect(t).toContain('The next card you buy sends your teammate a copy of a random card in it.');
  });

  it('says the cap, the copies left, and when a capped hat sends', () => {
    expect(text(buyN(magician(), 3))).toContain('**0/3**');
    expect(text(buyN(magician(), 3))).toContain('**1** left this turn');
    const capped = text(buyN(magician(), 9));
    expect(capped).toContain('**3/3**, sends on your first buy next turn');
    expect(capped).toContain('**0** left this turn');
    expect(capped).not.toContain('Your hat is **ready**');
    expect(text(nextTurn(buyN(magician(), 9)))).toContain('Your hat is **ready** (**3/3**)');
  });

  it('follows the player text rules', () => {
    for (const s of [magician(), buyN(magician(), 2), buyN(magician(), 9), nextTurn(buyN(magician(), 9))]) {
      expect(text(s)).toContain('Twice per turn');
      expect(text(s)).not.toMatch(/—|--|Oath|climb/);
    }
  });
});

describe('a recorded duo that includes the Magician', () => {
  it('its board snapshot round-trips into a combat side (a recorded seat needs no live teammate)', () => {
    const d = CARD_INDEX[PLAIN[0]!]!;
    const body = (uid: string): BoardCard => ({ uid, cardId: d.id, tribe: d.tribe, attack: d.attack + 2, health: d.health + 2, keywords: [...d.keywords], golden: false });
    const ann = { ...buyN(magician(), 3), board: [body('m0'), body('m1')] };
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
    const sides = { p1: prepared('magician', 21, 3), p2: prepared('warden', 22, 0), p3: prepared('indy', 23, 0), p4: prepared('magician', 24, 2) };
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
    expect(JSON.parse(replay()).duos.outbox).toHaveLength(2); // the 3rd and the 6th buy
  });
});
