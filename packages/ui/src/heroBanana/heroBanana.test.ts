// @vitest-environment jsdom
/**
 * THE BANANA CANNON HERO ATTACK (owner 2026-09-29: "i would love a king oona banana cannon animation. use the same 4
 * tier strategy we have been."): the tier mapping SHARED with every style; the tier -> shots ladder (1 / 2 / a barrage
 * of 6 / three warm-ups and the GIANT golden banana); the tuner defaults + clamping; the pure plan (the total is the
 * engine's number, the pump-and-fire rhythm, the impact beat, the royal shot at IV, reduced motion, determinism); the
 * pure cannon + banana paths (a high ballistic lob from the cannon's muzzle that comes down onto the struck portrait; the
 * giant leaves the frame and comes back); the camera; the runner on the shared clock (the consequence lands exactly
 * ONCE, on the last banana or the slam, never on a tick; both directions; slow motion; replay; finish / cancel; cleanup;
 * stuck peels ride the knockback); the headless scene (pooled, bounded, drains, destroy leaves nothing); and the
 * cosmetic resolution (the other styles unchanged).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_BLAST_DEFAULTS, blastPlan } from '../heroBlast/heroBlastConfig';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  BANANA_CAPS, HERO_BANANA_DEFAULTS, HERO_BANANA_RANGES, bananaCameraAt, bananaCameraFocus, bananaCues, bananaFlightMs, bananaPlan,
  bananaPos, cannonRig, clampHeroBananaValue, heroBananaConfigJson, sanitizeHeroBananaConfig, shotSlots,
  type HeroBananaConfig, type HeroBananaNumKey,
} from './heroBananaConfig';
import { HeroBananaScene, MAX_BANANA_SPRITES, type HeroBananaTextures } from './heroBananaScene';
import { bananaSeed, playHeroBanana, type HeroBananaOptions } from './heroBanana';
import { SPEC } from '../HeroBananaTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBananaTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  cannonBarrel: W, cannonTrim: W, cannonDark: W, cannonGlow: W, bananaBody: W, bananaEnds: W, bananaShine: W, bananaGlow: W,
  peel: W, chunk: W, impactStar: W, mush: W, leaf: W, puff: W, disc: W, shock: W,
};
const C = HERO_BANANA_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => bananaPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { banana: 0xffd83d, gold: 0xf0b429, barrel: 0x3f7d2a, dark: 0x4a2a12, cream: 0xfff2c2, smoke: 0xefe6cf, leaf: 0x4fae3a, side: 0xffd83d };
const LOOK = {
  cannonLength: 170, popMs: 240, recoil: 26, puffs: 6, leaves: 5, bananaLength: 74, trailAlpha: 0.45, tickChunks: 8, starSize: 1,
  peelHoldMs: 620, gravity: 1400, showerBananas: 12, shockSize: 1, goldRays: 10,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);
const regular = (p: ReturnType<typeof plan>) => p.shots.filter((s) => !s.giant);

describe('the damage tiers (shared with every style)', () => {
  it('the cannon steps up on exactly the blows Blast does: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(blastPlan({ total: d, distance: 1600 }, HERO_BLAST_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE banana, II a DOUBLE shot, III a rapid BARRAGE of six, IV three warm-ups then the GIANT golden banana', () => {
    expect([P1, P2, P3, P4].map((p) => regular(p).length)).toEqual([1, 2, 6, 3]);
    expect([P1, P2, P3, P4].map((p) => p.giant)).toEqual([false, false, false, true]);
    expect(P4.shots[P4.shots.length - 1]!.giant).toBe(true);
    expect(P4.shots.filter((s) => s.giant)).toHaveLength(1);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.giant ? 'giant' : p.shots.length; }))
      .toEqual([1, 1, 2, 2, 6, 6, 'giant', 'giant']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_BANANA_RANGES)) {
      const v = C[k as HeroBananaNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorBanana', 'colorGold', 'colorBarrel', 'colorDark', 'colorCream', 'colorSmoke', 'colorLeaf', 'colorPlayer', 'colorFoe'] as const) {
      expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroBananaValue('t3Shots', 99)).toBe(8);
    expect(clampHeroBananaValue('t1Shots', 0)).toBe(1);
    expect(clampHeroBananaValue('bananaLength', -3)).toBe(30);
    expect(clampHeroBananaValue('giantFlightMs', 99999)).toBe(2000);
    expect(clampHeroBananaValue('trailAlpha', 5)).toBe(1);
    expect(clampHeroBananaValue('spinTurns', Number.NaN)).toBe(C.spinTurns);
    expect(clampHeroBananaValue('spinTurns', 'abc')).toBe(C.spinTurns);
    expect(clampHeroBananaValue('spinTurns', '2')).toBe(2);
    expect(clampHeroBananaValue('colorBanana', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroBananaValue('colorPlayer', 'yellow')).toBe(C.colorPlayer);
    expect(clampHeroBananaValue('sfxFireClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroBananaValue('nope' as keyof HeroBananaConfig, 1)).toBeUndefined();
    expect(clampHeroBananaValue('toString' as keyof HeroBananaConfig, 1)).toBeUndefined();
    const s = sanitizeHeroBananaConfig({ t4Chunks: 400, colorGold: 'x', bogus: 3 });
    expect(s.t4Chunks).toBe(80);
    expect(s.colorGold).toBe(C.colorGold);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroBananaConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers the Banana Cannon', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroBananaConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Giant).toBe(1);
    expect(json.t3Shots).toBe(6);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('banana');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('banana');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe huge (40)', '▶ Reduced motion', 'Speed 1x', 'Speed 0.5x', 'Speed 0.25x']) {
      expect(labels).toContain(l);
    }
    // No hit-stop / freeze control anywhere (owner 2026-09-28).
    expect(SPEC.controls.map((c) => `${c.key} ${c.label}`).join(' ')).not.toMatch(/hit-?stop|freeze/i);
  });
});

describe('the plan', () => {
  it('THE BARRAGE: six bananas splat in in rhythm, the first five are ticks, the LAST is the impact (only one impact beat)', () => {
    const arr = P3.shots.map((d) => d.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!, `arrival ${i}`).toBeGreaterThan(arr[i - 1]!);
    const gaps = arr.slice(1).map((a, i) => a - arr[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(40); // an even rhythm
    expect(P3.impactAt).toBe(arr[arr.length - 1]);
    expect(P3.hits).toEqual(arr.slice(0, -1));
    const kinds = bananaCues(P3).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'fire')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'pump')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('hit')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds).not.toContain('glint');
    // the cannon PUMPS before every shot (the "chk"), and every pump comes after the cannon appeared
    for (const s of P3.shots) { expect(s.pumpAt).toBeLessThan(s.fireAt); expect(s.pumpAt).toBeGreaterThan(P3.chargeAt); }
  });

  it('Tier II is a double shot (one tick, then the impact); Tier I one banana, straight to the impact', () => {
    expect(P2.shots[1]!.fireAt - P2.shots[0]!.fireAt).toBeLessThanOrEqual(300);
    expect(P2.hits).toHaveLength(1);
    expect(P2.impactAt).toBe(P2.shots[1]!.arriveAt);
    expect(P1.shots).toHaveLength(1);
    expect(P1.hits).toEqual([]);
    expect(P1.impactAt).toBe(P1.shots[0]!.arriveAt);
  });

  it('Tier IV: every warm-up banana is a tick; then the glint, the giant fires, the mark, and the SLAM is the impact', () => {
    const kinds = bananaCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'hit')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    const g = P4.shots[P4.shots.length - 1]!;
    const firesBefore = P4.shots.filter((s) => !s.giant).map((s) => s.fireAt);
    expect(Math.max(...firesBefore)).toBeLessThan(P4.glintAt);
    expect(P4.glintAt).toBeLessThan(g.pumpAt);
    expect(g.pumpAt).toBeLessThan(g.fireAt);
    expect(g.fireAt).toBe(P4.glintAt + C.giantChargeMs);
    expect(P4.markAt).toBeGreaterThan(g.fireAt);
    expect(P4.markAt).toBeLessThan(P4.impactAt);
    expect(P4.impactAt).toBe(g.arriveAt);
    for (const h of P4.hits) expect(h).toBeLessThan(P4.impactAt);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(at('glint')).toBeLessThan(at('mark'));
    expect(at('mark')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('boom'));
    expect(P4.booms).toHaveLength(3);
  });

  it('every tier escalates: more shake, zoom, chunks, splat, peels and dim', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      for (const k of ['shakePx', 'zoom', 'chunks', 'burst', 'peels', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    }
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1600 px apart): first shot, impact and end, ms from the summon', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.fireAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual([
      [380, 920, 1484], [400, 1181, 1765], [440, 1545, 2169], [460, 2260, 3160],
    ]);
    // Chunky, not rushed, never dragging: Tier I about 1.5 s, Tier IV about 3 s.
    expect(t(P1)[2]).toBeLessThanOrEqual(2000);
    expect(t(P4)[2]).toBeLessThanOrEqual(3300);
  });

  it('the barrage fires outer shots first and the centre last', () => {
    expect(shotSlots(1)).toEqual([0]);
    expect(shotSlots(2)).toEqual([-1, 1]);
    expect(shotSlots(3)).toEqual([-1, 1, 0]);
    expect(shotSlots(6)[5]).toBe(0);
  });

  it('the caps always hold, whatever the sliders say; flight scales gently with distance', () => {
    const wild: HeroBananaConfig = { ...C, t3Shots: 8, t4Chunks: 80, t4Shake: 40, t4Zoom: 0.14, t4Peels: 12 };
    expect(bananaPlan({ total: 15, distance: 800 }, wild).shots.length).toBeLessThanOrEqual(BANANA_CAPS.shots);
    expect(bananaPlan({ total: 99, distance: 800 }, wild).chunks).toBeLessThanOrEqual(BANANA_CAPS.chunks);
    expect(bananaPlan({ total: 99, distance: 800 }, wild).peels).toBeLessThanOrEqual(BANANA_CAPS.peels);
    expect(bananaFlightMs(1600, 500)).toBe(500);
    expect(bananaFlightMs(100, 500)).toBe(310);
    expect(bananaFlightMs(99999, 500)).toBe(575);
  });

  it('reduced motion: no cannon, bananas, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.shots.length]).toEqual([0, 0, 0, 0]);
    const kinds = bananaCues(p).map((q) => q.kind);
    for (const k of ['charge', 'pump', 'fire', 'hit', 'glint', 'mark', 'stow']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(bananaCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(cannonRig(p, A, D, R, R, C).shots).toEqual([]);
  });

  it('is deterministic: the same fight plans the same beats and the same paths (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(bananaCues(plan([4, 2, 3], 9, 720))).toEqual(bananaCues(plan([4, 2, 3], 9, 720)));
    expect(cannonRig(P4, A, D, R, R, C)).toEqual(cannonRig(P4, A, D, R, R, C));
    expect(bananaSeed(14, 1500.2, 'player')).toBe(bananaSeed(14, 1500.4, 'player'));
    expect(bananaSeed(14, 1500, 'player')).not.toBe(bananaSeed(14, 1500, 'opp'));
  });
});

describe('the cannon and the banana paths', () => {
  it('the cannon sits on the striking hero\'s rim toward the target, tipped up; the banana leaves its MUZZLE on the cannon\'s heading', () => {
    const rig = cannonRig(P1, A, D, R, R, C);
    expect(Math.hypot(rig.pivot.x - A.x, rig.pivot.y - A.y)).toBeCloseTo(R * 0.8, 5);
    expect(Math.sin(rig.rest)).toBeLessThan(Math.sin(Math.atan2(D.y - A.y, D.x - A.x))); // tipped up toward the top
    const m = rig.shots[0]!;
    expect(Math.hypot(m.a.x - rig.pivot.x, m.a.y - rig.pivot.y)).toBeCloseTo(rig.muzzle, 0);
    const lead = bananaPos(m, 1);
    expect(Math.abs(Math.atan2(Math.sin(lead.heading - m.dir), Math.cos(lead.heading - m.dir)))).toBeLessThan(0.05);
  });

  it('a banana is LOBBED: a high ballistic arc (even sideways speed, falling faster) that comes down onto the struck portrait', () => {
    const [m] = cannonRig(P1, A, D, R, R, C).shots;
    const end = bananaPos(m!, m!.flightMs);
    expect(Math.hypot(end.x - D.x, end.y - D.y)).toBeLessThanOrEqual(R * 0.6); // on the face
    expect(bananaPos(m!, m!.flightMs + 500)).toMatchObject({ x: end.x, y: end.y });
    // a real lob: the midpoint rises well above the straight line
    const mid = bananaPos(m!, m!.flightMs / 2);
    const lineY = (m!.a.y + m!.b.y) / 2;
    expect(lineY - mid.y).toBeGreaterThan(0.08 * Math.hypot(D.x - A.x, D.y - A.y));
    // even sideways speed (a quadratic at a linear parameter is a true parabola)
    const x1 = bananaPos(m!, m!.flightMs * 0.25).x - bananaPos(m!, 0).x;
    const x2 = bananaPos(m!, m!.flightMs).x - bananaPos(m!, m!.flightMs * 0.75).x;
    expect(Math.abs(x1 - x2)).toBeLessThan(Math.abs(x1) * 0.25 + 1);
    // and it comes DOWN into the face (heading below the horizontal, toward the bottom of the screen)
    expect(Math.sin(end.heading)).toBeGreaterThan(0);
    // it tumbles
    expect(Math.abs(end.rot - bananaPos(m!, 0).rot)).toBeGreaterThan(Math.PI);
  });

  it('a barrage splats at spread positions across the face (never one stack), clear of the middle', () => {
    const shots = cannonRig(P3, A, D, R, R, C).shots;
    for (let i = 0; i < shots.length; i++) for (let j = i + 1; j < shots.length; j++) {
      expect(Math.hypot(shots[i]!.b.x - shots[j]!.b.x, shots[i]!.b.y - shots[j]!.b.y), `${i}-${j}`).toBeGreaterThan(R * 0.08);
    }
    for (const m of shots) expect(Math.hypot(m.b.x - D.x, m.b.y - D.y)).toBeLessThanOrEqual(R * 0.6);
  });

  it('Tier IV: the GIANT is lobbed far higher than the warm-ups, may leave the top of the frame, and slams DEAD CENTRE', () => {
    const rig = cannonRig(P4, A, D, R, R, C, C.cannonLength, 36);
    const g = rig.shots[rig.shots.length - 1]!;
    expect(g.giant).toBe(true);
    expect(g.b).toEqual(D);
    const apex = (m: typeof g): number => { let y = Infinity; for (let t = 0; t <= m.flightMs; t += 8) y = Math.min(y, bananaPos(m, t).y); return y; };
    expect(apex(g)).toBeLessThan(apex(rig.shots[0]!) - 100);
    expect(apex(g)).toBeLessThan(36); // out of the top of the frame
    expect(apex(g)).toBeGreaterThanOrEqual(36 - C.giantOvershoot - 1); // but never past the overshoot
    for (const m of rig.shots.slice(0, -1)) expect(m.c.y).toBeGreaterThanOrEqual(36); // the warm-ups stay in frame
  });

  it('works both ways: a foe cannon fires from the top down onto you', () => {
    const rig = cannonRig(P2, D, A, R, R, C);
    expect(Math.hypot(rig.pivot.x - D.x, rig.pivot.y - D.y)).toBeCloseTo(R * 0.8, 5);
    for (const m of rig.shots) {
      const end = bananaPos(m, m.flightMs);
      expect(Math.hypot(end.x - A.x, end.y - A.y)).toBeLessThanOrEqual(R * 0.6);
    }
  });
});

describe('the camera', () => {
  it('pushes in through the summon, punches in on the impact and shakes ALONG the banana; rests by the end', () => {
    const dir = { x: 0.6, y: 0.8 };
    const hit = bananaCameraAt(P3, C, P3.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P3.zoom);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = bananaCameraAt(P3, C, P3.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.8);
  });

  it('Tier IV pushes in on the glint, EASES OUT as the giant climbs, and the slam punches hardest; focus follows the giant down', () => {
    const g = P4.shots[P4.shots.length - 1]!;
    const glint = bananaCameraAt(P4, C, g.fireAt - 5);
    const climb = bananaCameraAt(P4, C, g.fireAt + g.flightMs * 0.45);
    expect(climb.zoom).toBeLessThan(glint.zoom);
    const slam = bananaCameraAt(P4, C, P4.impactAt + 1);
    expect(slam.zoom).toBeGreaterThan(bananaCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(bananaCameraFocus(P4, P4.fireAt, A, D)).toEqual(A);
    expect(bananaCameraFocus(P4, g.fireAt, A, D)).toEqual(A);
    expect(bananaCameraFocus(P4, P4.impactAt, A, D)).toEqual(D);
    expect(bananaCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
    let peak = 1;
    for (let t = P4.chargeAt; t < P4.endAt; t += 8) peak = Math.max(peak, bananaCameraAt(P4, C, t).zoom);
    expect(peak).toBeLessThan(1.3);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroBananaOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBananaOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBanana({
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

  it('THE BARRAGE lands the blow EXACTLY ONCE, on the LAST banana: never on a tick; peels stick; the cannon pops away; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.shots).toHaveLength(6);
    expect(host.querySelector('.hblast.hbanana')).not.toBeNull();
    f.tick(h.plan.chargeAt + 40, 4);
    expect(h.scene!.cannonUp).toBe(true);
    f.tick(h.plan.hits[h.plan.hits.length - 1]! - h.elapsed() + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.stuckPeels).toBeGreaterThanOrEqual(3);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.cannonUp).toBe(false); // stowed
    expect(h.scene!.liveBananas).toBe(0);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16); // the peels and chunks drain, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: the warm-ups splat (ticks), the crown glints, the giant flies, the ring locks on, and the blow lands ONCE on the SLAM', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.giant).toBe(true);
    f.tick(h.plan.glintAt + 40, 4);
    expect(h.scene!.glinting).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.markAt - h.elapsed() + 20, 4);
    expect(h.scene!.glinting).toBe(false); // released by the giant's shot
    expect(h.scene!.marking).toBe(true);
    expect(h.scene!.liveBananas).toBe(1); // the giant, in flight
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.marking).toBe(false);
    expect(h.scene!.liveBananas).toBe(0);
    expect(h.scene!.stuckPeels).toBeGreaterThanOrEqual(h.plan.peels);
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_BANANA_SPRITES);
    f.tick(h.plan.endAt + 3000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck), inside the sprite cap', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_BANANA_SPRITES);
        for (const m of h.rig.shots) expect(Math.hypot(m.b.x - d.x, m.b.y - d.y)).toBeLessThanOrEqual(R * 0.6); // into the struck hero
        expect(Math.hypot(h.rig.pivot.x - a.x, h.rig.pivot.y - a.y)).toBeLessThanOrEqual(R); // fired from the attacker
        h.cancel();
      }
    }
  });

  it('the cannon FLIPS to stay upright when it fires to the left (it is never drawn upside down)', () => {
    const { h, f, root } = run({ side: 'opp', attacker: { x: 1400, y: 150 }, defender: { x: 100, y: 800 }, total: 3, formation: formationOf([3], 3) });
    f.tick(h.plan.fireAt + 20, 4);
    expect(Math.cos(h.scene!.cannonRot!)).toBeLessThan(0);
    const layer = root.children[0] as Container;
    const parts = ['banana-body', 'banana-trim', 'banana-ink'].map((l) => layer.children.find((c) => c.label === l) as Container);
    // the barrel, the trim and the dark details each sit on their own layer (a fixed draw order), all flipped
    for (const l of parts) expect(l.children.some((c) => c.visible && c.scale.y < 0), l.label).toBe(true);
    h.cancel();
  });

  it('stuck peels RIDE the struck portrait\'s knockback (they never float off it)', () => {
    const { h, f, root } = run({ total: 3, formation: formationOf([3], 3) });
    f.tick(h.plan.impactAt + 40, 4);
    expect(h.scene!.stuckPeels).toBeGreaterThan(0);
    const layer = root.children[0] as Container;
    const bodies = (layer.children.find((c) => c.label === 'banana-body') as Container).children.filter((c) => c.visible);
    const m = h.rig.shots[0]!;
    // the peel at the impact point has moved with the knockback, not pinned to the resting spot
    const moved = bodies.some((b) => { const off = Math.hypot(b.x - m.b.x, b.y - m.b.y); return off > 1 && off < 40; });
    expect(moved).toBe(true);
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

  it('a replay plays the same: the same fight flies the same paths and beats', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.rig).toEqual(b.h.rig);
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
    b.f.tick(b.h.plan.glintAt + 100);
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
    expect(h.rig.shots).toEqual([]);
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
      const h = playHeroBanana({
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
  it('a whole Tier IV stays in the cap and drains; destroy leaves nothing', () => {
    const s = new HeroBananaScene(TEX, COLORS, LOOK, 1, 42);
    const rig = cannonRig(P4, A, D, R, R, C);
    s.summon(rig.pivot, rig.rest, rig.shots[0]!.dir, 240);
    for (let i = 0; i < 25; i++) s.update(16);
    let peak = 0;
    rig.shots.slice(0, -1).forEach((m, i) => { s.pump(); s.fire(m, 0.9, 0, i); });
    for (let i = 0; i < 40; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    rig.shots.slice(0, -1).forEach((_, i) => s.hit(i, D.x, D.y, R, i));
    s.glint(520);
    for (let i = 0; i < 32; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    expect(s.glinting).toBe(true);
    const g = rig.shots[rig.shots.length - 1]!;
    s.pump(1.6); s.fire(g, 2.6, 0, rig.shots.length - 1);
    expect(s.glinting).toBe(false);
    s.startMark(D.x, D.y, R, 500);
    s.stow();
    for (let i = 0; i < 40; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); }
    s.slam(rig.shots.length - 1, D.x, D.y, R, { burst: 1.9, chunks: 44, peels: 8, flashAlpha: 0.85 });
    s.boom(D.x + 40, D.y, 1); s.boom(D.x - 40, D.y, 1.1); s.boom(D.x, D.y + 40, 1.2);
    peak = Math.max(peak, s.liveSprites);
    expect(peak).toBeLessThanOrEqual(MAX_BANANA_SPRITES);
    expect(s.liveBananas).toBe(0);
    expect(s.marking).toBe(false);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.cannonUp).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('draws finite geometry every frame (no NaN at the pop, the shot, in flight, the recoil or the splat)', () => {
    const s = new HeroBananaScene(TEX, COLORS, LOOK, 1, 3);
    const rig = cannonRig(P1, A, D, R, R, C);
    s.summon(rig.pivot, rig.rest, rig.shots[0]!.dir, 240);
    s.update(16);
    s.fire(rig.shots[0]!, 1.1, 0, 0);
    for (let t = 0; t < rig.shots[0]!.flightMs + 400; t += 16) {
      s.update(16);
      for (const l of s.root.children as Container[]) {
        for (const ch of l.children) {
          if (!ch.visible) continue;
          expect(Number.isFinite(ch.x) && Number.isFinite(ch.y) && Number.isFinite(ch.rotation) && Number.isFinite(ch.scale.x) && Number.isFinite(ch.scale.y)).toBe(true);
        }
      }
    }
    s.impact(0, D.x, D.y, R, { tier: 1, k: 0, burst: 1, chunks: 10, peels: 1, flashAlpha: 0.85 });
    s.update(16);
    expect(s.liveBananas).toBe(0);
    s.destroy();
  });

  it('clear() drops everything in flight at once; the pool is reused, not regrown', () => {
    const s = new HeroBananaScene(TEX, COLORS, LOOK, 1, 9);
    const rig = cannonRig(P3, A, D, R, R, C);
    s.summon(rig.pivot, rig.rest, rig.shots[0]!.dir);
    rig.shots.forEach((m, i) => s.fire(m, 1, 0, i));
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    s.summon(rig.pivot, rig.rest, rig.shots[0]!.dir);
    rig.shots.forEach((m, i) => s.fire(m, 1, 0, i));
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 10);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('King Oona\'s Banana Cannon (attack_banana) is a Legendary crate hero attack that plays the Banana Cannon; the dev override can force it; the other styles unchanged; unknown ids play Classic', () => {
    expect(COSMETIC_INDEX.attack_banana).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: "Oona's Banana Cannon", assets: { style: 'banana' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'banana']);
    expect(styleOfCosmetic('attack_banana')).toBe('banana');
    for (const [id, st] of [['attack_blast', 'blast'], ['attack_quake', 'quake'], ['attack_poison', 'poison'], ['attack_holy', 'holy']] as const) {
      expect(styleOfCosmetic(id)).toBe(st);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_banana' })).toBe('banana');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'banana' })).toBe('banana');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_banana' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_banana_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
