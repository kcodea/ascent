/**
 * THE QUAKE RUNNER: plays one Quake hero attack (the beats are in `heroQuakeConfig.ts`) and lands the consequence on
 * its impact beat (the eruption). Presentation only: the total it shows and the blow it lands are handed in, already
 * decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the Blast does: one clock (it never pauses), the
 * damage formation, the `#stage` camera mirrored onto the Pixi root, the portraits (transform only, restored after), the
 * voices, the dim, reduced motion, finish / cancel and the safety timer. What is the Quake's own: the rumbling camera,
 * the hero's rise and slam, the struck hero jolted up and down, the ground scene and its sound.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites are pooled per layer, textures painted once per session, and the updater unhooks
 * the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playRumble } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, easeOutCubic, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  getHeroQuakeConfig, quakeCameraAt, quakeCameraFocus, quakeCues, quakePlan, type HeroQuakeConfig, type QuakeCue, type QuakePlan,
} from './heroQuakeConfig';
import { HeroQuakeScene, type HeroQuakeTextures } from './heroQuakeScene';
import { heroQuakeTextures } from './heroQuakeTextures';

export interface HeroQuakeOptions extends HeroAttackOptions {
  cfg?: HeroQuakeConfig;
  textures?: HeroQuakeTextures | null;
}

export interface HeroQuakeHandle extends HeroAttackHandle {
  readonly plan: QuakePlan;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroQuakeScene | null;
}

/** The seed a fight's cracks are drawn from: the same fight (same blow, same geometry) draws the same ground. */
export function quakeSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 31 + (side === 'opp' ? 101 : 1)) >>> 0;
}

/** Play the Quake. Returns a handle; the blow lands via `onImpact` on the eruption beat. */
export function playHeroQuake(o: HeroQuakeOptions): HeroQuakeHandle {
  const c = o.cfg ?? getHeroQuakeConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const dir = { x: (o.defender.x - o.attacker.x) / (dist || 1), y: (o.defender.y - o.attacker.y) / (dist || 1) };
  const heading = Math.atan2(dir.y, dir.x);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = quakePlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, quakeCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;

  // ── DOM: the numbers (shared with the Blast) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hquake',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the slam) ──
  const textures = o.textures !== undefined ? o.textures : heroQuakeTextures();
  const scene = textures && !reduced
    ? new HeroQuakeScene(textures, {
      core: hexToNum(c.colorCore), side: hexToNum(sideHex), chasm: hexToNum(c.colorChasm), lip: hexToNum(c.colorLip),
      dust: hexToNum(c.colorDust), rock: hexToNum(c.colorRock),
    }, s, quakeSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;
  scene?.setCoolMs(c.coolMs * (1 + plan.crater));
  scene?.setGravity(c.rockGravity);

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxWindupClip, c.sfxGroundClip, c.sfxThumpClip, c.sfxCrackClip, c.sfxEruptClip, c.sfxBigClip, c.sfxBoomClip, c.sfxPatterClip, c.sfxThrowClip]);
  /** Real ms from sequence ms (the playback speed). */
  const real = (ms: number): number => ms / speed;

  const fire = (q: QuakeCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        // The hero rises: a low grinding riser whose climax lands ON the slam, pebbles lift, a tremor starts.
        voices.riser(c.sfxWindupClip, c.sfxWindupGain, c.sfxWindupRate - 0.05 * (plan.tier - 1), real(plan.slamAt - plan.chargeAt));
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.windup(o.attacker.x, o.attacker.y, aRadius, plan.slamAt - plan.chargeAt, plan.tier, 3 + 2 * plan.tier);
        cam.start();
        break;
      case 'slam': {
        // THE SLAM: a ground thud (lower per tier), a low punch, rock splitting; the rumble starts and BUILDS to the
        // eruption, then rings out through the tail.
        cue(c.sfxGroundClip, c.sfxGroundGain * (0.8 + 0.07 * plan.tier), c.sfxGroundRate - 0.04 * (plan.tier - 1), { lenMs: 1200, fadeMs: 350 });
        cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 500, fadeMs: 180 });
        if (plan.quake) {
          // Only the huge hit is a true earthquake (owner 2026-09-28: "maybe only the huge hit should quake"): the board
          // rumbles, a crack races to the target, the ground splits round the hero.
          cue(c.sfxCrackClip, c.sfxCrackGain * 0.8, c.sfxCrackRate + 0.05, { lenMs: 600, fadeMs: 220 });
          voices.keep(playRumble('attack', {
            gain: c.sfxRumbleGain * (0.45 + 0.2 * plan.tier), buildMs: real(plan.travelMs), holdMs: real(120),
            tailMs: real(Math.max(300, plan.rumbleTailMs)), lowHz: c.sfxRumbleLowHz, highHz: c.sfxRumbleHighHz * (0.8 + 0.1 * plan.tier),
          }));
        }
        scene?.slam(o.attacker.x, o.attacker.y, aRadius, {
          tier: plan.tier, k: plan.k, width: plan.crackWidth, magma: plan.magma, rocks: Math.round(plan.rocks * (plan.quake ? 0.4 : 0.2)), dust: plan.dust,
          boardCracks: plan.boardCracks, reach: Math.max(dist, 400 * s), heading, cracks: plan.quake,
        });
        if (plan.quake) {
          scene?.quake(o.attacker, o.defender, aRadius, radius, {
            travelMs: plan.travelMs, width: plan.crackWidth, branches: plan.branches, fissures: plan.fissures, magma: plan.magma,
            segPx: c.crackSegPx, jag: c.crackJag, openPx: c.crackOpenPx, branchLength: c.branchLength, grit: 0.4 + 0.3 * plan.tier,
          });
        }
        break;
      }
      case 'throw': {
        // A boulder ripped out of the ground and HURLED (tiers I-III): a heavy whoosh, pitch stepping up per boulder.
        const n = plan.throws.length;
        cue(c.sfxThrowClip, c.sfxThrowGain, c.sfxThrowRate + 0.08 * q.i, { lenMs: 700, fadeMs: 250 });
        if (q.i > 0) cue(c.sfxCrackClip, c.sfxCrackGain * 0.45, c.sfxCrackRate + 0.2, { lenMs: 300, fadeMs: 120 });
        const last = q.i === n - 1;
        scene?.boulder(o.attacker, o.defender, aRadius, radius, {
          durMs: (plan.lands[q.i] ?? plan.impactAt) - q.at, size: plan.boulderSize * (last ? 1 : 0.8), lift: plan.arcLift,
          side: n === 1 ? 0 : (q.i - (n - 1) / 2) * 1.4, hot: plan.magma >= 0.5 ? plan.magma : 0, age0: seq.t - q.at,
        });
        break;
      }
      case 'land': {
        // An earlier boulder lands (a tick: FX and a knock only; the blow lands once, on the last).
        const a = heading + Math.PI + (q.i % 2 ? 0.9 : -0.9);
        cue(c.sfxThumpClip, c.sfxThumpGain * 0.8, c.sfxThumpRate + 0.1 + 0.05 * q.i, { lenMs: 400, fadeMs: 150 });
        cue(c.sfxCrackClip, c.sfxCrackGain * 0.55, c.sfxCrackRate + 0.15 + 0.05 * q.i, { lenMs: 350, fadeMs: 140 });
        scene?.landTick(o.defender.x + Math.cos(a) * radius * 0.35, o.defender.y + Math.sin(a) * radius * 0.35, radius, 0.9);
        break;
      }
      case 'burst': {
        // Secondary eruptions along the path: each a crack of rock and a pop, climbing in pitch.
        cue(c.sfxBoomClip, c.sfxBoomGain * 0.8, c.sfxBoomRate + q.i * 0.05, { lenMs: 500, fadeMs: 200 });
        cue(c.sfxCrackClip, c.sfxCrackGain * 0.6, c.sfxCrackRate + 0.1 + q.i * 0.04, { lenMs: 400, fadeMs: 160 });
        scene?.burst(plan.burstFracs[q.i] ?? 0.5, s * (0.75 + 0.35 * plan.k), plan.magma);
        break;
      }
      case 'impact':
        // THE ERUPTION: rock bursting (pitched down per tier), splitting rock, a big blast on III+, then debris patter.
        cue(c.sfxEruptClip, c.sfxEruptGain * (0.8 + 0.06 * plan.tier), c.sfxEruptRate - 0.05 * (plan.tier - 1), { tail: c.sfxTailMix, lenMs: c.sfxEruptLenMs, fadeMs: 450 });
        cue(c.sfxThumpClip, c.sfxThumpGain * 1.1, c.sfxThumpRate - 0.05 * plan.tier, { lenMs: 600, fadeMs: 200 });
        cue(c.sfxCrackClip, c.sfxCrackGain, c.sfxCrackRate, { lenMs: 700, fadeMs: 250 });
        if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain * (plan.tier >= 4 ? 1.2 : 1), c.sfxBigRate - (plan.tier >= 4 ? 0.08 : 0), { lenMs: 1100, fadeMs: 400, tail: c.sfxTailMix });
        for (let i = 0; i < 1 + plan.tier; i++) {
          cue(c.sfxPatterClip, c.sfxPatterGain * (1 - i * 0.12), c.sfxPatterRate + (i % 2 ? 0.15 : -0.1), { lenMs: 220, fadeMs: 90, delayMs: real(380 + i * (90 + 20 * i)) });
        }
        scene?.erupt(o.defender.x, o.defender.y, radius, {
          tier: plan.tier, k: plan.k, flashAlpha: c.flashAlpha, width: plan.crackWidth, magma: plan.magma, rocks: plan.rocks, dust: plan.dust,
          eruption: plan.eruption, crater: plan.crater, craterMs: c.craterMs, heading, rockSize: c.rockSize,
          quake: plan.quake, spikes: plan.spikes, spikeHeight: plan.spikeHeight, spray: plan.spray,
        });
        // Straight UP out of the ground; near the top edge (the foe's corner) the column is shorter and the jets round
        // its base carry the read, so it never becomes a sideways beam.
        if (plan.pillar) scene?.pillar(o.defender.x, o.defender.y, radius, c.pillarHoldMs, plan.eruption, Math.round(plan.rocks * 0.5));
        seq.land();
        break;
      case 'boom': {
        // Follow-up explosions ring the struck hero, alternating sides, each a little higher in pitch.
        const a = q.i * 2.4 + heading;
        const rr = radius * (0.7 + 0.25 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.06, { lenMs: c.sfxBoomLenMs, fadeMs: 260 });
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr, s * (0.8 + 0.15 * plan.tier), plan.magma);
        break;
      }
      case 'fade':
        scene?.fade(Math.max(1, plan.endAt - plan.fadeAt));
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.slamAt, plan.impactAt + (plan.pillar ? c.pillarHoldMs : 250));
    const cm = quakeCameraAt(plan, c, t);
    cam.apply(quakeCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, local ? 1 : s);
    if (hero.el && t >= plan.chargeAt) {
      // RISE through the wind-up (swelling, hanging at the top), DRIVE DOWN into the slam, squash and spring back.
      const px = local ? 0.45 : 1;
      if (t < plan.slamAt) {
        const u = (t - plan.chargeAt) / Math.max(1, plan.slamAt - plan.chargeAt);
        const up = easeOutCubic(Math.min(1, u / 0.72)) * (1 - Math.pow(clamp01((u - 0.82) / 0.18), 2));
        const sc = 1 + c.heroSwell * easeInOutSine(Math.min(1, u / 0.8));
        hero.set(`translate(0px, ${(-plan.liftPx * px * up).toFixed(2)}px) scale(${sc.toFixed(4)})`);
      } else {
        const k = spring(t - plan.slamAt, 4.2, 85);
        const sq = c.heroSquash * (0.7 + 0.3 * plan.k) * k;
        hero.set(Math.abs(k) < 0.004 ? null
          : `translate(0px, ${(plan.liftPx * 0.3 * px * Math.max(0, k)).toFixed(2)}px) scale(${(1 + sq).toFixed(4)}, ${(1 - sq).toFixed(4)})`);
      }
    }
    if (foe.el) {
      if (t >= plan.travelAt && t < plan.impactAt) {
        // The ground under the target trembles harder as the blow closes in (anticipation).
        const u = (t - plan.travelAt) / Math.max(1, plan.travelMs);
        const a = (1 + 2.5 * plan.k) * u * u * (local ? 0.5 : 1);
        foe.set(`translate(${(a * 0.4 * Math.sin(t * 0.21)).toFixed(2)}px, ${(a * Math.sin(t * 0.37)).toFixed(2)}px)`);
      } else if (t >= plan.impactAt) {
        // JOLTED UP by the eruption, then down past rest, springing home; squashed on the way.
        const k = spring(t - plan.impactAt, 3.6, 120);
        const up = c.knockPx * (0.7 + 0.5 * plan.k) * k * (local ? 0.5 : 1);
        const sq = c.squash * k;
        foe.set(Math.abs(k) < 0.004 ? null
          : `translate(0px, ${(-up).toFixed(2)}px) scale(${(1 + sq * 0.5).toFixed(4)}, ${(1 - sq).toFixed(4)})`);
      }
    }
  };

  const seq: Sequence<QuakeCue | FormationCue> = new Sequence<QuakeCue | FormationCue>({
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
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}

