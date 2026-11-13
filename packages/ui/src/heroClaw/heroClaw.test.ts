// @vitest-environment jsdom
/**
 * THE GRABBY CLAW, an EPIC hero attack (dev-only, no cosmetic yet): an arcade claw machine claw picks the STRUCK
 * portrait up. The shared four damage tiers map to THREE looks (I Fumble, II and III Shake, IV Prize; a knockout plays
 * Prize). Covered here: the looks; the tuner; the pure plan and its cues (one impact, per look, lifted and pulled out);
 * the pure geometry (the claw, the pull out and the chute stay in view, from either end of the board); the pure pose
 * (the portrait only moves in the grip and is EXACTLY at rest from `homeAt`; no jumps; the prongs open and close); the
 * camera; the runner on the shared clock (the blow lands exactly ONCE; both directions; replay; finish / cancel / the
 * safety timer; every exit restores the struck portrait's transform, opacity and z-order class); and the headless scene
 * (bounded, drains, destroy leaves nothing).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import {
  CLAW_CAPS, HERO_CLAW_CLIP_KEYS, HERO_CLAW_COLOR_KEYS, HERO_CLAW_DEFAULTS, HERO_CLAW_RANGES, blankPose, clawCameraAt, clawCameraFocus, clawCramped, clawCues,
  clawGeo, clawLevel, clawPlan, clawPose, clampHeroClawValue, heroClawConfigJson, operatorAt, sanitizeHeroClawConfig,
  type ClawPlan, type HeroClawConfig, type HeroClawNumKey,
} from './heroClawConfig';
import { HeroClawScene, MAX_CLAW_SPRITES, PRONG_OPEN_RAD, type HeroClawTextures } from './heroClawScene';
import { clawSeed, playHeroClaw, type HeroClawOptions } from './heroClaw';
import { SPEC } from '../HeroClawTuner';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroClawTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  cable: W, hub: W, prong: W, finger: W, chute: W, winner: W, coin: W,
};
const C = HERO_CLAW_DEFAULTS;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
/** The two real sockets on a 1080p board: the opponent's against the top right, yours at the bottom left. */
const TOP = { x: 1773, y: 161 }, BOT = { x: 150, y: 840 };
const R = 130;
const plan = (values: number[], total: number, cramped = false, reduced = false, knockout = false): ClawPlan =>
  clawPlan({ total, cramped, reduced, knockout, leadIn: leadInOf(values, reduced) }, C);
const V1 = [2, 1], V2 = [3, 3, 2], V4 = [6, 6, 6, 6, 6, 5, 5];
/** Every look, lifted (struck at the bottom) and pulled out (struck at the top). */
const CASES = [
  { name: 'fumble, lifted', p: plan(V1, 3), a: TOP, d: BOT },
  { name: 'shake, lifted', p: plan(V2, 8), a: TOP, d: BOT },
  { name: 'prize, lifted', p: plan(V4, 40), a: TOP, d: BOT },
  { name: 'fumble, pulled out', p: plan(V1, 3, true), a: BOT, d: TOP },
  { name: 'shake, pulled out', p: plan(V2, 8, true), a: BOT, d: TOP },
  { name: 'prize, pulled out', p: plan(V4, 40, true), a: BOT, d: TOP },
].map((k) => ({ ...k, g: clawGeo(k.p, k.a, k.d, R, FRAME, C) }));

describe('the three looks (an Epic maps the shared four tiers onto three)', () => {
  it('reads the SHARED tier (thresholds 6 / 12 / 20) and maps I fumble, II and III shake, IV prize', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    expect([1, 2, 3, 4].map((t) => clawLevel(t as 1 | 2 | 3 | 4))).toEqual([1, 2, 2, 3]);
    for (let d = 0; d <= 60; d++) {
      const p = plan([d], d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level).toBe(clawLevel(tierOf(d)));
    }
  });

  it('a knockout always plays Prize, whatever the number', () => {
    const ko = plan(V1, 3, false, false, true);
    expect(ko.tier).toBe(4);
    expect(ko.level).toBe(3);
  });

  it('the style is registered, dev-only', () => {
    expect(HERO_ATTACK_STYLES).toContain('claw');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('claw');
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_CLAW_RANGES)) {
      const v = C[k as HeroClawNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of HERO_CLAW_COLOR_KEYS) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroClawValue('shakes', 99)).toBe(6);
    expect(clampHeroClawValue('clawSize', -3)).toBe(0.6);
    expect(clampHeroClawValue('carryMs', Number.NaN)).toBe(C.carryMs);
    expect(clampHeroClawValue('carryMs', 'abc')).toBe(C.carryMs);
    expect(clampHeroClawValue('carryMs', '300')).toBe(300);
    expect(clampHeroClawValue('colorCoin', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroClawValue('colorPlayer', 'gold')).toBe(C.colorPlayer);
    expect(clampHeroClawValue('sfxServoClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroClawValue('nope' as keyof HeroClawConfig, 1)).toBeUndefined();
    const s = sanitizeHeroClawConfig({ v3Sparks: 400, colorCoin: 'x', bogus: 3 });
    expect(s.v3Sparks).toBe(60);
    expect(s.colorCoin).toBe(C.colorCoin);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroClawConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; buttons on top, one per look each way', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroClawConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.shakes).toBe(3);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('claw');
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Fumble (3)', '▶ Shake (8)', '▶ Prize (40)', '▶ Foe fumble (3)', '▶ Foe prize (40)']) expect(labels).toContain(l);
    expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
  });

  it('its own three clips are the ones registered for it, and every fx clip a default names is in that list', () => {
    expect(ATTACK_FX_CLIPS.claw).toEqual(['fx/claw-chute', 'fx/claw-clamp', 'fx/claw-servo']);
    for (const k of HERO_CLAW_CLIP_KEYS) if (C[k].startsWith('fx/')) expect(ATTACK_FX_CLIPS.claw, k).toContain(C[k]);
  });
});

describe('the plan', () => {
  it('every look runs in order: in, hover, drop, clamp, grab, lift, let go, THE impact, home, end', () => {
    for (const { name, p } of CASES) {
      const order = [p.chargeAt, p.hoverAt, p.dropAt, p.clampAt, p.grabAt, p.liftEnd, p.releaseAt, p.impactAt, p.homeAt, p.endAt];
      for (let i = 1; i < order.length; i++) expect(order[i]!, `${name} beat ${i}`).toBeGreaterThanOrEqual(order[i - 1]!);
      expect(p.impactAt, name).toBeGreaterThan(p.releaseAt);
      expect(p.heldTo, name).toBeLessThanOrEqual(p.impactAt);
      // The claw is gone and the portrait is home before the sequence ends.
      expect(p.leaveAt + p.leaveMs, name).toBeLessThanOrEqual(p.endAt);
      expect(p.homeAt, name).toBeLessThanOrEqual(p.endAt);
    }
  });

  it('FUMBLE: no shakes, no carry; the grip rattles, then the drop is the impact', () => {
    const p = plan(V1, 3);
    expect(p.shakes).toEqual([]);
    expect(p.carryEnd).toBe(p.carryAt);
    expect(p.releaseAt - p.liftEnd).toBe(C.fumbleMs);
    expect(p.heldTo).toBe(p.releaseAt);
    expect(p.impactAt - p.releaseAt).toBe(C.v1FallMs);
    expect(p.returnAt).toBe(p.impactAt);
    expect(p.coins).toBe(0);
  });

  it('SHAKE: three hard shakes, evenly spaced, all before the claw lets go; coins fall on each', () => {
    const p = plan(V2, 8);
    expect(p.shakes).toHaveLength(3);
    expect(p.shakes[1]! - p.shakes[0]!).toBe(C.shakeMs);
    expect(p.shakes[0]!).toBeGreaterThan(p.liftEnd);
    expect(p.shakes[2]!).toBeLessThan(p.releaseAt);
    expect(p.coins).toBe(C.coins);
    expect(p.lift).toBeGreaterThan(plan(V1, 3).lift);
  });

  it('PRIZE: carried, held over the chute a beat, dropped in (the impact), gone, then popped back home', () => {
    const p = plan(V4, 40);
    expect(p.carryEnd - p.carryAt).toBe(C.carryMs);
    expect(p.releaseAt - p.carryEnd).toBe(C.holdMs);
    expect(p.returnAt - p.impactAt).toBe(C.returnMs);
    expect(p.homeAt - p.returnAt).toBe(C.popMs);
    expect(p.heldTo).toBe(p.releaseAt);
  });

  it('NO HEADROOM: the claw takes a beat longer to show itself; Fumble and Shake hold the portrait right up to the impact (it is yanked home); Prize lets go as usual', () => {
    for (const [v, total] of [[V1, 3], [V2, 8], [V4, 40]] as const) {
      const lift = plan([...v], total), pull = plan([...v], total, true);
      expect(pull.pull).toBe(true);
      expect(pull.hoverAt - lift.hoverAt).toBe(C.peekMs);
      if (pull.level === 3) expect(pull.heldTo).toBe(pull.releaseAt);
      else { expect(pull.heldTo).toBe(pull.impactAt); expect(pull.leaveAt).toBe(pull.impactAt); }
    }
  });

  it('exactly one impact cue and one end; the release precedes the impact; the Prize has its chute, win and return beats', () => {
    for (const { name, p } of CASES) {
      const cues = clawCues(p);
      expect(cues.filter((q) => q.kind === 'impact'), name).toHaveLength(1);
      expect(cues[cues.length - 1]!.kind, name).toBe('end');
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.at, name).toBeGreaterThanOrEqual(cues[i - 1]!.at);
      expect(cues.findIndex((q) => q.kind === 'release'), name).toBeLessThan(cues.findIndex((q) => q.kind === 'impact'));
      expect(cues.filter((q) => q.kind === 'shake'), name).toHaveLength(p.level === 2 ? 3 : 0);
      expect(cues.some((q) => q.kind === 'chute') && cues.some((q) => q.kind === 'win') && cues.some((q) => q.kind === 'return'), name).toBe(p.level === 3);
      expect(cues.some((q) => q.kind === 'slip'), name).toBe(p.level === 1);
    }
  });

  it('an Epic length: about 1.6 s fumble, 2.2 s shake, 3 s prize from the charge (a little longer pulled out)', () => {
    const len = (p: ClawPlan): number => p.endAt - p.chargeAt;
    expect(len(plan(V1, 3))).toBeGreaterThan(1200); expect(len(plan(V1, 3))).toBeLessThan(1900);
    expect(len(plan(V2, 8))).toBeGreaterThan(1800); expect(len(plan(V2, 8))).toBeLessThan(2500);
    expect(len(plan(V4, 40))).toBeGreaterThan(2400); expect(len(plan(V4, 40))).toBeLessThan(3200);
    for (const [v, total] of [[V1, 3], [V2, 8], [V4, 40]] as const) expect(len(plan([...v], total, true)) - len(plan([...v], total))).toBeLessThan(260);
  });

  it('every look escalates, the caps always hold, and no plan carries a hit-stop', () => {
    const [a, b, c] = [plan(V1, 3), plan(V2, 8), plan(V4, 40)];
    expect(b.shakePx).toBeGreaterThan(a.shakePx); expect(c.shakePx).toBeGreaterThan(b.shakePx);
    expect(c.zoom).toBeGreaterThan(a.zoom); expect(c.dim).toBeGreaterThan(b.dim);
    const wild = clawPlan({ total: 8 }, { ...C, shakes: 99, coins: 99, v2Shake: 999, v2Zoom: 9, v2Sparks: 999 });
    expect(wild.shakes.length).toBe(CLAW_CAPS.shakes);
    expect(wild.coins).toBe(CLAW_CAPS.coins);
    expect(wild.shakePx).toBe(CLAW_CAPS.shakePx);
    expect(wild.zoom).toBe(CLAW_CAPS.zoom);
    expect(wild.sparks).toBe(CLAW_CAPS.sparks);
    expect(Object.keys(a).join(' ')).not.toMatch(/hitStop|slamStop/i);
  });

  it('reduced motion: nothing but the blow, landing where the formation ends', () => {
    const p = plan(V4, 40, true, true);
    expect(p.reduced).toBe(true);
    expect(p.impactAt).toBe(leadInOf(V4, true));
    expect(p.shakePx + p.zoom + p.dim + p.sparks).toBe(0);
    expect(clawCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
  });

  it('is deterministic (a replay plays what the live fight did)', () => {
    expect(plan(V2, 8, true)).toEqual(plan(V2, 8, true));
    expect(clawSeed(8, 1600, 'opp')).toBe(clawSeed(8, 1600, 'opp'));
    expect(clawSeed(8, 1600, 'opp')).not.toBe(clawSeed(8, 1600, 'player'));
  });
});

describe('the geometry', () => {
  it('knows which socket has no headroom: the one against the top edge is pulled out, the one at the bottom is lifted', () => {
    expect(clawCramped(TOP, R, FRAME, C)).toBe(true);
    expect(clawCramped(BOT, R, FRAME, C)).toBe(false);
    expect(clawCramped({ x: 900, y: 420 }, R, FRAME, C)).toBe(false);
  });

  it('the claw always comes from above the view, and clamps with its hub straight over the portrait', () => {
    for (const { name, g, d } of CASES) {
      expect(g.enter.y, name).toBeLessThan(FRAME.y0 - R);
      expect(g.topY, name).toBeLessThan(FRAME.y0);
      expect(g.grab).toEqual({ x: d.x, y: d.y - R * C.hubOff });
      expect(g.hover.x, name).toBe(d.x);
      expect(g.hover.y, name).toBeLessThan(g.grab.y);
    }
  });

  it('LIFTED: straight up, higher on the bigger looks, the whole hub in view', () => {
    const [f, s] = [CASES[0]!.g, CASES[1]!.g];
    expect(f.show.x).toBe(BOT.x);
    expect(f.grab.y - f.show.y).toBeCloseTo(R * C.v1Lift, 5);
    expect(s.grab.y - s.show.y).toBeCloseTo(R * C.v2Lift, 5);
    for (const k of CASES.slice(0, 3)) expect(k.g.show.y - R * 0.5, k.name).toBeGreaterThan(FRAME.y0);
    // A socket with only a little room is lifted only as far as the hub stays in view.
    const tight = clawGeo(plan(V2, 8), TOP, { x: 900, y: 330 }, R, FRAME, C);
    expect(tight.show.y - R * 0.5).toBeGreaterThanOrEqual(FRAME.y0 - 1e-6);
    expect(tight.grab.y - tight.show.y).toBeLessThan(R * C.v2Lift);
  });

  it('PULLED OUT: down and toward the middle, far enough that the whole hub and some cable show; it shows itself in the open first', () => {
    for (const k of CASES.slice(3)) {
      const { g, name } = k;
      expect(g.show.y, name).toBeGreaterThan(g.grab.y);
      expect(g.show.x, name).toBeLessThan(TOP.x);
      expect(g.show.y - R * 0.5, name).toBeGreaterThan(FRAME.y0 + R * 0.3);
      expect(g.pre.y - R * 0.5, name).toBeGreaterThan(FRAME.y0);
      expect(g.pre.x, name).toBeLessThan(TOP.x - R);
      // The held portrait is whole and in view there.
      expect(g.show.x + R, name).toBeLessThan(FRAME.x1);
      expect(g.show.y + g.hubOff + R, name).toBeLessThan(FRAME.y1);
    }
    // Mirrored for a socket in the top LEFT corner: it comes out to the right.
    const left = clawGeo(plan(V2, 8, true), BOT, { x: 150, y: 161 }, R, FRAME, C);
    expect(left.show.x).toBeGreaterThan(150);
  });

  it('the CHUTE stands inside the view on the roomier side, under where the portrait hangs, at least half of it showing', () => {
    for (const k of [CASES[2]!, CASES[5]!]) {
      const { g, name, d } = k;
      const ch = g.chute!;
      expect(ch.x - ch.w / 2, name).toBeGreaterThanOrEqual(FRAME.x0);
      expect(ch.x + ch.w / 2, name).toBeLessThanOrEqual(FRAME.x1);
      expect(ch.y + ch.h / 2, name).toBeLessThanOrEqual(FRAME.y1 + 1e-6);
      expect(ch.y, name).toBeGreaterThan(g.show.y + g.hubOff + R);
      expect(Math.sign(g.carry), name).toBe(d.x < 960 ? 1 : -1);
      expect(Math.abs(g.carry), name).toBeGreaterThan(R * 2);
      expect(ch.x, name).toBeCloseTo(g.show.x + g.carry, 5);
      // It ends up inside the chute, below the mouth.
      expect(d.y + g.sinkY, name).toBeGreaterThan(ch.y);
      expect(d.x + g.sinkX, name).toBeCloseTo(ch.x, 5);
    }
    for (const k of CASES) if (k.p.level !== 3) expect(k.g.chute, k.name).toBeNull();
  });

  it('a small sandbox box still lays out inside itself', () => {
    const box = { x0: 0, y0: 0, x1: 400, y1: 300 };
    for (const d of [{ x: 320, y: 60 }, { x: 80, y: 240 }]) {
      const p = plan(V4, 40, clawCramped(d, 34, box, C));
      const g = clawGeo(p, { x: 200, y: 150 }, d, 34, box, C);
      expect(g.chute!.x - g.chute!.w / 2).toBeGreaterThanOrEqual(0);
      expect(g.chute!.x + g.chute!.w / 2).toBeLessThanOrEqual(400);
      expect(Number.isFinite(g.show.x + g.show.y + g.sinkY)).toBe(true);
    }
  });
});

describe('the pose (the claw and the struck portrait, from one clock)', () => {
  const rest = (q: { px: number; py: number; prot: number; psx: number; psy: number; palpha: number }): boolean =>
    q.px === 0 && q.py === 0 && q.prot === 0 && q.psx === 1 && q.psy === 1 && q.palpha === 1;

  it('the portrait does not move before the prongs close on it, and is EXACTLY at rest from homeAt on', () => {
    for (const { name, p, g } of CASES) {
      for (let t = 0; t < p.clampAt; t += 7) expect(rest(clawPose(p, g, C, t)), `${name} t=${t}`).toBe(true);
      for (let t = p.homeAt; t <= p.endAt + 600; t += 7) expect(rest(clawPose(p, g, C, t)), `${name} t=${t}`).toBe(true);
      expect(rest(clawPose(p, g, C, 1e7)), name).toBe(true);
    }
  });

  it('the prongs are OPEN coming in, CLOSE on the portrait, stay shut while it is carried, and spring open to let go', () => {
    for (const { name, p, g } of CASES) {
      expect(clawPose(p, g, C, p.dropAt).open, name).toBe(1);
      expect(clawPose(p, g, C, (p.clampAt + p.grabAt) / 2).open, name).toBeLessThan(0.5);
      expect(clawPose(p, g, C, p.grabAt + 1).open, name).toBe(0);
      expect(clawPose(p, g, C, (p.grabAt + p.liftEnd) / 2).open, name).toBe(0);
      expect(clawPose(p, g, C, p.heldTo + 160).open, name).toBeGreaterThan(0.9);
      // It snips once on the way in.
      let least = 1;
      for (let t = p.chargeAt; t < p.hoverAt; t += 4) least = Math.min(least, clawPose(p, g, C, t).open);
      expect(least, name).toBeLessThan(0.6);
    }
  });

  it('while held, the portrait hangs exactly one hub-offset below the hub (plus any slip), turned with the claw, squeezed', () => {
    for (const { name, p, g } of CASES) {
      let moved = 0;
      for (let t = p.grabAt + 1; t < p.heldTo; t += 5) {
        const q = clawPose(p, g, C, t);
        expect(q.held, name).toBe(true);
        expect(q.calpha, name).toBe(1);
        const dist = Math.hypot(g.d.x + q.px - q.hx, g.d.y + q.py - q.hy);
        expect(dist, `${name} t=${t}`).toBeGreaterThanOrEqual(g.hubOff - 1e-6);
        expect(dist, `${name} t=${t}`).toBeLessThanOrEqual(g.hubOff + R * 0.41);
        expect(q.prot, name).toBe(q.crot);
        expect(q.psx, name).toBeLessThanOrEqual(1);
        moved = Math.max(moved, Math.hypot(q.px, q.py));
      }
      expect(moved, `${name}: it is really picked up`).toBeGreaterThan(R * 0.4);
    }
  });

  it('LIFTED Fumble and Shake: up, then a fall straight back onto the socket; the Shake swings it side to side three times', () => {
    const { p, g } = CASES[1]!;
    const top = clawPose(p, g, C, p.liftEnd);
    expect(top.py).toBeCloseTo(-(g.grab.y - g.show.y), 3);
    let flips = 0, last = 0;
    for (let t = p.shakeFrom; t < p.shakeTo; t += 3) {
      const x = clawPose(p, g, C, t).px;
      if (Math.abs(x) > R * 0.15 && Math.sign(x) !== last) { if (last !== 0) flips++; last = Math.sign(x); }
    }
    expect(flips).toBe(C.shakes * 2 - 1);
    const mid = clawPose(p, g, C, (p.releaseAt + p.impactAt) / 2);
    expect(mid.held).toBe(false);
    expect(mid.py).toBeLessThan(0);
    const land = clawPose(p, g, C, p.impactAt);
    expect(Math.abs(land.px) + Math.abs(land.py)).toBeLessThan(0.5);
    // It bounces UP off the socket (never through it).
    for (let t = p.impactAt; t < p.homeAt; t += 5) expect(clawPose(p, g, C, t).py).toBeLessThanOrEqual(1e-9);
  });

  it('PULLED OUT Fumble and Shake: out and down into the open, then yanked back up; the socket catches it exactly, and it rebounds DOWN', () => {
    for (const { name, p, g } of CASES.slice(3, 5)) {
      const out = clawPose(p, g, C, p.liftEnd);
      expect(out.py, name).toBeGreaterThan(R);
      expect(out.px, name).toBeLessThan(0);
      const before = clawPose(p, g, C, p.impactAt - 1);
      expect(before.held, name).toBe(true);
      expect(Math.hypot(before.px, before.py), name).toBeLessThan(R * 0.1);
      const at = clawPose(p, g, C, p.impactAt);
      expect(Math.abs(at.px) + Math.abs(at.py), name).toBeLessThan(0.5);
      for (let t = p.impactAt; t < p.homeAt; t += 5) expect(clawPose(p, g, C, t).py, name).toBeGreaterThanOrEqual(-1e-9);
      // The claw runs on up and is gone.
      expect(clawPose(p, g, C, p.leaveAt + p.leaveMs).calpha, name).toBe(0);
    }
  });

  it('PRIZE: carried over the chute, dropped in shrinking and fading, GONE until the return, then pops back in its own socket', () => {
    for (const { name, p, g } of [CASES[2]!, CASES[5]!]) {
      const over = clawPose(p, g, C, p.releaseAt - 1);
      expect(g.d.x + over.px, name).toBeCloseTo(g.chute!.x, -1);
      expect(g.d.y + over.py + R, name).toBeLessThan(g.chute!.y + 1);
      const falling = clawPose(p, g, C, p.releaseAt + (p.impactAt - p.releaseAt) * 0.8);
      expect(falling.psx, name).toBeLessThan(0.75);
      expect(falling.palpha, name).toBeLessThan(0.6);
      for (let t = p.impactAt; t < p.returnAt; t += 9) expect(clawPose(p, g, C, t).palpha, name).toBe(0);
      const pop = clawPose(p, g, C, p.returnAt + (p.homeAt - p.returnAt) * 0.6);
      expect(pop.px, name).toBe(0); expect(pop.py, name).toBe(0);
      expect(pop.palpha, name).toBe(1);
      expect(pop.psx, name).toBeGreaterThan(0.9);
      // The chute is up before the portrait arrives and down again by the end; the sign only shows after the impact.
      expect(clawPose(p, g, C, p.grabAt - 1).chute, name).toBe(0);
      expect(clawPose(p, g, C, p.carryEnd).chute, name).toBeGreaterThan(0.95);
      expect(clawPose(p, g, C, p.impactAt - 1).winAlpha, name).toBe(0);
      expect(clawPose(p, g, C, p.impactAt + 300).winAlpha, name).toBeGreaterThan(0.5);
      expect(clawPose(p, g, C, p.endAt).chute, name).toBe(0);
      expect(clawPose(p, g, C, p.endAt).winAlpha, name).toBe(0);
    }
  });

  it('nothing jumps: the visible portrait and the claw move smoothly frame to frame, and everything stays finite', () => {
    for (const { name, p, g } of CASES) {
      let prev = clawPose(p, g, C, p.chargeAt);
      for (let t = p.chargeAt + 4; t <= p.endAt; t += 4) {
        const q = clawPose(p, g, C, t);
        for (const v of Object.values(q)) if (typeof v === 'number') expect(Number.isFinite(v), `${name} t=${t}`).toBe(true);
        if (q.palpha > 0 && prev.palpha > 0) expect(Math.hypot(q.px - prev.px, q.py - prev.py), `${name} portrait t=${t}`).toBeLessThan(R * 0.22);
        if (q.calpha > 0 && prev.calpha > 0) expect(Math.hypot(q.hx - prev.hx, q.hy - prev.hy), `${name} claw t=${t}`).toBeLessThan(R * 0.45);
        prev = q;
      }
    }
  });

  it('the visible portrait stays in view the whole time (it may dip behind the chute at the bottom edge)', () => {
    for (const { name, p, g } of CASES) {
      for (let t = p.chargeAt; t <= p.endAt; t += 6) {
        const q = clawPose(p, g, C, t);
        if (q.palpha < 0.5) continue;
        const x = g.d.x + q.px, y = g.d.y + q.py;
        expect(x, `${name} t=${t}`).toBeGreaterThan(FRAME.x0); expect(x, `${name} t=${t}`).toBeLessThan(FRAME.x1);
        expect(y, `${name} t=${t}`).toBeGreaterThan(FRAME.y0); expect(y, `${name} t=${t}`).toBeLessThan(FRAME.y1);
      }
    }
  });

  it('refills the object it is handed (no allocation per frame) and is a pure function of time', () => {
    const { p, g } = CASES[4]!;
    const out = blankPose();
    expect(clawPose(p, g, C, p.liftEnd, out)).toBe(out);
    const a = { ...clawPose(p, g, C, p.shakes[1]!, out) };
    clawPose(p, g, C, p.endAt, out);
    expect({ ...clawPose(p, g, C, p.shakes[1]!, out) }).toEqual(a);
  });

  it('the operator leans, presses and hops a little, and is at rest outside those beats', () => {
    const { p, g } = CASES[0]!;
    const o = { x: 0, y: 0, sx: 1, sy: 1 };
    operatorAt(p, g, C, p.chargeAt - 1, o); expect(o).toEqual({ x: 0, y: 0, sx: 1, sy: 1 });
    operatorAt(p, g, C, (p.chargeAt + p.hoverAt) / 2, o); expect(Math.abs(o.x)).toBeGreaterThan(C.heroLeanPx * 0.8);
    operatorAt(p, g, C, p.impactAt + 150, o); expect(o.y).toBeLessThan(-C.heroLeanPx * 0.5);
    operatorAt(p, g, C, p.impactAt + 300, o); expect(o).toEqual({ x: 0, y: 0, sx: 1, sy: 1 });
  });
});

describe('the camera', () => {
  it('pushes in gently through the lift, punches on the impact, and rests by the end', () => {
    for (const { name, p } of CASES) {
      expect(clawCameraAt(p, C, p.chargeAt + 10).zoom, name).toBe(1);
      expect(clawCameraAt(p, C, p.liftEnd).zoom, name).toBeCloseTo(1 + p.zoom, 5);
      const hit = clawCameraAt(p, C, p.impactAt);
      expect(hit.zoom, name).toBeCloseTo(1 + p.zoom + p.punch, 5);
      expect(hit.zoom, name).toBeLessThanOrEqual(1 + CLAW_CAPS.zoom + 0.1);
      const end = clawCameraAt(p, C, p.endAt);
      expect(end.zoom, name).toBeLessThan(1.005);
      expect(Math.abs(end.x) + Math.abs(end.y), name).toBeLessThan(0.6);
    }
  });

  it('the impact shakes along the blow: DOWN for a drop, UP when the portrait is yanked home', () => {
    expect(clawCameraAt(CASES[1]!.p, C, CASES[1]!.p.impactAt).y).toBeGreaterThan(0);
    expect(clawCameraAt(CASES[4]!.p, C, CASES[4]!.p.impactAt).y).toBeLessThan(0);
  });

  it('anchors on the socket; on the Prize it eases halfway to the chute and back', () => {
    const o = { x: 0, y: 0 };
    const { p, g } = CASES[0]!;
    expect(clawCameraFocus(p, g, p.liftEnd, o)).toEqual(g.d);
    const z = CASES[5]!;
    expect(clawCameraFocus(z.p, z.g, z.p.carryEnd, o).x).toBeCloseTo(z.g.d.x + z.g.sinkX * 0.5, 5);
    expect(clawCameraFocus(z.p, z.g, z.p.homeAt, o).x).toBeCloseTo(z.g.d.x, 5);
    expect(clawCameraAt(plan(V4, 40, true, true), C, 500)).toEqual({ zoom: 1, x: 0, y: 0 });
  });
});

function manualFrames(): { frames: HeroClawOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

/** jsdom's window is 1024 x 768: the opponent's socket against the top right, yours at the bottom left. */
const J_TOP = { x: 930, y: 80 }, J_BOT = { x: 90, y: 640 };
const JR = 60;

function run(side: 'player' | 'opp', total: number, over: Partial<HeroClawOptions> = {}, inCamera = true) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  defenderEl.style.transform = 'rotate(1deg)'; // a resting transform of its own: it must come back EXACTLY
  defenderEl.style.opacity = '0.9';
  // The portraits ride the camera element (the stage) unless the test says otherwise (the opponent's bar is a body portal).
  document.body.append(host, camera);
  (inCamera ? camera : document.body).append(attackerEl, defenderEl);
  const h = playHeroClaw({
    formation: formationOf([total], total), total, side,
    attacker: side === 'player' ? J_BOT : J_TOP, defender: side === 'player' ? J_TOP : J_BOT, defenderRadius: JR, attackerRadius: JR,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

const zOf = (side: 'player' | 'opp'): string => (side === 'opp' ? 'duel-attacker-player' : 'duel-attacker-opp');
const restored = (r: ReturnType<typeof run>, side: 'player' | 'opp'): void => {
  expect(r.defenderEl.style.transform).toBe('rotate(1deg)');
  expect(r.defenderEl.style.opacity).toBe('0.9');
  expect(r.attackerEl.style.transform).toBe('');
  expect(r.camera.style.transform).toBe('');
  expect(document.body.classList.contains(zOf(side))).toBe(false);
  expect(r.host.querySelector('.hblast')).toBeNull();
  expect(r.h.scene?.clawVisible ?? false).toBe(false);
  expect(r.h.scene?.chuteVisible ?? false).toBe(false);
};

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  it('picks the pull out for the socket at the top and the lift for the one at the bottom', () => {
    const a = run('player', 8), b = run('opp', 8);
    expect(a.h.plan.pull).toBe(true);
    expect(b.h.plan.pull).toBe(false);
    a.h.cancel(); b.h.cancel();
  });

  it('BOTH directions, EVERY look: the struck portrait is really moved in the grip, the blow lands EXACTLY ONCE on the impact beat, and everything is put back', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 40]) {
        const r = run(side, total);
        const { h, f } = r;
        const p = h.plan;
        const tag = `${side} ${total}`;
        expect(r.host.querySelector('.hblast.hclaw'), tag).not.toBeNull();
        f.tick(p.dropAt, 4);
        expect(r.defenderEl.style.transform, `${tag}: untouched before the clamp`).toBe('rotate(1deg)');
        expect(h.scene!.clawVisible, tag).toBe(true);
        expect(h.scene!.prongAngle, `${tag}: open`).toBeCloseTo(PRONG_OPEN_RAD, 2);
        // The struck side is raised over the board while the claw has it.
        expect(document.body.classList.contains(zOf(side)), tag).toBe(true);
        f.tick(p.liftEnd - h.elapsed(), 4);
        expect(h.scene!.prongAngle, `${tag}: clamped`).toBeLessThan(0.02);
        expect(r.defenderEl.style.transform, tag).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\) rotate\(-?[\d.]+deg\) scale\(/);
        expect(r.camera.style.transform, tag).toContain('scale(');
        expect(h.scene!.chuteVisible, tag).toBe(p.level === 3);
        f.tick(p.impactAt - h.elapsed() - 8, 4);
        expect(r.onImpact, `${tag}: not before the beat`).not.toHaveBeenCalled();
        f.tick(16, 4);
        expect(r.onImpact, tag).toHaveBeenCalledTimes(1);
        expect(h.elapsed(), tag).toBeGreaterThanOrEqual(p.impactAt); // the clock never pauses on it
        expect(document.body.classList.contains(zOf(side)), `${tag}: lowered on the blow`).toBe(false);
        expect(r.host.querySelector('.hblast-hit')!.textContent, tag).toBe(`-${total}`);
        if (p.level === 3) { f.tick(60, 4); expect(Number(r.defenderEl.style.opacity), `${tag}: down the chute`).toBe(0); }
        f.tick(p.homeAt - h.elapsed() + 8, 4);
        expect(r.defenderEl.style.transform, `${tag}: home exactly`).toBe('rotate(1deg)');
        expect(r.defenderEl.style.opacity, tag).toBe('0.9');
        f.tick(p.endAt - h.elapsed() + 32, 8);
        expect(r.onDone, tag).toHaveBeenCalledTimes(1);
        expect(r.onImpact, tag).toHaveBeenCalledTimes(1);
        restored(r, side);
        expect(h.scene!.liveSprites, tag).toBeLessThanOrEqual(MAX_CLAW_SPRITES);
        f.tick(3000, 16);
        expect(f.hooked(), `${tag}: the updater unhooks once the scene drains`).toBe(0);
        expect(r.root.children, tag).toHaveLength(0);
        document.body.innerHTML = '';
      }
    }
  });

  it('cancel() at ANY moment restores the struck portrait (transform, opacity, z-order class) and never lands the blow', () => {
    for (const side of ['player', 'opp'] as const) {
      const p0 = run(side, 40); const plan0 = p0.h.plan; p0.h.cancel();
      const moments = [plan0.chargeAt + 30, plan0.grabAt + 40, plan0.liftEnd, (plan0.carryAt + plan0.carryEnd) / 2, plan0.releaseAt + 100, plan0.impactAt + 120, plan0.returnAt + 60];
      for (const at of moments) {
        const r = run(side, 40);
        r.f.tick(at, 4);
        const landed = r.onImpact.mock.calls.length;
        r.h.cancel();
        restored(r, side);
        r.f.tick(5000);
        expect(r.onImpact.mock.calls.length, `${side} t=${at}`).toBe(landed);
        expect(r.onDone).not.toHaveBeenCalled();
        expect(r.root.children).toHaveLength(0);
        expect(r.f.hooked()).toBe(0);
        document.body.innerHTML = '';
      }
    }
  });

  it('finish() mid-hold lands the blow once, restores everything and ends', () => {
    for (const total of [8, 40]) {
      const r = run('player', total);
      r.f.tick(r.h.plan.liftEnd + 40, 4);
      expect(r.defenderEl.style.transform).not.toBe('rotate(1deg)');
      r.h.finish();
      expect(r.onImpact).toHaveBeenCalledTimes(1);
      expect(r.onDone).toHaveBeenCalledTimes(1);
      restored(r, 'player');
      expect(r.f.hooked()).toBe(0);
      expect(r.root.children).toHaveLength(0);
      r.h.finish(); r.h.cancel();
      expect(r.onImpact).toHaveBeenCalledTimes(1);
    }
  });

  it('a portrait OUTSIDE the camera element has the camera folded into its transform (it stays in the prongs), and is still restored', () => {
    const r = run('player', 40, {}, false);
    r.f.tick(r.h.plan.carryEnd, 4);
    const m = /scale\(([\d.]+), ([\d.]+)\)/.exec(r.defenderEl.style.transform)!;
    const inside = run('player', 40);
    inside.f.tick(inside.h.plan.carryEnd, 4);
    const n = /scale\(([\d.]+), ([\d.]+)\)/.exec(inside.defenderEl.style.transform)!;
    expect(+m[1]! / +n[1]!).toBeCloseTo(1 + r.h.plan.zoom, 3);
    r.f.tick(r.h.plan.endAt, 8);
    restored(r, 'player');
    inside.h.cancel();
  });

  it('a z-order class the fight already put on the body is left exactly as it was', () => {
    document.body.classList.add(zOf('player'));
    const r = run('player', 8);
    r.f.tick(r.h.plan.endAt + 64, 8);
    expect(r.h.done).toBe(true);
    expect(document.body.classList.contains(zOf('player'))).toBe(true);
    const b = run('player', 8);
    b.f.tick(b.h.plan.liftEnd, 8);
    b.h.cancel();
    expect(document.body.classList.contains(zOf('player'))).toBe(true);
  });

  it('a knockout blow of 3 plays the Prize', () => {
    const r = run('opp', 3, { knockout: true });
    expect(r.h.plan.level).toBe(3);
    expect(r.h.geo.chute).not.toBeNull();
    r.h.cancel();
  });

  it('slow motion stretches real time but the impact is still the same sequence beat', () => {
    const r = run('opp', 8, { speed: 0.5 });
    r.f.tick((r.h.plan.impactAt - 40) * 2, 8);
    expect(r.onImpact).not.toHaveBeenCalled();
    r.f.tick(200, 8);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    r.h.cancel();
  });

  it('a replay plays the same: the same seed scatters the same, frame for frame', () => {
    const a = run('player', 8, { rollSeed: 77 }), b = run('player', 8, { rollSeed: 77 });
    for (let t = 0; t < a.h.plan.endAt; t += 96) {
      a.f.tick(96, 8); b.f.tick(96, 8);
      expect(a.h.scene!.liveSprites).toBe(b.h.scene!.liveSprites);
      expect(a.defenderEl.style.transform).toBe(b.defenderEl.style.transform);
    }
    expect(a.h.pose(a.h.plan.shakes[0]!)).toEqual(b.h.pose(b.h.plan.shakes[0]!));
    a.h.cancel(); b.h.cancel();
  });

  it('reduced motion: no Pixi layer, no camera, no portrait move, no class; the blow lands once', () => {
    const r = run('player', 40, { reduced: true });
    expect(r.root.children).toHaveLength(0);
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.impactAt + 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.defenderEl.style.transform).toBe('rotate(1deg)');
    expect(r.defenderEl.style.opacity).toBe('0.9');
    expect(r.camera.style.transform).toBe('');
    expect(document.body.className).toBe('');
    r.f.tick(r.h.plan.endAt);
    expect(r.f.hooked()).toBe(0);
  });

  it('a local sandbox box (the Collection preview) never touches the body class', () => {
    const host = document.createElement('div');
    const r = run('player', 40, { space: 'local', host, pixiScale: 0.42, attacker: { x: 80, y: 240 }, defender: { x: 320, y: 60 }, defenderRadius: 34, attackerRadius: 34 });
    r.f.tick(r.h.plan.liftEnd, 8);
    expect(document.body.className).toBe('');
    expect(r.defenderEl.style.transform).toContain('translate(');
    r.f.tick(r.h.plan.endAt, 8);
    expect(r.defenderEl.style.transform).toBe('rotate(1deg)');
    expect(r.onImpact).toHaveBeenCalledTimes(1);
  });

  it('the safety timer lands the blow and restores the portrait if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const defenderEl = document.createElement('div');
      const h = playHeroClaw({
        formation: formationOf([25], 25), total: 25, attacker: J_BOT, defender: J_TOP, defenderRadius: JR, defenderEl,
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false, mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
      expect(defenderEl.style.transform).toBe('');
      expect(defenderEl.style.opacity).toBe('');
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  const colors = { chrome: 0xffffff, lamp: 0xff4a5c, coin: 0xffc83a, dust: 0xe8dcc4, side: 0xffd76a };

  it('draws the claw from the pose: the side prongs swing open and shut about their hinges, the cable reaches the top', () => {
    const { p, g } = CASES[5]!;
    const s = new HeroClawScene(TEX, colors, R, 1, 1, 5);
    s.setPose(clawPose(p, g, C, p.dropAt), g);
    expect(s.clawVisible).toBe(true);
    expect(s.prongAngle).toBeCloseTo(PRONG_OPEN_RAD, 5);
    s.setPose(clawPose(p, g, C, p.grabAt + 1), g);
    expect(s.prongAngle).toBeCloseTo(0, 5);
    expect(s.chuteVisible).toBe(true);
    s.setPose(clawPose(p, g, C, p.chargeAt - 1), g);
    expect(s.clawVisible).toBe(false);
    s.hideOwn();
    expect(s.chuteVisible).toBe(false);
    s.destroy();
  });

  it('a whole Shake and a whole Prize stay in the cap and drain; every drawn number is finite; destroy leaves nothing', () => {
    for (const k of [CASES[1]!, CASES[4]!, CASES[2]!, CASES[5]!]) {
      const { p, g } = k;
      const s = new HeroClawScene(TEX, colors, R, 1, 1, 9);
      const pose = blankPose();
      let peak = 0;
      const shook = new Set<number>();
      let hit = false, won = false, popped = false, grabbed = false;
      for (let t = p.chargeAt; t <= p.endAt; t += 8) {
        clawPose(p, g, C, t, pose);
        s.setPose(pose, g); s.setFoeOffset(pose.px, pose.py);
        if (!grabbed && t >= p.grabAt) { grabbed = true; s.grab(g.d.x, g.d.y); }
        p.shakes.forEach((at, i) => { if (t >= at && !shook.has(i)) { shook.add(i); s.shakeOut(g.d.x + pose.px, g.d.y + pose.py, i % 2 ? -1 : 1, p.coins); } });
        if (!hit && t >= p.impactAt) { hit = true; if (g.chute) s.swallow(g.chute, { sparks: p.sparks, flashAlpha: 0.7 }); else s.land(g.d.x, g.d.y, { level: p.level, sparks: p.sparks, flashAlpha: 0.7, slam: p.pull }); }
        if (!won && g.chute && t >= p.impactAt + 70) { won = true; s.win(g.chute); }
        if (!popped && g.chute && t >= p.returnAt) { popped = true; s.pop(g.d.x, g.d.y); }
        s.update(8);
        peak = Math.max(peak, s.liveSprites);
        for (const layer of s.root.children) for (const ch of (layer as Container).children) {
          expect(Number.isFinite(ch.position.x + ch.position.y + ch.scale.x + ch.scale.y + ch.rotation + ch.alpha), k.name).toBe(true);
        }
      }
      expect(peak, k.name).toBeLessThanOrEqual(MAX_CLAW_SPRITES);
      expect(peak, k.name).toBeLessThan(110);
      s.hideOwn();
      let alive = true;
      for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
      expect(alive, `${k.name}: drains`).toBe(false);
      expect(s.liveFx, k.name).toBe(0);
      s.destroy();
      expect(s.root.destroyed, k.name).toBe(true);
      expect(s.update(16)).toBe(false);
    }
  });

  it('clear() drops every effect and hides the claw at once; the pool is reused, not regrown', () => {
    const { p, g } = CASES[1]!;
    const s = new HeroClawScene(TEX, colors, R, 1, 1, 3);
    s.setPose(clawPose(p, g, C, p.liftEnd), g);
    s.shakeOut(500, 500, 1, 5); s.land(500, 500, { level: 2, sparks: 14, flashAlpha: 0.7 });
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveFx).toBe(0);
    expect(s.clawVisible).toBe(false);
    s.shakeOut(500, 500, 1, 5); s.land(500, 500, { level: 2, sparks: 14, flashAlpha: 0.7 });
    expect(s.pooledSprites).toBe(pooled);
    s.destroy();
  });
});
