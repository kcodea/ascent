/**
 * THE BASKETBALL RUNNER ("Nothing But Net", a Legendary): plays one Basketball attack (the beats are in
 * `heroBasketballConfig.ts`) and lands the consequence on its impact beat (the swish, or the slam). Presentation only:
 * the total and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses), the damage formation, the
 * `#stage` camera (applied ONCE: `stageCamera.ts`), the voices, the dim, reduced motion, finish / cancel and the safety
 * timer.
 *
 * THE PORTRAIT MOVES (as Classic, Enraged and Shadow Step do): its pose is solved in screen px and written as a
 * transform in the portrait's own units (its ancestors' scale measured ONCE at the start). The foe's portrait is a
 * <body> portal outside the `#stage` camera, so when it is the striker the camera's zoom and shake are folded into its
 * own transform. The striker is raised over the target for the whole attack (Classic's `.duel-attacker-*` z-order).
 * EVERY exit path (the end, `finish()`, `cancel()`, the safety timer, and an unmount, which cancels) restores its
 * transform, its opacity and the z-order class exactly, and hides the ball, the shadows and the hoop.
 *
 * THE CONTRACT: the consequence (`onImpact`) lands exactly ONCE: on the swish (I-III) or the slam (IV). Nothing before
 * it (the pass, the pump fake, IV's smack and bounce, the catch) lands it.
 *
 * Perf: DOM writes are `transform` from the clock; layout is read once at the start; pooled sprites under a hard cap
 * plus six own objects; textures painted once per session and pre-warmed during the formation; the updater unhooks the
 * moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  basketballBall, basketballCameraAt, basketballCues, basketballGeo, basketballPlan, basketballPose, getHeroBasketballConfig, hoopAt, poseSegs,
  type BallState, type BasketballCue, type BasketballGeo, type BasketballPlan, type BasketballPose, type HeroBasketballConfig,
} from './heroBasketballConfig';
import { HeroBasketballScene, type HeroBasketballTextures } from './heroBasketballScene';
import { heroBasketballTextures } from './heroBasketballTextures';

export interface HeroBasketballOptions extends HeroAttackOptions {
  cfg?: HeroBasketballConfig;
  textures?: HeroBasketballTextures | null;
}

export interface HeroBasketballHandle extends HeroAttackHandle {
  readonly plan: BasketballPlan;
  readonly geo: BasketballGeo;
  readonly scene: HeroBasketballScene | null;
  readonly mirrorsCamera: boolean;
  /** The striking portrait's pose, and the ball, at a sequence time (pure). */
  pose(t: number): BasketballPose;
  ball(t: number): BallState;
}

export function basketballSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 3083 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 17)) >>> 0;
}

/** One measure of a portrait: its screen size, and `inv` = its own transform px per screen px. */
function rectOf(el: HTMLElement | null | undefined, r: number): { width: number; height: number; inv: number } {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { width: r * 2, height: r * 2, inv: 1 };
    return { width: b.width, height: b.height, inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  } catch { return { width: r * 2, height: r * 2, inv: 1 }; }
}

/** Play the Basketball attack. Returns a handle; the blow lands via `onImpact` on the swish or the slam. */
export function playHeroBasketball(o: HeroBasketballOptions): HeroBasketballHandle {
  const c = o.cfg ?? getHeroBasketballConfig();
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
  const plan = basketballPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, basketballCues(plan));
  // The frame the striker must stay inside (the screen, or the sandbox box).
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const frame = { x0: 0, y0: 0, x1: vw, y1: vh };
  const geo = basketballGeo(o.attacker, o.defender, aRadius, radius, frame, c);
  const segs = poseSegs(plan, geo, c, o.attacker, aRadius);
  const pose = (t: number): BasketballPose => basketballPose(plan, segs, c, t);
  const ballCtx = { p: plan, g: geo, segs, c, a: o.attacker, aR: aRadius, frame };
  const ball = (t: number): BallState => basketballBall(ballCtx, t);
  // The way the blow drives: a slam straight down through the rim (from the top of the leap), a shot along its line.
  const blowDir: Pt = plan.kind === 'alleyoop' ? { x: -geo.up.x, y: -geo.up.y } : geo.u;

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hbasketball',
  });

  const textures = o.textures !== undefined ? o.textures : heroBasketballTextures();
  const scene = textures && !reduced
    ? new HeroBasketballScene(textures, {
      ball: hexToNum(c.colorBall), rim: hexToNum(c.colorRim), net: hexToNum(c.colorNet), glass: hexToNum(c.colorGlass), flash: hexToNum(c.colorFlash), blast: hexToNum(c.colorBlast),
      confettiA: hexToNum(c.colorConfettiA), confettiB: hexToNum(c.colorConfettiB), side: hexToNum(sideHex),
    }, { ballSize: c.ballSize, shadowDrop: c.shadowDrop, hoopSize: c.hoopSize, wordSize: c.wordSize }, aRadius, radius, s, basketballSeed(o.total, dist, o.side))
    : null;
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

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxWhistleClip, c.sfxDribbleClip, c.sfxSqueakClip, c.sfxThrowClip, c.sfxSwishClip, c.sfxCatchClip, c.sfxRimClip, c.sfxSlamClip,
    c.sfxShatterClip, c.sfxOohClip, c.sfxCheerClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const heroAt = (t: number): Pt => { const p = pose(t); return { x: o.attacker.x + p.x, y: o.attacker.y + p.y }; };
  /** The way the portrait is moving at `t` (for the skid marks), or along the line when it is still. */
  const heading = (t: number): Pt => {
    const a = heroAt(t), b = heroAt(t + 40);
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    return l > 0.5 ? { x: dx / l, y: dy / l } : geo.u;
  };
  const big = plan.kind === 'alleyoop';

  const fire = (q: BasketballCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The referee's whistle opens it (softer on the jumper).
        cue(c.sfxWhistleClip, c.sfxWhistleGain * (plan.tier === 1 ? 0.6 : 1), c.sfxWhistleRate);
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      case 'dribble': {
        cue(c.sfxDribbleClip, c.sfxDribbleGain * (0.8 + 0.1 * (q.i % 3)), c.sfxDribbleRate * (1 + 0.04 * (q.i % 2)));
        const b = ball(t);
        scene?.dribble({ x: b.x, y: b.y + aRadius * c.ballSize * 0.8 }, 1);
        break;
      }
      case 'squeak':
        cue(c.sfxSqueakClip, c.sfxSqueakGain * (0.85 + 0.15 * (q.i % 2)), c.sfxSqueakRate * (1 + 0.07 * ((q.i % 3) - 1)));
        scene?.squeak(heroAt(t), heading(t));
        break;
      case 'jump':
        // The take-off (its squeak is its own cue): IV's leap from half court gets a rush of air.
        if (big) cue(c.sfxThrowClip, c.sfxThrowGain * 0.8, c.sfxThrowRate * 0.8, { lenMs: 500, fadeMs: 200 });
        break;
      case 'pass':
        // III: the pass whips in from off the right edge.
        cue(c.sfxThrowClip, c.sfxThrowGain * 0.8, c.sfxThrowRate * 1.15, { lenMs: 400, fadeMs: 160 });
        break;
      case 'pump':
        // III: the pump fake (a quick shuffle of the sneakers and the ball snapped up and back).
        cue(c.sfxSqueakClip, c.sfxSqueakGain * 0.5, c.sfxSqueakRate * 1.2);
        break;
      case 'release': {
        // The shot (I-III), or IV's throw fired straight at the target (harder and quicker).
        cue(c.sfxThrowClip, c.sfxThrowGain * (big ? 1.3 : 1), c.sfxThrowRate * (big ? 1.25 : 1), { lenMs: big ? 400 : 500, fadeMs: 160 });
        const b = ball(t);
        scene?.release({ x: b.x, y: b.y });
        break;
      }
      case 'bounce':
        // IV: the throw SMACKS the target and bounces high (FX and sound only; the blow waits for the slam).
        cue(c.sfxDribbleClip, c.sfxDribbleGain * 1.25, c.sfxDribbleRate * 0.8);
        cue(c.sfxRimClip, c.sfxRimGain * 0.35, c.sfxRimRate * 1.2, { lenMs: 450, fadeMs: 200 });
        scene?.bounce(geo.hit);
        break;
      case 'catch': {
        // III: the pass slapped into the hands (and a squeak as it plants); IV: the catch at the top of the leap.
        cue(c.sfxCatchClip, c.sfxCatchGain, c.sfxCatchRate, { lenMs: 200, fadeMs: 80 });
        if (!big) cue(c.sfxSqueakClip, c.sfxSqueakGain * 0.7, c.sfxSqueakRate * 1.05);
        const b = ball(t);
        scene?.catchFlash({ x: b.x, y: b.y }, big ? 1 : 0.6);
        break;
      }
      case 'impact': {
        if (big) {
          // THE SLAM: the rim rattles, the slam lands, the backboard shatters, the crowd goes "OOOH" and roars.
          cue(c.sfxRimClip, c.sfxRimGain * 1.15, c.sfxRimRate, { lenMs: 1000, fadeMs: 300 });
          cue(c.sfxSlamClip, c.sfxSlamGain * 1.2, c.sfxSlamRate, { lenMs: 900, fadeMs: 300, tail: 0.12 });
          cue(c.sfxOohClip, c.sfxOohGain * 1.35, c.sfxOohRate, { delayMs: real(110), fadeMs: 400 });
          cue(c.sfxShatterClip, c.sfxShatterGain, c.sfxShatterRate, { lenMs: 1200, fadeMs: 300 });
          cue(c.sfxCheerClip, c.sfxCheerGain, c.sfxCheerRate, { delayMs: real(380), lenMs: 2200, fadeMs: 700 });
          scene?.slam(geo.hit, blowDir, { burst: plan.burst, rings: plan.rings, shards: plan.shards, confetti: plan.confetti, blast: c.blastSize });
        } else {
          // SWISH: nothing but net. II's fade gets a small "ooh"; III's three a bigger swish and a full one.
          cue(c.sfxSwishClip, c.sfxSwishGain * (plan.kind === 'three' ? 1.15 : 1), c.sfxSwishRate);
          if (plan.kind === 'fadeaway') cue(c.sfxOohClip, c.sfxOohGain * 0.45, c.sfxOohRate * 1.05, { delayMs: real(160), fadeMs: 350 });
          if (plan.kind === 'three') cue(c.sfxOohClip, c.sfxOohGain * 0.95, c.sfxOohRate, { delayMs: real(140), fadeMs: 400 });
          scene?.swish(geo.hit, plan.burst, plan.kind === 'three' ? { rings: plan.rings, confetti: plan.confetti } : undefined);
        }
        seq.land();
        break;
      }
      case 'home':
        cue(c.sfxSqueakClip, c.sfxSqueakGain * 0.7, c.sfxSqueakRate * 0.95);
        scene?.squeak(heroAt(t), heading(t));
        break;
      default:
        break;
    }
  };

  let lastTrail = -Infinity;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.takeoffAt, plan.impactAt + 300);
    const cm = basketballCameraAt(plan, c, t, blowDir);
    const unitS = local ? 1 : s;
    const focus = o.defender;
    cam.apply(focus, cm.zoom, cm.x, cm.y, unitS);
    // The camera's screen offset: a portrait OUTSIDE `#stage` folds it in by hand (so it stays glued to the scene).
    const ax = focus.x * (1 - cm.zoom) + cm.x * unitS, ay = focus.y * (1 - cm.zoom) + cm.y * unitS;
    const place = (at: Pt, off: Pt, inCam: boolean): Pt => (inCam || !cam.active
      ? off
      : { x: off.x * cm.zoom + at.x * (cm.zoom - 1) + ax, y: off.y * cm.zoom + at.y * (cm.zoom - 1) + ay });
    const p = pose(t);
    if (hero.el) {
      const off = place(o.attacker, p, heroInCam);
      const sc = p.scale * (heroInCam || !cam.active ? 1 : cm.zoom);
      const moved = Math.abs(off.x) > 0.05 || Math.abs(off.y) > 0.05 || Math.abs(sc - 1) > 1e-4 || Math.abs(p.rot) > 0.01;
      const sq = Math.abs(p.squash) > 0.002 ? ` scale(${(1 + p.squash * 0.6).toFixed(4)}, ${(1 - p.squash).toFixed(4)})` : '';
      hero.set(!moved && !sq ? null
        : `translate(${(off.x / heroUnit).toFixed(2)}px, ${(off.y / heroUnit).toFixed(2)}px) rotate(${p.rot.toFixed(2)}deg) scale(${sc.toFixed(4)})${sq}`);
    }
    if (scene) {
      const b = ball(t);
      scene.setBall(b);
      if (b.flying && t - lastTrail >= c.trailMs) { scene.trail(b); lastTrail = t; }
      scene.setHeroShadow(p.air > 0.02 ? { x: o.attacker.x + p.x, y: o.attacker.y + p.y } : null, p.air, p.scale);
      const h = hoopAt(plan, t);
      scene.setHoop(geo.hit, h.alpha, h.rattle, h.board);
    }
    if (foe.el) {
      // The target takes the blow: a small bob on a swish, a hard squash down on the slam (IV's smack a small knock first).
      let kx = 0, ky = 0, sq = 0;
      const px = local ? 0.45 : 1;
      if (plan.bounceAt !== null && t >= plan.bounceAt) {
        const k = spring(t - plan.bounceAt, 5, 60);
        kx += geo.u.x * c.knockPx * 0.4 * k * px; ky += geo.u.y * c.knockPx * 0.4 * k * px; sq += c.squash * 0.4 * k;
      }
      if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, big ? 4 : 5, big ? 95 : 70);
        const w = big ? 0.8 + 0.5 * plan.k : 0.35;
        kx += blowDir.x * c.knockPx * w * k * px; ky += blowDir.y * c.knockPx * w * k * px; sq += c.squash * (big ? 1 + 0.4 * plan.k : 0.4) * k;
      }
      const off = place(o.defender, { x: kx, y: ky }, foeInCam);
      const z = foeInCam || !cam.active ? 1 : cm.zoom;
      const still = Math.abs(kx) < 0.05 && Math.abs(ky) < 0.05 && Math.abs(sq) < 0.002;
      foe.set(still && (foeInCam || !cam.active || Math.abs(z - 1) < 1e-4) ? null
        : `translate(${(off.x / foeUnit).toFixed(2)}px, ${(off.y / foeUnit).toFixed(2)}px) scale(${((1 + sq * 0.55) * z).toFixed(4)}, ${((1 - sq) * z).toFixed(4)})`);
    }
  };

  const seq: Sequence<BasketballCue | FormationCue> = new Sequence<BasketballCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
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
    pose,
    ball,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
