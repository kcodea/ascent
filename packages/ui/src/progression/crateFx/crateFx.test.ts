/**
 * THE CRATE OPENING (owner ask 2026-09-28; redone the same day): the tuner's defaults + clamping, the rarity ->
 * preset mapping and its escalation, the beat timeline (ordering, the shipped numbers, slow motion, reduced
 * motion), and the Pixi scene run headless through a whole opening: the heartbeat pulses, the camera pushes in,
 * the bursts spawn, everything drains, and nothing is left behind after `destroy()`.
 */
import { describe, expect, it, vi } from 'vitest';
import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import {
  CRATE_FX_DEFAULTS, CRATE_FX_RANGES, CRATE_RARITIES, SPEC, clampCrateFxValue, crateBeats, crateCue, crateRarityOf,
  chestTierPresetFor, presetFor, sanitizeCrateFxConfig, type CrateFxConfig, type CratePreset, type CrateRarity,
} from './crateFxConfig';
import {
  CrateScene, DEFAULT_CHEST_TUNING, MAX_PARTICLES, crateSizeFor, hsvToRgb, lerpColor, tierFlashColor, type CrateSceneTextures,
} from './crateScene';
import { decodeImage, preloadChestArt, setChestArtLoaderForTests } from './chestArt';
import { CHEST_ART, CHEST_TIER_ART, artChestModel, loadChestImages, paintedChestModel, type ChestModel } from './chestModel';
import { NO_TIER_LAYER, type ChestTierPreset } from './chestTiers';
import { CHEST } from './crateTextures';
import { CHEST_ART_WAIT_MS, CrateFxPixi } from './crateFxPixi';

/** The shipped timeline, ms from the branch: [hitch, burst, second burst, reveal, settled (buttons)]. */
const TIMELINE: Record<CrateRarity, number[]> = {
  common: [380, 380, -1, 524, 1624],
  rare: [680, 680, -1, 854, 2154],
  epic: [940, 1100, -1, 1316, 2816],
  legendary: [1400, 1700, 1985, 1985, 3785],
  // Ancient (2026-10-02): a 650 ms time stop between the charge (1900) and the burst
  ancient: [1640, 1900, 2215, 2215, 4265], // 650 ms shorter: "Time stops" switched off (owner 2026-10-19)
};

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
    expect(clampCrateFxValue('legendaryPush', 5)).toBe(0.3);
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
    expect(c.commonRays).toBe(1);
    expect(c.epicColor).toBe(CRATE_FX_DEFAULTS.epicColor);
    expect('bogus' in c).toBe(false);
    expect(sanitizeCrateFxConfig('garbage')).toEqual(CRATE_FX_DEFAULTS);
  });
});

describe('rarity -> preset', () => {
  it('maps each rarity to its own dials and colour; an unknown rarity plays as Common', () => {
    expect(presetFor('legendary', CRATE_FX_DEFAULTS)).toMatchObject({
      rarity: 'legendary', color: 0xffb938, colorCss: '#ffb938', chargeMs: 1700, hitchMs: 300, rays: 1, rings: 3, coins: 40, doubleBurst: true, sting: true,
    });
    expect(presetFor('rare', CRATE_FX_DEFAULTS)).toMatchObject({ rarity: 'rare', color: 0x5aa8ff, hitchMs: 0, coins: 0, doubleBurst: false, sting: false });
    expect(presetFor('mythic', CRATE_FX_DEFAULTS).rarity).toBe('common');
    expect(presetFor(null, CRATE_FX_DEFAULTS).rarity).toBe('common');
    expect(crateRarityOf('epic')).toBe('epic');
  });

  it('the presentation escalates with rarity: longer charge, more particles, heavier flash and shake, deeper pitch', () => {
    const p = CRATE_RARITIES.map((r) => presetFor(r, CRATE_FX_DEFAULTS));
    for (let i = 1; i < p.length; i++) {
      expect(p[i]!.chargeMs).toBeGreaterThan(p[i - 1]!.chargeMs);
      expect(p[i]!.burstSparks).toBeGreaterThan(p[i - 1]!.burstSparks);
      expect(p[i]!.chargeParticles).toBeGreaterThan(p[i - 1]!.chargeParticles);
      expect(p[i]!.flash).toBeGreaterThanOrEqual(p[i - 1]!.flash); // capped at 1: Legendary and Ancient both flash full
      expect(p[i]!.screenShake).toBeGreaterThan(p[i - 1]!.screenShake);
      expect(p[i]!.push).toBeGreaterThan(p[i - 1]!.push);
      expect(p[i]!.pitch).toBeLessThan(p[i - 1]!.pitch); // bigger = lower
    }
    expect(p.filter((x) => x.sting).map((x) => x.rarity)).toEqual(['legendary', 'ancient']);
    expect(p.filter((x) => x.doubleBurst).map((x) => x.rarity)).toEqual(['legendary', 'ancient']);
    expect(p.filter((x) => x.coins > 0).map((x) => x.rarity)).toEqual(['legendary']); // the gold shower stays Legendary's
    expect(p.filter((x) => x.hitchMs > 0).map((x) => x.rarity)).toEqual(['epic', 'legendary', 'ancient']);
    // Ancient's "Time stops" (owner pick 2026-10-02) is SWITCHED OFF (owner 2026-10-19: "the only part i dont like is how
    // everything stops and turns grey for a moment"): no rarity freezes or plays a signature by default.
    expect(p.filter((x) => x.freezeMs > 0)).toEqual([]);
    expect(p.filter((x) => x.signature !== 'none')).toEqual([]);
    expect(presetFor('ancient', CRATE_FX_DEFAULTS)).toMatchObject({ color: 0x8af5ff, colorCss: '#8af5ff', freezeMs: 0, signature: 'none' });
  });

  it('the preset reads the tuned config', () => {
    const c = { ...CRATE_FX_DEFAULTS, epicChargeMs: 1234, epicColor: '#112233' };
    expect(presetFor('epic', c)).toMatchObject({ chargeMs: 1234, color: 0x112233 });
  });
});

describe('the beats', () => {
  it('charge -> hitch -> burst (-> second burst) -> reveal -> gem -> stamp -> ribbon -> settle -> end, in order', () => {
    for (const r of CRATE_RARITIES) {
      const b = crateBeats(presetFor(r, CRATE_FX_DEFAULTS), CRATE_FX_DEFAULTS);
      expect(b.chargeAt).toBe(0);
      expect(b.hitchAt).toBeGreaterThanOrEqual(b.chargeAt);
      expect(b.hitchAt).toBeLessThanOrEqual(b.burstAt);
      // time stops only on a freezing signature, and the burst waits it out
      if (b.freezeAt >= 0) { expect(b.freezeAt).toBeGreaterThanOrEqual(b.hitchAt); expect(b.burstAt).toBeGreaterThan(b.freezeAt); }
      if (b.burst2At >= 0) { expect(b.burst2At).toBeGreaterThan(b.burstAt); expect(b.revealAt).toBeGreaterThanOrEqual(b.burst2At); }
      expect(b.revealAt).toBeGreaterThan(b.burstAt);
      expect(b.gemAt).toBeGreaterThanOrEqual(b.revealAt);
      expect(b.stampAt).toBeGreaterThanOrEqual(b.gemAt);
      expect(b.ribbonAt).toBeGreaterThan(b.stampAt);
      expect(b.settleAt).toBeGreaterThan(b.ribbonAt);
      expect(b.endAt).toBeGreaterThanOrEqual(b.settleAt);
    }
  });

  it('the shipped timeline per rarity (ms from the branch)', () => {
    for (const r of CRATE_RARITIES) {
      const b = crateBeats(presetFor(r, CRATE_FX_DEFAULTS), CRATE_FX_DEFAULTS);
      expect([b.hitchAt, b.burstAt, b.burst2At, b.revealAt, b.settleAt].map((v) => Math.round(v)), r).toEqual(TIMELINE[r]);
    }
  });

  it('slow motion stretches every beat; reduced motion is a short fade with no sequence', () => {
    const p = presetFor('legendary', CRATE_FX_DEFAULTS);
    const full = crateBeats(p, CRATE_FX_DEFAULTS);
    const quarter = crateBeats(p, CRATE_FX_DEFAULTS, { speed: 0.25 });
    expect(quarter.settleAt).toBeCloseTo(full.settleAt * 4);
    expect(quarter.burst2At).toBeCloseTo(full.burst2At * 4);
    expect(quarter.anticipationMs).toBeCloseTo(full.anticipationMs * 4);
    const reduced = crateBeats(p, CRATE_FX_DEFAULTS, { reduced: true });
    expect(reduced).toMatchObject({ anticipationMs: 0, burstAt: 0, burst2At: -1, revealAt: 0, settleAt: CRATE_FX_DEFAULTS.reducedFadeMs });
  });

  it('every cue maps to the tuned clip', () => {
    expect(crateCue(CRATE_FX_DEFAULTS, 'burst').clip).toBe('rebornshatter');
    expect(crateCue(CRATE_FX_DEFAULTS, 'whoosh').clip).toBe('ceremony/woosh1');
    expect(crateCue({ ...CRATE_FX_DEFAULTS, sfxRevealStartMs: 500 }, 'reveal').startMs).toBe(500);
  });
});

// ─── the scene, headless ──────────────────────────────────────────────────────────────────────────────────────

const W = Texture.WHITE;
/** A blank texture of a given size (headless: no pixels, only the size the model reads). */
const sized = (width: number, height: number): Texture => new Texture({ source: new TextureSource({ width, height }) });
/** The owner's art at its shipped size (840x457 body, 819x238 lid). */
const ART_CHEST: ChestModel = artChestModel(sized(840, 457), sized(819, 238), sized(41, 74));
const PAINTED_CHEST: ChestModel = paintedChestModel(sized(749, 403), sized(821, 274), 720, 14.4, CHEST);
const texFor = (chest: ChestModel): CrateSceneTextures => ({
  chest, seamBar: W, pedestal: W, runeRing: W, rays: W, glow: W, spark: W, streak: W, ring: W, coin: W, shards: [W, W],
  wisp: W, band: W, aura: W,
});
const TEX = texFor(ART_CHEST);
const ant = {
  antMs: CRATE_FX_DEFAULTS.anticipationMs, antShake: CRATE_FX_DEFAULTS.anticipationShake,
  antGlow: CRATE_FX_DEFAULTS.anticipationGlow, pulseMs: CRATE_FX_DEFAULTS.pulseStartMs,
};

/** Every display object under `c`, depth-first. */
function all(c: Container): Container[] {
  return c.children.flatMap((k) => [k, ...all(k as Container)]);
}
function run(scene: CrateScene, ms: number, step = 16): void {
  for (let t = 0; t < ms; t += step) scene.update(step);
}

describe('the crate scene (headless Pixi)', () => {
  it('pure helpers: colour blend and the fitted chest size', () => {
    expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(lerpColor(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
    expect(crateSizeFor(980, 560)).toBeCloseTo(190.4);
    expect(crateSizeFor(100, 100)).toBe(120); // floor
    expect(crateSizeFor(1920, 1080)).toBeCloseTo(367.2);
    expect(crateSizeFor(980, 560, 2)).toBeCloseTo(380.8);
  });

  it('a whole Legendary opening pulses, pushes in, bursts twice, drains, goes idle, and destroy leaves nothing', () => {
    const root = new Container();
    const pulses: number[] = [];
    const scene = new CrateScene(root, TEX, { onPulse: (k) => pulses.push(k) });
    scene.layout(1920, 1080);
    const p = presetFor('legendary', CRATE_FX_DEFAULTS);
    const b = crateBeats(p, CRATE_FX_DEFAULTS);

    expect(scene.hasWork()).toBe(false); // a sealed chest at rest: the ticker stays stopped
    scene.anticipate(ant);
    run(scene, ant.antMs);
    expect(scene.stats().particles).toBeGreaterThan(0); // motes
    expect(pulses.length).toBeGreaterThan(0); // the heartbeat
    const before = pulses.length;
    scene.charge(p);
    run(scene, p.chargeMs - p.hitchMs);
    expect(pulses.length - before).toBeGreaterThan(3); // the pulses accelerate through the charge
    expect(scene.cameraZoom).toBeGreaterThan(1 + p.push * 0.5); // the camera pushed in
    run(scene, p.hitchMs);
    scene.burst(p);
    const burst = scene.stats();
    expect(burst.particles).toBeGreaterThan(p.burstSparks);
    expect(burst.particles).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(burst.rings).toBeGreaterThanOrEqual(p.rings);
    run(scene, 80);
    expect(scene.cameraZoom).toBeLessThan(1 + p.push * 0.5); // snapped back
    run(scene, b.burst2At - b.burstAt);
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

  it('a skip mid-burst drops every in-flight effect at once and goes idle', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
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

  it('the chest comes to rest shortly after the burst: the charge ground shake does not outlive it (R-PROG-CRATE-05)', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    const p = presetFor('epic', CRATE_FX_DEFAULTS);
    scene.anticipate(ant);
    scene.charge(p);
    run(scene, p.chargeMs);
    expect(scene.cameraShake).toBeGreaterThan(p.screenShake * 0.15); // the charge rumbles the view
    scene.burst(p);
    expect(scene.cameraShake).toBeGreaterThanOrEqual(p.screenShake); // the hit
    run(scene, 600);
    expect(scene.cameraShake).toBeLessThan(0.5); // sub-pixel: at rest well before the plate settles
    scene.reveal(p);
    run(scene, 400);
    expect(scene.cameraShake).toBe(0);
    scene.destroy();
  });

  it('the switched-off "Time stops" still works when restored: the end of the charge holds frozen for freezeMs, then the burst picks it up', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    // Off by default since 2026-10-19 (owner); the machinery stays so the moment can come back with one line.
    const p = { ...presetFor('ancient', CRATE_FX_DEFAULTS), signature: 'timestop' as const, freezeMs: 650 };
    scene.anticipate(ant);
    scene.charge(p);
    run(scene, p.chargeMs + 60); // into the freeze
    expect(scene.currentPhase).toBe('charge');
    const held = scene.lidState;
    const particles = scene.stats().particles;
    run(scene, Math.min(300, p.freezeMs - 120));
    expect(scene.lidState).toEqual(held); // nothing moves while time is stopped
    expect(scene.stats().particles).toBe(particles);
    scene.burst(p);
    run(scene, 50);
    expect(scene.currentPhase).toBe('burst');
    expect(scene.stats().particles).toBeGreaterThan(particles);
    scene.destroy();
    expect(root.children.length).toBe(0);
  });

  it('a failure winds down to a sealed chest at rest; reset restores it', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    scene.anticipate(ant);
    run(scene, 400);
    scene.windDown(CRATE_FX_DEFAULTS.windDownMs);
    run(scene, CRATE_FX_DEFAULTS.windDownMs + 3000);
    expect(scene.currentPhase).toBe('idle');
    expect(scene.hasWork()).toBe(false);
    scene.reset();
    expect(scene.stats().particles).toBe(0);
    scene.destroy();
  });

  it('the one-picture override swaps the two-layer chest for one sprite, and back', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    const before = all(root).length;
    const visible = (): number => all(root).filter((o) => o.visible).length;
    const shown = visible();
    const art = new Texture({ source: W.source });
    scene.setCrateArt(art);
    expect(all(root).filter((o) => o instanceof Sprite && o.texture === art).length).toBe(1);
    expect(all(root).length).toBe(before + 1);
    // body, body flash, lid, seam, seam halo, keyhole mask, keyhole glow, open glow hidden
    expect(visible()).toBe(shown + 1 - 8);
    scene.setCrateArt(null);
    expect(all(root).length).toBe(before);
    expect(visible()).toBe(shown);
    scene.destroy();
  });
});

// ─── the tier layer (tiered chest openings, 2026-10-19) ───────────────────────────────────────────────────────

/** A seeded stand-in for Math.random (mulberry32), so a scene run is exactly repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Every drawn property of every display object under `root`, folded into one number (a cheap "pixel" pin). */
function fingerprint(root: Container): number {
  let h = 0;
  const mix = (v: number): void => { h = (Math.imul(h ^ Math.round(v * 1000), 0x01000193) >>> 0); };
  for (const o of all(root)) {
    mix(o.visible ? 1 : 0); mix(o.alpha); mix(o.position.x); mix(o.position.y); mix(o.scale.x); mix(o.scale.y); mix(o.rotation);
    if (o instanceof Sprite) { mix(o.tint); mix(o.blendMode === 'add' ? 1 : 0); }
  }
  return h;
}
/** A Standard opening at a common reward: anticipate -> charge -> burst, sampled at three checkpoints. */
function standardRun(prep?: (scene: CrateScene) => void): Array<[number, number, number]> {
  const rnd = vi.spyOn(Math, 'random').mockImplementation(seeded(7));
  try {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    prep?.(scene);
    const p = presetFor('common', CRATE_FX_DEFAULTS);
    const out: Array<[number, number, number]> = [];
    const sample = (): void => { out.push([all(root).length, scene.stats().particles, fingerprint(root)]); };
    scene.anticipate(ant);
    run(scene, ant.antMs);
    sample();
    scene.charge(p);
    run(scene, p.chargeMs);
    sample();
    scene.burst(p);
    run(scene, 200);
    sample();
    scene.destroy();
    return out;
  } finally {
    rnd.mockRestore();
  }
}

/**
 * A Standard opening at a common reward, as the code drew it BEFORE the tier layer existed (snapshotted at c892e3ab9
 * with the seeded Math.random above): [display objects, live particles, fingerprint] after the anticipation, the
 * charge and 200 ms into the burst. "Standard stays exactly today's opening" (owner constraint, 2026-10-19).
 */
const STANDARD_PIN: Array<[number, number, number]> = [[28, 4, 1416769314], [43, 18, 2252898167], [99, 72, 2843199676]];

/** Run a whole tiered opening (tier layer, then the reward's beats), calling `each` after every frame. */
function tieredRun(tier: ChestTierPreset, reward: CratePreset, each: (scene: CrateScene, root: Container) => void): void {
  const root = new Container();
  const scene = new CrateScene(root, TEX);
  scene.layout(1920, 1080);
  scene.setTierLayer(tier);
  const b = crateBeats(reward, CRATE_FX_DEFAULTS);
  const step = (ms: number): void => { for (let t = 0; t < ms; t += 16) { scene.update(16); each(scene, root); } };
  scene.anticipate(ant);
  step(ant.antMs);
  scene.charge(reward);
  step(b.burstAt);
  scene.burst(reward);
  each(scene, root);
  step(b.revealAt - b.burstAt);
  scene.reveal(reward);
  step(b.settleAt - b.revealAt);
  scene.settle(CRATE_FX_DEFAULTS.settleMs);
  step(CRATE_FX_DEFAULTS.settleMs + 3000);
  scene.destroy();
}

describe('the chest tier layer', () => {
  it('standard adds nothing: a Standard opening draws exactly what it drew before tiers existed', () => {
    expect(standardRun()).toEqual(STANDARD_PIN);
    expect(standardRun((s) => s.setTierLayer(NO_TIER_LAYER))).toEqual(STANDARD_PIN);
    expect(chestTierPresetFor('standard', CRATE_FX_DEFAULTS)).toBe(NO_TIER_LAYER);
  });

  it('the tier layer composes with the reward finale: a Rare chest rolling a Legendary gets both', () => {
    // Seeded: a Legendary reward alone peaks at the particle cap, so on some draws the last coins of the shower find the
    // pool full (with or without a chest tier: by then every tier particle has already given way). That made this test
    // fail about 1 run in 14 before the final review; the invariant below is what the cap promises.
    const rnd = vi.spyOn(Math, 'random').mockImplementation(seeded(8));
    try {
      const root = new Container();
      const scene = new CrateScene(root, TEX);
      scene.layout(1920, 1080);
      const rare = chestTierPresetFor('rare', CRATE_FX_DEFAULTS);
      scene.setTierLayer(rare);
      const p = presetFor('legendary', CRATE_FX_DEFAULTS);
      const b = crateBeats(p, CRATE_FX_DEFAULTS);
      scene.anticipate(ant);
      run(scene, ant.antMs);
      expect(scene.stats().tier).toBeGreaterThan(0); // the tier's motes drift up from the click
      scene.charge(p);
      run(scene, b.burstAt);
      scene.burst(p);
      expect(scene.stats().sparkles).toBe(rare.burstSparkles); // the tier's sparkles, on top of the reward's
      expect(scene.stats().particles).toBeGreaterThan(p.burstSparks + rare.burstSparkles);
      run(scene, b.burst2At - b.burstAt + 32);
      // the reward's double burst still fires, with its coin shower; a coin is only ever short once the chest's own
      // particles have ALL given way to the reward (the tier never costs the reward a coin)
      const after = scene.stats();
      expect(after.coins).toBeGreaterThan(p.coins * 0.85);
      if (after.coins < p.coins) expect(after.tier).toBe(0);
      scene.destroy();
      expect(root.children.length).toBe(0);
    } finally { rnd.mockRestore(); }
  });

  it('the particle cap holds at an Ancient chest rolling an Ancient reward', () => {
    const ancient = chestTierPresetFor('ancient', CRATE_FX_DEFAULTS);
    let peak = 0;
    let peakFront = 0;
    tieredRun(ancient, presetFor('ancient', CRATE_FX_DEFAULTS), (scene) => {
      const s = scene.stats();
      peak = Math.max(peak, s.particles);
      peakFront = Math.max(peakFront, s.frontChildren);
    });
    expect(peak).toBeGreaterThan(100); // it is a big opening
    expect(peak).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(peakFront).toBeLessThanOrEqual(MAX_PARTICLES + 24);
  });

  it('bands only from Legendary up: an Epic chest swirls none through the charge, a Legendary two', () => {
    const bandsFor = (tier: 'epic' | 'legendary'): number => {
      let most = 0;
      tieredRun(chestTierPresetFor(tier, CRATE_FX_DEFAULTS), presetFor('rare', CRATE_FX_DEFAULTS), (scene) => {
        most = Math.max(most, scene.stats().bands);
      });
      return most;
    };
    expect(bandsFor('epic')).toBe(0);
    expect(bandsFor('legendary')).toBe(2);
  });

  it('every tier escalates the layer: more live tier particles at the burst, Rare -> Ancient', () => {
    const at = (tier: 'rare' | 'epic' | 'legendary' | 'ancient'): number => {
      const rnd = vi.spyOn(Math, 'random').mockImplementation(seeded(3));
      try {
        let most = 0;
        tieredRun(chestTierPresetFor(tier, CRATE_FX_DEFAULTS), presetFor('common', CRATE_FX_DEFAULTS), (scene) => {
          most = Math.max(most, scene.stats().tier);
        });
        return most;
      } finally { rnd.mockRestore(); }
    };
    const counts = (['rare', 'epic', 'legendary', 'ancient'] as const).map(at);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!, String(counts)).toBeGreaterThan(counts[i - 1]!);
  });

  it('multichrome (Ancient): the tier particles cycle hue; an Ancient reward from ANY chest cycles too', () => {
    const tintsOf = (tier: ChestTierPreset, reward: CratePreset): Set<number> => {
      const seen = new Set<number>();
      tieredRun(tier, reward, (_scene, root) => {
        for (const o of all(root)) if (o instanceof Sprite && o.visible && o.alpha > 0 && o.blendMode === 'add') seen.add(o.tint);
      });
      return seen;
    };
    // a Rare chest is one blue; an Ancient chest paints a whole spectrum
    const rare = tintsOf(chestTierPresetFor('rare', CRATE_FX_DEFAULTS), presetFor('rare', CRATE_FX_DEFAULTS));
    const ancient = tintsOf(chestTierPresetFor('ancient', CRATE_FX_DEFAULTS), presetFor('rare', CRATE_FX_DEFAULTS));
    expect(ancient.size).toBeGreaterThan(rare.size + 40);
    // an Ancient reward out of a Standard chest still reads opal
    const plain = tintsOf(NO_TIER_LAYER, presetFor('legendary', CRATE_FX_DEFAULTS));
    const opal = tintsOf(NO_TIER_LAYER, presetFor('ancient', CRATE_FX_DEFAULTS));
    expect(opal.size).toBeGreaterThan(plain.size + 40);
  });

  it('hsvToRgb: the pure colour wheel the multichrome cycles round', () => {
    expect(hsvToRgb(0, 1, 1)).toBe(0xff0000);
    expect(hsvToRgb(1 / 3, 1, 1)).toBe(0x00ff00);
    expect(hsvToRgb(2 / 3, 1, 1)).toBe(0x0000ff);
    expect(hsvToRgb(0.5, 0, 1)).toBe(0xffffff);
    expect(hsvToRgb(0.25, 1, 0)).toBe(0x000000);
    expect(hsvToRgb(1, 1, 1)).toBe(0xff0000); // wraps
    expect(hsvToRgb(-1 / 3, 1, 1)).toBe(0x0000ff);
    expect(hsvToRgb(Number.NaN, 1, 1)).toBe(0xff0000);
    expect(hsvToRgb(2.5, 2, 2)).toBe(0x00ffff); // clamped
  });

  it('the chest swaps per tier; Epic and Ancient draw the lock spike over the lid until it launches', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    const count = all(root).length;
    const epic = artChestModel(sized(840, 402), sized(816, 238), null, CHEST_TIER_ART.epic);
    expect(epic.spikeFront).not.toBeNull();
    expect(artChestModel(sized(840, 410), sized(823, 236), null, CHEST_TIER_ART.rare).spikeFront).toBeNull();
    scene.setChestModel(epic);
    const crate = (all(root).find((o) => o instanceof Sprite && o.texture === epic.lid) as Sprite).parent!;
    const lidAt = crate.children.findIndex((o) => o instanceof Sprite && o.texture === epic.lid);
    const spike = crate.children.find((o, i) => i > lidAt && o instanceof Sprite && o.texture.source === epic.body.source) as Sprite;
    expect(spike).toBeDefined(); // a piece of the BODY, drawn above the lid
    expect(spike.visible).toBe(true);
    expect(spike.texture.frame.width).toBeLessThan(epic.body.width * 0.2);
    expect(all(root).length).toBe(count + 1);
    const p = presetFor('rare', CRATE_FX_DEFAULTS);
    scene.anticipate(ant);
    scene.charge(p);
    run(scene, p.chargeMs);
    scene.burst(p);
    expect(spike.visible).toBe(false); // the lid is gone: the body shows its own spike
    scene.reset();
    expect(spike.visible).toBe(true);
    scene.setChestModel(ART_CHEST); // back to Standard: no spike front
    expect(spike.visible).toBe(false);
    expect(all(root).some((o) => o instanceof Sprite && o.texture === ART_CHEST.body)).toBe(true);
    expect(scene.chestKind).toBe('art');
    scene.destroy();
    expect(root.children.length).toBe(0);
  });
});

describe('setChest: the tier art loads, or the opening plays on Standard', () => {
  const headless = (loadImage: (url: string) => Promise<HTMLImageElement>): { fx: CrateFxPixi; scene: CrateScene } => {
    const fx = new CrateFxPixi({ loadImage });
    const scene = new CrateScene(new Container(), TEX);
    scene.layout(1920, 1080);
    fx.attachSceneForTests(scene, ART_CHEST);
    return { fx, scene };
  };

  it('a loader that fails resolves Standard at once, and the Standard chest stays drawn', async () => {
    const { fx, scene } = headless(() => Promise.reject(new Error('404')));
    const t0 = performance.now();
    expect(await fx.setChest('epic')).toBe('standard');
    expect(performance.now() - t0).toBeLessThan(CHEST_ART_WAIT_MS);
    expect(scene.chestKind).toBe('art');
    fx.destroy();
  });

  it('a loader that never answers resolves Standard after CHEST_ART_WAIT_MS', async () => {
    vi.useFakeTimers();
    try {
      const { fx } = headless(() => new Promise<HTMLImageElement>(() => {}));
      let got: string | null = null;
      void fx.setChest('legendary').then((t) => { got = t; });
      await vi.advanceTimersByTimeAsync(CHEST_ART_WAIT_MS - 1);
      expect(got).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(got).toBe('standard');
      fx.destroy();
    } finally { vi.useRealTimers(); }
  });

  it('a loaded tier swaps the chest (cached for the next opening); Standard swaps back with no load', async () => {
    const urls: string[] = [];
    const img = (w: number, h: number): HTMLImageElement => ({ width: w, height: h, naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement;
    const { fx, scene } = headless(async (url) => { urls.push(url); return url.includes('lid') ? img(816, 238) : img(840, 402); });
    expect(await fx.setChest('epic')).toBe('epic');
    const lid = all(scene.root).find((o) => o instanceof Sprite && o.texture.width === 816);
    expect(lid).toBeDefined();
    expect(urls.filter((u) => u.includes('chest_epic'))).toHaveLength(2);
    expect(await fx.setChest('standard')).toBe('standard');
    expect(all(scene.root).some((o) => o instanceof Sprite && o.texture === ART_CHEST.lid)).toBe(true);
    expect(await fx.setChest('epic')).toBe('epic');
    expect(urls).toHaveLength(2); // cached
    fx.destroy();
  });

  it('safe before mount and after destroy: no throw, Standard', async () => {
    const early = new CrateFxPixi({ loadImage: () => Promise.reject(new Error('never called')) });
    expect(await early.setChest('ancient')).toBe('standard');
    early.setTierLayer(chestTierPresetFor('ancient', CRATE_FX_DEFAULTS));
    early.destroy();
    expect(await early.setChest('rare')).toBe('standard');
    const { fx } = headless(() => Promise.reject(new Error('x')));
    fx.destroy();
    expect(await fx.setChest('rare')).toBe('standard');
  });
});

describe('the two-layer chest (owner art, 2026-09-28)', () => {
  it('the art model: the lid notch sits on the lock spike, on the rim; one scale for both layers', () => {
    const m = ART_CHEST;
    const k = 840 / CHEST_ART.bodySrcW;
    expect(m.kind).toBe('art');
    expect(m.cx).toBeCloseTo(CHEST_ART.spikeX * k);
    expect(m.lidAtX).toBeCloseTo(m.cx); // centred on the spike
    expect(m.lidAtY).toBeCloseTo((CHEST_ART.rimY + CHEST_ART.lidOverlap) * k); // on the rim, a touch over it
    expect(m.lidRel).toBeCloseTo(1, 2); // both layers were scaled by the same factor
    expect(m.lidAttachX).toBeCloseTo(CHEST_ART.lidAttachX * (819 / CHEST_ART.lidSrcW));
    expect(m.width).toBeCloseTo((CHEST_ART.bodyX1 - CHEST_ART.bodyX0) * k);
    // the keyhole sits on the lock plate, below the rim, on the chest's centre line
    expect(m.keyholeY).toBeGreaterThan(m.rimY);
    expect(Math.abs(m.keyholeX - m.cx)).toBeLessThan(m.width * 0.02);
  });

  it('the art loads as two layers; if EITHER fails the painted chest stands in whole', async () => {
    const ok = await loadChestImages('/', async (url) => url);
    expect(ok).toEqual({ body: `/${CHEST_ART.bodyUrl}`, lid: `/${CHEST_ART.lidUrl}` });
    const lidFails = await loadChestImages('/', async (url) => { if (url.endsWith('crate_lid.webp')) throw new Error('404'); return url; });
    expect(lidFails).toBeNull();
    const bodyFails = await loadChestImages('/', (url) => (url.includes('crate_body') ? Promise.reject(new Error('decode')) : Promise.resolve(url)));
    expect(bodyFails).toBeNull();
  });

  it('the scene draws whichever chest it is given (the art, or the painted fallback)', () => {
    for (const chest of [ART_CHEST, PAINTED_CHEST]) {
      const root = new Container();
      const scene = new CrateScene(root, texFor(chest));
      scene.layout(1920, 1080);
      expect(scene.chestKind).toBe(chest.kind);
      expect(all(root).some((o) => o instanceof Sprite && o.texture === chest.body)).toBe(true);
      expect(all(root).some((o) => o instanceof Sprite && o.texture === chest.lid)).toBe(true);
      scene.destroy();
    }
  });

  it('the lid jumps on the heartbeat and settles back onto the rim', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    scene.anticipate(ant);
    let lowest = 0;
    for (let t = 0; t < 1200; t += 16) { scene.update(16); lowest = Math.min(lowest, scene.lidState.dy); }
    expect(lowest).toBeLessThan(-1); // it rose a pixel or more above the rim
    expect(scene.lidState.off).toBe(false);
    scene.windDown(200);
    run(scene, 2500);
    expect(Math.abs(scene.lidState.dy)).toBeLessThan(0.5); // back on the rim
    scene.destroy();
  });

  it('the lid separates at the burst: it flies up, spins and leaves; the body stays; reset puts it back', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    const p = presetFor('rare', CRATE_FX_DEFAULTS);
    scene.anticipate(ant);
    scene.charge(p);
    run(scene, p.chargeMs);
    scene.burst(p);
    run(scene, 150);
    const mid = scene.lidState;
    expect(mid.off).toBe(true);
    expect(mid.dy).toBeLessThan(-scene.crateSize * 0.3); // well above where it sat
    expect(Math.abs(mid.rotation)).toBeGreaterThan(0.3); // tumbling
    run(scene, 3000);
    expect(scene.lidState.alpha).toBe(0); // gone
    const body = all(root).find((o) => o instanceof Sprite && o.texture === ART_CHEST.body && o.blendMode === 'normal')!;
    expect(body.visible && body.alpha).toBe(1); // the open body stays on the pedestal
    scene.reset();
    expect(scene.lidState).toMatchObject({ dx: 0, dy: 0, rotation: 0, off: false, alpha: 1 });
    scene.destroy();
  });

  it('the tuner moves the lid: an offset nudges its rest, a zero launch keeps it from rising', () => {
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    const lid = all(root).find((o) => o instanceof Sprite && o.texture === ART_CHEST.lid) as Sprite;
    const x0 = lid.position.x;
    const y0 = lid.position.y;
    scene.setTuning({ ...DEFAULT_CHEST_TUNING, lidOffsetX: 2, lidOffsetY: -1 });
    expect(lid.position.x - x0).toBeCloseTo(scene.crateSize * 0.02);
    expect(lid.position.y - y0).toBeCloseTo(-scene.crateSize * 0.01);
    scene.setTuning({ ...DEFAULT_CHEST_TUNING, lidLaunchY: 0, lidLaunchX: 0, lidGravity: 0 });
    scene.burst(presetFor('common', CRATE_FX_DEFAULTS));
    run(scene, 200);
    expect(Math.abs(scene.lidState.dy)).toBeLessThan(1);
    scene.destroy();
  });
});

// ─── the final review's fixes (tiered chest openings, 2026-10-19) ─────────────────────────────────────────────

/** A stand-in picture: only its size (the model and the mask read nothing else headless). */
const fakeImg = (url: string): HTMLImageElement => {
  const [w, h] = url.includes('lid') ? [816, 238] : [840, 402];
  return { width: w, height: h, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement;
};
const lidOf = (root: Container): Texture | undefined =>
  (all(root).find((o) => o instanceof Sprite && (o.texture === ART_CHEST.lid || o.texture.width === 816)) as Sprite | undefined)?.texture;

describe('the chest art is preloaded once per page and decoded before the opening needs it', () => {
  const attached = (fx: CrateFxPixi): CrateScene => {
    const scene = new CrateScene(new Container(), TEX);
    scene.layout(1920, 1080);
    fx.attachSceneForTests(scene, ART_CHEST);
    return scene;
  };

  it('a tier preloaded early (the shop, the bay, the click) is never fetched again: every theatre after reuses it', async () => {
    const urls: string[] = [];
    setChestArtLoaderForTests(async (url) => { urls.push(url); return fakeImg(url); });
    try {
      expect(await preloadChestArt('epic')).not.toBeNull();
      expect(preloadChestArt('epic')).toBe(preloadChestArt('epic')); // one promise per tier
      expect(urls.filter((u) => u.includes('chest_epic'))).toHaveLength(2);
      const a = new CrateFxPixi();
      attached(a);
      expect(await a.setChest('epic')).toBe('epic');
      a.destroy();
      const b = new CrateFxPixi(); // a fresh theatre's controller
      attached(b);
      expect(await b.setChest('epic')).toBe('epic');
      b.destroy();
      expect(urls).toHaveLength(2);
    } finally { setChestArtLoaderForTests(null); }
  });

  it('a failed preload is not kept: the next ask tries again', async () => {
    let fail = true;
    const urls: string[] = [];
    setChestArtLoaderForTests(async (url) => { urls.push(url); if (fail) throw new Error('404'); return fakeImg(url); });
    try {
      expect(await preloadChestArt('rare')).toBeNull();
      fail = false;
      expect(await preloadChestArt('rare')).not.toBeNull();
      expect(urls.filter((u) => u.includes('chest_rare'))).toHaveLength(4);
    } finally { setChestArtLoaderForTests(null); }
  });

  it('a picture counts as loaded only once it is decoded, so no decode lands mid-opening', async () => {
    const pending: Array<{ ok: () => void; bad: () => void }> = [];
    class FakeImage {
      decoding = ''; src = ''; complete = false; naturalWidth = 0;
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      decode(): Promise<void> {
        return new Promise<void>((res, rej) => {
          pending.push({ ok: () => { this.complete = true; this.naturalWidth = 840; res(); }, bad: () => rej(new Error('EncodingError')) });
        });
      }
    }
    vi.stubGlobal('Image', FakeImage);
    try {
      let got: unknown = null;
      void decodeImage('collection/chest_epic_body.webp').then((i) => { got = i; });
      await Promise.resolve();
      expect(got).toBeNull(); // fetched but not decoded yet: not ready
      pending[0]!.ok();
      await Promise.resolve(); await Promise.resolve();
      expect(got).toBeInstanceOf(FakeImage);
      let failed = false;
      void decodeImage('collection/missing.webp').catch(() => { failed = true; });
      pending[1]!.bad();
      await Promise.resolve(); await Promise.resolve();
      expect(failed).toBe(true); // a broken picture rejects (the opening falls back to Standard)
    } finally { vi.unstubAllGlobals(); }
  });

  it('a tier chest is uploaded to the GPU before it is swapped in', async () => {
    const fx = new CrateFxPixi({ loadImage: async (url) => fakeImg(url) });
    const scene = new CrateScene(new Container(), TEX);
    scene.layout(1920, 1080);
    const lidsAtUpload: Array<Texture | undefined> = [];
    const uploaded: TextureSource[] = [];
    fx.attachSceneForTests(scene, ART_CHEST, { upload: (src) => { uploaded.push(src); lidsAtUpload.push(lidOf(scene.root)); } });
    expect(await fx.setChest('epic')).toBe('epic');
    expect(uploaded.length).toBeGreaterThanOrEqual(2); // the body and the lid (the mask too when there is one)
    expect(lidsAtUpload.every((t) => t === ART_CHEST.lid)).toBe(true); // every upload ran while Standard was still drawn
    expect(lidOf(scene.root)?.width).toBe(816);
    fx.destroy();
  });

  it('mount starts the first chest\x27s art at once, before the renderer (whatever Pixi does next)', async () => {
    const urls: string[] = [];
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fx = new CrateFxPixi({ loadImage: async (url) => { urls.push(url); return fakeImg(url); } });
      expect(await fx.mount({ clientWidth: 0, clientHeight: 0 } as HTMLElement, 'ancient')).toBe(false); // no WebGL here
      expect(urls.some((u) => u.includes('chest_ancient_body'))).toBe(true);
      fx.destroy();
    } finally { quiet.mockRestore(); }
  });
});

describe('late chest art never lands mid-finale', () => {
  it('art that arrives after the burst has started is dropped for that opening; the next one gets it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fx = new CrateFxPixi({ loadImage: async (url) => { await gate; return fakeImg(url); } });
    const scene = new CrateScene(new Container(), TEX);
    scene.layout(1920, 1080);
    fx.attachSceneForTests(scene, ART_CHEST);
    const p = presetFor('rare', CRATE_FX_DEFAULTS);
    fx.anticipate(ant);
    fx.charge(p);
    const asked = fx.setChest('legendary');
    fx.burst(p);
    release();
    expect(await asked).toBe('standard');
    expect(lidOf(scene.root)).toBe(ART_CHEST.lid); // the opening kept the chest it burst
    fx.reset();
    expect(await fx.setChest('legendary')).toBe('legendary'); // cached for the next opening
    fx.destroy();
  });
});

describe('a beat asked before Pixi is up plays once it is (the autoOpen path)', () => {
  it('the anticipation, its tier layer and its heartbeat resume where they would be', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      const fx = new CrateFxPixi({ loadImage: () => Promise.reject(new Error('x')) });
      fx.setTierLayer(chestTierPresetFor('rare', CRATE_FX_DEFAULTS));
      fx.reset();
      fx.anticipate(ant); // the click: before the mount
      now.mockReturnValue(1250);
      const pulses: number[] = [];
      const scene = new CrateScene(new Container(), TEX, { onPulse: (k) => pulses.push(k) });
      scene.layout(1920, 1080);
      const seen = vi.spyOn(scene, 'anticipate');
      fx.attachSceneForTests(scene, ART_CHEST); // the mount resolves
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen).toHaveBeenCalledWith(ant, 250); // 250 ms already into the anticipation
      expect(scene.currentPhase).toBe('anticipation');
      run(scene, 600);
      expect(scene.stats().tier).toBeGreaterThan(0); // the Rare motes
      expect(pulses.length).toBeGreaterThan(0); // the heartbeat ticks
      fx.destroy();
    } finally { now.mockRestore(); }
  });

  it('a reset or a later beat before the mount drops the waiting anticipation; a skip lands settled', () => {
    const scene = (): CrateScene => { const s = new CrateScene(new Container(), TEX); s.layout(1920, 1080); return s; };
    const a = new CrateFxPixi();
    a.anticipate(ant);
    a.reset(); // a new opening began
    const sa = scene();
    a.attachSceneForTests(sa, ART_CHEST);
    expect(sa.currentPhase).toBe('idle');
    a.destroy();
    const b = new CrateFxPixi();
    b.anticipate(ant);
    b.charge(presetFor('rare', CRATE_FX_DEFAULTS)); // the opening moved on
    const sb = scene();
    b.attachSceneForTests(sb, ART_CHEST);
    expect(sb.currentPhase).toBe('idle');
    b.destroy();
    const c = new CrateFxPixi();
    c.anticipate(ant);
    c.skipToSettled(presetFor('epic', CRATE_FX_DEFAULTS));
    const sc = scene();
    c.attachSceneForTests(sc, ART_CHEST);
    expect(sc.currentPhase).toBe('settled');
    c.destroy();
  });

  it('anticipate(a, elapsed) starts the ramp part-way (clamped); the default is the click', () => {
    const s = new CrateScene(new Container(), TEX);
    s.layout(1920, 1080);
    s.anticipate(ant, 1e9);
    expect(s.currentPhase).toBe('anticipation');
    s.update(16);
    expect(s.hasWork()).toBe(true);
    s.destroy();
  });
});

describe('the tier burst flash and the charge build (final review rulings, 2026-10-19)', () => {
  it('Rare, Epic and Legendary flash in their colour lightened toward white; Ancient flashes white', () => {
    for (const t of ['rare', 'epic', 'legendary'] as const) {
      const T = chestTierPresetFor(t, CRATE_FX_DEFAULTS);
      expect(tierFlashColor(T)).toBe(lerpColor(T.color, 0xffffff, 0.3));
    }
    expect(tierFlashColor(chestTierPresetFor('ancient', CRATE_FX_DEFAULTS))).toBe(0xffffff);
    // the Epic chest's flash is drawn in it
    const root = new Container();
    const scene = new CrateScene(root, TEX);
    scene.layout(1920, 1080);
    const epic = chestTierPresetFor('epic', CRATE_FX_DEFAULTS);
    scene.setTierLayer(epic);
    const p = presetFor('common', CRATE_FX_DEFAULTS);
    scene.anticipate(ant);
    scene.charge(p);
    run(scene, p.chargeMs);
    scene.burst(p);
    expect(all(root).some((o) => o instanceof Sprite && o.tint === tierFlashColor(epic))).toBe(true);
    scene.destroy();
  });

  it('the tier\x27s extra shake builds through the charge: twice as much added at its end as at its start', () => {
    /** The chest's shake (px) at `ms` into a Rare-reward charge, read back from the crate's rotation. */
    const shakeAt = (tier: ChestTierPreset, ms: number): number => {
      const root = new Container();
      const scene = new CrateScene(root, TEX);
      scene.layout(1920, 1080);
      scene.setTierLayer(tier);
      scene.anticipate(ant);
      scene.charge(presetFor('rare', CRATE_FX_DEFAULTS));
      run(scene, ms);
      const crate = (all(root).find((o) => o instanceof Sprite && o.texture === ART_CHEST.lid) as Sprite).parent!;
      const v = (crate.rotation / (0.8 * Math.sin(ms * 0.057))) * Math.max(40, scene.crateSize);
      scene.destroy();
      return v;
    };
    const legendary = chestTierPresetFor('legendary', CRATE_FX_DEFAULTS);
    const early = shakeAt(legendary, 96) - shakeAt(NO_TIER_LAYER, 96);
    const late = shakeAt(legendary, 640) - shakeAt(NO_TIER_LAYER, 640);
    expect(early).toBeCloseTo(legendary.extraShake, 1);
    expect(late).toBeGreaterThan(legendary.extraShake * 1.7);
    expect(late).toBeLessThanOrEqual(legendary.extraShake * 2 + 1e-6);
  });
});
