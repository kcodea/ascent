/**
 * THE IGGY BLAST RUNNER: plays one Iggy Blast hero attack (the beats are in `heroIggyConfig.ts`) and lands the
 * consequence on its impact beat (the surge detonating on the target). Presentation only: the total it shows and the
 * blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera (on the FX once: stageCamera.ts), the portraits (transform only,
 * restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer. What is Iggy's own: the
 * ward, the crouch, the staged breath, the push back, the rebound and its back-blast, the surge, its camera and sound.
 *
 * THE STAGE CONTRACT: every stage front that reaches the target is a tick (FX and sound only). The consequence
 * (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, when the surge detonates.
 *
 * Perf (docs/performance.md): DOM moves are `transform` written from the clock; nothing reads layout after the opening
 * measure; Pixi sprites and fire particles are pooled with hard caps, textures shared and pre-warmed during the
 * formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playEmberCrackle } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  getHeroIggyConfig, iggyCameraAt, iggyCameraFocus, iggyCues, iggyPlan, iggyPushAt, iggyStream, iggyStreamReach, iggySurgeAt,
  iggyWardAt, stageLook, type HeroIggyConfig, type IggyCue, type IggyPlan,
} from './heroIggyConfig';
import { HeroIggyScene, type HeroIggyTextures } from './heroIggyScene';
import { heroIggyTextures } from './heroIggyTextures';

export interface HeroIggyOptions extends HeroAttackOptions {
  cfg?: HeroIggyConfig;
  textures?: HeroIggyTextures | null;
}

export interface HeroIggyHandle extends HeroAttackHandle {
  readonly plan: IggyPlan;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroIggyScene | null;
}

/** The seed a fight's fire is scattered from: the same fight (same blow, same geometry) burns the same fire. */
export function iggySeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 43 + (side === 'opp' ? 211 : 29)) >>> 0;
}

/** Play Iggy Blast. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroIggy(o: HeroIggyOptions): HeroIggyHandle {
  const c = o.cfg ?? getHeroIggyConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = iggyPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, iggyCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const px = local ? 0.45 : 1;
  const wardR = aRadius * c.wardRadius;
  const stream = iggyStream(o.attacker, o.defender, aRadius, radius);
  const dir = stream.dir;

  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'higgy',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the breath) ──
  const textures = o.textures !== undefined ? o.textures : heroIggyTextures();
  const scene = textures && !reduced
    ? new HeroIggyScene(textures, {
      core: hexToNum(c.colorCore), hot: hexToNum(c.colorHot), flame: hexToNum(c.colorFlame), deep: hexToNum(c.colorDeep),
      ember: hexToNum(c.colorEmber), smoke: hexToNum(c.colorSmoke), ward: hexToNum(c.colorWard), side: hexToNum(sideHex),
    }, {
      streamFlame: c.streamFlame, streamSpeed: c.streamSpeed, turbulence: c.turbulence, buoyancy: c.buoyancy, smoke: c.smoke,
      embers: c.embers, wardAlpha: c.wardAlpha, backBlast: c.backBlast, shards: c.shards, explodeSize: c.explodeSize,
    }, s * px, iggySeed(o.total, dist, o.side))
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
    c.sfxWardClip, c.sfxGrowlClip, c.sfxBreathClip, c.sfxStageClip, c.sfxHitClip, c.sfxReboundClip, c.sfxShatterClip,
    c.sfxImpactClip, c.sfxThumpClip, c.sfxBoomClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const n = plan.stages.length;
  const d = o.defender;
  let wardDropped = false;

  const fire = (q: IggyCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        // The ward shimmers up; the dragon crouches and growls; debris flicks off its base.
        cue(c.sfxWardClip, c.sfxWardGain, c.sfxWardRate, { lenMs: 600, fadeMs: 250 });
        cue(c.sfxGrowlClip, c.sfxGrowlGain, c.sfxGrowlRate, { lenMs: 1200, fadeMs: 400, delayMs: real(80) });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.wardUpAt(o.attacker.x, o.attacker.y, wardR, dir);
        scene?.kickDebris(o.attacker.x, o.attacker.y, aRadius, dir, 6 + 2 * plan.tier);
        cam.start();
        break;
      case 'breath': {
        // The breath starts: thin and blue (the tier's first look), pouring toward the target.
        const look = stageLook(0, n);
        cue(c.sfxBreathClip, c.sfxBreathGain, c.sfxBreathRate, { lenMs: Math.max(600, real(plan.reboundAt - plan.breathAt + 200)), fadeMs: 350 });
        if (sound) voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain, durMs: real(plan.impactAt - plan.breathAt + 300) }));
        scene?.startStream(stream.mouth, stream.to, aRadius, plan.width * look.width);
        scene?.shiftStream({ heat: look.heat, width: plan.width * look.width, rate: look.rate, R: aRadius, level: 1 });
        break;
      }
      case 'stage': {
        // The breath SHIFTS UP (cyan, then white-cored): a roar a step higher, the stream widens, the ward flattens.
        const look = stageLook(q.i, n);
        cue(c.sfxStageClip, c.sfxStageGain * (0.8 + 0.15 * q.i), c.sfxStageRate + 0.08 * q.i, { lenMs: 700, fadeMs: 260 });
        scene?.shiftStream({ heat: look.heat, width: plan.width * look.width, rate: look.rate, R: aRadius, level: q.i + 1 });
        scene?.kickDebris(o.attacker.x, o.attacker.y, aRadius, dir, 3 + q.i * 2);
        break;
      }
      case 'hit':
        // A stage front reaching the target: a gust splash, FX only. The blow waits for the surge.
        cue(c.sfxHitClip, c.sfxHitGain, c.sfxHitRate + 0.06 * q.i, { lenMs: 420, fadeMs: 180 });
        scene?.splash(stream.to.x, stream.to.y, radius, dir, q.i + 1);
        break;
      case 'rebound':
        // THE REBOUND: the flattened ward springs back, the back-blast goes off behind the hero, the surge leaves.
        cue(c.sfxReboundClip, c.sfxReboundGain * (0.85 + 0.05 * plan.tier), c.sfxReboundRate, { tail: c.sfxTailMix, lenMs: 900, fadeMs: 320 });
        if (plan.shatter) cue(c.sfxShatterClip, c.sfxShatterGain, c.sfxShatterRate, { lenMs: 900, fadeMs: 300 });
        scene?.rebound({ shatter: plan.shatter, R: wardR, size: 0.8 + 0.25 * plan.tier });
        if (plan.shatter) wardDropped = true;
        break;
      case 'impact':
        // THE SURGE DETONATES: the blast, the hit and a low punch (bigger per tier). The consequence lands here, once.
        cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
        cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 500, fadeMs: 180 });
        if (plan.tier >= 3) cue(c.sfxHitClip, c.sfxHitGain * 1.6, c.sfxHitRate - 0.4, { tail: c.sfxTailMix, lenMs: 900, fadeMs: 300 });
        scene?.impact(d.x, d.y, radius, { size: 1 + 0.12 * plan.tier * plan.burst, big: plan.shatter, dir, flashAlpha: c.flashAlpha, embers: plan.embers });
        seq.land();
        break;
      case 'boom': {
        const a = q.i * 2.3 + 0.9;
        const rr = radius * (0.8 + 0.2 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.1, { lenMs: 420, fadeMs: 180 });
        scene?.boom(d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr * 0.8, radius, 0.9 + 0.15 * q.i);
        break;
      }
      default:
        break;
    }
  };

  const paintScene = (t: number): void => {
    if (!scene || plan.reduced) return;
    if (!wardDropped) {
      const w = iggyWardAt(plan, c, t);
      scene.setWard(w.up, w.flatten, w.glow);
      // The ward (I-III) calms after the impact and is put away once it has faded.
      if (t > plan.impactAt + 440) { scene.dropWard(); wardDropped = true; }
    }
    if (t >= plan.breathAt && t < plan.impactAt) scene.setStream(iggyStreamReach(plan, t));
    const sg = iggySurgeAt(plan, t);
    if (sg >= 0) scene.setSurge(sg);
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.breathAt, plan.impactAt + 200);
    const cm = iggyCameraAt(plan, c, t, dir);
    cam.apply(iggyCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, local ? 1 : s);
    if (hero.el && t >= plan.chargeAt) {
      // THE CROUCH: down and leaning in (squash), then the PUSH: slid back a step at each stage; the rebound throws it
      // forward (the push springs below zero) and it settles.
      const crouch = easeInOutSine(clamp01((t - plan.chargeAt) / Math.max(1, plan.breathAt - plan.chargeAt)))
        * (t < plan.reboundAt ? 1 : Math.max(0, spring(t - plan.reboundAt, 2.5, 90)));
      const push = iggyPushAt(plan, t);
      const back = plan.recoilPx * px * push;
      const sx = 1 + c.crouch * 0.5 * crouch, sy = 1 - c.crouch * crouch;
      const bx = -dir.x * back, by = -dir.y * back + c.crouch * 40 * px * crouch * 0.25;
      hero.set(Math.abs(sx - 1) + Math.abs(sy - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05
        ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`);
    }
    if (foe.el) {
      let css: string | null = null;
      if (t >= plan.impactAt) {
        // Knocked back along the stream and squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${(dir.x * knock).toFixed(2)}px, ${(dir.y * knock).toFixed(2)}px) scale(${(1 + sq * 0.6).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // The stream is shoving it: held back a little, a nudge at each stage front, a tremble while the breath pours.
        let k = 0.35;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        const tr = 0.8 * px * Math.sin(t * 0.5);
        css = `translate(${(dir.x * k * 6 * px + tr).toFixed(2)}px, ${(dir.y * k * 6 * px).toFixed(2)}px)`;
      }
      foe.set(css);
    }
  };

  const seq: Sequence<IggyCue | FormationCue> = new Sequence<IggyCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintScene(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => { nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck(); },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
