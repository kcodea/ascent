// @vitest-environment jsdom
/**
 * THE QUAKE HERO ATTACK (owner 2026-09-28: "make a new attack animation called quake. same attack dmg threshold logic
 * as blast"): the tier mapping SHARED with Blast; the tuner defaults + clamping; the pure plan (the total is the
 * engine's number, every tier escalates, the impact beat, reduced motion, determinism); the camera (a vertical rumble
 * that builds, a jolt up on the eruption, rest by the end); the runner on the shared clock (the consequence lands
 * exactly once on the eruption, hit-stops freeze the clock, both directions, slow motion, replay, finish / cancel,
 * cleanup); the headless ground scene (pooled, bounded, deterministic cracks, drains, destroy leaves nothing); and the
 * cosmetic resolution (Tectonic Slam plays Quake; unknown or retired ids play Classic).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_BLAST_DEFAULTS, blastPlan, tierOf as blastTierOf } from '../heroBlast/heroBlastConfig';
import { resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_QUAKE_DEFAULTS, HERO_QUAKE_RANGES, QUAKE_CAPS, clampHeroQuakeValue, heroQuakeConfigJson, quakeCameraAt, quakeCameraFocus,
  quakeCues, quakeEase, quakeEaseInv, quakePlan, quakeTravelMs, sanitizeHeroQuakeConfig, type HeroQuakeConfig, type HeroQuakeNumKey,
} from './heroQuakeConfig';
import { HeroQuakeScene, MAX_QUAKE_SPRITES, crackPath, quakeRng, type HeroQuakeTextures } from './heroQuakeScene';
import { playHeroQuake, quakeSeed, type HeroQuakeOptions } from './heroQuake';
import { SPEC } from '../HeroQuakeTuner';

const W = Texture.WHITE;
const TEX: HeroQuakeTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, crack: W, seamGlow: W, rocks: [W, W, W], dust: W, dustRing: W, scorch: W,
};
const C = HERO_QUAKE_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => quakePlan({ values, total, distance, reduced }, C);
const COLORS = { core: 0xffffff, side: 0xff9a1f, chasm: 0x140904, lip: 0xe2c294, dust: 0xa58c70, rock: 0x9b8570 };

describe('the damage tiers (shared with Blast)', () => {
  it('Quake steps up on exactly the blows Blast does: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect(HERO_ATTACK_TIER_THRESHOLDS).toEqual({ tier2At: 6, tier3At: 12, tier4At: 20 });
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    expect({ tier2At: HERO_BLAST_DEFAULTS.tier2At, tier3At: HERO_BLAST_DEFAULTS.tier3At, tier4At: HERO_BLAST_DEFAULTS.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const q = plan([d], d).tier;
      expect(q, `dmg ${d}`).toBe(blastPlan({ values: [d], total: d, distance: 1600 }, HERO_BLAST_DEFAULTS).tier);
      expect(q).toBe(sharedTierOf(d));
      expect(q).toBe(blastTierOf(d, HERO_BLAST_DEFAULTS));
    }
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => plan([d], d).tier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_QUAKE_RANGES)) {
      const v = C[k as HeroQuakeNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorPlayer', 'colorFoe', 'colorChasm', 'colorLip', 'colorDust', 'colorRock'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroQuakeValue('t2Branches', 99)).toBe(14);
    expect(clampHeroQuakeValue('t4Rumble', -3)).toBe(0);
    expect(clampHeroQuakeValue('t4Zoom', 5)).toBe(0.14);
    expect(clampHeroQuakeValue('absorbMs', Number.NaN)).toBe(C.absorbMs);
    expect(clampHeroQuakeValue('absorbMs', 'abc')).toBe(C.absorbMs);
    expect(clampHeroQuakeValue('absorbMs', '300')).toBe(300);
    expect(clampHeroQuakeValue('colorChasm', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroQuakeValue('colorDust', 'brown')).toBe(C.colorDust);
    expect(clampHeroQuakeValue('sfxEruptClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroQuakeValue('nope' as keyof HeroQuakeConfig, 1)).toBeUndefined();
    expect(clampHeroQuakeValue('toString' as keyof HeroQuakeConfig, 1)).toBeUndefined();
    const s = sanitizeHeroQuakeConfig({ t1Rocks: 400, colorCore: 'x', bogus: 3 });
    expect(s.t1Rocks).toBe(40);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroQuakeConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Quake', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroQuakeConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Pillar).toBe(1);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('quake');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe huge (40)', '▶ Reduced motion', 'Speed 1x', 'Speed 0.5x', 'Speed 0.25x']) expect(labels).toContain(l);
  });
});

describe('the plan', () => {
  it('the combine ends on EXACTLY the engine total, even when the parts sum past the cap', () => {
    const p = plan([6, 6, 6], 10);
    expect(p.total).toBe(10);
    expect(p.counts).toEqual([6, 10, 10]);
    expect(p.capped).toBe(true);
  });

  it('every tier escalates: more cracks, magma, rocks, rumble, jolt, hit-stop; III adds bursts and a crater; IV the pillar and board cracks', () => {
    const ps = [plan([2, 1], 3), plan([3, 3, 2], 8), plan([3, 3, 3, 3], 12), plan([6, 6, 6, 6, 6, 5, 5], 40)];
    expect(ps.map((p) => p.tier)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < 4; i++) {
      const a = ps[i - 1]!, b = ps[i]!;
      for (const k of ['crackWidth', 'rocks', 'rumblePx', 'shakePx', 'hitStopMs', 'zoom', 'eruption', 'rumbleTailMs'] as const) {
        expect(b[k], `${k} ${i}`).toBeGreaterThan(a[k]);
      }
      expect(b.travelMs, `travel ${i}`).toBeGreaterThan(a.travelMs);
      expect(b.slamAt - b.chargeAt, `wind-up ${i}`).toBeGreaterThan(a.slamAt - a.chargeAt);
    }
    expect(ps.map((p) => p.branches)).toEqual([0, 3, 6, 9]);
    expect(ps.map((p) => p.bursts.length)).toEqual([0, 0, 3, 5]);
    expect(ps.map((p) => p.pillar)).toEqual([false, false, false, true]);
    expect(ps.map((p) => p.boardCracks)).toEqual([0, 0, 0, 7]);
    expect(ps.map((p) => p.booms.length)).toEqual([0, 0, 2, 4]);
    expect(ps[0]!.magma).toBe(0);
    expect(ps[2]!.crater).toBeGreaterThan(0);
    expect(ps[3]!.magma).toBe(1);
  });

  it('the shipped per-tier timeline (1600 px apart): slam, impact and end (+ both hit-stops), ms', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.slamAt), Math.round(p.impactAt), Math.round(p.endAt + p.hitStopMs + p.slamStopMs)];
    expect([t(plan([2, 1], 3)), t(plan([3, 3, 2], 8)), t(plan([3, 3, 3, 3, 2], 14)), t(plan([6, 6, 6, 6, 6, 5, 5], 40))]).toEqual([
      [885, 1265, 1944], [1150, 1610, 2446], [1605, 2185, 3272], [2020, 2740, 4080],
    ]);
    // Brisk at Tier I (under 2 s), about 4 s at Tier IV (owner: "satisfying and chunky, not rushed").
    expect(t(plan([2, 1], 3))[2]).toBeLessThan(2000);
    expect(t(plan([6, 6, 6, 6, 6, 5, 5], 40))[2]).toBeLessThanOrEqual(4200);
  });

  it('beats run in order: numbers, merge, wind-up, SLAM, bursts on the way, IMPACT, booms, fade, end', () => {
    const p = plan([3, 1, 2, 4, 4], 14);
    expect(p.mergeAt).toBe(p.arrivals[4]);
    expect(p.impactAt).toBe(p.slamAt + p.travelMs);
    const kinds = quakeCues(p).map((c) => c.kind);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(at('merge')).toBeLessThan(at('charge'));
    expect(at('charge')).toBeLessThan(at('slam'));
    expect(at('slam')).toBeLessThan(at('burst'));
    expect(kinds.lastIndexOf('burst')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('boom'));
    expect(at('boom')).toBeLessThan(at('fade'));
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe('end');
    // each burst goes off where the front is when it fires
    p.bursts.forEach((b, i) => expect(quakeEase((b - p.slamAt) / p.travelMs)).toBeCloseTo(p.burstFracs[i]!, 2));
  });

  it('the front accelerates into the target; its inverse is exact; travel scales gently with distance', () => {
    expect(quakeEase(0)).toBe(0);
    expect(quakeEase(1)).toBe(1);
    expect(quakeEase(0.75) - quakeEase(0.5)).toBeGreaterThan(quakeEase(0.25) - quakeEase(0));
    for (const f of [0, 0.2, 0.5, 0.9, 1]) expect(quakeEase(quakeEaseInv(f))).toBeCloseTo(f, 6);
    expect(quakeTravelMs(1600, 500)).toBe(500);
    expect(quakeTravelMs(100, 500)).toBe(300);
    expect(quakeTravelMs(99999, 500)).toBe(600);
  });

  it('the caps always hold, whatever the sliders say', () => {
    const wild: HeroQuakeConfig = { ...C, t4Branches: 14, t4Bursts: 8, t4Rocks: 40, t4Rumble: 30, t4Shake: 40, t4HitStop: 250, t4Booms: 6 };
    const w = quakePlan({ values: [99], total: 99, distance: 800 }, wild);
    expect(w.branches).toBeLessThanOrEqual(QUAKE_CAPS.branches);
    expect(w.bursts.length).toBeLessThanOrEqual(QUAKE_CAPS.bursts);
    expect(w.rocks).toBeLessThanOrEqual(QUAKE_CAPS.rocks);
    expect(w.rumblePx).toBeLessThanOrEqual(QUAKE_CAPS.rumblePx);
    expect(w.hitStopMs).toBeLessThanOrEqual(QUAKE_CAPS.hitStopMs);
  });

  it('reduced motion: no wind-up, cracks, shake, zoom, dim or hit-stop; the blow still lands once', () => {
    const p = plan([3, 4], 7, 800, true);
    expect([p.rumblePx, p.shakePx, p.zoom, p.hitStopMs, p.slamStopMs, p.dim, p.travelMs]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const kinds = quakeCues(p).map((q) => q.kind);
    expect(kinds).not.toContain('slam');
    expect(kinds).not.toContain('charge');
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(quakeCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('is deterministic: the same fight plans the same beats (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3], 9, 720)).toEqual(plan([4, 2, 3], 9, 720));
    expect(quakeCues(plan([4, 2, 3], 9, 720))).toEqual(quakeCues(plan([4, 2, 3], 9, 720)));
  });
});

describe('the camera', () => {
  it('RUMBLES mostly vertically and builds through the travel; kicks down on the slam; jolts UP on the eruption; rests by the end', () => {
    const p = plan([6, 6, 6, 6, 6, 5, 5], 40);
    let early = 0, late = 0, xs = 0, ys = 0;
    for (let t = p.slamAt + 200; t < p.slamAt + 200 + p.travelMs * 0.25; t += 4) { const c = quakeCameraAt(p, C, t); early = Math.max(early, Math.abs(c.y)); }
    for (let t = p.slamAt + p.travelMs * 0.75; t < p.impactAt; t += 4) { const c = quakeCameraAt(p, C, t); late = Math.max(late, Math.abs(c.y)); xs += Math.abs(c.x); ys += Math.abs(c.y); }
    expect(late).toBeGreaterThan(early);
    expect(ys).toBeGreaterThan(xs * 2);
    expect(quakeCameraAt(p, C, p.slamAt).y).toBeGreaterThan(0);
    const hit = quakeCameraAt(p, C, p.impactAt);
    expect(hit.y).toBeLessThan(-p.shakePx * 0.5);
    expect(hit.zoom).toBeGreaterThan(1 + p.zoom);
    const rest = quakeCameraAt(p, C, p.endAt);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.6);
  });

  it('anchors on the attacker through the slam, rides the crack front, and anchors on the target from the eruption', () => {
    const p = plan([3, 4], 7);
    const a = { x: 100, y: 900 }, d = { x: 1700, y: 150 };
    expect(quakeCameraFocus(p, p.slamAt, a, d)).toEqual(a);
    expect(quakeCameraFocus(p, p.impactAt, a, d)).toEqual(d);
    const mid = quakeCameraFocus(p, p.slamAt + p.travelMs / 2, a, d);
    expect(mid.x).toBeGreaterThan(a.x);
    expect(mid.x).toBeLessThan(d.x);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroQuakeOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroQuakeOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroQuake({
    parts: [{ value: 3, from: { x: 100, y: 800 }, base: true }, { value: 2, from: { x: 500, y: 500 } }, { value: 4, from: { x: 700, y: 500 } }],
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, combineAt: { x: 900, y: 500 },
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('lands the blow EXACTLY ONCE on the eruption, HOLDS both hit-stops, then ends and cleans everything up', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run();
    expect(host.querySelectorAll('.hblast-chip')).toHaveLength(3);
    expect(host.querySelector('.hblast.hquake')).not.toBeNull();
    // the slam freezes on its frame
    f.tick(h.plan.slamAt + 8, 4);
    expect(h.elapsed()).toBe(h.plan.slamAt);
    f.tick(h.plan.slamStopMs - 12, 4);
    expect(h.elapsed()).toBe(h.plan.slamAt);
    expect(h.scene!.liveCracks).toBeGreaterThan(0);
    // the quake runs; the blow lands on the eruption and not a frame before
    f.tick(h.plan.impactAt - h.plan.slamAt - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBe(h.plan.impactAt);
    f.tick(h.plan.hitStopMs - 16, 4);
    expect(h.elapsed()).toBe(h.plan.impactAt);
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-9');
    f.tick(h.plan.endAt - h.plan.impactAt + h.plan.hitStopMs + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16); // the rocks and embers drain, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('works in both directions at every tier (the eruption lands under whichever hero is struck)', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 14, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total });
        f.tick(h.plan.impactAt + h.plan.slamStopMs + 16, 4);
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_QUAKE_SPRITES);
        h.cancel();
      }
    }
  });

  it('slow motion stretches real time but the eruption is still the same sequence beat', () => {
    const { h, f, onImpact } = run({ speed: 0.25 });
    f.tick((h.plan.impactAt + h.plan.slamStopMs) * 4 - 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(60, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('a replay draws the same ground: same seed from the same fight, same crack paths', () => {
    expect(quakeSeed(14, 1500.2, 'player')).toBe(quakeSeed(14, 1500.4, 'player'));
    expect(quakeSeed(14, 1500, 'player')).not.toBe(quakeSeed(14, 1500, 'opp'));
    const a = crackPath({ x: 0, y: 0 }, { x: 900, y: 300 }, 44, 0.4, quakeRng(77), 40);
    const b = crackPath({ x: 0, y: 0 }, { x: 900, y: 300 }, 44, 0.4, quakeRng(77), 40);
    expect(a).toEqual(b);
    expect(a[0]).toEqual({ x: 0, y: 0 });
    expect(a[a.length - 1]).toEqual({ x: 900, y: 300 });
    // bounded: never wanders further than its limit off the line
    const L = Math.hypot(900, 300);
    for (const p of a) expect(Math.abs((p.x * 300 - p.y * 900) / L)).toBeLessThanOrEqual(40.01);
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it', () => {
    const a = run();
    a.f.tick(200);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run();
    b.f.tick(1400);
    b.h.cancel();
    b.f.tick(5000);
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.onDone).not.toHaveBeenCalled();
    expect(b.host.querySelector('.hblast')).toBeNull();
    expect(b.camera.style.transform).toBe('');
    expect(b.attackerEl.style.transform).toBe('');
  });

  it('reduced motion: no Pixi layer, no camera or portrait move, just fades; the blow lands once', () => {
    const { h, f, root, onImpact, camera, host, defenderEl, attackerEl } = run({ reduced: true });
    expect(root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('9');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const h = playHeroQuake({
        parts: [{ value: 2, from: null }], total: 2, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 }, combineAt: { x: 400, y: 0 },
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false,
        mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + h.plan.hitStopMs + h.plan.slamStopMs + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('the ground scene (headless Pixi)', () => {
  it('a whole Tier IV quake (wind-up, slam, board cracks, travel, bursts, eruption, pillar, booms) stays inside the pool cap and drains; destroy leaves nothing', () => {
    const s = new HeroQuakeScene(TEX, COLORS, 1, 42);
    s.windup(100, 800, 70, 500, 4, 11);
    for (let i = 0; i < 20; i++) s.update(16);
    s.slam(100, 800, 70, { tier: 4, k: 1, width: 22, magma: 1, rocks: 10, dust: 1.4, boardCracks: 7, reach: 1500, heading: -0.46 });
    s.quake({ x: 100, y: 800 }, { x: 1400, y: 150 }, 70, 80, { travelMs: 720, width: 22, branches: 9, fissures: 3, magma: 1, segPx: 44, jag: 0.42, openPx: 170, branchLength: 0.13, grit: 1.6 });
    let peak = 0;
    for (let i = 0; i < 25; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    expect(s.front).toBeGreaterThan(0);
    expect(s.front).toBeLessThan(1);
    for (let i = 0; i < 5; i++) expect(s.burst(0.3 + i * 0.12, 1, 1)).not.toBeNull();
    for (let i = 0; i < 25; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    expect(s.front).toBe(1);
    s.erupt(1400, 150, 80, { tier: 4, k: 1, flashAlpha: 0.9, width: 22, magma: 1, rocks: 26, dust: 1.4, eruption: 1.5, crater: 1, craterMs: 1500, heading: -0.46, rockSize: 1 });
    s.pillar(1400, 150, 80, 380, 1.5, 13);
    for (let i = 0; i < 4; i++) s.boom(1400 + i * 20, 150, 1.2, 1);
    peak = Math.max(peak, s.liveSprites);
    expect(peak).toBeLessThanOrEqual(MAX_QUAKE_SPRITES);
    expect(s.pooledSprites).toBeLessThanOrEqual(MAX_QUAKE_SPRITES);
    expect(s.liveRocks).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) s.update(16);
    s.fade(420);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveCracks).toBe(0);
    expect(s.liveRocks).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('a Tier I quake is one thin crack: no branches, no magma glow sprites', () => {
    const s = new HeroQuakeScene(TEX, COLORS, 1, 3);
    s.quake({ x: 0, y: 0 }, { x: 1200, y: 0 }, 60, 60, { travelMs: 380, width: 5, branches: 0, fissures: 0, magma: 0, segPx: 44, jag: 0.42, openPx: 170, branchLength: 0.13, grit: 0.7 });
    expect(s.liveCracks).toBe(1);
    s.destroy();
  });

  it('clear() drops everything in flight at once', () => {
    const s = new HeroQuakeScene(TEX, COLORS, 1, 9);
    s.windup(0, 0, 60, 300, 2, 5);
    s.slam(0, 0, 60, { tier: 2, k: 0.33, width: 9, magma: 0.2, rocks: 4, dust: 0.9, boardCracks: 0, reach: 800, heading: 0 });
    s.quake({ x: 0, y: 0 }, { x: 800, y: 0 }, 60, 60, { travelMs: 400, width: 9, branches: 3, fissures: 0, magma: 0.2, segPx: 44, jag: 0.4, openPx: 170, branchLength: 0.13, grit: 1 });
    s.update(16);
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Tectonic Slam (attack_quake) is a Legendary crate hero attack that plays Quake; the dev override can force it', () => {
    expect(COSMETIC_INDEX.attack_quake).toMatchObject({ category: 'hero_attack', rarity: 'legendary', assets: { style: 'quake' }, active: true });
    expect(styleOfCosmetic('attack_quake')).toBe('quake');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_quake' })).toBe('quake');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'quake' })).toBe('quake');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_quake' })).toBe('classic');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'auto', attackerCosmeticId: 'attack_blast' })).toBe('blast');
    for (const bad of ['attack_gone', 'attack_quake_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
