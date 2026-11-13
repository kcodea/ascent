// @vitest-environment jsdom
/**
 * THE WRITTEN IN THE STARS HERO ATTACK (attack_stars, ANCIENT): the shared four tiers; the tuner values;
 * the pure plan (Tier 1 the arrow, Tier 2 the bow, Tier 3 the hunter, Tier 4 the medallion and the comet) and its cue
 * timing; the constellations (every line starts from a star that is already lit; the figures stay on screen in both
 * directions and on any layout; the comet always ARRIVES moving down: a straight fall, or an arc over the whole sky);
 * the draw of the bow; Tier 4's held breath (the swell, the hush) and aftermath (the flare, the scatter); THE
 * VARIATIONS (five launch places for Tiers 1 and 2, three Tier 3 figures, four Tier 4 finishers: rolled from the seed,
 * each forceable, each keeping its tier's timeline, each on screen and landing on the struck hero; the riders, the
 * wheel's lock, the nova's gather); the runner on the shared clock (the blow lands exactly ONCE; both directions; every
 * variation; replay; finish / cancel; every exit puts the portraits and the camera back); the headless scene (the path
 * and its tail, the nova, the jolt, the falling sparks).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import {
  HERO_STARS_CLIP_KEYS, HERO_STARS_DEFAULTS, HERO_STARS_RANGES, STARS_FIGURES3, STARS_FIGURES4, STARS_LAUNCHES, STARS_SLOTS, aliveAmount, clampHeroStarsValue,
  drawAmount, figureAmount, flareAmount, gatherAmount, heroStarsConfigJson, hushAmount, launchCentre, placeFigure, pluckPoint, shotAt, shotArrival, shotPoint,
  skyAmount, slotAt, spinAmount, starFigure, starLitAt, starsCameraAt, starsCues, starsPlan, starsVariant, swellAmount,
  type Box, type HeroStarsConfig, type HeroStarsNumKey, type StarFigure, type StarsLaunch, type StarsPlan, type StarsVariant,
} from './heroStarsConfig';
import { HeroStarsScene, MAX_STARS_SPRITES, type HeroStarsTextures, type SkyFrame, type StarsLook } from './heroStarsScene';
import { playHeroStars, starsSeed, type HeroStarsOptions } from './heroStars';
import { SPEC } from '../HeroStarsTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroStarsTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  glint: W, dot: W, line: W, trail: W, arrow: W, limb: W, veil: W, halo: W,
};
const C = HERO_STARS_DEFAULTS;
/** The defaults with every variation forced to its first option (the hunter, written in the stars, beside the striker). */
const CW: HeroStarsConfig = { ...C, launch: '1', figure3: '1', figure4: '1' };
const plan = (total: number, o: { knockout?: boolean; knockoutVariant?: boolean; reduced?: boolean } = {}): StarsPlan =>
  starsPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const TOTALS = [3, 8, 14, 40] as const;
const SCREEN: Box = { x: 0, y: 0, w: 1920, h: 1080 };
/** The real 1920 x 1080 layout: you bottom left, the foe tucked into the top right corner. */
const YOU = { x: 150, y: 840 }, FOE = { x: 1770, y: 140 };
const R = 130;
const fig = (total: number, a = YOU, d = FOE, bounds = SCREEN, r = R): StarFigure =>
  starFigure(plan(total), { attacker: a, defender: d, radius: r, attackerRadius: r, bounds }, C)!;

describe('the tiers', () => {
  it('uses the shared thresholds; a knockout plays Tier 4 (written in the stars)', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).tier, `dmg ${d}`).toBe(tierOf(d));
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'written', ko: false });
    expect(plan(2, { knockout: true, knockoutVariant: true }).ko).toBe(true);
    expect(TOTALS.map((t) => plan(t).kind)).toEqual(['arrow', 'bow', 'hunter', 'written']);
    expect(HERO_ATTACK_STYLES).toContain('stars');
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; all four tier buttons on top', () => {
    for (const [k, [min, max]] of Object.entries(HERO_STARS_RANGES)) {
      const v = C[k as HeroStarsNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroStarsValue('t4SkyStars', 999)).toBe(160);
    expect(clampHeroStarsValue('colorSky', 'night')).toBe(C.colorSky);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroStarsConfigJson(C)).previewParts).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    // The four tier buttons in both directions (their labels belong to the shared tuner builder).
    const labels = SPEC.actions!.map((a) => a.label).join(' | ');
    for (const n of ['(3)', '(8)', '(12)', '(40)']) expect(labels).toContain(n);
    expect(SPEC.actions!.filter((a) => a.label.includes('(40)')).length).toBeGreaterThanOrEqual(2);
    // The three Variation rows sit right under the Attack style row, with Random first and one option per variation.
    const rows = SPEC.controls.slice(1, 4);
    expect(rows.map((c) => c.key)).toEqual(['launch', 'figure3', 'figure4']);
    expect(rows.map((c) => (c.options ?? []).length)).toEqual([1 + STARS_LAUNCHES.length, 1 + STARS_FIGURES3.length, 1 + STARS_FIGURES4.length]);
    for (const c of rows) expect(c.options![0]).toBe('');
    expect(JSON.parse(heroStarsConfigJson(CW)).figure4).toBeUndefined(); // a DEV override never ships
    expect(DEV_HERO_ATTACK_CHOICES).toContain('stars');
  });

  it('labels the looks Tier 1 to Tier 4 (no roman numerals, no Small / Huge)', () => {
    const text = SPEC.controls.map((c) => `${c.label} ${c.hint ?? ''}`).join(' ');
    expect(text).not.toMatch(/\bTier (I|II|III|IV)\b|\b(I|II|III|IV):|\bHuge\b/);
    expect(text).toContain('Tier 4');
  });

  it('every sound it names is a real clip; none is the rune explosion or the turn explosion', () => {
    const bank = new Set(fs.readdirSync(path.join(__dirname, '..', 'audio', 'fx')).map((f) => `fx/${f.replace(/\.(mp3|wav)$/, '')}`));
    for (const k of HERO_STARS_CLIP_KEYS) {
      expect(bank.has(C[k]), `${k} = ${C[k]}`).toBe(true);
      expect(C[k], k).not.toMatch(/turnexplosion|rune/i);
    }
  });
});

describe('the plan', () => {
  it('every look: the sky, the trace (one step per slot), alive, the draw, the hold, the loose, the blow, the fade', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      const t = `tier ${p.tier}`;
      expect(p.slots, t).toBe(STARS_SLOTS[p.kind]);
      expect(p.traceAt - p.chargeAt, t).toBe(C[`t${p.tier}SkyMs`]);
      expect(p.tracedAt - p.traceAt, t).toBe(p.slots * C[`t${p.tier}StepMs`]);
      expect(p.drawAt - p.tracedAt, t).toBe(C[`t${p.tier}AliveMs`]);
      expect(p.holdAt - p.drawAt, t).toBe(C[`t${p.tier}DrawMs`]);
      expect(p.looseAt - p.holdAt, t).toBe(C[`t${p.tier}HoldMs`]);
      expect(p.impactAt, t).toBeGreaterThan(p.looseAt + 60);
      expect(p.outAt, t).toBeGreaterThanOrEqual(p.impactAt);
      expect(p.endAt, t).toBeGreaterThan(p.outAt);
      expect(p.endAt - p.impactAt, t).toBe(C[`t${p.tier}SettleMs`]);
      expect(slotAt(p, p.slots), t).toBe(p.tracedAt);
    }
    // Tier 4's fall is its own length; an arrow's flight follows the board.
    expect(plan(40).impactAt - plan(40).looseAt).toBe(C.t4FlyMs);
    const near = starsPlan({ total: 3, distance: 600 }, C), far = starsPlan({ total: 3, distance: 1600 }, C);
    expect(near.impactAt - near.looseAt).toBeLessThan(far.impactAt - far.looseAt);
  });

  it('the blow grows with the tier: the shake, the punch and the flash on the sky; only Tier 4 scatters its lines', () => {
    const ps = TOTALS.map((t) => plan(t));
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]!.shakePx).toBeGreaterThan(ps[i - 1]!.shakePx);
      expect(ps[i]!.punch).toBeGreaterThan(ps[i - 1]!.punch);
      expect(ps[i]!.flash).toBeGreaterThan(ps[i - 1]!.flash);
    }
    expect(ps[0]!.flash).toBeGreaterThan(0);
    expect(ps[3]!.flash).toBeCloseTo(C.skyFlash, 6);
    for (const p of ps.slice(0, 3)) expect(p.scatterAt).toBe(Infinity);
    const iv = ps[3]!;
    expect(iv.scatterAt - iv.impactAt).toBe(C.scatterMs);
    // The night holds while the sparks drift, then fades.
    expect(iv.outAt).toBeGreaterThan(iv.scatterAt + 300);
    expect(iv.endAt - iv.outAt).toBeGreaterThan(500);
  });

  it('the cues: one star tick per star at the moment its line arrives, in order; exactly one impact and one end', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      const f = fig(total);
      const cues = starsCues(p, f);
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.at).toBeGreaterThanOrEqual(cues[i - 1]!.at);
      expect(cues.filter((q) => q.kind === 'impact')).toHaveLength(1);
      expect(cues.filter((q) => q.kind === 'end')).toHaveLength(1);
      expect(cues[0]).toMatchObject({ kind: 'sky', at: p.chargeAt });
      const stars = cues.filter((q) => q.kind === 'star');
      expect(stars).toHaveLength(f.stars.filter((s) => !s.pluck).length);
      for (const q of stars) {
        expect(q.at).toBe(starLitAt(p, f, q.i));
        expect(q.at).toBeGreaterThanOrEqual(p.traceAt);
        expect(q.at).toBeLessThanOrEqual(p.tracedAt);
      }
      expect(cues.find((q) => q.kind === 'impact')!.at).toBe(p.impactAt);
      expect(cues.find((q) => q.kind === 'loose')!.at).toBe(p.looseAt);
      expect(cues.find((q) => q.kind === 'hold')!.at).toBe(p.holdAt);
      const sc = cues.filter((q) => q.kind === 'scatter');
      expect(sc.map((q) => q.at)).toEqual(p.kind === 'written' ? [p.scatterAt] : []);
    }
  });

  it('pace: Tiers 1 to 3 stay short; Tier 4 takes its time, and the time is in the anticipation and the aftermath, not the trace', () => {
    const len = (d: number): number => { const p = plan(d); return p.endAt - p.chargeAt; };
    expect(len(3)).toBeLessThan(1700);
    expect(len(8)).toBeLessThan(2200);
    expect(len(14)).toBeLessThan(2900);
    expect(len(3)).toBeLessThan(len(8));
    expect(len(8)).toBeLessThan(len(14));
    expect(len(14)).toBeLessThan(len(40));
    // Tier 4: longer than Soccer Tier 4 and Frost Tier 4 (3.3 s and 3.1 s after the formation), but not a cutscene.
    const p = plan(40);
    expect(len(40)).toBeGreaterThan(4200);
    expect(len(40)).toBeLessThan(5200);
    expect(p.looseAt - p.holdAt).toBeGreaterThanOrEqual(500); // the held breath
    expect(p.impactAt - p.looseAt).toBeGreaterThanOrEqual(500); // the comet's fall
    expect(p.endAt - p.impactAt).toBeGreaterThanOrEqual(1500); // the aftermath
    expect(p.tracedAt - p.traceAt).toBeLessThan(1000); // the trace itself is no slower than it was
  });

  it('nothing holds or scales the clock (no dip, no stop); the Knockout remix only shakes harder', () => {
    const p = plan(40), ko = plan(40, { knockout: true, knockoutVariant: true });
    expect(Object.keys(p).join(' ')).not.toMatch(/dip|stop|freeze/i);
    expect(ko.endAt).toBe(p.endAt);
    expect(ko.shakePx).toBeGreaterThan(p.shakePx);
  });

  it('reduced motion: no sky, no figure; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([40], true));
    expect(starFigure(p, { attacker: YOU, defender: FOE, radius: R, attackerRadius: R, bounds: SCREEN }, C)).toBeNull();
    expect(starsCues(p, null).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(skyAmount(p, p.impactAt)).toBe(0);
  });
});

const LAYOUTS: { name: string; a: { x: number; y: number }; d: { x: number; y: number }; bounds: Box; r: number }[] = [
  { name: 'you strike (the real layout)', a: YOU, d: FOE, bounds: SCREEN, r: R },
  { name: 'the foe strikes (the real layout)', a: FOE, d: YOU, bounds: SCREEN, r: R },
  { name: 'both in the middle', a: { x: 600, y: 560 }, d: { x: 1300, y: 520 }, bounds: SCREEN, r: 100 },
  { name: 'stacked', a: { x: 960, y: 900 }, d: { x: 960, y: 160 }, bounds: SCREEN, r: 110 },
  { name: 'a small screen', a: { x: 100, y: 560 }, d: { x: 1180, y: 95 }, bounds: { x: 0, y: 0, w: 1280, h: 720 }, r: 86 },
  { name: 'a sandbox box off the origin', a: { x: 420, y: 520 }, d: { x: 760, y: 330 }, bounds: { x: 300, y: 200, w: 600, h: 440 }, r: 40 },
];

describe('the constellations', () => {
  it('Tier 1: three stars in a row aimed at the struck hero, and two barbs; Tier 2: eight stars; Tier 3: sixteen; Tier 4: a ring of twelve, a crown, a bust, an arm and the star', () => {
    const a = fig(3);
    expect(a.stars).toHaveLength(5);
    const [tail, mid, head] = a.stars as [typeof a.stars[0], typeof a.stars[0], typeof a.stars[0]];
    // In a row: the middle star lies on the line from tail to head, and that line points at the struck hero.
    const cross = (mid.x - tail.x) * (head.y - tail.y) - (mid.y - tail.y) * (head.x - tail.x);
    expect(Math.abs(cross)).toBeLessThan(1);
    expect(Math.atan2(head.y - tail.y, head.x - tail.x)).toBeCloseTo(a.aim, 6);
    expect(a.aim).toBeCloseTo(Math.atan2(FOE.y - a.centre.y, FOE.x - a.centre.x), 6);
    expect(fig(8).stars).toHaveLength(8);
    const h = fig(14);
    expect(h.stars).toHaveLength(16);
    expect(h.stars.length).toBeGreaterThanOrEqual(12);
    const w = fig(40);
    expect(w.stars.filter((s) => s.pluck)).toHaveLength(1);
    expect(w.stars.length).toBeGreaterThanOrEqual(30);
    expect(w.medallion).not.toBeNull();
    // The ring: twelve stars one medallion radius from its centre.
    const m = w.medallion!;
    for (let i = 0; i < 12; i++) expect(Math.hypot(w.stars[i]!.x - m.x, w.stars[i]!.y - m.y)).toBeCloseTo(m.r, 4);
  });

  it('a line never starts from a dark star; every star is reached; the trace fills exactly its slots', () => {
    for (const lay of LAYOUTS) for (const total of TOTALS) {
      const f = fig(total, lay.a, lay.d, lay.bounds, lay.r);
      const t = `${lay.name} ${f.kind}`;
      for (const s of f.stars) expect(Number.isFinite(s.slot), t).toBe(true);
      for (const e of f.edges) {
        expect(f.stars[e.a]!.slot, t).toBeLessThanOrEqual(e.slot);
        expect(f.stars[e.b]!.slot, t).toBeLessThanOrEqual(e.slot + 1);
        expect(e.a, t).not.toBe(e.b);
      }
      expect(Math.max(...f.edges.map((e) => e.slot)) + 1, t).toBe(STARS_SLOTS[f.kind]);
      expect(Math.min(...f.stars.map((s) => s.slot)), t).toBe(0);
      // Every star but the plucked one is joined to the figure by a line.
      f.stars.forEach((s, i) => { if (!s.pluck) expect(f.edges.some((e) => e.a === i || e.b === i), `${t} star ${i}`).toBe(true); });
    }
  });

  it('every figure stays on screen, at rest and at full draw, in both directions and on every layout', () => {
    for (const lay of LAYOUTS) for (const total of TOTALS) {
      const f = fig(total, lay.a, lay.d, lay.bounds, lay.r);
      const b = lay.bounds;
      const t = `${lay.name} ${f.kind}`;
      for (const s of f.stars) for (const w of [0, 1]) {
        const x = s.x + s.px * w, y = s.y + s.py * w;
        expect(x, t).toBeGreaterThanOrEqual(b.x); expect(x, t).toBeLessThanOrEqual(b.x + b.w);
        expect(y, t).toBeGreaterThanOrEqual(b.y); expect(y, t).toBeLessThanOrEqual(b.y + b.h);
      }
      for (const p of [f.centre, f.shotFrom]) {
        expect(p.x, t).toBeGreaterThanOrEqual(b.x); expect(p.x, t).toBeLessThanOrEqual(b.x + b.w);
        expect(p.y, t).toBeGreaterThanOrEqual(b.y); expect(p.y, t).toBeLessThanOrEqual(b.y + b.h);
      }
      // The shot lands on the struck portrait.
      expect(Math.hypot(f.shotTo.x - lay.d.x, f.shotTo.y - lay.d.y), t).toBeLessThan(lay.r * 0.5);
    }
  });

  it('the figure sits above the striking hero when there is sky above it, else beside it (never on top of it)', () => {
    const above = placeFigure(YOU, R, 180, 180, FOE, SCREEN);
    expect(above.y).toBeLessThan(YOU.y - R - 180);
    expect(Math.abs(above.x - YOU.x)).toBeLessThan(120);
    const beside = placeFigure(FOE, R, 180, 180, YOU, SCREEN);
    expect(beside.x).toBeLessThan(FOE.x - R - 180); // toward the other hero
    for (const total of [3, 8, 14]) for (const [a, d] of [[YOU, FOE], [FOE, YOU]] as const) {
      const f = fig(total, a, d);
      for (const s of f.stars) expect(Math.hypot(s.x - a.x, s.y - a.y), `${f.kind}`).toBeGreaterThan(R * 0.9);
    }
  });

  it('Tier 3: the hunter stands upright in a braced stance and faces the struck hero', () => {
    for (const [a, d] of [[YOU, FOE], [FOE, YOU]] as const) {
      const f = fig(14, a, d);
      expect(f.facing).toBe(d.x >= f.centre.x ? 1 : -1);
      const head = f.stars[f.head]!;
      const feet = [f.stars[5]!, f.stars[7]!];
      for (const foot of feet) expect(foot.y).toBeGreaterThan(head.y + f.unit * 0.8);
      expect(Math.abs(feet[0]!.x - feet[1]!.x)).toBeGreaterThan(f.unit * 0.35); // braced
      // The arrow points the way the hunter faces.
      expect(Math.sign(Math.cos(f.aim))).toBe(f.facing);
      expect(f.torso).toHaveLength(3);
    }
  });

  it('Tier 4: the comet comes DOWN onto the struck hero: a straight fall down the sky when there is sky above, else an arc over the whole sky from the far side', () => {
    // The foe strikes you (you are low on the screen): straight down, as far as the dial or the sky allows.
    const down = fig(40, FOE, YOU);
    expect(down.arc).toBe(false);
    expect(down.shotFrom.x).toBeCloseTo(YOU.x, 6);
    expect(YOU.y - down.shotFrom.y).toBeCloseTo(Math.min(C.fallLen * R, YOU.y - SCREEN.h * 0.05), 6);
    expect(YOU.y - down.shotFrom.y).toBeGreaterThan(R * 5); // a long fall
    expect(shotPoint(down, 0.5).x).toBeCloseTo(YOU.x, 6);
    // You strike the foe (it is in the top corner): there is no sky above it, so the star is plucked on the FAR side
    // of the medallion and thrown over the top of the sky.
    const over = fig(40, YOU, FOE);
    expect(over.arc).toBe(true);
    expect(over.shotFrom.x).toBeLessThan(over.medallion!.x - over.medallion!.r); // beyond the medallion, away from the foe
    expect(Math.abs(over.shotFrom.x - FOE.x)).toBeGreaterThan(SCREEN.w * 0.6); // the whole sky is its path
    let top = Infinity;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      const q = shotPoint(over, Math.min(1, u));
      top = Math.min(top, q.y);
      expect(q.x).toBeGreaterThanOrEqual(0); expect(q.x).toBeLessThanOrEqual(SCREEN.w);
      expect(q.y).toBeGreaterThanOrEqual(0); expect(q.y).toBeLessThanOrEqual(SCREEN.h); // it never leaves the screen
    }
    expect(top).toBeLessThan(over.shotFrom.y - 200); // it climbs
    expect(top).toBeLessThan(FOE.y); // above the struck hero, so it comes down onto it
    for (const lay of LAYOUTS) {
      const f = fig(40, lay.a, lay.d, lay.bounds, lay.r);
      // However it travels, it ARRIVES moving downward, and its path is monotonic toward the struck hero's side.
      expect(shotArrival(f).y, lay.name).toBeGreaterThan(0.05);
      expect(shotPoint(f, 1).y, lay.name).toBeGreaterThan(shotPoint(f, 0.97).y);
      expect(shotPoint(f, 0), lay.name).toEqual(f.shotFrom);
      expect(shotPoint(f, 1).x, lay.name).toBeCloseTo(f.shotTo.x, 6);
      expect(f.stars[f.pluck]!).toMatchObject({ x: f.shotFrom.x, y: f.shotFrom.y, pluck: true });
      // The arm's hand stops short of the star and reaches toward it.
      const hand = f.stars[f.pluck - 1]!;
      const before = Math.hypot(hand.x - f.shotFrom.x, hand.y - f.shotFrom.y);
      const after = Math.hypot(hand.x + hand.px - f.shotFrom.x, hand.y + hand.py - f.shotFrom.y);
      expect(after, lay.name).toBeLessThan(before);
    }
    // A hero on the very top edge: still an arc, its control point above the hero.
    const edge = pluckPoint({ x: 500, y: 0 }, 100, 3, { x: 900, y: 300, r: 200 }, SCREEN);
    expect(edge.arc).toBe(true);
    expect(edge.ctrl.y).toBeLessThan(0);
    // The arrows fly straight.
    for (const total of [3, 8, 14]) { const f = fig(total); expect(f.arc).toBe(false); expect(shotPoint(f, 0.5).x).toBeCloseTo((f.shotFrom.x + f.shotTo.x) / 2, 6); }
  });

  it('the same blow draws the same sky (a replay matches); a different roll seeds a different scatter', () => {
    expect(fig(40)).toEqual(fig(40));
    expect(starsSeed(12, 1600, 'player')).toBe(starsSeed(12, 1600, 'player'));
    expect(starsSeed(12, 1600, 'player', 7)).toBe(starsSeed(12, 1600, 'player', 7));
    expect(starsSeed(12, 1600, 'player', 7)).not.toBe(starsSeed(12, 1600, 'player', 8));
    expect(starsSeed(12, 1600, 'player')).not.toBe(starsSeed(12, 1600, 'opp'));
  });
});

const vplan = (total: number, v: Partial<StarsVariant> = {}): StarsPlan =>
  starsPlan({ total, distance: 1600, leadIn: leadInOf([total]), variant: { launch: 'striker', fig3: 'hunter', fig4: 'written', ...v } }, C);
const VARIANT_CASES: { total: number; v: Partial<StarsVariant> }[] = [
  ...STARS_LAUNCHES.flatMap((launch) => [{ total: 3, v: { launch } }, { total: 8, v: { launch } }]),
  ...STARS_FIGURES3.map((fig3) => ({ total: 14, v: { fig3 } })),
  ...STARS_FIGURES4.map((fig4) => ({ total: 40, v: { fig4 } })),
];

describe('the variations', () => {
  it('rolled from the stable seed: the same seed rolls the same, every option turns up, and the tuner forces each one', () => {
    const seen = { launch: new Set<string>(), fig3: new Set<string>(), fig4: new Set<string>() };
    for (let s = 0; s < 300; s++) {
      const v = starsVariant(s, C);
      expect(starsVariant(s, C)).toEqual(v);
      seen.launch.add(v.launch); seen.fig3.add(v.fig3); seen.fig4.add(v.fig4);
    }
    expect(seen.launch.size).toBe(STARS_LAUNCHES.length);
    expect(seen.fig3.size).toBe(STARS_FIGURES3.length);
    expect(seen.fig4.size).toBe(STARS_FIGURES4.length);
    STARS_LAUNCHES.forEach((x, i) => { for (const s of [1, 77, 901]) expect(starsVariant(s, { ...C, launch: String(i + 1) }).launch).toBe(x); });
    STARS_FIGURES3.forEach((x, i) => { for (const s of [1, 77, 901]) expect(starsVariant(s, { ...C, figure3: String(i + 1) }).fig3).toBe(x); });
    STARS_FIGURES4.forEach((x, i) => { for (const s of [1, 77, 901]) expect(starsVariant(s, { ...C, figure4: String(i + 1) }).fig4).toBe(x); });
    // A nonsense override rolls instead.
    expect(starsVariant(5, { ...C, figure4: '9' })).toEqual(starsVariant(5, C));
    // The tier picks which choice matters.
    expect(vplan(14, { fig3: 'wolf', fig4: 'nova' }).kind).toBe('wolf');
    expect(vplan(40, { fig3: 'wolf', fig4: 'nova' }).kind).toBe('nova');
    expect(vplan(3, { fig3: 'wolf', fig4: 'nova', launch: 'open' })).toMatchObject({ kind: 'arrow', launch: 'open' });
  });

  it('each variation keeps its tier\'s timeline (the trace, the alive, the draw, the hold); only the flight and the aftermath differ', () => {
    for (const { total, v } of VARIANT_CASES) {
      const p = vplan(total, v), base = plan(total);
      const t = `${p.kind} ${p.launch}`;
      expect(p.slots, t).toBe(base.slots);
      expect(p.looseAt, t).toBe(base.looseAt);
      expect(p.impactAt, t).toBeGreaterThan(p.looseAt + 60);
      expect(p.endAt - p.impactAt, t).toBe(base.endAt - base.impactAt);
      const cues = starsCues(p, null);
      expect(cues.filter((q) => q.kind === 'impact'), t).toHaveLength(1);
      expect(cues.filter((q) => q.kind === 'lock').map((q) => q.at), t).toEqual(p.kind === 'wheel' ? [p.lockAt] : []);
      if (p.tier === 4) {
        expect(p.endAt - p.chargeAt, t).toBeGreaterThan(4200);
        expect(p.endAt - p.chargeAt, t).toBeLessThan(5200);
        expect(p.scatterAt, t).toBe(p.impactAt + C.scatterMs);
      } else if (p.kind === 'wolf' || p.kind === 'serpent') expect(p.scatterAt, t).toBe(p.impactAt + 90);
      else expect(p.scatterAt, t).toBe(Infinity);
    }
    // The wolf's leap takes longer than the hunter's arrow; the serpent's strike is quicker; the beam is quickest.
    const fly = (p: StarsPlan): number => p.impactAt - p.looseAt;
    expect(fly(vplan(14, { fig3: 'wolf' }))).toBeGreaterThan(fly(plan(14)));
    expect(fly(vplan(14, { fig3: 'serpent' }))).toBeLessThan(fly(plan(14)));
    expect(fly(vplan(40, { fig4: 'wheel' }))).toBeLessThan(fly(vplan(40, { fig4: 'nova' })));
  });

  it('every variation\'s figure: lines start from lit stars, it fills its slots, it stays on screen at rest, at full draw and turned, on every layout, and the shot lands on the struck portrait', () => {
    for (const lay of LAYOUTS) for (const { total, v } of VARIANT_CASES) {
      const p = vplan(total, v);
      const f = starFigure(p, { attacker: lay.a, defender: lay.d, radius: lay.r, attackerRadius: lay.r, bounds: lay.bounds, launch: p.launch }, C)!;
      const b = lay.bounds;
      const t = `${lay.name} ${f.kind} ${p.launch}`;
      expect(f.kind, t).toBe(p.kind);
      for (const st of f.stars) expect(Number.isFinite(st.slot), t).toBe(true);
      for (const e of f.edges) {
        expect(f.stars[e.a]!.slot, t).toBeLessThanOrEqual(e.slot);
        expect(f.stars[e.b]!.slot, t).toBeLessThanOrEqual(e.slot + 1);
      }
      expect(Math.max(...f.edges.map((e) => e.slot)) + 1, t).toBe(STARS_SLOTS[f.kind]);
      expect(Math.min(...f.stars.map((st) => st.slot)), t).toBe(0);
      f.stars.forEach((st, i) => { if (!st.pluck || f.kind !== 'written') expect(f.edges.some((e) => e.a === i || e.b === i), `${t} star ${i}`).toBe(true); });
      const on = (x: number, y: number, what: string): void => {
        expect(x, `${t} ${what}`).toBeGreaterThanOrEqual(b.x - 0.5); expect(x, `${t} ${what}`).toBeLessThanOrEqual(b.x + b.w + 0.5);
        expect(y, `${t} ${what}`).toBeGreaterThanOrEqual(b.y - 0.5); expect(y, `${t} ${what}`).toBeLessThanOrEqual(b.y + b.h + 0.5);
      };
      for (const st of f.stars) for (const w of [0, 1]) on(st.x + st.px * w, st.y + st.py * w, `w${w}`);
      if (f.pivot) for (const st of f.stars) if (st.spin) for (const a of [0.3, 0.7, 1]) {
        const ang = f.spinTurns * a, dx = st.x - f.pivot.x, dy = st.y - f.pivot.y;
        on(f.pivot.x + dx * Math.cos(ang) - dy * Math.sin(ang), f.pivot.y + dx * Math.sin(ang) + dy * Math.cos(ang), `turned ${a}`);
      }
      on(f.shotFrom.x, f.shotFrom.y, 'from'); on(f.centre.x, f.centre.y, 'centre');
      expect(Math.hypot(f.shotTo.x - lay.d.x, f.shotTo.y - lay.d.y), t).toBeLessThan(lay.r * 0.5);
      expect(shotPoint(f, 1).x, t).toBeCloseTo(f.shotTo.x, 6);
      // The riders' path stays near the sky (a hop never dives below the straight line, the top is clamped).
      for (let u = 0; u <= 1.0001; u += 0.05) { const q = shotPoint(f, Math.min(1, u)); expect(q.y, t).toBeGreaterThanOrEqual(b.y - b.h * 0.05); }
    }
  });

  it('Tiers 1 and 2 trace in five different places, and on the real layout none covers either portrait', () => {
    for (const [a, d] of [[YOU, FOE], [FOE, YOU]] as const) {
      const i = { attacker: a, defender: d, radius: R, attackerRadius: R, bounds: SCREEN };
      const cs = STARS_LAUNCHES.map((l) => launchCentre(l, i, 180, 180));
      for (let x = 0; x < cs.length; x++) for (let y = x + 1; y < cs.length; y++) expect(Math.hypot(cs[x]!.x - cs[y]!.x, cs[x]!.y - cs[y]!.y), `${STARS_LAUNCHES[x]} vs ${STARS_LAUNCHES[y]}`).toBeGreaterThan(R * 2.5);
      for (const total of [3, 8]) for (const launch of STARS_LAUNCHES as readonly StarsLaunch[]) {
        const f = starFigure(vplan(total, { launch }), { ...i, launch }, C)!;
        for (const st of f.stars) for (const h of [a, d]) expect(Math.hypot(st.x - h.x, st.y - h.y), `${total} ${launch}`).toBeGreaterThan(R * 0.9);
      }
    }
  });
});

describe('the motion', () => {
  it('the bow draws back smoothly, holds, and snaps forward on the loose', () => {
    const p = plan(8);
    expect(drawAmount(p, p.drawAt - 1)).toBe(0);
    let prev = 0;
    for (let t = p.drawAt; t <= p.holdAt; t += 10) { const w = drawAmount(p, t); expect(w).toBeGreaterThanOrEqual(prev - 1e-9); prev = w; }
    expect(drawAmount(p, p.holdAt)).toBe(1);
    expect(drawAmount(p, (p.holdAt + p.looseAt) / 2)).toBe(1);
    expect(drawAmount(p, p.looseAt + 30)).toBeLessThan(0.2); // the string is forward within a frame or two
    expect(Math.abs(drawAmount(p, p.looseAt + 400))).toBeLessThan(0.01);
  });

  it('the shot only ever moves forward, and arrives exactly on the blow; the night comes in and goes out', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      expect(shotAt(p, p.looseAt - 1).phase).toBe('nocked');
      let prev = 0;
      for (let t = p.looseAt; t < p.impactAt; t += 8) { const s = shotAt(p, t); expect(s.phase).toBe('fly'); expect(s.u).toBeGreaterThanOrEqual(prev); prev = s.u; }
      expect(shotAt(p, p.impactAt)).toEqual({ phase: 'done', u: 1 });
      expect(skyAmount(p, p.chargeAt)).toBe(0);
      expect(skyAmount(p, p.traceAt)).toBeCloseTo(1, 6);
      expect(skyAmount(p, p.impactAt)).toBeCloseTo(1, 6);
      expect(skyAmount(p, p.endAt)).toBeCloseTo(0, 6);
      expect(aliveAmount(p, p.tracedAt)).toBe(0);
      expect(aliveAmount(p, p.looseAt)).toBeCloseTo(1, 6);
    }
  });

  it('Tier 4 holds its breath: the star swells through the hold and is gone with the loose; the sky stays hushed until the blow', () => {
    const p = plan(40);
    expect(swellAmount(p, p.holdAt - 1)).toBe(0);
    let prev = 0;
    for (let t = p.holdAt; t < p.looseAt; t += 10) { const w = swellAmount(p, t); expect(w).toBeGreaterThanOrEqual(prev - 1e-9); prev = w; }
    expect(prev).toBeGreaterThan(0.9);
    expect(swellAmount(p, (p.holdAt + p.looseAt) / 2)).toBeLessThan(0.4); // slowly, then fast
    expect(swellAmount(p, p.looseAt)).toBe(0);
    expect(hushAmount(p, p.drawAt - 1)).toBe(0);
    expect(hushAmount(p, p.looseAt)).toBeCloseTo(1, 6);
    expect(hushAmount(p, p.impactAt - 1)).toBeCloseTo(1, 6);
    expect(hushAmount(p, p.impactAt)).toBe(0); // released on the blow
    for (const total of [3, 8, 14]) { const q = plan(total); for (let t = q.chargeAt; t < q.endAt; t += 20) { expect(swellAmount(q, t)).toBe(0); expect(hushAmount(q, t)).toBe(0); } }
  });

  it('after the blow the lines flare; Tier 4 then lets go of its figure (the scatter), the others keep theirs', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      expect(flareAmount(p, p.impactAt - 1)).toBe(0);
      expect(flareAmount(p, p.impactAt + 70)).toBeCloseTo(1, 6);
      expect(flareAmount(p, p.impactAt + 900)).toBeLessThan(0.1);
      expect(figureAmount(p, p.impactAt + 100)).toBe(1);
      if (p.kind === 'written') { expect(figureAmount(p, p.scatterAt + 70)).toBeCloseTo(0.5, 6); expect(figureAmount(p, p.scatterAt + 140)).toBe(0); }
      else expect(figureAmount(p, p.endAt)).toBe(1);
    }
  });

  it('the camera: a slow push in, a real hit on the blow, back to rest by the end, the shake within the tier cap', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      let peak = 1;
      for (let t = p.chargeAt; t <= p.endAt + 2000; t += 8) {
        const cm = starsCameraAt(p, C, t);
        peak = Math.max(peak, cm.zoom);
        expect(Math.hypot(cm.x, cm.y)).toBeLessThanOrEqual(p.shakePx * 1.25);
      }
      expect(peak).toBeLessThan(1.15);
      expect(starsCameraAt(p, C, p.endAt + 2000).zoom).toBeCloseTo(1, 3);
      // The hit: the view is thrown along the shot's line on the blow, and Tier 4 keeps creeping in while the star swells.
      expect(Math.hypot(starsCameraAt(p, C, p.impactAt).x, starsCameraAt(p, C, p.impactAt).y)).toBeGreaterThan(p.shakePx * 0.9);
    }
    const iv = plan(40);
    expect(starsCameraAt(iv, C, iv.looseAt - 1).zoom).toBeGreaterThan(starsCameraAt(iv, C, iv.holdAt).zoom + 0.02);
  });
});

function manualFrames(): { frames: HeroStarsOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroStarsOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  // The portraits come in with their own state: every exit must put exactly this back.
  attackerEl.style.transform = 'scale(1.05)'; attackerEl.style.opacity = '0.9'; attackerEl.className = 'herolunge raised';
  defenderEl.style.transform = 'translateY(2px)'; defenderEl.style.filter = 'brightness(1.1)'; defenderEl.className = 'combatopp-body';
  document.body.append(host, camera);
  const h = playHeroStars({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: YOU, defender: FOE, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: CW, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

function expectRestored(r: ReturnType<typeof run>): void {
  expect(r.attackerEl.style.transform).toBe('scale(1.05)');
  expect(r.attackerEl.style.opacity).toBe('0.9');
  expect(r.attackerEl.style.filter).toBe('');
  expect(r.attackerEl.className).toBe('herolunge raised');
  expect(r.defenderEl.style.transform).toBe('translateY(2px)');
  expect(r.defenderEl.style.filter).toBe('brightness(1.1)');
  expect(r.defenderEl.style.opacity).toBe('');
  expect(r.defenderEl.className).toBe('combatopp-body');
  expect(r.camera.style.transform).toBe('');
  expect(r.host.querySelector('.hblast')).toBeNull();
}

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('Tier 2: the stars light one by one, the bow draws (the string star pulls back), the arrow flies and the blow lands once; everything is put back', () => {
    const r = run({ total: 8, formation: formationOf([8], 8) });
    const { h, f, root, onImpact, onDone, host } = r;
    const p = h.plan, g = h.figure!;
    expect(host.querySelector('.hblast.hstars')).not.toBeNull();
    f.tick(p.traceAt + p.stepMs * 2.5, 4);
    const some = h.scene!.litStars;
    expect(some).toBeGreaterThan(0);
    expect(some).toBeLessThan(g.stars.length);
    expect(h.scene!.veilAlpha).toBeCloseTo(p.veil, 2);
    f.tick(p.tracedAt - h.elapsed() + 8, 4);
    expect(h.scene!.litStars).toBe(g.stars.length);
    expect(h.scene!.drawnLines).toBe(g.edges.length);
    // The nock (the string's star) at rest, then at full draw: pulled straight back from the struck hero.
    const nock = 5;
    const rest = h.scene!.starPos(nock);
    f.tick((p.holdAt + p.looseAt) / 2 - h.elapsed(), 4);
    const drawn = h.scene!.starPos(nock);
    const back = (drawn.x - rest.x) * Math.cos(g.aim) + (drawn.y - rest.y) * Math.sin(g.aim);
    expect(back).toBeLessThan(-R * 0.6);
    expect(h.scene!.shotFlying).toBe(false);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick((p.looseAt + p.impactAt) / 2 - h.elapsed(), 4);
    expect(h.scene!.shotFlying).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(p.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.shotFlying).toBe(false);
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-8');
    f.tick(p.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    f.tick(3000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier 4: the medallion is traced, the star is plucked and swells, the comet arcs over the sky, the blow lands once on it; the tail hangs, the lines scatter', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, f, onImpact, defenderEl } = r;
    const p = h.plan, g = h.figure!;
    f.tick(p.looseAt - 20, 4);
    expect(h.scene!.litStars).toBe(g.stars.length);
    expect(h.scene!.skyStars).toBe(C.t4SkyStars);
    expect(h.scene!.shotFlying).toBe(false);
    expect(onImpact).not.toHaveBeenCalled();
    // Mid flight: the comet is on its arc, above the straight line from the plucked star to the foe.
    f.tick((p.looseAt + p.impactAt) / 2 - h.elapsed(), 4);
    expect(h.scene!.shotFlying).toBe(true);
    const head = h.scene!.shotPos;
    const chordY = g.shotFrom.y + ((head.x - g.shotFrom.x) / (g.shotTo.x - g.shotFrom.x)) * (g.shotTo.y - g.shotFrom.y);
    expect(head.y).toBeLessThan(chordY - 60);
    expect(h.scene!.tailShown).toBe(true);
    f.tick(p.impactAt - 30 - h.elapsed(), 4);
    expect(h.scene!.shotFlying).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(40, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.shotFlying).toBe(false);
    expect(h.scene!.tailShown).toBe(true); // the line of light hangs along the path
    // The struck portrait is rocked: knocked, tipped and squashed.
    f.tick(24, 4);
    expect(defenderEl.style.transform).toMatch(/translate\(.+\) rotate\(.+deg\) scale\(/);
    // The lines are still there until the scatter, then they are sparks.
    f.tick(p.scatterAt - 20 - h.elapsed(), 4);
    expect(h.scene!.drawnLines).toBeGreaterThan(20);
    const before = h.scene!.liveFx;
    f.tick(40, 4);
    expect(h.scene!.liveFx).toBeGreaterThan(before + 80);
    f.tick(200, 4);
    expect(h.scene!.litStars).toBe(0);
    f.tick(p.endAt - h.elapsed() + 32, 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });

  it('both directions at every tier: one blow, within the sprite cap, everything put back', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of TOTALS) {
        const r = run({ side, attacker: side === 'player' ? YOU : FOE, defender: side === 'player' ? FOE : YOU, total, formation: formationOf([total], total) });
        const { h, f, onImpact } = r;
        let peak = 0;
        for (let t = 0; t < h.plan.endAt + 600; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_STARS_SPRITES);
        expect(h.done).toBe(true);
        expectRestored(r);
        document.body.innerHTML = '';
      }
    }
  });

  it('the camera is applied once when the canvas rides it', () => {
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const { h, f, root } = run({ camera, total: 40, formation: formationOf([40], 40) });
    f.tick(h.plan.tracedAt, 4);
    expect(h.mirrorsCamera).toBe(false);
    expect((root.children[0] as Container).scale.x).toBe(1);
    h.cancel();
  });

  it('every exit puts the portraits and the camera back: finish() lands once, cancel() never lands, at any moment', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      for (const at of [p.traceAt + 40, (p.drawAt + p.holdAt) / 2, (p.looseAt + p.impactAt) / 2, p.impactAt + 60]) {
        const a = run({ total, formation: formationOf([total], total) });
        a.f.tick(at, 8);
        a.h.finish();
        a.h.finish();
        expect(a.onImpact, `finish ${total} @${at}`).toHaveBeenCalledTimes(1);
        expect(a.onDone).toHaveBeenCalledTimes(1);
        expectRestored(a);
        expect(a.f.hooked()).toBe(0);
        expect(a.root.children).toHaveLength(0);
        document.body.innerHTML = '';
        const b = run({ total, formation: formationOf([total], total) });
        b.f.tick(at, 8);
        const landed = b.onImpact.mock.calls.length;
        b.h.cancel();
        expect(b.onImpact, `cancel ${total} @${at}`).toHaveBeenCalledTimes(landed);
        expect(landed).toBe(at >= b.h.plan.impactAt ? 1 : 0);
        expect(b.onDone).not.toHaveBeenCalled();
        expectRestored(b);
        expect(b.f.hooked()).toBe(0);
        expect(b.root.children).toHaveLength(0);
        document.body.innerHTML = '';
      }
    }
  });

  it('the safety timer lands the blow and cleans up if the frames never come (a hidden tab)', () => {
    vi.useFakeTimers();
    try {
      const r = run({ safety: true, total: 40, formation: formationOf([40], 40) });
      r.f.tick(400, 16);
      vi.advanceTimersByTime(r.h.plan.endAt + 3000);
      expect(r.onImpact).toHaveBeenCalledTimes(1);
      expect(r.h.done).toBe(true);
      expectRestored(r);
      expect(r.root.children).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it('every variation in both directions: one blow, within the sprite cap, everything put back', () => {
    const cases: [number, Partial<HeroStarsConfig>][] = [
      ...STARS_LAUNCHES.map((_, i) => [3, { launch: String(i + 1) }] as [number, Partial<HeroStarsConfig>]),
      ...STARS_LAUNCHES.map((_, i) => [8, { launch: String(i + 1) }] as [number, Partial<HeroStarsConfig>]),
      ...STARS_FIGURES3.map((_, i) => [14, { figure3: String(i + 1) }] as [number, Partial<HeroStarsConfig>]),
      ...STARS_FIGURES4.map((_, i) => [40, { figure4: String(i + 1) }] as [number, Partial<HeroStarsConfig>]),
    ];
    for (const side of ['player', 'opp'] as const) for (const [total, over] of cases) {
      const r = run({ side, attacker: side === 'player' ? YOU : FOE, defender: side === 'player' ? FOE : YOU, total, formation: formationOf([total], total), cfg: { ...CW, ...over } });
      const { h, f, onImpact } = r;
      const t = `${side} ${total} ${h.plan.kind} ${h.plan.launch}`;
      let peak = 0;
      for (let ms = 0; ms < h.plan.endAt + 600; ms += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
      expect(onImpact, t).toHaveBeenCalledTimes(1);
      expect(peak, t).toBeLessThanOrEqual(MAX_STARS_SPRITES);
      expect(h.done, t).toBe(true);
      expectRestored(r);
      f.tick(2500, 16);
      expect(f.hooked(), t).toBe(0);
      document.body.innerHTML = '';
    }
  });

  it('the riders: the wolf lands whole on the struck hero, the serpent strikes with its tail anchored, the giant brings its fist down', () => {
    const at = (figure3: string, figure4: string, total: number) => {
      const r = run({ total, formation: formationOf([total], total), cfg: { ...CW, figure3, figure4 } });
      return r;
    };
    // The wolf: before the leap every star is home; on landing its nose is on the struck hero and its whole body came with it.
    const w = at('2', '1', 14);
    const wf = w.h.figure!;
    expect(wf.kind).toBe('wolf');
    w.f.tick(w.h.plan.holdAt + 10, 4);
    const tail0 = w.h.scene!.starPos(10);
    w.f.tick(w.h.plan.impactAt - w.h.elapsed() + 2, 2);
    const nose = w.h.scene!.starPos(0);
    expect(Math.hypot(nose.x - wf.shotTo.x, nose.y - wf.shotTo.y)).toBeLessThan(R * 0.3);
    const tail1 = w.h.scene!.starPos(10);
    expect(Math.hypot(tail1.x - tail0.x, tail1.y - tail0.y)).toBeGreaterThan(400); // the tail flew too
    w.h.cancel(); document.body.innerHTML = '';
    // The serpent: the head lands, the tail tip never moves.
    const sp = at('3', '1', 14);
    const sf = sp.h.figure!;
    expect(sf.kind).toBe('serpent');
    sp.f.tick(sp.h.plan.drawAt - 20, 4);
    const tip0 = sp.h.scene!.starPos(0);
    sp.f.tick(sp.h.plan.impactAt - sp.h.elapsed() + 2, 2);
    const head = sp.h.scene!.starPos(10), tip1 = sp.h.scene!.starPos(0);
    expect(Math.hypot(head.x - sf.shotTo.x, head.y - sf.shotTo.y)).toBeLessThan(R * 0.3);
    expect(Math.hypot(tip1.x - tip0.x, tip1.y - tip0.y)).toBeLessThan(R * 0.1);
    sp.h.cancel(); document.body.innerHTML = '';
    // The giant: the fist goes up over the head in the draw, then comes down on the struck hero.
    const g = at('1', '3', 40);
    const gf = g.h.figure!;
    expect(gf.kind).toBe('giant');
    const fist = gf.charge;
    g.f.tick(g.h.plan.drawAt - 20, 4);
    const low = g.h.scene!.starPos(fist);
    g.f.tick(g.h.plan.looseAt - g.h.elapsed() - 10, 4);
    const high = g.h.scene!.starPos(fist);
    expect(high.y).toBeLessThan(low.y - 300);
    expect(high.y).toBeLessThan(g.h.scene!.starPos(gf.head).y + gf.unit * 0.05); // up by the crown
    g.f.tick(g.h.plan.impactAt - g.h.elapsed() + 2, 2);
    const down = g.h.scene!.starPos(fist);
    expect(Math.hypot(down.x - gf.shotTo.x, down.y - gf.shotTo.y)).toBeLessThan(R * 0.3);
    expect(shotArrival(gf).y).toBeGreaterThan(0); // it comes DOWN onto the foe
    g.h.cancel();
  });

  it('the wheel turns, slows and locks with its marker in the pointer\'s mouth before it fires; the nova draws the sky into one point', () => {
    const r = run({ total: 40, formation: formationOf([40], 40), cfg: { ...CW, figure4: '2' } });
    const { h, f } = r;
    const g = h.figure!, p = h.plan;
    expect(g.kind).toBe('wheel');
    expect(p.lockAt).toBeGreaterThan(p.holdAt);
    expect(p.lockAt).toBeLessThan(p.looseAt - 200);
    expect(spinAmount(p, p.drawAt)).toBe(0);
    let prev = 0, maxStep = 0;
    for (let t = p.drawAt; t <= p.lockAt; t += 8) { const a = spinAmount(p, t); expect(a).toBeGreaterThanOrEqual(prev - 1e-9); maxStep = Math.max(maxStep, a - prev); prev = a; }
    expect(prev).toBe(1);
    expect(spinAmount(p, p.lockAt - 30)).toBeGreaterThan(0.97); // it coasts into the lock
    expect(Math.abs(g.spinTurns)).toBeGreaterThan(Math.PI * 2); // more than a full turn
    f.tick(p.drawAt + (p.lockAt - p.drawAt) / 2, 4);
    const mid = h.scene!.starPos(g.pluck);
    expect(Math.hypot(mid.x - g.shotFrom.x, mid.y - g.shotFrom.y)).toBeGreaterThan(g.unit * 0.3); // still turning
    f.tick(p.lockAt - h.elapsed() + 20, 4);
    const locked = h.scene!.starPos(g.pluck);
    expect(Math.hypot(locked.x - g.shotFrom.x, locked.y - g.shotFrom.y)).toBeLessThan(2);
    h.cancel(); document.body.innerHTML = '';
    // The nova: the sky comes in over the draw and the hold, all of it by the loose; the sigil closes on its heart.
    const n = starsPlan({ total: 40, distance: 1600, leadIn: leadInOf([40]), variant: { launch: 'striker', fig3: 'hunter', fig4: 'nova' } }, C);
    expect(gatherAmount(n, n.drawAt)).toBe(0);
    expect(gatherAmount(n, (n.drawAt + n.looseAt) / 2)).toBeGreaterThan(0.3);
    expect(gatherAmount(n, n.looseAt)).toBe(1);
    const nf = starFigure(n, { attacker: YOU, defender: FOE, radius: R, attackerRadius: R, bounds: SCREEN }, C)!;
    for (const st of nf.stars) if (!st.pluck) expect(Math.hypot(st.x + st.px - nf.shotFrom.x, st.y + st.py - nf.shotFrom.y)).toBeLessThan(1e-6);
    for (const q of [n, plan(40)]) expect(gatherAmount(q === n ? plan(14) : q, q.looseAt)).toBe(0);
  });

  it('a replay plays the same; reduced motion lands once with no scene', () => {
    const x = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5 });
    const y = run({ total: 40, formation: formationOf([40], 40), rollSeed: 5 });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.figure).toEqual(y.h.figure);
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    expect(r.h.figure).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
  });
});

describe('the scene (headless Pixi)', () => {
  const colors = { star: 0xfff8e6, gold: 0xffe2a0, line: 0xb9cdfa, sky: 0x0a1440, side: 0xffe9b0 };
  const look: StarsLook = { starPx: 46, lineWidth: 9, twinkle: 0.45, ghostAlpha: 0.3, portraitAlpha: 0.34, impactSize: 1, tier: 4, swell: 1.6, hush: 0.7 };
  const frame = (p: StarsPlan, t: number): SkyFrame => ({
    t, sky: skyAmount(p, t), veil: p.veil, draw: drawAmount(p, t), alive: aliveAmount(p, t), ghost: 1, arrow: t < p.looseAt ? 1 : 0, pluck: 1,
    swell: swellAmount(p, t), hush: hushAmount(p, t), flare: flareAmount(p, t), fig: figureAmount(p, t),
    spin: 0, ride: shotAt(p, t).u, loosed: t >= p.looseAt, gather: gatherAmount(p, t),
    shimmerAt: t >= p.impactAt ? p.impactAt : Infinity, shimmerX: FOE.x, shimmerY: FOE.y,
  });

  it('the same seed scatters the same sky; pools, stays under the cap through Tier 4, its nova and its falling sparks, drains, and destroy leaves nothing', () => {
    const p = plan(40, { knockout: true, knockoutVariant: true });
    const f = fig(40);
    const make = (seed: number): HeroStarsScene => {
      const s = new HeroStarsScene(TEX, colors, look, 1, seed);
      s.setSky(SCREEN, p.skyStars);
      s.setFigure(f, f.stars.map((st) => slotAt(p, st.slot)), f.edges.map((e) => slotAt(p, e.slot)), p.stepMs);
      s.setPath(f.shotFrom, f.shotCtrl, f.shotTo, 'comet', 280, 44);
      s.setPortrait(W);
      return s;
    };
    const scene = make(3), twin = make(3);
    expect(scene.skyStars).toBe(p.skyStars);
    const layout = (s: HeroStarsScene): number[] => s.root.children.flatMap((layer) => (layer as Container).children.map((ch) => Math.round(ch.x * 10 + ch.y)));
    expect(layout(scene)).toEqual(layout(twin));
    twin.destroy();
    let peak = 0, swellFx = 0, scattered = 0;
    const rest = f.stars.map((st) => ({ x: st.x, y: st.y }));
    let jolted = 0;
    for (let t = p.chargeAt; t < p.endAt; t += 16) {
      scene.frame(frame(p, t));
      if (Math.abs(t - p.tracedAt) < 8) { scene.comeAlive(); f.stars.forEach((_, i) => scene.starPop(i)); }
      const st = shotAt(p, t);
      if (st.phase === 'fly') {
        scene.shotFrame(st.u, 0, true, 1);
        const at = shotPoint(f, st.u);
        expect(scene.shotPos.x).toBeCloseTo(at.x, 3); expect(scene.shotPos.y).toBeCloseTo(at.y, 3);
        expect(scene.shotFlying).toBe(true);
      }
      if (t >= p.impactAt && t < p.impactAt + 16) { scene.shotFrame(1, 0, false, 1); scene.impact(f.shotTo, { x: 0, y: 1 }, R, 4, 0.36); scene.koFlourish(f.shotTo, R); expect(scene.tailShown).toBe(true); expect(scene.shotFlying).toBe(false); }
      if (t >= p.scatterAt && t < p.scatterAt + 16) { const n = scene.liveFx; scene.scatter(1200); scattered = scene.liveFx - n; }
      if (t > p.tracedAt && t < p.looseAt) expect(scene.portraitShown).toBe(true);
      // The swelling star draws motes of light into itself.
      if (t > p.holdAt + 300 && t < p.looseAt) swellFx = Math.max(swellFx, scene.liveFx);
      // The jolt: after the blow the constellation's stars are shoved off their places, then spring back.
      if (t > p.impactAt + 100 && t < p.impactAt + 300) jolted = Math.max(jolted, ...rest.slice(0, 12).map((q, i) => Math.hypot(scene.starPos(i).x - q.x, scene.starPos(i).y - q.y)));
      scene.update(16);
      peak = Math.max(peak, scene.liveSprites);
    }
    expect(swellFx).toBeGreaterThan(4);
    expect(jolted).toBeGreaterThan(3);
    expect(scattered).toBeGreaterThan(80); // every line and star sheds sparks
    expect(peak).toBeLessThanOrEqual(MAX_STARS_SPRITES);
    expect(peak).toBeGreaterThan(p.skyStars + f.stars.length * 2);
    scene.shotFrame(1, 1, false, 0);
    expect(scene.tailShown).toBe(false);
    scene.endSky();
    expect(scene.veilAlpha).toBe(0);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });

  it('the nova grows with the tier', () => {
    const count = (tier: number): number => {
      const scene = new HeroStarsScene(TEX, colors, { ...look, tier }, 1, 5);
      scene.setSky(SCREEN, 10);
      const n = scene.liveFx;
      scene.impact(FOE, { x: 1, y: 0 }, R, tier, 0.2);
      const out = scene.liveFx - n;
      scene.destroy();
      return out;
    };
    const n = [1, 2, 3, 4].map(count);
    for (let i = 1; i < 4; i++) expect(n[i]!).toBeGreaterThan(n[i - 1]! + 15);
    expect(n[0]!).toBeGreaterThan(40); // even the arrow lands in a proper burst
  });

  it('a full pool skips effects instead of throwing (the cap is hard)', () => {
    const scene = new HeroStarsScene(TEX, colors, look, 1, 9);
    scene.setSky(SCREEN, 160);
    for (let i = 0; i < 60; i++) scene.impact(FOE, { x: 1, y: 0 }, R, 4);
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_STARS_SPRITES);
    scene.destroy();
  });
});
