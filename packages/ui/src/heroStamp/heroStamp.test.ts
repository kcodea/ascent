// @vitest-environment jsdom
/**
 * PAID IN FULL, THE RUBBER STAMP HERO ATTACK (a Rare): the shared tiers mapped onto TWO visual tiers (I-II small,
 * III-IV big, a knockout big); the tuner values; the pure plan (one stamp small; the ink pad, then three stamps big,
 * the ticks before THE impact); the pure track and pose (sized off the struck portrait, every mark on the face, crooked
 * at different angles, the whole stamp on screen in both directions); the runner on the shared clock (the blow lands
 * exactly ONCE, on the last thunk; both directions; replay; finish / cancel; cleanup; the camera applied once); the
 * headless scene (pooled, bounded, drains, destroy leaves nothing).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES } from '../heroBlast/heroAttackStyle';
import {
  HERO_STAMP_DEFAULTS, HERO_STAMP_RANGES, STAMP_MAX_LEAN, clampHeroStampValue, fitAxis, stampCameraAt, stampCues, stampLevel, stampPlan,
  stampPose, stampPress, stampTop, stampTrack, heroStampConfigJson, sanitizeHeroStampConfig,
  type HeroStampConfig, type HeroStampNumKey, type StampGeo,
} from './heroStampConfig';
import { HeroStampScene, MAX_STAMP_SPRITES, type HeroStampTextures } from './heroStampScene';
import { playHeroStamp, stampSeed, thunkVoice, type HeroStampOptions } from './heroStamp';
import { SPEC } from '../HeroStampTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroStampTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  stampBody: W, stampMark: W, stampSkull: W, stampGloss: W, stampSkullGloss: W, stampPad: W, stampDrop: W, stampSplat: W,
};
const C = HERO_STAMP_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => stampPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
/** The real 1080p layout: you bottom left, the foe hard against the top right corner. */
const YOU = { x: 150, y: 870 }, FOE = { x: 1790, y: 140 };
const R = 130;
const CEIL = 28;
const geo = (a = YOU, d = FOE, seed = 7): StampGeo => ({ a, d, radius: R, aRadius: R, ceilY: CEIL, seed });

describe('the tiers: the shared four onto a Rare\'s two', () => {
  it('uses the shared thresholds, and maps I-II to small, III-IV to big', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) {
      const p = plan(d);
      expect(p.tier, `dmg ${d}`).toBe(tierOf(d));
      expect(p.level, `dmg ${d}`).toBe(tierOf(d) >= 3 ? 'big' : 'small');
    }
    expect([1, 2, 3, 4].map((t) => stampLevel(t as 1 | 2 | 3 | 4))).toEqual(['small', 'small', 'big', 'big']);
  });

  it('a knockout plays big whatever the number, and its seal carries the skull', () => {
    const p = plan(3, { knockout: true });
    expect(p.tier).toBe(4);
    expect(p.level).toBe('big');
    expect(p.knockout).toBe(true);
    expect(plan(40).knockout).toBe(false);
  });
});

describe('the tuner values', () => {
  it('every shipped default sits inside its slider range, and colours are #rrggbb', () => {
    for (const [k, [min, max, step]] of Object.entries(HERO_STAMP_RANGES)) {
      const v = C[k as HeroStampNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
      expect(step, k).toBeGreaterThan(0);
    }
    for (const k of ['colorInk', 'colorInkDeep', 'colorShine', 'colorDust', 'colorPlayer', 'colorFoe'] as const) expect(C[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps numbers into range; junk falls back; colours must be #rrggbb; unknown keys drop', () => {
    expect(clampHeroStampValue('bigStamps', 99)).toBe(5);
    expect(clampHeroStampValue('stampSize', -3)).toBe(0.4);
    expect(clampHeroStampValue('stampSize', 'abc')).toBe(C.stampSize);
    expect(clampHeroStampValue('colorInk', '#ABCDEF')).toBe('#abcdef');
    expect(clampHeroStampValue('colorInk', 'red')).toBe(C.colorInk);
    expect(clampHeroStampValue('nope' as keyof HeroStampConfig, 1)).toBeUndefined();
    const s = sanitizeHeroStampConfig({ bigDroplets: 400, bogus: 1 });
    expect(s.bigDroplets).toBe(24);
    expect('bogus' in s).toBe(false);
  });

  it('every config key has a control; Copy JSON drops the preview keys; the buttons sit on top; the style row offers stamp', () => {
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    const json = JSON.parse(heroStampConfigJson(C)) as Record<string, unknown>;
    expect(json.previewDamage).toBeUndefined();
    expect(json.bigStamps).toBe(3);
    expect(SPEC.buttonsOnTop).toBe(true);
    expect(SPEC.controls.find((c) => c.key === 'attackStyle')?.options).toContain('stamp');
    expect(DEV_HERO_ATTACK_CHOICES).toContain('stamp');
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced/i.test(l))).toEqual([]);
  });

  it('the sounds: its own thunk and ink pad clips, and a shared whoosh', () => {
    expect(C.sfxThunkClip).toBe('fx/stamp-thunk');
    expect(C.sfxPadClip).toBe('fx/stamp-pad');
    expect(C.sfxBodyClip).toBe('fx/stamp-body');
    expect(C.sfxWhooshClip.startsWith('fx/')).toBe(true);
  });

  it('the three thunks climb: each thock harder and higher than the last, the thump under it deeper and fuller, the third clearly the heaviest', () => {
    const v = [0, 1, 2].map((i) => thunkVoice(i, 3));
    expect(v[1]!.gain).toBeGreaterThan(v[0]!.gain);
    expect(v[2]!.gain).toBeGreaterThanOrEqual(v[1]!.gain * 1.4);
    expect(v[1]!.rate).toBeGreaterThan(v[0]!.rate);
    expect(v[2]!.rate).toBeGreaterThan(v[1]!.rate);
    expect(v[2]!.body).toBeGreaterThanOrEqual(v[1]!.body * 2);
    expect(v[2]!.bodyRate).toBeLessThan(v[1]!.bodyRate);
    for (const q of v) { expect(q.gain).toBeGreaterThan(0); expect(q.body).toBeGreaterThan(0); }
    // A single stamp is a last one: it carries the low thump too.
    expect(thunkVoice(0, 1).body).toBeGreaterThan(v[1]!.body);
    // The third stamp presses the portrait far harder than a tick, and harder than a single stamp.
    const big = plan(40), small = plan(3);
    const peak = (p: ReturnType<typeof plan>, at: number): number => stampPress(p, at + 4);
    expect(peak(big, big.thunks[2]!)).toBeGreaterThan(peak(big, big.thunks[0]!) * 2.5);
    expect(peak(big, big.thunks[2]!)).toBeGreaterThan(peak(small, small.thunks[0]!) * 1.5);
    expect(big.shakePx).toBeGreaterThan(small.shakePx * 2);
  });
});

describe('the plan', () => {
  it('SMALL: one stamp, and it IS the impact (no ticks, no ink pad); short (a Rare)', () => {
    const p = plan(3);
    expect(p.thunks).toHaveLength(1);
    expect(p.hits).toEqual([]);
    expect(p.padAt).toBeNull();
    expect(p.impactAt).toBe(p.thunks[0]);
    expect(p.impactAt).toBe(p.launchAt + p.flightMs + p.slamMs);
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(1600);
    const kinds = stampCues(p).map((q) => q.kind);
    expect(kinds).toEqual(['charge', 'launch', 'impact', 'end']);
  });

  it('BIG: the ink pad first, then three stamps; the two before the last are ticks, the last is THE impact, wound up longer', () => {
    const p = plan(14);
    expect(p.thunks).toHaveLength(3);
    expect(p.hits).toEqual(p.thunks.slice(0, 2));
    expect(p.impactAt).toBe(p.thunks[2]);
    expect(p.padAt).not.toBeNull();
    expect(p.padAt!).toBeGreaterThan(p.riseEnd);
    expect(p.padAt! + p.pressMs).toBeLessThan(p.launchAt);
    const gap1 = p.thunks[1]! - p.thunks[0]!, gap2 = p.thunks[2]! - p.thunks[1]!;
    expect(gap1).toBeLessThanOrEqual(260); // fast: thunk thunk
    expect(gap2).toBeGreaterThan(gap1); // THUNK
    expect(gap1).toBeGreaterThan(p.slamMs + p.pressMs); // room for a lift between them
    expect(gap2 - gap1).toBeGreaterThanOrEqual(120); // a real wind-up before the hard one
    expect(p.endAt - p.chargeAt).toBeLessThanOrEqual(2400); // still a Rare: short
    const kinds = stampCues(p).map((q) => q.kind);
    expect(kinds).toEqual(['charge', 'pad', 'launch', 'hit', 'hit', 'impact', 'end']);
  });

  it('the marks outlast the impact and are gone just after the end', () => {
    for (const total of [3, 14]) {
      const p = plan(total);
      expect(p.markFadeAt).toBeGreaterThan(p.impactAt + p.pressMs + 200);
      expect(p.endAt).toBeGreaterThan(p.markFadeAt);
      expect(p.markFadeAt + p.markFadeMs - p.endAt).toBeLessThanOrEqual(300);
    }
  });

  it('reduced motion: no stamp; the blow lands at the end of the formation', () => {
    const p = plan(14, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(p.impactAt).toBe(leadInOf([14], true));
    expect(stampTrack(p, geo(), C).contacts).toEqual([]);
    expect(stampPose(p, stampTrack(p, geo(), C), p.impactAt).alpha).toBe(0);
    expect(stampCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
  });

  it('is deterministic', () => {
    expect(plan(14)).toEqual(plan(14));
    expect(stampTrack(plan(14), geo(), C)).toEqual(stampTrack(plan(14), geo(), C));
  });
});

describe('the track and the pose', () => {
  it('fitAxis: upright with headroom; with none it leans (toward the given side) just enough, never past the cap', () => {
    expect(fitAxis({ x: 500, y: 800 }, 300, 28, 1)).toEqual({ x: 0, y: -1 });
    const lean = fitAxis({ x: 500, y: 140 }, 300, 28, -1);
    expect(lean.x).toBeLessThan(0);
    expect(140 + lean.y * 300).toBeCloseTo(28, 3); // its top sits exactly at the ceiling
    const flat = fitAxis({ x: 500, y: 30 }, 300, 28, 1);
    expect(Math.atan2(flat.x, -flat.y)).toBeCloseTo(STAMP_MAX_LEAN, 5);
  });

  it('every mark lands on the struck face; three marks sit crooked at three different angles, alternating sides', () => {
    for (const [a, d] of [[YOU, FOE], [FOE, YOU]] as const) {
      for (const total of [3, 40]) {
        const p = plan(total);
        const tr = stampTrack(p, geo(a, d), C);
        expect(tr.contacts).toHaveLength(p.thunks.length);
        const markR = (tr.w * C.markSize * Math.max(...tr.sizes)) / 2;
        for (const c of tr.contacts) expect(Math.hypot(c.x - d.x, c.y - d.y) + markR).toBeLessThanOrEqual(R * 1.02);
        for (const t of tr.tilts) expect(Math.abs(t)).toBeLessThanOrEqual(C.markTilt);
        if (total === 40) {
          const [t0, t1, t2] = tr.tilts as [number, number, number];
          expect(Math.sign(t0)).toBe(-Math.sign(t1));
          expect(Math.sign(t2)).toBe(Math.sign(t0));
          expect(Math.abs(t0 - t2)).toBeGreaterThan(0.05);
          expect(Math.abs(t2)).toBeLessThan(Math.abs(t0)); // the seal sits nearest straight
          expect(tr.sizes[2]).toBeGreaterThan(tr.sizes[0]!); // and is the biggest
        } else expect(Math.abs(tr.tilts[0]!)).toBeGreaterThan(0.1); // slightly crooked, never square
      }
    }
  });

  it('the seed rolls the crookedness: the same seed stamps the same, another seed differs', () => {
    const p = plan(40);
    expect(stampTrack(p, geo(YOU, FOE, 5), C).tilts).toEqual(stampTrack(p, geo(YOU, FOE, 5), C).tilts);
    expect(stampTrack(p, geo(YOU, FOE, 5), C).tilts).not.toEqual(stampTrack(p, geo(YOU, FOE, 6), C).tilts);
    expect(stampSeed(9, 1500, 'player')).toBe(stampSeed(9, 1500, 'player'));
    expect(stampSeed(9, 1500, 'player')).not.toBe(stampSeed(9, 1500, 'opp'));
  });

  it('the last mark is nudged away from where the big -N pops', () => {
    const p = plan(3);
    const avoid = { x: FOE.x - 150, y: FOE.y + 20 };
    const tr = stampTrack(p, { ...geo(), avoid }, C);
    const plain = stampTrack(p, geo(), C);
    expect(Math.hypot(tr.contacts[0]!.x - avoid.x, tr.contacts[0]!.y - avoid.y)).toBeGreaterThan(Math.hypot(plain.contacts[0]!.x - avoid.x, plain.contacts[0]!.y - avoid.y));
  });

  it('a struck hero with headroom is stamped straight down; one against the top edge is stamped on a lean, from the striker\'s side', () => {
    const down = stampTrack(plan(40), geo(FOE, YOU), C);
    expect(down.rotD).toBe(0);
    expect(down.rotA).toBe(0);
    const lean = stampTrack(plan(40), geo(YOU, FOE), C);
    expect(lean.rotD).toBeLessThan(-0.3); // the handle leans left, back toward the striker at the bottom left
    expect(lean.rotA).toBe(0); // at the striker it always stands upright
  });

  it('the WHOLE stamp stays on screen from the rise to the lift away, in both directions, at both sizes', () => {
    for (const [a, d] of [[YOU, FOE], [FOE, YOU], [{ x: 960, y: 900 }, { x: 960, y: 150 }]] as const) {
      for (const total of [3, 40]) {
        const p = plan(total);
        const tr = stampTrack(p, geo(a, d), C);
        for (let t = p.chargeAt; t <= p.impactAt + p.pressMs + p.awayMs; t += 4) {
          const q = stampPose(p, tr, t);
          if (q.alpha <= 0.05) continue;
          const top = stampTop(tr, q);
          for (const pt of [q, top]) {
            expect(pt.y, `y at ${t - p.chargeAt} ms (${total}, from ${a.x})`).toBeGreaterThanOrEqual(CEIL - 26);
            expect(pt.y).toBeLessThanOrEqual(1080);
            expect(pt.x).toBeGreaterThanOrEqual(0);
            expect(pt.x).toBeLessThanOrEqual(1920);
          }
        }
      }
    }
  });

  it('the pose: rises at the striker, taps the pad (big), is ON each contact at its thunk, hovers before it, and is gone after', () => {
    const p = plan(40);
    const tr = stampTrack(p, geo(FOE, YOU), C);
    expect(stampPose(p, tr, p.chargeAt - 1).alpha).toBe(0);
    const risen = stampPose(p, tr, p.riseEnd);
    expect(Math.hypot(risen.x - tr.hold.x, risen.y - tr.hold.y)).toBeLessThan(1);
    const tap = stampPose(p, tr, p.padAt!);
    expect(Math.hypot(tap.x - tr.pad!.x, tap.y - tr.pad!.y)).toBeLessThan(1);
    expect(tap.sy).toBeLessThan(1); // squashed on the pad
    for (let i = 0; i < p.thunks.length; i++) {
      const before = stampPose(p, tr, p.thunks[i]! - p.slamMs);
      expect(Math.hypot(before.x - tr.hovers[i]!.x, before.y - tr.hovers[i]!.y), `hover ${i}`).toBeLessThan(2);
      const on = stampPose(p, tr, p.thunks[i]!);
      expect(Math.hypot(on.x - tr.contacts[i]!.x, on.y - tr.contacts[i]!.y), `thunk ${i}`).toBeLessThan(1);
      expect(on.sy).toBeLessThan(1);
      expect(on.target).toBe(i);
    }
    // the last stamp is wound up higher than the ticks
    expect(tr.hovers[2]!.y).toBeLessThan(tr.hovers[0]!.y - 20);
    expect(stampPose(p, tr, p.impactAt + p.pressMs + p.awayMs + 1).alpha).toBe(0);
    // no jump anywhere: the die never moves more than a slam's worth between two frames
    let prev = stampPose(p, tr, p.riseEnd);
    for (let t = p.riseEnd + 4; t <= p.impactAt + p.pressMs + p.awayMs; t += 4) {
      const q = stampPose(p, tr, t);
      expect(Math.hypot(q.x - prev.x, q.y - prev.y), `step at ${t - p.chargeAt}`).toBeLessThan(60);
      prev = { ...q };
    }
  });

  it('the struck portrait is pressed on every thunk, hardest on the last, and comes to rest', () => {
    const p = plan(40);
    expect(stampPress(p, p.thunks[0]! - 1)).toBe(0);
    expect(stampPress(p, p.thunks[0]!)).toBeGreaterThan(0.3);
    expect(stampPress(p, p.impactAt)).toBeGreaterThan(stampPress(p, p.thunks[0]!) * 1.5);
    expect(Math.abs(stampPress(p, p.impactAt + 900))).toBeLessThan(0.004);
  });

  it('the camera pushes in through the ready and settles after the impact', () => {
    const p = plan(14);
    expect(stampCameraAt(p, C, p.chargeAt - 10).zoom).toBe(1);
    expect(stampCameraAt(p, C, p.launchAt).zoom).toBeGreaterThan(1);
    expect(stampCameraAt(p, C, p.impactAt + 3000).zoom).toBeCloseTo(1, 3);
    expect(stampCameraAt(p, C, p.impactAt + 10, { x: 0, y: 1 }).y).toBeGreaterThan(0); // shaken the way the stamp presses
  });
});

function manualFrames(): { frames: HeroStampOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroStampOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  attackerEl.style.transform = 'translateX(3px)'; // a resting transform of its own: it must come back exactly
  attackerEl.style.opacity = '0.9';
  defenderEl.className = 'combatopp-body';
  document.body.append(host, camera);
  const h = playHeroStamp({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: YOU, defender: FOE, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false, pixiScale: 1,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

const rested = (r: ReturnType<typeof run>): void => {
  expect(r.host.querySelector('.hblast')).toBeNull();
  expect(r.camera.style.transform).toBe('');
  expect(r.attackerEl.style.transform).toBe('translateX(3px)');
  expect(r.attackerEl.style.opacity).toBe('0.9');
  expect(r.defenderEl.style.transform).toBe('');
  expect(r.defenderEl.style.opacity).toBe('');
  expect(r.defenderEl.style.filter).toBe('');
  expect(r.defenderEl.style.willChange).toBe(''); // the layer hint held for the squash is gone
  expect(r.defenderEl.className).toBe('combatopp-body');
  expect(r.f.hooked()).toBe(0);
  expect(r.root.children).toHaveLength(0);
};

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('BIG: the pad is tapped, the blow lands EXACTLY ONCE, on the third thunk, never on a tick; everything is put back', () => {
    const r = run({ total: 14, formation: formationOf([14], 14) });
    const { h, f, onImpact, onDone, host, camera, defenderEl } = r;
    expect(h.plan.level).toBe('big');
    expect(host.querySelector('.hblast.hstamp')).not.toBeNull();
    f.tick(h.plan.padAt! + 8, 4);
    expect(h.scene!.hasStamp).toBe(true);
    expect(h.scene!.hasPad).toBe(true);
    expect(h.scene!.liveMarks).toBe(0);
    f.tick(h.plan.hits[0]! + 8 - h.elapsed(), 4);
    expect(h.scene!.liveMarks).toBe(1);
    expect(h.scene!.hasPad).toBe(false); // the pad dropped away as the stamp left
    expect(defenderEl.style.transform).toContain('scale('); // pressed by the tick
    expect(defenderEl.style.willChange).toBe('transform'); // held on its own layer while it is squashed
    f.tick(h.plan.hits[1]! + 8 - h.elapsed(), 4);
    expect(h.scene!.liveMarks).toBe(2);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(24, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveMarks).toBe(3);
    expect(camera.style.transform).toContain('scale(');
    expect(defenderEl.style.transform).toContain('rotate('); // the foe is against the top edge: squashed along the leaning axis
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-14');
    f.tick(h.plan.impactAt + h.plan.pressMs + h.plan.awayMs + 16 - h.elapsed(), 4);
    expect(h.scene!.hasStamp).toBe(false); // lifted away
    expect(h.scene!.liveMarks).toBe(3); // the marks are left behind
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    f.tick(4000, 16);
    rested(r);
  });

  it('SMALL: one thunk lands the blow and leaves one mark, which fades; a struck hero with headroom is squashed straight down', () => {
    const r = run({ side: 'opp', attacker: FOE, defender: YOU, total: 3, formation: formationOf([3], 3) });
    const { h, f, onImpact, defenderEl } = r;
    expect(h.plan.level).toBe('small');
    f.tick(h.plan.impactAt - 12, 4);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.liveMarks).toBe(0);
    f.tick(40, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveMarks).toBe(1);
    expect(h.scene!.hasPad).toBe(false);
    expect(defenderEl.style.transform).toMatch(/^translate\(0\.00px, [\d.]+px\) scale\(1\.\d+, 0\.\d+\)$/); // pushed down, wider, flatter
    f.tick(h.plan.endAt + 3000, 16);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveMarks).toBe(0);
    rested(r);
  });

  it('works in both directions at every tier, within the sprite cap', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const a = side === 'player' ? YOU : FOE, d = side === 'player' ? FOE : YOU;
        const { h, f, onImpact } = run({ side, attacker: a, defender: d, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let t = 0; t < h.plan.impactAt + 400; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak).toBeLessThanOrEqual(MAX_STAMP_SPRITES);
        expect(h.track.contacts).toHaveLength(total >= 12 ? 3 : 1);
        for (const c of h.track.contacts) expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeLessThanOrEqual(R * 0.5);
        h.cancel();
      }
    }
  });

  it('a knockout stamps the skull three times, whatever the number', () => {
    const { h, f, onImpact } = run({ total: 2, knockout: true, formation: formationOf([2], 2) });
    expect(h.plan.level).toBe('big');
    expect(h.plan.knockout).toBe(true);
    f.tick(h.plan.impactAt + 20, 4);
    expect(h.scene!.liveMarks).toBe(3);
    expect(onImpact).toHaveBeenCalledTimes(1);
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
    b.f.tick(b.h.plan.launchAt + 20, 4);
    expect(b.h.mirrorsCamera).toBe(true);
    b.h.cancel();
  });

  it('finish() lands once and puts everything back, at any moment', () => {
    for (const at of [200, 'pad', 'tick', 'after'] as const) {
      const r = run({ total: 40, formation: formationOf([40], 40) });
      const p = r.h.plan;
      r.f.tick(at === 200 ? 200 : at === 'pad' ? p.padAt! + 10 : at === 'tick' ? p.hits[0]! + 30 : p.impactAt + 40, 8);
      r.h.finish();
      expect(r.onImpact, String(at)).toHaveBeenCalledTimes(1);
      expect(r.onDone).toHaveBeenCalledTimes(1);
      r.h.finish();
      expect(r.onImpact).toHaveBeenCalledTimes(1);
      rested(r);
    }
  });

  it('cancel() never lands and puts everything back, at any moment (an unmount cancels)', () => {
    for (const at of ['pad', 'tick'] as const) {
      const r = run({ total: 40, formation: formationOf([40], 40) });
      const p = r.h.plan;
      r.f.tick(at === 'pad' ? p.padAt! + 10 : p.hits[1]! + 30, 8);
      expect(r.h.scene!.liveSprites).toBeGreaterThan(0);
      r.h.cancel();
      expect(r.onImpact).not.toHaveBeenCalled();
      expect(r.onDone).not.toHaveBeenCalled();
      expect(r.h.scene!.root.destroyed).toBe(true);
      rested(r);
    }
  });

  it('the safety timer finishes a sequence whose frames never came (a hidden tab): the blow lands, everything is put back', () => {
    vi.useFakeTimers();
    try {
      const r = run({ total: 40, formation: formationOf([40], 40), safety: true });
      r.f.tick(r.h.plan.launchAt + 100, 8);
      expect(r.onImpact).not.toHaveBeenCalled();
      vi.advanceTimersByTime(r.h.plan.endAt + 2600);
      expect(r.onImpact).toHaveBeenCalledTimes(1);
      expect(r.h.done).toBe(true);
      rested(r);
    } finally { vi.useRealTimers(); }
  });

  it('a replay plays the same: the same plan, the same track, the same sprites; a roll seed is honoured', () => {
    const x = run({ total: 40, formation: formationOf([40], 40) });
    const y = run({ total: 40, formation: formationOf([40], 40) });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.track).toEqual(y.h.track);
    x.f.tick(x.h.plan.impactAt + 60, 8); y.f.tick(y.h.plan.impactAt + 60, 8);
    expect(x.h.scene!.liveSprites).toBe(y.h.scene!.liveSprites);
    x.h.cancel(); y.h.cancel();
    const a = run({ total: 40, formation: formationOf([40], 40), rollSeed: 11 });
    const b = run({ total: 40, formation: formationOf([40], 40), rollSeed: 11 });
    const c = run({ total: 40, formation: formationOf([40], 40), rollSeed: 12 });
    expect(a.h.track.tilts).toEqual(b.h.track.tilts);
    expect(a.h.track.tilts).not.toEqual(c.h.track.tilts);
    a.h.cancel(); b.h.cancel(); c.h.cancel();
  });

  it('reduced motion: no scene, no camera, no portrait moves; the blow still lands once', () => {
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.camera.style.transform).toBe('');
    expect(r.defenderEl.style.transform).toBe('');
  });
});

describe('the scene (headless Pixi)', () => {
  it('pools, stays under the cap, drains, and destroy leaves nothing', () => {
    const scene = new HeroStampScene(TEX, { ink: 0xe0203c, inkDeep: 0x8a0f26, shine: 0xffd9de, dust: 0xefe6d6 }, { markSize: 1.12 }, 1, 7);
    const p = stampPlan({ total: 40, distance: 1600, leadIn: 0 }, { ...C, bigStamps: 5, bigDroplets: 24 });
    const tr = stampTrack(p, geo(), C);
    scene.start(p, tr);
    expect(scene.hasStamp).toBe(true);
    expect(scene.hasPad).toBe(true);
    let t = 0;
    let peak = 0;
    const until = (at: number): void => { for (; t < at; t += 8) { scene.update(8); peak = Math.max(peak, scene.liveSprites); } };
    until(p.padAt!);
    scene.padTap();
    p.thunks.forEach((at, i) => {
      until(at);
      scene.thunk(i, { final: i === p.thunks.length - 1, big: true, skull: i % 2 === 0, droplets: p.droplets, hold: p.markFadeAt - at, fade: p.markFadeMs });
      peak = Math.max(peak, scene.liveSprites);
    });
    expect(scene.liveMarks).toBe(5);
    expect(peak).toBeLessThanOrEqual(MAX_STAMP_SPRITES);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    expect(scene.hasStamp).toBe(false);
    const pooled = scene.pooledSprites;
    scene.start(p, tr);
    scene.thunk(0, { final: false, big: true, skull: false, droplets: 4, hold: 200, fade: 100 });
    expect(scene.pooledSprites).toBe(pooled); // reused, not grown
    scene.clear();
    expect(scene.liveSprites).toBe(0);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });
});
