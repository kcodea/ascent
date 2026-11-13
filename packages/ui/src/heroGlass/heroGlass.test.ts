// @vitest-environment jsdom
/**
 * THE FOURTH WALL HERO ATTACK (style `glass`, ANCIENT, dev-only): the shared four tiers; the tuner values; the SEVEN
 * CAUSES (rolled from the stable roll seed, forced by the tuner, each with its own beats and its own crack shape); the
 * pure plan (Tier 1 the chip; Tier 2 the web; Tier 3 the pane that breaks out and repairs; Tier 4 the first crack, the tear, the held
 * beat and the shatter); the pure glass geometry (Tier 4's cracks ARE the shard edges; its shards number forty to seventy
 * and TILE the screen; everything from the seed; everything on the screen); the runner on the shared clock (the blow
 * lands exactly ONCE; both directions; replay; finish / cancel; every exit puts the portraits, the z-order class and the
 * camera back; the glass stays nailed to the screen while the camera moves; nothing of it is left); the headless scene.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  GLASS_CAPS, GLASS_CAUSES, GLASS_CAUSE_NAMES, HERO_GLASS_DEFAULTS, HERO_GLASS_RANGES, buildWeb, causeBeats, causeOf, clampHeroGlassValue, glassCameraAt,
  glassCues, glassGeo, glassPlan, glassScale, glassSeed, glassSlowExtraMs, heroGlassConfigJson, legPoint, rayExit, screenWeb, webFlips, webTris,
  type Box, type GlassCause, type HeroGlassNumKey, type ShardTri,
} from './heroGlassConfig';
import { seededRng } from '../heroAttack/easing';
import { BOLD_W, HeroGlassScene, MAX_GLASS_SPRITES, SHARDS_PER_MESH, type HeroGlassTextures } from './heroGlassScene';
import { playHeroGlass, type HeroGlassOptions } from './heroGlass';
import { SPEC } from '../HeroGlassTuner';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

// jsdom's window is 1024 x 768; the glass is the SCREEN, so give it the design size the fixtures' portraits sit in.
Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });

const W = Texture.WHITE;
const TEX: HeroGlassTextures = { glow: W, ring: W, star: W, spark: W, streak: W, crack: W, tear: W, chip: W, shard: W, sliver: W, glint: W, wash: W, line: W };
const C = HERO_GLASS_DEFAULTS;
type PlanOver = { knockout?: boolean; knockoutVariant?: boolean; reduced?: boolean; cause?: GlassCause };
const plan = (total: number, o: PlanOver = {}) => glassPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 200, y: 850 }, D = { x: 1500, y: 300 };
const R = 80;
const SCREEN: Box = { x: 0, y: 0, w: 1920, h: 1080 };
const geoOf = (total: number, cause: GlassCause = 'butt', a = A, d = D, seed = 7) => glassGeo(plan(total, { cause }), a, d, R, R, C, SCREEN, seed, 1);
const TOTALS = [3, 8, 14, 40] as const;
const onEdge = (q: { x: number; y: number }, m = 1.5): boolean => Math.min(Math.abs(q.x), Math.abs(q.x - 1920), Math.abs(q.y), Math.abs(q.y - 1080)) < m;

/** Is (x, y) inside the triangle (edges included)? */
function inTri(t: ShardTri, x: number, y: number): boolean {
  const s = (i: number, j: number): number => (t.x[j]! - t.x[i]!) * (y - t.y[i]!) - (t.y[j]! - t.y[i]!) * (x - t.x[i]!);
  const a = s(0, 1), b = s(1, 2), c = s(2, 0);
  return (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) || (a <= 1e-6 && b <= 1e-6 && c <= 1e-6);
}

describe('the tiers', () => {
  it('uses the shared thresholds; a knockout plays Tier 4 (the shatter)', () => {
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
  it('defaults in range; clamping; every key has a control; Copy JSON; the four tier buttons and the Knockout buttons on top', () => {
    for (const [k, [min, max]] of Object.entries(HERO_GLASS_RANGES)) {
      const v = C[k as HeroGlassNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroGlassValue('creakJumps', 999)).toBe(10);
    expect(clampHeroGlassValue('colorGlass', 'glass')).toBe(C.colorGlass);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroGlassConfigJson(C));
    expect(json.previewParts).toBeUndefined();
    expect(json.variation).toBeUndefined(); // a dev override is never shipped
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions!.map((a) => a.label);
    // The play buttons' labels are the shared tuner helper's (being renamed to Tier 1..4 elsewhere): match by damage.
    for (const n of ['(3)', '(8)', '(12)', '(40)']) expect(labels.some((l) => l.startsWith('▶') && l.endsWith(n)), n).toBe(true);
    for (const l of ['▶ Knockout (40)', '▶ Foe knockout (40)']) expect(labels).toContain(l);
  });

  it('the Variation row forces any of the seven causes (Random by default), right under the Attack style row', () => {
    const v = SPEC.controls[1]!;
    expect(v.key).toBe('variation');
    expect(v.options).toEqual(['', ...GLASS_CAUSES]);
    expect(C.variation).toBe('');
    for (const id of GLASS_CAUSES) expect(GLASS_CAUSE_NAMES[id].length).toBeGreaterThan(10);
  });

  it('never uses the overused rune explosion or turn explosion sounds; its own clips are the twelve glass clips, all registered', () => {
    for (const [k, v] of Object.entries(C)) if (k.endsWith('Clip')) expect(String(v), k).not.toMatch(/turnexplosion|rune/i);
    const own = Object.entries(C).filter(([k, v]) => k.endsWith('Clip') && String(v).startsWith('fx/glass-')).map(([, v]) => String(v)).sort();
    expect(own).toEqual(['fx/glass-body', 'fx/glass-crash', 'fx/glass-creak', 'fx/glass-knock', 'fx/glass-pane', 'fx/glass-pop', 'fx/glass-race', 'fx/glass-shatter', 'fx/glass-sing', 'fx/glass-squeak', 'fx/glass-swell', 'fx/glass-tick']);
    for (const [k, v] of Object.entries(C)) if (k.endsWith('Clip') && String(v).startsWith('fx/')) expect(ATTACK_FX_CLIPS.glass, k).toContain(v);
  });
});

describe('the causes (rolled per fight)', () => {
  it('the roll is stable for a seed, covers all seven, and the tuner can force each', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) { const a = causeOf(seed, C); expect(causeOf(seed, C)).toBe(a); seen.add(a); }
    expect([...seen].sort()).toEqual([...GLASS_CAUSES].sort());
    for (const id of GLASS_CAUSES) for (const seed of [1, 2, 3, 99]) expect(causeOf(seed, { ...C, variation: id })).toBe(id);
    expect(causeOf(5, { ...C, variation: 'nonsense' })).toBe(causeOf(5, C));
  });

  it('each cause has its own beats before the crack; a bigger look creeps and bounces once more', () => {
    expect(causeBeats('butt', 2)).toEqual([]);
    expect(causeBeats('knock', 2)).toHaveLength(2); // tap, tap (the KNOCK is the crack)
    expect(causeBeats('shock', 2)).toEqual([0]); // the stamp
    expect(causeBeats('creep', 1)).toHaveLength(3);
    expect(causeBeats('creep', 4)).toHaveLength(5);
    expect(causeBeats('ricochet', 1)).toHaveLength(2);
    expect(causeBeats('ricochet', 3)).toHaveLength(3);
    for (const id of GLASS_CAUSES) for (const f of causeBeats(id, 3)) { expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(1); }
    // The hum's pulses quicken.
    const h = causeBeats('hum', 2);
    for (let i = 2; i < h.length; i++) expect(h[i]! - h[i - 1]!).toBeLessThan(h[i - 1]! - h[i - 2]! + 1e-9);
  });
});

describe('the plan', () => {
  it('Tiers 1 to 3, every cause: its beats, then the glass cracks and THAT is the blow; never a mark before it', () => {
    for (const cause of GLASS_CAUSES) {
      for (const total of [3, 8, 14]) {
        const p = plan(total, { cause });
        expect(p.cause).toBe(cause);
        expect(p.strikeAt).toBeGreaterThan(p.fireAt + 100);
        expect(p.impactAt).toBe(p.strikeAt);
        expect(p.hits).toEqual([]);
        expect(p.pre).toHaveLength(causeBeats(cause, p.tier).length);
        for (let i = 0; i < p.pre.length; i++) { expect(p.pre[i]!).toBeGreaterThanOrEqual(p.fireAt); expect(p.pre[i]!).toBeLessThan(p.strikeAt); if (i) expect(p.pre[i]!).toBeGreaterThan(p.pre[i - 1]!); }
        expect(p.jumps[0]).toBe(p.impactAt);
        for (let i = 1; i < p.jumps.length; i++) expect(p.jumps[i]!).toBeGreaterThan(p.jumps[i - 1]!);
        const kinds = glassCues(p).map((q) => q.kind);
        expect(kinds.filter((k) => k === 'impact'), `${cause} ${total}`).toHaveLength(1);
        expect(kinds.filter((k) => k === 'fire')).toHaveLength(1);
        expect(kinds.filter((k) => k === 'pre')).toHaveLength(p.pre.length);
        expect(kinds).not.toContain('strike');
        expect(kinds).not.toContain('race');
        expect(kinds.filter((k) => k === 'creak')).toHaveLength(p.jumps.length - 1);
        expect(kinds[kinds.length - 1]).toBe('end');
      }
    }
  });

  it('Tier 1 heals after a beat; Tier 2 spreads in jumps then heals; Tier 3 breaks the pane out, holds the hole, repairs', () => {
    const one = plan(3);
    expect(one.breakAt).toBe(-1);
    expect(one.healAt).toBeGreaterThan(one.impactAt + 300);
    expect(one.healEnd - one.healAt).toBe(C.healMs);
    expect(one.endAt).toBeGreaterThanOrEqual(one.healEnd);
    const two = plan(8);
    expect(two.jumps).toHaveLength(C.creakJumps);
    expect(two.healAt).toBe(two.jumps[two.jumps.length - 1]! + C.t2HoldMs);
    const p = plan(14);
    expect(p.breakAt).toBeGreaterThanOrEqual(p.impactAt + C.breakMs);
    expect(p.breakAt).toBeGreaterThan(p.jumps[p.jumps.length - 1]!); // the web has grown before the pane goes
    expect(p.repairAt - p.breakAt).toBe(C.holeMs);
    expect(p.healAt).toBe(p.repairAt);
    expect(p.endAt).toBeGreaterThanOrEqual(p.healEnd);
    expect(glassCues(p).map((q) => q.kind).filter((k) => k === 'break' || k === 'repair')).toEqual(['break', 'repair']);
  });

  it('Tier 4, every cause: the cause cracks the glass (a mark), the tear runs, a long held beat creaks, and the SHATTER is the blow', () => {
    for (const cause of GLASS_CAUSES) {
      const p = plan(40, { cause });
      expect(p.hits).toEqual([p.strikeAt]);
      expect(p.raceAt).toBeGreaterThan(p.strikeAt);
      expect(p.raceEnd).toBeGreaterThan(p.raceAt + 300);
      expect(p.impactAt - p.raceEnd).toBe(C.t4HoldMs);
      expect(C.t4HoldMs).toBeGreaterThanOrEqual(700); // real tension, not a blink
      expect(p.breakAt).toBe(p.impactAt);
      expect(p.jumps.length).toBe(C.creakJumps + 3);
      expect(p.jumps[0]!).toBeGreaterThan(p.raceAt);
      expect(p.jumps[p.jumps.length - 1]!).toBeLessThan(p.impactAt);
      const kinds = glassCues(p).map((q) => q.kind);
      for (const k of ['strike', 'race', 'tense', 'impact'] as const) expect(kinds.filter((x) => x === k), `${cause} ${k}`).toHaveLength(1);
      expect(kinds.indexOf('strike')).toBeLessThan(kinds.indexOf('race'));
      expect(kinds.indexOf('tense')).toBeLessThan(kinds.indexOf('impact'));
      expect(kinds).not.toContain('heal');
    }
  });

  it('THE STRUCK HERO REACTS (FX only): Tier 1 leans in; Tier 2 presses and knocks twice from inside; Tier 3 knocks then its shove breaks the pane; Tier 4 pounds through the hold, then the inhale', () => {
    for (const cause of GLASS_CAUSES) {
      const one = plan(3, { cause }), two = plan(8, { cause }), three = plan(14, { cause }), four = plan(40, { cause });
      for (const p of [one, two, three]) {
        expect(p.pressAt, cause).toBeGreaterThan(p.impactAt); // after the blow: a reaction, never a second blow
        expect(p.pressEnd).toBeGreaterThan(p.pressAt);
        expect(p.inhaleAt).toBe(-1);
        for (const k of p.knocksIn) { expect(k).toBeGreaterThan(p.pressAt); expect(k).toBeLessThan(p.healAt); }
      }
      expect(one.knocksIn).toEqual([]);
      expect(one.healAt).toBeGreaterThanOrEqual(one.pressAt + 300);
      expect(two.knocksIn).toHaveLength(2);
      expect(two.healAt).toBeGreaterThan(two.knocksIn[1]!);
      expect(three.knocksIn).toHaveLength(1);
      expect(three.breakAt).toBeGreaterThan(three.knocksIn[0]!); // the shove after the knock breaks it
      expect(three.pressEnd).toBe(three.breakAt);
      expect(four.knocksIn).toHaveLength(2);
      for (const k of four.knocksIn) { expect(k).toBeGreaterThan(four.raceEnd); expect(k).toBeLessThan(four.inhaleAt); }
      expect(four.impactAt - four.inhaleAt).toBe(C.inhaleMs);
      expect(four.pressEnd).toBe(four.inhaleAt);
      const kinds = glassCues(four).map((q) => q.kind);
      expect(kinds.filter((k) => k === 'inknock')).toHaveLength(2);
      expect(kinds.indexOf('inhale')).toBeLessThan(kinds.indexOf('impact'));
      expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    }
    expect(plan(3, { reduced: true })).toMatchObject({ pressAt: -1, knocksIn: [], inhaleAt: -1 });
  });

  it('pace: each look is longer than the one below it; Tier 4 runs about as long as the other top attacks (3.2 to 5.2 s after the formation)', () => {
    const len = (d: number, cause: GlassCause): number => { const p = plan(d, { cause }); return p.endAt - p.chargeAt + glassSlowExtraMs(p, C); };
    for (const cause of GLASS_CAUSES) {
      expect(len(3, cause), cause).toBeLessThan(2000);
      expect(len(8, cause), cause).toBeLessThan(2400);
      expect(len(14, cause), cause).toBeLessThan(2900);
      expect(len(3, cause)).toBeLessThan(len(8, cause));
      expect(len(8, cause)).toBeLessThan(len(14, cause));
      expect(len(40, cause), cause).toBeGreaterThan(3200);
      expect(len(40, cause), cause).toBeLessThan(5200);
      // The aftermath lingers: at least 1.2 s of shards and dust after the shatter.
      const p = plan(40, { cause });
      expect(p.endAt - p.impactAt).toBeGreaterThanOrEqual(1200);
    }
  });

  it('Tier 4\'s shatter gets a slow-mo DIP that never freezes (R-PROG-ATTACK-10); no other look dips; the Knockout dips deeper', () => {
    const p = plan(40);
    for (let t = p.impactAt - 50; t < p.impactAt + C.slowMoMs + 50; t += 5) expect(glassScale(p, C, t)).toBeGreaterThan(0.09);
    expect(glassScale(p, C, p.impactAt + 1)).toBeLessThan(0.5);
    for (const d of [3, 8, 14]) { const q = plan(d); expect(glassScale(q, C, q.impactAt + 10)).toBe(1); }
    const ko = plan(40, { knockout: true, knockoutVariant: true });
    expect(ko.ko).toBe(true);
    expect(ko.shakePx).toBeGreaterThan(p.shakePx);
    expect(glassScale(ko, C, ko.impactAt + 1)).toBeLessThan(glassScale(p, C, p.impactAt + 1));
    expect(plan(40, { knockout: true }).ko).toBe(false);
  });

  it('reduced motion: nothing moves or cracks; the blow lands at the end of the formation', () => {
    for (const cause of GLASS_CAUSES) {
      const p = plan(40, { reduced: true, cause });
      expect(p.impactAt).toBe(leadInOf([40], true));
      expect(p.pre).toEqual([]);
      expect(p.jumps).toEqual([]);
      const g = glassGeo(p, A, D, R, R, C, SCREEN, 7);
      expect(g.segs).toEqual([]);
      expect(g.chips).toEqual([]);
    }
  });

  it('the camera: at rest before the charge and long after; pushed in through the held beat; every value finite and capped', () => {
    for (const cause of GLASS_CAUSES) {
      const p = plan(40, { cause });
      expect(glassCameraAt(p, C, p.chargeAt - 10)).toEqual({ zoom: 1, x: 0, y: 0 });
      expect(glassCameraAt(p, C, (p.raceEnd + p.impactAt) / 2).zoom).toBeGreaterThan(1.03);
      for (let t = 0; t < p.endAt + 200; t += 7) { const m = glassCameraAt(p, C, t); expect(Number.isFinite(m.zoom + m.x + m.y)).toBe(true); expect(m.zoom).toBeLessThanOrEqual(1.25); expect(Math.hypot(m.x, m.y)).toBeLessThan(80); }
      const late = glassCameraAt(p, C, p.endAt + 2500);
      expect(late.zoom).toBeCloseTo(1, 3);
      expect(Math.hypot(late.x, late.y)).toBeLessThan(0.5);
    }
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

  it('Tier 4: forty to seventy shards that TILE the whole screen, wherever the struck portrait is', () => {
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

  it('Tier 4: ONE BOLD TEAR runs edge to edge through BOTH portraits, both ways from the struck one, forking; then the rest of the web', () => {
    for (const cause of GLASS_CAUSES) {
      for (const [a, d] of [[A, D], [D, A]] as const) {
        const p = plan(40, { cause });
        const g = geoOf(40, cause, a, d);
        expect(g.main).not.toBeNull();
        const { a: e0, b: e1 } = g.main!;
        expect(onEdge(e0)).toBe(true);
        expect(onEdge(e1)).toBe(true);
        // Both portraits sit on the line between the two ends.
        const L = Math.hypot(e1.x - e0.x, e1.y - e0.y);
        const off = (q: { x: number; y: number }): number => Math.abs((e1.x - e0.x) * (q.y - e0.y) - (e1.y - e0.y) * (q.x - e0.x)) / L;
        expect(off(a)).toBeLessThan(1);
        expect(off(d)).toBeLessThan(1);
        // The tear is HEAVY (it draws with the bold texture), starts at the struck point when the race starts, and is
        // all drawn by the end of the race.
        expect(g.segs.filter((s) => s.w >= BOLD_W).length).toBeGreaterThanOrEqual(6); // the tear and the first piece of each fork draw bold
        const heavy = g.segs.filter((s) => s.w >= 2.7 * C.tearWidth * 0.74);
        expect(heavy.length, cause).toBeGreaterThanOrEqual(6);
        expect(Math.min(...heavy.map((s) => s.t0))).toBeCloseTo(p.raceAt, 3);
        expect(Math.max(...heavy.map((s) => s.t1))).toBeLessThanOrEqual(p.raceEnd + 0.5);
        for (const s of heavy) expect(off({ x: s.ax, y: s.ay }), 'a heavy piece off the tear').toBeLessThan(12);
        const starts = heavy.filter((s) => Math.hypot(s.ax - d.x, s.ay - d.y) < 2);
        expect(starts).toHaveLength(2); // one arm each way
        // It forks: each fork is on the tear, inside the race, in time order, with a real branch leaving that point.
        expect(g.forks.length, cause).toBeGreaterThanOrEqual(3);
        expect(g.forks.length).toBeLessThanOrEqual(GLASS_CAPS.forks);
        g.forks.forEach((f, i) => {
          expect(off(f.at)).toBeLessThan(1);
          expect(f.t).toBeGreaterThanOrEqual(p.raceAt);
          expect(f.t).toBeLessThanOrEqual(p.raceEnd);
          if (i) expect(f.t).toBeGreaterThanOrEqual(g.forks[i - 1]!.t);
          expect(g.segs.some((s) => Math.hypot(s.ax - f.at.x, s.ay - f.at.y) < 0.5 && s.len > 30 && Math.abs(s.t0 - f.t) < 1)).toBe(true);
        });
        // The cause's own mark is there first; the rest of the web creaks out after the tear is under way, before the shatter.
        expect(g.segs.some((s) => s.t1 <= p.raceAt + 60)).toBe(true);
        expect(g.segs.filter((s) => s.t0 >= p.jumps[0]!).length).toBeGreaterThan(30);
        expect(Math.max(...g.segs.map((s) => s.t1))).toBeLessThan(p.impactAt);
        expect(g.tris.length).toBeGreaterThanOrEqual(GLASS_CAPS.minShards);
      }
    }
  });

  it('every cause leaves its OWN crack shape (Tier 2, the spreading version)', () => {
    const reach = R * C.t2Web;
    /** How radial a piece is: 1 = it points straight out of the struck point, 0 = it runs round it. */
    const radial = (s: { ax: number; ay: number; bx: number; by: number }): number => {
      const mx = (s.ax + s.bx) / 2 - D.x, my = (s.ay + s.by) / 2 - D.y, dx = s.bx - s.ax, dy = s.by - s.ay;
      return Math.abs(mx * dx + my * dy) / ((Math.hypot(mx, my) || 1) * (Math.hypot(dx, dy) || 1));
    };
    const fromHeart = (g: ReturnType<typeof geoOf>, r: number): number => g.segs.filter((s) => Math.hypot(s.ax - D.x, s.ay - D.y) < r).length;
    const shape = Object.fromEntries(GLASS_CAUSES.map((id) => [id, geoOf(8, id)])) as Record<GlassCause, ReturnType<typeof geoOf>>;

    // THE IMPACT STAR: ten spokes out of one point, with rings tying them.
    expect(shape.butt.segs.filter((s) => Math.hypot(s.ax - D.x, s.ay - D.y) < 0.5 && s.len > reach * 0.1)).toHaveLength(10);
    expect(shape.butt.segs.filter((s) => radial(s) < 0.5).length).toBeGreaterThan(12);
    // THE BULLSEYE: mostly rings (pieces running ROUND the point), three knuckle pits.
    const ringy = shape.knock.segs.filter((s) => radial(s) < 0.5).length;
    expect(ringy / shape.knock.segs.length).toBeGreaterThan(0.6);
    expect(shape.knock.chips).toHaveLength(3);
    expect(shape.knock.segs.filter((s) => s.t1 < plan(8, { cause: 'knock' }).impactAt).length).toBeGreaterThanOrEqual(3); // the taps already marked it
    // THE SUNBURST: all needles, no rings at all.
    const needles = geoOf(8, 'hum');
    const straight = needles.segs.filter((s) => s.len > reach * 0.2);
    expect(straight.length).toBeGreaterThanOrEqual(20);
    for (const s of straight) expect(radial(s)).toBeGreaterThan(0.95);
    // THE FRACTURE TREE: born on the screen edge, one piece per jerk, it reaches the portrait on the blow.
    const tree = shape.creep;
    const jerks = plan(8, { cause: 'creep' }).pre;
    expect(tree.path).toHaveLength(jerks.length + 1);
    expect(onEdge(tree.path[0]!)).toBe(true);
    expect(tree.path[tree.path.length - 1]).toEqual(tree.origin);
    expect(tree.segs.filter((s) => s.t0 < plan(8, { cause: 'creep' }).impactAt).length).toBeGreaterThanOrEqual(jerks.length);
    expect(tree.segs.some((s) => onEdge({ x: s.ax, y: s.ay }, 3))).toBe(true);
    // THE FROSTED CRAZE: a net of many short pieces under a haze, no spokes.
    const craze = shape.shock;
    expect(craze.frost).toMatchObject({ at: D });
    expect(craze.segs.length).toBeGreaterThan(40);
    expect(Math.max(...craze.segs.map((s) => s.len))).toBeLessThan(reach * 0.8);
    expect(fromHeart(craze, 0.5)).toBeLessThanOrEqual(3);
    expect(craze.chips).toEqual([]);
    // THE THERMAL CRACKS: six long wandering cracks from the hot spot.
    expect(fromHeart(shape.beam, R * 0.06)).toBe(6);
    expect(shape.beam.segs.filter((s) => radial(s) < 0.5).length).toBeLessThan(shape.beam.segs.length * 0.35);
    // THE SKID STAR: the bolt's legs touch the screen edges (a chip at each), and the star is thrown FORWARD.
    const skid = shape.ricochet;
    const bounces = plan(8, { cause: 'ricochet' }).pre.length;
    expect(skid.path).toHaveLength(bounces + 2);
    for (let i = 1; i <= bounces; i++) expect(onEdge(skid.path[i]!)).toBe(true);
    expect(skid.chips).toHaveLength(bounces + 1);
    const last = skid.path[skid.path.length - 2]!;
    const vx = D.x - last.x, vy = D.y - last.y;
    const ahead = skid.segs.filter((s) => s.t0 >= plan(8, { cause: 'ricochet' }).impactAt - 1 && Math.hypot(s.bx - D.x, s.by - D.y) > reach * 0.5);
    expect(ahead.length).toBeGreaterThan(4);
    for (const s of ahead) expect((s.bx - D.x) * vx + (s.by - D.y) * vy).toBeGreaterThan(0);

    // And no two causes draw the same glass.
    for (const a of GLASS_CAUSES) for (const b of GLASS_CAUSES) if (a < b) expect(shape[a].segs, `${a} vs ${b}`).not.toEqual(shape[b].segs);
    for (const id of GLASS_CAUSES) { if (id !== 'shock') expect(shape[id].frost).toBeNull(); if (id !== 'creep' && id !== 'ricochet') expect(shape[id].path).toEqual([]); }
  });

  it('every cause scales over the looks: a small mark, a spreading one, a big one whose pane (eight shards) breaks out', () => {
    for (const cause of GLASS_CAUSES) {
      const p = [3, 8, 14].map((d) => plan(d, { cause }));
      const g = [3, 8, 14].map((d) => geoOf(d, cause));
      // How far the mark itself reaches (the creeping crack's run-in and the bolt's edge chips are not the mark).
      const reach = g.map((x, i) => Math.max(...x.segs.filter((s) => s.t0 >= p[i]!.impactAt - 1).map((s) => Math.hypot(s.bx - D.x, s.by - D.y))));
      expect(reach[0]!, cause).toBeLessThan(R * C.t1Web * 1.9);
      expect(reach[1]!, cause).toBeGreaterThan(reach[0]!);
      expect(reach[2]!, cause).toBeGreaterThan(reach[1]! * 1.3);
      expect(reach[2]!, cause).toBeGreaterThan(R * 2.2);
      expect(g[1]!.segs.length, cause).toBeGreaterThan(g[0]!.segs.length);
      expect(g[2]!.segs.length, cause).toBeGreaterThan(g[1]!.segs.length);
      expect(g[0]!.tris).toEqual([]);
      expect(g[1]!.tris).toEqual([]);
      expect(g[2]!.tris).toHaveLength(8);
      for (const t of g[2]!.tris) { expect(t.dist).toBeLessThan(R * 1.2); for (let v = 0; v < 3; v++) expect(Math.hypot(t.x[v]! - D.x, t.y[v]! - D.y)).toBeLessThan(R * 1.5); }
      // The pane's outline cracks through just before it lets go.
      expect(g[2]!.segs.some((s) => s.t0 >= p[2]!.breakAt - 91 && s.t1 <= p[2]!.breakAt + 1)).toBe(true);
      // I is over quickly: every crack is drawn inside its short grow.
      expect(Math.max(...g[0]!.segs.map((s) => s.t1))).toBeLessThan(p[0]!.impactAt + C.t1GrowMs + 200);
    }
  });

  it('every crack that is drawn is on (or within a hair of) the screen, under the cap, sorted by start, and finite; so is every chip', () => {
    for (const cause of GLASS_CAUSES) {
      for (const total of TOTALS) {
        for (const [a, d] of [[A, D], [D, A], [{ x: 960, y: 1000 }, { x: 960, y: 90 }], [{ x: 1850, y: 540 }, { x: 70, y: 540 }]] as const) {
          const g = geoOf(total, cause, a, d, 11);
          expect(g.segs.length, `${cause} ${total}`).toBeGreaterThan(0);
          expect(g.segs.length, `${cause} ${total}`).toBeLessThan(GLASS_CAPS.cracks); // the cap never had to cut a line
          for (let i = 0; i < g.segs.length; i++) {
            const s = g.segs[i]!;
            expect(Number.isFinite(s.ax + s.ay + s.bx + s.by + s.len + s.ang + s.t0 + s.t1 + s.w)).toBe(true);
            expect(s.t1).toBeGreaterThanOrEqual(s.t0);
            if (i) expect(s.t0).toBeGreaterThanOrEqual(g.segs[i - 1]!.t0);
            const m = { x: (s.ax + s.bx) / 2, y: (s.ay + s.by) / 2 };
            const near = (q: { x: number; y: number }): boolean => q.x > -21 && q.x < 1941 && q.y > -21 && q.y < 1101;
            expect(near({ x: s.ax, y: s.ay }) || near({ x: s.bx, y: s.by }) || near(m), `${cause} ${total}: a crack off the screen`).toBe(true);
          }
          g.chips.forEach((c, i) => {
            expect(c.at.x).toBeGreaterThanOrEqual(0); expect(c.at.x).toBeLessThanOrEqual(1920);
            expect(c.at.y).toBeGreaterThanOrEqual(0); expect(c.at.y).toBeLessThanOrEqual(1080);
            if (i) expect(c.t).toBeGreaterThanOrEqual(g.chips[i - 1]!.t);
          });
          for (const q of g.path) { expect(q.x).toBeGreaterThanOrEqual(-1); expect(q.x).toBeLessThanOrEqual(1921); expect(q.y).toBeGreaterThanOrEqual(-1); expect(q.y).toBeLessThanOrEqual(1081); }
        }
      }
    }
  });

  it('deterministic: the same blow cracks the same way; another seed cracks differently; the side and the roll change the seed', () => {
    for (const cause of GLASS_CAUSES) {
      expect(geoOf(40, cause, A, D, 5)).toEqual(geoOf(40, cause, A, D, 5));
      expect(geoOf(14, cause, A, D, 5)).toEqual(geoOf(14, cause, A, D, 5));
      expect(geoOf(8, cause, A, D, 5).segs).not.toEqual(geoOf(8, cause, A, D, 6).segs);
    }
    expect(glassSeed(12, 900, 'player')).not.toBe(glassSeed(12, 900, 'opp'));
    expect(glassSeed(12, 900, 'player', 1)).not.toBe(glassSeed(12, 900, 'player', 2));
    expect(glassSeed(12, 900, 'player', 4)).toBe(glassSeed(12, 900, 'player', 4));
  });

  it('a ray leaves the screen at its edge; the bolt reaches every bounce exactly on its beat', () => {
    expect(rayExit({ x: 100, y: 100 }, 0, SCREEN)).toBeCloseTo(1820, 6);
    expect(rayExit({ x: 100, y: 100 }, -Math.PI / 2, SCREEN)).toBeCloseTo(100, 6);
    expect(rayExit({ x: -5, y: 100 }, 0, SCREEN)).toBe(0);
    const p = plan(14, { cause: 'ricochet' });
    const g = geoOf(14, 'ricochet');
    const times = [p.fireAt, ...p.pre, p.strikeAt];
    expect(times).toHaveLength(g.path.length);
    g.path.forEach((q, i) => { const at = legPoint(g.path, times, times[i]!).p; expect(at.x).toBeCloseTo(q.x, 6); expect(at.y).toBeCloseTo(q.y, 6); });
    expect(legPoint(g.path, times, p.fireAt - 50).p).toEqual(g.path[0]);
    expect(legPoint(g.path, times, p.strikeAt + 50).p).toEqual(g.origin);
    for (let t = p.fireAt; t < p.strikeAt; t += 7) { const q = legPoint(g.path, times, t).p; expect(q.x).toBeGreaterThanOrEqual(-1); expect(q.y).toBeGreaterThanOrEqual(-1); expect(q.x).toBeLessThanOrEqual(1921); expect(q.y).toBeLessThanOrEqual(1081); }
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

function run(over: Partial<HeroGlassOptions> & { cause?: GlassCause } = {}) {
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
  const { cause, ...rest } = over;
  const h = playHeroGlass({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 250 }, defenderRadius: R,
    reduced: false, cfg: { ...C, variation: cause ?? 'butt' }, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...rest,
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
  expect(document.body.className).toBe(''); // the headbutt's z-order class is gone
  expect(r.h.scene?.lightsOn ?? 0).toBe(0);
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  it('Tier 1, every cause: nothing lands before the glass cracks; it cracks once (the blow); the mark shows, heals; everything is put back', () => {
    for (const cause of GLASS_CAUSES) {
      const r = run({ cause, total: 3, formation: formationOf([3], 3) });
      const { h, f, onImpact, onDone } = r;
      expect(h.cause).toBe(cause);
      expect(r.host.querySelector('.hblast.hglass')).not.toBeNull();
      f.tick((h.plan.fireAt + h.plan.strikeAt) / 2, 4);
      expect(onImpact, cause).not.toHaveBeenCalled();
      f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
      expect(onImpact, cause).toHaveBeenCalledTimes(1);
      expect(r.host.querySelector('.hblast-hit')!.textContent).toBe('-3');
      expect(h.scene!.chipCount, cause).toBe(h.geo.chips.length);
      f.tick(220, 4);
      expect(h.scene!.liveCracks, cause).toBe(h.scene!.crackCount);
      expect(h.scene!.marksAlpha).toBe(1);
      expect(h.scene!.lightsOn, cause).toBe(0); // the beam, the bolt: off the moment the glass cracks
      f.tick(h.plan.healEnd - h.elapsed() + 8, 4);
      expect(h.scene!.marksAlpha).toBe(0); // healed
      f.tick(h.plan.endAt - h.elapsed() + 32, 8);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expectRestored(r);
      f.tick(3000, 16);
      expect(f.hooked(), cause).toBe(0);
      expect(r.root.children).toHaveLength(0);
    }
  });

  it('the headbutt: the striker\'s PORTRAIT crosses the board (raised over the target), flattens on the glass and comes home', () => {
    const r = run({ cause: 'butt', total: 8, formation: formationOf([8], 8) });
    const { h, f } = r;
    const shift = (): number => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(r.attackerEl.style.transform); return m ? Math.hypot(+m[1]!, +m[2]!) : 0; };
    f.tick(h.plan.chargeAt + 20, 4);
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true);
    f.tick(h.plan.strikeAt - h.elapsed() - 4, 4);
    const D0 = Math.hypot(1300, 550);
    expect(shift()).toBeGreaterThan(D0 * 0.75); // nearly on the struck portrait
    expect(shift()).toBeLessThan(D0);
    f.tick(40, 4);
    expect(r.attackerEl.style.transform).toMatch(/rotate\([-\d.]+deg\) scale\(0\.5\d+, 1\.\d+\) rotate/); // flat against the glass
    f.tick(700, 4);
    expect(shift()).toBeLessThan(6); // home
    h.finish();
    expectRestored(r);
  });

  it('the causes\' own lights: the beam and the bolt show only until the crack; the knock marks the glass before the blow; the craze sits in a haze', () => {
    for (const cause of ['beam', 'ricochet'] as const) {
      const { h, f } = run({ cause, total: 8, formation: formationOf([8], 8) });
      f.tick((h.plan.fireAt + h.plan.strikeAt) / 2, 4);
      expect(h.scene!.lightsOn, cause).toBeGreaterThanOrEqual(3);
      f.tick(h.plan.strikeAt - h.elapsed() + 8, 4);
      expect(h.scene!.lightsOn, cause).toBe(0);
      h.cancel();
    }
    const k = run({ cause: 'knock', total: 8, formation: formationOf([8], 8) });
    k.f.tick(k.h.plan.pre[1]! + 12, 4);
    expect(k.defenderEl.style.transform).not.toBe('scale(0.98)'); // it flinched
    k.f.tick(70, 4);
    expect(k.onImpact).not.toHaveBeenCalled();
    expect(k.h.scene!.chipCount).toBe(2); // two knuckles so far
    expect(k.h.scene!.liveCracks).toBeGreaterThan(0);
    k.f.tick(k.h.plan.impactAt - k.h.elapsed() + 8, 4);
    expect(k.onImpact).toHaveBeenCalledTimes(1);
    expect(k.h.scene!.chipCount).toBe(3);
    k.h.cancel();
    const s = run({ cause: 'shock', total: 8, formation: formationOf([8], 8) });
    s.f.tick(s.h.plan.strikeAt - 10, 4);
    expect(s.h.scene!.frostAlpha).toBe(0);
    s.f.tick(260, 4);
    expect(s.h.scene!.frostAlpha).toBeGreaterThan(0.25);
    s.f.tick(s.h.plan.healEnd - s.h.elapsed() + 8, 4);
    expect(s.h.scene!.frostAlpha).toBe(0); // it heals with the cracks
    s.h.cancel();
    const c = run({ cause: 'creep', total: 8, formation: formationOf([8], 8) });
    c.f.tick((c.h.plan.fireAt + c.h.plan.strikeAt) / 2, 4);
    expect(c.h.scene!.liveCracks).toBeGreaterThan(0); // the crack is already creeping in from the edge
    expect(c.onImpact).not.toHaveBeenCalled();
    c.h.cancel();
  });

  it('Tier 2: the mark spreads outward in several creaking jumps', () => {
    for (const cause of ['butt', 'hum', 'beam'] as const) {
      const { h, f, onImpact } = run({ cause, total: 8, formation: formationOf([8], 8) });
      f.tick(h.plan.impactAt + 8, 4);
      expect(onImpact).toHaveBeenCalledTimes(1);
      let prev = h.scene!.liveCracks, steps = 0;
      for (let t = 0; t < C.t2GrowMs + 160; t += 8) { f.tick(8, 8); const n = h.scene!.liveCracks; if (n > prev) steps++; prev = n; }
      expect(steps, cause).toBeGreaterThanOrEqual(3);
      expect(prev).toBe(h.scene!.crackCount);
      h.cancel();
    }
  });

  it('Tier 3, every cause: the crack is the blow; the pane breaks out (its shards fall, a hole stays), then repairs; nothing is left', () => {
    for (const cause of GLASS_CAUSES) {
      const r = run({ cause, total: 14, formation: formationOf([14], 14) });
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
      expect(f.hooked(), cause).toBe(0);
      expect(r.root.children).toHaveLength(0);
      expect(onImpact).toHaveBeenCalledTimes(1);
    }
  });

  it('Tier 4, every cause: the first crack is NOT the blow; the tear runs (two bright heads), the web creaks out, then the WHOLE SCREEN SHATTERS: the one blow', () => {
    for (const cause of GLASS_CAUSES) {
      const r = run({ cause, total: 40, formation: formationOf([40], 40) });
      const { h, f, onImpact, onDone } = r;
      expect(h.scene!.shardCount).toBeGreaterThanOrEqual(GLASS_CAPS.minShards);
      expect(h.scene!.shardCount).toBeLessThanOrEqual(GLASS_CAPS.shards);
      f.tick(h.plan.strikeAt + 30, 4);
      expect(onImpact, cause).not.toHaveBeenCalled();
      expect(h.scene!.liveCracks, cause).toBeGreaterThan(0); // the cause's own mark
      f.tick((h.plan.raceAt + h.plan.raceEnd) / 2 - h.elapsed(), 4);
      const racing = h.scene!.liveCracks;
      expect(h.scene!.lightsOn, cause).toBeGreaterThanOrEqual(2); // the tear's heads
      f.tick(h.plan.impactAt - 20 - h.elapsed(), 4);
      expect(h.scene!.liveCracks).toBe(h.scene!.crackCount);
      expect(h.scene!.liveCracks).toBeGreaterThan(racing + 100);
      expect(h.scene!.shardsFalling).toBe(0);
      expect(onImpact).not.toHaveBeenCalled();
      f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.scene!.marksAlpha).toBe(0); // the cracks went with the glass
      expect(h.scene!.shardsFalling).toBe(h.scene!.shardCount);
      expect(h.scene!.lightsOn).toBe(0);
      let peak = 0;
      for (let t = 0; t < 5000 && !h.done; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
      expect(peak, cause).toBeLessThanOrEqual(MAX_GLASS_SPRITES);
      expect(peak, cause).toBeLessThan(MAX_GLASS_SPRITES - 60); // nothing was dropped at the cap
      expect(onDone).toHaveBeenCalledTimes(1);
      expectRestored(r);
      f.tick(5000, 16);
      expect(h.scene!.shardsFalling).toBe(0); // every shard fell off the screen
      expect(f.hooked(), cause).toBe(0);
      expect(r.root.children).toHaveLength(0);
      expect(onImpact).toHaveBeenCalledTimes(1);
    }
  });

  it('THE GLASS STAYS ON THE SCREEN: whatever the camera does, the glass layers carry its exact inverse (and only a few px of tremble)', () => {
    for (const inside of [true, false]) {
      const camera = document.createElement('div');
      const canvasHost = document.createElement('div');
      (inside ? camera : canvasHost).appendChild(document.createElement('canvas'));
      document.body.append(canvasHost);
      const r = run({ camera, host: inside ? camera : canvasHost, total: 40, formation: formationOf([40], 40), cause: 'knock' });
      const { h, f, root } = r;
      let zoomed = 0;
      for (let t = 0; t < h.plan.endAt + 3000 && !h.done; t += 8) {
        f.tick(8, 8);
        const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(camera.style.transform);
        if (!m) continue;
        const cam = { ax: +m[1]!, ay: +m[2]!, z: +m[3]! };
        if (cam.z > 1.02) zoomed++;
        const sr = root.children[0] as Container; // the scene's root: the camera mirror when the canvas is outside
        const [gx, gy, gs] = h.scene!.glassFix;
        // A point drawn on the glass at (500, 300) ends up on screen at: the DOM camera (when the canvas rides it), the
        // Pixi root, then the glass layer.
        const viaRoot = { x: sr.position.x + sr.scale.x * (gx + gs * 500), y: sr.position.y + sr.scale.y * (gy + gs * 300) };
        const onScreen = inside ? { x: cam.ax + cam.z * viaRoot.x, y: cam.ay + cam.z * viaRoot.y } : viaRoot;
        expect(Math.hypot(onScreen.x - 500, onScreen.y - 300), `${inside ? 'inside' : 'outside'} at ${Math.round(h.elapsed())}`).toBeLessThan(C.tremblePx * 1.5 + 0.6);
        expect(h.mirrorsCamera).toBe(!inside);
      }
      expect(zoomed).toBeGreaterThan(20);
      f.tick(200, 8);
      expect(h.done).toBe(true);
      expect(h.scene!.glassFix).toEqual([0, 0, 1]); // back at rest for the dust that is still falling
      expect((root.children[0] as Container).scale.x).toBe(1);
      h.cancel();
    }
  });

  it('THE GLASS IS ALIVE: the cracks glow and glints run on them after the crack; the ghost shows only during the cause; the struck hero presses; Tier 4 inhales; all of it is gone after', () => {
    for (const cause of ['hum', 'knock'] as const) {
      for (const total of [8, 40]) {
        const r = run({ cause, total, formation: formationOf([total], total) });
        const { h, f } = r;
        f.tick(h.plan.strikeAt - 10, 4);
        expect(h.scene!.glowAlpha, `${cause} ${total}`).toBe(0); // nothing glows before anything has cracked
        expect(h.scene!.runnersOn).toBe(0);
        f.tick(h.plan.strikeAt + 300 - h.elapsed(), 4);
        expect(h.scene!.glowAlpha).toBeGreaterThan(0.2);
        expect(h.scene!.runnersOn).toBeGreaterThan(0);
        expect(h.scene!.ghostAlpha).toBe(0); // it split with the crack
        f.tick(h.plan.pressAt + 200 - h.elapsed(), 4);
        expect(r.defenderEl.style.transform, `${cause} ${total}`).toMatch(/scale\(1\.0[5-9]|scale\(1\.1/); // up against the glass
        if (total === 40) {
          f.tick(h.plan.impactAt - 40 - h.elapsed(), 4);
          expect(h.scene!.darkAlpha).toBeGreaterThan(C.inhaleDark * 0.6); // the inhale
          expect(h.scene!.glowAlpha).toBeGreaterThan(0.9); // the cracks blaze
          f.tick(60, 4);
          expect(h.scene!.darkAlpha).toBe(0);
          expect(h.scene!.runnersOn).toBe(0);
        } else {
          f.tick(h.plan.healEnd + 20 - h.elapsed(), 4);
          f.tick(32, 16);
          expect(h.scene!.runnersOn).toBe(0);
          expect(h.scene!.glowAlpha).toBe(0);
        }
        f.tick(h.plan.endAt + 3000, 16);
        expect(r.onImpact).toHaveBeenCalledTimes(1);
        expectRestored(r);
        expect(f.hooked()).toBe(0);
      }
    }
  });

  it('both directions at every tier and cause: one blow, under the caps', () => {
    for (const cause of GLASS_CAUSES) {
      for (const side of ['player', 'opp'] as const) {
        for (const total of [3, 8, 12, 40]) {
          const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 250 };
          const d = side === 'player' ? { x: 1400, y: 250 } : { x: 100, y: 800 };
          const r = run({ cause, side, attacker: a, defender: d, total, formation: formationOf([total], total) });
          let peak = 0;
          for (let t = 0; t < r.h.plan.endAt + 900; t += 16) { r.f.tick(16, 16); peak = Math.max(peak, r.h.scene!.liveSprites); }
          expect(r.onImpact, `${cause} ${side} ${total}`).toHaveBeenCalledTimes(1);
          expect(peak, `${cause} ${side} ${total}`).toBeLessThanOrEqual(MAX_GLASS_SPRITES);
          expect(r.h.scene!.crackCount).toBeLessThanOrEqual(GLASS_CAPS.cracks);
          expect(r.h.done).toBe(true);
          expectRestored(r);
          r.h.cancel();
        }
      }
    }
  });

  it('the Knockout variant: Tier 4 with the prism; still exactly one blow', () => {
    const r = run({ total: 6, knockout: true, knockoutVariant: true, formation: formationOf([6], 6), cause: 'hum' });
    expect(r.h.plan).toMatchObject({ tier: 4, ko: true });
    for (let t = 0; t < r.h.plan.endAt + 1200; t += 16) r.f.tick(16, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.h.done).toBe(true);
    expectRestored(r);
    r.h.cancel();
  });

  it('every exit restores everything, in every cause: finish() lands once; cancel() never lands; mid-tear, mid-shatter and mid-hole too; reduced motion lands once', () => {
    for (const cause of GLASS_CAUSES) {
      const a = run({ cause });
      a.f.tick(200, 16);
      a.h.finish();
      a.h.finish();
      expect(a.onImpact).toHaveBeenCalledTimes(1);
      expectRestored(a);
      expect(a.root.children).toHaveLength(0);
      // In the middle of the cause itself (the portrait mid-lunge, the beam on, the bolt in flight).
      for (const exit of ['finish', 'cancel'] as const) {
        const b = run({ cause });
        b.f.tick((b.h.plan.fireAt + b.h.plan.strikeAt) / 2, 8);
        b.h[exit]();
        expect(b.onImpact, `${cause} ${exit}`).toHaveBeenCalledTimes(exit === 'finish' ? 1 : 0);
        expect(b.f.hooked()).toBe(0);
        expectRestored(b);
        expect(b.root.children).toHaveLength(0);
      }
    }
    for (const [total, when] of [[40, 'race'], [40, 'hold'], [40, 'shatter'], [14, 'hole']] as const) {
      for (const exit of ['finish', 'cancel'] as const) {
        const x = run({ total, formation: formationOf([total], total), cause: 'ricochet' });
        const p = x.h.plan;
        const at = when === 'race' ? (p.raceAt + p.raceEnd) / 2 : when === 'hold' ? (p.raceEnd + p.impactAt) / 2 : when === 'shatter' ? p.impactAt + 120 : p.breakAt + 100;
        x.f.tick(at, 8);
        expect(x.h.done).toBe(false);
        x.h[exit]();
        expectRestored(x);
        expect(x.f.hooked(), `${when} ${exit}`).toBe(0);
        expect(x.root.children, `${when} ${exit}`).toHaveLength(0);
        expect(x.h.scene!.root.destroyed).toBe(true);
        expect(x.onImpact).toHaveBeenCalledTimes((when === 'race' || when === 'hold') && exit === 'cancel' ? 0 : 1);
        x.h.cancel(); // a second exit is harmless
      }
    }
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });

  it('a replay plays the same cause and the same glass; the roll seed picks the cause (all seven turn up) and changes the glass', () => {
    const roll = (rollSeed: number) => run({ total: 40, formation: formationOf([40], 40), rollSeed, cfg: C });
    const x = roll(9), y = roll(9);
    expect(x.h.cause).toBe(y.h.cause);
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.geo).toEqual(y.h.geo);
    x.h.cancel(); y.h.cancel();
    const seen = new Set<string>();
    let differs = 0;
    for (let seed = 1; seed <= 60; seed++) { const z = roll(seed); seen.add(z.h.cause); if (JSON.stringify(z.h.geo.segs) !== JSON.stringify(x.h.geo.segs)) differs++; z.h.cancel(); }
    expect([...seen].sort()).toEqual([...GLASS_CAUSES].sort());
    expect(differs).toBeGreaterThanOrEqual(59);
  });
});

describe('the scene (headless Pixi)', () => {
  const COLORS = { glass: 0xbfe3ff, edge: 0xffffff, shade: 0x0a1626, flash: 0xe2f3ff, heat: 0xff9a3c, side: 0xffe9b0 };
  const LOOK = { gravity: 3600, burst: 340, spin: 2.2, rim: 10, lunge: 0.55, dust: 70, impactSize: 1, splitAlpha: 0.07 };

  it('the cracks grow from their near end and stay; a finished web is never touched again', () => {
    const scene = new HeroGlassScene(TEX, COLORS, LOOK, 1, 3);
    const p = plan(40);
    const g = geoOf(40);
    scene.setArea(SCREEN);
    scene.setCracks(g.segs);
    expect(scene.crackCount).toBe(g.segs.length);
    expect(scene.liveCracks).toBe(0);
    let prev = 0;
    for (let t = p.fireAt; t <= p.impactAt; t += 8) { scene.growCracks(t); scene.update(8); const n = scene.liveCracks; expect(n).toBeGreaterThanOrEqual(prev); prev = n; }
    expect(prev).toBe(g.segs.length);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
    scene.setMarksAlpha(1); scene.setHole(1); scene.growCracks(1e6); scene.fixGlass(3, 4, 1.1); scene.setTension(0.1); scene.destroy(); // harmless after the end
  });

  it('the lights are pooled sprites: on, moved, off; a clear gives them back; the glass fix is the camera\'s inverse', () => {
    const scene = new HeroGlassScene(TEX, COLORS, LOOK, 1, 3);
    scene.update(500); // the pre-warm sprites go back to the pool
    const base = scene.liveSprites;
    scene.setBeam({ x: 100, y: 100 }, { x: 900, y: 400 }, 1, 0.5);
    expect(scene.lightsOn).toBe(4);
    scene.setBeam({ x: 100, y: 100 }, { x: 900, y: 400 }, 1, 0.9);
    expect(scene.liveSprites).toBe(base + 4); // the same four sprites, moved
    scene.setBeam({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, 0);
    expect(scene.lightsOn).toBe(0);
    scene.setBolt({ x: 5, y: 5 }, 1, true); scene.setTearHead(0, { x: 1, y: 1 }, true); scene.setTearHead(1, { x: 2, y: 2 }, true); scene.setTension(0.05);
    expect(scene.lightsOn).toBe(3 + 2 + 2 + 1);
    expect(scene.update(16)).toBe(true); // a light keeps the scene alive
    scene.lightsOut();
    expect(scene.lightsOn).toBe(0);
    expect(scene.update(16)).toBe(false);
    scene.fixGlass(40, -20, 1.25);
    const [x, y, k] = scene.glassFix;
    expect(40 + 1.25 * (x + k * 300)).toBeCloseTo(300, 6);
    expect(-20 + 1.25 * (y + k * 700)).toBeCloseTo(700, 6);
    expect(scene.toGlass({ x: 10, y: 10 })).toEqual({ x: 52.5, y: -7.5 });
    scene.clear();
    expect(scene.liveSprites).toBe(0);
    scene.destroy();
  });

  it('the shards: batched meshes; they jump at the viewer, all fall off the screen, the dust drains, and destroy leaves nothing', () => {
    const scene = new HeroGlassScene(TEX, COLORS, LOOK, 1, 3);
    const g = geoOf(40);
    scene.setArea(SCREEN);
    scene.setShards(g.tris, g.origin, 'shatter');
    expect(scene.shardCount).toBe(g.tris.length);
    expect(SHARDS_PER_MESH * 6).toBeLessThanOrEqual(100); // each mesh batches with the sprites
    expect(scene.shardsFalling).toBe(0);
    const mesh = scene.root.children[3]!.children[0]!.children[0] as unknown as { vertices: Float32Array };
    const size = (): number => { const v = mesh.vertices; let s = 0; for (let j = 0; j < SHARDS_PER_MESH; j++) s += Math.hypot(v[j * 12 + 2]! - v[j * 12]!, v[j * 12 + 3]! - v[j * 12 + 1]!); return s; };
    const rest = size();
    scene.breakOut();
    scene.shatterFx(g.origin, true);
    expect(scene.shardsFalling).toBe(g.tris.length);
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_GLASS_SPRITES);
    let alive = true, frames = 0, biggest = 0;
    for (; frames < 500 && alive; frames++) { alive = scene.update(16); if (frames < 30) biggest = Math.max(biggest, size()); }
    expect(biggest).toBeGreaterThan(rest * 1.15); // they swelled toward the viewer before they fell
    expect(alive).toBe(false);
    expect(scene.shardsFalling).toBe(0);
    expect(frames * 16).toBeGreaterThan(1500); // the dust lingers
    expect(frames * 16).toBeLessThan(3600);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});
