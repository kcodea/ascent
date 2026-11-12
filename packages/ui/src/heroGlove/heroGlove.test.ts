// @vitest-environment jsdom
/**
 * THE SUCKER PUNCH HERO ATTACK (style id `glove`, a Rare; built 2026-11-12): the shared tiers on TWO visual tiers (I-II
 * small, III-IV big, a knockout big); the tuner values; the pure plan (Small: one bop, THE impact; Big: a tick bop, an
 * overshoot and a sway, then the rebound bop, THE impact; the retract and the hatch come AFTER the blow); the pure
 * geometry and pose of the glove on its spring (from the hatch to the face and home again, at any distance and angle,
 * on screen, the coil always the same length of wire); the runner on the shared clock (the blow lands exactly ONCE; both
 * directions; replay; finish / cancel; cleanup; the camera applied once); the headless scene.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES } from '../heroBlast/heroAttackStyle';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';
import {
  GLOVE_CAPS, HERO_GLOVE_DEFAULTS, HERO_GLOVE_RANGES, coilAmp, gloveCues, gloveLevel, gloveMotion, glovePlan, glovePos, glovePoseAt,
  newGlovePose, clampHeroGloveValue, heroGloveConfigJson, type GloveGeometry, type HeroGloveNumKey,
} from './heroGloveConfig';
import { HeroGloveScene, MAX_GLOVE_SPRITES, type HeroGloveTextures } from './heroGloveScene';
import { gloveSeed, playHeroGlove, type HeroGloveOptions } from './heroGlove';
import { SPEC } from '../HeroGloveTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroGloveTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W, glove: W, gloveTrim: W, coil: W, hatch: W, star5: W, burst: W,
};
const C = HERO_GLOVE_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean; distance?: number } = {}) => glovePlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const geo = (o: Partial<GloveGeometry> = {}): GloveGeometry => ({ attacker: A, defender: D, radius: R, aRadius: R, glovePx: C.glovePx, pitchPx: C.springPitch, seed: 4, ...o });
const COLORS = { glove: 0xe8281e, trim: 0xfff6e6, spring: 0xc4ccd6, hatch: 0xd6a24a, star: 0xffd447, flash: 0xfffbe6, side: 0xffd98a };
const LOOK = { hatchPx: 64, springWidth: 19, springThick: 7, bop: 1, squash: 0.3, closeMs: 160 };

describe('the tiers: the shared four onto a Rare\'s two', () => {
  it('uses the shared thresholds; I-II small, III-IV big; a knockout big', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).level, `dmg ${d}`).toBe(tierOf(d) >= 3 ? 'big' : 'small');
    expect([1, 2, 3, 4].map((t) => gloveLevel(t as 1 | 2 | 3 | 4))).toEqual(['small', 'small', 'big', 'big']);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, level: 'big' });
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top; its own clips', () => {
    for (const [k, [min, max]] of Object.entries(HERO_GLOVE_RANGES)) {
      const v = C[k as HeroGloveNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroGloveValue('bigStars', 99)).toBe(5);
    expect(clampHeroGloveValue('colorGlove', 'red')).toBe(C.colorGlove);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroGloveConfigJson(C)).previewParts).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('glove');
    expect(C.sfxBoingClip).toBe('fx/glove-boing');
    expect(C.sfxPunchClip).toBe('fx/glove-punch');
    expect(ATTACK_FX_CLIPS.glove).toEqual(expect.arrayContaining([C.sfxBoingClip, C.sfxPunchClip]));
  });
});

describe('the plan', () => {
  it('SMALL: pop, fire, ONE bop (the impact), then the retract and home; short (a Rare)', () => {
    const p = plan(3);
    expect(p.hits).toEqual([]);
    expect(p.stars).toBe(0);
    expect(p.popAt).toBeGreaterThan(p.chargeAt);
    expect(p.fireAt).toBeGreaterThan(p.popAt + 100);
    expect(p.impactAt).toBeGreaterThan(p.fireAt);
    expect(p.retractAt).toBeGreaterThan(p.impactAt);
    expect(p.homeAt).toBeGreaterThan(p.retractAt);
    expect(p.endAt).toBeGreaterThan(p.homeAt);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(1500);
    expect(gloveCues(p).map((q) => q.kind)).toEqual(['charge', 'pop', 'fire', 'impact', 'retract', 'home', 'end']);
  });

  it('BIG: a wind up, a tick bop, a wobble, then THE impact on the rebound; stars; everything after the blow', () => {
    const p = plan(14);
    expect(p.hits).toHaveLength(1);
    expect(p.wind).toBe(1);
    expect(p.over).toBeGreaterThan(0);
    expect(p.stars).toBe(3);
    expect(p.hits[0]!).toBeGreaterThan(p.fireAt);
    expect(p.impactAt - p.hits[0]!).toBeGreaterThanOrEqual(260); // room to overshoot, sway and rebound
    expect(p.retractAt).toBeGreaterThan(p.impactAt);
    expect(p.endAt).toBeGreaterThanOrEqual(p.impactAt + p.starsMs); // the stars are gone before the end
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(2400);
    const kinds = gloveCues(p).map((q) => q.kind);
    expect(kinds).toEqual(['charge', 'pop', 'fire', 'hit', 'impact', 'retract', 'home', 'end']);
    expect(plan(40).impactAt).toBe(p.impactAt); // III and IV are the same look
  });

  it('a closer pair punches sooner; reduced motion: no glove, the blow lands at the end of the formation', () => {
    expect(plan(3, { distance: 500 }).impactAt).toBeLessThan(plan(3).impactAt);
    const p = plan(14, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([14], true));
    expect(gloveMotion(p, geo())).toBeNull();
    expect(gloveCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
  });
});

describe('the glove on its spring', () => {
  const pose = newGlovePose();

  it('the hatch is on the edge of the striker facing the target, and the bop is on the face: every angle and distance', () => {
    const spots = [
      [A, D], [D, A], [{ x: 300, y: 500 }, { x: 1600, y: 500 }], [{ x: 960, y: 900 }, { x: 960, y: 200 }],
      [{ x: 700, y: 500 }, { x: 1000, y: 560 }], [{ x: 1000, y: 300 }, { x: 760, y: 420 }],
    ] as const;
    for (const total of [3, 40]) {
      for (const [a, d] of spots) {
        const p = plan(total, { distance: Math.hypot(d.x - a.x, d.y - a.y) });
        const m = gloveMotion(p, geo({ attacker: a, defender: d }))!;
        const tag = `${total} ${a.x},${a.y} -> ${d.x},${d.y}`;
        expect(Math.hypot(m.base.x - a.x, m.base.y - a.y), tag).toBeCloseTo(R * 0.86, 3);
        // the hatch is on the line to the target, and the bop is on that line too, inside the struck portrait
        expect((m.base.x - a.x) * m.u.x + (m.base.y - a.y) * m.u.y, tag).toBeGreaterThan(0);
        expect(Math.hypot(m.hit.x - d.x, m.hit.y - d.y), tag).toBeLessThanOrEqual(R * 1.05);
        expect(m.segs % 2, tag).toBe(0);
        expect(m.segs, tag).toBeLessThanOrEqual(GLOVE_CAPS.segs);
        // at the bop the glove is exactly on the spot; before the pop and after it is home it is put away
        const at = glovePos(m, m.tImpact);
        expect(Math.hypot(at.x - m.hit.x, at.y - m.hit.y), tag).toBeLessThan(0.5);
        expect(glovePoseAt(m, -5, 0.3, pose).vis, tag).toBe(0);
        expect(glovePoseAt(m, m.tHome + 1, 0.3, pose).vis, tag).toBe(0);
        // the whole punch stays on a 1920 x 1080 screen, and the spring never needs more wire than it has
        let far = 0;
        for (let t = 0; t <= m.tHome; t += 4) {
          const q = glovePoseAt(m, t, 0.3, pose);
          expect(Number.isFinite(q.ext + q.lat + q.bow + q.sx + q.sy), tag).toBe(true);
          const x = m.base.x + m.u.x * q.ext + m.n.x * q.lat, y = m.base.y + m.u.y * q.ext + m.n.y * q.lat;
          expect(x, tag).toBeGreaterThan(0); expect(x, tag).toBeLessThan(1920);
          expect(y, tag).toBeGreaterThan(0); expect(y, tag).toBeLessThan(1080);
          far = Math.max(far, Math.hypot(q.ext, q.lat));
        }
        expect(far, tag).toBeLessThanOrEqual(m.wire * m.segs);
      }
    }
  });

  it('SMALL: out along the line to one bop, a little bounce off it, and home', () => {
    const m = gloveMotion(plan(3), geo())!;
    expect(m.double).toBe(false);
    expect(m.over).toBe(0);
    let last = -1;
    for (let t = m.tFire; t <= m.tHit; t += 4) { const e = glovePoseAt(m, t, 0, pose).ext; expect(e).toBeGreaterThanOrEqual(last); last = e; }
    expect(glovePoseAt(m, m.tHit, 0, pose).ext).toBeCloseTo(m.len, 3);
    expect(glovePoseAt(m, m.tImpact + 120, 0, pose).ext).toBeLessThan(m.len); // bounced off
    expect(glovePoseAt(m, m.tHome - 1, 0, pose).ext).toBeLessThan(m.peek * 0.5); // nearly in
    // it squashes on the bop
    expect(glovePoseAt(m, m.tImpact + 4, 0.3, pose).sx).toBeLessThan(0.85);
  });

  it('BIG: winds back, bops, overshoots PAST the face, sways both ways, draws back and rebounds into the second bop', () => {
    const m = gloveMotion(plan(40), geo())!;
    expect(m.double).toBe(true);
    // the wind up: squeezed back from the peek
    expect(glovePoseAt(m, m.tFire - 2, 0, pose).ext).toBeLessThan(m.peek * 0.5);
    expect(glovePoseAt(m, m.tHit, 0, pose).ext).toBeCloseTo(m.len, 3);
    let peak = 0, low = Infinity, left = 0, right = 0;
    for (let t = m.tHit; t <= m.tImpact; t += 2) {
      const q = glovePoseAt(m, t, 0, pose);
      peak = Math.max(peak, q.ext); low = Math.min(low, q.ext);
      left = Math.min(left, q.lat); right = Math.max(right, q.lat);
    }
    expect(peak).toBeGreaterThan(m.len + m.over * 0.95);
    expect(low).toBeLessThan(m.len - m.back * 0.95);
    expect(right).toBeGreaterThan(R * 0.2);
    expect(left).toBeLessThan(-R * 0.2);
    // the rebound arrives on the spot, square on
    const end = glovePoseAt(m, m.tImpact - 0.01, 0, pose);
    expect(end.ext).toBeCloseTo(m.len, 0);
    expect(Math.abs(end.lat)).toBeLessThan(1);
  });

  it('the coil: fat when squeezed, thin when stretched, never wider than its cap; the seed picks the side', () => {
    const m = gloveMotion(plan(40), geo())!;
    expect(coilAmp(m, 10, 19)).toBe(19);
    expect(coilAmp(m, m.len, 19)).toBeLessThan(coilAmp(m, m.len * 0.5, 19) + 1e-9);
    expect(coilAmp(m, m.len + m.over, 19)).toBeGreaterThan(2); // still a zig-zag at full stretch
    expect(coilAmp(m, m.wire * m.segs + 50, 19)).toBe(0);
    expect(gloveMotion(plan(40), geo({ seed: 4 }))!.side).toBe(1);
    expect(gloveMotion(plan(40), geo({ seed: 7 }))!.side).toBe(-1);
    expect(gloveSeed(12, 900, 'player')).toBe(gloveSeed(12, 900, 'player'));
  });
});

function manualFrames(): { frames: HeroGloveOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroGloveOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  attackerEl.className = 'hero-a keep'; defenderEl.className = 'hero-d keep';
  attackerEl.style.opacity = '0.9'; defenderEl.style.filter = 'none';
  document.body.append(host, camera);
  const h = playHeroGlove({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

/** Both portraits exactly as they were handed in. */
function expectRestored(r: ReturnType<typeof run>): void {
  for (const el of [r.attackerEl, r.defenderEl]) expect(el.style.transform).toBe('');
  expect(r.attackerEl.className).toBe('hero-a keep');
  expect(r.defenderEl.className).toBe('hero-d keep');
  expect(r.attackerEl.style.opacity).toBe('0.9');
  expect(r.defenderEl.style.filter).toBe('none');
  expect(r.camera.style.transform).toBe('');
  expect(r.host.querySelector('.hblast')).toBeNull();
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('BIG: the blow lands ONCE on the second bop, never the first; stars circle; everything is put back', () => {
    const r = run({ total: 14, formation: formationOf([14], 14) });
    const { h, f, root, onImpact, onDone, host, attackerEl, defenderEl } = r;
    expect(host.querySelector('.hblast.hglove')).not.toBeNull();
    f.tick(h.plan.popAt + 60, 4);
    expect(h.scene!.punching).toBe(true);
    expect(h.scene!.gloveOut).toBe(true);
    expect(h.scene!.liveCoils).toBe(h.motion!.segs);
    f.tick(h.plan.fireAt - h.elapsed() - 8, 4);
    expect(attackerEl.style.transform).toContain('translate('); // leaning back with the wind up
    f.tick(h.plan.hits[0]! - h.elapsed() + 8, 4);
    expect(onImpact).not.toHaveBeenCalled(); // the first bop is a tick
    expect(defenderEl.style.transform).toContain('translate('); // nudged
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    expect(h.scene!.liveDizzy).toBe(3);
    expect(defenderEl.style.transform).toContain('scale('); // knocked back and squashed
    f.tick(h.plan.homeAt - h.elapsed() + 8, 4);
    expect(h.scene!.gloveOut).toBe(false); // back in the hatch
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    f.tick(3000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('SMALL: one bop is the blow; the glove follows the pure pose; put back at the end', () => {
    const r = run({ total: 3, formation: formationOf([3], 3) });
    const { h, f, onImpact } = r;
    f.tick(h.plan.impactAt - 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    const want = glovePos(h.motion!, h.elapsed() - h.plan.popAt);
    const got = h.scene!.glovePoint;
    expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(1);
    f.tick(16, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveDizzy).toBe(0);
    f.tick(h.plan.endAt - h.elapsed() + 16, 8);
    expectRestored(r);
  });

  it('both directions at every tier, within the cap; the camera applied once when the canvas rides it', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const r = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        const { h, f, onImpact } = r;
        let peak = 0;
        for (let t = 0; t < h.plan.endAt + 32; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_GLOVE_SPRITES);
        expect(h.done, `${side} ${total}`).toBe(true);
        expectRestored(r);
      }
    }
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const { h, f, root } = run({ camera, total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.impactAt + 20, 4);
    expect(h.mirrorsCamera).toBe(false);
    expect((root.children[0] as Container).scale.x).toBe(1);
    h.cancel();
  });

  it('every exit restores the portraits: finish() lands once, cancel() never lands, at any beat', () => {
    const p = run({ total: 40, formation: formationOf([40], 40) }).h.plan;
    for (const at of [p.popAt + 30, p.fireAt + 20, p.hits[0]! + 40, p.impactAt + 30, p.retractAt + 60, p.homeAt + 20]) {
      const a = run({ total: 40, formation: formationOf([40], 40) });
      a.f.tick(at, 8);
      a.h.finish();
      a.h.finish();
      expect(a.onImpact, `finish at ${at}`).toHaveBeenCalledTimes(1);
      expect(a.onDone).toHaveBeenCalledTimes(1);
      expectRestored(a);
      expect(a.f.hooked()).toBe(0);
      expect(a.root.children).toHaveLength(0);
      const b = run({ total: 40, formation: formationOf([40], 40) });
      b.f.tick(at, 8);
      const landed = b.onImpact.mock.calls.length;
      b.h.cancel();
      expect(b.onImpact.mock.calls.length, `cancel at ${at}`).toBe(landed);
      expect(landed).toBe(at >= p.impactAt ? 1 : 0);
      expectRestored(b);
      expect(b.f.hooked()).toBe(0);
      expect(b.root.children).toHaveLength(0);
    }
  });

  it('deterministic: a replay plays the same; the roll seed picks the side; reduced motion lands once with no scene', () => {
    const x = run({ total: 40, formation: formationOf([40], 40) });
    const y = run({ total: 40, formation: formationOf([40], 40) });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.motion).toEqual(y.h.motion);
    x.f.tick(x.h.plan.impactAt - 100, 8); y.f.tick(y.h.plan.impactAt - 100, 8);
    expect(x.h.scene!.glovePoint).toEqual(y.h.scene!.glovePoint);
    x.h.cancel(); y.h.cancel();
    const s1 = run({ total: 40, formation: formationOf([40], 40), rollSeed: 10 });
    const s2 = run({ total: 40, formation: formationOf([40], 40), rollSeed: 11 });
    expect(s1.h.motion!.side).toBe(-s2.h.motion!.side);
    s1.h.cancel(); s2.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    expect(r.h.motion).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });
});

describe('the scene (headless Pixi)', () => {
  it('takes the hatch, the coil and the glove once, stays under the cap, drains, and destroy leaves nothing', () => {
    const scene = new HeroGloveScene(TEX, COLORS, LOOK, 1, 3);
    const m = gloveMotion(plan(40), geo())!;
    scene.pop(m);
    scene.pop(m); // once per scene
    expect(scene.liveCoils).toBe(m.segs);
    const pooled = scene.pooledSprites;
    for (let t = 0; t <= m.tHit; t += 16) scene.update(16);
    scene.fire();
    scene.bop(m.hit, m.u, 0.8, 3);
    for (let t = m.tHit; t < m.tImpact; t += 16) scene.update(16);
    scene.bop(m.hit, m.u, 1.3, 7);
    scene.seeStars(D, 50, 14, 3, 900, 34);
    scene.seeStars(D, 50, 14, 3, 900, 34); // once per scene
    expect(scene.liveDizzy).toBe(3);
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_GLOVE_SPRITES);
    expect(scene.pooledSprites).toBeGreaterThan(pooled); // the FX were made, the glove and coil were not remade
    // the glove is turned to follow the punch and its knuckles lead it
    const g = scene.glovePoint, k = scene.knuckles;
    expect((k.x - g.x) * m.u.x + (k.y - g.y) * m.u.y).toBeGreaterThan(0);
    scene.home();
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.punching).toBe(false);
    expect(scene.liveSprites).toBe(0);
    expect(scene.liveCoils).toBe(0);
    expect(scene.liveDizzy).toBe(0);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });

  it('a full pool skips the punch cleanly (nothing half made)', () => {
    const scene = new HeroGloveScene(TEX, COLORS, LOOK, 1, 3);
    const m = { ...gloveMotion(plan(40), geo())!, segs: 400 };
    scene.pop(m);
    expect(scene.punching).toBe(false);
    for (let i = 0; i < 40; i++) scene.update(16); // the pre-warm drains
    expect(scene.liveSprites).toBe(0);
    scene.destroy();
  });
});
