/**
 * LOOK OUT BELOW'S RUNNER (style id `anvil`, a Rare hero attack): plays one drop (the beats are in
 * `heroAnvilConfig.ts`) and lands the consequence on its impact beat, the landing. Presentation only: the total it
 * shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they
 * happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), as every style does: one clock (it never pauses), the
 * damage formation, the `#stage` camera (applied ONCE: `stageCamera.ts`), the portraits (transform only, restored after),
 * the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE SQUASH: the struck portrait's wrapper is scaled (flat, then the accordion spring) about the BOTTOM of its round
 * art, so it flattens onto its own ground line and the object can sit on top of it. The wrapper's transform origin is
 * measured ONCE, at the start (with the portrait at rest); after that the transform is written from the clock and the
 * Pixi object reads the same squash value the same frame. Only `transform` is ever written to a portrait (never its
 * opacity, filter or classes), and `PortraitMover` puts it back exactly on every exit (the end, `finish()`,
 * `cancel()`, the safety timer).
 *
 * Perf: DOM moves are `transform` written from the clock; nothing reads layout after the opening measure; the Pixi
 * sprites are pooled (a hard cap), the textures painted once per session and pre-warmed during the formation, and the
 * updater unhooks the moment the scene drains.
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
import { restingRect } from '../heroBlast/portraits';
import {
  anvilCameraAt, anvilCameraFocus, anvilCues, anvilPlan, anvilRestOffset, anvilSquashAt, getHeroAnvilConfig,
  type AnvilCue, type AnvilPlan, type HeroAnvilConfig,
} from './heroAnvilConfig';
import { HeroAnvilScene, type HeroAnvilTextures } from './heroAnvilScene';
import { ANVIL_H, ANVIL_W, PIANO_H, PIANO_W, heroAnvilTextures } from './heroAnvilTextures';

export interface HeroAnvilOptions extends HeroAttackOptions {
  cfg?: HeroAnvilConfig;
  textures?: HeroAnvilTextures | null;
}

export interface HeroAnvilHandle extends HeroAttackHandle {
  readonly plan: AnvilPlan;
  /** Where the object's foot comes into view (above the top of the screen) and where it lands (the top of the portrait). */
  readonly startY: number;
  readonly landY: number;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroAnvilScene | null;
  /** Whether the camera is mirrored onto the Pixi root (false when the canvas already rides the camera element). */
  readonly mirrorsCamera: boolean;
}

/** The seed a fight's dust and keys are scattered from: the same fight scatters the same way. */
export function anvilSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, roll = 0): number {
  return ((Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 13)) ^ (Math.round(roll) || 0)) >>> 0;
}

/**
 * From the struck wrapper's transform origin to the bottom of its round art, in screen px: the point the squash is
 * pinned on. ONE layout read, at the start, with the portrait at rest. Without a measurable box (a test, a sandbox in
 * its own px) the origin is taken as the art's centre.
 */
function squashPivot(el: HTMLElement | null, d: Pt, radius: number, measure: boolean): Pt {
  const fallback = { x: 0, y: radius };
  if (!el || !measure || typeof window === 'undefined') return fallback;
  try {
    const r = restingRect(el);
    if (!(r.width > 0 && r.height > 0)) return fallback;
    let ox = 0.5, oy = 0.5;
    const parts = window.getComputedStyle(el).transformOrigin.split(' ');
    const px = parseFloat(parts[0] ?? ''), py = parseFloat(parts[1] ?? '');
    if (el.offsetWidth > 0 && el.offsetHeight > 0 && Number.isFinite(px) && Number.isFinite(py)) { ox = px / el.offsetWidth; oy = py / el.offsetHeight; }
    const out = { x: d.x - (r.left + r.width * ox), y: d.y + radius - (r.top + r.height * oy) };
    return Number.isFinite(out.x) && Number.isFinite(out.y) ? out : fallback;
  } catch { return fallback; }
}

/** Play Look Out Below. Returns a handle; the blow lands via `onImpact` on the landing. */
export function playHeroAnvil(o: HeroAnvilOptions): HeroAnvilHandle {
  const c = o.cfg ?? getHeroAnvilConfig();
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
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);

  // The geometry: the object's foot lands on the top of the portrait, having come from above the top of the screen
  // (y = 0 in both spaces), however high the portrait sits.
  const first = anvilPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt }, c);
  const piano = first.object === 'piano';
  const objH = radius * first.size * (piano ? PIANO_H / PIANO_W : ANVIL_H / ANVIL_W);
  const landY = o.defender.y + radius * anvilRestOffset(1);
  const startY = Math.min(0, landY - radius) - objH * 0.1 - 12 * s;
  const plan = anvilPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt, fallPx: (landY - startY) / Math.max(0.05, s) }, c);
  const cues = withFormation(fplan, anvilCues(plan));

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hanvil',
  });

  const textures = o.textures !== undefined ? o.textures : heroAnvilTextures();
  const scene = textures && !reduced
    ? new HeroAnvilScene(textures, {
      dust: hexToNum(c.colorDust), spark: hexToNum(c.colorSpark), shadow: hexToNum(c.colorShadow), side: hexToNum(sideHex),
    }, {
      shadowAlpha: c.shadowAlpha, tipMs: c.tipMs, tipSpeed: c.tipSpeed, tipGravity: c.tipGravity, keySpeed: c.keySpeed, keyGravity: c.keyGravity,
    }, s, anvilSeed(o.total, dist, o.side, o.rollSeed))
    : null;
  scene?.setTarget(o.defender, radius);
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const unit = local ? 1 : s; // portrait px -> overlay px
  const pivot = squashPivot(foe.el, o.defender, radius, !local);
  // The object tips off toward the striking hero's side of the screen (the side with the room).
  const tipDir = o.attacker.x < o.defender.x - 1 ? -1 : 1;

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxCueClip, c.sfxWhistleClip, piano ? c.sfxPianoClip : c.sfxClangClip, piano ? c.sfxThudClip : '', c.sfxPopClip]);

  const fire = (q: AnvilCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cue(c.sfxCueClip, c.sfxCueGain, c.sfxCueRate, { lenMs: 240, fadeMs: 100 });
        scene?.cue(o.attacker, aRadius);
        cam.start();
        break;
      case 'shadow': {
        // The whistle falls for exactly the fall (a window of the glide), lower and longer for the piano.
        const rate = c.sfxWhistleRate * (piano ? 0.72 : 1);
        cue(c.sfxWhistleClip, c.sfxWhistleGain, rate, { lenMs: Math.min(980, (plan.fallMs / speed) * rate), fadeMs: 50 });
        scene?.startShadow(plan.shadow, plan.fallMs, t - q.at);
        break;
      }
      case 'drop':
        scene?.drop(plan.object, plan.size, plan.dropMs, startY, t - q.at);
        break;
      case 'impact':
        if (piano) {
          cue(c.sfxPianoClip, c.sfxPianoGain, c.sfxPianoRate, { fadeMs: 200 });
          cue(c.sfxThudClip, c.sfxThudGain, c.sfxThudRate, { lenMs: 500, fadeMs: 200 });
        } else cue(c.sfxClangClip, c.sfxClangGain, c.sfxClangRate, { fadeMs: 150 });
        scene?.land({ dust: plan.dust, keys: plan.keys, big: piano });
        seq.land();
        break;
      case 'pop':
        cue(c.sfxPopClip, c.sfxPopGain, c.sfxPopRate, { lenMs: 260, fadeMs: 110 });
        scene?.pop(tipDir);
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.shadowAt, plan.popAt + 100);
    const cm = anvilCameraAt(plan, c, t);
    cam.apply(anvilCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    if (hero.el && t >= plan.chargeAt) {
      // The cue: a small hop as the spark goes up.
      const u = (t - plan.chargeAt) / 200;
      if (u >= 1) hero.set(null);
      else {
        const h = Math.sin(Math.PI * u);
        hero.set(`translate(0px, ${(-c.heroHopPx * (local ? 0.45 : 1) * h).toFixed(2)}px) scale(${(1 + 0.03 * h).toFixed(4)})`);
      }
    }
    const q = anvilSquashAt(plan, c, t);
    if (q.sx === 1 && q.sy === 1) foe.set(null);
    else {
      // Scaled about the bottom of the round art: the pivot stays put, whatever the wrapper's own origin is.
      const tx = (pivot.x * (1 - q.sx)) / unit, ty = (pivot.y * (1 - q.sy)) / unit;
      foe.set(`translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${q.sx.toFixed(4)}, ${q.sy.toFixed(4)})`);
    }
    scene?.setSquash(q.sy);
  };

  const seq: Sequence<AnvilCue | FormationCue> = new Sequence<AnvilCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => { nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck(); },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    startY,
    landY,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
