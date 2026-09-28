/**
 * THE CRATE OPENING (owner ask 2026-09-28; redone the same day): the tuner's defaults + clamping, the rarity ->
 * preset mapping and its escalation, the beat timeline (ordering, the shipped numbers, slow motion, reduced
 * motion), and the Pixi scene run headless through a whole opening: the heartbeat pulses, the camera pushes in,
 * the bursts spawn, everything drains, and nothing is left behind after `destroy()`.
 */
import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import {
  CRATE_FX_DEFAULTS, CRATE_FX_RANGES, CRATE_RARITIES, SPEC, clampCrateFxValue, crateBeats, crateCue, crateRarityOf,
  presetFor, sanitizeCrateFxConfig, type CrateFxConfig, type CrateRarity,
} from './crateFxConfig';
import { CrateScene, DEFAULT_CHEST_TUNING, MAX_PARTICLES, crateSizeFor, lerpColor, type CrateSceneTextures } from './crateScene';
import { CHEST_ART, artChestModel, loadChestImages, paintedChestModel, type ChestModel } from './chestModel';
import { CHEST } from './crateTextures';

/** The shipped timeline, ms from the branch: [hitch, burst, second burst, reveal, settled (buttons)]. */
const TIMELINE: Record<CrateRarity, number[]> = {
  common: [380, 380, -1, 524, 1624],
  rare: [680, 680, -1, 854, 2154],
  epic: [940, 1100, -1, 1316, 2816],
  legendary: [1400, 1700, 1985, 1985, 3785],
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
      expect(p[i]!.flash).toBeGreaterThan(p[i - 1]!.flash);
      expect(p[i]!.screenShake).toBeGreaterThan(p[i - 1]!.screenShake);
      expect(p[i]!.push).toBeGreaterThan(p[i - 1]!.push);
      expect(p[i]!.pitch).toBeLessThan(p[i - 1]!.pitch); // bigger = lower
    }
    expect(p.filter((x) => x.sting).map((x) => x.rarity)).toEqual(['legendary']);
    expect(p.filter((x) => x.doubleBurst).map((x) => x.rarity)).toEqual(['legendary']);
    expect(p.filter((x) => x.coins > 0).map((x) => x.rarity)).toEqual(['legendary']);
    expect(p.filter((x) => x.hitchMs > 0).map((x) => x.rarity)).toEqual(['epic', 'legendary']);
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
