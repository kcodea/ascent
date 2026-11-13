// @vitest-environment jsdom
/**
 * THE FOURTH WALL HERO ATTACK (style `glass`, ANCIENT, dev-only): the shared four tiers; the tuner values; the pure plan
 * (I the chip; II the web from two pebbles; III the pane that breaks out and repairs; IV the race, the held beat and the
 * shatter); the pure glass geometry (the cracks ARE the shard edges; IV's shards number forty to seventy and TILE the
 * screen; everything from the seed; everything on the screen); the runner on the shared clock (the blow lands exactly
 * ONCE; both directions; replay; finish / cancel; every exit puts the portraits and the camera back; nothing of the
 * glass is left on screen); the headless scene.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  GLASS_CAPS, HERO_GLASS_DEFAULTS, HERO_GLASS_RANGES, buildWeb, clampHeroGlassValue, glassCameraAt, glassCues, glassGeo, glassPlan, glassScale,
  glassSeed, glassSlowExtraMs, heroGlassConfigJson, rayExit, screenWeb, stoneAt, webFlips, webTris, type Box, type HeroGlassNumKey, type ShardTri,
} from './heroGlassConfig';
import { seededRng } from '../heroAttack/easing';
import { HeroGlassScene, MAX_GLASS_SPRITES, SHARDS_PER_MESH, type HeroGlassTextures } from './heroGlassScene';
import { playHeroGlass, type HeroGlassOptions } from './heroGlass';
import { SPEC } from '../HeroGlassTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

// jsdom's window is 1024 x 768; the glass is the SCREEN, so give it the design size the fixtures' portraits sit in.
Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });

const W = Texture.WHITE;
const TEX: HeroGlassTextures = { glow: W, ring: W, star: W, spark: W, streak: W, crack: W, chip: W, stone: W, shard: W, sliver: W, glint: W, wash: W };
const C = HERO_GLASS_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; knockoutVariant?: boolean; reduced?: boolean } = {}) => glassPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 200, y: 850 }, D = { x: 1500, y: 300 };
const R = 80;
const SCREEN: Box = { x: 0, y: 0, w: 1920, h: 1080 };
const geoOf = (total: number, a = A, d = D, seed = 7) => glassGeo(plan(total), a, d, R, R, C, SCREEN, seed, 1);

/** Is (x, y) inside the triangle (edges included)? */
function inTri(t: ShardTri, x: number, y: number): boolean {
  const s = (i: number, j: number): number => (t.x[j]! - t.x[i]!) * (y - t.y[i]!) - (t.y[j]! - t.y[i]!) * (x - t.x[i]!);
  const a = s(0, 1), b = s(1, 2), c = s(2, 0);
  return (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) || (a <= 1e-6 && b <= 1e-6 && c <= 1e-6);
}

describe('the tiers', () => {
  it('uses the shared thresholds; a knockout plays IV (the shatter)', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).tier, `dmg ${d}`).toBe(tierOf(d));
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'shatter' });
    expect([plan(3).kind, plan(8).kind, plan(14).kind, plan(40).kind]).toEqual(['chip', 'web', 'pane', 'shatter']);
  });

  it('is registered as a dev-only style with no cosmetic', () => {
    expect(HERO_ATTACK_STYLES).toContain('glass');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('glass');
    expect(styleOfCosmetic('attack_glass')).toBeNull();
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; all four tier buttons on top', () => {
    for (const [k, [min, max]] of Object.entries(HERO_GLASS_RANGES)) {
      const v = C[k as HeroGlassNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroGlassValue('creakJumps', 999)).toBe(10);
    expect(clampHeroGlassValue('colorGlass', 'glass')).toBe(C.colorGlass);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroGlassConfigJson(C)).previewParts).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions!.map((a) => a.label);
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)']) expect(labels).toContain(l);
  });

  it('never uses the overused rune explosion or turn explosion sounds; its own clips are the five glass clips', () => {
    for (const [k, v] of Object.entries(C)) if (k.endsWith('Clip')) expect(String(v), k).not.toMatch(/turnexplosion|rune/i);
    const own = Object.entries(C).filter(([k, v]) => k.endsWith('Clip') && String(v).startsWith('fx/glass-')).map(([, v]) => v).sort();
    expect(own).toEqual(['fx/glass-creak', 'fx/glass-pane', 'fx/glass-race', 'fx/glass-shatter', 'fx/glass-tick']);
  });
});

describe('the plan', () => {
  it('I, the chip: one pebble; its tap is the blow; the cracks heal after a beat', () => {
    const p = plan(3);
    expect(p.stones).toHaveLength(1);
    expect(p.impactAt).toBe(p.stones[0]!.hitAt);
    expect(p.hits).toEqual([]);
    expect(p.breakAt).toBe(-1);
    expect(p.healAt).toBeGreaterThan(p.impactAt + 300);
    expect(p.healEnd - p.healAt).toBe(C.healMs);
    expect(p.endAt).toBeGreaterThanOrEqual(p.healEnd);
    expect(glassCues(p).filter((q) => q.kind === 'impact')).toHaveLength(1);
  });

  it('II, the web: two pebbles in quick succession; the first is a tick, the second the blow; the cracks spread in jumps', () => {
    const p = plan(8);
    expect(p.stones).toHaveLength(2);
    expect(p.stones[1]!.hitAt - p.stones[0]!.hitAt).toBe(C.secondMs);
    expect(p.hits).toEqual([p.stones[0]!.hitAt]);
    expect(p.impactAt).toBe(p.stones[1]!.hitAt);
    expect(p.jumps[0]).toBe(p.stones[0]!.hitAt);
    expect(p.jumps[1]).toBe(p.impactAt);
    for (let i = 1; i < p.jumps.length; i++) expect(p.jumps[i]!).toBeGreaterThan(p.jumps[i - 1]!);
    const kinds = glassCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'tap')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'creak')).toHaveLength(C.creakJumps - 1);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
  });

  it('III, the pane: the rock is the blow; the pane breaks out a beat later, the hole stays, then it repairs and the cracks heal', () => {
    const p = plan(14);
    expect(p.stones).toHaveLength(1);
    expect(p.impactAt).toBe(p.stones[0]!.hitAt);
    expect(p.breakAt).toBeGreaterThanOrEqual(p.impactAt + C.breakMs);
    expect(p.breakAt).toBeGreaterThan(p.jumps[p.jumps.length - 1]!); // the web has grown before the pane goes
    expect(p.repairAt - p.breakAt).toBe(C.holeMs);
    expect(p.healAt).toBe(p.repairAt);
    expect(p.endAt).toBeGreaterThanOrEqual(p.healEnd);
    expect(glassCues(p).map((q) => q.kind).filter((k) => k === 'break' || k === 'repair')).toEqual(['break', 'repair']);
  });

  it('IV, the shatter: no pebble; the crack races, a held beat creaks, and the shatter is the blow', () => {
    const p = plan(40);
    expect(p.stones).toEqual([]);
    expect(p.raceAt).toBe(p.fireAt);
    expect(p.raceEnd).toBeGreaterThan(p.raceAt + 200);
    expect(p.impactAt - p.raceEnd).toBe(C.t4HoldMs);
    expect(p.breakAt).toBe(p.impactAt);
    expect(p.jumps.length).toBe(C.creakJumps + 2);
    expect(p.jumps[0]!).toBeGreaterThan(p.raceAt);
    expect(p.jumps[p.jumps.length - 1]!).toBeLessThan(p.impactAt);
    const kinds = glassCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'race')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds).not.toContain('heal');
  });

  it('pace: every look sits inside its scaffold source\'s lengths (after the formation); IV under 3.2 s', () => {
    const len = (d: number): number => { const p = plan(d); return p.endAt - p.chargeAt + glassSlowExtraMs(p, C); };
    expect(len(3)).toBeLessThan(1470);
    expect(len(8)).toBeLessThan(1740);
    expect(len(14)).toBeLessThan(2100);
    expect(len(40)).toBeLessThanOrEqual(3200);
    expect(len(3)).toBeLessThan(len(8));
    expect(len(8)).toBeLessThan(len(14));
  });

  it('IV\'s shatter gets a slow-mo DIP that never freezes (R-PROG-ATTACK-10); no other look dips; the Knockout dips deeper', () => {
    const p = plan(40);
    for (let t = p.impactAt - 50; t < p.impactAt + C.slowMoMs + 50; t += 5) expect(glassScale(p, C, t)).toBeGreaterThan(0.09);
    expect(glassScale(p, C, p.impactAt + 1)).toBeLessThan(0.5);
    for (const d of [3, 8, 14]) { const q = plan(d); expect(glassScale(q, C, q.impactAt + 10)).toBe(1); }
    const ko = plan(40, { knockout: true, knockoutVariant: true });
    expect(ko.ko).toBe(true);
    expect(glassScale(ko, C, ko.impactAt + 1)).toBeLessThan(glassScale(p, C, p.impactAt + 1));
    expect(plan(40, { knockout: true }).ko).toBe(false);
  });

  it('reduced motion: nothing flies or cracks; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([40], true));
    expect(p.stones).toEqual([]);
    expect(p.jumps).toEqual([]);
    expect(glassGeo(p, A, D, R, R, C, SCREEN, 7).segs).toEqual([]);
  });

  it('the camera: at rest before the charge and long after; pushed in during the race; every value finite', () => {
    const p = plan(40);
    expect(glassCameraAt(p, C, p.chargeAt - 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(glassCameraAt(p, C, (p.raceEnd + p.impactAt) / 2).zoom).toBeGreaterThan(1.03);
    for (let t = 0; t < p.endAt + 200; t += 7) { const m = glassCameraAt(p, C, t); expect(Number.isFinite(m.zoom + m.x + m.y)).toBe(true); expect(m.zoom).toBeLessThanOrEqual(1.25); }
  });
});

describe('the glass (pure geometry, from the seed)', () => {
  it('a web: spoke 0 points along the aim, an even web has a straight spoke through the middle, the last ring is never pulled in', () => {
    const o = { x: 500, y: 400 };
    const w = buildWeb(seededRng(3), o, 0.7, 10, [50, 120, 300]);
    expect(w.nodes).toHaveLength(3);
    for (const row of w.nodes) expect(row).toHaveLength(10);
    for (const row of w.nodes) {
      expect(Math.atan2(row[0]!.y - o.y, row[0]!.x - o.x)).toBeCloseTo(0.7, 6);
      expect(Math.atan2(row[5]!.y - o.y, row[5]!.x - o.x)).toBeCloseTo(0.7 - Math.PI, 6);
    }
    for (const n of w.nodes[2]!) expect(Math.hypot(n.x - o.x, n.y - o.y)).toBeGreaterThanOrEqual(300 - 1e-6);
    // The cells tile the web: their areas sum to the outer ring's polygon.
    const tris = webTris(w, webFlips(seededRng(4), w));
    const area = (t: ShardTri): number => Math.abs((t.x[1]! - t.x[0]!) * (t.y[2]! - t.y[0]!) - (t.x[2]! - t.x[0]!) * (t.y[1]! - t.y[0]!)) / 2;
    const ring = w.nodes[2]!;
    let poly = 0;
    for (let i = 0; i < ring.length; i++) { const p = ring[i]!, q = ring[(i + 1) % ring.length]!; poly += p.x * q.y - q.x * p.y; }
    expect(tris.reduce((s, t) => s + area(t), 0)).toBeCloseTo(Math.abs(poly) / 2, 3);
    expect(tris).toHaveLength(10 * (1 + 2 * 2));
  });

  it('IV: forty to seventy shards that TILE the whole screen, wherever the struck portrait is', () => {
    const spots = [D, A, { x: 960, y: 540 }, { x: 1800, y: 80 }, { x: 60, y: 1040 }, { x: 960, y: 60 }, { x: 120, y: 500 }];
    for (const [i, d] of spots.entries()) {
      for (const seed of [1, 99, 123456]) {
        const { tris, web } = screenWeb(seed, d, 0.4 + i, R, SCREEN);
        expect(tris.length, `${i} seed ${seed}`).toBeGreaterThanOrEqual(GLASS_CAPS.minShards);
        expect(tris.length, `${i} seed ${seed}`).toBeLessThanOrEqual(GLASS_CAPS.shards);
        expect(web.spokes % 2).toBe(0);
        for (let x = 4; x < 1920; x += 59) {
          for (let y = 4; y < 1080; y += 53) {
            if (!tris.some((t) => inTri(t, x, y))) throw new Error(`a gap in the glass at ${x},${y} (portrait ${i}, seed ${seed})`);
          }
        }
      }
    }
  });

  it('IV: the main crack runs edge to edge through BOTH portraits, racing from the striker and arriving by the end of the race', () => {
    for (const [a, d] of [[A, D], [D, A]] as const) {
      const p = plan(40);
      const g = geoOf(40, a, d);
      expect(g.main).not.toBeNull();
      const { a: e0, b: e1 } = g.main!;
      const onEdge = (q: { x: number; y: number }): boolean => Math.min(Math.abs(q.x), Math.abs(q.x - 1920), Math.abs(q.y), Math.abs(q.y - 1080)) < 1.5;
      expect(onEdge(e0)).toBe(true);
      expect(onEdge(e1)).toBe(true);
      // Both portraits sit on the line between the two ends.
      const L = Math.hypot(e1.x - e0.x, e1.y - e0.y);
      const off = (q: { x: number; y: number }): number => Math.abs((e1.x - e0.x) * (q.y - e0.y) - (e1.y - e0.y) * (q.x - e0.x)) / L;
      expect(off(a)).toBeLessThan(1);
      expect(off(d)).toBeLessThan(1);
      // The heavy pieces are the main crack: they start at the striker at `raceAt` and are all drawn by `raceEnd`.
      const heavy = g.segs.filter((s) => s.w >= 1.39);
      expect(heavy.length).toBeGreaterThanOrEqual(4);
      expect(Math.min(...heavy.map((s) => s.t0))).toBeCloseTo(p.raceAt, 3);
      expect(Math.max(...heavy.map((s) => s.t1))).toBeLessThanOrEqual(p.raceEnd + 0.5);
      const first = heavy.reduce((m, s) => (s.t0 < m.t0 ? s : m));
      expect(Math.hypot(first.ax - a.x, first.ay - a.y)).toBeLessThan(2);
      // The pieces between the two portraits grow TOWARD the struck one.
      for (const s of heavy) if (off({ x: s.ax, y: s.ay }) < 12 && Math.hypot(s.ax - d.x, s.ay - d.y) < Math.hypot(a.x - d.x, a.y - d.y) - 2 && Math.hypot(s.ax - a.x, s.ay - a.y) < Math.hypot(a.x - d.x, a.y - d.y)) {
        expect(Math.hypot(s.bx - d.x, s.by - d.y)).toBeLessThan(Math.hypot(s.ax - d.x, s.ay - d.y) + 12);
      }
      // The rest of the web only starts once the crack is well on its way, and is done before the shatter.
      const rest = g.segs.filter((s) => s.w < 1.39 * C.crackWidth && s.t0 >= p.jumps[0]!);
      expect(rest.length).toBeGreaterThan(30);
      expect(Math.max(...g.segs.map((s) => s.t1))).toBeLessThan(p.impactAt);
    }
  });

  it('I: one chip and three short cracks on the portrait. II: two chips either side whose webs reach each other. III: the pane is eight shards round the portrait', () => {
    const one = geoOf(3);
    expect(one.chips).toHaveLength(1);
    expect(one.taps).toHaveLength(1);
    expect(Math.hypot(one.taps[0]!.x - D.x, one.taps[0]!.y - D.y)).toBeLessThan(R * 0.3);
    expect(one.tris).toEqual([]);
    for (const s of one.segs) expect(Math.hypot(s.bx - one.origin.x, s.by - one.origin.y)).toBeLessThan(R * C.t1Web * 1.8);
    // Three cracks leave the chip itself.
    expect(one.segs.filter((s) => Math.hypot(s.ax - one.origin.x, s.ay - one.origin.y) < 0.5)).toHaveLength(3);

    const two = geoOf(8);
    expect(two.chips).toHaveLength(2);
    const gap = Math.hypot(two.taps[0]!.x - two.taps[1]!.x, two.taps[0]!.y - two.taps[1]!.y);
    expect(gap).toBeGreaterThan(R * 0.4);
    expect(gap).toBeLessThan(R * 1.2);
    // Each web reaches past the other tap: they join.
    const reach = (o: { x: number; y: number }): number => Math.max(...two.segs.map((s) => Math.hypot(s.bx - o.x, s.by - o.y)));
    expect(reach(two.taps[0]!)).toBeGreaterThan(gap);
    for (const s of two.segs) expect(Math.hypot(s.bx - D.x, s.by - D.y)).toBeLessThan(R * C.t2Web * 2.2); // about the size of the portrait
    // The first pebble's first cracks are there before the second lands.
    const p2 = plan(8);
    expect(two.segs.filter((s) => s.t1 < p2.impactAt).length).toBeGreaterThanOrEqual(7);

    const three = geoOf(14);
    expect(three.tris).toHaveLength(8);
    for (const t of three.tris) { expect(t.dist).toBeLessThan(R * 1.2); for (let v = 0; v < 3; v++) expect(Math.hypot(t.x[v]! - D.x, t.y[v]! - D.y)).toBeLessThan(R * 1.5); }
    expect(Math.max(...three.segs.map((s) => Math.hypot(s.bx - D.x, s.by - D.y)))).toBeGreaterThan(R * 2.6); // a large web
  });

  it('every crack that is drawn is on (or within a hair of) the screen, under the cap, sorted by start, and finite', () => {
    for (const total of [3, 8, 14, 40]) {
      for (const [a, d] of [[A, D], [D, A], [{ x: 960, y: 1000 }, { x: 960, y: 90 }], [{ x: 1850, y: 540 }, { x: 70, y: 540 }]] as const) {
        const g = geoOf(total, a, d, 11);
        expect(g.segs.length).toBeGreaterThan(0);
        expect(g.segs.length).toBeLessThanOrEqual(GLASS_CAPS.cracks);
        for (let i = 0; i < g.segs.length; i++) {
          const s = g.segs[i]!;
          expect(Number.isFinite(s.ax + s.ay + s.bx + s.by + s.len + s.ang + s.t0 + s.t1)).toBe(true);
          expect(s.t1).toBeGreaterThanOrEqual(s.t0);
          if (i) expect(s.t0).toBeGreaterThanOrEqual(g.segs[i - 1]!.t0);
          const m = { x: (s.ax + s.bx) / 2, y: (s.ay + s.by) / 2 };
          const near = (q: { x: number; y: number }): boolean => q.x > -21 && q.x < 1941 && q.y > -21 && q.y < 1101;
          expect(near({ x: s.ax, y: s.ay }) || near({ x: s.bx, y: s.by }) || near(m), `${total}: a crack off the screen`).toBe(true);
        }
        for (const c of g.chips) { expect(c.at.x).toBeGreaterThanOrEqual(0); expect(c.at.x).toBeLessThanOrEqual(1920); }
      }
    }
  });

  it('deterministic: the same blow cracks the same way; another seed cracks differently; the side and the roll change the seed', () => {
    expect(geoOf(40, A, D, 5)).toEqual(geoOf(40, A, D, 5));
    expect(geoOf(14, A, D, 5)).toEqual(geoOf(14, A, D, 5));
    expect(geoOf(40, A, D, 5).segs).not.toEqual(geoOf(40, A, D, 6).segs);
    expect(glassSeed(12, 900, 'player')).not.toBe(glassSeed(12, 900, 'opp'));
    expect(glassSeed(12, 900, 'player', 1)).not.toBe(glassSeed(12, 900, 'player', 2));
    expect(glassSeed(12, 900, 'player', 4)).toBe(glassSeed(12, 900, 'player', 4));
  });

  it('a ray leaves the screen at its edge; a pebble flies from the hand to its tap and is gone the moment it lands', () => {
    expect(rayExit({ x: 100, y: 100 }, 0, SCREEN)).toBeCloseTo(1820, 6);
    expect(rayExit({ x: 100, y: 100 }, -Math.PI / 2, SCREEN)).toBeCloseTo(100, 6);
    expect(rayExit({ x: -5, y: 100 }, 0, SCREEN)).toBe(0);
    const p = plan(3);
    const g = geoOf(3);
    const s = p.stones[0]!;
    expect(stoneAt(s, g.hand, g.taps[0]!, C.stoneArc, s.launchAt - 1).phase).toBe('hand');
    const mid = stoneAt(s, g.hand, g.taps[0]!, C.stoneArc, (s.launchAt + s.hitAt) / 2);
    expect(mid.phase).toBe('fly');
    expect(mid.p.y).toBeLessThan((g.hand.y + g.taps[0]!.y) / 2); // lobbed
    expect(stoneAt(s, g.hand, g.taps[0]!, C.stoneArc, s.hitAt)).toMatchObject({ phase: 'done', p: g.taps[0] });
    for (let t = s.launchAt; t < s.hitAt; t += 9) { const q = stoneAt(s, g.hand, g.taps[0]!, C.stoneArc, t).p; expect(q.x).toBeGreaterThan(-50); expect(q.y).toBeGreaterThan(-50); expect(q.x).toBeLessThan(1970); expect(q.y).toBeLessThan(1130); }
  });
});

function manualFrames(): { frames: HeroGlassOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroGlassOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  // The portraits carry their own resting look: every exit must hand it back untouched.
  attackerEl.style.transform = 'translateX(3px)'; attackerEl.style.opacity = '0.9'; attackerEl.className = 'hero me';
  defenderEl.style.transform = 'scale(0.98)'; defenderEl.style.filter = 'saturate(1.1)'; defenderEl.className = 'hero foe';
  document.body.append(host, camera);
  const h = playHeroGlass({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 250 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

function expectRestored(r: ReturnType<typeof run>): void {
  expect(r.camera.style.transform).toBe('');
  expect(r.attackerEl.style.transform).toBe('translateX(3px)');
  expect(r.attackerEl.style.opacity).toBe('0.9');
  expect(r.attackerEl.style.filter).toBe('');
  expect(r.attackerEl.className).toBe('hero me');
  expect(r.defenderEl.style.transform).toBe('scale(0.98)');
  expect(r.defenderEl.style.filter).toBe('saturate(1.1)');
  expect(r.defenderEl.style.opacity).toBe('');
  expect(r.defenderEl.className).toBe('hero foe');
  expect(r.host.querySelector('.hblast')).toBeNull();
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('I: the pebble flies, taps once (the blow), the chip and its cracks show, then heal; everything is put back', () => {
    const r = run({ total: 3, formation: formationOf([3], 3) });
    const { h, f, onImpact, onDone } = r;
    expect(r.host.querySelector('.hblast.hglass')).not.toBeNull();
    const s = h.plan.stones[0]!;
    f.tick((s.launchAt + s.hitAt) / 2, 4);
    expect(h.scene!.stonesFlying).toBe(1);
    expect(h.scene!.liveCracks).toBe(0);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(r.host.querySelector('.hblast-hit')!.textContent).toBe('-3');
    expect(h.scene!.stonesFlying).toBe(0);
    expect(h.scene!.chipCount).toBe(1);
    f.tick(200, 4);
    expect(h.scene!.liveCracks).toBe(h.scene!.crackCount);
    expect(h.scene!.marksAlpha).toBe(1);
    f.tick(h.plan.healEnd - h.elapsed() + 8, 4);
    expect(h.scene!.marksAlpha).toBe(0); // healed
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    f.tick(3000, 16);
    expect(f.hooked()).toBe(0);
    expect(r.root.children).toHaveLength(0);
  });

  it('II: the first pebble only ticks (a chip, a few cracks); the second is the blow; the web grows in jumps', () => {
    const { h, f, onImpact } = run({ total: 8, formation: formationOf([8], 8) });
    f.tick(h.plan.hits[0]! + 60, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.chipCount).toBe(1);
    const early = h.scene!.liveCracks;
    expect(early).toBeGreaterThan(0);
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.chipCount).toBe(2);
    let prev = h.scene!.liveCracks, steps = 0;
    for (let t = 0; t < C.t2GrowMs + 120; t += 8) { f.tick(8, 8); const n = h.scene!.liveCracks; if (n > prev) steps++; prev = n; }
    expect(steps).toBeGreaterThanOrEqual(3); // it creaks outward in several jumps
    expect(prev).toBe(h.scene!.crackCount);
    h.cancel();
  });

  it('III: the rock is the blow; the pane breaks out (its shards fall, a hole stays), then repairs; nothing is left', () => {
    const r = run({ total: 14, formation: formationOf([14], 14) });
    const { h, f, onImpact } = r;
    expect(h.scene!.shardCount).toBe(8);
    f.tick(h.plan.impactAt + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.shardsFalling).toBe(0);
    expect(h.scene!.holeAlpha).toBe(0);
    f.tick(h.plan.breakAt - h.elapsed() + 120, 4);
    expect(h.scene!.shardsFalling).toBeGreaterThan(0);
    expect(h.scene!.holeAlpha).toBeCloseTo(0.5, 5);
    f.tick(h.plan.repairAt - h.elapsed() + 260, 4);
    expect(h.scene!.holeAlpha).toBe(0);
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(h.done).toBe(true);
    expect(h.scene!.marksAlpha).toBe(0);
    expectRestored(r);
    f.tick(3000, 16);
    expect(h.scene!.shardsFalling).toBe(0);
    expect(f.hooked()).toBe(0);
    expect(r.root.children).toHaveLength(0);
    expect(onImpact).toHaveBeenCalledTimes(1);
  });

  it('IV: the crack races, the web creaks out, then the WHOLE SCREEN SHATTERS: the one blow; the shards fall away and nothing is left', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, f, onImpact, onDone } = r;
    expect(h.scene!.shardCount).toBeGreaterThanOrEqual(GLASS_CAPS.minShards);
    expect(h.scene!.shardCount).toBeLessThanOrEqual(GLASS_CAPS.shards);
    f.tick((h.plan.raceAt + h.plan.raceEnd) / 2, 4);
    const racing = h.scene!.liveCracks;
    expect(racing).toBeGreaterThan(0);
    expect(h.scene!.chipCount).toBe(1); // where the striker punched the glass
    f.tick(h.plan.impactAt - 20 - h.elapsed(), 4);
    expect(h.scene!.liveCracks).toBe(h.scene!.crackCount);
    expect(h.scene!.liveCracks).toBeGreaterThan(racing * 3);
    expect(h.scene!.shardsFalling).toBe(0);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.marksAlpha).toBe(0); // the cracks went with the glass
    expect(h.scene!.shardsFalling).toBe(h.scene!.shardCount);
    let peak = 0;
    for (let t = 0; t < 4000 && !h.done; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
    expect(peak).toBeLessThanOrEqual(MAX_GLASS_SPRITES);
    expect(onDone).toHaveBeenCalledTimes(1);
    expectRestored(r);
    f.tick(4000, 16);
    expect(h.scene!.shardsFalling).toBe(0); // every shard fell off the screen
    expect(f.hooked()).toBe(0);
    expect(r.root.children).toHaveLength(0);
    expect(onImpact).toHaveBeenCalledTimes(1);
  });

  it('both directions at every tier: one blow, under the caps; the camera applied once when the canvas rides it', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 250 };
        const d = side === 'player' ? { x: 1400, y: 250 } : { x: 100, y: 800 };
        const r = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < r.h.plan.endAt + 900; t += 16) { r.f.tick(16, 16); peak = Math.max(peak, r.h.scene!.liveSprites); }
        expect(r.onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_GLASS_SPRITES);
        expect(r.h.scene!.crackCount).toBeLessThanOrEqual(GLASS_CAPS.cracks);
        expect(r.h.done).toBe(true);
        expectRestored(r);
        r.h.cancel();
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

  it('every exit restores everything: finish() lands once; cancel() never lands; mid-shatter too; reduced motion lands once', () => {
    const a = run();
    a.f.tick(200, 16);
    a.h.finish();
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(a);
    expect(a.root.children).toHaveLength(0);
    const b = run();
    b.f.tick(b.h.plan.fireAt + 100, 16);
    b.h.cancel();
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.f.hooked()).toBe(0);
    expectRestored(b);
    expect(b.root.children).toHaveLength(0);
    // Mid-race, mid-shatter and mid-hole: the portraits and the camera come back, the scene is gone.
    for (const [total, when] of [[40, 'race'], [40, 'shatter'], [14, 'hole']] as const) {
      for (const exit of ['finish', 'cancel'] as const) {
        const x = run({ total, formation: formationOf([total], total) });
        const at = when === 'race' ? (x.h.plan.raceAt + x.h.plan.raceEnd) / 2 : when === 'shatter' ? x.h.plan.impactAt + 120 : x.h.plan.breakAt + 100;
        x.f.tick(at, 8);
        expect(x.h.done).toBe(false);
        x.h[exit]();
        expectRestored(x);
        expect(x.f.hooked(), `${when} ${exit}`).toBe(0);
        expect(x.root.children, `${when} ${exit}`).toHaveLength(0);
        expect(x.h.scene!.root.destroyed).toBe(true);
        expect(x.onImpact).toHaveBeenCalledTimes(when === 'race' && exit === 'cancel' ? 0 : 1);
        x.h.cancel(); // a second exit is harmless
      }
    }
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });

  it('a replay plays the same glass; the roll seed and the direction change it', () => {
    const x = run({ total: 40, formation: formationOf([40], 40), rollSeed: 9 });
    const y = run({ total: 40, formation: formationOf([40], 40), rollSeed: 9 });
    const z = run({ total: 40, formation: formationOf([40], 40), rollSeed: 10 });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.geo).toEqual(y.h.geo);
    expect(x.h.geo.segs).not.toEqual(z.h.geo.segs);
    x.h.cancel(); y.h.cancel(); z.h.cancel();
  });
});

describe('the scene (headless Pixi)', () => {
  it('the cracks grow from their near end and stay; a finished web is never touched again', () => {
    const scene = new HeroGlassScene(TEX, { glass: 0xbfe3ff, edge: 0xffffff, shade: 0x0a1626, flash: 0xe2f3ff, stone: 0x9a9186, side: 0xffe9b0 },
      { gravity: 3000, burst: 300, spin: 2.2, rim: 9, stonePx: 34, impactSize: 1, splitAlpha: 0.07 }, 1, 3);
    const p = plan(40);
    const g = geoOf(40);
    scene.setArea(SCREEN);
    scene.setCracks(g.segs);
    expect(scene.crackCount).toBe(g.segs.length);
    expect(scene.liveCracks).toBe(0);
    let prev = 0;
    for (let t = p.raceAt; t <= p.impactAt; t += 8) { scene.growCracks(t); scene.update(8); const n = scene.liveCracks; expect(n).toBeGreaterThanOrEqual(prev); prev = n; }
    expect(prev).toBe(g.segs.length);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
    scene.setMarksAlpha(1); scene.setHole(1); scene.growCracks(1e6); scene.destroy(); // harmless after the end
  });

  it('the shards: batched meshes, they all fall off the bottom, the scene drains, and destroy leaves nothing', () => {
    const scene = new HeroGlassScene(TEX, { glass: 0xbfe3ff, edge: 0xffffff, shade: 0x0a1626, flash: 0xe2f3ff, stone: 0x9a9186, side: 0xffe9b0 },
      { gravity: 3000, burst: 300, spin: 2.2, rim: 9, stonePx: 34, impactSize: 1, splitAlpha: 0.07 }, 1, 3);
    const g = geoOf(40);
    scene.setArea(SCREEN);
    scene.setShards(g.tris, g.origin, 'shatter');
    expect(scene.shardCount).toBe(g.tris.length);
    expect(SHARDS_PER_MESH * 6).toBeLessThanOrEqual(100); // each mesh batches with the sprites
    expect(scene.shardsFalling).toBe(0);
    scene.breakOut();
    scene.shatterFx(g.origin, true);
    expect(scene.shardsFalling).toBe(g.tris.length);
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_GLASS_SPRITES);
    let alive = true, frames = 0;
    for (; frames < 400 && alive; frames++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.shardsFalling).toBe(0);
    expect(frames * 16).toBeLessThan(2400); // gone inside two and a half seconds
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});
