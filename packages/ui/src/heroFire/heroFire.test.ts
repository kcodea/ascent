// @vitest-environment jsdom
/**
 * THE FIRE HERO ATTACK ("Inferno"; owner 2026-09-29: "we need a fire animation ... use the same 4 tier strategy ... it
 * should look like live flame/fires pixi sprites"): the tier mapping SHARED with every style; the tier -> fireballs
 * ladder (1 / 2 / 5 / 3 + the meteor); the tuner defaults + clamping; the pure plan (the volley rhythm, the impact beat,
 * the meteor's order, reduced motion, determinism); the pure fireball paths (they ignite round the rim, clear of the
 * face, never above the frame, and land on the target) and the meteor's fall (from above the frame onto the target);
 * the camera; the runner on the shared clock (the consequence lands exactly ONCE, on the last fireball or the
 * detonation, never on a tick; the target set ablaze at III; both directions; slow motion; replay; finish / cancel;
 * cleanup; the clock never pauses); the headless scene (every flame is live particle fire, pooled, bounded, drains,
 * destroy leaves nothing); and the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_FROST_DEFAULTS, frostPlan } from '../heroFrost/heroFrostConfig';
import { fireTexturesFrom } from '../heroAttack/pixiFire';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  FIRE_CAPS, HERO_FIRE_DEFAULTS, HERO_FIRE_RANGES, clampHeroFireValue, fireCameraAt, fireCameraFocus, fireCues, firePlan,
  fireSlots, fireTravelMs, fireballMotions, fireballPose, heroFireConfigJson, meteorMotion, meteorPose, sanitizeHeroFireConfig,
  type HeroFireConfig, type HeroFireNumKey,
} from './heroFireConfig';
import { HeroFireScene, MAX_FIRE_PARTICLES, MAX_FIRE_SPRITES, type HeroFireTextures } from './heroFireScene';
import { fireSeed, playHeroFire, type HeroFireOptions } from './heroFire';
import { SPEC } from '../HeroFireTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroFireTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  fire: fireTexturesFrom(W, W, W), scorch: W, shock: W,
};
const C = HERO_FIRE_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => firePlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xfff4d6, hot: 0xffc53d, flame: 0xff7417, deep: 0xd9230b, ember: 0x5a0a03, smoke: 0x2b1f1b, side: 0xff9a2e };
const LOOK = {
  kindle: 1, ballFlame: 1, ballGlow: 0.8, trail: 1, trailSmoke: 1, turbulence: 1, buoyancy: 1, smoke: 1, embers: 1, explodeSize: 1,
  blazeSize: 1, novaSize: 3.2, novaMs: 380, engulfMs: 620, burnoutMs: 900, scorch: 1,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with every hero attack)', () => {
  it('Fire steps up on exactly the blows the other styles do: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(frostPlan({ total: d, distance: 1600 }, HERO_FROST_DEFAULTS).tier);
    }
  });

  it('the ladder ESCALATES: I ONE fireball, II TWO, III a volley of FIVE that sets the target ablaze, IV three THEN the meteor', () => {
    expect([P1, P2, P3, P4].map((p) => p.balls.length)).toEqual([1, 2, 5, 3]);
    expect([P1, P2, P3, P4].map((p) => p.meteor)).toEqual([false, false, false, true]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.meteor ? `${p.balls.length}+meteor` : p.balls.length; }))
      .toEqual([1, 1, 2, 2, 5, 5, '3+meteor', '3+meteor']);
    // the blaze on the struck portrait, the shake, the embers and the flash all climb
    expect(P1.blaze).toBe(0);
    expect(P2.blaze).toBeGreaterThan(0);
    expect(P3.blaze).toBeGreaterThan(P2.blaze);
    expect(P3.blazeMs).toBeGreaterThan(P2.blazeMs);
    for (const k of ['shakePx', 'embers', 'burst'] as const) {
      expect(P2[k], k).toBeGreaterThan(P1[k]);
      expect(P3[k], k).toBeGreaterThan(P2[k]);
      expect(P4[k], k).toBeGreaterThan(P3[k]);
    }
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_FIRE_RANGES)) {
      const v = C[k as HeroFireNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorHot', 'colorFlame', 'colorDeep', 'colorEmber', 'colorSmoke', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroFireValue('t3Balls', 99)).toBe(8);
    expect(clampHeroFireValue('t1Balls', 0)).toBe(1);
    expect(clampHeroFireValue('novaSize', -3)).toBe(1);
    expect(clampHeroFireValue('meteorMs', 99999)).toBe(2000);
    expect(clampHeroFireValue('engulfMs', Number.NaN)).toBe(C.engulfMs);
    expect(clampHeroFireValue('engulfMs', 'abc')).toBe(C.engulfMs);
    expect(clampHeroFireValue('engulfMs', '200')).toBe(200);
    expect(clampHeroFireValue('colorFlame', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroFireValue('colorDeep', 'red')).toBe(C.colorDeep);
    expect(clampHeroFireValue('sfxLaunchClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroFireValue('nope' as keyof HeroFireConfig, 1)).toBeUndefined();
    expect(clampHeroFireValue('toString' as keyof HeroFireConfig, 1)).toBeUndefined();
    const s = sanitizeHeroFireConfig({ t4Embers: 400, colorCore: 'x', bogus: 3 });
    expect(s.t4Embers).toBe(120);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroFireConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Fire', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroFireConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Meteor).toBe(1);
    expect(json.t3Balls).toBe(5);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('fire');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('fire');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ You cast', '▶ Foe casts', '▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe tier II (8)',
      '▶ Foe medium (12)', '▶ Foe huge (40)']) {
      expect(labels).toContain(l);
    }
    // Owner 2026-09-29 (every attack tuner): the Play row on TOP, and no speed or reduced-motion buttons.
    expect(SPEC.buttonsOnTop).toBe(true);
    expect(labels.some((l) => /Speed|Reduced/.test(l))).toBe(false);
    // every sound cue has a clip picker
    const clipRows = SPEC.controls.filter((c) => String(c.key).startsWith('sfx') && String(c.key).endsWith('Clip'));
    expect(clipRows.length).toBe(13);
  });
});

describe('the plan', () => {
  it('THE VOLLEY: five fireballs land in rhythm, the first four are ticks, the LAST is the impact (only one impact beat)', () => {
    const arr = P3.balls.map((r) => r.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!, `arrival ${i}`).toBeGreaterThan(arr[i - 1]!);
    const gaps = arr.slice(1).map((a, i) => a - arr[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(P3.impactAt).toBe(arr[arr.length - 1]);
    expect(P3.hits).toEqual(arr.slice(0, -1));
    const cues = fireCues(P3);
    expect(cues.filter((q) => q.kind === 'impact')).toHaveLength(1);
    expect(cues.filter((q) => q.kind === 'hit')).toHaveLength(4);
    // every fireball is alight before it leaves
    for (const b of P3.balls) expect(b.formAt + C.growMs).toBeLessThanOrEqual(b.launchAt);
    // the last of a volley is the biggest
    expect(P3.balls[4]!.size).toBeGreaterThan(P3.balls[0]!.size);
  });

  it('Tier IV: every fireball is a tick, then the summon, the meteor falls, and it DETONATES (the one impact)', () => {
    expect(P4.hits).toHaveLength(3);
    expect(P4.summonAt).toBeGreaterThan(P4.balls[2]!.launchAt);
    expect(P4.meteorAt).toBeGreaterThan(P4.summonAt);
    expect(P4.impactAt).toBeGreaterThan(P4.meteorAt);
    for (const h of P4.hits) expect(h).toBeLessThan(P4.impactAt);
    expect(P4.booms.every((b) => b > P4.impactAt && b < P4.endAt)).toBe(true);
    const kinds = fireCues(P4).map((q) => q.kind);
    expect(kinds.indexOf('summon')).toBeLessThan(kinds.indexOf('meteor'));
    expect(kinds.indexOf('meteor')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe('end');
  });

  it('brisk: Tier I lands within about 0.9 s of the formation; Tier IV (the slower meteor build) within about 2.5 s', () => {
    expect(P1.impactAt - P1.chargeAt).toBeLessThan(900);
    expect(P4.impactAt - P4.chargeAt).toBeLessThan(2500);
    // the owner's slower build: the summon and the fall together take well over a second
    expect(P4.impactAt - P4.summonAt).toBeGreaterThan(1100);
    expect(P4.impactAt - P4.chargeAt).toBeGreaterThan(P3.impactAt - P3.chargeAt);
  });

  it('reduced motion: no fire at all, the blow lands on the formation end; the plan is deterministic', () => {
    const r = plan([6, 6, 6, 6, 6, 5, 5], 40, 1600, true);
    expect(r.reduced).toBe(true);
    expect(r.balls).toEqual([]);
    expect(r.meteor).toBe(false);
    expect(fireCues(r).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(plan([6, 6, 6, 6, 6, 5, 5], 40)).toEqual(P4);
  });

  it('the slots fan outer-first with the centre last; travel scales gently with the distance', () => {
    expect(fireSlots(1)).toEqual([0]);
    expect(fireSlots(2)).toEqual([-1, 1]);
    expect(fireSlots(5)).toEqual([-2, 2, -1, 1, 0]);
    expect(fireTravelMs(1600, 300)).toBe(300);
    expect(fireTravelMs(200, 300)).toBe(180);
    expect(fireTravelMs(9000, 300)).toBe(345);
    expect(FIRE_CAPS.balls).toBe(8);
  });
});

describe('the paths', () => {
  it('fireballs ignite round the striking rim (clear of the face, never above the frame) and land on the struck portrait', () => {
    for (const p of [P1, P2, P3, P4]) {
      const ms = fireballMotions(p, A, D, R, R, C, 1, 0);
      expect(ms).toHaveLength(p.balls.length);
      for (const m of ms) {
        const hd = Math.hypot(m.home.x - A.x, m.home.y - A.y);
        expect(hd).toBeGreaterThan(R);
        expect(hd).toBeLessThan(R * 2);
        expect(m.home.y - m.radius).toBeGreaterThanOrEqual(0);
        expect(Math.hypot(m.to.x - D.x, m.to.y - D.y)).toBeLessThanOrEqual(R * 0.35);
        const land = fireballPose(m, m.arriveAt);
        expect(land.landed).toBe(true);
        expect(land.x).toBeCloseTo(m.to.x, 6);
        const mid = fireballPose(m, (m.launchAt + m.arriveAt) / 2);
        expect(mid.flying).toBe(true);
        expect(fireballPose(m, m.formAt - 1).grow).toBe(0);
        expect(fireballPose(m, m.formAt + m.growMs).grow).toBeCloseTo(1, 2);
      }
    }
    // a hero at the top of the screen: its fireballs still ignite inside the frame
    const top = fireballMotions(P3, { x: 400, y: 60 }, { x: 1400, y: 900 }, R, R, C, 1, 0);
    for (const m of top) expect(m.home.y - m.radius).toBeGreaterThanOrEqual(0);
  });

  it('the meteor falls from ABOVE the frame, on the attacker\'s side, onto the struck hero, accelerating', () => {
    const m = meteorMotion(P4, A, D, R, C, 0)!;
    expect(m).not.toBeNull();
    expect(m.from.y + m.radius).toBeLessThan(0);
    expect(m.from.x).toBeLessThan(D.x); // the attacker is to the left
    const end = meteorPose(m, P4.impactAt);
    expect(end.x).toBeCloseTo(D.x, 6);
    expect(end.y).toBeCloseTo(D.y, 6);
    const q1 = meteorPose(m, P4.meteorAt + (P4.impactAt - P4.meteorAt) * 0.25), q3 = meteorPose(m, P4.meteorAt + (P4.impactAt - P4.meteorAt) * 0.75);
    const d1 = Math.hypot(q1.x - m.from.x, q1.y - m.from.y), d3 = Math.hypot(q3.x - m.from.x, q3.y - m.from.y);
    expect(d3 - d1).toBeGreaterThan(d1); // it covers more ground late (accelerating)
    expect(meteorMotion(P3, A, D, R, C)).toBeNull();
    const back = meteorMotion(P4, D, A, R, C, 0)!;
    expect(back.from.x).toBeGreaterThan(A.x);
  });
});

describe('the camera', () => {
  it('pushes in while the fire gathers, punches in on the impact and shakes ALONG the throw; rests by the end', () => {
    const dir = { x: 0.6, y: -0.8 };
    const hit = fireCameraAt(P3, C, P3.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P3.zoom);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = fireCameraAt(P3, C, P3.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.6);
  });

  it('Tier IV keeps both heroes in frame: it follows the volley, eases half way home for the summon, rides the meteor down; the detonation punches hardest', () => {
    expect(fireCameraFocus(P4, P4.fireAt, A, D)).toEqual(A);
    const home = fireCameraFocus(P4, P4.meteorAt, A, D);
    expect(home.x).toBeCloseTo((A.x + D.x) / 2, 4);
    expect(fireCameraFocus(P4, P4.impactAt, A, D)).toEqual(D);
    const boom = fireCameraAt(P4, C, P4.impactAt + 1);
    expect(boom.zoom).toBeGreaterThan(fireCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(fireCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroFireOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroFireOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroFire({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('THE VOLLEY lands the blow EXACTLY ONCE, on the LAST fireball: never on a tick; the target is SET ABLAZE; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.balls).toHaveLength(5);
    expect(host.querySelector('.hblast.hfire')).not.toBeNull();
    f.tick(h.plan.fireAt - 20, 4);
    expect(h.scene!.liveBalls).toBe(5); // every fireball is alight before the first one flies
    expect(h.scene!.charging).toBe(true);
    expect(h.scene!.liveFire).toBeGreaterThan(20); // live fire: the kindling and the fireballs are particles
    f.tick(h.plan.hits[h.plan.hits.length - 1]! - h.elapsed() + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(300, 8);
    expect(h.scene!.emitters).toBeGreaterThan(0); // ABLAZE: the struck portrait's rim is still burning
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(5000, 16); // the fire burns out to smoke, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: the fireballs tick, the summon and the meteor fall, and the blow lands ONCE, on the DETONATION', () => {
    const { h, f, onImpact, defenderEl } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.meteor).toBe(true);
    expect(h.meteor).not.toBeNull();
    f.tick(h.plan.meteorAt + 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.meteorLive).toBe(true);
    expect(defenderEl.style.transform).toContain('translate('); // trembling as it bears down (the clock runs on)
    const before = h.elapsed();
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(h.elapsed()).toBeGreaterThan(before);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.meteorLive).toBe(false);
    f.tick(200, 8);
    expect(h.scene!.liveFire).toBeGreaterThan(200); // the nova, the dome and the engulfing pillar
    expect(h.scene!.liveFire).toBeLessThanOrEqual(MAX_FIRE_PARTICLES);
    f.tick(h.plan.endAt + 5000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck); the pools stay in their caps', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 14, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 600; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_FIRE_SPRITES + MAX_FIRE_PARTICLES);
        expect(h.scene!.pooledFire).toBeLessThanOrEqual(MAX_FIRE_PARTICLES);
        expect(h.scene!.pooledSprites).toBeLessThanOrEqual(MAX_FIRE_SPRITES);
        const last = h.motions[h.motions.length - 1]!;
        expect(Math.hypot(last.home.x - a.x, last.home.y - a.y)).toBeLessThan(R * 2);
        expect(Math.hypot(last.to.x - d.x, last.to.y - d.y)).toBeLessThanOrEqual(R * 0.35);
        if (h.meteor) expect(h.meteor.to).toEqual(d);
        h.cancel();
      }
    }
  });

  it('the clock never pauses: every frame advances it by exactly the time played, through the detonation', () => {
    const { h, f } = run({ total: 40, formation: formationOf([40], 40) });
    let prev = h.elapsed();
    for (let t = 0; t < h.plan.endAt; t += 16) {
      f.tick(16, 16);
      if (h.done) break;
      expect(h.elapsed() - prev).toBeCloseTo(16, 6);
      prev = h.elapsed();
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

  it('a replay plays the same: the same fight flies the same fireballs, the same meteor and burns the same fire', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.motions).toEqual(b.h.motions);
    expect(a.h.meteor).toEqual(b.h.meteor);
    a.f.tick(a.h.plan.impactAt + 100, 16); b.f.tick(b.h.plan.impactAt + 100, 16);
    expect(a.h.scene!.liveFire).toBe(b.h.scene!.liveFire);
    expect(fireSeed(40, 1600, 'player')).toBe(fireSeed(40, 1600, 'player'));
    expect(fireSeed(40, 1600, 'player')).not.toBe(fireSeed(40, 1600, 'opp'));
    a.h.cancel(); b.h.cancel();
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it', () => {
    const a = run();
    a.f.tick(600);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.meteorAt + 50);
    b.h.cancel();
    b.f.tick(5000);
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.onDone).not.toHaveBeenCalled();
    expect(b.host.querySelector('.hblast')).toBeNull();
    expect(b.camera.style.transform).toBe('');
    expect(b.attackerEl.style.transform).toBe('');
    expect(b.defenderEl.style.transform).toBe('');
    expect(b.root.children).toHaveLength(0);
  });

  it('reduced motion: no Pixi layer, no camera or portrait move, just fades; the blow lands once', () => {
    const { h, f, root, onImpact, camera, host, defenderEl, attackerEl } = run({ reduced: true, total: 40, formation: formationOf([40], 40) });
    expect(root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    expect(h.motions).toEqual([]);
    expect(h.meteor).toBeNull();
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('40');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const h = playHeroFire({
        formation: formationOf([25], 25), total: 25, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 },
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false,
        mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  it('a whole Tier IV stays in the caps and drains; destroy leaves nothing', () => {
    const s = new HeroFireScene(TEX, COLORS, LOOK, 1, 42);
    const ms = fireballMotions(P4, A, D, R, R, C);
    const meteor = meteorMotion(P4, A, D, R, C, 0)!;
    let peakS = 0, peakF = 0;
    const cues = fireCues(P4);
    let ci = 0;
    for (let t = 0; t < P4.endAt + 5000; t += 16) {
      while (ci < cues.length && cues[ci]!.at <= s.time) {
        const q = cues[ci++]!;
        const m = ms[q.i];
        if (q.kind === 'charge') s.startCharge(A.x, A.y, R, P4.fireAt - P4.chargeAt, ms.length);
        else if (q.kind === 'grow' && m) s.grow(m);
        else if (q.kind === 'fire' && m) s.fireBall(m);
        else if (q.kind === 'hit' && m) { s.land(m); s.explode(m.to.x, m.to.y, R, { size: 1, big: false, dir: { x: 1, y: 0 }, flashAlpha: 0.85, embers: 10 }); }
        else if (q.kind === 'summon') s.summon(A.x, A.y, R, P4.meteorAt - P4.summonAt);
        else if (q.kind === 'meteor') s.startMeteor(meteor, R);
        else if (q.kind === 'impact') s.detonate(D.x, D.y, R, { burst: 2, flashAlpha: 0.85, embers: 60, screen: 1920 });
        else if (q.kind === 'boom') s.boom(D.x + 40, D.y, R, 1);
      }
      s.update(16);
      peakS = Math.max(peakS, s.liveSprites - s.liveFire); peakF = Math.max(peakF, s.liveFire);
    }
    expect(peakF).toBeGreaterThan(300);
    expect(peakF).toBeLessThanOrEqual(MAX_FIRE_PARTICLES);
    expect(peakS).toBeLessThanOrEqual(MAX_FIRE_SPRITES);
    expect(s.update(16)).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.emitters).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('clear() drops everything in flight at once; the pools are reused, not regrown', () => {
    const s = new HeroFireScene(TEX, COLORS, LOOK, 1, 9);
    const ms = fireballMotions(P3, A, D, R, R, C);
    for (let t = 0; t < ms[4]!.formAt + 200; t += 16) s.update(16);
    ms.forEach((m) => s.grow(m));
    for (let t = 0; t < 200; t += 16) s.update(16);
    const pooledS = s.pooledSprites, pooledF = s.pooledFire;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.emitters).toBe(0);
    expect(s.update(16)).toBe(false);
    ms.forEach((m) => s.grow(m));
    for (let t = 0; t < 200; t += 16) s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooledS + 4);
    expect(s.pooledFire).toBeLessThanOrEqual(Math.max(pooledF, MAX_FIRE_PARTICLES));
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Inferno (attack_fire) is a Legendary crate hero attack that plays Fire; the dev override can force it; the other attacks unchanged', () => {
    expect(COSMETIC_INDEX.attack_fire).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Inferno', assets: { style: 'fire' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast', 'banana', 'coin', 'boomerang', 'bubble', 'backstab']); // Grave Call (undead) joined after Inferno, 2026-09-29
    expect(styleOfCosmetic('attack_fire')).toBe('fire');
    for (const [id, style] of [['attack_blast', 'blast'], ['attack_frost', 'frost'], ['attack_holy', 'holy'], ['attack_enraged', 'enraged']] as const) {
      expect(styleOfCosmetic(id)).toBe(style);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_fire' })).toBe('fire');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'fire' })).toBe('fire');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_fire' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_fire_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
