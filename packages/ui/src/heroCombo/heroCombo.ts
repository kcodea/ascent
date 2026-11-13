/**
 * THE COMBO RUNNER ("Flawless", a Legendary): plays one Combo attack (the beats are in `heroComboConfig.ts`) and lands
 * the consequence on its impact beat (the jab, the low kick, the slam, the heavy blow). Presentation only: the total and
 * the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * THE COUNTER COUNTS REAL HITS (one hit, one count; the scene composes it from painted digits). The damage is the game's
 * own number (the shared damage formation and the hit number), never the counter's.
 *
 * SOUND: every hit is two or three layers (a low body punch, a snap on top re-pitched by the kind of hit, and a heavy
 * thump on the launcher, the spike and every finisher); the super freeze has a charge that climbs through the cut-in;
 * the flurry is a rattle that rises; the heavy blow's wind-up is a riser that peaks ON the impact; K.O. is the sting
 * over a deep boom.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses: the hit-freeze and the super
 * freeze are held poses), the damage formation, the `#stage` camera (applied ONCE: `stageCamera.ts`), the voices, the dim,
 * reduced motion, finish / cancel and the safety timer.
 *
 * BOTH PORTRAITS MOVE: the striker steps in beside the target and throws the combo; the target flinches, is launched,
 * juggled, spiked or sent flying. Each pose is solved in screen px (kept on screen by the pure pose functions) and
 * written as a transform in the portrait's own units (its ancestors' scale measured ONCE at the start). A portrait
 * outside the `#stage` camera (the foe's <body> portal) folds the camera's zoom and shake into its own transform. The
 * striker is raised over the target for the whole attack (Classic's `.duel-attacker-*` z-order). EVERY exit path (the
 * end, `finish()`, `cancel()`, the safety timer, and an unmount, which cancels) restores both transforms, the striker's
 * opacity and the z-order class exactly, and hides the counter and the cut-in.
 *
 * Perf: DOM writes are `transform` from the clock; layout is read once at the start; pooled sprites under a hard cap
 * plus the HUD's own handful; textures painted once per session (the portrait panel once per image) and pre-warmed
 * during the formation; the counter swaps textures only when its number changes; the updater unhooks the moment the
 * scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { hexToNum, prefersReducedMotion, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  airHitsOf, comboCameraAt, comboCounter, comboCues, comboCutin, comboGeo, comboPlan, counterSize, getHeroComboConfig, hitPoint, strikerPose, targetPose,
  type ComboCue, type ComboGeo, type ComboPlan, type ComboPose, type CounterState, type HeroComboConfig,
} from './heroComboConfig';
import { HeroComboScene, type HeroComboTextures } from './heroComboScene';
import { comboCutinTexture, heroComboTextures } from './heroComboTextures';

export interface HeroComboOptions extends HeroAttackOptions {
  cfg?: HeroComboConfig;
  textures?: HeroComboTextures | null;
}

export interface HeroComboHandle extends HeroAttackHandle {
  readonly plan: ComboPlan;
  readonly geo: ComboGeo;
  readonly scene: HeroComboScene | null;
  readonly mirrorsCamera: boolean;
  /** The striker's and the target's poses and the counter, at a sequence time (pure). */
  striker(t: number): ComboPose;
  target(t: number): ComboPose;
  counter(t: number): CounterState;
}

export function comboSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 2711 + Math.round(distance) * 41 + (side === 'opp' ? 197 : 23)) >>> 0;
}

/** One measure of a portrait: its screen size, and `inv` = its own transform px per screen px. */
function rectOf(el: HTMLElement | null | undefined, r: number): { width: number; height: number; inv: number } {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { width: r * 2, height: r * 2, inv: 1 };
    return { width: b.width, height: b.height, inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  } catch { return { width: r * 2, height: r * 2, inv: 1 }; }
}

/** A portrait pose as a CSS transform in its own units (`unit` = screen px per own px), or null when at rest. */
function poseCss(off: Pt, p: ComboPose, sc: number, unit: number): string | null {
  const moved = Math.abs(off.x) > 0.05 || Math.abs(off.y) > 0.05 || Math.abs(sc - 1) > 1e-4 || Math.abs(p.rot) > 0.01;
  const sq = Math.abs(p.squash) > 0.002 ? ` scale(${(1 + p.squash * 0.6).toFixed(4)}, ${(1 - p.squash).toFixed(4)})` : '';
  if (!moved && !sq) return null;
  return `translate(${(off.x / unit).toFixed(2)}px, ${(off.y / unit).toFixed(2)}px) rotate(${p.rot.toFixed(2)}deg) scale(${sc.toFixed(4)})${sq}`;
}

/** How each kind of hit is pitched (one clip, varied across the string). */
const HIT_RATE = { jab: 1.12, cross: 1, kick: 0.86, upper: 0.8, air: 1.04, spike: 0.74, flurry: 1.1, heavy: 0.7 } as const;
/** The low body layer under each kind of hit: [gain, pitch]. The heavier the hit, the lower and louder. */
const BODY = { jab: [0.7, 1.15], cross: [0.85, 1], kick: [1, 0.85], upper: [1.1, 0.78], air: [0.75, 1.05], spike: [1.15, 0.7], flurry: [0.5, 1.2], heavy: [1.25, 0.62] } as const;

/** Play the Combo attack. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroCombo(o: HeroComboOptions): HeroComboHandle {
  const c = o.cfg ?? getHeroComboConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const aRect = local ? { inv: 1 } : rectOf(o.attackerEl, aRadius);
  const dRect = local ? { inv: 1 } : rectOf(o.defenderEl, radius);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const seed = o.rollSeed ?? comboSeed(o.total, dist, o.side);
  // `o.total` picks the tier (and, on the smallest blows, how many taps the jab is).
  const plan = comboPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt, airHits: airHitsOf(seed, c) }, c);
  const cues = withFormation(fplan, comboCues(plan, c));
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const frame = { x0: 0, y0: 0, x1: vw, y1: vh };
  const geo = comboGeo(o.attacker, o.defender, aRadius, radius, frame, c, { side: o.side, hits: plan.hits.length, kind: plan.kind });
  const striker = (t: number): ComboPose => strikerPose(plan, geo, c, aRadius, o.attacker, t);
  const target = (t: number): ComboPose => targetPose(plan, geo, c, radius, o.defender, t);
  const counter = (t: number): CounterState => comboCounter(plan, c, t);

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hcombo',
  });

  const textures = o.textures !== undefined ? o.textures : heroComboTextures();
  let scene: HeroComboScene | null = null;
  if (textures && !reduced) {
    const cs = counterSize(plan.hits.length, radius, c);
    // IV only: the striking hero's own portrait art for the cut-in (painted once per image; null = the band alone).
    const img = plan.kind === 'super' ? (o.attackerEl?.querySelector?.('img') ?? null) : null;
    scene = new HeroComboScene(textures, {
      spark: hexToNum(c.colorSpark), heavy: hexToNum(c.colorHeavy), flash: hexToNum(c.colorFlash), dust: hexToNum(c.colorDust), side: hexToNum(sideHex),
    }, { sparkSize: c.sparkSize, face: geo.face, counter: geo.counter, digit: cs.digit, digits: cs.digits, band: geo.band, frameW: vw, frameH: vh },
    aRadius, radius, s, seed, comboCutinTexture(img));
  }
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const heroOpacity0 = hero.el ? hero.el.style.opacity : '';
  const heroUnit = 1 / (aRect.inv || 1);
  const foeUnit = 1 / (dRect.inv || 1);
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));
  const zClass = o.side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player';
  const lift = !reduced && !local && !!hero.el && !!doc;
  let lifted = false;

  const cue: AttackVoices['cue'] = (clip, gain, rate, opts) => voices.cue(clip, gain, rate, opts);
  voices.warm([c.sfxStepClip, c.sfxHitClip, c.sfxHeavyClip, c.sfxSuperClip, c.sfxKoClip, c.sfxPunchClip, c.sfxChargeClip, c.sfxBoomClip]);
  const heroAt = (t: number): Pt => { const p = striker(t); return { x: o.attacker.x + p.x, y: o.attacker.y + p.y }; };
  const last = plan.hits.length - 1;

  const fire = (q: ComboCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      case 'step':
        // The step in: a quick whoosh and dust kicked up behind it.
        cue(c.sfxStepClip, c.sfxStepGain, c.sfxStepRate, { lenMs: 380, fadeMs: 160 });
        scene?.stepDust(o.attacker, geo.stance.x >= o.attacker.x ? 1 : -1);
        break;
      case 'hit': {
        // ONE HIT OF THE COMBO (a tick unless it is the impact): its spark at its own height; a low body punch and a
        // snap on top, both re-pitched by the kind of hit.
        const h = plan.hits[q.i]!;
        const at = hitPoint(plan, geo, c, radius, o.defender, h);
        const body = BODY[h.kind];
        if (h.kind === 'heavy') {
          // THE HEAVY BLOW: everything at once, low. (Its look is the impact's.)
          cue(c.sfxHeavyClip, c.sfxHeavyGain, c.sfxHeavyRate * 0.9, { tail: 0.15 });
          cue(c.sfxPunchClip, c.sfxPunchGain * body[0], c.sfxPunchRate * body[1], { tail: 0.1 });
          cue(c.sfxHitClip, c.sfxHitGain, c.sfxHitRate * HIT_RATE.heavy);
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.75, c.sfxBoomRate * 1.15, { lenMs: 900, fadeMs: 400 });
          break;
        }
        const flurry = h.kind === 'flurry';
        const n = plan.hits.length;
        const isLast = q.i === last;
        if (flurry) {
          // THE RATTLE: it climbs in pitch and in level all the way through, a body punch under every other hit.
          const u = plan.flurryEnd !== null && plan.cutinEnd !== null ? (h.at - plan.cutinEnd) / Math.max(1, plan.flurryEnd - plan.cutinEnd) : q.i / n;
          cue(c.sfxHitClip, c.sfxHitGain * (0.55 + 0.4 * u), c.sfxHitRate * (0.9 + 0.6 * u), { lenMs: 170, fadeMs: 70 });
          if (q.i % 2 === 0) cue(c.sfxPunchClip, c.sfxPunchGain * body[0] * (0.7 + 0.5 * u), c.sfxPunchRate * (1 + 0.45 * u), { lenMs: 200, fadeMs: 90 });
        } else {
          const lift = h.kind === 'air' ? 1 + 0.05 * (q.i % 4) : 1;
          cue(c.sfxPunchClip, c.sfxPunchGain * body[0] * (0.8 + 0.3 * h.power), c.sfxPunchRate * body[1] * lift);
          cue(c.sfxHitClip, c.sfxHitGain * (0.7 + 0.3 * h.power), c.sfxHitRate * HIT_RATE[h.kind] * lift);
        }
        scene?.hitSpark(at, h.kind, h.power);
        if (isLast && plan.kind === 'jab') scene?.drive(at);
        if (h.kind === 'upper') {
          // THE LAUNCHER: a heavy thump under it and the whoosh of the launch.
          cue(c.sfxHeavyClip, c.sfxHeavyGain * 0.75, c.sfxHeavyRate * 1.15, { lenMs: 420, fadeMs: 160 });
          cue(c.sfxStepClip, c.sfxStepGain * 1.1, c.sfxStepRate * 0.8, { lenMs: 420, fadeMs: 180 });
          { const f = target(t); scene?.launch({ x: o.defender.x + f.x, y: o.defender.y + f.y }); }
        }
        if (h.kind === 'spike') {
          cue(c.sfxHeavyClip, c.sfxHeavyGain * 0.8, c.sfxHeavyRate * 1.05, { lenMs: 420, fadeMs: 160 });
          cue(c.sfxStepClip, c.sfxStepGain, c.sfxStepRate * 1.1, { lenMs: 260, fadeMs: 100 });
        }
        if (isLast && plan.kind !== 'launcher') scene?.finisher(at, plan.burst, plan.rings);
        break;
      }
      case 'jump':
        cue(c.sfxStepClip, c.sfxStepGain * 0.8, c.sfxStepRate * 1.15, { lenMs: 300, fadeMs: 120 });
        scene?.stepDust(geo.stance, geo.face);
        break;
      case 'super':
        // THE SUPER FREEZE: the activation flash and whoosh, and a charge that climbs through the whole cut-in and
        // peaks as the band leaves (the flurry's first hit). The cut-in slides across (the HUD paints it).
        cue(c.sfxSuperClip, c.sfxSuperGain, c.sfxSuperRate);
        if (plan.cutinEnd !== null) voices.riser(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate, (plan.cutinEnd - t) / speed);
        scene?.superFlash(heroAt(t));
        break;
      case 'glyph':
        // An input lights: a tick, climbing.
        cue(c.sfxHitClip, c.sfxHitGain * 0.5, c.sfxHitRate * (1.5 + 0.14 * q.i), { lenMs: 90, fadeMs: 40 });
        break;
      case 'flurry':
        cue(c.sfxStepClip, c.sfxStepGain, c.sfxStepRate * 1.3, { lenMs: 300, fadeMs: 120 });
        break;
      case 'wind':
        // THE WIND-UP: the striker rears back and gathers; a low whoosh and a riser that peaks ON the impact.
        cue(c.sfxStepClip, c.sfxStepGain * 1.2, c.sfxStepRate * 0.62, { lenMs: 620, fadeMs: 260 });
        voices.riser(c.sfxChargeClip, c.sfxChargeGain * 1.1, c.sfxChargeRate * 0.8, (plan.impactAt - t) / speed);
        scene?.gather(heroAt(plan.impactAt - 120), plan.impactAt - t);
        break;
      case 'impact': {
        // THE BLOW LANDS (once).
        const d = { x: o.defender.x, y: o.defender.y };
        if (plan.kind === 'super') {
          scene?.heavy(hitPoint(plan, geo, c, radius, o.defender, plan.hits[last]!), plan.burst, plan.rings);
          scene?.screenFlash(c.flashAlpha);
        } else if (plan.kind === 'launcher') {
          // THE SLAM: the heavy thump, a low body punch and a short boom under them.
          cue(c.sfxHeavyClip, c.sfxHeavyGain, c.sfxHeavyRate * 1.0, { tail: 0.1 });
          cue(c.sfxPunchClip, c.sfxPunchGain * 1.1, c.sfxPunchRate * 0.7);
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.55, c.sfxBoomRate * 1.3, { lenMs: 700, fadeMs: 350 });
          scene?.slam(d, plan.burst, plan.rings);
          scene?.screenFlash(c.flashAlpha * 0.6, 150);
          scene?.aftermath(d, 0.7);
        } else cue(c.sfxHeavyClip, c.sfxHeavyGain * (plan.kind === 'string' ? 0.7 : 0.5), c.sfxHeavyRate * (plan.kind === 'string' ? 1.2 : 1.35), { lenMs: 420, fadeMs: 160 });
        seq.land();
        break;
      }
      case 'land': {
        // IV: the blasted target comes down (and bounces once): a thud and dust each time, smaller the second.
        const k = q.i === 0 ? 1 : 0.55;
        cue(c.sfxPunchClip, c.sfxPunchGain * 0.8 * k, c.sfxPunchRate * (q.i === 0 ? 0.6 : 0.72));
        scene?.aftermath({ x: o.defender.x + geo.launch.x, y: o.defender.y + geo.launch.y }, k);
        break;
      }
      case 'ko':
        // "K.O." slams in: the sting (an impact and a gong, no voice) over a deep boom.
        cue(c.sfxKoClip, c.sfxKoGain, c.sfxKoRate, { tail: 0.2 });
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate);
        scene?.ko(geo.ko, geo.koW, c.koHoldMs);
        scene?.screenFlash(c.flashAlpha * 0.4, 140);
        break;
      default:
        break;
    }
  };

  let lastLine = -Infinity;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.stepEnd, plan.impactAt + (plan.kind === 'super' ? 1100 : 300));
    const cm = comboCameraAt(plan, c, t, geo.face);
    const unitS = local ? 1 : s;
    const focus = o.defender;
    cam.apply(focus, cm.zoom, cm.x, cm.y, unitS);
    // The camera's screen offset: a portrait OUTSIDE `#stage` folds it in by hand (so it stays glued to the scene).
    const ax = focus.x * (1 - cm.zoom) + cm.x * unitS, ay = focus.y * (1 - cm.zoom) + cm.y * unitS;
    const place = (at: Pt, off: Pt, inCam: boolean): Pt => (inCam || !cam.active
      ? off
      : { x: off.x * cm.zoom + at.x * (cm.zoom - 1) + ax, y: off.y * cm.zoom + at.y * (cm.zoom - 1) + ay });
    if (hero.el) {
      const p = striker(t);
      hero.set(poseCss(place(o.attacker, p, heroInCam), p, p.scale * (heroInCam || !cam.active ? 1 : cm.zoom), heroUnit));
    }
    if (foe.el) {
      const p = target(t);
      foe.set(poseCss(place(o.defender, p, foeInCam), p, p.scale * (foeInCam || !cam.active ? 1 : cm.zoom), foeUnit));
    }
    if (scene) {
      scene.setCounter(counter(t));
      const cut = comboCutin(plan, c, t);
      scene.setCutin(cut);
      // The band's speed lines, while it is across the screen.
      if (cut && cut.slide === 0 && t - lastLine >= 26) { scene.bandLine(); scene.bandLine(); lastLine = t; }
    }
  };

  const seq: Sequence<ComboCue | FormationCue> = new Sequence<ComboCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      if (hero.el) hero.el.style.opacity = heroOpacity0;
      scene?.hideOwn();
      if (lifted) { doc!.body.classList.remove(zClass); lifted = false; }
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    scene,
    striker,
    target,
    counter,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
