/**
 * THE BLAST RUNNER: plays one Blast hero attack (the beats are in `heroBlastConfig.ts`) and lands the consequence on
 * its impact beat. Presentation only: the total it shows and the blow it lands are handed in, already decided by the
 * engine; this file only decides WHEN on screen they happen.
 *
 * ONE CLOCK. The numbers (DOM), the camera, the two portraits, the Pixi scene and the sound cues all read one
 * sequence clock advanced per frame by `dt x speed`; it never pauses (the hit-stop was removed 2026-09-28: "it looks
 * like lag"). That is why the consequence, the flash and the damage number can never drift apart, and why slow motion
 * and `finish()` are exact.
 *
 * LAYERS (why here). The foe's portrait lives in a `#stage` portal that paints above everything inside `#root`, so FX
 * drawn on the in-root overlay land UNDER it. The Blast therefore draws its Pixi on the above-portrait slot, puts
 * its numbers in `#stage` (above the portraits), and moves the CAMERA on `#stage` itself (composed with the stage's
 * own scale), mirroring the same transform onto the Pixi root so the FX and the portraits zoom and shake as one.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock (plus the counter's
 * text when it changes); nothing reads layout after the opening measure (the caller passes points and radii); the
 * camera layer is promoted (`will-change`) only while it moves; Pixi sprites are pooled and the updater unhooks the
 * moment the scene drains. A safety timer finishes the sequence if frames stop (a hidden tab), so the blow lands.
 *
 * SHARED (2026-09-28, when Quake joined): the clock, the damage formation, the camera, the portraits and the voices are
 * the hero-attack core in `../heroAttack/`; this file keeps only what is the Blast's own (its camera curve, its beats).
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  blastCues, blastPlan, getHeroBlastConfig, type BlastCue, type BlastPlan, type HeroBlastConfig,
} from './heroBlastConfig';
import { HeroBlastScene, type HeroBlastTextures } from './heroBlastScene';
import { heroBlastTextures } from './heroBlastTextures';

export interface HeroBlastOptions extends HeroAttackOptions {
  cfg?: HeroBlastConfig;
  textures?: HeroBlastTextures | null;
}

export interface HeroBlastHandle extends HeroAttackHandle {
  readonly plan: BlastPlan;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroBlastScene | null;
}

/**
 * The camera at sequence time `t` (px in the space the points are in): a push toward the line of fire through the
 * charge (anticipation); an instant punch-in on impact that decays exponentially
 * (overshoot, settle); and a DIRECTIONAL shake along the bolt's line (a damped spring, a fifth of it across), with
 * smaller kicks on each shot and each trailing hit. At `t === impactAt` the frame is already displaced along the
 * bolt. Pure, so it is tested directly.
 */
export function cameraAt(p: BlastPlan, c: HeroBlastConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * easeInOutSine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
  else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
  }
  const perp = { x: -dir.y, y: dir.x };
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => {
    const age = t - at;
    if (age < 0) return;
    const s = spring(age, hz, tau);
    const across = amp * 0.2 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += dir.x * amp * s + perp.x * across;
    y += dir.y * amp * s + perp.y * across;
  };
  p.bolts.forEach((b) => kick(b.fireAt, -p.shakePx * 0.18, 45, 14));
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  p.bolts.slice(1).forEach((b) => kick(b.arriveAt, p.shakePx * 0.35, 40, 18));
  p.booms.forEach((at) => kick(at, p.shakePx * 0.3, 45, 18));
  // The beam holds with a low rumble (across and along), fading as it thins out.
  if (p.beam && t > p.impactAt && t < p.impactAt + c.beamHoldMs + 200) {
    const age = t - p.impactAt;
    const r = p.shakePx * 0.22 * (age < c.beamHoldMs ? 1 : 1 - (age - c.beamHoldMs) / 200);
    x += perp.x * r * Math.sin(age * 0.21) + dir.x * r * 0.5 * Math.sin(age * 0.33);
    y += perp.y * r * Math.sin(age * 0.21) + dir.y * r * 0.5 * Math.sin(age * 0.33);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera pushes in: anchored on the ATTACKER through the charge (the world gathers around the hero), panning
 * with the bolt in flight, and anchored on the DEFENDER from the impact on. A zoom anchored on a point keeps that point
 * still, so the struck hero never gets pushed off the edge of the screen by the punch-in (the midpoint did that: both
 * portraits sit near corners). Pure.
 */
export function cameraFocus(p: BlastPlan, t: number, a: Pt, d: Pt): Pt {
  if (t <= p.fireAt) return a;
  if (t >= p.impactAt) return d;
  const u = (t - p.fireAt) / Math.max(1, p.impactAt - p.fireAt);
  const e = 0.3 * u + 0.7 * u * u; // follows the lead bolt (the scene's boltEase)
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}

/** Play the Blast. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroBlast(o: HeroBlastOptions): HeroBlastHandle {
  const c = o.cfg ?? getHeroBlastConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const dir = { x: (o.defender.x - o.attacker.x) / (dist || 1), y: (o.defender.y - o.attacker.y) / (dist || 1) };
  // THE DAMAGE FORMATION plays first (shared by every style); the Blast's charge starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = blastPlan({ total: o.total, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, blastCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;

  // ── DOM: the numbers ──
  // They sit in a TOP-LEVEL layer (a child of <body>, above the Pixi overlay) so no flash, beam or portrait can ever
  // cover them: readability first. It carries the stage's own scale, so its children are laid out in stage px.
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices,
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the charge) ──
  const textures = o.textures !== undefined ? o.textures : heroBlastTextures();
  const scene = textures && !reduced
    ? new HeroBlastScene(textures, { core: hexToNum(c.colorCore), side: hexToNum(sideHex) }, s, c.trailLength)
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const radius = o.defenderRadius ?? 120 * s;

  const cue = voices.cue.bind(voices);
  // Warm every clip now, so the first cue of a session is not the one that has to wait for its decode.
  voices.warm([c.sfxChargeClip, c.sfxFireClip, c.sfxBeamClip, c.sfxImpactClip, c.sfxThumpClip, c.sfxBigClip, c.sfxBoomClip]);

  const fire = (q: BlastCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The riser, placed so its climax lands exactly on the release.
        voices.riser(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate, (plan.fireAt - plan.chargeAt) / speed);
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, plan.fireAt - plan.chargeAt, 0.9 + 0.6 * plan.k, plan.motes);
        cam.start();
        break;
      case 'fire': {
        const b = plan.bolts[q.i]!;
        if (plan.beam) {
          cue(c.sfxFireClip, c.sfxFireGain, c.sfxFireRate * 0.9);
          cue(c.sfxBeamClip, c.sfxBeamGain, c.sfxBeamRate);
          scene?.beam(o.attacker, o.defender, b.travelMs, c.beamHoldMs, b.size, t - q.at);
        } else {
          if (q.i === 0) cue(c.sfxFireClip, c.sfxFireGain, c.sfxFireRate);
          scene?.fire(o.attacker, o.defender, b.travelMs, b.size, b.curve, t - q.at);
        }
        break;
      }
      case 'impact':
        cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
        cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 600, fadeMs: 200 });
        if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
        scene?.impact(o.defender.x, o.defender.y, dir, plan.k, plan.flashScale, c.flashAlpha, plan.sparks, radius, plan.tier);
        seq.land();
        break;
      case 'hit': {
        const b = plan.bolts[q.i]!;
        const j = 26 * s;
        scene?.hit(o.defender.x + (Math.random() - 0.5) * j, o.defender.y + (Math.random() - 0.5) * j, dir, b.size);
        break;
      }
      case 'boom': {
        // Secondary explosions ring the struck hero, alternating sides, each a little higher in pitch.
        const a = (q.i * 2.4) + Math.atan2(dir.y, dir.x);
        const rr = radius * (0.55 + 0.2 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.06, { lenMs: c.sfxBoomLenMs, fadeMs: 260 });
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr, 0.8 + 0.15 * plan.tier);
        break;
      }
      default:
        break;
    }
  };

  const paintCamera = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.beam ? c.beamHoldMs : 200));
    const cm = cameraAt(plan, c, t, dir);
    const f = cameraFocus(plan, t, o.attacker, o.defender);
    // One transform for the DOM (outermost, in screen px, over the stage's own scale) and the same for Pixi.
    cam.apply(f, cm.zoom, cm.x, cm.y, local ? 1 : s);
    if (hero.el) {
      // Swell through the charge, a recoil away from the shot on fire, then settle.
      let sc = 1, back = 0;
      if (t >= plan.chargeAt && t < plan.fireAt) sc = 1 + c.heroSwell * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      else if (t >= plan.fireAt) {
        const since = t - plan.fireAt;
        sc = 1 + c.heroSwell * Math.max(0, spring(since, 4, 60));
        back = c.recoilPx * Math.max(0, spring(since, 3, 70));
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(back) < 0.05 ? null
        : `translate(${(-dir.x * back).toFixed(2)}px, ${(-dir.y * back).toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    if (foe.el && t >= plan.impactAt) {
      // Knocked back along the bolt and squashed, springing home.
      const since = t - plan.impactAt;
      const k = spring(since, 4.5, 90);
      const knock = c.knockPx * (0.7 + 0.3 * plan.k) * k;
      const sq = c.squash * k;
      foe.set(Math.abs(k) < 0.004 ? null
        : `translate(${(dir.x * knock).toFixed(2)}px, ${(dir.y * knock).toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`);
    }
  };

  const seq: Sequence<BlastCue | FormationCue> = new Sequence<BlastCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintCamera(t); },
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
