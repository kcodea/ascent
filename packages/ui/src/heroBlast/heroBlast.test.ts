// @vitest-environment jsdom
/**
 * THE BLAST HERO ATTACK (owner 2026-09-28): the tuner defaults + clamping; the pure plan (the total is the engine's
 * number, the damage tiers escalate, the impact beat, reduced motion, determinism); the one-clock runner (the
 * consequence lands exactly once on the impact beat, the clock never pauses, both directions, any speed,
 * finish/cancel, cleanup); the headless Pixi scene (pooled, bounded, drains, destroy leaves nothing); and the style
 * resolver (Classic by default, Blast as the `attack_blast` cosmetic).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import {
  BLAST_CAPS, HERO_BLAST_DEFAULTS, HERO_BLAST_RANGES, blastCues, blastPlan, boltTravelMs,
  clampHeroBlastValue, heroBlastConfigJson, sanitizeHeroBlastConfig, tierOf, type HeroBlastConfig, type HeroBlastNumKey,
} from './heroBlastConfig';
import { HeroBlastScene, MAX_SPRITES, arcControl, bezier, boltEase, whiten } from './heroBlastScene';
import { cameraAt, cameraFocus, playHeroBlast, type HeroBlastOptions } from './heroBlast';
import { DEFAULT_HERO_ATTACK_STYLE, resolveHeroAttackStyle, styleOfCosmetic } from './heroAttackStyle';
import { attackerCosmeticOf } from './attackerCosmetic';
import { SPEC, previewParts } from '../HeroBlastTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const TEX = { glow: Texture.WHITE, spark: Texture.WHITE, streak: Texture.WHITE, ring: Texture.WHITE, beam: Texture.WHITE };
const C = HERO_BLAST_DEFAULTS;
/** A Blast after the shared damage formation for `[heroTier, ...minionTiers]` (the formation's length is the lead-in). */
const plan = (values: number[], total: number, distance = 1600, reduced = false) => blastPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_BLAST_RANGES)) {
      const v = C[k as HeroBlastNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroBlastValue('t2Bolts', 99)).toBe(6);
    expect(clampHeroBlastValue('t4Shake', -3)).toBe(0);
    expect(clampHeroBlastValue('t4Zoom', 5)).toBe(0.14);
    expect(clampHeroBlastValue('absorbMs', Number.NaN)).toBe(C.absorbMs);
    expect(clampHeroBlastValue('absorbMs', 'abc')).toBe(C.absorbMs);
    expect(clampHeroBlastValue('absorbMs', '300')).toBe(300);
    expect(clampHeroBlastValue('colorPlayer', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroBlastValue('colorPlayer', 'red')).toBe(C.colorPlayer);
    expect(clampHeroBlastValue('sfxImpactClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroBlastValue('nope' as keyof HeroBlastConfig, 1)).toBeUndefined();
    const s = sanitizeHeroBlastConfig({ t1Bolts: 40, colorCore: 'x', bogus: 3 });
    expect(s.t1Bolts).toBe(6);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroBlastConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroBlastConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Beam).toBe(1);
  });

  it('the preview splits a blow the way a fight does and always sums to it', () => {
    for (const [d, n] of [[3, 2], [12, 4], [40, 7], [1, 5]] as const) {
      const v = previewParts(d, n);
      expect(v.reduce((s, x) => s + x, 0), `${d}/${n}`).toBe(d);
      expect(v.every((x) => x >= 1)).toBe(true);
    }
  });
});

describe('the plan', () => {
  it('damage tiers: I 1-5, II 6-11, III 12-19, IV 20+ (the engine caps are 5 / 10 / 15 / 20 by round)', () => {
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => tierOf(d, C))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('every tier escalates: longer charge, harder shake and push, more sparks; FOUR distinct steps (1 / 2 / 5 bolts / the beam and supernova)', () => {
    const ps = [plan([3], 3), plan([3, 5], 8), plan([4, 4, 3, 3], 14), plan([6, 6, 6, 6, 6, 5, 5], 40)];
    expect(ps.map((p) => p.tier)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < 4; i++) {
      const a = ps[i - 1]!, b = ps[i]!;
      expect(b.fireAt - b.chargeAt, `charge ${i}`).toBeGreaterThan(a.fireAt - a.chargeAt);
      expect(b.shakePx, `shake ${i}`).toBeGreaterThan(a.shakePx);
      expect(b.zoom, `zoom ${i}`).toBeGreaterThan(a.zoom);
      expect(b.sparks, `sparks ${i}`).toBeGreaterThan(a.sparks);
    }
    expect(ps.map((p) => p.bolts.length)).toEqual([1, 2, 5, 1]);
    expect(ps.map((p) => p.beam)).toEqual([false, false, false, true]);
    expect(ps.map((p) => p.nova)).toEqual([false, false, false, true]);
    expect(ps.map((p) => p.novaRays > 0)).toEqual([false, false, false, true]);
    expect(ps.map((p) => p.booms.length)).toEqual([0, 0, 2, 4]);
    expect(ps[0]!.dim).toBe(0);
    expect(ps[3]!.dim).toBeGreaterThan(ps[1]!.dim);
  });

  it('the shipped per-tier timeline (1600 px apart): impact and end, ms', () => {
    // Timed from the charge: the style's own attack, after the shared damage formation (pinned in formation.test.ts).
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(plan([2, 1], 3)), t(plan([3, 3, 2], 8)), t(plan([3, 3, 3, 3, 2], 14)), t(plan([6, 6, 6, 6, 6, 5, 5], 40))]).toEqual([
      [586, 1230], [686, 1430], [846, 1849], [1619, 2884],
    ]);
  });

  it('Tier IV: the beam lands (a tick), holds, pours in and implodes, and the blow lands on the SUPERNOVA', () => {
    const p = plan([6, 6, 6, 6, 6, 5, 5], 40);
    expect(p.beamHitAt).toBe(p.bolts[0]!.arriveAt);
    expect(p.collapseAt).toBe(p.beamHitAt + C.beamHoldMs);
    expect(p.impactAt).toBe(p.collapseAt + C.collapseMs);
    const kinds = blastCues(p).map((c) => c.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.indexOf('fire')).toBeLessThan(kinds.indexOf('beamhit'));
    expect(kinds.indexOf('beamhit')).toBeLessThan(kinds.indexOf('collapse'));
    expect(kinds.indexOf('collapse')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds.indexOf('impact')).toBeLessThan(kinds.indexOf('boom'));
    // the lower tiers have no finale beats: the blow lands on the lead bolt, as before
    for (const q of [plan([3], 3), plan([3, 5], 8), plan([4, 4, 3, 3], 14)]) {
      expect(q.impactAt).toBe(q.bolts[0]!.arriveAt);
      expect(q.beamHitAt).toBe(q.impactAt);
      expect(blastCues(q).some((c) => c.kind === 'beamhit' || c.kind === 'collapse')).toBe(false);
    }
    // a nova needs the beam: switched on for a bolt tier, it is ignored
    const odd = blastPlan({ total: 14, distance: 1600 }, { ...C, t3Nova: 1 });
    expect(odd.nova).toBe(false);
    // the camera inhales through the implosion and hits hardest on the detonation
    const dir = { x: 1, y: 0 };
    expect(cameraAt(p, C, p.impactAt - 1, dir).zoom).toBeGreaterThan(cameraAt(p, C, p.collapseAt, dir).zoom);
    expect(cameraAt(p, C, p.impactAt, dir).zoom).toBeCloseTo(1 + p.zoom + p.punch, 5);
    const a = { x: 100, y: 900 }, d = { x: 1700, y: 150 };
    expect(cameraFocus(p, p.beamHitAt, a, d)).toEqual(d);
  });

  it('beats run in order: the charge starts where the damage formation ends, fire, IMPACT, hits and booms, end', () => {
    const p = plan([3, 1, 2, 4, 4], 14);
    expect(p.chargeAt).toBe(leadInOf([3, 1, 2, 4, 4]));
    expect(p.impactAt).toBe(p.bolts[0]!.fireAt + p.bolts[0]!.travelMs);
    const kinds = blastCues(p).map((c) => c.kind);
    expect(kinds[0]).toBe('charge');
    expect(kinds.indexOf('charge')).toBeLessThan(kinds.indexOf('fire'));
    expect(kinds.indexOf('fire')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds.indexOf('impact')).toBeLessThan(kinds.indexOf('boom'));
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe('end');
  });

  it('bolt flight scales with distance inside a readable band; the caps always hold', () => {
    expect(boltTravelMs(560, 5600)).toBe(180);
    expect(boltTravelMs(1680, 5600)).toBe(300);
    expect(boltTravelMs(99999, 5600)).toBe(420);
    const wild: HeroBlastConfig = { ...C, t4Beam: 0, t4Bolts: 6, t4Shake: 40, t4Zoom: 0.14, t4Sparks: 70, t4Booms: 6 };
    const w = blastPlan({ total: 99, distance: 800 }, wild);
    expect(w.bolts.length).toBeLessThanOrEqual(BLAST_CAPS.bolts);
    expect(w.shakePx).toBeLessThanOrEqual(BLAST_CAPS.shakePx);
    expect(w.zoom).toBeLessThanOrEqual(BLAST_CAPS.zoom);
    expect(w.booms.length).toBeLessThanOrEqual(BLAST_CAPS.booms);
  });

  it('reduced motion: no flight, bolts, shake, zoom, dim or hit-stop; the blow still lands once', () => {
    const p = plan([3, 4], 7, 800, true);
    expect(p.bolts).toEqual([]);
    expect([p.shakePx, p.zoom, p.dim]).toEqual([0, 0, 0]);
    expect(blastCues(p).filter((c) => c.kind === 'impact')).toHaveLength(1);
    expect(cameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('the camera: pushes in through the charge, punches on impact, shakes ALONG the line of fire, rests by the end', () => {
    const p = plan([3, 4], 7);
    const dir = { x: 0.8, y: -0.6 };
    expect(cameraAt(p, C, p.chargeAt - 1, dir).zoom).toBeCloseTo(1, 5);
    expect(cameraAt(p, C, p.fireAt, dir).zoom).toBeCloseTo(1 + p.zoom, 5);
    const hit = cameraAt(p, C, p.impactAt, dir);
    expect(hit.zoom).toBeCloseTo(1 + p.zoom + p.punch, 5);
    // the impact frame is displaced along the bolt (the frame the hit-stop holds)
    expect(hit.x / p.shakePx).toBeCloseTo(dir.x, 1);
    expect(hit.y / p.shakePx).toBeCloseTo(dir.y, 1);
    const rest = cameraAt(p, C, p.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.1);
  });

  it('the camera anchors on the attacker through the charge and on the target from the impact', () => {
    const p = plan([3, 4], 7);
    const a = { x: 100, y: 900 }, d = { x: 1700, y: 150 };
    expect(cameraFocus(p, p.chargeAt, a, d)).toEqual(a);
    expect(cameraFocus(p, p.impactAt, a, d)).toEqual(d);
    const mid = cameraFocus(p, (p.fireAt + p.impactAt) / 2, a, d);
    expect(mid.x).toBeGreaterThan(a.x);
    expect(mid.x).toBeLessThan(d.x);
  });

  it('is deterministic: the same fight plans the same beats (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3], 9, 720)).toEqual(plan([4, 2, 3], 9, 720));
    expect(blastCues(plan([4, 2, 3], 9, 720))).toEqual(blastCues(plan([4, 2, 3], 9, 720)));
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroBlastOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBlastOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBlast({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 },
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('lands the blow EXACTLY ONCE on the impact beat, HOLDS the hit-stop, then ends and cleans everything up', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run();
    expect(host.querySelectorAll('.dform-chip')).toHaveLength(2);
    f.tick(h.plan.impactAt - 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(12, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    // the hit-stop: real time passes, the sequence clock does not
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('scale(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(3000, 16); // the embers drain, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('works in both directions (the impact lands at whichever hero is struck), and the top tier fires the beam', () => {
    for (const side of ['player', 'opp'] as const) {
      const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
      const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
      const { h, f, onImpact } = run({ side, attacker: a, defender: d, total: 40 });
      expect(h.plan.beam).toBe(true);
      expect(h.plan.nova).toBe(true);
      f.tick(h.plan.beamHitAt + 40, 4);
      expect(onImpact, `${side}: the beam landing is only a tick`).not.toHaveBeenCalled();
      f.tick(h.plan.impactAt - h.plan.beamHitAt - 24, 4);
      expect(onImpact, side).toHaveBeenCalledTimes(1);
      h.cancel();
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

  it('the formation ends on the ENGINE total (capped here), and the hit number shows the same blow', () => {
    const { h, f, host } = run({ total: 7, formation: formationOf([3, 2, 4], 7) }); // the full 9, capped to 7
    f.tick(h.plan.chargeAt + 20, 4);
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('7');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-7');
    h.cancel();
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
    b.f.tick(1200);
    b.h.cancel();
    b.f.tick(5000);
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.onDone).not.toHaveBeenCalled();
    expect(b.host.querySelector('.hblast')).toBeNull();
    expect(b.camera.style.transform).toBe('');
  });

  it('reduced motion: no Pixi layer, no camera or portrait move, just fades; the blow lands once', () => {
    const { h, f, root, onImpact, camera, host, defenderEl } = run({ reduced: true });
    expect(root.children).toHaveLength(0);
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('9');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const h = playHeroBlast({
        formation: formationOf([2], 2), total: 2, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 },
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
  it('pure helpers: the bolt accelerates, the arc bows sideways and ends on target, whiten blends to white', () => {
    expect(boltEase(0)).toBe(0);
    expect(boltEase(1)).toBe(1);
    expect(boltEase(0.75) - boltEase(0.5)).toBeGreaterThan(boltEase(0.25) - boltEase(0));
    const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
    expect(arcControl(a, b, 0.2).y).toBeCloseTo(20);
    expect(bezier(a, arcControl(a, b, 0.2), b, 1)).toEqual(b);
    expect(whiten(0x000000, 1)).toBe(0xffffff);
    expect(whiten(0xff0000, 0)).toBe(0xff0000);
  });

  it('a whole top-tier blast (charge, beam, impact, supernova, booms) drains to idle inside the pool cap; destroy leaves nothing', () => {
    const s = new HeroBlastScene(TEX, { core: 0xffffff, side: 0xffaa00 });
    s.startCharge(100, 800, 260, 1.4, 44);
    for (let i = 0; i < 16; i++) s.update(16);
    expect(s.charging).toBe(true);
    s.beam({ x: 100, y: 800 }, { x: 1400, y: 150 }, 240, 230, 2.2);
    for (let i = 0; i < 6; i++) s.fire({ x: 100, y: 800 }, { x: 1400, y: 150 }, 300, 1.4, (i % 2 ? 1 : -1) * 0.12);
    for (let i = 0; i < 25; i++) s.update(16);
    s.impact(1400, 150, { x: 1, y: -0.5 }, 1, 1.6, 1, 60, 130, 4);
    for (let i = 0; i < 4; i++) s.boom(1400 + i * 20, 150, 1.4);
    s.hit(1400, 150, { x: 1, y: -0.5 }, 1);
    s.nova(1400, 150, { x: 1, y: -0.5 }, 2.5, 20);
    expect(s.liveSprites).toBeLessThanOrEqual(MAX_SPRITES);
    expect(s.liveSprites).toBeLessThanOrEqual(MAX_SPRITES);
    expect(s.pooledSprites).toBeLessThanOrEqual(MAX_SPRITES);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveBolts).toBe(0);
    expect(s.charging).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('the supernova: the beam pours into the target (its tail chases its front), the implosion gathers, the nova releases it', () => {
    const s = new HeroBlastScene(TEX, { core: 0xffffff, side: 0xffaa00 });
    s.beam({ x: 0, y: 0 }, { x: 1000, y: 0 }, 200, 200, 2, 0, 300);
    for (let i = 0; i < 26; i++) s.update(16); // past travel + hold: the pour has begun
    expect(s.liveBolts).toBe(1);
    const tail = s.root.children.filter((c) => c.visible && c.scale.x > 1 && c.position.x > 1);
    expect(tail.length).toBeGreaterThan(0); // the beam's body now starts part-way along, not at the hero
    s.beamHit(1000, 0, { x: 1, y: 0 }, 1.3);
    s.collapse(1000, 0, 300, 1.4, 30);
    expect(s.charging).toBe(true);
    for (let i = 0; i < 20; i++) s.update(16);
    expect(s.liveBolts).toBe(0); // fully poured in
    s.impact(1000, 0, { x: 1, y: 0 }, 1, 1.6, 1, 36, 120, 4);
    s.nova(1000, 0, { x: 1, y: 0 }, 1, 12);
    expect(s.liveSprites).toBeLessThanOrEqual(MAX_SPRITES);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.charging).toBe(false);
    s.destroy();
  });

  it('clear() drops everything in flight at once', () => {
    const s = new HeroBlastScene(TEX, { core: 1, side: 2 });
    s.startCharge(0, 0, 200, 1, 20);
    s.fire({ x: 0, y: 0 }, { x: 500, y: 0 }, 200, 1, 0);
    s.beam({ x: 0, y: 0 }, { x: 500, y: 0 }, 200, 200, 2);
    s.collapse(500, 0, 300, 1, 20);
    s.impact(500, 0, { x: 1, y: 0 }, 0.5, 1, 1, 30);
    s.clear();
    expect(s.charging).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    s.destroy();
  });
});

describe('the attack style', () => {
  it('players see Classic by default; the dev override forces a style for both sides', () => {
    expect(DEFAULT_HERO_ATTACK_STYLE).toBe('classic');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'auto' })).toBe('classic');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'blast' })).toBe('blast');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_blast' })).toBe('classic');
  });

  it('an equipped cosmetic picks its style (Arcane Barrage plays Blast); a retired or unknown id falls back to Classic', () => {
    expect(COSMETIC_INDEX.attack_blast).toMatchObject({ category: 'hero_attack', rarity: 'legendary', assets: { style: 'blast' } });
    expect(styleOfCosmetic('attack_blast')).toBe('blast');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_blast' })).toBe('blast');
    for (const bad of ['attack_gone', 'toString', 'skin_albus_1', 'title_wanderer', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });

  it('the attacker recorded cosmetic: yours from the run; theirs from the seat, only while opponent cosmetics show', () => {
    expect(attackerCosmeticOf({ cosmetics: { heroAttack: 'attack_blast' }, lobby: undefined }, 'player', false)).toBe('attack_blast');
    expect(attackerCosmeticOf({ cosmetics: undefined, lobby: undefined }, 'player', true)).toBeNull();
    expect(attackerCosmeticOf({ cosmetics: { heroAttack: 'attack_blast' }, lobby: undefined }, 'opp', true)).toBeNull();
  });
});
