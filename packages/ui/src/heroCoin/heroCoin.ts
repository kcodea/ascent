/**
 * THE COIN FLICK RUNNER (a Rare hero attack): plays one Coin Flick (the beats are in `heroCoinConfig.ts`) and lands the
 * consequence on its impact beat (the last ping). Presentation only: the total it shows and the blow it lands are
 * handed in, already decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), as every style does: one clock (it never pauses), the
 * damage formation, the `#stage` camera (applied ONCE: `stageCamera.ts`), the portraits (transform only, restored after),
 * the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE RICOCHET CONTRACT: every ping before the last is a tick (FX and sound only). The consequence (`onImpact`) lands
 * exactly ONCE, on the last ping.
 *
 * Perf: DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after the opening measure;
 * the Pixi sprites are pooled (a hard cap), the textures painted once per session and pre-warmed during the formation,
 * and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  coinCameraAt, coinCameraFocus, coinCues, coinPath, coinPlan, getHeroCoinConfig,
  type CoinCue, type CoinPath, type CoinPlan, type HeroCoinConfig,
} from './heroCoinConfig';
import { HeroCoinScene, type HeroCoinTextures } from './heroCoinScene';
import { heroCoinTextures } from './heroCoinTextures';

export interface HeroCoinOptions extends HeroAttackOptions {
  cfg?: HeroCoinConfig;
  textures?: HeroCoinTextures | null;
}

export interface HeroCoinHandle extends HeroAttackHandle {
  readonly plan: CoinPlan;
  /** The coin's whole path (empty under reduced motion). */
  readonly path: CoinPath;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroCoinScene | null;
  /** Whether the camera is mirrored onto the Pixi root (false when the canvas already rides the camera). */
  readonly mirrorsCamera: boolean;
}

/** The seed a fight's glitter is scattered from: the same fight sparkles the same way. */
export function coinSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 13)) >>> 0;
}

/** Play the Coin Flick. Returns a handle; the blow lands via `onImpact` on the last ping. */
export function playHeroCoin(o: HeroCoinOptions): HeroCoinHandle {
  const c = o.cfg ?? getHeroCoinConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = coinPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, coinCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hcoin',
  });

  const arc = c[`${plan.level}Arc`];
  const path = coinPath(plan, o.attacker, o.defender, radius, aRadius, arc, (local ? 8 : 36) * s, nums.pts.hit, c[`${plan.level}HopLift`]);
  const lastIn = path.arrive[path.arrive.length - 1] ?? (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();

  const textures = o.textures !== undefined ? o.textures : heroCoinTextures();
  const scene = textures && !reduced
    ? new HeroCoinScene(textures, {
      gold: hexToNum(c.colorGold), amber: hexToNum(c.colorAmber), shine: hexToNum(c.colorShine), deep: hexToNum(c.colorDeep), side: hexToNum(sideHex),
    }, {
      px: c.coinPx, ghosts: c.ghosts, ghostMs: c.ghostMs, glint: c.glintAlpha, ping: c.pingSize, caromMs: c.caromMs,
      showerSpeed: c.showerSpeed, showerGravity: c.showerGravity,
    }, s, coinSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxFlickClip, c.sfxSnapClip, c.sfxDingClip, c.sfxSparkleClip, c.sfxImpactClip, c.sfxShowerClip]);
  const hand = path.legs[0]?.a ?? o.attacker;

  const fire = (q: CoinCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(hand, plan.flickAt - plan.chargeAt);
        cam.start();
        break;
      case 'flick':
        cue(c.sfxFlickClip, c.sfxFlickGain, c.sfxFlickRate, { lenMs: 260, fadeMs: 100 });
        cue(c.sfxSnapClip, c.sfxSnapGain, c.sfxSnapRate, { startMs: 440, lenMs: 160, fadeMs: 80 });
        scene?.flick(path, plan.size, plan.flipHz, t - q.at);
        break;
      case 'hit': {
        // A ricochet ping: the ding climbs a step each time (a little tune), a sparkle under it. FX only.
        cue(c.sfxDingClip, c.sfxDingGain * 0.8, c.sfxDingRate + 0.12 * q.i, { lenMs: 500, fadeMs: 200 });
        cue(c.sfxSparkleClip, c.sfxSparkleGain * 0.6, c.sfxSparkleRate + 0.08 * q.i, { lenMs: 400, fadeMs: 160 });
        const at = path.contacts[q.i];
        if (at) scene?.ping(at, path.arrive[q.i] ?? toFoe, 0.85, Math.round(plan.sparkles * 0.6));
        break;
      }
      case 'impact': {
        const up = plan.hits.length;
        cue(c.sfxDingClip, c.sfxDingGain, c.sfxDingRate + 0.12 * up, { lenMs: 700, fadeMs: 260, tail: 0.12 });
        cue(c.sfxSparkleClip, c.sfxSparkleGain, c.sfxSparkleRate + 0.08 * up, { lenMs: 500, fadeMs: 200 });
        cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate, { lenMs: 400, fadeMs: 150 });
        if (plan.shower > 0) cue(c.sfxShowerClip, c.sfxShowerGain, c.sfxShowerRate, { delayMs: 60 / speed, lenMs: 900, fadeMs: 300 });
        const at = path.contacts[path.contacts.length - 1];
        if (at) scene?.impact(at, lastIn, { big: plan.level === 'big', shower: plan.shower, sparkles: plan.sparkles });
        seq.land();
        break;
      }
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.flickAt, plan.impactAt + 200);
    const cm = coinCameraAt(plan, c, t, lastIn);
    const unit = local ? 1 : s;
    cam.apply(coinCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The ready: a small dip back (a wind of the wrist); the flick snaps it toward the target and springs home.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.flickAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.flickAt - plan.chargeAt));
        sc = 1 - 0.03 * u;
        bx = -toFoe.x * c.heroDipPx * px * u; by = -toFoe.y * c.heroDipPx * px * u + 2 * px * u;
      } else {
        const back = Math.max(0, spring(t - plan.flickAt, 3, 80));
        const f = c.heroFlickPx * px * spring(t - plan.flickAt, 5, 60);
        sc = 1 - 0.03 * back + 0.02 * Math.max(0, f / Math.max(1, c.heroFlickPx * px));
        bx = -toFoe.x * c.heroDipPx * px * back + toFoe.x * f; by = -toFoe.y * c.heroDipPx * px * back + toFoe.y * f;
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    let css: string | null = null;
    if (t >= plan.impactAt) {
      const k = spring(t - plan.impactAt, 4.5, 80);
      const knock = c.knockPx * (plan.level === 'big' ? 1.2 : 0.9) * k * px;
      const sq = c.squash * (plan.level === 'big' ? 1.2 : 0.9) * k;
      fx = lastIn.x * knock; fy = lastIn.y * knock;
      css = Math.abs(k) < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
    } else if (plan.hits.length && t >= plan.hits[0]!) {
      // Each ricochet ping nudges the face along the coin that hit it.
      let kx = 0, ky = 0;
      for (let i = 0; i < plan.hits.length; i++) {
        const k = Math.max(0, spring(t - plan.hits[i]!, 6, 45));
        const d = path.arrive[i] ?? lastIn;
        kx += d.x * k; ky += d.y * k;
      }
      fx = kx * 6 * px; fy = ky * 6 * px;
      css = Math.abs(fx) + Math.abs(fy) < 0.05 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
    }
    foe.set(css);
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<CoinCue | FormationCue> = new Sequence<CoinCue | FormationCue>({
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
    path,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
