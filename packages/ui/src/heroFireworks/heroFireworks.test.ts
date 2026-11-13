// @vitest-environment jsdom
/**
 * THE GRAND FINALE (style `fireworks`), an EPIC hero attack: the shared four damage tiers map to THREE looks (I the
 * bottle rocket, II and III the roman candle, IV the mortar shell; a knockout plays the mortar). Covered here: the
 * mapping; the tuner; the pure plan and its cue timing per look (the fuse, the launches, the pops, THE HELD BEAT, the
 * impact); the pure geometry in both directions (the firework stands on screen beside the striker, flights end on the
 * struck face, the comet leaves the top of the view, the bloom opens above the struck hero when there is room and
 * beside it in the open sky when there is none, the finale shells open round it inside the view); the camera
 * (still through the held beat); the runner on the shared clock (the blow lands exactly ONCE, never on a tick; both
 * directions; nothing moves and nothing sounds through the held beat; replay; finish / cancel / the safety timer;
 * every exit restores the portraits and the camera); and the headless scene (pooled, capped, drains, destroy leaves
 * nothing). The style is dev-only: it is in the style list and has no cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  BLOOM_INSET, BLOOM_VIEW, CANDLE_SHOTS, FINALE_LEAD_MS, FIREWORKS_CAPS, HERO_FIREWORKS_CLIP_KEYS, HERO_FIREWORKS_COLOR_KEYS, HERO_FIREWORKS_DEFAULTS, HERO_FIREWORKS_RANGES, LAUNCH_KICK_MS, PROP_LEAN,
  PROP_METRICS, clampHeroFireworksValue, fireworksArrivalDir, fireworksCameraAt, fireworksCameraFocus, fireworksCues, fireworksGeometry, fireworksLevel,
  fireworksPathAt, fireworksPlan, heroFireworksConfigJson, propPoint, sanitizeHeroFireworksConfig, type HeroFireworksConfig, type HeroFireworksNumKey,
} from './heroFireworksConfig';
import { HeroFireworksScene, MAX_FIREWORKS_SPRITES, MAX_STARS, type HeroFireworksTextures } from './heroFireworksScene';
import { fireworksSeed, fireworksTints, playHeroFireworks, type HeroFireworksOptions } from './heroFireworks';
import { SPEC } from '../HeroFireworksTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';

const W = Texture.WHITE;
const TEX: HeroFireworksTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W, rocket: W, candle: W, mortar: W,
};
const C = HERO_FIREWORKS_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false, knockout = false) => fireworksPlan({ total, distance, reduced, knockout, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xfffbea, gold: 0xffc94a, magenta: 0xff4fb0, cyan: 0x45dcff, green: 0x6dff7c, side: 0xffd66b };
const LOOK = { trailMs: 9, bloomMs: 2100, rain: 30, rainMs: 1000, glitter: 90, skyFlash: 0.36, dismissMs: 260, flashAlpha: 0.95, prefill: 0 };
// The real layout: you bottom left, the foe top right, on a 1920 x 1080 stage.
const YOU = { x: 176, y: 847 }, FOE = { x: 1773, y: 160 };
const R = 129;
const VIEW = { w: 1920, h: 1080 };
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);
const geo = (p: ReturnType<typeof plan>, a = YOU, d = FOE) => fireworksGeometry(p, a, d, R, R, C, 1, VIEW);

describe('the three looks (an Epic maps the shared four tiers onto three)', () => {
  it('reads the SHARED tier (thresholds 6 / 12 / 20) and maps I rocket, II and III candle, IV mortar', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    expect([1, 2, 3, 4].map((t) => fireworksLevel(t as 1 | 2 | 3 | 4))).toEqual([1, 2, 2, 3]);
    for (let d = 0; d <= 60; d++) {
      const p = plan([d], d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level).toBe(fireworksLevel(tierOf(d)));
    }
    expect([P1, P2, P3, P4].map((p) => p.level)).toEqual([1, 2, 2, 3]);
  });

  it('a knockout always plays the mortar (the held beat and the bloom), whatever the number', () => {
    const ko = plan([2, 1], 3, 1600, false, true);
    expect([ko.tier, ko.level]).toEqual([4, 3]);
    expect(ko.holdMs).toBe(C.holdMs);
  });

  it('the rocket launches once, the candle three times, the mortar once; only the mortar holds its breath', () => {
    expect([P1, P2, P4].map((p) => p.launches.length)).toEqual([1, CANDLE_SHOTS, 1]);
    expect([P1, P2, P4].map((p) => p.hits.length)).toEqual([0, CANDLE_SHOTS - 1, 0]);
    expect([P1, P2, P4].map((p) => p.holdMs)).toEqual([0, 0, C.holdMs]);
    expect(geo(P1).prop).toBe('rocket');
    expect(geo(P2).prop).toBe('candle');
    expect(geo(P4).prop).toBe('mortar');
  });

  it('is dev-only: in the style list and the dev override, with no cosmetic that plays it', () => {
    expect(HERO_ATTACK_STYLES).toContain('fireworks');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('fireworks');
    expect(Object.keys(COSMETIC_INDEX).filter((id) => styleOfCosmetic(id) === 'fireworks')).toEqual([]);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_FIREWORKS_RANGES)) {
      const v = C[k as HeroFireworksNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of HERO_FIREWORKS_COLOR_KEYS) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroFireworksValue('v3Sparks', 999)).toBe(80);
    expect(clampHeroFireworksValue('holdMs', -5)).toBe(0);
    expect(clampHeroFireworksValue('holdMs', 'abc')).toBe(C.holdMs);
    expect(clampHeroFireworksValue('holdMs', '700')).toBe(700);
    expect(clampHeroFireworksValue('colorGold', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroFireworksValue('colorGold', 'gold')).toBe(C.colorGold);
    expect(clampHeroFireworksValue('sfxBoomClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroFireworksValue('nope' as keyof HeroFireworksConfig, 1)).toBeUndefined();
    const s = sanitizeHeroFireworksConfig({ rain: 400, colorCore: 'x', bogus: 3 });
    expect(s.rain).toBe(40);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroFireworksConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers it; buttons on top', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroFireworksConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.holdMs).toBe(C.holdMs);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('fireworks');
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Rocket (3)', '▶ Candle (8)', '▶ Mortar (40)', '▶ Foe rocket (3)', '▶ Foe mortar (40)']) expect(labels).toContain(l);
    expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
  });

  it('player-facing words and hints carry no title tooltips, em dashes or banned words', () => {
    const text = [SPEC.title, ...SPEC.controls.flatMap((c) => [c.label, c.hint ?? '']), ...(SPEC.actions ?? []).flatMap((a) => [a.label, a.hint ?? ''])].join(' ');
    expect(text).not.toMatch(/—|--|\bOath\b|\bclimb\b/i);
  });

  it('the sound: its own seven clips are in the bank list for this style, and every clip key has a default that is in it or shared', () => {
    const own = [...(ATTACK_FX_CLIPS.fireworks ?? [])].sort();
    expect(own).toEqual(['fx/fireworks-boom', 'fx/fireworks-crackle', 'fx/fireworks-fuse', 'fx/fireworks-pop', 'fx/fireworks-squeal', 'fx/fireworks-thump', 'fx/fireworks-whistle']);
    for (const k of HERO_FIREWORKS_CLIP_KEYS) expect(C[k].length, k).toBeGreaterThan(0);
    // Every clip of its own is actually cued by a default (none is dead weight in the phone budget).
    const used = new Set(HERO_FIREWORKS_CLIP_KEYS.map((k) => C[k]));
    for (const clip of own) expect(used.has(clip), clip).toBe(true);
  });
});

describe('the plan (cue timing per look)', () => {
  const rel = (p: ReturnType<typeof plan>, at: number): number => Math.round(at - p.chargeAt);

  it('ROCKET: planted, the fuse fizzes, it launches, and its pop is THE impact the moment the flight ends; no ticks', () => {
    expect(rel(P1, P1.fuseAt)).toBe(C.plantMs);
    expect(P1.launches[0]).toBe(P1.fuseAt + P1.fuseMs);
    expect(P1.impactAt).toBe(P1.launches[0]! + P1.flyMs);
    expect(P1.hits).toEqual([]);
    expect(fireworksCues(P1).map((q) => q.kind)).toEqual(['plant', 'fuse', 'launch', 'impact', 'end']);
  });

  it('CANDLE: thump, thump, thump a fixed gap apart; the first two pops are ticks and the third is THE impact', () => {
    const [a, b, c] = P2.launches;
    expect([b! - a!, c! - b!]).toEqual([C.candleGapMs, C.candleGapMs]);
    expect(P2.hits).toEqual([a! + P2.flyMs, b! + P2.flyMs]);
    expect(P2.impactAt).toBe(c! + P2.flyMs);
    const kinds = fireworksCues(P2).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'launch')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'pop')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('pop')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds.indexOf('dismiss')).toBeGreaterThan(kinds.indexOf('impact'));
  });

  it('MORTAR: the thump, the comet leaves, THE HELD BEAT of `holdMs` with no beat inside it, then the bloom is THE impact', () => {
    expect(P4.holdAt).toBe(P4.launches[0]! + P4.flyMs);
    expect(P4.impactAt).toBe(P4.holdAt + C.holdMs);
    expect(C.holdMs).toBeGreaterThanOrEqual(500);
    expect(C.holdMs).toBeLessThanOrEqual(700);
    const cues = fireworksCues(P4);
    expect(cues.map((q) => q.kind)).toEqual(['plant', 'fuse', 'launch', 'hold', 'impact', 'dismiss', 'after', 'after', 'after', 'end']);
    // Nothing fires strictly inside the held beat.
    expect(cues.filter((q) => q.at > P4.holdAt && q.at < P4.impactAt)).toEqual([]);
  });

  it('MORTAR: THE FINALE is three smaller shells after the bloom, a steady gap apart, with the aftermath still running after the last', () => {
    expect(P4.afters).toEqual([0, 1, 2].map((i) => P4.impactAt + FINALE_LEAD_MS + i * C.finaleGapMs));
    expect(P4.afters[0]! - P4.impactAt).toBeGreaterThanOrEqual(250); // the bloom has its own moment first
    expect(P4.endAt - P4.afters[2]!).toBeGreaterThanOrEqual(500);
    expect(P4.endAt - P4.impactAt).toBeGreaterThanOrEqual(C.aftermathMs); // the glitter hangs for a good while
    // Only the mortar has one; the dial takes it away; it is capped.
    expect([P1.afters, P2.afters]).toEqual([[], []]);
    expect(fireworksPlan({ total: 40, distance: 1600 }, { ...C, finaleShots: 0 }).afters).toEqual([]);
    expect(fireworksPlan({ total: 40, distance: 1600 }, { ...C, finaleShots: 99 }).afters.length).toBe(FIREWORKS_CAPS.finale);
    expect(plan([40], 40, 1600, true).afters).toEqual([]); // reduced motion: none
  });

  it('short to medium, as an Epic should be (ms from the first beat: first launch, impact, end)', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [rel(p, p.launches[0]!), rel(p, p.impactAt), rel(p, p.endAt)];
    expect([t(P1), t(P2), t(P4)]).toEqual([[430, 790, 1450], [370, 1060, 1780], [570, 1590, 3390]]);
    // The mortar is the big look: it runs as long as the shipped top looks (Soccer IV 3308, Frost IV 3083), no longer.
    expect(t(P4)[2]).toBeGreaterThanOrEqual(3000);
    expect(t(P4)[2]).toBeLessThanOrEqual(3600);
  });

  it('every look escalates: more shake, zoom, punch and dim', () => {
    const ps = [P1, P2, P4];
    for (let i = 1; i < 3; i++) for (const k of ['shakePx', 'zoom', 'punch', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
  });

  it('the caps always hold', () => {
    const wild: HeroFireworksConfig = { ...C, v3Sparks: 80, v3Shake: 40, v3Zoom: 0.12 };
    const p = fireworksPlan({ total: 99, distance: 800 }, wild);
    expect(p.sparks).toBeLessThanOrEqual(FIREWORKS_CAPS.sparks);
    expect(p.shakePx).toBeLessThanOrEqual(FIREWORKS_CAPS.shakePx);
    expect(p.zoom).toBeLessThanOrEqual(FIREWORKS_CAPS.zoom);
    // The fullest bloom the sliders allow still fits the star pool.
    expect(Math.ceil(FIREWORKS_CAPS.sparks * 2.02) + FIREWORKS_CAPS.rain).toBeLessThanOrEqual(MAX_STARS);
  });

  it('reduced motion: no firework, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.launches.length, p.holdMs]).toEqual([0, 0, 0, 0, 0]);
    expect(fireworksCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(fireworksCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    const g = geo(p);
    expect([g.prop, g.paths.length, g.bloom]).toEqual([null, 0, null]);
  });

  it('is deterministic (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(geo(P4)).toEqual(geo(P4));
    expect(fireworksSeed(14, 1500.2, 'player')).toBe(fireworksSeed(14, 1500.4, 'player'));
    expect(fireworksSeed(14, 1500, 'player')).not.toBe(fireworksSeed(14, 1500, 'opp'));
    expect(fireworksSeed(14, 1500, 'player', 7)).not.toBe(fireworksSeed(14, 1500, 'player', 8));
    const pal = [1, 2, 3, 4];
    expect(fireworksTints(6, pal, 3)).toEqual([3, 4, 1]); // a run through the palette: no two the same
    expect(new Set(fireworksTints(123457, pal, 3)).size).toBe(3);
  });
});

describe('the geometry (both directions, on the real layout)', () => {
  const dirs: [string, typeof YOU, typeof FOE][] = [['you strike', YOU, FOE], ['the foe strikes', FOE, YOU]];

  it('the firework stands on screen, beside the striker on the target\'s side, leaning toward the target within its limit', () => {
    for (const [name, a, d] of dirs) {
      for (const p of [P1, P2, P4]) {
        const g = geo(p, a, d);
        const side = d.x >= a.x ? 1 : -1;
        expect(Math.sign(g.base.x - a.x), `${name} L${p.level}`).toBe(side);
        expect(Math.abs(g.base.x - a.x)).toBeLessThan(R * 2);
        expect(g.base.y).toBeGreaterThan(a.y); // on the line of the portrait's lower edge
        for (const pt of [g.base, g.anchor, g.mouth]) {
          expect(pt.x, `${name} L${p.level} x`).toBeGreaterThanOrEqual(0); expect(pt.x).toBeLessThanOrEqual(VIEW.w);
          expect(pt.y, `${name} L${p.level} y`).toBeGreaterThanOrEqual(0); expect(pt.y).toBeLessThanOrEqual(VIEW.h);
        }
        expect(Math.abs(g.angle)).toBeLessThanOrEqual(PROP_LEAN[g.prop!] + 1e-9);
        expect(Math.sign(g.angle)).toBe(side); // it leans at the target
        expect(g.mouth.y).toBeLessThan(g.base.y); // and always points up: it stands on the ground
        expect(g.flip).toBe(side === 1 ? 1 : -1); // its fuse is on the hero's side
        expect(Math.hypot(g.dir.x, g.dir.y)).toBeCloseTo(1, 9);
      }
    }
  });

  it('the fuse burns from its painted tip to its root on the firework, toward the hero that lit it', () => {
    for (const [, a, d] of dirs) {
      const g = geo(P4, a, d);
      const M = PROP_METRICS.mortar;
      const tip = propPoint(g, M.fuse0[0], M.fuse0[1], { x: 0, y: 0 });
      const root = propPoint(g, M.fuse1[0], M.fuse1[1], { x: 0, y: 0 });
      expect(Math.abs(tip.x - a.x)).toBeLessThan(Math.abs(root.x - a.x) + 1e-6);
      expect(Math.hypot(tip.x - g.anchor.x, tip.y - g.anchor.y)).toBeLessThan(M.h * g.k);
    }
  });

  it('ROCKET and CANDLE: every flight leaves the firework along its lean and ends on the struck face; pops stay on the portrait', () => {
    for (const [name, a, d] of dirs) {
      for (const p of [P1, P2]) {
        const g = geo(p, a, d);
        expect(g.paths).toHaveLength(p.launches.length);
        expect(g.strikes).toHaveLength(p.launches.length);
        g.paths.forEach((path, i) => {
          expect(path.from).toEqual(p.level === 1 ? g.anchor : g.mouth);
          expect(path.to).toEqual(g.strikes[i]);
          // It leaves along the lean: the control point is straight out of the mouth.
          const L = Math.hypot(path.ctrl.x - path.from.x, path.ctrl.y - path.from.y);
          expect((path.ctrl.x - path.from.x) / L).toBeCloseTo(g.dir.x, 6);
          expect((path.ctrl.y - path.from.y) / L).toBeCloseTo(g.dir.y, 6);
          expect(Math.hypot(path.to.x - d.x, path.to.y - d.y), `${name} L${p.level} #${i}`).toBeLessThanOrEqual(R * 0.6);
          // The whole flight stays on screen (a little slack for the wiggle).
          const q = { x: 0, y: 0 };
          for (let e = 0; e <= 1.0001; e += 0.05) {
            fireworksPathAt(path, e, q);
            expect(q.x).toBeGreaterThan(-20); expect(q.x).toBeLessThan(VIEW.w + 20);
            expect(q.y).toBeGreaterThan(-20); expect(q.y).toBeLessThan(VIEW.h + 20);
          }
        });
      }
    }
    // The candle's three land in three different places.
    const s = geo(P2).strikes;
    expect(Math.hypot(s[0]!.x - s[1]!.x, s[0]!.y - s[1]!.y)).toBeGreaterThan(R * 0.5);
  });

  it('the rocket WIGGLES, but leaves its stand and hits the face exactly (the wiggle is pinned at both ends)', () => {
    const path = geo(P1).paths[0]!;
    expect(path.wiggle).toBe(C.wigglePx);
    const q = { x: 0, y: 0 };
    expect(fireworksPathAt(path, 0, q)).toEqual(path.from);
    fireworksPathAt(path, 1, q);
    expect(q.x).toBeCloseTo(path.to.x, 6); expect(q.y).toBeCloseTo(path.to.y, 6);
    // Off the smooth curve in the middle, on both sides of it.
    const flat = { ...path, wiggle: 0 };
    const side: number[] = [];
    for (let e = 0.05; e < 1; e += 0.05) {
      const w = { ...fireworksPathAt(path, e, { x: 0, y: 0 }) }, f = fireworksPathAt(flat, e, { x: 0, y: 0 });
      side.push((w.x - f.x) * -(path.to.y - path.from.y) + (w.y - f.y) * (path.to.x - path.from.x));
    }
    expect(Math.max(...side)).toBeGreaterThan(0);
    expect(Math.min(...side)).toBeLessThan(0);
  });

  it('MORTAR: the comet leaves the TOP of the view; the bloom fills a large part of the sky by the struck hero, inside the view', () => {
    for (const [name, a, d] of dirs) {
      const g = geo(P4, a, d);
      const comet = g.paths[0]!;
      expect(comet.from).toEqual(g.mouth);
      expect(comet.to.y, name).toBeLessThan(0);
      expect(g.bloom).not.toBeNull();
      // Big: several portraits across, capped at a share of the view.
      expect(g.bloomR).toBe(Math.min(R * C.bloomSize, VIEW.h * BLOOM_VIEW));
      expect(g.bloomR * 2).toBeGreaterThan(VIEW.h * 0.7);
      // Mostly on screen, and by the struck hero: the portrait is inside the bloom, never at its centre.
      expect(g.bloom!.x).toBeGreaterThanOrEqual(g.bloomR * BLOOM_INSET - 1e-6); expect(g.bloom!.x).toBeLessThanOrEqual(VIEW.w - g.bloomR * BLOOM_INSET + 1e-6);
      expect(g.bloom!.y).toBeGreaterThanOrEqual(g.bloomR * BLOOM_INSET - 1e-6); expect(g.bloom!.y).toBeLessThanOrEqual(VIEW.h - g.bloomR * BLOOM_INSET + 1e-6);
      const off = Math.hypot(g.bloom!.x - d.x, g.bloom!.y - d.y);
      expect(off, name).toBeLessThan(g.bloomR * 1.1);
      expect(off, name).toBeGreaterThan(R * 1.5);
      expect(Math.hypot(g.strikes[0]!.x - d.x, g.strikes[0]!.y - d.y)).toBeLessThanOrEqual(R * 0.6);
      // THE FINALE: one point per shell, inside the view, clear of the struck portrait, all in different places.
      expect(g.afters.length).toBe(P4.afters.length);
      expect(g.afterR).toBeGreaterThan(R); expect(g.afterR).toBeLessThan(g.bloomR * 0.6);
      for (const q of g.afters) {
        expect(q.x).toBeGreaterThan(0); expect(q.x).toBeLessThan(VIEW.w); expect(q.y).toBeGreaterThan(0); expect(q.y).toBeLessThan(VIEW.h);
        expect(Math.hypot(q.x - d.x, q.y - d.y), name).toBeGreaterThan(R * 2);
      }
      for (let i = 0; i < g.afters.length; i++) for (let j = i + 1; j < g.afters.length; j++) expect(Math.hypot(g.afters[i]!.x - g.afters[j]!.x, g.afters[i]!.y - g.afters[j]!.y)).toBeGreaterThan(R);
    }
    // With room above (you, at the bottom of the screen) it hangs ABOVE the portrait, and the blow comes DOWN.
    const g = geo(P4, FOE, YOU);
    expect(g.bloom!.y).toBeLessThan(YOU.y - R);
    const dir = fireworksArrivalDir(P4, g, FOE, YOU);
    expect(dir.y).toBeGreaterThan(0.7);
    // With NO room above (the foe in the top right corner) it opens in the open sky toward the middle of the view:
    // left of and below the portrait, so the portrait sits on its rim and the blow comes from the board side.
    const top = geo(P4, YOU, FOE);
    expect(top.bloom!.x).toBeLessThan(FOE.x - R);
    expect(top.bloom!.y).toBeGreaterThan(FOE.y);
    const tdir = fireworksArrivalDir(P4, top, YOU, FOE);
    expect(tdir.x).toBeGreaterThan(0.5);
    // The rocket and the candle have no bloom and no finale.
    expect([geo(P1).bloom, geo(P2).bloom, geo(P1).afters, geo(P2).afters]).toEqual([null, null, [], []]);
  });

  it('a small sandbox box (the Collection preview) keeps everything inside it', () => {
    const view = { w: 400, h: 300 };
    const a = { x: 70, y: 230 }, d = { x: 330, y: 70 };
    for (const p of [P1, P2, P4]) {
      const g = fireworksGeometry(p, a, d, 40, 40, C, 0.3, view);
      for (const pt of [g.base, g.mouth]) { expect(pt.x).toBeGreaterThanOrEqual(0); expect(pt.x).toBeLessThanOrEqual(view.w); expect(pt.y).toBeGreaterThanOrEqual(0); expect(pt.y).toBeLessThanOrEqual(view.h); }
      if (g.bloom) { expect(g.bloom.x).toBeLessThanOrEqual(view.w); expect(g.bloom.y).toBeGreaterThanOrEqual(0); }
    }
  });
});

describe('the camera', () => {
  it('pushes in while the fuse burns, punches in on the impact and shakes along the blow; rests by the end', () => {
    const dir = { x: 0.8, y: -0.6 };
    expect(fireworksCameraAt(P2, C, P2.launches[0]!, dir).zoom).toBeCloseTo(1 + P2.zoom, 6);
    const hit = fireworksCameraAt(P2, C, P2.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P2.zoom * 0.9);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P2.shakePx * 0.5);
    const rest = fireworksCameraAt(P2, C, P2.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.8);
  });

  it('MORTAR: the thump kicks the view down and is over before the held beat; through the held beat the camera is EXACTLY still', () => {
    const thump = fireworksCameraAt(P4, C, P4.launches[0]! + 1);
    expect(thump.y).toBeGreaterThan(P4.shakePx * 0.3);
    expect(LAUNCH_KICK_MS).toBeLessThanOrEqual(P4.flyMs);
    const first = fireworksCameraAt(P4, C, P4.holdAt);
    expect(first).toEqual({ zoom: 1 + P4.zoom, x: 0, y: 0 });
    for (let t = P4.holdAt; t < P4.impactAt; t += 7) {
      expect(fireworksCameraAt(P4, C, t)).toEqual(first);
      expect(fireworksCameraFocus(P4, t, YOU, FOE)).toEqual(FOE);
    }
    expect(fireworksCameraFocus(P4, P4.chargeAt, YOU, FOE)).toEqual(YOU);
    let peak = 1;
    for (let t = P4.chargeAt; t < P4.endAt; t += 8) peak = Math.max(peak, fireworksCameraAt(P4, C, t).zoom);
    expect(peak).toBeLessThan(1.2);
    expect(fireworksCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
  });
});

function manualFrames(): { frames: HeroFireworksOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroFireworksOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  // What the portraits carry before the attack: every exit must put exactly this back.
  for (const el of [attackerEl, defenderEl]) { el.className = 'heroportrait keepme'; el.style.opacity = '0.9'; el.style.filter = 'saturate(1.1)'; }
  document.body.append(host, camera);
  const h = playHeroFireworks({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: YOU, defender: FOE, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

function expectRestored(r: ReturnType<typeof run>): void {
  for (const el of [r.attackerEl, r.defenderEl]) {
    expect(el.style.transform).toBe('');
    expect(el.style.opacity).toBe('0.9');
    expect(el.style.filter).toBe('saturate(1.1)');
    expect(el.className).toBe('heroportrait keepme');
  }
  expect(r.camera.style.transform).toBe('');
  expect(r.host.querySelector('.hblast')).toBeNull();
  expect(r.root.children).toHaveLength(0);
  expect(r.f.hooked()).toBe(0);
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('ROCKET: planted, the fuse lit, it flies, and its pop lands the blow EXACTLY ONCE; ends clean', () => {
    const r = run({ total: 3, formation: formationOf([3], 3) });
    const { h, f, onImpact, onDone, host } = r;
    expect(h.plan.level).toBe(1);
    expect(h.tints).toHaveLength(1);
    expect(host.querySelector('.hblast.hfireworks')).not.toBeNull();
    f.tick(h.plan.fuseAt + 40, 4);
    expect(h.scene!.planted).toBe(true);
    expect(h.scene!.fuseLit).toBe(true);
    f.tick(h.plan.launches[0]! - h.elapsed() + 40, 4);
    expect(h.scene!.fuseLit).toBe(false);
    expect(h.scene!.rocketFlying).toBe(true);
    expect(h.scene!.planted).toBe(false); // the rocket IS the projectile
    f.tick(h.plan.impactAt - h.elapsed() - 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(16, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.rocketFlying).toBe(false);
    expect(r.camera.style.transform).toContain('scale(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-3');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    f.tick(3000, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });

  it('CANDLE: three balls; the first two pops are ticks (the portrait is nudged, the blow is NOT landed); the third lands it once', () => {
    const r = run({ total: 8, formation: formationOf([8], 8) });
    const { h, f, onImpact, defenderEl } = r;
    expect(h.plan.level).toBe(2);
    expect(new Set(h.tints).size).toBe(3); // each a different colour
    f.tick(h.plan.launches[1]! + 20, 4);
    expect(h.scene!.liveBalls).toBe(2); // thumped out in a row, in the air together
    expect(h.scene!.planted).toBe(true);
    f.tick(h.plan.hits[0]! - h.elapsed() + 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(defenderEl.style.transform).toContain('translate('); // a tick nudges it
    f.tick(h.plan.impactAt - h.elapsed() - 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(16, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveBalls).toBe(0);
    f.tick(h.plan.dismissAt - h.elapsed() + C.dismissMs + 40, 4);
    expect(h.scene!.planted).toBe(false); // the tube is taken away
    f.tick(4000, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });

  it('MORTAR: the comet leaves, then THE HELD BEAT: for about 0.6 s nothing moves (scene, camera, both portraits) while the clock runs on; then the bloom lands the blow ONCE', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, f, onImpact, camera, attackerEl, defenderEl } = r;
    expect(h.plan.level).toBe(3);
    f.tick(h.plan.launches[0]! + 24, 4);
    expect(h.scene!.cometUp).toBe(true);
    expect(attackerEl.style.transform).toContain('translate('); // the hero flinches at the thump
    f.tick(h.plan.holdAt - h.elapsed() + 4, 4);
    expect(h.scene!.cometUp).toBe(false); // gone off the top
    // Let the last of the comet's trail wink out, then sample the whole of the rest of the beat.
    f.tick(200, 4);
    const cam0 = camera.style.transform;
    expect(cam0).toContain('scale('); // held pushed in, not released
    let quiet = 0;
    while (h.elapsed() < h.plan.impactAt - 8) {
      const before = h.elapsed();
      f.tick(4, 4);
      expect(h.elapsed() - before).toBe(4); // staged stillness: the clock itself never stops
      expect(h.scene!.moving, `moving at ${h.elapsed() - h.plan.holdAt} ms into the beat`).toBe(false);
      expect(h.scene!.liveStars).toBe(0);
      expect(camera.style.transform).toBe(cam0);
      expect(attackerEl.style.transform).toBe('');
      expect(defenderEl.style.transform).toBe('');
      quiet += 4;
    }
    expect(quiet).toBeGreaterThanOrEqual(380);
    expect(h.scene!.planted).toBe(true); // the tube just stands there
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(16, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveStars).toBeGreaterThan(100); // the chrysanthemum
    expect(h.scene!.liveStars).toBeLessThanOrEqual(MAX_STARS);
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_FIREWORKS_SPRITES);
    f.tick(60, 4);
    // Knocked, ROCKED and squashed by the bloom.
    expect(defenderEl.style.transform).toMatch(/^translate\(.+\) rotate\(-?\d+\.\d+deg\) scale\(\d\.\d+, \d\.\d+\)$/);
    // THE FINALE: each smaller shell throws its own stars and rocks the portrait again; none lands anything.
    for (let i = 0; i < h.plan.afters.length; i++) {
      f.tick(h.plan.afters[i]! - h.elapsed() - 4, 4);
      const before = h.scene!.liveStars;
      f.tick(12, 4);
      expect(h.scene!.liveStars, `finale shell ${i}`).toBeGreaterThan(before + 20);
      expect(h.scene!.liveStars).toBeLessThanOrEqual(MAX_STARS);
      expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_FIREWORKS_SPRITES);
      f.tick(40, 4);
      expect(defenderEl.style.transform).toContain('rotate(');
      expect(onImpact).toHaveBeenCalledTimes(1);
    }
    // The aftermath: stars and glitter still hang a second after the bloom.
    f.tick(h.plan.impactAt + 1000 - h.elapsed(), 4);
    expect(h.scene!.liveStars).toBeGreaterThan(40);
    f.tick(h.plan.endAt + 4000, 8);
    expect(h.scene!.liveStars).toBe(0);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });

  it('the bloom\'s star sprites are made AHEAD of it, a few per frame, so the bloom frame creates none', () => {
    const { h, f } = run({ total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.holdAt + 200, 4);
    const pooled = h.scene!.pooledSprites;
    expect(pooled).toBeGreaterThan(150);
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(h.scene!.liveStars).toBeGreaterThan(100);
    // Only the bloom's few one-off pieces (flash, halo, ring, sky, crackle) are new; never a star.
    expect(h.scene!.pooledSprites - pooled).toBeLessThan(45);
    h.cancel();
  });

  it('a knockout blow of 3 plays the mortar', () => {
    const { h } = run({ total: 3, knockout: true, formation: formationOf([3], 3) });
    expect(h.plan.level).toBe(3);
    expect(h.geo.bloom).not.toBeNull();
    h.cancel();
  });

  it('works in both directions at every look: the blow lands once, the pops are on the struck portrait, inside the caps', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? YOU : FOE, d = side === 'player' ? FOE : YOU;
        const r = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        const { h, f, onImpact } = r;
        let peakS = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peakS = Math.max(peakS, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peakS).toBeLessThanOrEqual(MAX_FIREWORKS_SPRITES);
        for (const p of h.geo.strikes) expect(Math.hypot(p.x - d.x, p.y - d.y)).toBeLessThanOrEqual(R * 0.6);
        f.tick(6000, 16);
        expectRestored(r);
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

  it('a replay plays the same: the same plan, geometry, colours and sparks; another roll changes the colours only', () => {
    const a = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5 });
    const b = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5 });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.geo).toEqual(b.h.geo);
    expect(a.h.tints).toEqual(b.h.tints);
    a.f.tick(a.h.plan.impactAt + 300, 8); b.f.tick(b.h.plan.impactAt + 300, 8);
    expect(a.h.scene!.liveSprites).toBe(b.h.scene!.liveSprites);
    expect(a.h.scene!.liveStars).toBe(b.h.scene!.liveStars);
    a.h.cancel(); b.h.cancel();
    const c1 = run({ total: 3, formation: formationOf([3], 3), rollSeed: 1 });
    const c2 = run({ total: 3, formation: formationOf([3], 3), rollSeed: 2 });
    expect(c1.h.plan).toEqual(c2.h.plan);
    expect(c1.h.tints).not.toEqual(c2.h.tints);
    c1.h.cancel(); c2.h.cancel();
  });

  it('finish() at any point lands the blow once and restores everything (mid fuse, mid flight, in the held beat, after the bloom)', () => {
    const at = (p: ReturnType<typeof plan>): number[] => [p.fuseAt + 30, p.launches[0]! + 60, p.holdAt + 300, p.impactAt + 120];
    for (const total of [3, 8, 40]) {
      for (let i = 0; i < 4; i++) {
        const r = run({ total, formation: formationOf([total], total) });
        r.f.tick(at(r.h.plan)[i]!, 4);
        r.h.finish();
        expect(r.onImpact, `${total} #${i}`).toHaveBeenCalledTimes(1);
        expect(r.onDone).toHaveBeenCalledTimes(1);
        expect(r.h.done).toBe(true);
        expectRestored(r);
        r.f.tick(500);
        expect(r.onImpact).toHaveBeenCalledTimes(1);
      }
    }
  });

  it('cancel() never lands the blow and restores everything (an unmount mid sequence)', () => {
    for (const total of [3, 8, 40]) {
      for (const frac of [0.2, 0.55, 0.9]) {
        const r = run({ total, formation: formationOf([total], total) });
        r.f.tick(r.h.plan.impactAt * frac, 4);
        r.h.cancel();
        r.f.tick(5000);
        expect(r.onImpact).not.toHaveBeenCalled();
        expect(r.onDone).not.toHaveBeenCalled();
        expectRestored(r);
      }
    }
  });

  it('reduced motion: no Pixi layer, no camera or portrait move; the blow lands once', () => {
    const r = run({ reduced: true, total: 40, formation: formationOf([40], 40) });
    const { h, f, onImpact } = r;
    expect(r.root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(r.camera.style.transform).toBe('');
    expect(r.defenderEl.style.transform).toBe('');
    f.tick(h.plan.endAt);
    expectRestored(r);
  });

  it('the safety timer lands the blow and restores everything if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const camera = document.createElement('div');
      const attackerEl = document.createElement('div');
      const defenderEl = document.createElement('div');
      const root = new Container();
      const h = playHeroFireworks({
        formation: formationOf([25], 25), total: 25, attacker: YOU, defender: FOE,
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false,
        mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host: null, camera, attackerEl, defenderEl,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
      expect(root.children).toHaveLength(0);
      expect(camera.style.transform).toBe('');
      expect(attackerEl.style.transform).toBe('');
      expect(defenderEl.style.transform).toBe('');
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  const G4 = geo(P4), G2 = geo(P2), G1 = geo(P1);

  it('the rocket is ONE sprite: planted, then the same sprite flies nose first and is gone when it pops', () => {
    const s = new HeroFireworksScene(TEX, COLORS, LOOK, 1, 5);
    s.plant(G1, 130);
    s.update(200);
    s.fuse(300);
    s.update(50);
    expect([s.planted, s.fuseLit]).toEqual([true, true]);
    const body = s.root.children.find((c) => c.label === 'heroFireworks-body') as Container;
    const sprite = body.children.find((c) => c.visible)!;
    expect(sprite.rotation).toBeCloseTo(G1.angle, 1); // leaning at the target (give or take its tremble)
    s.launchRocket(G1.paths[0]!, 360, COLORS.cyan);
    for (let i = 0; i < 12; i++) s.update(16);
    expect(s.rocketFlying).toBe(true);
    expect(body.children.filter((c) => c.visible)).toEqual([sprite]); // still the one sprite
    expect(Math.hypot(sprite.x - G1.anchor.x, sprite.y - G1.anchor.y)).toBeGreaterThan(100); // away
    s.pop(G1.strikes[0]!, COLORS.cyan, 1, 14);
    expect(s.rocketFlying).toBe(false);
    expect(body.children.filter((c) => c.visible)).toEqual([]);
    let alive = true;
    for (let i = 0; i < 200 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    s.destroy();
  });

  it('a whole mortar stays in the caps, is still through the held beat, and drains; destroy leaves nothing', () => {
    const s = new HeroFireworksScene(TEX, COLORS, { ...LOOK, prefill: 150 }, 1, 42);
    s.setView(VIEW.w, VIEW.h);
    let peak = 0;
    const step = (n: number): void => { for (let i = 0; i < n; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); } };
    s.plant(G4, 130); step(8);
    s.fuse(260); step(16);
    s.thump(COLORS.gold, 1.5, true);
    s.comet(G4.paths[0]!, 400);
    step(26);
    expect(s.cometUp).toBe(false);
    step(12); // the trail's last sparks
    for (let i = 0; i < 20; i++) { s.update(16); expect(s.moving).toBe(false); }
    expect(s.liveSprites).toBe(2); // the tube and its shadow, nothing else
    s.bloom(G4.bloom!, G4.bloomR, FOE, R, 72, 1.25);
    // Four rings (gold, magenta, cyan, the white pistil), the willow, and the falling sparks.
    const bloomStars = 72 + Math.round(72 * 0.62) + Math.round(72 * 0.4) + Math.round(72 * 0.2) + Math.round(72 * 0.55) + LOOK.rain;
    expect(s.liveStars).toBe(bloomStars);
    step(10);
    // THE FINALE: three smaller shells on top of the bloom, still inside every cap.
    G4.afters.forEach((q, i) => { s.afterBurst(q, G4.afterR, [COLORS.magenta, COLORS.cyan, COLORS.green][i]!, FOE, R, 26); step(6); });
    expect(s.liveStars).toBe(bloomStars + 3 * (26 + Math.round(26 * 0.45)));
    expect(s.liveStars).toBeLessThanOrEqual(MAX_STARS);
    s.dismiss();
    step(30);
    expect(s.planted).toBe(false);
    expect(peak).toBeLessThanOrEqual(MAX_FIREWORKS_SPRITES);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveStars).toBe(0);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('the bloom is a ring: its stars leave evenly in every direction, reach about its radius, then droop', () => {
    const s = new HeroFireworksScene(TEX, COLORS, { ...LOOK, rain: 0, glitter: 0, skyFlash: 0 }, 1, 7);
    const at = { x: 900, y: 500 };
    s.bloom(at, 300, { x: 900, y: 900 }, 100, 40, 1);
    const core = s.root.children.find((c) => c.label === 'heroFireworks-core') as Container;
    const stars = (): { x: number; y: number }[] => core.children.filter((c) => c.visible && c.alpha > 0.5 && (c as unknown as { anchor: { x: number } }).anchor.x === 0.9).map((c) => ({ x: c.x, y: c.y }));
    for (let i = 0; i < 38; i++) s.update(16); // 600 ms: fully open
    const open = stars();
    expect(open.length).toBeGreaterThanOrEqual(40 + 25);
    const far = Math.max(...open.map((p) => Math.hypot(p.x - at.x, p.y - at.y)));
    expect(far).toBeGreaterThan(300 * 0.75); expect(far).toBeLessThan(300 * 1.25);
    // Every quadrant has its share of the outer ring.
    const outer = open.filter((p) => Math.hypot(p.x - at.x, p.y - at.y) > 300 * 0.6);
    for (const [qx, qy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) expect(outer.filter((p) => Math.sign(p.x - at.x) === qx && Math.sign(p.y - 20 - at.y) === qy).length).toBeGreaterThan(4);
    const y0 = open.reduce((m, p) => m + p.y, 0) / open.length;
    for (let i = 0; i < 20; i++) s.update(16);
    const later = stars();
    expect(later.reduce((m, p) => m + p.y, 0) / later.length).toBeGreaterThan(y0 + 10); // drooping
    s.destroy();
  });

  it('the falling sparks land ON the struck portrait and twinkle out there', () => {
    const s = new HeroFireworksScene(TEX, COLORS, { ...LOOK, rain: 12, glitter: 0, skyFlash: 0 }, 1, 3);
    const target = { x: 300, y: 850 };
    s.bloom({ x: 310, y: 480 }, 380, target, 120, 0, 1);
    expect(s.liveStars).toBe(12);
    const core = s.root.children.find((c) => c.label === 'heroFireworks-core') as Container;
    const seen = new Map<unknown, { x: number; y: number }>();
    for (let i = 0; i < 120 && s.liveStars > 0; i++) {
      s.update(12);
      for (const c of core.children) if (c.visible && (c as unknown as { anchor: { x: number } }).anchor.x === 0.9 && c.alpha > 0.9) seen.set(c, { x: c.x, y: c.y });
    }
    expect(s.liveStars).toBe(0);
    expect(seen.size).toBeGreaterThanOrEqual(6);
    // Where each was last seen (a frame before landing): on the portrait.
    for (const p of seen.values()) expect(Math.hypot(p.x - target.x, p.y - target.y)).toBeLessThan(120 * 0.8 + 40);
    s.destroy();
  });

  it('clear() drops everything at once; the pools are reused, not regrown', () => {
    const s = new HeroFireworksScene(TEX, COLORS, LOOK, 1, 9);
    const fire = (): void => {
      s.plant(G2, 130); s.fuse(240); s.update(16);
      s.thump(COLORS.green, 0.8); G2.paths.forEach((p, i) => s.ball(p, 330, [COLORS.green, COLORS.gold, COLORS.magenta][i]!));
      s.update(16);
      s.pop(G2.strikes[0]!, COLORS.green, 1, 10);
      s.update(16);
    };
    fire();
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect([s.planted, s.fuseLit, s.liveBalls, s.liveStars]).toEqual([false, false, 0, 0]);
    expect(s.update(16)).toBe(false);
    fire();
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 6);
    s.destroy();
  });
});
