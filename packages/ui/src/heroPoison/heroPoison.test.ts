// @vitest-environment jsdom
/**
 * THE POISON DARTS HERO ATTACK (owner 2026-09-28: "branch off and make a poison dart animation. the final one should
 * throw multiple poison darts that implode with poison"): the tier mapping SHARED with every style; the tier -> darts
 * ladder (1 / 2 / 5 / six that implode); the tuner defaults + clamping; the pure plan (the total is the engine's number,
 * the volley rhythm, the impact beat, the implosion at IV, reduced motion, determinism); the pure dart paths (a slight
 * arc that comes down onto the struck portrait and sticks at varied angles); the camera; the runner on the shared clock
 * (the consequence lands exactly ONCE, on the last dart or the burst, never on a tick; both directions; slow motion;
 * replay; finish / cancel; cleanup; stuck darts ride the knockback); the headless scene (pooled, bounded, drains,
 * destroy leaves nothing); and the cosmetic resolution (the other styles unchanged).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_ARCANA_DEFAULTS, arcanaPlan } from '../heroArcana/heroArcanaConfig';
import { HERO_BLAST_DEFAULTS, blastPlan } from '../heroBlast/heroBlastConfig';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_POISON_DEFAULTS, HERO_POISON_RANGES, POISON_CAPS, clampHeroPoisonValue, dartEase, dartMotions, dartPos, fanSlots,
  heroPoisonConfigJson, poisonCameraAt, poisonCameraFocus, poisonCues, poisonFlightMs, poisonPlan, sanitizeHeroPoisonConfig,
  type HeroPoisonConfig, type HeroPoisonNumKey,
} from './heroPoisonConfig';
import { HeroPoisonScene, MAX_POISON_MESHES, MAX_POISON_SPRITES, TRAIL_POINTS, type HeroPoisonTextures } from './heroPoisonScene';
import { playHeroPoison, poisonSeed, type HeroPoisonOptions } from './heroPoison';
import { SPEC } from '../HeroPoisonTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroPoisonTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  dartShaft: W, dartFletch: W, dartVenom: W, dartEdge: W, dartGlow: W, splat: W, splat2: W, drop: W, puff: W, bubble: W, disc: W, shock: W,
};
const C = HERO_POISON_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => poisonPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xf0ffdc, venom: 0x4dff3a, acid: 0xd2ff1f, dark: 0x2a0b3c, side: 0x7dff3a };
const LOOK = {
  length: 84, glow: 0.6, trailMs: 75, trailWidth: 7, wisps: 0.6, quiver: 0.2, splash: 1, tickDrops: 8, tint: 0.34, gravity: 1100,
  hazeAlpha: 0.3, hazeMs: 1500, cloudPuffs: 10, cloudSize: 1,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with every style)', () => {
  it('Poison steps up on exactly the blows Blast and Arcana do: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(blastPlan({ total: d, distance: 1600 }, HERO_BLAST_DEFAULTS).tier);
      expect(t).toBe(arcanaPlan({ total: d, distance: 1600 }, HERO_ARCANA_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE dart, II TWO in quick succession, III a fan of FIVE, IV SIX that IMPLODE (the owner\'s "multiple poison darts that implode")', () => {
    expect([P1, P2, P3, P4].map((p) => p.darts.length)).toEqual([1, 2, 5, 6]);
    expect([P1, P2, P3, P4].map((p) => p.implode)).toEqual([false, false, false, true]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.implode ? 'implode' : p.darts.length; }))
      .toEqual([1, 1, 2, 2, 5, 5, 'implode', 'implode']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_POISON_RANGES)) {
      const v = C[k as HeroPoisonNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorVenom', 'colorAcid', 'colorDark', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroPoisonValue('t3Darts', 99)).toBe(8);
    expect(clampHeroPoisonValue('t1Darts', 0)).toBe(1);
    expect(clampHeroPoisonValue('dartLength', -3)).toBe(30);
    expect(clampHeroPoisonValue('swellMs', 99999)).toBe(2000);
    expect(clampHeroPoisonValue('tintAlpha', 5)).toBe(0.8);
    expect(clampHeroPoisonValue('trailMs', Number.NaN)).toBe(C.trailMs);
    expect(clampHeroPoisonValue('trailMs', 'abc')).toBe(C.trailMs);
    expect(clampHeroPoisonValue('trailMs', '120')).toBe(120);
    expect(clampHeroPoisonValue('colorVenom', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroPoisonValue('colorPlayer', 'green')).toBe(C.colorPlayer);
    expect(clampHeroPoisonValue('sfxThrowClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroPoisonValue('nope' as keyof HeroPoisonConfig, 1)).toBeUndefined();
    expect(clampHeroPoisonValue('toString' as keyof HeroPoisonConfig, 1)).toBeUndefined();
    const s = sanitizeHeroPoisonConfig({ t4Drops: 400, colorCore: 'x', bogus: 3 });
    expect(s.t4Drops).toBe(80);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroPoisonConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Poison', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroPoisonConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Implode).toBe(1);
    expect(json.t3Darts).toBe(5);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('poison');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('poison');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe huge (40)']) {
      expect(labels).toContain(l);
    }
  });
});

describe('the plan', () => {
  it('THE VOLLEY: five darts thunk in in rhythm, the first four are ticks, the LAST is the impact (only one impact beat)', () => {
    const arr = P3.darts.map((d) => d.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!, `arrival ${i}`).toBeGreaterThan(arr[i - 1]!);
    const gaps = arr.slice(1).map((a, i) => a - arr[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(30); // an even rhythm
    expect(P3.impactAt).toBe(arr[arr.length - 1]);
    expect(P3.hits).toEqual(arr.slice(0, -1));
    const kinds = poisonCues(P3).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'throw')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
    // the poison seeps and the darts dissolve AFTER the blow (FX only)
    expect(kinds.indexOf('impact')).toBeLessThan(kinds.indexOf('seep'));
    expect(kinds.indexOf('seep')).toBeLessThan(kinds.indexOf('dissolve'));
  });

  it('Tier II is two darts in quick succession (one tick, then the impact); Tier I one dart, straight to the impact', () => {
    expect(P2.darts[1]!.throwAt - P2.darts[0]!.throwAt).toBeLessThanOrEqual(250);
    expect(P2.hits).toHaveLength(1);
    expect(P2.impactAt).toBe(P2.darts[1]!.arriveAt);
    expect(P1.darts).toHaveLength(1);
    expect(P1.hits).toEqual([]);
    expect(P1.impactAt).toBe(P1.darts[0]!.arriveAt);
  });

  it('Tier IV: EVERY dart is a tick; then the swell, the suck, and the BURST is the impact (the one consequence)', () => {
    const kinds = poisonCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds).not.toContain('seep');
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(at('swell'));
    expect(at('swell')).toBeLessThan(at('suck'));
    expect(at('suck')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('boom'));
    expect(P4.swellAt).toBeGreaterThan(Math.max(...P4.darts.map((d) => d.arriveAt)));
    expect(P4.suckAt).toBe(P4.swellAt + C.swellMs);
    expect(P4.impactAt).toBe(P4.suckAt + C.suckMs);
  });

  it('every tier escalates: more shake, zoom, droplets, splash and dim', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      for (const k of ['shakePx', 'zoom', 'drops', 'burst', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    }
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1600 px apart): first throw, impact and end, ms from the ready', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.throwAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual([
      [300, 600, 1320], [340, 825, 1585], [400, 1130, 1930], [420, 2090, 2990],
    ]);
    // Chunky, not rushed, never dragging: Tier I about 1.4 s, Tier IV under 3 s.
    expect(t(P1)[2]).toBeLessThanOrEqual(2000);
    expect(t(P4)[2]).toBeLessThanOrEqual(3200);
  });

  it('the fan throws outer darts first and the centre last', () => {
    expect(fanSlots(1)).toEqual([0]);
    expect(fanSlots(2)).toEqual([-1, 1]);
    expect(fanSlots(5)).toEqual([-2, 2, -1, 1, 0]);
  });

  it('the caps always hold, whatever the sliders say; flight scales gently with distance', () => {
    const wild: HeroPoisonConfig = { ...C, t3Darts: 8, t4Drops: 80, t4Shake: 40, t4Zoom: 0.14 };
    expect(poisonPlan({ total: 15, distance: 800 }, wild).darts.length).toBeLessThanOrEqual(POISON_CAPS.darts);
    expect(poisonPlan({ total: 99, distance: 800 }, wild).drops).toBeLessThanOrEqual(POISON_CAPS.drops);
    expect(poisonFlightMs(1600, 300)).toBe(300);
    expect(poisonFlightMs(100, 300)).toBe(186);
    expect(poisonFlightMs(99999, 300)).toBe(345);
  });

  it('reduced motion: no darts, ready, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.darts.length]).toEqual([0, 0, 0, 0]);
    const kinds = poisonCues(p).map((q) => q.kind);
    for (const k of ['charge', 'throw', 'hit', 'swell', 'suck', 'seep']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(poisonCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(dartMotions(p, A, D, R, R, C)).toEqual([]);
  });

  it('is deterministic: the same fight plans the same beats and the same paths (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(poisonCues(plan([4, 2, 3], 9, 720))).toEqual(poisonCues(plan([4, 2, 3], 9, 720)));
    expect(dartMotions(P4, A, D, R, R, C)).toEqual(dartMotions(P4, A, D, R, R, C));
    expect(poisonSeed(14, 1500.2, 'player')).toBe(poisonSeed(14, 1500.4, 'player'));
    expect(poisonSeed(14, 1500, 'player')).not.toBe(poisonSeed(14, 1500, 'opp'));
  });
});

describe('the dart paths', () => {
  it('a dart leaves the thrower\'s rim, flies a SLIGHT arc (above the line, not a lob), and sticks IN the struck portrait', () => {
    const [m] = dartMotions(P1, A, D, R, R, C);
    const p0 = dartPos(m!, 0);
    expect(Math.hypot(p0.x - A.x, p0.y - A.y)).toBeLessThanOrEqual(R); // on the thrower's rim
    const end = dartPos(m!, m!.flightMs);
    expect(Math.hypot(end.x - D.x, end.y - D.y)).toBeLessThanOrEqual(R * 0.7); // in the face
    expect(dartPos(m!, m!.flightMs + 500)).toEqual(end); // it STAYS stuck
    // a slight arc: the midpoint is above the straight line, but by far less than a lob would be
    const mid = dartPos(m!, m!.flightMs / 2);
    const lineY = (m!.a.y + m!.b.y) / 2;
    expect(mid.y).toBeLessThan(lineY);
    expect(lineY - mid.y).toBeLessThan(0.12 * Math.hypot(D.x - A.x, D.y - A.y));
    // it points where it flies, and sticks at the heading it arrived on
    const late = dartPos(m!, m!.flightMs * 0.98);
    expect(Math.abs(Math.atan2(Math.sin(late.rot - m!.rot), Math.cos(late.rot - m!.rot)))).toBeLessThan(0.35);
    expect(dartEase(0)).toBe(0);
    expect(dartEase(1)).toBe(1);
    // fast and still accelerating into the target (it thunks)
    expect(dartEase(1) - dartEase(0.9)).toBeGreaterThan(dartEase(0.1) - dartEase(0));
  });

  it('a volley sticks at VARIED angles and spread positions across the face (never one stack)', () => {
    const ms = dartMotions(P3, A, D, R, R, C);
    const rots = ms.map((m) => m.rot);
    expect(Math.max(...rots) - Math.min(...rots)).toBeGreaterThan(0.2);
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      expect(Math.hypot(ms[i]!.aim.x - ms[j]!.aim.x, ms[i]!.aim.y - ms[j]!.aim.y), `${i}-${j}`).toBeGreaterThan(R * 0.12);
    }
    for (const m of ms) expect(Math.hypot(m.aim.x - D.x, m.aim.y - D.y)).toBeLessThanOrEqual(R * 0.75);
  });

  it('Tier IV sticks the darts ROUND the face (so the implosion has somewhere to pull them in from)', () => {
    const ms = dartMotions(P4, A, D, R, R, C);
    const angs = ms.map((m) => Math.atan2(m.aim.y - D.y, m.aim.x - D.x)).sort((a, b) => a - b);
    const gaps = angs.map((a, i) => (i ? a - angs[i - 1]! : a + 2 * Math.PI - angs[angs.length - 1]!));
    for (const g of gaps) expect(g).toBeGreaterThan(0.5);
    for (const m of ms) { const r = Math.hypot(m.aim.x - D.x, m.aim.y - D.y); expect(r).toBeGreaterThan(R * 0.25); expect(r).toBeLessThan(R * 0.6); }
  });

  it('works both ways: a foe dart from the top down to you, and the arc ceiling keeps it in frame', () => {
    const [m] = dartMotions(P1, D, A, R, R, C);
    expect(Math.hypot(dartPos(m!, 0).x - D.x, dartPos(m!, 0).y - D.y)).toBeLessThanOrEqual(R);
    const end = dartPos(m!, m!.flightMs);
    expect(Math.hypot(end.x - A.x, end.y - A.y)).toBeLessThanOrEqual(R * 0.7);
    const [c] = dartMotions(P1, { x: 200, y: 100 }, { x: 1500, y: 60 }, R, R, C, 40);
    expect(c!.c.y).toBeGreaterThanOrEqual(40);
  });
});

describe('the camera', () => {
  it('pushes in through the ready, punches in on the impact and shakes ALONG the dart; rests by the end', () => {
    const dir = { x: 0.8, y: -0.6 };
    const hit = poisonCameraAt(P3, C, P3.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P3.zoom);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = poisonCameraAt(P3, C, P3.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.8);
  });

  it('Tier IV builds through the swell and the suck, then the burst punches hardest; focus moves from thrower to target', () => {
    const early = poisonCameraAt(P4, C, P4.swellAt + 20);
    const late = poisonCameraAt(P4, C, P4.impactAt - 5);
    expect(late.zoom).toBeGreaterThan(early.zoom);
    const boom = poisonCameraAt(P4, C, P4.impactAt + 1);
    expect(boom.zoom).toBeGreaterThan(poisonCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(poisonCameraFocus(P4, P4.throwAt, A, D)).toEqual(A);
    expect(poisonCameraFocus(P4, P4.swellAt, A, D)).toEqual(D);
    expect(poisonCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
    // controlled: the zoom never goes past a gentle push
    let peak = 1;
    for (let t = P4.chargeAt; t < P4.endAt; t += 8) peak = Math.max(peak, poisonCameraAt(P4, C, t).zoom);
    expect(peak).toBeLessThan(1.25);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroPoisonOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroPoisonOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroPoison({
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

  it('THE VOLLEY lands the blow EXACTLY ONCE, on the LAST dart: never on a tick; the darts stick; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.darts).toHaveLength(5);
    expect(host.querySelector('.hblast.hpoison')).not.toBeNull();
    f.tick(h.plan.hits[h.plan.hits.length - 1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.stuckDarts).toBe(4);
    expect(h.scene!.liveMeshes).toBeGreaterThan(0);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.stuckDarts).toBe(5);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveDarts).toBe(0); // dissolved
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16); // the droplets drain, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: six darts stick (ticks), swell, are SUCKED in, and the blow lands ONCE on the BURST', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.implode).toBe(true);
    f.tick(h.plan.swellAt + 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.stuckDarts).toBe(6);
    expect(h.scene!.swelling).toBe(true);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.swelling).toBe(false);
    expect(h.scene!.liveDarts).toBe(0); // imploded into the burst
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_POISON_SPRITES);
    f.tick(h.plan.endAt + 3000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck)', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peakS = 0, peakM = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peakS = Math.max(peakS, h.scene!.liveSprites); peakM = Math.max(peakM, h.scene!.liveMeshes); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peakS).toBeLessThanOrEqual(MAX_POISON_SPRITES);
        expect(peakM).toBeLessThanOrEqual(MAX_POISON_MESHES);
        for (const m of h.motions) {
          expect(Math.hypot(m.a.x - a.x, m.a.y - a.y)).toBeLessThanOrEqual(R); // thrown from the attacker
          expect(Math.hypot(m.aim.x - d.x, m.aim.y - d.y)).toBeLessThanOrEqual(R * 0.75); // into the struck hero
        }
        h.cancel();
      }
    }
  });

  it('stuck darts RIDE the struck portrait\'s knockback (they never float off it)', () => {
    const { h, f, root } = run({ total: 3, formation: formationOf([3], 3) });
    f.tick(h.plan.impactAt + 40, 4);
    const layer = root.children[0] as Container;
    const bodies = (layer.children.find((c) => c.label === 'poison-body') as Container).children.filter((c) => c.visible && Math.abs(c.rotation - h.motions[0]!.rot) < 0.4);
    expect(bodies.length).toBeGreaterThan(0);
    const m = h.motions[0]!;
    const off = Math.hypot(bodies[0]!.x - m.b.x, bodies[0]!.y - m.b.y);
    expect(off).toBeGreaterThan(1); // moved with the knockback, not pinned to the resting spot
    f.tick(h.plan.dissolveAt - h.elapsed() - 20, 4);
    const back = bodies[0]!;
    expect(Math.hypot(back.x - m.b.x, back.y - m.b.y)).toBeLessThan(off); // and back as the portrait springs home
    h.cancel();
  });

  it('slow motion stretches real time but the impact is still the same sequence beat', () => {
    const { h, f, onImpact } = run({ speed: 0.25 });
    f.tick(h.plan.impactAt * 4 - 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(60, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('a replay plays the same: the same fight flies the same paths and beats', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.motions).toEqual(b.h.motions);
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
    b.f.tick(b.h.plan.swellAt + 100);
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
      const h = playHeroPoison({
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
  it('trails are strips of TRAIL_POINTS x 2 vertices (under the 100-vertex batch limit); a whole Tier IV stays in the caps and drains; destroy leaves nothing', () => {
    expect(TRAIL_POINTS * 2).toBeLessThanOrEqual(100);
    const s = new HeroPoisonScene(TEX, COLORS, LOOK, 1, 42);
    const ms = dartMotions(P4, A, D, R, R, C);
    s.startCharge(A.x, A.y, ms[0]!.a, 70, 400, ms.length, 18);
    for (let i = 0; i < 25; i++) s.update(16);
    let peakS = 0, peakM = 0;
    ms.forEach((m, i) => s.throw(m, 0.95, 0, i));
    for (let i = 0; i < 40; i++) { s.update(16); peakS = Math.max(peakS, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes); }
    ms.forEach((_, i) => s.hit(i, D.x, D.y, R, i));
    expect(s.stuckDarts).toBe(6);
    s.startSwell(D.x, D.y, R, 700, 200);
    for (let i = 0; i < 44; i++) { s.update(16); peakS = Math.max(peakS, s.liveSprites); }
    s.suck();
    for (let i = 0; i < 12; i++) { s.update(16); peakS = Math.max(peakS, s.liveSprites); }
    s.burst(D.x, D.y, R, { burst: 1.8, size: 1, drops: 40, flashAlpha: 0.85 });
    s.boom(D.x + 40, D.y, 1); s.boom(D.x - 40, D.y, 1.1);
    peakS = Math.max(peakS, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes);
    expect(peakS).toBeLessThanOrEqual(MAX_POISON_SPRITES);
    expect(peakM).toBeLessThanOrEqual(MAX_POISON_MESHES);
    expect(s.liveDarts).toBe(0);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('a dart draws finite geometry every frame (no NaN at the throw, in flight, stuck or dissolving)', () => {
    const s = new HeroPoisonScene(TEX, COLORS, LOOK, 1, 3);
    const [m] = dartMotions(P1, A, D, R, R, C);
    s.throw(m!, 1.1, 0, 0);
    for (let t = 0; t < m!.flightMs + 400; t += 16) {
      s.update(16);
      for (const l of s.root.children as Container[]) {
        for (const ch of l.children) {
          if (!ch.visible) continue;
          expect(Number.isFinite(ch.x) && Number.isFinite(ch.y) && Number.isFinite(ch.rotation)).toBe(true);
          if ('vertices' in ch) for (const v of (ch as unknown as { vertices: Float32Array }).vertices) expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
    s.dissolve();
    for (let i = 0; i < 30; i++) s.update(16);
    expect(s.liveDarts).toBe(0);
    s.destroy();
  });

  it('clear() drops everything in flight at once; the pool is reused, not regrown', () => {
    const s = new HeroPoisonScene(TEX, COLORS, LOOK, 1, 9);
    const ms = dartMotions(P3, A, D, R, R, C);
    ms.forEach((m, i) => s.throw(m, 1, 0, i));
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.update(16)).toBe(false);
    ms.forEach((m, i) => s.throw(m, 1, 0, i));
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 10);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Venom Volley (attack_poison) is a Legendary crate hero attack that plays Poison; the dev override can force it; the other styles unchanged; unknown ids play Classic', () => {
    expect(COSMETIC_INDEX.attack_poison).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Venom Volley', assets: { style: 'poison' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire']); // Frost, then Consecration (holy), joined 2026-09-28 (Inferno, fire, 2026-09-29)
    expect(styleOfCosmetic('attack_poison')).toBe('poison');
    for (const [id, st] of [['attack_blast', 'blast'], ['attack_quake', 'quake'], ['attack_arcana', 'arcana'], ['attack_blades', 'blades'], ['attack_enraged', 'enraged']] as const) {
      expect(styleOfCosmetic(id)).toBe(st);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_poison' })).toBe('poison');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'poison' })).toBe('poison');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_poison' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_poison_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
