/**
 * THE PHANTOM BLADES RUNNER: plays one Blades hero attack (the beats are in `heroBladesConfig.ts`) and lands the
 * consequence on its impact beat (the last blade going in, or Tier IV's greatsword). Presentation only: the total it
 * shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen
 * they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as Blast, Quake and Arcana do: one clock
 * (it never pauses), the damage formation, the `#stage` camera (on the FX once: stageCamera.ts), the portraits (transform only,
 * restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer. What is the Blades' own:
 * the formation, the aim and the lock, the straight thrusts, the stuck blades and the shatter, the Tier IV greatsword
 * and its judgement, its camera and its sound.
 *
 * THE STAB CONTRACT: every blade that goes in before the last is a tick (FX and a clang only). The consequence
 * (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last blade (Tier IV: on the greatsword). The
 * shatter that follows is FX only.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites are pooled per layer, textures painted once per session, and the updater unhooks
 * the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playSteelHum } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  bladeMotions, bladesCameraAt, bladesCameraFocus, bladesCues, bladesPlan, blowDir, getHeroBladesConfig,
  type BladeMotion, type BladesCue, type BladesPlan, type Bounds, type HeroBladesConfig,
} from './heroBladesConfig';
import { HeroBladesScene, type HeroBladesTextures } from './heroBladesScene';
import { heroBladesTextures } from './heroBladesTextures';

/** Where the greatsword clip (`fx/universfield-cinematic-swoosh-impact`) hits, ms in at pitch 1 (measured 2026-09-28). */
const GREAT_CLIP_HIT_MS = 480;

export interface HeroBladesOptions extends HeroAttackOptions {
  cfg?: HeroBladesConfig;
  textures?: HeroBladesTextures | null;
  /** The box the formation stays inside (default: the screen, or the host box in `local` space). */
  bounds?: Bounds;
}

export interface HeroBladesHandle extends HeroAttackHandle {
  readonly plan: BladesPlan;
  /** Every sword's life (the small blades in loose order, then Tier IV's greatsword). Empty under reduced motion. */
  readonly motions: readonly BladeMotion[];
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroBladesScene | null;
}

/** The seed a fight's sparks are scattered from: the same fight (same blow, same geometry) throws the same sparks. */
export function bladesSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 41 + (side === 'opp' ? 313 : 7)) >>> 0;
}

/** Play the Phantom Blades. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroBlades(o: HeroBladesOptions): HeroBladesHandle {
  const c = o.cfg ?? getHeroBladesConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = bladesPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, bladesCues(plan, c));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  // The raised blades stay on screen (or inside the sandbox box).
  const bounds: Bounds = o.bounds ?? (() => {
    if (local && host) return { x0: 0, y0: 0, x1: host.clientWidth || 400, y1: host.clientHeight || 300 };
    if (typeof window !== 'undefined') return { x0: 0, y0: 0, x1: window.innerWidth, y1: window.innerHeight };
    return { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 };
  })();
  const motions = bladeMotions(plan, o.attacker, o.defender, radius, aRadius, c, bounds, s);
  const small = plan.great ? motions.slice(0, -1) : motions;
  const greatM = plan.great ? motions[motions.length - 1]! : null;
  const last = greatM ?? small[small.length - 1];
  // The direction the blow ARRIVES from (the last blade's thrust): the shake and the spray follow it.
  const dir = blowDir(last, o.attacker, o.defender);

  // ── DOM: the numbers (shared) ──
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hblades',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first blade) ──
  const textures = o.textures !== undefined ? o.textures : heroBladesTextures();
  const scene = textures && !reduced
    ? new HeroBladesScene(textures, {
      core: hexToNum(c.colorCore), edge: hexToNum(c.colorEdge), side: hexToNum(sideHex), hilt: hexToNum(c.colorHilt), shade: hexToNum(c.colorShade),
    }, { glow: c.glow, edge: c.edge, outline: c.outline, ghosts: c.ghosts, ghostGapMs: c.ghostGapMs, cutLine: c.cutLine }, s, bladesSeed(o.total, dist, o.side))
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
    c.sfxSummonClip, c.sfxRingClip, c.sfxAimClip, c.sfxLockClip, c.sfxLooseClip,
    c.sfxCrackClip, c.sfxStabClip, c.sfxClangClip, c.sfxImpactClip, c.sfxBigClip, c.sfxThumpClip, c.sfxShatterClip, c.sfxGreatClip,
    c.sfxSlamDownClip, c.sfxBoomClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const n = plan.blades.length;
  let hitStep = 0;

  const fire = (q: BladesCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, aRadius, n, plan.k);
        cam.start();
        break;
      case 'summon': {
        // Each blade unfurls with a steel shimmer (a little higher each time) and a soft high ring.
        const m = small[q.i];
        cue(c.sfxSummonClip, c.sfxSummonGain * (n > 3 ? 0.8 : 1), c.sfxSummonRate + q.i * c.sfxSummonStep, { lenMs: 520, fadeMs: 200 });
        cue(c.sfxRingClip, c.sfxRingGain, c.sfxRingRate + q.i * c.sfxSummonStep, { lenMs: 380, fadeMs: 200 });
        if (m) scene?.summon(m, o.attacker, t - q.at);
        break;
      }
      case 'aim':
        cue(c.sfxAimClip, c.sfxAimGain, c.sfxAimRate, { lenMs: 420, fadeMs: 160 });
        break;
      case 'lock':
        // The breath before the loose: a bright "ting" and a glint off every point.
        cue(c.sfxLockClip, c.sfxLockGain, c.sfxLockRate, { lenMs: 360, fadeMs: 200 });
        scene?.lock();
        break;
      case 'loose': {
        const m = small[q.i];
        const lastOne = q.i === n - 1;
        // Clips are entered at their attack (the woosh's rush, the snap's crack), so what you hear IS the thrust.
        cue(c.sfxLooseClip, c.sfxLooseGain * (lastOne ? 1 : 0.75), c.sfxLooseRate + q.i * c.sfxLooseStep, { startMs: 110, lenMs: c.sfxLooseLenMs, fadeMs: 200 });
        if (q.i === 0 || lastOne) cue(c.sfxCrackClip, c.sfxCrackGain * (lastOne && q.i > 0 ? 0.8 : 1), c.sfxCrackRate + 0.05 * q.i, { startMs: 440, lenMs: 260, fadeMs: 120 });
        if (m) scene?.loose(m);
        break;
      }
      case 'hit': {
        // A blade goes in before the last: a stab and a clang pitched up each tick (the rhythm), FX only.
        const m = small[q.i];
        cue(c.sfxStabClip, c.sfxStabGain, c.sfxStabRate + 0.05 * hitStep, { startMs: 100, lenMs: 380, fadeMs: 160 });
        cue(c.sfxClangClip, c.sfxClangGain, c.sfxClangRate + 0.07 * hitStep, { lenMs: 380, fadeMs: 200 });
        if (m) scene?.hit(m, hitStep);
        hitStep++;
        break;
      }
      case 'great':
        // The greatsword forms: a heavy, low steel shimmer and a deep ring.
        cue(c.sfxSummonClip, c.sfxSummonGain * 1.3, c.sfxSummonRate * 0.7, { lenMs: 900, fadeMs: 300 });
        cue(c.sfxRingClip, c.sfxRingGain * 1.6, c.sfxRingRate * 0.55, { lenMs: 700, fadeMs: 300 });
        if (greatM) scene?.summon(greatM, o.attacker, t - q.at);
        break;
      case 'greatAim':
        cue(c.sfxAimClip, c.sfxAimGain * 1.3, c.sfxAimRate * 0.75, { lenMs: 600, fadeMs: 200 });
        break;
      case 'hang':
        // THE JUDGEMENT locks on: a ting, and the steel hum swells to the loose.
        cue(c.sfxLockClip, c.sfxLockGain * 1.2, c.sfxLockRate * 0.85, { lenMs: 500, fadeMs: 250 });
        if (greatM) voices.keep(playSteelHum('attack', { gain: c.sfxHumGain, buildMs: real(greatM.flightStart - greatM.aimEnd), hz: c.sfxHumHz, rise: c.sfxHumRise }));
        // The cinematic swoosh-impact is placed so its own hit (0.48 s in, at pitch 1) lands ON the greatsword's impact.
        if (greatM && c.sfxGreatClip) {
          const r = c.sfxGreatRate > 0 ? c.sfxGreatRate : 1;
          const lead = real(plan.impactAt - t) - GREAT_CLIP_HIT_MS / r;
          cue(c.sfxGreatClip, c.sfxGreatGain, r, lead >= 0 ? { delayMs: lead, lenMs: 1600, fadeMs: 400 } : { startMs: -lead * r, lenMs: 1600, fadeMs: 400 });
        }
        if (greatM) scene?.lockOn(o.defender.x, o.defender.y, radius, greatM.flightStart - greatM.aimEnd, c.bindBeams);
        break;
      case 'greatLoose':
        cue(c.sfxCrackClip, c.sfxCrackGain * 1.3, c.sfxCrackRate * 0.8, { startMs: 440, lenMs: 320, fadeMs: 140 });
        cue(c.sfxLooseClip, c.sfxLooseGain * 1.3, c.sfxLooseRate * 0.7, { startMs: 90, lenMs: c.sfxLooseLenMs * 1.4, fadeMs: 240 });
        if (greatM) scene?.loose(greatM);
        break;
      case 'impact':
        if (plan.great) {
          // THE GREATSWORD goes in: a slam, a cleave, a crack, a deep thump.
          cue(c.sfxSlamDownClip, c.sfxSlamDownGain, c.sfxSlamDownRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate * 0.9, { startMs: 60, tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.15, c.sfxBigRate - 0.05, { startMs: 40, lenMs: 700, fadeMs: 250 });
          cue(c.sfxThumpClip, c.sfxThumpGain * 1.15, c.sfxThumpRate - 0.08, { startMs: 60, lenMs: 500, fadeMs: 180 });
        } else {
          // THE LAST BLADE: a cleave, a stab, a clang, a low punch (bigger per tier).
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { startMs: 60, tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxStabClip, c.sfxStabGain * 1.1, c.sfxStabRate + 0.05 * hitStep - 0.05, { startMs: 100, lenMs: 420, fadeMs: 200 });
          cue(c.sfxClangClip, c.sfxClangGain * 1.2, c.sfxClangRate - 0.1, { lenMs: 500, fadeMs: 220 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { startMs: 60, lenMs: 500, fadeMs: 180 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { startMs: 40, lenMs: 700, fadeMs: 250 });
        }
        if (last) scene?.hit(last, hitStep);
        scene?.impact(o.defender.x, o.defender.y, dir, radius, { tier: plan.tier, k: plan.k, burst: plan.burst, great: !!plan.great });
        seq.land();
        break;
      case 'shatter':
        cue(c.sfxShatterClip, c.sfxShatterGain * (plan.great ? 1.25 : 1), c.sfxShatterRate - (plan.great ? 0.12 : 0), { lenMs: 900, fadeMs: 300 });
        scene?.shatter(o.defender.x, o.defender.y, plan.shards);
        break;
      case 'boom': {
        const a = q.i * 2.4 + 0.6;
        const rr = radius * (0.8 + 0.2 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.08, { startMs: 100, lenMs: 600, fadeMs: 220 });
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr * 0.7, 0.9 + 0.1 * q.i);
        break;
      }
      default:
        break;
    }
  };

  const gLoose = plan.great ? plan.great.launchAt + c.greatPullMs : Number.POSITIVE_INFINITY;
  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.great ? 420 : 200));
    const cm = bladesCameraAt(plan, c, t, dir);
    cam.apply(bladesCameraFocus(plan, t, o.attacker, o.defender, c), cm.zoom, cm.x, cm.y, local ? 1 : s);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // Swell through the summon; a small kick back on each loose (the blades are thrown off the hero); settle.
      let sc = 1, back = 0;
      if (t < plan.fireAt) sc = 1 + c.heroSwell * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      else {
        sc = 1 + c.heroSwell * Math.max(0, spring(t - plan.fireAt, 4, 70));
        for (const b of plan.blades) { const at = b.launchAt + c.pullMs; back += c.recoilPx * px * Math.max(0, spring(t - at, 3.5, 55)) * (at <= t ? 1 : 0); }
        if (t >= gLoose) back += c.recoilPx * 2 * px * Math.max(0, spring(t - gLoose, 3, 70));
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(back) < 0.05 ? null : `translate(${(-dir.x * back).toFixed(2)}px, ${(-dir.y * back).toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    if (foe.el) {
      let css: string | null = null;
      if (plan.great && t >= plan.hangAt && t < plan.impactAt) {
        // Locked on by the judgement: trembling, harder as the loose nears (anticipation).
        const u = clamp01((t - plan.hangAt) / Math.max(1, gLoose - plan.hangAt));
        const a = (0.5 + 2.5 * u * u) * px;
        css = `translate(${(a * Math.sin(t * 0.23)).toFixed(2)}px, ${(a * Math.sin(t * 0.31)).toFixed(2)}px)`;
      } else if (t >= plan.impactAt) {
        // Knocked back along the blow and squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${(dir.x * knock).toFixed(2)}px, ${(dir.y * knock).toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // Each blade that goes in jolts the target along it.
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        css = k < 0.004 ? null : `translate(${(dir.x * k * 6 * px).toFixed(2)}px, ${(dir.y * k * 6 * px).toFixed(2)}px)`;
      }
      foe.set(css);
    }
  };

  const seq: Sequence<BladesCue | FormationCue> = new Sequence<BladesCue | FormationCue>({
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
