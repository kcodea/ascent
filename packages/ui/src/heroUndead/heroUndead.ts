/**
 * THE UNDEAD RUNNER: plays one Undead (Grave Call) hero attack (the beats are in `heroUndeadConfig.ts`) and lands the
 * consequence on its impact beat (the last skull's bite, or Tier IV's chomp). Presentation only: the total it shows and
 * the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as Holy does: one clock (it never pauses), the damage
 * formation, the `#stage` camera mirrored onto the Pixi root, the portraits (transform only, restored after), the voices,
 * the dim, reduced motion, finish / cancel and the safety timer. What is Undead's own: the raise, the skulls, the hands
 * and the wisp swarm, the Tier IV rift and maw, its camera and its sound.
 *
 * THE TICK CONTRACT: every skull before the last, every hand's grip and every wisp is a tick (FX and sound only). The
 * consequence (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last bite (Tier IV: the chomp).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after the
 * opening measure; Pixi sprites are pooled per layer, textures painted once per session and pre-warmed during the
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
  getHeroUndeadConfig, undeadCameraAt, undeadCameraFocus, undeadCues, undeadGeo, undeadPlan,
  type HeroUndeadConfig, type UndeadCue, type UndeadGeo, type UndeadPlan,
} from './heroUndeadConfig';
import { HeroUndeadScene, type HeroUndeadTextures } from './heroUndeadScene';
import { heroUndeadTextures } from './heroUndeadTextures';

export interface HeroUndeadOptions extends HeroAttackOptions {
  cfg?: HeroUndeadConfig;
  textures?: HeroUndeadTextures | null;
}

export interface HeroUndeadHandle extends HeroAttackHandle {
  readonly plan: UndeadPlan;
  /** Every position the attack uses (the skulls, the hands, the swarm, the rift and the maw). */
  readonly geo: UndeadGeo;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroUndeadScene | null;
}

/** The seed a fight's wisps are scattered from: the same fight (same blow, same geometry) throws the same wisps. */
export function undeadSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 53 + (side === 'opp' ? 211 : 17)) >>> 0;
}

/** Play Undead. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroUndead(o: HeroUndeadOptions): HeroUndeadHandle {
  const c = o.cfg ?? getHeroUndeadConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = undeadPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, undeadCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // The screen band the maw must stay whole inside (measured ONCE, here: the window, or the sandbox box).
  const hostEl = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const viewH = local ? (hostEl?.clientHeight ?? 0) : (typeof window !== 'undefined' ? window.innerHeight : 0);
  const geo = undeadGeo(plan, o.attacker, o.defender, radius, c, s, aRadius, viewH > 0 ? { top: 0, bottom: viewH } : null);
  const d = o.defender;
  // The line of the blow (attacker to defender), for knockback along it.
  const ux = dist > 0 ? (o.defender.x - o.attacker.x) / dist : 1, uy = dist > 0 ? (o.defender.y - o.attacker.y) / dist : 0;

  // ── DOM: the numbers (shared) ──
  const host = hostEl;
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hundead',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first beat) ──
  const textures = o.textures !== undefined ? o.textures : heroUndeadTextures();
  const scene = textures && !reduced
    ? new HeroUndeadScene(textures, {
      core: hexToNum(c.colorCore), ghost: hexToNum(c.colorGhost), teal: hexToNum(c.colorTeal), void: hexToNum(c.colorVoid),
      bone: hexToNum(c.colorBone), side: hexToNum(sideHex),
    }, {
      circleSize: c.circleSize, circleSpin: c.circleSpin, smokeRing: c.smokeRing, skullWobble: c.skullWobble, afterimages: c.afterimages,
      shedWisps: c.shedWisps, echoSize: c.echoSize, wispLife: c.wispLife, wispWander: c.wispWander, wispSize: c.wispSize, handSize: c.handSize,
    }, s, undeadSeed(o.total, dist, o.side))
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
    c.sfxRaiseClip, c.sfxCallClip, c.sfxShriekClip, c.sfxWhooshClip, c.sfxTickClip, c.sfxImpactClip, c.sfxThumpClip, c.sfxBigClip,
    c.sfxClawClip, c.sfxWispClip, c.sfxRiftClip, c.sfxRumbleClip, c.sfxRiseClip, c.sfxRoarClip, c.sfxLungeClip, c.sfxChompClip, c.sfxMistClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const skullW = (i: number): number => radius * 1.35 * (plan.skulls[i]?.size ?? 1);
  let tick = 0;

  const fire = (q: UndeadCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        // The dead stir: a low necrotic swell as the grave circle forms under the hero.
        cue(c.sfxRaiseClip, c.sfxRaiseGain, c.sfxRaiseRate, { lenMs: 1200, fadeMs: 400 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startRaise(o.attacker.x, o.attacker.y, aRadius, plan.raiseAt - plan.chargeAt, plan.k);
        cam.start();
        break;
      case 'raise':
        cue(c.sfxCallClip, c.sfxCallGain, c.sfxCallRate, { lenMs: 900, fadeMs: 300 });
        scene?.raise(o.attacker.x, o.attacker.y, aRadius, plan.k);
        break;
      case 'grave':
        cue(c.sfxRumbleClip, c.sfxRumbleGain * 0.7, c.sfxRumbleRate * 1.1, { lenMs: 700, fadeMs: 300 });
        scene?.openGrave(d.x, d.y, radius, 260);
        break;
      case 'hand': {
        const h = geo.hands[q.i];
        cue(c.sfxClawClip, c.sfxClawGain * 0.8, c.sfxClawRate + 0.05 * q.i, { lenMs: 420, fadeMs: 160 });
        if (h) scene?.raiseHand(h, c.handRiseMs, c.handDragPx);
        break;
      }
      case 'grip': {
        const h = geo.hands[q.i];
        cue(c.sfxClawClip, c.sfxClawGain, c.sfxClawRate * 0.85 + 0.04 * q.i, { lenMs: 360, fadeMs: 140 });
        if (h) scene?.gripHand(q.i, h.at);
        tick++;
        break;
      }
      case 'wisp': {
        const w = geo.wisps[q.i], pw = plan.wisps[q.i]!;
        if (q.i % 2 === 0) cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.6, c.sfxWhooshRate * 1.3 + 0.03 * q.i, { lenMs: 380, fadeMs: 160 });
        if (w) scene?.launchWisp(w, pw.hitAt - pw.launchAt);
        break;
      }
      case 'wispHit': {
        const w = geo.wisps[q.i];
        cue(c.sfxWispClip, c.sfxWispGain, c.sfxWispRate + 0.04 * (tick % 6), { lenMs: 360, fadeMs: 160 });
        if (w) scene?.wispHit(w.to, radius, q.i);
        tick++;
        break;
      }
      case 'emerge': {
        // A skull pops out of the hero and SHRIEKS.
        const sp = geo.skulls[q.i];
        cue(c.sfxShriekClip, c.sfxShriekGain * (q.i === plan.skulls.length - 1 ? 1 : 0.8), c.sfxShriekRate + 0.08 * q.i, { lenMs: 700, fadeMs: 260 });
        if (sp) scene?.emergeSkull(q.i, sp.from, skullW(q.i), c.shriekMs);
        break;
      }
      case 'launch': {
        const sp = geo.skulls[q.i], ps = plan.skulls[q.i]!;
        cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate + 0.06 * q.i, { lenMs: 520, fadeMs: 200 });
        if (sp) scene?.launchSkull(q.i, sp, ps.hitAt - ps.launchAt);
        break;
      }
      case 'skullHit':
        // A bite before the last: a tick, FX and sound only. The blow waits for the last.
        cue(c.sfxTickClip, c.sfxTickGain, c.sfxTickRate + 0.06 * tick, { lenMs: 520, fadeMs: 200 });
        cue(c.sfxChompClip, c.sfxChompGain * 0.5, c.sfxChompRate * 1.25, { lenMs: 300, fadeMs: 120 });
        scene?.skullBite(q.i, geo.foot, radius, { last: false, k: plan.k, burst: plan.burst, motes: plan.motes, flashAlpha: c.flashAlpha, shards: c.shards });
        tick++;
        break;
      case 'rift':
        // THE RIFT tears open: the rift clip, a heavy ground crack under it.
        cue(c.sfxRiftClip, c.sfxRiftGain, c.sfxRiftRate, { lenMs: 1600, fadeMs: 500 });
        cue(c.sfxRumbleClip, c.sfxRumbleGain, c.sfxRumbleRate, { lenMs: 900, fadeMs: 300 });
        scene?.tearRift(geo.rift.at, geo.rift.ang, geo.rift.len, c.riftMs, geo.cracks);
        break;
      case 'rise':
        cue(c.sfxRiseClip, c.sfxRiseGain, c.sfxRiseRate, { lenMs: 1200, fadeMs: 400 });
        scene?.riseMaw(geo.maw.from, geo.maw.up, geo.maw.size, plan.shriekAt - plan.riseAt);
        break;
      case 'shriek':
        // THE SHRIEK: a roar pitched up into a scream, the skull shriek layered over it.
        cue(c.sfxRoarClip, c.sfxRoarGain, c.sfxRoarRate, { lenMs: 1100, fadeMs: 350 });
        cue(c.sfxShriekClip, c.sfxShriekGain * 1.1, c.sfxShriekRate * 0.8, { lenMs: 900, fadeMs: 300 });
        scene?.shriekMaw(plan.lungeAt - plan.shriekAt, radius);
        break;
      case 'lunge':
        // The lunge: a riser placed so its hit lands on the chomp. Only with sound on: the riser reads the clip's buffer
        // directly, and with sound off that would wake the audio system cold on this beat (measured: an 86-150 ms task).
        if (sound) voices.riser(c.sfxLungeClip, c.sfxLungeGain, c.sfxLungeRate, real(plan.impactAt - plan.lungeAt));
        scene?.lungeMaw(geo.maw.to, plan.chompAt - plan.lungeAt, c.mawGrow);
        break;
      case 'chomp':
        cue(c.sfxChompClip, c.sfxChompGain, c.sfxChompRate, { lenMs: 600, fadeMs: 240 });
        scene?.chompMaw(plan.impactAt - plan.chompAt);
        break;
      case 'impact':
        if (plan.maw) {
          // THE CHOMP lands: the shatter, a low punch, the crack, and the mist washing out.
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.05, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxThumpClip, c.sfxThumpGain * 1.2, c.sfxThumpRate - 0.1, { lenMs: 500, fadeMs: 180 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.1, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxTickClip, c.sfxTickGain, c.sfxTickRate * 0.8, { lenMs: 600, fadeMs: 250 });
          cue(c.sfxMistClip, c.sfxMistGain, c.sfxMistRate, { tail: c.sfxTailMix, lenMs: 1200, fadeMs: 500 });
          scene?.mawImpact(geo.foot, radius, {
            k: plan.k, burst: plan.burst, motes: plan.motes, flashAlpha: c.flashAlpha, shards: c.shards, mistMs: c.mistMs, mistReach: c.mistReach, mistPuffs: c.mistPuffs,
          });
        } else {
          // THE LAST BITE: the skull burst, the shatter, a low punch (bigger per tier).
          cue(c.sfxTickClip, c.sfxTickGain * 1.1, c.sfxTickRate - 0.05 * (plan.tier - 1), { lenMs: 600, fadeMs: 220 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 500, fadeMs: 180 });
          cue(c.sfxChompClip, c.sfxChompGain * 0.6, c.sfxChompRate * 1.15, { lenMs: 360, fadeMs: 140 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          scene?.skullBite(plan.skulls.length - 1, geo.foot, radius, { last: true, k: plan.k, burst: plan.burst, motes: plan.motes, flashAlpha: c.flashAlpha, shards: c.shards });
        }
        seq.land();
        break;
      case 'fade':
        scene?.fadeGround(c.lingerMs);
        break;
      default:
        break;
    }
  };

  const px = local ? 0.45 : 1;
  const firstGrip = plan.hands.length ? plan.hands[0]!.gripAt : Number.POSITIVE_INFINITY;
  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.raiseAt, plan.impactAt + (plan.maw ? 420 : 200));
    const cm = undeadCameraAt(plan, c, t);
    cam.apply(undeadCameraFocus(plan, t, o.attacker, o.defender, plan.maw ? geo.maw.up : null), cm.zoom, cm.x, cm.y, local ? 1 : s);
    if (hero.el && t >= plan.chargeAt) {
      // Swell and sink a little through the raise (drawing the dead up); a small lift as they answer; settle.
      let sc = 1, lift = 0;
      if (t < plan.raiseAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.raiseAt - plan.chargeAt));
        sc = 1 + c.heroSwell * u; lift = 4 * px * u;
      } else {
        const k = Math.max(0, spring(t - plan.raiseAt, 3.5, 90));
        sc = 1 + c.heroSwell * k; lift = 4 * px * k - 5 * px * Math.max(0, spring(t - plan.raiseAt, 4, 50)) * (t - plan.raiseAt < 120 ? 1 : 0);
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(lift) < 0.05 ? null : `translate(0px, ${lift.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    if (foe.el) {
      let css: string | null = null;
      if (t >= plan.impactAt) {
        // Bitten: knocked along the blow, squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${(ux * knock).toFixed(2)}px, ${(uy * knock).toFixed(2)}px) scale(${(1 - sq * 0.5).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      } else if (plan.maw && t >= plan.shriekAt) {
        // The maw's scream: the struck hero shudders, harder as the maw closes in.
        const u = clamp01((t - plan.shriekAt) / Math.max(1, plan.impactAt - plan.shriekAt));
        const a = (0.8 + 2.6 * u) * px;
        css = `translate(${(a * Math.sin(t * 0.27)).toFixed(2)}px, ${(a * Math.sin(t * 0.35)).toFixed(2)}px)`;
      } else if (t >= firstGrip) {
        // III: the hands DRAG it down into the grave: it sinks and shrinks a little, trembling.
        const u = clamp01((t - firstGrip) / Math.max(1, plan.impactAt - firstGrip));
        const sink = c.handDragPx * 0.8 * easeInOutSine(u) * px;
        const tr = (0.6 + 1.6 * u) * px;
        css = `translate(${(tr * Math.sin(t * 0.31)).toFixed(2)}px, ${(sink + tr * Math.sin(t * 0.23)).toFixed(2)}px) scale(${(1 - 0.05 * easeInOutSine(u)).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // Each tick jolts the target back along the blow.
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        css = k < 0.004 ? null : `translate(${(ux * k * 5 * px).toFixed(2)}px, ${(uy * k * 5 * px).toFixed(2)}px)`;
      }
      foe.set(css);
    }
  };

  const seq: Sequence<UndeadCue | FormationCue> = new Sequence<UndeadCue | FormationCue>({
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
    geo,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
