// @vitest-environment jsdom
/**
 * THE DUOS HAND-OFF BEAT (R-DUOS-HANDOFF-BEAT-01): the tag-in is speed-true and order-true, every hand-off event has a
 * sound and an accent, and the accent fits inside the beat that already holds it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent, MinionSnapshot } from '@game/core';

const fx = vi.hoisted(() => ({ plays: [] as { id: string; opts: Record<string, unknown> | undefined }[], can: true }));
vi.mock('../../fx/playDef', () => ({
  canPlayDefs: () => fx.can,
  playDef: (id: string, _a: unknown, opts?: Record<string, unknown>) => { fx.plays.push({ id, opts }); return () => {}; },
}));

import { isSpeedTimedAnim } from '../../floatConfig';
import { sfx } from '../../sfx';
import { getChoreoConfig } from '../choreoConfig';
import { holdMs } from '../clock';
import type { Moment } from '../compile';
import { getScore } from '../score';
import { playMomentSfx } from './sfx';
import {
  FALLEN_DIM_MS, TAG_FLY_MS, TAG_LAND_FRAC, TAG_MAX_ORDER, TAG_STAGGER_MS, handoffsIn, playHandoffFx, tagAnimClass,
  tagEntranceMs, tagLandMs, tagLandsMs, tagLastLandMs, tagOrder,
} from './duosHandoff';

const css = readFileSync(join(__dirname, '../../styles.css'), 'utf8');
const body = (uid: string): MinionSnapshot => ({ uid, cardId: 'x', name: uid, attack: 1, health: 1 } as unknown as MinionSnapshot);
const bodies = (n: number, p = 'b'): MinionSnapshot[] => Array.from({ length: n }, (_, i) => body(`${p}${i}`));
const moment = (events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[]], kind: 'tagIn' });
const tagIn = (side: 'player' | 'enemy', n: number): CombatEvent => ({ type: 'tagIn', side, member: 1, minions: bodies(n) } as CombatEvent);
const flyIn = (side: 'player' | 'enemy', n: number): CombatEvent => ({ type: 'flyIn', side, member: 1, index: 3, minions: bodies(n) } as CombatEvent);
const fallen = (side: 'player' | 'enemy'): CombatEvent => ({ type: 'boardFallen', side, member: 0 } as CombatEvent);

beforeEach(() => { fx.plays.length = 0; fx.can = true; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('the entrance is speed-true', () => {
  it('styles.css divides the flight and every stagger step by --combat-speed, with the numbers this module holds', () => {
    expect(css).toContain(`.unit.tagin .card { animation: taginfly calc(${TAG_FLY_MS / 1000}s / var(--combat-speed, 1))`);
    for (let o = 1; o <= TAG_MAX_ORDER; o++) {
      expect(css).toContain(`.unit.tagin.tagi-${o} .card { animation-delay: calc(${o * TAG_STAGGER_MS}ms / var(--combat-speed, 1)); }`);
    }
    // the old slot-keyed, fixed-length rules are gone
    expect(css).not.toMatch(/\.unit\.tagin:nth-child/);
    expect(css).not.toMatch(/taginfly 0\.52s cubic/);
  });

  it('Unit stamps the live speed on a tagging-in body (the same stamp a death gets)', () => {
    const unit = readFileSync(join(__dirname, '../../Unit.tsx'), 'utf8');
    expect(unit).toContain('const speedTimed = isSpeedTimedAnim(anim);');
    expect(unit).toContain("'--combat-speed': String(liveCombatSpeed())");
    // ...and the entrance's own classes are ones the stamp recognises (`tagin`, with or without its turn)
    expect(isSpeedTimedAnim(tagAnimClass('player', 0, 7))).toBe(true);
    expect(isSpeedTimedAnim(tagAnimClass('player', 6, 7))).toBe(true);
    expect(isSpeedTimedAnim(tagAnimClass('enemy', 2, 7))).toBe(true);
  });

  // A hold is the wait BEFORE `next` shows, so the time a tag-in gets on screen is the hold of whatever FOLLOWS it.
  const after = (kind: Moment['kind'], primary: CombatEvent): Moment => ({ start: 1, end: 2, primary, stepGroups: [[]], kind });
  const swing = after('attackExchange', { type: 'attack', attacker: 'b0', defender: 'x' } as CombatEvent);
  const summon = after('summon', { type: 'summon', side: 'player', index: 0, minion: body('s') } as CombatEvent);

  it('at 1x, 2x and 5x nothing follows a tag-in until its last body has landed: not a swing, not a summon riding it', () => {
    for (const speed of [1, 2, 5]) {
      for (const n of [1, 3, 7]) {
        const shown = moment([tagIn('player', n)]);
        for (const next of [swing, summon]) {
          expect(holdMs(next, shown, speed), `${n} bodies, ${next.kind}, ${speed}x`).toBeGreaterThanOrEqual(tagEntranceMs(n, speed) - 0.001);
          expect(holdMs(next, shown, speed)).toBeGreaterThan(tagLastLandMs(n, speed));
        }
        const fly: Moment = { ...moment([flyIn('enemy', n)]), kind: 'flyIn' };
        expect(holdMs(swing, fly, speed)).toBeGreaterThanOrEqual(tagEntranceMs(n, speed) - 0.001);
      }
    }
    expect(tagLandMs(0, 1)).toBeCloseTo(TAG_FLY_MS * TAG_LAND_FRAC);
    expect(tagLandMs(3, 2)).toBeCloseTo((3 * TAG_STAGGER_MS + TAG_FLY_MS * TAG_LAND_FRAC) / 2);
  });

  it('a short entrance never shortens the beat after it (one body: the swing keeps its own lead-in)', () => {
    const cfg = getChoreoConfig();
    expect(holdMs(swing, moment([tagIn('player', 1)]), 1)).toBe(Math.max(cfg.attack * cfg.speed, tagEntranceMs(1, 1)));
    // and a beat that is not a hand-off is untouched
    const death: Moment = { start: 0, end: 1, primary: { type: 'death', target: 'x', side: 'player' } as CombatEvent, stepGroups: [[]], kind: 'death' };
    expect(holdMs(summon, death, 1)).toBe(cfg.overlapMs);
  });

  it('NO FIGHT IS LONGER: the fallen board to the first swing takes no more time than before, and the dim fits its window', () => {
    const cfg = getChoreoConfig();
    const WAS_TAG_IN_MS = 640 * cfg.speed; // the old lead-in (960 ms of dead air before the fly-in)
    const WAS_SWING_MS = cfg.attack * cfg.speed; // ...and the fly-in then got only the swing's own lead-in
    const fallenBeat: Moment = { ...moment([fallen('player')]), kind: 'boardFallen' };
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const tag = moment([tagIn('player', n)]);
      const now = holdMs(tag, fallenBeat, 1) + holdMs(swing, tag, 1);
      expect(now, `${n} bodies`).toBeLessThanOrEqual(WAS_TAG_IN_MS + WAS_SWING_MS);
    }
    // the fallen board is read for as long as its dim plays, at every speed
    for (const speed of [1, 2, 5]) expect(holdMs(moment([tagIn('player', 7)]), fallenBeat, speed)).toBeGreaterThanOrEqual(FALLEN_DIM_MS / speed);
    // the lead-in before the fallen beat itself is untouched (the last death settles)
    const death: Moment = { start: 0, end: 1, primary: { type: 'death', target: 'x', side: 'player' } as CombatEvent, stepGroups: [[]], kind: 'death' };
    expect(holdMs(fallenBeat, death, 1)).toBe(260 * cfg.speed); // tightened 2026-11-12 (was 380: a long stall after the last death)
  });

  it('reduced motion swaps the drop for a fade (same length, same stagger)', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.unit\.tagin \.card \{ animation-name: taginfade;/);
    expect(css).not.toMatch(/taginflyfoe/); // 2026-11-11: one drop-in entrance for both teams, the mirrored sideways sweep is gone
  });
});

describe('the stagger follows the arriving bodies, not the slot', () => {
  it('my team leaves left to right; the other team mirrors (its nearest body, the last, leaves first)', () => {
    expect([0, 1, 2].map((i) => tagOrder('player', i, 3))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((i) => tagOrder('enemy', i, 3))).toEqual([2, 1, 0]);
    expect(tagAnimClass('player', 0, 7)).toBe('tagin');
    expect(tagAnimClass('player', 6, 7)).toBe('tagin tagi-6');
    expect(tagAnimClass('enemy', 6, 7)).toBe('tagin');
  });

  it('one body joining six survivors leaves at once (it used to wait 360 ms in slot seven)', () => {
    expect(tagAnimClass('player', 0, 1)).toBe('tagin');
    expect(tagAnimClass('enemy', 0, 1)).toBe('tagin');
  });
});

describe('every hand-off event rings (it was silent)', () => {
  it('a tag-in plays the stinger for its side, timed to the last landing at the live speed', () => {
    const tag = vi.spyOn(sfx, 'duosTagIn').mockImplementation(() => {});
    const ev = [tagIn('enemy', 5)];
    playMomentSfx(moment(ev), ev, undefined, 2);
    expect(tag).toHaveBeenCalledTimes(1);
    expect(tag).toHaveBeenCalledWith('enemy', tagLandsMs(5, 2));
    playMomentSfx(moment(ev), ev); // no speed given = 1x
    expect(tag).toHaveBeenLastCalledWith('enemy', tagLandsMs(5, 1));
  });

  it('a fallen board and a fly-in ring their own cues, once per side per moment', () => {
    const fell = vi.spyOn(sfx, 'duosBoardFallen').mockImplementation(() => {});
    const fly = vi.spyOn(sfx, 'duosFlyIn').mockImplementation(() => {});
    const tag = vi.spyOn(sfx, 'duosTagIn').mockImplementation(() => {});
    const ev = [fallen('player'), fallen('player'), flyIn('enemy', 2)];
    const r = playMomentSfx(moment(ev), ev, undefined, 1);
    expect(fell).toHaveBeenCalledTimes(1);
    expect(fell).toHaveBeenCalledWith('player');
    expect(fly).toHaveBeenCalledWith('enemy', tagLandsMs(2, 1));
    expect(tag).not.toHaveBeenCalled();
    expect(r.shake).toBe(false); // the shake is the landing's, from the accent, not the beat's start
  });

  it('the three hand-off kinds carry the accent cue, and only they do', () => {
    const score = getScore();
    for (const kind of ['boardFallen', 'tagIn', 'flyIn'] as const) {
      expect(score[kind].some((c) => c.ch === 'duosHandoffFx'), kind).toBe(true);
      expect(score[kind].some((c) => c.ch === 'sfx'), kind).toBe(true);
    }
    expect(score.summon.some((c) => c.ch === 'duosHandoffFx')).toBe(false);
  });
});

describe('the accent', () => {
  const rectOf = (uid: string): { cx: number; cy: number; w: number; h: number } => ({ cx: 300 + Number(uid.slice(1)) * 150, cy: 600, w: 130, h: 180 });
  const ctx = (speed: number, shake: () => void) => ({
    speed, slotRectOf: rectOf, shake, later: (fn: () => void, ms: number) => { setTimeout(fn, ms); },
  });

  it('reads the moment\'s own events', () => {
    const ev = [fallen('enemy'), tagIn('enemy', 3)];
    expect(handoffsIn(moment(ev), ev)).toEqual([
      { kind: 'boardFallen', side: 'enemy', uids: [] },
      { kind: 'tagIn', side: 'enemy', uids: ['b0', 'b1', 'b2'] },
    ]);
  });

  it('a tag-in: dust under each body as it lands, then the shake under the last. No ring (owner 2026-11-12)', () => {
    const shake = vi.fn();
    const ev = [tagIn('player', 3)];
    expect(playHandoffFx(handoffsIn(moment(ev), ev), ctx(1, shake))).toBe(1);
    expect(fx.plays).toHaveLength(0); // nothing before the first landing
    vi.advanceTimersByTime(tagLandMs(0, 1) + 1);
    expect(fx.plays.map((p) => p.id)).toEqual(['landing-dust']);
    expect(shake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(tagLastLandMs(3, 1) - tagLandMs(0, 1));
    expect(fx.plays.map((p) => p.id)).toEqual(['landing-dust', 'landing-dust', 'landing-dust']);
    expect(fx.plays.some((p) => p.id === 'ground-slam')).toBe(false);
    expect(shake).toHaveBeenCalledTimes(1);
  });

  it('the other team lands the same way, and at 2x everything lands in half the time', () => {
    const shake = vi.fn();
    const ev = [tagIn('enemy', 7)];
    playHandoffFx(handoffsIn(moment(ev), ev), ctx(2, shake));
    vi.advanceTimersByTime(tagLastLandMs(7, 2) - 2);
    expect(shake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4);
    expect(shake).toHaveBeenCalledTimes(1);
    expect(fx.plays.some((p) => p.id === 'ground-slam')).toBe(false);
    expect(tagLastLandMs(7, 2)).toBeCloseTo(tagLastLandMs(7, 1) / 2);
  });

  it('a fly-in after a won fight lands in dust only: no slam, no shake', () => {
    const shake = vi.fn();
    const ev = [flyIn('player', 2)];
    playHandoffFx(handoffsIn(moment(ev), ev), ctx(1, shake));
    vi.advanceTimersByTime(2000);
    expect(fx.plays.map((p) => p.id)).toEqual(['landing-dust', 'landing-dust']);
    expect(shake).not.toHaveBeenCalled();
  });

  it('a fallen board draws nothing: no dim over its row (owner 2026-11-12: "the shadow looks off")', () => {
    document.body.innerHTML = '<div data-zone="tavern"><div class="row"></div></div>';
    const ev = [fallen('enemy')];
    expect(playHandoffFx(handoffsIn(moment(ev), ev), ctx(2, vi.fn()))).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.duosfell')).toBeNull();
    expect(fx.plays).toHaveLength(0);
  });

  it('reduced motion: no dim, no dust, no slam, no shake (the sound still plays through the sfx row)', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    document.body.innerHTML = '<div data-zone="warband"><div class="row"></div></div>';
    document.querySelector('.row')!.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 200, right: 800, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    const shake = vi.fn();
    const ev = [fallen('player'), tagIn('player', 4)];
    playHandoffFx(handoffsIn(moment(ev), ev), ctx(1, shake));
    vi.advanceTimersByTime(3000);
    expect(fx.plays).toHaveLength(0);
    expect(document.querySelector('.duosfell')).toBeNull();
    expect(shake).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('with the FX layer down the shake still lands (presentation never blocks the beat)', () => {
    fx.can = false;
    const shake = vi.fn();
    const ev = [tagIn('player', 2)];
    playHandoffFx(handoffsIn(moment(ev), ev), ctx(1, shake));
    vi.advanceTimersByTime(2000);
    expect(fx.plays).toHaveLength(0);
    expect(shake).toHaveBeenCalledTimes(1);
  });
});
