/**
 * THE SUCKER PUNCH RUNNER (style id `glove`, a Rare hero attack): plays one spring-glove punch (the beats are in
 * `heroGloveConfig.ts`) and lands the consequence on its impact beat (the LAST bop). Presentation only: the total and
 * the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses), the damage formation, the
 * `#stage` camera (applied ONCE: `stageCamera.ts`), the portraits (transform only, restored after), the voices, the dim,
 * reduced motion, finish / cancel and the safety timer.
 *
 * THE DOUBLE BOP CONTRACT: Big's first bop is a tick (FX and sound only). The consequence (`onImpact`) lands exactly
 * ONCE, on the last bop. The retract and the hatch shutting come after it and are looks only.
 *
 * GEOMETRY is measured once, from the two portrait centres and radii the caller hands in: the hatch sits on the edge of
 * the striking portrait facing the target and the whole punch runs along that line (`gloveMotion`), so it works in both
 * directions and at any distance and angle. The one rolled variation (which side the glove glances past on the
 * overshoot) comes from `rollSeed` (or, without one, from the blow itself), never from `Math.random`.
 *
 * Perf: DOM moves are `transform` only, from the clock; no layout reads after the opening measure; the hatch, the coil's
 * strokes and the glove are taken from the pool once at the pop and only moved after that; textures painted once per
 * session and pre-warmed during the formation; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  gloveCameraAt, gloveCameraFocus, gloveCues, gloveMotion, glovePlan, getHeroGloveConfig,
  type GloveCue, type GloveMotion, type GlovePlan, type HeroGloveConfig,
} from './heroGloveConfig';
import { HeroGloveScene, type HeroGloveTextures } from './heroGloveScene';
import { heroGloveTextures } from './heroGloveTextures';

export interface HeroGloveOptions extends HeroAttackOptions {
  cfg?: HeroGloveConfig;
  textures?: HeroGloveTextures | null;
}

export interface HeroGloveHandle extends HeroAttackHandle {
  readonly plan: GlovePlan;
  /** The punch's geometry (null with reduced motion). */
  readonly motion: GloveMotion | null;
  readonly scene: HeroGloveScene | null;
  readonly mirrorsCamera: boolean;
}

/** The seed when the caller rolls none: the blow itself, so the same fight plays the same. */
export function gloveSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 4513 + Math.round(distance) * 29 + (side === 'opp' ? 173 : 19)) >>> 0;
}

/** Play the Sucker Punch. Returns a handle; the blow lands via `onImpact` on the last bop. */
export function playHeroGlove(o: HeroGloveOptions): HeroGloveHandle {
  const c = o.cfg ?? getHeroGloveConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = glovePlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, gloveCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hglove',
  });

  const seed = (o.rollSeed ?? gloveSeed(o.total, dist, o.side)) >>> 0;
  const motion = gloveMotion(plan, {
    attacker: o.attacker, defender: o.defender, radius, aRadius, glovePx: c.glovePx * plan.size * s, pitchPx: c.springPitch * s, seed,
  });
  const toFoe = motion ? motion.u : (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  const big = plan.hits.length > 0;

  const textures = o.textures !== undefined ? o.textures : heroGloveTextures();
  const scene = textures && motion
    ? new HeroGloveScene(textures, {
      glove: hexToNum(c.colorGlove), trim: hexToNum(c.colorTrim), spring: hexToNum(c.colorSpring), hatch: hexToNum(c.colorHatch),
      star: hexToNum(c.colorStar), flash: hexToNum(c.colorFlash), side: hexToNum(sideHex),
    }, { hatchPx: c.hatchPx * (0.85 + 0.15 * plan.size), springWidth: c.springWidth, springThick: c.springThick, bop: c.bopSize, squash: c.gloveSquash, closeMs: c.closeMs }, s, seed)
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxPopClip, c.sfxBoingClip, c.sfxPunchClip, c.sfxRetractClip, c.sfxHomeClip, c.sfxSpringClip, c.sfxRatchetClip, c.sfxBodyClip, c.sfxRecoilClip]);
  // The squash SCALES the struck portrait: without a layer hint the browser re-rasters it at every new scale (a run of
  // dropped frames after the bop, measured). The hint is held for the attack only and put back exactly on every exit.
  const foeWill = foe.el ? foe.el.style.willChange : '';
  if (foe.el) foe.el.style.willChange = 'transform';
  /** Where a bop bursts: the knuckles at the bop (the glove's centre there, plus most of half its length). */
  const bopAt = motion ? { x: motion.hit.x + motion.u.x * motion.glove * 0.42, y: motion.hit.y + motion.u.y * motion.glove * 0.42 } : o.defender;

  const fire = (q: GloveCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'pop':
        // The hatch: a ratchet click, then the lid's thock (its hit is 50 ms into the clip).
        cue(c.sfxRatchetClip, c.sfxRatchetGain, c.sfxRatchetRate, { fadeMs: 60 });
        cue(c.sfxPopClip, c.sfxPopGain, c.sfxPopRate, { startMs: 28, lenMs: 150, fadeMs: 70, delayMs: 30 / speed });
        if (motion) scene?.pop(motion, t - q.at);
        break;
      case 'fire':
        // The boing as the coil lets go (Big: lower and fuller).
        cue(c.sfxBoingClip, c.sfxBoingGain * (big ? 1 : 0.85), c.sfxBoingRate * (big ? 0.94 : 1.08), { fadeMs: 160 });
        // Under it the steel coil's own twang (pitched well down, so it is a body, not a ping) and the rush of the glove.
        cue(c.sfxSpringClip, c.sfxSpringGain * (big ? 1 : 0.8), c.sfxSpringRate * (big ? 1 : 1.15), { fadeMs: 220 });
        cue(c.sfxRetractClip, c.sfxRetractGain * 0.8, c.sfxRetractRate, { startMs: 330, lenMs: 300, fadeMs: 120 });
        scene?.fire();
        break;
      case 'hit':
        // The first bop (a tick), and the spring boings again as it overshoots and sways.
        cue(c.sfxPunchClip, c.sfxPunchGain * 0.55, c.sfxPunchRate * 1.18, { lenMs: 320, fadeMs: 140 });
        cue(c.sfxBodyClip, c.sfxBodyGain * 0.35, c.sfxBodyRate * 1.25, { lenMs: 200, fadeMs: 120 });
        cue(c.sfxBoingClip, c.sfxBoingGain * 0.8, c.sfxBoingRate * 1.3, { delayMs: 50 / speed, fadeMs: 200 });
        cue(c.sfxSpringClip, c.sfxSpringGain * 0.6, c.sfxSpringRate * 1.3, { delayMs: 50 / speed, fadeMs: 260 });
        // The sway: the coil wobbles once more, lower, half way to the second bop.
        cue(c.sfxBoingClip, c.sfxBoingGain * 0.55, c.sfxBoingRate * 1.05, { delayMs: (plan.impactAt - q.at) * 0.5 / speed, lenMs: 300, fadeMs: 160 });
        scene?.bop(bopAt, toFoe, 0.65, 2);
        break;
      case 'impact':
        // THE blow: the padded thud with a low body under it (Big: lower, fuller, clearly harder than the tick before).
        cue(c.sfxPunchClip, c.sfxPunchGain * (big ? 1.25 : 0.9), c.sfxPunchRate * (big ? 0.88 : 1), { fadeMs: 180, tail: big ? 0.1 : 0 });
        cue(c.sfxBodyClip, c.sfxBodyGain * (big ? 1.2 : 0.75), c.sfxBodyRate * (big ? 0.9 : 1.05), { lenMs: 420, fadeMs: 220 });
        scene?.bop(bopAt, toFoe, big ? 1.75 : 1, big ? 9 : 4);
        if (plan.stars > 0) {
          // Stars circle the struck head: a flat ring over the top of the portrait.
          scene?.seeStars({ x: o.defender.x, y: o.defender.y - radius * 0.86 }, radius * 0.66, radius * 0.18, plan.stars, plan.starsMs, 46 * plan.size);
        }
        seq.land();
        break;
      case 'retract':
        // The coil winding back in: the ratchety squeeze, the boing played BACKWARD (it swells as the spring closes),
        // and the rush of the glove coming home.
        cue(c.sfxRecoilClip, c.sfxRecoilGain, c.sfxRecoilRate, { fadeMs: 80 });
        cue(c.sfxBoingClip, c.sfxBoingGain * 0.5, c.sfxBoingRate * 1.1, { reverse: true, lenMs: 380, fadeMs: 60 });
        cue(c.sfxRetractClip, c.sfxRetractGain, c.sfxRetractRate, { startMs: 300, lenMs: 360, fadeMs: 160 });
        break;
      case 'home':
        cue(c.sfxHomeClip, c.sfxHomeGain, c.sfxHomeRate, { startMs: 28, lenMs: 150, fadeMs: 80 });
        cue(c.sfxBodyClip, c.sfxBodyGain * 0.4, c.sfxBodyRate * 1.2, { lenMs: 200, fadeMs: 120 });
        scene?.home();
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + 200);
    const cm = gloveCameraAt(plan, c, t, toFoe);
    const unit = local ? 1 : s;
    cam.apply(gloveCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.popAt) {
      // A hop as the hatch pops, a lean back as the glove winds up, a kick BACK as the spring lets go (the recoil),
      // and a bump as the glove thumps home.
      const sgn = toFoe.x >= 0 ? 1 : -1;
      let sc = 1 + 0.04 * Math.max(0, spring(t - plan.popAt, 5, 55));
      let lean = 0, rot = 0;
      if (t < plan.fireAt) {
        const u = easeInOutSine((t - plan.popAt - 100) / Math.max(1, plan.fireAt - plan.popAt - 100));
        lean = -c.heroWindPx * plan.wind * u;
        rot = -3.5 * plan.wind * u * sgn;
      } else {
        const k = spring(t - plan.fireAt, 4.5, 75);
        lean = -(c.heroWindPx * plan.wind * 0.4 + c.heroKickPx * (0.6 + 0.4 * plan.wind)) * k;
        rot = -3.5 * plan.wind * Math.max(0, k) * sgn;
      }
      if (t >= plan.homeAt) {
        const k = spring(t - plan.homeAt, 5, 65);
        lean -= c.heroKickPx * 0.5 * k;
        sc += c.homePop * Math.max(0, k);
      }
      const bx = toFoe.x * lean * px, by = toFoe.y * lean * px;
      const still = Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(rot) < 0.01;
      hero.set(still ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`);
    }
    // The struck portrait: a nudge on the tick bop, the knock back and squash on the impact.
    let fx = 0, fy = 0;
    let css: string | null = null;
    let nudge = 0;
    for (const at of plan.hits) nudge += Math.max(0, spring(t - at, 6, 50)) * 9;
    if (t >= plan.impactAt) {
      const k = spring(t - plan.impactAt, 4.5, 80);
      const knock = (c.knockPx * (big ? 1.7 : 1) * k + nudge) * px;
      const sq = c.squash * (big ? 1.7 : 1) * k;
      fx = toFoe.x * knock; fy = toFoe.y * knock;
      css = Math.abs(k) < 0.004 && nudge < 0.05 ? null
        : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
    } else if (nudge >= 0.05) {
      fx = toFoe.x * nudge * px; fy = toFoe.y * nudge * px;
      css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
    }
    foe.set(css);
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<GloveCue | FormationCue> = new Sequence<GloveCue | FormationCue>({
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
    motion,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
