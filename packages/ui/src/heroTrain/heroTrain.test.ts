// @vitest-environment jsdom
/**
 * THE TRAIN HERO ATTACK ("Right on Schedule", a Legendary; DEV-ONLY): the shared tiers onto the four vehicles; the tuner
 * values; the pure plan (the blow lands ONCE, when the vehicle's nose reaches the portrait; the track, the signal, the
 * bell, the gate, the horn and the whistle never touch the target); the geometry (the track under the struck portrait,
 * the vehicle always entering from the striker's side, the signal on screen); the consist and its motion (through the
 * portrait and off the far edge on time); the struck portrait's reaction (nothing before the blow, settled exactly
 * after); the runner (both portraits restored exactly on the end, finish, cancel and the safety timer; the track, the
 * train and the signal hidden; the camera applied once); determinism; the scene; the sounds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import {
  HERO_TRAIN_CLIP_KEYS, HERO_TRAIN_DEFAULTS, HERO_TRAIN_RANGES, UNIT_SHAPES, clampHeroTrainValue, consistLength, foePose, headlightAt, heroTrainConfigJson,
  noseTravel, signalAt, strikerPose, trackAlpha, trainCameraAt, trainConsist, trainCues, trainGeo, trainKind, trainMotion, trainPlan,
  type FoePose, type HeroTrainNumKey, type TierNum,
} from './heroTrainConfig';
import { HeroTrainScene, MAX_TRAIN_SPRITES, MAX_UNITS, type HeroTrainTextures } from './heroTrainScene';
import { playHeroTrain, type HeroTrainOptions } from './heroTrain';
import { SPEC } from '../HeroTrainTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroTrainTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  track: W, handcar: W, handle: W, cart: W, engine: W, tender: W, box: W, tank: W, hopper: W, flat: W, caboose: W, wheel: W, rod: W, signal: W, gate: W,
  puff: W, ore: W, bonk: W,
};
const C = HERO_TRAIN_DEFAULTS;
const DMG: Record<TierNum, number> = { 1: 3, 2: 8, 3: 12, 4: 40 };
const TIERS: TierNum[] = [1, 2, 3, 4];
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean } = {}) => trainPlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const R = 120;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
// The two real layouts: you (bottom left) strike the foe (top right), and the other way round.
const YOU = { x: 170, y: 845 }, FOE = { x: 1770, y: 160 };
const pose = (): FoePose => ({ x: 0, y: 0, rot: 0, sx: 1, sy: 1 });
const rest = (p: FoePose): boolean => Math.abs(p.x) < 0.05 && Math.abs(p.y) < 0.05 && Math.abs(p.rot) < 0.01 && Math.abs(p.sx - 1) < 1e-4 && Math.abs(p.sy - 1) < 1e-4;

describe('the tiers: the shared four onto the four vehicles', () => {
  it('uses the shared thresholds; I handcar, II mine cart, III steam engine, IV freight; a knockout plays the freight', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).kind, `dmg ${d}`).toBe(trainKind(tierOf(d)));
    expect(TIERS.map((t) => trainKind(t))).toEqual(['handcar', 'minecart', 'engine', 'freight']);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'freight' });
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top; a clip row per sound; DEV-ONLY', () => {
    for (const [k, [min, max]] of Object.entries(HERO_TRAIN_RANGES)) {
      const v = C[k as HeroTrainNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroTrainValue('cars', 99)).toBe(8);
    expect(clampHeroTrainValue('colorSteam', 'nope')).toBe(C.colorSteam);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroTrainConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('train');
    expect(HERO_ATTACK_STYLES).toContain('train');
    for (const k of HERO_TRAIN_CLIP_KEYS) {
      expect(keys.has(k as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Gain') as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Rate') as never), k).toBe(true);
    }
    // Player-facing rules for anything a tuner prints: no em dash, no banned words.
    const text = SPEC.controls.map((c) => `${c.label} ${c.hint ?? ''}`).join(' ');
    expect(text).not.toMatch(/—|\bOath\b|\bclimb\b/i);
  });

  it('the sounds: six clips made for it (bell, whistle, horn, pass, clatter, handcar) and two shared ones; every default clip exists', () => {
    expect(C.sfxBellClip).toBe('fx/train-bell');
    expect(C.sfxWhistleClip).toBe('fx/train-whistle');
    expect(C.sfxHornClip).toBe('fx/train-horn');
    expect(C.sfxPassClip).toBe('fx/train-pass');
    expect(C.sfxClatterClip).toBe('fx/train-clatter');
    expect(C.sfxSqueakClip).toBe('fx/train-handcar');
    const bank = new Set(fs.readdirSync(path.join(__dirname, '..', 'audio', 'fx')).map((f) => f.replace(/\.(mp3|wav)$/, '')));
    for (const k of HERO_TRAIN_CLIP_KEYS) expect(bank.has(C[k].replace('fx/', '')), C[k]).toBe(true);
  });
});

describe('the plan', () => {
  it('every tier: exactly one impact cue, the charge first, the end last, in time order; the plan never reads the portraits', () => {
    for (const t of TIERS) {
      const p = plan(DMG[t]);
      const cues = trainCues(p);
      expect(cues.filter((q) => q.kind === 'impact'), `tier ${t}`).toHaveLength(1);
      expect(cues[0]!.kind).toBe('charge');
      expect(cues.at(-1)!.kind).toBe('end');
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.at).toBeGreaterThanOrEqual(cues[i - 1]!.at);
      expect(p.chargeAt).toBeLessThanOrEqual(p.enterAt);
      expect(p.enterAt).toBeLessThan(p.impactAt);
      expect(p.impactAt).toBeLessThan(p.passEnd);
      expect(p.passEnd).toBeLessThan(p.exitEnd);
      expect(p.exitEnd).toBeLessThanOrEqual(p.endAt);
      expect(p.trackOutAt).toBeGreaterThanOrEqual(p.passEnd);
      expect(p.trackOutAt + C.trackFadeMs).toBeLessThanOrEqual(p.endAt);
      // Nothing that makes the target react is cued before the impact.
      const before = cues.filter((q) => q.at < p.impactAt).map((q) => q.kind);
      expect(before).not.toContain('car');
      expect(before).not.toContain('tail');
    }
  });

  it('the running time grows with the tier and stays in a Legendary\'s range', () => {
    const len = TIERS.map((t) => { const p = plan(DMG[t]); return p.endAt - p.chargeAt; });
    expect(len[0]).toBeGreaterThan(1400); expect(len[0]).toBeLessThan(2400);
    expect(len[1]).toBeGreaterThan(1300); expect(len[1]).toBeLessThan(2400);
    expect(len[2]).toBeGreaterThan(1700); expect(len[2]).toBeLessThan(2800);
    expect(len[3]).toBeGreaterThan(3000); expect(len[3]).toBeLessThan(4600);
    expect(len[3]).toBeGreaterThan(len[2]!);
  });

  it('I: the pump squeaks on the way in. II: the cart rattles. III: the whistle before the engine. None has a signal', () => {
    const h = plan(3), m = plan(8), e = plan(12);
    expect(h.rollAts).toHaveLength(2);
    expect(h.rollAts[0]).toBe(h.enterAt);
    expect(m.rollAts.every((t) => t > m.enterAt && t < m.impactAt)).toBe(true);
    expect(e.whistleAt).not.toBeNull();
    expect(e.whistleAt!).toBeLessThan(e.enterAt);
    for (const p of [h, m, e]) {
      expect(p.signalAt).toBeNull(); expect(p.gateAt).toBeNull(); expect(p.hornAt).toBeNull(); expect(p.bellAts).toEqual([]); expect(p.carAts).toEqual([]);
    }
    expect(trainCues(e).map((q) => q.kind)).toEqual(['charge', 'whistle', 'enter', 'impact', 'tail', 'trackout', 'end']);
  });

  it('IV: the signal rises, the lamps and bell, the gate drops, the horn, then the engine; a car at a time; the caboose; the gate lifts', () => {
    const p = plan(40);
    expect(p.signalAt!).toBeLessThan(p.lampsAt!);
    expect(p.lampsAt!).toBeLessThan(p.gateAt!);
    expect(p.gateAt!).toBeLessThan(p.hornAt!);
    expect(p.hornAt!).toBeLessThan(p.enterAt);
    expect(p.bellAts[0]).toBe(p.lampsAt);
    expect(p.bellAts.length).toBeGreaterThanOrEqual(2);
    expect(p.bellAts.at(-1)!).toBeLessThan(p.passEnd);
    // Seven cars and the caboose each arrive between the impact and the end of the pass, in order.
    expect(p.cars).toBe(7);
    expect(p.carAts).toHaveLength(8);
    for (let i = 0; i < p.carAts.length; i++) {
      expect(p.carAts[i]!).toBeGreaterThan(i ? p.carAts[i - 1]! : p.impactAt);
      expect(p.carAts[i]!).toBeLessThan(p.passEnd);
    }
    expect(p.gateUpAt!).toBeGreaterThan(p.passEnd);
    expect(clampHeroTrainValue('cars', 6)).toBe(6);
    expect(trainPlan({ total: 40 }, { ...C, cars: 6 }).carAts).toHaveLength(7);
  });

  it('reduced motion: no track, no vehicle, no camera; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(p.impactAt).toBe(leadInOf([40], true));
    expect(trainCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(trainConsist(p, R, C)).toEqual([]);
    const g = trainGeo(YOU, FOE, R, FRAME, C);
    for (const t of [0, p.impactAt, p.impactAt + 100, p.endAt]) {
      expect(rest(foePose(p, g, C, R, t, pose()))).toBe(true);
      expect(rest(strikerPose(p, g, R, t, pose()))).toBe(true);
      expect(trackAlpha(p, C, t)).toBe(0);
      expect(trainCameraAt(p, C, t, 1)).toEqual({ zoom: 1, x: 0, y: 0 });
    }
  });
});

describe('the geometry', () => {
  it('the track runs under the struck portrait, past both edges; the vehicle ENTERS from the striker\'s side', () => {
    const g = trainGeo(YOU, FOE, R, FRAME, C);
    expect(g.dir).toBe(1);
    expect(g.enterX).toBe(0); expect(g.exitX).toBe(1920);
    expect(g.railY).toBeGreaterThan(FOE.y); expect(g.railY).toBeLessThan(FOE.y + R * 1.2);
    expect(g.x0).toBeLessThan(0); expect(g.x1).toBeGreaterThan(1920);
    // The nose is on the portrait's near edge on the impact.
    expect(g.hitX).toBeLessThan(FOE.x); expect(g.hitX).toBeGreaterThan(FOE.x - R);
    expect(g.distIn + g.distOut).toBeCloseTo(1920, 5);
    const back = trainGeo(FOE, YOU, R, FRAME, C, 'opp');
    expect(back.dir).toBe(-1);
    expect(back.enterX).toBe(1920); expect(back.exitX).toBe(0);
    expect(back.hitX).toBeGreaterThan(YOU.x);
    expect(back.hit).toEqual(YOU);
  });

  it('a striker straight above or below: yours come from the left, the foe\'s from the right', () => {
    expect(trainGeo({ x: 960, y: 900 }, { x: 960, y: 200 }, R, FRAME, C, 'player').dir).toBe(1);
    expect(trainGeo({ x: 960, y: 200 }, { x: 960, y: 900 }, R, FRAME, C, 'opp').dir).toBe(-1);
  });

  it('the signal stands on screen beside the track (never on the portrait), as tall as the room above allows; the throw stays on screen', () => {
    for (const [a, d, side] of [[YOU, FOE, 'player'], [FOE, YOU, 'opp'], [{ x: 1700, y: 900 }, { x: 80, y: 90 }, 'opp'], [{ x: 200, y: 200 }, { x: 1850, y: 1000 }, 'player']] as const) {
      const g = trainGeo(a, d, R, FRAME, C, side);
      expect(g.signal.x).toBeGreaterThan(0); expect(g.signal.x).toBeLessThan(1920);
      expect(Math.abs(g.signal.x - d.x)).toBeGreaterThan(R * 1.5);
      expect(g.signal.footY - g.signal.h).toBeGreaterThanOrEqual(0);
      expect(g.signal.h).toBeGreaterThan(0);
      // The arm lies away from the portrait.
      expect(g.signal.arm).toBe(g.signal.x < d.x ? -1 : 1);
      expect(g.lift).toBeGreaterThanOrEqual(0);
      expect(d.y - g.lift - R).toBeGreaterThanOrEqual(-0.01 + Math.min(0, d.y - R));
    }
  });
});

describe('the consist and its motion', () => {
  it('I one handcar, II one cart, III the engine and its tender, IV the engine, its tender, the cars and the caboose (a few textures repeated)', () => {
    const kinds = (t: TierNum) => trainConsist(plan(DMG[t]), R, C).map((u) => u.kind);
    expect(kinds(1)).toEqual(['handcar']);
    expect(kinds(2)).toEqual(['cart']);
    expect(kinds(3)).toEqual(['engine', 'tender']);
    const f = kinds(4);
    expect(f.slice(0, 2)).toEqual(['engine', 'tender']);
    expect(f.at(-1)).toBe('caboose');
    expect(f).toHaveLength(10);
    expect(new Set(f.slice(2, -1)).size).toBeLessThanOrEqual(4);
    expect(trainConsist(trainPlan({ total: 40 }, { ...C, cars: 8 }), R, { ...C, cars: 8 }).length).toBeLessThanOrEqual(MAX_UNITS);
    // Units sit nose to tail with no gap or overlap, each at its painted aspect.
    const units = trainConsist(plan(40), R, C);
    units.forEach((u, i) => {
      expect(u.off).toBeCloseTo(i ? units[i - 1]!.off + units[i - 1]!.w : 0, 5);
      expect(u.w / u.h).toBeCloseTo(UNIT_SHAPES[u.kind].tw / UNIT_SHAPES[u.kind].th, 5);
    });
    expect(consistLength(units)).toBeCloseTo(units.at(-1)!.off + units.at(-1)!.w, 5);
  });

  it('every tier, both directions: off screen before it is due, its nose ON the portrait at the impact, its tail past the portrait by the end of the pass and off the far edge by the exit', () => {
    for (const t of TIERS) {
      for (const [a, d, side] of [[YOU, FOE, 'player'], [FOE, YOU, 'opp']] as const) {
        const p = plan(DMG[t]);
        const g = trainGeo(a, d, R, FRAME, C, side);
        const units = trainConsist(p, R, C);
        const len = consistLength(units);
        const m = trainMotion(p, g, len, R);
        const nose = (ms: number): number => g.hitX + g.dir * noseTravel(p, m, ms);
        const along = (x: number): number => (x - g.enterX) * g.dir; // px past the entry edge
        const label = `tier ${t} ${side}`;
        expect(along(nose(m.arriveAt - 1)), label).toBeLessThan(0);
        expect(m.arriveAt, label).toBeLessThan(p.impactAt);
        if (t < 4) expect(m.arriveAt, label).toBeGreaterThanOrEqual(p.enterAt - 0.01);
        expect(nose(p.impactAt), label).toBeCloseTo(g.hitX, 5);
        // The tail (the nose less the train's length) is past the far side of the portrait by the end of the pass.
        expect((nose(p.passEnd) - g.dir * len - d.x) * g.dir, label).toBeGreaterThanOrEqual(R * 0.8);
        expect(along(nose(p.exitEnd) - g.dir * len), label).toBeGreaterThanOrEqual(1920);
        // It never stops or backs up.
        let prev = -Infinity;
        for (let ms = p.chargeAt; ms <= p.endAt; ms += 16) { const x = along(nose(ms)); expect(x, label).toBeGreaterThan(prev); prev = x; }
      }
    }
  });

  it('IV: the whole train takes exactly the pass to clear the portrait, wherever the portraits are', () => {
    const p = plan(40);
    const len = consistLength(trainConsist(p, R, C));
    for (const d of [FOE, { x: 900, y: 500 }, { x: 300, y: 300 }]) {
      const m = trainMotion(p, trainGeo(YOU, d, R, FRAME, C), len, R);
      expect(m.v0 * p.passMs).toBeCloseTo(len + R * 1.7, 3);
    }
  });
});

describe('the track, the signal and the headlight', () => {
  it('the track fades in at the charge and is gone by the end; I to III never show the signal or the headlight', () => {
    for (const t of TIERS) {
      const p = plan(DMG[t]);
      expect(trackAlpha(p, C, p.chargeAt - 1)).toBe(0);
      expect(trackAlpha(p, C, p.chargeAt + C.trackFadeMs)).toBeCloseTo(1, 5);
      expect(trackAlpha(p, C, p.impactAt)).toBe(1);
      expect(trackAlpha(p, C, p.endAt)).toBe(0);
      if (t < 4) for (let ms = 0; ms <= p.endAt; ms += 40) { expect(signalAt(p, C, ms).alpha).toBe(0); expect(headlightAt(p, ms, p.enterAt)).toBe(0); }
    }
  });

  it('IV: the signal rises, its two lamps ALTERNATE (never both lit), the arm drops before the horn and lifts after the caboose, and it goes with the track', () => {
    const p = plan(40);
    expect(signalAt(p, C, p.signalAt! - 1).alpha).toBe(0);
    expect(signalAt(p, C, p.gateAt! - 1)).toMatchObject({ arm: 0 });
    expect(signalAt(p, C, p.signalAt! + 400).rise).toBeCloseTo(1, 1);
    expect(signalAt(p, C, p.hornAt!).arm).toBeGreaterThan(0.9);
    expect(signalAt(p, C, p.impactAt).arm).toBeCloseTo(1, 2);
    expect(signalAt(p, C, p.gateUpAt! + 500).arm).toBeCloseTo(0, 5);
    let a = 0, b = 0;
    for (let ms = p.lampsAt!; ms < p.passEnd; ms += 10) {
      const s = signalAt(p, C, ms);
      expect(Math.min(s.lampA, s.lampB)).toBe(0);
      if (s.lampA > 0.9) a++;
      if (s.lampB > 0.9) b++;
    }
    expect(a).toBeGreaterThan(20); expect(b).toBeGreaterThan(20);
    expect(signalAt(p, C, p.gateUpAt! + 10)).toMatchObject({ lampA: 0, lampB: 0 });
    expect(signalAt(p, C, p.endAt).alpha).toBe(0);
    // The headlight grows from the horn and is gone once the engine is on screen.
    const arrive = p.impactAt - 500;
    expect(headlightAt(p, p.hornAt! - 1, arrive)).toBe(0);
    expect(headlightAt(p, arrive - 100, arrive)).toBeGreaterThan(headlightAt(p, p.hornAt! + 150, arrive));
    expect(headlightAt(p, arrive + 200, arrive)).toBe(0);
  });
});

describe('the struck portrait', () => {
  const g = trainGeo(YOU, FOE, R, FRAME, C);
  it('every tier: nothing before the impact; it reacts on it; it has settled to EXACTLY nothing by the end', () => {
    for (const t of TIERS) {
      const p = plan(DMG[t]);
      for (let ms = 0; ms < p.impactAt; ms += 20) expect(rest(foePose(p, g, C, R, ms, pose())), `tier ${t} at ${ms}`).toBe(true);
      expect(rest(foePose(p, g, C, R, p.impactAt + 60, pose())), `tier ${t} reacts`).toBe(false);
      const end = foePose(p, g, C, R, p.endAt, pose());
      expect(Math.abs(end.x), `tier ${t} x`).toBeLessThan(0.6);
      expect(Math.abs(end.y), `tier ${t} y`).toBeLessThan(0.6);
      expect(Math.abs(end.rot), `tier ${t} rot`).toBeLessThan(0.6);
      expect(Math.abs(end.sy - 1), `tier ${t} sy`).toBeLessThan(0.01);
    }
  });

  it('I a small nudge along the track; II knocked further and it wobbles; both the way the vehicle goes', () => {
    const a = foePose(plan(3), g, C, R, plan(3).impactAt + 1, pose());
    const b = foePose(plan(8), g, C, R, plan(8).impactAt + 1, pose());
    expect(a.x).toBeGreaterThan(0); expect(b.x).toBeGreaterThan(a.x * 1.5);
    expect(Math.abs(b.rot)).toBeGreaterThan(Math.abs(a.rot) * 2);
    const back = trainGeo(FOE, YOU, R, FRAME, C, 'opp');
    expect(foePose(plan(8), back, C, R, plan(8).impactAt + 1, pose()).x).toBeLessThan(0);
  });

  it('III: FLATTENED while the engine passes (pressed down onto the track, never under it), then it springs up past its height and settles', () => {
    const p = plan(12);
    const mid = foePose(p, g, C, R, (p.impactAt + p.passEnd) / 2, pose());
    expect(mid.sy).toBeCloseTo(1 - C.flatten, 3);
    expect(mid.sx).toBeGreaterThan(1.1);
    expect(mid.y).toBeGreaterThan(0);
    // Its lower edge rests on the near side of the track bed, not under it.
    expect(FOE.y + mid.y + mid.sy * R).toBeLessThanOrEqual(g.railY - R * C.trackSize * 0.5 + 0.5);
    let tallest = 0;
    for (let ms = p.passEnd; ms < p.endAt; ms += 8) tallest = Math.max(tallest, foePose(p, g, C, R, ms, pose()).sy);
    expect(tallest).toBeGreaterThan(1.05);
  });

  it('IV: thrown up and SPINNING whole turns while the cars pass, buffeted by each, upright as the caboose clears; then it drops and wobbles to rest', () => {
    const p = plan(40);
    const low = trainGeo(FOE, YOU, R, FRAME, C, 'opp'); // room above: the full throw
    expect(low.lift).toBeCloseTo(R * C.liftSize, 5);
    const mid = foePose(p, low, C, R, p.impactAt + 400, pose());
    expect(mid.y).toBeLessThan(-low.lift * 0.8);
    expect(Math.abs(mid.rot)).toBeGreaterThan(180);
    expect(Math.sign(mid.rot)).toBe(low.dir);
    const last = foePose(p, low, C, R, p.passEnd - 0.01, pose());
    expect(Math.abs(last.rot)).toBeCloseTo(360 * C.spinTurns, 0); // whole turns: upright
    // A car arriving jolts it.
    const car = p.carAts[2]!;
    expect(Math.abs(foePose(p, low, C, R, car + 1, pose()).x - foePose(p, low, C, R, car - 1, pose()).x)).toBeGreaterThan(3);
    expect(foePose(p, low, C, R, p.passEnd + 190, pose()).y).toBeCloseTo(0, 1);
    // A portrait tucked against the top of the screen is thrown only as far as there is room.
    expect(g.lift).toBeLessThan(low.lift);
    expect(FOE.y - g.lift - R).toBeGreaterThanOrEqual(0);
  });

  it('the striker only hops and leans down the line, and is home before the end', () => {
    for (const t of TIERS) {
      const p = plan(DMG[t]);
      expect(rest(strikerPose(p, g, R, p.chargeAt - 1, pose()))).toBe(true);
      const mid = strikerPose(p, g, R, p.chargeAt + 130, pose());
      expect(mid.y).toBeLessThan(0);
      expect(Math.sign(strikerPose(p, g, R, p.enterAt + 100, pose()).rot)).toBe(g.dir);
      expect(rest(strikerPose(p, g, R, p.endAt, pose()))).toBe(true);
    }
  });

  it('the camera pushes in as it comes, holds while it passes, shakes ALONG the track on the impact, and is back by the end', () => {
    for (const t of TIERS) {
      const p = plan(DMG[t]);
      expect(trainCameraAt(p, C, p.chargeAt, 1).zoom).toBe(1);
      expect(trainCameraAt(p, C, p.impactAt - 1, 1).zoom).toBeCloseTo(1 + p.zoom, 3);
      expect(trainCameraAt(p, C, p.impactAt + 20, 1).x).not.toBe(0);
      expect(trainCameraAt(p, C, p.impactAt, -1).x).toBeCloseTo(-trainCameraAt(p, C, p.impactAt, 1).x, 5);
      expect(trainCameraAt(p, C, p.passEnd + C.zoomOutMs + 600, 1).zoom).toBeCloseTo(1, 3);
    }
    const iv = plan(40);
    expect(trainCameraAt(iv, C, (iv.impactAt + iv.passEnd) / 2, 1).zoom).toBeGreaterThan(1.04);
  });
});

// ─── the runner ────────────────────────────────────────────────────────────────────────────────────────────────

function manualFrames() {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn: (dt: number) => void) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms: number, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(Math.min(step, ms - t))); },
    hooked: () => fns.length,
  };
}

function setup(total: number, side: 'player' | 'opp' = 'player', extra: Partial<HeroTrainOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  attackerEl.style.transform = 'translate(1px, 2px)';
  attackerEl.style.opacity = '0.9';
  defenderEl.style.transform = 'scale(0.5)';
  defenderEl.style.opacity = '0.8';
  camera.append(attackerEl, defenderEl);
  document.body.append(camera);
  const onImpact = vi.fn(), onDone = vi.fn();
  const a = side === 'player' ? YOU : FOE, d = side === 'player' ? FOE : YOU;
  const h = playHeroTrain({
    formation: formationOf([2, 3], total), total, side, attacker: a, defender: d, defenderRadius: R, attackerRadius: R, reduced: false, onImpact, onDone,
    frames: f.frames, textures: TEX, sound: false, safety: false, cfg: C, pixiScale: 1,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host: camera, camera, attackerEl, defenderEl, ...extra,
  });
  const restored = (): void => {
    expect(attackerEl.style.transform).toBe('translate(1px, 2px)');
    expect(attackerEl.style.opacity).toBe('0.9');
    expect(defenderEl.style.transform).toBe('scale(0.5)');
    expect(defenderEl.style.opacity).toBe('0.8');
    expect(camera.style.transform).toBe('');
    expect(document.body.className).toBe('');
    expect(document.querySelector('.dform')).toBeNull();
  };
  return { f, h, root, camera, attackerEl, defenderEl, onImpact, onDone, restored };
}

describe('the runner (the shared clock, both portraits restored on every exit)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; vi.useRealTimers(); });

  it('IV: the signal, the bell, the gate, the horn and the train rolling in never land it; the blow lands ONCE as the engine hits; everything is put back EXACTLY at the end', () => {
    const s = setup(40);
    const p = s.h.plan;
    s.f.tick(p.hornAt! + 40);
    expect(s.onImpact).not.toHaveBeenCalled();
    expect(s.defenderEl.style.transform).toBe('scale(0.5)'); // the target has not reacted
    expect(s.h.scene!.ownVisible).toBe(true); // the track and the signal are up
    s.f.tick(p.impactAt - p.hornAt! - 80);
    expect(s.onImpact).not.toHaveBeenCalled();
    expect(s.defenderEl.style.transform).toBe('scale(0.5)');
    s.f.tick(96);
    expect(s.onImpact).toHaveBeenCalledTimes(1);
    expect(s.h.impacted).toBe(true);
    expect(s.defenderEl.style.transform).toContain('rotate('); // thrown and spinning
    expect(s.camera.style.transform).toContain('scale(');
    s.f.tick(p.endAt);
    expect(s.onImpact).toHaveBeenCalledTimes(1);
    expect(s.onDone).toHaveBeenCalledTimes(1);
    expect(s.h.done).toBe(true);
    s.restored();
    s.f.tick(3000);
    expect(s.f.hooked()).toBe(0); // the scene drained and the updater unhooked
    expect(s.root.children).toHaveLength(0);
  });

  it('cancel() mid-run, finish() mid-run and the safety timer each put both portraits back exactly (cancel never lands)', () => {
    for (const t of TIERS) {
      const c = setup(DMG[t]);
      c.f.tick(c.h.plan.impactAt + 120);
      expect(c.defenderEl.style.transform).not.toBe('scale(0.5)');
      c.h.cancel();
      c.restored();
      expect(c.onDone).not.toHaveBeenCalled();
      expect(c.f.hooked()).toBe(0);
      expect(c.root.children).toHaveLength(0);

      const early = setup(DMG[t]);
      early.f.tick(early.h.plan.chargeAt + 100);
      early.h.cancel();
      expect(early.onImpact).not.toHaveBeenCalled();
      early.restored();

      const fin = setup(DMG[t]);
      fin.f.tick(fin.h.plan.enterAt + 30);
      fin.h.finish();
      expect(fin.onImpact).toHaveBeenCalledTimes(1);
      expect(fin.onDone).toHaveBeenCalledTimes(1);
      fin.restored();
      expect(fin.root.children).toHaveLength(0);
    }
    vi.useFakeTimers();
    const s = setup(40, 'player', { safety: true });
    s.f.tick(s.h.plan.impactAt - 200); // then the tab is hidden: no more frames
    vi.advanceTimersByTime(s.h.plan.endAt + 2600);
    expect(s.onImpact).toHaveBeenCalledTimes(1);
    expect(s.h.done).toBe(true);
    s.restored();
    expect(s.root.children).toHaveLength(0);
  });

  it('both directions at every tier: within the sprite cap, the blow once, own objects hidden at the end, the camera applied once; reduced motion draws nothing', () => {
    for (const t of TIERS) {
      for (const side of ['player', 'opp'] as const) {
        const s = setup(DMG[t], side);
        expect(s.h.geo.dir).toBe(side === 'player' ? 1 : -1);
        expect(s.h.mirrorsCamera).toBe(true); // the test canvas does not ride the camera element
        let peak = 0;
        for (let ms = 0; ms < s.h.plan.endAt + 32; ms += 16) { s.f.tick(16); peak = Math.max(peak, s.h.scene!.liveSprites); }
        expect(peak, `tier ${t} ${side}`).toBeLessThanOrEqual(MAX_TRAIN_SPRITES);
        expect(peak, `tier ${t} ${side}`).toBeLessThan(200);
        expect(s.onImpact).toHaveBeenCalledTimes(1);
        expect(s.h.scene!.ownVisible).toBe(false);
        expect(s.h.scene!.ownSprites.every((sp) => !sp.visible)).toBe(true);
        s.restored();
      }
    }
    const r = setup(40, 'player', { reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 32);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.attackerEl.style.transform).toBe('translate(1px, 2px)');
    expect(r.defenderEl.style.transform).toBe('scale(0.5)');
  });

  it('the train is drawn THROUGH the portrait: off the track before it is due, over the portrait just after the impact, gone after the exit', () => {
    for (const side of ['player', 'opp'] as const) {
      const s = setup(40, side);
      const p = s.h.plan;
      const cars = (): number => s.h.scene!.ownSprites.filter((sp) => sp.visible && sp.anchor.y === 1 && sp.anchor.x === 0.5 && sp.y > s.h.geo.railY).length;
      s.f.tick(p.hornAt!);
      const before = cars();
      s.f.tick(p.impactAt + 300 - p.hornAt!);
      expect(cars()).toBeGreaterThan(before + 2); // several units on screen at once
      expect((s.h.noseX(p.impactAt + 300) - s.h.geo.hit.x) * s.h.geo.dir).toBeGreaterThan(R); // the nose is out the far side
      s.f.tick(p.endAt - p.impactAt);
      expect(s.h.scene!.ownVisible).toBe(false);
      s.h.cancel();
    }
  });

  it('deterministic: the same blow plays the same frames (the portrait, the camera, the sprites); the seed only scatters the FX', () => {
    const run = (seed?: number): string[] => {
      const s = setup(40, 'player', seed === undefined ? {} : { rollSeed: seed });
      const out: string[] = [];
      for (let ms = 0; ms < s.h.plan.endAt + 32; ms += 16) {
        s.f.tick(16);
        const sc = s.h.scene!;
        out.push(`${s.defenderEl.style.transform}|${s.camera.style.transform}|${sc.liveSprites}|${sc.root.children.map((l) => l.children.filter((ch) => ch.visible).map((ch) => `${ch.x.toFixed(1)},${ch.y.toFixed(1)}`).join(';')).join('/')}`);
      }
      s.h.cancel();
      document.body.innerHTML = '';
      return out;
    };
    expect(run()).toEqual(run());
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    // The plan and the portrait's pose never depend on the seed.
    const a = setup(40, 'player', { rollSeed: 1 }), b = setup(40, 'player', { rollSeed: 2 });
    expect(a.h.plan).toEqual(b.h.plan);
    expect(a.h.foe(a.h.plan.impactAt + 300)).toEqual(b.h.foe(b.h.plan.impactAt + 300));
    a.h.cancel(); b.h.cancel();
  });
});

describe('the scene (headless Pixi)', () => {
  it('makes its own sprites once, mirrors a train going left, hides them all, drains, and destroy leaves nothing', () => {
    for (const dirSide of ['player', 'opp'] as const) {
      const p = plan(40);
      const g = dirSide === 'player' ? trainGeo(YOU, FOE, R, FRAME, C) : trainGeo(FOE, YOU, R, FRAME, C, 'opp');
      const units = trainConsist(p, R, C);
      const sc = new HeroTrainScene(TEX, { steam: 1, ore: 2, lamp: 3, headlight: 4, spark: 5, star: 6, flash: 7, side: 8 }, { trackSize: C.trackSize, handleSwing: C.handleSwing, bounce: C.bounce }, g, units, p.kind, R, 1, 3);
      const made = sc.ownSprites.length;
      expect(sc.ownVisible).toBe(false);
      sc.setTrack(1);
      sc.setTrain(g.hitX + g.dir * 400, 400, true);
      sc.setSignal({ alpha: 1, rise: 1, arm: 1, lampA: 1, lampB: 0 });
      sc.setHeadlight(0.6);
      expect(sc.ownVisible).toBe(true);
      const car = sc.ownSprites.find((s) => s.visible && s.anchor.y === 1 && s.anchor.x === 0.5 && s.y > g.railY)!;
      expect(Math.sign(car.scale.x)).toBe(g.dir);
      expect(car.scale.y).toBeGreaterThan(0);
      const f = sc.funnelAt(500, { x: 0, y: 0 })!;
      expect((500 - f.x) * g.dir).toBeGreaterThan(0); // the funnel is behind the nose
      expect(f.y).toBeLessThan(g.wheelY);
      sc.puff(f); sc.wind(); sc.sparks(900, 4); sc.dust({ x: 900, y: 300 }); sc.hit(g.contact, 1.7); sc.buffet(g.hit); sc.lastPuff(g.hit);
      expect(sc.liveFx).toBeGreaterThan(20);
      expect(sc.liveSprites).toBeLessThanOrEqual(MAX_TRAIN_SPRITES);
      expect(sc.ownSprites.length).toBe(made); // nothing is made per frame
      sc.hideOwn();
      expect(sc.ownVisible).toBe(false);
      let alive = true;
      for (let i = 0; i < 200 && alive; i++) alive = sc.update(16);
      expect(alive).toBe(false);
      expect(sc.liveFx).toBe(0);
      sc.destroy();
      expect(sc.update(16)).toBe(false);
    }
  });

  it('each look\'s hit: I throws its bonk stars, II spills ore, III and IV blow steam', () => {
    for (const t of TIERS) {
      const p = plan(DMG[t]);
      const g = trainGeo(YOU, FOE, R, FRAME, C);
      const sc = new HeroTrainScene(TEX, { steam: 1, ore: 2, lamp: 3, headlight: 4, spark: 5, star: 0xabcdef, flash: 7, side: 8 }, { trackSize: C.trackSize, handleSwing: C.handleSwing, bounce: C.bounce }, g, trainConsist(p, R, C), p.kind, R, 1, 3);
      sc.update(500); // the pre-warm sprites are returned
      const before = sc.liveFx;
      sc.hit(g.contact, p.burst);
      const n = sc.liveFx - before;
      expect(n, `tier ${t}`).toBeGreaterThanOrEqual(t === 1 ? 5 : 15);
      sc.destroy();
    }
  });
});
