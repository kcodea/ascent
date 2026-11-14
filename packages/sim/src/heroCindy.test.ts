/**
 * CINDY (owner 2026-11-14, R-DUOS-CINDY-01): "Cindy, 30 resolve, 10 Armor. Golden Gratitude: cost 0, once per game.
 * The next minion your teammate buys gives you a Gilded copy of it." A Duos-only hero. Every case runs through the
 * real reducer on two teammates' runs, with the arm and the copy carried by the pass channel's wire form.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { reduce } from './reducer';
import { handCap, serialize, type BoardCard, type RunState, type ShopCard } from './state';
import { getHero, playableHeroes, powerDiscoverPool, practiceHeroes } from './heroes';
import { createVersusRun, versusHeroRerollCandidates } from './versus/run';
import { versusHeroShuffle } from './versus/heroOffers';
import type { VersusRoomOptions } from './versus/options';
import { duosWaitingCount, duosWireOf } from './duosPass';
import { heroPowerText } from './recruit';
import { gratitudeView } from './goldenGratitude';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };
const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.tier <= 2 && c.effects.length === 0).map((c) => c!.id);
const SPELL = Object.values(CARD_INDEX).find((c) => c && c.spell && !c.ruby && !c.token && !c.duos && (c.cost ?? 0) <= 3)!.id;
const offer = (i: number, over: Partial<ShopCard> = {}): ShopCard => ({ uid: `s${i}`, cardId: PLAIN[i % PLAIN.length]!, ...over });

function cindy(over: Partial<RunState> = {}, seed = 11): RunState {
  return { ...createVersusRun(seed, 'cindy', 'set2', DUOS), hand: [], board: [], embers: 10, ...over };
}
function mate(over: Partial<RunState> = {}, seed = 12): RunState {
  return { ...createVersusRun(seed, 'warden', 'set2', DUOS), hand: [], board: [], embers: 100, shop: [offer(0), offer(1), offer(2)], spell: null, ...over };
}
/** Deliver every outbox entry of `from` (from `since` on) to `to`, as the room would. */
function ship(from: RunState, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: 'p1', seq: e.seq, card: duosWireOf(e) });
  return out;
}
const press = (s: RunState): RunState => reduce(s, { type: 'heroPower' });
/** Cindy presses; her teammate's run hears it. */
function armed(over: Partial<RunState> = {}): { ann: RunState; bob: RunState } {
  const ann = press(cindy());
  return { ann, bob: ship(ann, mate(over)) };
}
const sentCopies = (s: RunState) => s.duos!.outbox.filter((e) => e.gratitude);

describe('the hero: Duos only, 10 Armor, a free once-per-game power', () => {
  it('prints what the owner asked for', () => {
    const h = getHero('cindy');
    expect(h.id).toBe('cindy');
    expect([h.name, h.resolve, h.armor, h.duosOnly]).toEqual(['Cindy', 30, 10, true]);
    expect(h.power).toMatchObject({ name: 'Golden Gratitude', kind: 'gratitude', cost: 0, oncePerGame: true, untargeted: true });
    expect(h.power.passive).toBeUndefined();
    expect(h.power.text).toBe('The next minion your teammate buys gives you a **Gilded** copy of it. Once per game.');
    for (const t of [h.power.text, h.blurb]) expect(t).not.toMatch(/—|--|Oath|climb/);
  });

  it('is never offered outside a team mode, and never by Mimic, Void or Power Shifter', () => {
    expect(playableHeroes().some((h) => h.id === 'cindy')).toBe(false);
    expect(practiceHeroes().some((h) => h.id === 'cindy')).toBe(false);
    expect(powerDiscoverPool('mimic')).not.toContain('cindy');
    expect(powerDiscoverPool('void')).not.toContain('cindy');
    expect(versusHeroShuffle(5, 6, 'set2')).not.toContain('cindy');
    expect(versusHeroRerollCandidates(6, 'set2', [])).not.toContain('cindy');
  });

  it('joins a team-mode deal, appended last (no solo order moves)', () => {
    expect(playableHeroes(undefined, { duos: true }).map((h) => h.id)).toEqual([...playableHeroes().map((h) => h.id), 'priestess', 'magician', 'cindy']);
    expect(versusHeroRerollCandidates(6, 'set2', [], { duos: true })).toContain('cindy');
  });

  it('her 10 Armor reaches the team pool', () => {
    expect(createVersusRun(11, 'cindy', 'set2', { v: 1, mode: 'duel', modifiers: [] }).armor).toBe(10);
  });
});

describe('the press arms it, once per game, for 0 Gold', () => {
  it('arms her run and tells the teammate run through a team effect', () => {
    const before = cindy();
    const ann = press(before);
    expect(ann.cindyGratitude).toBe('armed');
    expect(ann.heroPowerSpent).toBe(true);
    expect(ann.embers).toBe(before.embers);
    expect(ann.duos!.outbox).toHaveLength(1);
    expect(ann.duos!.outbox[0]!.team).toEqual({ kind: 'gratitude' });
    const bob = ship(ann, mate());
    expect(bob.duos!.gratitude).toBe(true);
  });

  it('cannot be pressed again: not this turn, not next turn', () => {
    const ann = press(cindy());
    expect(press(ann)).toBe(ann);
    const later = { ...ann, wave: ann.wave + 3, heroReady: true };
    expect(press(later)).toBe(later);
  });

  it('with no teammate (no Duos state) it is refused and nothing is spent', () => {
    const solo: RunState = { ...createVersusRun(11, 'cindy', 'set2'), hand: [], board: [], embers: 10 };
    expect(solo.duos).toBeUndefined();
    expect(press(solo)).toBe(solo);
  });

  it('the text and the state follow it live: ready, waiting, spent with the card it gave', () => {
    const fresh = cindy();
    expect(gratitudeView(fresh).state).toBe('ready');
    expect(heroPowerText(fresh)).toBe('The next minion your teammate buys gives you a **Gilded** copy of it. Once per game.');
    const { ann, bob } = armed();
    expect(gratitudeView(ann).state).toBe('armed');
    expect(heroPowerText(ann)).toBe("**Waiting** for your teammate's next minion buy. You get a **Gilded** copy of it.");
    const paid = ship(reduce(bob, { type: 'buy', uid: 's0' }), ann, 0);
    expect(gratitudeView(paid)).toEqual({ state: 'paid', cardId: PLAIN[0] });
    expect(heroPowerText(paid)).toBe(`Spent. Your teammate bought **${CARD_INDEX[PLAIN[0]!]!.name}**, and you got a **Gilded** copy.`);
  });
});

describe('the payout: the teammate\'s NEXT MINION buy, once', () => {
  it('a normal Shop buy sends Cindy a Gilded copy; the teammate keeps the minion', () => {
    const { ann, bob } = armed();
    const after = reduce(bob, { type: 'buy', uid: 's0' });
    expect(after.hand.map((c) => c.cardId)).toEqual([PLAIN[0]]);
    expect(after.duos!.gratitude).toBeUndefined();
    const sent = sentCopies(after);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ via: 'sale', paid: 0, src: { uid: after.hand[0]!.uid } });
    const def = CARD_INDEX[PLAIN[0]!]!;
    expect(sent[0]!.card).toMatchObject({ cardId: def.id, golden: true, attack: def.attack * 2, health: def.health * 2 });
    const got = ship(after, ann);
    const copy = got.hand.at(-1)!;
    expect(copy).toMatchObject({ cardId: def.id, golden: true, attack: def.attack * 2, health: def.health * 2 });
    expect(copy).not.toHaveProperty('passGratitude');
    expect(got.cindyGratitude).toBe('paid');
  });

  it('pays once: the next buys send nothing', () => {
    const { bob } = armed();
    let s = reduce(bob, { type: 'buy', uid: 's0' });
    s = reduce(s, { type: 'buy', uid: 's1' });
    s = reduce({ ...s, wave: s.wave + 1 }, { type: 'buy', uid: 's2' });
    expect(sentCopies(s)).toHaveLength(1);
  });

  it('waits across turns until a minion is bought', () => {
    const { bob } = armed();
    const later = reduce({ ...bob, wave: bob.wave + 2 }, { type: 'roll' });
    expect(later.duos!.gratitude).toBe(true);
    const shopMinion = later.shop.find((o) => { const d = CARD_INDEX[o.cardId]; return d && !d.spell && !d.ruby && !o.starform; })!;
    const bought = reduce(later, { type: 'buy', uid: shopMinion.uid });
    expect(sentCopies(bought).map((e) => e.card.cardId)).toEqual([shopMinion.cardId]);
  });

  it('a spell from the slot or the row does not count and does not spend it', () => {
    const { bob } = armed({ spell: { uid: 'sp0', cardId: SPELL }, shop: [{ uid: 'sp1', cardId: SPELL }, offer(3)] });
    let s = reduce(bob, { type: 'buy', uid: 'sp0' });
    s = reduce(s, { type: 'buy', uid: 'sp1' });
    expect(sentCopies(s)).toHaveLength(0);
    expect(s.duos!.gratitude).toBe(true);
    s = reduce(s, { type: 'buy', uid: 's3' });
    expect(sentCopies(s).map((e) => e.card.cardId)).toEqual([PLAIN[3]]);
  });

  it('a Starform buy does not count (no minion leaves the Shop) and does not spend it', () => {
    const { bob } = armed({ shop: [{ uid: 'sf', cardId: 'ce3_starform', starform: true, cost: 1 }, offer(4)] });
    let s = reduce(bob, { type: 'buy', uid: 'sf' });
    expect(s.shop.some((o) => o.uid === 'sf')).toBe(false); // the buy happened
    expect(sentCopies(s)).toHaveLength(0);
    s = reduce(s, { type: 'buy', uid: 's4' });
    expect(sentCopies(s)).toHaveLength(1);
  });

  it('a held (Swapped-away) minion bought back counts', () => {
    const held: BoardCard = { uid: 'h9', cardId: PLAIN[5]!, tribe: CARD_INDEX[PLAIN[5]!]!.tribe, attack: 9, health: 9, keywords: [], golden: false };
    const { bob } = armed({ shop: [{ uid: 'sh', cardId: PLAIN[5]!, held }] });
    const s = reduce(bob, { type: 'buy', uid: 'sh' });
    expect(s.hand.map((c) => c.cardId)).toEqual([PLAIN[5]]);
    const def = CARD_INDEX[PLAIN[5]!]!;
    expect(sentCopies(s)[0]!.card).toMatchObject({ cardId: PLAIN[5], golden: true, attack: def.attack * 2, health: def.health * 2 });
  });

  it('a minion a RUNE put in the Shop counts: the Golden Monkey rune\'s Monkey', () => {
    const base: RunState = {
      ...createVersusRun(12, 'warden', 'set2', DUOS), tribes: [...SETS.set2.tribes], wave: 7, tier: 3, phase: 'recruit', embers: 60,
      hand: [], board: [], spell: null, pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
    };
    let bob = reduce({ ...base, runeforgeOffer: ['rune_golden_monkey'], runeforgeEpic: false }, { type: 'buyRune', index: 0 });
    bob = { ...bob, discover: undefined, discoverQueue: undefined };
    for (let i = 0; i < 5; i++) bob = reduce({ ...bob, embers: 60 }, { type: 'roll' });
    const monkey = bob.shop.find((o) => o.cardId === 'n3_goldenmonkey');
    expect(monkey, 'the rune swapped a Golden Monkey into the Shop').toBeTruthy();
    bob = ship(press(cindy()), bob);
    const s = reduce({ ...bob, embers: 60 }, { type: 'buy', uid: monkey!.uid });
    const sent = sentCopies(s);
    expect(sent.map((e) => e.card.cardId)).toEqual(['n3_goldenmonkey']);
    expect(sent[0]!.card.golden).toBe(true);
  });

  it('the copy is the plain base card Gilded: the bought card\'s buffs and offer stats do not ride it', () => {
    const def = CARD_INDEX[PLAIN[6]!]!;
    const { bob } = armed({ shop: [offer(6, { atk: 5, hp: 5 })] });
    const s = reduce(bob, { type: 'buy', uid: 's6' });
    expect(s.hand[0]!.attack).toBeGreaterThan(def.attack); // the teammate's minion carries its offer buff
    expect(sentCopies(s)[0]!.card).toMatchObject({ attack: def.attack * 2, health: def.health * 2, golden: true });
  });

  it('a Gilded minion bought gives the same Gilded card (never doubled twice)', () => {
    const def = CARD_INDEX[PLAIN[7]!]!;
    const { bob } = armed({ shop: [offer(7, { golden: true })] });
    const s = reduce(bob, { type: 'buy', uid: 's7' });
    expect(s.hand[0]!.golden).toBe(true);
    expect(sentCopies(s)[0]!.card).toMatchObject({ attack: def.attack * 2, health: def.health * 2, golden: true });
  });

  it('a buy that completes the teammate\'s triple still sends the plain card Gilded', () => {
    const id = PLAIN[8]!;
    const two: BoardCard[] = [0, 1].map((i) => ({ uid: `t${i}`, cardId: id, tribe: CARD_INDEX[id]!.tribe, attack: 1, health: 1, keywords: [], golden: false }));
    const { bob } = armed({ hand: two, shop: [offer(8)] });
    const s = reduce(bob, { type: 'buy', uid: 's8' });
    expect(s.hand.some((c) => c.cardId === id && c.golden)).toBe(true); // the triple happened
    expect(sentCopies(s).map((e) => e.card.cardId)).toEqual([id]);
  });

  it('another hero\'s teammate who was never armed sends nothing', () => {
    const s = reduce(mate(), { type: 'buy', uid: 's0' });
    expect(s.duos!.outbox).toEqual([]);
  });
});

describe('delivery follows the effect-pass rules', () => {
  const fullHand = (): BoardCard[] => Object.values(CARD_INDEX)
    .filter((c) => c && !c.spell && !c.token && !c.duos && !PLAIN.includes(c.id) && c.tier <= 2).slice(0, 10)
    .map((d, i) => ({ uid: `h${i}`, cardId: d!.id, tribe: d!.tribe, attack: d!.attack, health: d!.health, keywords: [...d!.keywords], golden: false }));

  it('a full hand holds the copy until there is room, never refused; it is paid the moment it is held', () => {
    const { ann, bob } = armed();
    const sold = reduce(bob, { type: 'buy', uid: 's0' });
    let got = ship(sold, { ...ann, hand: fullHand() });
    expect(got.hand.length).toBe(handCap(got));
    expect(duosWaitingCount(got)).toBe(1);
    expect(got.duos!.refused).toEqual([]);
    expect(got.cindyGratitude).toBe('paid');
    got = reduce(got, { type: 'passCard', uid: 'h0' });
    expect(duosWaitingCount(got)).toBe(0);
    expect(got.hand.at(-1)).toMatchObject({ cardId: PLAIN[0], golden: true });
  });

  it('lands exactly once, whatever is delivered again', () => {
    const { ann, bob } = armed();
    const sold = reduce(bob, { type: 'buy', uid: 's0' });
    const got = ship(sold, ann);
    expect(ship(sold, got)).toBe(got);
  });

  it('is not a pass: no pass watcher fires on Cindy\'s run', () => {
    const watcher = Object.values(CARD_INDEX).find((c) => c && c.effects.some((e) => e.on === 'teamPassedCard'));
    expect(watcher, 'a pass watcher exists to test against').toBeTruthy();
    const w: BoardCard = { uid: 'w0', cardId: watcher!.id, tribe: watcher!.tribe, attack: watcher!.attack, health: watcher!.health, keywords: [...watcher!.keywords], golden: false };
    const { bob } = armed();
    const sold = reduce(bob, { type: 'buy', uid: 's0' });
    const ann = { ...press(cindy()), board: [structuredClone(w)] };
    const got = ship(sold, ann);
    expect(got.board).toEqual(ann.board);
    const strip = (r: RunState): string => serialize({ ...r, duos: undefined, hand: [], cindyGratitude: undefined, cindyGratitudeCard: undefined });
    const asPass = reduce(ann, { type: 'receivePass', from: 'p1', seq: sold.duos!.outbox.length - 1, card: { ...duosWireOf(sentCopies(sold)[0]!), passGratitude: undefined, passFrom: 'spell' } as BoardCard });
    expect(strip(asPass), 'the control: a real pass DOES move the watcher').not.toBe(strip(got));
  });
});

describe('a reload replays the server\'s rows without a second arm or a second copy', () => {
  it('Cindy\'s arm row: armed again, the charge spent; a press after it is refused', () => {
    const locked = cindy();
    const r = reduce(locked, { type: 'restoreEffectPass', uid: 'team0', cardId: '__team', via: 'sale', gratitude: 'arm' });
    expect(r.cindyGratitude).toBe('armed');
    expect(r.heroPowerSpent).toBe(true);
    expect(r.duos!.outbox[0]).toMatchObject({ team: { kind: 'gratitude' }, restored: true });
    expect(press(r)).toBe(r);
    expect(reduce(r, { type: 'restoreEffectPass', uid: 'team0', cardId: '__team', via: 'sale', gratitude: 'arm' })).toBe(r);
  });

  it('the teammate\'s copy row: the arm is spent, nothing leaves, a later buy sends nothing', () => {
    const { bob } = armed();
    const r = reduce(bob, { type: 'restoreEffectPass', uid: 'grat9', cardId: PLAIN[0]!, via: 'sale', gratitude: 'pay' });
    expect(r.duos!.gratitude).toBeUndefined();
    expect(r.shop).toEqual(bob.shop);
    expect(r.duos!.outbox.at(-1)).toMatchObject({ gratitude: true, restored: true, via: 'sale', card: { uid: 'grat9', golden: true } });
    expect(sentCopies(reduce(r, { type: 'buy', uid: 's1' })).filter((e) => !e.restored)).toHaveLength(0);
  });
});
