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
 * whatever is under them loses its colour); the Pixi SCENE (`heroReapingScene.ts`: the scythe, the shadow, the candle,
 * the line and the motes, which keep their colour over the grey). Layout is read ONCE, at the start, by the caller (the
 * two portrait rects); this file reads none.
 *
 * THE PORTRAITS move very little, on purpose (it is a cold attack): the striker swells a breath through the ready and
 * pulses as the colour reaches it; the struck portrait takes a short knock along the cut and then SAGS while it is
 * grey, easing back as its colour returns. No z-order class is touched.
 *
 * THE SOUND (IV): the other buses are hushed as the screen drains, there is a beat of silence, ONE bell tolls, the
 * sweep, and the buses come back as the colour floods back.
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

/** Where the sweep clip's body sits (ms into the clip): a cue is placed so it lands on the crossing. */
export const SWEEP_BODY_MS = 420;

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
  voices.warm([c.sfxBellClip, c.sfxSweepClip, c.sfxBreathClip, c.sfxThumpClip]);
  const real = (ms: number): number => ms / speed;
  const unit = local ? 1 : s;
  const px = local ? 0.45 : 1;
  const big = plan.kind === 'reaping';
  let hushed = false;
  /** When the colour last reached the striker (it pulses). */
  let fedAt = Number.POSITIVE_INFINITY;

  /** The sweep, placed so the clip's body lands on the crossing `inMs` (attack ms) from now. */
  const sweep = (gain: number, rate: number, inMs: number): void => {
    const lead = SWEEP_BODY_MS / rate; // real ms from the clip's start to its body
    const wait = real(inMs) - lead;
    cue(c.sfxSweepClip, gain, rate, wait >= 0 ? { delayMs: wait } : { startMs: Math.min(SWEEP_BODY_MS - 60, -wait * rate) });
  };

  const fire = (q: ReapingCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (!big && c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'rise':
        // III: the shadow rises: a long low breath.
        cue(c.sfxBreathClip, c.sfxBreathGain * 0.9, c.sfxBreathRate * 0.62, { fadeMs: 200 });
        break;
      case 'drain':
        // IV: the colour goes out of the world: a slow exhale, and every other bus is hushed under it.
        cue(c.sfxBreathClip, c.sfxBreathGain * 1.1, c.sfxBreathRate * 0.7, { fadeMs: 200 });
        if (c.sfxHush < 1) { voices.duck(c.sfxHush); hushed = true; }
        break;
      case 'hush':
        // IV: silence. Nothing plays until the toll.
        break;
      case 'toll':
        // IV: ONE bell, its whole tail.
        cue(c.sfxBellClip, c.sfxBellGain, c.sfxBellRate, { tail: 0.18 });
        scene?.toll();
        break;
      case 'sweep': {
        const cut = plan.cuts[q.i]!;
        if (big) sweep(c.sfxSweepGain * 1.15, c.sfxSweepRate * 0.78, cut.crossAt - t);
        else if (plan.kind === 'shadow') sweep(c.sfxSweepGain, c.sfxSweepRate * 0.9, cut.crossAt - t);
        else sweep(c.sfxSweepGain * (0.8 + 0.1 * q.i), c.sfxSweepRate * (1.22 - 0.14 * q.i), cut.crossAt - t);
        break;
      }
      case 'cross':
        // II's first cut: a tick. A strip of colour goes, and a few motes with it.
        scene?.cross(q.i, 0.7);
        scene?.stream(Math.round(plan.motes * 0.35), 160, q.i);
        cue(c.sfxBreathClip, c.sfxBreathGain * 0.5, c.sfxBreathRate * 1.25, { lenMs: 500, fadeMs: 200 });
        break;
      case 'impact': {
        if (!plan.reduced) {
          const last = plan.cuts.length - 1;
          scene?.cross(last, big ? 1.3 : 1);
          cue(c.sfxThumpClip, c.sfxThumpGain * (0.8 + 0.25 * plan.tier), c.sfxThumpRate - 0.04 * (plan.tier - 1), { lenMs: 420, fadeMs: 180 });
          if (plan.kind === 'cut') {
            scene?.stream(plan.motes, 180, 0);
            cue(c.sfxBreathClip, c.sfxBreathGain * 0.7, c.sfxBreathRate * 1.1, { lenMs: 600, fadeMs: 240 });
          } else if (plan.kind === 'cross') {
            scene?.stream(plan.motes - Math.round(plan.motes * 0.35), 260, null);
            cue(c.sfxBreathClip, c.sfxBreathGain * 0.85, c.sfxBreathRate, { lenMs: 700, fadeMs: 260 });
          } else if (plan.kind === 'shadow') {
            // A low bell, cut short of its full tail, and the breath of the colour going.
            scene?.stream(plan.motes, 320, null);
            cue(c.sfxBellClip, c.sfxBellGain * 0.75, c.sfxBellRate * 0.84, { lenMs: 2200, fadeMs: 900, tail: 0.12 });
            cue(c.sfxBreathClip, c.sfxBreathGain * 0.9, c.sfxBreathRate * 0.9, { fadeMs: 260 });
          } else {
            // IV: the portrait's colour is drawn out in a long stream, all the way to the flood.
            scene?.stream(plan.motes, Math.max(120, (plan.floodAt ?? t) - t - 160), null);
            cue(c.sfxBreathClip, c.sfxBreathGain, c.sfxBreathRate * 0.85, { fadeMs: 260 });
          }
          fedAt = t + c.moteMs * 0.8;
        }
        seq.land();
        break;
      }
      case 'snuff':
        // III: the flame is out: a small puff.
        scene?.snuff();
        cue(c.sfxBreathClip, c.sfxBreathGain * 0.35, c.sfxBreathRate * 1.7, { lenMs: 260, fadeMs: 140 });
        break;
      case 'flood':
        // IV: colour floods back: the breath again, drawn IN this time, and the hushed buses return.
        cue(c.sfxBreathClip, c.sfxBreathGain * 0.9, c.sfxBreathRate * 0.8, { reverse: true, fadeMs: 120 });
        if (hushed) { voices.unduck(); hushed = false; }
        break;
      default:
        break;
    }
  };

  /** Both portraits, in their own px (scaled by the stage like every other style), and the drain panes. */
  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.launchAt, plan.impactAt + 260);
    const cm = reapingCameraAt(plan, c, t, cutDir);
    cam.apply(reapingCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    // The striker: a breath of a swell through the ready, and a pulse as the colour reaches it.
    let hs = 1;
    if (t >= plan.chargeAt) {
      const ready = Math.max(1, plan.launchAt - plan.chargeAt);
      hs += c.heroSwell * (t < plan.launchAt ? easeInOutSine((t - plan.chargeAt) / ready) : Math.max(0, 1 - (t - plan.launchAt) / 260));
      if (t >= fedAt) hs += 0.03 * Math.max(0, spring(t - fedAt, 3, 140));
    }
    hero.set(Math.abs(hs - 1) < 1e-4 ? null : `scale(${hs.toFixed(4)})`);
    // The struck portrait: knocked along the cut, then sagging while it is grey.
    const mv = foeMoveAt(plan, t);
    const knock = c.knockPx * (0.7 + 0.5 * plan.k) * mv.knock * px;
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
