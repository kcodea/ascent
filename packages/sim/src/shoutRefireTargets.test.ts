/**
 * A TARGETED SHOUT RE-FIRED WITHOUT AN AIM PICKS A RANDOM LEGAL TARGET (R-TARGET-06, owner ruling 2026-09-26).
 *
 * Question (#1755): "Gravetwin, Auric Runemaster and Graverobber: when re-fired (in combat or the Shop) they have
 * no target, so they do nothing. Should they pick a random target instead?"  Owner: *"yes they should pick a
 * random target."*
 *
 * Played from hand the player still aims. A RE-FIRE (Resonance, Myra, Echoing Roar, an End-of-Turn replay in the
 * Shop; Dawnclaw / Ryme, a Rally re-fire, an Ancient of Time in combat) picks at random from the card's legal
 * targets, the Baby Gastrid / Appetite Agent convention: the Shop draws off the run's rng cursor, combat off
 * `ctx.rng`. Never itself (R-TARGET-03); nothing legal → nothing happens (no draw either).
 *
 *   · Gravetwin      a random other friendly ECHO minion (its Echo is copied)
 *   · Auric Runemaster a random other friendly that is not Gilded (Gilded; combat: for that fight)
 *   · Graverobber    a random other friendly (destroyed, its Echo fires, a spell of its tier to hand)
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, createRun, enableAncients, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { replayBattlecry } from './recruit';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: 400, keywords: [], golden: false, ...extra };
};
const shop = (board: BoardCard[], over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'myra'), phase: 'recruit', hand: [], board, ...over } as RunState);
/** Re-fire `uid`'s Shout the way Resonance / Myra / Echoing Roar do: no aim. */
const refireInShop = (s: RunState, uid: string): RunState => {
  const next = structuredClone(s);
  replayBattlecry(next, next.board.find((c) => c.uid === uid)!);
  return next;
};
const echoOf = (cardId: string) => CARD_INDEX[cardId]!.effects.filter((e) => e.on === 'onDeath');

// ── SHOP ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('R-TARGET-06 Shop re-fire — Gravetwin copies a RANDOM friendly Echo', () => {
  const board = () => [card('g', 'gravetwin'), card('a', 'k_geode'), card('x', 'whelpling'), card('b', 'dw_anvilshade')];

  it('copies one of the Echo minions (never the Echo-less body, never itself), off the run cursor', () => {
    const s = shop(board());
    const out = refireInShop(s, 'g');
    const g = out.board.find((c) => c.uid === 'g')!;
    expect(g.copiedEcho?.length, 'a re-fire now copies something').toBeGreaterThan(0);
    expect([CARD_INDEX.k_geode!.name, CARD_INDEX.dw_anvilshade!.name]).toContain(g.copiedEchoName);
    const src = g.copiedEchoName === CARD_INDEX.k_geode!.name ? 'k_geode' : 'dw_anvilshade';
    expect(g.copiedEcho!.map((e) => e.do)).toEqual(echoOf(src).map((e) => e.do));
    expect(out.rngCursor, 'one draw off the shared cursor').not.toBe(s.rngCursor);
  });

  it('is deterministic: the same state re-fires onto the same body', () => {
    const s = shop(board());
    expect(refireInShop(s, 'g').board[0]!.copiedEchoName).toBe(refireInShop(s, 'g').board[0]!.copiedEchoName);
  });

  it('both Echo minions are reachable across seeds (it is random, not the left-most)', () => {
    const seen = new Set<string | undefined>();
    for (let seed = 1; seed <= 40 && seen.size < 2; seed++) seen.add(refireInShop(shop(board(), { rngCursor: seed * 7919 }), 'g').board[0]!.copiedEchoName);
    expect(seen.size).toBe(2);
  });

  it('no friendly Echo minion → nothing happens, and no draw is taken', () => {
    const s = shop([card('g', 'gravetwin'), card('x', 'whelpling')]);
    const out = refireInShop(s, 'g');
    expect(out.board[0]!.copiedEcho).toBeUndefined();
    expect(out.rngCursor).toBe(s.rngCursor);
  });
});

describe('R-TARGET-06 Shop re-fire — Auric Runemaster Gilds a RANDOM non-Gilded friendly', () => {
  it('Gilds the only legal body (the Gilded one and itself are not candidates)', () => {
    const s = shop([card('r', 'dw_runemaster'), card('gold', 'whelpling', { golden: true }), card('a', 'k_geode')]);
    const out = refireInShop(s, 'r');
    expect(out.board.find((c) => c.uid === 'a')!.golden).toBe(true);
    expect(out.board.find((c) => c.uid === 'r')!.golden, 'never itself').toBe(false);
  });

  it('is deterministic, and random across seeds', () => {
    const board = () => [card('r', 'dw_runemaster'), card('a', 'k_geode'), card('b', 'whelpling')];
    const gilded = (s: RunState) => refireInShop(s, 'r').board.filter((c) => c.golden).map((c) => c.uid);
    const s = shop(board());
    expect(gilded(s)).toEqual(gilded(s));
    expect(gilded(s).length).toBe(1);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40 && seen.size < 2; seed++) seen.add(gilded(shop(board(), { rngCursor: seed * 7919 }))[0]!);
    expect(seen).toEqual(new Set(['a', 'b']));
  });

  it('every other friendly already Gilded → nothing happens, and no draw is taken', () => {
    const s = shop([card('r', 'dw_runemaster'), card('gold', 'whelpling', { golden: true })]);
    const out = refireInShop(s, 'r');
    expect(out.board.map((c) => c.golden)).toEqual([false, true]);
    expect(out.rngCursor).toBe(s.rngCursor);
  });
});

describe('R-TARGET-06 Shop re-fire — Graverobber destroys a RANDOM other friendly for a spell of its tier', () => {
  it('destroys the other body at once (its Echo fires) and adds a spell of its tier; never itself', () => {
    const s = shop([card('gr', 'graverobber'), card('a', 'k_geode')]);
    const out = refireInShop(s, 'gr');
    expect(out.board.some((c) => c.uid === 'a'), 'the victim is gone').toBe(false);
    expect(out.board.some((c) => c.uid === 'gr'), 'never itself').toBe(true);
    expect(out.pendingDeath, 'a re-fired death resolves immediately, never left pending').toBeUndefined();
    const got = out.hand.filter((c) => CARD_INDEX[c.cardId]?.spell);
    expect(got.length).toBe(1);
    expect(CARD_INDEX[got[0]!.cardId]!.tier).toBe(CARD_INDEX.k_geode!.tier);
  });

  it('is deterministic: the same state destroys the same body and draws the same spell', () => {
    const s = shop([card('gr', 'graverobber'), card('a', 'k_geode'), card('b', 'dw_anvilshade')]);
    const one = refireInShop(s, 'gr');
    const two = refireInShop(s, 'gr');
    expect(one.board.map((c) => c.uid)).toEqual(two.board.map((c) => c.uid));
    expect(one.hand.map((c) => c.cardId)).toEqual(two.hand.map((c) => c.cardId));
  });

  it('alone on the board → nothing happens (no death, no spell, no draw)', () => {
    const s = shop([card('gr', 'graverobber')]);
    const out = refireInShop(s, 'gr');
    expect(out.board.map((c) => c.uid)).toEqual(['gr']);
    expect(out.hand).toEqual([]);
    expect(out.rngCursor).toBe(s.rngCursor);
  });

  it('an AIMED play still destroys the aimed body (the player picks; only a re-fire is random)', () => {
    const s = shop([card('a', 'k_geode'), card('b', 'dw_anvilshade')], { hand: [card('h', 'graverobber')] });
    let next = reduce(s, { type: 'play', uid: 'h', toIndex: 2 });
    expect(next.pendingTarget, 'the hand play asks for an aim').toBeTruthy();
    next = reduce(next, { type: 'battlecryTarget', targetUid: 'b' });
    next = reduce(next, { type: 'resolveShopDeath' });
    expect(next.board.some((c) => c.uid === 'b'), 'the aimed body died').toBe(false);
    expect(next.board.some((c) => c.uid === 'a'), 'the other one did not').toBe(true);
  });
});

// ── COMBAT ───────────────────────────────────────────────────────────────────────────────────────────────────

const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, ...extra } as BoardMinion);
/** Dawnclaw (1/1) dies to the first swing and its Echo re-fires its living neighbours' Shouts, live. */
const refire = (left: BoardMinion, right: BoardMinion[] = [], seed = 4, side = combatSide({ tier: 6 })) => simulate(
  [left, bm('b2_dawnclaw', 1, 1), ...right], [bm('sandbag', 50, 9999)], makeRng(seed), CARD_INDEX, side, combatSide({ tier: 6 }));
const ofType = <T extends CombatEvent['type']>(ev: readonly CombatEvent[], t: T) =>
  ev.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === t);
const afterShout = (ev: readonly CombatEvent[]) => ev.slice(Math.max(0, ev.findIndex((e) => e.type === 'shout')));

describe('R-TARGET-06 combat re-fire — resolves LIVE on the Shout beat (R-REALTIME-03)', () => {
  it('Gravetwin copies a random friendly Echo on the beat and carries the copy back to its run card', () => {
    const r = refire(bm('gravetwin', 1, 9999, { sourceUid: 'run-g' }), [bm('whelpling', 1, 9999), bm('k_geode', 1, 9999)]);
    expect(afterShout(r.events).some((e) => e.type === 'sc' && /copies .*Echo/.test((e as { text: string }).text))).toBe(true);
    const carried = r.playerShoutCarry?.copiedEchoes;
    expect(carried?.map((c) => [c.uid, c.name])).toEqual([['run-g', CARD_INDEX.k_geode!.name]]);
    expect(carried![0]!.effects.map((e) => e.do)).toEqual(echoOf('k_geode').map((e) => e.do));
    expect(r.playerDeferredBattlecries).toBeUndefined();
  });

  it('Gravetwin with no friendly Echo minion does nothing', () => {
    const r = refire(bm('gravetwin', 1, 9999, { sourceUid: 'run-g' }), [bm('whelpling', 1, 9999)]);
    expect(r.playerShoutCarry?.copiedEchoes).toBeUndefined();
  });

  it('Auric Runemaster Gilds a random non-Gilded friendly for the fight (an in-fight gild + its stats again)', () => {
    const r = refire(bm('dw_runemaster', 1, 9999), [bm('whelpling', 1, 9999, { golden: true }), bm('k_geode', 1, 9999)]);
    const geode = r.initial.player.find((m) => m.cardId === 'k_geode')!.uid;
    const gilds = ofType(afterShout(r.events), 'ascend').filter((e) => e.gild);
    expect(gilds.map((e) => e.target)).toEqual([geode]);
    const src = r.initial.player[0]!.uid;
    const d = CARD_INDEX.k_geode!;
    expect(ofType(r.events, 'buff').filter((e) => e.source === src && e.target === geode).map((e) => [e.attack, e.health])).toEqual([[d.attack, d.health]]);
  });

  it('Auric Runemaster with every other friendly Gilded does nothing', () => {
    const r = refire(bm('dw_runemaster', 1, 9999), [bm('whelpling', 1, 9999, { golden: true })]);
    expect(ofType(r.events, 'ascend').length).toBe(0);
  });

  it('Graverobber destroys a random other friendly and a spell of its tier flies to hand, live', () => {
    const r = refire(bm('graverobber', 1, 9999), [bm('k_geode', 1, 9999)], 4, combatSide({ tier: 6, tribes: ['kobold'] }));
    const geode = r.initial.player.find((m) => m.cardId === 'k_geode')!.uid;
    const ev = afterShout(r.events);
    const toHand = ofType(ev, 'toHand');
    expect(toHand.length).toBe(1);
    expect(CARD_INDEX[toHand[0]!.cardId]!.spell).toBe(true);
    expect(CARD_INDEX[toHand[0]!.cardId]!.tier).toBe(CARD_INDEX.k_geode!.tier);
    expect(ofType(ev, 'death').some((e) => e.target === geode), 'the victim died in the fight').toBe(true);
    expect(r.playerHandGrants).toEqual([toHand[0]!.cardId]);
  });

  it('Graverobber with no other living friendly does nothing', () => {
    const r = refire(bm('graverobber', 1, 9999));
    const ev = afterShout(r.events);
    const beat = ev.slice(0, Math.max(1, ev.findIndex((e) => e.type === 'attack')));
    expect(ofType(r.events, 'toHand').length).toBe(0);
    expect(ofType(beat, 'death').length, 'the Shout destroyed nothing').toBe(0);
  });

  it('deterministic: the same seed picks the same targets; the pick is random across seeds', () => {
    const run = (seed: number) => refire(bm('dw_runemaster', 1, 9999), [bm('k_geode', 1, 9999), bm('whelpling', 1, 9999)], seed);
    const pick = (seed: number) => {
      const r = run(seed);
      const t = ofType(r.events, 'ascend').find((e) => e.gild)!.target;
      return r.initial.player.find((m) => m.uid === t)!.cardId;
    };
    expect(run(9).events).toEqual(run(9).events);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40 && seen.size < 2; seed++) seen.add(pick(seed));
    expect(seen).toEqual(new Set(['k_geode', 'whelpling']));
  });
});

// ── END TO END: the reducer fight + settle (Auctioneer × Time fires the edge Shouts at Start of Combat) ────────

const withTime = (over: Partial<RunState> = {}): RunState => {
  const id: AncientId = 'time';
  let s = enableAncients({ ...createRun(7, 'myra'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  return reduce(s, { type: 'pickAncient', id });
};
const foes = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 400,
  minions: [{ cardId: 'sandbag', attack: 0, health: 400, keywords: [] }], seed: 1, origin: 'self',
});
const fightAndSettle = (s: RunState): { fought: RunState; settled: RunState } => {
  const fought = reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' });
  return { fought, settled: reduce(fought, { type: 'resolveCombat' }) };
};

describe('R-TARGET-06 end to end — a combat re-fire lands once at settle', () => {
  it('Gravetwin: the copy made in the fight is on its run card after settle (it fires next Shop if it survived)', () => {
    const { settled } = fightAndSettle(withTime({ board: [card('g', 'gravetwin'), card('a', 'k_geode')] }));
    const g = settled.board.find((c) => c.uid === 'g')!;
    expect(g.copiedEchoName).toBe(CARD_INDEX.k_geode!.name);
    expect(g.copiedEcho!.map((e) => e.do)).toEqual(echoOf('k_geode').map((e) => e.do));
  });

  it('Auric Runemaster: the combat gild is for the fight only; the run card is not Gilded after settle', () => {
    const { fought, settled } = fightAndSettle(withTime({ board: [card('r', 'dw_runemaster'), card('a', 'k_geode')] }));
    expect((fought.lastCombat!.events as CombatEvent[]).some((e) => e.type === 'ascend' && e.gild)).toBe(true);
    expect(settled.board.find((c) => c.uid === 'a')!.golden).toBe(false);
  });
});
