// @vitest-environment jsdom
/**
 * THE BANANA BARRAGE HERO ATTACK (Oona's Banana Cannon; owner 2026-09-29: "i would love a king oona banana cannon
 * animation", then "use oona's animation as a guideline. improve this dramatically", then for Tier IV "it lands on the
 * hero and then we slam our fist into it 4 times"): the tier mapping SHARED with every style; the ladder (1 / 2 / a
 * barrage of 8 / four warm-ups, the giant lands, four slams); Oona's painted art and clips; the tuner (defaults,
 * clamping, the jam's dials, the button row on top, no Speed / Reduced rows); the pure plan (the impact beat, the jam,
 * reduced motion, determinism); the pure paths (lobbed arcs, the giant hangs in view and lands on the face); the jam
 * pose; the camera; the runner on the shared clock (the consequence lands exactly ONCE, never on a tick; both
 * directions; slow motion; replay; finish / cancel; cleanup; the striking portrait pounds the target); the headless
 * scene (pooled, bounded, drains, destroy leaves nothing); and the cosmetic resolution.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture, TextureSource } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_BLAST_DEFAULTS, blastPlan } from '../heroBlast/heroBlastConfig';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  BANANA_CAPS, HERO_BANANA_DEFAULTS, HERO_BANANA_RANGES, bananaCameraAt, bananaCameraFocus, bananaCues, bananaEase, bananaFlightMs,
  bananaPlan, bananaPos, bananaRig, clampHeroBananaValue, heroBananaConfigJson, jamGeo, jamPose, sanitizeHeroBananaConfig, shotSlots,
  type HeroBananaConfig, type HeroBananaNumKey,
} from './heroBananaConfig';
import { HeroBananaScene, MAX_BANANA_SPRITES, SIDE_FRAME, type HeroBananaTextures } from './heroBananaScene';
import { BANANA_SHEET_ID, SPLAT_SHEET_ID, sliceSheet } from './heroBananaTextures';
import { bananaSeed, playHeroBanana, type HeroBananaOptions } from './heroBanana';
import { SPEC } from '../HeroBananaTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';
import type { Pt } from '../heroAttack/easing';
import oonaDef from '../fx/defs/oona-banana.json';

const W = Texture.WHITE;
const TEX: HeroBananaTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  banana: Array.from({ length: 16 }, () => W), splat: Array.from({ length: 14 }, () => W), disc: W, shock: W,
};
const C = HERO_BANANA_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => bananaPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { juice: 0xfce400, amber: 0xebb912, cream: 0xffffe0, gold: 0xffc714, spark: 0xff6d2c, side: 0xffd83d };
const LOOK = {
  bananaPx: 108, burstAmount: 1, juiceDrips: 1, dripMs: 2600, trailSparks: 1, splatPx: 150, splatMs: 480, tickJuice: 40, juiceSpeed: 435, juiceLifeMs: 450, juicePx: 35,
  launchSparks: 11, giantSplat: 3.4, ringSplats: 7, showerBananas: 14, shockSize: 1, goldRays: 10,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 250 };
const R = 80;
const TIMELINE_IV = [420, 6114, 7064];
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);
const regular = (p: ReturnType<typeof plan>) => p.shots.filter((s) => !s.giant);
/** A blood-like tint: red far above green and blue (the juice yellows, golds and the orange launch sparks all carry plenty of green). */
const isRed = (t: number): boolean => { const r = (t >> 16) & 0xff, g = (t >> 8) & 0xff, b = t & 0xff; return r > 120 && g < r * 0.3 && b < r * 0.3; };

describe('the damage tiers (shared with every style)', () => {
  it('the bananas step up on exactly the blows Blast does: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(blastPlan({ total: d, distance: 1600 }, HERO_BLAST_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE banana, II a DOUBLE, III a BARRAGE of eight, IV four warm-ups, then the GIANT lands and is jammed in SIX times', () => {
    expect([P1, P2, P3, P4].map((p) => regular(p).length)).toEqual([1, 2, 8, 4]);
    expect([P1, P2, P3, P4].map((p) => p.giant)).toEqual([false, false, false, true]);
    expect(P4.shots[P4.shots.length - 1]!.giant).toBe(true);
    expect(P4.slams).toHaveLength(6); // owner 2026-09-29: "have it hit 6 times"
    expect([P1, P2, P3].map((p) => p.slams.length)).toEqual([0, 0, 0]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.giant ? 'giant' : p.shots.length; }))
      .toEqual([1, 1, 2, 2, 8, 8, 'giant', 'giant']);
  });
});

describe("King Oona's art and sound (owner 2026-09-29: use oona's animation as a guideline)", () => {
  it("plays Oona's own painted sheets (the ids her card FX uses) and her own clips", () => {
    const def = oonaDef as unknown as { layers: { primitive: string; params: Record<string, unknown> }[] };
    const images = def.layers.filter((l) => l.primitive === 'custom').map((l) => l.params.image);
    expect(images).toEqual([BANANA_SHEET_ID, SPLAT_SHEET_ID]);
    const clips = def.layers.filter((l) => l.primitive === 'sound').map((l) => l.params.clip);
    for (const clip of clips) expect([C.sfxLaunchClip, C.sfxSplatClip, C.sfxPowerClip]).toContain(clip);
    // Her juice burst is the default this attack starts from.
    const target = def.layers.find((l) => l.primitive === 'burst' && (l as unknown as { anchor: string }).anchor === 'target')!.params;
    expect([C.juiceSpeed, C.juiceLifeMs, C.juicePx]).toEqual([target.speed, target.life, target.size]);
  });

  it('slices a 4 x 4 sheet into its 16 cells, row by row', () => {
    const fake = { width: 1024, height: 1024, source: W.source } as unknown as Texture;
    const cells = sliceSheet(fake);
    expect(cells).toHaveLength(16);
    expect(cells.map((c) => [c.frame.x, c.frame.y])).toEqual(Array.from({ length: 16 }, (_, i) => [(i % 4) * 256, Math.floor(i / 4) * 256]));
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_BANANA_RANGES)) {
      const v = C[k as HeroBananaNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorJuice', 'colorAmber', 'colorCream', 'colorGold', 'colorSpark', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroBananaValue('t3Shots', 99)).toBe(12);
    expect(clampHeroBananaValue('t1Shots', 0)).toBe(1);
    expect(clampHeroBananaValue('slamCount', 20)).toBe(8);
    expect(clampHeroBananaValue('bananaPx', -3)).toBe(30);
    expect(clampHeroBananaValue('giantFlightMs', 99999)).toBe(2500);
    expect(clampHeroBananaValue('spinTurns', Number.NaN)).toBe(C.spinTurns);
    expect(clampHeroBananaValue('spinTurns', 'abc')).toBe(C.spinTurns);
    expect(clampHeroBananaValue('spinTurns', '3')).toBe(3);
    expect(clampHeroBananaValue('colorJuice', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroBananaValue('colorPlayer', 'yellow')).toBe(C.colorPlayer);
    expect(clampHeroBananaValue('sfxLaunchClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroBananaValue('nope' as keyof HeroBananaConfig, 1)).toBeUndefined();
    expect(clampHeroBananaValue('toString' as keyof HeroBananaConfig, 1)).toBeUndefined();
    const s = sanitizeHeroBananaConfig({ t4Juice: 900, colorGold: 'x', bogus: 3 });
    expect(s.t4Juice).toBe(300);
    expect(s.colorGold).toBe(C.colorGold);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroBananaConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; the jam has its dials; the button row sits on TOP with no Speed or Reduced motion rows', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    for (const k of ['slamCount', 'slamGapMs', 'slamPullPx', 'finisherWindMs', 'finisherZoom', 'burstStart', 'burstAmount', 'jamDepthEnd']) expect(keys.has(k as never), k).toBe(true);
    expect([C.slamCount, C.burstStart]).toEqual([6, 4]);
    // owner 2026-09-29: no blood; banana splats instead
    expect(Object.keys(C).join(' ')).not.toMatch(/blood/i);
    const json = JSON.parse(heroBananaConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Giant).toBe(1);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('banana');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('banana');
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe huge (40)']) expect(labels).toContain(l);
    for (const l of labels) expect(l).not.toMatch(/speed|reduced/i);
    expect(SPEC.controls.map((c) => `${c.key} ${c.label}`).join(' ')).not.toMatch(/hit-?stop|freeze/i);
  });
});

describe('the plan', () => {
  it('THE BARRAGE: eight bananas splat in rhythm, the first seven are ticks, the LAST is the impact (only one impact beat)', () => {
    const arr = P3.shots.map((d) => d.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!, `arrival ${i}`).toBeGreaterThan(arr[i - 1]!);
    expect(P3.impactAt).toBe(arr[arr.length - 1]);
    expect(P3.hits).toEqual(arr.slice(0, -1));
    const kinds = bananaCues(P3).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'fire')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(7);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
    for (const k of ['glint', 'hang', 'land', 'dash', 'slam']) expect(kinds).not.toContain(k);
  });

  it('Tier II is a double (one tick, then the impact); Tier I one banana, straight to the impact', () => {
    expect(P2.shots[1]!.fireAt - P2.shots[0]!.fireAt).toBeLessThanOrEqual(300);
    expect(P2.hits).toHaveLength(1);
    expect(P2.impactAt).toBe(P2.shots[1]!.arriveAt);
    expect(P1.shots).toHaveLength(1);
    expect(P1.hits).toEqual([]);
    expect(P1.impactAt).toBe(P1.shots[0]!.arriveAt);
  });

  it('Tier IV (the jam): warm-ups, the blaze, the giant flies, hangs, LANDS, the hero dashes, slams 1-5 are ticks and slam 6 IS the impact', () => {
    const kinds = bananaCues(P4).map((q) => q.kind);
    const g = P4.shots[P4.shots.length - 1]!;
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'slam')).toHaveLength(5);
    const at = (k: string): number => kinds.indexOf(k as never);
    for (const [a, b] of [['glint', 'hang'], ['hang', 'land'], ['land', 'dash'], ['dash', 'slam'], ['slam', 'impact'], ['impact', 'boom']]) {
      expect(at(a!), `${a} before ${b}`).toBeLessThan(at(b!));
    }
    expect(Math.max(...regular(P4).map((s) => s.fireAt))).toBeLessThan(P4.glintAt);
    expect(g.fireAt).toBe(P4.glintAt + C.giantChargeMs);
    expect(P4.landAt).toBe(g.arriveAt);
    expect(P4.impactAt).toBe(P4.slams[5]);
    // the hits: the warm-ups, the landing and the first five slams; never the finisher
    expect(P4.hits).toEqual([...regular(P4).map((s) => s.arriveAt), P4.landAt, ...P4.slams.slice(0, 5)].sort((a, b) => a - b));
    for (const h of P4.hits) expect(h).toBeLessThan(P4.impactAt);
    // slow slams with the anticipation BUILDING (owner: "increasingly larger time between slams"): every gap longer than
    // the last, the finisher's wind-up the longest
    const gaps = P4.slams.slice(1).map((s, i) => s - P4.slams[i]!);
    expect(gaps[0]).toBe(C.slamGapMs);
    expect(C.slamGapMs).toBeGreaterThanOrEqual(400);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!, `gap ${i}`).toBeGreaterThan(gaps[i - 1]!);
    expect(gaps[4]).toBe(C.finisherWindMs);
    expect(P4.homeAt).toBeGreaterThan(P4.impactAt);
    expect(P4.endAt).toBeGreaterThanOrEqual(P4.homeAt);
  });

  it('the slam count is a dial: 1 slam = the finisher alone; 6 slams = five ticks and the finisher', () => {
    const one = bananaPlan({ total: 40, distance: 1600 }, { ...C, slamCount: 1 });
    expect(one.slams).toHaveLength(1);
    expect(bananaCues(one).filter((q) => q.kind === 'slam')).toHaveLength(0);
    const six = bananaPlan({ total: 40, distance: 1600 }, { ...C, slamCount: 6 });
    expect(bananaCues(six).filter((q) => q.kind === 'slam')).toHaveLength(5);
    expect(six.impactAt).toBe(six.slams[5]);
  });

  it('every tier escalates: more shake, zoom and juice, and dim', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) for (const k of ['shakePx', 'zoom', 'juice', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    expect([P1, P2, P3].map((p) => p.splats)).toEqual([1, 2, 3]);
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1600 px apart): first fling, impact and end, ms from the flourish', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.fireAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual([
      [340, 1000, 1596], [360, 1222, 1838], [400, 1687, 2343], TIMELINE_IV,
    ]);
    // Chunky, not rushed: Tier I about 1.5 s; the Tier IV showpiece (six slow, building slams) under 7.5 s.
    expect(t(P1)[2]).toBeLessThanOrEqual(2000);
    expect(t(P4)[2]).toBeLessThanOrEqual(7500);
  });

  it('the barrage flings outer shots first and the centre last', () => {
    expect(shotSlots(1)).toEqual([0]);
    expect(shotSlots(2)).toEqual([-1, 1]);
    expect(shotSlots(3)).toEqual([-1, 1, 0]);
    expect(shotSlots(8)[7]).toBe(0);
  });

  it('the caps always hold, whatever the sliders say; flight scales gently with distance', () => {
    const wild: HeroBananaConfig = { ...C, t3Shots: 12, t4Juice: 300, t4Shake: 40, t4Zoom: 0.14, t3Splats: 8 };
    expect(bananaPlan({ total: 15, distance: 800 }, wild).shots.length).toBeLessThanOrEqual(BANANA_CAPS.shots);
    expect(bananaPlan({ total: 99, distance: 800 }, wild).juice).toBeLessThanOrEqual(BANANA_CAPS.juice);
    expect(bananaPlan({ total: 15, distance: 800 }, wild).splats).toBeLessThanOrEqual(BANANA_CAPS.splats);
    expect(bananaFlightMs(1600, 500)).toBe(500);
    expect(bananaFlightMs(100, 500)).toBe(310);
    expect(bananaFlightMs(99999, 500)).toBe(575);
  });

  it('reduced motion: no bananas, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.shots.length, p.slams.length]).toEqual([0, 0, 0, 0, 0]);
    const kinds = bananaCues(p).map((q) => q.kind);
    for (const k of ['charge', 'fire', 'hit', 'glint', 'hang', 'land', 'dash', 'slam']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(bananaCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(bananaRig(p, A, D, R, R, C).shots).toEqual([]);
  });

  it('is deterministic: the same fight plans the same beats and the same paths (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(bananaCues(plan([4, 2, 3], 9, 720))).toEqual(bananaCues(plan([4, 2, 3], 9, 720)));
    expect(bananaRig(P4, A, D, R, R, C)).toEqual(bananaRig(P4, A, D, R, R, C));
    expect(bananaSeed(14, 1500.2, 'player')).toBe(bananaSeed(14, 1500.4, 'player'));
    expect(bananaSeed(14, 1500, 'player')).not.toBe(bananaSeed(14, 1500, 'opp'));
  });
});

describe('the banana paths', () => {
  it('a banana bursts out of the striking hero and is LOBBED on a high arc that comes down onto the struck portrait', () => {
    const rig = bananaRig(P1, A, D, R, R, C);
    const m = rig.shots[0]!;
    expect(Math.hypot(m.a.x - A.x, m.a.y - A.y)).toBeLessThanOrEqual(R);
    const end = bananaPos(m, m.flightMs);
    expect(Math.hypot(end.x - D.x, end.y - D.y)).toBeLessThanOrEqual(R * 0.6);
    expect(bananaPos(m, m.flightMs + 500)).toMatchObject({ x: end.x, y: end.y });
    const mid = bananaPos(m, m.flightMs / 2);
    expect((m.a.y + m.b.y) / 2 - mid.y).toBeGreaterThan(0.08 * Math.hypot(D.x - A.x, D.y - A.y));
    expect(Math.sin(end.heading)).toBeGreaterThan(0); // it comes DOWN into the face
  });

  it('SPINS with BACKSPIN (owner: "the bananas should spin, not flip"): flying right it turns counter-clockwise, flying left clockwise, several turns', () => {
    const right = bananaRig(P3, A, D, R, R, C).shots;
    for (const m of right) {
      expect(m.spin).toBeLessThan(0);
      expect(Math.abs(bananaPos(m, m.flightMs).rot - bananaPos(m, 0).rot)).toBeGreaterThan(Math.PI * 2 * 1.5);
    }
    const left = bananaRig(P3, D, A, R, R, C).shots;
    for (const m of left) expect(m.spin).toBeGreaterThan(0);
    // the giant spins too, slowing with the flight at the apex
    const g = bananaRig(P4, A, D, R, R, C).shots.at(-1)!;
    const at = (u: number): number => bananaPos(g, u * g.flightMs).rot;
    const apexT = g.apex; // the slow part is round the apex
    expect(Math.abs(at(apexT + 0.02) - at(apexT - 0.02))).toBeLessThan(Math.abs(at(0.04) - at(0)));
  });

  it('the hang ease: monotonic, ends pinned, slow at the apex and fast at both ends (0 = a plain ballistic arc)', () => {
    expect(bananaEase(0, 0.7)).toBe(0);
    expect(bananaEase(1, 0.7)).toBeCloseTo(1, 9);
    expect(bananaEase(0.37, 0)).toBeCloseTo(0.37, 9);
    let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.01) { const e = bananaEase(u, 0.7); expect(e).toBeGreaterThanOrEqual(prev); prev = e; }
    const rate = (u: number): number => (bananaEase(u + 0.005, 0.7) - bananaEase(u - 0.005, 0.7)) / 0.01;
    expect(rate(0.5)).toBeLessThan(0.5);
    expect(rate(0.05)).toBeGreaterThan(1.4);
  });

  it('a barrage splats at spread positions across the face (never one stack)', () => {
    const shots = bananaRig(P3, A, D, R, R, C).shots;
    for (let i = 0; i < shots.length; i++) for (let j = i + 1; j < shots.length; j++) {
      expect(Math.hypot(shots[i]!.b.x - shots[j]!.b.x, shots[i]!.b.y - shots[j]!.b.y), `${i}-${j}`).toBeGreaterThan(R * 0.05);
    }
    for (const m of shots) expect(Math.hypot(m.b.x - D.x, m.b.y - D.y)).toBeLessThanOrEqual(R * 0.4);
  });

  it('Tier IV: the giant HANGS in view (its apex held below the top of the screen), then LANDS as a stake on the rim toward the thrower', () => {
    const rig = bananaRig(P4, A, D, R, R, C, 36, null, C.giantHangY, 300);
    const g = rig.shots[rig.shots.length - 1]!;
    expect(g.giant).toBe(true);
    let apex = Infinity;
    for (let t = 0; t <= g.flightMs; t += 4) apex = Math.min(apex, bananaPos(g, t).y);
    expect(apex).toBeGreaterThanOrEqual(36 + C.giantHangY - 30);
    expect(apex).toBeLessThan(Math.min(A.y, D.y));
    // its centre sits out from the rim by its unsunk half (a stake), on the line toward the thrower
    expect(Math.hypot(g.b.x - D.x, g.b.y - D.y)).toBeCloseTo(R + 300 * (0.5 - C.jamDepthStart), 5);
    expect((g.b.x - D.x) * (A.x - D.x) + (g.b.y - D.y) * (A.y - D.y)).toBeGreaterThan(0);
    // it lingers near the top: a third of its flight is spent in the top tenth of its rise
    const rise = Math.min(g.a.y, g.b.y) - apex;
    let near = 0;
    for (let t = 0; t <= g.flightMs; t += 4) if (bananaPos(g, t).y < apex + rise * 0.1) near += 4;
    expect(near / g.flightMs).toBeGreaterThan(0.25);
  });

  it('every small banana lands ON the struck portrait, never past it (owner 2026-09-29: "the little bananas in huge get sent too far"): every tier, both directions, 1920x1080 and 1600x900', () => {
    // The real layouts: your portrait low in the status bar, the foe's high in the combat header (screen px).
    const layouts: [string, Pt, Pt, number, number][] = [
      ['1920x1080', { x: 960, y: 985 }, { x: 960, y: 150 }, 62, 70],
      ['1600x900', { x: 800, y: 821 }, { x: 800, y: 125 }, 52, 58],
      ['1600x900 offset', { x: 520, y: 820 }, { x: 1180, y: 130 }, 52, 58],
    ];
    for (const [name, you, them, ry, rt] of layouts) {
      for (const [a, d, ra, rd, who] of [[you, them, ry, rt, 'you hit'], [them, you, rt, ry, 'foe hits']] as const) {
        for (const total of [3, 8, 14, 40]) {
          const p = bananaPlan({ total, distance: Math.hypot(d.x - a.x, d.y - a.y) }, C);
          const rig = bananaRig(p, a, d, rd, ra, C, 36, { x: d.x, y: d.y - rd * 0.2 });
          const L = Math.hypot(d.x - a.x, d.y - a.y);
          const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
          for (const m of rig.shots) {
            if (m.giant) continue;
            const tag = `${name} ${who} ${total}`;
            const end = bananaPos(m, m.flightMs);
            expect(Math.hypot(end.x - d.x, end.y - d.y), `${tag}: lands on the face`).toBeLessThanOrEqual(rd * 0.4);
            // and never flies past the target along the line of the throw
            for (let t = 0; t <= m.flightMs; t += 8) {
              const q = bananaPos(m, t);
              expect((q.x - a.x) * u.x + (q.y - a.y) * u.y, `${tag}: never past it`).toBeLessThanOrEqual(L + rd * 0.4);
            }
          }
        }
      }
    }
  });

  it('works both ways: a foe flings from the top down onto you', () => {
    const rig = bananaRig(P2, D, A, R, R, C);
    for (const m of rig.shots) {
      expect(Math.hypot(m.a.x - D.x, m.a.y - D.y)).toBeLessThanOrEqual(R);
      const end = bananaPos(m, m.flightMs);
      expect(Math.hypot(end.x - A.x, end.y - A.y)).toBeLessThanOrEqual(R * 0.6);
    }
  });
});

describe('the jam (the striking portrait drives the stake in)', () => {
  const LEN = 330;
  const g = jamGeo(A, D, R, R, LEN, 6, C);
  it('the stake enters the struck rim toward the thrower and sinks a step per slam, from jamDepthStart to jamDepthEnd', () => {
    expect(Math.hypot(g.entry.x - D.x, g.entry.y - D.y)).toBeCloseTo(R, 6);
    expect(g.depths).toHaveLength(7);
    expect(g.depths[0]).toBeCloseTo(C.jamDepthStart, 6);
    expect(g.depths[6]).toBeCloseTo(C.jamDepthEnd, 6);
    for (let k = 1; k < g.depths.length; k++) expect(g.depths[k]!).toBeGreaterThan(g.depths[k - 1]!);
  });

  it('on each slam the striking portrait is ON the stake\'s outer end (its rim at the end, deeper every slam); rests before and after', () => {
    expect(jamPose(P4, g, C, P4.dashAt - 1)).toMatchObject({ x: 0, y: 0, scale: 1 });
    expect(jamPose(P4, g, C, P4.homeAt + 1)).toMatchObject({ x: 0, y: 0, scale: 1 });
    let prev = -Infinity;
    P4.slams.forEach((s, k) => {
      const p = jamPose(P4, g, C, s);
      const cx = A.x + p.x, cy = A.y + p.y;
      const end = { x: g.entry.x - g.u.x * LEN * (1 - g.depths[k + 1]!), y: g.entry.y - g.u.y * LEN * (1 - g.depths[k + 1]!) };
      expect(Math.hypot(cx - end.x, cy - end.y), `slam ${k + 1}`).toBeCloseTo(R * 0.72, 0);
      const reach = p.x * g.u.x + p.y * g.u.y;
      expect(reach).toBeGreaterThan(prev);
      prev = reach;
      expect(p.squash).toBeGreaterThan(0);
    });
    expect(jamPose(P1, g, C, P1.impactAt)).toMatchObject({ x: 0, y: 0 });
  });

  it('between slams it REELS BACK far (owner: "reel back further between hits"), further each time, the finisher furthest, swelling into it', () => {
    const back = (i: number): number => {
      let most = 0;
      const anchor = g.contacts[i]!;
      for (let t = P4.slams[i]!; t < P4.slams[i + 1]!; t += 4) {
        const p = jamPose(P4, g, C, t);
        most = Math.max(most, -((p.x - anchor.x) * g.u.x + (p.y - anchor.y) * g.u.y));
      }
      return most;
    };
    expect(back(0)).toBeGreaterThan(C.slamPullPx * 0.9);
    for (let i = 1; i < 4; i++) expect(back(i)).toBeGreaterThan(back(i - 1));
    expect(back(4)).toBeGreaterThan(back(3) * 1.3);
    expect(back(3)).toBeGreaterThan(back(0) * 1.6); // much bigger reel-backs as it builds
    const wind = jamPose(P4, g, C, P4.slams[4]! + (P4.slams[5]! - P4.slams[4]!) * 0.7);
    expect(wind.scale).toBeGreaterThan(1.12);
  });

  it('never pauses: the pose keeps moving every frame through the jam (no freeze)', () => {
    let still = 0;
    let prev = jamPose(P4, g, C, P4.dashAt);
    for (let t = P4.dashAt + 8; t < P4.impactAt; t += 8) {
      const p = jamPose(P4, g, C, t);
      if (Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) + Math.abs(p.scale - prev.scale) + Math.abs(p.squash - prev.squash) < 1e-6) still++;
      prev = p;
    }
    expect(still).toBe(0);
  });
});

describe('the camera', () => {
  it('pushes in through the flourish, punches in on the impact and shakes ALONG the banana; rests by the end', () => {
    const dir = { x: 0.6, y: 0.8 };
    const hit = bananaCameraAt(P3, C, P3.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P3.zoom);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = bananaCameraAt(P3, C, P3.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.8);
  });

  it('Tier IV eases OUT as the giant climbs, PUSHES IN over the finisher wind-up, and the finisher punches hardest', () => {
    const g = P4.shots[P4.shots.length - 1]!;
    expect(bananaCameraAt(P4, C, P4.hangAt).zoom).toBeLessThan(bananaCameraAt(P4, C, g.fireAt - 5).zoom);
    const s4 = P4.slams[4]!;
    const wind0 = bananaCameraAt(P4, C, s4 + (P4.impactAt - s4) * 0.35).zoom;
    const wind1 = bananaCameraAt(P4, C, P4.impactAt - 5).zoom;
    expect(wind1 - wind0).toBeGreaterThan(C.finisherZoom * 0.5);
    // every slam punches the view in harder than the last
    const punch = P4.slams.slice(0, 5).map((at) => bananaCameraAt(P4, C, at + 12).zoom - bananaCameraAt(P4, C, at - 4).zoom);
    for (let i = 1; i < punch.length; i++) expect(punch[i]!, `slam ${i + 1}`).toBeGreaterThan(punch[i - 1]!);
    expect(bananaCameraAt(P4, C, P4.impactAt + 1).zoom).toBeGreaterThan(bananaCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(bananaCameraFocus(P4, g.fireAt, A, D)).toEqual(A);
    expect(bananaCameraFocus(P4, P4.impactAt, A, D)).toEqual(D);
    expect(bananaCameraAt(P4, C, P4.endAt + 400).zoom).toBeCloseTo(1, 2);
    let peak = 1;
    for (let t = P4.chargeAt; t < P4.endAt; t += 8) peak = Math.max(peak, bananaCameraAt(P4, C, t).zoom);
    expect(peak).toBeLessThan(1.35);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroBananaOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBananaOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBanana({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 250 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

const translateOf = (el: HTMLElement): { x: number; y: number } => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
  return { x: m ? Number(m[1]) : 0, y: m ? Number(m[2]) : 0 };
};

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('THE BARRAGE lands the blow EXACTLY ONCE, on the LAST banana: never on a tick; painted splats play; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.shots).toHaveLength(8);
    expect(host.querySelector('.hblast.hbanana')).not.toBeNull();
    f.tick(h.plan.hits[h.plan.hits.length - 1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveSplats).toBeGreaterThan(0);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt);
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveBananas).toBe(0);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV THE JAM: the giant lands as a stake, the striking PORTRAIT dashes over and drives it in SIX times (on top of it, deeper and flatter each slam, extra juice bursts from slam 4, no blood), and the blow lands ONCE on the FINISHER', () => {
    // A painted-size sheet (1024 px, 4 x 4), so the stake's crop is the real one.
    const sheet = sliceSheet(new Texture({ source: new TextureSource({ width: 1024, height: 1024 }) }));
    const { h, f, onImpact, attackerEl, defenderEl } = run({ total: 40, formation: formationOf([40], 40), textures: { ...TEX, banana: sheet } });
    attackerEl.style.cssText = 'opacity: 0.99; left: 3px';
    defenderEl.style.cssText = 'opacity: 0.98; top: 4px';
    const restA = attackerEl.style.cssText, restD = defenderEl.style.cssText;
    const p = h.plan;
    expect(p.giant).toBe(true);
    expect(p.slams).toHaveLength(6);
    f.tick(p.glintAt + 40, 4);
    expect(h.scene!.blazing).toBe(true);
    f.tick(p.hangAt - h.elapsed() + 20, 4);
    expect(h.scene!.blazing).toBe(false);
    expect(h.scene!.marking).toBe(true);
    expect(h.scene!.glinting).toBe(true);
    f.tick(p.landAt - h.elapsed() + 20, 4);
    expect(h.scene!.stuckBanana).toBe(true);
    expect(h.scene!.marking).toBe(false);
    expect(h.scene!.strikerOnTop).toBe(false);
    expect(onImpact).not.toHaveBeenCalled();
    const home = translateOf(attackerEl);
    expect(Math.hypot(home.x, home.y)).toBeLessThan(120); // not dashed yet (only the fling's recoil)
    let sunk = h.scene!.sunk;
    const splatLayer = h.scene!.layer('splat');
    const reds = (): number => (['haze', 'splat', 'glow', 'body', 'core'] as const).reduce((n, l) => n + h.scene!.layer(l).children.filter((c) => c.visible && isRed((c as unknown as { tint: number }).tint)).length, 0);
    const extra: number[] = [];
    const stake = h.scene!.layer('stake').children[0]!;
    let long = Infinity;
    for (let i = 0; i < 5; i++) {
      const before = splatLayer.children.filter((c) => c.visible).length;
      f.tick(p.slams[i]! - h.elapsed() + 8, 4);
      expect(h.scene!.crush, `slam ${i + 1}`).toBe(i + 1);
      expect(h.scene!.sunk, `slam ${i + 1} drives it deeper`).toBeGreaterThan(sunk);
      sunk = h.scene!.sunk;
      expect(h.scene!.strikerOnTop, `slam ${i + 1}: the striker is on top`).toBe(true);
      expect(h.scene!.strayGraphics, `slam ${i + 1}: nothing drawn but the scene`).toBe(false);
      // owner 2026-09-29: "the banana also lengthens as it goes on": it must get SHORTER (more buried) every slam
      f.tick(90, 4);
      // the DRAWN quad (its bounds), not just the texture's numbers: a stale quad is what stretched
      const drawn = stake.getLocalBounds().height; // the quad in texture px (its own scale left out: the squash is separate)
      expect(drawn, `slam ${i + 1}: shorter`).toBeLessThan(long);
      long = drawn;
      const at = translateOf(attackerEl);
      expect(Math.hypot(at.x, at.y), `slam ${i + 1} reaches`).toBeGreaterThan(900); // the portrait itself is across the board
      extra.push(splatLayer.children.filter((c) => c.visible).length - before);
      // owner 2026-09-29: "remove the blood from the banana attack": nothing red, ever
      expect(reds(), `slam ${i + 1}: no blood`).toBe(0);
      expect(onImpact, `slam ${i + 1} is a tick`).not.toHaveBeenCalled();
    }
    // slams 4 and 5 add far more juice than slams 1 to 3 (the juice burst from slam 4 on)
    expect(extra[3]!).toBeGreaterThan(Math.max(extra[0]!, extra[1]!, extra[2]!));
    expect(extra[4]!).toBeGreaterThan(extra[3]!);
    f.tick(p.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(reds(), 'the finale: no blood').toBe(0);
    expect(h.scene!.stuckBanana).toBe(false); // burst into the finale
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_BANANA_SPRITES);
    f.tick(p.homeAt - h.elapsed() + 20, 4);
    expect(h.scene!.masked, 'home again: the cut is lifted').toBe(false);
    // owner 2026-09-29: "the hero gets messed up at the end": nothing may be left drawn over the striker's portrait
    expect(h.scene!.strayGraphics, 'no leftover disc').toBe(false);
    // owner 2026-09-29: "what's the leftover circle here from the banana final slam? can you remove that?": by the END
    // no crater ring or cracks are drawn (the splat on the target stays and fades as designed: owner "keep the banana
    // splat on the target still")
    f.tick(p.endAt - h.elapsed(), 8);
    expect(h.scene!.residue, 'the jam residue is cleared by the end').toBe(0);
    const darkRing = (['haze', 'splat', 'glow', 'body', 'core'] as const).some((l) => h.scene!.layer(l).children.some((c) =>
      c.visible && c.alpha > 0.01 && [0x2a1406, 0x1e0c04].includes((c as unknown as { tint: number }).tint)));
    expect(darkRing, 'no crater ring or cracks at the end').toBe(false);
    // and once the juice has played out its designed fade EVERY sprite and graphic is released: the scene drains, unhooks
    // and unmounts (nothing is held on screen)
    f.tick(3000, 8);
    expect(h.scene!.liveSprites, 'nothing survives the end').toBe(0);
    expect(f.hooked(), 'nothing survives the end').toBe(0);
    expect(h.scene!.strayGraphics).toBe(false);
    expect(onImpact).toHaveBeenCalledTimes(1);
    // both portraits exactly as they were (every inline style, not just the transform)
    expect(attackerEl.style.cssText).toBe(restA);
    expect(defenderEl.style.cssText).toBe(restD);
    expect(f.hooked()).toBe(0);
  });

  it('the camera is applied ONCE: mirrored onto the Pixi root only when the canvas is outside the camera element (owner 2026-09-29: splats "overshot due to the zoom")', () => {
    // Canvas outside the camera: the root mirrors the zoom.
    const out = run({ total: 14, formation: formationOf([14], 14) });
    out.f.tick(out.h.plan.impactAt + 8, 4);
    expect(out.camera.style.transform).toContain('scale(');
    expect(out.h.mirrorsCamera).toBe(true);
    expect(out.h.scene!.root.scale.x).toBeGreaterThan(1.001);
    out.h.cancel();
    // Canvas INSIDE the camera (the shared overlay since the scaled stage): the DOM camera already moves it.
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    document.body.append(camera);
    const inside = run({ total: 14, formation: formationOf([14], 14), camera });
    inside.f.tick(inside.h.plan.impactAt + 8, 4);
    expect(camera.style.transform).toContain('scale(');
    expect(inside.h.mirrorsCamera).toBe(false);
    expect(inside.h.scene!.root.scale.x).toBe(1);
    expect([inside.h.scene!.root.x, inside.h.scene!.root.y]).toEqual([0, 0]);
    inside.h.cancel();
  });

  it('the struck portrait DENTS along the blow on each slam (compressed toward the push, bulging across it)', () => {
    const { h, f, defenderEl } = run({ total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.slams[2]! + 30, 4);
    expect(defenderEl.style.transform).toMatch(/rotate\(.*scale\(.*rotate\(/);
    const sc = /scale\(([\d.]+), ([\d.]+)\)/.exec(defenderEl.style.transform)!;
    expect(Number(sc[1])).toBeLessThan(Number(sc[2]));
    h.cancel();
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck), inside the sprite cap', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 250 };
        const d = side === 'player' ? { x: 1400, y: 250 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 500; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_BANANA_SPRITES);
        for (const m of h.rig.shots) if (!m.giant) expect(Math.hypot(m.b.x - d.x, m.b.y - d.y)).toBeLessThanOrEqual(R * 0.6);
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
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.rig).toEqual(b.h.rig);
    a.f.tick(a.h.plan.impactAt + 60, 8); b.f.tick(b.h.plan.impactAt + 60, 8);
    expect(a.h.scene!.liveSprites).toBe(b.h.scene!.liveSprites);
    a.h.cancel(); b.h.cancel();
  });

  it('finish() before impact still lands the blow once and ends; cancel() mid-jam never lands it and puts the portraits back', () => {
    const a = run();
    a.f.tick(600);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.slams[1]! + 40);
    expect(b.attackerEl.style.transform).not.toBe('');
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
    expect(h.rig.shots).toEqual([]);
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
      const h = playHeroBanana({
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
  it('a whole Tier IV (warm-ups, blaze, giant, land, four slams, finale) stays in the cap and drains; destroy leaves nothing', () => {
    const s = new HeroBananaScene(TEX, COLORS, LOOK, 1, 42);
    const rig = bananaRig(P4, A, D, R, R, C);
    const jg = jamGeo(A, D, R, R, 330, 6, C);
    const u = jg.u;
    s.flourish(A.x, A.y, R, 400);
    for (let i = 0; i < 25; i++) s.update(16);
    let peak = 0;
    rig.shots.slice(0, -1).forEach((m, i) => s.fling(m, 1, 0, i));
    for (let i = 0; i < 40; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    rig.shots.slice(0, -1).forEach((_, i) => s.hit(i, D.x, D.y, R, i));
    s.flourish(A.x, A.y, R, 540, true);
    for (let i = 0; i < 30; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    expect(s.blazing).toBe(true);
    const gi = rig.shots.length - 1;
    s.fling(rig.shots[gi]!, 3.2, 0, gi);
    s.hang(gi, rig.shots[gi]!.b, R, 500);
    for (let i = 0; i < 70; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    s.land(gi, { entry: jg.entry, u, len: 330, depth: jg.depths[0]! });
    expect(s.stuckBanana).toBe(true);
    s.setCuts({ x: A.x, y: A.y, r: R });
    expect(s.strikerOnTop).toBe(true);
    for (let k = 0; k < 5; k++) { s.slam(k, jg.depths[k + 1]!, Math.max(0, k - 2)); for (let i = 0; i < 15; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); } }
    expect(s.crush).toBe(5);
    s.slam(5, jg.depths[6]!, 3);
    s.finale(gi, D.x, D.y, R, { burst: 1, juice: 200, flashAlpha: 0.85 });
    s.boom(D.x + 40, D.y, 1); s.boom(D.x - 40, D.y, 1.1); s.boom(D.x, D.y + 40, 1.2);
    for (let i = 0; i < 20; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    expect(peak).toBeLessThanOrEqual(MAX_BANANA_SPRITES);
    expect(s.liveBananas).toBe(0);
    expect(s.strayGraphics).toBe(false); // the cut circle is the mask, never drawn
    s.setCuts(null);
    expect(s.strikerOnTop).toBe(false);
    expect(s.strayGraphics).toBe(false); // and gone from the tree once lifted (it would render as a white disc)
    expect(s.masked).toBe(false); // really lifted (a leftover mask would hide everything outside the striker's circle)
    let alive = true;
    for (let i = 0; i < 800 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('NO blood (owner 2026-09-29: "just keep the banana splats instead"): the late slams burst extra painted juice, growing sharply (hits 5 and 6 far more), and juice DRIPS run down the face, over the rim, and linger through the finale', () => {
    const s = new HeroBananaScene(TEX, COLORS, LOOK, 1, 5);
    const rig = bananaRig(P4, A, D, R, R, C);
    const jg = jamGeo(A, D, R, R, 330, 6, C);
    const gi = rig.shots.length - 1;
    s.fling(rig.shots[gi]!, 3.2, 0, gi);
    s.land(gi, { entry: jg.entry, u: jg.u, len: 330, depth: jg.depths[0]!, face: { x: D.x, y: D.y, r: R } });
    // The burst's own share at each level: the same slam on the same seed, with and without it.
    const burstShare = (level: number): number => {
      const count = (lvl: number): number => {
        const t = new HeroBananaScene(TEX, COLORS, LOOK, 1, 77);
        t.fling(rig.shots[gi]!, 3.2, 0, gi);
        t.land(gi, { entry: jg.entry, u: jg.u, len: 330, depth: jg.depths[0]!, face: { x: D.x, y: D.y, r: R } });
        const before = t.layer('splat').children.filter((c) => c.visible).length;
        t.slam(5, jg.depths[6]!, lvl);
        const n = t.layer('splat').children.filter((c) => c.visible).length - before;
        t.destroy();
        return n;
      };
      return count(level) - count(0);
    };
    const shed = [1, 2, 3].map(burstShare);
    expect(shed[0]!).toBeGreaterThan(0);
    expect(shed[1]!).toBeGreaterThan(shed[0]! * 2.5);
    expect(shed[2]!).toBeGreaterThan(shed[1]! * 1.8);
    for (let k = 0; k < 3; k++) { s.slam(3 + k, jg.depths[4 + k]!, k + 1); for (let i = 0; i < 6; i++) s.update(16); }
    const anyRed = (['haze', 'splat', 'glow', 'body', 'core'] as const).some((l) => s.layer(l).children.some((c) => c.visible && isRed((c as unknown as { tint: number }).tint)));
    expect(anyRed).toBe(false);
    // the drips: yellow streams whose heads have run DOWN (below where they started), some past the portrait's bottom
    const juice = [0xfce400, 0xebb912];
    const streams = (): { y: number; h: number }[] => s.layer('splat').children
      .filter((c) => c.visible && juice.includes((c as unknown as { tint: number }).tint))
      .map((c) => ({ y: c.y, h: c.height }));
    expect(streams().length).toBeGreaterThan(8);
    for (let i = 0; i < 90; i++) s.update(16);
    expect(Math.max(...streams().map((q) => q.y + q.h))).toBeGreaterThan(D.y + R);
    s.finale(gi, D.x, D.y, R, { burst: 1, juice: 200, flashAlpha: 0.85 });
    for (let i = 0; i < 60; i++) s.update(16);
    expect(streams().length).toBeGreaterThan(8); // still running after the burst
    expect(s.residue).toBe(0); // but the crater ring and the cracks are cleared by it
    let alive = true;
    for (let i = 0; i < 800 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    s.destroy();
  });

  it('every banana is ONE painted side-on cell, SPINNING (never flipping through frames); a splat plays its sheet through once', () => {
    const frames = Array.from({ length: 16 }, () => new Texture({ source: W.source }));
    const splat = Array.from({ length: 14 }, () => new Texture({ source: W.source }));
    const s = new HeroBananaScene({ ...TEX, banana: frames, splat }, COLORS, LOOK, 1, 3);
    const m = bananaRig(P1, A, D, R, R, C).shots[0]!;
    s.fling(m, 1, 0, 0);
    const body = s.layer('body').children.find((c) => c.visible) as unknown as { texture: Texture; rotation: number };
    const seen = new Set<Texture>();
    const rots: number[] = [];
    for (let t = 0; t < 400; t += 16) { s.update(16); seen.add(body.texture); rots.push(body.rotation); }
    expect([...seen]).toEqual([frames[SIDE_FRAME]]);
    for (let i = 1; i < rots.length; i++) expect(rots[i]!).toBeLessThan(rots[i - 1]!); // turning steadily (backspin, flying right)
    s.hit(0, D.x, D.y, R, 0);
    const sp = s.layer('splat').children.find((c) => c.visible) as unknown as { texture: Texture };
    const order: number[] = [];
    for (let t = 0; t < LOOK.splatMs; t += 16) { s.update(16); order.push(splat.indexOf(sp.texture)); }
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThanOrEqual(order[i - 1]!);
    expect(order[order.length - 1]).toBeGreaterThan(10);
    s.destroy();
  });

  it('draws finite geometry every frame; clear() drops everything and the pool is reused, not regrown', () => {
    const s = new HeroBananaScene(TEX, COLORS, LOOK, 1, 9);
    const rig = bananaRig(P3, A, D, R, R, C);
    rig.shots.forEach((m, i) => s.fling(m, 1, 0, i));
    for (let t = 0; t < 300; t += 16) {
      s.update(16);
      for (const l of ['glow', 'body', 'core', 'splat', 'haze'] as const) for (const ch of s.layer(l).children) {
        if (!ch.visible) continue;
        expect(Number.isFinite(ch.x) && Number.isFinite(ch.y) && Number.isFinite(ch.rotation) && Number.isFinite(ch.scale.x) && Number.isFinite(ch.scale.y)).toBe(true);
      }
    }
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    rig.shots.forEach((m, i) => s.fling(m, 1, 0, i));
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 10);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it("Oona's Banana Cannon (attack_banana) is a Legendary crate hero attack that plays the banana style; the dev override can force it; unknown ids play Classic", () => {
    expect(COSMETIC_INDEX.attack_banana).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: "Oona's Banana Cannon", assets: { style: 'banana' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast', 'banana', 'bleed', 'cards', 'storm', 'coin', 'boomerang', 'bubble', 'backstab', 'basketball', 'fel']);
    expect(styleOfCosmetic('attack_banana')).toBe('banana');
    for (const [id, st] of [['attack_blast', 'blast'], ['attack_quake', 'quake'], ['attack_poison', 'poison'], ['attack_holy', 'holy']] as const) {
      expect(styleOfCosmetic(id)).toBe(st);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_banana' })).toBe('banana');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'banana' })).toBe('banana');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_banana' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_banana_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
