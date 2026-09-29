// @vitest-environment jsdom
/**
 * THE PHANTOM BLADES HERO ATTACK (owner 2026-09-28: "branch off and make a new style animation and surprise me with it.
 * arcana is top tier good. use that as your benchmark for quality. make it unique"): the tier mapping SHARED with Blast,
 * Quake and Arcana; the tier -> blades ladder (one / a crossed pair / a fan of five / six and the greatsword); the
 * tuner defaults + clamping; the pure plan (the total is the engine's number, the stab rhythm, the impact beat, the
 * shatter after it, reduced motion, determinism); the pure poses (raised, swung round to aim, locked still, a straight
 * thrust, the tip in its mark, the formation kept on screen, the pair crossing); the camera; the runner on the shared
 * clock (the consequence lands exactly ONCE, on the last blade or the greatsword, never on a tick or the shatter; both
 * directions; slow motion; replay; finish / cancel; cleanup); the headless scene (pooled, bounded, drains, destroy
 * leaves nothing); the cosmetic resolution; and Blast / Quake / Arcana unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_BLAST_DEFAULTS, blastPlan } from '../heroBlast/heroBlastConfig';
import { HERO_QUAKE_DEFAULTS, quakePlan } from '../heroQuake/heroQuakeConfig';
import { HERO_ARCANA_DEFAULTS, arcanaPlan } from '../heroArcana/heroArcanaConfig';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  BLADES_CAPS, BLADE_TIP_FRACTION, HERO_BLADES_DEFAULTS, HERO_BLADES_RANGES, bladeFlightMs, bladeMotions, bladePose, bladeSlots,
  bladesCameraAt, bladesCameraFocus, bladesCues, bladesPlan, clampHeroBladesValue, heroBladesConfigJson, sanitizeHeroBladesConfig,
  thrustEase, tipOf, turn, type BladeMotion, type Bounds, type HeroBladesConfig, type HeroBladesNumKey,
} from './heroBladesConfig';
import { HeroBladesScene, MAX_BLADES_SPRITES, type HeroBladesTextures } from './heroBladesScene';
import { bladesSeed, playHeroBlades, type HeroBladesOptions } from './heroBlades';
import { SPEC } from '../HeroBladesTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBladesTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, swordGlow: W, swordBlade: W, swordHilt: W, swordEdge: W, shard: W, slash: W, reticle: W,
};
const C = HERO_BLADES_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => bladesPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xffffff, edge: 0xc9f6ff, side: 0x3fb8ff, hilt: 0xffc85a, shade: 0x0a2240 };
const LOOK = { glow: 0.85, edge: 1, outline: 0.55, ghosts: 3, ghostGapMs: 26, cutLine: 0.9 };
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const BOX: Bounds = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);
const motions = (p: ReturnType<typeof plan>, a = A, d = D, box = BOX): BladeMotion[] => bladeMotions(p, a, d, 80, 80, C, box, 1);

describe('the damage tiers (shared with Blast, Quake and Arcana)', () => {
  it('the Blades step up on exactly the blows every other style does: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(blastPlan({ total: d, distance: 1600 }, HERO_BLAST_DEFAULTS).tier);
      expect(t).toBe(quakePlan({ total: d, distance: 1600 }, HERO_QUAKE_DEFAULTS).tier);
      expect(t).toBe(arcanaPlan({ total: d, distance: 1600 }, HERO_ARCANA_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE blade, II a PAIR, III a fan of FIVE, IV six and the GREATSWORD', () => {
    expect([P1, P2, P3, P4].map((p) => p.blades.length)).toEqual([1, 2, 5, 6]);
    expect([P1, P2, P3, P4].map((p) => p.great !== null)).toEqual([false, false, false, true]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.great ? 'great' : p.blades.length; }))
      .toEqual([1, 1, 2, 2, 5, 5, 'great', 'great']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_BLADES_RANGES)) {
      const v = C[k as HeroBladesNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorEdge', 'colorPlayer', 'colorFoe', 'colorHilt', 'colorShade'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroBladesValue('t3Blades', 99)).toBe(8);
    expect(clampHeroBladesValue('t1Blades', 0)).toBe(1);
    expect(clampHeroBladesValue('glow', -3)).toBe(0);
    expect(clampHeroBladesValue('greatHangMs', 99999)).toBe(1200);
    expect(clampHeroBladesValue('bladeLength', Number.NaN)).toBe(C.bladeLength);
    expect(clampHeroBladesValue('bladeLength', 'abc')).toBe(C.bladeLength);
    expect(clampHeroBladesValue('bladeLength', '200')).toBe(200);
    expect(clampHeroBladesValue('colorEdge', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroBladesValue('colorPlayer', 'blue')).toBe(C.colorPlayer);
    expect(clampHeroBladesValue('sfxLooseClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroBladesValue('nope' as keyof HeroBladesConfig, 1)).toBeUndefined();
    expect(clampHeroBladesValue('toString' as keyof HeroBladesConfig, 1)).toBeUndefined();
    const s = sanitizeHeroBladesConfig({ t4Shards: 400, colorCore: 'x', bogus: 3 });
    expect(s.t4Shards).toBe(20);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroBladesConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers the Blades', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroBladesConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Great).toBe(1);
    expect(json.t3Blades).toBe(5);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('blades');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('blades');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe huge (40)', '▶ Reduced motion', 'Speed 1x', 'Speed 0.5x', 'Speed 0.25x']) {
      expect(labels).toContain(l);
    }
    // No em dashes in anything a player (or the owner) reads off the tuner.
    for (const c of SPEC.controls) expect(`${c.label} ${c.hint ?? ''}`, c.key).not.toMatch(/[—–]/);
  });
});

describe('the plan', () => {
  it('THE FAN: five blades go in, in rhythm; the first four are ticks, the LAST is the impact (one impact beat); the shatter follows', () => {
    const arr = P3.blades.map((b) => b.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!, `arrival ${i}`).toBeGreaterThan(arr[i - 1]!);
    const gaps = arr.slice(1).map((a, i) => a - arr[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(30); // an even rhythm
    expect(P3.impactAt).toBe(arr[arr.length - 1]);
    expect(P3.hits).toEqual(arr.slice(0, -1));
    const kinds = bladesCues(P3, C).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'summon')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'loose')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'shatter')).toHaveLength(1);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(kinds.lastIndexOf('summon')).toBeLessThan(at('aim'));
    expect(at('aim')).toBeLessThan(at('lock'));
    expect(at('lock')).toBeLessThan(at('loose'));
    expect(kinds.lastIndexOf('hit')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('shatter'));
    expect(P3.shatterAt).toBeGreaterThan(P3.impactAt);
    // the last to go in is the centre blade, and the biggest
    expect(P3.blades[4]!.slot).toBe(0);
    expect(P3.blades[4]!.size).toBeGreaterThan(P3.blades[0]!.size);
  });

  it('Tier II is a PAIR from opposite sides of the arc; Tier I one blade, straight to the impact', () => {
    expect(P2.blades.map((b) => b.slot)).toEqual([-1, 1]);
    expect(P2.hits).toHaveLength(1);
    expect(P1.blades).toHaveLength(1);
    expect(P1.hits).toEqual([]);
    expect(P1.impactAt).toBe(P1.blades[0]!.arriveAt);
  });

  it('Tier IV: all six blades are TICKS; the greatsword forms while they fly, hangs, and IT is the impact', () => {
    const kinds = bladesCues(P4, C).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(at('loose')).toBeLessThan(at('great'));
    expect(at('great')).toBeLessThan(at('greatAim'));
    expect(at('greatAim')).toBeLessThan(at('hang'));
    expect(at('hang')).toBeLessThan(at('greatLoose'));
    expect(at('greatLoose')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('shatter'));
    expect(at('shatter')).toBeLessThan(at('boom'));
    const g = P4.great!;
    expect(P4.impactAt).toBe(g.arriveAt);
    expect(g.manifestAt).toBeLessThan(Math.max(...P4.blades.map((b) => b.arriveAt))); // it forms while the volley flies
    expect(P4.impactAt - Math.max(...P4.blades.map((b) => b.arriveAt))).toBeGreaterThanOrEqual(240); // a clear beat after
  });

  it('every tier escalates: more shake, zoom, hit-stop and burst; II+ dims', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      for (const k of ['shakePx', 'zoom', 'burst', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    }
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1600 px apart): first loose, impact and end, ms', () => {
    // Timed from the charge: the style's own attack, after the shared damage formation (pinned in formation.test.ts).
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.fireAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual(TIMELINE);
    // About 2 s at Tier I, about 4 s at Tier IV (owner: "satisfying and chunky, not rushed").
    expect(t(P1)[2]).toBeLessThanOrEqual(2300);
    expect(t(P4)[2]).toBeLessThanOrEqual(4300);
  });

  it('the formation looses outer blades first and the centre last', () => {
    expect(bladeSlots(1)).toEqual([0]);
    expect(bladeSlots(2)).toEqual([-1, 1]);
    expect(bladeSlots(5)).toEqual([-2, 2, -1, 1, 0]);
    expect(bladeSlots(6)).toEqual([-2.5, 2.5, -1.5, 1.5, -0.5, 0.5]);
  });

  it('the caps always hold, whatever the sliders say; flight scales gently with distance', () => {
    const wild: HeroBladesConfig = { ...C, t3Blades: 8, t4Shards: 20, t4Shake: 40, t4Zoom: 0.14 };
    const w = bladesPlan({ total: 15, distance: 800 }, wild);
    expect(w.blades.length).toBeLessThanOrEqual(BLADES_CAPS.blades);
    const v = bladesPlan({ total: 99, distance: 800 }, wild);
    expect(v.shards).toBeLessThanOrEqual(BLADES_CAPS.shards);
    expect(bladeFlightMs(1600, 500)).toBe(500);
    expect(bladeFlightMs(100, 500)).toBe(310);
    expect(bladeFlightMs(99999, 500)).toBe(575);
  });

  it('reduced motion: no blades, summon, shake, zoom, dim, shatter or hit-stop; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.blades.length]).toEqual([0, 0, 0, 0]);
    expect(p.great).toBeNull();
    const kinds = bladesCues(p, C).map((q) => q.kind);
    for (const k of ['charge', 'summon', 'aim', 'loose', 'hit', 'great', 'shatter']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(bladesCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(motions(p)).toEqual([]);
  });

  it('is deterministic: the same fight plans the same beats and the same blades (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(bladesCues(plan([4, 2, 3], 9, 720), C)).toEqual(bladesCues(plan([4, 2, 3], 9, 720), C));
    expect(motions(P4)).toEqual(motions(P4));
    expect(bladesSeed(14, 1500.2, 'player')).toBe(bladesSeed(14, 1500.4, 'player'));
    expect(bladesSeed(14, 1500, 'player')).not.toBe(bladesSeed(14, 1500, 'opp'));
  });
});

/** The shipped timeline: [first loose, impact, end] per tier at 1600 px, timed from the charge (after the formation). */
const TIMELINE = [[557, 882, 1412], [647, 1102, 1692], [807, 1502, 2152], [747, 1906, 2636]];

describe('the blade poses', () => {
  it('a blade unfurls RAISED to the sky, swings round to AIM, holds dead still on the LOCK, kicks back, thrusts STRAIGHT and its tip goes in on its mark', () => {
    const [m] = motions(P1);
    const pose = (t: number) => bladePose(m!, t);
    expect(pose(-1).phase).toBe('hidden');
    expect(pose(10).phase).toBe('manifest');
    expect(pose(m!.manifestMs + 5).ang).toBeCloseTo(-Math.PI / 2, 5); // raised (a lone blade is not splayed)
    expect(pose(m!.aimStart + 20).phase).toBe('aim');
    const lock = pose(m!.aimEnd + 5);
    expect(lock.phase).toBe('lock');
    expect(lock.ang).toBeCloseTo(m!.aim, 6);
    expect(pose(m!.aimEnd + 5)).toEqual(pose(m!.pullStart - 1)); // dead still
    // the kick back moves it AWAY from the target
    const back = pose(m!.flightStart - 1);
    const dx = Math.cos(m!.aim), dy = Math.sin(m!.aim);
    expect((back.x - lock.x) * dx + (back.y - lock.y) * dy).toBeLessThan(-C.pullPx * 0.9);
    // the thrust is a straight line: every sample sits on the line through the start along the aim
    for (let t = m!.flightStart; t <= m!.arrive; t += 12) {
      const p = pose(t);
      expect(p.phase === 'flight' || p.phase === 'stuck').toBe(true);
      const cross = (p.x - back.x) * dy - (p.y - back.y) * dx;
      expect(Math.abs(cross)).toBeLessThan(0.5);
    }
    const inAt = tipOf(pose(m!.arrive), m!.tipLen);
    expect(inAt.x).toBeCloseTo(m!.tipTo.x, 6);
    expect(inAt.y).toBeCloseTo(m!.tipTo.y, 6);
    // stuck: it quivers about its tip, and settles
    const later = tipOf(pose(m!.arrive + 90), m!.tipLen);
    expect(later.x).toBeCloseTo(m!.tipTo.x, 6);
    expect(pose(m!.arrive + 1500).ang).toBeCloseTo(m!.aim, 3);
    // the tip goes in on the struck portrait
    expect(Math.hypot(m!.tipTo.x - D.x, m!.tipTo.y - D.y)).toBeLessThanOrEqual(80);
    expect(thrustEase(0)).toBe(0);
    expect(thrustEase(1)).toBe(1);
    expect(m!.tipLen / m!.length).toBeCloseTo(BLADE_TIP_FRACTION, 6);
  });

  it('a pair CROSSES: the two thrusts cut across each other (an X), from opposite sides of the arc', () => {
    const [a, b] = motions(P2);
    const cross = (o: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }): number => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    const segs = (p1: { x: number; y: number }, p2: { x: number; y: number }, q1: { x: number; y: number }, q2: { x: number; y: number }): boolean =>
      Math.sign(cross(p1, p2, q1)) !== Math.sign(cross(p1, p2, q2)) && Math.sign(cross(q1, q2, p1)) !== Math.sign(cross(q1, q2, p2));
    expect(segs(a!.home, a!.tipTo, b!.home, b!.tipTo)).toBe(true);
    // and the fan of five criss-crosses too: the outermost pair's thrusts cross
    const five = motions(P3);
    expect(segs(five[0]!.home, five[0]!.tipTo, five[1]!.home, five[1]!.tipTo)).toBe(true);
  });

  it('works both ways, and the raised blades stay on screen even round a hero at the top edge', () => {
    const box: Bounds = { x0: 0, y0: 0, x1: 1600, y1: 900 };
    for (const [a, d] of [[{ x: 150, y: 790 }, { x: 1500, y: 110 }], [{ x: 1500, y: 110 }, { x: 150, y: 790 }]] as const) {
      for (const p of [P1, P2, P3, P4]) {
        for (const m of motions(p, a, d, box)) {
          const raisedTip = tipOf(bladePose(m, m.manifestMs + 1), m.tipLen);
          expect(raisedTip.y, `${p.tier} ${m.index}`).toBeGreaterThanOrEqual(-1);
          expect(m.home.x).toBeGreaterThanOrEqual(0);
          expect(m.home.x).toBeLessThanOrEqual(1600);
          expect(m.home.y).toBeLessThanOrEqual(900);
          expect(Math.hypot(m.tipTo.x - d.x, m.tipTo.y - d.y)).toBeLessThanOrEqual(80);
        }
      }
    }
  });

  it('the turn to aim is always the short way round', () => {
    expect(turn(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 9);
    expect(turn(-Math.PI / 2, Math.PI)).toBeCloseTo(-Math.PI / 2, 9);
    expect(Math.abs(turn(3, -3))).toBeLessThan(Math.PI);
  });
});

describe('the camera', () => {
  it('pushes in through the summon, punches in on the impact and shakes ALONG the last blade; rests by the end', () => {
    const dir = { x: 0.6, y: -0.8 };
    const hit = bladesCameraAt(P3, C, P3.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P3.zoom);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = bladesCameraAt(P3, C, P3.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.6);
    expect(bladesCameraFocus(P3, P3.fireAt, A, D, C)).toEqual(A);
    expect(bladesCameraFocus(P3, P3.impactAt, A, D, C)).toEqual(D);
  });

  it('Tier IV eases out to a wide shot while the greatsword hangs, then its impact punches hardest', () => {
    const g = P4.great!;
    const loose = g.launchAt + C.greatPullMs;
    const early = bladesCameraAt(P4, C, P4.hangAt + 1);
    const wide = bladesCameraAt(P4, C, loose - 1);
    expect(wide.zoom).toBeLessThan(early.zoom);
    const boom = bladesCameraAt(P4, C, P4.impactAt + 1);
    expect(boom.zoom).toBeGreaterThan(bladesCameraAt(P3, C, P3.impactAt + 1).zoom);
    const mid = { x: (A.x + D.x) / 2, y: (A.y + D.y) / 2 };
    expect(bladesCameraFocus(P4, P4.hangAt + 10, A, D, C)).toEqual(mid);
    expect(bladesCameraFocus(P4, P4.impactAt, A, D, C)).toEqual(D);
    expect(bladesCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroBladesOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBladesOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBlades({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: 80,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false, bounds: BOX,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('THE FAN lands the blow EXACTLY ONCE, on the LAST blade: never on a tick or the shatter; holds the hit-stop; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.blades).toHaveLength(5);
    expect(host.querySelector('.hblast.hblades')).not.toBeNull();
    f.tick(h.plan.hits[h.plan.hits.length - 1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveBlades).toBe(5);
    expect(h.scene!.stuckBlades).toBe(4);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.shatterAt - h.elapsed() + 20, 4);
    expect(h.scene!.liveBlades).toBe(0); // every stuck blade shattered
    expect(onImpact).toHaveBeenCalledTimes(1);
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16); // the shards drain, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: six ticks, then the blow lands ONCE, on the greatsword (never on a blade going in)', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.great).not.toBeNull();
    expect(h.motions).toHaveLength(7);
    expect(h.motions[6]!.great).toBe(true);
    f.tick(h.plan.hangAt + 40, 4);
    expect(h.scene!.locking).toBe(true);
    expect(h.scene!.stuckBlades).toBe(6);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveBlades).toBe(7);
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    f.tick(h.plan.shatterAt - h.elapsed() + 20, 4);
    expect(h.scene!.liveBlades).toBe(0);
    expect(h.scene!.locking).toBe(false);
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_BLADES_SPRITES);
    f.tick(h.plan.endAt + 3000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck)', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 14, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_BLADES_SPRITES);
        // every tip goes in on the struck hero
        for (const m of h.motions) expect(Math.hypot(m.tipTo.x - d.x, m.tipTo.y - d.y)).toBeLessThanOrEqual(80);
        h.cancel();
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

  it('a replay plays the same: the same fight flies the same blades and beats', () => {
    const a = run();
    const b = run();
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.motions).toEqual(b.h.motions);
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
    b.f.tick(b.h.plan.hangAt + 100);
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
      const h = playHeroBlades({
        formation: formationOf([25], 25), total: 25, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 },
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false, bounds: BOX,
        mount: () => () => {}, host: null, camera: null,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  it('a whole Tier IV stays in the cap and drains; destroy leaves nothing', () => {
    const s = new HeroBladesScene(TEX, COLORS, LOOK, 1, 42);
    const ms = motions(P4);
    s.startCharge(A.x, A.y, 70, 6, 1);
    let peak = 0;
    for (const m of ms) s.summon(m, A, 0);
    expect(s.liveBlades).toBe(7);
    // run every blade through to stuck (the greatsword too)
    for (let i = 0; i < 260; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); if (i === 120) s.lock(); }
    s.lockOn(D.x, D.y, 80, 300, 0.8);
    for (const m of ms) s.loose(m);
    s.impact(D.x, D.y, { x: 0.8, y: -0.6 }, 80, { tier: 4, k: 1, burst: 1.9, great: true });
    peak = Math.max(peak, s.liveSprites);
    expect(s.shatter(D.x, D.y, 10)).toBe(7);
    s.boom(D.x + 40, D.y, 1); s.boom(D.x - 40, D.y, 1.1);
    peak = Math.max(peak, s.liveSprites);
    expect(peak).toBeLessThanOrEqual(MAX_BLADES_SPRITES);
    expect(s.liveBlades).toBe(0);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('a Tier I blade draws a finite transform every frame (no NaN from summon to stuck)', () => {
    const s = new HeroBladesScene(TEX, COLORS, LOOK, 1, 3);
    const [m] = motions(P1);
    s.summon(m!, A, 0);
    for (let t = 0; t < m!.arrive + 400; t += 16) {
      s.update(16);
      for (const layer of s.root.children) for (const ch of (layer as Container).children) {
        expect(Number.isFinite(ch.x) && Number.isFinite(ch.y) && Number.isFinite(ch.rotation) && Number.isFinite(ch.scale.x)).toBe(true);
      }
    }
    expect(s.stuckBlades).toBe(1);
    s.destroy();
  });

  it('clear() drops everything in flight at once; the pool is reused, not regrown', () => {
    const s = new HeroBladesScene(TEX, COLORS, LOOK, 1, 9);
    const ms = motions(P3);
    ms.forEach((m) => s.summon(m, A, 0));
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    ms.forEach((m) => s.summon(m, A, 0));
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 10);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Phantom Blades (attack_blades) is a Legendary crate hero attack that plays the Blades; the dev override can force it; Blast, Quake and Arcana unchanged', () => {
    expect(COSMETIC_INDEX.attack_blades).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Phantom Blades', assets: { style: 'blades' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy']); // Enraged Strike, Poison Darts, Frost, then Consecration (holy) joined 2026-09-28
    expect(styleOfCosmetic('attack_blades')).toBe('blades');
    expect(styleOfCosmetic('attack_blast')).toBe('blast');
    expect(styleOfCosmetic('attack_quake')).toBe('quake');
    expect(styleOfCosmetic('attack_arcana')).toBe('arcana');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_blades' })).toBe('blades');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'blades' })).toBe('blades');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_blades' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_blades_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
