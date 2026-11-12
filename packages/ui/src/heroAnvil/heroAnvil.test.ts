// @vitest-environment jsdom
/**
 * LOOK OUT BELOW (style id `anvil`, a Rare hero attack): the shared tiers mapped onto TWO visual tiers (I-II the anvil,
 * III-IV the piano, a knockout the piano); the tuner values; the pure plan (cue, shadow, drop, landing, hold, pop, end,
 * per tier); the pure squash (flat under the weight, the accordion spring, settling on exactly 1); the pure camera; the
 * runner on the shared clock (the blow lands exactly ONCE, on the landing; both directions; the object comes from above
 * the screen and lands on the portrait; replay from the seed; finish / cancel / the end put both portraits back
 * exactly); the headless scene (pooled, bounded, drains, destroy leaves nothing).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES } from '../heroBlast/heroAttackStyle';
import {
  ANVIL_REST_EPS, HERO_ANVIL_DEFAULTS, HERO_ANVIL_RANGES, anvilCameraAt, anvilCameraFocus, anvilCues, anvilDropMs, anvilLevel, anvilPlan,
  anvilRestOffset, anvilSquashAt, clampHeroAnvilValue, heroAnvilConfigJson, sanitizeHeroAnvilConfig, type HeroAnvilConfig, type HeroAnvilNumKey,
} from './heroAnvilConfig';
import { HeroAnvilScene, MAX_ANVIL_SPRITES, type HeroAnvilTextures } from './heroAnvilScene';
import { anvilSeed, playHeroAnvil, type HeroAnvilOptions } from './heroAnvil';
import { SPEC } from '../HeroAnvilTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroAnvilTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  anvil: W, piano: W, keyWhite: W, keyBlack: W, puff: W, shadow: W,
};
const C = HERO_ANVIL_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean; fallPx?: number } = {}) => anvilPlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const R = 80;

describe('the tiers: the shared four onto a Rare\'s two', () => {
  it('uses the shared thresholds, and maps I-II to the anvil, III-IV to the piano', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const p = plan(d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level, `dmg ${d}`).toBe(tierOf(d) >= 3 ? 'big' : 'small');
      expect(p.object, `dmg ${d}`).toBe(tierOf(d) >= 3 ? 'piano' : 'anvil');
    }
    expect([1, 2, 3, 4].map((t) => anvilLevel(t as 1 | 2 | 3 | 4))).toEqual(['small', 'small', 'big', 'big']);
  });

  it('a knockout drops the piano whatever the number', () => {
    const p = plan(3, { knockout: true });
    expect(p.tier).toBe(4);
    expect(p.level).toBe('big');
    expect(p.object).toBe('piano');
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_ANVIL_RANGES)) {
      const v = C[k as HeroAnvilNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorDust', 'colorSpark', 'colorShadow', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroAnvilValue('bigKeys', 99)).toBe(20);
    expect(clampHeroAnvilValue('smallFlat', -3)).toBe(0.1);
    expect(clampHeroAnvilValue('tipMs', 'abc')).toBe(C.tipMs);
    expect(clampHeroAnvilValue('colorDust', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroAnvilValue('colorDust', 'beige')).toBe(C.colorDust);
    expect(clampHeroAnvilValue('nope' as keyof HeroAnvilConfig, 1)).toBeUndefined();
    const s = sanitizeHeroAnvilConfig({ bigDust: 400, bogus: 1 });
    expect(s.bigDust).toBe(30);
    expect('bogus' in s).toBe(false);
  });

  it('every config key has a control; Copy JSON drops the preview keys; the buttons sit on top; the style row offers anvil', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroAnvilConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.bigKeys).toBe(14);
    expect(SPEC.buttonsOnTop).toBe(true);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('anvil');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('anvil');
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced/i.test(l))).toEqual([]);
  });

  it('no control carries a native tooltip or player text with a dash', () => {
    for (const c of SPEC.controls) expect(`${c.label} ${c.hint ?? ''}`, String(c.key)).not.toMatch(/—|--/);
  });
});

describe('the plan', () => {
  it('SMALL: cue, shadow, drop, THE landing, pop, end, in that order; short (a Rare); no keys', () => {
    const p = plan(3);
    expect(anvilCues(p).map((q) => q.kind)).toEqual(['charge', 'shadow', 'drop', 'impact', 'pop', 'end']);
    expect(p.shadowAt).toBe(p.chargeAt + C.smallReadyMs);
    expect(p.impactAt).toBe(p.shadowAt + C.smallFallMs);
    expect(p.dropAt).toBe(p.impactAt - p.dropMs);
    expect(p.dropAt).toBeGreaterThanOrEqual(p.shadowAt); // the shadow is on the portrait before anything is in the sky
    expect(p.popAt).toBe(p.impactAt + C.smallHoldMs);
    expect(p.endAt).toBe(p.popAt + C.smallSettleMs);
    expect(p.keys).toBe(0);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(1600);
  });

  it('BIG: a longer fall, a bigger shadow and object, a flatter squash, more dust, and the keys', () => {
    const s = plan(3), b = plan(14);
    expect(b.fallMs).toBeGreaterThan(s.fallMs);
    expect(b.shadow).toBeGreaterThan(s.shadow * 1.5);
    expect(b.size).toBeGreaterThan(s.size);
    expect(b.flat).toBeLessThan(s.flat);
    expect(b.dust).toBeGreaterThan(s.dust);
    expect(b.keys).toBeGreaterThan(0);
    expect(b.endAt - b.chargeAt).toBeLessThanOrEqual(2200);
    expect(anvilCues(b).filter((q) => q.kind === 'impact')).toHaveLength(1);
  });

  it('the visible drop scales gently with the height it falls, and never moves the landing', () => {
    expect(anvilDropMs(700, 200)).toBe(200);
    expect(anvilDropMs(100, 200)).toBe(150);
    expect(anvilDropMs(4000, 200)).toBe(250);
    expect(anvilDropMs(Number.NaN, 200)).toBe(200);
    const near = plan(14, { fallPx: 150 }), far = plan(14, { fallPx: 1100 });
    expect(near.dropMs).toBeLessThan(far.dropMs);
    expect(near.impactAt).toBe(far.impactAt);
    expect(near.endAt).toBe(far.endAt);
  });

  it('reduced motion: nothing falls; the blow lands at the end of the formation', () => {
    const p = plan(14, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(p.impactAt).toBe(leadInOf([14], true));
    expect(anvilCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(anvilSquashAt(p, C, p.impactAt + 50)).toEqual({ sx: 1, sy: 1 });
    expect(anvilCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('is deterministic', () => {
    expect(plan(14)).toEqual(plan(14));
    expect(anvilSeed(14, 900, 'opp', 77)).toBe(anvilSeed(14, 900, 'opp', 77));
    expect(anvilSeed(14, 900, 'opp', 77)).not.toBe(anvilSeed(14, 900, 'opp', 78));
  });
});

describe('the squash (pure)', () => {
  it('untouched until the landing; flat within a few frames; held flat under the weight', () => {
    for (const total of [3, 14]) {
      const p = plan(total);
      expect(anvilSquashAt(p, C, p.impactAt - 1)).toEqual({ sx: 1, sy: 1 });
      expect(anvilSquashAt(p, C, p.impactAt + 60).sy).toBeLessThan(p.flat + 0.12);
      for (let t = p.impactAt + 120; t < p.popAt; t += 10) {
        const q = anvilSquashAt(p, C, t);
        expect(q.sy, `t ${t}`).toBeLessThan(p.flat + 0.08);
        expect(q.sy, `t ${t}`).toBeGreaterThan(p.flat - 0.08);
        expect(q.sx, `t ${t}`).toBeGreaterThan(1.2); // spread sideways
      }
    }
  });

  it('pops back like an accordion: tall, short, tall, each smaller, and settles on EXACTLY 1 before the end', () => {
    for (const total of [3, 14]) {
      const p = plan(total);
      // The turning points of the spring after the pop.
      const peaks: number[] = [];
      let prev = anvilSquashAt(p, C, p.popAt).sy, dir = 0;
      for (let t = p.popAt + 2; t <= p.endAt; t += 2) {
        const v = anvilSquashAt(p, C, t).sy;
        const d = Math.sign(v - prev);
        if (dir !== 0 && d !== 0 && d !== dir) peaks.push(prev);
        if (d !== 0) dir = d;
        prev = v;
      }
      expect(peaks.length, `total ${total}`).toBeGreaterThanOrEqual(3);
      expect(peaks[0]!).toBeGreaterThan(1.15); // the first overshoot stands tall
      expect(peaks[1]!).toBeLessThan(0.97); // then short
      expect(peaks[2]!).toBeGreaterThan(1.01); // then tall again
      expect(Math.abs(peaks[1]! - 1)).toBeLessThan(Math.abs(peaks[0]! - 1));
      expect(Math.abs(peaks[2]! - 1)).toBeLessThan(Math.abs(peaks[1]! - 1));
      // Whatever is left at the end is under what the eye can see, and once under the threshold it is exactly at rest.
      const last = anvilSquashAt(p, C, p.endAt);
      expect(Math.abs(last.sy - 1)).toBeLessThan(0.012);
      expect(anvilSquashAt(p, C, p.endAt + 400)).toEqual({ sx: 1, sy: 1 });
      expect(ANVIL_REST_EPS).toBeLessThan(0.01);
    }
  });

  it('the object rests on the top of the pressed portrait (its bottom edge is pinned)', () => {
    expect(anvilRestOffset(1)).toBeLessThan(-0.7); // near the top of the round art at rest
    expect(anvilRestOffset(1)).toBeGreaterThanOrEqual(-1);
    expect(anvilRestOffset(0.2)).toBeGreaterThan(0.5); // down near the ground line when flat
    expect(anvilRestOffset(0.2)).toBeLessThan(1);
  });
});

describe('the camera (pure)', () => {
  it('pushes in through the fall, is driven DOWN on the landing, and settles after the pop', () => {
    const p = plan(14);
    expect(anvilCameraAt(p, C, p.chargeAt - 10).zoom).toBe(1);
    expect(anvilCameraAt(p, C, p.impactAt - 1).zoom).toBeGreaterThan(1.03);
    const hit = anvilCameraAt(p, C, p.impactAt);
    expect(hit.y).toBeGreaterThan(0);
    expect(hit.x).toBe(0);
    expect(hit.y).toBeLessThanOrEqual(30);
    const rest = anvilCameraAt(p, C, p.endAt + 3000);
    expect(rest.zoom).toBeCloseTo(1, 3);
    expect(Math.abs(rest.y)).toBeLessThan(0.01);
  });

  it('anchors on the striking hero at the cue and on the struck hero from the shadow on', () => {
    const p = plan(14);
    const a = { x: 100, y: 800 }, d = { x: 1400, y: 150 };
    expect(anvilCameraFocus(p, p.chargeAt, a, d)).toEqual(a);
    expect(anvilCameraFocus(p, p.shadowAt, a, d)).toEqual(d);
    expect(anvilCameraFocus(p, p.impactAt + 50, a, d)).toEqual(d);
  });
});

function manualFrames(): { frames: HeroAnvilOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroAnvilOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  // The portraits come in with a look of their own: every exit must put exactly this back.
  attackerEl.style.transform = 'translateX(3px)';
  defenderEl.style.transform = 'rotate(2deg)';
  defenderEl.style.opacity = '0.9';
  defenderEl.style.filter = 'saturate(1.1)';
  defenderEl.className = 'combatopp-body is-front';
  document.body.append(host, camera);
  const h = playHeroAnvil({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false, pixiScale: 1,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

function expectRestored(r: ReturnType<typeof run>): void {
  expect(r.attackerEl.style.transform).toBe('translateX(3px)');
  expect(r.defenderEl.style.transform).toBe('rotate(2deg)');
  expect(r.defenderEl.style.opacity).toBe('0.9');
  expect(r.defenderEl.style.filter).toBe('saturate(1.1)');
  expect(r.defenderEl.className).toBe('combatopp-body is-front');
  expect(r.attackerEl.className).toBe('');
  expect(r.camera.style.transform).toBe('');
  expect(r.host.querySelector('.hblast')).toBeNull();
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('BIG: shadow, then the piano from above the screen, the blow EXACTLY ONCE on the landing, flat, pop, all put back', () => {
    const r = run({ total: 14, formation: formationOf([14], 14) });
    const { h, f, root, onImpact, onDone, host, camera, defenderEl } = r;
    const p = h.plan;
    expect(p.level).toBe('big');
    expect(host.querySelector('.hblast.hanvil')).not.toBeNull();
    expect(h.startY).toBeLessThan(0); // it starts above the top of the screen
    // The shadow is on the portrait and growing before anything is in the sky.
    f.tick(p.shadowAt + 40, 4);
    expect(h.scene!.shadowOn).toBe(true);
    expect(h.scene!.objectState).toBeNull();
    const r0 = h.scene!.shadowRadius;
    f.tick(p.dropAt - h.elapsed() + 8, 4);
    expect(h.scene!.shadowRadius).toBeGreaterThan(r0);
    expect(h.scene!.objectState).toBe('fall');
    expect(h.scene!.objectKind).toBe('piano');
    expect(defenderEl.style.transform).toBe('rotate(2deg)'); // untouched until the landing
    const y0 = h.scene!.objectAt!.y;
    f.tick(p.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.objectAt!.y).toBeGreaterThan(y0);
    expect(h.scene!.objectAt!.y).toBeLessThanOrEqual(h.landY + 0.5);
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.objectState).toBe('rest');
    expect(h.scene!.liveKeys).toBe(p.keys);
    expect(h.scene!.liveFx).toBeGreaterThanOrEqual(p.dust);
    expect(camera.style.transform).toContain('scale(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    // Flat under the weight: pressed down onto its bottom edge, spread sideways, the piano sitting on top of it.
    f.tick(120, 4);
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+), ([\d.]+)\)/.exec(defenderEl.style.transform)!;
    expect(+m[4]!).toBeLessThan(0.3);
    expect(+m[3]!).toBeGreaterThan(1.3);
    expect(+m[2]!).toBeCloseTo(R * (1 - +m[4]!), 0); // the bottom edge of the round art stays put
    expect(h.scene!.objectAt!.y).toBeGreaterThan(h.landY + R); // it followed the portrait down
    expect(h.scene!.shadowOn).toBe(false);
    // The pop: the piano is tossed off, the portrait springs up past its height.
    f.tick(p.popAt - h.elapsed() + 90, 4);
    expect(h.scene!.objectState).toBe('tip');
    expect(/scale\(([\d.]+), ([\d.]+)\)/.exec(defenderEl.style.transform)![2]).toMatch(/^1\./);
    f.tick(p.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    f.tick(4000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('SMALL: the anvil lands the blow, no keys, and everything is put back', () => {
    const r = run({ total: 3, formation: formationOf([3], 3) });
    const { h, f, onImpact } = r;
    expect(h.plan.level).toBe('small');
    f.tick(h.plan.impactAt + 40, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.objectKind).toBe('anvil');
    expect(h.scene!.objectState).toBe('rest');
    expect(h.scene!.liveKeys).toBe(0);
    f.tick(h.plan.endAt + 3000, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier: from above the screen onto the portrait, tipping toward the room, within the cap', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const r = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        const { h, f, onImpact } = r;
        const tag = `${side} ${total}`;
        expect(h.startY, tag).toBeLessThan(0);
        expect(h.landY, tag).toBeLessThan(d.y);
        expect(h.landY, tag).toBeGreaterThanOrEqual(d.y - R);
        let peak = 0, sawFall = false;
        for (let t = 0; t < h.plan.popAt + 120; t += 8) {
          f.tick(8, 8);
          peak = Math.max(peak, h.scene!.liveSprites);
          const at = h.scene!.objectAt;
          if (h.scene!.objectState === 'fall' && at) { sawFall = true; expect(at.x, tag).toBe(d.x); expect(at.y, tag).toBeLessThanOrEqual(h.landY + 0.5); }
          if (h.scene!.shadowOn) expect(h.scene!.shadowRadius, tag).toBeLessThanOrEqual(R * h.plan.shadow + 0.5);
        }
        expect(sawFall, tag).toBe(true);
        expect(onImpact, tag).toHaveBeenCalledTimes(1);
        expect(peak, tag).toBeLessThanOrEqual(MAX_ANVIL_SPRITES);
        // Tossed toward the striking hero's side (the inside of the screen).
        expect(h.scene!.objectState, tag).toBe('tip');
        expect(Math.sign(h.scene!.objectAt!.x - d.x), tag).toBe(Math.sign(a.x - d.x));
        h.cancel();
        expectRestored(r);
      }
    }
  });

  it('a portrait right at the top of the screen still gets a visible drop from off screen', () => {
    const { h, f } = run({ defender: { x: 900, y: 70 }, total: 40, formation: formationOf([40], 40) });
    expect(h.startY).toBeLessThan(h.landY - R); // at least a radius of travel
    expect(h.startY).toBeLessThan(0);
    expect(h.plan.dropMs).toBeGreaterThanOrEqual(150);
    f.tick(h.plan.dropAt + 16, 4);
    expect(h.scene!.objectState).toBe('fall');
    h.cancel();
  });

  it('the camera is applied ONCE: the Pixi root stays at rest when the canvas already rides the camera element', () => {
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const { h, f, root } = run({ camera, total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.impactAt + 20, 4);
    expect(h.mirrorsCamera).toBe(false);
    expect(camera.style.transform).toContain('scale(');
    const layer = root.children[0] as Container;
    expect(layer.scale.x).toBe(1);
    expect(layer.position.x).toBe(0);
    h.cancel();
    const b = run({ total: 40, formation: formationOf([40], 40) }); // a bare camera (no canvas inside): mirrored
    b.f.tick(b.h.plan.shadowAt + 20, 4);
    expect(b.h.mirrorsCamera).toBe(true);
    b.h.cancel();
  });

  it('finish() lands once and restores, mid-fall and mid-squash; cancel() never lands and restores', () => {
    const a = run();
    a.f.tick(200, 16);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(a);
    const flat = run({ total: 40, formation: formationOf([40], 40) });
    flat.f.tick(flat.h.plan.impactAt + 100, 8);
    expect(flat.defenderEl.style.transform).toContain('scale(');
    flat.h.finish();
    expect(flat.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(flat);
    expect(flat.root.children).toHaveLength(0);
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.impactAt - 60, 8);
    b.h.cancel();
    expect(b.onImpact).not.toHaveBeenCalled();
    expect(b.f.hooked()).toBe(0);
    expectRestored(b);
    const c = run({ total: 40, formation: formationOf([40], 40) });
    c.f.tick(c.h.plan.impactAt + 100, 8);
    c.h.cancel();
    expect(c.onImpact).toHaveBeenCalledTimes(1); // it had already landed; a cancel adds nothing
    expectRestored(c);
    expect(c.root.children).toHaveLength(0);
  });

  it('a replay plays the same; a different roll seed scatters differently', () => {
    const keysOf = (r: ReturnType<typeof run>): string => {
      r.f.tick(r.h.plan.impactAt + 60, 8);
      const out: string[] = [];
      const walk = (c: Container): void => { for (const ch of c.children) { if (ch.visible && ch.children.length === 0) out.push(`${ch.position.x.toFixed(2)},${ch.position.y.toFixed(2)}`); walk(ch as Container); } };
      walk(r.root);
      r.h.cancel();
      return out.join(' ');
    };
    const o = { total: 40, formation: formationOf([40], 40), rollSeed: 1234 };
    const x = run(o), y = run(o), z = run({ ...o, rollSeed: 99 });
    expect(x.h.plan).toEqual(y.h.plan);
    const kx = keysOf(x), ky = keysOf(y), kz = keysOf(z);
    expect(kx.length).toBeGreaterThan(100);
    expect(kx).toBe(ky);
    expect(kz).not.toBe(kx);
  });

  it('reduced motion: no scene, no camera, no squash; the blow still lands once', () => {
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });
});

describe('the scene (headless Pixi)', () => {
  const make = (): HeroAnvilScene => {
    const scene = new HeroAnvilScene(TEX, { dust: 0xd9cdb8, spark: 0xfff1b8, shadow: 0x05060a, side: 0xffd76a },
      { shadowAlpha: 0.6, tipMs: 640, tipSpeed: 620, tipGravity: 2600, keySpeed: 760, keyGravity: 2300 }, 1, 7);
    scene.setTarget({ x: 800, y: 500 }, 100);
    return scene;
  };

  it('pools, stays under the cap at the caps, drains, and destroy leaves nothing', () => {
    const scene = make();
    scene.cue({ x: 200, y: 800 }, 100);
    scene.startShadow(1.7, 700);
    for (let i = 0; i < 30; i++) scene.update(16);
    scene.drop('piano', 2.7, 240, -300);
    for (let i = 0; i < 15; i++) scene.update(16);
    scene.land({ dust: 30, keys: 20, big: true });
    expect(scene.liveKeys).toBe(20);
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_ANVIL_SPRITES);
    scene.setSquash(0.2);
    scene.update(16);
    expect(scene.objectAt!.y).toBeCloseTo(500 + 100 * anvilRestOffset(0.2), 3);
    scene.pop(-1);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    expect(scene.objectState).toBeNull();
    const pooled = scene.pooledSprites;
    scene.startShadow(1, 400);
    scene.drop('anvil', 1.9, 200, -200);
    expect(scene.pooledSprites).toBe(pooled); // reused, not grown
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });

  it('the keys bounce on the ground line and never fall through it; nothing is left if a beat is skipped', () => {
    const scene = make();
    scene.drop('piano', 2.7, 200, -300);
    scene.land({ dust: 0, keys: 12, big: true });
    const body = scene.root.children.find((c) => c.label === 'heroAnvil-body') as Container;
    let lowest = -Infinity;
    for (let i = 0; i < 60; i++) { scene.update(16); for (const s of body.children) if (s.visible) lowest = Math.max(lowest, s.position.y); }
    expect(lowest).toBeLessThanOrEqual(500 + 100 * 1.25 + 0.5);
    // No pop ever comes (a skipped beat): the resting object and a growing shadow still clear themselves.
    const stray = make();
    stray.startShadow(1, 300);
    stray.drop('anvil', 1.9, 200, -200);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = stray.update(16);
    expect(alive).toBe(false);
    expect(stray.liveSprites).toBe(0);
  });
});
