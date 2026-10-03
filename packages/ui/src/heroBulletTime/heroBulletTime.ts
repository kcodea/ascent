/**
 * THE TIMEBREAK RUNNER ("Timebreak", the Ancient of Time; ANCIENT): plays one Timebreak hero attack (the beats are
 * in `heroBulletTimeConfig.ts`) and lands the consequence on its impact beat (the hit, or IV's collapse). Presentation
 * only: the total and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * CUTTING THROUGH TIME (owner review 2026-10-02: "prefer slow motion vs stopped/grey time. like more cutting through time
 * than stopping it and dont grey out"; "looks weird not being centered"): gold clock-hand blades slice in, each leaving a
 * tear through the air, and as they reach the target time drops into DRAMATIC SLOW MOTION: they keep CRAWLING forward,
 * the FX run at `slowFx` speed, afterimages peel off, the clock over the target sweeps its hand, the camera pushes in.
 * Then time SNAPS back to full speed and everything lands. Every shape centres on the struck hero (its point is the
 * portrait's at-rest centre: `portraitGeometry` measures with `restingRect`). Full colour, never grey.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses; IV's collapse gets a slow-mo DIP
 * through the frame source, never a freeze), the damage formation, the `#stage` camera (applied ONCE), the portraits
 * (transform only, restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE CONTRACT: every hit before the last (III's run) is a tick (FX and sound only). The consequence (`onImpact`) lands
 * exactly ONCE, on the last hit (IV: the collapse).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` from the clock; no layout reads after the opening
 * measure; pooled sprites under a hard cap plus the darts and the clock as own objects; textures painted once per
 * session and pre-warmed during the formation; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices, type CueOpts } from '../heroAttack/attackSound';
import { KO_CYAN, KO_MAGENTA, playKoSting } from '../heroAttack/knockout';
import { playBellStrike } from '../sfx';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  bulletCameraAt, bulletCameraFocus, bulletCues, bulletPlan, bulletSlowExtraMs, bulletTimeScale, clockCentre, dartAt, dartGeos, getHeroBulletTimeConfig,
  stopTicks, inSlowMo, type BulletCue, type BulletPlan, type DartGeo, type HeroBulletTimeConfig,
} from './heroBulletTimeConfig';
import { HeroBulletTimeScene, type HeroBulletTimeTextures } from './heroBulletTimeScene';
import { heroBulletTimeTextures } from './heroBulletTimeTextures';

export interface HeroBulletTimeOptions extends HeroAttackOptions {
  cfg?: HeroBulletTimeConfig;
  textures?: HeroBulletTimeTextures | null;
}

export interface HeroBulletTimeHandle extends HeroAttackHandle {
  readonly plan: BulletPlan;
  readonly geos: readonly DartGeo[];
  readonly scene: HeroBulletTimeScene | null;
  readonly mirrorsCamera: boolean;
}

export function bulletSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6977 + Math.round(distance) * 43 + (side === 'opp' ? 251 : 29)) >>> 0;
}

/** Play Timebreak. Returns a handle; the blow lands via `onImpact` on the last hit. */
export function playHeroBulletTime(o: HeroBulletTimeOptions): HeroBulletTimeHandle {
  const c = o.cfg ?? getHeroBulletTimeConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = bulletPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, bulletCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hbullet',
  });

  const vw = typeof window === 'undefined' ? 1920 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 1080 : window.innerHeight;
  const screen = local
    ? { x: Math.min(o.attacker.x, o.defender.x) - dist * 0.3, y: Math.min(o.attacker.y, o.defender.y) - dist * 0.3, w: Math.abs(o.attacker.x - o.defender.x) + dist * 0.6, h: Math.abs(o.attacker.y - o.defender.y) + dist * 0.6 }
    : { x: 0, y: 0, w: vw, h: vh };
  const geos = dartGeos(plan, o.attacker, o.defender, radius, aRadius, c, screen);
  // Each dart's position on the clock (made once: a closure per dart, never per frame).
  const samplers = plan.darts.map((d, i) => (ms: number): Pt => dartAt(d, geos[i]!, ms).p);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  const flip = o.attacker.x > o.defender.x ? -1 : 1;
  // The clock CENTRES ON THE TARGET (owner 2026-10-02): a dial ringing the struck portrait, bigger each tier (IV's
  // ringing the whole dome).
  const clockAt = clockCentre(plan, o.attacker, o.defender);
  const clockR = c.clockSize * radius * (plan.kind === 'dome' ? 3.4 : plan.kind === 'spiral' ? 2.5 : 1.35);
  const gold = hexToNum(c.colorGold), light = hexToNum(c.colorLight), violet = hexToNum(c.colorViolet);
  // The dome's rings alternate gold and light gold; the Knockout's rings go prismatic (cyan, magenta) between them.
  const tintOf = (i: number): number => (plan.kind !== 'dome' ? gold : (plan.ko ? [gold, KO_CYAN, light, KO_MAGENTA] : [gold, light, gold])[plan.darts[i]!.ring % (plan.ko ? 4 : 3)]!);

  const textures = o.textures !== undefined ? o.textures : heroBulletTimeTextures();
  const scene = textures && !reduced
    ? new HeroBulletTimeScene(textures, { gold, light, violet, side: hexToNum(sideHex) }, {
      dartPx: c.dartPx, trailMs: c.trailMs, trailWidth: c.trailWidth, riftWidth: c.riftWidth, impactSize: c.impactSize,
    }, s, bulletSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const cue = (clip: string, gain: number, rate: number, opts?: CueOpts): void =>
    voices.cue(clip, gain, rate * (0.85 + 0.15 * bulletTimeScale(plan, c, seq ? seq.t : 0)), opts);
  voices.warm([
    c.sfxTickClip, c.sfxThrowClip, c.sfxFreezeClip, c.sfxStopClip, c.sfxSnapClip, c.sfxRestartClip, c.sfxHitClip, c.sfxThudClip,
    c.sfxBoomClip, c.sfxBellClip, c.sfxRumbleClip,
  ]);
  const n = plan.darts.length;
  // A big volley would be a wall of noise: one launch / freeze sound every few darts.
  const every = n > 12 ? 4 : n > 3 ? 3 : 1;
  let rippleNext = 0;
  // When each crawling blade last shed an afterimage (IV sheds less often: dozens of blades).
  const ghostEvery = c.ghostMs * (plan.kind === 'dome' ? 4 : 1);
  const lastGhost = plan.darts.map((_, i) => -i * 13);

  const fire = (q: BulletCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        cue(c.sfxTickClip, c.sfxTickGain, c.sfxTickRate, { lenMs: 400, fadeMs: 160 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'launch':
        if (q.i % every === 0) cue(c.sfxThrowClip, c.sfxThrowGain, c.sfxThrowRate + 0.03 * (q.i / every), { lenMs: 260, fadeMs: 100 });
        break;
      case 'cut': {
        // A blade drops into the slow motion: a glassy tink, and the TEAR it sliced through the air behind it.
        if (q.i % every === 0) cue(c.sfxFreezeClip, c.sfxFreezeGain, c.sfxFreezeRate + 0.04 * (q.i / every), { lenMs: 220, fadeMs: 90 });
        const d = plan.darts[q.i], g = geos[q.i];
        if (d && g) {
          // The tear runs back along its last stretch of flight, at most a few portrait radii long (a slash, not a laser).
          const back = dartAt(d, g, d.hangAt - Math.min(140, (d.hangAt - d.launchAt) * 0.6)).p;
          const bl = Math.hypot(back.x - g.hang.x, back.y - g.hang.y) || 1;
          const keep = Math.min(1, (radius * (plan.kind === 'dome' ? 2.2 : 3.2)) / bl);
          const from = { x: g.hang.x + (back.x - g.hang.x) * keep, y: g.hang.y + (back.y - g.hang.y) * keep };
          // The tear lingers through the slow motion (in the FX's own, slowed, time).
          const linger = Math.max(0, d.resumeAt - d.hangAt) * c.slowFx + 120;
          scene?.cut(from, g.hang, linger, plan.kind === 'dome' ? 0.7 : 1);
        }
        break;
      }
      case 'slow':
        // TIME SLOWS: a low reversed swell; a ripple sweeps the screen, motes drift; III's and IV's clock flashes in.
        cue(c.sfxStopClip, c.sfxStopGain, c.sfxStopRate, { lenMs: 700, fadeMs: 260, reverse: true });
        scene?.stop(o.defender, radius, screen, Math.round(c.motes), plan.kind === 'dome');
        if (plan.kind === 'spiral' || plan.kind === 'dome') scene?.clockFlash(clockAt, clockR);
        // The anticipation: a riser into the restart (III, IV).
        if (plan.kind === 'spiral' || plan.kind === 'dome') voices.riser(c.sfxStopClip, c.sfxStopGain * 0.9, c.sfxStopRate * 1.5, (plan.resumeAt - plan.stopAt) / speed);
        rippleNext = plan.stopAt + c.rippleMs;
        break;
      case 'count': {
        // IV: 3 ... 2 ... 1, each a heavier tick.
        const k = (3 - q.i) as 1 | 2 | 3;
        cue(c.sfxTickClip, c.sfxTickGain * 1.3, c.sfxTickRate * (0.85 + 0.12 * q.i), { lenMs: 300, fadeMs: 120 });
        cue(c.sfxFreezeClip, c.sfxFreezeGain * 0.8, c.sfxFreezeRate * (0.7 + 0.1 * q.i), { lenMs: 300, fadeMs: 120 });
        scene?.count(clockAt, k, radius * 0.95, c.countMs);
        break;
      }
      case 'tick':
        // The clock ticks through the slow motion, faster, higher and LOUDER toward the snap.
        cue(c.sfxTickClip, c.sfxTickGain * Math.min(1.6, 0.7 + 0.12 * q.i), c.sfxTickRate + 0.05 * q.i, { lenMs: 160, fadeMs: 70 });
        break;
      case 'snap':
        // TIME SNAPS BACK TO FULL SPEED: the hero snaps its fingers, a rising whoosh, a flash, a chromatic burst.
        cue(c.sfxSnapClip, c.sfxSnapGain, c.sfxSnapRate, { lenMs: 500, fadeMs: 200 });
        cue(c.sfxRestartClip, c.sfxRestartGain, c.sfxRestartRate, { lenMs: 420, fadeMs: 160 });
        // A bell tone for the time snap (a bright fifth; IV lower and fuller).
        if (sound) {
          const lo = plan.kind === 'dome' ? 0.75 : 1;
          voices.keep(playBellStrike('attack', { gain: 0.45, hz: 1047 * lo, decayMs: 600 / speed }));
          voices.keep(playBellStrike('attack', { gain: 0.35, hz: 1568 * lo, decayMs: 700 / speed, delayMs: 50 / speed }));
        }
        scene?.snap(o.defender, radius, screen, plan.kind === 'dome' ? 1.6 : 1);
        break;
      case 'hit':
        cue(c.sfxHitClip, c.sfxHitGain * 0.75, c.sfxHitRate + 0.03 * q.i, { lenMs: 300, fadeMs: 120 });
        if (geos[0]) scene?.hit(o.defender, toFoe, 0.8, 6);
        break;
      case 'impact':
        if (plan.tier >= 4) {
          cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate - 0.08, { tail: c.sfxTailMix, lenMs: 1800, fadeMs: 600 });
          cue(c.sfxBellClip, c.sfxBellGain, c.sfxBellRate, { tail: c.sfxTailMix * 1.5, lenMs: 2200, fadeMs: 900 });
          // The great time bell under the collapse.
          if (sound) voices.keep(playBellStrike('attack', { gain: 0.6, hz: 196, decayMs: 2200 / speed }));
          cue(c.sfxRumbleClip, c.sfxRumbleGain, c.sfxRumbleRate, { lenMs: 1400, fadeMs: 500 });
          cue(c.sfxThudClip, c.sfxThudGain * 1.2, c.sfxThudRate - 0.25, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxFreezeClip, c.sfxFreezeGain * 1.4, c.sfxFreezeRate * 0.55, { lenMs: 900, fadeMs: 300 });
        } else {
          cue(c.sfxHitClip, c.sfxHitGain * 1.15, c.sfxHitRate - 0.08 * plan.tier, { tail: c.sfxTailMix, lenMs: 600, fadeMs: 220 });
          cue(c.sfxThudClip, c.sfxThudGain * (0.9 + 0.1 * plan.tier), c.sfxThudRate - 0.08 * plan.tier, { lenMs: 600, fadeMs: 220 });
          if (plan.tier >= 2) cue(c.sfxBoomClip, c.sfxBoomGain * (0.4 + 0.2 * plan.tier), c.sfxBoomRate + 0.3 - 0.1 * plan.tier, { tail: c.sfxTailMix, lenMs: 1200, fadeMs: 400 });
          if (plan.tier >= 3) cue(c.sfxBellClip, c.sfxBellGain * 0.5, c.sfxBellRate * 1.4, { tail: c.sfxTailMix, lenMs: 1200, fadeMs: 500 });
        }
        scene?.impact(o.defender, toFoe, radius, plan.tier, screen);
        // THE KNOCKOUT: the prismatic collapse and the sting.
        if (plan.ko) { scene?.koFlourish(o.defender, radius); playKoSting(voices, sound, (ms) => ms / speed); }
        seq.land();
        break;
      default:
        break;
    }
  };

  // ── the per-frame paint ──
  const ticks = stopTicks(plan);
  const tickStep = (Math.PI * 2) / 60 * 5; // each tick moves the minute hand five minutes, with a little kick

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.tier >= 4 ? 420 : 200));
    const cm = bulletCameraAt(plan, c, t, toFoe);
    const unit = local ? 1 : s;
    cam.apply(bulletCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const slow = inSlowMo(plan, t);
    if (scene) {
      // THE SLOW MOTION: every FX runs at `slowFx` speed (sparks, motes, ripples, glints, tears), easing in over 80 ms
      // and snapping straight back to full speed on the snap.
      scene.setTimeScale(slow ? 1 - (1 - c.slowFx) * clamp01((t - plan.stopAt) / 80) : 1);
      // The last ~300 ms before the snap the crawling blades strain (the anticipation).
      const tension = slow ? clamp01((t - (plan.resumeAt - 320)) / 320) : 0;
      // Every blade, from its own pure path (crawling through the slow motion, never stopped).
      for (let i = 0; i < n; i++) {
        const d = plan.darts[i]!, g = geos[i]!;
        const st = dartAt(d, g, t);
        scene.setDart(i, samplers[i]!, t, st.phase, st.angle, plan.size * (plan.kind === 'dome' ? 1 + 0.12 * d.ring : 1), tintOf(i), tension);
        // Afterimages peel off a crawling blade.
        if (st.phase === 'crawl' && t - lastGhost[i]! >= ghostEvery) { lastGhost[i] = t; scene.ghost(i); }
      }
      // The clock over the target, ticking (each tick kicks the hand a notch, with a little overshoot).
      let minute = 0;
      for (const at of ticks) if (t >= at) minute += tickStep * (1 + 0.25 * Math.max(0, spring(t - at, 8, 40)));
      const inU = clamp01((t - plan.stopAt) / 160), outA = t < plan.resumeAt ? 1 : 1 - clamp01((t - plan.resumeAt) / 90);
      // It MATERIALISES: settling in from a little bigger as it fades up; the hand spins hard in the last beat.
      if (tension > 0) minute += tension * tension * Math.PI * 4;
      scene.setClock(clockAt, clockR * (1 + 0.25 * (1 - inU) * (1 - inU)), minute, t >= plan.stopAt && t < plan.resumeAt + 90 ? inU * outA : 0);
      // The gold time ripple pulses off the target through the slow motion.
      if (slow && rippleNext > 0 && t >= rippleNext) { scene.ripple(o.defender, radius); rippleNext += c.rippleMs; }
    }
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The draw (a lean back), the throw (a snap forward), and on the restart the hero's own SNAP (a pop).
      let bx = 0, by = 0, rot = 0, sc = 1;
      const lean = t < plan.fireAt ? easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt)) : Math.max(0, spring(t - plan.fireAt, 3, 90));
      bx -= toFoe.x * c.heroWindPx * px * lean; by -= toFoe.y * c.heroWindPx * px * lean;
      rot -= 3 * flip * lean;
      if (t >= plan.fireAt) { const f = c.heroThrowPx * px * Math.max(0, spring(t - plan.fireAt, 5, 60)); bx += toFoe.x * f; by += toFoe.y * f; }
      if (t >= plan.resumeAt) sc += 0.08 * Math.max(0, spring(t - plan.resumeAt, 4, 70));
      const still = Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(rot) < 0.01 && Math.abs(sc - 1) < 1e-4;
      hero.set(still ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    let css: string | null = null;
    if (t >= plan.impactAt) {
      const k = spring(t - plan.impactAt, 4.5, 90);
      const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
      const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
      fx = toFoe.x * knock; fy = toFoe.y * knock;
      css = Math.abs(k) < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
    } else {
      let k = 0;
      for (const at of plan.hits) if (t >= at) k += Math.max(0, spring(t - at, 6, 40)) * 8 * px;
      fx = toFoe.x * k; fy = toFoe.y * k;
      css = Math.abs(fx) + Math.abs(fy) < 0.05 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
    }
    foe.set(css);
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<BulletCue | FormationCue> = new Sequence<BulletCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    // IV's slow-mo dip on the collapse: the frame source hands the ONE clock a scaled step (a smooth ramp, never 0).
    frames: (fn: (dt: number) => void) => (o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)))((dt) => fn(dt * (seq && !seq.done ? bulletTimeScale(plan, c, seq.t) : 1))),
    safetyMs: o.safety !== false ? (plan.endAt + bulletSlowExtraMs(plan, c)) / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      scene?.setClock(o.defender, 0, 0, 0);
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geos,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
