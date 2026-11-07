/**
 * R-ROOMWORKS-02 — AN END OF TURN FIRED IN COMBAT RESOLVES IN REAL TIME (owner 2026-11-07).
 *
 * Owner: *"This trigger should happen in combat in real time"* (Dawnclaw's Echo re-firing Roomworks). Roomworks used to
 * sit on `SHOP_ONLY_SHOUTS`: it logged a line mid-fight and the End of Turn landed when the Shop opened. Now the End of
 * Turn runs on the beat through `replayCombatEndOfTurn`. Only an effect whose target is the Shop waits for it
 * (`SHOP_ONLY_END_OF_TURN`). Stats follow the phase: combat-only, like every other combat trigger.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { COMBAT_END_OF_TURN_IDS, FACTORIES, SHOP_ONLY_END_OF_TURN, SHOP_ONLY_SHOUTS, combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, reduce, type BoardCard, type BoardSnapshot, type RunState } from './index';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: 1, health: 400, keywords: [], golden: false, ...extra };
};
/** Taunt on 1 Health: it eats the first swing, so its Echo fires while its neighbours still stand. */
const claw = (uid = 'dc', extra: Partial<BoardCard> = {}): BoardCard => card(uid, 'b2_dawnclaw', { health: 1, keywords: ['T'], ...extra });
const foes = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 400,
  minions: [{ cardId: 'sandbag', attack: 50, health: 4000, keywords: [] }], seed: 1, origin: 'self',
});
const fight = (board: BoardCard[], seed = 7, over: Partial<RunState> = {}) => {
  const s = { ...createRun(seed, 'myra', 'ascent', undefined as never, 'set2'), phase: 'recruit', embers: 60, hand: [], board, tier: 4, ...over } as RunState;
  const fought = reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' }) as RunState;
  const settled = reduce(fought, { type: 'resolveCombat' }) as RunState;
  const events = fought.lastCombat!.events as CombatEvent[];
  const uidOf = (id: string): string => fought.lastCombat!.initial.player.find((m) => m.cardId === id)!.uid;
  return { fought, settled, events, uidOf, deferred: fought.lastCombat!.playerDeferredBattlecries ?? [] };
};
const toHand = (ev: CombatEvent[]): number => ev.filter((e) => e.type === 'toHand').length;
/** The counted End of Turn fires: each is its own moment on screen, so a re-trigger is never just a narration line. */
const eotFires = (ev: CombatEvent[]) => ev.filter((e): e is Extract<CombatEvent, { type: 'shout' }> => e.type === 'shout' && !!e.eot);
const fromSource = (ev: CombatEvent[], uid: string) => ev.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === uid);

describe('R-ROOMWORKS-02 — the content walk', () => {
  it('every End of Turn effect has a live combat body or a reasoned Shop-only entry', () => {
    const missing: string[] = [];
    for (const c of Object.values(CARD_INDEX)) {
      for (const e of c?.effects ?? []) {
        if (e.on !== 'endOfTurn') continue;
        if (!COMBAT_END_OF_TURN_IDS.has(e.do) && !SHOP_ONLY_END_OF_TURN[e.do] && !FACTORIES[e.do as keyof typeof FACTORIES]) missing.push(`${c.id}:${e.do}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('Roomworks is no longer a Shop-only Shout', () => {
    expect(SHOP_ONLY_SHOUTS.battlecryReplayTargetEndOfTurn).toBeUndefined();
    expect(FACTORIES.battlecryReplayTargetEndOfTurn).toBeTypeOf('function');
  });
});

describe('R-ROOMWORKS-02 — Dawnclaw into Roomworks resolves on the beat', () => {
  it('the End of Turn pays in the fight, and settle does not pay it again', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = fight([card('b', 'dw_brewer'), claw(), card('r', 'd2_roomworks')], seed);
      expect(toHand(r.events), 'the Ale arrives mid-fight').toBe(1);
      expect(r.deferred, 'nothing left for the Shop').toEqual([]);
      expect(r.settled.hand.length - r.fought.hand.length, 'one Ale, once').toBe(1);
    }
  });
  it('a gilded Roomworks fires it twice; a gilded Dawnclaw fires both Roomworks', () => {
    expect(toHand(fight([card('b', 'dw_brewer'), claw(), card('r', 'd2_roomworks', { golden: true })]).events)).toBe(2);
    expect(toHand(fight([card('r1', 'd2_roomworks'), claw('dc', { golden: true }), card('r2', 'd2_roomworks'), card('b', 'dw_brewer')]).events)).toBe(2);
  });
  it('each fire is a counted moment, Roomworks to the target, with its consequence right behind it', () => {
    const r = fight([card('b', 'dw_brewer'), claw(), card('r', 'd2_roomworks', { golden: true })]);
    const fires = eotFires(r.events);
    expect(fires.map((e) => [e.source, e.target]), 'gilded = two fires').toEqual(Array(2).fill([r.uidOf('d2_roomworks'), r.uidOf('dw_brewer')]));
    for (const f of fires) expect(r.events[r.events.indexOf(f) + 1]?.type, 'the Ale rides this fire').toBe('toHand');
  });
  it('the source dying later changes nothing, and with no End of Turn minion nothing fires or prints', () => {
    expect(toHand(fight([card('b', 'dw_brewer'), claw(), card('r', 'd2_roomworks', { health: 60 })]).events)).toBe(1);
    const none = fight([claw(), card('r', 'd2_roomworks')]);
    expect(eotFires(none.events)).toEqual([]);
    expect(none.deferred).toEqual([]);
  });
  it('a dead End of Turn minion is not a target', () => {
    const r = fight([card('b', 'dw_brewer', { health: 1, keywords: ['T'] }), claw('dc', { keywords: [], health: 200 }), card('r', 'd2_roomworks')]);
    expect(toHand(r.events)).toBe(0);
  });
  it('the random target spreads across seeds and reproduces per seed (R-TARGET-07)', () => {
    const board = (): BoardCard[] => [card('b', 'dw_brewer'), claw(), card('r', 'd2_roomworks'), card('c', 'cryptscribe')];
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) seen.add(toHand(fight(board(), seed).events));
    expect([...seen].sort(), 'Brewer pays 1 card, Crypt Scribe pays 2').toEqual([1, 2]);
    expect(fight(board(), 11).events).toEqual(fight(board(), 11).events);
  });
});

describe('R-ROOMWORKS-02 — what each kind of End of Turn does mid-fight', () => {
  it('stats are combat-only: Kringle buffs the Dwarves live, the run cards keep their stats', () => {
    const r = fight([card('k', 'dw_foreman'), claw(), card('r', 'd2_roomworks'), card('d', 'dw_gangplank')], 7, { playedThisTurn: ['a', 'b'] });
    expect(fromSource(r.events, r.uidOf('dw_foreman')).length, 'both ends, one + two played = three ticks').toBe(6);
    // The REAL End of Turn already paid in the Shop before the fight; the combat fire must add nothing to the run card.
    expect(r.settled.board.find((c) => c.uid === 'd')!.attack, 'no permanent gain').toBe(r.fought.board.find((c) => c.uid === 'd')!.attack);
  });
  it('Shredder scales off the Equipment left unused', () => {
    const none = fight([card('s', 'n3_shredder'), claw(), card('r', 'd2_roomworks')]);
    expect(fromSource(none.events, none.uidOf('n3_shredder')).length).toBe(0);
    const bm = (cardId: string, attack: number, health: number, keywords: string[] = []): BoardMinion => ({ cardId, attack, health, keywords } as BoardMinion);
    const two = simulate([bm('n3_shredder', 1, 400), bm('b2_dawnclaw', 1, 1, ['T']), bm('d2_roomworks', 1, 400)], [bm('sandbag', 50, 4000)],
      makeRng(4), CARD_INDEX, combatSide({ tier: 4, unusedEquipment: 2 }), combatSide({ tier: 4 }));
    const src = two.initial.player.find((m) => m.cardId === 'n3_shredder')!.uid;
    expect(fromSource(two.events as CombatEvent[], src).length, 'two waves over the two living minions').toBe(4);
  });
  it('Shrieker fires its Shouts live, and never re-enters Roomworks (R-ROOMWORKS-01)', () => {
    const r = fight([card('s', 'd2_shrieker'), claw(), card('r', 'd2_roomworks'), card('a', 'd2_humphry')]);
    expect(eotFires(r.events).length, 'one End of Turn fire').toBe(1);
    const shrieker = r.uidOf('d2_shrieker');
    expect(r.events.filter((e) => e.type === 'shout' && e.source === shrieker).map((e) => (e as { target: string }).target), 'Humphry only, Roomworks excluded')
      .toEqual([r.uidOf('d2_humphry')]);
  });
  it('Moira and Roomworks cannot loop', () => {
    const r = fight([card('m', 'b2_moira'), claw(), card('r', 'd2_roomworks'), card('r2', 'd2_roomworks')]);
    expect(eotFires(r.events).length).toBeLessThanOrEqual(2);
  });
  it('a Shop-only End of Turn fires its line live and acts once, at settle, on the run card', () => {
    const r = fight([card('g', 'dm_gourmand'), claw(), card('r', 'd2_roomworks')]);
    expect(r.deferred.map((d) => [d.cardId, d.uid, d.eot?.map((e) => e.do)])).toEqual([['dm_gourmand', 'g', ['consumeShopRightmost']]]);
    expect(r.events.some((e) => e.type === 'sc' && /Bob Blart's End of Turn/.test((e as { text: string }).text))).toBe(true);
  });
  it('a mixed card splits: Maw buffs Fodder and sends a Fodder, both live', () => {
    const r = fight([card('m', 'maw'), claw(), card('r', 'd2_roomworks')]);
    expect(r.deferred).toEqual([]);
    expect(r.settled.shop.length + (r.settled.pendingTavern?.length ?? 0), 'the Fodder reached the next Shop').toBeGreaterThan(0);
  });
});

describe('R-ROOMWORKS-02 — named casts', () => {
  it('a spell with a combat body casts live; one without finishes at the Shop', () => {
    const live = fight([card('c', 'dw_arnold'), claw(), card('r', 'd2_roomworks')]);
    expect(live.deferred).toEqual([]);
    expect(live.events.some((e) => e.type === 'sc' && /casts Beefy/.test((e as { text: string }).text))).toBe(true);
    const split = fight([card('c', 'dm_curator'), claw(), card('r', 'd2_roomworks')]);
    expect(split.deferred.flatMap((d) => d.eot?.map((e) => e.params?.spellId))).toEqual(['sp_picnic']);
    expect(split.events.some((e) => e.type === 'sc' && /casts Staff of Guel/.test((e as { text: string }).text))).toBe(true);
  });
});

describe('R-ROOMWORKS-02 — the sides are symmetric', () => {
  it('an enemy Dawnclaw into Roomworks fires live too', () => {
    const bm = (cardId: string, attack: number, health: number, keywords: string[] = []): BoardMinion => ({ cardId, attack, health, keywords } as BoardMinion);
    const enemy = [bm('dw_brewer', 1, 400), bm('b2_dawnclaw', 1, 1, ['T']), bm('d2_roomworks', 1, 400)];
    const r = simulate([bm('sandbag', 50, 4000)], enemy, makeRng(4), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    expect((r.events as CombatEvent[]).filter((e) => e.type === 'toHand').length).toBe(1);
  });
});
