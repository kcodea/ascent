// @vitest-environment jsdom
/**
 * THE COMBO HERO ATTACK ("Flawless", a Legendary): the blow played as an arcade fighting game combo with a HUD. The
 * shared tiers onto the four combos (Tier 1 the counter, Tier 2 the string, Tier 3 the launcher, Tier 4 the super); the
 * tuner values and the sounds; the pure plan (the blow lands ONCE: the counter-hit, the roundhouse, the slam, the heavy
 * blow; every other hit and the parry are ticks); THE COUNTER COUNTS REAL HITS; the geometry (the ring pulled out of a
 * screen corner, everything on screen, both directions); the pure poses of BOTH portraits (the parry, the hit-freeze is
 * a held pose, the contact smear, the launch, the juggle, the struggle, the spike home, dizzy, the K.O.); the super
 * cut-in and the letterbox; the runner (both portraits' transforms, the striker's opacity, the z-order class and EVERY
 * lifted z-index restored exactly on the end, finish, cancel, the safety timer and an unmount; the HUD hidden; the camera
 * applied once); determinism from the seed; the scene.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES, HERO_ATTACK_STYLES } from '../heroBlast/heroAttackStyle';
import {
  COMBO_CAPS, GLYPHS, HERO_COMBO_CLIP_KEYS, HERO_COMBO_DEFAULTS, HERO_COMBO_RANGES, airHitsOf, clampHeroComboValue, comboCameraAt, comboCounter, KO_LANDINGS,
  comboBars, comboCues, comboCutin, comboDizzy, comboGeo, comboKind, comboPlan, counterSize, glyphAt, heroComboConfigJson, hitPoint, onScreen, parryPoint,
  strikerPose, targetPose, tierColor,
  type HeroComboNumKey,
} from './heroComboConfig';
import { HeroComboScene, MAX_COMBO_SPRITES, type HeroComboTextures } from './heroComboScene';
import { COMBO_Z, playHeroCombo, type HeroComboOptions } from './heroCombo';
import { SPEC } from '../HeroComboTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';

const W = Texture.WHITE;
const TEX: HeroComboTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  blade: W, dizzyStar: W, arrow: W, button: W, band: W, dust: W, labelHit: W, labelHits: W, wordKo: W, wordCounter: W, wordPerfect: W, wordBreaker: W,
  d0: W, d1: W, d2: W, d3: W, d4: W, d5: W, d6: W, d7: W, d8: W, d9: W,
};
const C = HERO_COMBO_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; reduced?: boolean; airHits?: number } = {}) => comboPlan({ total, leadIn: leadInOf([total], o.reduced), ...o }, C);
const R = 120;
const FRAME = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
// The real screen: your hero in the bottom left corner, the foe in the top right.
const YOU = { x: 171, y: 844 }, FOE = { x: 1773, y: 161 };
const cueKinds = (total: number) => comboCues(plan(total), C).map((q) => q.kind);

describe('the tiers: the shared four onto the four combos', () => {
  it('uses the shared thresholds; Tier 1 the counter, Tier 2 the string, Tier 3 the launcher, Tier 4 the super; a knockout plays the super', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).kind, `dmg ${d}`).toBe(comboKind(tierOf(d)));
    expect([1, 2, 3, 4].map((t) => comboKind(t as 1 | 2 | 3 | 4))).toEqual(['counter', 'string', 'launcher', 'super']);
    // Every tier has its own colour.
    expect(new Set([1, 2, 3, 4].map((t) => tierColor(t as 1 | 2 | 3 | 4, C))).size).toBe(4);
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'super' });
    expect(HERO_ATTACK_STYLES).toContain('combo');
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; buttons on top; a clip row per sound', () => {
    for (const [k, [min, max]] of Object.entries(HERO_COMBO_RANGES)) {
      const v = C[k as HeroComboNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroComboValue('flurryHits', 99)).toBe(COMBO_CAPS.flurry);
    expect(clampHeroComboValue('colorT1', 'nope')).toBe(C.colorT1);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroComboConfigJson(C)).previewDamage).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    expect((SPEC.actions ?? []).map((a) => a.label).filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('combo');
    for (const k of HERO_COMBO_CLIP_KEYS) {
      expect(keys.has(k as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Gain') as never), k).toBe(true);
      expect(keys.has(k.replace('Clip', 'Rate') as never), k).toBe(true);
    }
  });

  it('the sounds: its own clips (the hits, the parry, the struggle, the birds, the super, the K.O. sting, the announcer); every default clip exists', async () => {
    expect(C.sfxParryClip).toBe('fx/combo-parry');
    expect(C.sfxStruggleClip).toBe('fx/combo-struggle');
    expect(C.sfxDizzyClip).toBe('fx/combo-dizzy');
    expect(C.sfxVoCounterClip).toBe('fx/combo-vo-counter');
    expect(C.sfxVoKoClip).toBe('fx/combo-vo-ko');
    expect(C.sfxVoPerfectClip).toBe('fx/combo-vo-perfect');
    expect(C.sfxPunchClip).toBe('fx/combo-punch');
    expect(C.sfxChargeClip).toBe('fx/combo-charge');
    expect(C.sfxBoomClip).toBe('fx/combo-boom');
    expect(C.sfxHitClip).toBe('fx/combo-hit');
    expect(C.sfxHeavyClip).toBe('fx/combo-heavy');
    expect(C.sfxSuperClip).toBe('fx/combo-super');
    expect(C.sfxKoClip).toBe('fx/combo-ko');
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const k of HERO_COMBO_CLIP_KEYS) {
      const id = C[k];
      const base = resolve(__dirname, '../audio', id);
      expect(existsSync(`${base}.mp3`) || existsSync(`${base}.wav`), `${k} = ${id}`).toBe(true);
    }
  });
});

describe('the plan (the blow lands once, on the last beat of the combo)', () => {
  it('Tier 1: step in; the target lunges and is PARRIED (a tick), then ONE counter-hit = THE impact', () => {
    for (const total of [1, 3, 5]) {
      const p = plan(total);
      expect(p.kind).toBe('counter');
      expect(p.hits.map((h) => h.kind)).toEqual(['counter']);
      expect(p.chargeAt).toBeLessThan(p.stepAt);
      expect(p.stepEnd).toBeLessThan(p.feintAt!);
      expect(p.parryAt! - p.feintAt!).toBe(C.feintMs);
      expect(p.impactAt - p.parryAt!).toBe(C.parryMs);
      expect(p.impactAt).toBe(p.hits[0]!.at);
    }
    expect(cueKinds(3)).toEqual(['charge', 'step', 'feint', 'parry', 'hit', 'impact', 'home', 'end']);
  });

  it('Tier 2: jab, jab, cross, then the held-back roundhouse on the beat (THE impact); then dizzy', () => {
    const p = plan(8);
    expect(p.kind).toBe('string');
    expect(p.hits.map((h) => h.kind)).toEqual(['jab', 'jab', 'cross', 'kick']);
    const g = p.hits.map((h, i) => (i ? h.at - p.hits[i - 1]!.at : 0)).slice(1);
    // A steady beat, then a held-back last beat.
    expect(g[0]).toBe(g[1]);
    expect(g[2]!).toBeGreaterThan(g[1]! * 1.3);
    expect(p.impactAt).toBe(p.hits[3]!.at);
    expect(p.dizzyAt!).toBeGreaterThan(p.impactAt);
    expect(p.dizzyEnd!).toBeLessThan(p.homeAt + 200);
    expect(cueKinds(8).filter((k) => k === 'hit')).toHaveLength(4);
    expect(cueKinds(8)).toContain('dizzy');
  });

  it('Tier 3: two hits, the uppercut launches, the jump, three or four air hits, the STRUGGLE, the spike, then the slam = THE impact; dizzy', () => {
    for (const air of [3, 4]) {
      const p = plan(14, { airHits: air });
      expect(p.hits.map((h) => h.kind)).toEqual(['jab', 'cross', 'upper', ...Array.from({ length: air }, () => 'air'), 'spike']);
      expect(p.launchAt).toBe(p.hits[2]!.at);
      expect(p.jumpAt!).toBeGreaterThan(p.launchAt!);
      expect(p.hits[3]!.at).toBeGreaterThan(p.jumpAt!);
      expect(p.spikeAt).toBe(p.hits[p.hits.length - 1]!.at);
      // THE STRUGGLE ("BREAKER?"): after the last air hit, before the spike, and nothing lands in it.
      expect(p.breakAt!).toBeGreaterThan(p.hits[p.hits.length - 2]!.at);
      expect(p.spikeAt! - p.breakAt!).toBeGreaterThanOrEqual(C.breakMs);
      expect(p.hits.filter((h) => h.at > p.breakAt! && h.at < p.spikeAt!)).toHaveLength(0);
      expect(p.dizzyAt!).toBeGreaterThan(p.slamAt!);
      expect(p.slamAt!).toBeGreaterThan(p.spikeAt!);
      expect(p.impactAt).toBe(p.slamAt);
    }
    expect([...new Set(Array.from({ length: 40 }, (_, s) => airHitsOf(s, C)))].sort()).toEqual([3, 4]);
    expect(airHitsOf(7, C)).toBe(airHitsOf(7, C));
  });

  it('Tier 4: opening hits, the super freeze (the cut-in and its inputs), the flurry, the heavy blow = THE impact, then K.O. and PERFECT', () => {
    const p = plan(40);
    const kinds = p.hits.map((h) => h.kind);
    expect(kinds.filter((k) => k === 'flurry')).toHaveLength(C.flurryHits);
    expect(kinds[kinds.length - 1]).toBe('heavy');
    const open = p.hits.filter((h) => h.at < p.freezeAt!);
    expect(open).toHaveLength(C.openHits);
    // NOTHING is thrown during the freeze.
    expect(p.hits.filter((h) => h.at >= p.freezeAt! && h.at < p.cutinEnd!)).toHaveLength(0);
    expect(p.flurryEnd!).toBeGreaterThan(p.cutinEnd!);
    expect(p.impactAt).toBe(p.hits[p.hits.length - 1]!.at);
    expect(p.koAt!).toBeGreaterThan(p.impactAt);
    // THE WIND-UP: a real held beat between the flurry's last hit and the heavy blow, and nothing lands in it.
    expect(p.windAt!).toBeGreaterThan(p.flurryEnd!);
    expect(p.impactAt - p.windAt!).toBeGreaterThanOrEqual(400);
    expect(p.hits.filter((h) => h.at > p.flurryEnd! && h.at < p.impactAt)).toHaveLength(0);
    // THE AFTERMATH: the striker stays for well over a second after the blow (K.O. holds, the target settles).
    expect(p.homeAt - p.impactAt).toBeGreaterThanOrEqual(1400);
    const cs = comboCues(p, C);
    const k = cs.map((q) => q.kind);
    expect(k.filter((x) => x === 'glyph')).toHaveLength(GLYPHS);
    expect(k.indexOf('super')).toBeLessThan(k.indexOf('glyph'));
    expect(k.lastIndexOf('glyph')).toBeLessThan(k.indexOf('flurry'));
    expect(k.lastIndexOf('hit')).toBeLessThan(k.indexOf('impact'));
    expect(k.indexOf('impact')).toBeLessThan(k.indexOf('ko'));
    expect(k.indexOf('ko')).toBeLessThan(k.indexOf('perfect'));
    expect(p.perfectAt!).toBeLessThan(p.homeAt);
    // THE LETTERBOX: in with the freeze, out for the flurry, in again for the wind-up and the blow, gone after K.O.
    expect(comboBars(p, p.freezeAt! - 1)).toBe(0);
    expect(comboBars(p, (p.freezeAt! + p.cutinEnd!) / 2)).toBeCloseTo(1, 5);
    expect(comboBars(p, p.impactAt)).toBeCloseTo(1, 5);
    expect(comboBars(p, p.koAt! + 900)).toBe(0);
    for (const total of [3, 8, 14]) expect(comboBars(plan(total), plan(total).impactAt)).toBe(0);
    expect(k.indexOf('wind')).toBeGreaterThan(k.indexOf('flurry'));
    expect(k.indexOf('wind')).toBeLessThan(k.indexOf('impact'));
    expect(cs.filter((q) => q.kind === 'land').map((q) => q.at - p.impactAt)).toEqual([...KO_LANDINGS]);
    for (let i = 0; i < GLYPHS; i++) { expect(glyphAt(p, C, i)).toBeGreaterThan(p.freezeAt!); expect(glyphAt(p, C, i)).toBeLessThan(p.cutinEnd! - C.cutinSlideMs); }
  });

  it('every tier: exactly one impact and one end, cues in time order; lengths in the range of a Legendary', () => {
    const len: number[] = [];
    for (const total of [3, 8, 14, 40]) {
      const p = plan(total);
      const cs = comboCues(p, C);
      expect(cs.filter((q) => q.kind === 'impact')).toHaveLength(1);
      expect(cs[cs.length - 1]!.kind).toBe('end');
      for (let i = 1; i < cs.length; i++) expect(cs[i]!.at).toBeGreaterThanOrEqual(cs[i - 1]!.at);
      len.push(p.endAt - p.chargeAt);
    }
    expect(len[0]!).toBeLessThan(1900);
    expect(len[1]!).toBeLessThan(2600);
    expect(len[2]!).toBeLessThan(4200);
    // Tier 4 is long on purpose (the wind-up and the aftermath): in the range of Soccer's top look, never past 6.2 s.
    expect(len[3]!).toBeGreaterThan(4800);
    expect(len[3]!).toBeLessThan(6200);
    for (let i = 1; i < 4; i++) expect(len[i]!).toBeGreaterThan(len[i - 1]!);
  });

  it('reduced motion: no combo, the blow lands as the formation ends', () => {
    const p = plan(40, { reduced: true });
    expect(p.reduced).toBe(true);
    expect(p.hits).toEqual([]);
    expect(comboCues(p, C).map((q) => q.kind)).toEqual(['impact', 'end']);
    expect(comboCounter(p, C, p.impactAt + 10).alpha).toBe(0);
  });
});

describe('THE COUNTER COUNTS REAL HITS', () => {
  it('hit n reads n, at every tier and on a knockout: the count never claims a hit that did not land', () => {
    for (const [total, ko] of [[1, false], [3, false], [5, false], [6, false], [11, false], [12, false], [19, false], [20, false], [47, false], [137, false], [2, true], [9, true]] as const) {
      const p = plan(total, { knockout: ko });
      expect(p.hits.map((h) => h.count)).toEqual(p.hits.map((_, i) => i + 1));
      expect(comboCounter(p, C, p.hits[0]!.at - 1).alpha).toBe(0);
      for (let t = p.hits[0]!.at; t <= p.homeAt; t += 4) {
        const landed = p.hits.filter((h) => h.at <= t).length;
        expect(comboCounter(p, C, t).value, `${total} at ${t}`).toBe(landed);
      }
      const end = comboCounter(p, C, p.impactAt + 40);
      expect(end.value, `${total}${ko ? ' knockout' : ''}`).toBe(p.hits.length);
      expect(end.final).toBe(true);
      expect(end.alpha).toBeGreaterThan(0.9);
      expect(comboCounter(p, C, p.endAt).alpha).toBe(0);
    }
  });

  it('Tier 1 is always ONE hit, whatever the blow (the counter-hit); no roll between hits', () => {
    for (const total of [1, 2, 3, 5]) expect(comboCounter(plan(total), C, plan(total).impactAt + 1)).toMatchObject({ value: 1, final: true });
    const q = plan(8);
    expect(comboCounter(q, C, q.hits[1]!.at - 1).value).toBe(1);
    expect(comboCounter(q, C, q.hits[1]!.at + 5)).toMatchObject({ value: 2, pulse: 5 });
  });
});

describe('the geometry (the ring; everything on screen; both directions)', () => {
  it('a 2D fighter: the striker stands beside the target, level with it, on the side it comes from, facing it', () => {
    const you = comboGeo(YOU, FOE, R, R, FRAME, C, { side: 'player', hits: 3, kind: 'string' });
    expect(you.face).toBe(1);
    expect(you.stance.x).toBeLessThan(you.ring.x);
    expect(you.stance.y).toBe(you.ring.y);
    const foe = comboGeo(FOE, YOU, R, R, FRAME, C, { side: 'opp', hits: 3, kind: 'string' });
    expect(foe.face).toBe(-1);
    expect(foe.stance.x).toBeGreaterThan(foe.ring.x);
    // Straight above or below: your hero takes the left, the foe the right.
    expect(comboGeo({ x: 960, y: 900 }, { x: 960, y: 300 }, R, R, FRAME, C, { side: 'player' }).face).toBe(1);
    expect(comboGeo({ x: 960, y: 300 }, { x: 960, y: 900 }, R, R, FRAME, C, { side: 'opp' }).face).toBe(-1);
  });

  it('a target in the open fights in its own slot; one tucked in a corner hops out just far enough for its tier', () => {
    const open = comboGeo({ x: 400, y: 540 }, { x: 1100, y: 600 }, R, R, FRAME, C, { side: 'player', hits: 18, kind: 'super' });
    expect(open.pull).toEqual({ x: 0, y: 0 });
    const jab = comboGeo(YOU, FOE, R, R, FRAME, C, { side: 'player', hits: 1, kind: 'counter' });
    const launcher = comboGeo(YOU, FOE, R, R, FRAME, C, { side: 'player', hits: 8, kind: 'launcher' });
    const sup = comboGeo(YOU, FOE, R, R, FRAME, C, { side: 'player', hits: 18, kind: 'super' });
    expect(Math.hypot(jab.pull.x, jab.pull.y)).toBeLessThan(R * 0.5);
    // Tier 3: headroom for the whole launch.
    expect(launcher.lift).toBeCloseTo(R * C.launchHeight, 5);
    expect(launcher.ring.y - launcher.lift - R).toBeGreaterThanOrEqual(0);
    expect(jab.lift).toBe(0);
    // Tier 4: room to be sent flying.
    expect(sup.ring.x + R * C.koLaunch + R * 0.75).toBeLessThanOrEqual(FRAME.x1 + 1e-6);
  });

  it('every tier, both directions, corners and edges: the stance, the counter, K.O. and both portraits stay on screen all the way through', () => {
    const spots: [{ x: number; y: number }, { x: number; y: number }][] = [[YOU, FOE], [FOE, YOU], [{ x: 960, y: 900 }, { x: 960, y: 200 }], [{ x: 140, y: 140 }, { x: 1780, y: 940 }], [{ x: 1780, y: 940 }, { x: 140, y: 140 }], [{ x: 300, y: 540 }, { x: 150, y: 540 }]];
    for (const [a, d] of spots) {
      for (const total of [3, 8, 14, 40]) {
        const p = plan(total);
        const g = comboGeo(a, d, R, R, FRAME, C, { side: 'player', hits: p.hits.length, kind: p.kind });
        const tag = `${JSON.stringify(a)} -> ${JSON.stringify(d)} ${p.kind}`;
        expect(onScreen(g.stance, FRAME, R), tag).toBe(true);
        expect(onScreen(g.ring, FRAME, R), tag).toBe(true);
        expect(g.counter.x - g.counterW / 2, tag).toBeGreaterThanOrEqual(0);
        expect(g.counter.x + g.counterW / 2, tag).toBeLessThanOrEqual(1920);
        expect(g.counter.y - g.counterH / 2, tag).toBeGreaterThanOrEqual(0);
        expect(g.counter.y + g.counterH / 2, tag).toBeLessThanOrEqual(1080);
        expect(g.ko.x - g.koW / 2, tag).toBeGreaterThanOrEqual(0);
        expect(g.ko.x + g.koW / 2, tag).toBeLessThanOrEqual(1920);
        // The counter is never behind K.O.
        const apart = Math.abs(g.ko.x - g.counter.x) >= (g.koW + g.counterW) / 2 || Math.abs(g.ko.y - g.counter.y) >= g.koW * 0.22 + g.counterH / 2;
        expect(apart, `${tag}: K.O. clear of the counter`).toBe(true);
        for (let t = p.chargeAt; t <= p.endAt; t += 6) {
          const s = strikerPose(p, g, C, R, a, t), f = targetPose(p, g, C, R, d, t);
          // A portrait's centre never leaves the screen (a slot that already sits near an edge is allowed its own spot).
          expect(onScreen({ x: a.x + s.x, y: a.y + s.y }, FRAME, Math.min(R * 0.5, a.x, a.y, 1920 - a.x, 1080 - a.y) - 1), `${tag} striker at ${t}`).toBe(true);
          expect(onScreen({ x: d.x + f.x, y: d.y + f.y }, FRAME, Math.min(R * 0.5, d.x, d.y, 1920 - d.x, 1080 - d.y) - 1), `${tag} target at ${t}`).toBe(true);
        }
        for (const h of p.hits) expect(onScreen(hitPoint(p, g, C, R, d, h), FRAME, 0), `${tag} hit ${h.i}`).toBe(true);
      }
    }
  });

  it('the counter is sized for the final number and sits behind the striker, clear of the target', () => {
    expect(counterSize(8, R, C).digits).toBe(1);
    expect(counterSize(40, R, C).digits).toBe(2);
    expect(counterSize(137, R, C).w).toBeGreaterThan(counterSize(40, R, C).w);
    const g = comboGeo({ x: 400, y: 540 }, { x: 1100, y: 600 }, R, R, FRAME, C, { side: 'player', hits: 18, kind: 'super' });
    expect(g.counter.x + g.counterW / 2).toBeLessThan(g.stance.x - R);
  });
});

describe('the poses (pure): both portraits', () => {
  const A = { x: 400, y: 600 }, D = { x: 1100, y: 600 };
  const setup = (total: number, air?: number) => {
    const p = plan(total, { airHits: air });
    const g = comboGeo(A, D, R, R, FRAME, C, { side: 'player', hits: p.hits.length, kind: p.kind });
    return { p, g, s: (t: number) => strikerPose(p, g, C, R, A, t), f: (t: number) => targetPose(p, g, C, R, D, t) };
  };

  it('at rest before the step in and at the end; the striker reaches its stance; deterministic', () => {
    for (const total of [3, 8, 14, 40]) {
      const { p, g, s, f } = setup(total);
      for (const t of [0, p.stepAt - 1, p.endAt, p.endAt + 500]) {
        expect(s(t)).toEqual({ x: 0, y: 0, rot: 0, scale: 1, squash: 0, skew: 0 });
        expect(f(t)).toEqual({ x: 0, y: 0, rot: 0, scale: 1, squash: 0, skew: 0 });
      }
      const at = s(p.stepEnd + 1);
      expect(Math.abs(A.x + at.x - g.stance.x)).toBeLessThan(R * 0.2);
      expect(s(p.hits[0]!.at + 30)).toEqual(s(p.hits[0]!.at + 30));
      // Both are (all but) home again by the end.
      expect(Math.hypot(s(p.homeEnd).x, s(p.homeEnd).y)).toBeLessThan(1);
      expect(Math.hypot(f(p.endAt - 1).x, f(p.endAt - 1).y)).toBeLessThan(3);
    }
  });

  it('THE HIT-FREEZE is a held pose (visuals only): both portraits stand still for it on a hit, then recover', () => {
    const { p, s, f } = setup(8);
    const h = p.hits[0]!.at;
    expect(s(h + 2)).toEqual(s(h + C.hitFreezeMs - 2));
    const a = f(h + 2), b = f(h + C.hitFreezeMs - 2);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1.5);
    expect(Math.abs(s(h + C.hitFreezeMs + 80).x - s(h + 2).x)).toBeGreaterThan(5);
    // The striker lunges INTO the target on the hit, the target is knocked AWAY, smeared along the hit, then not.
    expect(s(h + 2).x).toBeGreaterThan(s(h - 90).x);
    expect(f(h + 2).x).toBeGreaterThan(0);
    expect(f(h + 2).skew).toBeGreaterThan(C.skew * 0.3);
    expect(f(h + C.hitFreezeMs + 95).skew).toBe(0);
  });

  it('Tier 1: the target lunges AT the striker, is thrown back on the parry (smeared), and the counter knocks it away', () => {
    const { p, g, s, f } = setup(3);
    expect(f(p.parryAt! - 2).x).toBeLessThan(f(p.feintAt!).x - R * 0.2); // the lunge, toward the striker (left)
    expect(f(p.parryAt! + 2).skew).toBeLessThan(0);
    expect(f(p.impactAt - 5).x).toBeGreaterThan(f(p.parryAt! - 2).x + R * 0.2); // staggered back
    expect(s(p.parryAt! + 20).rot).toBeLessThan(0); // the guard
    expect(s(p.impactAt + 2).x).toBeGreaterThan(s(p.parryAt! + 20).x + R * 0.3); // the counter lunge
    expect(f(p.impactAt + 2).skew).toBeGreaterThan(0);
    const pp = parryPoint(p, g, C, R, D);
    expect(pp.x).toBeGreaterThan(A.x + s(p.parryAt!).x);
    expect(pp.x).toBeLessThan(D.x + f(p.parryAt! - 1).x);
  });

  it('Tier 2: the jabs land high, the cross lower, the roundhouse high again and leans the striker back; then it reels, dizzy', () => {
    const { p, g, f } = setup(8);
    const ys = p.hits.map((h) => hitPoint(p, g, C, R, D, h).y);
    expect(ys[0]!).toBeLessThan(ys[2]!);
    expect(ys[3]!).toBeLessThan(ys[2]!);
    expect(strikerPose(p, g, C, R, A, p.hits[3]!.at + 2).rot).toBeLessThan(0);
    const rots = [0, 150, 300, 450].map((d) => f(p.dizzyAt! + 250 + d).rot);
    expect(Math.max(...rots) - Math.min(...rots)).toBeGreaterThan(5);
    expect(comboDizzy(p, p.dizzyAt! - 1).age).toBeLessThan(0);
    expect(comboDizzy(p, p.dizzyAt! + 300).alpha).toBeGreaterThan(0.9);
    expect(comboDizzy(p, p.dizzyEnd! + 300).alpha).toBe(0);
  });

  it('Tier 3: the uppercut launches the target, the striker jumps after it, each air hit bobs it up, it struggles, the spike drives it home', () => {
    const { p, g, s, f } = setup(14, 4);
    const air = p.hits.filter((h) => h.kind === 'air');
    expect(f(p.launchAt! - 5).y).toBeGreaterThan(-R * 0.3);
    expect(f(air[0]!.at).y).toBeLessThan(-g.lift * 0.7); // airborne
    expect(s(air[0]!.at).y).toBeLessThan(-g.lift * 0.6); // the striker is up there with it
    for (let i = 0; i < air.length - 1; i++) {
      const mid = (air[i]!.at + air[i + 1]!.at) / 2 + C.hitFreezeMs / 2;
      expect(f(mid).y, `air hit ${i} bobs it up`).toBeLessThan(f(air[i]!.at - 1).y - g.lift * 0.05);
    }
    // THE STRUGGLE: it wriggles (its rotation swings both ways) while still up in the air.
    const wr = [0, 40, 80, 120, 160, 200].map((d) => f(p.breakAt! + 120 + d).rot);
    expect(Math.max(...wr) - Math.min(...wr)).toBeGreaterThan(8);
    expect(f(p.breakAt! + 200).y).toBeLessThan(-g.lift * 0.6);
    expect(f(p.spikeAt! + C.hitFreezeMs + (p.slamAt! - p.spikeAt! - C.hitFreezeMs) * 0.5).y).toBeGreaterThan(f(p.spikeAt!).y);
    expect(Math.abs(f(p.slamAt!).y)).toBeLessThan(2); // in its socket on the impact
    expect(f(p.slamAt! + 30).squash).toBeGreaterThan(0.15);
    // Never higher than the launch.
    for (let t = p.launchAt!; t < p.slamAt!; t += 5) expect(f(t).y).toBeGreaterThan(-g.lift - R * 0.2);
  });

  it('Tier 4: nobody moves through the super freeze; the heavy blow sends the target flying, spinning, and it comes home', () => {
    const { p, g, s, f } = setup(40);
    const a = p.freezeAt! + 200, b = p.cutinEnd! - 60;
    expect(s(a)).toEqual(s(b));
    expect(Math.hypot(f(a).x - f(b).x, f(a).y - f(b).y)).toBeLessThan(1.5); // only the last flinch dying away
    expect(s(p.impactAt - 120).x).toBeLessThan(s(a).x); // the wind-up pulls back
    expect(s(p.impactAt + 2).x).toBeGreaterThan(s(a).x + R * 0.3); // the heavy lunge
    // THE WIND-UP: the striker swells as it rears back.
    expect(s(p.impactAt - 60).scale).toBeGreaterThan(s(p.windAt! - 1).scale + 0.08);
    const out = f(p.impactAt + 240);
    expect(out.x).toBeCloseTo(g.launch.x, 0);
    expect(Math.abs(out.rot)).toBeGreaterThan(180);
    // THE AFTERMATH: it bounces off its landing, then SETTLES there (still, upright-turned) until the striker heads home.
    expect(f(p.impactAt + 150 + 130).y).toBeLessThan(f(p.impactAt + 150).y - R * 0.1);
    const rest = f(p.homeAt - 40), rest2 = f(p.homeAt - 10);
    expect(Math.hypot(rest.x - rest2.x, rest.y - rest2.y)).toBeLessThan(0.5);
    expect(rest.x).toBeCloseTo(g.launch.x, 0);
    expect(Math.abs(f(p.homeEnd).x)).toBeLessThan(1);
    expect(f(p.homeEnd).rot).toBeCloseTo(0, 5);
  });

  it('the cut-in: dim, the band slides in, holds, slides out; the inputs light one by one; none outside the freeze', () => {
    const p = plan(40);
    expect(comboCutin(p, C, p.freezeAt! - 1)).toBeNull();
    expect(comboCutin(p, C, p.cutinEnd!)).toBeNull();
    expect(comboCutin(plan(14), C, plan(14).impactAt)).toBeNull();
    expect(comboCutin(p, C, p.freezeAt!)!.slide).toBe(-1);
    const hold = comboCutin(p, C, (p.freezeAt! + p.cutinEnd!) / 2)!;
    expect(hold.slide).toBe(0);
    expect(hold.dim).toBeCloseTo(C.cutinDim, 5);
    expect(comboCutin(p, C, p.cutinEnd! - 5)!.slide).toBeGreaterThan(0.8);
    expect(comboCutin(p, C, p.cutinEnd! - 5)!.dim).toBeLessThan(0.05);
    expect(comboCutin(p, C, glyphAt(p, C, 0) - 5)!.glyphAge).toBeLessThan(0);
    expect(comboCutin(p, C, glyphAt(p, C, 2) + 1)!.glyphAge).toBeGreaterThan(0);
  });

  it('the camera: at rest before and long after; it pushes in for the fight and shakes on the impact, within the cap', () => {
    for (const total of [3, 8, 14, 40]) {
      const p = plan(total);
      expect(comboCameraAt(p, C, p.stepAt - 1, 1)).toEqual({ zoom: 1, x: 0, y: 0 });
      expect(comboCameraAt(p, C, p.impactAt - 1, 1).zoom).toBeGreaterThan(1 + p.zoom * 0.95);
      // Tier 3: the view rises with the launch.
      if (p.kind === 'launcher') expect(comboCameraAt(p, C, p.hits[3]!.at - 20, 1, 200).y).toBeGreaterThan(comboCameraAt(p, C, p.hits[3]!.at - 20, 1, 0).y + 60);
      let peak = 0;
      for (let t = p.chargeAt; t < p.endAt; t += 3) { const c = comboCameraAt(p, C, t, 1); peak = Math.max(peak, Math.hypot(c.x, c.y)); }
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(COMBO_CAPS.shakePx * 1.5);
    }
  });
});

function manualFrames() {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn: (dt: number) => void) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms: number, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function tickTo(r: { h: { elapsed(): number; done: boolean }; f: { tick: (ms: number, step?: number) => void } }, t: number, step = 4): void {
  for (let i = 0; i < 20000 && !r.h.done && r.h.elapsed() < t; i++) r.f.tick(step, step);
}

function run(over: Partial<HeroComboOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  attackerEl.style.transform = 'translateX(3px)';
  defenderEl.style.zIndex = '3';
  attackerEl.style.opacity = '0.95';
  attackerEl.style.filter = 'saturate(1.1)';
  defenderEl.style.transform = 'translateY(2px)';
  defenderEl.style.opacity = '0.9';
  camera.append(attackerEl, defenderEl);
  document.body.append(host, camera);
  const h = playHeroCombo({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: YOU, defender: FOE, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl };
}

/** Both portraits and the page are back EXACTLY as they were, and nothing of the attack is left drawing. */
function expectRestored(r: ReturnType<typeof run>, zClass = 'duel-attacker-player'): void {
  expect(r.attackerEl.style.transform).toBe('translateX(3px)');
  expect(r.attackerEl.style.opacity).toBe('0.95');
  expect(r.attackerEl.style.filter).toBe('saturate(1.1)');
  expect(r.defenderEl.style.transform).toBe('translateY(2px)');
  expect(r.defenderEl.style.opacity).toBe('0.9');
  expect(r.camera.style.transform).toBe('');
  expect(document.body.classList.contains(zClass)).toBe(false);
  // Every lifted z-index is back to its own inline value (an empty one stays empty).
  expect(r.attackerEl.style.zIndex).toBe('');
  expect(r.defenderEl.style.zIndex).toBe('3');
  expect(r.camera.style.zIndex).toBe('');
  expect(r.host.querySelector('.hblast')).toBeNull();
  expect(r.h.scene?.ownVisible ?? false).toBe(false);
  expect(r.h.scene?.counterValue ?? -1).toBe(-1);
}

describe('the runner (the shared clock, both portraits restored on every exit)', () => {
  afterEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  it('Tier 4: no opening hit, no flurry hit and not the freeze lands it; the blow lands ONCE on the heavy blow; the counter reads the hits; all put back EXACTLY', () => {
    const r = run({ total: 37, formation: formationOf([37], 37) });
    const { h, onImpact, onDone } = r;
    const p = h.plan;
    expect(r.host.querySelector('.hblast.hcombo')).not.toBeNull();
    tickTo(r, p.hits[0]!.at + 20);
    expect(onImpact).not.toHaveBeenCalled();
    expect(r.attackerEl.style.transform).toContain('translate('); // the striker has stepped in
    expect(r.defenderEl.style.transform).toContain('translate('); // the target is out in the ring, flinching
    expect(document.body.classList.contains('duel-attacker-player')).toBe(true);
    // ON TOP OF ALL THE UI: both portraits' whole chains lifted, the striker over the target.
    expect(r.attackerEl.style.zIndex).toBe(String(COMBO_Z.striker));
    expect(r.defenderEl.style.zIndex).toBe(String(COMBO_Z.target));
    expect(r.camera.style.zIndex).toBe(String(COMBO_Z.target)); // the shared parent keeps the first lift
    expect(h.scene!.counterValue).toBeGreaterThanOrEqual(1);
    tickTo(r, (p.freezeAt! + p.cutinEnd!) / 2);
    expect(onImpact).not.toHaveBeenCalled();
    expect(h.scene!.ownVisible).toBe(true); // the cut-in is up
    tickTo(r, p.flurryEnd! + 20);
    expect(onImpact).not.toHaveBeenCalled(); // every flurry hit is a tick
    expect(h.scene!.counterValue).toBe(p.hits.length - 1);
    tickTo(r, p.impactAt - 8);
    expect(onImpact).not.toHaveBeenCalled();
    tickTo(r, p.impactAt + 8);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(r.host.querySelector('.hblast-hit')!.textContent).toBe('-37');
    tickTo(r, p.impactAt + 30);
    expect(h.scene!.counterValue).toBe(p.hits.length); // the hits that landed (the damage is the game's own -37)
    tickTo(r, p.koAt! + 60);
    expect(h.scene!.callouts).toContain('ko');
    tickTo(r, p.perfectAt! + 60);
    expect(h.scene!.callouts).toContain('perfect');
    expect(h.counter(h.elapsed())).toMatchObject({ value: p.hits.length, final: true });
    tickTo(r, p.endAt + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expectRestored(r);
    r.f.tick(4000, 16);
    expect(r.f.hooked()).toBe(0);
    expect(r.root.children).toHaveLength(0);
  });

  it('Tier 3: the juggle and the struggle never land it; it lands ONCE on the slam; Tier 1 and Tier 2 land on their last hit', () => {
    const r = run({ total: 14, formation: formationOf([14], 14) });
    tickTo(r, r.h.plan.breakAt! + 100);
    expect(r.h.scene!.callouts).toContain('breaker');
    tickTo(r, r.h.plan.spikeAt! + 20);
    expect(r.onImpact).not.toHaveBeenCalled();
    tickTo(r, r.h.plan.slamAt! + 12);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    tickTo(r, r.h.plan.spikeAt! + 160);
    expect(r.h.scene!.callouts).not.toContain('breaker'); // smashed by the spike
    expect(r.h.scene!.counterValue).toBe(r.h.plan.hits.length);
    tickTo(r, r.h.plan.endAt + 32, 8);
    expectRestored(r);
    document.body.innerHTML = '';
    for (const total of [3, 8]) {
      const q = run({ total, formation: formationOf([total], total) });
      tickTo(q, q.h.plan.impactAt - 8);
      expect(q.onImpact).not.toHaveBeenCalled(); // not the parry either
      tickTo(q, q.h.plan.impactAt + 30);
      expect(q.onImpact).toHaveBeenCalledTimes(1);
      expect(q.h.scene!.counterValue).toBe(total === 3 ? 1 : 4);
      if (total === 3) expect(q.h.scene!.callouts).toContain('counter');
      tickTo(q, q.h.plan.endAt + 32, 8);
      expect(q.onImpact).toHaveBeenCalledTimes(1);
      expectRestored(q);
      document.body.innerHTML = '';
    }
  });

  it('cancel() mid-juggle, finish() mid-cut-in and the safety timer each put both portraits back exactly (cancel never lands)', () => {
    const a = run({ total: 14, formation: formationOf([14], 14) });
    tickTo(a, a.h.plan.jumpAt! + 260);
    expect(a.defenderEl.style.transform).not.toBe('translateY(2px)');
    a.h.cancel();
    expect(a.onImpact).not.toHaveBeenCalled();
    expectRestored(a);
    expect(a.f.hooked()).toBe(0);
    document.body.innerHTML = '';

    const b = run({ total: 40, formation: formationOf([40], 40), side: 'opp', attacker: FOE, defender: YOU });
    tickTo(b, b.h.plan.freezeAt! + 300);
    expect(b.h.scene!.ownVisible).toBe(true);
    b.h.finish();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    expect(b.onDone).toHaveBeenCalledTimes(1);
    expectRestored(b, 'duel-attacker-opp');
    document.body.innerHTML = '';

    vi.useFakeTimers();
    try {
      const c = run({ total: 40, formation: formationOf([40], 40), safety: true });
      tickTo(c, c.h.plan.cutinEnd! + 200);
      vi.advanceTimersByTime(c.h.plan.endAt + 3000);
      expect(c.onImpact).toHaveBeenCalledTimes(1);
      expect(c.h.done).toBe(true);
      expectRestored(c);
    } finally { vi.useRealTimers(); }
  });

  it('an unmount mid-attack (Recruit cancels the handle) leaves no transform, no class and nothing drawn, at every tier and many moments', () => {
    for (const total of [3, 8, 14, 40]) {
      for (const at of [0.15, 0.4, 0.65, 0.9]) {
        const r = run({ total, formation: formationOf([total], total) });
        tickTo(r, r.h.plan.chargeAt + (r.h.plan.endAt - r.h.plan.chargeAt) * at);
        r.h.cancel();
        expectRestored(r);
        expect(r.f.hooked()).toBe(0);
        expect(r.root.children, `${total} at ${at}`).toHaveLength(0);
        document.body.innerHTML = '';
      }
    }
  });

  it('both directions at every tier, within the cap, the blow once; the camera applied once; a replay is identical; reduced motion', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40]) {
        const r = run({ side, attacker: side === 'player' ? YOU : FOE, defender: side === 'player' ? FOE : YOU, total, formation: formationOf([total], total) });
        let peak = 0;
        for (let i = 0; i < 3000 && !r.h.done; i++) { r.f.tick(16, 16); peak = Math.max(peak, r.h.scene!.liveSprites); }
        expect(r.onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_COMBO_SPRITES);
        expect(peak, `${side} ${total}: well under the cap`).toBeLessThan(200);
        expectRestored(r, side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player');
        r.h.cancel();
        document.body.innerHTML = '';
      }
    }
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const c = run({ camera, total: 40, formation: formationOf([40], 40) });
    tickTo(c, c.h.plan.impactAt + 20);
    expect(c.h.mirrorsCamera).toBe(false);
    expect((c.root.children[0] as Container).scale.x).toBe(1);
    c.h.cancel();
    // DETERMINISM: the same seed plays the same combo; III's air hits come from it.
    const x = run({ total: 14, formation: formationOf([14], 14), rollSeed: 5 });
    const y = run({ total: 14, formation: formationOf([14], 14), rollSeed: 5 });
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.geo).toEqual(y.h.geo);
    expect(x.h.striker(x.h.plan.spikeAt!)).toEqual(y.h.striker(y.h.plan.spikeAt!));
    expect(x.h.plan.hits.filter((q) => q.kind === 'air')).toHaveLength(airHitsOf(5, C));
    x.h.cancel(); y.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    expect(r.attackerEl.style.transform).toBe('translateX(3px)');
    expect(r.defenderEl.style.transform).toBe('translateY(2px)');
  });

  it('the clock never stops: through the hit-freeze and the super freeze it advances exactly with real time', () => {
    const r = run({ total: 40, formation: formationOf([40], 40) });
    tickTo(r, r.h.plan.freezeAt! + 100);
    const t0 = r.h.elapsed();
    r.f.tick(200, 4);
    expect(r.h.elapsed() - t0).toBeCloseTo(200, 5);
    r.h.cancel();
  });
});

describe('the scene (headless Pixi)', () => {
  const look = { sparkSize: 1, face: 1 as const, counter: { x: 300, y: 300 }, digit: 100, digits: 2, band: { x: 960, y: 540, w: 2400, h: 290, rot: -0.14 }, frameW: 1920, frameH: 1080, barsH: 0.08 };
  const colors = { tier: 0xffb01f, flash: 0xfff4dc, dust: 0xe9dfc8, side: 0xffcf5a };

  it('the counter is composed from pooled digit sprites: the number, HIT or HITS, hidden at 0 alpha; the cut-in shows and hides', () => {
    const scene = new HeroComboScene(TEX, colors, look, R, R, 1, 9, W);
    expect(scene.ownVisible).toBe(false);
    scene.setCounter({ value: 1, pulse: 0, final: false, alpha: 1 });
    expect(scene.counterValue).toBe(1);
    expect(scene.ownVisible).toBe(true);
    scene.setCounter({ value: 37, pulse: 40, final: true, alpha: 1 });
    expect(scene.counterValue).toBe(37);
    scene.setCounter({ value: 37, pulse: 40, final: true, alpha: 0 });
    expect(scene.counterValue).toBe(-1);
    expect(scene.ownVisible).toBe(false);
    scene.setCutin({ dim: 0.5, slide: 0, glyphAge: 400, age: 300 });
    expect(scene.ownVisible).toBe(true);
    scene.setCutin(null);
    expect(scene.ownVisible).toBe(false);
    // The letterbox, the birds and a call-out each show, and each hides.
    scene.setBars(1); expect(scene.ownVisible).toBe(true); scene.setBars(0); expect(scene.ownVisible).toBe(false);
    scene.setDizzy({ x: 900, y: 500 }, 200, 1); expect(scene.ownVisible).toBe(true); scene.setDizzy({ x: 900, y: 500 }, -1, 0); expect(scene.ownVisible).toBe(false);
    scene.callout('breaker', { x: 900, y: 300 }, 400, 300);
    expect(scene.callouts).toEqual(['breaker']);
    scene.smash('breaker');
    for (let i = 0; i < 20; i++) scene.update(16);
    expect(scene.callouts).toEqual([]);
    scene.callout('counter', { x: 900, y: 300 }, 400, 200);
    for (let i = 0; i < 40; i++) scene.update(16);
    expect(scene.callouts).toEqual([]);
    expect(scene.ownVisible).toBe(false);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });

  it('pools, stays under the cap, hides its own objects, drains, and destroy leaves nothing', () => {
    const scene = new HeroComboScene(TEX, colors, look, R, R, 1, 9);
    const D = { x: 1100, y: 600 };
    scene.setCounter({ value: 12, pulse: 0, final: false, alpha: 1 });
    scene.setCutin({ dim: 0.5, slide: -0.4, glyphAge: 100, age: 100 });
    for (let i = 0; i < 6; i++) {
      for (const k of ['jab', 'cross', 'kick', 'counter', 'upper', 'air', 'spike', 'flurry', 'heavy'] as const) scene.hitFx(D, k, 1);
      scene.parry(D); scene.trail({ x: 800, y: 700 }, D, 0.5, 60); scene.impactFrame(D); scene.callout('perfect', D, 400, 300);
      scene.setDizzy(D, 100 + i * 60, 1); scene.setBars(0.5);
      scene.drive(D); scene.drive(D, true); scene.gather(D, 560); scene.screenFlash(0.5); scene.aftermath(D); scene.stepDust(D, 1); scene.launch(D); scene.slam(D, 2, 8); scene.finisher(D, 2, 8); scene.superFlash(D);
      for (let j = 0; j < 12; j++) scene.bandLine();
      scene.heavy(D, 2, 8); scene.ko(D, 600);
    }
    expect(scene.liveSprites).toBeLessThanOrEqual(MAX_COMBO_SPRITES);
    scene.hideOwn();
    expect(scene.ownVisible).toBe(false);
    let alive = true;
    for (let i = 0; i < 400 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    expect(scene.liveSprites).toBe(0);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
    scene.setCounter({ value: 3, pulse: 0, final: false, alpha: 1 }); // after destroy: a no-op
    scene.setCutin(null);
  });
});
