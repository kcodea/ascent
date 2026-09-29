// @vitest-environment jsdom
/**
 * THE ENRAGED STRIKE HERO ATTACK (owner 2026-09-28: "a legendary version of this strike ... just amplified or enraged";
 * then "enraged needs way more polish", and "remove the freezeing frame from all of the animations"): the tier mapping
 * SHARED with every style; the tier -> strikes ladder (one / a double / a combo of three / a rampage and the haymaker); the tuner
 * defaults + clamping (and no hit-stop dial); the pure plan (Classic's swing times, the tick rhythm, the finisher wind,
 * the full cycle between hits, the haymaker's rear-back, reduced motion, determinism); the pure pose (Classic's coil and contact, deeper; the squash; the rage
 * spent on the last blow; home at the end; kept on screen); the camera; the runner on the shared clock (the consequence
 * lands exactly ONCE, on the last strike or the haymaker, never on a tick; both directions; slow motion; replay; finish /
 * cancel; cleanup); the headless scene (pooled, bounded, evenly stamped afterimages, drains, destroy leaves nothing);
 * the cosmetic resolution; and every other style unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { CLASSIC_DEFAULTS } from '../heroAttack/classicConfig';
import { classicSwing } from '../heroAttack/heroClassic';
import { HERO_ARCANA_DEFAULTS, arcanaPlan } from '../heroArcana/heroArcanaConfig';
import { HERO_BLADES_DEFAULTS, bladesPlan } from '../heroBlades/heroBladesConfig';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  ENRAGED_CAPS, ENRAGED_TIER_SUFFIXES, HERO_ENRAGED_DEFAULTS, HERO_ENRAGED_RANGES, TYPICAL_SWING, clampHeroEnragedValue, enragedCameraAt,
  enragedCameraFocus, enragedCues, enragedGeo, enragedPlan, enragedPose, fitInFrame, heroEnragedConfigJson, sanitizeHeroEnragedConfig,
  type HeroEnragedNumKey,
} from './heroEnragedConfig';
import { HeroEnragedScene, MAX_ENRAGED_MESHES, MAX_ENRAGED_SPRITES, MAX_GHOSTS, type HeroAt, type HeroEnragedTextures } from './heroEnragedScene';
import { enragedSeed, playHeroEnraged, type HeroEnragedOptions } from './heroEnraged';
import { SPEC } from '../HeroEnragedTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroEnragedTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  smoke: W, rock: W, scorch: W, cracks: W, disc: W, rim: W, halo: W, rimCracks: W,
};
const C = HERO_ENRAGED_DEFAULTS;
const plan = (values: number[], total: number, reduced = false) => enragedPlan({ total, reduced, leadIn: leadInOf(values, reduced), swing: TYPICAL_SWING, tempo: CLASSIC_DEFAULTS.tempo }, C);
const COLORS = { core: 0xffffff, hot: 0xffd36b, side: 0xff5a14, shade: 0x6e0f00, smoke: 0x2b1b16 };
const LOOK = {
  auraSize: 1, flames: 12, flameLength: 1, ghosts: 3, ghostSpacing: 1.35, ghostAlpha: 0.65, ghostFadeMs: 220, wakeWidth: 1, wakeMs: 90,
  ringSize: 1, ring2Size: 1, slashLength: 1, slashWidth: 1, sparkSpeed: 1, emberLife: 1, craterSize: 1, debris: 12,
  crescentSize: 1, shockSize: 1, burstSize: 1, sparkInward: 0.65, rimCracks: 1, scorch: 1, scorchMs: 1000, emberStorm: 46,
};
const A = { x: 300, y: 800 }, D = { x: 1500, y: 200 };
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);
const geo = (a = A, d = D) => enragedGeo(a, d, 80, 80, C, FRAME);

describe('the damage tiers (shared with every style)', () => {
  it('Enraged steps up on exactly the blows every other style does: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(arcanaPlan({ total: d, distance: 1600 }, HERO_ARCANA_DEFAULTS).tier);
      expect(t).toBe(bladesPlan({ total: d, distance: 1600 }, HERO_BLADES_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE enraged hit, II a DOUBLE strike, III a COMBO of three, IV a RAMPAGE of five slams and the overhead HAYMAKER', () => {
    expect([P1, P2, P3, P4].map((p) => p.strikes.length)).toEqual([1, 2, 3, 6]);
    expect([P1, P2, P3, P4].map((p) => p.haymaker)).toEqual([false, false, false, true]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.haymaker ? 'haymaker' : p.strikes.length; }))
      .toEqual([1, 1, 2, 2, 3, 3, 'haymaker', 'haymaker']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_ENRAGED_RANGES)) {
      const v = C[k as HeroEnragedNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorHot', 'colorPlayer', 'colorFoe', 'colorShade', 'colorSmoke'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('there is NO hit-stop dial (owner 2026-09-28: "remove the freezeing frame from all of the animations. it looks like lag")', () => {
    expect(ENRAGED_TIER_SUFFIXES as readonly string[]).not.toContain('HitStop');
    expect(Object.keys(C).some((k) => /hitstop/i.test(k))).toBe(false);
    expect(SPEC.controls.some((c) => /hit-?stop|freeze/i.test(`${c.label} ${c.hint ?? ''}`))).toBe(false);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroEnragedValue('t3Strikes', 99)).toBe(8);
    expect(clampHeroEnragedValue('t1Strikes', 0)).toBe(1);
    expect(clampHeroEnragedValue('ghosts', 99)).toBe(6);
    expect(clampHeroEnragedValue('shakeCap', -3)).toBe(0);
    expect(clampHeroEnragedValue('windupDepth', Number.NaN)).toBe(C.windupDepth);
    expect(clampHeroEnragedValue('colorPlayer', 'red')).toBe(C.colorPlayer);
    expect(clampHeroEnragedValue('colorPlayer', '#AABBCC')).toBe('#aabbcc');
    expect(clampHeroEnragedValue('nope' as never, 1)).toBeUndefined();
    const s = sanitizeHeroEnragedConfig({ t4Haymaker: 0, flames: 'x', junk: 3, t2Strikes: 3.4 });
    expect(s.t4Haymaker).toBe(0);
    expect(s.flames).toBe(C.flames);
    expect((s as unknown as Record<string, unknown>).junk).toBeUndefined();
    expect(s.t2Strikes).toBe(3.4);
    expect(sanitizeHeroEnragedConfig(null)).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Enraged; no em dashes', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroEnragedConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Haymaker).toBe(1);
    expect(json.t3Strikes).toBe(3);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('enraged');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('enraged');
    expect(DEV_HERO_ATTACK_LABELS.enraged).toBe('Enraged Strike');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ You strike', '▶ Foe strikes', '▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe tier II (8)', '▶ Foe medium (12)', '▶ Foe huge (40)']) {
      expect(labels).toContain(l);
    }
    for (const c of SPEC.controls) expect(`${c.label} ${c.hint ?? ''}`, c.key).not.toMatch(/[—–]/);
  });
});

describe('the plan', () => {
  it('runs on CLASSIC\'s swing times and tempo: the coil is Classic\'s windup x the tier\'s dial, the drive Classic\'s strike x its dial', () => {
    const ms = (s: number): number => (s * 1000) / CLASSIC_DEFAULTS.tempo;
    const s0 = P1.strikes[0]!;
    expect(s0.driveAt - P1.windupAt).toBeCloseTo(ms(TYPICAL_SWING.windupS) * C.t1WindupX, 6);
    expect(s0.contactAt - s0.driveAt).toBeCloseTo(ms(TYPICAL_SWING.strikeS) * C.t1DriveX, 6);
    // a longer cross-board swing (Classic scales the strike by distance) lengthens the drive with it
    const long = enragedPlan({ total: 3, leadIn: 0, swing: { ...TYPICAL_SWING, strikeS: 0.35 }, tempo: 1.15 }, C);
    expect(long.strikes[0]!.contactAt - long.strikes[0]!.driveAt).toBeGreaterThan(s0.contactAt - s0.driveAt);
  });

  it('EVERY HIT IS A FULL CYCLE (owner 2026-09-28: "let them fly back in and impact each time"): recoil, coil, drive, impact; ONE consequence; each hit harder', () => {
    for (const p of [P2, P3, P4]) {
      const n = p.strikes.length;
      expect(p.ticks).toEqual(p.strikes.slice(0, -1).map((s0) => s0.contactAt));
      expect(p.impactAt).toBe(p.strikes[n - 1]!.contactAt);
      const cues = enragedCues(p);
      expect(cues.filter((q) => q.kind === 'impact')).toHaveLength(1);
      expect(cues.filter((q) => q.kind === 'tick')).toHaveLength(n - 1);
      expect(cues.filter((q) => q.kind === 'drive')).toHaveLength(n);
      for (let i = 1; i < n; i++) {
        const s0 = p.strikes[i]!;
        expect(s0.coilAt).toBeGreaterThan(p.strikes[i - 1]!.contactAt); // the recoil comes first
        expect(s0.coilAt).toBeLessThan(s0.driveAt); // then the coil, then the drive
        expect(s0.power).toBeGreaterThan(p.strikes[i - 1]!.power); // every hit lands harder than the last
      }
      expect(p.strikes[n - 1]!.power).toBe(1);
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.at).toBeGreaterThanOrEqual(cues[i - 1]!.at);
    }
    // The recoil is a REAL pull back, not a nudge: mid-cycle the hero is at least half a windup depth off the contact.
    const g = geo();
    const s1 = P2.strikes[1]!;
    const mid = enragedPose(P2, g, C, s1.coilAt);
    expect(Math.hypot(mid.x - g.contact.x, mid.y - g.contact.y)).toBeGreaterThan(0.5 * Math.hypot(g.back.x, g.back.y));
    expect(enragedPose(P2, g, C, (P2.strikes[0]!.contactAt + s1.coilAt) / 2).squash).toBeLessThan(0); // stretched off the foe
    expect(enragedPose(P2, g, C, (s1.coilAt + s1.driveAt) / 2).squash).toBeGreaterThan(0); // squashed in the coil
  });

  it('the RAMPAGE (Tier IV) accelerates: each slam comes faster than the one before, then the haymaker', () => {
    const gap = (i: number): number => P4.strikes[i]!.driveAt - P4.strikes[i - 1]!.contactAt;
    for (let i = 2; i < P4.strikes.length - 1; i++) expect(gap(i)).toBeLessThan(gap(i - 1));
    expect(gap(P4.strikes.length - 1)).toBeGreaterThan(gap(P4.strikes.length - 2)); // the rear-back is the long breath
  });

  it('Tier II is a double strike; Tier I one hit straight to the impact', () => {
    expect(P2.ticks).toHaveLength(1);
    expect(P2.impactAt).toBe(P2.strikes[1]!.contactAt);
    expect(P1.ticks).toEqual([]);
    expect(P1.impactAt).toBe(P1.strikes[0]!.contactAt);
  });

  it('Tier IV: five slams (ticks), then the hero REARS BACK and the overhead HAYMAKER is the impact; rubble lands after', () => {
    expect(P4.haymaker).toBe(true);
    const last = P4.strikes[P4.strikes.length - 1]!;
    expect(last.haymaker).toBe(true);
    expect(P4.strikes.filter((s0) => s0.haymaker)).toHaveLength(1);
    expect(P4.rearAt).toBe(P4.strikes[P4.strikes.length - 2]!.contactAt);
    expect(last.driveAt - P4.rearAt).toBeCloseTo(C.haymakerCoilMs, 6);
    expect(P4.impactAt).toBe(last.contactAt);
    expect(P4.ticks).toHaveLength(5);
    expect(P4.booms.length).toBeGreaterThan(0);
    for (const b0 of P4.booms) expect(b0).toBeGreaterThan(P4.impactAt);
    const kinds = enragedCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'rear')).toHaveLength(1);
    expect(kinds.indexOf('rear')).toBeLessThan(kinds.lastIndexOf('drive'));
    expect(kinds.indexOf('impact')).toBeGreaterThan(kinds.lastIndexOf('tick'));
    // the owner's brief: 2.5 to 3.5 s for the whole style's own attack (the windup to the end), the knockout late in it
    expect(P4.endAt - P4.windupAt).toBeGreaterThanOrEqual(2500);
    expect(P4.endAt - P4.windupAt).toBeLessThanOrEqual(3600);
    expect(P4.impactAt - P4.windupAt).toBeGreaterThan(0.6 * (P4.endAt - P4.windupAt));
  });

  it('THE RAGE BURST fires once, at the top of the windup, just before the first drive', () => {
    for (const p of [P1, P2, P3, P4]) {
      expect(enragedCues(p).filter((q) => q.kind === 'burst')).toHaveLength(1);
      expect(p.burstAt).toBeGreaterThan(p.windupAt);
      expect(p.strikes[0]!.driveAt - p.burstAt).toBeCloseTo(C.burstMs, 6);
    }
  });

  it('every tier escalates: more shake, zoom, sparks and burst; II+ dims; all within the caps', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      expect(ps[i]!.shakePx).toBeGreaterThan(ps[i - 1]!.shakePx);
      expect(ps[i]!.zoom).toBeGreaterThanOrEqual(ps[i - 1]!.zoom);
      expect(ps[i]!.sparks).toBeGreaterThan(ps[i - 1]!.sparks);
      expect(ps[i]!.burst).toBeGreaterThan(ps[i - 1]!.burst);
    }
    expect(P2.dim).toBeGreaterThan(P1.dim);
    for (const p of ps) {
      expect(p.shakePx).toBeLessThanOrEqual(Math.min(C.shakeCap, ENRAGED_CAPS.shakePx));
      expect(p.zoom).toBeLessThanOrEqual(Math.min(C.zoomCap, ENRAGED_CAPS.zoom));
    }
  });

  it('the shipped per-tier timeline (a typical cross-board Classic swing, after the formation): windup, impact and end, ms', () => {
    const row = (p: typeof P1) => [Math.round(p.windupAt), Math.round(p.impactAt), Math.round(p.endAt)];
    expect(row(P1)).toEqual(TIMELINE[0]);
    expect(row(P2)).toEqual(TIMELINE[1]);
    expect(row(P3)).toEqual(TIMELINE[2]);
    expect(row(P4)).toEqual(TIMELINE[3]);
  });

  it('reduced motion: no strikes, shake, zoom, dim or aura; the blow still lands once, when the formation ends', () => {
    const r = plan([6, 6, 6, 6, 6, 5, 5], 40, true);
    expect(r.reduced).toBe(true);
    expect(r.strikes).toEqual([]);
    expect([r.shakePx, r.zoom, r.dim, r.aura, r.sparks]).toEqual([0, 0, 0, 0, 0]);
    expect(r.impactAt).toBe(leadInOf([6, 6, 6, 6, 6, 5, 5], true));
    expect(enragedCues(r).filter((q) => q.kind === 'impact')).toHaveLength(1);
    expect(enragedPose(r, geo(), C, r.impactAt)).toMatchObject({ x: 0, y: 0, scale: 1, rot: 0 });
  });

  it('is deterministic: the same fight plans the same beats and poses (a replay plays what the live fight did)', () => {
    expect(plan([3, 3, 3, 3, 2], 14)).toEqual(P3);
    const g = geo();
    for (let t = 0; t < P3.endAt; t += 37) expect(enragedPose(P3, g, C, t)).toEqual(enragedPose(P3, geo(), C, t));
    expect(enragedSeed(14, 1600, 'player')).toBe(enragedSeed(14, 1600, 'player'));
    expect(enragedSeed(14, 1600, 'player')).not.toBe(enragedSeed(14, 1600, 'opp'));
  });
});

/** The shipped timeline, pinned (update ON PURPOSE when the defaults move). */
const TIMELINE = [
  [2210, 2988, 3925],
  [2376, 3576, 4533],
  [2708, 4405, 5401],
  [2800, 5224, 6341],
];

describe('the hero pose (Classic\'s swing, enraged)', () => {
  it('rests until the windup; coils BACK along the line (Classic\'s direction, deeper) with the swell and the lean; trembles harder as it builds', () => {
    const g = geo();
    expect(enragedPose(P1, g, C, P1.windupAt - 1)).toMatchObject({ x: 0, y: 0, scale: 1, rot: 0, heat: 0 });
    const top = enragedPose(P1, g, C, P1.strikes[0]!.driveAt - 1);
    const u = g.u;
    expect(top.x * u.x + top.y * u.y).toBeLessThan(-0.1 * g.dist); // pulled back against the blow
    expect(top.scale).toBeGreaterThan(1.3); // Classic's 1.32 swell, plus the rage
    expect(Math.abs(top.rot)).toBeGreaterThan(5);
    expect(top.heat).toBeGreaterThan(0.95);
    const sw = classicSwing(A, D, { width: 160, height: 160 }, { width: 160, height: 160 }, 1);
    const g2 = enragedGeo(A, D, 80, 80, C, null, sw, 1);
    expect(g2.back.x).toBeCloseTo(sw.back.x * C.windupDepth, 6); // Classic's coil x the enraged depth
    expect(g2.tilt).toBeCloseTo(sw.leadTilt * C.tiltBoost, 6);
  });

  it('THE READABLE HIT (owner 2026-09-28 polish): the striker stops at the struck portrait\'s rim, never over its face (Classic keeps its own contact)', () => {
    const sw = classicSwing(A, D, { width: 160, height: 160 }, { width: 160, height: 160 }, 1);
    const g = enragedGeo(A, D, 80, 80, C, null, sw, 1);
    const at = { x: A.x + g.contact.x, y: A.y + g.contact.y };
    const fromFoe = Math.hypot(at.x - D.x, at.y - D.y);
    expect(fromFoe).toBeCloseTo(80 + 80 * C.contactStop, 6); // its centre sits outside the struck rim
    expect(fromFoe).toBeGreaterThan(80); // the struck face stays clear on the contact frame
    const classicAt = { x: A.x + sw.strike.x, y: A.y + sw.strike.y };
    expect(Math.hypot(classicAt.x - D.x, classicAt.y - D.y)).toBeLessThan(fromFoe); // Classic drives in further, unchanged
  });

  it('drives INTO the foe on every strike, squashes on contact, and pulls back between strikes', () => {
    const g = geo();
    for (const s of P3.strikes) {
      const at = enragedPose(P3, g, C, s.contactAt);
      expect(Math.hypot(at.x - g.contact.x, at.y - g.contact.y), 'lands on the contact point').toBeLessThan(1);
      expect(enragedPose(P3, g, C, s.contactAt + 30).squash).toBeGreaterThan(0.03);
    }
    const mid = enragedPose(P3, g, C, P3.strikes[1]!.driveAt - 1);
    expect(Math.hypot(mid.x - g.contact.x, mid.y - g.contact.y)).toBeGreaterThan(20);
  });

  it('the rage is SPENT on the last blow (the aura drops so the impact reads), and the hero is home and cool by the end', () => {
    const g = geo();
    expect(enragedPose(P3, g, C, P3.impactAt - 1).heat).toBe(1);
    expect(enragedPose(P3, g, C, P3.impactAt + 1).heat).toBeLessThan(0.5);
    const end = enragedPose(P3, g, C, P3.homeAt + 1);
    expect(Math.hypot(end.x, end.y)).toBeLessThan(0.5);
    expect(end.heat).toBe(0);
    expect(end.scale).toBeCloseTo(1, 3);
  });

  it('the HAYMAKER rears UP the screen and swells toward the camera, then comes DOWN on an overhead arc onto the foe', () => {
    const g = geo();
    const last = P4.strikes[P4.strikes.length - 1]!;
    const top = enragedPose(P4, g, C, last.driveAt);
    expect(top.y).toBeLessThan(-100);
    expect(top.scale).toBeGreaterThan(1.4);
    // mid-swoop it is ABOVE the straight line from the rear-back to the contact (an overhead blow, not a straight lunge)
    const mid = enragedPose(P4, g, C, (last.driveAt + last.contactAt) / 2);
    const lineY = top.y + (g.contact.y - top.y) * ((mid.x - top.x) / ((g.contact.x - top.x) || 1));
    expect(mid.y).toBeLessThan(lineY);
    const hit = enragedPose(P4, g, C, P4.impactAt);
    expect(Math.hypot(hit.x - g.contact.x, hit.y - g.contact.y)).toBeLessThan(1);
  });

  it('never pulls a hero in a corner off the screen, in either direction (the coil and the rise are shortened, never bent)', () => {
    for (const [a, d] of [[{ x: 90, y: 1000 }, D], [{ x: 1830, y: 60 }, { x: 300, y: 900 }]] as const) {
      const g = enragedGeo(a, d, 80, 80, C, FRAME);
      for (const off of [g.back, g.rear]) {
        const x = a.x + off.x, y = a.y + off.y;
        expect(x).toBeGreaterThanOrEqual(Math.min(a.x, FRAME.x0 + 80 * 1.05) - 1e-6);
        expect(x).toBeLessThanOrEqual(Math.max(a.x, FRAME.x1 - 80 * 1.05) + 1e-6);
        expect(y).toBeGreaterThanOrEqual(Math.min(a.y, FRAME.y0 + 80 * 1.05) - 1e-6);
        expect(y).toBeLessThanOrEqual(Math.max(a.y, FRAME.y1 - 80 * 1.05) + 1e-6);
      }
    }
    expect(fitInFrame({ x: 100, y: 100 }, { x: -200, y: 0 }, FRAME, 50)).toEqual({ x: -50, y: 0 });
  });
});

describe('the camera', () => {
  it('pushes in through the windup, punches in on the impact and shakes ALONG the blow within the cap; rests by the end', () => {
    const u = geo().u;
    expect(enragedCameraAt(P3, C, P3.windupAt - 1, u)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(enragedCameraAt(P3, C, P3.strikes[0]!.driveAt, u).zoom).toBeGreaterThan(1.02);
    let peak = 0;
    for (let t = P3.impactAt; t < P3.impactAt + 300; t += 4) { const cm = enragedCameraAt(P3, C, t, u); peak = Math.max(peak, Math.hypot(cm.x, cm.y)); }
    expect(peak).toBeGreaterThan(P3.shakePx * 0.5);
    expect(peak).toBeLessThanOrEqual(C.shakeCap + 1e-6);
    expect(enragedCameraAt(P3, C, P3.endAt, u).zoom).toBeCloseTo(1, 2);
    expect(enragedCameraFocus(P3, P3.windupAt, A, D)).toEqual(A);
    expect(enragedCameraFocus(P3, P3.impactAt, A, D)).toEqual(D);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroEnragedOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroEnragedOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroEnraged({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 300, y: 800 }, defender: { x: 1500, y: 200 }, defenderRadius: 80, attackerRadius: 80,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false, impactFx: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  it('THE COMBO lands the blow EXACTLY ONCE, on the LAST strike: never on a tick; the clock never stops; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.strikes).toHaveLength(3);
    expect(host.querySelector('.hblast.henraged')).not.toBeNull();
    f.tick(h.plan.windupAt + 40, 8);
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true); // the striker rides over the struck hero
    expect(h.scene!.burning).toBe(true);
    f.tick(h.plan.ticks[1]! - h.elapsed() + 8, 8);
    expect(onImpact).not.toHaveBeenCalled(); // two ticks in, no consequence yet
    expect(attackerEl.style.transform).toContain('translate(');
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    const before = h.elapsed();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed() - before).toBe(24); // no hit-stop: the clock kept running through the blow
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    expect(document.body.classList.contains('duel-attacker-player')).toBe(false);
    f.tick(5000, 16); // the embers and smoke drain, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: five slams, the rear-back, then the blow lands ONCE, on the haymaker; the shockwave, cracks and rubble follow; all within the caps', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.haymaker).toBe(true);
    f.tick(h.plan.rearAt + 100, 8);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.burning).toBe(true);
    f.tick(h.plan.impactAt - h.elapsed() + 8, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    let peakS = 0, peakM = 0;
    for (let t = 0; t < 1200; t += 16) { f.tick(16, 16); peakS = Math.max(peakS, h.scene?.liveSprites ?? 0); peakM = Math.max(peakM, h.scene?.liveMeshes ?? 0); }
    expect(peakS).toBeGreaterThan(20);
    expect(peakS).toBeLessThanOrEqual(MAX_ENRAGED_SPRITES);
    expect(peakM).toBeLessThanOrEqual(MAX_ENRAGED_MESHES);
    f.tick(h.plan.endAt + 4000, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck, the right side lifts)', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 14, 40]) {
        const a = side === 'player' ? { x: 300, y: 800 } : { x: 1500, y: 200 };
        const d = side === 'player' ? { x: 1500, y: 200 } : { x: 300, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        f.tick(h.plan.windupAt + 20, 8);
        expect(document.body.classList.contains(side === 'player' ? 'duel-attacker-player' : 'duel-attacker-opp'), `${side} ${total}`).toBe(true);
        // the hero lands on the struck hero (Classic's contact point, from the attacker's rest)
        const hit = h.pose(h.plan.impactAt);
        expect(Math.hypot(a.x + hit.x - d.x, a.y + hit.y - d.y), `${side} ${total}`).toBeLessThan(200);
        f.tick(h.plan.impactAt - h.elapsed() + 8, 8);
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        h.cancel();
        expect(document.body.className).toBe('');
      }
    }
  });

  it('slow motion stretches real time but the impact is still the same sequence beat', () => {
    const { h, f, onImpact } = run({ speed: 0.25 });
    f.tick(h.plan.impactAt * 4 - 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(60, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('a replay plays the same: the same fight plans the same strikes and moves the hero the same way', () => {
    const a = run();
    const b = run();
    expect(a.h.plan).toEqual(b.h.plan);
    for (let t = 0; t < a.h.plan.endAt; t += 50) expect(a.h.pose(t)).toEqual(b.h.pose(t));
    a.h.cancel(); b.h.cancel();
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it and puts everything back', () => {
    const a = run();
    a.f.tick(a.h.plan.windupAt + 100);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run({ total: 40 });
    b.f.tick(b.h.plan.rearAt + 50);
    b.h.cancel();
    b.f.tick(5000);
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.onDone).not.toHaveBeenCalled();
    expect(b.host.querySelector('.hblast')).toBeNull();
    expect(b.camera.style.transform).toBe('');
    expect(b.attackerEl.style.transform).toBe('');
    expect(b.defenderEl.style.transform).toBe('');
    expect(document.body.className).toBe('');
    expect(b.root.children).toHaveLength(0);
  });

  it('reduced motion: no Pixi layer, no camera or portrait move, no lift, just fades; the blow lands once', () => {
    const { h, f, root, onImpact, camera, host, defenderEl, attackerEl } = run({ reduced: true, total: 40, formation: formationOf([40], 40) });
    expect(root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(document.body.className).toBe('');
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('40');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const h = playHeroEnraged({
        formation: formationOf([25], 25), total: 25, attacker: { x: 0, y: 500 }, defender: { x: 800, y: 500 },
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false, impactFx: false,
        mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  const path = (p: ReturnType<typeof plan>): ((t: number) => HeroAt) => {
    const g = geo();
    return (t) => { const q = enragedPose(p, g, C, t); return { x: A.x + q.x, y: A.y + q.y, s: q.scale, heat: q.heat }; };
  };

  it('a whole Tier IV stays in the caps and drains; destroy leaves nothing', () => {
    const s = new HeroEnragedScene(TEX, COLORS, LOOK, 1, 42);
    s.setHero(path(P4), 80, null);
    let peak = 0, peakM = 0;
    let t = P4.windupAt;
    s.follow(t);
    s.startWindup(P4.aura, 20, P4.strikes[0]!.driveAt - P4.windupAt);
    s.rear();
    const s0 = P4.strikes[0]!;
    for (; t < s0.driveAt; t += 16) { s.follow(t); s.update(16); peak = Math.max(peak, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes); }
    expect(s.burning).toBe(true);
    s.drive({ x: A.x, y: A.y }, geo().u, 1000, 10, true);
    for (; t < s0.contactAt; t += 8) { s.follow(t); s.update(8); peak = Math.max(peak, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes); }
    s.impact(D.x, D.y, geo().u, 80, { k: 1, burst: 1.75, sparks: 46, embers: 40, slashes: 2, flashAlpha: 0.95, haymaker: true, smoulderMs: 1200, screen: 2200 });
    for (const [i, at] of P4.booms.entries()) { void at; s.boom(D.x + 40 * i, D.y, 1 + 0.1 * i); }
    s.recover();
    for (; t < P4.endAt + 3000; t += 16) { s.follow(t); peak = Math.max(peak, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes); if (!s.update(16) && t > P4.endAt) break; }
    expect(peak).toBeGreaterThan(50);
    expect(peak).toBeLessThanOrEqual(MAX_ENRAGED_SPRITES);
    expect(peakM).toBeLessThanOrEqual(MAX_ENRAGED_MESHES);
    expect(s.update(16)).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('the new beats (burst, ground scorch, rim cracks, ember storm) stay in the caps and drain to nothing', () => {
    const s = new HeroEnragedScene(TEX, COLORS, LOOK, 1, 11);
    s.setHero(path(P4), 80, null);
    s.follow(P4.windupAt);
    s.startWindup(1, 10, 600);
    s.rear();
    s.coil(A.x, A.y, 80, 0.6);
    s.burst(A.x, A.y, 80, 1.35);
    s.drive(A, geo().u, 1000, 8, true);
    let t = P4.strikes[0]!.driveAt;
    for (; t < P4.impactAt; t += 16) { s.follow(t); s.update(16); }
    s.impact(D.x, D.y, geo().u, 80, { k: 1, burst: 1.75, sparks: 50, embers: 44, slashes: 2, flashAlpha: 0.95, haymaker: true, smoulderMs: 1200, screen: 2200, into: { x: -0.7, y: 0.7 } });
    let peak = 0, peakM = 0;
    for (; t < P4.endAt + 4000; t += 16) { s.follow(t); peak = Math.max(peak, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes); if (!s.update(16) && t > P4.endAt) break; }
    expect(peak).toBeLessThanOrEqual(MAX_ENRAGED_SPRITES);
    expect(peakM).toBeLessThanOrEqual(MAX_ENRAGED_MESHES);
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    s.destroy();
  });

  it('AFTERIMAGES: only a dash stamps them, never the coil; at most the tuned few; evenly spaced along the dash, newest strongest', () => {
    const s = new HeroEnragedScene(TEX, COLORS, LOOK, 1, 7);
    s.setHero(path(P1), 80, null);
    let t = P1.windupAt;
    s.startWindup(1, 10, 500);
    for (; t < P1.strikes[0]!.driveAt; t += 16) { s.follow(t); s.update(16); }
    expect(s.liveGhosts).toBe(0); // the coil (and its tremble) never leaves ghosts
    s.drive({ x: A.x, y: A.y }, geo().u, 1000, 0, false);
    let most = 0;
    for (; t < P1.strikes[0]!.contactAt; t += 16) { s.follow(t); s.update(16); most = Math.max(most, s.liveGhosts); }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(LOOK.ghosts);
    expect(LOOK.ghosts).toBeLessThanOrEqual(MAX_GHOSTS);
    s.destroy();
  });

  it('draws finite geometry every frame (no NaN from the windup to the smoulder)', () => {
    const s = new HeroEnragedScene(TEX, COLORS, LOOK, 1, 3);
    s.setHero(path(P3), 80, null);
    s.startWindup(1, 10, 600);
    for (let t = P3.windupAt; t < P3.endAt; t += 16) {
      if (P3.strikes.some((q) => Math.abs(q.driveAt - t) < 8)) s.drive(A, geo().u, 1000, 6, false);
      if (P3.ticks.some((q) => Math.abs(q - t) < 8)) s.tick(D.x, D.y, geo().u, 80, 0, 0.66);
      if (Math.abs(P3.impactAt - t) < 8) s.impact(D.x, D.y, geo().u, 80, { k: 0.66, burst: 1.25, sparks: 30, embers: 18, slashes: 2, flashAlpha: 0.95, haymaker: false, smoulderMs: 1200, screen: 2200 });
      s.follow(t);
      s.update(16);
      for (const layer of s.root.children) for (const ch of (layer as Container).children) {
        expect(Number.isFinite(ch.x) && Number.isFinite(ch.y) && Number.isFinite(ch.rotation) && Number.isFinite(ch.scale.x) && Number.isFinite(ch.alpha)).toBe(true);
      }
    }
    s.destroy();
  });

  it('clear() drops everything in flight at once; the pool is reused, not regrown', () => {
    const s = new HeroEnragedScene(TEX, COLORS, LOOK, 1, 9);
    s.setHero(path(P3), 80, null);
    s.follow(P3.windupAt);
    s.startWindup(1, 10, 600);
    s.impact(D.x, D.y, geo().u, 80, { k: 0.66, burst: 1.25, sparks: 30, embers: 18, slashes: 2, flashAlpha: 0.95, haymaker: false, smoulderMs: 0, screen: 2200 });
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.update(16)).toBe(false);
    s.impact(D.x, D.y, geo().u, 80, { k: 0.66, burst: 1.25, sparks: 30, embers: 18, slashes: 2, flashAlpha: 0.95, haymaker: false, smoulderMs: 0, screen: 2200 });
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 10);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Enraged Strike (attack_enraged) is a Legendary crate hero attack that plays Enraged; the dev override can force it; the others unchanged', () => {
    expect(COSMETIC_INDEX.attack_enraged).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Enraged Strike', assets: { style: 'enraged' }, active: true, acquisition: { type: 'crate' } });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy']); // Enraged Strike, Poison Darts, Frost, then Consecration (holy) joined 2026-09-28
    expect(styleOfCosmetic('attack_enraged')).toBe('enraged');
    for (const [id, style] of [['attack_blast', 'blast'], ['attack_quake', 'quake'], ['attack_arcana', 'arcana'], ['attack_blades', 'blades']] as const) expect(styleOfCosmetic(id)).toBe(style);
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_enraged' })).toBe('enraged');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'enraged' })).toBe('enraged');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_enraged' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_enraged_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
