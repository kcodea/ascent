/**
 * THE GRAND FINALE RUNNER: plays one fireworks hero attack (the beats are in `heroFireworksConfig.ts`) and lands the
 * consequence on its impact beat (the rocket's pop, the candle's third pop, or the shell's bloom). Presentation only:
 * the total it shows and the blow it lands are handed in, already decided by the engine.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera, the portraits (transform only, restored after), the voices, the
 * dim, reduced motion, finish / cancel and the safety timer. What is this style's own: the planted firework, its fuse,
 * the flights, the pops, THE HELD BEAT and the bloom, its camera and its sound.
 *
 * THE HELD BEAT (the mortar) is staged, not a pause: the clock runs straight through it. For `holdMs` nothing is asked
 * to move (the camera holds one zoom, both portraits are at rest, the scene has only the standing tube), no sound is
 * cued, and the dim finishes closing. The bloom, the boom and the blow then land together on the impact beat.
 *
 * THE CAMERA IS APPLIED ONCE (as Card Shark, see `../heroCards/heroCards.ts`): the Pixi root mirrors the DOM camera only
 * when its canvas is NOT already inside the camera element.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; every sprite is pooled and capped, the bloom's stars live in flat arrays and their sprites are
 * made ahead of time during the formation; textures are painted once per session and pre-warmed; no filters; and the
 * updater unhooks the moment the scene drains.
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
  LAUNCH_KICK_MS, getHeroFireworksConfig, fireworksArrivalDir, fireworksCameraAt, fireworksCameraFocus, fireworksCues, fireworksGeometry, fireworksPlan,
  type HeroFireworksConfig, type FireworksCue, type FireworksGeo, type FireworksPlan,
} from './heroFireworksConfig';
import { HeroFireworksScene, MAX_STARS, type HeroFireworksTextures } from './heroFireworksScene';
import { heroFireworksTextures } from './heroFireworksTextures';

export interface HeroFireworksOptions extends HeroAttackOptions {
  cfg?: HeroFireworksConfig;
  textures?: HeroFireworksTextures | null;
}

export interface HeroFireworksHandle extends HeroAttackHandle {
  readonly plan: FireworksPlan;
  /** Where the firework stands, every flight, the pops and the bloom (empty under reduced motion). */
  readonly geo: FireworksGeo;
  /** The colour of each pop, in order (the rocket: one; the candle: three, all different). */
  readonly tints: readonly number[];
  readonly scene: HeroFireworksScene | null;
}

/** The seed a fight's sparks and colours are drawn from: the same fight (same blow, same geometry) plays the same. */
export function fireworksSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, roll = 0): number {
  return (Math.round(total) * 4969 + Math.round(distance) * 53 + (side === 'opp' ? 401 : 29) + (Math.round(roll) >>> 0) * 7919) >>> 0;
}

/** The pop colours a seed rolls: a run through the four firework colours from a seeded start, so no two repeat. */
export function fireworksTints(seed: number, palette: readonly number[], n: number): number[] {
  const start = palette.length ? (seed >>> 0) % palette.length : 0;
  return Array.from({ length: n }, (_, i) => palette[(start + i) % Math.max(1, palette.length)] ?? 0xffffff);
}

/** Play the Grand Finale. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroFireworks(o: HeroFireworksOptions): HeroFireworksHandle {
  const c = o.cfg ?? getHeroFireworksConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = fireworksPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, fireworksCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hfireworks',
  });

  // The view (measured once, at the start): the firework stays inside it, the comet leaves its top, the bloom lights it.
  const view = local ? { w: o.host?.clientWidth || 400, h: o.host?.clientHeight || 300 } : { w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 };
  const geo = fireworksGeometry(plan, o.attacker, o.defender, radius, aRadius, c, s, view);
  const dir = fireworksArrivalDir(plan, geo, o.attacker, o.defender);
  const seed = fireworksSeed(o.total, dist, o.side, o.rollSeed);
  const palette = [hexToNum(c.colorGold), hexToNum(c.colorMagenta), hexToNum(c.colorCyan), hexToNum(c.colorGreen)];
  const tints = fireworksTints(seed, palette, Math.max(1, plan.launches.length));
  // The hero leans away from the firework it lit (it stands on the target's side).
  const away = o.defender.x >= o.attacker.x ? -1 : 1;

  // ── Pixi ──
  const textures = o.textures !== undefined ? o.textures : heroFireworksTextures();
  const mortar = plan.level === 3;
  const scene = textures && !reduced
    ? new HeroFireworksScene(textures, {
      core: hexToNum(c.colorCore), gold: palette[0]!, magenta: palette[1]!, cyan: palette[2]!, green: palette[3]!, side: hexToNum(sideHex),
    }, {
      trailMs: c.trailMs, bloomMs: c.bloomMs, rain: c.rain, rainMs: c.rainMs, glitter: c.glitter, skyFlash: c.skyFlash, dismissMs: c.dismissMs, flashAlpha: c.flashAlpha,
      prefill: mortar ? Math.min(MAX_STARS, Math.ceil(plan.sparks * 2.02) + Math.round(c.rain) + 4) : 0,
    }, s, seed)
    : null;
  scene?.setView(view.w, view.h);
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxPlantClip, c.sfxFuseClip, c.sfxSquealClip, c.sfxThumpClip, c.sfxPopClip, c.sfxBoomClip]);
  const strikePt = geo.strikes[geo.strikes.length - 1] ?? o.defender;
  const firstLaunch = plan.launches[0] ?? plan.impactAt;
  const lastLaunch = plan.launches[plan.launches.length - 1] ?? plan.impactAt;

  const fire = (q: FireworksCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'plant':
        // The firework is set down beside the hero.
        cue(c.sfxPlantClip, c.sfxPlantGain, c.sfxPlantRate, { lenMs: 300, fadeMs: 120 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.plant(geo, c.plantMs);
        cam.start();
        break;
      case 'fuse':
        // The fuse fizzes for exactly as long as it burns.
        cue(c.sfxFuseClip, c.sfxFuseGain, c.sfxFuseRate, { lenMs: plan.fuseMs + 60, fadeMs: 90 });
        scene?.fuse(plan.fuseMs);
        break;
      case 'launch': {
        const path = geo.paths[q.i] ?? geo.paths[0];
        const tint = tints[q.i] ?? tints[0]!;
        if (plan.level === 1) {
          // It SQUEALS off: the whistle runs the length of the flight.
          cue(c.sfxSquealClip, c.sfxSquealGain, c.sfxSquealRate, { lenMs: plan.flyMs + 140, fadeMs: 150 });
          if (path) scene?.launchRocket(path, plan.flyMs, tint, t - q.at);
        } else if (plan.level === 2) {
          // Thump, thump, thump: the same tube, a touch higher each time.
          cue(c.sfxThumpClip, c.sfxThumpGain * 0.6, c.sfxThumpRate + 0.6 + 0.1 * q.i, { lenMs: 260, fadeMs: 100 });
          scene?.thump(tint, 0.8);
          if (path) scene?.ball(path, plan.flyMs, tint, t - q.at);
        } else {
          // The heavy thump, and the shell is away.
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate, { tail: c.sfxTailMix * 0.5, lenMs: 380, fadeMs: 140 });
          scene?.thump(palette[0]!, 1.5, true);
          if (path) scene?.comet(path, plan.flyMs, t - q.at);
        }
        break;
      }
      case 'hold':
        // THE HELD BEAT: nothing is cued. The comet has left the screen; the quiet is the beat.
        break;
      case 'pop': {
        // A candle ball pops on the portrait: a tick, FX and sound only.
        const p = geo.strikes[q.i] ?? o.defender;
        cue(c.sfxPopClip, c.sfxPopGain * 0.7, c.sfxPopRate + 0.25 - 0.1 * q.i, { lenMs: 340, fadeMs: 170 });
        scene?.pop(p, tints[q.i] ?? tints[0]!, 0.8 * plan.burst, plan.sparks);
        break;
      }
      case 'impact':
        if (mortar) {
          // THE BLOOM: the boom and its crackle, the chrysanthemum, the blow.
          cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate, { tail: c.sfxTailMix, fadeMs: 400 });
          if (geo.bloom) scene?.bloom(geo.bloom, geo.bloomR, o.defender, radius, plan.sparks, plan.burst);
        } else {
          const last = tints[tints.length - 1]!;
          cue(c.sfxPopClip, c.sfxPopGain * (plan.level === 2 ? 1.15 : 1), c.sfxPopRate - (plan.level === 2 ? 0.2 : 0), { tail: c.sfxTailMix * 0.6, lenMs: plan.level === 2 ? 760 : 560, fadeMs: 260 });
          scene?.pop(strikePt, last, (plan.level === 2 ? 1.15 : 1) * plan.burst, Math.round(plan.sparks * (plan.level === 2 ? 1.4 : 1)));
        }
        seq.land();
        break;
      case 'dismiss':
        scene?.dismiss();
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    if (mortar) nums.paintDim(t, firstLaunch, plan.holdAt + Math.min(180, plan.holdMs * 0.4), plan.impactAt + 760);
    else nums.paintDim(t, plan.chargeAt, firstLaunch, plan.impactAt + 220);
    const cm = fireworksCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(fireworksCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The hero leans away from the lit firework, and flinches at every launch. At rest again LAUNCH_KICK_MS after the
      // last one (so both portraits are exactly still through the held beat).
      const lean = t < lastLaunch
        ? easeInOutSine((t - plan.chargeAt) / Math.max(1, firstLaunch - plan.chargeAt))
        : 1 - easeInOutSine((t - lastLaunch) / LAUNCH_KICK_MS);
      let bx = away * c.heroCoilPx * px * lean, by = 0;
      for (const at of plan.launches) {
        const age = t - at;
        if (age < 0 || age >= LAUNCH_KICK_MS) continue;
        const f = c.heroFlinchPx * px * (mortar ? 1.3 : plan.level === 2 ? 0.6 : 1) * spring(age, 6, 55) * (1 - age / LAUNCH_KICK_MS);
        bx += away * f; by += f * 0.35;
      }
      hero.set(Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px)`);
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let css: string | null = null;
      let sx = 1, sy = 1;
      if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.5 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        fx = dir.x * knock; fy = dir.y * knock;
        if (Math.abs(k) >= 0.004) {
          // Squashed along the way the blow came: sideways for a flight, DOWN under the bloom.
          if (Math.abs(dir.y) > Math.abs(dir.x)) { sx = 1 + sq * 0.6; sy = 1 - sq; } else { sx = 1 - sq; sy = 1 + sq * 0.6; }
        }
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        let k = 0;
        for (const at of plan.hits) k += at <= t ? Math.max(0, spring(t - at, 6, 45)) : 0;
        fx = dir.x * k * 6 * px; fy = dir.y * k * 6 * px;
      }
      if (Math.abs(fx) + Math.abs(fy) >= 0.05 || sx !== 1) css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)${sx !== 1 ? ` scale(${sx.toFixed(4)}, ${sy.toFixed(4)})` : ''}`;
      foe.set(css);
    }
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<FireworksCue | FormationCue> = new Sequence<FireworksCue | FormationCue>({
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
    tints,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
