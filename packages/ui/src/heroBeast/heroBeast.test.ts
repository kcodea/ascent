// @vitest-environment jsdom
/**
 * THE STAMPEDE, the beast chomp rush hero attack (owner 2026-09-29: "make some more attack types ... a beast chomp rush
 * animation ... use the same 4 tier strategy we have been"): the tier mapping SHARED with every style; the tier ->
 * beasts ladder (1 / 2 / a pack of 5 / six and the colossus); the tuner defaults + clamping; the pure plan (the total is
 * the engine's number, the pack rhythm, the impact beat, the colossus at IV, reduced motion, determinism); the jaw
 * clamp curve (the SNAP lands exactly on the bite); the pure leaps (from the attacker's rim, a leap that comes down onto
 * the struck portrait, ticks off-centre, the impact dead centre); the camera; the runner on the shared clock (the
 * consequence lands exactly ONCE, on the last chomp or the slam, never on a tick; both directions; slow motion; replay;
 * finish / cancel; cleanup); the headless scene (pooled, bounded, drains, destroy leaves nothing); and the cosmetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_BLAST_DEFAULTS, blastPlan } from '../heroBlast/heroBlastConfig';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  BEAST_CAPS, HERO_BEAST_DEFAULTS, HERO_BEAST_RANGES, beastCameraAt, beastCameraFocus, beastCues, beastFlightMs, beastMotions,
  beastPlan, beastPos, clampAlpha, clampGap, clampHeroBeastValue, colossalGap, heroBeastConfigJson, leapEase, packSlots,
  sanitizeHeroBeastConfig, type HeroBeastConfig, type HeroBeastNumKey,
} from './heroBeastConfig';
import { HeroBeastScene, MANE_POINTS, MAX_BEAST_MESHES, MAX_BEAST_SPRITES, type HeroBeastTextures } from './heroBeastScene';
import { beastSeed, playHeroBeast, type HeroBeastOptions } from './heroBeast';
import { BEAST_TUNER_PLAYS, SPEC } from '../HeroBeastTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroBeastTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  headUpper: W, headLower: W, headUpperEdge: W, headLowerEdge: W, headUpperGlow: W, headLowerGlow: W,
  jaw: W, jawEdge: W, jawGlow: W, bite: W, dust: W, disc: W, shock: W,
};
const C = HERO_BEAST_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false) => beastPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xfff6dc, amber: 0xffb53c, feral: 0x8dff4a, fang: 0xfffbea, dark: 0x2a1a08, dust: 0xb08a58, side: 0xffd24a };
const LOOK = {
  length: 190, glow: 0.75, maneMs: 120, maneWidth: 44, embers: 0.7, jawOpen: 0.62, clampLead: 120, clampSize: 1, biteHold: 340,
  biteMarkMs: 900, tint: 0.22, dustSize: 1, colossalSize: 1, roarRings: 3, roarSize: 1,
};
const A = { x: 200, y: 850 }, D = { x: 1500, y: 180 };
const R = 80;
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with every style)', () => {
  it('the Stampede steps up on exactly the blows Blast does: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(blastPlan({ total: d, distance: 1600 }, HERO_BLAST_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE beast, II TWO staggered, III a PACK of five kicking up dust, IV six and the COLOSSUS', () => {
    expect([P1, P2, P3, P4].map((p) => p.beasts.length)).toEqual([1, 2, 5, 6]);
    expect([P1, P2, P3, P4].map((p) => p.colossal)).toEqual([false, false, false, true]);
    expect([P1, P2, P3, P4].map((p) => p.dust)).toEqual([false, false, true, true]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.colossal ? 'colossus' : p.beasts.length; }))
      .toEqual([1, 1, 2, 2, 5, 5, 'colossus', 'colossus']);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_BEAST_RANGES)) {
      const v = C[k as HeroBeastNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorAmber', 'colorFeral', 'colorFang', 'colorDark', 'colorDust', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroBeastValue('t3Beasts', 99)).toBe(8);
    expect(clampHeroBeastValue('t1Beasts', 0)).toBe(1);
    expect(clampHeroBeastValue('beastLength', -3)).toBe(60);
    expect(clampHeroBeastValue('riseMs', 99999)).toBe(2000);
    expect(clampHeroBeastValue('tintAlpha', 5)).toBe(0.8);
    expect(clampHeroBeastValue('maneMs', Number.NaN)).toBe(C.maneMs);
    expect(clampHeroBeastValue('maneMs', 'abc')).toBe(C.maneMs);
    expect(clampHeroBeastValue('maneMs', '90')).toBe(90);
    expect(clampHeroBeastValue('colorAmber', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroBeastValue('colorPlayer', 'gold')).toBe(C.colorPlayer);
    expect(clampHeroBeastValue('sfxSnapClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroBeastValue('nope' as keyof HeroBeastConfig, 1)).toBeUndefined();
    expect(clampHeroBeastValue('toString' as keyof HeroBeastConfig, 1)).toBeUndefined();
    const s = sanitizeHeroBeastConfig({ t4Sparks: 400, colorCore: 'x', bogus: 3 });
    expect(s.t4Sparks).toBe(90);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroBeastConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers the Beast', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroBeastConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Colossal).toBe(1);
    expect(json.t3Beasts).toBe(5);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('beast');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('beast');
    // Owner 2026-09-29: no Speed or Reduced motion buttons, and the button row at the TOP (the shared buttonsOnTop, #1843).
    const labels = BEAST_TUNER_PLAYS.map((a) => a.label);
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe small (3)', '▶ Foe huge (40)']) expect(labels).toContain(l);
    for (const l of ['▶ Reduced motion', 'Speed 1x', 'Speed 0.5x', 'Speed 0.25x']) expect(labels).not.toContain(l);
    expect(SPEC.actions).toBe(BEAST_TUNER_PLAYS);
    expect(SPEC.buttonsOnTop).toBe(true);
    expect(SPEC.readout).toBeUndefined();
  });
});

describe('the plan', () => {
  it('THE PACK: five beasts bite in rhythm, the first four are ticks, the LAST is the impact (only one impact beat)', () => {
    const arr = P3.beasts.map((d) => d.arriveAt);
    for (let i = 1; i < arr.length; i++) expect(arr[i]!, `arrival ${i}`).toBeGreaterThan(arr[i - 1]!);
    const gaps = arr.slice(1).map((a, i) => a - arr[i]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(30); // an even chomp-chomp-chomp
    expect(P3.impactAt).toBe(arr[arr.length - 1]);
    expect(P3.chomps).toEqual(arr.slice(0, -1));
    const kinds = beastCues(P3).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'launch')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'chomp')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(kinds.lastIndexOf('chomp')).toBeLessThan(kinds.indexOf('impact'));
    expect(kinds).not.toContain('rise');
    expect(kinds).not.toContain('roar');
  });

  it('Tier II is a staggered double chomp (one tick, then the impact); Tier I one beast, straight to the impact', () => {
    expect(P2.beasts[1]!.launchAt - P2.beasts[0]!.launchAt).toBeGreaterThanOrEqual(150);
    expect(P2.beasts[1]!.arriveAt - P2.beasts[0]!.arriveAt).toBeGreaterThanOrEqual(120); // two distinct chomps, not one
    expect(P2.chomps).toHaveLength(1);
    expect(P2.impactAt).toBe(P2.beasts[1]!.arriveAt);
    expect(P1.beasts).toHaveLength(1);
    expect(P1.chomps).toEqual([]);
    expect(P1.impactAt).toBe(P1.beasts[0]!.arriveAt);
  });

  it('Tier IV: EVERY beast is a tick; then the colossus rises, and the SLAM is the impact (the one consequence); the roar comes after', () => {
    const kinds = beastCues(P4).map((q) => q.kind);
    expect(kinds.filter((k) => k === 'chomp')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(kinds.lastIndexOf('chomp')).toBeLessThan(at('rise'));
    expect(at('rise')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('roar'));
    expect(P4.riseAt).toBeGreaterThan(Math.max(...P4.beasts.map((d) => d.arriveAt)));
    expect(P4.slamAt).toBe(P4.riseAt + C.riseMs);
    expect(P4.impactAt).toBe(P4.slamAt + C.slamMs);
    expect(P4.roarAt).toBe(P4.impactAt + C.roarDelayMs);
  });

  it('every tier escalates: more shake, zoom, sparks, flash and dim', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      for (const k of ['shakePx', 'zoom', 'sparks', 'burst', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    }
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1600 px apart): first leap, impact and end, ms from the growl', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.launchAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual([
      [340, 740, 1340], [380, 989, 1629], [420, 1260, 1920], [440, 2042, 2942],
    ]);
    // Chunky, not rushed, never dragging: Tier I about 1.3 s, Tier IV under 3 s.
    expect(t(P1)[2]).toBeLessThanOrEqual(2000);
    expect(t(P4)[2]).toBeLessThanOrEqual(3000);
  });

  it('the pack launches its flanks first and the centre last', () => {
    expect(packSlots(1)).toEqual([0]);
    expect(packSlots(2)).toEqual([-1, 1]);
    expect(packSlots(5)).toEqual([-2, 2, -1, 1, 0]);
  });

  it('the caps always hold, whatever the sliders say; the leap scales gently with distance', () => {
    const wild: HeroBeastConfig = { ...C, t3Beasts: 8, t4Sparks: 90, t4Shake: 40, t4Zoom: 0.14 };
    expect(beastPlan({ total: 15, distance: 800 }, wild).beasts.length).toBeLessThanOrEqual(BEAST_CAPS.beasts);
    expect(beastPlan({ total: 99, distance: 800 }, wild).sparks).toBeLessThanOrEqual(BEAST_CAPS.sparks);
    expect(beastFlightMs(1600, 400)).toBe(400);
    expect(beastFlightMs(100, 400)).toBe(248);
    expect(beastFlightMs(99999, 400)).toBe(460);
  });

  it('reduced motion: no beasts, growl, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.beasts.length]).toEqual([0, 0, 0, 0]);
    const kinds = beastCues(p).map((q) => q.kind);
    for (const k of ['charge', 'launch', 'chomp', 'rise', 'roar']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(beastCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(beastMotions(p, A, D, R, R)).toEqual([]);
  });

  it('is deterministic: the same fight plans the same beats and the same leaps (a replay plays what the live fight did)', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(beastCues(plan([4, 2, 3], 9, 720))).toEqual(beastCues(plan([4, 2, 3], 9, 720)));
    expect(beastMotions(P4, A, D, R, R)).toEqual(beastMotions(P4, A, D, R, R));
    expect(beastSeed(14, 1500.2, 'player')).toBe(beastSeed(14, 1500.4, 'player'));
    expect(beastSeed(14, 1500, 'player')).not.toBe(beastSeed(14, 1500, 'opp'));
  });
});

describe('THE CHOMP (the jaw clamp curve)', () => {
  const lead = C.clampLeadMs, hold = C.biteHoldMs;
  it('the jaws fade in WIDE before the bite, SLAM shut (accelerating) exactly ON it, interlock, clench, then let go', () => {
    expect(clampAlpha(-lead - 1, lead, hold)).toBe(0);
    expect(clampGap(-lead, lead, hold)).toBeGreaterThan(1.2); // wide open
    expect(clampGap(0, lead, hold)).toBeLessThan(0); // shut (fangs interlocked) ON the bite
    expect(clampAlpha(0, lead, hold)).toBe(1);
    // a SNAP, not a slide: the last quarter of the lead closes more than the first three quarters together
    const q = lead / 4;
    expect(clampGap(-q, lead, hold) - clampGap(0, lead, hold)).toBeGreaterThan(clampGap(-lead, lead, hold) - clampGap(-q, lead, hold));
    // it bites a hair PAST shut, then holds clenched (never opening while it clamps)
    let lowest = 0;
    for (let ms = 0; ms < hold; ms += 5) { const g = clampGap(ms, lead, hold); lowest = Math.min(lowest, g); expect(g, `${ms}`).toBeLessThan(0); }
    expect(lowest).toBeLessThan(clampGap(0, lead, hold));
    // no jump anywhere: the curve is continuous frame to frame
    for (let ms = -lead; ms < hold + 300; ms += 2) expect(Math.abs(clampGap(ms + 2, lead, hold) - clampGap(ms, lead, hold)), `${ms}`).toBeLessThan(0.2);
    // and lets go
    expect(clampGap(hold + 220, lead, hold)).toBeGreaterThan(0.4);
    expect(clampAlpha(hold + 220, lead, hold)).toBe(0);
  });

  it('THE COLOSSUS: wide through the rise (framing the target), SHUT on the slam, sprung open by the roar, drifting apart as it goes', () => {
    const rise = C.riseMs, slam = C.slamMs, roar = rise + slam + C.roarDelayMs, rel = roar + C.roarHoldMs;
    expect(colossalGap(0, rise, slam, roar, rel)).toBeGreaterThan(2.5);
    expect(colossalGap(rise, rise, slam, roar, rel)).toBeGreaterThan(2);
    expect(colossalGap(rise + slam, rise, slam, roar, rel)).toBeLessThan(0);
    expect(colossalGap(roar - 1, rise, slam, roar, rel)).toBeLessThan(0);
    expect(colossalGap(roar + 200, rise, slam, roar, rel)).toBeGreaterThan(1);
    expect(colossalGap(rel + 300, rise, slam, roar, rel)).toBeGreaterThan(colossalGap(rel, rise, slam, roar, rel));
    for (let ms = 0; ms < rel + 360; ms += 2) expect(Math.abs(colossalGap(ms + 2, rise, slam, roar, rel) - colossalGap(ms, rise, slam, roar, rel)), `${ms}`).toBeLessThan(0.25);
  });
});

describe('the leaps', () => {
  it('a beast bursts off the attacker\'s rim, LEAPS (above the line, not a lob) and comes down onto the struck portrait', () => {
    const [m] = beastMotions(P1, A, D, R, R);
    const p0 = beastPos(m!, 0);
    expect(Math.hypot(p0.x - A.x, p0.y - A.y)).toBeLessThanOrEqual(R); // on the attacker's rim
    const end = beastPos(m!, m!.flightMs);
    expect(Math.hypot(end.x - D.x, end.y - D.y)).toBeLessThanOrEqual(R * 0.4); // at the face
    expect(beastPos(m!, m!.flightMs + 500)).toEqual(end);
    const mid = beastPos(m!, m!.flightMs / 2);
    const lineY = (m!.a.y + m!.b.y) / 2;
    expect(mid.y).toBeLessThan(lineY);
    expect(lineY - mid.y).toBeLessThan(0.16 * Math.hypot(D.x - A.x, D.y - A.y));
    expect(leapEase(0)).toBe(0);
    expect(leapEase(1)).toBe(1);
    // still accelerating into the pounce
    expect(leapEase(1) - leapEase(0.9)).toBeGreaterThan(leapEase(0.1) - leapEase(0));
  });

  it('THE impact bites dead centre at full size; the ticks bite smaller and off-centre, spread across the face', () => {
    const ms = beastMotions(P3, A, D, R, R);
    const last = ms[ms.length - 1]!;
    expect(last.bite).toMatchObject({ x: D.x, y: D.y, scale: 1 });
    const ticks = ms.slice(0, -1);
    for (const m of ticks) {
      expect(m.bite.scale).toBeLessThan(1);
      const r = Math.hypot(m.bite.x - D.x, m.bite.y - D.y);
      expect(r).toBeGreaterThan(R * 0.2);
      expect(r).toBeLessThan(R * 0.6);
    }
    for (let i = 0; i < ticks.length; i++) for (let j = i + 1; j < ticks.length; j++) {
      expect(Math.hypot(ticks[i]!.bite.x - ticks[j]!.bite.x, ticks[i]!.bite.y - ticks[j]!.bite.y), `${i}-${j}`).toBeGreaterThan(R * 0.1);
    }
  });

  it('Tier IV\'s six chomps ring the whole face (a mauled portrait for the colossus to close on)', () => {
    const ms = beastMotions(P4, A, D, R, R);
    const angs = ms.map((m) => Math.atan2(m.bite.y - D.y, m.bite.x - D.x)).sort((a, b) => a - b);
    const gaps = angs.map((a, i) => (i ? a - angs[i - 1]! : a + 2 * Math.PI - angs[angs.length - 1]!));
    for (const g of gaps) expect(g).toBeGreaterThan(0.5);
  });

  it('works both ways: a foe pack from the top down to you; the leap ceiling keeps it in frame', () => {
    const [m] = beastMotions(P1, D, A, R, R);
    expect(Math.hypot(beastPos(m!, 0).x - D.x, beastPos(m!, 0).y - D.y)).toBeLessThanOrEqual(R);
    const end = beastPos(m!, m!.flightMs);
    expect(Math.hypot(end.x - A.x, end.y - A.y)).toBeLessThanOrEqual(R * 0.4);
    const [c] = beastMotions(P1, { x: 200, y: 100 }, { x: 1500, y: 60 }, R, R, 40);
    expect(c!.c.y).toBeGreaterThanOrEqual(40);
  });
});

describe('the camera', () => {
  it('pushes in through the growl, punches in on the impact and kicks VERTICALLY (the jaws snap top to bottom); rests by the end', () => {
    const dir = { x: 0.8, y: -0.6 };
    const hit = beastCameraAt(P3, C, P3.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P3.zoom);
    expect(Math.abs(hit.y)).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = beastCameraAt(P3, C, P3.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(1);
  });

  it('Tier IV builds through the rise, the slam punches hardest, the roar rattles; focus moves from attacker to target', () => {
    const early = beastCameraAt(P4, C, P4.riseAt + 20);
    const late = beastCameraAt(P4, C, P4.impactAt - 5);
    expect(late.zoom).toBeGreaterThan(early.zoom);
    const slam = beastCameraAt(P4, C, P4.impactAt + 1);
    expect(slam.zoom).toBeGreaterThan(beastCameraAt(P3, C, P3.impactAt + 1).zoom);
    let rattle = 0;
    for (let t = P4.roarAt; t < P4.roarAt + 120; t += 4) rattle = Math.max(rattle, Math.abs(beastCameraAt(P4, C, t).x));
    expect(rattle).toBeGreaterThan(P4.shakePx * 0.2);
    expect(beastCameraFocus(P4, P4.launchAt, A, D)).toEqual(A);
    expect(beastCameraFocus(P4, P4.riseAt, A, D)).toEqual(D);
    expect(beastCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
    let peak = 1;
    for (let t = P4.chargeAt; t < P4.endAt; t += 8) peak = Math.max(peak, beastCameraAt(P4, C, t).zoom);
    expect(peak).toBeLessThan(1.3);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroBeastOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroBeastOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroBeast({
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

  it('THE PACK lands the blow EXACTLY ONCE, on the LAST chomp, as its jaws SNAP SHUT: never on a tick; ends clean', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.beasts).toHaveLength(5);
    expect(host.querySelector('.hblast.hbeast')).not.toBeNull();
    f.tick(h.plan.chomps[h.plan.chomps.length - 1]! + 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.landedBeasts).toBe(4);
    expect(h.scene!.liveMeshes).toBeGreaterThan(0);
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.clampOf(4)!.gap).toBeGreaterThan(0); // the last jaws still closing
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.clampOf(4)!.gap).toBeLessThan(0); // SHUT on the impact beat
    expect(h.scene!.clampOf(4)!.alpha).toBe(1);
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt); // the clock never pauses on it
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('scale(');
    expect(host.querySelector<HTMLElement>('.hblast-hit')!.style.opacity).toBe('1');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16); // the marks and embers drain, then the updater unhooks and the layer unmounts
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier IV: six beasts chomp (ticks), the colossus rises, and the blow lands ONCE as its jaws SLAM shut', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.colossal).toBe(true);
    f.tick(h.plan.riseAt + 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.colossusUp).toBe(true);
    expect(h.scene!.colossusGap!).toBeGreaterThan(2); // framing the target, wide
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.colossusGap!).toBeLessThan(0.2); // shut over the portrait
    f.tick(h.plan.roarAt - h.elapsed() + 200, 4);
    expect(h.scene!.colossusGap!).toBeGreaterThan(1); // the roar springs it open
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_BEAST_SPRITES);
    f.tick(h.plan.endAt + 3000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.colossusUp).toBe(false);
    expect(f.hooked()).toBe(0);
  });

  it('THE FINAL CHOMP IS CENTRED on the struck portrait (owner 2026-09-29: "the final beast chomp isnt centered on the hero correctly"): both ways, corner heroes, 1920x1080 and 1600x900 layouts, every tier', () => {
    const layouts = [
      { you: { x: 180, y: 900 }, foe: { x: 1740, y: 140 }, r: 118 }, // 1920 x 1080: corner portraits
      { you: { x: 150, y: 750 }, foe: { x: 1460, y: 120 }, r: 98 }, // 1600 x 900
    ];
    for (const L of layouts) {
      for (const side of ['player', 'opp'] as const) {
        const a = side === 'player' ? L.you : L.foe;
        const d = side === 'player' ? L.foe : L.you;
        for (const total of [3, 8, 14, 40]) {
          const { h, f } = run({ side, attacker: a, defender: d, defenderRadius: L.r, total, formation: formationOf([total], total) });
          f.tick(h.plan.impactAt - 2, 2);
          f.tick(4, 2);
          const at = h.plan.colossal ? h.scene!.colossusCentre! : h.scene!.clampCentreOf(h.plan.beasts.length - 1)!;
          // The portrait is squashed / knocked on the impact and the jaws ride it: compare against where it is drawn.
          const moved = (h.scene as unknown as { fox: number; foy: number });
          expect(Math.abs(at.x - (d.x + moved.fox)), `${side} ${total} x`).toBeLessThan(0.5);
          expect(Math.abs(at.y - (d.y + moved.foy)), `${side} ${total} y`).toBeLessThan(0.5);
          h.cancel();
        }
      }
    }
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck)', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peakS = 0, peakM = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peakS = Math.max(peakS, h.scene!.liveSprites); peakM = Math.max(peakM, h.scene!.liveMeshes); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peakS).toBeLessThanOrEqual(MAX_BEAST_SPRITES);
        expect(peakM).toBeLessThanOrEqual(MAX_BEAST_MESHES);
        for (const m of h.motions) {
          expect(Math.hypot(m.a.x - a.x, m.a.y - a.y)).toBeLessThanOrEqual(R); // loosed from the attacker
          expect(Math.hypot(m.bite.x - d.x, m.bite.y - d.y)).toBeLessThanOrEqual(R * 0.6); // bites the struck hero
        }
        h.cancel();
      }
    }
  });

  it('slow motion stretches real time but the impact is still the same sequence beat', () => {
    const { h, f, onImpact } = run({ speed: 0.25 });
    f.tick(h.plan.impactAt * 4 - 40, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(60, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('a replay plays the same: the same fight runs the same leaps and beats', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    const b = run({ total: 40, formation: formationOf([40], 40) });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.motions).toEqual(b.h.motions);
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
    b.f.tick(b.h.plan.riseAt + 100);
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
    expect(h.motions).toEqual([]);
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
      const h = playHeroBeast({
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
  it('manes are strips of MANE_POINTS x 2 vertices (under the 100-vertex batch limit); a whole Tier IV stays in the caps and drains; destroy leaves nothing', () => {
    expect(MANE_POINTS * 2).toBeLessThanOrEqual(100);
    const s = new HeroBeastScene(TEX, COLORS, LOOK, 1, 42);
    const ms = beastMotions(P4, A, D, R, R);
    s.startCharge(A.x, A.y, 70, 440, ms.length, 24);
    for (let i = 0; i < 25; i++) s.update(16);
    let peakS = 0, peakM = 0;
    ms.forEach((m, i) => s.launch(m, 0.85, R, 0, i, true));
    for (let i = 0; i < 30; i++) { s.update(16); peakS = Math.max(peakS, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes); }
    ms.forEach((_, i) => s.chomp(i, D.x, D.y, R, i));
    s.startRise(D.x, D.y, R, 560, 110, 970, 1390);
    for (let i = 0; i < 42; i++) { s.update(16); peakS = Math.max(peakS, s.liveSprites); }
    s.slam(D.x, D.y, R, { burst: 1.9, sparks: 48, flashAlpha: 0.85 });
    for (let i = 0; i < 19; i++) { s.update(16); peakS = Math.max(peakS, s.liveSprites); }
    s.roar(D.x, D.y, R);
    for (let i = 0; i < 10; i++) { s.update(16); peakS = Math.max(peakS, s.liveSprites); peakM = Math.max(peakM, s.liveMeshes); }
    expect(peakS).toBeLessThanOrEqual(MAX_BEAST_SPRITES);
    expect(peakM).toBeLessThanOrEqual(MAX_BEAST_MESHES);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.liveBeasts).toBe(0);
    expect(s.colossusUp).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('a beast draws finite geometry every frame (no NaN at the launch, mid-leap, biting or dissolving), running either way', () => {
    for (const [a, d] of [[A, D], [D, A]] as const) {
      const s = new HeroBeastScene(TEX, COLORS, LOOK, 1, 3);
      const [m] = beastMotions(P1, a, d, R, R);
      s.launch(m!, 1.15, R, 0, 0, false);
      for (let t = 0; t < m!.flightMs + 700; t += 16) {
        s.update(16);
        for (const l of s.root.children as Container[]) {
          for (const ch of l.children) {
            if (!ch.visible) continue;
            expect(Number.isFinite(ch.x) && Number.isFinite(ch.y) && Number.isFinite(ch.rotation) && Number.isFinite(ch.scale.x) && Number.isFinite(ch.scale.y)).toBe(true);
            if ('vertices' in ch) for (const v of (ch as unknown as { vertices: Float32Array }).vertices) expect(Number.isFinite(v)).toBe(true);
          }
        }
      }
      s.destroy();
    }
  });

  it('clear() drops everything in flight at once; the pool is reused, not regrown', () => {
    const s = new HeroBeastScene(TEX, COLORS, LOOK, 1, 9);
    const ms = beastMotions(P3, A, D, R, R);
    ms.forEach((m, i) => s.launch(m, 1, R, 0, i, true));
    s.update(16);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect(s.update(16)).toBe(false);
    ms.forEach((m, i) => s.launch(m, 1, R, 0, i, true));
    s.update(16);
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 10);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Stampede (attack_beast) is a Legendary crate hero attack that plays the Beast; the dev override can force it; the other styles unchanged; unknown ids play Classic', () => {
    expect(COSMETIC_INDEX.attack_beast).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Stampede', assets: { style: 'beast' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast', 'banana', 'bleed', 'cards', 'storm', 'coin', 'boomerang', 'bubble', 'backstab', 'basketball', 'fel']); // the Stampede joined 2026-09-29
    expect(styleOfCosmetic('attack_beast')).toBe('beast');
    for (const [id, st] of [['attack_blast', 'blast'], ['attack_poison', 'poison'], ['attack_frost', 'frost'], ['attack_holy', 'holy']] as const) {
      expect(styleOfCosmetic(id)).toBe(st);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_beast' })).toBe('beast');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'beast' })).toBe('beast');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_beast' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_beast_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
