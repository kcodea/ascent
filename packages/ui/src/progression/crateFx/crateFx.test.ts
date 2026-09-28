/**
 * THE CRATE OPENING (owner ask 2026-09-28): the tuner's defaults + clamping, the rarity -> preset mapping, the
 * beat timeline (ordering, escalation per rarity, slow motion, reduced motion), and the Pixi scene run headless
 * through a whole opening: particles spawn, drain, and nothing is left behind after `destroy()`.
 */
import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import {
  CRATE_FX_DEFAULTS, CRATE_FX_RANGES, CRATE_RARITIES, SPEC, clampCrateFxValue, crateBeats, crateCue, crateRarityOf,
  presetFor, sanitizeCrateFxConfig, type CrateFxConfig,
} from './crateFxConfig';
import { CrateScene, MAX_PARTICLES, crateSizeFor, lerpColor, type CrateSceneTextures } from './crateScene';

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range', () => {
    for (const [k, [min, max, step]] of Object.entries(CRATE_FX_RANGES)) {
      const v = CRATE_FX_DEFAULTS[k as keyof CrateFxConfig] as number;
      expect(typeof v, k).toBe('number');
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
  });

  it('every default has a tuner control, and every control writes a real key', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(CRATE_FX_DEFAULTS)) expect(keys.has(k as keyof CrateFxConfig), k).toBe(true);
    for (const k of keys) expect(k in CRATE_FX_DEFAULTS, k).toBe(true);
  });

  it('clamps numbers into range, NaN and junk fall back to the default, colours must be #rrggbb', () => {
    expect(clampCrateFxValue('legendaryChargeMs', 99999)).toBe(CRATE_FX_RANGES.legendaryChargeMs[1]);
    expect(clampCrateFxValue('legendaryChargeMs', -5)).toBe(0);
    expect(clampCrateFxValue('epicFlash', 2)).toBe(1);
    expect(clampCrateFxValue('anticipationMs', Number.NaN)).toBe(CRATE_FX_DEFAULTS.anticipationMs);
    expect(clampCrateFxValue('anticipationMs', 'abc')).toBe(CRATE_FX_DEFAULTS.anticipationMs);
    expect(clampCrateFxValue('anticipationMs', '900')).toBe(900);
    expect(clampCrateFxValue('rareColor', '#ABCDEF')).toBe('#abcdef');
    expect(clampCrateFxValue('rareColor', 'blue')).toBe(CRATE_FX_DEFAULTS.rareColor);
    expect(clampCrateFxValue('crateArt', '  /crates/crate.webp ')).toBe('/crates/crate.webp');
    expect(clampCrateFxValue('nope' as keyof CrateFxConfig, 3)).toBeUndefined();
  });

  it('a saved object is sanitised key by key over the defaults (unknown keys dropped)', () => {
    const c = sanitizeCrateFxConfig({ commonRays: 500, epicColor: 'nope', bogus: 1, sfxBurstClip: 'rebornshatter' });
    expect(c.commonRays).toBe(24);
    expect(c.epicColor).toBe(CRATE_FX_DEFAULTS.epicColor);
    expect('bogus' in c).toBe(false);
    expect(sanitizeCrateFxConfig('garbage')).toEqual(CRATE_FX_DEFAULTS);
  });
});

describe('rarity -> preset', () => {
  it('maps each rarity to its own dials and colour; an unknown rarity plays as Common', () => {
    expect(presetFor('legendary', CRATE_FX_DEFAULTS)).toMatchObject({
      rarity: 'legendary', color: 0xffbe5c, colorCss: '#ffbe5c', chargeMs: 1500, rays: 12, rings: 3, sting: true,
    });
    expect(presetFor('rare', CRATE_FX_DEFAULTS)).toMatchObject({ rarity: 'rare', color: 0x6fb0ff, rays: 0, sting: false });
    expect(presetFor('mythic', CRATE_FX_DEFAULTS).rarity).toBe('common');
    expect(presetFor(null, CRATE_FX_DEFAULTS).rarity).toBe('common');
    expect(crateRarityOf('epic')).toBe('epic');
  });

  it('the presentation escalates with rarity: longer charge, more particles, heavier flash', () => {
    const p = CRATE_RARITIES.map((r) => presetFor(r, CRATE_FX_DEFAULTS));
    for (let i = 1; i < p.length; i++) {
      expect(p[i]!.chargeMs).toBeGreaterThan(p[i - 1]!.chargeMs);
      expect(p[i]!.burstSparks).toBeGreaterThan(p[i - 1]!.burstSparks);
      expect(p[i]!.chargeParticles).toBeGreaterThan(p[i - 1]!.chargeParticles);
      expect(p[i]!.flash).toBeGreaterThan(p[i - 1]!.flash);
    }
    expect(p.filter((x) => x.sting).map((x) => x.rarity)).toEqual(['legendary']);
  });

  it('the preset reads the tuned config', () => {
    const c = { ...CRATE_FX_DEFAULTS, epicChargeMs: 1234, epicColor: '#112233' };
    expect(presetFor('epic', c)).toMatchObject({ chargeMs: 1234, color: 0x112233 });
  });
});

describe('the beats', () => {
  it('charge -> burst -> reveal (inside the burst) -> stamp -> settle -> end, in order', () => {
    for (const r of CRATE_RARITIES) {
      const b = crateBeats(presetFor(r, CRATE_FX_DEFAULTS), CRATE_FX_DEFAULTS);
      expect(b.chargeAt).toBe(0);
      expect(b.burstAt).toBeGreaterThanOrEqual(b.chargeAt);
      expect(b.revealAt).toBeGreaterThan(b.burstAt);
      expect(b.stampAt).toBeGreaterThanOrEqual(b.revealAt);
      expect(b.settleAt).toBeGreaterThan(b.stampAt);
      expect(b.endAt).toBeGreaterThanOrEqual(b.settleAt);
    }
  });

  it('the shipped timeline per rarity (ms from the branch)', () => {
    const at = (r: (typeof CRATE_RARITIES)[number]): number[] => {
      const b = crateBeats(presetFor(r, CRATE_FX_DEFAULTS), CRATE_FX_DEFAULTS);
      return [b.burstAt, b.revealAt, b.settleAt].map((v) => Math.round(v));
    };
    expect(at('common')).toEqual([300, 458, 1478]);
    expect(at('rare')).toEqual([550, 743, 1963]);
    expect(at('epic')).toEqual([950, 1195, 2615]);
    expect(at('legendary')).toEqual([1500, 1815, 3635]);
  });

  it('slow motion stretches every beat; reduced motion is a short fade with no sequence', () => {
    const p = presetFor('legendary', CRATE_FX_DEFAULTS);
    const full = crateBeats(p, CRATE_FX_DEFAULTS);
    const quarter = crateBeats(p, CRATE_FX_DEFAULTS, { speed: 0.25 });
    expect(quarter.settleAt).toBeCloseTo(full.settleAt * 4);
    expect(quarter.anticipationMs).toBeCloseTo(full.anticipationMs * 4);
    const reduced = crateBeats(p, CRATE_FX_DEFAULTS, { reduced: true });
    expect(reduced).toMatchObject({ anticipationMs: 0, burstAt: 0, revealAt: 0, settleAt: CRATE_FX_DEFAULTS.reducedFadeMs });
  });

  it('every cue maps to its own mixer fader and the tuned clip', () => {
    expect(crateCue(CRATE_FX_DEFAULTS, 'burst').clip).toBe('rebornshatter');
    expect(crateCue({ ...CRATE_FX_DEFAULTS, sfxRevealStartMs: 500 }, 'reveal').startMs).toBe(500);
  });
});

// ─── the scene, headless ──────────────────────────────────────────────────────────────────────────────────────

const TEX: CrateSceneTextures = { spark: Texture.WHITE, glow: Texture.WHITE, ring: Texture.WHITE, frag: Texture.WHITE, ray: Texture.WHITE };
const ant = { antMs: CRATE_FX_DEFAULTS.anticipationMs, antShake: CRATE_FX_DEFAULTS.anticipationShake, antGlow: CRATE_FX_DEFAULTS.anticipationGlow };

/** Every display object under `c`, depth-first. */
function all(c: Container): Container[] {
  return c.children.flatMap((k) => [k, ...all(k as Container)]);
}
function run(scene: CrateScene, ms: number, step = 16): void {
  for (let t = 0; t < ms; t += step) scene.update(step);
}

describe('the crate scene (headless Pixi)', () => {
  it('pure helpers: colour blend and the fitted crate size', () => {
    expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(lerpColor(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
    expect(crateSizeFor(980, 560)).toBeCloseTo(168);
    expect(crateSizeFor(100, 100)).toBe(70); // floor
    expect(crateSizeFor(980, 560, 2)).toBeCloseTo(336);
  });

  it('a whole Legendary opening spawns and drains its particles, goes idle, and destroy leaves nothing', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(980, 560);
    const p = presetFor('legendary', CRATE_FX_DEFAULTS);
    const b = crateBeats(p, CRATE_FX_DEFAULTS);

    expect(scene.hasWork()).toBe(false); // a sealed crate at rest: the ticker stays stopped
    scene.anticipate(ant);
    run(scene, ant.antMs);
    expect(scene.stats().particles).toBeGreaterThan(0); // motes
    scene.charge(p);
    run(scene, p.chargeMs);
    scene.burst(p);
    const burst = scene.stats();
    expect(burst.particles).toBeGreaterThanOrEqual(Math.min(MAX_PARTICLES, p.burstSparks + p.debris));
    expect(burst.rings).toBe(p.rings);
    expect(burst.particles).toBeLessThanOrEqual(MAX_PARTICLES);
    run(scene, b.revealAt - b.burstAt);
    scene.reveal(p);
    run(scene, b.settleAt - b.revealAt);
    scene.settle(CRATE_FX_DEFAULTS.settleMs);
    run(scene, CRATE_FX_DEFAULTS.settleMs + 4000);
    expect(scene.currentPhase).toBe('settled');
    expect(scene.hasWork()).toBe(false); // idle: the ticker stops
    const idle = scene.stats();
    expect([idle.particles, idle.rings, idle.flashes, idle.frontChildren]).toEqual([0, 0, 0, 0]);
    expect(idle.pooled).toBeGreaterThan(0);

    const everything = all(root);
    scene.destroy();
    expect(root.children.length).toBe(0);
    expect(everything.every((o) => o.destroyed)).toBe(true);
    expect(scene.update(16)).toBe(false); // inert after destroy
  });

  it('a skip mid-burst drops every in-flight effect at once', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(980, 560);
    const p = presetFor('epic', CRATE_FX_DEFAULTS);
    scene.anticipate(ant);
    scene.charge(p);
    run(scene, 300);
    scene.burst(p);
    run(scene, 50);
    expect(scene.stats().particles).toBeGreaterThan(0);
    scene.skipToSettled(p);
    expect(scene.stats()).toMatchObject({ particles: 0, rings: 0, flashes: 0, frontChildren: 0 });
    expect(scene.hasWork()).toBe(false);
    scene.destroy();
    expect(root.children.length).toBe(0);
  });

  it('a failure winds down to a sealed crate at rest; reset restores the lid', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(980, 560);
    scene.anticipate(ant);
    run(scene, 400);
    scene.windDown(CRATE_FX_DEFAULTS.windDownMs);
    run(scene, CRATE_FX_DEFAULTS.windDownMs + 2500);
    expect(scene.currentPhase).toBe('idle');
    expect(scene.hasWork()).toBe(false);
    scene.reset();
    expect(scene.stats().particles).toBe(0);
    scene.destroy();
  });

  it('the art drop-in swaps the drawn crate for one sprite, and back', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(980, 560);
    const before = all(root).length;
    scene.setCrateArt(Texture.WHITE);
    const sprites = all(root).filter((o) => o instanceof Sprite && o.texture === Texture.WHITE && o.blendMode !== 'add');
    expect(sprites.length).toBe(1);
    scene.setCrateArt(null);
    expect(all(root).length).toBe(before);
    scene.destroy();
  });
});
