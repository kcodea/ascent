// @vitest-environment jsdom
/**
 * THE WRITTEN IN THE STARS HERO ATTACK (ANCIENT; dev-only, no cosmetic yet): the shared four tiers; the tuner values;
 * the pure plan (I the arrow, II the bow, III the hunter, IV the medallion and the falling star) and its cue timing;
 * the constellations (every line starts from a star that is already lit; the figures stay on screen in both
 * directions and on any layout; the star always falls DOWN); the draw of the bow; the runner on the shared clock (the
 * blow lands exactly ONCE; both directions; replay; finish / cancel; every exit puts the portraits and the camera
 * back); the headless scene.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import {
  HERO_STARS_CLIP_KEYS, HERO_STARS_DEFAULTS, HERO_STARS_RANGES, STARS_SLOTS, aliveAmount, clampHeroStarsValue, drawAmount, heroStarsConfigJson,
  placeFigure, pluckPoint, shotAt, skyAmount, slotAt, starFigure, starLitAt, starsCameraAt, starsCues, starsPlan,
  type Box, type HeroStarsNumKey, type StarFigure, type StarsPlan,
} from './heroStarsConfig';
import { HeroStarsScene, MAX_STARS_SPRITES, type HeroStarsTextures, type SkyFrame } from './heroStarsScene';
import { playHeroStars, starsSeed, type HeroStarsOptions } from './heroStars';
import { SPEC } from '../HeroStarsTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroStarsTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  glint: W, dot: W, line: W, trail: W, arrow: W, limb: W, veil: W, halo: W,
};
const C = HERO_STARS_DEFAULTS;
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
  it('uses the shared thresholds; a knockout plays IV (written in the stars)', () => {
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
    const labels = SPEC.actions!.map((a) => a.label);
    for (const l of ['▶ Small (3)', '▶ Tier II (8)', '▶ Medium (12)', '▶ Huge (40)', '▶ Foe huge (40)']) expect(labels).toContain(l);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('stars');
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
      expect(slotAt(p, p.slots), t).toBe(p.tracedAt);
    }
    // IV's fall is its own length; an arrow's flight follows the board.
    expect(plan(40).impactAt - plan(40).looseAt).toBe(C.t4FlyMs);
    const near = starsPlan({ total: 3, distance: 600 }, C), far = starsPlan({ total: 3, distance: 1600 }, C);
    expect(near.impactAt - near.looseAt).toBeLessThan(far.impactAt - far.looseAt);
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
    }
  });

  it('pace: in the range of the other Ancients (I under 1.5 s, II under 1.8 s, III under 2.3 s, IV about 3 s after the formation)', () => {
    const len = (d: number): number => { const p = plan(d); return p.endAt - p.chargeAt; };
    expect(len(3)).toBeLessThan(1500);
    expect(len(8)).toBeLessThan(1800);
    expect(len(14)).toBeLessThan(2300);
    expect(len(40)).toBeLessThanOrEqual(3100);
    expect(len(3)).toBeLessThan(len(8));
    expect(len(8)).toBeLessThan(len(14));
    expect(len(14)).toBeLessThan(len(40));
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
  it('I: three stars in a row aimed at the struck hero, and two barbs; II: eight stars; III: sixteen; IV: a ring of twelve, a crown, a bust, an arm and the star', () => {
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

  it('III: the hunter stands upright in a braced stance and faces the struck hero', () => {
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

  it('IV: the star falls DOWN onto the struck hero: straight down when there is sky above, else on the steepest line the screen allows', () => {
    // The foe strikes you (you are low on the screen): straight down, the full length.
    const down = fig(40, FOE, YOU);
    expect(down.shotFrom.x).toBeCloseTo(YOU.x, 6);
    expect(YOU.y - down.shotFrom.y).toBeCloseTo(C.fallLen * R, 6);
    // You strike the foe (it is in the top corner): there is no sky above it, so the star comes in along the sky.
    const along = fig(40, YOU, FOE);
    expect(along.shotFrom.y).toBeLessThan(FOE.y);
    expect(along.shotFrom.y).toBeGreaterThanOrEqual(SCREEN.h * 0.05 - 1e-6);
    expect(Math.hypot(along.shotFrom.x - FOE.x, along.shotFrom.y - FOE.y)).toBeCloseTo(C.fallLen * R, 4);
    for (const lay of LAYOUTS) {
      const f = fig(40, lay.a, lay.d, lay.bounds, lay.r);
      expect(f.shotTo.y, lay.name).toBeGreaterThanOrEqual(f.shotFrom.y - 1e-6); // never upward
      expect(f.stars[f.pluck]!).toMatchObject({ x: f.shotFrom.x, y: f.shotFrom.y, pluck: true });
      // The arm's hand stops short of the star and reaches toward it.
      const hand = f.stars[f.pluck - 1]!;
      const before = Math.hypot(hand.x - f.shotFrom.x, hand.y - f.shotFrom.y);
      const after = Math.hypot(hand.x + hand.px - f.shotFrom.x, hand.y + hand.py - f.shotFrom.y);
      expect(after, lay.name).toBeLessThan(before);
    }
    expect(pluckPoint({ x: 500, y: 0 }, 100, 3, { x: 900, y: 300 }, SCREEN).y).toBeLessThanOrEqual(0); // a hero on the top edge: level, never below it
  });

  it('the same blow draws the same sky (a replay matches); a different roll seeds a different scatter', () => {
    expect(fig(40)).toEqual(fig(40));
    expect(starsSeed(12, 1600, 'player')).toBe(starsSeed(12, 1600, 'player'));
    expect(starsSeed(12, 1600, 'player', 7)).toBe(starsSeed(12, 1600, 'player', 7));
    expect(starsSeed(12, 1600, 'player', 7)).not.toBe(starsSeed(12, 1600, 'player', 8));
    expect(starsSeed(12, 1600, 'player')).not.toBe(starsSeed(12, 1600, 'opp'));
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

  it('the camera is gentle: a slow push in, back to rest by the end, the shake within the tier cap', () => {
    for (const total of TOTALS) {
      const p = plan(total);
      let peak = 1;
      for (let t = p.chargeAt; t <= p.endAt + 2000; t += 8) {
        const cm = starsCameraAt(p, C, t);
        peak = Math.max(peak, cm.zoom);
        expect(Math.hypot(cm.x, cm.y)).toBeLessThanOrEqual(p.shakePx * 1.25);
      }
      expect(peak).toBeLessThan(1.12);
      expect(starsCameraAt(p, C, p.endAt + 2000).zoom).toBeCloseTo(1, 3);
    }
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
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
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

  it('II: the stars light one by one, the bow draws (the string star pulls back), the arrow flies and the blow lands once; everything is put back', () => {
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

  it('IV: the medallion is traced, the star is plucked and falls, and the blow lands on the falling star, once', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    const { h, f, onImpact } = r;
    const p = h.plan;
    f.tick(p.looseAt - 20, 4);
    expect(h.scene!.litStars).toBe(h.figure!.stars.length);
    expect(h.scene!.skyStars).toBe(C.t4SkyStars);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(p.impactAt - 30 - h.elapsed(), 4);
    expect(h.scene!.shotFlying).toBe(true);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(40, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    f.tick(p.endAt - h.elapsed() + 32, 8);
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
  const look = { starPx: 46, lineWidth: 7, twinkle: 0.45, ghostAlpha: 0.3, portraitAlpha: 0.34, arrowPx: 230, trailWidth: 7, impactSize: 1 };
  const frame = (p: StarsPlan, t: number): SkyFrame => ({
    t, sky: skyAmount(p, t), veil: p.veil, draw: drawAmount(p, t), alive: aliveAmount(p, t), ghost: 1, arrow: t < p.looseAt ? 1 : 0, pluck: 1,
    shimmerAt: t >= p.impactAt ? p.impactAt : Infinity, shimmerX: FOE.x, shimmerY: FOE.y,
  });

  it('the same seed scatters the same sky; pools, stays under the cap through IV and its stardust, drains, and destroy leaves nothing', () => {
    const p = plan(40, { knockout: true, knockoutVariant: true });
    const f = fig(40);
    const make = (seed: number): HeroStarsScene => {
      const s = new HeroStarsScene(TEX, colors, look, 1, seed);
      s.setSky(SCREEN, p.skyStars);
      s.setFigure(f, f.stars.map((st) => slotAt(p, st.slot)), f.edges.map((e) => slotAt(p, e.slot)), p.stepMs);
      s.setPortrait(W);
      return s;
    };
    const scene = make(3), twin = make(3);
    expect(scene.skyStars).toBe(p.skyStars);
    const layout = (s: HeroStarsScene): number[] => s.root.children.flatMap((layer) => (layer as Container).children.map((ch) => Math.round(ch.x * 10 + ch.y)));
    expect(layout(scene)).toEqual(layout(twin));
    twin.destroy();
    let peak = 0;
    for (let t = p.chargeAt; t < p.endAt; t += 16) {
      scene.frame(frame(p, t));
      if (Math.abs(t - p.tracedAt) < 8) { scene.comeAlive(); f.stars.forEach((_, i) => scene.starPop(i)); }
      const st = shotAt(p, t);
      if (st.phase === 'fly') scene.setShot(true, f.shotFrom.x + (f.shotTo.x - f.shotFrom.x) * st.u, f.shotFrom.y + (f.shotTo.y - f.shotFrom.y) * st.u, f.aim, f.shotFrom.x, f.shotFrom.y, 1, true);
      if (t >= p.impactAt && t < p.impactAt + 16) { scene.setShot(false); scene.impact(f.shotTo, { x: 0, y: 1 }, R, 4); scene.koFlourish(f.shotTo, R); scene.linger(f.shotFrom, f.shotTo, 500); }
      if (t > p.tracedAt && t < p.looseAt) expect(scene.portraitShown).toBe(true);
      scene.update(16);
      peak = Math.max(peak, scene.liveSprites);
    }
    expect(peak).toBeLessThanOrEqual(MAX_STARS_SPRITES);
    expect(peak).toBeGreaterThan(p.skyStars + f.stars.length * 2);
    scene.endSky();
    expect(scene.veilAlpha).toBe(0);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });

  it('a full pool skips effects instead of throwing (the cap is hard)', () => {
    const scene = new HeroStarsScene(TEX, colors, look, 1, 9);
    scene.setSky(SCREEN, 160);
    for (let i = 0; i < 60; i++) scene.impact(FOE, { x: 1, y: 0 }, R, 4);
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_STARS_SPRITES);
    scene.destroy();
  });
});
