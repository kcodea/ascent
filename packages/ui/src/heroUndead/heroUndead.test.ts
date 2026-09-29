// @vitest-environment jsdom
/**
 * THE UNDEAD HERO ATTACK, Grave Call (owner 2026-09-29: "some sort of an undead animation", on the same four tiers): the
 * tier mapping SHARED with every attack; the ladder (one skull / two skulls / the grave hands, the wisp swarm and a
 * skull / the grave rift and the maw); the tuner defaults + clamping; the pure plan (the tick contract, the IV beats in
 * order, reduced motion, determinism); the pure geometry (the skulls, the hands round the target, the swarm, the rift
 * across the heroes' line); the camera; the runner on the shared clock (the consequence lands exactly ONCE; both
 * directions; slow motion; replay; finish / cancel; cleanup; the safety timer); the headless scene (pooled, bounded,
 * drains, destroy leaves nothing; FLAT: no skew); and the cosmetic resolution.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { COSMETIC_INDEX } from '@game/progression';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf as sharedTierOf } from '../heroAttack/tiers';
import { HERO_HOLY_DEFAULTS, holyPlan } from '../heroHoly/heroHolyConfig';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES, resolveHeroAttackStyle, styleOfCosmetic } from '../heroBlast/heroAttackStyle';
import {
  HERO_UNDEAD_DEFAULTS, HERO_UNDEAD_RANGES, UNDEAD_CAPS, clampHeroUndeadValue, heroUndeadConfigJson, sanitizeHeroUndeadConfig,
  SKULL_BOTTOM_FRAC, SKULL_TOP_FRAC, skullAt, undeadCameraAt, undeadCameraFocus, undeadCues, undeadFlightMs, undeadGeo, undeadPlan, type HeroUndeadConfig, type HeroUndeadNumKey,
} from './heroUndeadConfig';
import { HeroUndeadScene, MAX_UNDEAD_SPRITES, type HeroUndeadTextures } from './heroUndeadScene';
import { playHeroUndead, undeadSeed, type HeroUndeadOptions } from './heroUndead';
import { SPEC } from '../HeroUndeadTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';
import { CRANIUM_H, HINGE_Y, JAW_H, SKULL_CENTRE_ABOVE_HINGE, SKULL_SPAN } from './heroUndeadTextures';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const W = Texture.WHITE;
const TEX: HeroUndeadTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  cranium: W, craniumEdge: W, jaw: W, jawEdge: W, skullGlow: W, wisp: W, hand: W, necro: W, rift: W, riftEdge: W, crack: W, mist: W, shard: W,
};
const C = HERO_UNDEAD_DEFAULTS;
const plan = (values: number[], total: number, distance = 1300, reduced = false) => undeadPlan({ total, distance, reduced, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { core: 0xeafff4, ghost: 0x5cf2b0, teal: 0x3fd3cf, void: 0x2a1238, bone: 0xece4cd, side: 0x6cf5bf };
const LOOK = {
  circleSize: 1, circleSpin: 1, smokeRing: 1, skullWobble: 1, afterimages: 4, shedWisps: 1, echoSize: 1, wispLife: 1, wispWander: 1, wispSize: 1, handSize: 1,
};
const A = { x: 200, y: 850 }, D = { x: 1400, y: 300 };
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the damage tiers (shared with every attack)', () => {
  it('Undead steps up on exactly the blows every other attack does: I 1-5, II 6-11, III 12-19, IV 20+', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const t = plan([d], d).tier;
      expect(t, `dmg ${d}`).toBe(sharedTierOf(d));
      expect(t).toBe(holyPlan({ total: d, distance: 1600 }, HERO_HOLY_DEFAULTS).tier);
    }
  });

  it('the ladder: I ONE skull, II TWO skulls, III the grave HANDS and a wisp SWARM then one skull, IV the grave RIFT and the MAW', () => {
    expect([P1, P2, P3, P4].map((p) => p.skulls.length)).toEqual([1, 2, 1, 0]);
    expect([P1, P2, P3, P4].map((p) => p.hands.length)).toEqual([0, 0, 4, 0]);
    expect([P1, P2, P3, P4].map((p) => p.wisps.length)).toEqual([0, 0, 8, 0]);
    expect([P1, P2, P3, P4].map((p) => p.maw)).toEqual([false, false, false, true]);
    expect([1, 5, 6, 11, 12, 19, 20, 60].map((d) => { const p = plan([d], d); return p.maw ? 'maw' : `${p.skulls.length}/${p.hands.length}/${p.wisps.length}`; }))
      .toEqual(['1/0/0', '1/0/0', '2/0/0', '2/0/0', '1/4/8', '1/4/8', 'maw', 'maw']);
    // The finisher is bigger than a tick skull, and each tier's skull grows.
    expect(P2.skulls[1]!.size).toBeGreaterThan(P2.skulls[0]!.size);
    expect(P3.skulls[0]!.size).toBeGreaterThan(P1.skulls[0]!.size);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb; the palette is sickly green, teal, purple-black and bone', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_UNDEAD_RANGES)) {
      const v = C[k as HeroUndeadNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorCore', 'colorGhost', 'colorTeal', 'colorVoid', 'colorBone', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
    expect([C.colorGhost, C.colorTeal, C.colorVoid, C.colorBone]).toEqual(['#5cf2b0', '#3fd3cf', '#2a1238', '#ece4cd']);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroUndeadValue('t3Hands', 99)).toBe(8);
    expect(clampHeroUndeadValue('t1Skulls', -2)).toBe(0);
    expect(clampHeroUndeadValue('mawRiseMs', 99999)).toBe(1500);
    expect(clampHeroUndeadValue('afterimages', 99)).toBe(6);
    expect(clampHeroUndeadValue('mawSize', Number.NaN)).toBe(C.mawSize);
    expect(clampHeroUndeadValue('mistMs', 'abc')).toBe(C.mistMs);
    expect(clampHeroUndeadValue('mistMs', '400')).toBe(400);
    expect(clampHeroUndeadValue('colorGhost', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroUndeadValue('colorGhost', 'green')).toBe(C.colorGhost);
    expect(clampHeroUndeadValue('sfxChompClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroUndeadValue('nope' as keyof HeroUndeadConfig, 1)).toBeUndefined();
    expect(clampHeroUndeadValue('toString' as keyof HeroUndeadConfig, 1)).toBeUndefined();
    const s = sanitizeHeroUndeadConfig({ t4Motes: 400, colorCore: 'x', bogus: 3 });
    expect(s.t4Motes).toBe(90);
    expect(s.colorCore).toBe(C.colorCore);
    expect('bogus' in s).toBe(false);
    expect(sanitizeHeroUndeadConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control (every sound cue has a clip, gain and pitch row); Copy JSON leaves the preview-only keys out; the style row offers Grave Call', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    for (const cueName of ['Raise', 'Call', 'Shriek', 'Whoosh', 'Tick', 'Impact', 'Thump', 'Big', 'Claw', 'Wisp', 'Rift', 'Rumble', 'Rise', 'Roar', 'Lunge', 'Chomp', 'Mist']) {
      for (const suf of ['Clip', 'Gain', 'Rate']) expect(keys.has(`sfx${cueName}${suf}` as never), `sfx${cueName}${suf}`).toBe(true);
    }
    const json = JSON.parse(heroUndeadConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.previewParts).toBeUndefined();
    expect(json.t4Maw).toBe(1);
    expect(json.t3Hands).toBe(4);
    const style = SPEC.controls.find((c) => c.key === 'attackStyle');
    expect(style?.options).toContain('undead');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('undead');
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe huge (40)']) {
      expect(labels).toContain(l);
    }
    // owner 2026-09-29: no Speed or Reduced motion buttons on a hero attack tuner, and the button row sits at the TOP
    expect(labels.filter((l) => /Speed|Reduced/.test(l))).toEqual([]);
    expect(SPEC.buttonsOnTop).toBe(true);
  });
});

describe('the plan', () => {
  it('THE TICK CONTRACT: II\'s first skull is a tick and the second the impact; III\'s grips and wisps are ticks, the skull after them the impact', () => {
    expect(P2.hits).toEqual([P2.skulls[0]!.hitAt]);
    expect(P2.impactAt).toBe(P2.skulls[1]!.hitAt);
    // the second skull pops out while the first is still in flight (they weave in close together)
    expect(P2.skulls[1]!.emergeAt).toBeLessThan(P2.skulls[0]!.hitAt);
    const ticks = [...P3.hands.map((h) => h.gripAt), ...P3.wisps.map((w) => w.hitAt)].sort((a, b) => a - b);
    expect(P3.hits).toEqual(ticks);
    for (let i = 1; i < P3.wisps.length; i++) expect(P3.wisps[i]!.launchAt - P3.wisps[i - 1]!.launchAt, `wisp ${i}`).toBe(C.t3WispGapMs);
    expect(P3.impactAt).toBe(P3.skulls[0]!.hitAt);
    expect(P3.impactAt).toBeGreaterThan(ticks[ticks.length - 1]!);
    for (const p of [P1, P2, P3]) {
      const kinds = undeadCues(p).map((q) => q.kind);
      expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'emerge')).toHaveLength(p.skulls.length);
      expect(kinds.filter((k) => k === 'launch')).toHaveLength(p.skulls.length);
      expect(kinds.filter((k) => k === 'skullHit')).toHaveLength(p.skulls.length - 1);
      expect(kinds.filter((k) => k === 'grip')).toHaveLength(p.hands.length);
      expect(kinds.filter((k) => k === 'wispHit')).toHaveLength(p.wisps.length);
      expect(kinds.indexOf('raise')).toBeLessThan(kinds.indexOf('emerge'));
      for (const k of ['rift', 'rise', 'shriek', 'lunge', 'chomp']) expect(kinds).not.toContain(k);
      for (const s of p.skulls) { expect(s.launchAt - s.emergeAt).toBe(C.shriekMs); expect(s.hitAt).toBeGreaterThan(s.launchAt); }
    }
    expect(P1.hits).toEqual([]);
  });

  it('Tier IV: the rift tears, the maw rises, shrieks, lunges and chomps IN THAT ORDER; the blow lands once, on the chomp (never on the rise, the shriek or the lunge)', () => {
    const kinds = undeadCues(P4).map((q) => q.kind);
    for (const k of ['emerge', 'launch', 'skullHit', 'hand', 'grip', 'wisp', 'wispHit', 'grave']) expect(kinds).not.toContain(k);
    const at = (k: string): number => kinds.indexOf(k as never);
    expect(at('raise')).toBeLessThan(at('rift'));
    expect(at('rift')).toBeLessThan(at('rise'));
    expect(at('rise')).toBeLessThan(at('shriek'));
    expect(at('shriek')).toBeLessThan(at('lunge'));
    expect(at('lunge')).toBeLessThan(at('chomp'));
    expect(at('chomp')).toBeLessThan(at('impact'));
    expect(at('impact')).toBeLessThan(at('fade'));
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(P4.hits).toEqual([]);
    expect(P4.shriekAt - P4.riseAt).toBe(C.mawRiseMs);
    expect(P4.lungeAt - P4.shriekAt).toBe(C.mawShriekMs);
    expect(P4.impactAt - P4.chompAt).toBe(C.chompMs);
  });

  it('every tier escalates: more shake, zoom, burst, motes and dim', () => {
    const ps = [P1, P2, P3, P4];
    for (let i = 1; i < 4; i++) {
      for (const k of ['shakePx', 'zoom', 'burst', 'motes', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
    }
    expect(P1.dim).toBe(0);
  });

  it('the shipped per-tier timeline (1300 px apart), ms from the raise: the raise, the impact and the end; chunky, not rushed, and IV the longest', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.raiseAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P3), t(P4)]).toEqual([
      [320, 900, 1540], [360, 1108, 1788], [400, 1483, 2203], [440, 1878, 2878],
    ]);
    for (const p of [P1, P2, P3]) expect(t(p)[2]).toBeLessThanOrEqual(2400);
    expect(t(P4)[2]).toBeGreaterThan(t(P3)[2]);
    expect(t(P4)[2]).toBeLessThanOrEqual(3600);
  });

  it('the caps always hold, whatever the sliders say; flights scale gently with distance', () => {
    const wild: HeroUndeadConfig = { ...C, t3Hands: 8, t3Wisps: 16, t4Motes: 90, t4Shake: 40, t4Zoom: 0.14, t2Skulls: 4 };
    expect(undeadPlan({ total: 15, distance: 800 }, wild).hands.length).toBeLessThanOrEqual(UNDEAD_CAPS.hands);
    expect(undeadPlan({ total: 15, distance: 800 }, wild).wisps.length).toBeLessThanOrEqual(UNDEAD_CAPS.wisps);
    expect(undeadPlan({ total: 8, distance: 800 }, wild).skulls.length).toBeLessThanOrEqual(UNDEAD_CAPS.skulls);
    expect(undeadPlan({ total: 99, distance: 800 }, wild).motes).toBeLessThanOrEqual(UNDEAD_CAPS.motes);
    expect(undeadFlightMs(1100, 300)).toBe(300);
    expect(undeadFlightMs(50, 300)).toBe(180);
    expect(undeadFlightMs(99999, 300)).toBe(360);
  });

  it('reduced motion: no skulls, hands, wisps, rift, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.skulls.length, p.hands.length, p.wisps.length, p.maw]).toEqual([0, 0, 0, 0, 0, 0, false]);
    const kinds = undeadCues(p).map((q) => q.kind);
    for (const k of ['charge', 'raise', 'emerge', 'rift', 'rise', 'chomp']) expect(kinds).not.toContain(k);
    expect(kinds.filter((k) => k === 'impact')).toHaveLength(1);
    expect(undeadCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('is deterministic: the same fight plans the same beats and places the same skulls, hands, wisps and rift', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(undeadCues(plan([4, 2, 3], 9, 720))).toEqual(undeadCues(plan([4, 2, 3], 9, 720)));
    expect(undeadGeo(P4, A, D, 80, C, 1)).toEqual(undeadGeo(P4, A, D, 80, C, 1));
    expect(undeadGeo(P3, A, D, 80, C, 1)).toEqual(undeadGeo(P3, A, D, 80, C, 1));
    expect(undeadSeed(14, 1500.2, 'player')).toBe(undeadSeed(14, 1500.4, 'player'));
    expect(undeadSeed(14, 1500, 'player')).not.toBe(undeadSeed(14, 1500, 'opp'));
  });
});

describe('the geometry', () => {
  it('a skull pops out on the hero\'s rim facing the target and bites the target\'s centre; two skulls bow opposite ways', () => {
    const g = undeadGeo(P2, A, D, 80, C, 1, 70);
    const dist = Math.hypot(D.x - A.x, D.y - A.y);
    for (const s of g.skulls) {
      expect(Math.hypot(s.from.x - A.x, s.from.y - A.y)).toBeCloseTo(70 * 0.95, 6);
      expect(Math.hypot(s.from.x - D.x, s.from.y - D.y)).toBeLessThan(dist);
      expect(s.to).toEqual(D);
      expect(skullAt(s, 0)).toEqual(s.from);
      expect(skullAt(s, 1).x).toBeCloseTo(D.x, 6);
    }
    expect(Math.sign(g.skulls[0]!.arc)).toBe(-Math.sign(g.skulls[1]!.arc));
  });

  it('III: the hands come up round the target (spread all round it, at about the ring), each reaching IN; the swarm leaves the hero and lands on the target', () => {
    const g = undeadGeo(P3, A, D, 80, C, 1, 70);
    expect(g.hands).toHaveLength(4);
    const angs = g.hands.map((h) => Math.atan2(h.at.y - D.y, h.at.x - D.x));
    for (let i = 0; i < angs.length; i++) for (let j = i + 1; j < angs.length; j++) {
      let d = Math.abs(angs[i]! - angs[j]!); if (d > Math.PI) d = 2 * Math.PI - d;
      expect(d, `${i} vs ${j}`).toBeGreaterThan(Math.PI / 4);
    }
    for (const h of g.hands) {
      const r = Math.hypot(h.at.x - D.x, h.at.y - D.y);
      expect(r).toBeGreaterThan(80 * C.handRing * 0.9);
      expect(r).toBeLessThan(80 * C.handRing * 1.1);
      // reaching in: its direction points back at the target's centre
      const inward = { x: D.x - h.at.x, y: D.y - h.at.y };
      expect(Math.cos(h.ang) * inward.x + Math.sin(h.ang) * inward.y).toBeGreaterThan(0.9 * r);
    }
    expect(g.wisps).toHaveLength(8);
    for (const w of g.wisps) {
      expect(Math.hypot(w.from.x - A.x, w.from.y - A.y)).toBeLessThan(70 * 1.3);
      expect(Math.hypot(w.to.x - D.x, w.to.y - D.y)).toBeLessThan(80);
    }
    // they bend both ways
    expect(new Set(g.wisps.map((w) => Math.sign(w.bend))).size).toBe(2);
  });

  it('IV: the rift opens between the heroes, ACROSS the line of the blow; the maw rises just above it and chomps the target', () => {
    const g = undeadGeo(P4, A, D, 80, C, 1);
    expect(g.rift.at).toEqual({ x: (A.x + D.x) / 2, y: (A.y + D.y) / 2 });
    const blow = Math.atan2(D.y - A.y, D.x - A.x);
    expect(Math.abs(Math.cos(g.rift.ang - blow))).toBeLessThan(1e-9); // perpendicular
    expect(g.rift.len).toBeGreaterThan(80 * 2);
    expect(g.maw.from).toEqual(g.rift.at);
    expect(g.maw.up.y).toBeLessThan(g.rift.at.y);
    expect(g.maw.to).toEqual(D);
    expect(g.maw.size).toBeGreaterThan(80 * 3);
    expect(g.cracks.length).toBe(C.riftCracks);
  });
});

describe('the maw stays whole in view (never cropped)', () => {
  it('the pure extents match the painted skull (the top of the cranium, the chin of the jaw)', () => {
    // top: the cranium's top (y 6) to the visual centre; bottom: the centre to the chin (the jaw's 116 below the hinge)
    expect(SKULL_TOP_FRAC).toBeCloseTo((HINGE_Y - 6 - SKULL_CENTRE_ABOVE_HINGE) / SKULL_SPAN, 9);
    expect(SKULL_BOTTOM_FRAC).toBeCloseTo((116 + SKULL_CENTRE_ABOVE_HINGE) / SKULL_SPAN, 9);
    expect(CRANIUM_H).toBeGreaterThan(HINGE_Y);
    expect(JAW_H).toBeGreaterThan(116);
  });

  it('a struck hero at the top or bottom edge: the chomp slides toward the middle so the whole maw (and the camera punch) fits; a short view shrinks it', () => {
    const Z = 1 + P4.zoom * 1.7 + P4.punch;
    const view = { top: 0, bottom: 900 };
    for (const d of [{ x: 800, y: 110 }, { x: 800, y: 800 }, { x: 800, y: 450 }]) {
      const a = { x: 800, y: 900 - d.y };
      const g = undeadGeo(P4, a, d, 70, C, 1, 70, view);
      const w = g.maw.size * C.mawGrow * 1.06;
      const top = d.y + (g.maw.to.y - w * SKULL_TOP_FRAC - d.y) * Z, bottom = d.y + (g.maw.to.y + w * SKULL_BOTTOM_FRAC - d.y) * Z;
      expect(top, `top at ${d.y}`).toBeGreaterThanOrEqual(view.top + 11.9);
      expect(bottom, `bottom at ${d.y}`).toBeLessThanOrEqual(view.bottom - 11.9);
      expect(g.maw.to.x).toBe(d.x);
    }
    // in the middle it chomps right on the struck hero
    expect(undeadGeo(P4, { x: 800, y: 900 }, { x: 800, y: 450 }, 70, C, 1, 70, view).maw.to.y).toBe(450);
    // a short view: smaller, never cropped
    const tiny = undeadGeo(P4, { x: 200, y: 250 }, { x: 600, y: 60 }, 70, C, 1, 70, { top: 0, bottom: 300 });
    expect(tiny.maw.size).toBeLessThan(70 * 3.4 * C.mawSize);
  });
});

describe('the sounds', () => {
  it('every default cue plays a clip that exists in the repo (reusing existing clips; no new audio)', () => {
    const audio = join(__dirname, '..', 'audio');
    for (const k of Object.keys(C).filter((key) => key.startsWith('sfx') && key.endsWith('Clip'))) {
      const clip = C[k as keyof HeroUndeadConfig] as string;
      expect(clip, k).not.toBe('');
      expect(existsSync(join(audio, `${clip}.mp3`)) || existsSync(join(audio, `${clip}.wav`)), `${k}: ${clip}`).toBe(true);
    }
  });
});

describe('the camera', () => {
  it('I-III: pushes in on the hero through the raise, punches on the bite and shakes; rests by the end', () => {
    const hit = undeadCameraAt(P3, C, P3.impactAt);
    expect(hit.zoom).toBeGreaterThan(1 + P3.punch);
    expect(hit.y).toBeGreaterThan(P3.shakePx * 0.5);
    const rest = undeadCameraAt(P3, C, P3.endAt);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.6);
    expect(undeadCameraFocus(P3, P3.chargeAt + 10, A, D)).toEqual(A);
    expect(undeadCameraFocus(P3, P3.impactAt, A, D)).toEqual(D);
    expect(undeadCameraFocus(P1, P1.skulls[0]!.hitAt, A, D)).toEqual(D);
  });

  it('IV: the focus rides to the rift, holds through the rise and the shriek, and follows the lunge to the target; the shriek trembles the view; the chomp punches hardest; it rests by the end', () => {
    const rift = { x: 800, y: 500 };
    expect(undeadCameraFocus(P4, P4.riseAt, A, D, rift)).toEqual(rift);
    expect(undeadCameraFocus(P4, P4.shriekAt + 50, A, D, rift)).toEqual(rift);
    expect(undeadCameraFocus(P4, P4.impactAt, A, D, rift)).toEqual(D);
    let moved = 0;
    for (let t = P4.shriekAt + 20; t < P4.lungeAt; t += 17) { const m = undeadCameraAt(P4, C, t); moved = Math.max(moved, Math.abs(m.x) + Math.abs(m.y)); }
    expect(moved).toBeGreaterThan(P4.shakePx * 0.1);
    const strike = undeadCameraAt(P4, C, P4.impactAt + 1);
    expect(strike.zoom).toBeGreaterThan(undeadCameraAt(P3, C, P3.impactAt + 1).zoom);
    expect(undeadCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
  });
});

/** A manual frame source: the test owns the clock. */
function manualFrames(): { frames: HeroUndeadOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroUndeadOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  document.body.append(host, camera);
  const h = playHeroUndead({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, defenderRadius: 80,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('III: the hands claw up and drag, the swarm strikes, and the blow lands EXACTLY ONCE, on the skull after them: never on a grip or a wisp; everything is put back', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 14, formation: formationOf([14], 14) });
    expect(h.plan.hands).toHaveLength(4);
    expect(host.querySelector('.hblast.hundead')).not.toBeNull();
    f.tick(h.plan.wisps[3]!.launchAt + 40, 4);
    expect(h.scene!.liveHands).toBeGreaterThan(0);
    expect(h.scene!.liveWisps).toBeGreaterThan(0);
    expect(h.scene!.graveHeld).toBeGreaterThan(0);
    f.tick(h.plan.hands[0]!.gripAt + 60 - h.elapsed(), 4);
    expect(defenderEl.style.transform).toContain('translate('); // dragged down
    f.tick(h.plan.hits[h.plan.hits.length - 1]! + 8 - h.elapsed(), 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveSkulls).toBe(1); // the finisher is in flight
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveSkulls).toBe(0); // it burst on the bite
    expect(h.elapsed()).toBeGreaterThanOrEqual(h.plan.impactAt);
    expect(camera.style.transform).toContain('scale(');
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expect(attackerEl.style.transform).toBe('');
    expect(defenderEl.style.transform).toBe('');
    f.tick(4000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('IV: the rift opens, the maw rises and shrieks (jaw wide), lunges and chomps (jaw shut); the blow lands ONCE, on the chomp', () => {
    const { h, f, onImpact } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.maw).toBe(true);
    f.tick(h.plan.riftAt + 40, 4);
    expect(h.scene!.riftOpen).toBe(true);
    f.tick(h.plan.shriekAt - h.elapsed() - 8, 4);
    expect(h.scene!.hasMaw).toBe(true);
    expect(h.scene!.mawState!.open).toBeLessThan(0.3);
    f.tick(h.plan.lungeAt - h.elapsed() - 8, 4);
    expect(h.scene!.mawState!.open).toBeGreaterThan(0.9); // screaming
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.chompAt - h.elapsed() - 4, 4);
    const m = h.scene!.mawState!;
    expect(Math.hypot(m.x - 1400, m.y - 150)).toBeLessThan(120); // it has crossed to the target
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() - 4, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(12, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.mawState!.open).toBeLessThan(0.15); // shut on it
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_UNDEAD_SPRITES);
    f.tick(h.plan.endAt + 3000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('works in both directions at every tier (the blow lands on whichever hero is struck; everything stays in the caps)', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 14, 40]) {
        const a = side === 'player' ? { x: 100, y: 800 } : { x: 1400, y: 150 };
        const d = side === 'player' ? { x: 1400, y: 150 } : { x: 100, y: 800 };
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_UNDEAD_SPRITES);
        expect(h.geo.foot).toEqual(d);
        // IV: the maw chomps ON the struck hero's column, slid inside the window (jsdom's 768 px) so it stays whole
        if (h.plan.maw) { expect(h.geo.maw.to.x).toBe(d.x); expect(h.geo.maw.to.y).toBeGreaterThan(0); expect(h.geo.maw.to.y).toBeLessThan(window.innerHeight); }
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

  it('a replay plays the same: the same fight plans the same beats and places the same things', () => {
    for (const total of [9, 14, 40]) {
      const a = run({ total, formation: formationOf([total], total) });
      const b = run({ total, formation: formationOf([total], total) });
      expect(a.h.plan).toEqual(b.h.plan);
      expect(a.h.geo).toEqual(b.h.geo);
      a.h.cancel(); b.h.cancel();
    }
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it and leaves nothing behind', () => {
    const a = run();
    a.f.tick(600);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.shriekAt + 40);
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
      const h = playHeroUndead({
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
  const skewed = (s: HeroUndeadScene): number => s.root.children.flatMap((l) => (l as Container).children)
    .filter((ch) => ch.visible && (Math.abs(ch.skew.x) > 1e-9 || Math.abs(ch.skew.y) > 1e-9)).length;

  it('a whole Tier IV (raise, rift, rise, shriek, lunge, chomp, mist) stays in the cap, is FLAT (never skewed), drains, and destroy leaves nothing', () => {
    const s = new HeroUndeadScene(TEX, COLORS, LOOK, 1, 42);
    const g = undeadGeo(P4, A, D, 80, C, 1);
    let peak = 0;
    const step = (n: number): void => { for (let i = 0; i < n; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); expect(skewed(s)).toBe(0); } };
    s.startRaise(A.x, A.y, 70, 440, 1);
    step(27);
    s.raise(A.x, A.y, 70, 1);
    step(4);
    s.tearRift(g.rift.at, g.rift.ang, g.rift.len, C.riftMs, g.cracks);
    step(12);
    expect(s.riftOpen).toBe(true);
    s.riseMaw(g.maw.from, g.maw.up, g.maw.size, C.mawRiseMs);
    step(33);
    expect(s.hasMaw).toBe(true);
    s.shriekMaw(C.mawShriekMs, 80);
    step(24);
    s.lungeMaw(g.maw.to, 240, C.mawGrow);
    step(15);
    s.chompMaw(C.chompMs);
    step(5);
    s.mawImpact(g.foot, 80, { k: 1, burst: 1.8, motes: 48, flashAlpha: 1, shards: C.shards, mistMs: C.mistMs, mistReach: 1, mistPuffs: C.mistPuffs });
    step(10);
    s.fadeGround(C.lingerMs);
    expect(peak).toBeLessThanOrEqual(MAX_UNDEAD_SPRITES);
    let alive = true;
    for (let i = 0; i < 800 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.hasMaw).toBe(false);
    expect(s.riftOpen).toBe(false);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('I-III: skulls, hands, wisps and the grave all drain; clear() drops everything at once and the pool is reused, not regrown', () => {
    const s = new HeroUndeadScene(TEX, COLORS, LOOK, 1, 9);
    const g = undeadGeo(P3, A, D, 80, C, 1);
    s.openGrave(D.x, D.y, 80, 260);
    g.hands.forEach((hs) => s.raiseHand(hs, C.handRiseMs, C.handDragPx));
    g.wisps.forEach((w) => s.launchWisp(w, 380));
    s.emergeSkull(0, g.skulls[0]!.from, 110, C.shriekMs);
    for (let i = 0; i < 14; i++) { s.update(16); expect(skewed(s)).toBe(0); }
    g.hands.forEach((hs, i) => s.gripHand(i, hs.at));
    s.launchSkull(0, g.skulls[0]!, 300);
    for (let i = 0; i < 18; i++) { s.update(16); expect(skewed(s)).toBe(0); }
    expect(s.liveSkulls).toBe(1);
    expect(s.liveHands).toBe(4);
    s.skullBite(0, g.foot, 80, { last: true, k: 2 / 3, burst: 1.35, motes: 28, flashAlpha: 0.85, shards: 10 });
    expect(s.liveSkulls).toBe(0);
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.update(16)).toBe(false);
    s.emergeSkull(0, g.skulls[0]!.from, 110, C.shriekMs);
    s.skullBite(0, g.foot, 80, { last: true, k: 2 / 3, burst: 1.35, motes: 28, flashAlpha: 0.85, shards: 10 });
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveHands).toBe(0);
    s.destroy();
  });

  it('the hands shatter on the blow (they leave, they do not linger)', () => {
    const s = new HeroUndeadScene(TEX, COLORS, LOOK, 1, 3);
    const g = undeadGeo(P3, A, D, 80, C, 1);
    g.hands.forEach((hs) => s.raiseHand(hs, 200, 10));
    for (let i = 0; i < 20; i++) s.update(16);
    expect(s.liveHands).toBe(4);
    s.emergeSkull(0, g.skulls[0]!.from, 110, 170);
    s.skullBite(0, g.foot, 80, { last: true, k: 2 / 3, burst: 1.35, motes: 20, flashAlpha: 1, shards: 10 });
    for (let i = 0; i < 16; i++) s.update(16);
    expect(s.liveHands).toBe(0);
    s.destroy();
  });
});

describe('the cosmetic', () => {
  it('Grave Call (attack_undead) is a Legendary crate hero attack that plays Undead; the dev override can force it; the others are unchanged; unknown ids play Classic', () => {
    expect(COSMETIC_INDEX.attack_undead).toMatchObject({ category: 'hero_attack', rarity: 'legendary', name: 'Grave Call', assets: { style: 'undead' }, active: true });
    expect(HERO_ATTACK_STYLES).toEqual(['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast', 'banana', 'bleed', 'cards', 'storm']); // Inferno (fire) landed first, 2026-09-29
    expect(styleOfCosmetic('attack_undead')).toBe('undead');
    for (const [id, style] of [['attack_blast', 'blast'], ['attack_quake', 'quake'], ['attack_arcana', 'arcana'], ['attack_blades', 'blades'], ['attack_enraged', 'enraged'], ['attack_holy', 'holy']] as const) {
      expect(styleOfCosmetic(id)).toBe(style);
    }
    expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: 'attack_undead' })).toBe('undead');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'undead' })).toBe('undead');
    expect(resolveHeroAttackStyle({ attacker: 'player', devChoice: 'classic', attackerCosmeticId: 'attack_undead' })).toBe('classic');
    for (const bad of ['attack_gone', 'attack_undead_2', 'skin_albus_1', null, undefined]) {
      expect(resolveHeroAttackStyle({ attacker: 'opp', devChoice: 'auto', attackerCosmeticId: bad }), String(bad)).toBe('classic');
    }
  });
});
