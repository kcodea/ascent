/**
 * THE EYE OF THE LEGION RUNNER: plays one Fel hero attack (the beats are in `heroFelConfig.ts`) and lands the
 * consequence on its impact beat (the gaze landing, or Tier IV's starburst). Presentation only: the total it shows and
 * the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never pauses),
 * the damage formation, the `#stage` camera (on the FX once: stageCamera.ts), the portraits (transform only, restored
 * after), the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE CONTRACT: II's first gaze is a tick (FX and sound only). The consequence (`onImpact`: the damage, Armor,
 * Resolve) lands exactly ONCE, on THE impact.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; the eye rigs are built once while the formation plays (only their transforms / alpha change),
 * one-shots and fire particles are pooled with hard caps, the veil is one sprite, and the updater unhooks the moment the
 * scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playRumble, playSwirlTone } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  eyeMotions, felCameraAt, felCameraFocus, felCues, felPlan, getHeroFelConfig,
  type EyeMotion, type FelCue, type FelPlan, type HeroFelConfig,
} from './heroFelConfig';
import { HeroFelScene, type HeroFelTextures } from './heroFelScene';
import { heroFelTextures } from './heroFelTextures';

export interface HeroFelOptions extends HeroAttackOptions {
  cfg?: HeroFelConfig;
  textures?: HeroFelTextures | null;
}

export interface HeroFelHandle extends HeroAttackHandle {
  readonly plan: FelPlan;
  /** Every eye's place and timeline (empty under reduced motion). */
  readonly eyes: readonly EyeMotion[];
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroFelScene | null;
}

/** The seed a fight's scatter comes from: the same fight throws the same sparks. */
export function felSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6271 + Math.round(distance) * 53 + (side === 'opp' ? 409 : 23)) >>> 0;
}

/** Play the Eye of the Legion. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroFel(o: HeroFelOptions): HeroFelHandle {
  const c = o.cfg ?? getHeroFelConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = felPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, felCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const px = local ? 0.45 : 1;
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const screen = Math.max(vw, vh);
  const eyes = eyeMotions(plan, o.attacker, o.defender, aRadius * (local ? 0.7 : 1), radius, { w: vw, h: vh, margin: 10 * s * px }, c);
  const d = o.defender;
  const eyeAt: Pt = eyes.length
    ? { x: eyes.reduce((t, e) => t + e.c.x, 0) / eyes.length, y: eyes.reduce((t, e) => t + e.c.y, 0) / eyes.length }
    : o.attacker;
  const dir = (() => { const L = Math.hypot(d.x - eyeAt.x, d.y - eyeAt.y) || 1; return { x: (d.x - eyeAt.x) / L, y: (d.y - eyeAt.y) / L }; })();

  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hfel',
  });

  // ── Pixi (the above-portrait slot; the eye rigs are built now, while the formation plays) ──
  const textures = o.textures !== undefined ? o.textures : heroFelTextures();
  const scene = textures && !reduced
    ? new HeroFelScene(textures, {
      sclera: hexToNum(c.colorSclera), vein: hexToNum(c.colorVein), iris: hexToNum(c.colorIris), fel: hexToNum(c.colorFel),
      hot: hexToNum(c.colorHot), core: hexToNum(c.colorCore), pupil: hexToNum(c.colorPupil), lid: hexToNum(c.colorLid),
      rift: hexToNum(c.colorRift), veil: hexToNum(c.colorVeil),
    }, c, eyes, s * px, felSeed(o.total, dist, o.side), { w: vw, h: vh })
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o));
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxRiftClip, c.sfxOpenClip, c.sfxDartClip, c.sfxLockClip, c.sfxGazeClip, c.sfxHitClip, c.sfxImpactClip, c.sfxBlastClip,
    c.sfxImplodeClip, c.sfxBurstClip, c.sfxCloseClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const big = plan.tier >= 3;

  const fire = (q: FelCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.setVeil(plan.veil);
        cam.start();
        break;
      case 'rift':
        cue(c.sfxRiftClip, c.sfxRiftGain * (big ? 1.2 : 1), c.sfxRiftRate - (big ? 0.1 : 0), { lenMs: 1000, fadeMs: 380 });
        if (sound && q.i === 0) {
          const e = plan.eyes[0]!;
          voices.keep(playSwirlTone('attack', { gain: c.sfxHumGain * (big ? 1.3 : 1), buildMs: real(e.fireAt - e.riftAt), lowHz: c.sfxHumLowHz, highHz: c.sfxHumHighHz }));
        }
        scene?.rift(q.i);
        break;
      case 'open':
        cue(c.sfxOpenClip, c.sfxOpenGain * (big ? 1.5 : 1), c.sfxOpenRate - (plan.tier === 4 ? 0.2 : 0), { lenMs: plan.tier === 4 ? 1200 : 700, fadeMs: 300 });
        scene?.opened(q.i);
        break;
      case 'dart':
        cue(c.sfxDartClip, c.sfxDartGain, c.sfxDartRate + 0.08 * (q.j ?? 0), { lenMs: 200, fadeMs: 80 });
        break;
      case 'lock':
        cue(c.sfxLockClip, c.sfxLockGain * (big ? 1.3 : 1), c.sfxLockRate, { lenMs: 700, fadeMs: 250 });
        if (sound && plan.kind === 'lance' && q.i === 0) {
          voices.keep(playRumble('attack', { gain: c.sfxRumbleGain, buildMs: real(plan.impactAt - plan.eyes[0]!.lockAt), holdMs: real(60), tailMs: real(900), lowHz: 45, highHz: 900 }));
        }
        scene?.locked(q.i, plan.kind === 'lance');
        break;
      case 'fire':
        cue(c.sfxGazeClip, c.sfxGazeGain * (big ? 1.2 : 1), c.sfxGazeRate + 0.06 * q.i - (plan.tier === 4 ? 0.12 : 0), { lenMs: 1000, fadeMs: 320 });
        scene?.fired(q.i);
        break;
      case 'hit': {
        cue(c.sfxHitClip, c.sfxHitGain, c.sfxHitRate, { lenMs: 600, fadeMs: 240 });
        const e = eyes[q.i];
        scene?.impact(d.x, d.y, radius, { size: 0.8, big: false, dir: e ? unit(e.c, d) : dir, flashAlpha: c.flashAlpha });
        break;
      }
      case 'land':
        // IV: the lance lands and holds; the target is drawn in; a riser lands its climax on the starburst.
        voices.riser(c.sfxImplodeClip, c.sfxImplodeGain, c.sfxImplodeRate, real(plan.impactAt - plan.landAt));
        cue(c.sfxHitClip, c.sfxHitGain, c.sfxHitRate - 0.15, { lenMs: 600, fadeMs: 240 });
        scene?.drawIn(d.x, d.y, radius, plan.impactAt - plan.landAt);
        break;
      case 'impact':
        if (plan.kind === 'lance') {
          cue(c.sfxBurstClip, c.sfxBurstGain, c.sfxBurstRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxBlastClip, c.sfxBlastGain * 1.2, c.sfxBlastRate - 0.08, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.1, { lenMs: 900, fadeMs: 300 });
          scene?.starburst(d.x, d.y, radius, { burst: plan.burst, flashAlpha: c.flashAlpha, screen });
        } else {
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { lenMs: 900, fadeMs: 300 });
          cue(c.sfxBlastClip, c.sfxBlastGain * (0.75 + 0.08 * plan.tier), c.sfxBlastRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          scene?.impact(d.x, d.y, radius, { size: 1 + 0.12 * plan.tier, big: true, dir, flashAlpha: c.flashAlpha });
        }
        seq.land();
        break;
      case 'close':
        cue(c.sfxCloseClip, c.sfxCloseGain, c.sfxCloseRate, { lenMs: 250, fadeMs: 100 });
        scene?.closed(q.i);
        break;
      case 'seal':
        scene?.sealed(q.i);
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    const e0 = plan.eyes[0]!;
    nums.paintDim(t, e0.riftAt, e0.lockAt, plan.impactAt + (plan.kind === 'lance' ? 420 : 260));
    const cm = felCameraAt(plan, c, t, dir);
    cam.apply(felCameraFocus(plan, t, eyeAt, d), cm.zoom, cm.x, cm.y, local ? 1 : s);
    if (hero.el && t >= plan.chargeAt) {
      // The summoner swells as the eye opens (it is calling it), and is jolted back as the gaze leaves.
      let sc = 1 + c.heroSwell * easeInOutSine((t - e0.riftAt) / Math.max(1, e0.lockAt - e0.riftAt));
      if (t >= e0.fireAt) sc = 1 + c.heroSwell * Math.max(0, spring(t - e0.fireAt, 4, 80));
      let bx = 0, by = 0;
      for (const e of plan.eyes) {
        const k = e.fireAt <= t ? Math.max(0, spring(t - e.fireAt, 3.5, 55)) : 0;
        bx -= dir.x * 6 * px * k; by -= dir.y * 6 * px * k;
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    if (foe.el) {
      let css: string | null = null;
      if (plan.kind === 'lance' && t >= plan.landAt && t < plan.impactAt) {
        // Drawn in: it shrinks toward the collapse and trembles harder (the clock never stops).
        const u = clamp01((t - plan.landAt) / Math.max(1, plan.impactAt - plan.landAt));
        const a = (0.5 + 3 * u * u) * px;
        css = `translate(${(a * Math.sin(t * 0.47)).toFixed(2)}px, ${(a * Math.sin(t * 0.53)).toFixed(2)}px) scale(${(1 - 0.1 * u * u).toFixed(4)})`;
      } else if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${(dir.x * knock).toFixed(2)}px, ${(dir.y * knock).toFixed(2)}px) scale(${(1 + sq * 0.6).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        css = k < 0.004 ? null : `translate(${(dir.x * k * 6 * px).toFixed(2)}px, ${(dir.y * k * 6 * px).toFixed(2)}px)`;
      }
      foe.set(css);
    }
  };

  const seq: Sequence<FelCue | FormationCue> = new Sequence<FelCue | FormationCue>({
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
    eyes,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}

function unit(a: Pt, b: Pt): Pt {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
}
