// @vitest-environment jsdom
/**
 * THE BLAST HERO ATTACK (owner ask 2026-09-28): the tuner defaults + clamping, the pure plan (the total is the
 * engine's number, the impact beat, scaling with damage inside caps, reduced motion), the one-clock runner (the
 * consequence lands exactly once on the impact beat, at any speed, in both directions; finish/cancel; cleanup), the
 * headless Pixi scene (pooled, bounded, drains, destroy leaves nothing), and the style resolver.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import {
  BLAST_CAPS, HERO_BLAST_DEFAULTS, HERO_BLAST_RANGES, blastCounts, blastCues, blastPlan, boltTravelMs,
  clampHeroBlastValue, heroBlastConfigJson, sanitizeHeroBlastConfig, type HeroBlastConfig, type HeroBlastNumKey,
} from './heroBlastConfig';
import { HeroBlastScene, MAX_SPRITES, arcControl, bezier, boltEase } from './heroBlastScene';
import { cameraAt, playHeroBlast, type HeroBlastOptions } from './heroBlast';
import { DEFAULT_HERO_ATTACK_STYLE, resolveHeroAttackStyle, styleOfCosmetic } from './heroAttackStyle';
import { attackerCosmeticOf } from './attackerCosmetic';
import { COSMETIC_INDEX } from '@game/progression';
import { SPEC } from '../HeroBlastTuner';

const TEX = { glow: Texture.WHITE, spark: Texture.WHITE, streak: Texture.WHITE, ring: Texture.WHITE };
const C = HERO_BLAST_DEFAULTS;

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_BLAST_RANGES)) {
      const v = C[k as HeroBlastNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorBolt', 'colorImpact'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroBlastValue('boltsMax', 99)).toBe(8);
    expect(clampHeroBlastValue('shakeMax', -3)).toBe(0);
    expect(clampHeroBlastValue('zoomMax', 5)).toBe(0.12);
    expect(clampHeroBlastValue('chargeMs', Number.NaN)).toBe(C.chargeMs);
    expect(clampHeroBlastValue('chargeMs', 'abc')).toBe(C.chargeMs);
    expect(clampHeroBlastValue('chargeMs', '300')).toBe(300);
    expect(clampHeroBlastValue('colorBolt', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroBlastValue('colorBolt', 'red')).toBe(C.colorBolt);
    expect(clampHeroBlastValue('nope' as keyof HeroBlastConfig, 1)).toBeUndefined();
    const s = sanitizeHeroBlastConfig({ boltsMin: 40, colorCore: 'x', bogus: 3 });
    expect(s.boltsMin).toBe(8);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroBlastConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroBlastConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.boltSpeed).toBe(C.boltSpeed);
  });
});

describe('the plan', () => {
  it('the combine ends on EXACTLY the engine total, even when the parts sum past the cap or fall short', () => {
    expect(blastCounts([3, 2, 4], 9)).toEqual([3, 5, 9]);
    expect(blastCounts([6, 6, 6], 10)).toEqual([6, 10, 10]);   // capped: never shows past the blow
    expect(blastCounts([2, 1], 5)).toEqual([2, 5]);            // short: the last arrival lands the real number
    const p = blastPlan({ values: [6, 6, 6], total: 10, distance: 800 }, C);
    expect(p.total).toBe(10);
    expect(p.counts[p.counts.length - 1]).toBe(10);
    expect(p.capped).toBe(true);
  });

  it('beats run in order: numbers launch and arrive, merge, charge, fire, IMPACT (lead bolt lands), end', () => {
    const p = blastPlan({ values: [3, 1, 2, 4], total: 10, distance: 900 }, C);
    p.launches.forEach((l, i) => expect(p.arrivals[i]).toBe(l + C.combineFlyMs));
    expect(p.mergeAt).toBe(p.arrivals[3]);
    expect(p.chargeAt).toBe(p.mergeAt + C.mergeHoldMs);
    expect(p.fireAt).toBeGreaterThan(p.chargeAt);
    expect(p.impactAt).toBe(p.bolts[0]!.fireAt + p.bolts[0]!.travelMs);
    expect(p.endAt).toBeGreaterThan(Math.max(...p.bolts.map((b) => b.arriveAt)));
    const kinds = blastCues(p).map((c) => c.kind);
    expect(kinds.indexOf('merge')).toBeLessThan(kinds.indexOf('charge'));
    expect(kinds.indexOf('charge')).toBeLessThan(kinds.indexOf('fire'));
    expect(kinds.indexOf('fire')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe('end');
  });

  it('the shipped timeline (4 parts, 900 px): impact and end, ms', () => {
    const p = blastPlan({ values: [3, 1, 2, 4], total: 10, distance: 900 }, C);
    expect([p.mergeAt, p.chargeAt, p.fireAt, p.impactAt, Math.round(p.endAt)]).toEqual([760, 930, 1190, 1455, 2043]);
  });

  it('bigger blows read bigger: more bolts, harder shake, deeper push, more sparks; always inside the caps', () => {
    const small = blastPlan({ values: [1], total: 1, distance: 800 }, C);
    const big = blastPlan({ values: [5, 6, 6, 6, 6], total: 40, distance: 800 }, C);
    expect(small.bolts).toHaveLength(C.boltsMin);
    expect(big.bolts).toHaveLength(C.boltsMax);
    expect(big.shakePx).toBeGreaterThan(small.shakePx);
    expect(big.zoom).toBeGreaterThan(small.zoom);
    expect(big.sparks).toBeGreaterThan(small.sparks);
    expect(big.bolts[0]!.size).toBeGreaterThan(small.bolts[0]!.size);
    const wild: HeroBlastConfig = { ...C, boltsMax: 8, shakeMax: 20, zoomMax: 0.12, sparksMax: 80 };
    const w = blastPlan({ values: [99], total: 99, distance: 800 }, wild);
    expect(w.bolts.length).toBeLessThanOrEqual(BLAST_CAPS.bolts);
    expect(w.shakePx).toBeLessThanOrEqual(BLAST_CAPS.shakePx);
    expect(w.zoom).toBeLessThanOrEqual(BLAST_CAPS.zoom);
  });

  it('bolt flight scales with distance inside a readable band', () => {
    expect(boltTravelMs(340, 3400)).toBe(140);
    expect(boltTravelMs(1020, 3400)).toBe(300);
    expect(boltTravelMs(99999, 3400)).toBe(520);
  });

  it('reduced motion: no flight, no bolts, no shake, no zoom; the blow still lands once', () => {
    const p = blastPlan({ values: [3, 4], total: 7, distance: 800, reduced: true }, C);
    expect(p.bolts).toEqual([]);
    expect(p.shakePx).toBe(0);
    expect(p.zoom).toBe(0);
    expect(p.impactAt).toBe(C.reducedFadeMs + 220);
    expect(blastCues(p).filter((c) => c.kind === 'impact')).toHaveLength(1);
    expect(cameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('the camera pushes in through the charge, punches on impact, and is back at rest by the end', () => {
    const p = blastPlan({ values: [3, 4], total: 7, distance: 800 }, C);
    expect(cameraAt(p, C, p.chargeAt - 1).zoom).toBe(1);
    expect(cameraAt(p, C, p.fireAt).zoom).toBeCloseTo(1 + p.zoom, 5);
    expect(cameraAt(p, C, p.impactAt + 70).zoom).toBeGreaterThan(1 + p.zoom);
    const rest = cameraAt(p, C, p.endAt);
    expect(rest.zoom).toBeCloseTo(1, 4);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.01);
    const shake = cameraAt(p, C, p.impactAt + 20);
    expect(Math.abs(shake.x) + Math.abs(shake.y)).toBeGreaterThan(0);
  });

  it('is deterministic: the same fight plans the same beats (a replay plays what the live fight did)', () => {
    const a = blastPlan({ values: [4, 2, 3], total: 9, distance: 720 }, C);
    const b = blastPlan({ values: [4, 2, 3], total: 9, distance: 720 }, C);
    expect(b).toEqual(a);
    expect(blastCues(b)).toEqual(blastCues(a));
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroBlastOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBlastOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBlast({
    parts: [{ value: 3, from: { x: 100, y: 800 }, base: true }, { value: 2, from: { x: 500, y: 500 } }, { value: 4, from: { x: 700, y: 500 } }],
    total: 9, attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, combineAt: { x: 900, y: 500 },
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera };
}

describe('the runner', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('lands the blow EXACTLY ONCE, on the impact beat (the lead bolt arriving), then ends and cleans up', () => {
    const { h, f, root, onImpact, onDone, host, camera } = run();
    expect(host.querySelectorAll('.hblast-chip')).toHaveLength(3);
    f.tick(h.plan.impactAt - 20, 1);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(20, 1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt);
    expect(camera.style.transform).toContain('scale(');
    f.tick(h.plan.endAt - h.plan.impactAt + 16, 16);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    f.tick(2000, 16); // the embers drain, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('works in both directions (the impact lands at whichever hero is struck)', () => {
    for (const dir of ['you', 'them'] as const) {
      const a = dir === 'you' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
      const d = dir === 'you' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
      const { h, f, onImpact } = run({ attacker: a, defender: d });
      f.tick(h.plan.impactAt + 16);
      expect(onImpact, dir).toHaveBeenCalledTimes(1);
      h.cancel();
    }
  });

  it('slow motion stretches real time but the impact is still the same sequence beat', () => {
    const { h, f, onImpact } = run({ speed: 0.25 });
    f.tick(h.plan.impactAt * 4 - 40);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(60);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('the counter shows the ENGINE total at the merge', () => {
    const { h, f, host } = run({ total: 7 }); // parts sum to 9, the capped blow is 7
    f.tick(h.plan.mergeAt + 20, 4);
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('7');
    h.cancel();
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it', () => {
    const a = run();
    a.f.tick(200);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run();
    b.f.tick(200);
    b.h.cancel();
    b.f.tick(5000);
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.onDone).not.toHaveBeenCalled();
    expect(b.host.querySelector('.hblast')).toBeNull();
    expect(b.camera.style.transform).toBe('');
  });

  it('reduced motion: no Pixi layer, no camera move, just the total fading; the blow lands once', () => {
    const { h, f, root, onImpact, camera, host } = run({ reduced: true });
    expect(root.children).toHaveLength(0);
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expect(host.querySelector('.hblast-total-n')!.textContent).toBe('9');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const h = playHeroBlast({
        parts: [{ value: 2, from: null }], total: 2, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 }, combineAt: { x: 400, y: 0 },
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
  it('pure helpers: the bolt accelerates, the arc bows sideways and ends on target', () => {
    expect(boltEase(0)).toBe(0);
    expect(boltEase(1)).toBe(1);
    expect(boltEase(0.75) - boltEase(0.5)).toBeGreaterThan(boltEase(0.25) - boltEase(0));
    const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
    expect(arcControl(a, b, 0.2).y).toBeCloseTo(20);
    expect(bezier(a, arcControl(a, b, 0.2), b, 1)).toEqual(b);
  });

  it('a whole blast charges, fires, impacts, drains to idle; the pool stays bounded; destroy leaves nothing', () => {
    const s = new HeroBlastScene(TEX, { core: 0xffffff, bolt: 0xffaa00, impact: 0xff4400 });
    s.mergeBurst(500, 500, true);
    s.startCharge(100, 800, 260, 1, 30);
    for (let i = 0; i < 16; i++) s.update(16);
    expect(s.charging).toBe(true);
    for (let i = 0; i < 8; i++) s.fire({ x: 100, y: 800 }, { x: 1400, y: 150 }, 300, 1.4, (i % 2 ? 1 : -1) * 0.12);
    expect(s.liveBolts).toBe(8);
    for (let i = 0; i < 25; i++) s.update(16);
    s.impact(1400, 150, { x: 1, y: -0.5 }, 1, 1.4, 0.9, 80);
    s.hit(1400, 150, { x: 1, y: -0.5 }, 1);
    expect(s.liveSprites).toBeLessThanOrEqual(MAX_SPRITES);
    expect(s.pooledSprites).toBeLessThanOrEqual(MAX_SPRITES);
    let alive = true;
    for (let i = 0; i < 200 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveBolts).toBe(0);
    expect(s.charging).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('clear() drops everything in flight at once', () => {
    const s = new HeroBlastScene(TEX, { core: 1, bolt: 2, impact: 3 });
    s.startCharge(0, 0, 200, 1, 20);
    s.fire({ x: 0, y: 0 }, { x: 500, y: 0 }, 200, 1, 0);
    s.impact(500, 0, { x: 1, y: 0 }, 0.5, 1, 1, 30);
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    s.destroy();
  });
});

describe('the attack style', () => {
  it('players see Classic by default; the dev override forces a style for both sides', () => {
    expect(DEFAULT_HERO_ATTACK_STYLE).toBe('classic');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'auto' })).toBe('classic');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'blast' })).toBe('blast');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_blast' })).toBe('classic');
  });

  it('an equipped cosmetic picks its style (Arcane Barrage plays Blast); a retired or unknown id falls back to Classic', () => {
    expect(COSMETIC_INDEX.attack_blast).toMatchObject({ category: 'hero_attack', rarity: 'epic', assets: { style: 'blast' } });
    expect(styleOfCosmetic('attack_blast')).toBe('blast');
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_blast' })).toBe('blast');
    for (const bad of ['attack_gone', 'toString', 'skin_albus_1', 'title_wanderer', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });

  it('the attacker recorded cosmetic: yours from the run; theirs from the seat, only while opponent cosmetics show', () => {
    expect(attackerCosmeticOf({ cosmetics: { heroAttack: 'attack_blast' }, lobby: undefined }, 'player', false)).toBe('attack_blast');
    expect(attackerCosmeticOf({ cosmetics: undefined, lobby: undefined }, 'player', true)).toBeNull();
    expect(attackerCosmeticOf({ cosmetics: { heroAttack: 'attack_blast' }, lobby: undefined }, 'opp', true)).toBeNull();
  });
});
