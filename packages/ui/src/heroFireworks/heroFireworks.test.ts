// @vitest-environment jsdom
/**
 * THE GRAND FINALE (style `fireworks`), an EPIC hero attack: the shared four damage tiers map to THREE looks (shared tier
 * 1 plays Tier 1, shared tiers 2 and 3 play Tier 2, shared tier 4 and every knockout play Tier 3), and every look has
 * three variants rolled from the stable `rollSeed` (the smiley, the pinwheel, the fake-out). Covered here: the mapping;
 * the variant roll (deterministic from the seed, every one reachable, each one forceable from the tuner); the tuner
 * (tier names, the Variation row, clamping); the sound list; the pure plan and its cues per tier and variant (the
 * barrage, THE HELD BEAT, the enormous shell, the final flash); the pure geometry in both directions (the spark on the
 * striker's rim, every burst inside the view, the comet off the top); the camera (still through the held beat, at rest
 * by the end); the runner on the shared clock (the blow lands exactly ONCE, never on a tick, in every tier, variant and
 * direction; replay; finish / cancel / the safety timer; every exit restores the portraits and the camera); and the
 * headless scene (no painted launcher, pooled, capped, drains, destroy leaves nothing). The style is dev-only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  FIREWORKS_CAPS, FIREWORKS_LEVEL_NAMES, FIREWORKS_VARIANTS, HERO_FIREWORKS_CLIP_KEYS, HERO_FIREWORKS_COLOR_KEYS, HERO_FIREWORKS_DEFAULTS, HERO_FIREWORKS_RANGES,
  clampHeroFireworksValue, fireworksCameraAt, fireworksCameraFocus, fireworksCues, fireworksGeometry, fireworksLevel, fireworksPathAt, fireworksPlan,
  fireworksVariantOf, heroFireworksConfigJson, sanitizeHeroFireworksConfig, type FireworksVariant, type HeroFireworksConfig, type HeroFireworksNumKey,
} from './heroFireworksConfig';
import { HeroFireworksScene, MAX_FIREWORKS_SPRITES, MAX_PARTICLES, type HeroFireworksTextures } from './heroFireworksScene';
import { fireworksSeed, playHeroFireworks, type HeroFireworksOptions } from './heroFireworks';
import { SPEC } from '../HeroFireworksTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';

const W = Texture.WHITE;
const TEX: HeroFireworksTextures = { glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W, puff: W };
const C = HERO_FIREWORKS_DEFAULTS;
const plan = (values: number[], total: number, o: { variant?: FireworksVariant; seed?: number; reduced?: boolean; knockout?: boolean } = {}) =>
  fireworksPlan({ total, distance: 1600, reduced: o.reduced, knockout: o.knockout, leadIn: leadInOf(values, o.reduced), variant: o.variant, seed: o.seed ?? 7 }, C);
const PALETTE = [0xffc94a, 0xff4fb0, 0x45dcff, 0x6dff7c, 0xb285ff];
const COLORS = { core: 0xfffbea, side: 0xffd66b, palette: PALETTE };
const LOOK = { bloomMs: 2100, rain: 200, rainMs: 1700, skyFlash: 0.32, flashAlpha: 0.95, smoke: 1, singe: 1, stars: 1, prefill: 0 };
// The real layout: you bottom left, the foe top right, on a 1920 x 1080 stage.
const YOU = { x: 176, y: 847 }, FOE = { x: 1773, y: 160 };
const R = 129;
const VIEW = { w: 1920, h: 1080 };
const T1 = plan([2, 1], 3), T2 = plan([3, 3, 2], 8), T2b = plan([3, 3, 3, 3, 2], 14), T3 = plan([6, 6, 6, 6, 6, 5, 5], 40);
const geo = (p: ReturnType<typeof plan>, a = YOU, d = FOE) => fireworksGeometry(p, a, d, R, R, C, 1, VIEW, 7);
const TIERS: [number[], number][] = [[[2, 1], 3], [[3, 3, 2], 8], [[6, 6, 6, 6, 6, 5, 5], 40]];
const inView = (p: { x: number; y: number }, pad = 0): boolean => p.x >= -pad && p.x <= VIEW.w + pad && p.y >= -pad && p.y <= VIEW.h + pad;

describe('the three looks (an Epic maps the shared four tiers onto three)', () => {
  it('reads the SHARED tier (thresholds 6 / 12 / 20) and maps 1 -> Tier 1, 2 and 3 -> Tier 2, 4 -> Tier 3', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    expect([1, 2, 3, 4].map((t) => fireworksLevel(t as 1 | 2 | 3 | 4))).toEqual([1, 2, 2, 3]);
    for (let d = 0; d <= 60; d++) {
      const p = plan([d], d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level).toBe(fireworksLevel(tierOf(d)));
    }
    expect([T1, T2, T2b, T3].map((p) => p.level)).toEqual([1, 2, 2, 3]);
    expect(Object.values(FIREWORKS_LEVEL_NAMES)).toEqual(['Tier 1', 'Tier 2', 'Tier 3']);
  });

  it('a knockout always plays Tier 3 (the barrage, the held beat and the enormous shell), whatever the number', () => {
    const ko = plan([2, 1], 3, { knockout: true });
    expect([ko.tier, ko.level]).toEqual([4, 3]);
    expect(ko.holdMs).toBe(C.holdMs);
    expect(ko.shells[ko.impactShell]!.kind).toBe('giant');
  });

  it('is dev-only: in the style list and the dev override, with no cosmetic that plays it', () => {
    expect(HERO_ATTACK_STYLES).toContain('fireworks');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('fireworks');
    expect(Object.keys(COSMETIC_INDEX).filter((id) => styleOfCosmetic(id) === 'fireworks')).toEqual([]);
  });
});

describe('the variant roll', () => {
  it('is deterministic from the seed, reaches all three, and the tuner override forces each one', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 90; s++) {
      expect(fireworksVariantOf(s, C)).toBe(fireworksVariantOf(s, C));
      seen.add(fireworksVariantOf(s, C));
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
    for (const v of ['1', '2', '3']) for (const s of [0, 5, 99]) expect(fireworksVariantOf(s, { ...C, variation: v })).toBe(Number(v));
    expect(clampHeroFireworksValue('variation', '2')).toBe('2');
    expect(clampHeroFireworksValue('variation', 7)).toBe('');
    expect(clampHeroFireworksValue('variation', 'x')).toBe('');
  });

  it('every tier plays its variant: the smiley, the pinwheel, the fake-out', () => {
    const kinds = (p: ReturnType<typeof plan>) => p.shells.map((s) => `${s.kind}/${s.flight}`);
    // Tier 1.
    expect(kinds(plan([2, 1], 3, { variant: 1 }))).toEqual(['smiley/rise']);
    expect(kinds(plan([2, 1], 3, { variant: 2 }))).toEqual(['spiral/pinwheel']);
    expect(kinds(plan([2, 1], 3, { variant: 3 }))).toEqual(['none/dud', 'peony/rise']);
    // Tier 2: a ring and a heart, then the variant's shell.
    expect(kinds(plan([8], 8, { variant: 1 }))).toEqual(['ring/rise', 'heart/rise', 'smiley/rise']);
    expect(kinds(plan([8], 8, { variant: 2 }))).toEqual(['ring/rise', 'heart/rise', 'spiral/rise']);
    expect(kinds(plan([8], 8, { variant: 3 }))).toEqual(['ring/rise', 'heart/rise', 'crackle/sputter']);
    // Tier 3: the whimsy rides the barrage.
    expect(kinds(plan([40], 40, { variant: 1 }))).toContain('smiley/rise');
    expect(kinds(plan([40], 40, { variant: 2 }))).toContain('spiral/pinwheel');
    expect(kinds(plan([40], 40, { variant: 3 }))[0]).toBe('none/dud');
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
    expect(clampHeroFireworksValue('waves', 99)).toBe(4);
    expect(clampHeroFireworksValue('holdMs', -5)).toBe(0);
    expect(clampHeroFireworksValue('holdMs', 'abc')).toBe(C.holdMs);
    expect(clampHeroFireworksValue('holdMs', '700')).toBe(700);
    expect(clampHeroFireworksValue('colorGold', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroFireworksValue('colorGold', 'gold')).toBe(C.colorGold);
    expect(clampHeroFireworksValue('sfxBoomClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroFireworksValue('nope' as keyof HeroFireworksConfig, 1)).toBeUndefined();
    const s = sanitizeHeroFireworksConfig({ rain: 4000, colorCore: 'x', bogus: 3 });
    expect(s.rain).toBe(360);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroFireworksConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control (the Variation row under the style); Copy JSON leaves the preview-only keys out', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const row = SPEC.controls.find((c) => c.key === 'variation')!;
    expect(row.options).toEqual(['', '1', '2', '3']);
    expect(SPEC.controls.findIndex((c) => c.key === 'variation')).toBe(1);
    const json = JSON.parse(heroFireworksConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.variation).toBeUndefined();
    expect(json.holdMs).toBe(C.holdMs);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('fireworks');
    expect(SPEC.buttonsOnTop).toBe(true);
  });

  it('the looks are named Tier 1, Tier 2, Tier 3 everywhere (no Small / Big / roman numerals / Huge), with the shared tiers in a hint', () => {
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Tier 1 (3)', '▶ Tier 2 (8)', '▶ Tier 3 (40)', '▶ Foe Tier 1 (3)', '▶ Foe Tier 3 (40)']) expect(labels).toContain(l);
    const groups = new Set(SPEC.controls.map((c) => c.group));
    for (const g of ['Tier 1', 'Tier 2', 'Tier 3']) expect(groups.has(g)).toBe(true);
    const text = [...SPEC.controls.flatMap((c) => [c.label, c.group ?? '', c.hint ?? '']), ...(SPEC.actions ?? []).flatMap((a) => [a.label, a.hint ?? ''])].join(' | ');
    expect(text).not.toMatch(/\b(Small|Big|Huge|Mortar|Rocket|Candle)\b|\bTier (I|II|III|IV)\b/);
    expect(SPEC.controls.find((c) => c.key === 'v3Shake')?.hint).toMatch(/shared tier 4/);
    expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
  });

  it('player-facing words and hints carry no em dashes or banned words', () => {
    const text = [SPEC.title, ...SPEC.controls.flatMap((c) => [c.label, c.hint ?? '']), ...(SPEC.actions ?? []).flatMap((a) => [a.label, a.hint ?? ''])].join(' ');
    expect(text).not.toMatch(/—|--|\bOath\b|\bclimb\b/i);
  });

  it('the sound: its clips are in the bank list for this style, and every one is cued by a default', () => {
    const own = [...(ATTACK_FX_CLIPS.fireworks ?? [])].sort();
    expect(own).toEqual([
      'fx/fireworks-aah', 'fx/fireworks-boom', 'fx/fireworks-crackle', 'fx/fireworks-dud', 'fx/fireworks-fuse', 'fx/fireworks-ignite', 'fx/fireworks-pinwheel',
      'fx/fireworks-pop', 'fx/fireworks-squeal', 'fx/fireworks-thump', 'fx/fireworks-volley', 'fx/fireworks-whistle', 'fx/soccer-crowd-ooh',
    ]);
    const used = new Set(HERO_FIREWORKS_CLIP_KEYS.map((k) => C[k]));
    for (const clip of own) expect(used.has(clip), clip).toBe(true);
    for (const k of HERO_FIREWORKS_CLIP_KEYS) expect(own, k).toContain(C[k]);
  });
});

describe('the plan (cue timing per tier and variant)', () => {
  it('the spark is lit first, the fuse burns `FuseMs`, and no shell leaves before it is done', () => {
    for (const [vals, total] of TIERS) {
      for (const v of FIREWORKS_VARIANTS) {
        const p = plan(vals, total, { variant: v });
        const first = Math.min(...p.shells.map((s) => s.launchAt));
        expect(first - p.chargeAt).toBeCloseTo(p.fuseMs, 0);
        const cues = fireworksCues(p);
        expect(cues[0]!.kind).toBe('ignite');
      }
    }
  });

  it('every tier and variant: ONE impact, the last burst; every burst after its launch; the ticks before the blow', () => {
    for (const [vals, total] of TIERS) {
      for (const v of FIREWORKS_VARIANTS) {
        const p = plan(vals, total, { variant: v });
        const cues = fireworksCues(p);
        expect(cues.filter((q) => q.kind === 'impact'), `${total}/${v}`).toHaveLength(1);
        expect(p.shells.filter((s) => s.role === 'impact')).toHaveLength(1);
        for (const s of p.shells) {
          expect(s.takeoffAt).toBeGreaterThanOrEqual(s.launchAt);
          expect(s.burstAt).toBeGreaterThan(s.takeoffAt);
          expect(s.burstAt, `${total}/${v} ${s.kind}`).toBeLessThanOrEqual(p.impactAt);
        }
        for (const h of p.hits) expect(h).toBeLessThan(p.impactAt);
        for (let i = 1; i < cues.length; i++) expect(cues[i]!.at).toBeGreaterThanOrEqual(cues[i - 1]!.at);
        expect(cues[cues.length - 1]!.kind).toBe('end');
      }
    }
  });

  it('Tier 1: the pinwheel spins `spinMs` on the rim first; the dud fizzles, a pause, then the real one', () => {
    const pw = plan([2, 1], 3, { variant: 2 });
    expect(pw.shells[0]!.takeoffAt - pw.shells[0]!.launchAt).toBe(C.spinMs);
    expect(fireworksCues(pw).some((q) => q.kind === 'takeoff')).toBe(true);
    const dud = plan([2, 1], 3, { variant: 3 });
    const [a, b] = dud.shells;
    expect(a!.role).toBe('fx');
    expect(a!.sputterAt).toBeGreaterThan(a!.launchAt);
    expect(b!.launchAt - a!.burstAt).toBeCloseTo(C.dudPauseMs, 5);
    expect(dud.impactShell).toBe(1);
  });

  it('Tier 2: the ring and the heart TICK a gap apart; the fake-out hangs `sputterMs` before it goes', () => {
    const p = plan([8], 8, { variant: 1 });
    expect(p.hits).toHaveLength(2);
    expect(p.shells[1]!.launchAt - p.shells[0]!.launchAt).toBe(C.volleyGapMs);
    const f = plan([8], 8, { variant: 3 });
    const last = f.shells[2]!;
    expect(last.flight).toBe('sputter');
    expect(last.burstAt - last.sputterAt).toBe(C.sputterMs);
  });

  it('Tier 3: wave after wave, a tick per wave, then the comet, THE HELD BEAT with no beat inside it, the enormous shell and the final flash', () => {
    const p = T3;
    const barrage = p.shells.filter((s) => s.wave >= 0);
    expect(new Set(barrage.map((s) => s.wave)).size).toBe(C.waves);
    expect(barrage.length).toBeGreaterThanOrEqual(C.waves * C.waveShells);
    expect(p.hits.length).toBe(C.waves);
    expect(p.shells.length).toBeLessThanOrEqual(FIREWORKS_CAPS.shells);
    expect(p.shells.some((s) => s.from === 'ground')).toBe(true);
    expect(p.shells.some((s) => s.from === 'hero')).toBe(true);
    const giant = p.shells[p.impactShell]!;
    expect(giant.kind).toBe('giant');
    expect(p.holdAt).toBe(giant.launchAt + C.riseMs);
    expect(p.impactAt - p.holdAt).toBe(C.holdMs);
    expect(Math.max(...barrage.map((s) => s.burstAt))).toBeLessThan(p.holdAt);
    const inside = fireworksCues(p).filter((q) => q.at > p.holdAt && q.at < p.impactAt);
    expect(inside).toEqual([]);
    expect(p.finalAt).toBe(p.impactAt + C.finalMs);
    expect(p.endAt).toBeGreaterThan(p.finalAt);
  });

  it('every look escalates: more shake, zoom, punch and dim; Tier 3 runs longest', () => {
    expect(T1.shakePx).toBeLessThan(T2.shakePx); expect(T2.shakePx).toBeLessThan(T3.shakePx);
    expect(T1.zoom).toBeLessThan(T3.zoom); expect(T1.punch).toBeLessThan(T3.punch);
    expect(T1.dim).toBeLessThan(T2.dim); expect(T2.dim).toBeLessThan(T3.dim);
    expect(T1.endAt - T1.chargeAt).toBeLessThan(T2.endAt - T2.chargeAt);
    expect(T3.endAt - T3.chargeAt).toBeGreaterThan(4000);
    expect(T3.endAt - T3.chargeAt).toBeLessThan(7000);
  });

  it('reduced motion: no shell, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([40], 40, { reduced: true });
    expect(p.shells).toEqual([]);
    expect([p.shakePx, p.zoom, p.dim]).toEqual([0, 0, 0]);
    expect(fireworksCues(p).filter((q) => q.kind === 'impact')).toHaveLength(1);
  });

  it('is deterministic (a replay plays the same show); another seed spreads a different barrage', () => {
    expect(plan([40], 40, { seed: 3 })).toEqual(plan([40], 40, { seed: 3 }));
    expect(plan([40], 40, { seed: 3 }).shells.map((s) => s.kind)).not.toEqual(plan([40], 40, { seed: 4 }).shells.map((s) => s.kind));
  });
});

describe('the geometry (both directions, on the real layout)', () => {
  it('the spark sits on the striker\'s rim, turned toward the target and up; the fuse crawls the rim into it', () => {
    for (const [a, d] of [[YOU, FOE], [FOE, YOU]] as const) {
      for (const p of [T1, T2, T3]) {
        const g = geo(p, a, d);
        expect(Math.hypot(g.ember.x - a.x, g.ember.y - a.y)).toBeLessThan(R * 1.2);
        expect(g.ember.y).toBeLessThan(a.y); // above the centre: shells climb out of it
        expect(inView(g.ember)).toBe(true);
        const end = { x: g.fuse.c.x + Math.cos(g.fuse.a1) * g.fuse.r, y: g.fuse.c.y + Math.sin(g.fuse.a1) * g.fuse.r };
        expect(Math.hypot(end.x - g.ember.x, end.y - g.ember.y)).toBeLessThan(30);
      }
    }
  });

  it('every burst opens inside the view; Tier 1 and 2 shells open by the struck portrait, on its side facing the middle', () => {
    for (const [a, d] of [[YOU, FOE], [FOE, YOU]] as const) {
      for (const [vals, total] of TIERS) {
        for (const v of FIREWORKS_VARIANTS) {
          const p = plan(vals, total, { variant: v });
          const g = geo(p, a, d);
          p.shells.forEach((s, i) => {
            const sg = g.shells[i]!;
            if (s.flight === 'comet') return;
            expect(inView(sg.at), `${total}/${v} ${s.kind}`).toBe(true);
            if (p.level < 3 && s.role !== 'fx') expect(Math.hypot(sg.at.x - d.x, sg.at.y - d.y), `${total}/${v} ${s.kind}`).toBeLessThan(R * (s.kind === 'heart' ? 2.2 : 1.6));
            // Every flight starts at the spark or below the bottom of the view and ends where the shell opens.
            const end = fireworksPathAt(sg.path, 1, { x: 0, y: 0 });
            expect(Math.hypot(end.x - sg.at.x, end.y - sg.at.y)).toBeLessThan(1);
            if (s.from === 'hero') expect(sg.path.from).toEqual(g.ember); else expect(sg.path.from.y).toBeGreaterThan(VIEW.h);
          });
        }
      }
    }
  });

  it('Tier 3: the comet leaves the TOP of the view; the enormous shell fills it, centred inside it', () => {
    for (const [a, d] of [[YOU, FOE], [FOE, YOU]] as const) {
      const g = geo(T3, a, d);
      const comet = g.shells[T3.impactShell]!;
      expect(comet.path.to.y).toBeLessThan(0);
      expect(g.bloom).not.toBeNull();
      expect(inView(g.bloom!)).toBe(true);
      expect(g.bloomR).toBeCloseTo(Math.min(VIEW.w, VIEW.h) * C.giantSize, 3);
    }
  });

  it('a small sandbox box (the Collection preview) keeps every burst inside it', () => {
    const box = { w: 400, h: 300 };
    for (const p of [T1, T2, T3]) {
      const g = fireworksGeometry(p, { x: 90, y: 220 }, { x: 310, y: 80 }, 40, 40, C, 0.3, box, 3);
      for (const [i, s] of g.shells.entries()) {
        if (p.shells[i]!.flight === 'comet') continue;
        expect(s.at.x).toBeGreaterThanOrEqual(0); expect(s.at.x).toBeLessThanOrEqual(box.w);
        expect(s.at.y).toBeGreaterThanOrEqual(0); expect(s.at.y).toBeLessThanOrEqual(box.h);
      }
    }
  });
});

describe('the camera', () => {
  it('pushes in, punches in on the impact and shakes; rests by the end, in every tier', () => {
    for (const p of [T1, T2, T3]) {
      let peak = 1, shook = 0;
      for (let t = p.chargeAt; t < p.endAt; t += 8) { const cm = fireworksCameraAt(p, C, t); peak = Math.max(peak, cm.zoom); shook = Math.max(shook, Math.hypot(cm.x, cm.y)); }
      expect(peak).toBeGreaterThan(1.01);
      expect(peak).toBeLessThan(1.25);
      expect(shook).toBeGreaterThan(2);
      const end = fireworksCameraAt(p, C, p.endAt);
      expect(end.zoom).toBeCloseTo(1, 2);
      expect(Math.hypot(end.x, end.y)).toBeLessThan(0.5);
    }
  });

  it('Tier 3: through THE HELD BEAT the camera is still (one zoom, no shake)', () => {
    const z0 = fireworksCameraAt(T3, C, T3.holdAt + 1).zoom;
    for (let t = T3.holdAt + 1; t < T3.impactAt; t += 4) {
      const cm = fireworksCameraAt(T3, C, t);
      expect(cm.zoom).toBeCloseTo(z0, 6);
      expect(Math.hypot(cm.x, cm.y), `t ${t - T3.holdAt}`).toBeLessThan(0.01);
    }
    expect(fireworksCameraFocus(T3, T3.chargeAt, YOU, FOE)).toEqual(YOU);
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

/** A rollSeed that rolls variant `v` (the runner rolls from it). */
const rollFor = (v: FireworksVariant): number => { for (let s = 0; ; s++) if (fireworksVariantOf(s, C) === v) return s; };

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('every tier, variant and direction: the blow lands EXACTLY ONCE on its beat, never on a tick; the caps hold; ends clean', () => {
    for (const total of [3, 8, 40]) {
      for (const v of FIREWORKS_VARIANTS) {
        for (const side of ['player', 'opp'] as const) {
          const [a, d] = side === 'player' ? [YOU, FOE] : [FOE, YOU];
          const r = run({ total, formation: formationOf([total], total), rollSeed: rollFor(v), side, attacker: a, defender: d });
          const { h, f, onImpact, onDone } = r;
          expect(h.variant).toBe(v);
          expect(h.plan.variant).toBe(v);
          f.tick(h.plan.impactAt - 10, 4);
          expect(onImpact, `${total}/${v}/${side} early`).not.toHaveBeenCalled();
          expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_FIREWORKS_SPRITES);
          f.tick(20, 4);
          expect(onImpact, `${total}/${v}/${side}`).toHaveBeenCalledTimes(1);
          f.tick(h.plan.endAt - h.elapsed() + 40, 8);
          expect(onDone).toHaveBeenCalledTimes(1);
          expect(h.scene!.peakParticles).toBeLessThanOrEqual(MAX_PARTICLES);
          f.tick(4000, 16);
          expect(onImpact).toHaveBeenCalledTimes(1);
          expectRestored(r);
        }
      }
    }
  });

  it('Tier 2: the ticks nudge the struck portrait but do NOT land the blow', () => {
    const r = run({ total: 8, formation: formationOf([8], 8), rollSeed: rollFor(1) });
    const { h, f, onImpact, defenderEl } = r;
    f.tick(h.plan.hits[0]! + 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(defenderEl.style.transform).not.toBe('');
    r.h.cancel();
  });

  it('Tier 3: through THE HELD BEAT both portraits are at rest while the clock runs on; then the enormous shell lands the blow ONCE', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, f, onImpact, attackerEl, defenderEl, camera } = r;
    f.tick(h.plan.holdAt + 40, 4);
    const cam0 = camera.style.transform;
    for (let t = h.plan.holdAt + 40; t < h.plan.impactAt - 8; t += 4) {
      f.tick(4, 4);
      expect(attackerEl.style.transform).toBe('');
      expect(defenderEl.style.transform).toBe('');
    }
    expect(camera.style.transform).toBe(cam0);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveParticles).toBeGreaterThan(300); // the sky is full
    r.h.cancel();
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

  it('a replay plays the same: the same variant, plan and geometry; another roll can change the variant', () => {
    const a = run({ total: 40, formation: formationOf([40], 40), rollSeed: 11 });
    const b = run({ total: 40, formation: formationOf([40], 40), rollSeed: 11 });
    expect(a.h.variant).toBe(b.h.variant);
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.geo).toEqual(b.h.geo);
    const vs = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8].map((s) => fireworksVariantOf(s, C)));
    expect(vs.size).toBeGreaterThan(1);
    a.h.cancel(); b.h.cancel();
    expect(fireworksSeed(40, 1600, 'player', 11)).toBe(fireworksSeed(40, 1600, 'player', 11));
  });

  it('finish() at any point lands the blow once and restores everything (mid fuse, mid barrage, in the held beat, after the blow)', () => {
    for (const total of [3, 8, 40]) {
      const at = (p: ReturnType<typeof plan>): number[] => [p.chargeAt + 30, (p.shells[0]!.launchAt + p.impactAt) / 2, p.holdMs ? p.holdAt + 200 : p.impactAt - 30, p.impactAt + 120];
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
  const G1 = geo(plan([2, 1], 3, { variant: 1 }));

  it('there is no launcher: nothing is ever drawn on the normal body layer', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const body = r.h.scene!.root.children.find((c) => c.label === 'heroFireworks-body') as Container;
    for (let t = 0; t < r.h.plan.endAt; t += 16) {
      r.f.tick(16, 16);
      expect(body.children.filter((c) => c.visible)).toEqual([]);
    }
    r.h.cancel();
  });

  it('the spark ignites and fizzes, a shell flies to its burst point, bursts into stars, and it all drains; destroy leaves nothing', () => {
    const s = new HeroFireworksScene(TEX, COLORS, LOOK, 1, 5);
    s.setView(VIEW.w, VIEW.h);
    s.ignite(G1.ember, G1.fuse, 300);
    s.update(100);
    expect(s.emberLit).toBe(true);
    expect(s.liveParticles).toBeGreaterThan(0); // the fuse spits sparks
    const sg = G1.shells[0]!;
    s.launch(0, { flight: 'rise', kind: 'smiley', path: sg.path, at: sg.at, R: sg.R, tint: 0, tint2: -1, flyMs: 400, spinMs: 0, fromHero: true });
    for (let i = 0; i < 20; i++) s.update(16);
    expect(s.liveFlights).toBe(1);
    s.burstShell(0);
    expect(s.liveFlights).toBe(0);
    const before = s.liveParticles;
    expect(before).toBeGreaterThan(40); // the face of stars
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    s.destroy();
    expect(s.root.children).toHaveLength(0);
  });

  it('THE SMILEY: its stars come to rest on a face (a ring, two eyes, a grin) round the burst point', () => {
    const s = new HeroFireworksScene(TEX, COLORS, LOOK, 1, 9);
    const at = { x: 900, y: 500 }, Rf = 200;
    s.launch(0, { flight: 'rise', kind: 'smiley', path: { from: at, ctrl: at, to: at }, at, R: Rf, tint: 0, tint2: -1, flyMs: 1, spinMs: 0, fromHero: false });
    s.update(4);
    s.burstShell(0);
    for (let i = 0; i < 40; i++) s.update(16); // 640 ms: they have arrived
    const stars = (s.root.children.find((c) => c.label === 'heroFireworks-core') as Container).children.filter((c) => c.visible && c.alpha > 0.2);
    const near = (x: number, y: number, r: number) => stars.filter((c) => Math.hypot(c.x - x, c.y - y) < r).length;
    expect(near(at.x - 0.34 * Rf, at.y - 0.28 * Rf + 20, 40)).toBeGreaterThan(2); // the left eye (drooping a little)
    expect(near(at.x, at.y + 0.58 * Rf + 20, 40)).toBeGreaterThan(1); // the bottom of the grin
    s.destroy();
  });

  it('THE DUD fizzles with a puff and throws no stars', () => {
    const s = new HeroFireworksScene(TEX, COLORS, LOOK, 1, 3);
    const from = { x: 300, y: 800 }, at = { x: 500, y: 400 };
    s.launch(0, { flight: 'dud', kind: 'none', path: { from, ctrl: { x: 320, y: 500 }, to: at }, at, R: 100, tint: 3, tint2: -1, flyMs: 600, spinMs: 0, fromHero: true });
    for (let i = 0; i < 30; i++) s.update(16);
    const before = s.peakParticles;
    s.burstShell(0);
    expect(s.liveFlights).toBe(0);
    expect(s.peakParticles - before).toBeLessThan(12); // a puff and a few sad sparks, not a burst
    s.destroy();
  });

  it('a whole Tier 3 stays in the caps and drains', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    let peak = 0;
    for (let t = 0; t < r.h.plan.endAt + 4000 && r.root.children.length; t += 16) {
      r.f.tick(16, 16);
      if (r.h.scene) peak = Math.max(peak, r.h.scene.liveSprites);
    }
    expect(peak).toBeLessThanOrEqual(MAX_FIREWORKS_SPRITES);
    expect(r.h.scene!.peakParticles).toBeLessThanOrEqual(MAX_PARTICLES);
    expectRestored(r);
  });
});
