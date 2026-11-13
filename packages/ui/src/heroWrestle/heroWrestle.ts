/**
 * THE WRESTLING RUNNER ("Top Rope", a Legendary): plays one Wrestle attack (the beats are in `heroWrestleConfig.ts`) and
 * lands the consequence on its impact beat (the chop, the slam, the elbow, the clothesline). Presentation only: the
 * total and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses and never changes speed), the
 * damage formation, the `#stage` camera (applied ONCE: `stageCamera.ts`), the voices, the dim, reduced motion, finish /
 * cancel and the safety timer.
 *
 * BOTH PORTRAITS MOVE: the striker walks over and wrestles the struck one (it is lifted, slammed, shoved flat, whipped
 * into the ropes, clotheslined and pinned). Each pose is solved in screen px and written as a transform in the
 * portrait's own units (its ancestors' scale measured ONCE at the start); the squash is in SCREEN axes, so a portrait on
 * its back still flattens against the mat. A portrait outside the `#stage` camera (the foe's <body> portal) folds the
 * camera's zoom and shake into its own transform. The striker is raised over the target for the whole attack (Classic's
 * `.duel-attacker-*` z-order). EVERY exit path (the end, `finish()`, `cancel()`, the safety timer, and an unmount, which
 * cancels) restores both transforms, the striker's opacity and the z-order class exactly, and hides the ring, the
 * spotlight, the elbow star and the shadow.
 *
 * THE CONTRACT: the consequence (`onImpact`) lands exactly ONCE, on the impact. The shove, the ropes, the landing on the
 * mat, the count and the bell are ticks.
 *
 * Perf: DOM writes are `transform` from the clock; layout is read once at the start; pooled sprites under a hard cap
 * plus the own objects (the ring's 16 sprites, the light, the star, the shadow); textures painted once per session and
 * pre-warmed during the formation; the updater unhooks the moment the scene drains.
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
  getHeroWrestleConfig, ringLayout, strikerPose, victimPose, wrestleCameraAt, wrestleCues, wrestleElbow, wrestleGeo, wrestlePlan, wrestleRing,
  wrestleShadow, wrestleSpot,
  type HeroWrestleConfig, type WrestleCtx, type WrestleCue, type WrestleGeo, type WrestlePlan, type WrestlePose,
} from './heroWrestleConfig';
import { HeroWrestleScene, type HeroWrestleTextures } from './heroWrestleScene';
import { heroWrestleTextures } from './heroWrestleTextures';

export interface HeroWrestleOptions extends HeroAttackOptions {
  cfg?: HeroWrestleConfig;
  textures?: HeroWrestleTextures | null;
}

export interface HeroWrestleHandle extends HeroAttackHandle {
  readonly plan: WrestlePlan;
  readonly geo: WrestleGeo;
  readonly scene: HeroWrestleScene | null;
  readonly mirrorsCamera: boolean;
  /** The striking and the struck portraits' poses at a sequence time (pure). */
  striker(t: number): WrestlePose;
  victim(t: number): WrestlePose;
}

export function wrestleSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 2711 + Math.round(distance) * 41 + (side === 'opp' ? 197 : 23)) >>> 0;
}

/** One measure of a portrait: its screen size, and `inv` = its own transform px per screen px. */
function rectOf(el: HTMLElement | null | undefined, r: number): { width: number; height: number; inv: number } {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { width: r * 2, height: r * 2, inv: 1 };
    return { width: b.width, height: b.height, inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  } catch { return { width: r * 2, height: r * 2, inv: 1 }; }
}

/**
 * A portrait pose as a CSS transform in its own units (`unit` = screen px per own px), or null when at rest. The squash
 * is written OUTSIDE the rotation, so it is in screen axes (a portrait lying flat squashes against the floor).
 */
function poseCss(off: Pt, p: WrestlePose, sc: number, unit: number): string | null {
  const moved = Math.abs(off.x) > 0.05 || Math.abs(off.y) > 0.05 || Math.abs(sc - 1) > 1e-4 || Math.abs(p.rot) > 0.01;
  const sq = Math.abs(p.squash) > 0.002 ? ` scale(${(1 + p.squash * 0.6).toFixed(4)}, ${(1 - p.squash).toFixed(4)})` : '';
  if (!moved && !sq) return null;
  return `translate(${(off.x / unit).toFixed(2)}px, ${(off.y / unit).toFixed(2)}px)${sq} rotate(${p.rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
}

/** Play the Wrestle attack. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroWrestle(o: HeroWrestleOptions): HeroWrestleHandle {
  const c = o.cfg ?? getHeroWrestleConfig();
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
  const plan = wrestlePlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, wrestleCues(plan));
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const frame = { x0: 0, y0: 0, x1: vw, y1: vh };
  const geo = wrestleGeo(o.attacker, o.defender, aRadius, radius, frame, plan.kind, c);
  const ctx: WrestleCtx = { p: plan, g: geo, c, a: o.attacker, d: o.defender, aR: aRadius, dR: radius };
  const striker = (t: number): WrestlePose => strikerPose(ctx, t);
  const victim = (t: number): WrestlePose => victimPose(ctx, t);
  const sides = ringLayout(geo, aRadius, radius);
  const sd = geo.s;
  // The way the blow drives the view: the chop goes sideways (away from the striker), the clothesline back the way the
  // struck portrait came, the slam and the elbow straight down into the mat.
  const blowDir: Pt = plan.kind === 'chop' ? { x: -sd, y: 0 } : plan.kind === 'pin' ? { x: sd, y: 0 } : { x: 0, y: 1 };

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hwrestle',
  });

  const textures = o.textures !== undefined ? o.textures : heroWrestleTextures();
  const scene = textures && !reduced
    ? new HeroWrestleScene(textures, {
      mat: hexToNum(c.colorMat), flash: hexToNum(c.colorFlash), pow: hexToNum(c.colorPow), hand: hexToNum(c.colorHand), spot: hexToNum(c.colorSpot), side: hexToNum(sideHex),
    }, { ropeSize: c.ropeSize, wordSize: c.wordSize, frameW: vw, frameH: vh }, aRadius, radius, s, o.rollSeed ?? wrestleSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const heroOpacity0 = hero.el ? hero.el.style.opacity : '';
  const heroUnit = 1 / (aRect.inv || 1);
  const foeUnit = 1 / (dRect.inv || 1);
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));
  const zClass = o.side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player';
  const lift = !reduced && !local && !!hero.el && !!doc;
  let lifted = false;

  const cue: AttackVoices['cue'] = (clip, gain, rate, opts) => voices.cue(clip, gain, rate, opts);
  voices.warm([c.sfxWhooshClip, c.sfxChopClip, c.sfxSlamClip, c.sfxBoomClip, c.sfxBellClip, c.sfxWooClip, c.sfxCheerClip]);
  const real = (ms: number): number => ms / speed;
  const whoosh = (gain: number, rate: number, lenMs = 420): void => cue(c.sfxWhooshClip, c.sfxWhooshGain * gain, c.sfxWhooshRate * rate, { lenMs, fadeMs: lenMs * 0.4 });
  const foeAt = (t: number): Pt => { const p = victim(t); return { x: o.defender.x + p.x, y: o.defender.y + p.y }; };

  const fire = (q: WrestleCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      case 'walk':
        whoosh(0.7, 0.8, 500);
        break;
      case 'grip':
        // They lock up (a soft thud of two bodies meeting). The chop has no lock-up: it winds up instead.
        if (plan.kind !== 'chop') cue(c.sfxSlamClip, c.sfxSlamGain * 0.22, c.sfxSlamRate * 1.9, { lenMs: 140, fadeMs: 70 });
        break;
      case 'swing':
        whoosh(1, 1.5, 260);
        scene?.slapArc({ x: (geo.grab.x + o.defender.x) / 2 + sd * radius * 0.2, y: o.defender.y }, -sd, radius);
        break;
      case 'lift':
        whoosh(0.9, 0.7, 520);
        break;
      case 'top':
        // The held beat: the crowd draws breath.
        cue(c.sfxWooClip, c.sfxWooGain * 0.35, c.sfxWooRate * 0.8, { lenMs: 500, fadeMs: 300 });
        break;
      case 'drop':
        whoosh(1.2, 1.25, 300);
        break;
      case 'bounce':
        cue(c.sfxSlamClip, c.sfxSlamGain * 0.4, c.sfxSlamRate * 1.35, { lenMs: 300, fadeMs: 150 });
        scene?.matRing(geo.mat, radius, 0.5, 1);
        break;
      case 'down':
        // III: shoved flat on its back (a tick), and the striker goes for the top.
        cue(c.sfxSlamClip, c.sfxSlamGain * 0.5, c.sfxSlamRate * 1.25, { lenMs: 360, fadeMs: 160 });
        scene?.matRing(geo.mat, radius, 0.6, 1);
        whoosh(0.9, 0.75, 520);
        break;
      case 'perch':
        // Out of the top of the screen: the spotlight comes on and the crowd goes "ooh".
        cue(c.sfxWooClip, c.sfxWooGain * 0.6, c.sfxWooRate * 0.86, { fadeMs: 400 });
        break;
      case 'dive':
        whoosh(1.4, 1.1, 420);
        break;
      case 'whip':
        whoosh(1.2, 1.2, 420);
        scene?.rush(foeAt(t), sd, radius);
        break;
      case 'rope':
        // The far ropes take it (a tick): a dull twang as they stretch.
        cue(c.sfxSlamClip, c.sfxSlamGain * 0.3, c.sfxSlamRate * 0.75, { lenMs: 300, fadeMs: 200 });
        scene?.ropeTwang(geo.ropeHit, sd);
        break;
      case 'fling':
        whoosh(1.3, 1.45, 320);
        scene?.rush(geo.ropeHit, -sd, radius);
        break;
      case 'land':
        // Flat on its back on the mat (a tick).
        cue(c.sfxSlamClip, c.sfxSlamGain, c.sfxSlamRate);
        scene?.matRing(geo.mat, radius, 1.1, 2);
        scene?.dizzy(geo.mat, radius);
        break;
      case 'cover':
        cue(c.sfxSlamClip, c.sfxSlamGain * 0.45, c.sfxSlamRate * 1.3, { lenMs: 300, fadeMs: 150 });
        scene?.matRing(geo.mat, radius, 0.5, 1);
        break;
      case 'count': {
        // ONE, TWO, THREE: the number slams down and the mat is slapped (the slam, pitched up and short).
        cue(c.sfxSlamClip, c.sfxSlamGain * (0.5 + 0.08 * q.i), c.sfxSlamRate * (1.7 + 0.06 * q.i), { lenMs: 220, fadeMs: 110 });
        scene?.count(geo.count, q.i);
        scene?.matSlap({ x: geo.mat.x + sd * radius * 1.25, y: geo.mat.y + radius * 0.55 }, radius);
        break;
      }
      case 'bell':
        // DING DING DING: it is over.
        cue(c.sfxBellClip, c.sfxBellGain, c.sfxBellRate);
        cue(c.sfxCheerClip, c.sfxCheerGain, c.sfxCheerRate, { delayMs: real(120), lenMs: 2200, fadeMs: 800 });
        scene?.bell({ x: geo.count.x, y: geo.count.y }, radius);
        scene?.winner(geo.win, aRadius, plan.burst);
        break;
      case 'impact': {
        if (plan.kind === 'chop') {
          // THE CHOP: a flat smack, the hand print, and the crowd's "WOO".
          cue(c.sfxChopClip, c.sfxChopGain, c.sfxChopRate);
          cue(c.sfxWooClip, c.sfxWooGain, c.sfxWooRate, { delayMs: real(110) });
          scene?.chop(o.defender, -sd, plan.burst, plan.rings);
          scene?.word('woo', { x: geo.grab.x + sd * aRadius * 1.5, y: geo.grab.y - aRadius * 0.55 }, plan.burst, sd * 0.1, 760);
        } else if (plan.kind === 'slam') {
          // THE BODY SLAM.
          cue(c.sfxSlamClip, c.sfxSlamGain, c.sfxSlamRate);
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.7, c.sfxBoomRate, { lenMs: 700, fadeMs: 300 });
          cue(c.sfxWooClip, c.sfxWooGain * 0.8, c.sfxWooRate * 0.94, { delayMs: real(140) });
          scene?.wallop({ x: geo.mat.x, y: geo.mat.y + radius * 0.45 }, radius, plan.burst);
          scene?.matRing(geo.mat, radius, plan.burst, plan.rings);
          scene?.word('slam', { x: geo.stand.x + sd * aRadius * 1.5, y: geo.stand.y - aRadius * 0.9 }, plan.burst, sd * 0.08);
        } else if (plan.kind === 'elbow') {
          // THE ELBOW DROP.
          cue(c.sfxSlamClip, c.sfxSlamGain * 1.1, c.sfxSlamRate * 0.92);
          cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate, { lenMs: 900, fadeMs: 300, tail: 0.1 });
          cue(c.sfxChopClip, c.sfxChopGain * 0.5, c.sfxChopRate * 0.8);
          cue(c.sfxCheerClip, c.sfxCheerGain * 0.9, c.sfxCheerRate, { delayMs: real(160), lenMs: 1800, fadeMs: 700 });
          scene?.wallop({ x: geo.mat.x, y: geo.mat.y + radius * 0.45 }, radius, plan.burst);
          scene?.matRing(geo.mat, radius, plan.burst, plan.rings);
        } else {
          // THE CLOTHESLINE.
          cue(c.sfxChopClip, c.sfxChopGain * 1.1, c.sfxChopRate * 0.82);
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.9, c.sfxBoomRate * 1.1, { lenMs: 800, fadeMs: 300 });
          cue(c.sfxWooClip, c.sfxWooGain * 0.9, c.sfxWooRate * 0.9, { delayMs: real(120) });
          const at = { x: (geo.meet.x + geo.block.x) / 2 + sd * radius * 0.2, y: geo.meet.y - radius * 0.1 };
          scene?.slapArc(at, sd, radius, 1.2);
          scene?.wallop(at, radius, plan.burst);
          whoosh(0.8, 0.9, 400);
        }
        seq.land();
        break;
      }
      default:
        break;
    }
  };

  let lastStep = -Infinity;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.walkAt, plan.impactAt + 300);
    const cm = wrestleCameraAt(plan, c, t, blowDir);
    const unitS = local ? 1 : s;
    const focus = o.defender;
    cam.apply(focus, cm.zoom, cm.x, cm.y, unitS);
    // The camera's screen offset: a portrait OUTSIDE `#stage` folds it in by hand (so it stays glued to the scene).
    const ax = focus.x * (1 - cm.zoom) + cm.x * unitS, ay = focus.y * (1 - cm.zoom) + cm.y * unitS;
    const place = (at: Pt, off: Pt, inCam: boolean): Pt => (inCam || !cam.active
      ? off
      : { x: off.x * cm.zoom + at.x * (cm.zoom - 1) + ax, y: off.y * cm.zoom + at.y * (cm.zoom - 1) + ay });
    const hp = striker(t), fp = victim(t);
    if (hero.el) hero.set(poseCss(place(o.attacker, hp, heroInCam), hp, hp.scale * (heroInCam || !cam.active ? 1 : cm.zoom), heroUnit));
    if (foe.el) foe.set(poseCss(place(o.defender, fp, foeInCam), fp, fp.scale * (foeInCam || !cam.active ? 1 : cm.zoom), foeUnit));
    if (scene) {
      scene.setFoeOffset(fp.x, fp.y);
      if (plan.kind === 'pin') scene.setRing(sides, wrestleRing(ctx, t));
      else if (plan.kind === 'elbow') { scene.setSpot(wrestleSpot(ctx, t, frame.y0)); scene.setElbow(wrestleElbow(ctx, t)); }
      if (plan.kind === 'slam' || plan.kind === 'elbow') { const sh = wrestleShadow(ctx, t); scene.setShadow(sh.at, sh.k); }
      // Footfalls on the walk in (three strides), and on the walk home.
      if (t >= plan.walkAt && t < plan.gripAt && t - lastStep >= (plan.gripAt - plan.walkAt) / 3) {
        scene.step({ x: o.attacker.x + hp.x, y: o.attacker.y + hp.y }, aRadius, geo.grab.x >= o.attacker.x ? -1 : 1);
        lastStep = t;
      }
    }
  };

  const seq: Sequence<WrestleCue | FormationCue> = new Sequence<WrestleCue | FormationCue>({
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
    scene,
    striker,
    victim,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
