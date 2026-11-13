/**
 * THE WARHOST RUNNER ("Warhost", the Ancient of War; ANCIENT): plays one Warhost hero attack (the beats and the
 * staging are in `heroWarhostConfig.ts`) and lands the consequence on its impact beat. Presentation only: the total
 * and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * AN ARMY OF TINY SOLDIERS delivers the blow: I one spearman and his thrown spear; II a rank of archers and an arrow
 * rain; III a wedge of cavalry riding through the struck portrait; IV three war drums, a horn, banners, and the whole
 * host flooding over it, leaving one soldier to plant a banner on it. The host always comes from the striker's side
 * (every path is built from the two portrait points), and its jitter is rolled from the blow's seed.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses; only the Knockout variant dips
 * it, through the frame source, never a freeze), the damage formation, the `#stage` camera (applied ONCE), the
 * portraits (transform only, restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE CONTRACT: every arrow before the last (II) is a tick (FX and sound only); every row or rank after the first (III,
 * IV) is a buffet (FX only). The consequence (`onImpact`) lands exactly ONCE: the spear, the last arrow, the point
 * rider, the front rank.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` from the clock; no layout reads after the opening
 * measure; every soldier's sprite is taken up front (during the formation), placed from the clock with no allocation;
 * one texture atlas, painted once per session and pre-warmed; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices, type CueOpts } from '../heroAttack/attackSound';
import { playKoSting } from '../heroAttack/knockout';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  getHeroWarhostConfig, warhostCameraAt, warhostCameraFocus, warhostCues, warhostPlan, warhostRumble, warhostScale, warhostSlowExtraMs, warhostStage,
  type HeroWarhostConfig, type WarhostCue, type WarhostPlan, type WarhostStage,
} from './heroWarhostConfig';
import { HeroWarhostScene, type HeroWarhostTextures } from './heroWarhostScene';
import { heroWarhostTextures } from './heroWarhostTextures';

export interface HeroWarhostOptions extends HeroAttackOptions {
  cfg?: HeroWarhostConfig;
  textures?: HeroWarhostTextures | null;
}

export interface HeroWarhostHandle extends HeroAttackHandle {
  readonly plan: WarhostPlan;
  readonly stage: WarhostStage;
  readonly scene: HeroWarhostScene | null;
  readonly mirrorsCamera: boolean;
}

/** The formation jitter's seed when the caller gives none: the same blow always fields the same host. */
export function warhostSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 31 + (side === 'opp' ? 613 : 17)) >>> 0;
}

/** Play the Warhost. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroWarhost(o: HeroWarhostOptions): HeroWarhostHandle {
  const c = o.cfg ?? getHeroWarhostConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = warhostPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, warhostCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hwarhost',
  });

  const vw = typeof window === 'undefined' ? 1920 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 1080 : window.innerHeight;
  const screen = local
    ? { x: Math.min(o.attacker.x, o.defender.x) - dist * 0.3, y: Math.min(o.attacker.y, o.defender.y) - dist * 0.3, w: Math.abs(o.attacker.x - o.defender.x) + dist * 0.6, h: Math.abs(o.attacker.y - o.defender.y) + dist * 0.6 }
    : { x: 0, y: 0, w: vw, h: vh };
  const seed = o.rollSeed ?? warhostSeed(o.total, dist, o.side);
  const stage = warhostStage(plan, o.attacker, o.defender, radius, aRadius, c, s, seed, screen);
  const u = stage.u, n = stage.n;
  const feet = { x: o.attacker.x, y: o.attacker.y + aRadius * 0.2 };

  const textures = o.textures !== undefined ? o.textures : heroWarhostTextures();
  const scene = textures && !reduced
    ? new HeroWarhostScene(textures, { red: hexToNum(c.colorRed), brass: hexToNum(c.colorBrass), dust: hexToNum(c.colorDust), side: hexToNum(sideHex) }, {
      soldierPx: c.soldierPx, cavalryPx: c.cavalryPx, dust: c.dust, impactSize: c.impactSize,
    }, s, seed)
    : null;
  // Every soldier's sprite is taken now, while the damage formation still plays: nothing is made on a hot beat.
  scene?.deploy(stage);
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const cue = (clip: string, gain: number, rate: number, opts?: CueOpts): void =>
    voices.cue(clip, gain, rate * (0.85 + 0.15 * warhostScale(plan, seq ? seq.t : 0)), opts);
  voices.warm([
    c.sfxHornClip, c.sfxDrumClip, c.sfxChargeClip, c.sfxGallopClip, c.sfxLooseClip, c.sfxThunkClip, c.sfxWhooshClip, c.sfxThudClip, c.sfxBoomClip,
    c.sfxCheerClip,
  ]);
  /** The thunk's knock sits 87 ms into its clip: skip most of the lead so it lands on the beat. */
  const thunk = (gain: number, rate: number, lenMs = 360): void => cue(c.sfxThunkClip, c.sfxThunkGain * gain, c.sfxThunkRate * rate, { startMs: 55, lenMs, fadeMs: 120 });

  const fire = (q: WarhostCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'drum':
        // Three heavy hits, each a little lower and louder than the last.
        cue(c.sfxDrumClip, c.sfxDrumGain * (0.8 + 0.15 * q.i), c.sfxDrumRate * (1 - 0.035 * q.i), { tail: c.sfxTailMix });
        scene?.drum(feet, aRadius, q.i);
        break;
      case 'horn':
        // III: a quick call over the charge. IV: the long deep one after the drums.
        if (plan.kind === 'host') cue(c.sfxHornClip, c.sfxHornGain, c.sfxHornRate * 0.94, { tail: c.sfxTailMix });
        else cue(c.sfxHornClip, c.sfxHornGain * 0.85, c.sfxHornRate * 1.1, { lenMs: 1150, fadeMs: 350 });
        scene?.horn(o.attacker, u, aRadius);
        break;
      case 'march':
        if (plan.kind === 'cavalry') {
          cue(c.sfxGallopClip, c.sfxGallopGain, c.sfxGallopRate);
          cue(c.sfxChargeClip, c.sfxChargeGain * 0.4, c.sfxChargeRate * 1.15, { lenMs: 1100, fadeMs: 400 });
        } else if (plan.kind === 'host') {
          cue(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate);
          cue(c.sfxGallopClip, c.sfxGallopGain * 0.6, c.sfxGallopRate * 0.9);
        }
        break;
      case 'arrive':
        if (plan.kind === 'spear') { const who = stage.troops[0]; if (who) for (let i = 0; i < 3; i++) scene?.puff(who.p1.x + (i - 1) * 8 * s, who.p1.y - 2 * s, 1.2); }
        break;
      case 'loose':
        if (plan.kind === 'spear') cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate, { lenMs: 320, fadeMs: 140 });
        else {
          cue(c.sfxLooseClip, c.sfxLooseGain, c.sfxLooseRate);
          cue(c.sfxLooseClip, c.sfxLooseGain * 0.7, c.sfxLooseRate * 1.12, { delayMs: 90 / speed });
          cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.7, c.sfxWhooshRate * 0.8, { lenMs: 520, fadeMs: 240 });
        }
        break;
      case 'volley':
        cue(c.sfxLooseClip, c.sfxLooseGain * 0.75, c.sfxLooseRate * (0.95 + 0.08 * q.i));
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.6, c.sfxWhooshRate * 0.75, { lenMs: 560, fadeMs: 260 });
        break;
      case 'hit': {
        // One arrow of the rain: every other one knocks (a patter, not a wall of noise).
        if (q.i % 2 === 0) thunk(0.42, 1.35 + 0.06 * ((q.i / 2) % 4), 180);
        scene?.arrowTick(stage.shots[q.i]?.to ?? stage.strike);
        break;
      }
      case 'impact':
        if (plan.tier === 1) thunk(1, 1);
        else if (plan.tier === 2) { thunk(0.9, 1.1); cue(c.sfxThudClip, c.sfxThudGain * 0.5, c.sfxThudRate * 1.3, { lenMs: 500, fadeMs: 200 }); }
        else if (plan.tier === 3) {
          cue(c.sfxThudClip, c.sfxThudGain, c.sfxThudRate * 0.95, { tail: c.sfxTailMix, lenMs: 900, fadeMs: 350 });
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.5, c.sfxBoomRate * 1.15, { lenMs: 900, fadeMs: 350 });
          thunk(0.6, 0.8);
        } else {
          cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate, { tail: c.sfxTailMix, lenMs: 1600, fadeMs: 600 });
          cue(c.sfxThudClip, c.sfxThudGain * 1.2, c.sfxThudRate * 0.8, { tail: c.sfxTailMix, lenMs: 1100, fadeMs: 400 });
          thunk(0.5, 0.7);
        }
        scene?.impact(o.defender, stage.strike, u, radius, plan.tier);
        // THE KNOCKOUT: the prismatic shock and the sting.
        if (plan.ko) { scene?.koFlourish(o.defender, radius); playKoSting(voices, sound, (ms) => ms / speed); }
        seq.land();
        break;
      case 'buffet':
        cue(c.sfxThudClip, c.sfxThudGain * 0.45, c.sfxThudRate * (1.15 + 0.04 * q.i), { lenMs: 420, fadeMs: 180 });
        scene?.buffet(o.defender, radius, plan.kind === 'host' ? 1 : 0.7);
        break;
      case 'cheer':
        // A tiny cheer (the crowd clip pitched up and trimmed to a second): one man on I, a few on the Knockout.
        cue(c.sfxCheerClip, c.sfxCheerGain * (plan.ko ? 1.5 : 1), c.sfxCheerRate, { startMs: 700, lenMs: plan.kind === 'spear' ? 650 : 900, fadeMs: 320 });
        break;
      case 'plant':
        thunk(0.8, 0.8);
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.5, c.sfxWhooshRate * 0.7, { lenMs: 420, fadeMs: 200 });
        scene?.plant({ x: o.defender.x, y: o.defender.y + radius * 0.35 }, radius);
        break;
      default:
        break;
    }
  };

  // ── the per-frame paint ──
  const flip = stage.face;
  const dimOut = plan.kind === 'host' ? plan.plantAt + c.bannerMs * 0.5 : plan.kind === 'cavalry' ? plan.passAt + 160 : plan.impactAt + 200;
  const knockK = c.knockPx * (0.7 + 0.4 * plan.k);

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.marchAt, dimOut);
    const cm = warhostCameraAt(plan, c, t, u);
    const unit = local ? 1 : s;
    cam.apply(warhostCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The send-off: a lean back through the ready, a thrust as the troops go; each war drum thumps it.
      let bx = 0, by = 0, sc = 1;
      const lean = t < plan.marchAt ? easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.marchAt - plan.chargeAt)) : Math.max(0, spring(t - plan.marchAt, 3, 90));
      bx -= u.x * c.heroWindPx * px * lean; by -= u.y * c.heroWindPx * px * lean;
      const rot = -2.5 * flip * lean;
      if (t >= plan.marchAt) { const f = c.heroThrowPx * px * Math.max(0, spring(t - plan.marchAt, 5, 60)); bx += u.x * f; by += u.y * f; }
      for (const at of plan.drums) if (t >= at) sc += 0.06 * Math.max(0, spring(t - at, 4, 80));
      const still = Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(rot) < 0.01 && Math.abs(sc - 1) < 1e-4;
      hero.set(still ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`);
    }
    // The struck portrait: ticked by each arrow, knocked by the blow, knocked ABOUT by every row and rank after it, and
    // shuddering under the trample.
    let fx = 0, fy = 0, rot = 0, sq = 0;
    for (const at of plan.hits) if (t >= at) { const k = Math.max(0, spring(t - at, 6, 40)) * 3 * px; fx += u.x * k; fy += u.y * k; }
    if (t >= plan.impactAt) {
      const k = spring(t - plan.impactAt, 4.5, 90);
      fx += u.x * knockK * k * px; fy += u.y * knockK * k * px;
      sq = c.squash * (0.8 + 0.4 * plan.k) * k;
      rot += 3 * flip * k * (0.5 + plan.k);
      for (let i = 0; i < plan.buffets.length; i++) {
        const at = plan.buffets[i]!;
        if (t < at) break;
        const b = spring(t - at, 5, 70) * knockK * 0.45 * px;
        const side = i % 2 ? 1 : -1;
        fx += (u.x * 0.5 + n.x * side * 0.7) * b; fy += (u.y * 0.5 + n.y * side * 0.7) * b;
        rot += side * 2.4 * spring(t - at, 5, 70);
      }
      const r = plan.kind === 'host' ? warhostRumble(plan, t) : 0;
      if (r > 0) { fx += Math.sin(t * 0.11) * 3 * r * px; fy += Math.sin(t * 0.17 + 1) * 2.4 * r * px; }
      if (plan.plantAt >= 0 && t >= plan.plantAt) fy += 5 * px * spring(t - plan.plantAt, 4, 70);
    }
    const still = Math.abs(fx) + Math.abs(fy) < 0.05 && Math.abs(rot) < 0.02 && Math.abs(sq) < 4e-4;
    foe.set(still ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`);
    if (scene) { scene.setFoeOffset(fx * unit, fy * unit); scene.paint(t); }
  };

  const seq: Sequence<WarhostCue | FormationCue> = new Sequence<WarhostCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    // The Knockout's slow-mo dip: the frame source hands the ONE clock a scaled step (a smooth ramp, never 0).
    frames: (fn: (dt: number) => void) => (o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)))((dt) => fn(dt * (seq && !seq.done ? warhostScale(plan, seq.t) : 1))),
    safetyMs: o.safety !== false ? (plan.endAt + warhostSlowExtraMs(plan)) / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      scene?.retire();
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    stage,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
