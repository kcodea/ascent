// @vitest-environment jsdom
/**
 * THE BACKSTAB HERO ATTACK (a Rare; owner 2026-09-29: "portrait fades and attacks from behind the target back towards
 * the player portrait and settles. the larger version can do a "normal" lunge attack then vanish into smoke and hit from
 * the side, then vanish and hit from behind again"): the shared tiers on TWO visual tiers; the tuner values; the pure
 * plan (small: fade, behind, stab; big: lunge tick, side tick, behind impact); the geometry (behind is PAST the target,
 * the side is off its flank, both kept on screen, every stab drives at the target); the pure pose (hidden in the
 * shadows, visible at each strike, home at rest); the runner (the blow lands exactly ONCE; the portrait's transform,
 * opacity and z-order restored exactly on the end, finish and cancel; the camera applied once); the scene; the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_BACKSTAB_DEFAULTS, HERO_BACKSTAB_RANGES, backstabCues, backstabGeo, backstabLevel, backstabPlan, backstabPose, clampHeroBackstabValue,
  fitSpot, heroBackstabConfigJson, type HeroBackstabNumKey, type LungeGeo,
} from './heroBackstabConfig';
import { HeroBackstabScene, MAX_BACKSTAB_SPRITES, type HeroBackstabTextures } from './heroBackstabScene';
import { playHeroBackstab, type HeroBackstabOptions } from './heroBackstab';
import { SPEC } from '../HeroBackstabTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBackstabTextures = { glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W, smoke: W, slash: W };
const C = HERO_BACKSTAB_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => backstabPlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const A = { x: 960, y: 900 }, D = { x: 960, y: 200 };
const R = 80;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
const LUNGE: LungeGeo = { back: { x: 0, y: 60 }, strike: { x: 0, y: -560 }, tilt: 6, swell: 1.2, ease: (u) => u * u };

describe('the tiers: the shared four onto a Rare\'s two', () => {
  it('uses the shared thresholds; I-II small, III-IV big; a knockout big', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).level, `dmg ${d}`).toBe(tierOf(d) >= 3 ? 'big' : 'small');
    expect([1, 2, 3, 4].map((t) => backstabLevel(t as 1 | 2 | 3 | 4))).toEqual(['small', 'small', 'big', 'big']);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, level: 'big' });
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top', () => {
    for (const [k, [min, max]] of Object.entries(HERO_BACKSTAB_RANGES)) {
      const v = C[k as HeroBackstabNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroBackstabValue('behindGap', 99)).toBe(2.5);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroBackstabConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('backstab');
  });
});

describe('the plan', () => {
  it('SMALL: fade out of the slot, step out behind, ONE stab (THE impact), home and settle', () => {
    const p = plan(3);
    expect(p.lunge).toBeNull();
    expect(p.blinks.map((b) => b.spot)).toEqual(['behind']);
    expect(p.hits).toEqual([]);
    expect(p.impactAt).toBe(p.blinks[0]!.hitAt);
    expect(p.fadeOutEnd).toBeLessThan(p.blinks[0]!.appearAt);
    expect(p.homeAt).toBeGreaterThan(p.blinks[0]!.vanishEnd);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(1800);
  });

  it('BIG: a lunge (tick), a stab from the side (tick), a stab from BEHIND (THE impact), in that order', () => {
    const p = plan(14);
    expect(p.lunge).not.toBeNull();
    expect(p.blinks.map((b) => b.spot)).toEqual(['side', 'behind']);
    expect(p.hits).toEqual([p.lunge!.hitAt, p.blinks[0]!.hitAt]);
    expect(p.impactAt).toBe(p.blinks[1]!.hitAt);
    expect(p.lunge!.vanishEnd).toBeLessThan(p.blinks[0]!.appearAt);
    expect(p.blinks[0]!.vanishEnd).toBeLessThan(p.blinks[1]!.appearAt);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(2700);
    const kinds = backstabCues(p).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'vanish')).toHaveLength(3);
  });

  it('reduced motion: the portrait never moves; the blow lands at the end of the formation', () => {
    const p = plan(14, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([14], true));
    const g = backstabGeo(A, D, R, R, FRAME, LUNGE, C);
    for (let t = 0; t < p.endAt + 200; t += 50) expect(backstabPose(p, g, C, A, t)).toMatchObject({ x: 0, y: 0, alpha: 1, scale: 1 });
  });
});

describe('the geometry', () => {
  it('BEHIND is past the target along the line from the striker; the SIDE is off its flank; each stab drives at the target', () => {
    const D = { x: 960, y: 420 }; // room behind it
    const g = backstabGeo(A, D, R, R, FRAME, LUNGE, C);
    // behind: further from the striker than the target, on the far side
    expect(g.behind.at.y).toBeLessThan(D.y);
    expect(Math.hypot(g.behind.at.x - A.x, g.behind.at.y - A.y)).toBeGreaterThan(Math.hypot(D.x - A.x, D.y - A.y));
    // the stab from behind heads BACK toward the striker's side
    expect(g.behind.dir.y).toBeGreaterThan(0.9);
    // the side is off the flank (perpendicular-ish to the line)
    expect(Math.abs(g.side.dir.y)).toBeLessThan(0.5);
    for (const s of [g.side, g.behind]) {
      // the stab's line passes through the target's centre, and the contact lands on the target
      const toD = { x: D.x - s.at.x, y: D.y - s.at.y };
      const L = Math.hypot(toD.x, toD.y);
      expect(toD.x / L).toBeCloseTo(s.dir.x, 6);
      expect(toD.y / L).toBeCloseTo(s.dir.y, 6);
      expect(Math.hypot(s.contact.x - D.x, s.contact.y - D.y)).toBeLessThanOrEqual(2 * R);
    }
  });

  it('a target at the TOP edge: "behind" comes in closer and swings round to stay (mostly) on screen, and still stabs at the target', () => {
    const d = { x: 960, y: 90 };
    const g = backstabGeo(A, d, R, R, FRAME, LUNGE, C);
    const m = R * 0.9 * 0.45; // the centre at least this far inside: most of the portrait on screen
    for (const s of [g.side, g.behind]) {
      expect(s.at.x).toBeGreaterThanOrEqual(m - 1e-6);
      expect(s.at.x).toBeLessThanOrEqual(1920 - m + 1e-6);
      expect(s.at.y).toBeGreaterThanOrEqual(m - 1e-6);
      expect(s.at.y).toBeLessThanOrEqual(1080 - m + 1e-6);
      expect(Math.hypot(s.contact.x - d.x, s.contact.y - d.y)).toBeLessThanOrEqual(2 * R);
      // and the stab still travels
      expect(Math.hypot(s.contact.x - s.at.x, s.contact.y - s.at.y)).toBeGreaterThan(R * 0.5);
    }
    // a corner: still inside (clamped as a last resort)
    const p = fitSpot({ x: 20, y: 20 }, { x: -0.7, y: -0.7 }, 200, FRAME, 72);
    expect(p.x).toBeGreaterThanOrEqual(72);
    expect(p.y).toBeGreaterThanOrEqual(72);
  });
});

describe('the pose', () => {
  it('SMALL: visible at rest, HIDDEN in the shadows, visible striking from behind, home at rest when it ends', () => {
    const p = plan(3);
    const g = backstabGeo(A, D, R, R, FRAME, LUNGE, C);
    const at = (t: number) => backstabPose(p, g, C, A, t);
    expect(at(p.chargeAt - 1)).toMatchObject({ x: 0, y: 0, alpha: 1 });
    expect(at(p.fadeOutEnd + 5).alpha).toBe(0);
    const b = p.blinks[0]!;
    const hit = at(b.hitAt);
    expect(hit.alpha).toBe(1);
    expect(Math.hypot(A.x + hit.x - g.behind.contact.x, A.y + hit.y - g.behind.contact.y)).toBeLessThan(2);
    expect(at(b.vanishEnd + 5).alpha).toBe(0);
    expect(at(p.endAt)).toMatchObject({ x: 0, y: 0, alpha: 1, scale: 1, rot: 0 });
  });

  it('BIG: the lunge is Classic\'s swing (coils back, drives to its contact), then the side, then behind', () => {
    const p = plan(14);
    const g = backstabGeo(A, D, R, R, FRAME, LUNGE, C);
    const at = (t: number) => backstabPose(p, g, C, A, t);
    const coil = at(p.lunge!.strikeAt - 1);
    expect(coil.y).toBeGreaterThan(0); // coiled back (away from the target, which is up)
    const contact = at(p.lunge!.hitAt);
    expect(contact.y).toBeCloseTo(LUNGE.strike.y, 0);
    const side = at(p.blinks[0]!.hitAt);
    expect(Math.hypot(A.x + side.x - g.side.contact.x, A.y + side.y - g.side.contact.y)).toBeLessThan(2);
    const back = at(p.blinks[1]!.hitAt);
    expect(Math.hypot(A.x + back.x - g.behind.contact.x, A.y + back.y - g.behind.contact.y)).toBeLessThan(2);
  });
});

function manualFrames(): { frames: HeroBackstabOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBackstabOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  attackerEl.style.transform = 'translateX(3px)';
  attackerEl.style.opacity = '0.95';
  camera.append(attackerEl, defenderEl);
  document.body.append(host, camera);
  const h = playHeroBackstab({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: { x: 960, y: 900 }, defender: { x: 960, y: 200 }, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock, the portrait restored)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  it('BIG: the lunge and the side stab are ticks; the blow lands ONCE from behind; the portrait is put back EXACTLY', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(host.querySelector('.hblast.hbackstab')).not.toBeNull();
    f.tick(h.plan.lunge!.hitAt + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true); // raised over the target
    expect(attackerEl.style.transform).toContain('translate(');
    f.tick(h.plan.lunge!.vanishEnd - h.elapsed() + 20, 4);
    expect(Number(attackerEl.style.opacity)).toBe(0); // in the shadows
    f.tick(h.plan.blinks[0]!.hitAt - h.elapsed() + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(attackerEl.style.opacity).toBe('0.95'); // fully visible again: its own resting opacity
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    expect(defenderEl.style.transform).toContain('translate(');
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(attackerEl.style.transform).toBe('translateX(3px)');
    expect(attackerEl.style.opacity).toBe('0.95');
    expect(defenderEl.style.transform).toBe('');
    expect(camera.style.transform).toBe('');
    expect(document.body.classList.contains('duel-attacker-player')).toBe(false);
    expect(host.querySelector('.hblast')).toBeNull();
    f.tick(3000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('cancel() mid-vanish and finish() mid-strike both put the portrait back exactly (cancel never lands the blow)', () => {
    const a = run({ total: 3, formation: formationOf([3], 3) });
    a.f.tick(a.h.plan.fadeOutEnd - 20, 4);
    expect(Number(a.attackerEl.style.opacity)).toBeLessThan(0.5);
    a.h.cancel();
    expect(a.onImpact).not.toHaveBeenCalled();
    expect(a.attackerEl.style.opacity).toBe('0.95');
    expect(a.attackerEl.style.transform).toBe('translateX(3px)');
    expect(document.body.classList.contains('duel-attacker-player')).toBe(false);
    expect(a.f.hooked()).toBe(0);
    const b = run({ total: 40, formation: formationOf([40], 40), side: 'opp', attacker: { x: 960, y: 200 }, defender: { x: 960, y: 900 } });
    b.f.tick(b.h.plan.blinks[0]!.strikeAt + 20, 4);
    b.h.finish();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expect(b.attackerEl.style.opacity).toBe('0.95');
    expect(b.attackerEl.style.transform).toBe('translateX(3px)');
    expect(document.body.classList.contains('duel-attacker-opp')).toBe(false);
  });

  it('both directions at every tier, within the cap; the camera applied once; a replay is identical; reduced motion', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 960, y: 900 } : { x: 960, y: 200 };
        const d = side === 'player' ? { x: 960, y: 200 } : { x: 960, y: 900 };
        const { h, f, onImpact, attackerEl } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.endAt + 100; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_BACKSTAB_SPRITES);
        expect(attackerEl.style.opacity).toBe('0.95');
        h.cancel();
      }
    }
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const c = run({ camera, total: 40, formation: formationOf([40], 40) });
    c.f.tick(c.h.plan.impactAt + 20, 4);
    expect(c.h.mirrorsCamera).toBe(false);
    expect((c.root.children[0] as Container).scale.x).toBe(1);
    c.h.cancel();
    const x = run({ total: 40, formation: formationOf([40], 40) });
    const y = run({ total: 40, formation: formationOf([40], 40) });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.geo.behind).toEqual(y.h.geo.behind);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.attackerEl.style.transform).toBe('translateX(3px)');
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, drains, and destroy leaves nothing', () => {
    const scene = new HeroBackstabScene(TEX, { smoke: 0x2b2438, shadow: 0x120d1c, violet: 0x9b6bff, teal: 0x3de0d0, flash: 0xf2eaff, side: 0xb99bff }, 1, 9);
    for (let i = 0; i < 3; i++) { scene.vanish(A, R, 2); scene.appear(D, R, 2); scene.slash(D, { x: 0, y: 1 }, 3, i === 2); }
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_BACKSTAB_SPRITES);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});

describe('the cosmetic', () => {
  it('Shadow Step (attack_backstab) is a RARE crate hero attack that plays the backstab', () => {
    expect(COSMETIC_INDEX.attack_backstab).toMatchObject({ category: 'hero_attack', rarity: 'rare', name: 'Shadow Step', assets: { style: 'backstab' }, active: true });
    expect(HERO_ATTACK_STYLES).toContain('backstab');
    expect(styleOfCosmetic('attack_backstab')).toBe('backstab');
  });
});
