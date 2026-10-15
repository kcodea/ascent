/**
 * VERSUS turn state (owner 2026-10-14: "i got back from combat and was set in the ready state for some reason?"). The
 * pill ("Players ready N/2"), the shop hold and the clock all read `versusTurn`. Pinned here as the two journeys the
 * owner named, step by step, plus the cases that used to show the pill wrongly (a stale combat row after the next
 * shop opened, and a lock the clock made rather than the player).
 */
import { describe, expect, it } from 'vitest';
import type { VersusMatch } from './versusRemote';
import { versusEndsNow, versusTurn, versusTurnHolds, versusTurnLocksGem, versusTurnNote, type VersusTurnInput } from './versusTurn';

const T0 = Date.parse('2026-10-14T18:00:00Z');
const row = (p: Partial<VersusMatch>): VersusMatch => ({
  id: 'm', p1_user: 'me', p2_user: 'them', phase: 'shop', round: 2, shop_deadline: '2026-10-14T18:00:30Z', combat_deadline: null,
  paused_at: null, p1_locked: false, p2_locked: false, p1_ready: false, p2_ready: false, p1_auto: false, p2_auto: false,
  p1_intro: true, p2_intro: true, ...p,
} as VersusMatch);
const at = (match: VersusMatch, wave: number, phase: 'recruit' | 'combat', lockedRound: number | null = null, now = T0): VersusTurnInput =>
  ({ match, seat: 'p1', lockedRound, run: { mode: 'versus', phase, wave }, now });
const view = (i: VersusTurnInput) => { const t = versusTurn(i); return { kind: t.kind, held: versusTurnHolds(t), pill: versusTurnNote(t) }; };

describe('shop -> end early -> pill -> both locked -> combat', () => {
  it('walks the round', () => {
    expect(view(at(row({}), 2, 'recruit'))).toEqual({ kind: 'shop', held: false, pill: null });
    expect(view(at(row({ p1_locked: true }), 2, 'recruit', 2))).toEqual({ kind: 'locked', held: true, pill: 'Players ready 1/2' });
    expect(view(at(row({ p1_locked: true, p2_locked: true, phase: 'resolving' }), 2, 'recruit', 2))).toEqual({ kind: 'locked', held: true, pill: 'Players ready 2/2' });
    expect(view(at(row({ phase: 'combat', p1_locked: true, p2_locked: true }), 2, 'combat', 2))).toEqual({ kind: 'fight', held: false, pill: null });
  });
  it('the locked pill counts my own lock before the server row has it', () => {
    expect(view(at(row({}), 2, 'recruit', 2)).pill).toBe('Players ready 1/2');
  });
});

describe('combat -> back early -> waiting (pill, no clock) -> both back -> new shop unlocked, no pill', () => {
  it('walks the return', () => {
    const fight = row({ phase: 'combat', round: 2, shop_deadline: null, combat_deadline: '2026-10-14T18:01:30Z' });
    expect(view(at(fight, 2, 'combat', 2))).toEqual({ kind: 'fight', held: false, pill: null });
    expect(view(at({ ...fight, p1_ready: true }, 3, 'recruit', 2))).toEqual({ kind: 'back', held: true, pill: 'Players ready 1/2' });
    // Both back: the server opens round 3. The previous round's lock (lockedRound 2) carries nothing into it.
    expect(view(at(row({ round: 3 }), 3, 'recruit', 2))).toEqual({ kind: 'shop', held: false, pill: null });
  });
  it('the opponent back first: my own return opens the shop with no pill', () => {
    expect(view(at(row({ round: 3, p2_ready: false }), 3, 'recruit', null))).toEqual({ kind: 'shop', held: false, pill: null });
  });
});

describe('the cases that used to show the pill wrongly', () => {
  it('a combat row past its cap is stale (the next shop is already open): held, no pill, re-read', () => {
    const stale = row({ phase: 'combat', round: 2, p1_ready: true, combat_deadline: '2026-10-14T17:59:00Z' });
    const t = versusTurn(at(stale, 3, 'recruit', 2));
    expect([t.kind, t.stale, versusTurnNote(t)]).toEqual(['waiting', true, null]);
  });
  it('the clock ran out (I never pressed End Turn): held while the fight comes, but no pill', () => {
    expect(view(at(row({ phase: 'resolving', p1_locked: true, p2_locked: true }), 2, 'recruit', null))).toEqual({ kind: 'waiting', held: true, pill: null });
  });
  it('round 1 before my Good Luck intro is over: held, no pill; after it, 1/2 until theirs', () => {
    const r1 = row({ round: 1, shop_deadline: null, p1_intro: false, p2_intro: false });
    expect(view(at(r1, 1, 'recruit'))).toEqual({ kind: 'waiting', held: true, pill: null });
    expect(view(at({ ...r1, p1_intro: true }, 1, 'recruit'))).toEqual({ kind: 'intro', held: true, pill: 'Players ready 1/2' });
    expect(view(at(row({ round: 1 }), 1, 'recruit'))).toEqual({ kind: 'shop', held: false, pill: null });
  });
  it('a pause, the end, or no Versus run: nothing', () => {
    expect(versusTurn(at(row({ paused_at: 'x' }), 2, 'recruit', 2)).kind).toBe('none');
    expect(versusTurn(at(row({ phase: 'complete' }), 2, 'recruit', 2)).kind).toBe('none');
    expect(versusTurn({ ...at(row({}), 2, 'recruit', 2), run: { mode: 'lobby', phase: 'recruit', wave: 2 } }).kind).toBe('none');
  });
  it('an absent seat on auto counts as ready', () => {
    expect(view(at(row({ p2_auto: true }), 2, 'recruit', 2)).pill).toBe('Players ready 2/2');
  });
});

describe('the end gate: a concede shuts it at once, a hearts finish after its deciding fight (owner 2026-10-14)', () => {
  const ended = (end_reason: VersusMatch['end_reason'], round = 3) => row({ phase: 'complete', round, end_reason });
  const run = (phase: 'recruit' | 'combat', wave: number) => ({ mode: 'versus' as const, phase, wave });
  const rounds = { 1: {}, 2: {}, 3: {} };
  it('a concede closes it wherever the player is: shop, mid-fight, hero select', () => {
    for (const r of [run('recruit', 3), run('combat', 3), run('combat', 2), run('recruit', 4)]) {
      expect(versusEndsNow({ match: ended('forfeit'), rounds, run: r, heroSelect: false }), JSON.stringify(r)).toBe(true);
    }
    expect(versusEndsNow({ match: ended('forfeit', 0), rounds: {}, run: { mode: 'lobby', phase: 'recruit', wave: 1 }, heroSelect: true })).toBe(true);
    expect(versusEndsNow({ match: ended('missed'), rounds, run: run('combat', 3), heroSelect: false })).toBe(true);
  });
  it('a hearts finish waits: the deciding fight (still to land, or on screen) is watched; past it, it closes', () => {
    expect(versusEndsNow({ match: ended('hearts'), rounds, run: run('recruit', 3), heroSelect: false })).toBe(false);
    expect(versusEndsNow({ match: ended('hearts'), rounds, run: run('combat', 3), heroSelect: false })).toBe(false);
    expect(versusEndsNow({ match: ended('hearts'), rounds, run: run('recruit', 4), heroSelect: false })).toBe(true);
  });
  it('a match still running never closes it', () => {
    expect(versusEndsNow({ match: row({}), rounds, run: run('recruit', 2), heroSelect: false })).toBe(false);
  });
});

describe('the fight screen: End Combat waits for both, the second player gets 5 s (owner 2026-10-14)', () => {
  const fight = (p: Partial<VersusMatch>) => row({ phase: 'combat', round: 2, combat_deadline: '2026-10-14T18:00:05Z', ...p });
  const inFight = (match: VersusMatch, readyRound: number | null = null): VersusTurnInput =>
    ({ match, seat: 'p1', lockedRound: 2, readyRound, run: { mode: 'versus', phase: 'combat', wave: 2 }, now: T0 });
  it('nobody pressed: the fight, no pill', () => {
    expect(view(inFight(fight({})))).toEqual({ kind: 'fight', held: false, pill: null });
  });
  it('I pressed first: I stay on the fight with 1/2 and a spent gem', () => {
    const t = versusTurn(inFight(fight({}), 2));
    expect([t.kind, versusTurnNote(t), versusTurnLocksGem(t)]).toEqual(['fightReady', 'Players ready 1/2', true]);
  });
  it('they pressed first: "Opponent is ready" with my seconds, and my gem still works', () => {
    const t = versusTurn(inFight(fight({ p2_ready: true })));
    expect([t.kind, t.deadline, versusTurnNote(t, 4), versusTurnLocksGem(t)]).toEqual(['foeReady', Date.parse('2026-10-14T18:00:05Z'), 'Opponent is ready · 4s', false]);
  });
  it('the next shop opened (both pressed, or the 5 s ran out): leave the fight', () => {
    expect(versusTurn(inFight(row({ phase: 'shop', round: 3 }), 2)).kind).toBe('leave');
    expect(versusTurn(inFight(row({ phase: 'shop', round: 3 }))).kind).toBe('leave');
  });
});
