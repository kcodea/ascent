/**
 * THE FROST RUNNER: plays one Frost hero attack (the beats are in `heroFrostConfig.ts`) and lands the consequence on
 * its impact beat (the last icicle shattering, or Tier IV's encasement shattering). Presentation only: the total it
 * shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they
 * happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses: the ICE holds still, the clock does not), the damage formation, the `#stage` camera mirrored onto the Pixi
 * root, the portraits (transform only, restored after), the voices, the dim, reduced motion, finish / cancel and the
 * safety timer. What is Frost's own: the icicles, the frost creep, the Tier IV nova and encasement, its camera and its
 * sound.
 *
 * THE VOLLEY CONTRACT: every icicle that lands before the last is a tick (FX and a glassy crack only). The consequence
 * (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last icicle (Tier IV: on the encasement shattering).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites and strips are pooled per layer, textures painted once per session and pre-warmed
 * during the formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playFrostWind, playIceCrackle } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  frostArrivalDir, frostCameraAt, frostCameraFocus, frostCues, frostPlan, getHeroFrostConfig, icicleMotions, novaMotion,
  type FrostCue, type FrostPlan, type HeroFrostConfig, type IcicleMotion, type NovaMotion,
} from './heroFrostConfig';
import { HeroFrostScene, type HeroFrostTextures } from './heroFrostScene';
import { heroFrostTextures } from './heroFrostTextures';

export interface HeroFrostOptions extends HeroAttackOptions {
  cfg?: HeroFrostConfig;
  textures?: HeroFrostTextures | null;
}

export interface HeroFrostHandle extends HeroAttackHandle {
  readonly plan: FrostPlan;
  /** Every icicle's life (empty under reduced motion). Exposed for tests and the capture rig. */
  readonly motions: readonly IcicleMotion[];
  /** The Tier IV nova's run (null below Tier IV and under reduced motion). */
  readonly nova: NovaMotion | null;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroFrostScene | null;
}

/** The seed a fight's shards are scattered from: the same fight (same blow, same geometry) throws the same ice. */
export function frostSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 41 + (side === 'opp' ? 307 : 13)) >>> 0;
}

/** How many ice spikes burst from the struck portrait's rim on the impact, per tier (IV: off the shattered shell). */
const SPIKES: Record<number, number> = { 1: 0, 2: 5, 3: 7, 4: 10 };

/** Play Frost. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroFrost(o: HeroFrostOptions): HeroFrostHandle {
  const c = o.cfg ?? getHeroFrostConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = frostPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, frostCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const px = local ? 0.45 : 1;
  const motions = icicleMotions(plan, o.attacker, o.defender, aRadius, radius, c, s * px, (local ? 8 : 30) * s);
  const nova = novaMotion(plan, o.attacker, o.defender, aRadius, radius, c);
  const last = motions[motions.length - 1];
  // The direction the blow ARRIVES from (the last icicle, or the nova rolling in): the shake and the spray follow it.
  const dir = plan.nova && nova ? nova.dir : frostArrivalDir(last, o.attacker, o.defender);
  const fromAng = Math.atan2(-dir.y, -dir.x);

  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hfrost',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first icicle) ──
  const textures = o.textures !== undefined ? o.textures : heroFrostTextures();
  const scene = textures && !reduced
    ? new HeroFrostScene(textures, {
      core: hexToNum(c.colorCore), ice: hexToNum(c.colorIce), deep: hexToNum(c.colorDeep), side: hexToNum(sideHex), shade: hexToNum(c.colorShade),
    }, {
      thick: c.icicleThick, glow: c.icicleGlow, core: c.icicleCore, trailMs: c.trailMs, trailWidth: c.trailWidth * px, dust: c.dust,
      shatterSize: c.shatterSize * px, snowPuffs: c.snowPuffs, creepMs: c.creepMs, creepFerns: c.creepFerns, creepReach: c.creepReach,
      snowDensity: c.snowDensity, groundFerns: c.groundFerns, groundFadeMs: c.groundFadeMs, encaseSize: c.encaseSize,
    }, s, frostSeed(o.total, dist, o.side))
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
    c.sfxFormClip, c.sfxChimeClip, c.sfxSheenClip, c.sfxLaunchClip, c.sfxDustClip, c.sfxHitClip, c.sfxShatterClip,
    c.sfxImpactClip, c.sfxThumpClip, c.sfxBigClip, c.sfxReleaseClip, c.sfxEncaseClip, c.sfxBurstClip, c.sfxBoomClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const n = plan.icicles.length;
  // The frost creeping over the struck portrait holds until just after the end, then thaws.
  const creepHold = (t: number): number => Math.max(300, plan.endAt - t + 150);
  let hitStep = 0;

  const fire = (q: FrostCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The cold gathers: a crystalline forming chime and a shimmer.
        cue(c.sfxFormClip, c.sfxFormGain, c.sfxFormRate, { lenMs: 1100, fadeMs: 300 });
        cue(c.sfxSheenClip, c.sfxSheenGain, c.sfxSheenRate, { lenMs: 800, fadeMs: 300, delayMs: real(80) });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, aRadius, plan.fireAt - plan.chargeAt, plan.k, n);
        cam.start();
        break;
      case 'grow': {
        // Each icicle crystallising: a bright chime, a little higher each time.
        cue(c.sfxChimeClip, c.sfxChimeGain * (0.7 + 0.3 / n), c.sfxChimeRate + 0.07 * q.i, { lenMs: 520, fadeMs: 220 });
        const m = motions[q.i];
        if (m) scene?.grow(m);
        break;
      }
      case 'fire': {
        // Each icicle leaves: a sharp whoosh (a step higher each), and the ice dust shimmers after the first.
        cue(c.sfxLaunchClip, c.sfxLaunchGain * (q.i === n - 1 ? 1 : 0.78), c.sfxLaunchRate + 0.05 * q.i, { lenMs: c.sfxLaunchLenMs, fadeMs: 240 });
        if (q.i === 0) cue(c.sfxDustClip, c.sfxDustGain, c.sfxDustRate, { lenMs: 800, fadeMs: 300, delayMs: real(60) });
        const m = motions[q.i];
        if (m) scene?.fire(m);
        break;
      }
      case 'hit': {
        // A volley icicle shatters: a glassy crack pitched up each tick (the rhythm), FX only. The blow waits.
        const m = motions[q.i];
        cue(c.sfxHitClip, c.sfxHitGain, c.sfxHitRate + 0.07 * hitStep, { lenMs: 480, fadeMs: 200 });
        if (m && scene) {
          scene.shatter(m, frostArrivalDir(m, o.attacker, o.defender), { size: 0.85 + 0.1 * plan.k, shards: 8 + 2 * plan.tier, big: false, burst: 1, flashAlpha: c.flashAlpha, radius, tier: plan.tier, spikes: 0 });
          scene.creep(o.defender.x, o.defender.y, radius, fromAng, plan.creep * 0.55, creepHold(t));
        }
        hitStep++;
        break;
      }
      case 'novaCharge':
        // The cold gathers for the nova: the freezing howl rises to the release and trails off as the wave rolls.
        voices.keep(playFrostWind('attack', {
          gain: c.sfxWindGain, buildMs: real(plan.novaAt - plan.novaChargeAt), tailMs: real(plan.contactAt - plan.novaAt + 200),
          lowHz: c.sfxWindLowHz, highHz: c.sfxWindHighHz,
        }));
        scene?.startNovaCharge(o.attacker.x, o.attacker.y, aRadius, plan.novaAt - plan.novaChargeAt, dir);
        break;
      case 'nova':
        // THE NOVA: a cinematic whoosh-hit, the crackle of freezing ground under the rolling wave.
        cue(c.sfxReleaseClip, c.sfxReleaseGain, c.sfxReleaseRate, { lenMs: 1200, fadeMs: 400 });
        cue(c.sfxLaunchClip, c.sfxLaunchGain * 0.8, c.sfxLaunchRate - 0.2, { lenMs: c.sfxLaunchLenMs, fadeMs: 260 });
        voices.keep(playIceCrackle('attack', { gain: c.sfxCrackleGain * 0.6, durMs: real(plan.contactAt - plan.novaAt) }));
        if (nova) scene?.release(nova);
        break;
      case 'contact':
        // ENCASED: a freezing chime-crunch as the ice snaps shut, and the ice straining until it bursts.
        cue(c.sfxEncaseClip, c.sfxEncaseGain, c.sfxEncaseRate, { lenMs: 900, fadeMs: 300 });
        cue(c.sfxHitClip, c.sfxHitGain * 0.8, c.sfxHitRate - 0.15, { lenMs: 400, fadeMs: 160 });
        voices.keep(playIceCrackle('attack', { gain: c.sfxCrackleGain, durMs: real(plan.impactAt - plan.contactAt) }));
        scene?.contact(o.defender.x, o.defender.y, radius, plan.impactAt - plan.contactAt);
        scene?.creep(o.defender.x, o.defender.y, radius, fromAng, plan.creep, creepHold(t));
        break;
      case 'impact':
        if (plan.nova) {
          // THE ENCASEMENT SHATTERS: a big glassy burst (a blast pitched up so it cracks, not booms), the impact, a punch.
          cue(c.sfxShatterClip, c.sfxShatterGain * 1.15, c.sfxShatterRate - 0.08, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxBurstClip, c.sfxBurstGain, c.sfxBurstRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.06, { lenMs: 800, fadeMs: 300 });
          cue(c.sfxHitClip, c.sfxHitGain * 1.1, c.sfxHitRate + 0.1, { lenMs: 500, fadeMs: 200 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.15, c.sfxBigRate - 0.05, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxThumpClip, c.sfxThumpGain * 1.1, c.sfxThumpRate - 0.05, { lenMs: 500, fadeMs: 180 });
          scene?.shatterNova(o.defender.x, o.defender.y, radius, dir, { burst: plan.burst, shards: Math.min(60, c.encaseShards), flashAlpha: c.flashAlpha, spikes: SPIKES[4]! });
        } else {
          // THE LAST ICICLE: a glassy shatter, the impact and a low punch (bigger per tier).
          cue(c.sfxShatterClip, c.sfxShatterGain * (0.85 + 0.05 * plan.tier), c.sfxShatterRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { lenMs: 800, fadeMs: 300 });
          cue(c.sfxHitClip, c.sfxHitGain * 1.05, c.sfxHitRate + 0.07 * hitStep, { lenMs: 520, fadeMs: 200 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 500, fadeMs: 180 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          if (last && scene) {
            scene.shatter(last, dir, { size: 1.15, shards: plan.shards, big: true, burst: plan.burst, flashAlpha: c.flashAlpha, radius, tier: plan.tier, spikes: SPIKES[plan.tier] ?? 0 });
            scene.creep(o.defender.x, o.defender.y, radius, fromAng, plan.creep, creepHold(t));
          }
        }
        seq.land();
        break;
      case 'boom': {
        const a = q.i * 2.3 + 0.9;
        const rr = radius * (0.75 + 0.2 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.1, { lenMs: 420, fadeMs: 180 });
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr * 0.8, 0.9 + 0.15 * q.i);
        break;
      }
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.nova ? 420 : 200));
    const cm = frostCameraAt(plan, c, t, dir);
    cam.apply(frostCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, local ? 1 : s);
    if (hero.el && t >= plan.chargeAt) {
      // Swell while the ice forms; a small recoil along the line on each launch; Tier IV: a deeper gather, a thrust.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.fireAt) sc = 1 + c.heroSwell * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      else sc = 1 + c.heroSwell * Math.max(0, spring(t - plan.fireAt, 4, 70));
      for (const r of plan.icicles) {
        const k = r.launchAt <= t ? Math.max(0, spring(t - r.launchAt, 3.5, 55)) : 0;
        bx -= dir.x * c.recoilPx * px * k; by -= dir.y * c.recoilPx * px * k;
      }
      if (plan.nova && t >= plan.novaChargeAt) {
        if (t < plan.novaAt) {
          const u = (t - plan.novaChargeAt) / Math.max(1, plan.novaAt - plan.novaChargeAt);
          sc += c.heroSwell * 1.3 * easeInOutSine(u);
          const tr = 1.4 * px * u * u;
          bx += tr * Math.sin(t * 0.31); by += tr * Math.sin(t * 0.37);
        } else {
          const k = spring(t - plan.novaAt, 3, 90);
          sc += c.heroSwell * 1.3 * Math.max(0, k);
          bx += dir.x * c.recoilPx * 1.6 * px * Math.max(0, spring(t - plan.novaAt, 4, 50));
          by += dir.y * c.recoilPx * 1.6 * px * Math.max(0, spring(t - plan.novaAt, 4, 50));
        }
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    if (foe.el) {
      let css: string | null = null;
      if (plan.nova && t >= plan.contactAt && t < plan.impactAt) {
        // ENCASED: held rigid in the ice, straining harder as it cracks (anticipation; the clock never stops).
        const u = clamp01((t - plan.contactAt) / Math.max(1, plan.impactAt - plan.contactAt));
        const a = (0.4 + 2.2 * u * u) * px;
        const jolt = Math.max(0, spring(t - plan.contactAt, 5, 40)) * 6 * px;
        css = `translate(${(dir.x * jolt + a * Math.sin(t * 0.47)).toFixed(2)}px, ${(dir.y * jolt + a * Math.sin(t * 0.53)).toFixed(2)}px) scale(${(1 + 0.02 * u).toFixed(4)})`;
      } else if (t >= plan.impactAt) {
        // Knocked back along the blow and squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${(dir.x * knock).toFixed(2)}px, ${(dir.y * knock).toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // Each icicle that shatters on it nudges it along the throw.
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        css = k < 0.004 ? null : `translate(${(dir.x * k * 6 * px).toFixed(2)}px, ${(dir.y * k * 6 * px).toFixed(2)}px)`;
      }
      foe.set(css);
    }
  };

  const seq: Sequence<FrostCue | FormationCue> = new Sequence<FrostCue | FormationCue>({
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
    nova,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
