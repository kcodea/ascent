/**
 * THE POISON DARTS RUNNER: plays one Poison Darts hero attack (the beats are in `heroPoisonConfig.ts`) and lands the
 * consequence on its impact beat (the last dart thunking in, or Tier IV's toxic burst). Presentation only: the total it
 * shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they
 * happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera (on the FX once: stageCamera.ts), the portraits (transform only,
 * restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer. What is Poison's own: the
 * dart paths, the throw rhythm, the stick, the Tier IV implosion, its camera and its sound.
 *
 * THE VOLLEY CONTRACT: every dart that thunks in before the last is a tick (FX and sound only; at Tier IV every dart
 * is). The consequence (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last dart (Tier IV: on the
 * burst).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites and strips are pooled per layer, textures painted once per session and pre-warmed
 * during the formation, the synth buffers built during the formation too, and the updater unhooks the moment the scene
 * drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playAcidSizzle, playToxicFizz, warmPoisonSynths } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  arrivalDir, dartMotions, getHeroPoisonConfig, poisonCameraAt, poisonCameraFocus, poisonCues, poisonPlan,
  type DartMotion, type HeroPoisonConfig, type PoisonCue, type PoisonPlan,
} from './heroPoisonConfig';
import { HeroPoisonScene, type HeroPoisonTextures } from './heroPoisonScene';
import { heroPoisonTextures } from './heroPoisonTextures';

export interface HeroPoisonOptions extends HeroAttackOptions {
  cfg?: HeroPoisonConfig;
  textures?: HeroPoisonTextures | null;
}

export interface HeroPoisonHandle extends HeroAttackHandle {
  readonly plan: PoisonPlan;
  /** Every dart's flight (empty under reduced motion). Exposed for tests and the capture rig. */
  readonly motions: readonly DartMotion[];
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroPoisonScene | null;
}

/** The seed a fight's droplets are scattered from: the same fight (same blow, same geometry) splashes the same way. */
export function poisonSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 41 + (side === 'opp' ? 307 : 11)) >>> 0;
}

/** Play Poison Darts. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroPoison(o: HeroPoisonOptions): HeroPoisonHandle {
  const c = o.cfg ?? getHeroPoisonConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = poisonPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, poisonCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hpoison',
  });

  // A dart's arc never rises above the top of the screen (or the sandbox box); the darts stick clear of the big -N.
  const motions = dartMotions(plan, o.attacker, o.defender, radius, aRadius, { ...c, dartLength: c.dartLength * s }, (local ? 8 : 36) * s, nums.pts.hit);
  const last = motions[motions.length - 1];
  // The direction the blow ARRIVES from (the last dart's heading): the shake and the knockback follow it. The burst
  // knocks straight down.
  const dir = plan.implode ? { x: 0, y: 1 } : arrivalDir(last, o.attacker, o.defender);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first dart) ──
  const textures = o.textures !== undefined ? o.textures : heroPoisonTextures();
  const scene = textures && !reduced
    ? new HeroPoisonScene(textures, {
      core: hexToNum(c.colorCore), venom: hexToNum(c.colorVenom), acid: hexToNum(c.colorAcid), dark: hexToNum(c.colorDark), side: hexToNum(sideHex),
    }, {
      length: c.dartLength, glow: c.dartGlow, trailMs: c.trailMs, trailWidth: c.trailWidth, wisps: c.wisps, quiver: c.quiver,
      splash: c.splashSize, tickDrops: c.tickDrops, tint: c.tintAlpha, gravity: c.dropGravity, hazeAlpha: c.hazeAlpha, hazeMs: c.hazeMs,
      cloudPuffs: c.cloudPuffs, cloudSize: c.cloudSize,
    }, s, poisonSeed(o.total, dist, o.side))
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
    c.sfxReadyClip, c.sfxThrowClip, c.sfxSnapClip, c.sfxThunkClip, c.sfxMeatClip, c.sfxSplashClip,
    c.sfxImpactClip, c.sfxBigClip, c.sfxSuckClip, c.sfxBurstClip, c.sfxGushClip, c.sfxBoomClip,
  ]);
  if (sound && !reduced) warmPoisonSynths();
  const real = (ms: number): number => ms / speed;
  const n = plan.darts.length;
  const hand = motions[0]?.a ?? o.attacker;
  let hitStep = 0;
  const sizzle = (gain: number, durMs: number): void => { if (sound && gain > 0) voices.keep(playAcidSizzle('attack', { gain, durMs: real(durMs) })); };

  const fire = (q: PoisonCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The hero readies, sneakily: a glint of venom at the hand, a soft sheen.
        cue(c.sfxReadyClip, c.sfxReadyGain, c.sfxReadyRate, { lenMs: 700, fadeMs: 250 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, hand, aRadius, plan.throwAt - plan.chargeAt, n, 6 + 3 * plan.tier);
        cam.start();
        break;
      case 'throw': {
        // THWIP: a quick swish and a whip-snap crack pitched up (a little higher per dart), entered at its crack.
        const m = motions[q.i];
        const lastOne = q.i === n - 1;
        cue(c.sfxThrowClip, c.sfxThrowGain * (lastOne ? 1 : 0.8), c.sfxThrowRate + 0.05 * q.i, { lenMs: c.sfxThrowLenMs, fadeMs: 120 });
        cue(c.sfxSnapClip, c.sfxSnapGain * (lastOne ? 1 : 0.75), c.sfxSnapRate + 0.04 * q.i, { startMs: 440, lenMs: 180, fadeMs: 90 });
        if (m && scene) scene.throw(m, plan.size * (plan.darts[q.i]?.size ?? 1), t - q.at, q.i);
        break;
      }
      case 'hit': {
        // A dart THUNKS in before the last: a meaty thunk, a wet splat and a sizzle, pitched up each tick. FX only.
        cue(c.sfxThunkClip, c.sfxThunkGain * 0.85, c.sfxThunkRate + 0.05 * hitStep, { lenMs: 450, fadeMs: 160 });
        cue(c.sfxMeatClip, c.sfxMeatGain * 0.7, c.sfxMeatRate + 0.04 * hitStep, { lenMs: 300, fadeMs: 120 });
        cue(c.sfxSplashClip, c.sfxSplashGain * 0.7, c.sfxSplashRate + 0.05 * hitStep, { lenMs: 500, fadeMs: 200 });
        sizzle(c.sfxSizzleGain * 0.6, 260);
        scene?.hit(q.i, o.defender.x, o.defender.y, radius, hitStep);
        hitStep++;
        break;
      }
      case 'swell':
        // The venom swells: the fizz, bubbling faster and higher, peaks exactly at the suck.
        if (sound) voices.keep(playToxicFizz('attack', { gain: c.sfxFizzGain, buildMs: real(plan.suckAt - plan.swellAt), lowHz: c.sfxFizzLowHz, highHz: c.sfxFizzHighHz }));
        scene?.startSwell(o.defender.x, o.defender.y, radius, plan.suckAt - plan.swellAt, plan.impactAt - plan.suckAt);
        break;
      case 'suck':
        cue(c.sfxSuckClip, c.sfxSuckGain, c.sfxSuckRate, { lenMs: 650, fadeMs: 200 });
        scene?.suck();
        break;
      case 'impact':
        if (plan.implode) {
          // THE TOXIC BURST: a wet gush, a crack (pitched up so it punches, not booms), the thunk layered low, a sizzle.
          cue(c.sfxGushClip, c.sfxGushGain, c.sfxGushRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxBurstClip, c.sfxBurstGain, c.sfxBurstRate, { lenMs: 600, fadeMs: 260 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.05, { lenMs: 500, fadeMs: 180 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.1, c.sfxBigRate - 0.05, { lenMs: 700, fadeMs: 250 });
          sizzle(c.sfxSizzleGain * 1.3, 900);
          scene?.burst(o.defender.x, o.defender.y, radius, { burst: plan.burst, size: c.burstSize, drops: plan.drops, flashAlpha: c.flashAlpha });
        } else {
          // THE LAST DART: the thunk, the meat, the splat (bigger per tier), a sizzle; a crack on III.
          cue(c.sfxThunkClip, c.sfxThunkGain, c.sfxThunkRate + 0.05 * hitStep, { tail: c.sfxTailMix, lenMs: 600, fadeMs: 200 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { lenMs: c.sfxImpactLenMs, fadeMs: 300 });
          cue(c.sfxMeatClip, c.sfxMeatGain, c.sfxMeatRate - 0.03 * (plan.tier - 1), { lenMs: 400, fadeMs: 150 });
          cue(c.sfxSplashClip, c.sfxSplashGain * (0.9 + 0.1 * plan.tier), c.sfxSplashRate - 0.04 * (plan.tier - 1), { lenMs: 700, fadeMs: 250 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          sizzle(c.sfxSizzleGain, 520);
          scene?.impact(n - 1, o.defender.x, o.defender.y, radius, { tier: plan.tier, k: plan.k, burst: plan.burst, drops: plan.drops, flashAlpha: c.flashAlpha });
        }
        seq.land();
        break;
      case 'seep':
        // The poison takes hold: a soft wet pop and a sizzle, FX only.
        cue(c.sfxBoomClip, c.sfxBoomGain * 0.8, c.sfxBoomRate - 0.1, { lenMs: 400, fadeMs: 160 });
        sizzle(c.sfxSizzleGain * 0.7, 520);
        scene?.seep(o.defender.x, o.defender.y, radius);
        break;
      case 'dissolve':
        scene?.dissolve();
        break;
      case 'boom': {
        const a = q.i * 2.3 + 0.9;
        const rr = radius * (0.75 + 0.2 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.1, { lenMs: 450, fadeMs: 180 });
        sizzle(c.sfxSizzleGain * 0.5, 300);
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr * 0.8, 0.9 + 0.15 * q.i);
        break;
      }
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.throwAt, plan.impactAt + (plan.implode ? 420 : 200));
    const cm = poisonCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(poisonCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The ready: a sneaky lean BACK from the target and a small swell; each throw FLICKS it toward the target.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.throwAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.throwAt - plan.chargeAt));
        sc = 1 + 0.04 * u;
        bx = -toFoe.x * c.heroCoilPx * px * u; by = -toFoe.y * c.heroCoilPx * px * u;
      } else {
        const back = Math.max(0, spring(t - plan.throwAt, 3, 90));
        sc = 1 + 0.04 * back;
        bx = -toFoe.x * c.heroCoilPx * px * back; by = -toFoe.y * c.heroCoilPx * px * back;
        for (const d of plan.darts) {
          if (d.throwAt > t) continue;
          const f = c.heroFlickPx * px * spring(t - d.throwAt, 5, 60);
          bx += toFoe.x * f; by += toFoe.y * f;
        }
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let css: string | null = null;
      if (plan.implode && t >= plan.swellAt && t < plan.impactAt) {
        // The venom swells in the struck hero: it trembles harder and swells, then is squeezed in by the suck.
        const u = clamp01((t - plan.swellAt) / Math.max(1, plan.suckAt - plan.swellAt));
        const su = clamp01((t - plan.suckAt) / Math.max(1, plan.impactAt - plan.suckAt));
        const a = (0.4 + 2.2 * u * u) * px;
        fx = a * Math.sin(t * 0.23); fy = a * Math.sin(t * 0.31);
        const sc = 1 + 0.035 * easeInOutSine(u) - 0.07 * su * su;
        css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${sc.toFixed(4)})`;
      } else if (t >= plan.impactAt) {
        // Knocked back along the blow (the burst: straight down) and squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        fx = dir.x * knock; fy = dir.y * knock;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // Each tick nudges the target along the dart that hit it.
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        fx = dir.x * k * 6 * px; fy = dir.y * k * 6 * px;
        css = k < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
      }
      foe.set(css);
    }
    // The stuck darts and the tint ride the portrait (the offset in the overlay's px).
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<PoisonCue | FormationCue> = new Sequence<PoisonCue | FormationCue>({
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
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
