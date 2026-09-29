// @vitest-environment jsdom
/**
 * THE BUBBLE POP HERO ATTACK (a Rare; owner 2026-09-29): the shared tiers on TWO visual tiers (I-II small, III-IV big, a
 * knockout big); the tuner values; the pure plan (one bubble small; a stream of little ones big, each blip a tick, then
 * THE pop); the pure drift (from the hero's rim to the struck face); the runner on the shared clock (the blow lands
 * exactly ONCE, on the pop; both directions; replay; finish / cancel; cleanup; the camera applied once); the headless
 * scene; the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_BUBBLE_DEFAULTS, HERO_BUBBLE_RANGES, bubbleCues, bubbleDrifts, bubbleLevel, bubblePlan, clampHeroBubbleValue, driftPos,
  heroBubbleConfigJson, type HeroBubbleNumKey,
} from './heroBubbleConfig';
import { HeroBubbleScene, MAX_BUBBLE_SPRITES, type HeroBubbleTextures } from './heroBubbleScene';
import { playHeroBubble, type HeroBubbleOptions } from './heroBubble';
import { SPEC } from '../HeroBubbleTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBubbleTextures = { glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W, film: W, sheen: W, drop: W, tiny: W };
const C = HERO_BUBBLE_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => bubblePlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;

describe('the tiers: the shared four onto a Rare\'s two', () => {
  it('uses the shared thresholds; I-II small, III-IV big; a knockout big', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).level, `dmg ${d}`).toBe(tierOf(d) >= 3 ? 'big' : 'small');
    expect([1, 2, 3, 4].map((t) => bubbleLevel(t as 1 | 2 | 3 | 4))).toEqual(['small', 'small', 'big', 'big']);
    expect(plan(1, { knockout: true })).toMatchObject({ tier: 4, level: 'big' });
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top', () => {
    for (const [k, [min, max]] of Object.entries(HERO_BUBBLE_RANGES)) {
      const v = C[k as HeroBubbleNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroBubbleValue('bigStream', 99)).toBe(10);
    expect(clampHeroBubbleValue('colorPink', 'pink')).toBe(C.colorPink);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroBubbleConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('bubble');
  });
});

describe('the plan', () => {
  it('SMALL: one bubble, blown, drifted, engulfing, and THE pop; no ticks; short (a Rare)', () => {
    const p = plan(3);
    expect(p.stream).toEqual([]);
    expect(p.hits).toEqual([]);
    expect(p.blowAt).toBeLessThan(p.releaseAt);
    expect(p.releaseAt).toBeLessThan(p.arriveAt);
    expect(p.arriveAt).toBeLessThan(p.engulfAt);
    expect(p.engulfAt).toBeLessThanOrEqual(p.impactAt);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(1900);
  });

  it('BIG: a stream of little bubbles (ticks) before THE pop, with a splash ring; the pop is the only impact', () => {
    const p = plan(14);
    expect(p.stream.length).toBeGreaterThanOrEqual(3);
    for (const at of p.hits) expect(at).toBeLessThan(p.impactAt);
    expect(p.splash).toBeGreaterThan(0);
    expect(p.engulf).toBeGreaterThan(plan(3).engulf); // a bigger bubble swells round the portrait
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(2300);
    const kinds = bubbleCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(p.stream.length);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
  });

  it('reduced motion: no bubbles; the blow lands at the end of the formation', () => {
    const p = plan(14, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([14], true));
    expect(bubbleDrifts(p, A, D, R, R, 0.1)).toEqual({ main: null, stream: [] });
  });
});

describe('the drift', () => {
  it('starts at the hero\'s rim, ends on the struck face, floats up on the way', () => {
    const p = plan(40);
    const d = bubbleDrifts(p, A, D, R, R, 0.12);
    expect(Math.hypot(d.main!.a.x - A.x, d.main!.a.y - A.y)).toBeLessThanOrEqual(R);
    const end = driftPos(d.main!, 1);
    expect(Math.hypot(end.x - D.x, end.y - D.y)).toBeLessThan(0.01);
    const mid = driftPos(d.main!, 0.5);
    const straight = { x: (d.main!.a.x + D.x) / 2, y: (d.main!.a.y + D.y) / 2 };
    expect(mid.y).toBeLessThan(straight.y); // above the straight line (it floats)
    for (const s of d.stream) {
      const end = driftPos(s, 1);
      expect(Math.hypot(end.x - D.x, end.y - D.y)).toBeLessThanOrEqual(R * 0.55);
    }
  });
});

function manualFrames(): { frames: HeroBubbleOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBubbleOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBubble({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('BIG: the little bubbles blip (never the blow), the big one engulfs the face, and the blow lands ONCE on the pop', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(host.querySelector('.hblast.hbubble')).not.toBeNull();
    f.tick(h.plan.stream[0]!.releaseAt + 40, 4);
    expect(h.scene!.streamBubbles).toBeGreaterThan(0);
    f.tick(h.plan.hits[h.plan.hits.length - 1]! - h.elapsed() + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.streamBubbles).toBe(0); // every little one blipped
    f.tick(h.plan.engulfAt - h.elapsed() + 20, 4);
    expect(h.scene!.phase).toBe('hold');
    expect(h.scene!.bubbleRadius).toBeGreaterThan(R); // round the whole portrait
    expect(defenderEl.style.transform).toContain('translate(');
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.hasBubble).toBe(false);
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(3000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('both directions at every tier, within the cap; the camera applied once when the canvas rides it', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.endAt; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_BUBBLE_SPRITES);
        h.cancel();
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

  it('finish() lands once; cancel() never lands; a replay plays the same; reduced motion lands once', () => {
    const a = run();
    a.f.tick(200, 16);
    a.h.finish();
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    const b = run();
    b.f.tick(200, 16);
    b.h.cancel();
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.f.hooked()).toBe(0);
    const x = run({ total: 40, formation: formationOf([40], 40) });
    const y = run({ total: 40, formation: formationOf([40], 40) });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.drifts).toEqual(y.h.drifts);
    x.f.tick(x.h.plan.impactAt + 60, 8); y.f.tick(y.h.plan.impactAt + 60, 8);
    expect(x.h.scene!.liveSprites).toBe(y.h.scene!.liveSprites);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, drains, and destroy leaves nothing', () => {
    const scene = new HeroBubbleScene(TEX, { film: 0xffffff, pink: 0xffb3d9, mint: 0xaef5d8, lilac: 0xc9b6ff, sky: 0x9fdcff, side: 0xc9b6ff },
      { filmSpin: 0.0012, sheen: 0.85, dropGravity: 900, dropSpeed: 360 }, 1, 5);
    const p = plan(40);
    const d = bubbleDrifts(p, A, D, R, R, 0.12);
    scene.blow(d.main!.a, 40, 300, 0.08);
    d.stream.forEach((s) => scene.streamOut(s, 14, 0.08));
    for (let i = 0; i < 40; i++) scene.update(16);
    d.stream.forEach((_, i) => scene.blip(i));
    scene.release(d.main!);
    for (let i = 0; i < 40; i++) scene.update(16);
    scene.engulf(D, 110, 200, 200);
    for (let i = 0; i < 30; i++) scene.update(16);
    scene.pop({ drops: 50, tinies: 30, splash: 2 });
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_BUBBLE_SPRITES);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});

describe('the cosmetic', () => {
  it('Bubble Trouble (attack_bubble) is a RARE crate hero attack that plays the bubble', () => {
    expect(COSMETIC_INDEX.attack_bubble).toMatchObject({ category: 'hero_attack', rarity: 'rare', name: 'Bubble Trouble', assets: { style: 'bubble' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('bubble');
    expect(styleOfCosmetic('attack_bubble')).toBe('bubble');
  });
});
