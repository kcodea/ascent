// @vitest-environment jsdom
/**
 * THE REAPING (the Ancient of Death's hero attack, an ANCIENT): what the scythe cuts is colour. The shared four tiers
 * (I cut, II cross, III shadow, IV the reaping; a knockout plays IV); the tuner values; the pure plan (II's first cut
 * is a tick, the blow lands as the last blade crosses the portrait's middle); the pure geometry (every blade passes
 * through the struck portrait and the shadow, candle and line stay on screen, both directions); the pure drain (what is
 * grey when, and exactly nothing after the end); the runner on the shared clock (the blow lands exactly ONCE; every
 * exit removes every pane and puts both portraits back; replay; reduced motion); the headless scene (pooled, bounded,
 * drains, destroy leaves nothing); the dev-only registration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';
import {
  CROSS_AT, HERO_REAPING_DEFAULTS, HERO_REAPING_RANGES, SNUFF_MS, bladeAt, clampHeroReapingValue, drainAt, flameAt, foeMoveAt, heroReapingConfigJson, lineAt,
  passAt, reapingCameraAt, reapingCameraFocus, reapingCues, reapingGeo, reapingKind, reapingPlan, sanitizeHeroReapingConfig, scytheAt, shadowAt, swingAt,
  type HeroReapingNumKey,
} from './heroReapingConfig';
import { DRAIN_Z, ReapingDrain } from './heroReapingDrain';
import { HeroReapingScene, MAX_MOTES, MAX_REAPING_SPRITES, type HeroReapingTextures } from './heroReapingScene';
import { playHeroReaping, reapingSeed, type HeroReapingOptions } from './heroReaping';
import { SPEC } from '../HeroReapingTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroReapingTextures = { glow: W, spark: W, streak: W, ring: W, beam: W, blade: W, line: W, snath: W, shadow: W, candle: W, flame: W, mote: W };
const C = HERO_REAPING_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => reapingPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const R = 130;
const BOUNDS = { w: 1920, h: 1080 };
/** The two real seats at 1080p: yours bottom left, the foe's top right. */
const YOU = { x: 171, y: 844 }, FOE = { x: 1773, y: 161 };
const TOTALS = [3, 8, 14, 40] as const;
const COLORS = { teal: 0x2fe0bc, bone: 0xefe9dc, shade: 0x05070a, motes: [0xffb24a, 0xff7a5c, 0xffe08a], side: 0xf0c75e };
const LOOK = { bladeSize: C.bladeSize, moteMs: C.moteMs, moteSize: C.moteSize, stripWidth: C.stripWidth };

describe('the tiers', () => {
  it('uses the shared thresholds: I cut, II cross, III shadow, IV the reaping', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const p = plan(d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.kind, `dmg ${d}`).toBe(reapingKind(tierOf(d)));
    }
    expect([1, 2, 3, 4].map((t) => reapingKind(t as 1 | 2 | 3 | 4))).toEqual(['cut', 'cross', 'shadow', 'reaping']);
  });

  it('a knockout always plays IV, whatever the number, and there is no separate knockout variant', () => {
    const p = plan(3, { knockout: true });
    expect(p.tier).toBe(4);
    expect(p.kind).toBe('reaping');
    expect(reapingPlan({ total: 3, distance: 1600, knockout: true, knockoutVariant: true }, C)).toEqual(reapingPlan({ total: 3, distance: 1600, knockout: true }, C));
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_REAPING_RANGES)) {
      const v = C[k as HeroReapingNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorTeal', 'colorBone', 'colorShade', 'colorMoteA', 'colorMoteB', 'colorMoteC', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('ships the Ancient of Death teal, and its own three clips', () => {
    expect(C.colorTeal).toBe('#2fe0bc');
    expect([C.sfxBellClip, C.sfxSweepClip, C.sfxBreathClip]).toEqual(['fx/reaping-bell', 'fx/reaping-sweep', 'fx/reaping-breath']);
    expect(ATTACK_FX_CLIPS.reaping).toEqual(['fx/reaping-bell', 'fx/reaping-breath', 'fx/reaping-sweep']);
  });

  it('clamps numbers into range; junk falls back; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroReapingValue('t4Motes', 999)).toBe(40);
    expect(clampHeroReapingValue('grey', -3)).toBe(0);
    expect(clampHeroReapingValue('drainMs', 'x')).toBe(C.drainMs);
    expect(clampHeroReapingValue('colorTeal', 'teal')).toBe(C.colorTeal);
    expect(clampHeroReapingValue('colorTeal', '#ABCDEF')).toBe('#abcdef');
    const s = sanitizeHeroReapingConfig({ t1SweepMs: 99999, nope: 1, colorBone: 7 });
    expect(s.t1SweepMs).toBe(1500);
    expect(s.colorBone).toBe(C.colorBone);
    expect('nope' in s).toBe(false);
  });

  it('Copy JSON leaves the preview-only keys out', () => {
    const j = JSON.parse(heroReapingConfigJson(C)) as Record<string, unknown>;
    expect('previewDamage' in j).toBe(false);
    expect(j.colorTeal).toBe('#2fe0bc');
  });

  it('the tuner offers every dial, the Play buttons on top, and the style in the dev list only', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(HERO_REAPING_RANGES)) expect(keys.has(k as never), k).toBe(true);
    expect(SPEC.buttonsOnTop).toBe(true);
    expect((SPEC.actions ?? []).filter((a) => a.label.startsWith('▶')).length).toBe(10);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('reaping');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('reaping');
    expect(HERO_ATTACK_STYLES).toContain('reaping');
  });

  it('no words drawn or spoken to the player use a dash pair, an em dash, "Oath" or "climb"', () => {
    const text = [SPEC.title, ...SPEC.controls.map((c) => `${c.label} ${c.hint ?? ''}`), ...(SPEC.actions ?? []).map((a) => `${a.label} ${a.hint ?? ''}`)].join(' ');
    expect(text).not.toMatch(/—|--|\bOath\b|\bclimb\b/i);
  });
});

describe('the plan (pure)', () => {
  it('starts where the shared formation ends, and every beat is in order', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      expect(p.chargeAt).toBe(leadInOf([total]));
      expect(p.launchAt).toBeGreaterThanOrEqual(p.chargeAt);
      for (const q of p.cuts) { expect(q.startAt).toBeLessThan(q.crossAt); expect(q.crossAt).toBeLessThanOrEqual(q.endAt); }
      expect(p.impactAt).toBe(p.cuts[p.cuts.length - 1]!.crossAt);
      expect(p.returnAt).toBeGreaterThan(p.impactAt);
      expect(p.returnEnd).toBeGreaterThan(p.returnAt);
      expect(p.endAt).toBeGreaterThanOrEqual(p.returnEnd); // the portrait has ALL its colour back before the attack ends
    }
  });

  it('I one cut, II two (the first a tick), III the downswing after the rise, IV the line after the drain, the silence and the toll', () => {
    expect(plan(3).cuts.length).toBe(1);
    const two = plan(8);
    expect(two.cuts.length).toBe(2);
    expect(two.cuts[1]!.startAt - two.cuts[0]!.startAt).toBe(C.crossGapMs);
    expect(two.cuts[0]!.crossAt).toBeLessThan(two.impactAt);
    const three = plan(14);
    expect(three.riseAt).toBe(three.chargeAt);
    expect(three.raisedAt! - three.riseAt!).toBe(C.riseMs);
    expect(three.cuts[0]!.startAt).toBe(three.raisedAt! + C.raiseMs);
    expect([three.drainAt, three.tollAt, three.floodAt]).toEqual([null, null, null]);
    const four = plan(40);
    expect(four.drainAt).toBe(four.chargeAt);
    expect(four.drainedAt! - four.drainAt!).toBe(C.drainMs);
    expect(four.tollAt! - four.drainedAt!).toBe(C.silenceMs); // the silent gap
    expect(four.cuts[0]!.startAt - four.tollAt!).toBe(C.tollMs);
    expect(four.floodAt! - four.impactAt).toBe(C.streamMs);
    expect(four.floodEnd! - four.floodAt!).toBe(C.floodMs);
    expect(four.returnAt).toBeGreaterThan(four.floodEnd!); // the loser stays grey after the flood has passed
  });

  it('escalates: each tier runs longer, throws more motes and shakes harder; IV sits near its source attack', () => {
    const ps = TOTALS.map((t) => plan(t));
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]!.endAt - ps[i]!.chargeAt).toBeGreaterThan(ps[i - 1]!.endAt - ps[i - 1]!.chargeAt);
      expect(ps[i]!.motes).toBeGreaterThan(ps[i - 1]!.motes);
      expect(ps[i]!.shakePx).toBeGreaterThan(ps[i - 1]!.shakePx);
    }
    expect(ps[0]!.endAt - ps[0]!.chargeAt).toBeLessThan(1800);
    expect(ps[3]!.endAt - ps[3]!.chargeAt).toBeLessThan(4200);
    expect(ps[3]!.motes).toBeLessThanOrEqual(MAX_MOTES);
  });

  it('the cues: one impact, one end, in time order; ticks before the impact; no plan carries a hit-stop', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      const q = reapingCues(p);
      expect(q.filter((c) => c.kind === 'impact')).toEqual([{ at: p.impactAt, kind: 'impact', i: 0 }]);
      expect(q.filter((c) => c.kind === 'end').length).toBe(1);
      for (let i = 1; i < q.length; i++) expect(q[i]!.at).toBeGreaterThanOrEqual(q[i - 1]!.at);
      expect(q.filter((c) => c.kind === 'sweep').length).toBe(p.cuts.length);
      expect(q.filter((c) => c.kind === 'cross').length).toBe(p.cuts.length - 1);
      expect(q[q.length - 1]!.kind).toBe('end');
      expect(Object.keys(p).join(' ')).not.toMatch(/hitStop|slamStop/i);
    }
    const four = reapingCues(plan(40)).map((c) => c.kind);
    expect(four).toEqual(['charge', 'drain', 'hush', 'toll', 'sweep', 'impact', 'flood', 'return', 'end']);
    expect(reapingCues(plan(14)).map((c) => c.kind)).toEqual(['charge', 'rise', 'sweep', 'impact', 'snuff', 'return', 'end']);
    expect(reapingCues(plan(14)).find((c) => c.kind === 'snuff')!.at).toBe(plan(14).impactAt + SNUFF_MS);
  });

  it('reduced motion: no cuts, no drain; the blow lands where the formation ends', () => {
    const p = plan(40, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(p.cuts).toEqual([]);
    expect(reapingCues(p).map((c) => c.kind)).toEqual(['impact', 'end']);
    expect(drainAt(p, p.impactAt + 10)).toEqual({ strip: [0, 0], stripA: 0, full: 0, veil: 0, flood: 0 });
    expect(reapingCameraAt(p, C, p.impactAt)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('is deterministic', () => {
    for (const total of TOTALS) expect(plan(total)).toEqual(plan(total));
  });
});

describe('the geometry (pure), both directions', () => {
  const DIRS: [string, typeof YOU, typeof FOE][] = [['you strike', YOU, FOE], ['the foe strikes', FOE, YOU]];

  it('I-II: every blade passes through the middle of the struck portrait exactly at its crossing, point first', () => {
    for (const [name, a, d] of DIRS) {
      for (const total of [3, 8]) {
        for (const flip of [false, true]) {
          const p = plan(total);
          const g = reapingGeo(p, a, d, R, R, C, BOUNDS, flip);
          p.cuts.forEach((q, i) => {
            expect(passAt(q, q.crossAt)).toBeCloseTo(CROSS_AT, 6);
            const at = bladeAt(p, g, i, q.crossAt);
            expect(at.visible, name).toBe(true);
            expect(Math.hypot(at.x - d.x, at.y - d.y), `${name} ${total}`).toBeLessThan(0.5);
            // it points the way it travels: along the cut
            expect(Math.cos(at.rot - g.cuts[i]!.angle)).toBeGreaterThan(0.99);
            expect(bladeAt(p, g, i, q.startAt - 1).visible).toBe(false);
            expect(bladeAt(p, g, i, q.endAt).visible).toBe(false);
          });
        }
      }
    }
  });

  it('II: the two cuts cross at right angles, 45 degrees either side of the strike line (the wedges between are half)', () => {
    const p = plan(8);
    const g = reapingGeo(p, YOU, FOE, R, R, C, BOUNDS);
    const [c0, c1] = g.cuts;
    expect(c0!.dir.x * c1!.dir.x + c0!.dir.y * c1!.dir.y).toBeCloseTo(0, 6);
    expect(c0!.dir.x * g.u.x + c0!.dir.y * g.u.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(c1!.dir.x * g.u.x + c1!.dir.y * g.u.y).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('the seed mirrors the cut, and the same seed cuts the same way', () => {
    const p = plan(3);
    const g0 = reapingGeo(p, YOU, FOE, R, R, C, BOUNDS, false), g1 = reapingGeo(p, YOU, FOE, R, R, C, BOUNDS, true);
    expect(g0.cuts[0]!.angle).not.toBeCloseTo(g1.cuts[0]!.angle, 3);
    expect(reapingGeo(p, YOU, FOE, R, R, C, BOUNDS, true)).toEqual(g1);
    expect(reapingSeed(9, 1600, 'player', 5)).toBe(reapingSeed(9, 1600, 'player', 5));
    expect(reapingSeed(9, 1600, 'player', 5)).not.toBe(reapingSeed(9, 1600, 'player', 6));
  });

  it('III: the shadow, its raised scythe and the candle stay on screen; the MIDDLE of the blade crosses the portrait middle at the impact', () => {
    for (const [name, a, d] of DIRS) {
      const p = plan(14);
      const g = reapingGeo(p, a, d, R, R, C, BOUNDS);
      const s = g.shadow!;
      expect(s, name).not.toBeNull();
      // the figure: its head inside the top edge, its sides inside the screen, on the striker's side of the portrait
      expect(s.baseY - s.h, name).toBeGreaterThanOrEqual(0);
      expect(s.x - s.h * 0.31, name).toBeGreaterThanOrEqual(0);
      expect(s.x + s.h * 0.31, name).toBeLessThanOrEqual(BOUNDS.w);
      expect(Math.sign(s.x - d.x), name).toBe(Math.sign(a.x - d.x));
      // the candle on the other side, on screen
      expect(Math.sign(s.candle.x - d.x), name).toBe(-Math.sign(a.x - d.x));
      expect(s.candle.x).toBeGreaterThan(0); expect(s.candle.x).toBeLessThan(BOUNDS.w);
      expect(s.candle.y).toBeGreaterThan(0); expect(s.candle.y).toBeLessThanOrEqual(BOUNDS.h);
      // the swing: raised before, exactly through the portrait at the crossing, then on
      const q = p.cuts[0]!;
      expect(swingAt(p, s, q.startAt - 50)).toBe(s.a0);
      const hit = scytheAt(s, swingAt(p, s, q.crossAt));
      expect(Math.hypot(hit.mid.x - d.x, hit.mid.y - d.y), name).toBeLessThan(0.5);
      expect(swingAt(p, s, q.endAt + 10)).toBeCloseTo(s.a1, 6);
      // raised, the blade is above the hands (it comes down from above)
      expect(scytheAt(s, s.a0).tip.y, name).toBeLessThan(s.pivot.y);
      // the shadow is standing for the swing and gone before the colour returns; the flame is out SNUFF_MS after the cut
      expect(shadowAt(p, p.chargeAt - 1)).toBe(0);
      expect(shadowAt(p, q.startAt)).toBe(1);
      expect(shadowAt(p, p.returnEnd)).toBe(0);
      expect(flameAt(p, p.impactAt - 1)).toBe(1);
      expect(flameAt(p, p.impactAt + SNUFF_MS)).toBe(0);
    }
  });

  it('IV: the line crosses the WHOLE screen through the struck portrait, from the striker side, and is on it at the impact', () => {
    for (const [name, a, d] of DIRS) {
      const p = plan(40);
      const g = reapingGeo(p, a, d, R, R, C, BOUNDS);
      const l = g.line!;
      // both ends are off the screen, on opposite sides, and it starts on the striker's side
      expect(Math.min(l.from.x, l.to.x), name).toBeLessThan(0);
      expect(Math.max(l.from.x, l.to.x), name).toBeGreaterThan(BOUNDS.w);
      expect(Math.sign(l.from.x - d.x), name).toBe(Math.sign(a.x - d.x));
      const q = p.cuts[0]!;
      expect(lineAt(p, g, q.startAt)).toBe(0);
      const k = lineAt(p, g, q.crossAt);
      expect(Math.hypot(l.from.x + (l.to.x - l.from.x) * k - d.x, l.from.y + (l.to.y - l.from.y) * k - d.y), name).toBeLessThan(0.5);
      expect(lineAt(p, g, q.endAt)).toBe(1);
      // nearly level: it stays inside the screen's height all the way across
      for (const x of [0, BOUNDS.w]) {
        const f = (x - l.from.x) / (l.to.x - l.from.x);
        const y = l.from.y + (l.to.y - l.from.y) * f;
        expect(y, name).toBeGreaterThan(0); expect(y, name).toBeLessThan(BOUNDS.h);
      }
    }
  });
});

describe('the drain (pure): what is grey when', () => {
  it('nothing is grey before the charge or from the end of the return, on any tier', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      const zero = { strip: [0, 0], stripA: 0, full: 0, veil: 0, flood: 0 };
      expect(drainAt(p, p.chargeAt - 1)).toEqual(zero);
      expect(drainAt(p, p.returnEnd)).toEqual(zero);
      expect(drainAt(p, p.endAt + 500)).toEqual(zero);
      expect(foeMoveAt(p, p.returnEnd)).toEqual({ knock: 0, sag: 0 });
    }
  });

  it('I: the strip is drained BEHIND the blade (nothing before it reaches the portrait, all of it once it has left), then seeps back', () => {
    const p = plan(3);
    const q = p.cuts[0]!;
    expect(drainAt(p, q.startAt + 20).strip[0]).toBe(0);
    const mid = drainAt(p, q.crossAt).strip[0]!;
    expect(mid).toBeGreaterThan(0.3); expect(mid).toBeLessThan(0.7);
    expect(drainAt(p, q.endAt).strip[0]).toBe(1);
    expect(drainAt(p, q.endAt).stripA).toBe(1);
    expect(drainAt(p, q.endAt).full).toBe(0); // only the strip: the rest of the portrait keeps its colour
    const half = drainAt(p, (p.returnAt + p.returnEnd) / 2).stripA;
    expect(half).toBeGreaterThan(0.3); expect(half).toBeLessThan(0.7);
  });

  it('II: the first cut drains only its strip; the wedges go on the second', () => {
    const p = plan(8);
    const between = drainAt(p, p.cuts[0]!.endAt - 1);
    expect(between.strip[0]).toBeGreaterThan(0.95);
    expect(between.full).toBe(0);
    const after = drainAt(p, p.impactAt + 200);
    expect(after.full).toBe(1);
    expect(after.strip).toEqual([1, 1]);
  });

  it('III: the whole portrait goes grey on the cut', () => {
    const p = plan(14);
    expect(drainAt(p, p.impactAt - 100).full).toBe(0);
    expect(drainAt(p, p.impactAt + 120).full).toBe(1);
    expect(drainAt(p, p.impactAt + 120).veil).toBe(0);
  });

  it('IV: the screen drains before the toll, stays monochrome through the sweep, floods back, and the LOSER stays grey after it', () => {
    const p = plan(40);
    expect(drainAt(p, p.drainAt! + 1).veil).toBeLessThan(0.05);
    expect(drainAt(p, p.drainedAt!).veil).toBe(1);
    expect(drainAt(p, p.tollAt!).veil).toBe(1);
    expect(drainAt(p, p.impactAt).veil).toBe(1);
    expect(drainAt(p, p.impactAt).flood).toBe(0);
    const mid = drainAt(p, (p.floodAt! + p.floodEnd!) / 2);
    expect(mid.flood).toBeCloseTo(0.5, 2);
    const passed = drainAt(p, p.floodEnd! + 1);
    expect(passed.veil).toBe(0); // the screen has its colour
    expect(passed.full).toBe(1); // the struck portrait does not
    expect(drainAt(p, p.returnAt).full).toBe(1);
    expect(drainAt(p, p.returnEnd - 1).full).toBeLessThan(0.01);
  });

  it('the struck portrait is knocked on each crossing and sags only while it is grey', () => {
    const p = plan(8);
    expect(foeMoveAt(p, p.cuts[0]!.crossAt - 1)).toEqual({ knock: 0, sag: 0 });
    expect(foeMoveAt(p, p.cuts[0]!.crossAt + 1).knock).toBeGreaterThan(0.3);
    expect(foeMoveAt(p, p.impactAt + 1).knock).toBeGreaterThan(0.8);
    expect(foeMoveAt(p, p.impactAt + 300).sag).toBe(1);
    expect(foeMoveAt(p, p.returnEnd - 1).sag).toBeLessThan(0.01);
  });

  it('the camera pushes in to the blow and is at rest again by the end; IV holds its push until the flood', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      expect(reapingCameraAt(p, C, p.chargeAt - 1).zoom).toBe(1);
      expect(reapingCameraAt(p, C, p.impactAt - 1).zoom).toBeGreaterThan(1 + p.zoom * 0.9);
      const end = reapingCameraAt(p, C, p.endAt);
      expect(end.zoom).toBeLessThan(1.004);
      expect(Math.abs(end.x) + Math.abs(end.y)).toBeLessThan(0.2);
      expect(reapingCameraFocus(p, p.impactAt, YOU, FOE)).toEqual(FOE);
    }
    const four = plan(40);
    expect(reapingCameraAt(four, C, four.floodAt! - 1).zoom).toBeGreaterThan(1 + four.zoom * 0.95);
    expect(reapingCameraAt(four, C, four.floodEnd!).zoom).toBeLessThan(1.002);
  });
});

function manualFrames(): { frames: HeroReapingOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroReapingOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroReaping({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: YOU, defender: FOE, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

const panes = (): number => document.querySelectorAll('.hreaping-veil, .hreaping-patch, .hreaping-strip, .hreaping-full').length;
const of = (total: number): Partial<HeroReapingOptions> => ({ total, formation: formationOf([total], total) });

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  for (const total of TOTALS) {
    it(`tier ${tierOf(total)}: the blow lands EXACTLY ONCE, on the impact; at the end everything is put back and nothing is left`, () => {
      const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run(of(total));
      attackerEl.style.transform = 'translate(1px, 2px)';
      expect(host.querySelector('.hblast.hreaping')).not.toBeNull();
      expect(panes()).toBeGreaterThan(0);
      f.tick(h.plan.impactAt - 12, 4);
      expect(onImpact).not.toHaveBeenCalled();
      f.tick(24, 4);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(camera.style.transform).toContain('scale(');
      expect(host.querySelector('.hblast-hit')!.textContent).toBe(`-${total}`);
      f.tick(200, 4);
      expect(defenderEl.style.transform).toContain('scale('); // it sags while it is grey
      f.tick(h.plan.endAt - h.elapsed() + 32, 8);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(panes()).toBe(0);
      expect(h.drain.panes).toBe(0);
      expect(host.querySelector('.hblast')).toBeNull();
      expect(camera.style.transform).toBe('');
      expect(defenderEl.style.transform).toBe('');
      expect(defenderEl.style.filter).toBe('');
      expect(defenderEl.style.opacity).toBe('');
      expect(document.body.className).toBe('');
      f.tick(6000, 16);
      expect(f.hooked()).toBe(0);
      expect(root.children.length).toBe(0);
    });
  }

  it('II: the first cut is a tick (FX only); the consequence waits for the second', () => {
    const { h, f, onImpact } = run(of(8));
    f.tick(h.plan.cuts[0]!.crossAt + 20, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveMotes).toBeGreaterThan(0); // a few motes already left with the first strip
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('the panes: a strip per cut on I-II, the wedge pane on II, the whole portrait on III-IV, the veil on IV only; all under the FX canvas', () => {
    const count = (total: number) => {
      const { h } = run(of(total));
      const r = { veil: h.drain.veil ? 1 : 0, strips: h.drain.strips.length, full: h.drain.full ? 1 : 0 };
      for (const el of [h.drain.veil, h.drain.patch]) if (el) expect(Number(el.style.zIndex)).toBeGreaterThanOrEqual(DRAIN_Z);
      for (const el of [h.drain.veil, h.drain.patch]) if (el) expect(Number(el.style.zIndex)).toBeLessThan(200);
      h.cancel();
      return r;
    };
    expect(count(3)).toEqual({ veil: 0, strips: 1, full: 0 });
    expect(count(8)).toEqual({ veil: 0, strips: 2, full: 1 });
    expect(count(14)).toEqual({ veil: 0, strips: 0, full: 1 });
    expect(count(40)).toEqual({ veil: 1, strips: 0, full: 1 });
    expect(panes()).toBe(0);
  });

  it('the grey rides the struck portrait: the patch is written the portrait transform, and only opacity and transform change after the build', () => {
    const { h, f, defenderEl } = run(of(8));
    const patch = h.drain.patch!;
    const rest = (): string => { const c = patch.cloneNode(false) as HTMLElement; c.style.transform = ''; return (c.getAttribute('style') ?? '').trim(); };
    const before = rest();
    f.tick(h.plan.impactAt + 40, 4);
    expect(defenderEl.style.transform).not.toBe('');
    expect(patch.style.transform).toBe(defenderEl.style.transform);
    expect(rest()).toBe(before);
    expect(Number(h.drain.full!.style.opacity)).toBeGreaterThan(0);
    expect(h.drain.strips[0]!.style.transform).toContain('scaleX(1.0000)');
    h.cancel();
  });

  it('IV: monochrome before the toll, the line reaches the portrait on the impact, colour floods back, the loser stays grey, then nothing is left', () => {
    const { h, f, onImpact } = run(of(40));
    const p = h.plan;
    f.tick(p.tollAt! + 4, 4);
    expect(Number(h.drain.veil!.style.opacity)).toBe(1);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(p.impactAt - h.elapsed() + 4, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    const head = h.scene!.lineHeadPos!;
    expect(Math.hypot(head.x - FOE.x, head.y - FOE.y)).toBeLessThan(60);
    expect(h.scene!.liveMotes).toBe(p.motes);
    f.tick(p.floodEnd! - h.elapsed() + 8, 4);
    expect(Number(h.drain.veil!.style.opacity)).toBe(0);
    expect(Number(h.drain.full!.style.opacity)).toBe(1);
    f.tick(p.endAt - h.elapsed() + 16, 4);
    expect(h.done).toBe(true);
    expect(panes()).toBe(0);
  });

  it('every exit (cancel, finish, the end) at every tier, mid-drain: panes gone, both portraits exactly as they were, the camera reset', () => {
    for (const total of TOTALS) {
      for (const exit of ['cancel', 'finish', 'end'] as const) {
        const { h, f, onImpact, attackerEl, defenderEl, camera } = run(of(total));
        attackerEl.style.transform = 'translate(3px, 4px)';
        defenderEl.className = 'combatopp-body keep';
        f.tick(h.plan.impactAt + 150, 4);
        expect(panes(), `${total} ${exit}`).toBeGreaterThan(0);
        expect(defenderEl.style.transform).not.toBe('');
        if (exit === 'cancel') h.cancel();
        else if (exit === 'finish') h.finish();
        else f.tick(h.plan.endAt, 8);
        expect(panes(), `${total} ${exit}`).toBe(0);
        expect(defenderEl.style.transform, `${total} ${exit}`).toBe('');
        expect(defenderEl.getAttribute('style') ?? '', `${total} ${exit}`).toBe('');
        expect(defenderEl.className).toBe('combatopp-body keep');
        expect(camera.style.transform).toBe('');
        expect(document.body.className).toBe('');
        expect(onImpact).toHaveBeenCalledTimes(1);
        f.tick(6000, 16);
        expect(f.hooked(), `${total} ${exit}`).toBe(0);
      }
    }
  });

  it('cancel before the blow never lands it; finish lands it once', () => {
    const a = run(of(40));
    a.f.tick(a.h.plan.tollAt!, 16);
    a.h.cancel();
    expect(a.onImpact).not.toHaveBeenCalled();
    expect(a.onDone).not.toHaveBeenCalled();
    expect(panes()).toBe(0);
    expect(a.f.hooked()).toBe(0);
    const b = run(of(40));
    b.f.tick(b.h.plan.tollAt!, 16);
    b.h.finish(); b.h.finish();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expect(b.onDone).toHaveBeenCalledTimes(1);
    expect(panes()).toBe(0);
  });

  it('works in both directions at every tier, within the sprite cap, with everything it draws on the screen', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of TOTALS) {
        const a = side === 'player' ? YOU : FOE, d = side === 'player' ? FOE : YOU;
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, ...of(total) });
        let peak = 0;
        for (let t = 0; t < h.plan.endAt; t += 16) {
          f.tick(16, 16);
          peak = Math.max(peak, h.scene!.liveSprites);
          const b = h.scene!.bladePos(0);
          if (b && (h.plan.kind === 'cut' || h.plan.kind === 'cross')) {
            // a blade passes THROUGH the portrait: it is never further from it than its reach
            expect(Math.hypot(b.x - d.x, b.y - d.y)).toBeLessThanOrEqual(R * Math.hypot(C.bladeReach, C.bladeBow) + 1);
          }
        }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_REAPING_SPRITES);
        h.cancel();
      }
    }
  });

  it('the camera is applied ONCE: the Pixi root stays at rest when the canvas already rides the camera element', () => {
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const { h, f, root } = run({ camera, ...of(40) });
    f.tick(h.plan.impactAt + 20, 4);
    expect(h.mirrorsCamera).toBe(false);
    expect(camera.style.transform).toContain('scale(');
    const layer = root.children[0] as Container;
    expect(layer.scale.x).toBe(1);
    expect(layer.position.x).toBe(0);
    h.cancel();
  });

  it('a replay plays the same: the same seed gives the same plan, cut, panes and motes; another roll may mirror the cut', () => {
    const x = run({ ...of(3), rollSeed: 7 }), y = run({ ...of(3), rollSeed: 7 });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.geo).toEqual(y.h.geo);
    x.f.tick(x.h.plan.impactAt + 300, 8); y.f.tick(y.h.plan.impactAt + 300, 8);
    expect(x.h.scene!.liveSprites).toBe(y.h.scene!.liveSprites);
    expect(x.h.drain.strips[0]!.style.transform).toBe(y.h.drain.strips[0]!.style.transform);
    const angles = new Set([1, 2, 3, 4].map((roll) => { const r = run({ ...of(3), rollSeed: roll }); const a = r.h.geo.cuts[0]!.angle; r.h.cancel(); return a.toFixed(3); }));
    expect(angles.size).toBe(2);
    x.h.cancel(); y.h.cancel();
  });

  it('reduced motion: no scene, no panes, no camera, no portrait moves; the blow still lands once', () => {
    const { h, f, onImpact, camera, defenderEl } = run({ reduced: true, ...of(40) });
    expect(h.scene).toBeNull();
    expect(panes()).toBe(0);
    f.tick(h.plan.endAt + 100, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
  });

  it('a sandbox box (local space): the panes live inside the box, in its own px, and leave with it', () => {
    const { h, f, host } = run({ space: 'local', pixiScale: 0.4, attacker: { x: 60, y: 200 }, defender: { x: 300, y: 60 }, defenderRadius: 30, attackerRadius: 30, ...of(40) });
    expect(host.querySelector('.hreaping-veil')).not.toBeNull();
    expect((host.querySelector('.hreaping-patch') as HTMLElement).style.position).toBe('absolute');
    f.tick(h.plan.endAt + 32, 8);
    expect(host.querySelector('.hreaping-veil, .hreaping-patch')).toBeNull();
  });
});

describe('the drain panes (DOM)', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  const setup = (kind: 'cut' | 'cross' | 'shadow' | 'reaping') => ({
    doc: document, parent: document.body, local: false, css: (v: number) => v, kind, d: FOE, r: R, angles: kind === 'cut' ? [0.5] : kind === 'cross' ? [0.5, 0.5 + Math.PI / 2] : [],
    strike: -0.4, stripWidth: C.stripWidth, grey: 1, bounds: BOUNDS,
  });

  it('the patch is a round window exactly over the struck portrait; the veil covers the whole screen at any angle', () => {
    const d = new ReapingDrain(setup('reaping'));
    const p = d.patch!.style;
    expect([parseFloat(p.left), parseFloat(p.top), parseFloat(p.width), parseFloat(p.height)]).toEqual([FOE.x - R, FOE.y - R, 2 * R, 2 * R]);
    expect(p.borderRadius).toBe('50%');
    expect(p.overflow).toBe('hidden');
    const v = d.veil!.style;
    const diag = Math.hypot(BOUNDS.w, BOUNDS.h);
    expect(parseFloat(v.height)).toBeGreaterThanOrEqual(diag);
    expect(parseFloat(v.width)).toBeGreaterThan(parseFloat(v.height)); // plus the feathered trailing edge
    expect(parseFloat(v.top) + parseFloat(v.height) / 2).toBeCloseTo(BOUNDS.h / 2, 0);
    expect(d.patch!.style.pointerEvents).toBe('none');
    expect(v.pointerEvents).toBe('none');
    d.remove();
  });

  it('writes only when a value changes, and remove() is safe twice', () => {
    const d = new ReapingDrain(setup('cut'));
    const strip = d.strips[0]!;
    const s = { strip: [0.5, 0] as [number, number], stripA: 1, full: 0, veil: 0, flood: 0 };
    d.paint(s, null);
    const first = strip.style.transform;
    expect(first).toContain('scaleX(0.5000)');
    expect(first).toContain(`translateX(${(-R * 0.5).toFixed(2)}px)`); // grown from the end the blade came in at
    strip.style.transform = 'probe';
    d.paint(s, null);
    expect(strip.style.transform).toBe('probe');
    d.remove(); d.remove();
    expect(d.panes).toBe(0);
    expect(document.querySelector('.hreaping-patch')).toBeNull();
    d.paint(s, 'translate(1px, 1px)'); // a late frame after removal writes nothing
  });

  it('no setup (reduced motion): no panes, every call a no-op', () => {
    const d = new ReapingDrain(null);
    expect(d.panes).toBe(0);
    d.paint({ strip: [1, 1], stripA: 1, full: 1, veil: 1, flood: 1 }, null);
    d.remove();
  });
});

describe('the scene (headless Pixi)', () => {
  const make = (total: number, a = YOU, d = FOE) => {
    const p = plan(total);
    const g = reapingGeo(p, a, d, R, R, C, BOUNDS);
    return { p, g, s: new HeroReapingScene(TEX, COLORS, LOOK, p, g, { ...d, r: R }, { ...a, r: R }, 1, 42) };
  };
  const still = { heroX: 0, heroY: 0, foeX: 0, foeY: 0 };

  it('I-II: a blade is drawn only during its pass, exactly where the pure blade is', () => {
    const { p, g, s } = make(8);
    s.draw(p.chargeAt, still);
    expect(s.visibleBlades).toBe(0);
    s.draw(p.cuts[0]!.crossAt, still);
    expect(s.visibleBlades).toBe(1);
    const at = bladeAt(p, g, 0, p.cuts[0]!.crossAt);
    expect(s.bladePos(0)).toEqual({ x: at.x, y: at.y });
    s.draw(p.cuts[1]!.crossAt, still);
    expect(s.bladePos(1)).not.toBeNull();
    s.draw(p.endAt, still);
    expect(s.visibleBlades).toBe(0);
    s.destroy();
  });

  it('III: the shadow and the flame are there for the swing; the flame is out and the shadow gone before the end', () => {
    const { p, s } = make(14);
    s.draw(p.cuts[0]!.startAt, still);
    expect(s.shadowVisible).toBe(true);
    expect(s.flameVisible).toBe(true);
    s.draw(p.impactAt + SNUFF_MS + 1, still);
    expect(s.flameVisible).toBe(false);
    s.draw(p.returnEnd, still);
    expect(s.shadowVisible).toBe(false);
    s.destroy();
  });

  it('IV: the line is drawn from the sweep until it has thinned away', () => {
    const { p, s } = make(40);
    s.draw(p.tollAt!, still);
    expect(s.lineVisible).toBe(false);
    s.draw(p.impactAt, still);
    expect(s.lineVisible).toBe(true);
    s.draw(p.floodEnd!, still);
    expect(s.lineVisible).toBe(false);
    s.destroy();
  });

  it('the motes: capped, they all reach the striker, the scene drains, and the same seed streams the same', () => {
    const { s } = make(40);
    s.stream(999, 300, null);
    expect(s.liveMotes).toBe(MAX_MOTES);
    let alive = true, n = 0, peak = 0;
    while (alive && n++ < 800) { alive = s.update(16); peak = Math.max(peak, s.liveSprites); }
    expect(alive).toBe(false);
    expect(s.liveMotes).toBe(0);
    expect(s.arrived).toBe(MAX_MOTES);
    expect(peak).toBeLessThanOrEqual(MAX_REAPING_SPRITES);
    const a = make(3).s, b = make(3).s;
    a.stream(5, 180, 0); b.stream(5, 180, 0);
    for (let i = 0; i < 20; i++) { a.update(16); b.update(16); }
    expect(a.liveSprites).toBe(b.liveSprites);
    expect(a.root.children.map((c) => c.children.map((k) => `${k.position.x.toFixed(2)},${k.position.y.toFixed(2)}`))).toEqual(b.root.children.map((c) => c.children.map((k) => `${k.position.x.toFixed(2)},${k.position.y.toFixed(2)}`)));
    s.destroy(); a.destroy(); b.destroy();
  });

  it('every beat fires without a renderer, hideOwn hides the scythe, and destroy leaves nothing', () => {
    for (const total of TOTALS) {
      const { p, s } = make(total, FOE, YOU);
      const parent = new Container();
      parent.addChild(s.root);
      s.draw(p.impactAt, still);
      s.cross(0); s.stream(p.motes, 200, total < 12 ? 0 : null); s.toll(); s.snuff();
      s.update(16);
      expect(s.liveFx).toBeGreaterThan(0);
      s.hideOwn();
      expect(s.visibleBlades).toBe(0);
      expect(s.shadowVisible || s.lineVisible || s.flameVisible).toBe(false);
      s.draw(p.impactAt, still); // a late frame after the end draws nothing
      expect(s.visibleBlades).toBe(0);
      s.clear();
      expect(s.liveMotes).toBe(0);
      s.destroy(); s.destroy();
      expect(s.update(16)).toBe(false);
    }
  });
});
