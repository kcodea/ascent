/**
 * THE ARCANA RUNNER: plays one Arcana hero attack (the beats are in `heroArcanaConfig.ts`) and lands the consequence on
 * its impact beat (the last ribbon landing, or Tier IV's explosion). Presentation only: the total it shows and the
 * blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as Blast and Quake do: one clock (it never pauses),
 * the damage formation, the `#stage` camera (on the FX once: stageCamera.ts), the portraits (transform only, restored
 * after), the voices, the dim, reduced motion, finish / cancel and the safety timer. What is Arcana's own: the ribbon
 * paths, the barrage rhythm, the Tier IV vortex, its camera and its sound.
 *
 * THE BARRAGE CONTRACT: every ribbon that lands before the last is a tick (FX and a chime only). The consequence
 * (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last ribbon (Tier IV: on the explosion).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites and strip meshes are pooled per layer, textures painted once per session, and the
 * updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playSwirlTone } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  arcanaCameraAt, arcanaCameraFocus, arcanaCues, arcanaPlan, arrivalDir, getHeroArcanaConfig, ribbonMotions,
  type ArcanaCue, type ArcanaPlan, type HeroArcanaConfig, type RibbonMotion,
} from './heroArcanaConfig';
import { HeroArcanaScene, type HeroArcanaTextures } from './heroArcanaScene';
import { heroArcanaTextures } from './heroArcanaTextures';

export interface HeroArcanaOptions extends HeroAttackOptions {
  cfg?: HeroArcanaConfig;
  textures?: HeroArcanaTextures | null;
}

export interface HeroArcanaHandle extends HeroAttackHandle {
  readonly plan: ArcanaPlan;
  /** Every ribbon's flight (empty under reduced motion). Exposed for tests and the capture rig. */
  readonly motions: readonly RibbonMotion[];
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroArcanaScene | null;
}

/** The seed a fight's sparkle is scattered from: the same fight (same blow, same geometry) throws the same glitter. */
export function arcanaSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 5)) >>> 0;
}

/** Play Arcana. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroArcana(o: HeroArcanaOptions): HeroArcanaHandle {
  const c = o.cfg ?? getHeroArcanaConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = arcanaPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, arcanaCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // The lobs never arc above the top of the screen (or the sandbox box): a lob at the foe's corner flattens instead.
  const motions = ribbonMotions(plan, o.attacker, o.defender, radius, c, (local ? 8 : 36) * s);
  const last = motions[motions.length - 1];
  // The direction the blow ARRIVES from (the last ribbon's dive into the target): the shake and the spray follow it.
  const dir = plan.swirl ? { x: 0, y: 1 } : arrivalDir(last, o.attacker, o.defender);
  const spinDir = o.attacker.x <= o.defender.x ? 1 : -1;

  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'harcana',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first ribbon) ──
  const textures = o.textures !== undefined ? o.textures : heroArcanaTextures();
  const scene = textures && !reduced
    ? new HeroArcanaScene(textures, {
      core: hexToNum(c.colorCore), accent: hexToNum(c.colorAccent), side: hexToNum(sideHex), shade: hexToNum(c.colorShade),
    }, {
      lengthMs: c.ribbonLength, glow: c.ribbonGlow, core: c.ribbonCore, shade: c.ribbonShade, twist: c.ribbonTwist, strand: c.strand,
      headSize: c.headSize, sigilSize: c.sigilSize,
    }, s, arcanaSeed(o.total, dist, o.side))
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
    c.sfxCastClip, c.sfxChargeClip, c.sfxLaunchClip, c.sfxShimmerClip, c.sfxHitClip,
    c.sfxImpactClip, c.sfxChimeClip, c.sfxThumpClip, c.sfxImplodeClip, c.sfxExplodeClip, c.sfxBigClip, c.sfxBoomClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const n = plan.ribbons.length;
  let hitStep = 0;

  const fire = (q: ArcanaCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The spell is cast: a shimmer of casting, and a riser whose climax lands on the first launch.
        cue(c.sfxCastClip, c.sfxCastGain, c.sfxCastRate, { lenMs: 900, fadeMs: 250 });
        voices.riser(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate, real(plan.fireAt - plan.chargeAt));
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, aRadius, plan.fireAt - plan.chargeAt, plan.k, n, 8 + 6 * plan.tier);
        cam.start();
        break;
      case 'fire': {
        // Each ribbon: a sparkling whoosh, a little higher each time; a shimmer rides the first one in flight.
        const r = plan.ribbons[q.i]!;
        const m = motions[q.i];
        cue(c.sfxLaunchClip, c.sfxLaunchGain * (q.i === n - 1 ? 1 : 0.75), c.sfxLaunchRate + 0.05 * q.i, { lenMs: c.sfxLaunchLenMs, fadeMs: 260 });
        if (q.i === 0) cue(c.sfxShimmerClip, c.sfxShimmerGain, c.sfxShimmerRate, { lenMs: 900, fadeMs: 300, delayMs: real(90) });
        if (m && scene) {
          const v = m.vortex;
          scene.fire(m, plan.width, r.size, t - q.at, v ? { cx: v.cx, cy: v.cy, r: (v.r0 + v.r1) / 2, tilt: v.tilt, start: v.start, end: v.end, w0: v.w0, w1: v.w1 } : null);
        }
        break;
      }
      case 'hit': {
        // A barrage ribbon lands: a bright crack pitched up each tick (the rhythm), FX only. The blow waits for the last.
        const m = motions[q.i];
        cue(c.sfxHitClip, c.sfxHitGain, c.sfxHitRate + 0.06 * hitStep, { lenMs: 500, fadeMs: 200 });
        scene?.hit(o.defender.x, o.defender.y, arrivalDir(m, o.attacker, o.defender), 0.85 + 0.1 * plan.k, hitStep);
        hitStep++;
        break;
      }
      case 'orbit':
        // A ribbon joins the vortex: a soft chime climbing with each one.
        cue(c.sfxChimeClip, c.sfxChimeGain * 0.5, c.sfxChimeRate + 0.08 * q.i, { lenMs: 500, fadeMs: 220 });
        break;
      case 'swirl':
        // The vortex forms: the rising swirl tone, timed to peak exactly on the explosion.
        voices.keep(playSwirlTone('attack', { gain: c.sfxSwirlGain, buildMs: real(plan.impactAt - plan.swirlAt), lowHz: c.sfxSwirlLowHz, highHz: c.sfxSwirlHighHz }));
        {
          const v = motions[0]?.vortex;
          if (v) scene?.startVortex(o.defender.x, o.defender.y, v.r0, v.r1, v.tilt, plan.convergeAt - plan.swirlAt, plan.impactAt - plan.convergeAt, spinDir);
        }
        break;
      case 'converge':
        cue(c.sfxImplodeClip, c.sfxImplodeGain, c.sfxImplodeRate, { lenMs: 700, fadeMs: 200 });
        scene?.converge();
        break;
      case 'impact':
        if (plan.swirl) {
          // THE EXPLOSION: a punchy blast (pitched up, so it cracks rather than booms), a bright chime, the impact.
          cue(c.sfxExplodeClip, c.sfxExplodeGain, c.sfxExplodeRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.08, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxChimeClip, c.sfxChimeGain, c.sfxChimeRate, { lenMs: 900, fadeMs: 300 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.15, c.sfxBigRate - 0.05, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxThumpClip, c.sfxThumpGain * 1.1, c.sfxThumpRate - 0.05, { lenMs: 500, fadeMs: 180 });
          scene?.explode(o.defender.x, o.defender.y, radius, {
            burst: plan.burst, size: c.explodeSize, ribbons: Math.min(16, c.explodeRibbons), motes: plan.motes, flashAlpha: c.flashAlpha,
            tilt: c.swirlTilt, dir: spinDir, width: plan.width,
          });
        } else {
          // THE LAST RIBBON: a bright arcane crack and chime, the impact, a low punch (bigger per tier).
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxHitClip, c.sfxHitGain * 1.1, c.sfxHitRate + 0.06 * hitStep, { lenMs: 600, fadeMs: 220 });
          cue(c.sfxChimeClip, c.sfxChimeGain, c.sfxChimeRate + 0.04 * (plan.tier - 1), { lenMs: 900, fadeMs: 300 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 500, fadeMs: 180 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          scene?.impact(o.defender.x, o.defender.y, dir, radius, { tier: plan.tier, k: plan.k, burst: plan.burst, flashAlpha: c.flashAlpha, motes: plan.motes });
        }
        seq.land();
        break;
      case 'boom': {
        const a = q.i * 2.4 + 0.6;
        const rr = radius * (0.7 + 0.2 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.08, { lenMs: 600, fadeMs: 220 });
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr * 0.7, 0.9 + 0.1 * q.i);
        break;
      }
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.swirl ? 420 : 200));
    const cm = arcanaCameraAt(plan, c, t, dir);
    cam.apply(arcanaCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, local ? 1 : s);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // Swell through the charge; a small recoil down on each launch (the lob kicks the caster); settle.
      let sc = 1, back = 0;
      if (t < plan.fireAt) sc = 1 + c.heroSwell * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      else {
        sc = 1 + c.heroSwell * Math.max(0, spring(t - plan.fireAt, 4, 70));
        for (const r of plan.ribbons) back += c.recoilPx * px * Math.max(0, spring(t - r.launchAt, 3.5, 55)) * (r.launchAt <= t ? 1 : 0);
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(back) < 0.05 ? null : `translate(0px, ${back.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    if (foe.el) {
      let css: string | null = null;
      if (plan.swirl && t >= plan.swirlAt && t < plan.impactAt) {
        // Caught in the vortex: lifted a little, trembling harder as it tightens (anticipation).
        const u = clamp01((t - plan.swirlAt) / Math.max(1, plan.impactAt - plan.swirlAt));
        const lift = -6 * px * easeInOutSine(u);
        const a = (0.5 + 2.5 * u * u) * px;
        css = `translate(${(a * Math.sin(t * 0.23)).toFixed(2)}px, ${(lift + a * Math.sin(t * 0.31)).toFixed(2)}px) scale(${(1 + 0.03 * u).toFixed(4)})`;
      } else if (t >= plan.impactAt) {
        // Knocked back along the blow (the explosion: straight down) and squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${(dir.x * knock).toFixed(2)}px, ${(dir.y * knock).toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // Each barrage tick nudges the target along the ribbon that hit it.
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        css = k < 0.004 ? null : `translate(${(dir.x * k * 6 * px).toFixed(2)}px, ${(dir.y * k * 6 * px).toFixed(2)}px)`;
      }
      foe.set(css);
    }
  };

  const seq: Sequence<ArcanaCue | FormationCue> = new Sequence<ArcanaCue | FormationCue>({
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
