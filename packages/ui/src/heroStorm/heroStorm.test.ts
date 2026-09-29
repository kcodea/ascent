// @vitest-environment jsdom
/**
 * STORM CALL, an EPIC hero attack (owner 2026-09-29: "build 5 animations that range from rare -> epic ... rare and epics
 * should only have 2 or 3 tiers to them and generally be less exciting, but still extremely clean and fun"): the shared
 * four damage tiers map to THREE looks (I small, II and III medium, IV big; a knockout plays big); the looks (a crackling
 * arc / a forked bolt that strikes twice with static / a storm cloud that drops a thick strike); the tuner; the pure
 * plan, bolt geometry and camera; the runner on the shared clock (the blow lands exactly ONCE, never on a tick; both
 * directions; replay; finish / cancel; cleanup; static jitter; the camera applied once); the headless scene (bolts are
 * strips under the batch limit, regenerated in place, pooled, bounded, drains, destroy leaves nothing); and the
 * cosmetic (Epic, style `storm`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_STORM_DEFAULTS, HERO_STORM_RANGES, STORM_CAPS, clampHeroStormValue, heroStormConfigJson, sanitizeHeroStormConfig, stormCameraAt,
  stormCameraFocus, stormCues, stormGeometry, stormLevel, stormPlan, type HeroStormConfig, type HeroStormNumKey,
} from './heroStormConfig';
import { ARC_POINTS, BOLT_POINTS, HeroStormScene, MAX_STORM_MESHES, MAX_STORM_SPRITES, type HeroStormTextures } from './heroStormScene';
import { playHeroStorm, staticJitter, stormSeed, type HeroStormOptions } from './heroStorm';
import { SPEC } from '../HeroStormTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroStormTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W, boltGlow: W, boltCore: W, puff: W, puff2: W,
};
const C = HERO_STORM_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false, knockout = false) => stormPlan({ total, distance, reduced, knockout, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xf4fbff, bolt: 0x58c2ff, violet: 0xa377ff, cloud: 0x262a44, side: 0x6fd4ff };
const LOOK = { width: 12, glow: 4.5, regenMs: 45, fadeMs: 160 };
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the three looks (an Epic maps the shared four tiers onto three)', () => {
  it('reads the SHARED tier (thresholds 6 / 12 / 20) and maps I small, II and III medium, IV big', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    expect([1, 2, 3, 4].map((t) => stormLevel(t as 1 | 2 | 3 | 4))).toEqual([1, 2, 2, 3]);
    for (let d = 0; d <= 60; d++) {
      const p = plan([d], d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level).toBe(stormLevel(tierOf(d)));
    }
    expect([P1, P2, P3, P4].map((p) => p.level)).toEqual([1, 2, 2, 3]);
  });

  it('a knockout always plays Big (the storm), whatever the number', () => {
    const ko = plan([2, 1], 3, 1600, false, true);
    expect([ko.tier, ko.level, ko.storm]).toEqual([4, 3, true]);
  });

  it('Small is one arc; Medium a trunk that forks into two striking branches; Big a call up to the sky and one thick strike', () => {
    expect(P1.bolts.map((b) => b.kind)).toEqual(['arc']);
    expect(P2.bolts.map((b) => b.kind)).toEqual(['trunk', 'branch', 'branch']);
    expect(P4.bolts.map((b) => b.kind)).toEqual(['call', 'strike']);
    expect(P4.bolts[1]!.width).toBeGreaterThan(P1.bolts[0]!.width * 2); // THICK
    expect(P4.bolts.filter((b) => b.strikes)).toHaveLength(1);
    expect(P2.bolts.filter((b) => b.strikes)).toHaveLength(2);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_STORM_RANGES)) {
      const v = C[k as HeroStormNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorBolt', 'colorViolet', 'colorCloud', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroStormValue('v1Forks', 99)).toBe(6);
    expect(clampHeroStormValue('regenMs', 1)).toBe(16);
    expect(clampHeroStormValue('gatherMs', 'abc')).toBe(C.gatherMs);
    expect(clampHeroStormValue('gatherMs', '600')).toBe(600);
    expect(clampHeroStormValue('colorBolt', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroStormValue('colorBolt', 'blue')).toBe(C.colorBolt);
    expect(clampHeroStormValue('sfxZapClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroStormValue('nope' as keyof HeroStormConfig, 1)).toBeUndefined();
    const s = sanitizeHeroStormConfig({ v3Sparks: 400, colorCore: 'x', bogus: 3 });
    expect(s.v3Sparks).toBe(60);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroStormConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Storm Call; buttons on top', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroStormConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.v3Width).toBe(C.v3Width);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('storm');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('storm');
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Medium (8)', '▶ Big (40)', '▶ Foe small (3)', '▶ Foe big (40)']) expect(labels).toContain(l);
    expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
  });
});

describe('the plan', () => {
  it('SMALL: the arc lands (THE impact) the moment its leader arrives; no ticks', () => {
    expect(P1.impactAt).toBe(P1.bolts[0]!.at + P1.bolts[0]!.leaderMs);
    expect(P1.hits).toEqual([]);
    const kinds = stormCues(P1).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds).not.toContain('gather');
  });

  it('MEDIUM: the first branch strikes (a tick), the second strikes `forkGapMs` later (THE impact); static crawls from the first', () => {
    expect(P2.hits).toHaveLength(1);
    expect(P2.impactAt - P2.hits[0]!).toBe(C.forkGapMs);
    const [trunk, b1, b2] = P2.bolts;
    expect(b1!.at).toBeCloseTo(trunk!.at + trunk!.leaderMs, 6); // the branch leaves the fork as the trunk arrives
    expect(b1!.at + b1!.leaderMs).toBe(P2.hits[0]);
    expect(b2!.at + b2!.leaderMs).toBe(P2.impactAt);
    expect(P2.staticAt).toBe(P2.hits[0]);
    expect(P2.staticEnd).toBeGreaterThan(P2.impactAt);
    const kinds = stormCues(P2).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.indexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
  });

  it('BIG: the call, the cloud gathers, rumbles twice, then the strike lands (THE impact); no ticks', () => {
    expect(P4.storm).toBe(true);
    expect(P4.gatherAt).toBeGreaterThan(P4.boltAt);
    expect(P4.rumbleAt).toBe(P4.gatherAt + C.gatherMs);
    expect(P4.rumbles).toHaveLength(2);
    for (const r of P4.rumbles) { expect(r).toBeGreaterThan(P4.rumbleAt); expect(r).toBeLessThan(P4.impactAt); }
    expect(P4.impactAt).toBe(P4.bolts[1]!.at + P4.bolts[1]!.leaderMs);
    expect(P4.hits).toEqual([]);
    const kinds = stormCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(at('gather')).toBeLessThan(at('rumble'));
    expect(kinds.lastIndexOf('rumble')).toBeLessThan(at('impact'));
  });

  it('short to medium, as an Epic should be (from the charge)', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.boltAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P4)]).toEqual([[380, 450, 1130], [380, 610, 1350], [320, 1373, 2233]]);
    expect(t(P4)[2]).toBeLessThanOrEqual(2800);
  });

  it('every look escalates: more shake, zoom, sparks, burst and dim', () => {
    const ps = [P1, P2, P4];
    for (let i = 1; i < 3; i++) for (const k of ['shakePx', 'zoom', 'sparks', 'burst', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    expect(P1.dim).toBe(0);
  });

  it('the caps always hold', () => {
    const wild: HeroStormConfig = { ...C, v2Forks: 6, v3Sparks: 60, v3Shake: 40, v3Zoom: 0.12 };
    const p = stormPlan({ total: 99, distance: 800 }, wild);
    expect(p.sparks).toBeLessThanOrEqual(STORM_CAPS.sparks);
    expect(p.shakePx).toBeLessThanOrEqual(STORM_CAPS.shakePx);
    for (const b of stormPlan({ total: 8, distance: 800 }, wild).bolts) expect(b.forks).toBeLessThanOrEqual(STORM_CAPS.forks);
  });

  it('reduced motion: no bolts, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.bolts.length]).toEqual([0, 0, 0, 0]);
    const kinds = stormCues(p).map((q) => q.kind);
    for (const k of ['charge', 'bolt', 'gather', 'rumble', 'hit']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(stormCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(stormGeometry(p, A, D, R, R, C).bolts).toEqual([]);
  });

  it('is deterministic (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(stormGeometry(P4, A, D, R, R, C, 1, { w: 1600, h: 900 })).toEqual(stormGeometry(P4, A, D, R, R, C, 1, { w: 1600, h: 900 }));
    expect(stormSeed(14, 1500.2, 'player')).toBe(stormSeed(14, 1500.4, 'player'));
    expect(stormSeed(14, 1500, 'player')).not.toBe(stormSeed(14, 1500, 'opp'));
    expect(staticJitter(1234)).toEqual(staticJitter(1239)); // one offset per 30 ms
    expect(staticJitter(1234)).not.toEqual(staticJitter(1290));
  });
});

describe('the bolt geometry', () => {
  it('Small arcs from the striker\'s rim into the struck face', () => {
    const g = stormGeometry(P1, A, D, R, R, C);
    expect(Math.hypot(g.bolts[0]!.from.x - A.x, g.bolts[0]!.from.y - A.y)).toBeLessThanOrEqual(R);
    expect(Math.hypot(g.bolts[0]!.to.x - D.x, g.bolts[0]!.to.y - D.y)).toBeLessThanOrEqual(R * 0.5);
  });

  it('Medium: the trunk ends where both branches start (the fork), and they land either side of the face', () => {
    const g = stormGeometry(P2, A, D, R, R, C);
    const [trunk, b1, b2] = g.bolts;
    expect(b1!.from).toEqual(trunk!.to);
    expect(b2!.from).toEqual(trunk!.to);
    expect(Math.hypot(b1!.to.x - b2!.to.x, b1!.to.y - b2!.to.y)).toBeGreaterThan(R * 0.6);
    for (const b of [b1!, b2!]) expect(Math.hypot(b.to.x - D.x, b.to.y - D.y)).toBeLessThanOrEqual(R * 0.8);
    expect(g.strikes).toEqual([b1!.to, b2!.to]);
  });

  it('Big: the cloud gathers ABOVE a target with room over it, and the strike DROPS from the cloud onto the face', () => {
    const g = stormGeometry(P4, D, A, R, R, C, 1, { w: 1600, h: 900 }); // the foe (top right) strikes you (bottom left)
    expect(g.cloud!.y).toBeLessThan(A.y - R * 1.5);
    expect(Math.abs(g.cloud!.x - A.x)).toBeLessThan(R * 0.5);
    const strike = g.bolts[1]!;
    expect(strike.to.y).toBeGreaterThan(strike.from.y + R); // a drop, not a sideways beam
    expect(Math.hypot(strike.to.x - A.x, strike.to.y - A.y)).toBeLessThan(R * 0.5);
    // With no room above (a hero at the top of the screen) the cloud rolls in over the top edge and still drops onto the face.
    const top = stormGeometry(P4, A, D, R, R, C, 1, { w: 1600, h: 900 });
    expect(top.cloud!.y).toBeLessThan(D.y);
    expect(top.bolts[1]!.to.y).toBeGreaterThan(top.bolts[1]!.from.y);
    expect(top.cloud!.x).toBeGreaterThanOrEqual(top.cloudR * 0.9);
    expect(top.cloud!.x).toBeLessThanOrEqual(1600 - top.cloudR * 0.9);
  });
});

describe('the camera', () => {
  it('pushes in through the charge, punches in on the impact and shakes along the blow; rests by the end', () => {
    const dir = { x: 0.8, y: -0.6 };
    const hit = stormCameraAt(P2, C, P2.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P2.zoom * 0.9);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P2.shakePx * 0.5);
    const rest = stormCameraAt(P2, C, P2.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.8);
  });

  it('Big: the focus moves from the hero to the target as the storm gathers; the zoom stays gentle', () => {
    expect(stormCameraFocus(P4, P4.chargeAt, A, D)).toEqual(A);
    expect(stormCameraFocus(P4, P4.rumbleAt, A, D)).toEqual(D);
    let peak = 1;
    for (let t = P4.chargeAt; t < P4.endAt; t += 8) peak = Math.max(peak, stormCameraAt(P4, C, t).zoom);
    expect(peak).toBeLessThan(1.2);
    expect(stormCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
  });
});

function manualFrames(): { frames: HeroStormOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroStormOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroStorm({
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

  it('MEDIUM lands the blow EXACTLY ONCE, on the second branch: never on the first; the portrait jitters with static; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 8, formation: formationOf([8], 8) });
    expect(h.plan.level).toBe(2);
    expect(host.querySelector('.hblast.hstorm')).not.toBeNull();
    f.tick(h.plan.hits[0]! + 20, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveBolts).toBe(2); // the trunk and the first branch; the second has not left the fork yet
    expect(h.scene!.staticActive).toBe(true);
    const jit: string[] = [];
    for (let i = 0; i < 12; i++) { f.tick(8, 4); jit.push(defenderEl.style.transform); }
    expect(new Set(jit).size).toBeGreaterThan(2); // it stutters
    f.tick(h.plan.impactAt - h.elapsed() - 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(16, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toContain('scale(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-8');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(3000, 16);
    expect(h.scene!.liveBolts).toBe(0);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('BIG: the cloud gathers and rumbles, the thick strike lands the blow ONCE, and the cloud breaks up', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.storm).toBe(true);
    f.tick(h.plan.rumbleAt + 20, 4);
    expect(h.scene!.cloudUp).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() + 12, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.staticActive).toBe(true);
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_STORM_SPRITES);
    expect(h.scene!.liveMeshes).toBeLessThanOrEqual(MAX_STORM_MESHES);
    f.tick(h.plan.endAt + 3000, 8);
    expect(h.scene!.cloudUp).toBe(false);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('a knockout blow of 3 plays the storm', () => {
    const { h } = run({ total: 3, knockout: true, formation: formationOf([3], 3) });
    expect(h.plan.storm).toBe(true);
    expect(h.geo.cloud).not.toBeNull();
    h.cancel();
  });

  it('works in both directions at every look, inside the caps', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peakS = 0, peakM = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peakS = Math.max(peakS, h.scene!.liveSprites); peakM = Math.max(peakM, h.scene!.liveMeshes); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peakS).toBeLessThanOrEqual(MAX_STORM_SPRITES);
        expect(peakM).toBeLessThanOrEqual(MAX_STORM_MESHES);
        for (const p of h.geo.strikes) expect(Math.hypot(p.x - d.x, p.y - d.y)).toBeLessThanOrEqual(R * 0.8);
        h.cancel();
      }
    }
  });

  it('THE CAMERA IS APPLIED ONCE: with the FX canvas inside the camera element the Pixi root never mirrors it', () => {
    const inCam = document.createElement('div');
    inCam.appendChild(document.createElement('canvas'));
    const a = run({ total: 40, formation: formationOf([40], 40), camera: inCam });
    a.f.tick(a.h.plan.impactAt + 20, 4);
    expect(inCam.style.transform).toContain('scale(');
    expect(a.h.scene!.root.scale.x).toBe(1);
    a.h.cancel();
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.impactAt + 20, 4);
    expect(b.h.scene!.root.scale.x).toBeGreaterThan(1);
    b.h.cancel();
  });

  it('a replay plays the same', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.geo).toEqual(b.h.geo);
    a.f.tick(a.h.plan.impactAt + 60, 8); b.f.tick(b.h.plan.impactAt + 60, 8);
    expect(a.h.scene!.liveSprites).toBe(b.h.scene!.liveSprites);
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
    const b = run({ total: 40 });
    b.f.tick(b.h.plan.rumbleAt + 50);
    b.h.cancel();
    b.f.tick(5000);
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.onDone).not.toHaveBeenCalled();
    expect(b.host.querySelector('.hblast')).toBeNull();
    expect(b.camera.style.transform).toBe('');
    expect(b.defenderEl.style.transform).toBe('');
    expect(b.root.children).toHaveLength(0);
  });

  it('reduced motion: no Pixi layer, no camera or portrait move; the blow lands once', () => {
    const { h, f, root, onImpact, camera, defenderEl } = run({ reduced: true, total: 40, formation: formationOf([40], 40) });
    expect(root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const h = playHeroStorm({
        formation: formationOf([25], 25), total: 25, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 },
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false, mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  it('bolts are strips under the 100-vertex batch limit, their jag regenerated in place (a live crackle), endpoints pinned', () => {
    expect(BOLT_POINTS * 2).toBeLessThanOrEqual(100);
    expect(ARC_POINTS * 2).toBeLessThanOrEqual(100);
    const s = new HeroStormScene(TEX, COLORS, LOOK, 1, 5);
    const g = stormGeometry(P1, A, D, R, R, C).bolts[0]!;
    s.bolt('arc', g, { leaderMs: 70, holdMs: 400, width: 1, jag: 0.08, forks: 2 });
    s.update(80);
    const layer = s.root.children.find((c) => c.label === 'storm-core') as Container;
    const mesh = layer.children.find((c) => c.visible && 'vertices' in c && (c as unknown as { vertices: Float32Array }).vertices.length === BOLT_POINTS * 4) as unknown as { vertices: Float32Array };
    const snap = Array.from(mesh.vertices);
    s.update(50); // past a regeneration
    const next = Array.from(mesh.vertices);
    expect(next).not.toEqual(snap); // the shape crackles
    // the ends stay pinned (the middle of the first and last cross-sections)
    const mid = (v: number[], j: number): [number, number] => [(v[j * 4]! + v[j * 4 + 2]!) / 2, (v[j * 4 + 1]! + v[j * 4 + 3]!) / 2];
    expect(mid(next, 0)[0]).toBeCloseTo(g.from.x, 3);
    expect(mid(next, BOLT_POINTS - 1)[1]).toBeCloseTo(g.to.y, 3);
    for (const v of next) expect(Number.isFinite(v)).toBe(true);
    s.destroy();
  });

  it('a whole Big stays in the caps and drains; destroy leaves nothing', () => {
    const s = new HeroStormScene(TEX, COLORS, LOOK, 1, 42);
    const g = stormGeometry(P4, A, D, R, R, C, 1, { w: 1600, h: 900 });
    s.setView(1600, 900);
    s.startCharge(A.x, A.y, R, 320, 2);
    s.bolt('call', g.bolts[0]!, { leaderMs: 90, holdMs: 130, width: 0.55, jag: 0.07, forks: 1 });
    s.gather(g.cloud!.x, g.cloud!.y, g.cloudR, 520);
    let peakS = 0, peakM = 0;
    const step = (n: number): void => { for (let i = 0; i < n; i++) { s.update(16); peakS = Math.max(peakS, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes); } };
    step(40);
    s.rumble(); step(10); s.rumble(); step(10);
    s.bolt('strike', g.bolts[1]!, { leaderMs: 60, holdMs: 380, width: 2.6, jag: 0.06, forks: 4 });
    step(4);
    s.strike(D.x, D.y, R, { level: 3, burst: 1.7, sparks: 32, flashAlpha: 0.9, screen: 0.3 });
    s.crawl(D.x, D.y, R, 700, 4);
    step(10);
    expect(peakS).toBeLessThanOrEqual(MAX_STORM_SPRITES);
    expect(peakM).toBeLessThanOrEqual(MAX_STORM_MESHES);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.cloudUp).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('clear() drops everything at once; the pools are reused, not regrown', () => {
    const s = new HeroStormScene(TEX, COLORS, LOOK, 1, 9);
    const g = stormGeometry(P2, A, D, R, R, C);
    const fire = (): void => { g.bolts.forEach((b, i) => s.bolt(i === 0 ? 'trunk' : 'branch', b, { leaderMs: 60, holdMs: 200, width: 1, jag: 0.08, forks: 2 })); s.crawl(D.x, D.y, R, 400, 3); s.update(16); };
    fire();
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.update(16)).toBe(false);
    fire();
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 4);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Storm Call (attack_storm) is an EPIC crate hero attack that plays `storm`; the dev override can force it; unknown ids play Classic', () => {
    expect(COSMETIC_INDEX.attack_storm).toMatchObject({ category: 'hero_attack', rarity: 'epic', name: 'Storm Call', assets: { style: 'storm' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('storm');
    expect(styleOfCosmetic('attack_storm')).toBe('storm');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_storm' })).toBe('storm');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'storm' })).toBe('storm');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_storm' })).toBe('classic');
  });
});
