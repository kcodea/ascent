// @vitest-environment jsdom
/**
 * POWER CHORD, an EPIC hero attack (2026-11-12; in progress, dev-only, no cosmetic): the shared four damage tiers map to
 * THREE looks (I small, II and III medium, IV big; a knockout plays big); the looks (one note riding a staff strung
 * between the heroes / a three-note chord that makes the staff thrum / the striking portrait as a SPEAKER whose bass wave
 * train bends the staff and blows the struck portrait back; no drawn prop); the tuner; the pure plan, geometry and camera; the runner on the shared clock (the
 * blow lands exactly ONCE; both directions; replay; finish / cancel; every exit puts the portraits back; the camera
 * applied once); and the headless scene (the staff is strips under the batch limit, rewritten in place, pooled, bounded,
 * drains, destroy leaves nothing).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import {
  AMP_LEAD_MS, COUNT_IN, HERO_CHORD_CLIP_KEYS, HERO_CHORD_DEFAULTS, HERO_CHORD_RANGES, CHORD_CAPS, STAFF_LINES, clampHeroChordValue, heroChordConfigJson, sanitizeHeroChordConfig,
  chordArrivalDir, chordCameraAt, chordCameraFocus, chordCues, chordGeometry, chordLevel, chordPlan,
  type HeroChordConfig, type HeroChordNumKey,
} from './heroChordConfig';
import { HeroChordScene, MAX_CHORD_MESHES, MAX_CHORD_SPRITES, SPEAKER_RINGS, STAFF_POINTS, noteLean, rideEase, staffSpread, type HeroChordTextures } from './heroChordScene';
import { BLOW_HOLD_MS, blowAt, chordSeed, playHeroChord, STRING_RATES, type HeroChordOptions } from './heroChord';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';
import { SPEC } from '../HeroChordTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroChordTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  lineGlow: W, lineCore: W, note: W, pair: W, wave: W,
};
const C = HERO_CHORD_DEFAULTS;
const plan = (values: number[], total: number, distance = 1600, reduced = false, knockout = false) => chordPlan({ total, distance, reduced, knockout, leadIn: leadInOf(values, reduced) }, C);
const COLORS = { staff: 0xfff3d1, noteA: 0xffd24a, noteB: 0xff6fae, noteC: 0x66dcff, wave: 0xcfeaff, side: 0xffc94a };
const LOOK = {
  width: C.staffWidth, glow: C.staffGlow, sag: C.staffSag, stringMs: C.stringMs, staggerMs: C.stringStaggerMs, pluckPx: C.pluckPx, thrumPx: C.thrumPx,
  vibHz: C.vibHz, vibMs: C.vibMs, slackMs: C.slackMs, bendPx: C.bendPx, pumpScale: C.pumpScale, waveBands: C.waveBands, waveSize: C.waveSize,
};
// The real layout: you at the bottom left, the foe in the top right corner.
const A = { x: 195, y: 790 }, D = { x: 1773, y: 120 };
const R = 105;
const VIEW = { w: 1920, h: 1080 };
const P1 = plan([2, 1], 3), P2 = plan([3, 3, 2], 8), P3 = plan([3, 3, 3, 3, 2], 14), P4 = plan([6, 6, 6, 6, 6, 5, 5], 40);

describe('the three looks (an Epic maps the shared four tiers onto three)', () => {
  it('reads the SHARED tier (thresholds 6 / 12 / 20) and maps I small, II and III medium, IV big', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    expect([1, 2, 3, 4].map((t) => chordLevel(t as 1 | 2 | 3 | 4))).toEqual([1, 2, 2, 3]);
    for (let d = 0; d <= 60; d++) {
      const p = plan([d], d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level).toBe(chordLevel(tierOf(d)));
    }
    expect([P1, P2, P3, P4].map((p) => p.level)).toEqual([1, 2, 2, 3]);
  });

  it('a knockout always plays Big (the speakers), whatever the number', () => {
    const ko = plan([2, 1], 3, 1600, false, true);
    expect([ko.tier, ko.level, ko.speaker]).toEqual([4, 3, true]);
  });

  it('Small is ONE note on the middle line; Medium a CHORD of three notes on three different lines; Big has no rider (the wave carries its own)', () => {
    expect(P1.riders.map((r) => r.line)).toEqual([2]);
    expect(P2.riders.map((r) => r.line)).toEqual([0, 2, 4]);
    expect(new Set(P2.riders.map((r) => r.hue)).size).toBe(3);
    expect(new Set(P2.riders.map((r) => r.at)).size).toBe(1); // they leave together
    expect(new Set(P2.riders.map((r) => r.flyMs)).size).toBe(1); // and land together
    expect(P4.riders).toEqual([]);
    expect([P1.speaker, P2.speaker, P4.speaker]).toEqual([false, false, true]);
  });

  it('the style is dev-only: it is in the style list and the dev override, and has no cosmetic yet', () => {
    expect(HERO_ATTACK_STYLES).toContain('chord');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('chord');
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_CHORD_RANGES)) {
      const v = C[k as HeroChordNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorStaff', 'colorNoteA', 'colorNoteB', 'colorNoteC', 'colorWave', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back to the default; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroChordValue('v1Notes', 99)).toBe(30);
    expect(clampHeroChordValue('stringMs', 1)).toBe(40);
    expect(clampHeroChordValue('beatMs', 'abc')).toBe(C.beatMs);
    expect(clampHeroChordValue('beatMs', '300')).toBe(300);
    expect(clampHeroChordValue('colorStaff', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroChordValue('colorStaff', 'gold')).toBe(C.colorStaff);
    expect(clampHeroChordValue('sfxBassClip', '  fx/x  ')).toBe('fx/x');
    expect(clampHeroChordValue('nope' as keyof HeroChordConfig, 1)).toBeUndefined();
    const s = sanitizeHeroChordConfig({ v3Sparks: 400, colorWave: 'x', bogus: 3, boltWidth: 12 });
    expect(s.v3Sparks).toBe(50);
    expect(s.colorWave).toBe(C.colorWave);
    expect('bogus' in s).toBe(false);
    expect('boltWidth' in s).toBe(false); // a key left over from the scaffold's source is dropped
    expect(sanitizeHeroChordConfig('junk')).toEqual(C);
  });

  it('every config key has a tuner control; Copy JSON leaves the preview-only keys out; the style row offers Power Chord; buttons on top', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroChordConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.v3FlyMs).toBe(C.v3FlyMs);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('chord');
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions?.map((a) => a.label) ?? [];
    for (const l of ['▶ Small (3)', '▶ Medium (8)', '▶ Big (40)', '▶ Foe small (3)', '▶ Foe big (40)']) expect(labels).toContain(l);
    expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
  });

  it('the sounds: its own five clips, every one of them cued by a default, and every fx clip a default names is in the style\'s list', () => {
    expect([C.sfxPluckClip, C.sfxStrumClip, C.sfxBassClip, C.sfxPumpClip, C.sfxRiserClip]).toEqual(['fx/chord-pluck', 'fx/chord-strum', 'fx/chord-bass', 'fx/chord-kick', 'fx/chord-feedback']);
    const listed = [...(ATTACK_FX_CLIPS.chord ?? [])];
    expect(listed.filter((c) => c.startsWith('fx/chord-')).sort()).toEqual(['fx/chord-bass', 'fx/chord-feedback', 'fx/chord-kick', 'fx/chord-pluck', 'fx/chord-strum']);
    const used = new Set(HERO_CHORD_CLIP_KEYS.map((k) => C[k]));
    for (const clip of listed) expect(used.has(clip), clip).toBe(true);
    for (const clip of used) if (clip.startsWith('fx/')) expect(listed, clip).toContain(clip);
    expect(STRING_RATES).toHaveLength(STAFF_LINES);
    for (let i = 1; i < STRING_RATES.length; i++) expect(STRING_RATES[i]!).toBeGreaterThan(STRING_RATES[i - 1]!); // the strings walk UP
  });
});

describe('the plan', () => {
  it('SMALL and MEDIUM: the staff is taut before the hero plays, and the blow lands as the ride ends', () => {
    for (const p of [P1, P2]) {
      expect(p.stringEnd).toBe(p.chargeAt + C.stringMs + C.stringStaggerMs * (STAFF_LINES - 1));
      expect(p.releaseAt).toBeGreaterThan(p.stringEnd);
      expect(p.impactAt).toBe(p.releaseAt + p.flyMs);
      for (const r of p.riders) expect(r.at + r.flyMs).toBe(p.impactAt);
      const kinds = chordCues(p).map((q) => q.kind);
      expect(kinds).toEqual(['charge', 'release', 'impact', 'slack', 'end']);
    }
    // Even with the wind-up slider at its minimum the staff still finishes stringing first.
    const rushed = chordPlan({ total: 3, distance: 1600 }, { ...C, v1ChargeMs: 60 });
    expect(rushed.releaseAt).toBeGreaterThan(rushed.stringEnd);
  });

  it('BIG: the speaker powers up, pumps three times a beat apart, holds its breath, then THE DROP; the first front arriving is THE impact and two more follow', () => {
    expect(P4.ampAt).toBe(P4.chargeAt + C.v3ChargeMs);
    expect(P4.pumps).toEqual(Array.from({ length: COUNT_IN }, (_, i) => P4.ampAt + AMP_LEAD_MS + i * C.beatMs));
    expect(P4.inhaleAt).toBe(P4.pumps[COUNT_IN - 1]! + C.beatMs);
    expect(P4.releaseAt).toBe(P4.inhaleAt + C.inhaleMs);
    expect(P4.releaseAt - P4.pumps[COUNT_IN - 1]!).toBeGreaterThan(C.beatMs); // the last beat is held longer: anticipation
    expect(P4.impactAt).toBe(P4.releaseAt + C.v3FlyMs);
    // The wave is a train: the later fronts ARRIVE a steady gap after the first, and each LEFT one flight earlier.
    expect(P4.echoes).toEqual([P4.impactAt + C.echoGapMs, P4.impactAt + C.echoGapMs * 2]);
    const cues = chordCues(P4);
    expect(cues.map((q) => q.kind)).toEqual(['charge', 'amp', 'pump', 'pump', 'pump', 'inhale', 'release', 'echo', 'impact', 'echo', 'slack', 'end']);
    expect(cues.filter((q) => q.kind === 'echo').map((q) => q.at)).toEqual(P4.echoes.map((at) => at - P4.flyMs));
    // The staff stays up (and the portrait pinned) until the last front is past.
    expect(P4.slackAt).toBeGreaterThanOrEqual(P4.echoes[1]! + 200);
    // No echoes on the other looks, none under reduced motion, the dial takes them away, and they are capped.
    expect([P1.echoes, P2.echoes, plan([40], 40, 1600, true).echoes]).toEqual([[], [], []]);
    expect(chordPlan({ total: 40, distance: 1600 }, { ...C, echoes: 0 }).echoes).toEqual([]);
    expect(chordPlan({ total: 40, distance: 1600 }, { ...C, echoes: 99 }).echoes.length).toBe(CHORD_CAPS.echoes);
  });

  it('exactly one impact cue at every look, and the cues are in time order', () => {
    for (const p of [P1, P2, P3, P4]) {
      const cues = chordCues(p);
      expect(cues.filter((q) => q.kind === 'impact')).toHaveLength(1);
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.at).toBeGreaterThanOrEqual(cues[i - 1]!.at);
      expect(cues[cues.length - 1]!.kind).toBe('end');
    }
  });

  it('short to medium, as an Epic should be (from the first string; Storm Call, its source, runs 1130 / 1350 / 2233)', () => {
    const t = (p: ReturnType<typeof plan>): number[] => [Math.round(p.releaseAt - p.chargeAt), Math.round(p.impactAt - p.chargeAt), Math.round(p.endAt - p.chargeAt)];
    expect([t(P1), t(P2), t(P4)]).toEqual([[400, 700, 1362], [420, 740, 1682], [1310, 1710, 3092]]);
    // Big is the top look: it runs as long as the shipped top looks (Soccer IV 3308, Frost IV 3083), no longer.
    expect(t(P4)[2]).toBeGreaterThanOrEqual(2800);
    expect(t(P4)[2]).toBeLessThanOrEqual(3400);
  });

  it('every look escalates: more shake, zoom, burst notes, sparks, burst and dim', () => {
    const ps = [P1, P2, P4];
    for (let i = 1; i < 3; i++) for (const k of ['shakePx', 'zoom', 'notes', 'sparks', 'burst', 'dim'] as const) expect(ps[i]![k], `${k} ${i}`).toBeGreaterThan(ps[i - 1]![k]);
  });

  it('the caps always hold', () => {
    const wild: HeroChordConfig = { ...C, v3Notes: 30, v3Sparks: 50, v3Shake: 40, v3Zoom: 0.12 };
    const p = chordPlan({ total: 99, distance: 800 }, wild);
    expect(p.notes).toBeLessThanOrEqual(CHORD_CAPS.notes);
    expect(p.sparks).toBeLessThanOrEqual(CHORD_CAPS.sparks);
    expect(p.shakePx).toBeLessThanOrEqual(CHORD_CAPS.shakePx);
    expect(p.zoom).toBeLessThanOrEqual(CHORD_CAPS.zoom);
  });

  it('reduced motion: no staff, speakers, shake, zoom or dim; the blow still lands once', () => {
    const p = plan([3, 4], 25, 800, true);
    expect([p.shakePx, p.zoom, p.dim, p.riders.length, p.speaker]).toEqual([0, 0, 0, 0, false]);
    const kinds = chordCues(p).map((q) => q.kind);
    expect(kinds).toEqual(['impact', 'end']);
    expect(chordCameraAt(p, C, p.impactAt + 10)).toEqual({ zoom: 1, x: 0, y: 0 });
    const g = chordGeometry(p, A, D, R, R, C);
    expect([g.from, g.to, g.speaker, g.waveFrom]).toEqual([null, null, null, null]);
  });

  it('is deterministic (a replay plays what the live fight did), and the scatter follows the roll seed', () => {
    expect(plan([4, 2, 3, 5, 6], 20, 720)).toEqual(plan([4, 2, 3, 5, 6], 20, 720));
    expect(chordGeometry(P4, A, D, R, R, C, 1)).toEqual(chordGeometry(P4, A, D, R, R, C, 1));
    expect(chordSeed(14, 1500.2, 'player')).toBe(chordSeed(14, 1500.4, 'player'));
    expect(chordSeed(14, 1500, 'player')).not.toBe(chordSeed(14, 1500, 'opp'));
    expect(chordSeed(14, 1500, 'player', 77)).toBe(chordSeed(14, 1500, 'player', 77));
    expect(chordSeed(14, 1500, 'player', 77)).not.toBe(chordSeed(14, 1500, 'player', 78));
  });
});

describe('the geometry', () => {
  it('the staff runs from the striker\'s rim to a point INSIDE the struck face, in both directions', () => {
    for (const [a, d] of [[A, D], [D, A]] as const) {
      const g = chordGeometry(P1, a, d, R, R, C);
      expect(Math.hypot(g.from!.x - a.x, g.from!.y - a.y)).toBeCloseTo(R * 0.9, 3);
      expect(Math.hypot(g.to!.x - d.x, g.to!.y - d.y)).toBeLessThan(R * 0.5);
      expect(g.hit).toEqual(g.to);
      // Across the staff is a unit vector square to it, and always points DOWN the screen (so the sag hangs).
      expect(Math.hypot(g.across.x, g.across.y)).toBeCloseTo(1, 6);
      expect(g.across.x * (d.x - a.x) + g.across.y * (d.y - a.y)).toBeCloseTo(0, 6);
      expect(g.across.y).toBeGreaterThan(0);
      expect(g.gap).toBe(C.staffGap);
      expect(g.speaker).toBeNull();
    }
  });

  it('BIG: the speaker IS the striking portrait (no prop anywhere), in both directions; the wave leaves its centre and the blow arrives along striker -> struck', () => {
    for (const [a, d] of [[A, D], [D, A]] as const) {
      const g = chordGeometry(P4, a, d, R, 90, C, 1);
      expect(g.speaker).toEqual({ x: a.x, y: a.y, r: 90 });
      expect(g.waveFrom).toEqual({ x: a.x, y: a.y });
      const dir = chordArrivalDir(g, a, d);
      expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 6);
      const L = Math.hypot(d.x - a.x, d.y - a.y);
      expect(dir.x).toBeCloseTo((d.x - a.x) / L, 6); expect(dir.y).toBeCloseTo((d.y - a.y) / L, 6);
    }
    // Its standing rings sit just outside the portrait's rim, each one further out.
    expect(SPEAKER_RINGS[0]).toBeGreaterThan(1);
    for (let i = 1; i < SPEAKER_RINGS.length; i++) expect(SPEAKER_RINGS[i]!).toBeGreaterThan(SPEAKER_RINGS[i - 1]!);
  });

  it('the staff pinches to a point at both ends and runs parallel between; a note never hangs upside down', () => {
    expect(staffSpread(0)).toBe(0);
    expect(staffSpread(1)).toBe(0);
    expect(staffSpread(0.5)).toBe(1);
    expect(staffSpread(0.2)).toBe(1);
    expect(rideEase(0)).toBe(0);
    expect(rideEase(1)).toBeCloseTo(1, 9);
    expect(rideEase(0.5)).toBeLessThan(0.5); // still speeding up as it lands
    for (const ang of [-3, -2, -1, 0, 1, 2, 3]) expect(Math.abs(noteLean(ang))).toBeLessThanOrEqual(0.7 + 1e-9);
    expect(noteLean(Math.atan2(-670, 1578))).toBeCloseTo(noteLean(Math.atan2(670, -1578)), 9); // the same lean both ways
  });
});

describe('the camera', () => {
  it('pushes in through the wind-up, punches in on the impact and shakes along the blow; rests by the end', () => {
    const dir = { x: 0.8, y: -0.6 };
    const hit = chordCameraAt(P2, C, P2.impactAt, dir);
    expect(hit.zoom).toBeGreaterThan(1 + P2.zoom * 0.9);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P2.shakePx * 0.5);
    const rest = chordCameraAt(P2, C, P2.endAt, dir);
    expect(rest.zoom).toBeCloseTo(1, 2);
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(0.8);
  });

  it('Big: a thump straight DOWN on every pump, harder each time; a recoil on the drop; a slower, longer shake on the blow; a thump per later front; the focus stays on the striker through the count-in and reaches the target with the wave; the zoom stays gentle', () => {
    const dir = { x: 0.92, y: -0.39 };
    const thumps = P4.pumps.map((at) => chordCameraAt(P4, C, at + 1, dir));
    for (const k of thumps) { expect(k.y).toBeGreaterThan(P4.shakePx * 0.1); expect(Math.abs(k.x)).toBeLessThan(1.5); }
    expect(thumps[2]!.y).toBeGreaterThan(thumps[0]!.y);
    const recoil = chordCameraAt(P4, C, P4.releaseAt + 1, dir);
    expect(recoil.x * dir.x + recoil.y * dir.y).toBeLessThan(-P4.shakePx * 0.15); // kicked BACK, away from the foe
    const hit = chordCameraAt(P4, C, P4.impactAt + 1, dir);
    expect(hit.x * dir.x + hit.y * dir.y).toBeGreaterThan(P4.shakePx * 0.7);
    // Each later front thumps the view again (compare with the same instant had there been no echoes).
    const bare = { ...P4, echoes: [] };
    for (const at of P4.echoes) {
      const a = chordCameraAt(P4, C, at + 2, dir), b = chordCameraAt(bare, C, at + 2, dir);
      expect((a.x - b.x) * dir.x + (a.y - b.y) * dir.y).toBeGreaterThan(P4.shakePx * 0.25);
    }
    // The inhale lets the push go (the view holds its breath), then the wave throws it back in.
    expect(chordCameraAt(P4, C, P4.releaseAt - 1, dir).zoom).toBeLessThan(chordCameraAt(P4, C, P4.inhaleAt, dir).zoom);
    expect(chordCameraAt(P4, C, P4.impactAt, dir).zoom).toBeGreaterThan(chordCameraAt(P4, C, P4.inhaleAt, dir).zoom);
    expect(chordCameraFocus(P4, P4.chargeAt, A, D)).toEqual(A);
    expect(chordCameraFocus(P4, P4.pumps[1]!, A, D)).toEqual(A);
    expect(chordCameraFocus(P4, P4.impactAt, A, D)).toEqual(D);
    let peak = 1;
    for (let t = P4.chargeAt; t < P4.endAt; t += 8) peak = Math.max(peak, chordCameraAt(P4, C, t).zoom);
    expect(peak).toBeLessThan(1.2);
    expect(chordCameraAt(P4, C, P4.endAt).zoom).toBeCloseTo(1, 2);
  });
});

function manualFrames(): { frames: HeroChordOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

/** What the portraits looked like before the attack: a transform of their own, an opacity, a filter and a class. */
const REST = { transform: 'translateY(3px)', opacity: '0.9', filter: 'brightness(1.1)', className: 'herolunge z-top' } as const;
function portrait(): HTMLElement {
  const el = document.createElement('div');
  el.style.transform = REST.transform; el.style.opacity = REST.opacity; el.style.filter = REST.filter; el.className = REST.className;
  return el;
}
function expectAtRest(el: HTMLElement, what: string): void {
  expect(el.style.transform, `${what}: transform`).toBe(REST.transform);
  expect(el.style.opacity, `${what}: opacity`).toBe(REST.opacity);
  expect(el.style.filter, `${what}: filter`).toBe(REST.filter);
  expect(el.className, `${what}: class`).toBe(REST.className);
}

function run(over: Partial<HeroChordOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = portrait();
  const defenderEl = portrait();
  document.body.append(host, camera);
  const h = playHeroChord({
    formation: formationOf([3, 2, 4], 9),
    total: 9, side: 'player', attacker: A, defender: D, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl,
    ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('SMALL: the staff strings out, one note rides it, and the blow lands EXACTLY ONCE as it arrives; everything is put back', () => {
    const { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl } = run({ total: 3, formation: formationOf([3], 3) });
    expect(h.plan.level).toBe(1);
    expect(host.querySelector('.hblast.hchord')).not.toBeNull();
    f.tick(h.plan.stringEnd + 20, 4);
    expect(h.scene!.staffUp).toBe(true);
    expect(h.scene!.liveMeshes).toBe(MAX_CHORD_MESHES);
    expect(h.scene!.liveRiders).toBe(0); // the hero has not played yet
    f.tick(h.plan.releaseAt - h.elapsed() + 20, 4);
    expect(h.scene!.liveRiders).toBe(1);
    expect(attackerEl.style.transform).not.toBe(REST.transform); // the hero is thrown forward
    f.tick(h.plan.impactAt - h.elapsed() - 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(16, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveRiders).toBe(0); // the note is gone: it burst
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('translate('); // knocked back
    expect(defenderEl.style.transform).not.toContain('skew'); // only the bass wave skews
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-3');
    f.tick(h.plan.endAt - h.plan.impactAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast')).toBeNull();
    expect(camera.style.transform).toBe('');
    expectAtRest(attackerEl, 'striker');
    expectAtRest(defenderEl, 'struck');
    f.tick(3000, 16);
    expect(h.scene!.staffUp).toBe(false);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('MEDIUM: three notes ride together and land at once (one blow, never three)', () => {
    const { h, f, onImpact } = run({ total: 8, formation: formationOf([8], 8) });
    expect(h.plan.level).toBe(2);
    f.tick(h.plan.releaseAt + 40, 4);
    expect(h.scene!.liveRiders).toBe(3);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() + 12, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveRiders).toBe(0);
    f.tick(h.plan.endAt + 3000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(f.hooked()).toBe(0);
  });

  it('BIG: the striking portrait powers up as the speaker and pumps three times (it swells, notes wait on the staff), holds its breath, the wave rolls out and its front arriving lands the blow ONCE; the struck portrait is blown back (skewed), battered by two more fronts, and put back exactly', () => {
    const { h, f, onImpact, defenderEl, attackerEl } = run({ total: 40, formation: formationOf([40], 40) });
    expect(h.plan.speaker).toBe(true);
    f.tick(h.plan.ampAt + 20, 4);
    expect(h.scene!.speakerUp).toBe(true);
    expect(h.scene!.speakerKick).toBe(0);
    const scaleOf = (el: HTMLElement): number => Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);
    const swell: number[] = [];
    for (const at of h.plan.pumps) {
      f.tick(at - h.elapsed() + 12, 4);
      expect(h.scene!.speakerKick).toBeGreaterThan(0.5);
      swell.push(scaleOf(attackerEl));
    }
    expect(swell[0]!).toBeGreaterThan(1.03); // the portrait itself swells on a pump
    expect(swell[2]!).toBeGreaterThan(swell[0]!); // more each time
    f.tick(220, 4);
    expect(h.scene!.liveRests).toBe(9); // three per pump
    expect(h.scene!.waveUp).toBe(false);
    expect(onImpact).not.toHaveBeenCalled();
    // THE INHALE: nothing new leaves; the striker draws in.
    f.tick(h.plan.releaseAt - h.elapsed() - 8, 4);
    expect(h.scene!.waveUp).toBe(false);
    expect(scaleOf(attackerEl)).toBeLessThan(swell[2]!);
    f.tick(20, 4);
    expect(h.scene!.waveUp).toBe(true);
    expect(h.scene!.speakerKick).toBeGreaterThan(1); // the drop kicks hardest
    f.tick(48, 4);
    expect(h.scene!.waveFront).toBeGreaterThan(0);
    expectAtRest(defenderEl, 'struck, before the front arrives');
    f.tick(h.plan.impactAt - h.elapsed() - 8, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveRests).toBeLessThan(9); // the front is sweeping the waiting notes away
    f.tick(20, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(defenderEl.style.transform).toMatch(/skewX\(-?\d/);
    expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_CHORD_SPRITES);
    // Still pinned back as each later front arrives, and nothing more lands.
    const skewOf = (el: HTMLElement): number => Math.abs(Number(/skewX\((-?[\d.]+)deg\)/.exec(el.style.transform)?.[1] ?? 0));
    for (const at of h.plan.echoes) {
      f.tick(at - h.elapsed() + 12, 4);
      expect(skewOf(defenderEl)).toBeGreaterThan(C.blowSkew * 0.5);
      expect(h.scene!.liveSprites).toBeLessThanOrEqual(MAX_CHORD_SPRITES);
      expect(onImpact).toHaveBeenCalledTimes(1);
    }
    f.tick(h.plan.endAt + 3000, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.speakerUp).toBe(false);
    expect(h.scene!.waveUp).toBe(false);
    expectAtRest(defenderEl, 'struck');
    expectAtRest(attackerEl, 'striker');
    expect(f.hooked()).toBe(0);
  });

  it('the blow-back leans DOWNWIND (the portrait\'s top goes the way the wave travels) and springs back to nothing', () => {
    expect(blowAt(-1)).toBe(0);
    expect(blowAt(0)).toBe(1);
    expect(Math.abs(blowAt(BLOW_HOLD_MS + 1100))).toBeLessThan(0.004);
    // Pinned (and fluttering) for the whole hold: never much below full, never above it by much.
    for (let t = 0; t < BLOW_HOLD_MS; t += 8) { expect(blowAt(t)).toBeGreaterThan(0.7); expect(blowAt(t)).toBeLessThan(1.06); }
    let min = 1;
    for (let t = 0; t < BLOW_HOLD_MS + 600; t += 4) min = Math.min(min, blowAt(t));
    expect(min).toBeLessThan(0); // it swings back past upright
    expect(min).toBeGreaterThan(-0.5); // but never as far the other way
    const skewOf = (el: HTMLElement): number => Number(/skewX\((-?[\d.]+)deg\)/.exec(el.style.transform)?.[1]);
    const a = run({ total: 40, formation: formationOf([40], 40) }); // the wave travels to the RIGHT
    a.f.tick(a.h.plan.impactAt + 8, 4);
    expect(skewOf(a.defenderEl)).toBeLessThan(-C.blowSkew * 0.7);
    a.h.cancel();
    const b = run({ total: 40, formation: formationOf([40], 40), side: 'opp', attacker: D, defender: A }); // to the LEFT
    b.f.tick(b.h.plan.impactAt + 8, 4);
    expect(skewOf(b.defenderEl)).toBeGreaterThan(C.blowSkew * 0.7);
    b.h.cancel();
  });

  it('a knockout blow of 3 plays the speaker', () => {
    const { h } = run({ total: 3, knockout: true, formation: formationOf([3], 3) });
    expect(h.plan.speaker).toBe(true);
    expect(h.geo.speaker).not.toBeNull();
    h.cancel();
  });

  it('works in both directions at every look, inside the caps, and everything it draws stays near the screen', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? A : D;
        const d = side === 'player' ? D : A;
        const { h, f, onImpact, root } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peakS = 0, peakM = 0;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) {
          f.tick(16, 16);
          peakS = Math.max(peakS, h.scene!.liveSprites); peakM = Math.max(peakM, h.scene!.liveMeshes);
          // The staff's strips never leave the two heroes' span (plus its swing).
          const staff = root.children[0]?.children.find((c) => c.label === 'heroChord-staff') as Container | undefined;
          for (const m of staff?.children ?? []) {
            const v = (m as unknown as { vertices: Float32Array }).vertices;
            for (let i = 0; i < v.length; i += 2) { x0 = Math.min(x0, v[i]!); x1 = Math.max(x1, v[i]!); y0 = Math.min(y0, v[i + 1]!); y1 = Math.max(y1, v[i + 1]!); }
          }
        }
        expect(x0, `${side} ${total} left`).toBeGreaterThan(Math.min(a.x, d.x) - 160);
        expect(x1, `${side} ${total} right`).toBeLessThan(Math.max(a.x, d.x) + 160);
        expect(y0, `${side} ${total} top`).toBeGreaterThan(Math.min(a.y, d.y) - 160);
        expect(y1, `${side} ${total} bottom`).toBeLessThan(Math.max(a.y, d.y) + 160);
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peakS).toBeLessThanOrEqual(MAX_CHORD_SPRITES);
        expect(peakM).toBeLessThanOrEqual(MAX_CHORD_MESHES);
        expect(Math.hypot(h.geo.hit.x - d.x, h.geo.hit.y - d.y)).toBeLessThanOrEqual(R * 0.8);
        h.cancel();
      }
    }
  });

  it('THE CAMERA IS APPLIED ONCE: with the FX canvas inside the camera element the Pixi root never mirrors it', () => {
    const inCam = document.createElement('div');
    inCam.appendChild(document.createElement('canvas'));
    const a = run({ total: 40, formation: formationOf([40], 40), camera: inCam });
    a.f.tick(a.h.plan.impactAt + 20, 4);
    expect(inCam.style.transform).toContain('scale(');
    expect(a.h.scene!.root.scale.x).toBe(1);
    a.h.cancel();
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.impactAt + 20, 4);
    expect(b.h.scene!.root.scale.x).toBeGreaterThan(1);
    b.h.cancel();
  });

  it('a replay plays the same; a different roll seed scatters differently but keeps the plan', () => {
    const a = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5 });
    const b = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5 });
    const c = run({ total: 40, formation: formationOf([40], 40), rollSeed: 6 });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.geo).toEqual(b.h.geo);
    expect(c.h.plan).toEqual(a.h.plan);
    const snap = (r: ReturnType<typeof run>): string => {
      const out: number[] = [];
      for (const layer of r.root.children[0]!.children) for (const s of layer.children) if (s.visible) out.push(Math.round(s.x * 10), Math.round(s.y * 10));
      return out.join(',');
    };
    for (const r of [a, b, c]) r.f.tick(r.h.plan.pumps[1]! + 200, 8);
    expect(snap(a)).toBe(snap(b));
    expect(snap(a)).not.toBe(snap(c));
    a.h.cancel(); b.h.cancel(); c.h.cancel();
  });

  it('finish() before impact still lands the blow once and ends; cancel() never lands it; both put everything back, at any moment', () => {
    const a = run({ total: 40, formation: formationOf([40], 40) });
    a.f.tick(a.h.plan.pumps[0]! + 30);
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    expect(a.camera.style.transform).toBe('');
    expectAtRest(a.attackerEl, 'striker after finish');
    expectAtRest(a.defenderEl, 'struck after finish');
    // Cancel in the middle of the blow-back (the portrait is skewed right now).
    const b = run({ total: 40, formation: formationOf([40], 40) });
    b.f.tick(b.h.plan.impactAt + 24, 4);
    expect(b.defenderEl.style.transform).toContain('skewX');
    b.h.cancel();
    expectAtRest(b.defenderEl, 'struck after cancel');
    expectAtRest(b.attackerEl, 'striker after cancel');
    expect(b.onDone).not.toHaveBeenCalled();
    expect(b.host.querySelector('.hblast')).toBeNull();
    expect(b.camera.style.transform).toBe('');
    expect(b.root.children).toHaveLength(0);
    // Cancel before the blow: it never lands.
    const c = run({ total: 8, formation: formationOf([8], 8) });
    c.f.tick(c.h.plan.releaseAt + 50);
    c.h.cancel();
    c.f.tick(5000);
    expect(c.onImpact).not.toHaveBeenCalled();
    expectAtRest(c.defenderEl, 'struck after an early cancel');
    expectAtRest(c.attackerEl, 'striker after an early cancel');
    expect(c.root.children).toHaveLength(0);
  });

  it('reduced motion: no Pixi layer, no camera or portrait move; the blow lands once', () => {
    const { h, f, root, onImpact, camera, defenderEl, attackerEl } = run({ reduced: true, total: 40, formation: formationOf([40], 40) });
    expect(root.children).toHaveLength(0);
    expect(h.scene).toBeNull();
    f.tick(h.plan.impactAt + 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(camera.style.transform).toBe('');
    expectAtRest(defenderEl, 'struck');
    expectAtRest(attackerEl, 'striker');
    f.tick(h.plan.endAt);
    expect(f.hooked()).toBe(0);
  });

  it('the safety timer lands the blow and puts the portraits back if frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const onImpact = vi.fn();
      const defenderEl = portrait(), attackerEl = portrait();
      const h = playHeroChord({
        formation: formationOf([25], 25), total: 25, attacker: { x: 0, y: 0 }, defender: { x: 800, y: 0 },
        cfg: C, reduced: false, onImpact, frames: () => () => {}, textures: TEX, sound: false, mount: () => () => {}, host: null, camera: null,
        attackerEl, defenderEl,
      });
      vi.advanceTimersByTime(h.plan.endAt + 2600);
      expect(onImpact).toHaveBeenCalledTimes(1);
      expect(h.done).toBe(true);
      expectAtRest(defenderEl, 'struck');
      expectAtRest(attackerEl, 'striker');
    } finally { vi.useRealTimers(); }
  });
});

describe('the scene (headless Pixi)', () => {
  const G1 = chordGeometry(P1, A, D, R, R, C);
  const allStrips = (s: HeroChordScene): { vertices: Float32Array; alpha: number; blendMode: string }[] =>
    (s.root.children.find((c) => c.label === 'heroChord-staff') as Container).children as unknown as { vertices: Float32Array; alpha: number; blendMode: string }[];
  /** The ten line strips (five glows, then five strings), without the dark band under them. */
  const staffOf = (s: HeroChordScene): { vertices: Float32Array; alpha: number; blendMode: string }[] => allStrips(s).slice(1);
  const mid = (v: Float32Array, j: number): [number, number] => [(v[j * 4]! + v[j * 4 + 2]!) / 2, (v[j * 4 + 1]! + v[j * 4 + 3]!) / 2];

  it('the staff reads as LIGHT: every string and its glow is additive, over one dark band as wide as the staff', () => {
    const s = new HeroChordScene(TEX, COLORS, LOOK, 1, 5);
    s.string(G1.from!, G1.to!, G1.across, G1.gap);
    for (let i = 0; i < 40; i++) s.update(16);
    const all = allStrips(s);
    expect(all).toHaveLength(STAFF_LINES * 2 + 1);
    expect(all[0]!.blendMode).toBe('normal');
    for (const m of all.slice(1)) expect(m.blendMode).toBe('add');
    expect(all[0]!.alpha).toBeGreaterThan(0.3);
    // In the middle the band is wider than the five lines together, and each glow is several times its string.
    const wide = (v: Float32Array, j: number): number => Math.hypot(v[j * 4]! - v[j * 4 + 2]!, v[j * 4 + 1]! - v[j * 4 + 3]!);
    expect(wide(all[0]!.vertices, 14)).toBeGreaterThan(G1.gap * 4);
    expect(wide(all[1]!.vertices, 14)).toBeGreaterThan(wide(all[1 + STAFF_LINES]!.vertices, 14) * 3);
    expect(wide(all[1 + STAFF_LINES]!.vertices, 14)).toBeGreaterThanOrEqual(8); // a bold string, not a hairline
    for (const m of all.slice(1)) expect(m.alpha).toBeGreaterThan(0.55);
    s.destroy();
  });

  it('the staff is ten strips under the 100-vertex batch limit, drawn in one after another, pinned at both ends', () => {
    expect(STAFF_POINTS * 2).toBeLessThanOrEqual(100);
    const s = new HeroChordScene(TEX, COLORS, LOOK, 1, 5);
    s.string(G1.from!, G1.to!, G1.across, G1.gap);
    expect(s.liveMeshes).toBe(MAX_CHORD_MESHES);
    s.update(C.stringMs * 0.5);
    const strips = staffOf(s);
    // Half way through the first string's draw-in: the first line is showing, the last has not started.
    expect(strips[STAFF_LINES]!.alpha).toBeGreaterThan(0);
    expect(strips[STAFF_LINES * 2 - 1]!.alpha).toBe(0);
    // Its far end is still collapsed on the moving head, well short of the struck hero.
    const head = mid(strips[STAFF_LINES]!.vertices, STAFF_POINTS - 1);
    expect(Math.hypot(head[0] - G1.to!.x, head[1] - G1.to!.y)).toBeGreaterThan(100);
    for (let i = 0; i < 40; i++) s.update(16);
    for (let i = STAFF_LINES; i < STAFF_LINES * 2; i++) {
      const v = strips[i]!.vertices;
      expect(strips[i]!.alpha).toBeGreaterThan(0.8);
      const a = mid(v, 0), b = mid(v, STAFF_POINTS - 1);
      expect(a[0]).toBeCloseTo(G1.from!.x, 3); expect(a[1]).toBeCloseTo(G1.from!.y, 3);
      expect(b[0]).toBeCloseTo(G1.to!.x, 3); expect(b[1]).toBeCloseTo(G1.to!.y, 3);
      for (const x of v) expect(Number.isFinite(x)).toBe(true);
    }
    // In the middle the five lines stand one gap apart.
    const m0 = mid(strips[STAFF_LINES]!.vertices, 14), m4 = mid(strips[STAFF_LINES * 2 - 1]!.vertices, 14);
    expect(Math.hypot(m4[0] - m0[0], m4[1] - m0[1])).toBeGreaterThan(G1.gap * 3.2);
    expect(Math.hypot(m4[0] - m0[0], m4[1] - m0[1])).toBeLessThan(G1.gap * 4.8);
    s.destroy();
  });

  it('a struck line swings and dies away (the vertices are rewritten in place); a thrum moves every line', () => {
    const s = new HeroChordScene(TEX, COLORS, LOOK, 1, 5);
    s.string(G1.from!, G1.to!, G1.across, G1.gap);
    for (let i = 0; i < 120; i++) s.update(16); // strung and still
    const strips = staffOf(s);
    const still = strips.slice(STAFF_LINES).map((m) => Array.from(m.vertices));
    const buffers = strips.map((m) => m.vertices);
    s.pluck(2, 10);
    s.update(16);
    const moved = strips.slice(STAFF_LINES).map((m) => Array.from(m.vertices));
    expect(moved[2]).not.toEqual(still[2]);
    expect(moved[0]).toEqual(still[0]); // only the line that was struck
    s.thrum();
    s.update(16);
    for (let i = 0; i < STAFF_LINES; i++) expect(Array.from(strips[STAFF_LINES + i]!.vertices), `line ${i}`).not.toEqual(still[i]);
    strips.forEach((m, i) => expect(m.vertices).toBe(buffers[i])); // the same buffers: nothing reallocated
    for (let i = 0; i < 200; i++) s.update(16);
    const after = strips.slice(STAFF_LINES).map((m) => Array.from(m.vertices));
    for (let i = 0; i < STAFF_LINES; i++) for (let k = 0; k < after[i]!.length; k++) expect(after[i]![k]!).toBeCloseTo(still[i]![k]!, 1);
    s.destroy();
  });

  it('the bass wave bends the staff where its front is, and nowhere else', () => {
    const g = chordGeometry(P4, A, D, R, R, C, 1);
    const s = new HeroChordScene(TEX, COLORS, LOOK, 1, 5);
    s.string(g.from!, g.to!, g.across, g.gap);
    for (let i = 0; i < 120; i++) s.update(16);
    const strips = staffOf(s);
    const still = Array.from(strips[STAFF_LINES + 2]!.vertices);
    s.bass(g.waveFrom!, D, 320);
    for (let i = 0; i < 10; i++) s.update(16); // half way across
    const front = s.waveFront;
    expect(front).toBeGreaterThan(400);
    const v = strips[STAFF_LINES + 2]!.vertices;
    let near = 0, far = 0;
    for (let j = 1; j < STAFF_POINTS - 1; j++) {
      const [x, y] = mid(v, j);
      const moved = Math.hypot(x - (still[j * 4]! + still[j * 4 + 2]!) / 2, y - (still[j * 4 + 1]! + still[j * 4 + 3]!) / 2);
      const off = Math.abs(Math.hypot(x - g.waveFrom!.x, y - g.waveFrom!.y) - front);
      if (off < 110) near = Math.max(near, moved);
      if (off > 320) far = Math.max(far, moved);
    }
    expect(near).toBeGreaterThan(C.bendPx * 0.4);
    expect(far).toBeLessThan(0.5);
    s.destroy();
  });

  it('a whole Big stays in the caps and drains; destroy leaves nothing', () => {
    const g = chordGeometry(P4, A, D, R, R, C, 1);
    const s = new HeroChordScene(TEX, COLORS, LOOK, 1, 42);
    let peak = 0;
    const step = (n: number): void => { for (let i = 0; i < n; i++) { s.update(16); peak = Math.max(peak, s.liveSprites); } };
    s.string(g.from!, g.to!, g.across, g.gap);
    s.speakerOn(g.speaker!);
    step(15);
    expect(s.speakerUp).toBe(true);
    s.pump(1, 2); s.rest(3); step(16);
    s.pump(1.2, 2); s.rest(3); step(16);
    s.pump(1.44, 2); s.rest(3); step(16);
    expect(s.liveRests).toBe(9);
    s.inhale(140); step(9);
    s.pump(2.1, 3); s.bass(g.waveFrom!, D, 400, 0, R);
    step(10);
    s.echo(g.waveFrom!, D, 400, 0.9, R);
    step(15);
    expect(s.liveRests).toBe(0); // every waiting note was swept away by the front
    s.thrum();
    s.strike(g.hit.x, g.hit.y, R, { level: 3, notes: 18, sparks: 26, burst: 1.7, flashAlpha: 0.9, dir: { x: 0.9, y: -0.4 }, view: VIEW });
    s.echo(g.waveFrom!, D, 400, 0.7, R);
    step(26);
    s.slacken();
    step(10);
    expect(peak).toBeLessThanOrEqual(MAX_CHORD_SPRITES);
    expect(peak).toBeGreaterThan(40);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = s.update(16);
    expect(alive).toBe(false);
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect([s.staffUp, s.speakerUp, s.waveUp]).toEqual([false, false, false]);
    s.destroy();
    expect(s.root.destroyed).toBe(true);
  });

  it('clear() drops everything at once; the sprite pool is reused, not regrown', () => {
    const g = chordGeometry(P4, A, D, R, R, C, 1);
    const s = new HeroChordScene(TEX, COLORS, LOOK, 1, 9);
    const fire = (): void => {
      s.string(g.from!, g.to!, g.across, g.gap); s.speakerOn(g.speaker!);
      for (let i = 0; i < 30; i++) s.update(16);
      s.ride(2, { flyMs: 300, lag: 0, size: 1, hue: 0 }); s.rest(3); s.pump(1, 2); s.bass(g.waveFrom!, D, 330);
      s.update(16);
    };
    fire();
    const pooled = s.pooledSprites;
    s.clear();
    expect(s.liveSprites).toBe(0);
    expect(s.liveMeshes).toBe(0);
    expect([s.staffUp, s.speakerUp, s.waveUp, s.liveRiders, s.liveRests]).toEqual([false, false, false, 0, 0]);
    expect(s.update(16)).toBe(false);
    fire();
    expect(s.pooledSprites).toBeLessThanOrEqual(pooled + 4);
    s.destroy();
  });
});
