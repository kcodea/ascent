/**
 * THE BASEBALL RUNNER ("Charge the Mound", a Legendary): plays one Baseball attack (the beats are in
 * `heroBaseballConfig.ts`) and lands the consequence on its impact beat (the BONK, the crater, the haymaker).
 * Presentation only: the total and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses), the damage formation, the
 * `#stage` camera (applied ONCE: `stageCamera.ts`), the voices, the dim, reduced motion, finish / cancel and the safety
 * timer.
 *
 * BOTH PORTRAITS MOVE: the struck hero is the PITCHER (it winds up, throws, reacts, is launched) and the striker is the
 * BATTER (it swings; at IV it staggers, charges the mound, brawls and lands the haymaker). Each pose is solved in screen
 * px and written as a transform in the portrait's own units (its ancestors' scale measured ONCE at the start). A portrait
 * outside the `#stage` camera (the foe's <body> portal) folds the camera's zoom and shake into its own transform. The
 * striker is raised over the target for the whole attack (Classic's `.duel-attacker-*` z-order). EVERY exit path (the
 * end, `finish()`, `cancel()`, the safety timer, and an unmount, which cancels) restores both transforms, the striker's
 * opacity and the z-order class exactly, and hides the ball, the bat and the shadows.
 *
 * THE CONTRACT: the consequence (`onImpact`) lands exactly ONCE, on the impact. The pitch, the CRACK, the hop, the bean on
 * the striker and every brawl hit are ticks; the target only reacts on the impact (its windup and IV's brawl shaking
 * are its own acting, not a hit reaction).
 *
 * Perf: DOM writes are `transform` from the clock; layout is read once at the start; pooled sprites under a hard cap
 * plus four own objects; textures painted once per session and pre-warmed during the formation; the updater unhooks the
 * moment the scene drains.
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
  baseballBall, baseballBat, baseballCameraAt, baseballCues, baseballGeo, baseballPlan, baseballTimeScale, batLength, batterPose,
  getHeroBaseballConfig, moonShadow, pitcherPose, slowExtraMs, variantOf,
  type BallState, type BaseballCue, type BaseballGeo, type BaseballPlan, type BaseballPose, type BatState, type HeroBaseballConfig,
} from './heroBaseballConfig';
import { HeroBaseballScene, type HeroBaseballTextures } from './heroBaseballScene';
import { heroBaseballTextures } from './heroBaseballTextures';

export interface HeroBaseballOptions extends HeroAttackOptions {
  cfg?: HeroBaseballConfig;
  textures?: HeroBaseballTextures | null;
}

export interface HeroBaseballHandle extends HeroAttackHandle {
  readonly plan: BaseballPlan;
  readonly geo: BaseballGeo;
  readonly scene: HeroBaseballScene | null;
  readonly mirrorsCamera: boolean;
  /** The rolled variation (II's hit). */
  readonly variant: 1 | 2 | 3;
  /** The batter's and the pitcher's poses, the ball and the bat, at a sequence time (pure). */
  batter(t: number): BaseballPose;
  pitcher(t: number): BaseballPose;
  ball(t: number): BallState;
  bat(t: number): BatState;
}

export function baseballSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
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

/** A portrait pose as a CSS transform in its own units (`unit` = screen px per own px), or null when at rest. */
function poseCss(off: Pt, p: BaseballPose, sc: number, unit: number): string | null {
  const moved = Math.abs(off.x) > 0.05 || Math.abs(off.y) > 0.05 || Math.abs(sc - 1) > 1e-4 || Math.abs(p.rot) > 0.01;
  const sq = Math.abs(p.squash) > 0.002 ? ` scale(${(1 + p.squash * 0.6).toFixed(4)}, ${(1 - p.squash).toFixed(4)})` : '';
  if (!moved && !sq) return null;
  return `translate(${(off.x / unit).toFixed(2)}px, ${(off.y / unit).toFixed(2)}px) rotate(${p.rot.toFixed(2)}deg) scale(${sc.toFixed(4)})${sq}`;
}

/** Play the Baseball attack. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroBaseball(o: HeroBaseballOptions): HeroBaseballHandle {
  const c = o.cfg ?? getHeroBaseballConfig();
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
  // THE VARIATION (II's hit), rolled from the stable per-blow seed (or forced by the DEV tuner).
  const variant = variantOf(o.rollSeed ?? baseballSeed(o.total, dist, o.side), c);
  const plan = baseballPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt, variant }, c);
  const cues = withFormation(fplan, baseballCues(plan));
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const frame = { x0: 0, y0: 0, x1: vw, y1: vh };
  const geo = baseballGeo(o.attacker, o.defender, aRadius, radius, frame, c);
  const batter = (t: number): BaseballPose => batterPose(plan, geo, c, aRadius, o.attacker, t);
  const pitcher = (t: number): BaseballPose => pitcherPose(plan, geo, c, radius, t);
  const ctx = { p: plan, g: geo, c, d: o.defender, dR: radius, aR: aRadius, a: o.attacker };
  const ball = (t: number): BallState => baseballBall(ctx, t);
  const bat = (t: number): BatState => baseballBat(ctx, t);
  // The way the blow drives the pitcher (the foul tip comes from behind it).
  const blowDir: Pt = plan.kind === 'hotshot' && plan.variant === 3 ? { x: -geo.u.x, y: -geo.u.y } : geo.u;

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hbaseball',
  });

  const textures = o.textures !== undefined ? o.textures : heroBaseballTextures();
  const scene = textures && !reduced
    ? new HeroBaseballScene(textures, {
      ball: hexToNum(c.colorBall), bat: hexToNum(c.colorBat), dust: hexToNum(c.colorDust), flash: hexToNum(c.colorFlash), pow: hexToNum(c.colorPow), side: hexToNum(sideHex),
    }, { ballSize: c.ballSize, batLen: batLength(aRadius, c), shadowDrop: c.shadowDrop, wordSize: c.wordSize, frameH: vh }, aRadius, radius, s, baseballSeed(o.total, dist, o.side))
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

  // During a slow-mo beat a cue is pitched down a touch (subtle), with the clock.
  const cue: AttackVoices['cue'] = (clip, gain, rate, opts) => voices.cue(clip, gain, rate * (0.88 + 0.12 * Math.min(1, baseballTimeScale(plan, c, seq.t))), opts);
  voices.warm([
    c.sfxGloveClip, c.sfxPitchClip, c.sfxCrackClip, c.sfxBonkClip, c.sfxHopClip, c.sfxFallClip, c.sfxChargeClip, c.sfxThumpClip, c.sfxKoClip,
    c.sfxUmpClip, c.sfxOohClip, c.sfxCheerClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const heroAt = (t: number): Pt => { const p = batter(t); return { x: o.attacker.x + p.x, y: o.attacker.y + p.y }; };
  const foeAt = (t: number): Pt => { const p = pitcher(t); return { x: o.defender.x + p.x, y: o.defender.y + p.y }; };
  const brawl = plan.kind === 'brawl';

  const fire = (q: BaseballCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // PLAY BALL: the pitcher pops the ball into its mitt.
        cue(c.sfxGloveClip, c.sfxGloveGain, c.sfxGloveRate);
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        scene?.glovePop(foeAt(t));
        break;
      case 'windup':
        cue(c.sfxGloveClip, c.sfxGloveGain * 0.35, c.sfxGloveRate * 1.3, { lenMs: 160, fadeMs: 60 });
        break;
      case 'pitch':
        cue(c.sfxPitchClip, c.sfxPitchGain * (brawl ? 1.3 : 1), c.sfxPitchRate * (brawl ? 1.1 : 1), { lenMs: 450, fadeMs: 180 });
        scene?.kick(foeAt(t), { x: -geo.u.x, y: -geo.u.y });
        break;
      case 'swing':
        cue(c.sfxPitchClip, c.sfxPitchGain * 0.6, c.sfxPitchRate * 0.8, { lenMs: 300, fadeMs: 120 });
        break;
      case 'crack': {
        // THE BAT MEETS THE BALL (a tick). III's is huge (and in slow mo).
        const k = plan.kind === 'moonshot' ? 1.6 : plan.kind === 'hotshot' ? 1.15 : 0.9;
        cue(c.sfxCrackClip, c.sfxCrackGain * (0.8 + 0.25 * k), c.sfxCrackRate * (plan.kind === 'moonshot' ? 0.92 : 1), { tail: plan.kind === 'moonshot' ? 0.18 : 0 });
        if (plan.kind === 'moonshot') cue(c.sfxOohClip, c.sfxOohGain * 0.7, c.sfxOohRate * 1.05, { delayMs: real(220), fadeMs: 400 });
        const toward = plan.kind === 'moonshot' ? { x: geo.sky.x - geo.plate.x, y: geo.sky.y - geo.plate.y } : plan.kind === 'hotshot' && plan.variant === 3 ? { x: geo.foul1.x - geo.plate.x, y: geo.foul1.y - geo.plate.y } : geo.u;
        const l = Math.hypot(toward.x, toward.y) || 1;
        scene?.crack({ x: geo.plate.x, y: geo.plate.y - aRadius * 0.35 }, { x: toward.x / l, y: toward.y / l }, k);
        break;
      }
      case 'hop': {
        cue(c.sfxHopClip, c.sfxHopGain, c.sfxHopRate);
        scene?.hopDust(geo.hop);
        break;
      }
      case 'twinkle':
        cue(c.sfxGloveClip, c.sfxGloveGain * 0.25, c.sfxGloveRate * 2.2, { lenMs: 140, fadeMs: 60 });
        scene?.twinkle({ x: geo.sky.x, y: Math.max(frame.y0 + 30, 30) });
        break;
      case 'fall':
        // The slide whistle as it comes down.
        cue(c.sfxFallClip, c.sfxFallGain, c.sfxFallRate);
        break;
      case 'batland':
        cue(c.sfxCrackClip, c.sfxCrackGain * 0.35, c.sfxCrackRate * 0.6, { lenMs: 200, fadeMs: 80 });
        cue(c.sfxCrackClip, c.sfxCrackGain * 0.25, c.sfxCrackRate * 0.7, { lenMs: 160, fadeMs: 60, delayMs: real(120) });
        scene?.clatter(geo.batLand);
        break;
      case 'bean':
        // THE PITCHER BEANS THE BATTER (a tick: the striker takes it, no damage). The crowd goes "ooh".
        cue(c.sfxBonkClip, c.sfxBonkGain * 1.1, c.sfxBonkRate * 0.95);
        cue(c.sfxOohClip, c.sfxOohGain, c.sfxOohRate * 0.95, { delayMs: real(160), fadeMs: 400 });
        scene?.bean(heroAt(t), { x: -geo.u.x, y: -geo.u.y });
        scene?.popAway(heroAt(t), { x: -geo.u.x, y: -geo.u.y }, aRadius * 0.35);
        break;
      case 'batdrop':
        cue(c.sfxPitchClip, c.sfxPitchGain * 0.5, c.sfxPitchRate * 0.75, { lenMs: 250, fadeMs: 100 });
        break;
      case 'clatter':
        cue(c.sfxCrackClip, c.sfxCrackGain * 0.45, c.sfxCrackRate * 0.55, { lenMs: 220, fadeMs: 80 });
        cue(c.sfxCrackClip, c.sfxCrackGain * 0.3, c.sfxCrackRate * 0.65, { lenMs: 160, fadeMs: 60, delayMs: real(110) });
        scene?.clatter(geo.batSlam);
        break;
      case 'fume':
        scene?.fume(heroAt(t));
        break;
      case 'run':
        // CHARGE! The ballpark organ, and the batter is off.
        cue(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate);
        cue(c.sfxPitchClip, c.sfxPitchGain * 1.1, c.sfxPitchRate * 0.7, { lenMs: 500, fadeMs: 200, delayMs: real(60) });
        break;
      case 'collide': {
        cue(c.sfxThumpClip, c.sfxThumpGain * 1.3, c.sfxThumpRate * 0.8);
        cue(c.sfxOohClip, c.sfxOohGain * 0.6, c.sfxOohRate * 1.1, { fadeMs: 300 });
        cue(c.sfxCheerClip, c.sfxCheerGain * 0.8, c.sfxCheerRate, { lenMs: 1800, fadeMs: 600 });
        scene?.cloudBurst(geo.cloud, c.brawlCloud);
        break;
      }
      case 'hit': {
        // A comic hit in the brawl (a tick): round the cloud's edge, never the same spot twice in a row.
        cue(c.sfxThumpClip, c.sfxThumpGain * (0.8 + 0.1 * (q.i % 3)), c.sfxThumpRate * (0.9 + 0.12 * ((q.i * 7) % 4)), { lenMs: 260, fadeMs: 90 });
        const a = q.i * 2.39996 + 0.6;
        const R = (aRadius + radius) * 0.55 * c.brawlCloud;
        scene?.brawlHit({ x: geo.cloud.x + Math.cos(a) * R, y: geo.cloud.y + Math.sin(a) * R * 0.8 }, q.i, 1);
        break;
      }
      case 'kowind':
        cue(c.sfxPitchClip, c.sfxPitchGain * 0.9, c.sfxPitchRate * 0.65, { lenMs: 400, fadeMs: 160 });
        break;
      case 'impact': {
        if (brawl) {
          // THE HAYMAKER: YER OUT!
          cue(c.sfxKoClip, c.sfxKoGain * 1.2, c.sfxKoRate, { lenMs: 900, fadeMs: 300, tail: 0.12 });
          cue(c.sfxBonkClip, c.sfxBonkGain, c.sfxBonkRate * 0.8);
          cue(c.sfxUmpClip, c.sfxUmpGain, c.sfxUmpRate, { delayMs: real(140) });
          cue(c.sfxCheerClip, c.sfxCheerGain * 1.2, c.sfxCheerRate, { delayMs: real(320), lenMs: 2200, fadeMs: 700 });
          scene?.ko({ x: o.defender.x + geo.pitcherBrawl.x, y: o.defender.y + geo.pitcherBrawl.y }, geo.cloud, blowDir, plan.burst, plan.rings);
        } else if (plan.kind === 'moonshot') {
          // HOME RUN: the moonshot craters the pitcher.
          cue(c.sfxKoClip, c.sfxKoGain, c.sfxKoRate * 1.05, { lenMs: 900, fadeMs: 300, tail: 0.1 });
          cue(c.sfxBonkClip, c.sfxBonkGain * 0.9, c.sfxBonkRate * 0.85);
          cue(c.sfxCheerClip, c.sfxCheerGain, c.sfxCheerRate, { delayMs: real(200), lenMs: 2000, fadeMs: 700 });
          scene?.crater(geo.hit, blowDir, plan.burst, plan.rings);
          scene?.popAway(geo.hit, blowDir);
        } else {
          // BONK: right back at the pitcher.
          cue(c.sfxBonkClip, c.sfxBonkGain * (plan.kind === 'hotshot' ? 1.1 : 0.9), c.sfxBonkRate * (plan.kind === 'hotshot' ? 0.95 : 1.05));
          if (plan.kind === 'hotshot') cue(c.sfxOohClip, c.sfxOohGain * 0.5, c.sfxOohRate * 1.05, { delayMs: real(160), fadeMs: 350 });
          scene?.bonk(geo.hit, blowDir, plan.burst, { rings: plan.rings, word: plan.kind === 'hotshot' && plan.variant === 1 ? 'smack' : 'bonk' });
          scene?.popAway(geo.hit, blowDir, aRadius * 0.35);
        }
        seq.land();
        break;
      }
      case 'home':
        break;
      default:
        break;
    }
  };

  let lastTrail = -Infinity;
  let lastPuff = -Infinity;
  let lastDust = -Infinity;
  let lastRush = -Infinity;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.windAt, plan.impactAt + 300);
    const cm = baseballCameraAt(plan, c, t, blowDir);
    const unitS = local ? 1 : s;
    const focus = o.defender;
    cam.apply(focus, cm.zoom, cm.x, cm.y, unitS);
    // The camera's screen offset: a portrait OUTSIDE `#stage` folds it in by hand (so it stays glued to the scene).
    const ax = focus.x * (1 - cm.zoom) + cm.x * unitS, ay = focus.y * (1 - cm.zoom) + cm.y * unitS;
    const place = (at: Pt, off: Pt, inCam: boolean): Pt => (inCam || !cam.active
      ? off
      : { x: off.x * cm.zoom + at.x * (cm.zoom - 1) + ax, y: off.y * cm.zoom + at.y * (cm.zoom - 1) + ay });
    if (hero.el) {
      const p = batter(t);
      hero.set(poseCss(place(o.attacker, p, heroInCam), p, p.scale * (heroInCam || !cam.active ? 1 : cm.zoom), heroUnit));
    }
    if (foe.el) {
      const p = pitcher(t);
      foe.set(poseCss(place(o.defender, p, foeInCam), p, p.scale * (foeInCam || !cam.active ? 1 : cm.zoom), foeUnit));
    }
    if (scene) {
      const b = ball(t);
      scene.setBall(b);
      if (b.flying && t - lastTrail >= c.trailMs) { scene.trail(b); lastTrail = t; }
      scene.setBat(bat(t));
      scene.setTargetShadow(o.defender, moonShadow(plan, t));
      if (brawl) {
        // The charge's dust and speed lines; the boiling cloud and the benches clearing through the brawl.
        if (t >= plan.chargeRunAt! && t < plan.collideAt! && t - lastDust >= 40) { scene.chargeDust(heroAt(t), heroAt(t - 40), aRadius); lastDust = t; }
        if (t >= plan.collideAt! && t < plan.brawlEnd! + 60 && t - lastPuff >= 28) { scene.cloudPuff(geo.cloud, c.brawlCloud); lastPuff = t; }
        if (t >= plan.collideAt! + 60 && t < plan.brawlEnd! - 200 && t - lastRush >= 260) { scene.benchRush(geo.cloud, vw, c.benchRush); lastRush = t; }
      }
    }
  };

  const seq: Sequence<BaseballCue | FormationCue> = new Sequence<BaseballCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    // SLOW MO (and IV's fast brawl): the frame source hands the ONE clock a scaled step (a smooth ramp, never 0), so the
    // portraits, the ball, the FX, the camera and the cue timing all slow and speed up together.
    frames: (fn: (dt: number) => void) => (o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)))((dt) => fn(dt * (seq && !seq.done ? baseballTimeScale(plan, c, seq.t) : 1))),
    safetyMs: o.safety !== false ? (plan.endAt + slowExtraMs(plan, c)) / speed + 2500 : null,
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
    variant: plan.variant,
    scene,
    batter,
    pitcher,
    ball,
    bat,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
