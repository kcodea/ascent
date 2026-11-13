/**
 * THE GRABBY CLAW RUNNER: plays one Grabby Claw hero attack (the beats, the geometry and the pose are pure, in
 * `heroClawConfig.ts`) and lands the consequence on its impact beat (the portrait hitting its socket, or dropping into
 * the prize chute). Presentation only: the total it shows and the blow it lands are handed in, already decided by the
 * engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera, the voices, the dim, reduced motion, finish / cancel and the
 * safety timer. What is the claw's own: the claw, the chute, and THE STRUCK PORTRAIT ITSELF BEING PICKED UP.
 *
 * THE STRUCK PORTRAIT MOVES. It is the real DOM portrait, moved by its own `transform` (and, down the chute, its
 * `opacity`) from the one pose the claw is drawn from, so the prongs and the portrait can never drift apart. While it is
 * in the air its side of the board is raised over everything (Classic's `.duel-attacker-*` z-order class, here on the
 * STRUCK side), and that class comes off the moment the blow lands. EVERY exit path (the end, `finish()`, `cancel()`,
 * the safety timer, and an unmount, which cancels) restores its transform, its opacity and the z-order class exactly,
 * restores the striker's transform, and hides the claw, the chute and the sign.
 *
 * THE CAMERA IS APPLIED ONCE. The shared FX canvas lives INSIDE `#stage`, so the DOM camera already zooms and shakes it;
 * the Pixi root mirrors the camera only when its canvas is NOT inside the camera element (see `stageCamera.ts`). A
 * portrait outside the camera element has the camera folded into its own transform by hand, so it stays in the prongs.
 *
 * Perf (docs/performance.md): DOM writes are `transform` / `opacity` from the clock; layout is read once, at the start;
 * the claw's sprites are taken once and only moved; the pose, the camera focus and the operator's nudge are refilled in
 * place each frame (no allocation); the pool is capped; textures are painted once per session and pre-warmed during the
 * formation; and the updater unhooks the moment the scene drains.
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
  blankPose, clawCameraAt, clawCameraFocus, clawCramped, clawCues, clawGeo, clawPlan, clawPose, getHeroClawConfig, operatorAt,
  type ClawCue, type ClawGeo, type ClawPlan, type ClawPose, type HeroClawConfig,
} from './heroClawConfig';
import { HeroClawScene, type HeroClawTextures } from './heroClawScene';
import { heroClawTextures } from './heroClawTextures';

export interface HeroClawOptions extends HeroAttackOptions {
  cfg?: HeroClawConfig;
  textures?: HeroClawTextures | null;
}

export interface HeroClawHandle extends HeroAttackHandle {
  readonly plan: ClawPlan;
  /** Where everything is laid out (measured once, at the start). */
  readonly geo: ClawGeo;
  /** The pose at any sequence time (a fresh object; for tests and the capture rig). */
  pose(t: number): ClawPose;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroClawScene | null;
}

/** The seed a fight's coins and sparks are scattered from when the caller gives none: the same blow scatters the same. */
export function clawSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 5393 + Math.round(distance) * 41 + (side === 'opp' ? 227 : 19)) >>> 0;
}

/** One measure of a portrait: `inv` = its own transform px per screen px (the stage may be scaled). */
function invOf(el: HTMLElement | null | undefined): number {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return 1;
    return el.offsetWidth > 0 ? el.offsetWidth / b.width : 1;
  } catch { return 1; }
}

/** Play the Grabby Claw. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroClaw(o: HeroClawOptions): HeroClawHandle {
  const c = o.cfg ?? getHeroClawConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  // Layout is read ONCE, here: the portraits' own px per screen px, and the view.
  const heroInv = local ? 1 : invOf(o.attackerEl);
  const foeInv = local ? 1 : invOf(o.defenderEl);
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const frame = { x0: 0, y0: 0, x1: vw, y1: vh };
  // No room above the struck portrait (the opponent's sits against the top edge): it is pulled out, not lifted.
  const plan = clawPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt, cramped: clawCramped(o.defender, radius, frame, c) }, c);
  const cues = withFormation(fplan, clawCues(plan));
  const geo = clawGeo(plan, o.attacker, o.defender, radius, frame, c);
  const yank = plan.heldTo > plan.releaseAt;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hclaw',
  });

  // ── Pixi ──
  const textures = o.textures !== undefined ? o.textures : heroClawTextures();
  const scene = textures && !reduced
    ? new HeroClawScene(textures, {
      chrome: hexToNum(c.colorChrome), lamp: hexToNum(c.colorLamp), coin: hexToNum(c.colorCoin), dust: hexToNum(c.colorDust), side: hexToNum(sideHex),
    }, radius, c.clawSize, s, o.rollSeed ?? clawSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const foeOpacity0 = foe.el ? foe.el.style.opacity : '';
  let foeFaded = false;
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));
  // The STRUCK side is raised over the board while its portrait is in the air (Classic's own duel z-order classes).
  const zClass = o.side === 'opp' ? 'duel-attacker-player' : 'duel-attacker-opp';
  const canRaise = !reduced && !local && !!foe.el && !!doc;
  let raised = false;
  const raise = (): void => {
    // A class someone else already put there (the fight's own duel) is theirs: it is left alone, going up and coming down.
    if (!canRaise || raised || doc!.body.classList.contains(zClass)) return;
    doc!.body.classList.add(zClass); raised = true;
  };
  const lower = (): void => { if (raised) { doc!.body.classList.remove(zClass); raised = false; } };

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxServoClip, c.sfxClampClip, c.sfxCoinClip, c.sfxThudClip, c.sfxChuteClip, c.sfxWinClip, c.sfxPopClip]);

  const pose = blankPose();
  const focus: Pt = { x: o.defender.x, y: o.defender.y };
  const op = { x: 0, y: 0, sx: 1, sy: 1 };
  /** The held portrait's centre right now (overlay px). */
  const heldAt = (): Pt => ({ x: o.defender.x + pose.px, y: o.defender.y + pose.py });

  const fire = (q: ClawCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        // The trolley runs in: the servo.
        cue(c.sfxServoClip, c.sfxServoGain, c.sfxServoRate, { lenMs: Math.max(160, plan.hoverAt - plan.chargeAt + 60), fadeMs: 120 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        // The struck side goes over the board now, on the frame the camera is promoted anyway (the class change
        // restyles the page: one busy frame here, none on the clamp).
        raise();
        break;
      case 'drop':
        // The winch lets the claw down: a shorter, higher whirr.
        cue(c.sfxServoClip, c.sfxServoGain * 0.7, c.sfxServoRate * 1.35, { lenMs: Math.max(120, plan.clampAt - plan.dropAt + 40), fadeMs: 80 });
        break;
      case 'grab':
        // CLAMP: the prongs bite.
        cue(c.sfxClampClip, c.sfxClampGain, c.sfxClampRate);
        scene?.grab(o.defender.x, o.defender.y);
        break;
      case 'lift':
        cue(c.sfxServoClip, c.sfxServoGain * 0.8, c.sfxServoRate * 0.88, { lenMs: Math.max(140, plan.liftEnd - plan.grabAt), fadeMs: 110 });
        break;
      case 'slip':
        // Fumble: the grip rattles loose.
        cue(c.sfxClampClip, c.sfxClampGain * 0.55, c.sfxClampRate * 1.5, { startMs: 50, lenMs: 150, fadeMs: 60 });
        break;
      case 'shake': {
        // A hard shake: the servo jerks, coins fall out (a little higher each time).
        cue(c.sfxServoClip, c.sfxServoGain * 0.6, c.sfxServoRate * (1.5 + 0.08 * q.i), { lenMs: 120, fadeMs: 60 });
        cue(c.sfxCoinClip, c.sfxCoinGain, c.sfxCoinRate + 0.08 * q.i, { lenMs: 420, fadeMs: 200 });
        const at = heldAt();
        scene?.shakeOut(at.x, at.y, q.i % 2 === 0 ? 1 : -1, plan.coins);
        break;
      }
      case 'chute':
        // Prize: the chute slides up.
        cue(c.sfxPopClip, c.sfxPopGain * 0.8, c.sfxPopRate * 0.75, { lenMs: 300, fadeMs: 120 });
        break;
      case 'carry':
        cue(c.sfxServoClip, c.sfxServoGain, c.sfxServoRate * 1.08, { lenMs: Math.max(200, plan.carryEnd - plan.carryAt + 40), fadeMs: 140 });
        break;
      case 'release':
        // The prongs spring open; or (pulled out) the winch snatches the portrait back up.
        if (yank) cue(c.sfxServoClip, c.sfxServoGain * 0.9, c.sfxServoRate * 1.6, { lenMs: Math.max(120, plan.impactAt - plan.releaseAt), fadeMs: 60 });
        else cue(c.sfxClampClip, c.sfxClampGain * 0.7, c.sfxClampRate * 1.25, { lenMs: 120, fadeMs: 50 });
        break;
      case 'impact':
        if (plan.level === 3 && geo.chute) {
          // Down the chute: the clatter.
          cue(c.sfxChuteClip, c.sfxChuteGain, c.sfxChuteRate, { tail: c.sfxTailMix });
          cue(c.sfxThudClip, c.sfxThudGain * 0.6, c.sfxThudRate * 0.9, { lenMs: 420, fadeMs: 180 });
          scene?.swallow(geo.chute, { sparks: plan.sparks, flashAlpha: c.flashAlpha });
        } else {
          // Back in its socket: the thud (heavier from the height of a shake).
          cue(c.sfxThudClip, c.sfxThudGain * (plan.level === 2 ? 1.25 : 0.9), c.sfxThudRate * (plan.level === 2 ? 0.92 : 1.08), { tail: c.sfxTailMix, lenMs: 520, fadeMs: 220 });
          if (yank) cue(c.sfxClampClip, c.sfxClampGain * 0.6, c.sfxClampRate * 1.25, { lenMs: 120, fadeMs: 50 });
          scene?.land(o.defender.x, o.defender.y, { level: plan.level, sparks: plan.sparks, flashAlpha: c.flashAlpha, slam: yank });
        }
        lower();
        seq.land();
        break;
      case 'win':
        cue(c.sfxWinClip, c.sfxWinGain, c.sfxWinRate, { lenMs: 900, fadeMs: 350 });
        if (geo.chute) scene?.win(geo.chute);
        break;
      case 'return':
        cue(c.sfxPopClip, c.sfxPopGain, c.sfxPopRate, { lenMs: 320, fadeMs: 120 });
        scene?.pop(o.defender.x, o.defender.y);
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.grabAt, plan.impactAt + 300);
    const cm = clawCameraAt(plan, c, t);
    const unit = local ? 1 : s;
    clawCameraFocus(plan, geo, t, focus);
    cam.apply(focus, cm.zoom, cm.x, cm.y, unit);
    clawPose(plan, geo, c, t, pose);
    if (scene) { scene.setPose(pose, geo); scene.setFoeOffset(pose.px, pose.py); }
    // The camera's screen offset: a portrait OUTSIDE the camera element folds it in by hand (so it stays in the prongs).
    const camOn = cam.active;
    const ax = focus.x * (1 - cm.zoom) + cm.x * unit, ay = focus.y * (1 - cm.zoom) + cm.y * unit;
    if (foe.el) {
      const own = foeInCam || !camOn;
      const z = own ? 1 : cm.zoom;
      const x = own ? pose.px : pose.px * cm.zoom + o.defender.x * (cm.zoom - 1) + ax;
      const y = own ? pose.py : pose.py * cm.zoom + o.defender.y * (cm.zoom - 1) + ay;
      const still = Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(pose.prot) < 1e-4 && Math.abs(pose.psx * z - 1) < 1e-4 && Math.abs(pose.psy * z - 1) < 1e-4;
      foe.set(still ? null
        : `translate(${(x * foeInv).toFixed(2)}px, ${(y * foeInv).toFixed(2)}px) rotate(${((pose.prot * 180) / Math.PI).toFixed(2)}deg) scale(${(pose.psx * z).toFixed(4)}, ${(pose.psy * z).toFixed(4)})`);
      if (pose.palpha < 0.999) { foe.el.style.opacity = pose.palpha.toFixed(3); foeFaded = true; } else if (foeFaded) { foe.el.style.opacity = foeOpacity0; foeFaded = false; }
    }
    if (hero.el) {
      operatorAt(plan, geo, c, t, op);
      const px = local ? 0.45 : 1;
      const own = heroInCam || !camOn;
      const z = own ? 1 : cm.zoom;
      const x = own ? op.x * px : op.x * px * cm.zoom + o.attacker.x * (cm.zoom - 1) + ax;
      const y = own ? op.y * px : op.y * px * cm.zoom + o.attacker.y * (cm.zoom - 1) + ay;
      const still = Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(op.sx * z - 1) < 1e-4 && Math.abs(op.sy * z - 1) < 1e-4;
      hero.set(still ? null : `translate(${(x * heroInv).toFixed(2)}px, ${(y * heroInv).toFixed(2)}px) scale(${(op.sx * z).toFixed(4)}, ${(op.sy * z).toFixed(4)})`);
    }
  };

  const seq: Sequence<ClawCue | FormationCue> = new Sequence<ClawCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      if (foe.el) foe.el.style.opacity = foeOpacity0;
      foeFaded = false;
      scene?.hideOwn();
      lower();
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    pose: (t: number) => clawPose(plan, geo, c, t),
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
