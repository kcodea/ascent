// @vitest-environment jsdom
/**
 * The rank timeline's FX wiring, driven by SCRUBBING the paused GSAP timeline (jsdom has no paint or clock;
 * `tl.time(t)` fires the callbacks the playhead crosses): a demotion — the plain division drop AND the lost
 * demotion game's medal drop — fires the owner's `down-rank` def ONCE at the transition beat, anchored on the
 * old crest's centre, holds the old label until the 90 ms hit, then swaps, reserves the def's full length before
 * the landing bar starts, and fires NO promotion cue (the def's own sound layer is the sound); a promotion
 * still fires `rank-up` + the clang at ITS hit; and a skip (`progress(1, true)`) never fires either def.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureById } from './fixtures';
import { planRankSequence } from './rankSequence';
import { rankLabel } from './types';

const playDef = vi.fn((_id: string, _anchors: unknown) => () => {});
vi.mock('../fx/playDef', () => ({ canPlayDefs: () => true, playDef: (id: string, anchors: unknown) => playDef(id, anchors) }));

const { buildRankTimeline, RANK_DOWN_FX_MS, RANK_DOWN_HIT_MS, RANK_UP_HIT_MS } = await import('./rankTimeline');
type Targets = Parameters<typeof buildRankTimeline>[1];
type Cues = Parameters<typeof buildRankTimeline>[2];

function targets(): Targets {
  const mk = (): HTMLElement => document.body.appendChild(document.createElement('div'));
  const t: Targets = {
    placement: mk(), crestOld: mk(), crestNew: mk(), label: mk(), track: mk(), fill: mk(), tip: mk(),
    points: mk(), delta: mk(), detail: mk(), outcome: mk(),
  };
  // jsdom lays nothing out; give the OLD crest a rect so `crestCentre` resolves (200, 200).
  t.crestOld!.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 200, right: 300, bottom: 300, x: 100, y: 100, toJSON: () => ({}) });
  return t;
}
const cues = (): Cues & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    progress: () => calls.push('progress'), gate: () => calls.push('gate'), promote: () => calls.push('promote'),
    medal: () => calls.push('medal'), hit: () => calls.push('hit'),
  };
};

const STEP = 0.01;
/** Scrub the whole timeline in 10 ms steps, reporting the first time each named observation became true. */
function scrub(tl: gsap.core.Timeline, watch: Record<string, () => boolean>): Record<string, number> {
  const seen: Record<string, number> = {};
  const end = tl.duration();
  for (let t = 0; t <= end + STEP; t += STEP) {
    tl.time(Math.min(t, end));
    for (const [k, f] of Object.entries(watch)) if (!(k in seen) && f()) seen[k] = Math.min(t, end);
  }
  return seen;
}

beforeEach(() => { playDef.mockClear(); });
afterEach(() => { document.body.innerHTML = ''; });

describe.each([
  ['demotion', 'a plain division demotion'],
  ['demo-lost', "a lost demotion game's medal drop"],
])('%s (%s)', (id) => {
  it('fires `down-rank` once at the beat on the old crest, holds the label to the hit, reserves the def, and fires no promotion cue', () => {
    const r = fixtureById(id)!.result!;
    const steps = planRankSequence(r);
    const t = targets();
    const c = cues();
    t.label!.textContent = rankLabel(r.before);
    const tl = buildRankTimeline(steps, t, c, () => {});
    const seen = scrub(tl, {
      fire: () => playDef.mock.calls.length > 0,
      swap: () => t.label!.textContent === rankLabel(r.after),
      // The landing bar's start is its `cues.progress` — the SECOND progress call (the drain / hold was the first).
      landing: () => c.calls.filter((x) => x === 'progress').length >= 2,
    });
    expect(playDef).toHaveBeenCalledTimes(1);
    expect(playDef.mock.calls[0]![0]).toBe('down-rank');
    expect(playDef.mock.calls[0]![1]).toEqual({ source: { x: 200, y: 200 }, target: { x: 200, y: 200 }, cursor: { x: 200, y: 200 } });
    expect(seen.swap! - seen.fire!).toBeCloseTo(RANK_DOWN_HIT_MS / 1000, 1);   // the old crest HOLDS until the hit
    expect(seen.landing! - seen.fire!).toBeGreaterThanOrEqual(RANK_DOWN_FX_MS / 1000 - STEP); // the tail is not cut off
    expect(c.calls).not.toContain('hit');
    expect(c.calls).not.toContain('promote');
    expect(c.calls).not.toContain('medal');
    tl.kill();
  });

  it('a skip never fires the def (silent)', () => {
    const c = cues();
    const tl = buildRankTimeline(planRankSequence(fixtureById(id)!.result!), targets(), c, () => {});
    tl.progress(1, true);
    expect(playDef).not.toHaveBeenCalled();
    expect(c.calls).toEqual([]);
    tl.kill();
  });
});

describe('a promotion still fires `rank-up` + the clang at its own hit', () => {
  it('promo-won', () => {
    const r = fixtureById('promo-won')!.result!;
    const t = targets();
    const c = cues();
    t.label!.textContent = rankLabel(r.before);
    const tl = buildRankTimeline(planRankSequence(r), t, c, () => {});
    const seen = scrub(tl, {
      fire: () => playDef.mock.calls.length > 0,
      hit: () => c.calls.includes('hit'),
      swap: () => t.label!.textContent === rankLabel(r.after),
    });
    expect(playDef).toHaveBeenCalledTimes(1);
    expect(playDef.mock.calls[0]![0]).toBe('rank-up');
    expect(seen.hit).toBe(seen.swap);
    expect(seen.hit! - seen.fire!).toBeCloseTo(RANK_UP_HIT_MS / 1000, 1);
    expect(c.calls).toContain('promote');
    tl.kill();
  });
});
