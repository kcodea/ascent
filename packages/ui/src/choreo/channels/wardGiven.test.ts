import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { replayBeats, replayOrder } from '../replayOrder';
import { extraWardGainsIn, wardsGivenIn } from './wardGiven';
import { defArrivalMs } from '../../fx/defArrival';
import { clearWardHolds, holdWard, isWardHeld, WARD_HOLD_MAX_MS } from '../../fx/wardHold';
import { CARD_EVENT_SLOTS } from '../../fx/ui/cardEventSlots';
import { fireGroups, wardsPerFire } from '../../fx/wardGivenLaunch';

const bm = (uid: string, cardId: string, attack: number, health: number): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [], golden: false } as unknown as BoardMinion);

describe('a Ward given travels from the giver, then the Ward appears (R-FX-WARD-GIVEN-01)', () => {
  afterEach(() => { clearWardHolds(); vi.useRealTimers(); });

  it('Lastlight Echo: each Ward it gives is found with Lastlight as the source', () => {
    const r = simulate([bm('ll', 'n2_lastlight', 3, 1), bm('a', 'sandbag', 1, 50), bm('b', 'sandbag', 1, 50)],
      [bm('w', 'sandbag', 10, 500)], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const ord = replayOrder(r.events);
    const cardIds = new Map<string, string>();
    for (const m of [...r.initial.player, ...r.initial.enemy]) cardIds.set(m.uid, m.cardId);
    const ll = r.initial.player.find((m) => m.cardId === 'n2_lastlight')!.uid;
    const given = replayBeats(r.events).flatMap((m) => wardsGivenIn(m, ord, cardIds));
    expect(given.length).toBe(2);
    for (const w of given) expect(w).toMatchObject({ cardId: 'n2_lastlight', source: ll });
    expect(new Set(given.map((w) => w.target)).size).toBe(2);
  });

  it('the dome waits for the travelling layer to land, and a def with no travel waits for nothing', () => {
    expect(defArrivalMs({ duration: 900, layers: [{ anchor: 'source', at: 0 }, { anchor: 'travel', at: 100, travelMs: 400, life: 700 }] } as never)).toBe(500);
    expect(defArrivalMs({ duration: 900, layers: [{ anchor: 'travel', at: 50, life: 300 }] } as never)).toBe(350);
    expect(defArrivalMs({ duration: 900, layers: [{ anchor: 'target', at: 0 }] } as never)).toBe(0);
    expect(defArrivalMs(undefined)).toBe(0);
    // A beam lands when its own reach does; a one-shot burst fires from the source and never arrives.
    expect(defArrivalMs({ duration: 1000, layers: [{ primitive: 'beam', anchor: 'travel', at: 0, params: { travelMs: 380 } }, { primitive: 'burst', anchor: 'travel', at: 0, params: {} }] } as never)).toBe(380);
    expect(defArrivalMs({ duration: 1000, layers: [{ primitive: 'lightning', anchor: 'travel', at: 100, params: { travelMs: 0 } }] } as never)).toBe(100);
    // The real Lastlight beam: the Ward lands with the beam, not at the def's end.
    expect(defArrivalMs(JSON.parse(readFileSync(new URL('../../fx/defs/lastlight-beam.json', import.meta.url), 'utf8')))).toBe(380);
  });

  it('a hold always releases on its own, capped so a Ward can never stay hidden', () => {
    vi.useFakeTimers();
    holdWard('x', 400);
    expect(isWardHeld('x')).toBe(true);
    vi.advanceTimersByTime(400);
    expect(isWardHeld('x')).toBe(false);
    holdWard('y', 99_999);
    vi.advanceTimersByTime(WARD_HOLD_MAX_MS);
    expect(isWardHeld('y')).toBe(false);
  });

  it('a FORCED Echo (Spots) credits Lastlight, alive, and every fire is its own volley (Sylus)', () => {
    const r = simulate([bm('sp', 'b2_spots', 6, 10), bm('ll', 'n2_lastlight', 3, 20), bm('a', 'sandbag', 1, 50), bm('b', 'sandbag', 1, 50),
      bm('c', 'sandbag', 1, 50), bm('d', 'sandbag', 1, 50), bm('sy', 'sylus', 1, 70)],
    [bm('w', 'sandbag', 10, 500)], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const ord = replayOrder(r.events);
    const cardIds = new Map<string, string>();
    for (const m of [...r.initial.player, ...r.initial.enemy]) cardIds.set(m.uid, m.cardId);
    const ll = r.initial.player.find((m) => m.cardId === 'n2_lastlight')!.uid;
    const perBeat = replayBeats(r.events).map((m) => wardsGivenIn(m, ord, cardIds).filter((w) => w.forced)).filter((g) => g.length > 0);
    // Spots + Sylus: two fires, each its own beat of two Wards, each from the living Lastlight.
    expect(perBeat.map((g) => g.length)).toEqual([2, 2]);
    for (const w of perBeat.flat()) expect(w).toMatchObject({ cardId: 'n2_lastlight', source: ll, forced: true });
  });

  it('a death-fired Echo multiplied by Sylus splits into fires by its per-fire Ward count', () => {
    const w = (target: string) => ({ cardId: 'n2_lastlight', source: 'L', target });
    expect(wardsPerFire('n2_lastlight', false)).toBe(2);
    expect(wardsPerFire('n2_lastlight', true)).toBe(4);
    expect(fireGroups([w('a'), w('b'), w('c'), w('d')], 2).map((g) => g.map((x) => x.target))).toEqual([['a', 'b'], ['c', 'd']]);
    expect(fireGroups([w('a'), w('b'), w('c')], 2).map((g) => g.length)).toEqual([2, 1]); // a later fire found fewer bodies
  });

  it('the workbench offers On Ward given on Lastlight, not on a card that gives no Ward', () => {
    const slot = CARD_EVENT_SLOTS.find((s) => s.id === 'wardGiven')!;
    const row = (cardId: string) => ({ cardId, name: '', tribe: '', spell: false, defId: null }) as never;
    expect(slot.kindFor(row('n2_lastlight'))).toBe('wardGiven');
    expect(slot.kindFor(row('dw_edward'))).toBe(null);
  });
});

describe('every Ward gained plays the Ward-gained effect (R-FX-WARD-GAIN-EVERY-01)', () => {
  const ev = (target: string, extra: Record<string, unknown> = {}) => ({ type: 'shieldUp', target, ...extra }) as unknown as CombatEvent;
  const mo = (events: CombatEvent[], kind: string) => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [], kind }) as never;

  it('a Ward riding another beat (an Echo, a Start of Combat grant) is still told, one per minion', () => {
    const events = [{ type: 'death', target: 'g' } as unknown as CombatEvent, ev('a', { srcCard: 'x', key: 'factory:scGrantShieldTribe:startOfCombat' }), ev('b')];
    expect(extraWardGainsIn(mo(events, 'death'), events, new Map(), () => false).map((g) => g.target)).toEqual(['a', 'b']);
  });

  it('skips the primary of a Ward-gained beat (its own row plays it) and a Ward its giver travels to', () => {
    const events = [ev('a'), ev('b')];
    expect(extraWardGainsIn(mo(events, 'shieldGain'), events, new Map(), () => false).map((g) => g.target)).toEqual(['b']);
    const ll = [{ type: 'death', target: 'L' } as unknown as CombatEvent, ev('a', { srcCard: 'n2_lastlight', key: 'factory:deathrattleGrantWardRandom:onDeath' }), ev('b')];
    const cardIds = new Map([['L', 'n2_lastlight']]);
    expect(extraWardGainsIn(mo(ll, 'death'), ll, cardIds, (w) => w.source === 'L').map((g) => g.target)).toEqual(['b']);
  });
});
