/**
 * THE CHECKMATE RUNNER: plays one Checkmate hero attack (the beats are in `heroChessConfig.ts`) and lands the
 * consequence on its impact beat (the pawn's capture, the knight's landing, the queen's slide arriving). Presentation
 * only: the total it shows and the blow it lands are handed in, already decided by the engine; this file only decides
 * WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera, the portraits (transform only, restored after), the voices, the
 * dim, reduced motion, finish / cancel and the safety timer. What is Checkmate's own: the board, the pieces and their
 * moves, the king and the word, its camera and its sound.
 *
 * THE CAMERA IS APPLIED ONCE. Since the scaled stage (#1762) the shared FX canvas lives INSIDE `#stage`, so the DOM
 * camera already zooms and shakes it; the Pixi root mirrors the camera only when its canvas is NOT inside the camera
 * element (a sandbox that mounts its own canvas elsewhere). `StageCamera` decides that once, at `start()`.
 *
 * Perf (docs/performance.md): DOM moves are `transform` only, written from the clock; nothing reads layout after the
 * opening measure (the view size is read once, here); the board is laid out once; Pixi sprites are pooled and capped,
 * textures painted once per session and pre-warmed during the formation; the per-frame poses write into reused objects;
 * and the updater unhooks the moment the scene has faded.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  KING_ROCKS, chessBoard, chessCameraAt, chessCameraFocus, chessCues, chessPlan, getHeroChessConfig,
  type ChessCue, type ChessGeo, type ChessPlan, type HeroChessConfig,
} from './heroChessConfig';
import { HeroChessScene, type HeroChessTextures } from './heroChessScene';
import { heroChessTextures, type Wood } from './heroChessTextures';

export interface HeroChessOptions extends HeroAttackOptions {
  cfg?: HeroChessConfig;
  textures?: HeroChessTextures | null;
}

export interface HeroChessHandle extends HeroAttackHandle {
  readonly plan: ChessPlan;
  /** The board for this blow (laid out once, at the start). Exposed for tests and the capture rig. */
  readonly geo: ChessGeo;
  /** The striker's wood: ivory when you strike, ebony when the foe does. */
  readonly wood: Wood;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroChessScene | null;
}

/** The seed a blow's sparks are scattered from: the fight's own roll seed when it has one, so a replay looks the same. */
export function chessSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, rollSeed?: number): number {
  const own = (Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 17)) >>> 0;
  return rollSeed === undefined || !Number.isFinite(rollSeed) ? own : ((rollSeed >>> 0) ^ Math.imul(own, 0x9e3779b1)) >>> 0;
}

/** Play Checkmate. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroChess(o: HeroChessOptions): HeroChessHandle {
  const c = o.cfg ?? getHeroChessConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const wood: Wood = o.side === 'opp' ? 'ebony' : 'ivory';
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = chessPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, chessCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hchess',
  });

  // The view the board and the pieces must stay inside (measured once, at the start).
  const view = local ? { w: o.host?.clientWidth || 400, h: o.host?.clientHeight || 300 } : { w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 };
  const geo = chessBoard(plan, o.attacker, o.defender, radius, aRadius, c, view, nums.pts.hit);
  const dir = geo.dir;
  const toFoe: Pt = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  const contact = geo.stops[geo.stops.length - 1] ?? o.defender;

  // ── Pixi ──
  const textures = o.textures !== undefined ? o.textures : heroChessTextures();
  const scene = textures && !reduced
    ? new HeroChessScene(textures, { ivory: hexToNum(c.colorIvory), ebony: hexToNum(c.colorEbony), gold: hexToNum(c.colorGold), side: hexToNum(sideHex) },
      plan, geo, c, wood, s, chessSeed(o.total, dist, o.side, o.rollSeed))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxSetClip, c.sfxHopClip, c.sfxWhooshClip, c.sfxSlideClip, c.sfxGleamClip, c.sfxThudClip, c.sfxPunchClip,
    c.sfxImpactClip, c.sfxBigClip, c.sfxToppleClip, c.sfxKnockClip, c.sfxRollClip, c.sfxBodyClip,
  ]);
  /** THE LOW LAYER (the shared ground impact; its hit is 380 ms into the clip, so it starts there). */
  const body = (gain: number, rate = 1, lenMs = 600, delayMs = 0): void => cue(c.sfxBodyClip, c.sfxBodyGain * gain, c.sfxBodyRate * rate, { startMs: 380, lenMs, fadeMs: Math.round(lenMs * 0.45), delayMs });
  let hop = 0;

  const fire = (q: ChessCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'tap':
        // The piece is set down: one solid wooden tap (lower and fuller up the looks; the queen lands with a low thump).
        cue(c.sfxSetClip, c.sfxSetGain * (plan.level === 3 ? 1.2 : 1), c.sfxSetRate * (plan.level === 3 ? 0.82 : plan.level === 2 ? 0.94 : 1.06), { fadeMs: 80 });
        cue(c.sfxKnockClip, c.sfxKnockGain * (plan.level === 3 ? 0.7 : plan.level === 2 ? 0.5 : 0.35), c.sfxKnockRate * (plan.level === 3 ? 0.85 : 1.1));
        if (plan.level === 3) body(0.4, 1.3, 380);
        scene?.tap(geo.start.x, geo.start.y, plan.level === 3 ? 1.5 : 1.1);
        break;
      case 'hop':
        // A pawn hop leaves the board: a short swish.
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.5, c.sfxWhooshRate + 0.6, { lenMs: 160, fadeMs: 80 });
        break;
      case 'land': {
        // A pawn's hop lands: a solid tap, a little higher each square.
        cue(c.sfxHopClip, c.sfxHopGain, c.sfxHopRate + 0.08 * hop, { fadeMs: 70 });
        cue(c.sfxKnockClip, c.sfxKnockGain * 0.6, c.sfxKnockRate * (1.25 + 0.08 * hop));
        const at = geo.stops[q.i];
        if (at) scene?.tap(at.x, at.y, 0.8);
        hop++;
        break;
      }
      case 'rear':
        // The knight rears: a low swish as it winds up.
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.6, c.sfxWhooshRate * 0.7, { lenMs: 320, fadeMs: 160 });
        break;
      case 'gleam':
        // The gleam runs up the queen, and a low swish rises under it as she coils (the held breath before the slide).
        // (The sparkle clip is near silent for its first 1.4 s: it is played from where it is rising.)
        cue(c.sfxGleamClip, c.sfxGleamGain, c.sfxGleamRate, { startMs: 1500, lenMs: 600, fadeMs: 220 });
        // The coil: the slide's own wood (a swell that peaks 360 ms into the clip), slowed, placed so it peaks as she leaves.
        cue(c.sfxSlideClip, c.sfxSlideGain * 0.7, c.sfxSlideRate * 0.62, { delayMs: Math.max(0, plan.strikeAt - q.at - 360 / (c.sfxSlideRate * 0.62)) / speed, lenMs: 420, fadeMs: 60 });
        break;
      case 'strike':
        // The move that takes the portrait leaves: the knight's jump is a whoosh; the queen's slide is wood on wood
        // under a fast whoosh, timed so the slide's swell ends as she arrives.
        if (plan.level === 2) cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate, { lenMs: 460, fadeMs: 160 });
        else if (plan.level === 3) {
          cue(c.sfxSlideClip, c.sfxSlideGain, c.sfxSlideRate, { startMs: 80, fadeMs: 90 });
          cue(c.sfxWhooshClip, c.sfxWhooshGain * 1.1, c.sfxWhooshRate * 1.35, { lenMs: 300, fadeMs: 110 });
        } else cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.7, c.sfxWhooshRate + 0.5, { lenMs: 200, fadeMs: 90 });
        break;
      case 'impact':
        // THE capture: a hard wooden knock over a low body, under the hit. The pawn pokes; the knight thuds down; the
        // queen cracks through.
        cue(c.sfxKnockClip, c.sfxKnockGain * (0.8 + 0.2 * plan.level), c.sfxKnockRate * (plan.level === 1 ? 1.1 : plan.level === 2 ? 0.9 : 0.75), { tail: plan.level === 3 ? 0.12 : 0 });
        body(plan.level === 1 ? 0.6 : plan.level === 2 ? 1 : 1.2, plan.level === 1 ? 1.35 : plan.level === 2 ? 1.15 : 1, plan.level === 3 ? 900 : 520);
        cue(c.sfxSetClip, c.sfxSetGain * 0.9, c.sfxSetRate * (plan.level === 1 ? 1.15 : 0.8), { fadeMs: 80 });
        cue(c.sfxPunchClip, c.sfxPunchGain * (0.8 + 0.2 * plan.level), c.sfxPunchRate - 0.1 * (plan.level - 1), { lenMs: 320, fadeMs: 120 });
        cue(c.sfxImpactClip, c.sfxImpactGain * (0.75 + 0.12 * plan.level), c.sfxImpactRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 280 });
        if (plan.level === 2) cue(c.sfxThudClip, c.sfxThudGain, c.sfxThudRate, { lenMs: 520, fadeMs: 180 });
        if (plan.level === 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 650, fadeMs: 240 });
        scene?.impact(plan.level === 2 ? o.defender.x : contact.x + dir.x * radius * 0.3, plan.level === 2 ? o.defender.y : contact.y + dir.y * radius * 0.3, radius, dir,
          { level: plan.level, burst: plan.burst, sparks: plan.sparks, flashAlpha: c.flashAlpha });
        if (plan.level === 3) scene?.screenFlash(0.38, view.w, view.h);
        seq.land();
        break;
      case 'wobble':
        // The king rocks on its base: a knock each time it comes down, louder and lower as it rocks wider.
        cue(c.sfxSetClip, c.sfxSetGain * (0.45 + 0.15 * q.i), c.sfxSetRate * (1.0 - 0.06 * q.i), { fadeMs: 70 });
        cue(c.sfxKnockClip, c.sfxKnockGain * (0.25 + 0.1 * q.i), c.sfxKnockRate * (1.2 - 0.07 * q.i));
        // The last rock: it hangs, then goes. A low rush of air through the fall, ending as it hits the board.
        if (q.i === KING_ROCKS - 1) cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.8, c.sfxWhooshRate * 0.62, { delayMs: Math.max(0, plan.fallAt - seq.t - 420) / speed, lenMs: 520, fadeMs: 120 });
        break;
      case 'topple':
        // The king is DOWN: a heavy clack and a knock over a low thud, then it rolls and rocks to rest.
        cue(c.sfxToppleClip, c.sfxToppleGain, c.sfxToppleRate, { fadeMs: 120 });
        cue(c.sfxKnockClip, c.sfxKnockGain * 1.3, c.sfxKnockRate * 0.7, { tail: 0.1 });
        body(1.1, 1.2, 700);
        cue(c.sfxRollClip, c.sfxRollGain, c.sfxRollRate, { delayMs: 90 / speed });
        if (geo.king) scene?.kingDown(geo.king.x + geo.kingFall * geo.sq * 0.4, geo.king.y, geo.kingFall);
        break;
      case 'word':
        // CHECKMATE slams in: a low stamp.
        cue(c.sfxKnockClip, c.sfxKnockGain * 0.8, c.sfxKnockRate * 0.6, { tail: 0.15 });
        body(0.6, 0.9, 700);
        if (geo.word) scene?.wordSlam(geo.word.x, geo.word.y, geo.wordW);
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    scene?.drive(t);
    nums.paintDim(t, plan.chargeAt, plan.strikeAt, plan.impactAt + (plan.king ? 1100 : 260));
    const cm = chessCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(chessCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The ready: a small lean back and swell; then a nod toward the board as the piece is set down, and a second,
      // smaller one as it makes its move.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.setAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.setAt - plan.chargeAt));
        sc = 1 + 0.03 * u;
        bx = -toFoe.x * c.heroCoilPx * px * u; by = -toFoe.y * c.heroCoilPx * px * u;
      } else {
        const back = Math.max(0, spring(t - plan.setAt, 3, 90));
        sc = 1 + 0.03 * back;
        bx = -toFoe.x * c.heroCoilPx * px * back; by = -toFoe.y * c.heroCoilPx * px * back;
        const nod = c.heroNodPx * px * (spring(t - plan.setAt, 5, 60) + (t >= plan.strikeAt ? 0.6 * spring(t - plan.strikeAt, 5, 60) : 0));
        bx += toFoe.x * nod; by += toFoe.y * nod;
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let css: string | null = null;
      if (t >= plan.impactAt) {
        // The queen's capture REELS the portrait (a slower, longer ring); the small looks snap back.
        const k = spring(t - plan.impactAt, plan.level === 3 ? 3.4 : 4.5, plan.level === 3 ? 170 : 90);
        const knock = c.knockPx * (0.7 + 0.5 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        fx = dir.x * knock; fy = dir.y * knock;
        css = Math.abs(k) < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 + sq * 0.6).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      }
      foe.set(css);
    }
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<ChessCue | FormationCue> = new Sequence<ChessCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => { nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck(); scene?.setFoeOffset(0, 0); },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    wood,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
