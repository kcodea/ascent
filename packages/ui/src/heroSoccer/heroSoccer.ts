/**
 * THE SOCCER RUNNER ("Golazo", a Legendary): plays one Soccer attack (the beats are in `heroSoccerConfig.ts`) and
 * lands the consequence on its impact beat (the ball in the net). Presentation only: the total and the blow are the
 * engine's; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses), the damage formation, the
 * `#stage` camera (applied ONCE: `stageCamera.ts`), the voices, the dim, reduced motion, finish / cancel and the safety
 * timer.
 *
 * THE PORTRAIT MOVES (as the Basketball's does): its pose is solved in screen px and written as a transform in the
 * portrait's own units (its ancestors' scale measured ONCE at the start). The foe's portrait is a <body> portal outside
 * the `#stage` camera, so when it is the striker the camera's zoom and shake are folded into its own transform. The
 * striker is raised over the target for the whole attack (Classic's `.duel-attacker-*` z-order). EVERY exit path (the
 * end, `finish()`, `cancel()`, the safety timer, and an unmount, which cancels) restores its transform, its opacity and
 * the z-order class exactly, and hides the ball, the shadows, the goal, the flag and the defenders.
 *
 * THE CONTRACT: the consequence (`onImpact`) lands exactly ONCE: when the ball hits the net. Nothing before it (the
 * keepy-uppies, the corner, the one-two, the header's cross, the skills, the sky-high flick, the contact) lands it or
 * makes the target react.
 *
 * Perf: DOM writes are `transform` from the clock; layout is read once at the start; pooled sprites under a hard cap
 * plus nine own objects; textures painted once per session and pre-warmed during the formation; the updater unhooks
 * the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { hexToNum, mixColor, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  defenderAt, flagAt, getHeroSoccerConfig, goalAt, goalLayout, poseSegs, shotFrom, slowExtraMs, soccerBall, soccerCameraAt, soccerCues, soccerGeo,
  soccerPlan, soccerPose, soccerTimeScale, variantOf,
  type BallState, type HeroSoccerConfig, type SoccerCue, type SoccerGeo, type SoccerPlan, type SoccerPose,
} from './heroSoccerConfig';
import { HeroSoccerScene, MAX_DEFENDERS, type HeroSoccerTextures } from './heroSoccerScene';
import { heroSoccerTextures } from './heroSoccerTextures';

export interface HeroSoccerOptions extends HeroAttackOptions {
  cfg?: HeroSoccerConfig;
  textures?: HeroSoccerTextures | null;
}

export interface HeroSoccerHandle extends HeroAttackHandle {
  readonly plan: SoccerPlan;
  readonly geo: SoccerGeo;
  readonly scene: HeroSoccerScene | null;
  readonly mirrorsCamera: boolean;
  /** The rolled variation (II's corner, III's skill). */
  readonly variant: 1 | 2 | 3;
  /** The striking portrait's pose, and the ball, at a sequence time (pure). */
  pose(t: number): SoccerPose;
  ball(t: number): BallState;
}

export function soccerSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
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

/** Play the Soccer attack. Returns a handle; the blow lands via `onImpact` when the ball hits the net. */
export function playHeroSoccer(o: HeroSoccerOptions): HeroSoccerHandle {
  const c = o.cfg ?? getHeroSoccerConfig();
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
  // THE VARIATION (II's corner, III's skill), rolled from the stable per-blow seed (or forced by the DEV tuner).
  const variant = variantOf(o.rollSeed ?? soccerSeed(o.total, dist, o.side), c);
  const plan = soccerPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt, variant }, c);
  const cues = withFormation(fplan, soccerCues(plan));
  // The frame the striker must stay inside (the screen, or the sandbox box).
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const frame = { x0: 0, y0: 0, x1: vw, y1: vh };
  const geo = soccerGeo(o.attacker, o.defender, aRadius, radius, frame, c, plan.variant);
  const segs = poseSegs(plan, geo, c, o.attacker, aRadius);
  const pose = (t: number): SoccerPose => soccerPose(plan, segs, c, t);
  const ballCtx = { p: plan, g: geo, segs, c, a: o.attacker, aR: aRadius, frame };
  const ball = (t: number): BallState => soccerBall(ballCtx, t);
  // The way the blow drives: along the final shot.
  const from = shotFrom(plan, geo, o.attacker, aRadius);
  const bl = Math.hypot(geo.hit.x - from.x, geo.hit.y - from.y);
  const blowDir: Pt = bl > 1 ? { x: (geo.hit.x - from.x) / bl, y: (geo.hit.y - from.y) / bl } : geo.u;
  const goal = goalLayout(geo.hit, radius, c.goalSize);

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hsoccer',
  });

  const textures = o.textures !== undefined ? o.textures : heroSoccerTextures();
  const scene = textures && !reduced
    ? new HeroSoccerScene(textures, {
      ball: hexToNum(c.colorBall), post: hexToNum(c.colorPost), net: hexToNum(c.colorNet), flag: hexToNum(c.colorFlag),
      // The defenders wear the DEFENDING side's colour (the struck hero's), deepened.
      defender: mixColor(hexToNum(c.colorDefender), hexToNum(o.side === 'opp' ? c.colorPlayer : c.colorFoe), 0.45),
      flash: hexToNum(c.colorFlash), fire: hexToNum(c.colorFire), blast: hexToNum(c.colorBlast), confettiA: hexToNum(c.colorConfettiA), confettiB: hexToNum(c.colorConfettiB),
      side: hexToNum(sideHex),
    }, { ballSize: c.ballSize, shadowDrop: c.shadowDrop, goalSize: c.goalSize, wordSize: c.wordSize }, aRadius, radius, s, soccerSeed(o.total, dist, o.side))
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

  // During a slow-mo beat a cue is pitched down a touch (subtle), with the clock.
  const cue: AttackVoices['cue'] = (clip, gain, rate, opts) => voices.cue(clip, gain, rate * (0.88 + 0.12 * Math.min(1, soccerTimeScale(plan, c, seq.t))), opts);
  voices.warm([c.sfxWhistleClip, c.sfxKickClip, c.sfxTouchClip, c.sfxWhooshClip, c.sfxNetClip, c.sfxPostClip, c.sfxBoomClip, c.sfxOohClip, c.sfxRoarClip, c.sfxGolazoClip]);
  const heroAt = (t: number): Pt => { const p = pose(t); return { x: o.attacker.x + p.x, y: o.attacker.y + p.y }; };
  /** The way the portrait is moving at `t` (for the skids), or along the line when it is still. */
  const heading = (t: number): Pt => {
    const a = heroAt(t), b = heroAt(t + 40);
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    return l > 0.5 ? { x: dx / l, y: dy / l } : geo.u;
  };
  const big = plan.kind === 'bicycle';

  const fire = (q: SoccerCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The referee's whistle opens it (softer on the volley).
        cue(c.sfxWhistleClip, c.sfxWhistleGain * (plan.tier === 1 ? 0.6 : 1), c.sfxWhistleRate);
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      case 'touch': {
        // A keepy-uppy or a dribble touch: a soft tap and a puff of grass.
        cue(c.sfxTouchClip, c.sfxTouchGain * (0.85 + 0.1 * (q.i % 3)), c.sfxTouchRate * (1 + 0.05 * ((q.i % 3) - 1)));
        const b = ball(t);
        scene?.touch({ x: b.x, y: b.y }, 0.8);
        break;
      }
      case 'flick': {
        // I: the higher flick for the volley; IV: SKY HIGH (a whoosh going up, and the crowd begins to rise).
        cue(c.sfxTouchClip, c.sfxTouchGain * (big ? 1.4 : 1.1), c.sfxTouchRate * (big ? 0.85 : 1));
        if (big) {
          cue(c.sfxWhooshClip, c.sfxWhooshGain * 1.1, c.sfxWhooshRate * 0.8, { lenMs: 600, fadeMs: 240 });
          // The crowd's "Ooooh" rises as the ball goes up (it peaks about a second in: the leap).
          cue(c.sfxOohClip, c.sfxOohGain, c.sfxOohRate, { fadeMs: 400 });
        }
        const b = ball(t);
        scene?.touch({ x: b.x, y: b.y }, big ? 1.4 : 1);
        break;
      }
      case 'set': {
        // II: the ball set down at the corner flag (a tap), the crowd hushes.
        cue(c.sfxTouchClip, c.sfxTouchGain * 0.8, c.sfxTouchRate * 1.1);
        const b = ball(t + 20);
        scene?.touch({ x: b.x, y: b.y }, 0.7);
        break;
      }
      case 'runup':
        // II: the run-up (a step and the arm raised); a quick skid.
        scene?.skid(heroAt(t), heading(t), 0.6);
        break;
      case 'beat': {
        // III: past a defender: the skill (a tap, a whoosh) and the defender beaten (a nutmeg / the stepovers get a word).
        cue(c.sfxTouchClip, c.sfxTouchGain * 1.1, c.sfxTouchRate * 1.12);
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.6, c.sfxWhooshRate * 1.3, { lenMs: 300, fadeMs: 120 });
        // The crowd's "Ooooh" starts on the first defender, so its peak (about a second in) lands on the finish.
        if (q.i === 0) cue(c.sfxOohClip, c.sfxOohGain * 0.85, c.sfxOohRate, { fadeMs: 350 });
        const d = geo.defenders[q.i];
        if (d) scene?.beaten(d.at, plan.variant === 2 ? 'nutmeg' : plan.variant === 1 && q.i === 0 ? 'ole' : null);
        break;
      }
      case 'pass': {
        // II-3: the short corner rolled off the edge of the screen.
        cue(c.sfxKickClip, c.sfxKickGain * 0.55, c.sfxKickRate * 1.2);
        const b = ball(t + 10);
        scene?.strike({ x: b.x, y: b.y }, 0.6);
        break;
      }
      case 'return': {
        // II-3: the one-two comes back (a tap into the stride).
        cue(c.sfxTouchClip, c.sfxTouchGain, c.sfxTouchRate * 1.05);
        break;
      }
      case 'jump':
        // The take-off (a skid); IV's launch out of the crouch is a shock ring of grass and dust.
        scene?.skid(heroAt(t), heading(t - 60), big ? 1.4 : 0.8);
        if (big) {
          cue(c.sfxWhooshClip, c.sfxWhooshGain * 1.2, c.sfxWhooshRate * 0.75, { lenMs: 600, fadeMs: 220 });
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.3, c.sfxBoomRate * 1.4, { lenMs: 300, fadeMs: 120 });
          scene?.launch(heroAt(t), c.launchSize);
        }
        break;
      case 'head': {
        // II-2: THE HEADER (a thud, a flash on the ball).
        cue(c.sfxKickClip, c.sfxKickGain * 0.9, c.sfxKickRate * 0.8);
        cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate * 1.2, { lenMs: 360, fadeMs: 160 });
        const b = ball(t);
        scene?.header({ x: b.x, y: b.y });
        break;
      }
      case 'strike': {
        // The kick that sends it (the volley, the corner, the finish, the BICYCLE KICK upside down in slow mo).
        const b = ball(t + 1);
        if (big) {
          cue(c.sfxKickClip, c.sfxKickGain * 1.3, c.sfxKickRate * 0.82, { tail: 0.1 });
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.7, c.sfxBoomRate * 1.2, { lenMs: 500, fadeMs: 200 });
          cue(c.sfxWhooshClip, c.sfxWhooshGain * 1.4, c.sfxWhooshRate * 0.9, { lenMs: 500, fadeMs: 200 });
          scene?.contact({ x: b.x, y: b.y }, blowDir, 1.4);
        } else {
          cue(c.sfxKickClip, c.sfxKickGain * (plan.kind === 'breakaway' ? 1.1 : 1), c.sfxKickRate);
          cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate, { lenMs: 420, fadeMs: 180 });
          scene?.strike({ x: b.x, y: b.y }, plan.kind === 'breakaway' ? 1.2 : 1);
          // II's corner: the crowd's "Ooooh" rises with the ball in flight (it peaks about a second in, near the goal).
          if (plan.kind === 'corner' && plan.variant !== 3) cue(c.sfxOohClip, c.sfxOohGain * 0.7, c.sfxOohRate, { fadeMs: 400 });
        }
        break;
      }
      case 'impact': {
        // THE BALL IN THE NET: the net, the crowd. IV: the frame rings, a boom, the explosion, the roar.
        cue(c.sfxNetClip, c.sfxNetGain * (big ? 1.3 : plan.kind === 'breakaway' ? 1.1 : 1), c.sfxNetRate * (big ? 0.9 : 1));
        if (big) {
          cue(c.sfxPostClip, c.sfxPostGain * 1.2, c.sfxPostRate, { lenMs: 1000, fadeMs: 300 });
          cue(c.sfxBoomClip, c.sfxBoomGain * 1.25, c.sfxBoomRate, { lenMs: 900, fadeMs: 300, tail: 0.12 });
          // The stadium erupts (the roar swells in its first few hundred ms) and the commentator screams GOLAZO! with the
          // word (the voice starts about 80 ms into its clip, as the word pops).
          cue(c.sfxRoarClip, c.sfxRoarGain * 1.3, c.sfxRoarRate, { fadeMs: 700 });
          cue(c.sfxGolazoClip, c.sfxGolazoGain, c.sfxGolazoRate, { fadeMs: 600 });
        } else {
          // The stadium roars (soft on the volley, fuller up the tiers).
          cue(c.sfxRoarClip, c.sfxRoarGain * (plan.tier === 1 ? 0.45 : plan.tier === 2 ? 0.75 : 1), c.sfxRoarRate, { lenMs: plan.tier === 1 ? 1400 : undefined, fadeMs: 600 });
        }
        scene?.goalHit(geo.hit, blowDir, { burst: plan.burst, rings: plan.rings, confetti: plan.confetti, big, blast: c.blastSize });
        seq.land();
        break;
      }
      case 'land':
        scene?.skid(heroAt(t), heading(t - 40), big ? 1.2 : 0.6);
        if (big) cue(c.sfxTouchClip, c.sfxTouchGain * 1.2, c.sfxTouchRate * 0.6);
        break;
      case 'slide':
        // IV: the knee slide celebration (a skid of grass).
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.6, c.sfxWhooshRate * 0.7, { lenMs: 500, fadeMs: 250 });
        scene?.slide(heroAt(t), heading(t + 40));
        break;
      case 'home':
        scene?.skid(heroAt(t), heading(t), 0.5);
        break;
      default:
        break;
    }
  };

  let lastTrail = -Infinity;
  let lastLine = -Infinity;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.strikeAt, plan.impactAt + 300);
    const cm = soccerCameraAt(plan, c, t, blowDir);
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
      if (b.flying && t - lastTrail >= (b.fire > 0 ? c.trailMs * 0.6 : c.trailMs)) { scene.trail(b); lastTrail = t; }
      // Speed lines behind a sprint (IV's run to the spot, and the leap).
      if (big && t >= plan.approachAt && t < plan.strikeAt && t - lastLine >= 50) { scene.speedLine(heroAt(t), heroAt(t - 40), aRadius); lastLine = t; }
      scene.setHeroShadow(p.air > 0.02 ? { x: o.attacker.x + p.x, y: o.attacker.y + p.y } : null, p.air, p.scale);
      const gs = goalAt(plan, t);
      scene.setGoal(goal, gs.alpha, gs.bulge, gs.shake, blowDir);
      const fl = flagAt(plan, t);
      scene.setFlag(geo.flag, fl.alpha, fl.wave);
      for (let i = 0; i < MAX_DEFENDERS; i++) scene.setDefender(i, defenderAt(plan, geo, i, aRadius, t));
    }
    if (foe.el) {
      // The target takes the blow: knocked back along the shot and squashed. Nothing before it.
      let kx = 0, ky = 0, sq = 0;
      const px = local ? 0.45 : 1;
      if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, big ? 4 : 5, big ? 95 : 70);
        const w = big ? 0.8 + 0.5 * plan.k : 0.35 + 0.25 * plan.k;
        kx += blowDir.x * c.knockPx * w * k * px; ky += blowDir.y * c.knockPx * w * k * px; sq += c.squash * (big ? 1 + 0.4 * plan.k : 0.4) * k;
      }
      const off = place(o.defender, { x: kx, y: ky }, foeInCam);
      const z = foeInCam || !cam.active ? 1 : cm.zoom;
      const still = Math.abs(kx) < 0.05 && Math.abs(ky) < 0.05 && Math.abs(sq) < 0.002;
      foe.set(still && (foeInCam || !cam.active || Math.abs(z - 1) < 1e-4) ? null
        : `translate(${(off.x / foeUnit).toFixed(2)}px, ${(off.y / foeUnit).toFixed(2)}px) scale(${((1 + sq * 0.55) * z).toFixed(4)}, ${((1 - sq) * z).toFixed(4)})`);
    }
  };

  const seq: Sequence<SoccerCue | FormationCue> = new Sequence<SoccerCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    // SLOW MO: the frame source hands the ONE clock a scaled step (a smooth ramp, never 0), so the portrait, the ball,
    // the FX, the camera and the cue timing all slow and speed up together.
    frames: (fn: (dt: number) => void) => (o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)))((dt) => fn(dt * (seq && !seq.done ? soccerTimeScale(plan, c, seq.t) : 1))),
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
