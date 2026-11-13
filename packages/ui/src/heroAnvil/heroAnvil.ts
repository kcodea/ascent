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
  anvilCameraAt, anvilCameraFocus, anvilCues, anvilPlan, anvilPull, anvilPullAt, anvilRestOffset, anvilSquashAt, getHeroAnvilConfig,
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
  /** How far the struck portrait ducks to give the drop room, px (0 with headroom above it). */
  readonly pull: number;
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
 * From the struck wrapper's transform origin to the bottom of its round art, in the WRAPPER'S OWN px (what a transform
 * on it is written in): the point the squash is pinned on. The wrapper sits inside scaled ancestors (the stage, the
 * portrait's own sizing), so its px are not screen px: the ratio is read off its box. ONE layout read, at the start,
 * with the portrait at rest. Without a measurable box (a test, a sandbox in its own px) the origin is taken as the
 * art's centre and `unit` as the ratio.
 */
function squashPivot(el: HTMLElement | null, d: Pt, radius: number, unit: number, measure: boolean): Pt & { ky: number } {
  const fallback = { x: 0, y: radius / unit, ky: unit };
  if (!el || !measure || typeof window === 'undefined') return fallback;
  try {
    const r = restingRect(el, el.closest('.combatopp'));
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!(r.width > 0 && r.height > 0 && w > 0 && h > 0)) return fallback;
    const kx = r.width / w, ky = r.height / h; // screen px per wrapper px
    const parts = window.getComputedStyle(el).transformOrigin.split(' ');
    let ox = parseFloat(parts[0] ?? ''), oy = parseFloat(parts[1] ?? '');
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) { ox = w / 2; oy = h / 2; }
    const out = { x: (d.x - (r.left + ox * kx)) / kx, y: (d.y + radius - (r.top + oy * ky)) / ky, ky };
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
  const aspect = piano ? PIANO_H / PIANO_W : ANVIL_H / ANVIL_W;
  // A portrait near the top of the screen has little room above it: the object is sized down (never under 1.6 radii
  // wide) so that, resting on the flattened portrait, the whole of it is still on screen.
  // First the portrait ducks (`anvilPull`): that buys the drop its room and usually the object its full size.
  const pull = reduced ? 0 : anvilPull(o.defender.y, radius, radius * first.size * aspect, c);
  const struck = { x: o.defender.x, y: o.defender.y + pull }; // where the portrait is when the thing lands
  const restFoot = struck.y + radius * anvilRestOffset(first.flat);
  const size = Math.max(Math.min(first.size, 1.6), Math.min(first.size, (restFoot - 10 * s) / (radius * aspect)));
  const objH = radius * size * aspect;
  const landY = struck.y + radius * anvilRestOffset(1);
  const startY = Math.min(0, landY - radius) - objH * 0.1 - 12 * s;
  const plan = { ...anvilPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt, fallPx: (landY - startY) / Math.max(0.05, s) }, c), size };
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
  // The screen's width (not a layout read): a portrait in a corner keeps its piano on screen.
  if (local || typeof window === 'undefined') scene?.setTarget(struck, radius);
  else scene?.setTarget(struck, radius, 0, window.innerWidth);
  scene?.setPull(-pull);
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const unit = local ? 1 : s; // portrait px -> overlay px
  const pivot = squashPivot(foe.el, o.defender, radius, unit, !local);
  // The squash SCALES the struck portrait: without a layer hint the browser re-rasters it at every new scale (a run of
  // dropped frames, measured on the stamp). The hint is held for the attack only and put back exactly on every exit.
  const foeWill = foe.el ? foe.el.style.willChange : '';
  if (foe.el) foe.el.style.willChange = 'transform';
  // The object tips off toward the striking hero's side of the screen (the side with the room).
  const tipDir = o.attacker.x < o.defender.x - 1 ? -1 : 1;

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxCueClip, c.sfxWhistleClip, piano ? c.sfxPianoClip : c.sfxClangClip, c.sfxThudClip, c.sfxPopClip, c.sfxBoingClip, piano ? c.sfxKeysClip : '']);

  const fire = (q: AnvilCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        // The shared swish is loudest about 440 ms into its clip: play that part, short, as the spark goes up.
        cue(c.sfxCueClip, c.sfxCueGain, c.sfxCueRate, { startMs: 300, lenMs: 380, fadeMs: 140 });
        scene?.cue(o.attacker, aRadius);
        cam.start();
        break;
      case 'shadow': {
        // The whistle slides DOWN for exactly the fall and stops on the landing: the last stretch of the clip's glide,
        // as long as the fall, lower and longer for the piano.
        const rate = c.sfxWhistleRate * (piano ? 0.72 : 1);
        const len = Math.min(1000, (plan.fallMs / speed) * rate);
        cue(c.sfxWhistleClip, c.sfxWhistleGain, rate, { startMs: Math.max(0, 800 - len), lenMs: len, fadeMs: 40 }); // the glide is loud to 800 ms, then dies away
        scene?.startShadow(plan.shadow, plan.fallMs, t - q.at);
        break;
      }
      case 'drop':
        scene?.drop(plan.object, plan.size, plan.dropMs, startY, t - q.at);
        break;
      case 'impact':
        // THE loudest moment: the object's own crash on top, a deep ground thud under it (lower and fuller for the piano).
        if (piano) {
          cue(c.sfxPianoClip, c.sfxPianoGain, c.sfxPianoRate, { fadeMs: 200, tail: 0.1 });
          cue(c.sfxThudClip, c.sfxThudGain * 1.2, c.sfxThudRate * 0.85, { lenMs: 620, fadeMs: 380 });
          // The loose keys come down and clatter about a quarter of a second later.
          if (plan.keys > 0) cue(c.sfxKeysClip, c.sfxKeysGain, c.sfxKeysRate, { fadeMs: 160, delayMs: 260 / speed });
        } else {
          cue(c.sfxClangClip, c.sfxClangGain, c.sfxClangRate, { fadeMs: 150, tail: 0.08 });
          cue(c.sfxThudClip, c.sfxThudGain, c.sfxThudRate, { lenMs: 480, fadeMs: 300 });
        }
        scene?.land({ dust: plan.dust, keys: plan.keys, big: piano });
        seq.land();
        break;
      case 'pop':
        // The accordion: a springy boing (lower under the piano) with the swish of the thing being tossed off.
        cue(c.sfxBoingClip, c.sfxBoingGain, c.sfxBoingRate * (piano ? 0.85 : 1.1), { fadeMs: 180 });
        cue(c.sfxPopClip, c.sfxPopGain, c.sfxPopRate, { startMs: 300, lenMs: 320, fadeMs: 120 });
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
    // The duck: sunk under the shadow, flattened down there, back up with the pop.
    const e = pull > 0 ? anvilPullAt(plan, t) : 0;
    if (q.sx === 1 && q.sy === 1 && e === 0) foe.set(null);
    else {
      // Scaled about the bottom of the round art: the pivot stays put, whatever the wrapper's own origin is.
      const tx = pivot.x * (1 - q.sx), ty = pivot.y * (1 - q.sy) + (pull * e) / pivot.ky;
      foe.set(`translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${q.sx.toFixed(4)}, ${q.sy.toFixed(4)})`);
    }
    scene?.setSquash(q.sy);
    scene?.setPull(pull * (e - 1));
  };

  const seq: Sequence<AnvilCue | FormationCue> = new Sequence<AnvilCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => { nums.remove(); cam.reset(); hero.reset(); foe.reset(); if (foe.el) foe.el.style.willChange = foeWill; voices.unduck(); },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    startY,
    landY,
    pull,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
