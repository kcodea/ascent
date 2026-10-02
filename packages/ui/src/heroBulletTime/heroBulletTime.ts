/**
 * THE BULLET TIME RUNNER ("Bullet Time", the Ancient of Time; ANCIENT): plays one Bullet Time hero attack (the beats are
 * in `heroBulletTimeConfig.ts`) and lands the consequence on its impact beat (the hit, or IV's collapse). Presentation
 * only: the total and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * THE SIGNATURE: STOPPED TIME. The darts fly and STOP DEAD in the air round the target; time is stopped; then it
 * restarts with a hard snap and they land. Only the PROJECTILES stop: the screen stays alive the whole time (owner rule
 * R-PROG-ATTACK-10, "it looks like lag"): the clock over the target ticks (faster and faster toward the restart), the hung
 * darts tremble and glint, a gold time ripple pulses, dust motes drift, the camera keeps pushing in. While time is stopped
 * everything but the shots DESATURATES (a one-shot CSS filter transition on the board, the portraits and the background,
 * set once and snapped back off; never animated per frame).
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses; IV's collapse gets a slow-mo DIP
 * through the frame source, never a freeze), the damage formation, the `#stage` camera (applied ONCE), the portraits
 * (transform only, restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE CONTRACT: every hit before the last (III's run) is a tick (FX and sound only). The consequence (`onImpact`) lands
 * exactly ONCE, on the last hit (IV: the collapse).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` from the clock; the desaturation is a filter SET twice
 * (a one-shot transition in, an instant snap out) on a handful of elements found once at the start; no layout reads after
 * the opening measure; pooled sprites under a hard cap plus the darts and the clock as own objects; textures painted once
 * per session and pre-warmed during the formation; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices, type CueOpts } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  bulletCameraAt, bulletCameraFocus, bulletCues, bulletPlan, bulletSlowExtraMs, bulletTimeScale, clockCentre, dartAt, dartGeos, getHeroBulletTimeConfig,
  stopTicks, timeStopped, type BulletCue, type BulletPlan, type DartGeo, type HeroBulletTimeConfig,
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

/** One element's filter, saved and restored exactly (the stopped-time desaturation). */
class FilterMover {
  private readonly prevFilter: string;
  private readonly prevTransition: string;
  constructor(readonly el: HTMLElement) { this.prevFilter = el.style.filter; this.prevTransition = el.style.transition; }
  /** A one-shot transition into the grey (set once; the browser runs it). */
  fadeTo(filter: string, ms: number): void {
    const base = this.prevTransition ? `${this.prevTransition}, ` : '';
    this.el.style.transition = `${base}filter ${Math.max(0, Math.round(ms))}ms ease-out`;
    this.el.style.filter = filter;
  }
  /** A hard snap back (no transition). */
  reset(): void { this.el.style.transition = this.prevTransition; this.el.style.filter = this.prevFilter; }
}

/** Play Bullet Time. Returns a handle; the blow lands via `onImpact` on the last hit. */
export function playHeroBulletTime(o: HeroBulletTimeOptions): HeroBulletTimeHandle {
  const c = o.cfg ?? getHeroBulletTimeConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = bulletPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
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
  const area = { x: o.defender.x - radius * 3.5, y: o.defender.y - radius * 3, w: radius * 7, h: radius * 6 };
  // The clock: over the target on I-II; III's and IV's GIANT face out over the board behind the shots.
  const clockAt = clockCentre(plan, o.attacker, o.defender, radius, screen);
  const giant = Math.min(screen.w, screen.h);
  const clockR = c.clockSize * (plan.kind === 'dome' ? giant * 0.4 : plan.kind === 'spiral' ? giant * 0.3 : radius * 1.5);
  const gold = hexToNum(c.colorGold), light = hexToNum(c.colorLight), violet = hexToNum(c.colorViolet);
  const tintOf = (i: number): number => (plan.kind === 'dome' ? [gold, light, gold][plan.darts[i]!.ring % 3]! : gold);

  const textures = o.textures !== undefined ? o.textures : heroBulletTimeTextures();
  const scene = textures && !reduced
    ? new HeroBulletTimeScene(textures, { gold, light, violet, side: hexToNum(sideHex) }, {
      dartPx: c.dartPx, trailMs: c.trailMs, trailWidth: c.trailWidth, tremblePx: c.tremblePx, turn: c.turn, impactSize: c.impactSize,
    }, s, bulletSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  // STOPPED TIME's grey: the boards, the background and both portraits (found ONCE; the shots live on the Pixi canvas,
  // which is never filtered, so they keep their colour).
  const greys: FilterMover[] = (() => {
    if (reduced || local || !doc || c.desat <= 0) return [];
    const els = new Set<HTMLElement>(doc.querySelectorAll<HTMLElement>('[data-zone="warband"], [data-zone="tavern"], .boardbg'));
    if (o.attackerEl) els.add(o.attackerEl);
    if (o.defenderEl) els.add(o.defenderEl);
    return [...els].map((el) => new FilterMover(el));
  })();
  let grey = false;
  const greyOn = (): void => { if (grey) return; grey = true; for (const g of greys) g.fadeTo(`grayscale(${c.desat.toFixed(2)}) brightness(0.88)`, c.desatInMs / speed); };
  const greyOff = (): void => { if (!grey) return; grey = false; for (const g of greys) g.reset(); };

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
      case 'freeze': {
        // A dart STOPS DEAD: a glassy tink (pitched up through a volley).
        if (q.i % every === 0) cue(c.sfxFreezeClip, c.sfxFreezeGain, c.sfxFreezeRate + 0.04 * (q.i / every), { lenMs: 220, fadeMs: 90 });
        const g = geos[q.i];
        if (g && plan.kind !== 'dome') scene?.freeze(g.hang, 1);
        else if (g && q.i % 3 === 0) scene?.freeze(g.hang, 0.7);
        break;
      }
      case 'stop':
        // TIME STOPS: a low reversed swell; everything but the shots goes grey; a ripple, motes; III's clock flashes.
        cue(c.sfxStopClip, c.sfxStopGain, c.sfxStopRate, { lenMs: 700, fadeMs: 260, reverse: true });
        greyOn();
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
        scene?.count(clockAt, k, clockR * 0.55, c.countMs);
        break;
      }
      case 'tick':
        // The clock ticks while time is stopped, faster and higher toward the restart.
        // ...and LOUDER.
        cue(c.sfxTickClip, c.sfxTickGain * Math.min(1.6, 0.7 + 0.12 * q.i), c.sfxTickRate + 0.05 * q.i, { lenMs: 160, fadeMs: 70 });
        break;
      case 'snap':
        // TIME RESTARTS, HARD: the hero snaps its fingers, a rising whoosh, a flash, a shock ring; colour snaps back.
        cue(c.sfxSnapClip, c.sfxSnapGain, c.sfxSnapRate, { lenMs: 200, fadeMs: 80 });
        cue(c.sfxRestartClip, c.sfxRestartGain, c.sfxRestartRate, { lenMs: 420, fadeMs: 160 });
        greyOff();
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
    const stopped = timeStopped(plan, t);
    if (scene) {
      // The last ~300 ms before the restart the hung shots strain (the anticipation).
      const tension = stopped ? clamp01((t - (plan.resumeAt - 320)) / 320) : 0;
      // Every dart, from its own pure path; while it hangs, its motion time is the instant it stopped.
      for (let i = 0; i < n; i++) {
        const d = plan.darts[i]!, g = geos[i]!;
        const st = dartAt(d, g, t);
        const te = st.phase === 'hang' ? d.hangAt - 0.01 : t;
        scene.setDart(i, samplers[i]!, te, st.phase, st.angle, plan.size * (plan.kind === 'dome' ? 1 + 0.12 * d.ring : 1), tintOf(i), tension);
      }
      // The clock over the target, ticking (each tick kicks the hand a notch, with a little overshoot).
      let minute = 0;
      for (const at of ticks) if (t >= at) minute += tickStep * (1 + 0.25 * Math.max(0, spring(t - at, 8, 40)));
      const inU = clamp01((t - plan.stopAt) / 160), outA = t < plan.resumeAt ? 1 : 1 - clamp01((t - plan.resumeAt) / 90);
      // It MATERIALISES: settling in from a little bigger as it fades up; the hand spins hard in the last beat.
      if (tension > 0) minute += tension * tension * Math.PI * 4;
      scene.setClock(clockAt, clockR * (1 + 0.25 * (1 - inU) * (1 - inU)), minute, t >= plan.stopAt && t < plan.resumeAt + 90 ? inU * outA : 0);
      // The gold time ripple pulses off the target while time is stopped.
      if (stopped && rippleNext > 0 && t >= rippleNext) { scene.ripple(o.defender, radius); rippleNext += c.rippleMs; }
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
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck(); greyOff();
      for (const g of greys) g.reset();
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
