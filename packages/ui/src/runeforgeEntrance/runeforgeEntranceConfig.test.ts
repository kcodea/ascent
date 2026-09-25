import { describe, expect, it } from 'vitest';
import {
  ENTRANCE_CUES, IMPACT_AT, NO_CLIP, RFE_DEFAULTS, RFE_RANGES, SPEC, cueSetting, dropKeyframes, entranceTimeline,
  resolveEntrance,
} from './runeforgeEntranceConfig';

/**
 * THE RUNEFORGE ENTRANCE, its numbers (owner ask 2026-09-24). The timeline is pure, so the promises the entrance
 * makes (snappy, left to right, clickable on landing, Epic grander, reduced motion a plain fade) are pinned here
 * without a DOM.
 */
describe('runeforge entrance: tuner defaults', () => {
  it('ships a 1.2 to 2 s opening for a four-tablet forge (a real Runeforge offers four)', () => {
    const t = entranceTimeline(resolveEntrance(RFE_DEFAULTS, false), 4);
    expect(t.cards).toHaveLength(4);
    expect(t.endAt).toBeGreaterThanOrEqual(1200);
    expect(t.endAt).toBeLessThanOrEqual(2000);
  });

  it('every tablet is clickable (landed) before the flourish ends, and the first within 0.6 s of the wipe ending', () => {
    const t = entranceTimeline(resolveEntrance(RFE_DEFAULTS, false), 4);
    expect(t.cards[0]!.landAt).toBeLessThanOrEqual(600);
    for (const c of t.cards) expect(c.landAt).toBeLessThan(t.endAt);
  });

  it('waits the post-wipe pad (150 ms) before anything starts; a re-roll skips the pad', () => {
    expect(RFE_DEFAULTS.openDelayMs).toBe(150);
    const r = resolveEntrance(RFE_DEFAULTS, false);
    const open = entranceTimeline(r, 4);
    expect(open.openAt).toBe(150);
    for (const c of open.cards) expect(c.startAt).toBeGreaterThanOrEqual(150);
    expect(entranceTimeline(r, 4, { opening: false }).openAt).toBe(0);
  });

  it('handles any tablet count, from the real offer length', () => {
    const r = resolveEntrance(RFE_DEFAULTS, false);
    for (const n of [1, 2, 3, 4, 5]) {
      const t = entranceTimeline(r, n);
      expect(t.cards).toHaveLength(n);
      expect(t.cards[n - 1]!.startAt).toBe(t.openAt + r.startDelayMs + (n - 1) * r.staggerMs);
    }
  });

  it('every default sits inside its tuner range', () => {
    for (const [key, [min, max]] of Object.entries(RFE_RANGES)) {
      const v = RFE_DEFAULTS[key as keyof typeof RFE_RANGES];
      expect(v, key).toBeGreaterThanOrEqual(min);
      expect(v, key).toBeLessThanOrEqual(max);
    }
  });

  it('the tuner exposes every dial the owner asked for, plus a clip, gain and offset row per cue', () => {
    const keys: string[] = SPEC.controls.map((c) => c.key);
    for (const k of ['openDelayMs', 'sfxSweepEach', 'sfxSweepGapMs', 'staggerMs', 'dropDistance', 'dropMs', 'overshootPx', 'squash', 'dustCount', 'dustSize', 'dustLife',
      'dustOpacity', 'backdropDim', 'emberCount', 'glowSweepMs', 'epicDropMul', 'epicDustMul', 'epicEmberMul', 'epicFlare']) {
      expect(keys, k).toContain(k);
    }
    for (const cue of ['Land', 'Dust', 'Sweep', 'EpicFlare']) {
      for (const suffix of ['Clip', 'Gain', 'OffsetMs']) expect(keys).toContain(`sfx${cue}${suffix}`);
    }
    expect(SPEC.actions?.map((a) => a.label)).toEqual(['▶ Play (Basic)', '▶ Play (Epic)']);
  });

  it('names four cue points; land and sweep ship with existing clips, dust and epicFlare are placeholders', () => {
    expect(ENTRANCE_CUES).toEqual(['land', 'dust', 'sweep', 'epicFlare']);
    expect(cueSetting(RFE_DEFAULTS, 'land').clip).toBe('cardlanding');
    expect(cueSetting(RFE_DEFAULTS, 'sweep').clip).toBe('equipmentsheen');
    for (const cue of ['dust', 'epicFlare'] as const) expect(cueSetting(RFE_DEFAULTS, cue).clip).toBe(NO_CLIP);
  });

  it('the glow sweep sound defaults to once per forge, with a gap for the every-tablet mode', () => {
    expect(RFE_DEFAULTS.sfxSweepEach).toBe(0);
    expect(RFE_DEFAULTS.sfxSweepGapMs).toBeGreaterThan(0);
    const each = SPEC.controls.find((c) => c.key === 'sfxSweepEach');
    expect(each?.kind).toBe('toggle');
    expect(SPEC.controls.find((c) => c.key === 'sfxSweepGain')?.group).toBe('Glow sweep sound');
  });
});

describe('runeforge entrance: the timeline', () => {
  it('drops the tablets left to right, one stagger apart', () => {
    const r = resolveEntrance(RFE_DEFAULTS, false);
    const t = entranceTimeline(r, 4);
    expect(t.cards.map((c) => c.startAt)).toEqual([0, 1, 2, 3].map((i) => r.openDelayMs + r.startDelayMs + i * r.staggerMs));
    for (const c of t.cards) {
      expect(c.landAt).toBe(Math.round(c.startAt + r.dropMs * IMPACT_AT));
      expect(c.settledAt).toBe(c.startAt + r.dropMs);
    }
  });

  it('a replay speed compresses every beat', () => {
    const r = resolveEntrance(RFE_DEFAULTS, false);
    const t1 = entranceTimeline(r, 3);
    const t2 = entranceTimeline(r, 3, { speed: 2 });
    expect(t2.endAt).toBeLessThanOrEqual(Math.ceil(t1.endAt / 2) + 1);
    expect(t2.cards[2]!.landAt).toBeLessThan(t1.cards[2]!.landAt);
  });

  it('reduced motion is one plain fade: every tablet clickable at once, no flare', () => {
    const t = entranceTimeline(resolveEntrance(RFE_DEFAULTS, true), 3, { reduced: true });
    expect(t.cards.every((c) => c.landAt === t.openAt)).toBe(true);
    expect(t.flareAt).toBeNull();
    expect(t.endAt).toBe(RFE_DEFAULTS.openDelayMs + RFE_DEFAULTS.backdropFadeMs);
  });

  it('the drop keyframes touch only transform and opacity (compositor-only)', () => {
    for (const f of dropKeyframes(resolveEntrance(RFE_DEFAULTS, true))) {
      for (const k of Object.keys(f)) expect(['offset', 'easing', 'transform', 'opacity']).toContain(k);
    }
  });

  it('rise-from-below flips the drop direction', () => {
    expect(resolveEntrance(RFE_DEFAULTS, false).dropFrom).toBeLessThan(0);
    expect(resolveEntrance({ ...RFE_DEFAULTS, fromBelow: 1 }, false).dropFrom).toBeGreaterThan(0);
  });
});

describe('runeforge entrance: the Epic variant', () => {
  it('the Epic forge is heavier, dustier, has more embers and flares; the basic forge never flares', () => {
    const b = resolveEntrance(RFE_DEFAULTS, false);
    const e = resolveEntrance(RFE_DEFAULTS, true);
    expect(e.epic).toBe(true);
    expect(Math.abs(e.dropFrom)).toBeGreaterThan(Math.abs(b.dropFrom));
    expect(e.squash).toBeGreaterThan(b.squash);
    expect(e.dustIntensity).toBeGreaterThan(b.dustIntensity);
    expect(e.emberCount).toBeGreaterThan(b.emberCount);
    expect(b.flare).toBe(0);
    expect(e.flare).toBeGreaterThan(0);
    expect(entranceTimeline(b, 3).flareAt).toBeNull();
    // The flare lands with the LAST tablet.
    const te = entranceTimeline(e, 3);
    expect(te.flareAt).toBe(te.cards[2]!.landAt);
  });

  it('an Epic flare of 0 turns it off', () => {
    expect(entranceTimeline(resolveEntrance({ ...RFE_DEFAULTS, epicFlare: 0 }, true), 3).flareAt).toBeNull();
  });
});
