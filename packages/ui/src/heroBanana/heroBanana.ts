/**
 * THE BANANA CANNON RUNNER: plays one Banana Cannon hero attack (the beats are in `heroBananaConfig.ts`) and lands the
 * consequence on its impact beat (the last banana splatting, or Tier IV's giant golden banana slamming down).
 * Presentation only: the total it shows and the blow it lands are handed in, already decided by the engine; this file
 * only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera mirrored onto the Pixi root, the portraits (transform only,
 * restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer. What is the cannon's own:
 * the cannon, the lobbed bananas, the pump-and-fire rhythm, the splats, the Tier IV royal shot, its camera and sound.
 *
 * THE BARRAGE CONTRACT: every banana that splats in before the last is a tick (FX and sound only; at Tier IV every
 * regular banana is). The consequence (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last banana
 * (Tier IV: on the giant's slam).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites are pooled per layer, textures painted once per session and pre-warmed during the
 * formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  arrivalDir, bananaCameraAt, bananaCameraFocus, bananaCues, bananaPlan, cannonRig, getHeroBananaConfig,
  type BananaCue, type BananaPlan, type CannonRig, type HeroBananaConfig,
} from './heroBananaConfig';
import { HeroBananaScene, type HeroBananaTextures } from './heroBananaScene';
import { heroBananaTextures } from './heroBananaTextures';

export interface HeroBananaOptions extends HeroAttackOptions {
  cfg?: HeroBananaConfig;
  textures?: HeroBananaTextures | null;
}

export interface HeroBananaHandle extends HeroAttackHandle {
  readonly plan: BananaPlan;
  /** The cannon and every banana's flight (no shots under reduced motion). Exposed for tests and the capture rig. */
  readonly rig: CannonRig;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroBananaScene | null;
}

/** The seed a fight's chunks are scattered from: the same fight (same blow, same geometry) splats the same way. */
export function bananaSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 5)) >>> 0;
}

/** Play the Banana Cannon. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroBanana(o: HeroBananaOptions): HeroBananaHandle {
  const c = o.cfg ?? getHeroBananaConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = bananaPlan({ total: o.total, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, bananaCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hbanana',
  });

  // A banana's arc never rises above the top of the screen (the giant may leave it and come back); the bananas splat
  // clear of the big -N.
  const rig = cannonRig(plan, o.attacker, o.defender, radius, aRadius, c, c.cannonLength * s, (local ? 8 : 36) * s, nums.pts.hit, c.giantOvershoot * s);
  const last = rig.shots[rig.shots.length - 1];
  // The direction the blow ARRIVES from (the last banana's heading): the shake and the knockback follow it.
  const dir = arrivalDir(last, o.attacker, o.defender);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the cannon) ──
  const textures = o.textures !== undefined ? o.textures : heroBananaTextures();
  const scene = textures && !reduced
    ? new HeroBananaScene(textures, {
      banana: hexToNum(c.colorBanana), gold: hexToNum(c.colorGold), barrel: hexToNum(c.colorBarrel), dark: hexToNum(c.colorDark),
      cream: hexToNum(c.colorCream), smoke: hexToNum(c.colorSmoke), leaf: hexToNum(c.colorLeaf), side: hexToNum(sideHex),
    }, {
      cannonLength: c.cannonLength, popMs: c.cannonPopMs, recoil: c.recoilPx, puffs: c.muzzlePuffs, leaves: c.leaves, bananaLength: c.bananaLength,
      trailAlpha: c.trailAlpha, tickChunks: c.tickChunks, starSize: c.starSize, peelHoldMs: c.peelHoldMs, gravity: c.gravity,
      showerBananas: c.showerBananas, shockSize: c.shockSize, goldRays: c.goldRays,
    }, s, bananaSeed(o.total, dist, o.side))
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
    c.sfxSummonClip, c.sfxSparkleClip, c.sfxPumpClip, c.sfxFireClip, c.sfxBoomClip, c.sfxWhooshClip, c.sfxSplatClip,
    c.sfxSmackClip, c.sfxImpactClip, c.sfxPowerClip, c.sfxMarkClip, c.sfxSlamClip, c.sfxPopClip, c.sfxStowClip,
  ]);
  const n = plan.shots.length;
  let hitStep = 0;

  const fire = (q: BananaCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The royal banana cannon pops in on the hero's rim with a clunk and a sparkle, and swings round to aim.
        cue(c.sfxSummonClip, c.sfxSummonGain, c.sfxSummonRate, { lenMs: 600, fadeMs: 200 });
        cue(c.sfxSparkleClip, c.sfxSparkleGain, c.sfxSparkleRate, { lenMs: 900, fadeMs: 300 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.summon(rig.pivot, rig.rest, rig.shots[0]?.dir ?? rig.rest, c.cannonPopMs);
        cam.start();
        break;
      case 'pump': {
        // CHK: the cannon bulges (each pump a touch higher; the giant's a heavy one).
        const giant = plan.shots[q.i]?.giant ?? false;
        cue(c.sfxPumpClip, c.sfxPumpGain * (giant ? 1.3 : 1), c.sfxPumpRate + (giant ? -0.25 : 0.04 * q.i), { lenMs: 260, fadeMs: 90 });
        scene?.aim(rig.shots[q.i]?.dir ?? rig.rest);
        scene?.pump(giant ? 1.6 : 1);
        break;
      }
      case 'fire': {
        // FOOMP: the launch, a muzzle boom and a whoosh (the giant: lower, heavier, louder).
        const m = rig.shots[q.i];
        const giant = m?.giant ?? false;
        const lastOne = q.i === n - 1;
        cue(c.sfxFireClip, c.sfxFireGain * (giant ? 1.25 : lastOne ? 1 : 0.85), c.sfxFireRate * (giant ? 0.75 : 1) + (giant ? 0 : 0.04 * q.i), { lenMs: c.sfxFireLenMs, fadeMs: 200 });
        cue(c.sfxBoomClip, c.sfxBoomGain * (giant ? 2 : 1), c.sfxBoomRate * (giant ? 0.62 : 1), { lenMs: giant ? 900 : 380, fadeMs: giant ? 300 : 140 });
        cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate * (giant ? 0.7 : 1) + (giant ? 0 : 0.03 * q.i), { lenMs: 420, fadeMs: 160, delayMs: 60 / speed });
        if (m && scene) scene.fire(m, giant ? plan.shots[q.i]!.size : plan.size * (plan.shots[q.i]?.size ?? 1), t - q.at, q.i);
        // After the shot the cannon swings to the next one's heading.
        const next = rig.shots[q.i + 1];
        if (next) scene?.aim(next.dir);
        break;
      }
      case 'hit': {
        // A banana SPLATS in before the last: a wet splat and a smack, pitched up each tick. FX only.
        cue(c.sfxSplatClip, c.sfxSplatGain * 0.8, c.sfxSplatRate + 0.06 * hitStep, { lenMs: 500, fadeMs: 180 });
        cue(c.sfxSmackClip, c.sfxSmackGain * 0.75, c.sfxSmackRate + 0.05 * hitStep, { lenMs: 320, fadeMs: 120 });
        scene?.hit(q.i, o.defender.x, o.defender.y, radius, hitStep);
        hitStep++;
        break;
      }
      case 'glint':
        // THE ROYAL SHOT charges: a rising power-up, a sparkle, the crown glints.
        cue(c.sfxPowerClip, c.sfxPowerGain, c.sfxPowerRate, { lenMs: Math.max(300, (plan.shots[n - 1]!.fireAt - plan.glintAt) / speed + 200), fadeMs: 200 });
        cue(c.sfxSparkleClip, c.sfxSparkleGain * 1.2, c.sfxSparkleRate * 1.15, { lenMs: 900, fadeMs: 300, delayMs: 140 / speed });
        scene?.glint(plan.shots[n - 1]!.fireAt - plan.glintAt);
        break;
      case 'mark':
        // The giant is up out of frame: a descending whoosh while the golden target ring locks on.
        cue(c.sfxMarkClip, c.sfxMarkGain, c.sfxMarkRate, { lenMs: Math.max(250, (plan.impactAt - plan.markAt) / speed + 150), fadeMs: 150 });
        scene?.startMark(o.defender.x, o.defender.y, radius, plan.impactAt - plan.markAt);
        break;
      case 'impact':
        if (plan.giant) {
          // THE SLAM: a heavy rock impact, a big low boom, a squelch, a crit crack on top.
          cue(c.sfxSlamClip, c.sfxSlamGain, c.sfxSlamRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxBoomClip, c.sfxBoomGain * 2.2, c.sfxBoomRate * 0.55, { lenMs: 1000, fadeMs: 350 });
          cue(c.sfxSplatClip, c.sfxSplatGain * 1.2, c.sfxSplatRate * 0.7, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxImpactClip, c.sfxImpactGain * 1.1, c.sfxImpactRate - 0.05, { lenMs: 700, fadeMs: 250 });
          scene?.slam(q.i, o.defender.x, o.defender.y, radius, { burst: plan.burst, chunks: plan.chunks, peels: plan.peels, flashAlpha: c.flashAlpha });
        } else {
          // THE LAST BANANA: the splat, the smack, a crit crack (bigger per tier), a boom on III.
          cue(c.sfxSplatClip, c.sfxSplatGain, c.sfxSplatRate - 0.04 * (plan.tier - 1), { tail: c.sfxTailMix, lenMs: 700, fadeMs: 250 });
          cue(c.sfxSmackClip, c.sfxSmackGain, c.sfxSmackRate, { lenMs: 400, fadeMs: 150 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { lenMs: c.sfxImpactLenMs, fadeMs: 300 });
          if (plan.tier >= 3) cue(c.sfxBoomClip, c.sfxBoomGain * 1.4, c.sfxBoomRate * 0.8, { lenMs: 600, fadeMs: 250 });
          scene?.impact(q.i, o.defender.x, o.defender.y, radius, { tier: plan.tier, k: plan.k, burst: plan.burst, chunks: plan.chunks, peels: plan.peels, flashAlpha: c.flashAlpha });
        }
        seq.land();
        break;
      case 'stow':
        cue(c.sfxStowClip, c.sfxStowGain, c.sfxStowRate, { lenMs: 300, fadeMs: 120 });
        scene?.stow();
        break;
      case 'boom': {
        const a = q.i * 2.1 + 0.7;
        const rr = radius * (0.85 + 0.15 * (q.i % 2));
        cue(c.sfxPopClip, c.sfxPopGain, c.sfxPopRate + q.i * 0.1, { lenMs: 420, fadeMs: 160 });
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr * 0.9, (radius / 80) * (0.9 + 0.12 * q.i));
        break;
      }
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.giant ? 420 : 200));
    const cm = bananaCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(bananaCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The hero braces as the cannon appears (a lean back, a small swell); each shot's recoil shoves it back.
      let sc = 1, bx = 0, by = 0;
      const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      const settle = t > plan.stowAt ? 1 - clamp01((t - plan.stowAt) / 240) : 1;
      sc = 1 + 0.035 * u * settle;
      bx = -toFoe.x * c.heroCoilPx * px * u * settle; by = -toFoe.y * c.heroCoilPx * px * u * settle;
      for (const sp of plan.shots) {
        if (sp.fireAt > t) continue;
        const f = c.heroRecoilPx * px * (sp.giant ? 2 : 1) * Math.max(0, spring(t - sp.fireAt, 4, 90));
        bx -= toFoe.x * f; by -= toFoe.y * f;
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let css: string | null = null;
      if (plan.giant && t >= plan.markAt && t < plan.impactAt) {
        // The golden ring locks on: the target cowers (a small tremble and a squeeze, growing as the giant falls).
        const u = clamp01((t - plan.markAt) / Math.max(1, plan.impactAt - plan.markAt));
        const a = (0.3 + 1.6 * u * u) * px;
        fx = a * Math.sin(t * 0.23); fy = a * Math.sin(t * 0.31);
        css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - 0.03 * u).toFixed(4)})`;
      } else if (t >= plan.impactAt) {
        // Knocked back along the blow (the slam: straight down, harder) and squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        const kd = plan.giant ? { x: 0, y: 1 } : dir;
        fx = kd.x * knock; fy = kd.y * knock;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq * (plan.giant ? 0.4 : 1)).toFixed(4)}, ${(1 + sq * (plan.giant ? -0.9 : 0.6)).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // Each tick nudges the target along the banana that hit it.
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        fx = dir.x * k * 6 * px; fy = dir.y * k * 6 * px;
        css = k < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
      }
      foe.set(css);
    }
    // The stuck peels, the star and the target ring ride the portrait (the offset in the overlay's px).
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<BananaCue | FormationCue> = new Sequence<BananaCue | FormationCue>({
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
    rig,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
