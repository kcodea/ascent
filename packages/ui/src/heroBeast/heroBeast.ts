/**
 * THE STAMPEDE RUNNER: plays one beast chomp rush hero attack (the beats are in `heroBeastConfig.ts`) and lands the
 * consequence on its impact beat (the last chomp, or Tier IV's colossal jaws slamming shut). Presentation only: the
 * total it shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on
 * screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera mirrored onto the Pixi root, the portraits (transform only,
 * restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer. What is the Stampede's
 * own: the leaps, the pack rhythm, the chomp, the colossus, its camera and its sound.
 *
 * THE PACK CONTRACT: every chomp before the last is a tick (FX and sound only; at Tier IV every chomp is). The
 * consequence (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last chomp (Tier IV: on the slam).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites and strips are pooled per layer, textures painted once per session and pre-warmed
 * during the formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playRumble } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  arrivalDir, beastCameraAt, beastCameraFocus, beastCues, beastMotions, beastPlan, getHeroBeastConfig,
  type BeastCue, type BeastMotion, type BeastPlan, type HeroBeastConfig,
} from './heroBeastConfig';
import { HeroBeastScene, type HeroBeastTextures } from './heroBeastScene';
import { heroBeastTextures } from './heroBeastTextures';

export interface HeroBeastOptions extends HeroAttackOptions {
  cfg?: HeroBeastConfig;
  textures?: HeroBeastTextures | null;
}

export interface HeroBeastHandle extends HeroAttackHandle {
  readonly plan: BeastPlan;
  /** Every beast's leap (empty under reduced motion). Exposed for tests and the capture rig. */
  readonly motions: readonly BeastMotion[];
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroBeastScene | null;
}

/** The seed a fight's sparks and dust are scattered from: the same fight (same blow, same geometry) scatters the same way. */
export function beastSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 17)) >>> 0;
}

/** Play the Stampede. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroBeast(o: HeroBeastOptions): HeroBeastHandle {
  const c = o.cfg ?? getHeroBeastConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = beastPlan({ total: o.total, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, beastCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hbeast',
  });

  // A leap never rises above the top of the screen (or the sandbox box); the ticks bite clear of the big -N.
  const motions = beastMotions(plan, o.attacker, o.defender, radius, aRadius, (local ? 8 : 36) * s, nums.pts.hit);
  const last = motions[motions.length - 1];
  // The direction the blow ARRIVES from (the last beast's heading): the knockback follows it.
  const dir = arrivalDir(last, o.attacker, o.defender);
  // Tier IV's room round the target (the view is measured once, here, never per frame): the colossal jaw on a
  // side with little room comes in from just off that edge instead of far outside it, so a hero in a corner is still
  // framed by fangs.
  const room = (() => {
    const h = local ? (host?.clientHeight || 180) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
    // The maw always closes CENTRED on the struck portrait (owner 2026-09-29: "the final beast chomp isnt centered on
    // the hero correctly"); only how far out each jaw WAITS adapts to the room on its side.
    return { up: o.defender.y, down: h - o.defender.y };
  })();
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first beast) ──
  const textures = o.textures !== undefined ? o.textures : heroBeastTextures();
  const scene = textures && !reduced
    ? new HeroBeastScene(textures, {
      core: hexToNum(c.colorCore), amber: hexToNum(c.colorAmber), feral: hexToNum(c.colorFeral), fang: hexToNum(c.colorFang),
      dark: hexToNum(c.colorDark), dust: hexToNum(c.colorDust), side: hexToNum(sideHex),
    }, {
      length: c.beastLength, glow: c.beastGlow, maneMs: c.maneMs, maneWidth: c.maneWidth, embers: c.embers, jawOpen: c.jawOpen,
      clampLead: c.clampLeadMs, clampSize: c.clampSize, biteHold: c.biteHoldMs, biteMarkMs: c.biteMarkMs, tint: c.tintAlpha,
      dustSize: c.dustSize, colossalSize: c.colossalSize, roarRings: c.roarRings, roarSize: c.roarSize,
    }, s, beastSeed(o.total, dist, o.side))
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
    c.sfxGrowlClip, c.sfxSnarlClip, c.sfxRushClip, c.sfxSnapClip, c.sfxCrunchClip, c.sfxImpactClip,
    c.sfxBigClip, c.sfxRiseClip, c.sfxSlamClip, c.sfxRoarClip, c.sfxBoomClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const n = plan.beasts.length;
  let chompStep = 0;
  const rumble = (gain: number, buildMs: number, holdMs: number, tailMs: number): void => {
    if (!sound || !(gain > 0)) return;
    voices.keep(playRumble('attack', { gain, buildMs: real(buildMs), holdMs: real(holdMs), tailMs: real(tailMs), lowHz: c.sfxRumbleLowHz, highHz: c.sfxRumbleHighHz }));
  };

  const fire = (q: BeastCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The growl: feral energy gathers round the hero.
        cue(c.sfxGrowlClip, c.sfxGrowlGain, c.sfxGrowlRate, { lenMs: 1100, fadeMs: 320 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, aRadius, plan.launchAt - plan.chargeAt, n, 8 + 4 * plan.tier);
        // The pack's hooves: a rumble under the stampede (III and IV), building to the last bite.
        if (plan.dust && n) {
          const lastIn = Math.max(...plan.beasts.map((b) => b.arriveAt));
          rumble(c.sfxRumbleGain, Math.max(60, lastIn - plan.chargeAt), 60, 380);
        }
        cam.start();
        break;
      case 'launch': {
        // A beast bursts off: the rush of air (a little higher per beast); a snarl on the first (every one at I and II).
        const m = motions[q.i];
        const lastOne = q.i === n - 1;
        cue(c.sfxRushClip, c.sfxRushGain * (lastOne ? 1 : 0.8), c.sfxRushRate + 0.04 * q.i, { lenMs: c.sfxRushLenMs, fadeMs: 140 });
        if (q.i === 0 || n <= 2) cue(c.sfxSnarlClip, c.sfxSnarlGain, c.sfxSnarlRate + 0.06 * q.i, { lenMs: 700, fadeMs: 260 });
        if (m && scene) scene.launch(m, plan.size * (plan.beasts[q.i]?.size ?? 1), radius, t - q.at, q.i, plan.dust);
        break;
      }
      case 'chomp':
        // A chomp before the last: the SNAP of the jaws and a crunch, pitched up each tick. FX only.
        cue(c.sfxSnapClip, c.sfxSnapGain * 0.8, c.sfxSnapRate + 0.05 * chompStep, { startMs: 440, lenMs: 200, fadeMs: 90 });
        cue(c.sfxCrunchClip, c.sfxCrunchGain * 0.75, c.sfxCrunchRate + 0.05 * chompStep, { lenMs: 380, fadeMs: 150 });
        scene?.chomp(q.i, o.defender.x, o.defender.y, radius, chompStep);
        chompStep++;
        break;
      case 'rise':
        // The colossus rises: a deep, slow growl and the ground rumbling, peaking on the slam.
        cue(c.sfxRiseClip, c.sfxRiseGain, c.sfxRiseRate, { lenMs: real(plan.impactAt - plan.riseAt) + 200, fadeMs: 200 });
        rumble(c.sfxRumbleGain * 1.2, plan.impactAt - plan.riseAt, 80, 600);
        scene?.startRise(o.defender.x, o.defender.y, radius, plan.slamAt - plan.riseAt, plan.impactAt - plan.slamAt, plan.roarAt - plan.riseAt, plan.releaseAt - plan.riseAt, room);
        break;
      case 'impact':
        if (plan.colossal) {
          // THE SLAM: the jaws' snap, pitched down to a crack, the slam, the crunch and a rock-heavy impact.
          cue(c.sfxSnapClip, c.sfxSnapGain * 1.2, c.sfxSnapRate - 0.14, { startMs: 440, lenMs: 260, fadeMs: 120 });
          cue(c.sfxSlamClip, c.sfxSlamGain, c.sfxSlamRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxCrunchClip, c.sfxCrunchGain * 1.1, c.sfxCrunchRate - 0.1, { lenMs: 500, fadeMs: 200 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.2, c.sfxBigRate - 0.1, { lenMs: 900, fadeMs: 300 });
          scene?.slam(o.defender.x, o.defender.y, radius, { burst: plan.burst, sparks: plan.sparks, flashAlpha: c.flashAlpha });
        } else {
          // THE LAST CHOMP: the snap, the crunch, the impact (bigger per tier), and a heavy crack at III.
          cue(c.sfxSnapClip, c.sfxSnapGain, c.sfxSnapRate + 0.05 * chompStep - 0.04 * (plan.tier - 1), { startMs: 440, lenMs: 240, fadeMs: 110 });
          cue(c.sfxCrunchClip, c.sfxCrunchGain, c.sfxCrunchRate - 0.03 * (plan.tier - 1), { lenMs: 450, fadeMs: 180 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 300 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 800, fadeMs: 260 });
          scene?.impact(n - 1, o.defender.x, o.defender.y, radius, { tier: plan.tier, k: plan.k, burst: plan.burst, sparks: plan.sparks, flashAlpha: c.flashAlpha });
        }
        seq.land();
        break;
      case 'roar':
        // THE ROAR (FX only): the beast's roar and a deep boom under it.
        cue(c.sfxRoarClip, c.sfxRoarGain, c.sfxRoarRate, { tail: c.sfxTailMix, lenMs: 1600, fadeMs: 500 });
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate, { lenMs: 900, fadeMs: 300 });
        scene?.roar(o.defender.x, o.defender.y, radius);
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.launchAt, plan.impactAt + (plan.colossal ? 520 : 200));
    const cm = beastCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(beastCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The growl: the hero CROUCHES back from the target and swells a touch; each beast it looses LUNGES it forward.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.launchAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.launchAt - plan.chargeAt));
        sc = 1 + 0.05 * u;
        bx = -toFoe.x * c.heroCrouchPx * px * u; by = -toFoe.y * c.heroCrouchPx * px * u;
      } else {
        const back = Math.max(0, spring(t - plan.launchAt, 3, 90));
        sc = 1 + 0.05 * back;
        bx = -toFoe.x * c.heroCrouchPx * px * back; by = -toFoe.y * c.heroCrouchPx * px * back;
        for (const d of plan.beasts) {
          if (d.launchAt > t) continue;
          const f = c.heroLungePx * px * spring(t - d.launchAt, 4.5, 70);
          bx += toFoe.x * f; by += toFoe.y * f;
        }
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let css: string | null = null;
      if (plan.colossal && t >= plan.riseAt && t < plan.impactAt) {
        // The colossus looms: the struck hero trembles harder and harder, and shrinks a hair as the jaws come down.
        const u = clamp01((t - plan.riseAt) / Math.max(1, plan.slamAt - plan.riseAt));
        const su = clamp01((t - plan.slamAt) / Math.max(1, plan.impactAt - plan.slamAt));
        const a = (0.4 + 2.4 * u * u) * px;
        fx = a * Math.sin(t * 0.23); fy = a * Math.sin(t * 0.31);
        const sc = 1 - 0.02 * easeInOutSine(u) - 0.03 * su;
        css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${sc.toFixed(4)})`;
      } else if (t >= plan.impactAt) {
        // CLAMPED: squashed between the jaws (flat top to bottom, wide), knocked along the blow (the slam: down), springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px * (plan.colossal ? 0.5 : 1);
        const sq = c.squash * (0.8 + 0.5 * plan.k) * k;
        const kd = plan.colossal ? { x: 0, y: 1 } : dir;
        fx = kd.x * knock; fy = kd.y * knock;
        if (plan.colossal && t >= plan.roarAt) {
          const age = t - plan.roarAt;
          const r = 3 * px * Math.exp(-age / 160);
          fx += r * Math.sin(age * 0.21); fy += r * Math.cos(age * 0.27);
        }
        css = Math.abs(k) < 0.004 && Math.abs(fx) + Math.abs(fy) < 0.05 ? null
          : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 + sq * 0.6).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      } else if (plan.chomps.length && t >= plan.chomps[0]!) {
        // Each tick squeezes the target between the jaws and jerks it along the beast that bit.
        let k = 0;
        for (const at of plan.chomps) k += Math.max(0, spring(t - at, 6, 50)) * (at <= t ? 1 : 0);
        fx = dir.x * k * 5 * px; fy = dir.y * k * 5 * px;
        const sq = Math.min(0.08, 0.05 * k);
        css = k < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 + sq * 0.6).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      }
      foe.set(css);
    }
    // The jaws, the bite marks and the tint ride the portrait (the offset in the overlay's px).
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<BeastCue | FormationCue> = new Sequence<BeastCue | FormationCue>({
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
