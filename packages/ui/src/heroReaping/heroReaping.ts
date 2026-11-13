/**
 * THE REAPING RUNNER (the Ancient of Death's hero attack, an ANCIENT): plays one Reaping (the beats are in
 * `heroReapingConfig.ts`) and lands the consequence on its impact beat (the blade crossing the middle of the struck
 * portrait). Presentation only: the total and the blow are the engine's; this file only decides WHEN on screen they
 * happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), as every style does: one clock (it never pauses or slows),
 * the damage formation, the `#stage` camera (applied ONCE: `stageCamera.ts`), the portraits (transform only, restored
 * after), the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THREE LAYERS, bottom to top: the game; the DRAIN panes (`heroReapingDrain.ts`: DOM, `backdrop-filter: grayscale`, so
 * whatever is under them loses its colour); the Pixi SCENE (`heroReapingScene.ts`: the blades, the great crescent and
 * its afterimages, the rings, the line and the motes, which keep their colour over the grey). Layout is read ONCE, at the start, by the caller (the
 * two portrait rects); this file reads none.
 *
 * THE PORTRAITS: the striker swells a breath through the ready and pulses as the colour reaches it (and on IV's toll);
 * the struck portrait takes a knock along the cut (a short one on I-II, a hard one on III-IV: it REELS) and then SAGS
 * while it is grey, easing back as its colour returns. No z-order class is touched.
 *
 * THE SOUND. Cold, but never thin (the owner heard the first pass as silent): every blade is three layers placed so
 * their bodies land on the crossing (the airy sweep, the low slash under it, a ring of steel over it); every blow has
 * a low body (the cleave, and on III-IV a boom); the colour leaving is a hollow rush of air. IV: the other buses are
 * hushed as the screen drains, a real beat of silence, then ONE bell (layered an octave down over a boom) breaks it;
 * the sweep; the cut lands with the deepest hit of the attack; the buses come back as the colour floods back.
 *
 * EVERY EXIT (the end, `finish()`, `cancel()`, the safety timer; an unmount cancels) removes every drain pane, puts
 * both portraits' transforms back exactly, resets the camera, restores the hushed buses and hides the scene.
 *
 * THE CONTRACT: II's first cut is a tick (FX and sound only). The consequence (`onImpact`) lands exactly ONCE.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale, toStage } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  drainAt, emptyDrain, foeMoveAt, getHeroReapingConfig, reapingCameraAt, reapingCameraFocus, reapingCues, reapingGeo, reapingPlan,
  type HeroReapingConfig, type ReapingCue, type ReapingGeo, type ReapingPlan,
} from './heroReapingConfig';
import { ReapingDrain } from './heroReapingDrain';
import { HeroReapingScene, type HeroReapingTextures } from './heroReapingScene';
import { heroReapingTextures } from './heroReapingTextures';

export interface HeroReapingOptions extends HeroAttackOptions {
  cfg?: HeroReapingConfig;
  textures?: HeroReapingTextures | null;
}

export interface HeroReapingHandle extends HeroAttackHandle {
  readonly plan: ReapingPlan;
  /** Every blade's path (empty under reduced motion). */
  readonly geo: ReapingGeo;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroReapingScene | null;
  /** The colour-drain panes (no panes under reduced motion). */
  readonly drain: ReapingDrain;
  /** Whether the camera is mirrored onto the Pixi root (false when the canvas already rides the camera). */
  readonly mirrorsCamera: boolean;
}

/** The seed a fight's cut and motes are rolled from: the same fight reaps the same way. */
export function reapingSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, roll = 0): number {
  return (Math.round(total) * 4513 + Math.round(distance) * 41 + (side === 'opp' ? 223 : 19) + (roll >>> 0) * 7919) >>> 0;
}

/** Where each blade layer's body sits (ms into its clip): a cue is placed so the bodies land together on the crossing. */
export const SWEEP_BODY_MS = 420;
export const SLASH_BODY_MS = 75;
export const METAL_BODY_MS = 225;

/** Play The Reaping. Returns a handle; the blow lands via `onImpact` on the impact. */
export function playHeroReaping(o: HeroReapingOptions): HeroReapingHandle {
  const c = o.cfg ?? getHeroReapingConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = reapingPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, reapingCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hreaping',
  });

  // The screen (or the sandbox box) the line crosses and the veil covers: its size, read once.
  const bounds = { w: 1920, h: 1080 };
  try {
    if (local && host) { bounds.w = host.clientWidth || bounds.w; bounds.h = host.clientHeight || bounds.h; }
    else if (typeof window !== 'undefined' && window.innerWidth > 0) { bounds.w = window.innerWidth; bounds.h = window.innerHeight; }
  } catch { /* keep the design size */ }
  const seed = reapingSeed(o.total, dist, o.side, o.rollSeed);
  const geo = reapingGeo(plan, o.attacker, o.defender, aRadius, radius, c, bounds, (seed & 1) === 1);
  const u = geo.u;
  const cutDir = geo.cuts[geo.cuts.length - 1]?.dir ?? u;

  const textures = o.textures !== undefined ? o.textures : heroReapingTextures();
  const scene = textures && !reduced
    ? new HeroReapingScene(textures, {
      teal: hexToNum(c.colorTeal), bone: hexToNum(c.colorBone), shade: hexToNum(c.colorShade),
      motes: [hexToNum(c.colorMoteA), hexToNum(c.colorMoteB), hexToNum(c.colorMoteC)], side: hexToNum(sideHex),
    }, { bladeSize: c.bladeSize, moteMs: c.moteMs, moteSize: c.moteSize, stripWidth: c.stripWidth }, plan, geo,
    { x: o.defender.x, y: o.defender.y, r: radius }, { x: o.attacker.x, y: o.attacker.y, r: aRadius }, s, seed)
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // The drain panes: in `#stage` (they ride the camera with the portraits, under the FX canvas), or the sandbox box.
  const paneParent = reduced || !doc ? null : (local ? host : (doc.getElementById('stage') ?? host));
  const drain = new ReapingDrain(paneParent && doc ? {
    doc, parent: paneParent, local, css: local ? (v: number) => v : toStage, kind: plan.kind, d: o.defender, r: radius,
    angles: plan.kind === 'cut' || plan.kind === 'cross' ? geo.cuts.map((q) => q.angle) : [], strike: Math.atan2(u.y, u.x),
    stripWidth: c.stripWidth, grey: c.grey, bounds,
  } : null);
  const dstate = emptyDrain();

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxBellClip, c.sfxSweepClip, c.sfxBreathClip, c.sfxThumpClip, c.sfxSlashClip, c.sfxMetalClip, c.sfxCleaveClip, c.sfxDrainClip, c.sfxBoomClip]);
  const real = (ms: number): number => ms / speed;
  const unit = local ? 1 : s;
  const px = local ? 0.45 : 1;
  const big = plan.kind === 'reaping';
  const fall = plan.kind === 'fall';
  /** III-IV: the struck portrait REELS (I-II keep the short knock the owner approved). */
  const reel = big ? 8 : fall ? 6 : 1;
  let hushed = false;
  /** When the colour last reached the striker (it pulses). */
  let fedAt = Number.POSITIVE_INFINITY;
  /** IV: when the bell tolled (the striker jolts with it). */
  let tolledAt = Number.POSITIVE_INFINITY;

  /** One clip placed so the part of it `bodyMs` in lands `inMs` (attack ms) from now: delayed, or started part way in. */
  const land = (clip: string, gain: number, rate: number, inMs: number, bodyMs: number): void => {
    const wait = real(inMs) - bodyMs / rate; // real ms until the clip must start
    cue(clip, gain, rate, wait >= 0 ? { delayMs: wait } : { startMs: Math.min(Math.max(0, bodyMs - 40), -wait * rate) });
  };
  /** A BLADE through the air, its body on the crossing `inMs` from now: the airy sweep, the low slash, a ring of steel. */
  const bladeSound = (weight: number, rate: number, inMs: number): void => {
    land(c.sfxSweepClip, c.sfxSweepGain * weight, c.sfxSweepRate * rate, inMs, SWEEP_BODY_MS);
    land(c.sfxSlashClip, c.sfxSlashGain * weight, c.sfxSlashRate * rate, inMs, SLASH_BODY_MS);
    land(c.sfxMetalClip, c.sfxMetalGain * weight, c.sfxMetalRate * rate * 1.1, inMs, METAL_BODY_MS);
  };
  /** The colour leaving: the hollow rush of air (a window of it on the small looks, all of it on the big ones). */
  const leave = (gain: number, rate: number, lenMs?: number): void => {
    cue(c.sfxDrainClip, c.sfxDrainGain * gain, c.sfxDrainRate * rate, lenMs ? { startMs: 300, lenMs, fadeMs: Math.min(300, lenMs * 0.4) } : { fadeMs: 300 });
  };

  const fire = (q: ReapingCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (!big && c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'wind':
        // III: the crescent ignites and is drawn back: the rush of air SWELLS (the clip's own rise) and is cut off as it
        // falls.
        scene?.ignite();
        cue(c.sfxDrainClip, c.sfxDrainGain * 1.1, c.sfxDrainRate * 1.1, { lenMs: Math.max(300, real(plan.launchAt - t) * 1.1), fadeMs: 90 });
        cue(c.sfxMetalClip, c.sfxMetalGain * 0.7, c.sfxMetalRate * 0.7, { fadeMs: 200 });
        break;
      case 'drain':
        // IV: the colour goes out of the world: a long hollow exhale that ENDS as the silence starts, and every other
        // bus is hushed under it.
        cue(c.sfxDrainClip, c.sfxDrainGain * 1.2, c.sfxDrainRate * 0.8, { startMs: 280, lenMs: Math.max(200, real((plan.drainedAt ?? t) - t) * 0.8 + 100), fadeMs: 260 });
        cue(c.sfxBreathClip, c.sfxBreathGain, c.sfxBreathRate * 0.7, { lenMs: Math.max(200, real((plan.drainedAt ?? t) - t)), fadeMs: 200 });
        if (c.sfxHush < 1) { voices.duck(c.sfxHush); hushed = true; }
        break;
      case 'hush':
        // IV: silence. Nothing plays until the toll.
        break;
      case 'toll':
        // IV: ONE bell breaks the silence, its whole tail: the bell, the same bell an octave down, and a low boom under
        // the strike. The crescent ignites on it.
        cue(c.sfxBellClip, c.sfxBellGain * 1.3, c.sfxBellRate, { tail: 0.2 });
        cue(c.sfxBellClip, c.sfxBellGain, c.sfxBellRate * 0.5, { tail: 0.2 });
        cue(c.sfxBoomClip, c.sfxBoomGain * 1.7, c.sfxBoomRate * 0.8, { lenMs: 1200, fadeMs: 600 });
        scene?.toll();
        scene?.ignite();
        tolledAt = t;
        break;
      case 'held':
        // III-IV: fully lit: a glint on the point, a short ring of steel.
        scene?.held();
        cue(c.sfxMetalClip, c.sfxMetalGain * 0.6, c.sfxMetalRate * 1.7, { startMs: 120, lenMs: 420, fadeMs: 240 });
        break;
      case 'sweep': {
        const cut = plan.cuts[q.i]!;
        if (big) bladeSound(1.3, 0.78, cut.crossAt - t);
        else if (fall) bladeSound(1.15, 0.9, cut.crossAt - t);
        else bladeSound(1.25 + 0.15 * q.i, 1.22 - 0.14 * q.i, cut.crossAt - t);
        break;
      }
      case 'cross':
        // II's first cut: a tick. A strip of colour goes, and a few motes with it.
        scene?.cross(q.i, 0.7);
        scene?.stream(Math.round(plan.motes * 0.35), 160, q.i);
        cue(c.sfxCleaveClip, c.sfxCleaveGain * 0.75, c.sfxCleaveRate * 1.3, { fadeMs: 160 });
        leave(0.5, 1.3, 450);
        break;
      case 'impact': {
        if (!plan.reduced) {
          const last = plan.cuts.length - 1;
          const cd = geo.cuts[last]?.dir ?? u;
          cue(c.sfxThumpClip, c.sfxThumpGain * (0.8 + 0.25 * plan.tier), c.sfxThumpRate - 0.04 * (plan.tier - 1), { lenMs: 420, fadeMs: 180 });
          if (plan.kind === 'cut') {
            scene?.cross(last, 1);
            scene?.stream(plan.motes, 180, 0);
            cue(c.sfxCleaveClip, c.sfxCleaveGain * 1.05, c.sfxCleaveRate * 1.2, { fadeMs: 180 });
            leave(0.7, 1.2, 600);
          } else if (plan.kind === 'cross') {
            scene?.cross(last, 1);
            scene?.stream(plan.motes - Math.round(plan.motes * 0.35), 260, null);
            cue(c.sfxCleaveClip, c.sfxCleaveGain * 1.05, c.sfxCleaveRate * 1.08, { fadeMs: 200 });
            leave(0.8, 1.08, 800);
          } else if (fall) {
            // THE FALL lands: the cleave over a boom, a low bell (and the same bell an octave under it), and the rush
            // of the colour torn out.
            scene?.strike(1);
            scene?.stream(plan.motes, 380, null, 1.7, { x: cd.x * radius * 2.4, y: cd.y * radius * 2.4 });
            cue(c.sfxCleaveClip, c.sfxCleaveGain * 1.1, c.sfxCleaveRate * 0.9);
            cue(c.sfxBoomClip, c.sfxBoomGain * 0.8, c.sfxBoomRate * 0.9, { lenMs: 1000, fadeMs: 500 });
            cue(c.sfxBellClip, c.sfxBellGain * 0.65, c.sfxBellRate * 0.84, { lenMs: 2400, fadeMs: 1000, tail: 0.15 });
            cue(c.sfxBellClip, c.sfxBellGain * 0.5, c.sfxBellRate * 0.42, { lenMs: 2200, fadeMs: 1000 });
            cue(c.sfxDrainClip, c.sfxDrainGain * 0.9, c.sfxDrainRate * 0.95, { delayMs: real(60), fadeMs: 300 });
          } else {
            // IV, THE CUT: the deepest hit of the attack (the cleave and the boom, pitched down, and the bell's low
            // octave struck again under them), then the portrait's colour is drawn out in a long thick stream, all the
            // way to the flood.
            scene?.strike(1.5);
            scene?.stream(plan.motes, Math.max(120, (plan.floodAt ?? t) - t - 200), null, 1.6, { x: cd.x * radius * 3, y: cd.y * radius * 3 });
            cue(c.sfxCleaveClip, c.sfxCleaveGain * 1.3, c.sfxCleaveRate * 0.8);
            cue(c.sfxBoomClip, c.sfxBoomGain * 1.15, c.sfxBoomRate * 0.7, { lenMs: 1400, fadeMs: 700 });
            cue(c.sfxBellClip, c.sfxBellGain * 0.55, c.sfxBellRate * 0.5, { lenMs: 2600, fadeMs: 1200, tail: 0.15 });
            cue(c.sfxDrainClip, c.sfxDrainGain * 0.8, c.sfxDrainRate * 0.8, { delayMs: real(90), fadeMs: 320 });
          }
          fedAt = t + c.moteMs * 0.8;
        }
        seq.land();
        break;
      }
      case 'flood':
        // IV: colour floods back: the rush of air again, higher, a low sweep with it, and the hushed buses return.
        scene?.flood();
        cue(c.sfxDrainClip, c.sfxDrainGain * 1.1, c.sfxDrainRate * 1.1, { startMs: 150, fadeMs: 200 });
        cue(c.sfxSweepClip, c.sfxSweepGain * 0.9, c.sfxSweepRate * 0.6, { fadeMs: 200 });
        cue(c.sfxSlashClip, c.sfxSlashGain * 0.7, c.sfxSlashRate * 0.7, { delayMs: real(plan.floodEnd !== null ? (plan.floodEnd - t) * 0.45 : 200) });
        if (hushed) { voices.unduck(); hushed = false; }
        break;
      case 'return':
        // The struck portrait's colour seeps back: a soft breath.
        cue(c.sfxBreathClip, c.sfxBreathGain * (big || fall ? 1 : 0.8), c.sfxBreathRate * (big || fall ? 0.9 : 1.15), { fadeMs: 160 });
        break;
      default:
        break;
    }
  };

  /** Both portraits, in their own px (scaled by the stage like every other style), and the drain panes. */
  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    // The dim holds through the blow; IV keeps it until the colour floods back (it lifts with the wave).
    nums.paintDim(t, plan.chargeAt, big ? (plan.drainedAt ?? plan.launchAt) : plan.launchAt, plan.floodAt ?? plan.impactAt + (fall ? 420 : 260));
    const cm = reapingCameraAt(plan, c, t, cutDir);
    cam.apply(reapingCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    // The striker: a breath of a swell through the ready, and a pulse as the colour reaches it.
    let hs = 1;
    if (t >= plan.chargeAt) {
      const ready = Math.max(1, plan.launchAt - plan.chargeAt);
      hs += c.heroSwell * (t < plan.launchAt ? easeInOutSine((t - plan.chargeAt) / ready) : Math.max(0, 1 - (t - plan.launchAt) / 260));
      if (t >= fedAt) hs += 0.03 * Math.max(0, spring(t - fedAt, 3, 140));
      if (t >= tolledAt) hs += 0.05 * Math.max(-0.4, spring(t - tolledAt, 4, 110));
    }
    hero.set(Math.abs(hs - 1) < 1e-4 ? null : `scale(${hs.toFixed(4)})`);
    // The struck portrait: knocked along the cut, then sagging while it is grey.
    const mv = foeMoveAt(plan, t);
    const knock = c.knockPx * (0.7 + 0.5 * plan.k) * reel * mv.knock * px;
    const fx = cutDir.x * knock, fy = cutDir.y * knock + 5 * mv.sag * px;
    const fs = 1 - c.sag * mv.sag;
    const still = Math.abs(fx) + Math.abs(fy) < 0.05 && Math.abs(fs - 1) < 1e-4;
    const tf = still ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${fs.toFixed(4)})`;
    foe.set(tf);
    drain.paint(drainAt(plan, t, dstate), tf);
    scene?.draw(t, { heroX: 0, heroY: 0, foeX: fx * unit, foeY: fy * unit });
  };

  const seq: Sequence<ReapingCue | FormationCue> = new Sequence<ReapingCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); drain.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck(); hushed = false; scene?.hideOwn();
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    scene,
    drain,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
