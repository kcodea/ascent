// @vitest-environment jsdom
/**
 * THE BLEED HERO ATTACK ("Hemorrhage"; owner 2026-09-29: "make some more attack types - we need ... a bleed/gash
 * animation ... use the same 4 tier strategy we have been"): the tier mapping SHARED with every style; the ladder (one
 * gash / a cross / a flurry ending in a claw rake / three rakes and the Hemorrhage); the tuner defaults + clamping; the
 * pure plan (the total is the engine's number, the cut rhythm, the impact beat, the heartbeat and the mega-slash at IV,
 * reduced motion, determinism); the pure geometry (crescents from the attacker's rim, cuts across the struck face, the
 * cross, the rake, mirrored for a foe, the mega-slash through the target); the camera; the runner on the shared clock
 * (the consequence lands exactly ONCE, on the last cut or the explosion, never on a tick or a zip; both directions; slow motion;
 * replay; finish / cancel; cleanup; wounds ride the knockback); the headless scene (pooled, bounded, drains, destroy
 * leaves nothing); and the cosmetic resolution (the other styles unchanged).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_BLAST_DEFAULTS, blastPlan } from '../heroBlast/heroBlastConfig';
import { HERO_POISON_DEFAULTS, poisonPlan } from '../heroPoison/heroPoisonConfig';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  AVOID_SHIFT, BLEED_CAPS, HERO_BLEED_DEFAULTS, RAKE_FAN, ZIP_FAN, lineOrientation, rakeLines, zipGeos, HERO_BLEED_RANGES, bleedCameraAt, bleedCameraFocus, bleedCues, bleedFlightMs, bleedPlan,
  clampHeroBleedValue, heroBleedConfigJson, megaPos, sanitizeHeroBleedConfig, slashGeos, waveEase, wavePos,
  type HeroBleedConfig, type HeroBleedNumKey,
} from './heroBleedConfig';
import { HeroBleedScene, MAX_BLEED_SPRITES, type HeroBleedTextures } from './heroBleedScene';
import { bleedSeed, playHeroBleed, type HeroBleedOptions } from './heroBleed';
import { SPEC } from '../HeroBleedTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBleedTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  crescent: W, crescentGlow: W, seam: W, seamSoft: W, gash: W, gashLip: W, drip: W, drop: W, splat: W, splat2: W, spray: W, disc: W, shock: W,
};
const C = HERO_BLEED_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => bleedPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xfff1ec, bright: 0xff2d3c, blood: 0xb3001b, deep: 0x3d0009, side: 0xff4757 };
const LOOK = {
  waveSize: 1, waveGlow: 0.75, afterimages: 3, afterMs: 22, seamWidth: 9, gashWidth: 15, spray: 10, tickDrops: 8, tint: 0.3,
  gravity: 1300, dripMs: 900, stainAlpha: 0.7, stainMs: 1300, spatter: 9, megaWidth: 22, megaSize: 2.4, novaSize: 1, explosionSize: 1.6,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const AREA = { x: 0, y: 0, w: 1920, h: 1080 };
const R = 80;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);
const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number => Math.hypot(p.x - q.x, p.y - q.y);

describe('the damage tiers (shared with every style)', () => {
  it('Bleed steps up on exactly the blows Blast and Poison do: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(blastPlan({ total: d, distance: 1600 }, HERO_BLAST_DEFAULTS).tier);
      expect(t).toBe(poisonPlan({ total: d, distance: 1600 }, HERO_POISON_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE clean gash, II a CROSS of two, III a FLURRY of five ending in a three-claw RAKE, IV three rakes and the HEMORRHAGE', () => {
    expect([P1, P2, P3, P4].map((p) => p.slashes.length)).toEqual([1, 2, 5, 3]);
    expect([P1, P2, P3, P4].map((p) => p.hemorrhage)).toEqual([false, false, false, true]);
    expect([P1, P2, P3, P4].map((p) => p.slashes.map((s) => s.lines))).toEqual([[1], [1, 1], [1, 1, 1, 1, 3], [3, 3, 3]]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.hemorrhage ? 'hemorrhage' : p.slashes.length; }))
      .toEqual([1, 1, 2, 2, 5, 5, 'hemorrhage', 'hemorrhage']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_BLEED_RANGES)) {
      const v = C[k as HeroBleedNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorBright', 'colorBlood', 'colorDeep', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroBleedValue('t3Slashes', 99)).toBe(8);
    expect(clampHeroBleedValue('t1Slashes', 0)).toBe(1);
    expect(clampHeroBleedValue('t4Claws', 9)).toBe(4);
    expect(clampHeroBleedValue('gashWidth', -3)).toBe(2);
    expect(clampHeroBleedValue('megaMs', 99999)).toBe(900);
    expect(clampHeroBleedValue('tintAlpha', 5)).toBe(0.8);
    expect(clampHeroBleedValue('drawMs', Number.NaN)).toBe(C.drawMs);
    expect(clampHeroBleedValue('drawMs', 'abc')).toBe(C.drawMs);
    expect(clampHeroBleedValue('drawMs', '120')).toBe(120);
    expect(clampHeroBleedValue('colorBlood', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroBleedValue('colorPlayer', 'red')).toBe(C.colorPlayer);
    expect(clampHeroBleedValue('sfxSwingClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroBleedValue('nope' as keyof HeroBleedConfig, 1)).toBeUndefined();
    expect(clampHeroBleedValue('toString' as keyof HeroBleedConfig, 1)).toBeUndefined();
    const s = sanitizeHeroBleedConfig({ t4Drops: 999, colorCore: 'x', bogus: 3 });
    expect(s.t4Drops).toBe(160);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroBleedConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; every sound cue has a clip row; Copy JSON leaves the preview-only keys out; the style row offers Bleed', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    for (const k of Object.keys(C).filter((x) => x.endsWith('Clip'))) {
      expect(SPEC.controls.find((c) => c.key === k)?.kind, k).toBe('select');
    }
    const json = JSON.parse(heroBleedConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Hemorrhage).toBe(1);
    expect(json.t3Slashes).toBe(5);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('bleed');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('bleed');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe huge (40)']) {
      expect(labels).toContain(l);
    }
    // Owner 2026-09-29 (every hero attack tuner): no speed or reduced-motion buttons, and the button row on TOP.
    for (const l of labels) expect(l).not.toMatch(/Speed|Reduced/);
    expect(SPEC.buttonsOnTop).toBe(true);
  });
});

describe('the plan', () => {
  it('THE FLURRY: five cuts land in rhythm, the first four are ticks, the LAST (the rake) is the impact (only one impact beat)', () => {
    const arr = P3.slashes.map((s) => s.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!, `arrival ${i}`).toBeGreaterThan(arr[i - 1]!);
    const gaps = arr.slice(1).map((a, i) => a - arr[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1); // an even rhythm
    expect(P3.impactAt).toBe(arr[arr.length - 1]);
    expect(P3.hits).toEqual(arr.slice(0, -1));
    const kinds = bleedCues(P3).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'swing')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
    // the wounds bleed and then close AFTER the blow (FX only)
    expect(kinds.indexOf('impact')).toBeLessThan(kinds.indexOf('bleed'));
    expect(kinds.indexOf('bleed')).toBeLessThan(kinds.indexOf('close'));
  });

  it('Tier II is a cross: two cuts on the two diagonals (one tick, then the impact); Tier I one cut, straight to the impact', () => {
    expect(P2.slashes[1]!.swingAt - P2.slashes[0]!.swingAt).toBeLessThanOrEqual(250);
    expect(P2.hits).toHaveLength(1);
    expect(P2.impactAt).toBe(P2.slashes[1]!.arriveAt);
    expect(P2.slashes[0]!.angle + P2.slashes[1]!.angle).toBeCloseTo(Math.PI, 6); // mirror images: an X
    expect(P2.slashes.map((s) => s.off)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }]); // crossing on the face
    expect(P1.slashes).toHaveLength(1);
    expect(P1.hits).toEqual([]);
    expect(P1.impactAt).toBe(P1.slashes[0]!.arriveAt);
    expect(P1.slashes[0]!.angle).toBeGreaterThan(0.3); // a real diagonal
    expect(P1.slashes[0]!.angle).toBeLessThan(1.2);
  });

  it('Tier IV: EVERY rake and EVERY zip is a tick; heartbeats, the wind-up, EIGHT zips, the held tension, and the EXPLOSION is the impact (the one consequence)', () => {
    const kinds = bleedCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'beat')).toHaveLength(C.beats);
    expect(C.zips).toBe(8); // the owner's "do 8 zips of the long attack animation"
    expect(kinds.filter((k) => k === 'zip')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'zhit')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds).not.toContain('close');
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(at('beat'));
    expect(at('wind')).toBeLessThan(at('zip'));
    expect(kinds.lastIndexOf('beat')).toBeLessThan(at('zip'));
    expect(kinds.lastIndexOf('zhit')).toBeLessThan(at('tension'));
    expect(at('tension')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('boom'));
    expect(P4.hits).toHaveLength(3 + 8);
    expect(Math.max(...P4.hits)).toBeLessThan(P4.impactAt);
    expect(P4.beats[0]!).toBeGreaterThan(Math.max(...P4.slashes.map((s) => s.arriveAt)));
    expect(P4.megaAt - P4.windAt).toBe(C.windupMs);
    expect(P4.zips[0]!.at).toBe(P4.megaAt);
    // every zip crosses the target half-way through its sweep
    for (const z of P4.zips) expect(z.hitAt).toBeCloseTo(z.at + z.dur / 2, 9);
    // the held tension, then the explosion
    expect(P4.impactAt - P4.tensionAt).toBe(C.tensionMs);
    expect(P4.tensionAt).toBeCloseTo(Math.max(...P4.zips.map((z) => z.at + z.dur)), 9);
  });

  it('the zips ACCELERATE: every gap and sweep shorter than (or equal to, at the floor) the one before; the first readable, the last a blur', () => {
    const gaps = P4.zips.slice(1).map((z, i) => z.at - P4.zips[i]!.at);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeLessThanOrEqual(gaps[i - 1]!);
    for (let i = 1; i < P4.zips.length; i++) expect(P4.zips[i]!.dur).toBeLessThanOrEqual(P4.zips[i - 1]!.dur);
    expect(gaps[0]!).toBeGreaterThanOrEqual(250);
    expect(gaps[gaps.length - 1]!).toBeLessThanOrEqual(80);
    expect(P4.zips[0]!.dur).toBeGreaterThan(P4.zips[7]!.dur * 3);
    for (const z of P4.zips) expect(z.dur).toBeGreaterThanOrEqual(C.zipMinMs);
    // the count is tunable and capped
    expect(bleedPlan({ total: 40, distance: 1600 }, { ...C, zips: 3 }).zips).toHaveLength(3);
    expect(bleedPlan({ total: 40, distance: 1600 }, { ...C, zips: 99 }).zips.length).toBeLessThanOrEqual(BLEED_CAPS.zips);
  });

  it('every tier escalates: more shake, zoom, droplets, splash, drips and dim', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      for (const k of ['shakePx', 'zoom', 'drops', 'burst', 'drips', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    }
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1600 px apart): first swing, impact and end, ms from the ready', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.swingAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual([
      [300, 530, 1470], [340, 760, 1740], [380, 970, 1990], [420, 3059, 4159],
    ]);
    // Chunky, not rushed, never dragging: Tier I about 1.5 s; Tier IV, the over-the-top one, still under 4.5 s.
    expect(t(P1)[2]).toBeLessThanOrEqual(2000);
    expect(t(P4)[2]).toBeLessThanOrEqual(4500);
  });

  it('the caps always hold, whatever the sliders say; flight scales gently with distance', () => {
    const wild: HeroBleedConfig = { ...C, t3Slashes: 8, t4Drops: 80, t4Shake: 40, t4Zoom: 0.14, t3Claws: 4 };
    expect(bleedPlan({ total: 15, distance: 800 }, wild).slashes.length).toBeLessThanOrEqual(BLEED_CAPS.slashes);
    expect(Math.max(...bleedPlan({ total: 15, distance: 800 }, wild).slashes.map((s) => s.lines))).toBeLessThanOrEqual(BLEED_CAPS.claws);
    expect(bleedPlan({ total: 99, distance: 800 }, wild).drops).toBeLessThanOrEqual(BLEED_CAPS.drops);
    expect(bleedFlightMs(1600, 230)).toBe(230);
    expect(bleedFlightMs(100, 230)).toBe(143);
    expect(bleedFlightMs(99999, 230)).toBe(265);
  });

  it('reduced motion: no swings, cuts, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.slashes.length]).toEqual([0, 0, 0, 0]);
    const kinds = bleedCues(p).map((q) => q.kind);
    for (const k of ['charge', 'swing', 'hit', 'beat', 'wind', 'mega', 'bleed', 'close']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(bleedCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(slashGeos(p, A, D, R, R, C)).toEqual([]);
  });

  it('is deterministic: the same fight plans the same beats and the same paths (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(bleedCues(plan([4, 2, 3], 9, 720))).toEqual(bleedCues(plan([4, 2, 3], 9, 720)));
    expect(slashGeos(P4, A, D, R, R, C)).toEqual(slashGeos(P4, A, D, R, R, C));
    expect(bleedSeed(14, 1500.2, 'player')).toBe(bleedSeed(14, 1500.4, 'player'));
    expect(bleedSeed(14, 1500, 'player')).not.toBe(bleedSeed(14, 1500, 'opp'));
  });
});

describe('the geometry', () => {
  it('a crescent leaves the attacker\'s rim, flies in, turns to the cut and runs straight THROUGH the face along it', () => {
    const [g] = slashGeos(P1, A, D, R, R, C);
    expect(dist(wavePos(g!, 0), A)).toBeLessThanOrEqual(R);
    const bite = wavePos(g!, g!.flightMs);
    expect(dist(bite, g!.start)).toBeLessThan(1);
    // by the time it bites it faces along the cut
    expect(Math.abs(Math.atan2(Math.sin(bite.rot - g!.angle), Math.cos(bite.rot - g!.angle)))).toBeLessThan(0.01);
    const out = wavePos(g!, g!.flightMs + g!.drawMs);
    expect(dist(out, g!.end)).toBeLessThan(1);
    // the cut crosses the struck portrait, across its middle, and stays within about its width
    expect(dist(g!.aim, D)).toBeLessThan(1);
    expect(g!.len).toBeCloseTo(C.t1SlashLength * R, 6);
    expect(dist(g!.start, D)).toBeLessThanOrEqual(R);
    expect(dist(g!.end, D)).toBeLessThanOrEqual(R);
    expect(waveEase(0)).toBe(0);
    expect(waveEase(1)).toBe(1);
    expect(waveEase(1) - waveEase(0.9)).toBeGreaterThan(waveEase(0.1) - waveEase(0)); // still accelerating as it bites
  });

  it('II draws an X (the two cuts cross at the heart of the face); III ends in a three-claw rake of parallel lines', () => {
    const [a, b] = slashGeos(P2, A, D, R, R, C);
    const cross = Math.abs(Math.sin(a!.angle - b!.angle));
    expect(cross).toBeGreaterThan(0.8); // near perpendicular
    expect(dist(a!.aim, b!.aim)).toBeLessThan(1);
    const g3 = slashGeos(P3, A, D, R, R, C);
    const rake = g3[g3.length - 1]!;
    expect(rake.lines).toHaveLength(3);
    const ang = rake.lines.map((l) => Math.atan2(l.to.y - l.from.y, l.to.x - l.from.x));
    for (const x of ang) expect(Math.abs(x - rake.angle)).toBeLessThan(1e-9); // parallel
    const gap = dist(rake.lines[0]!.from, rake.lines[1]!.from);
    expect(gap).toBeGreaterThan(R * 0.1);
    // the flurry spreads over the face, never one stack
    for (let i = 0; i < g3.length - 1; i++) for (let j = i + 1; j < g3.length - 1; j++) expect(dist(g3[i]!.aim, g3[j]!.aim), `${i}-${j}`).toBeGreaterThan(R * 0.15);
    for (const g of g3) for (const l of g.lines) { expect(dist(l.from, D)).toBeLessThanOrEqual(R * 1.05); expect(dist(l.to, D)).toBeLessThanOrEqual(R * 1.05); }
  });

  it('works both ways: a foe\'s cut is the mirror image, from their rim to you; the flight ceiling keeps it in frame', () => {
    const [mine] = slashGeos(P1, A, D, R, R, C);
    const [theirs] = slashGeos(P1, D, A, R, R, C);
    expect(dist(wavePos(theirs!, 0), D)).toBeLessThanOrEqual(R);
    expect(dist(theirs!.aim, A)).toBeLessThan(1);
    expect(theirs!.angle).toBeCloseTo(Math.PI - mine!.angle, 9);
    const [c] = slashGeos(P1, { x: 200, y: 100 }, { x: 1500, y: 60 }, R, R, C, 40);
    expect(c!.c.y).toBeGreaterThanOrEqual(40);
  });

  it('EVERY zip sweeps IN from the far side of the screen, across the board, through the struck hero half-way, and out past its corner; each its own line; both ways (owner 2026-09-29: "missing some of its wide slashes at the beginning")', () => {
    const MID = { x: 960, y: 540 };
    const span = 3700;
    for (const [a, d] of [[A, D], [D, A]] as const) {
      const zs = zipGeos(P4, a, d, span, MID);
      expect(zs).toHaveLength(8);
      const inward = Math.atan2(MID.y - d.y, MID.x - d.x);
      zs.forEach((z, i) => {
        expect(dist(megaPos(z, 0.5), d), `zip ${i} crosses the target half-way`).toBeLessThan(1e-6);
        // it STARTS on the screen side of the struck hero (toward the middle), so its first half crosses the board
        const f = { x: z.from.x - d.x, y: z.from.y - d.y };
        const cos = (f.x * Math.cos(inward) + f.y * Math.sin(inward)) / Math.hypot(f.x, f.y);
        expect(cos, `zip ${i} starts on the screen side`).toBeGreaterThan(Math.cos(0.9));
        // and a quarter of the way through its sweep its head is ON the 1920 x 1080 screen, crossing the board
        const q = megaPos(z, 0.25);
        expect(q.x >= 0 && q.x <= 1920 && q.y >= 0 && q.y <= 1080, `zip ${i} head on screen at a quarter`).toBe(true);
        expect(z.angle).toBeCloseTo(inward + Math.PI + ZIP_FAN[i]!, 9);
      });
      // no two zips on the same line: each visibly crosses the ones before it
      const orients = zs.map((z) => lineOrientation(z.angle));
      for (let i = 0; i < orients.length; i++) for (let j = i + 1; j < orients.length; j++) {
        const dd = Math.abs(orients[i]! - orients[j]!);
        expect(Math.min(dd, Math.PI - dd), `zips ${i} and ${j}`).toBeGreaterThan(0.1);
      }
    }
    // a sandbox (no middle given) aims across toward the striker
    const zs = zipGeos(P4, A, D, span);
    expect(dist(megaPos(zs[0]!, 0.5), D)).toBeLessThan(1e-6);
    expect(megaPos(zs[0]!, Number.NaN)).toEqual(zs[0]!.from);
  });

  it('Tier IV\'s claw rakes sweep WIDE lines too, in from the screen side, through the struck hero (owner 2026-09-29: "first 2 slash throughs on the huge attack still dont have the line slashes"); none below IV', () => {
    const MID = { x: 960, y: 540 };
    const ls = rakeLines(P4, A, D, 3700, MID);
    expect(ls).toHaveLength(3);
    const inward = Math.atan2(MID.y - D.y, MID.x - D.x);
    ls.forEach((l, i) => {
      expect(dist(megaPos(l, 0.5), D)).toBeLessThan(1e-6);
      expect(l.angle).toBeCloseTo(inward + Math.PI + RAKE_FAN[i]!, 9);
      const q = megaPos(l, 0.25);
      expect(q.x >= 0 && q.x <= 1920 && q.y >= 0 && q.y <= 1080, `rake ${i} head on screen`).toBe(true);
    });
    expect(rakeLines(P3, A, D, 3700, MID)).toEqual([]);
  });

  it('the cuts sit off the big -N (shifted to the far side of the face from it)', () => {
    const hitAt = { x: D.x - 150, y: D.y + 60 };
    const [plain] = slashGeos(P1, A, D, R, R, C);
    const [shifted] = slashGeos(P1, A, D, R, R, C, Number.NEGATIVE_INFINITY, hitAt);
    expect(dist(shifted!.aim, hitAt)).toBeGreaterThan(dist(plain!.aim, hitAt));
    expect(dist(shifted!.aim, D)).toBeCloseTo(AVOID_SHIFT * R, 6);
  });
});

describe('the camera', () => {
  it('pushes in through the ready, punches in on the impact and shakes ALONG the last cut; rests by the end', () => {
    const cuts = slashGeos(P3, A, D, R, R, C).map((g) => ({ x: Math.cos(g.angle), y: Math.sin(g.angle) }));
    const last = cuts[cuts.length - 1]!;
    const hit = bleedCameraAt(P3, C, P3.impactAt, last, cuts);
    expect(hit.zoom).toBeGreaterThan(1 + P3.zoom);
    expect(hit.x * last.x + hit.y * last.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = bleedCameraAt(P3, C, P3.endAt, last, cuts);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.8);
  });

  it('Tier IV breathes in on each heartbeat, eases back through the wind-up, whips along every zip, creeps in through the tension, then the explosion punches hardest; focus moves from striker to target', () => {
    const b = P4.beats[0]!;
    expect(bleedCameraAt(P4, C, b + 5).zoom).toBeGreaterThan(bleedCameraAt(P4, C, b - 5).zoom);
    expect(bleedCameraAt(P4, C, P4.megaAt - 5).zoom).toBeLessThan(bleedCameraAt(P4, C, P4.windAt).zoom + 1e-9);
    // it whips along each zip, and creeps in through the held tension
    const zd = { x: 0, y: 1 };
    const whip = bleedCameraAt(P4, C, P4.zips[4]!.hitAt + 3, { x: 1, y: 0 }, [], [zd, zd, zd, zd, zd, zd, zd, zd]);
    expect(whip.y).toBeGreaterThan(P4.shakePx * 0.3);
    expect(bleedCameraAt(P4, C, P4.impactAt - 5).zoom).toBeGreaterThan(bleedCameraAt(P4, C, P4.tensionAt + 5).zoom);
    const blast = bleedCameraAt(P4, C, P4.impactAt + 1);
    expect(blast.zoom).toBeGreaterThan(bleedCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(bleedCameraFocus(P4, P4.swingAt, A, D)).toEqual(A);
    expect(bleedCameraFocus(P4, P4.beats[0]!, A, D)).toEqual(D);
    expect(bleedCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
    let peak = 1;
    for (let t = P4.chargeAt; t < P4.endAt; t += 8) peak = Math.max(peak, bleedCameraAt(P4, C, t).zoom);
    expect(peak).toBeLessThan(1.3); // big, but never past a firm push
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroBleedOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBleedOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBleed({
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

  it('THE FLURRY lands the blow EXACTLY ONCE, on the LAST cut: never on a tick; wounds open, bleed and close; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.slashes).toHaveLength(5);
    expect(host.querySelector('.hblast.hbleed')).not.toBeNull();
    f.tick(h.plan.hits[h.plan.hits.length - 1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveWounds).toBe(4);
    expect(attackerEl.style.transform).toContain('rotate(');
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveWounds).toBe(4 + 3); // the rake: three more
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.bleedAt - h.elapsed() + 200, 8);
    expect(h.scene!.liveDrips).toBeGreaterThan(0); // the wounds keep bleeding
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16); // the drips drain, the wounds close, then the updater unhooks and the layer unmounts
    expect(h.scene!.liveWounds).toBe(0);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: three rakes, the heartbeats, EIGHT zips (all ticks), the held tension, and the blow lands ONCE on the EXPLOSION', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.hemorrhage).toBe(true);
    expect(h.zips).toHaveLength(8);
    expect(h.mega).toEqual(h.zips[0]);
    f.tick(h.plan.slashes[0]!.swingAt + 30, 4);
    expect(h.scene!.liveZips).toBeGreaterThanOrEqual(1); // the first rake's wide line is already sweeping
    f.tick(h.plan.beats[0]! + 20 - h.elapsed(), 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveWounds).toBe(9);
    f.tick(h.plan.windAt - h.elapsed() + 30, 4);
    expect(h.scene!.winding).toBe(true);
    f.tick(h.plan.zips[0]!.hitAt - h.elapsed() + 30, 4);
    expect(h.scene!.sweeping).toBe(true);
    expect(h.scene!.liveWounds).toBe(10); // a fresh gash from the first zip
    let peakZips = 0;
    while (h.elapsed() < h.plan.tensionAt + 20) { f.tick(4, 4); peakZips = Math.max(peakZips, h.scene!.liveZips); }
    expect(peakZips).toBeGreaterThan(1); // the late zips overlap: a frenzy
    expect(h.scene!.liveWounds).toBe(9 + 8);
    expect(h.scene!.tense).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.tense).toBe(false);
    let peak = 0;
    for (let i = 0; i < 60; i++) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
    expect(peak).toBeLessThanOrEqual(MAX_BLEED_SPRITES);
    expect(h.scene!.liveDrips).toBeGreaterThan(0); // the stain drips
    f.tick(h.plan.endAt + 5000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck)', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_BLEED_SPRITES);
        for (const g of h.geos) {
          expect(dist(g.a, a)).toBeLessThanOrEqual(R); // loosed from the attacker
          expect(dist(g.aim, d)).toBeLessThanOrEqual(R * 0.5); // cut across the struck hero
        }
        for (const z of h.zips) expect(dist(megaPos(z, 0.5), d)).toBeLessThan(1e-6);
        h.cancel();
      }
    }
  });

  it('wounds RIDE the struck portrait\'s knockback (they never float off it)', () => {
    const { h, f, root } = run({ total: 3, formation: formationOf([3], 3) });
    f.tick(h.plan.impactAt + 40, 4);
    const layer = root.children[0] as Container;
    const stain = layer.children.find((c) => c.label === 'bleed-stain') as Container;
    const g = h.geos[0]!;
    const wound = stain.children.find((c) => c.visible && Math.abs(c.rotation - g.angle) < 1e-6 && c.scale.x > 0.1);
    expect(wound).toBeDefined();
    const off = dist(wound!, g.lines[0]!.from);
    expect(off).toBeGreaterThan(1); // moved with the knockback, not pinned to the resting spot
    f.tick(h.plan.closeAt - h.elapsed() - 20, 4);
    expect(dist(wound!, g.lines[0]!.from)).toBeLessThan(off); // and back as the portrait springs home
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

  it('a replay plays the same: the same fight cuts the same paths and beats', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.geos).toEqual(b.h.geos);
    expect(a.h.zips).toEqual(b.h.zips);
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
    b.f.tick(b.h.plan.beats[0]! + 100);
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
    expect(h.geos).toEqual([]);
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
      const h = playHeroBleed({
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
  it('a whole Tier IV (eight zips and the explosion) stays in the cap and drains; destroy leaves nothing', () => {
    const s = new HeroBleedScene(TEX, COLORS, LOOK, 1, 42);
    const gs = slashGeos(P4, A, D, R, R, C);
    s.startCharge(A.x, A.y, gs[0]!.a, 70, 400, gs.length);
    for (let i = 0; i < 25; i++) s.update(16);
    let peak = 0;
    gs.forEach((g, i) => s.swing(i, g, 1.15, 0));
    for (let i = 0; i < 20; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    gs.forEach((g, i) => s.hit(g, D.x, D.y, R, i));
    expect(s.liveWounds).toBe(9);
    for (let b = 0; b < 2; b++) { s.beat(D.x, D.y, R, b); for (let i = 0; i < 18; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); } }
    s.windup(gs[0]!.a, 0, 380);
    for (let i = 0; i < 24; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    const zs = zipGeos(P4, A, D, dist(A, D) * 2.1);
    zs.forEach((z, i) => {
      s.startMega(z, P4.zips[i]!.dur);
      for (let k = 0; k < 3; k++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
      s.zipCut(z.angle, D.x, D.y, R, i);
      s.screenBlood(z, i, 1500, AREA);
    });
    expect(s.liveWounds).toBe(9 + 8);
    s.tension(D.x, D.y, R, 460);
    for (let i = 0; i < 28; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    s.explode(D.x, D.y, R, zs[7]!, { burst: 1.8, drops: 150, drips: 11, flashAlpha: 0.85, area: AREA });
    s.spurt(D.x + 30, D.y, 1, 0); s.spurt(D.x - 30, D.y, 1.1, Math.PI); s.spurt(D.x, D.y + 30, 1.2, 1);
    for (let i = 0; i < 10; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    expect(peak).toBeLessThanOrEqual(MAX_BLEED_SPRITES);
    let alive = true;
    for (let i = 0; i < 1200 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveWounds).toBe(0);
    expect(s.sweeping).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('EVERY zip, from the very first on a fresh scene, allocates its crescent and its seam and draws a visible crossing line, and cuts its own gash (owner 2026-09-29)', () => {
    const s = new HeroBleedScene(TEX, COLORS, LOOK, 1, 5);
    // the build-up first, as in a real fight (so the early zips compete with the rakes' sprites)
    const gs = slashGeos(P4, A, D, R, R, C);
    gs.forEach((g, i) => s.swing(i, g, 1.15, 0));
    for (let i = 0; i < 20; i++) s.update(16);
    gs.forEach((g, i) => s.hit(g, D.x, D.y, R, i));
    const zs = zipGeos(P4, A, D, dist(A, D) * 2.1);
    const layer = (id: string): Container => (s.root.children as Container[]).find((c) => c.label === id)!;
    zs.forEach((z, i) => {
      const before = s.liveSprites;
      const wounds = s.liveWounds;
      s.startMega(z, P4.zips[i]!.dur);
      expect(s.liveSprites - before, `zip ${i} sprites`).toBe(10); // head (3) + ghosts (4) + seam, bloom, split
      s.update(Math.min(16, P4.zips[i]!.dur / 2));
      // the seam: a visible core sprite on the zip's line, stretched out from its start
      const seam = layer('bleed-core').children.find((c) => c.visible && Math.abs(c.rotation - z.angle) < 1e-9 && c.scale.x > 0.05 && c.alpha > 0.5);
      expect(seam, `zip ${i} seam`).toBeDefined();
      s.zipCut(z.angle, D.x, D.y, R, i);
      expect(s.liveWounds, `zip ${i} gash`).toBe(wounds + 1);
    });
    expect(s.liveSprites).toBeLessThanOrEqual(MAX_BLEED_SPRITES);
    s.destroy();
  });

  it('the zips PILE blood across the whole screen (more each zip), it stays through the combo, and the explosion paints the screen; all of it fades out cleanly (owner 2026-09-29: "hilariously bloody by the end of the combo")', () => {
    const s = new HeroBleedScene(TEX, COLORS, LOOK, 1, 11);
    const zs = zipGeos(P4, A, D, 3700, { x: 960, y: 540 });
    const counts: number[] = [];
    zs.forEach((z, i) => {
      const before = s.liveSprites;
      s.screenBlood(z, i, 1500, AREA);
      counts.push(s.liveSprites - before);
      s.update(40);
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i]!, `zip ${i} flings more`).toBeGreaterThanOrEqual(counts[i - 1]! - 2);
    expect(counts[7]!).toBeGreaterThan(counts[0]!);
    // every splat lands on the screen
    const stain = (s.root.children as Container[]).find((c) => c.label === 'bleed-stain')!;
    for (const c of stain.children) if (c.visible && c.alpha > 0) { expect(c.x).toBeGreaterThanOrEqual(-1); expect(c.x).toBeLessThanOrEqual(1921); expect(c.y).toBeGreaterThanOrEqual(-1); expect(c.y).toBeLessThanOrEqual(1081); }
    // it is still there 600 ms on (piling up through the combo)
    for (let i = 0; i < 15; i++) s.update(40);
    const piled = stain.children.filter((c) => c.visible && c.alpha > 0.5).length;
    expect(piled).toBeGreaterThan(40);
    s.explode(D.x, D.y, R, zs[7]!, { burst: 1.8, drops: 150, drips: 11, flashAlpha: 0.85, area: AREA });
    for (let i = 0; i < 20; i++) s.update(40);
    expect(stain.children.filter((c) => c.visible && c.alpha > 0.5).length).toBeGreaterThan(piled + 20); // the screen painted
    expect(s.liveSprites).toBeLessThanOrEqual(MAX_BLEED_SPRITES);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(40);
    expect(alive).toBe(false); // fades out cleanly
    expect(s.liveSprites).toBe(0);
    s.destroy();
  });

  it('draws finite geometry every frame (no NaN at the swing, in flight, cutting, bleeding or closing)', () => {
    const s = new HeroBleedScene(TEX, COLORS, LOOK, 1, 3);
    const [g] = slashGeos(P1, A, D, R, R, C);
    s.swing(0, g!, 1, 0);
    const check = (): void => {
      for (const l of s.root.children as Container[]) {
        for (const ch of l.children) {
          if (!ch.visible) continue;
          expect(Number.isFinite(ch.x) && Number.isFinite(ch.y) && Number.isFinite(ch.rotation) && Number.isFinite(ch.scale.x) && Number.isFinite(ch.scale.y)).toBe(true);
        }
      }
    };
    for (let t = 0; t < g!.flightMs; t += 16) { s.update(16); check(); }
    s.impact(g!, D.x, D.y, R, { tier: 1, k: 0, burst: 1, drops: 14, flashAlpha: 0.85, cross: false });
    for (let i = 0; i < 20; i++) { s.update(16); check(); }
    s.bleed(D.x, D.y, R, 3);
    for (let i = 0; i < 30; i++) { s.update(16); check(); }
    s.close();
    for (let i = 0; i < 30; i++) { s.update(16); check(); }
    expect(s.liveWounds).toBe(0);
    s.destroy();
  });

  it('clear() drops everything in flight at once; the pool is reused, not regrown', () => {
    const s = new HeroBleedScene(TEX, COLORS, LOOK, 1, 9);
    const gs = slashGeos(P3, A, D, R, R, C);
    gs.forEach((g, i) => s.swing(i, g, 1, 0));
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    gs.forEach((g, i) => s.swing(i, g, 1, 0));
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 10);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Hemorrhage (attack_bleed) is a Legendary crate hero attack that plays Bleed; the dev override can force it; the other styles unchanged; unknown ids play Classic', () => {
    expect(COSMETIC_INDEX.attack_bleed).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Hemorrhage', assets: { style: 'bleed' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'bleed']);
    expect(styleOfCosmetic('attack_bleed')).toBe('bleed');
    for (const [id, st] of [['attack_blast', 'blast'], ['attack_quake', 'quake'], ['attack_arcana', 'arcana'], ['attack_blades', 'blades'], ['attack_enraged', 'enraged'], ['attack_poison', 'poison'], ['attack_frost', 'frost'], ['attack_holy', 'holy']] as const) {
      expect(styleOfCosmetic(id)).toBe(st);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_bleed' })).toBe('bleed');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'bleed' })).toBe('bleed');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_bleed' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_bleed_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
