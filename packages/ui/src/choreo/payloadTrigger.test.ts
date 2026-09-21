import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { buildBeats, RESULT_TYPES } from '../combatBeats';
import { compileMoments, type Moment } from './compile';
import { replayBeats, replayOrder } from './replayOrder';
import { momentKind } from './kinds';
import { runMomentCues, SCORE_DEFAULTS } from './score';
import { bindingFor } from './bindings';
import { beatDelay, getChoreoConfig, holdMsForKind } from './choreoConfig';
import { holdMs } from './clock';
import { PAYLOAD_STACK_MS } from './channels/payloadFired';
import { canPlayDefs, playDef } from '../fx/playDef';
import { anchorsForUnits } from '../fx/combatAnchors';

/**
 * `payload-trigger` (owner-authored, 2026-09-21) — the DAMAGE-METER crossing's presentation, end to end:
 * the engine's `payloadTrigger` event folds into the impact moment of the hit that crossed (the beat), the
 * `payloadFx` channel plays the def bound at the `payloadTrigger` kind ON the body that crossed (the binding),
 * and — THE case the owner named — a crossing on the last attack of the fight, as the LAST event of the log,
 * still produces both the beat and the `playDef` call.
 */
vi.mock('../fx/playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('../fx/combatAnchors', () => ({ anchorsForUnits: vi.fn(() => ({ target: { x: 5, y: 7 } })) }));
const mockPlayDef = vi.mocked(playDef);
const mockCanPlayDefs = vi.mocked(canPlayDefs);
const mockAnchors = vi.mocked(anchorsForUnits);

const attack = (attacker: string, defender: string): CombatEvent => ({ type: 'attack', attacker, defender, swing: 0 } as CombatEvent);
const dmg = (target: string, source: string, amount = 6, remainingHp = 0): CombatEvent => ({ type: 'dmg', target, source, amount, remainingHp } as CombatEvent);
const trigger = (source: string, marker = 'dealtDamageGoldNextTurn'): CombatEvent => ({ type: 'payloadTrigger', source, side: 'player', marker } as CombatEvent);
const death = (target: string): CombatEvent => ({ type: 'death', target, side: 'enemy' } as CombatEvent);
const shape = (ms: { start: number; end: number; primary: CombatEvent }[]) => ms.map(({ start, end, primary }) => ({ start, end, primary }));

const baseCtx = (events: CombatEvent[], cardIds: Map<string, string>, overrides: Partial<Parameters<typeof runMomentCues>[1]> = {}) => ({
  events, cardIds, combatSpeed: 1, onShake: vi.fn(), slotRectOf: () => ({ cx: 0, cy: 0, w: 100, h: 140 }), attackerUid: null, meleePair: null,
  onFloats: vi.fn(), onDeathFloats: vi.fn(), onAuraBurst: vi.fn(), onShieldBreak: vi.fn(), onReborn: vi.fn(), onBuffCasts: vi.fn(),
  onSelfBuffs: vi.fn(), onImprove: vi.fn(), onMaxGold: vi.fn(), onDamageFx: vi.fn(), onSummonFx: vi.fn(), onAscend: vi.fn(), onExecuteFx: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  mockPlayDef.mockReset(); mockPlayDef.mockImplementation(() => () => {});
  mockCanPlayDefs.mockReset(); mockCanPlayDefs.mockImplementation(() => true);
  mockAnchors.mockReset(); mockAnchors.mockImplementation(() => ({ target: { x: 5, y: 7 } }));
});
afterEach(() => vi.restoreAllMocks());

describe('the beat — a crossing rides the impact of the hit that crossed it', () => {
  it('is a RESULT_TYPE, classified as its own kind, paced like damage, with a score row', () => {
    expect(RESULT_TYPES.has('payloadTrigger')).toBe(true);
    expect(momentKind(trigger('gv'))).toBe('payloadTrigger');
    expect(holdMsForKind('payloadTrigger')).toBe(holdMsForKind('damage'));
    expect(Array.isArray(SCORE_DEFAULTS.payloadTrigger)).toBe(true);
    expect(SCORE_DEFAULTS.payloadTrigger.some((c) => c.ch === 'payloadFx')).toBe(true);
    // …and the channel is on EVERY kind, because the event usually rides another kind's moment (its hit's impact)
    // and only sometimes leads its own.
    for (const cues of Object.values(SCORE_DEFAULTS)) expect(cues.some((c) => c.ch === 'payloadFx')).toBe(true);
  });

  it('a LEADING crossing holds like the hit it belongs to: the clock keys by primary event type, and `payloadTrigger` has a real pacing key (= dmg), not the 300 fallback', () => {
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), trigger('gv'), death('foe')];
    const lead: Moment = { start: 2, end: 4, primary: ev[2]!, kind: 'payloadTrigger' } as Moment;
    expect(beatDelay('payloadTrigger')).toBe(beatDelay('dmg'));
    expect(holdMs(lead, undefined, 1)).toBeCloseTo(beatDelay('dmg') * getChoreoConfig().speed, 5);
  });

  it('a mid-clash crossing never splits the impact: [dmg, payloadTrigger, retaliation dmg, death] is ONE beat (and the oracle agrees)', () => {
    const ev = [attack('hg', 'foe'), dmg('foe', 'hg', 40), trigger('hg', 'dealtDamageAleMeter'), dmg('hg', 'foe', 2, 5), death('foe')];
    const beats = buildBeats(ev);
    expect(beats.length).toBe(2);
    expect(beats[1]).toEqual({ start: 1, end: 5, primary: ev[1] });
    expect(shape(compileMoments(ev))).toEqual(shape(beats));
    expect(compileMoments(ev)[1]!.kind).toBe('damage');
  });

  it('THE LAST-EVENT CASE: a payloadTrigger as the very last event of the log still lands in the final impact beat', () => {
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), death('foe'), trigger('gv')];
    const beats = buildBeats(ev);
    expect(beats.length).toBe(2);
    expect(beats[1]).toEqual({ start: 1, end: 4, primary: ev[1] });
    const moments = compileMoments(ev);
    expect(shape(moments)).toEqual(shape(beats));
    expect(replayBeats(ev).at(-1)).toMatchObject({ start: 1, end: 4 });
  });

  it('the binding: the owner’s def is bound at the kind, and resolves for both meter cards', () => {
    expect(bindingFor(null, 'payloadTrigger')).toEqual({ def: 'payload-trigger' });
    expect(bindingFor('k3_goldvein', 'payloadTrigger')?.def).toBe('payload-trigger');
    expect(bindingFor('dw3_hangover', 'payloadTrigger')?.def).toBe('payload-trigger');
  });
});

describe('the cue — payloadFx plays the def ON the body that crossed', () => {
  const lastMoment = (ev: CombatEvent[]): Moment => compileMoments(ev).at(-1)!;

  it('THE LAST-EVENT CASE: a payloadTrigger as the last event of the log → the beat runs, the proc reports, playDef fires on (uid, uid) with uids', () => {
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), death('foe'), trigger('gv')];
    const onPayloadProc = vi.fn();
    const stop = runMomentCues(lastMoment(ev), baseCtx(ev, new Map([['gv', 'k3_goldvein']]), { onPayloadProc }));
    expect(onPayloadProc).toHaveBeenCalledWith('gv', 'dealtDamageGoldNextTurn', 1);
    expect(mockAnchors).toHaveBeenCalledWith('gv', 'gv');
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith('payload-trigger', { target: { x: 5, y: 7 } }, { uids: { source: 'gv', target: 'gv' }, index: 0 });
    stop();
  });

  it('a mid-clash crossing plays from the impact moment, not from a beat of its own', () => {
    const ev = [attack('hg', 'foe'), dmg('foe', 'hg', 40), trigger('hg', 'dealtDamageAleMeter'), dmg('hg', 'foe', 2, 5), death('foe')];
    runMomentCues(lastMoment(ev), baseCtx(ev, new Map([['hg', 'dw3_hangover']])));
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith('payload-trigger', { target: { x: 5, y: 7 } }, { uids: { source: 'hg', target: 'hg' }, index: 0 });
  });

  it('a double crossing (Han Gover’s 80-damage hit) detonates TWICE, a stack stride apart', () => {
    vi.useFakeTimers();
    const ev = [attack('hg', 'foe'), dmg('foe', 'hg', 80), trigger('hg', 'dealtDamageAleMeter'), trigger('hg', 'dealtDamageAleMeter'), death('foe')];
    const onPayloadProc = vi.fn();
    runMomentCues(lastMoment(ev), baseCtx(ev, new Map([['hg', 'dw3_hangover']]), { onPayloadProc }));
    expect(onPayloadProc).toHaveBeenCalledTimes(1);
    expect(onPayloadProc).toHaveBeenCalledWith('hg', 'dealtDamageAleMeter', 2);
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PAYLOAD_STACK_MS - 1);
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    expect(mockPlayDef).toHaveBeenCalledTimes(2);
    expect(mockPlayDef).toHaveBeenLastCalledWith('payload-trigger', { target: { x: 5, y: 7 } }, { uids: { source: 'hg', target: 'hg' }, index: 1 });
    vi.useRealTimers();
  });

  it('when defs cannot play, the proc callback still fires (the fallback pulse) and nothing is scheduled', () => {
    mockCanPlayDefs.mockReturnValue(false);
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), death('foe'), trigger('gv')];
    const onPayloadProc = vi.fn();
    runMomentCues(lastMoment(ev), baseCtx(ev, new Map([['gv', 'k3_goldvein']]), { onPayloadProc }));
    expect(onPayloadProc).toHaveBeenCalledWith('gv', 'dealtDamageGoldNextTurn', 1);
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  it('a body that already left the screen is skipped silently', () => {
    mockAnchors.mockReturnValue(null);
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), death('foe'), trigger('gv')];
    runMomentCues(lastMoment(ev), baseCtx(ev, new Map([['gv', 'k3_goldvein']])));
    expect(mockPlayDef).not.toHaveBeenCalled();
  });

  it('a moment with no crossing plays nothing on this channel', () => {
    const ev = [attack('gv', 'foe'), dmg('foe', 'gv'), death('foe')];
    const onPayloadProc = vi.fn();
    runMomentCues(lastMoment(ev), baseCtx(ev, new Map([['gv', 'k3_goldvein']]), { onPayloadProc }));
    expect(onPayloadProc).not.toHaveBeenCalled();
    expect(mockPlayDef).not.toHaveBeenCalled();
  });
});

describe('a REAL fight — the crossing LEADS its moment (the one-channel rule)', () => {
  // The sim runs the victim's `onDamaged` reactors BEFORE the dealer's meter, so a reactor event that is neither a
  // RESULT_TYPE nor a deferred `buff` lands between the crossing `dmg` and its `payloadTrigger` and splits the
  // impact run. Hearth Whisperer (Set 3 Spirit, Taunt, `onDamagedBuffRandomHand`) emits a player-side `handBuff`
  // when it has a hand minion to buff — and an enemy Goldvein's crossing on that hit then HEADS a moment of its
  // own: `[attack] [dmg,dmg] [handBuff] [payloadTrigger,death]`. That moment is `payloadTrigger`-kind, whose
  // score is BASE — which carries BOTH `payloadFx` (the per-event scan) and `fxDef` (the primary's binding).
  // Without the stand-down in the `fxDef` row the owner's burst played TWICE for one crossing (review 2026-09-21).
  const SET3 = poolFor('set3').all.map((c) => c.id);
  const whisperer = { cardId: 'sp3_hearthwhisperer', attack: 2, health: 6, keywords: ['T'] } as unknown as BoardMinion;
  const enemyVein = { cardId: 'k3_goldvein', attack: 6, health: 30, keywords: [] } as unknown as BoardMinion;
  const handStray = { uid: 'h1', cardId: 'stray', attack: 1, health: 1, keywords: [], golden: false };
  const fight = () => simulate([whisperer], [enemyVein], makeRng(7), CARD_INDEX,
    combatSide({ tier: 6, poolIds: SET3, handMinions: [handStray] }), combatSide({ tier: 6 }));
  const cardIdsOf = (r: ReturnType<typeof fight>): Map<string, string> =>
    new Map([...r.initial.player, ...r.initial.enemy].map((u) => [u.uid, u.cardId] as const));

  it('Hearth Whisperer’s handBuff splits the clash, the enemy Goldvein’s crossing leads its own moment — and the def plays ONCE, on Goldvein', () => {
    const r = fight();
    const gv = r.initial.enemy[0]!.uid;
    const ordered = replayOrder(r.events);
    const beats = replayBeats(r.events);
    expect(beats.map((b) => ordered.slice(b.start, b.end).map((e) => e.type))).toEqual([
      ['attack'], ['dmg', 'dmg'], ['handBuff'], ['payloadTrigger', 'death'],
    ]);
    const last = beats.at(-1)!;
    expect(last.kind).toBe('payloadTrigger');
    expect(SCORE_DEFAULTS.payloadTrigger.some((c) => c.ch === 'fxDef')).toBe(true); // the row IS there — it must stand down
    runMomentCues(last, baseCtx(ordered, cardIdsOf(r)));
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith('payload-trigger', { target: { x: 5, y: 7 } }, { uids: { source: gv, target: gv }, index: 0 });
  });

  it('the synthetic shape of the same log: [attack, dmg, dmg, handBuff, payloadTrigger, death] → one play', () => {
    const handBuff = { type: 'handBuff', uid: 'h1', cardId: 'stray', side: 'player', attack: 1, health: 2 } as CombatEvent;
    const ev = [attack('gv', 'hw'), dmg('hw', 'gv', 6, 0), dmg('gv', 'hw', 2, 28), handBuff, trigger('gv'), death('hw')];
    const moments = compileMoments(ev);
    const lead = moments.find((m) => m.kind === 'payloadTrigger');
    expect(lead).toBeDefined();
    runMomentCues(lead!, baseCtx(ev, new Map([['gv', 'k3_goldvein'], ['hw', 'sp3_hearthwhisperer']])));
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith('payload-trigger', { target: { x: 5, y: 7 } }, { uids: { source: 'gv', target: 'gv' }, index: 0 });
  });
});

describe('a REAL fight — the crossing on the killing blow', () => {
  // `stray` is a vanilla body. (`sandbag` — the Target Dummy — carries an onDamaged +1 Attack reactor whose
  // `buff` the clash-order pass defers PAST the death, which would make the reactor buff the last beat instead.)
  const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'stray', attack, health, keywords: [] } as unknown as BoardMinion);
  const SET3 = poolFor('set3').all.map((c) => c.id);
  const fight = (board: BoardMinion[], foes: BoardMinion[]) =>
    simulate(board, foes, makeRng(5), CARD_INDEX, combatSide({ tier: 6, poolIds: SET3 }), combatSide({ tier: 6 }));
  const cardIdsOf = (r: ReturnType<typeof fight>): Map<string, string> =>
    new Map([...r.initial.player, ...r.initial.enemy].map((u) => [u.uid, u.cardId] as const));

  it('Goldvein’s third hit crosses 6 AND ends the fight: the trigger is in the LAST beat, and that beat plays the def on Goldvein', () => {
    const r = fight([{ cardId: 'k3_goldvein', attack: 2, health: 3, keywords: [] } as unknown as BoardMinion], [foe(0, 1), foe(0, 1), foe(0, 1)]);
    const gv = r.initial.player[0]!.uid;
    expect(r.events.filter((e) => e.type === 'payloadTrigger')).toHaveLength(1);
    const ordered = replayOrder(r.events);
    const beats = replayBeats(r.events);
    const last = beats.at(-1)!;
    expect(ordered.slice(last.start, last.end).map((e) => e.type)).toEqual(['dmg', 'payloadTrigger', 'death']); // the killing blow's own beat
    expect(last.kind).toBe('damage');
    runMomentCues(last, baseCtx(ordered, cardIdsOf(r)));
    expect(mockPlayDef).toHaveBeenCalledTimes(1);
    expect(mockPlayDef).toHaveBeenCalledWith('payload-trigger', { target: { x: 5, y: 7 } }, { uids: { source: gv, target: gv }, index: 0 });
  });

  it('Han Gover’s 40th point of damage ends the fight: the trigger rides the impact beat and plays the def on him (the Ale and the death follow)', () => {
    const r = fight([{ cardId: 'dw3_hangover', attack: 40, health: 7, keywords: [] } as unknown as BoardMinion], [foe(0, 40)]);
    const hg = r.initial.player[0]!.uid;
    const ordered = replayOrder(r.events);
    const beats = replayBeats(r.events);
    const idx = beats.findIndex((b) => ordered.slice(b.start, b.end).some((e) => e.type === 'payloadTrigger'));
    expect(idx).toBeGreaterThan(0);
    expect(beats[idx]!.kind).toBe('damage');
    expect(ordered.slice(beats[idx]!.start, beats[idx]!.end).some((e) => e.type === 'dmg' && e.source === hg)).toBe(true);
    runMomentCues(beats[idx]!, baseCtx(ordered, cardIdsOf(r)));
    expect(mockPlayDef).toHaveBeenCalledWith('payload-trigger', { target: { x: 5, y: 7 } }, { uids: { source: hg, target: hg }, index: 0 });
  });
});
