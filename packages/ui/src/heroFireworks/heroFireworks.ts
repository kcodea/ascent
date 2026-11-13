/**
 * THE GRAND FINALE RUNNER: plays one fireworks hero attack (the beats are in `heroFireworksConfig.ts`) and lands the
 * consequence on its impact beat (Tier 1's shell, Tier 2's third shell, or Tier 3's enormous shell). Presentation only:
 * the total it shows and the blow it lands are handed in, already decided by the engine.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera, the portraits (transform only, restored after), the voices, the
 * dim, reduced motion, finish / cancel and the safety timer. What is this style's own: the spark and its fuse on the
 * hero's rim, every shell's flight and burst, the struck portrait flinching and singed, THE HELD BEAT and the enormous
 * shell, its camera and its sound.
 *
 * THE VARIANT is rolled from the stable `rollSeed` (`fireworksVariantOf`), so a replay plays the same show; the DEV
 * tuner's Variation row forces one.
 *
 * THE HELD BEAT (Tier 3) is staged, not a pause: the clock runs straight through it. The comet has left the screen, the
 * barrage's smoke hangs, the camera holds still, the dim closes and only a soft crowd "ooh" rises. The enormous shell,
 * the boom and the blow then land together on the impact beat.
 *
 * SOUND. Every visible beat has a cue: the spark (a strike and the fuse's fizz for as long as it burns), every launch
 * from the hero (a squeal; the pinwheel's whirr; the comet's thump and rising whistle), the dud's sputter, the bursts (a
 * crack with a body under the ticks, a volley under every barrage wave), the held beat (the crowd), the blow (a pop and
 * a boom; Tier 3's deep boom, two takes of crackle and the crowd's "aah") and the final flash.
 *
 * THE CAMERA IS APPLIED ONCE (as Card Shark, see `../heroCards/heroCards.ts`): the Pixi root mirrors the DOM camera only
 * when its canvas is NOT already inside the camera element.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; every sprite is pooled and capped, every particle lives in flat arrays and the sprites are made
 * ahead of time during the formation; textures are painted once per session and pre-warmed; no filters; and the updater
 * unhooks the moment the scene drains.
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
  LAUNCH_KICK_MS, PALETTE_KEYS, getHeroFireworksConfig, fireworksArrivalDir, fireworksCameraAt, fireworksCameraFocus, fireworksCues, fireworksGeometry, fireworksPlan,
  fireworksVariantOf, type HeroFireworksConfig, type FireworksCue, type FireworksGeo, type FireworksPlan, type FireworksVariant,
} from './heroFireworksConfig';
import { HeroFireworksScene, MAX_FIREWORKS_SPRITES, type HeroFireworksTextures } from './heroFireworksScene';
import { heroFireworksTextures } from './heroFireworksTextures';

export interface HeroFireworksOptions extends HeroAttackOptions {
  cfg?: HeroFireworksConfig;
  textures?: HeroFireworksTextures | null;
}

export interface HeroFireworksHandle extends HeroAttackHandle {
  readonly plan: FireworksPlan;
  readonly variant: FireworksVariant;
  /** Where the spark is lit, every flight and burst, and the enormous shell (empty under reduced motion). */
  readonly geo: FireworksGeo;
  readonly scene: HeroFireworksScene | null;
}

/** The seed a fight's sparks and colours are drawn from: the same fight (same blow, same geometry) plays the same. */
export function fireworksSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, roll = 0): number {
  return (Math.round(total) * 4969 + Math.round(distance) * 53 + (side === 'opp' ? 401 : 29) + (Math.round(roll) >>> 0) * 7919) >>> 0;
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
  const seed = fireworksSeed(o.total, dist, o.side, o.rollSeed);
  const variant = fireworksVariantOf(o.rollSeed ?? seed, c);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = fireworksPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt, variant, seed }, c);
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

  // The view (measured once, at the start): the barrage spreads across it, the comet leaves its top, the giant fills it.
  const view = local ? { w: o.host?.clientWidth || 400, h: o.host?.clientHeight || 300 } : { w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 };
  const geo = fireworksGeometry(plan, o.attacker, o.defender, radius, aRadius, c, s, view, seed);
  const dir = fireworksArrivalDir(plan, geo, o.attacker, o.defender);
  const palette = PALETTE_KEYS.map((k) => hexToNum(c[k]));
  // The hero leans away from the spark it lit (on its rim, toward the target).
  const away = o.defender.x >= o.attacker.x ? -1 : 1;
  const big = plan.level === 3;

  // ── Pixi ──
  const textures = o.textures !== undefined ? o.textures : heroFireworksTextures();
  const scene = textures && !reduced
    ? new HeroFireworksScene(textures, { core: hexToNum(c.colorCore), side: hexToNum(sideHex), palette }, {
      bloomMs: 2100, rain: c.rain, rainMs: c.rainMs, skyFlash: c.skyFlash, flashAlpha: c.flashAlpha, smoke: c.smoke, singe: c.singe, stars: plan.stars,
      // Every sprite the busiest frame will ask for, made ahead while the formation plays.
      prefill: Math.min(MAX_FIREWORKS_SPRITES - 80, big ? 1900 : 520),
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
  voices.warm([c.sfxIgniteClip, c.sfxFuseClip, c.sfxSquealClip, c.sfxThumpClip, c.sfxPopClip, c.sfxBoomClip, c.sfxWhistleClip, c.sfxCrackleClip, c.sfxDudClip, c.sfxPinwheelClip, ...(big ? [c.sfxVolleyClip, c.sfxOohClip, c.sfxAahClip] : [])]);
  const first = plan.shells[0]?.launchAt ?? plan.impactAt;
  const heroLaunches = plan.shells.filter((q) => q.from === 'hero').map((q) => q.takeoffAt);
  const lastHeroLaunch = heroLaunches.length ? Math.max(...heroLaunches) : plan.impactAt;
  const firstHeroLaunch = heroLaunches.length ? Math.min(...heroLaunches) : plan.impactAt;
  // The portrait is rocked away from the side the blow came from.
  const rockSign = (geo.bloom ? geo.bloom.x <= o.defender.x : o.attacker.x <= o.defender.x) ? 1 : -1;
  const wavesSounded = new Set<number>();
  // Seeded pitches for the barrage's pops (a replay sounds the same).
  const pitchOf = (i: number): number => 0.82 + (((seed >>> (i % 24)) ^ (i * 2654435761)) >>> 0) % 1000 / 1000 * 0.5;

  const launchOpts = (i: number) => {
    const q = plan.shells[i]!;
    const g = geo.shells[i]!;
    return { flight: q.flight, kind: q.kind, path: g.path, at: g.at, R: g.R, tint: q.tint, tint2: q.tint2, flyMs: q.flyMs, spinMs: q.takeoffAt - q.launchAt, fromHero: q.from === 'hero' };
  };

  const fire = (q: FireworksCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'ignite':
        // The spark strikes on the hero's rim and the fuse crawls round it, fizzing for exactly as long as it burns.
        cue(c.sfxIgniteClip, c.sfxIgniteGain, c.sfxIgniteRate, { fadeMs: 150 });
        cue(c.sfxFuseClip, c.sfxFuseGain, c.sfxFuseRate, { delayMs: 60, lenMs: plan.fuseMs, fadeMs: 90 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.ignite(geo.ember, geo.fuse, plan.fuseMs);
        cam.start();
        break;
      case 'launch': {
        const sh = plan.shells[q.i]!;
        if (geo.shells[q.i]) scene?.launch(q.i, launchOpts(q.i), t - q.at);
        if (sh.flight === 'comet') {
          // The enormous shell: a heavy thump and its whistle rising for as long as the comet is in view.
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate * 0.9, { fadeMs: 160 });
          cue(c.sfxWhistleClip, c.sfxWhistleGain * 1.2, c.sfxWhistleRate * 0.9, { delayMs: 40, lenMs: Math.max(120, sh.flyMs - 20) * c.sfxWhistleRate * 0.9, fadeMs: 160 });
        } else if (sh.flight === 'pinwheel') {
          cue(c.sfxPinwheelClip, c.sfxPinwheelGain, c.sfxPinwheelRate, { lenMs: sh.takeoffAt - sh.launchAt + sh.flyMs, fadeMs: 200 });
        } else if (sh.flight === 'dud') {
          cue(c.sfxSquealClip, c.sfxSquealGain * 0.7, c.sfxSquealRate * 0.8, { lenMs: sh.flyMs * 0.4 + 60, fadeMs: 120 });
        } else if (sh.from === 'hero' && (!big || sh.role === 'hit' || q.i % 2 === 0)) {
          cue(c.sfxSquealClip, c.sfxSquealGain * (big ? 0.7 : 1), c.sfxSquealRate * (big ? 0.9 + pitchOf(q.i) * 0.3 : 1 + 0.06 * q.i), { lenMs: sh.flyMs + 80, fadeMs: 140 });
          if (!big) cue(c.sfxThumpClip, c.sfxThumpGain * 0.3, c.sfxThumpRate * 1.6, { lenMs: 160, fadeMs: 90 });
        } else if (big && sh.from === 'ground' && q.i % 3 === 1) {
          cue(c.sfxWhistleClip, c.sfxWhistleGain * 0.45, c.sfxWhistleRate * (0.9 + 0.3 * pitchOf(q.i)), { lenMs: sh.flyMs, fadeMs: 160 });
        }
        break;
      }
      case 'takeoff':
        scene?.takeoff(q.i);
        cue(c.sfxSquealClip, c.sfxSquealGain * 0.8, c.sfxSquealRate * 1.15, { lenMs: plan.shells[q.i]!.flyMs + 80, fadeMs: 140 });
        break;
      case 'sputter': {
        const sh = plan.shells[q.i]!;
        scene?.sputter(q.i);
        // The dud's sad fizzle; the fake-out's sputter (higher, cut to its hang).
        if (sh.flight === 'dud') cue(c.sfxDudClip, c.sfxDudGain, c.sfxDudRate, { fadeMs: 200 });
        else cue(c.sfxDudClip, c.sfxDudGain * 0.85, c.sfxDudRate * 1.3, { lenMs: c.sputterMs + 40, fadeMs: 90 });
        break;
      }
      case 'burst': {
        const sh = plan.shells[q.i]!;
        if (sh.flight === 'dud') {
          // Pfft: a soft low thud under the last of the fizzle.
          cue(c.sfxThumpClip, c.sfxThumpGain * 0.25, c.sfxThumpRate * 0.7, { lenMs: 200, fadeMs: 120 });
          scene?.burstShell(q.i);
          break;
        }
        const hit = sh.role === 'hit';
        // Tier 3 throws thirty-odd shells: each one a little leaner keeps the crowd under the particle cap (the busiest
        // moment is the last wave and the crescendo together, about a second before the enormous shell).
        scene?.burstShell(q.i, hit ? 1.1 : 1, big ? (hit ? 0.75 : 0.62) : 1);
        if (big && sh.wave >= 0 && !wavesSounded.has(sh.wave)) {
          // A wave starts bursting: the volley rolls under it.
          wavesSounded.add(sh.wave);
          cue(c.sfxVolleyClip, c.sfxVolleyGain * Math.min(1.2, 0.8 + 0.12 * sh.wave), c.sfxVolleyRate * (1 - 0.04 * sh.wave), { fadeMs: 400 });
        }
        if (hit || !big || q.i % 2 === 0) {
          cue(c.sfxPopClip, c.sfxPopGain * (hit ? 0.95 : big ? 0.6 : 0.85), c.sfxPopRate * (big ? pitchOf(q.i) : 1.15 - 0.1 * q.i), { tail: hit ? c.sfxTailMix : 0, fadeMs: 170 });
        }
        if (hit) cue(c.sfxBoomClip, c.sfxBoomGain * 0.28, c.sfxBoomRate * 1.5, { lenMs: 480, fadeMs: 260 });
        if (sh.kind === 'crackle' || sh.kind === 'willow') cue(c.sfxCrackleClip, c.sfxCrackleGain * 0.5, c.sfxCrackleRate * 1.1, { delayMs: 200, lenMs: 900, fadeMs: 300 });
        if (hit) {
          // A tick: the struck portrait flinches, lit and singed.
          scene?.light(o.defender, radius, palette[sh.tint % palette.length]!, 0.5, 420);
          scene?.singe(o.defender, radius, 0.6, Math.max(400, plan.endAt - t - 200));
        }
        break;
      }
      case 'hold':
        // THE HELD BEAT: the comet has gone, the smoke hangs, and the crowd draws breath.
        cue(c.sfxOohClip, c.sfxOohGain, c.sfxOohRate, { lenMs: plan.holdMs + 140, fadeMs: 140 });
        break;
      case 'impact':
        if (big) {
          // THE ENORMOUS SHELL: the deep boom, the crackle that carries the glitter rain, and the crowd's "aah".
          cue(c.sfxBoomClip, c.sfxBoomGain * 1.25, c.sfxBoomRate, { tail: c.sfxTailMix, fadeMs: 400 });
          cue(c.sfxCrackleClip, c.sfxCrackleGain, c.sfxCrackleRate, { delayMs: 170, fadeMs: 300 });
          cue(c.sfxCrackleClip, c.sfxCrackleGain * 1.1, c.sfxCrackleRate * 0.82, { delayMs: 900, fadeMs: 400 });
          cue(c.sfxAahClip, c.sfxAahGain, c.sfxAahRate, { delayMs: 380, fadeMs: 500 });
          cue(c.sfxVolleyClip, c.sfxVolleyGain * 0.5, c.sfxVolleyRate * 0.8, { delayMs: 450, fadeMs: 600 });
          if (geo.bloom) scene?.giant(q.i, geo.bloom, geo.bloomR, o.defender, radius, c.giantStars, plan.variant);
          scene?.singe(o.defender, radius, 1.3, Math.max(400, plan.endAt - t - 200));
          // THE AFTERMATH: crackle popping on the struck face, glitter drifting onto it, smoke curling off it.
          scene?.smoulder(o.defender, radius, Math.max(400, plan.endAt - t - 250));
        } else {
          const sh = plan.shells[q.i]!;
          // A crisp crack with a body under it (the boom, short and pitched up), and a breath of crackle after.
          cue(c.sfxPopClip, c.sfxPopGain * (plan.level === 2 ? 1.15 : 1), c.sfxPopRate * (plan.level === 2 ? 0.88 : 1), { tail: c.sfxTailMix * 0.6, fadeMs: 260 });
          cue(c.sfxBoomClip, c.sfxBoomGain * (plan.level === 2 ? 0.6 : 0.45), c.sfxBoomRate * 1.45, { lenMs: 560, fadeMs: 300 });
          cue(c.sfxCrackleClip, c.sfxCrackleGain * (sh.kind === 'crackle' ? 1 : 0.7), c.sfxCrackleRate * 1.15, { delayMs: sh.kind === 'crackle' ? 40 : 160, startMs: 200, lenMs: 900, fadeMs: 300 });
          scene?.burstShell(q.i, plan.level === 2 ? 1.25 : 1.1);
          scene?.light(o.defender, radius, palette[sh.tint % palette.length]!, 1, 900);
          scene?.singe(o.defender, radius, plan.level === 2 ? 1.1 : 0.8, Math.max(400, plan.endAt - t - 200));
        }
        seq.land();
        break;
      case 'final':
        // The last of it: a flash on the struck portrait, a crack and a shimmer of crackle.
        cue(c.sfxPopClip, c.sfxPopGain, c.sfxPopRate * 0.8, { tail: c.sfxTailMix, fadeMs: 220 });
        cue(c.sfxBoomClip, c.sfxBoomGain * 0.4, c.sfxBoomRate * 1.3, { lenMs: 620, fadeMs: 320 });
        cue(c.sfxCrackleClip, c.sfxCrackleGain * 0.6, c.sfxCrackleRate * 1.25, { delayMs: 120, lenMs: 800, fadeMs: 300 });
        // The portrait smouldering on: a last, thinning crackle under the aftermath.
        cue(c.sfxCrackleClip, c.sfxCrackleGain * 0.4, c.sfxCrackleRate * 0.95, { delayMs: 900, lenMs: Math.max(300, plan.endAt - plan.finalAt - 1100), fadeMs: 500 });
        scene?.finalFlash(o.defender, radius);
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    if (big) nums.paintDim(t, plan.chargeAt, first + 300, plan.impactAt + Math.max(900, c.aftermathMs - 500));
    else nums.paintDim(t, plan.chargeAt, first, plan.impactAt + 650);
    const cm = fireworksCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(fireworksCameraFocus(plan, t, o.attacker, o.defender, geo.bloom), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The hero leans away from the spark on its rim, and flinches at each shell leaving it. At rest again
      // LAUNCH_KICK_MS after the last one (so both portraits are still through the held beat).
      const lean = t < lastHeroLaunch
        ? easeInOutSine((t - plan.chargeAt) / Math.max(1, firstHeroLaunch - plan.chargeAt))
        : 1 - easeInOutSine((t - lastHeroLaunch) / LAUNCH_KICK_MS);
      let bx = away * c.heroCoilPx * px * lean, by = 0;
      for (const at of heroLaunches) {
        const age = t - at;
        if (age < 0 || age >= LAUNCH_KICK_MS) continue;
        const f = c.heroFlinchPx * px * (big ? 0.5 : 1) * spring(age, 6, 55) * (1 - age / LAUNCH_KICK_MS);
        bx += away * f; by += f * 0.35;
      }
      hero.set(Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px)`);
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let css: string | null = null;
      let sx = 1, sy = 1;
      let rock = 0;
      if (t >= plan.impactAt) {
        // The blow rolls on (a slower, longer spring for the enormous shell); the final flash pops the portrait again.
        let k = big ? spring(t - plan.impactAt, 3.2, 160) : spring(t - plan.impactAt, 4.5, 90);
        rock = c.rockDeg * (big ? 1 : 0.5) * spring(t - plan.impactAt, 2.6, big ? 200 : 120) * rockSign;
        if (plan.finalAt >= 0 && t >= plan.finalAt) {
          const age = t - plan.finalAt;
          k += 0.5 * spring(age, 4.5, 90);
          rock -= c.rockDeg * 0.45 * spring(age, 3.6, 110) * rockSign;
        }
        const knock = c.knockPx * (0.7 + 0.5 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        fx = dir.x * knock; fy = dir.y * knock;
        if (Math.abs(k) >= 0.004) {
          if (Math.abs(dir.y) > Math.abs(dir.x)) { sx = 1 + sq * 0.6; sy = 1 - sq; } else { sx = 1 - sq; sy = 1 + sq * 0.6; }
        }
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // The ticks: a flinch and a little twist away from each one.
        let k = 0;
        for (let i = 0; i < plan.hits.length; i++) {
          const at = plan.hits[i]!;
          if (at > t) continue;
          const sp = spring(t - at, 6, 50);
          k += Math.max(0, sp);
          rock += c.rockDeg * 0.35 * sp * (i % 2 ? rockSign : -rockSign);
        }
        fx = dir.x * k * 8 * px; fy = dir.y * k * 8 * px;
        const sq = 0.05 * Math.min(1, k);
        sx = 1 - sq * 0.5; sy = 1 - sq * 0.5;
      }
      const turn = Math.abs(rock) >= 0.02;
      if (Math.abs(fx) + Math.abs(fy) >= 0.05 || Math.abs(sx - 1) >= 0.0005 || turn) css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)${turn ? ` rotate(${rock.toFixed(2)}deg)` : ''}${Math.abs(sx - 1) >= 0.0005 ? ` scale(${sx.toFixed(4)}, ${sy.toFixed(4)})` : ''}`;
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
    variant,
    geo,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
