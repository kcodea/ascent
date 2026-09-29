/**
 * THE FIRE RUNNER: plays one Fire ("Inferno") hero attack (the beats are in `heroFireConfig.ts`) and lands the
 * consequence on its impact beat (the last fireball bursting, or Tier IV's meteor detonating). Presentation only: the
 * total it shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on
 * screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera mirrored onto the Pixi root, the portraits (transform only,
 * restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer. What is Fire's own: the
 * kindling, the fireballs, the blaze, the Tier IV summon, meteor and detonation, its camera and its sound.
 *
 * THE VOLLEY CONTRACT: every fireball that lands before the last is a tick (FX and a crackling burst only). The
 * consequence (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last fireball (Tier IV: on the
 * meteor's detonation).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites and fire particles are pooled with hard caps, textures painted once per session and
 * pre-warmed during the formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playEmberCrackle, playRumble } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  fireArrivalDir, fireCameraAt, fireCameraFocus, fireCues, firePlan, fireballMotions, getHeroFireConfig, meteorMotion,
  type FireCue, type FirePlan, type FireballMotion, type HeroFireConfig, type MeteorMotion,
} from './heroFireConfig';
import { HeroFireScene, type HeroFireTextures } from './heroFireScene';
import { heroFireTextures } from './heroFireTextures';

export interface HeroFireOptions extends HeroAttackOptions {
  cfg?: HeroFireConfig;
  textures?: HeroFireTextures | null;
}

export interface HeroFireHandle extends HeroAttackHandle {
  readonly plan: FirePlan;
  /** Every fireball's life (empty under reduced motion). Exposed for tests and the capture rig. */
  readonly motions: readonly FireballMotion[];
  /** The Tier IV meteor's fall (null below Tier IV and under reduced motion). */
  readonly meteor: MeteorMotion | null;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroFireScene | null;
}

/** The seed a fight's fire is scattered from: the same fight (same blow, same geometry) burns the same fire. */
export function fireSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 41 + (side === 'opp' ? 307 : 17)) >>> 0;
}

/** Play Fire. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroFire(o: HeroFireOptions): HeroFireHandle {
  const c = o.cfg ?? getHeroFireConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = firePlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, fireCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const px = local ? 0.45 : 1;
  // The top of the frame: fireballs never ignite above it, and the meteor starts above it.
  const ceilY = local ? 8 * s : 0;
  const motions = fireballMotions(plan, o.attacker, o.defender, aRadius, radius, c, s * px, ceilY);
  const meteor = meteorMotion(plan, o.attacker, o.defender, radius, c, 0);
  const last = motions[motions.length - 1];
  // The direction the blow ARRIVES from (the last fireball, or the meteor falling): the shake and the spray follow it.
  const dir = plan.meteor && meteor ? meteor.dir : fireArrivalDir(last, o.attacker, o.defender);
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const screen = Math.max(vw, vh);

  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hfire',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first fireball) ──
  const textures = o.textures !== undefined ? o.textures : heroFireTextures();
  const scene = textures && !reduced
    ? new HeroFireScene(textures, {
      core: hexToNum(c.colorCore), hot: hexToNum(c.colorHot), flame: hexToNum(c.colorFlame), deep: hexToNum(c.colorDeep),
      ember: hexToNum(c.colorEmber), smoke: hexToNum(c.colorSmoke), side: hexToNum(sideHex),
    }, {
      kindle: c.kindle, ballFlame: c.ballFlame, ballGlow: c.ballGlow, trail: c.trail, trailSmoke: c.trailSmoke,
      turbulence: c.turbulence, buoyancy: c.buoyancy, smoke: c.smoke, embers: c.embers, explodeSize: c.explodeSize,
      blazeSize: c.blazeSize, novaSize: c.novaSize, novaMs: c.novaMs, engulfMs: c.engulfMs, burnoutMs: c.burnoutMs, scorch: c.scorch,
    }, s * px, fireSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxIgniteClip, c.sfxFormClip, c.sfxLaunchClip, c.sfxTrailClip, c.sfxHitClip, c.sfxBlastClip, c.sfxImpactClip,
    c.sfxThumpClip, c.sfxBigClip, c.sfxSummonClip, c.sfxMeteorClip, c.sfxDetonateClip, c.sfxBoomClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const n = plan.balls.length;
  const d = o.defender;
  let hitStep = 0;

  const fire = (q: FireCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        // The fire catches: a whoomp of flame, a crackle through the kindling.
        cue(c.sfxIgniteClip, c.sfxIgniteGain, c.sfxIgniteRate, { lenMs: 1000, fadeMs: 350 });
        if (sound) voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain * 0.6, durMs: real(plan.fireAt - plan.chargeAt + 200) }));
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, aRadius, plan.fireAt - plan.chargeAt, n);
        cam.start();
        break;
      case 'grow': {
        // Each fireball igniting: a rising charge, a little higher each time.
        cue(c.sfxFormClip, c.sfxFormGain * (0.7 + 0.3 / n), c.sfxFormRate + 0.07 * q.i, { lenMs: 520, fadeMs: 220 });
        const m = motions[q.i];
        if (m) scene?.grow(m, Math.min(1, 1.3 / Math.sqrt(n)));
        break;
      }
      case 'fire': {
        // Each fireball leaves: a heavy whoosh (a step higher each); the first carries the roar of its flame.
        cue(c.sfxLaunchClip, c.sfxLaunchGain * (q.i === n - 1 ? 1 : 0.78), c.sfxLaunchRate + 0.05 * q.i, { lenMs: c.sfxLaunchLenMs, fadeMs: 260 });
        if (q.i === 0) cue(c.sfxTrailClip, c.sfxTrailGain, c.sfxTrailRate, { lenMs: 900, fadeMs: 350, delayMs: real(30) });
        const m = motions[q.i];
        if (m) scene?.fireBall(m);
        break;
      }
      case 'hit': {
        // A volley fireball bursts: a crackling burst pitched up each tick (the rhythm), FX only. The blow waits.
        const m = motions[q.i];
        cue(c.sfxHitClip, c.sfxHitGain, c.sfxHitRate + 0.06 * hitStep, { lenMs: 520, fadeMs: 220 });
        if (m && scene) {
          scene.land(m);
          scene.explode(m.to.x, m.to.y, radius, { size: 0.85 + 0.1 * plan.k, big: false, dir: fireArrivalDir(m, o.attacker, d), flashAlpha: c.flashAlpha, embers: Math.round(plan.embers * 0.3) });
          // The struck hero CATCHES: every tick sets more of its rim alight (III builds toward the blaze).
          if (plan.blaze > 0) scene.ablaze(d.x, d.y, radius, plan.blaze * (0.25 + 0.12 * hitStep), 260 + 60 * hitStep);
        }
        hitStep++;
        break;
      }
      case 'summon':
        // THE SUMMON: the column of fire roars up; a rumble builds under the fall to the detonation.
        cue(c.sfxSummonClip, c.sfxSummonGain, c.sfxSummonRate, { lenMs: 1100, fadeMs: 400 });
        if (sound) {
          voices.keep(playRumble('attack', {
            gain: c.sfxRoarGain, buildMs: real(plan.impactAt - plan.summonAt), holdMs: real(80), tailMs: real(900),
            lowHz: c.sfxRoarLowHz, highHz: c.sfxRoarHighHz,
          }));
        }
        scene?.summon(o.attacker.x, o.attacker.y, aRadius, plan.meteorAt - plan.summonAt);
        // The struck hero is MARKED from here until the meteor lands: the build-up (owner: "slightly slower build up").
        scene?.markTarget(d.x, d.y, radius, plan.impactAt - plan.summonAt);
        break;
      case 'meteor':
        // The meteor falls: a riser placed so its hit lands on the detonation.
        voices.riser(c.sfxMeteorClip, c.sfxMeteorGain, c.sfxMeteorRate, real(plan.impactAt - plan.meteorAt));
        if (meteor) scene?.startMeteor(meteor, radius);
        break;
      case 'impact':
        if (plan.meteor) {
          // THE DETONATION: the ground-shaking boom, the blast, the hit, a crack and a punch; the fire crackles as it burns out.
          cue(c.sfxDetonateClip, c.sfxDetonateGain, c.sfxDetonateRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxBlastClip, c.sfxBlastGain * 1.1, c.sfxBlastRate - 0.1, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.06, { lenMs: 800, fadeMs: 300 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.15, c.sfxBigRate - 0.05, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxThumpClip, c.sfxThumpGain * 1.1, c.sfxThumpRate - 0.05, { lenMs: 500, fadeMs: 180 });
          if (sound) voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain, durMs: real(c.engulfMs + c.burnoutMs) }));
          scene?.detonate(d.x, d.y, radius, { burst: plan.burst, flashAlpha: c.flashAlpha, embers: plan.embers, screen });
        } else {
          // THE LAST FIREBALL: the blast, the hit and a low punch (bigger per tier); a crackle while the rim burns.
          cue(c.sfxBlastClip, c.sfxBlastGain * (0.85 + 0.05 * plan.tier), c.sfxBlastRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { lenMs: 800, fadeMs: 300 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 500, fadeMs: 180 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          if (sound && plan.blaze > 0) voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain * Math.min(1, plan.blaze), durMs: real(plan.blazeMs + 600) }));
          if (last && scene) {
            scene.land(last);
            scene.explode(last.to.x, last.to.y, radius, { size: 1.05 + 0.1 * plan.tier, big: true, dir, flashAlpha: c.flashAlpha, embers: plan.embers });
          }
          // III: the struck hero FLARES UP (a gout of flame off the portrait).
          if (plan.tier >= 3) scene?.flareUp(d.x, d.y, radius, Math.min(1.4, plan.blaze));
          // The blaze burns at full until just before the sequence ends, then dies down (never long past it).
          scene?.ablaze(d.x, d.y, radius, plan.blaze, Math.min(plan.blazeMs, Math.max(0, plan.endAt - plan.impactAt - 100)));
        }
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

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.meteor ? 420 : 200));
    const cm = fireCameraAt(plan, c, t, dir);
    cam.apply(fireCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, local ? 1 : s);
    const aim = fireArrivalDir(undefined, o.attacker, o.defender);
    if (hero.el && t >= plan.chargeAt) {
      // Swell while the fire gathers; a small recoil along the line on each launch; Tier IV: rise and thrust up for the summon.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.fireAt) sc = 1 + c.heroSwell * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      else sc = 1 + c.heroSwell * Math.max(0, spring(t - plan.fireAt, 4, 70));
      for (const r of plan.balls) {
        const k = r.launchAt <= t ? Math.max(0, spring(t - r.launchAt, 3.5, 55)) : 0;
        bx -= aim.x * c.recoilPx * px * k; by -= aim.y * c.recoilPx * px * k;
      }
      if (plan.meteor && t >= plan.summonAt) {
        const k = Math.max(0, spring(t - plan.summonAt, 3, 110));
        sc += c.heroSwell * 1.4 * k;
        by -= 10 * px * k;
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    if (foe.el) {
      let css: string | null = null;
      if (plan.meteor && t >= plan.meteorAt && t < plan.impactAt) {
        // The meteor bears down: the struck hero trembles harder as it nears (anticipation; the clock never stops).
        const u = clamp01((t - plan.meteorAt) / Math.max(1, plan.impactAt - plan.meteorAt));
        const a = (0.4 + 2.6 * u * u) * px;
        css = `translate(${(a * Math.sin(t * 0.47)).toFixed(2)}px, ${(a * Math.sin(t * 0.53)).toFixed(2)}px)`;
      } else if (t >= plan.impactAt) {
        // Knocked back along the blow and squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${(dir.x * knock).toFixed(2)}px, ${(dir.y * knock).toFixed(2)}px) scale(${(1 + sq * 0.6).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // Each fireball that bursts on it nudges it along the throw.
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        css = k < 0.004 ? null : `translate(${(aim.x * k * 6 * px).toFixed(2)}px, ${(aim.y * k * 6 * px).toFixed(2)}px)`;
      }
      foe.set(css);
    }
  };

  const seq: Sequence<FireCue | FormationCue> = new Sequence<FireCue | FormationCue>({
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
    motions,
    meteor,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
