/**
 * THE TRAIN RUNNER ("Right on Schedule", a Legendary; DEV-ONLY): plays one Train attack (the beats are in
 * `heroTrainConfig.ts`) and lands the consequence on its impact beat (the vehicle's nose reaching the struck
 * portrait). Presentation only: the total and the blow are the engine's; this file only decides WHEN on screen they
 * happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses), the damage formation, the
 * `#stage` camera (applied ONCE: `stageCamera.ts`), the voices, the dim, reduced motion, finish / cancel and the safety
 * timer.
 *
 * THE STRUCK PORTRAIT MOVES (nudged, knocked, flattened, or thrown up spinning): its pose is solved in screen px and
 * written as a transform in the portrait's own units (its ancestors' scale measured ONCE at the start). A portrait that
 * is a <body> portal outside the `#stage` camera has the camera's zoom and shake folded into its own transform. The
 * striker only hops and leans. EVERY exit path (the end, `finish()`, `cancel()`, the safety timer, and an unmount,
 * which cancels) restores both portraits' transform and opacity exactly and hides the track, the train, the signal and
 * the headlight. No z-order class is ever added (nothing is raised), so there is none to take off.
 *
 * THE CONTRACT: the consequence (`onImpact`) lands exactly ONCE, on the `impact` cue. Nothing before it (the track, the
 * signal, the bell, the gate, the horn, the whistle, the vehicle rolling in) lands it or makes the target react.
 *
 * Perf: DOM writes are `transform` from the clock; layout is read once at the start; every own sprite is made once at
 * the start (a long train is the same few textures repeated) and pooled sprites sit under a hard cap; textures are
 * painted once per session and pre-warmed during the formation; nothing is allocated per frame; the updater unhooks
 * the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { hexToNum, prefersReducedMotion, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  consistLength, foePose, getHeroTrainConfig, headlightAt, noseTravel, signalAt, strikerPose, trackAlpha, trainCameraAt, trainConsist, trainCues, trainGeo,
  trainMotion, trainPlan,
  type FoePose, type HeroTrainConfig, type TrainCue, type TrainGeo, type TrainMotion, type TrainPlan, type TrainUnit,
} from './heroTrainConfig';
import { HeroTrainScene, type HeroTrainTextures } from './heroTrainScene';
import { heroTrainTextures } from './heroTrainTextures';

export interface HeroTrainOptions extends HeroAttackOptions {
  cfg?: HeroTrainConfig;
  textures?: HeroTrainTextures | null;
}

export interface HeroTrainHandle extends HeroAttackHandle {
  readonly plan: TrainPlan;
  readonly geo: TrainGeo;
  readonly units: readonly TrainUnit[];
  readonly motion: TrainMotion;
  readonly scene: HeroTrainScene | null;
  readonly mirrorsCamera: boolean;
  /** The train's nose (screen px) at a sequence time (pure). */
  noseX(t: number): number;
  /** The struck portrait's pose at a sequence time (pure; a fresh object). */
  foe(t: number): FoePose;
}

export function trainSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 2711 + Math.round(distance) * 43 + (side === 'opp' ? 199 : 23)) >>> 0;
}

/** One measure of a portrait: `inv` = its own transform px per screen px. */
function rectOf(el: HTMLElement | null | undefined): { inv: number } {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { inv: 1 };
    return { inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  } catch { return { inv: 1 }; }
}

/** Play the Train attack. Returns a handle; the blow lands via `onImpact` when the vehicle reaches the portrait. */
export function playHeroTrain(o: HeroTrainOptions): HeroTrainHandle {
  const c = o.cfg ?? getHeroTrainConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const aRect = local ? { inv: 1 } : rectOf(o.attackerEl);
  const dRect = local ? { inv: 1 } : rectOf(o.defenderEl);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = trainPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, trainCues(plan));
  // The frame the track runs across (the screen, or the sandbox box).
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const geo = trainGeo(o.attacker, o.defender, radius, { x0: 0, y0: 0, x1: vw, y1: vh }, c, o.side ?? 'player');
  const units = trainConsist(plan, radius, c);
  const motion = trainMotion(plan, geo, consistLength(units), radius);
  const noseX = (t: number): number => geo.hitX + geo.dir * noseTravel(plan, motion, t);

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'htrain',
  });

  const textures = o.textures !== undefined ? o.textures : heroTrainTextures();
  // The seed only scatters the steam and the sparks: the same blow (or the same `rollSeed`) throws the same ones.
  const seed = o.rollSeed ?? trainSeed(o.total, dist, o.side);
  const scene = textures && !reduced
    ? new HeroTrainScene(textures, {
      steam: hexToNum(c.colorSteam), ore: hexToNum(c.colorOre), lamp: hexToNum(c.colorLamp), headlight: hexToNum(c.colorHeadlight), spark: hexToNum(c.colorSpark),
      star: hexToNum(c.colorStar), flash: hexToNum(c.colorFlash), side: hexToNum(sideHex),
    }, { trackSize: c.trackSize, handleSwing: c.handleSwing, bounce: c.bounce }, geo, units, plan.kind, radius, s, seed)
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  // The portraits' opacity is saved and restored too (it never changes here, but every exit path puts it back exactly).
  const heroOpacity0 = hero.el ? hero.el.style.opacity : '';
  const foeOpacity0 = foe.el ? foe.el.style.opacity : '';
  const heroUnit = 1 / (aRect.inv || 1);
  const foeUnit = 1 / (dRect.inv || 1);
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));

  const cue: AttackVoices['cue'] = (clip, gain, rate, opts) => voices.cue(clip, gain, rate, opts);
  voices.warm([c.sfxBellClip, c.sfxWhistleClip, c.sfxHornClip, c.sfxPassClip, c.sfxClatterClip, c.sfxSqueakClip, c.sfxBoomClip, c.sfxWhooshClip]);
  const freight = plan.kind === 'freight';

  const fire = (q: TrainCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        // The track drops in: a soft thump of dust under the portrait.
        scene?.dust({ x: geo.hit.x, y: geo.wheelY }, 1.2);
        break;
      case 'bell':
        // The crossing bell (three dings a cue), until the caboose.
        cue(c.sfxBellClip, c.sfxBellGain, c.sfxBellRate, { fadeMs: 200 });
        break;
      case 'gate':
        // The arm coming down: a short low swish.
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.7, c.sfxWhooshRate * 0.7, { lenMs: 380, fadeMs: 160 });
        break;
      case 'horn':
        // Off screen, coming: the horn, and the headlight starts to grow.
        cue(c.sfxHornClip, c.sfxHornGain, c.sfxHornRate, { fadeMs: 260, tail: 0.1 });
        break;
      case 'whistle':
        cue(c.sfxWhistleClip, c.sfxWhistleGain, c.sfxWhistleRate, { fadeMs: 200, tail: 0.08 });
        break;
      case 'roll':
        // I: the pump's squeak (softer as it trundles off). II: the cart rattling over a joint.
        if (plan.kind === 'handcar') cue(c.sfxSqueakClip, c.sfxSqueakGain * (q.i === 0 ? 1 : 0.5), c.sfxSqueakRate, q.i === 0 ? {} : { lenMs: 420, fadeMs: 120 });
        else cue(c.sfxClatterClip, c.sfxClatterGain * 0.6, c.sfxClatterRate * (1.3 + 0.08 * q.i), { fadeMs: 120 });
        break;
      case 'enter':
        // The rush of it coming (III and IV): the roar swells through the impact and fades with the tail.
        if (plan.kind === 'engine') cue(c.sfxPassClip, c.sfxPassGain * 0.7, c.sfxPassRate * 1.2, { fadeMs: 400 });
        else if (freight) cue(c.sfxPassClip, c.sfxPassGain, c.sfxPassRate * 0.85, { fadeMs: 500 });
        break;
      case 'impact': {
        // THE BLOW: the vehicle's nose is on the portrait.
        if (plan.kind === 'handcar') {
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.45, c.sfxBoomRate * 2.1, { lenMs: 200, fadeMs: 120 });
        } else if (plan.kind === 'minecart') {
          cue(c.sfxClatterClip, c.sfxClatterGain, c.sfxClatterRate * 0.9, { fadeMs: 160 });
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.6, c.sfxBoomRate * 1.5, { lenMs: 320, fadeMs: 160 });
        } else {
          cue(c.sfxBoomClip, c.sfxBoomGain * (freight ? 1.2 : 0.9), c.sfxBoomRate * (freight ? 0.9 : 1.1), { lenMs: freight ? 900 : 600, fadeMs: 280, tail: freight ? 0.12 : 0 });
          cue(c.sfxClatterClip, c.sfxClatterGain * 0.9, c.sfxClatterRate * 0.8, { fadeMs: 200 });
        }
        scene?.hit(geo.contact, plan.burst);
        seq.land();
        break;
      }
      case 'car':
        // IV: car after car over the joint (a clack each, never quite the same pitch) and the portrait buffeted.
        cue(c.sfxClatterClip, c.sfxClatterGain * 0.55, c.sfxClatterRate * (1.02 + 0.07 * ((q.i * 5) % 4)), { lenMs: 300, fadeMs: 140 });
        scene?.buffet({ x: geo.hit.x, y: geo.hit.y });
        break;
      case 'tail':
        // The tail has passed: a last puff where the train was (III and IV), a soft rush of air.
        if (plan.kind === 'engine' || freight) {
          cue(c.sfxWhooshClip, c.sfxWhooshGain * (freight ? 0.9 : 0.6), c.sfxWhooshRate * 0.8, { lenMs: 520, fadeMs: 260 });
          scene?.lastPuff({ x: geo.hit.x, y: geo.hit.y });
        }
        break;
      case 'gateup':
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.45, c.sfxWhooshRate * 0.95, { lenMs: 320, fadeMs: 160 });
        break;
      default:
        break;
    }
  };

  let lastPuff = -Infinity;
  let lastWind = -Infinity;
  let lastSpark = -Infinity;
  const fp: FoePose = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
  const hp: FoePose = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
  const funnel: Pt = { x: 0, y: 0 };
  const px = local ? 0.45 : 1; // a sandbox box is small: the portrait's travel shrinks with it

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.enterAt + 1, plan.passEnd + 200);
    const cm = trainCameraAt(plan, c, t, geo.dir);
    const unitS = local ? 1 : s;
    const focus = o.defender;
    cam.apply(focus, cm.zoom, cm.x, cm.y, unitS);
    // The camera's screen offset: a portrait OUTSIDE `#stage` folds it in by hand (so it stays glued to the scene).
    const ax = focus.x * (1 - cm.zoom) + cm.x * unitS, ay = focus.y * (1 - cm.zoom) + cm.y * unitS;
    const camOn = cam.active;
    if (hero.el) {
      const p = strikerPose(plan, geo, aRadius, t, hp);
      const inC = heroInCam || !camOn;
      const x = inC ? p.x : p.x * cm.zoom + o.attacker.x * (cm.zoom - 1) + ax;
      const y = inC ? p.y : p.y * cm.zoom + o.attacker.y * (cm.zoom - 1) + ay;
      const z = inC ? 1 : cm.zoom;
      const still = Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(p.rot) < 0.01 && Math.abs(p.sx * z - 1) < 1e-4;
      hero.set(still ? null : `translate(${(x / heroUnit).toFixed(2)}px, ${(y / heroUnit).toFixed(2)}px) rotate(${p.rot.toFixed(2)}deg) scale(${(p.sx * z).toFixed(4)})`);
    }
    if (foe.el) {
      const p = foePose(plan, geo, c, radius, t, fp);
      const inC = foeInCam || !camOn;
      const x = inC ? p.x * px : p.x * px * cm.zoom + o.defender.x * (cm.zoom - 1) + ax;
      const y = inC ? p.y * px : p.y * px * cm.zoom + o.defender.y * (cm.zoom - 1) + ay;
      const z = inC ? 1 : cm.zoom;
      const still = Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(p.rot) < 0.01 && Math.abs(p.sx * z - 1) < 1e-4 && Math.abs(p.sy * z - 1) < 1e-4;
      foe.set(still ? null
        : `translate(${(x / foeUnit).toFixed(2)}px, ${(y / foeUnit).toFixed(2)}px) rotate(${p.rot.toFixed(2)}deg) scale(${(p.sx * z).toFixed(4)}, ${(p.sy * z).toFixed(4)})`);
    }
    if (!scene) return;
    scene.setTrack(trackAlpha(plan, c, t));
    const travel = noseTravel(plan, motion, t);
    const nx = geo.hitX + geo.dir * travel;
    // The train draws from the moment its nose arrives until its tail has gone (a unit off the track is hidden anyway).
    scene.setTrain(nx, travel, t >= motion.arriveAt - 1 && t <= plan.exitEnd + 400);
    if (freight) { scene.setSignal(signalAt(plan, c, t)); scene.setHeadlight(headlightAt(plan, t, motion.arriveAt)); }
    if (t < motion.arriveAt || t > plan.exitEnd) return;
    // Steam from the funnel while the engine is on screen (III and IV).
    if (t - lastPuff >= c.puffMs) {
      const f = scene.funnelAt(nx, funnel);
      if (f && f.x > -radius && f.x < vw + radius) { scene.puff(f, freight ? 1.15 : 1); lastPuff = t; }
    }
    if (freight && t >= plan.impactAt - 80 && t < plan.passEnd) {
      // Wind along the flank, and sparks off the rail under the portrait, while the cars go by.
      if (t - lastWind >= c.windMs) { scene.wind(); lastWind = t; }
      if (t - lastSpark >= 130) { scene.sparks(geo.hit.x, 2); lastSpark = t; }
    }
  };

  const seq: Sequence<TrainCue | FormationCue> = new Sequence<TrainCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      if (hero.el) hero.el.style.opacity = heroOpacity0;
      if (foe.el) foe.el.style.opacity = foeOpacity0;
      scene?.hideOwn();
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    units,
    motion,
    scene,
    noseX,
    foe: (t: number) => foePose(plan, geo, c, radius, t, { x: 0, y: 0, rot: 0, sx: 1, sy: 1 }),
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
