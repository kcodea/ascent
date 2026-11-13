// @vitest-environment jsdom
/**
 * THE REAPING (the Ancient of Death's hero attack, an ANCIENT): what the scythe cuts is colour. The shared four tiers
 * (Tier 1 the cut, Tier 2 the cross, Tier 3 the harvest, Tier 4 the reaping; a knockout plays Tier 4); the tuner
 * values; the pure plan (Tier 2's first cut is a tick, the blow lands as the last blade crosses the portrait's middle);
 * the pure geometry (every blade passes through the struck portrait; the great crescent is held on screen and cuts the
 * portrait's middle, both directions; Tiers 1 and 2 are the owner-approved first pass and their timing is pinned); the
 * pure drain, gather, orb, ribbons, rainbow, cracks and stolen glow (what is grey or drawn when, and exactly nothing
 * after the end); the stolen palette (read from the portrait's own pixels); the runner on the shared clock (the blow
 * lands exactly ONCE; every exit removes every pane and puts both portraits back; replay; reduced motion); the
 * headless scene (pooled, bounded, drains, destroy leaves nothing); the dev-only registration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';
import {
  CROSS_AT, FALL_RAISE, HERO_REAPING_DEFAULTS, HERO_REAPING_RANGES, SCAR_MS, bladeAt, clampHeroReapingValue, crackAt, drainAt, foeMoveAt, gatherAt01, gatherRadius,
  heroReapingConfigJson, lineAt, orbAt, passAt, rainbowAt, reapingCameraAt, reapingCameraFocus, reapingCues, reapingGeo, reapingKind, reapingPlan, ribbonPoint,
  ribbonSpan, sanitizeHeroReapingConfig, stolenAt, swingAt, swingLight, swingPose,
  type HeroReapingNumKey,
} from './heroReapingConfig';
import { DRAIN_Z, ReapingDrain, farCorner, gatherClip, veilSpan } from './heroReapingDrain';
import { GHOSTS, HeroReapingScene, MAX_MOTES, MAX_REAPING_SPRITES, RIBBONS, ghostLag, type HeroReapingTextures } from './heroReapingScene';
import { isWarm, paletteFromPixels } from './heroReapingPalette';
import { playHeroReaping, reapingSeed, type HeroReapingOptions } from './heroReaping';
import { SPEC } from '../HeroReapingTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroReapingTextures = { glow: W, spark: W, streak: W, ring: W, beam: W, blade: W, crescent: W, line: W, mote: W, rainbow: W, shard: W, ribbon: W, cracks: W };
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
  it('uses the shared thresholds: Tier 1 cut, Tier 2 cross, Tier 3 the harvest, Tier 4 the reaping', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const p = plan(d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.kind, `dmg ${d}`).toBe(reapingKind(tierOf(d)));
    }
    expect([1, 2, 3, 4].map((t) => reapingKind(t as 1 | 2 | 3 | 4))).toEqual(['cut', 'cross', 'harvest', 'reaping']);
  });

  it('a knockout always plays Tier 4, whatever the number, and there is no separate knockout variant', () => {
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
    for (const k of ['colorTeal', 'colorBone', 'colorShade', 'colorMoteA', 'colorMoteB', 'colorMoteC', 'colorWorldA', 'colorWorldB', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('ships the Ancient of Death teal, its own ten clips and two shared ones, every fx clip it plays registered', () => {
    expect(C.colorTeal).toBe('#2fe0bc');
    expect([C.sfxBellClip, C.sfxSweepClip, C.sfxBreathClip, C.sfxSlashClip, C.sfxCleaveClip, C.sfxDrainClip]).toEqual(['fx/reaping-bell', 'fx/reaping-sweep', 'fx/reaping-breath', 'fx/reaping-slash', 'fx/reaping-cleave', 'fx/reaping-drain']);
    expect([C.sfxOrbClip, C.sfxShatterClip, C.sfxWindClip, C.sfxCrackClip]).toEqual(['fx/reaping-orb', 'fx/reaping-shatter', 'fx/reaping-wind', 'fx/reaping-crack']);
    expect([C.sfxMetalClip, C.sfxBoomClip]).toEqual(['fx/metal-woosh', 'fx/heavy-rock-impact']);
    expect(ATTACK_FX_CLIPS.reaping).toEqual([
      'fx/heavy-rock-impact', 'fx/metal-woosh', 'fx/reaping-bell', 'fx/reaping-breath', 'fx/reaping-cleave', 'fx/reaping-crack', 'fx/reaping-drain', 'fx/reaping-orb',
      'fx/reaping-shatter', 'fx/reaping-slash', 'fx/reaping-sweep', 'fx/reaping-wind',
    ]);
    for (const k of ['sfxBellClip', 'sfxSweepClip', 'sfxBreathClip', 'sfxSlashClip', 'sfxMetalClip', 'sfxCleaveClip', 'sfxDrainClip', 'sfxBoomClip', 'sfxOrbClip', 'sfxShatterClip', 'sfxWindClip', 'sfxCrackClip'] as const) {
      expect(ATTACK_FX_CLIPS.reaping, k).toContain(C[k]);
    }
  });

  it('the sound has presence (the owner heard the first pass as silent): no cue of its own clips sits under half gain', () => {
    for (const k of ['sfxBellGain', 'sfxSweepGain', 'sfxBreathGain', 'sfxSlashGain', 'sfxCleaveGain', 'sfxDrainGain', 'sfxOrbGain', 'sfxShatterGain', 'sfxWindGain', 'sfxCrackGain'] as const) expect(C[k], k).toBeGreaterThanOrEqual(0.5);
  });

  it('clamps numbers into range; junk falls back; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroReapingValue('t4Motes', 999)).toBe(64);
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

  it('names its looks Tier 1 to Tier 4 (no roman numerals, no Small / Big / Huge in its own words)', () => {
    const own = SPEC.controls.map((c) => `${c.label} ${c.hint ?? ''} ${c.group ?? ''}`).join(' ');
    expect(own).toMatch(/Tier 1/); expect(own).toMatch(/Tier 4/);
    expect(own).not.toMatch(/\b(I|II|III|IV)\b|\bSmall\b|\bBig\b|\bHuge\b/);
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

  it('Tiers 1 and 2 are the owner-approved first pass: their timing is pinned', () => {
    const one = plan(3), two = plan(8);
    expect([one.impactAt - one.chargeAt, one.endAt - one.chargeAt]).toEqual([450, 1350]);
    expect([two.impactAt - two.chargeAt, two.endAt - two.chargeAt]).toEqual([710, 1690]);
    expect([one.motes, two.motes, one.shakePx, two.shakePx, one.dim, two.dim]).toEqual([5, 10, 3, 5, 0.05, 0.12]);
    expect([C.bladeSize, C.bladeReach, C.bladeBow, C.stripWidth, C.knockPx, C.moteMs, C.moteSize]).toEqual([2.7, 2.3, 0.5, 0.46, 10, 700, 1.2]);
  });

  it('Tier 1 one cut, Tier 2 two (the first a tick), Tier 3 the fall after the gather and the hold, Tier 4 the sweep after the drain, the silence, the toll and the ribbons', () => {
    expect(plan(3).cuts.length).toBe(1);
    const two = plan(8);
    expect(two.cuts.length).toBe(2);
    expect(two.cuts[1]!.startAt - two.cuts[0]!.startAt).toBe(C.crossGapMs);
    expect(two.cuts[0]!.crossAt).toBeLessThan(two.impactAt);
    const three = plan(14);
    expect(three.gatherAt).toBe(three.chargeAt);
    expect(three.gatherEnd! - three.gatherAt!).toBe(C.gatherMs);
    expect(three.orbAt!).toBeGreaterThan(three.gatherAt!); expect(three.orbAt!).toBeLessThan(three.gatherEnd!);
    expect(three.heldAt).toBe(three.gatherEnd); // the orb is full and the crescent held over it
    expect(three.heldAt! - three.windAt!).toBe(C.riseMs);
    expect(three.cuts[0]!.startAt).toBe(three.heldAt! + C.raiseMs);
    expect(three.impactAt - three.cuts[0]!.startAt).toBeLessThanOrEqual(260);
    expect(three.stolenAt).toBeGreaterThan(three.impactAt); expect(three.stolenFull).toBeGreaterThan(three.stolenAt);
    expect([three.drainAt, three.tollAt, three.floodAt, three.ribbonAt]).toEqual([null, null, null, null]);
    const four = plan(40);
    expect(four.drainAt).toBe(four.chargeAt);
    expect(four.drainedAt! - four.drainAt!).toBe(C.drainMs);
    expect(four.tollAt! - four.drainedAt!).toBe(C.silenceMs); // the silent gap
    expect(C.silenceMs).toBeGreaterThanOrEqual(300); // a beat long enough to be FELT as silence
    expect(four.windAt).toBe(four.tollAt); // the crescent ignites on the toll
    expect(four.ribbonAt! - four.tollAt!).toBe(C.tollMs);
    expect(four.ribbonEnd! - four.ribbonAt!).toBe(C.windMs);
    expect(four.heldAt).toBe(four.ribbonEnd); // the blade is full of colour: it blazes
    expect(four.cuts[0]!.startAt - four.heldAt!).toBe(C.blazeMs);
    expect([four.gatherAt, four.orbAt]).toEqual([null, null]);
    expect(four.floodAt! - four.impactAt).toBe(C.streamMs);
    expect(four.floodEnd! - four.floodAt!).toBe(C.floodMs);
    expect(four.returnAt).toBeGreaterThan(four.floodEnd!); // the loser stays grey after the flood has passed
  });

  it('escalates: each tier runs longer and shakes harder; Tier 4 is the long one (anticipation and aftermath), under 5.2 s', () => {
    const ps = TOTALS.map((t) => plan(t));
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]!.endAt - ps[i]!.chargeAt).toBeGreaterThan(ps[i - 1]!.endAt - ps[i - 1]!.chargeAt);
      expect(ps[i]!.shakePx).toBeGreaterThan(ps[i - 1]!.shakePx);
    }
    expect(ps[0]!.endAt - ps[0]!.chargeAt).toBeLessThan(1800);
    // Soccer Tier 4 runs about 3.3 s and Frost Tier 4 about 3.1 s after the formation; the first pass ran 3.7 s and felt weightless.
    expect(ps[3]!.endAt - ps[3]!.chargeAt).toBeGreaterThan(4000);
    expect(ps[3]!.endAt - ps[3]!.chargeAt).toBeLessThan(5200);
    expect(ps[2]!.endAt - ps[2]!.chargeAt).toBeLessThan(3600);
    expect(ps[2]!.motes).toBeGreaterThan(ps[1]!.motes * 3); // a storm of shards
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
    expect(four).toEqual(['charge', 'drain', 'hush', 'toll', 'ribbons', 'held', 'sweep', 'impact', 'stolen', 'flood', 'return', 'end']);
    expect(reapingCues(plan(14)).map((c) => c.kind)).toEqual(['charge', 'gather', 'orb', 'wind', 'held', 'sweep', 'impact', 'stolen', 'return', 'end']);
  });

  it('reduced motion: no cuts, no drain; the blow lands where the formation ends', () => {
    const p = plan(40, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(p.cuts).toEqual([]);
    expect(reapingCues(p).map((c) => c.kind)).toEqual(['impact', 'end']);
    expect(drainAt(p, p.impactAt + 10)).toEqual({ strip: [0, 0], stripA: 0, full: 0, gather: 0, gatherA: 0, veil: 0, flood: 0 });
    expect(reapingCameraAt(p, C, p.impactAt)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('is deterministic', () => {
    for (const total of TOTALS) expect(plan(total)).toEqual(plan(total));
  });
});

describe('the geometry (pure), both directions', () => {
  const DIRS: [string, typeof YOU, typeof FOE][] = [['you strike', YOU, FOE], ['the foe strikes', FOE, YOU]];

  it('Tiers 1-2: every blade passes through the middle of the struck portrait exactly at its crossing, point first', () => {
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

  it('Tier 2: the two cuts cross at right angles, 45 degrees either side of the strike line (the wedges between are half)', () => {
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

  const onScreen = (pt: { x: number; y: number }, pad = 0): boolean => pt.x >= -pad && pt.x <= BOUNDS.w + pad && pt.y >= -pad && pt.y <= BOUNDS.h + pad;

  it('Tier 3: the great crescent is HUGE, held on screen, and its edge goes through the middle of the portrait exactly at the impact', () => {
    for (const [name, a, d] of DIRS) {
      const p = plan(14);
      const g = reapingGeo(p, a, d, R, R, C, BOUNDS);
      const s = g.swing!;
      expect(s, name).not.toBeNull();
      expect(g.line, name).toBeNull();
      expect(s.blade, name).toBeGreaterThanOrEqual(R * 3); // longer than the portrait is wide, by half again
      const q = p.cuts[0]!;
      // drawn back through the wind-up, then held still at a0
      expect(Math.abs(swingAt(p, s, p.windAt!) - s.a0), name).toBeCloseTo(s.back, 6);
      expect(swingAt(p, s, p.heldAt!)).toBe(s.a0);
      expect(swingAt(p, s, q.startAt)).toBe(s.a0);
      expect(Math.abs(s.a0 - s.aHit)).toBeCloseTo(FALL_RAISE, 6);
      // held, the whole crescent is on the screen (a few px of its point may graze the edge)
      const up = swingPose(s, s.a0);
      expect(onScreen(up.mid), name).toBe(true);
      expect(onScreen(up.tip, 20), `${name} tip ${JSON.stringify(up.tip)}`).toBe(true);
      expect(onScreen(up.heel), name).toBe(true);
      // the cut: the arm points at the middle of the portrait, and the blade covers the WHOLE portrait
      const hit = swingPose(s, swingAt(p, s, q.crossAt));
      expect(Math.hypot(hit.mid.x - d.x, hit.mid.y - d.y), name).toBeLessThan(0.5);
      expect(Math.hypot(hit.heel.x - d.x, hit.heel.y - d.y), name).toBeGreaterThanOrEqual(R);
      expect(Math.hypot(hit.tip.x - d.x, hit.tip.y - d.y), name).toBeGreaterThanOrEqual(R);
      // it accelerates into the cut, and follows through
      const early = Math.abs(swingAt(p, s, q.startAt + 40) - s.a0), late = Math.abs(swingAt(p, s, q.crossAt) - swingAt(p, s, q.crossAt - 40));
      expect(late, name).toBeGreaterThan(early * 3);
      expect(swingAt(p, s, q.endAt + 10)).toBeCloseTo(s.a1, 6);
      // the cut's direction is the tangent of the swing
      expect(g.cuts[0]!.dir.x * Math.cos(s.aHit) + g.cuts[0]!.dir.y * Math.sin(s.aHit)).toBeCloseTo(0, 6);
      // its light: nothing before the wind-up, building through it, full at the cut, gone by the end of the follow
      expect(swingLight(p, p.windAt! - 1)).toEqual({ a: 0, build: 0 });
      expect(swingLight(p, p.heldAt!).a).toBe(1);
      expect(swingLight(p, q.startAt).build).toBe(1);
      expect(swingLight(p, (p.windAt! + q.startAt) / 2).build).toBeCloseTo(0.5, 6);
      expect(swingLight(p, q.crossAt).a).toBe(1);
      expect(swingLight(p, q.endAt)).toEqual({ a: 0, build: 0 });
    }
    // with room above (your portrait, bottom left) it is raised ABOVE the portrait and FALLS through it
    const p = plan(14);
    const down = reapingGeo(p, FOE, YOU, R, R, C, BOUNDS);
    expect(swingPose(down.swing!, down.swing!.a0).mid.y).toBeLessThan(YOU.y - R);
    expect(down.cuts[0]!.dir.y).toBeGreaterThan(0.99);
  });

  it('Tier 4: the crescent is as tall as half the screen, sweeps on a great arc from the striker through the struck portrait, and leaves a line across the WHOLE screen', () => {
    for (const [name, a, d] of DIRS) {
      const p = plan(40);
      const g = reapingGeo(p, a, d, R, R, C, BOUNDS);
      const s = g.swing!, l = g.line!;
      expect(s.blade, name).toBeGreaterThanOrEqual(BOUNDS.h * 0.5);
      const q = p.cuts[0]!;
      // held over the striker; through the struck portrait at the impact; then on
      const from = swingPose(s, s.a0), hit = swingPose(s, swingAt(p, s, q.crossAt));
      expect(Math.hypot(from.mid.x - a.x, from.mid.y - a.y), name).toBeLessThan(1);
      expect(Math.hypot(hit.mid.x - d.x, hit.mid.y - d.y), name).toBeLessThan(0.5);
      expect(Math.sign(s.a1 - s.aHit), name).toBe(s.sgn);
      // most of the blade lies on the screen side of the portrait (toward the pivot, which is far off the screen)
      expect(onScreen(s.pivot), name).toBe(false);
      expect(s.arm, name).toBeGreaterThan(Math.hypot(d.x - a.x, d.y - a.y));
      expect(onScreen({ x: (hit.heel.x + hit.mid.x) / 2, y: (hit.heel.y + hit.mid.y) / 2 }), name).toBe(true);
      // half way through the sweep the edge is still nearer the striker (it accelerates): the afterimages fan out
      const half = swingPose(s, swingAt(p, s, (q.startAt + q.crossAt) / 2));
      expect(Math.hypot(half.mid.x - a.x, half.mid.y - a.y), name).toBeLessThan(Math.hypot(half.mid.x - d.x, half.mid.y - d.y));
      // the line: through the portrait, both ends off the screen, along the sweep
      expect(onScreen(l.from), name).toBe(false);
      expect(onScreen(l.to), name).toBe(false);
      expect(Math.hypot(l.from.x + (l.to.x - l.from.x) * l.hitK - d.x, l.from.y + (l.to.y - l.from.y) * l.hitK - d.y), name).toBeLessThan(0.5);
      expect(Math.cos(l.angle - g.cuts[0]!.angle)).toBeCloseTo(1, 6);
      // it is not there before the cut, opens out from the portrait, and has thinned away SCAR_MS later
      expect(lineAt(p, p.impactAt - 1)).toEqual({ len: 0, a: 0 });
      expect(lineAt(p, p.impactAt).a).toBe(1);
      expect(lineAt(p, p.impactAt).len).toBeLessThan(0.2);
      expect(lineAt(p, p.impactAt + 120).len).toBe(1);
      expect(lineAt(p, p.impactAt + SCAR_MS)).toEqual({ len: 0, a: 0 });
    }
    expect(lineAt(plan(14), plan(14).impactAt + 50)).toEqual({ len: 0, a: 0 }); // Tier 3 leaves no line
  });
});

describe('the drain (pure): what is grey when', () => {
  it('nothing is grey before the charge or from the end of the return, on any tier', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      const zero = { strip: [0, 0], stripA: 0, full: 0, gather: 0, gatherA: 0, veil: 0, flood: 0 };
      expect(drainAt(p, p.chargeAt - 1)).toEqual(zero);
      expect(drainAt(p, p.returnEnd)).toEqual(zero);
      expect(drainAt(p, p.endAt + 500)).toEqual(zero);
      expect(foeMoveAt(p, p.returnEnd)).toEqual({ knock: 0, sag: 0 });
    }
  });

  it('Tier 1: the strip is drained BEHIND the blade (nothing before it reaches the portrait, all of it once it has left), then seeps back', () => {
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

  it('Tier 2: the first cut drains only its strip; the wedges go on the second', () => {
    const p = plan(8);
    const between = drainAt(p, p.cuts[0]!.endAt - 1);
    expect(between.strip[0]).toBeGreaterThan(0.95);
    expect(between.full).toBe(0);
    const after = drainAt(p, p.impactAt + 200);
    expect(after.full).toBe(1);
    expect(after.strip).toEqual([1, 1]);
  });

  it('Tier 3: the world greys from the edges in, the portrait greys into the orb and is ALL grey on the cut, and the world gets its colour back first', () => {
    const p = plan(14);
    expect(drainAt(p, p.gatherAt!).gather).toBe(0);
    expect(drainAt(p, p.gatherAt! + 1).gatherA).toBe(1);
    const half = drainAt(p, (p.gatherAt! + p.gatherEnd!) / 2).gather;
    expect(half).toBeGreaterThan(0.3); expect(half).toBeLessThan(0.7);
    expect(drainAt(p, p.gatherEnd!).gather).toBe(1);
    expect(drainAt(p, p.orbAt! - 1).full).toBe(0); // the portrait keeps its colour until the orb starts taking it
    const into = drainAt(p, p.heldAt!).full;
    expect(into).toBeGreaterThan(0.6); expect(into).toBeLessThan(1);
    expect(drainAt(p, p.impactAt + 50).full).toBe(1);
    expect(drainAt(p, p.impactAt + 120).veil).toBe(0);
    // The board's grey lifts after the shatter; the portrait stays grey.
    const lifted = drainAt(p, p.impactAt + 1000);
    expect(lifted.gatherA).toBe(0);
    expect(lifted.full).toBe(1);
    // The hole: past the farthest corner at the start, on the portrait at the end.
    const dMax = farCorner(FOE, BOUNDS);
    expect(gatherRadius(0, dMax, R)).toBeGreaterThan(dMax);
    expect(gatherRadius(1, dMax, R)).toBeCloseTo(R * 1.15, 3);
    expect(gatherAt01(0)).toBe(0); expect(gatherAt01(1)).toBeCloseTo(1, 6);
    for (let v = 0; v < 1; v += 0.05) expect(gatherAt01(v + 0.05)).toBeGreaterThan(gatherAt01(v));
  });

  it('Tier 3: the orb forms from orbAt, is full by the hold, and is GONE on the impact (it shatters)', () => {
    const p = plan(14);
    expect(orbAt(p, p.orbAt! - 1)).toEqual({ k: 0, a: 0 });
    expect(orbAt(p, p.heldAt!).k).toBeGreaterThan(0.95);
    expect(orbAt(p, p.impactAt - 1).a).toBe(1);
    expect(orbAt(p, p.impactAt)).toEqual({ k: 0, a: 0 });
    expect(orbAt(plan(40), plan(40).impactAt - 100).a).toBe(0);
  });

  it('Tier 4: three ribbons grow out of the portrait, reach the blade, and are reeled onto it before the blaze; the blade turns rainbow', () => {
    const p = plan(40);
    for (let j = 0; j < RIBBONS; j++) {
      expect(ribbonSpan(p, j, p.ribbonAt! - 1)).toEqual({ tail: 0, head: 0 });
      const mid = ribbonSpan(p, j, p.ribbonAt! + C.windMs * 0.5);
      expect(mid.head).toBeGreaterThan(mid.tail);
      expect(mid.tail).toBe(0); // still rooted in the portrait
      expect(ribbonSpan(p, j, p.ribbonAt! + C.windMs * 0.9).head).toBe(1); // reached the blade
      expect(ribbonSpan(p, j, p.ribbonEnd!)).toEqual({ tail: 0, head: 0 }); // all of it is on the blade
    }
    const a = { x: 100, y: 100 }, b = { x: 1100, y: 600 };
    for (let j = 0; j < RIBBONS; j++) {
      expect(ribbonPoint(a, b, j, 0, 1.3, 200)).toEqual({ x: a.x, y: a.y });
      const e = ribbonPoint(a, b, j, 1, 1.3, 200);
      expect(e.x).toBeCloseTo(b.x, 6); expect(e.y).toBeCloseTo(b.y, 6);
    }
    // The three are a braid: a third of a turn apart in the middle.
    const m = [0, 1, 2].map((j) => ribbonPoint(a, b, j, 0.5, 0, 200));
    expect(Math.hypot(m[0]!.x - m[1]!.x, m[0]!.y - m[1]!.y)).toBeGreaterThan(100);
    expect(rainbowAt(p, p.ribbonAt!)).toBe(0);
    expect(rainbowAt(p, p.heldAt!)).toBe(1);
    expect(rainbowAt(plan(14), plan(14).impactAt)).toBe(0);
  });

  it('Tier 4: the loser cracks like old paint just after the cut, stays cracked while grey, and is clean by the end', () => {
    const p = plan(40);
    expect(crackAt(p, p.impactAt)).toBe(0);
    expect(crackAt(p, p.impactAt + 200)).toBe(1);
    expect(crackAt(p, p.returnAt)).toBe(1);
    expect(crackAt(p, p.returnEnd)).toBe(0);
    for (const t of [3, 8, 14]) expect(crackAt(plan(t), plan(t).impactAt + 200)).toBe(0);
  });

  it('every tier: the striker glows with the stolen colour only once it arrives, and not at all by the end', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      expect(stolenAt(p, p.stolenAt - 1)).toBe(0);
      expect(stolenAt(p, p.impactAt)).toBe(0);
      expect(stolenAt(p, p.stolenFull)).toBe(1);
      expect(stolenAt(p, p.endAt)).toBe(0);
    }
  });

  it('Tier 4: the screen drains before the toll (sparing the portrait), stays monochrome through the sweep, floods back, and the LOSER stays grey after it', () => {
    const p = plan(40);
    expect(drainAt(p, p.tollAt!).full).toBe(0); // the last colour in the world
    const pulled = drainAt(p, (p.ribbonAt! + p.ribbonEnd!) / 2).full;
    expect(pulled).toBeGreaterThan(0.3); expect(pulled).toBeLessThan(0.7);
    expect(drainAt(p, p.ribbonEnd!).full).toBe(1);
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

  it('the camera pushes in to the blow and is at rest again by the end; Tier 4 is jolted by the toll and holds its push until the flood', () => {
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
    // the toll: the view drops and kicks in; the cut hits harder than the toll, and harder than Tier 3's
    const before = reapingCameraAt(four, C, four.tollAt! - 1), jolt = reapingCameraAt(four, C, four.tollAt! + 30);
    expect(before.y).toBe(0);
    expect(Math.abs(jolt.y)).toBeGreaterThan(1.5);
    expect(jolt.zoom).toBeGreaterThan(before.zoom + four.punch * 0.3);
    const peak = (p: ReturnType<typeof plan>, from: number): number => { let m = 0; for (let t = from; t < from + 200; t += 4) { const c = reapingCameraAt(p, C, t, { x: 1, y: 0 }); m = Math.max(m, Math.hypot(c.x, c.y)); } return m; };
    expect(peak(four, four.impactAt)).toBeGreaterThan(peak(four, four.tollAt!) * 2);
    expect(peak(four, four.impactAt)).toBeGreaterThan(peak(plan(14), plan(14).impactAt) * 1.3);
    expect(peak(plan(14), plan(14).impactAt)).toBeGreaterThan(peak(plan(8), plan(8).impactAt) * 2);
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

  it('Tier 2: the first cut is a tick (FX only); the consequence waits for the second', () => {
    const { h, f, onImpact } = run(of(8));
    f.tick(h.plan.cuts[0]!.crossAt + 20, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveMotes).toBeGreaterThan(0); // a few motes already left with the first strip
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('the panes: a strip per cut on Tiers 1-2, the two wedges on Tier 2, the whole portrait on Tiers 3-4, the gather on Tier 3, the veil on Tier 4; all under the FX canvas', () => {
    const count = (total: number) => {
      const { h } = run(of(total));
      const r = { veil: h.drain.veil ? 1 : 0, gather: h.drain.gatherPane ? 1 : 0, strips: h.drain.strips.length, full: h.drain.fulls.length };
      for (const el of [h.drain.veil, h.drain.gatherPane, h.drain.patch]) if (el) expect(Number(el.style.zIndex)).toBeGreaterThanOrEqual(DRAIN_Z);
      for (const el of [h.drain.veil, h.drain.gatherPane, h.drain.patch]) if (el) expect(Number(el.style.zIndex)).toBeLessThan(200);
      h.cancel();
      return r;
    };
    expect(count(3)).toEqual({ veil: 0, gather: 0, strips: 1, full: 0 });
    expect(count(8)).toEqual({ veil: 0, gather: 0, strips: 2, full: 2 }); // the two wedges
    expect(count(14)).toEqual({ veil: 0, gather: 1, strips: 0, full: 1 });
    expect(count(40)).toEqual({ veil: 1, gather: 0, strips: 0, full: 1 });
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

  it('Tier 3: the world greys in toward the orb before the blow; on it the orb shatters into shards, the portrait is all grey and knocked hard', () => {
    const { h, f, onImpact, defenderEl } = run(of(14));
    const p = h.plan;
    const gather = h.drain.gatherPane!;
    expect(gather).not.toBeNull();
    f.tick((p.gatherAt! + p.gatherEnd!) / 2, 4);
    expect(Number(gather.style.opacity)).toBe(1);
    expect(gather.style.clipPath || gather.style.getPropertyValue('clip-path')).toContain('evenodd');
    f.tick(p.cuts[0]!.startAt - h.elapsed(), 4);
    expect(h.scene!.crescentVisible).toBe(true);
    expect(h.scene!.orbVisible).toBe(true);
    const into = Number(h.drain.full!.style.opacity);
    expect(into).toBeGreaterThan(0.5); expect(into).toBeLessThan(1); // its colour is going into the orb
    expect(h.scene!.liveMotes).toBe(0);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(p.impactAt - h.elapsed() + 60, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.orbVisible).toBe(false);
    expect(Number(h.drain.full!.style.opacity)).toBe(1);
    expect(h.scene!.liveMotes).toBe(p.motes);
    let far = 0;
    for (let i = 0; i < 50; i++) {
      f.tick(4, 4);
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(defenderEl.style.transform);
      if (m) far = Math.max(far, Math.hypot(Number(m[1]), Number(m[2])));
    }
    expect(far).toBeGreaterThan(14); // it REELS (Tiers 1-2 move about 3 px)
    h.cancel();
  });

  it('Tier 4: monochrome but the foe and still before the toll, the crescent cuts the portrait on the impact, colour floods back behind a bright front, the loser stays grey, then nothing is left', () => {
    const { h, f, onImpact } = run(of(40));
    const p = h.plan;
    f.tick(p.tollAt! - 8, 4);
    expect(Number(h.drain.veil!.style.opacity)).toBe(1);
    expect(h.drain.veil!.style.getPropertyValue('mask-image')).toContain('radial-gradient'); // the foe is spared
    expect(Number(h.drain.full!.style.opacity)).toBe(0);
    expect(h.scene!.crescentVisible).toBe(false); // the silence is still: nothing is drawn until the bell
    expect(h.scene!.liveFx).toBe(0);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(p.cuts[0]!.startAt - h.elapsed(), 4);
    expect(h.scene!.crescentVisible).toBe(true); // it ignited on the toll and is held
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(p.impactAt - h.elapsed() + 4, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.lineVisible).toBe(true);
    expect(h.scene!.visibleGhosts).toBe(GHOSTS);
    expect(h.scene!.liveMotes).toBe(p.motes);
    f.tick((p.floodAt! + p.floodEnd!) / 2 - h.elapsed(), 4);
    expect(h.scene!.frontVisible).toBe(true);
    expect(h.drain.veil!.style.getPropertyValue('mask-image')).not.toContain('radial-gradient'); // dropped as the flood began
    f.tick(p.floodEnd! - h.elapsed() + 8, 4);
    expect(h.scene!.frontVisible).toBe(false);
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
  const setup = (kind: 'cut' | 'cross' | 'harvest' | 'reaping') => ({
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

  it('the gather clip (pure): the whole box minus a circle round the portrait, even-odd', () => {
    const c = gatherClip(1920, 1080, 1773, 161, 300);
    expect(c.startsWith('path(evenodd, "M0 0 H1920.0 V1080.0 H0 Z M1473.0 161.0')).toBe(true);
    expect(c).toContain('a300.0 300.0 0 1 0 600.0 0');
    expect(farCorner(FOE, BOUNDS)).toBeCloseTo(Math.hypot(1773, 1080 - 161), 6);
  });

  it('the veil span (pure): the bright front starts off the striker side, ends off the far side, and runs with the flood', () => {
    const v = veilSpan(BOUNDS.w, BOUNDS.h, 240);
    const diag = Math.hypot(BOUNDS.w, BOUNDS.h);
    expect(v.side).toBeGreaterThanOrEqual(diag);
    expect(v.frontAt(0)).toBeLessThan(-diag / 2);
    expect(v.frontAt(1)).toBeGreaterThan(diag / 2);
    expect(v.frontAt(0.5)).toBeGreaterThan(v.frontAt(0.25));
  });

  it('writes only when a value changes, and remove() is safe twice', () => {
    const d = new ReapingDrain(setup('cut'));
    const strip = d.strips[0]!;
    const s = { strip: [0.5, 0] as [number, number], stripA: 1, full: 0, gather: 0, gatherA: 0, veil: 0, flood: 0 };
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
    d.paint({ strip: [1, 1], stripA: 1, full: 1, gather: 1, gatherA: 1, veil: 1, flood: 1 }, null);
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

  it('Tiers 1-2: a blade is drawn only during its pass, exactly where the pure blade is', () => {
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

  it('Tier 3: the crescent is drawn from the wind-up to the end of the follow-through, on its arm, with afterimages only once it falls', () => {
    const { p, g, s } = make(14);
    const q = p.cuts[0]!, sw = g.swing!;
    s.draw(p.windAt! - 1, still);
    expect(s.crescentVisible).toBe(false);
    s.draw(p.heldAt!, still);
    expect(s.crescentVisible).toBe(true);
    expect(s.visibleGhosts).toBe(0); // held: no afterimage
    const heel = swingPose(sw, sw.a0).heel;
    expect(Math.hypot(s.crescentPose!.x - heel.x, s.crescentPose!.y - heel.y)).toBeLessThan(6); // held: it only trembles
    s.draw(q.crossAt, still);
    expect(s.crescentPose!.rot).toBeCloseTo(sw.aHit, 6);
    expect(s.visibleGhosts).toBeGreaterThanOrEqual(3);
    s.draw(q.endAt + 1, still);
    expect(s.crescentVisible).toBe(false);
    expect(s.visibleGhosts).toBeGreaterThan(0); // the afterimages are still finishing the pass
    s.draw(q.endAt + ghostLag(GHOSTS) + 1, still);
    expect(s.visibleGhosts).toBe(0);
    expect(s.lineVisible).toBe(false);
    s.destroy();
  });

  it('Tier 4: the crescent from the toll, every afterimage fanned out at the cut, the line after it, and the front running with the flood', () => {
    const { p, g, s } = make(40);
    const q = p.cuts[0]!;
    s.draw(p.tollAt! - 1, still);
    expect(s.crescentVisible || s.lineVisible || s.frontVisible).toBe(false);
    s.draw(p.heldAt!, still);
    expect(s.crescentVisible).toBe(true);
    s.draw(p.impactAt - 1, still);
    expect(s.lineVisible).toBe(false);
    s.draw(p.impactAt, still);
    expect(s.lineVisible).toBe(true);
    expect(s.visibleGhosts).toBe(GHOSTS);
    s.draw(p.impactAt + SCAR_MS, still);
    expect(s.lineVisible).toBe(false);
    expect(q.endAt + ghostLag(GHOSTS)).toBeLessThan(p.floodAt!); // every afterimage is gone before the colour returns
    // the front: only during the flood, and it travels from the striker's side toward the struck portrait's
    s.draw(p.floodAt! - 1, still);
    expect(s.frontVisible).toBe(false);
    s.draw(p.floodAt! + (p.floodEnd! - p.floodAt!) * 0.3, still);
    const f0 = s.frontPos!;
    s.draw(p.floodAt! + (p.floodEnd! - p.floodAt!) * 0.7, still);
    const f1 = s.frontPos!;
    expect((f1.x - f0.x) * g.u.x + (f1.y - f0.y) * g.u.y).toBeGreaterThan(400);
    s.draw(p.floodEnd!, still);
    expect(s.frontVisible).toBe(false);
    s.destroy();
  });

  it('the cut: Tier 4 strikes harder than a bare Tier 3 strike; Tier 3 SHATTERS the orb into shards; Tiers 1-2 mark a cut with a hairline, a breath and a spray of the colour', () => {
    const three = make(14).s, four = make(40).s, one = make(3).s, shat = make(14).s;
    three.strike(1); four.strike(1.5); one.cross(0, 1);
    expect(one.liveFx).toBe(2 + 8 + 4);
    expect(three.liveFx).toBeGreaterThanOrEqual(15);
    expect(four.liveFx).toBeGreaterThan(three.liveFx);
    shat.shatter(40);
    expect(shat.liveMotes).toBe(40); // the shards are in flight to the striker
    expect(shat.liveFx).toBeGreaterThan(three.liveFx); // its own rings and sparkles on top of the strike
    let n = 0;
    while (shat.liveMotes > 0 && n++ < 400) shat.update(16);
    expect(shat.arrived).toBe(40);
    three.destroy(); four.destroy(); one.destroy(); shat.destroy();
  });

  it('Tier 3: the drops run in during the gather only, the orb is drawn until the impact, and the striker glows once its colour arrives', () => {
    const { p, s } = make(14);
    s.draw(p.gatherAt! - 1, still);
    expect(s.visibleDrops).toBe(0);
    expect(s.orbVisible).toBe(false);
    let most = 0;
    for (let t = p.gatherAt!; t < p.gatherEnd!; t += 40) { s.draw(t, still); most = Math.max(most, s.visibleDrops); }
    expect(most).toBeGreaterThan(4);
    s.draw(p.heldAt!, still);
    expect(s.orbVisible).toBe(true);
    expect(s.orbRadius).toBeGreaterThan(R * 0.8);
    s.draw(p.impactAt, still);
    expect(s.orbVisible).toBe(false);
    expect(s.visibleDrops).toBe(0);
    expect(s.auraAlpha).toBe(0);
    s.draw(p.stolenFull, still);
    expect(s.auraAlpha).toBeGreaterThan(0.2);
    s.draw(p.endAt, still);
    expect(s.auraAlpha).toBe(0);
    s.destroy();
  });

  it('Tier 3 drops leave from the edge of the grey where it is ON the screen, in both directions', () => {
    for (const [a, d] of [[YOU, FOE], [FOE, YOU]] as const) {
      const { p, s } = make(14, a, d);
      let onScreen = 0, seen = 0;
      for (let t = p.gatherAt!; t < p.gatherEnd!; t += 16) {
        s.draw(t, still);
        for (const k of s.root.children[3]!.children) {
          if (!k.visible || k.alpha < 0.05) continue;
          seen++;
          if (k.position.x > -40 && k.position.y > -40 && k.position.x < BOUNDS.w + 40 && k.position.y < BOUNDS.h + 40) onScreen++;
        }
      }
      expect(seen).toBeGreaterThan(0);
      expect(onScreen / seen).toBeGreaterThan(0.95);
      s.destroy();
    }
  });

  it('Tier 4: the ribbons wind from the portrait to the blade, the blade turns rainbow, the loser cracks after the cut', () => {
    const { p, g, s } = make(40);
    s.draw(p.ribbonAt! - 1, still);
    expect(s.visibleRibbons).toBe(0);
    s.draw(p.ribbonAt! + C.windMs * 0.5, still);
    expect(s.visibleRibbons).toBe(RIBBONS);
    expect(s.rainbowAlpha).toBeGreaterThan(0);
    s.draw(p.ribbonAt! + C.windMs * 0.9, still);
    // A ribbon's head is on the blade (its middle, on its arm).
    const sw = g.swing!, ang = swingAt(p, sw, p.ribbonAt! + C.windMs * 0.9);
    const head = s.ribbonHead(0)!;
    expect(Math.hypot(head.x - (sw.pivot.x + Math.cos(ang) * sw.arm), head.y - (sw.pivot.y + Math.sin(ang) * sw.arm))).toBeLessThan(2);
    s.draw(p.heldAt!, still);
    expect(s.visibleRibbons).toBe(0);
    expect(s.rainbowAlpha).toBeGreaterThan(0.95);
    expect(s.cracksAlpha).toBe(0);
    s.draw(p.impactAt + 200, still);
    expect(s.cracksAlpha).toBeGreaterThan(0.85);
    s.draw(p.returnEnd, still);
    expect(s.cracksAlpha).toBe(0);
    s.flake();
    expect(s.liveFx).toBeGreaterThanOrEqual(26);
    s.destroy();
  });

  it('the stolen colour is the portrait\'s own: picked from its pixels, vivid, with a warm and a cool, deterministic', () => {
    const px = (rgb: [number, number, number], n: number): number[] => { const out: number[] = []; for (let i = 0; i < n; i++) out.push(rgb[0], rgb[1], rgb[2], 255); return out; };
    // A mostly red portrait with a green cloak and some grey.
    const data = [...px([200, 40, 40], 300), ...px([40, 160, 60], 150), ...px([120, 120, 120], 126)];
    const fb = [0xffb24a, 0x5ab4ff];
    const pal = paletteFromPixels(data, 4, fb);
    expect(pal.length).toBeGreaterThanOrEqual(2);
    expect(isWarm(pal[0]!)).toBe(true); // the red leads (the strongest)
    expect(pal.some((c) => !isWarm(c))).toBe(true); // the green
    expect(pal).toEqual(paletteFromPixels(data, 4, fb));
    // Nothing but grey: the fallback hues.
    const grey = paletteFromPixels(px([128, 128, 128], 100), 4, fb);
    expect(grey.some((c) => isWarm(c)) && grey.some((c) => !isWarm(c))).toBe(true);
    // One colour only: still a few shades of it, plus a cool.
    const mono = paletteFromPixels(px([220, 60, 30], 200), 4, fb);
    expect(mono.length).toBeGreaterThanOrEqual(3);
    expect(mono.some((c) => !isWarm(c))).toBe(true);
  });

  it('a plume (Tiers 3-4) is fatter than a drift (Tiers 1-2), torn out along the cut, and rolls the same dice', () => {
    const a = make(40).s, b = make(40).s;
    a.stream(20, 200, null); b.stream(20, 200, null, 1.6, { x: 300, y: 0 });
    for (let i = 0; i < 30; i++) { a.update(16); b.update(16); }
    const bodies = (s: HeroReapingScene) => s.root.children[2]!.children.filter((k) => k.visible);
    expect(bodies(a).length).toBe(bodies(b).length);
    const size = (s: HeroReapingScene): number => bodies(s).reduce((m, k) => m + k.scale.x, 0);
    const xs = (s: HeroReapingScene): number => bodies(s).reduce((m, k) => m + k.position.x, 0);
    expect(size(b)).toBeGreaterThan(size(a) * 1.4);
    expect(xs(b)).toBeGreaterThan(xs(a));
    a.destroy(); b.destroy();
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
      s.cross(0); s.stream(p.motes, 200, total < 12 ? 0 : null); s.toll(); s.ignite(); s.held(); s.strike(1.5); s.flood();
      s.orbBegin(); s.ribbonsBegin(); s.shatter(10); s.flake();
      s.update(16);
      expect(s.liveFx).toBeGreaterThan(0);
      s.hideOwn();
      expect(s.visibleBlades).toBe(0);
      expect(s.crescentVisible || s.lineVisible || s.frontVisible).toBe(false);
      expect(s.visibleGhosts).toBe(0);
      expect(s.visibleRibbons + s.visibleDrops).toBe(0);
      expect(s.orbVisible).toBe(false);
      expect(s.cracksAlpha + s.auraAlpha).toBe(0);
      s.draw(p.impactAt, still); // a late frame after the end draws nothing
      expect(s.visibleBlades).toBe(0);
      expect(s.crescentVisible).toBe(false);
      s.clear();
      expect(s.liveMotes).toBe(0);
      s.destroy(); s.destroy();
      expect(s.update(16)).toBe(false);
    }
  });
});
