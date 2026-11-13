/**
 * THE PINBALL RUNNER ("Multiball", a Legendary): plays one Pinball attack (the beats are in `heroPinballConfig.ts`)
 * and lands the consequence on its impact beat (the ball slamming the target). Presentation only: the total and the
 * blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses or changes pace), the damage
 * formation, the `#stage` camera (applied ONCE: `stageCamera.ts`), the voices, the dim, reduced motion, finish / cancel
 * and the safety timer.
 *
 * THE DAMAGE NUMBER: the jackpot (IV) stops on `o.total`, the blow the engine decided (the same number the shared
 * formation shows), read through the plan (`plan.total`).
 *
 * THE PORTRAITS: the striker leans into the flip and, on IV, shoves the table; the struck one is knocked back on the
 * impact. On IV's TILT both are turned about the target by the same angle as the scene's own root, with their own
 * transforms (the game's DOM is never rotated). A portrait outside the `#stage` camera (the foe's is a <body> portal)
 * folds the camera's zoom and shake into its own transform. The striker is raised over the target for the whole attack
 * (Classic's `.duel-attacker-*` z-order). EVERY exit path (the end, `finish()`, `cancel()`, the safety timer, and an
 * unmount, which cancels) restores both transforms, the opacity and the z-order class exactly, hides every own object
 * and levels the scene's root.
 *
 * THE CONTRACT: the consequence (`onImpact`) lands exactly ONCE: when the (first) ball hits the target. Nothing before
 * it (the flip, the bumpers, the ramp, the tilt, the roll-up) lands it or makes the target react.
 *
 * Perf: DOM writes are `transform` from the clock; layout is read once at the start; pooled sprites under a hard cap
 * plus the table's own objects, all made once; the balls' paths are built once and read with no allocation; textures
 * are painted once per session and pre-warmed during the formation; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  BUMPERS, MAX_BALLS, PINBALL_CAPS, arrowLit, ballAt, bumperAt, displayAt, flipperAngle, getHeroPinballConfig, jackpotDigits, lampAt, newBallState,
  newBumperState, pinballCameraAt, pinballCues, pinballGeo, pinballPaths, pinballPlan, rampAt, strikerPose, tableIn, tiltAt,
  type BallState, type HeroPinballConfig, type PinballCue, type PinballGeo, type PinballPaths, type PinballPlan,
} from './heroPinballConfig';
import { HeroPinballScene, type HeroPinballTextures } from './heroPinballScene';
import { heroPinballTextures } from './heroPinballTextures';

export interface HeroPinballOptions extends HeroAttackOptions {
  cfg?: HeroPinballConfig;
  textures?: HeroPinballTextures | null;
}

export interface HeroPinballHandle extends HeroAttackHandle {
  readonly plan: PinballPlan;
  readonly geo: PinballGeo;
  readonly paths: PinballPaths;
  readonly scene: HeroPinballScene | null;
  readonly mirrorsCamera: boolean;
  /** Ball `i` at a sequence time (pure). */
  ball(i: number, t: number): BallState;
  /** What the jackpot's reels read at a sequence time, leftmost first (pure). */
  digits(t: number): number[];
}

/** The fallback bounce seed when the caller gives no `rollSeed`: stable for the same blow between the same portraits. */
export function pinballSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 2711 + Math.round(distance) * 43 + (side === 'opp' ? 199 : 23)) >>> 0;
}

/** One measure of a portrait: its screen size, and `inv` = its own transform px per screen px. */
function rectOf(el: HTMLElement | null | undefined, r: number): { width: number; height: number; inv: number } {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { width: r * 2, height: r * 2, inv: 1 };
    return { width: b.width, height: b.height, inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  } catch { return { width: r * 2, height: r * 2, inv: 1 }; }
}

/** Play the Pinball attack. Returns a handle; the blow lands via `onImpact` when the ball slams the target. */
export function playHeroPinball(o: HeroPinballOptions): HeroPinballHandle {
  const c = o.cfg ?? getHeroPinballConfig();
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
  const aRect = local ? { inv: 1 } : rectOf(o.attackerEl, aRadius);
  const dRect = local ? { inv: 1 } : rectOf(o.defenderEl, radius);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  // THE BOUNCE ORDER is rolled from the stable per-blow seed (the run seed and the round), so a replay bounces the same.
  const seed = o.rollSeed ?? pinballSeed(o.total, dist, o.side);
  const plan = pinballPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt, seed }, c);
  const cues = withFormation(fplan, pinballCues(plan));
  // The frame the table must stay inside (the screen, or the sandbox box).
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const geo = pinballGeo(o.attacker, o.defender, aRadius, radius, { x0: 0, y0: 0, x1: vw, y1: vh }, c);
  const paths = pinballPaths(plan, geo);
  const blowDir = paths.blowDir;
  // Scratch state, written every frame (no allocation in the paint).
  const ballS = Array.from({ length: MAX_BALLS }, newBallState);
  const bumpS = Array.from({ length: BUMPERS }, newBumperState);
  const reels: number[] = [];
  const ball = (i: number, t: number): BallState => ballAt(paths.tracks[i], t, newBallState(), i === 0 ? 160 : 0);

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hpinball',
  });

  const textures = o.textures !== undefined ? o.textures : heroPinballTextures();
  const scene = textures && !reduced
    ? new HeroPinballScene(textures, { flash: hexToNum(c.colorFlash), lamp: hexToNum(c.colorLamp), spark: hexToNum(c.colorSpark), side: hexToNum(sideHex) },
      c.scoreSize, aRadius, radius, s, seed)
    : null;
  scene?.placeTable(geo);
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  // The striker's opacity is saved and restored too (it never changes here, but every exit path puts it back exactly).
  const heroOpacity0 = hero.el ? hero.el.style.opacity : '';
  const heroUnit = 1 / (aRect.inv || 1);
  const foeUnit = 1 / (dRect.inv || 1);
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));
  // Raised over the struck portrait for the whole attack (Classic's own duel z-order classes).
  const zClass = o.side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player';
  const lift = !reduced && !local && !!hero.el && !!doc;
  let lifted = false;

  const cue: AttackVoices['cue'] = (clip, gain, rate, opts) => voices.cue(clip, gain, rate, opts);
  voices.warm([c.sfxFlipperClip, c.sfxBumperClip, c.sfxRampClip, c.sfxReelClip, c.sfxWhooshClip, c.sfxBoomClip]);
  const big = plan.kind === 'jackpot';
  /** The striker's centre minus the target's (the arm the tilt swings it on). */
  const armX = o.attacker.x - o.defender.x, armY = o.attacker.y - o.defender.y;

  const fire = (q: PinballCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      case 'table':
        // The table pops up out of the board: a soft swish, a ring under each piece.
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.7, c.sfxWhooshRate * 0.9, { lenMs: 380, fadeMs: 180 });
        scene?.popAt(geo.pivot, geo.batLen * 0.4);
        for (let i = 0; i < plan.bumpers; i++) scene?.popAt(geo.bumpers[i]!, geo.bumperR, 70 * i);
        break;
      case 'chase':
        // IV: the lights run: three soft bells climbing, spread over the chase.
        for (let i = 0; i < 3; i++) {
          cue(c.sfxBumperClip, c.sfxBumperGain * 0.4, c.sfxBumperRate * (1.3 + 0.12 * i), { delayMs: (i * Math.max(0, plan.strikeAt - q.at)) / 3.2 / speed, lenMs: 300, fadeMs: 140 });
        }
        break;
      case 'flip':
        // THE FLIPPER: the clack (its transient is 25 ms into the clip, so it starts a little in) and the ball's swish.
        cue(c.sfxFlipperClip, c.sfxFlipperGain * (big ? 1.15 : 1), c.sfxFlipperRate, { startMs: 12 });
        cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate, { lenMs: 360, fadeMs: 160 });
        scene?.flip(geo.cradle, geo.u, 1 + 0.4 * plan.k);
        break;
      case 'ramp':
        // III: the ball takes the wire: it rolls for as long as it is on the ramp.
        cue(c.sfxRampClip, c.sfxRampGain, c.sfxRampRate, { lenMs: (Math.max(200, (plan.multiAt ?? q.at) - q.at) + 80) / speed, fadeMs: 140 });
        break;
      case 'multi': {
        // MULTIBALL: one becomes three (a bright bell, a swish).
        cue(c.sfxBumperClip, c.sfxBumperGain * 0.9, c.sfxBumperRate * 1.35, { lenMs: 420, fadeMs: 160 });
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.8, c.sfxWhooshRate * 1.2, { lenMs: 300, fadeMs: 140 });
        const r = geo.ramp;
        scene?.split({ x: r.xs[r.n - 1]!, y: r.ys[r.n - 1]! });
        break;
      }
      case 'bump': {
        // A POP BUMPER fires: each has its own pitch, so a rattle plays a little tune instead of one note repeated.
        const h = plan.hits[q.i]!;
        const at = geo.bumpers[h.bumper]!;
        cue(c.sfxBumperClip, c.sfxBumperGain * (big ? 0.7 : plan.balls > 1 ? 0.75 : 0.9), c.sfxBumperRate * (0.92 + 0.09 * h.bumper + 0.03 * (q.i % 2)), { lenMs: 320, fadeMs: 150 });
        const k = paths.kicks[q.i]!;
        const reach = geo.bumperR * 0.92;
        scene?.bump(at, { x: at.x - k.x * reach, y: at.y - k.y * reach }, h.score, big);
        break;
      }
      case 'tilt':
        // IV: the striker shoves the table: a dull thud under the bells.
        cue(c.sfxBoomClip, c.sfxBoomGain * 0.5, c.sfxBoomRate * 1.5, { lenMs: 320, fadeMs: 160 });
        break;
      case 'roll':
        // IV: the score reels rattle up until the ball lands.
        cue(c.sfxReelClip, c.sfxReelGain, c.sfxReelRate, { lenMs: (Math.max(120, plan.impactAt - q.at) + 60) / speed, fadeMs: 90 });
        break;
      case 'impact': {
        // THE BALL SLAMS THE TARGET: the bell, low and full, over a thud. IV: a second bell as the jackpot stops.
        cue(c.sfxBumperClip, c.sfxBumperGain * (1 + 0.25 * plan.k), c.sfxBumperRate * 0.72, { tail: big ? 0.12 : 0 });
        cue(c.sfxBoomClip, c.sfxBoomGain * (0.4 + 0.75 * plan.k), c.sfxBoomRate * (big ? 1 : 1.25), { lenMs: big ? 900 : 480, fadeMs: big ? 300 : 200 });
        if (big) cue(c.sfxBumperClip, c.sfxBumperGain * 0.9, c.sfxBumperRate * 1.08, { delayMs: 110 / speed });
        scene?.impact(geo.hit, blowDir, { burst: plan.burst, rings: plan.rings, big });
        if (big) scene?.jackpot();
        seq.land();
        break;
      }
      case 'echo':
        // III: the second and third balls arrive (a bell each, climbing). They land nothing.
        cue(c.sfxBumperClip, c.sfxBumperGain * 0.8, c.sfxBumperRate * (0.82 + 0.1 * (q.i + 1)), { lenMs: 400, fadeMs: 160 });
        scene?.echo(geo.hit, blowDir);
        break;
      default:
        break;
    }
  };

  let lastGlint = -Infinity;
  const unitS = local ? 1 : s;
  const kickPx = c.kickPx * unitS;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.strikeAt, plan.impactAt + 300);
    const cm = pinballCameraAt(plan, c, t, blowDir);
    const focus = o.defender;
    cam.apply(focus, cm.zoom, cm.x, cm.y, unitS);
    // The camera's screen offset: a portrait OUTSIDE `#stage` folds it in by hand (so it stays glued to the scene).
    const camOn = cam.active;
    const ax = focus.x * (1 - cm.zoom) + cm.x * unitS, ay = focus.y * (1 - cm.zoom) + cm.y * unitS;
    const th = tiltAt(plan, c, t);
    const deg = (th * 180) / Math.PI;
    if (hero.el) {
      const p = strikerPose(plan, t, aRadius);
      // The lean, the jolt and the shove, plus the tilt swinging the striker round the target.
      let x = geo.u.x * p.along + geo.n.x * p.across, y = geo.u.y * p.along + geo.n.y * p.across;
      if (th !== 0) { const cs = Math.cos(th), sn = Math.sin(th); x += armX * cs - armY * sn - armX; y += armX * sn + armY * cs - armY; }
      const fold = !heroInCam && camOn;
      if (fold) { x = x * cm.zoom + o.attacker.x * (cm.zoom - 1) + ax; y = y * cm.zoom + o.attacker.y * (cm.zoom - 1) + ay; }
      const z = fold ? cm.zoom : 1;
      const rot = p.rot * (geo.u.x >= 0 ? 1 : -1) + deg;
      const still = Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(z - 1) < 1e-4 && Math.abs(rot) < 0.01;
      hero.set(still ? null : `translate(${(x / heroUnit).toFixed(2)}px, ${(y / heroUnit).toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${z.toFixed(4)})`);
    }
    if (foe.el) {
      // The target takes the blow: knocked back along the shot and squashed (III: a smaller knock per echo). Nothing before it.
      let kx = 0, ky = 0, sq = 0;
      const px = local ? 0.45 : 1;
      if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, big ? 4 : 5, big ? 95 : 70);
        const w = big ? 0.8 + 0.5 * plan.k : 0.35 + 0.25 * plan.k;
        kx += blowDir.x * c.knockPx * w * k * px; ky += blowDir.y * c.knockPx * w * k * px; sq += c.squash * (big ? 1 + 0.4 * plan.k : 0.4) * k;
        for (let i = 0; i < plan.echoes.length; i++) {
          const since = t - plan.echoes[i]!;
          if (since < 0) break;
          const e = spring(since, 5, 60);
          kx += blowDir.x * c.knockPx * 0.3 * e * px; ky += blowDir.y * c.knockPx * 0.3 * e * px; sq += c.squash * 0.25 * e;
        }
      }
      const fold = !foeInCam && camOn;
      let x = kx, y = ky;
      if (fold) { x = x * cm.zoom + o.defender.x * (cm.zoom - 1) + ax; y = y * cm.zoom + o.defender.y * (cm.zoom - 1) + ay; }
      const z = fold ? cm.zoom : 1;
      const still = Math.abs(kx) < 0.05 && Math.abs(ky) < 0.05 && Math.abs(sq) < 0.002 && Math.abs(deg) < 0.01 && Math.abs(z - 1) < 1e-4;
      foe.set(still ? null
        : `translate(${(x / foeUnit).toFixed(2)}px, ${(y / foeUnit).toFixed(2)}px) rotate(${deg.toFixed(2)}deg) scale(${((1 + sq * 0.55) * z).toFixed(4)}, ${((1 - sq) * z).toFixed(4)})`);
    }
    if (scene) {
      scene.setTilt(th, focus);
      scene.setFlipper(flipperAngle(plan, geo, t), tableIn(plan, t));
      for (let i = 0; i < MAX_BALLS; i++) scene.setBall(i, ballAt(paths.tracks[i], t, ballS[i]!, i === 0 ? 160 : 0));
      for (let i = 0; i < BUMPERS; i++) scene.setBumper(i, bumperAt(plan, geo, paths, i, t, kickPx, bumpS[i]!));
      const lamp = lampAt(plan, t);
      scene.setLamps(tableIn(plan, t, 40), lamp.lit, lamp.step);
      const lanes = plan.bumpers > 0 ? geo.arrows.length : 0;
      for (let j = 0; j < PINBALL_CAPS.arrows; j++) scene.setArrow(j, j < lanes ? tableIn(plan, t, 120 + 40 * j) : 0, arrowLit(plan, j, lanes, t));
      const rp = rampAt(plan, t);
      scene.setRamp(rp.reveal, rp.alpha);
      const ds = displayAt(plan, t);
      scene.setDisplay(ds, ds.score ? jackpotDigits(plan, t, reels) : null);
      // The ball on the wire throws glints off the rails.
      if (plan.rampInAt !== null && plan.multiAt !== null && t >= plan.rampInAt && t < plan.multiAt && t - lastGlint >= 42 && ballS[0]!.visible) {
        scene.rail(ballS[0]!);
        lastGlint = t;
      }
      scene.refresh();
    }
  };

  const seq: Sequence<PinballCue | FormationCue> = new Sequence<PinballCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      if (hero.el) hero.el.style.opacity = heroOpacity0;
      scene?.hideOwn();
      if (lifted) { doc!.body.classList.remove(zClass); lifted = false; }
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    paths,
    scene,
    ball,
    digits: (t: number) => jackpotDigits(plan, t, []),
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
