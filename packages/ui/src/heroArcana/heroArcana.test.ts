// @vitest-environment jsdom
/**
 * THE ARCANA HERO ATTACK (owner 2026-09-28: "one more attack animation, same setup as the last 2, but let's make like a
 * magic one called arcana. tier 1 attack will be s clean pixi ribbon arc'd and lobbed from hero location. tier 2 attack
 * will be 2 of those. tier 3 attack will be barrage of 5 of those. tier 4 attack will be a swirl of them over the
 * opponent hero frame and then they explode and ribbon/pixi blast outward"): the tier mapping SHARED with Blast and
 * Quake; the tier -> ribbons ladder (1 / 2 / 5 / the vortex); the tuner defaults + clamping; the pure plan (the total is
 * the engine's number, the barrage rhythm, the impact beat, reduced motion, determinism); the pure ribbon paths (a lob
 * that rises and lands on the target; the vortex circling the struck hero and collapsing into it); the camera; the
 * runner on the shared clock (the consequence lands exactly ONCE, on the last ribbon or the explosion, never on a
 * barrage tick; both directions; slow motion; replay; finish / cancel; cleanup); the headless scene (pooled, bounded,
 * drains, destroy leaves nothing); and the cosmetic resolution.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_BLAST_DEFAULTS, blastPlan } from '../heroBlast/heroBlastConfig';
import { HERO_QUAKE_DEFAULTS, quakePlan } from '../heroQuake/heroQuakeConfig';
import { DEV_HERO_ATTACK_CHOICES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  ARCANA_CAPS, HERO_ARCANA_DEFAULTS, HERO_ARCANA_RANGES, arcanaCameraAt, arcanaCameraFocus, arcanaCues, arcanaFlightMs, arcanaPlan,
  clampHeroArcanaValue, fanSlots, heroArcanaConfigJson, lobEase, lobPath, ribbonMotions, ribbonPos, sanitizeHeroArcanaConfig, sideNormal,
  vortexPhase, type HeroArcanaConfig, type HeroArcanaNumKey,
} from './heroArcanaConfig';
import { HeroArcanaScene, MAX_ARCANA_MESHES, MAX_ARCANA_SPRITES, RIBBON_POINTS, type HeroArcanaTextures } from './heroArcanaScene';
import { arcanaSeed, playHeroArcana, type HeroArcanaOptions } from './heroArcana';
import { SPEC } from '../HeroArcanaTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroArcanaTextures = { glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W };
const C = HERO_ARCANA_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => arcanaPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xffffff, accent: 0x72f1ff, side: 0xa45bff, shade: 0x1a0833 };
const LOOK = { lengthMs: 150, glow: 2.6, core: 0.34, shade: 0.34, twist: 0.4, strand: 0.55, headSize: 1, sigilSize: 1 };
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with Blast and Quake)', () => {
  it('Arcana steps up on exactly the blows Blast and Quake do: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(blastPlan({ total: d, distance: 1600 }, HERO_BLAST_DEFAULTS).tier);
      expect(t).toBe(quakePlan({ total: d, distance: 1600 }, HERO_QUAKE_DEFAULTS).tier);
    }
  });

  it('the owner\'s ladder: I ONE ribbon, II TWO, III a barrage of FIVE, IV the vortex', () => {
    expect([P1, P2, P3, P4].map((p) => p.ribbons.length)).toEqual([1, 2, 5, 6]);
    expect([P1, P2, P3, P4].map((p) => p.swirl)).toEqual([false, false, false, true]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.swirl ? 'swirl' : p.ribbons.length; }))
      .toEqual([1, 1, 2, 2, 5, 5, 'swirl', 'swirl']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_ARCANA_RANGES)) {
      const v = C[k as HeroArcanaNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorAccent', 'colorPlayer', 'colorFoe', 'colorShade'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroArcanaValue('t3Ribbons', 99)).toBe(8);
    expect(clampHeroArcanaValue('t1Ribbons', 0)).toBe(1);
    expect(clampHeroArcanaValue('ribbonGlow', -3)).toBe(1);
    expect(clampHeroArcanaValue('swirlMs', 99999)).toBe(2000);
    expect(clampHeroArcanaValue('ribbonLength', Number.NaN)).toBe(C.ribbonLength);
    expect(clampHeroArcanaValue('ribbonLength', 'abc')).toBe(C.ribbonLength);
    expect(clampHeroArcanaValue('ribbonLength', '200')).toBe(200);
    expect(clampHeroArcanaValue('colorAccent', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroArcanaValue('colorPlayer', 'purple')).toBe(C.colorPlayer);
    expect(clampHeroArcanaValue('sfxLaunchClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroArcanaValue('nope' as keyof HeroArcanaConfig, 1)).toBeUndefined();
    expect(clampHeroArcanaValue('toString' as keyof HeroArcanaConfig, 1)).toBeUndefined();
    const s = sanitizeHeroArcanaConfig({ t4Motes: 400, colorCore: 'x', bogus: 3 });
    expect(s.t4Motes).toBe(80);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroArcanaConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Arcana', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroArcanaConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Swirl).toBe(1);
    expect(json.t3Ribbons).toBe(5);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('arcana');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('arcana');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe huge (40)', '▶ Reduced motion', 'Speed 1x', 'Speed 0.5x', 'Speed 0.25x']) {
      expect(labels).toContain(l);
    }
  });
});

describe('the plan', () => {
  it('THE BARRAGE: five ribbons land in rhythm, the first four are ticks, the LAST is the impact (only one impact beat)', () => {
    const arr = P3.ribbons.map((r) => r.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!, `arrival ${i}`).toBeGreaterThan(arr[i - 1]!);
    const gaps = arr.slice(1).map((a, i) => a - arr[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(30); // an even rhythm
    expect(P3.impactAt).toBe(arr[arr.length - 1]);
    expect(P3.hits).toEqual(arr.slice(0, -1));
    const kinds = arcanaCues(P3).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'fire')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
    // the last to land is the centre ribbon, and the biggest
    expect(P3.ribbons[4]!.size).toBeGreaterThan(P3.ribbons[0]!.size);
  });

  it('Tier II is a PAIR on different heights and opposite sides; Tier I one ribbon, straight to the impact', () => {
    const [a, b] = P2.ribbons;
    expect(Math.sign(a!.side)).not.toBe(Math.sign(b!.side));
    expect(a!.lift).toBeGreaterThan(b!.lift * 1.5);
    expect(P2.hits).toHaveLength(1);
    expect(P1.ribbons).toHaveLength(1);
    expect(P1.hits).toEqual([]);
    expect(P1.impactAt).toBe(P1.ribbons[0]!.arriveAt);
  });

  it('Tier IV: the ribbons ORBIT (no ticks), the vortex forms on the first arrival, collapses after the last, and the EXPLOSION is the impact', () => {
    const kinds = arcanaCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(0);
    expect(kinds.filter((k) => k === 'orbit')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(at('fire')).toBeLessThan(at('swirl'));
    expect(at('swirl')).toBeLessThan(at('converge'));
    expect(at('converge')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('boom'));
    expect(P4.swirlAt).toBe(Math.min(...P4.ribbons.map((r) => r.arriveAt)));
    expect(P4.convergeAt).toBeGreaterThan(Math.max(...P4.ribbons.map((r) => r.arriveAt)));
    expect(P4.impactAt).toBe(P4.convergeAt + C.convergeMs);
  });

  it('every tier escalates: more shake, zoom, hit-stop, glitter and burst; II+ dims', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      for (const k of ['shakePx', 'zoom', 'motes', 'burst', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    }
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1600 px apart): first launch, impact and end, ms', () => {
    // Timed from the charge: the style's own attack, after the shared damage formation (pinned in formation.test.ts).
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.fireAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual([
      [260, 820, 1328], [340, 1085, 1673], [420, 1425, 2073], [420, 1854, 2574],
    ]);
    // Brisk at Tier I (about 2 s), about 4 s at Tier IV (owner: "satisfying and chunky, not rushed").
    expect(t(P1)[2]).toBeLessThanOrEqual(2100);
    expect(t(P4)[2]).toBeLessThanOrEqual(4200);
  });

  it('the fan launches outer ribbons first and the centre last', () => {
    expect(fanSlots(1)).toEqual([0]);
    expect(fanSlots(2)).toEqual([-1, 1]);
    expect(fanSlots(5)).toEqual([-2, 2, -1, 1, 0]);
    expect(fanSlots(6)).toEqual([-3, 3, -2, 2, -1, 1]);
  });

  it('the caps always hold, whatever the sliders say; flight scales gently with distance', () => {
    const wild: HeroArcanaConfig = { ...C, t3Ribbons: 8, t4Motes: 80, t4Shake: 40, t4Zoom: 0.14 };
    const w = arcanaPlan({ total: 15, distance: 800 }, wild);
    expect(w.ribbons.length).toBeLessThanOrEqual(ARCANA_CAPS.ribbons);
    const v = arcanaPlan({ total: 99, distance: 800 }, wild);
    expect(v.motes).toBeLessThanOrEqual(ARCANA_CAPS.motes);
    expect(arcanaFlightMs(1600, 500)).toBe(500);
    expect(arcanaFlightMs(100, 500)).toBe(310);
    expect(arcanaFlightMs(99999, 500)).toBe(575);
  });

  it('reduced motion: no ribbons, charge, shake, zoom, dim or hit-stop; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.ribbons.length]).toEqual([0, 0, 0, 0]);
    const kinds = arcanaCues(p).map((q) => q.kind);
    for (const k of ['charge', 'fire', 'hit', 'swirl', 'orbit']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(arcanaCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(ribbonMotions(p, A, D, 80, C)).toEqual([]);
  });

  it('is deterministic: the same fight plans the same beats and the same paths (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(arcanaCues(plan([4, 2, 3], 9, 720))).toEqual(arcanaCues(plan([4, 2, 3], 9, 720)));
    expect(ribbonMotions(P4, A, D, 80, C)).toEqual(ribbonMotions(P4, A, D, 80, C));
    expect(arcanaSeed(14, 1500.2, 'player')).toBe(arcanaSeed(14, 1500.4, 'player'));
    expect(arcanaSeed(14, 1500, 'player')).not.toBe(arcanaSeed(14, 1500, 'opp'));
  });
});

describe('the ribbon paths', () => {
  it('a lob leaves the hero, rises toward the TOP of the screen, comes DOWN onto the target, and lands exactly on it', () => {
    const [m] = ribbonMotions(P1, A, D, 80, C);
    expect(ribbonPos(m!, 0)).toEqual(A);
    expect(ribbonPos(m!, m!.flightMs)).toEqual(D);
    expect(ribbonPos(m!, m!.flightMs + 500)).toEqual(D);
    const mid = ribbonPos(m!, m!.flightMs / 2);
    expect(mid.y).toBeLessThan((A.y + D.y) / 2 - 100); // a high arc, not a bolt
    const late = ribbonPos(m!, m!.flightMs * 0.97);
    expect(late.y).toBeLessThan(D.y); // still above the target just before it lands: it dives in
    // the top-edge ceiling: the controls never rise above it, so the lob stays in frame
    const [c] = ribbonMotions(P1, A, D, 80, C, 40);
    expect(Math.min(c!.lob.c1.y, c!.lob.c2.y)).toBeGreaterThanOrEqual(40);
    expect(lobEase(0)).toBe(0);
    expect(lobEase(1)).toBe(1);
  });

  it('a pair swings apart: two clearly separate arcs, each to its own side', () => {
    const [a, b] = ribbonMotions(P2, A, D, 80, C);
    const n = sideNormal(A, D);
    const side = (m: typeof a): number => { const p = ribbonPos(m!, m!.flightMs / 2); return (p.x - (A.x + D.x) / 2) * n.x + (p.y - (A.y + D.y) / 2) * n.y; };
    const [ra, rb] = P2.ribbons;
    expect((side(a) - side(b)) * (ra!.side - rb!.side)).toBeGreaterThan(0);
    expect(Math.abs(side(a) - side(b))).toBeGreaterThan(150);
  });

  it('works both ways: a foe lob from the top down to you still rises first', () => {
    const [m] = ribbonMotions(P1, D, A, 80, C);
    expect(ribbonPos(m!, 0)).toEqual(D);
    expect(ribbonPos(m!, m!.flightMs)).toEqual(A);
    const l = lobPath(D, A, 0.3);
    expect(l.c1.y).toBeLessThan(D.y);
  });

  it('Tier IV: each ribbon lands ON the vortex, circles the struck hero at the vortex radius, then collapses into it', () => {
    const r = 80;
    const ms = ribbonMotions(P4, A, D, r, C);
    for (const [i, m] of ms.entries()) {
      const v = m.vortex!;
      expect(v, `vortex ${i}`).not.toBeNull();
      const land = ribbonPos(m, m.flightMs);
      expect(land.x).toBeCloseTo(m.lob.b.x, 6);
      expect(land.y).toBeCloseTo(m.lob.b.y, 6);
      // on the ellipse: ((x-cx)/R)^2 + ((y-cy)/(R*tilt))^2 ~ 1 at the radius it is at
      let angles = 0;
      let prev = Math.atan2((land.y - D.y) / C.swirlTilt, land.x - D.x);
      for (let t = m.flightMs; t <= v.end; t += 8) {
        const p = ribbonPos(m, t);
        const rr = Math.hypot(p.x - D.x, (p.y - D.y) / C.swirlTilt);
        expect(rr).toBeLessThanOrEqual(r * C.swirlRadius + 0.5);
        expect(rr).toBeGreaterThanOrEqual(r * C.swirlRadius * (1 - C.swirlTighten) - 0.5);
        const a = Math.atan2((p.y - D.y) / C.swirlTilt, p.x - D.x);
        let da = a - prev; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        angles += da; prev = a;
      }
      expect(Math.abs(angles), `ribbon ${i} turns`).toBeGreaterThan(Math.PI); // it really circles
      const end = ribbonPos(m, v.end + v.converge);
      expect(end.x).toBeCloseTo(D.x, 4);
      expect(end.y).toBeCloseTo(D.y, 4);
    }
    // evenly spaced round the ring (every ribbon rides the same spin)
    const t = P4.convergeAt;
    const angs = ms.map((m, i) => { const p = ribbonPos(m, t - P4.ribbons[i]!.launchAt); return Math.atan2((p.y - D.y) / C.swirlTilt, p.x - D.x); }).sort((a, b) => a - b);
    const gaps = angs.map((a, i) => (i ? a - angs[i - 1]! : a + 2 * Math.PI - angs[angs.length - 1]!));
    for (const g of gaps) expect(g).toBeCloseTo((2 * Math.PI) / 6, 3);
    // it speeds up
    const v = ms[0]!.vortex!;
    expect(vortexPhase(v, 400) - vortexPhase(v, 300)).toBeGreaterThan(vortexPhase(v, 100) - vortexPhase(v, 0));
  });
});

describe('the camera', () => {
  it('pushes in through the charge, punches in on the impact and shakes ALONG the arriving ribbon; rests by the end', () => {
    const [m] = ribbonMotions(P3, A, D, 80, C);
    void m;
    const dir = { x: 0.6, y: -0.8 };
    const hit = arcanaCameraAt(P3, C, P3.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P3.zoom);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = arcanaCameraAt(P3, C, P3.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.6);
  });

  it('Tier IV builds on the vortex (zoom and tremor grow), then the explosion punches hardest', () => {
    const early = arcanaCameraAt(P4, C, P4.swirlAt + 20);
    const late = arcanaCameraAt(P4, C, P4.impactAt - 10);
    expect(late.zoom).toBeGreaterThan(early.zoom);
    const boom = arcanaCameraAt(P4, C, P4.impactAt + 1);
    expect(boom.zoom).toBeGreaterThan(arcanaCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(arcanaCameraFocus(P4, P4.swirlAt, A, D)).toEqual(D);
    expect(arcanaCameraFocus(P4, P4.fireAt, A, D)).toEqual(A);
    const rest = arcanaCameraAt(P4, C, P4.endAt);
    expect(rest.zoom).toBeCloseTo(1, 2);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroArcanaOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroArcanaOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroArcana({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: 80,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('THE BARRAGE lands the blow EXACTLY ONCE, on the LAST ribbon: never on a tick; holds the hit-stop; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.ribbons).toHaveLength(5);
    expect(host.querySelector('.hblast.harcana')).not.toBeNull();
    // through every tick: no consequence yet
    f.tick(h.plan.hits[h.plan.hits.length - 1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveRibbons).toBeGreaterThan(0);
    expect(h.scene!.liveMeshes).toBeGreaterThan(0);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16); // the glitter drains, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: the vortex forms and the blow lands ONCE, on the explosion (not on any ribbon joining the ring)', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.swirl).toBe(true);
    f.tick(h.plan.swirlAt + 40, 4);
    expect(h.scene!.swirling).toBe(true);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveRibbons).toBe(6);
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.swirling).toBe(false);
    expect(h.scene!.liveRibbons).toBe(C.explodeRibbons); // the vortex ribbons became the blast streaks
    expect(h.scene!.liveMeshes).toBeLessThanOrEqual(MAX_ARCANA_MESHES);
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
        let peakS = 0, peakM = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peakS = Math.max(peakS, h.scene!.liveSprites); peakM = Math.max(peakM, h.scene!.liveMeshes); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peakS).toBeLessThanOrEqual(MAX_ARCANA_SPRITES);
        expect(peakM).toBeLessThanOrEqual(MAX_ARCANA_MESHES);
        const last = h.motions[h.motions.length - 1]!;
        // every ribbon flies from the attacker (to the struck hero, or its ring round the struck hero)
        expect(last.lob.a).toEqual(a);
        if (!h.plan.swirl) expect(last.lob.b).toEqual(d);
        else expect(Math.hypot(last.lob.b.x - d.x, last.lob.b.y - d.y)).toBeLessThanOrEqual(80 * C.swirlRadius + 1);
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

  it('a replay plays the same: the same fight flies the same paths and beats', () => {
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
    b.f.tick(b.h.plan.swirlAt + 100);
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
      const h = playHeroArcana({
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
  it('ribbons are strips of RIBBON_POINTS x 2 vertices (under the 100-vertex batch limit); a whole Tier IV stays in the caps and drains; destroy leaves nothing', () => {
    expect(RIBBON_POINTS * 2).toBeLessThanOrEqual(100);
    const s = new HeroArcanaScene(TEX, COLORS, LOOK, 1, 42);
    const ms = ribbonMotions(P4, A, D, 80, C);
    s.startCharge(A.x, A.y, 70, 400, 1, ms.length, 30);
    for (let i = 0; i < 25; i++) s.update(16);
    let peakS = 0, peakM = 0;
    ms.forEach((m) => { const v = m.vortex!; s.fire(m, 22, 1, 0, { cx: v.cx, cy: v.cy, r: (v.r0 + v.r1) / 2, tilt: v.tilt, start: v.start, end: v.end, w0: v.w0, w1: v.w1 }); });
    expect(s.charging).toBe(true); // released over the next frames
    s.startVortex(D.x, D.y, 124, 68, 0.5, 700, 120, 1);
    for (let i = 0; i < 70; i++) { s.update(16); peakS = Math.max(peakS, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes); }
    expect(s.charging).toBe(false);
    expect(s.liveRibbons).toBe(6);
    s.converge();
    s.explode(D.x, D.y, 80, { burst: 1.9, size: 1, ribbons: 12, motes: 46, flashAlpha: 0.95, tilt: 0.5, dir: 1, width: 22 });
    s.boom(D.x + 40, D.y, 1); s.boom(D.x - 40, D.y, 1.1);
    peakS = Math.max(peakS, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes);
    expect(peakS).toBeLessThanOrEqual(MAX_ARCANA_SPRITES);
    expect(peakM).toBeLessThanOrEqual(MAX_ARCANA_MESHES);
    expect(s.liveRibbons).toBe(12);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.liveRibbons).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('a Tier I ribbon draws finite geometry every frame (no NaN at launch, in flight, or landing) and fades after it lands', () => {
    const s = new HeroArcanaScene(TEX, COLORS, LOOK, 1, 3);
    const [m] = ribbonMotions(P1, A, D, 80, C);
    s.fire(m!, 26, 1);
    for (let t = 0; t < m!.flightMs + 400; t += 16) {
      s.update(16);
      const meshes = s.root.children.flatMap((l) => (l as Container).children).filter((ch) => 'vertices' in ch && ch.visible) as unknown as { vertices: Float32Array }[];
      for (const mesh of meshes) for (const v of mesh.vertices) expect(Number.isFinite(v)).toBe(true);
    }
    expect(s.liveRibbons).toBe(0);
    s.destroy();
  });

  it('clear() drops everything in flight at once; the pool is reused, not regrown', () => {
    const s = new HeroArcanaScene(TEX, COLORS, LOOK, 1, 9);
    const ms = ribbonMotions(P3, A, D, 80, C);
    ms.forEach((m) => s.fire(m, 24, 1));
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.update(16)).toBe(false);
    ms.forEach((m) => s.fire(m, 24, 1));
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 10);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Arcana (attack_arcana) is a Legendary crate hero attack that plays Arcana; the dev override can force it; Blast and Quake unchanged', () => {
    expect(COSMETIC_INDEX.attack_arcana).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Arcana', assets: { style: 'arcana' }, active: true });
    expect(styleOfCosmetic('attack_arcana')).toBe('arcana');
    expect(styleOfCosmetic('attack_blast')).toBe('blast');
    expect(styleOfCosmetic('attack_quake')).toBe('quake');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_arcana' })).toBe('arcana');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'arcana' })).toBe('arcana');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_arcana' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_arcana_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
