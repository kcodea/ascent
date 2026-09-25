import { beforeEach, describe, expect, it } from 'vitest';
import { goodLuckIntro, resetGoodLuckIntroForTests, shouldPlayGoodLuckIntro } from './goodLuckIntroStore';
import { GLI_DEFAULTS, goodLuckTimeline } from './goodLuckIntroConfig';
import { turnClockMayTick } from '../turnClock';

/**
 * THE "GOOD LUCK" INTRO (owner ask 2026-09-24): "after the player hits start game in the hero ceremony ...
 * fade to the game screen and the clock begins." Pins the three promises that need no DOM: which starts get
 * the intro, that the shop clock is held while it plays, and that its beats run in order.
 */
beforeEach(() => resetGoodLuckIntroForTests());

describe('which game starts get the intro', () => {
  const run = (mode: string, extra: { sandbox?: boolean; wave?: number } = {}) => ({ mode, wave: 1, ...extra });

  it('plays on a real lobby start and a Practice start', () => {
    expect(shouldPlayGoodLuckIntro(run('lobby'))).toBe(true);
    expect(shouldPlayGoodLuckIntro(run('practice'))).toBe(true);
  });

  it('never plays in the tutorial, the Scene Builder sandbox or a replay', () => {
    expect(shouldPlayGoodLuckIntro(run('tutorial'))).toBe(false);
    expect(shouldPlayGoodLuckIntro(run('practice', { sandbox: true }))).toBe(false);
    expect(shouldPlayGoodLuckIntro(run('lobby', { sandbox: true }))).toBe(false);
    expect(shouldPlayGoodLuckIntro(run('lobby'), { replaying: true })).toBe(false);
  });

  it('never plays past the opening turn, for legacy modes, or with no run', () => {
    expect(shouldPlayGoodLuckIntro(run('lobby', { wave: 4 }))).toBe(false);
    expect(shouldPlayGoodLuckIntro(run('ascent'))).toBe(false);
    expect(shouldPlayGoodLuckIntro(run('rift'))).toBe(false);
    expect(shouldPlayGoodLuckIntro(null)).toBe(false);
  });
});

describe('the shop clock and the intro', () => {
  const gate = (introPlaying: boolean): boolean =>
    turnClockMayTick({ recruitPhase: true, decisionOpen: false, heroSelecting: false, overlayOpen: false, introPlaying });

  it('holds while the intro plays and runs the moment it ends', () => {
    expect(gate(goodLuckIntro.isActive())).toBe(true);
    goodLuckIntro.begin();
    expect(gate(goodLuckIntro.isActive())).toBe(false);
    goodLuckIntro.end();
    expect(gate(goodLuckIntro.isActive())).toBe(true);
  });

  it('keeps every existing pause', () => {
    const base = { recruitPhase: true, decisionOpen: false, heroSelecting: false, overlayOpen: false, introPlaying: false };
    expect(turnClockMayTick(base)).toBe(true);
    expect(turnClockMayTick({ ...base, recruitPhase: false })).toBe(false);
    expect(turnClockMayTick({ ...base, decisionOpen: true })).toBe(false);
    expect(turnClockMayTick({ ...base, heroSelecting: true })).toBe(false);
    expect(turnClockMayTick({ ...base, overlayOpen: true })).toBe(false);
  });

  it('notifies subscribers once per flip, and a second end is a no-op', () => {
    let n = 0;
    goodLuckIntro.subscribe(() => { n += 1; });
    goodLuckIntro.begin();
    goodLuckIntro.end();
    goodLuckIntro.end();
    expect(n).toBe(2);
  });
});

describe('the timeline', () => {
  it('runs in order and lands in the asked-for 2.2 to 3 s window (with the curtain cover)', () => {
    const t = goodLuckTimeline(GLI_DEFAULTS, false);
    expect(t.inAt).toBeLessThan(t.shineAt);
    expect(t.shineAt).toBeLessThan(t.outAt);
    expect(t.outAt).toBeLessThan(t.endAt);
    const withCover = t.endAt + 280;
    expect(withCover).toBeGreaterThanOrEqual(2200);
    expect(withCover).toBeLessThanOrEqual(3000);
  });

  it('starts the shine sound with the sweep, nudged by the offset but never before the intro', () => {
    const t = goodLuckTimeline(GLI_DEFAULTS, false);
    expect(t.shineSoundAt).toBe(t.shineAt);
    expect(goodLuckTimeline({ ...GLI_DEFAULTS, shineSoundOffsetMs: 80 }, false).shineSoundAt).toBe(t.shineAt + 80);
    expect(goodLuckTimeline({ ...GLI_DEFAULTS, startDelayMs: 0, fadeInMs: 100, shineSoundOffsetMs: -400 }, false).shineSoundAt).toBe(0);
    expect(t.sparkAt).toBeGreaterThanOrEqual(t.inAt);
    expect(t.sparkAt).toBeLessThan(t.shineAt);
  });

  it('is shorter, never longer, under reduced motion', () => {
    expect(goodLuckTimeline(GLI_DEFAULTS, true).endAt).toBeLessThanOrEqual(goodLuckTimeline(GLI_DEFAULTS, false).endAt);
  });
});
