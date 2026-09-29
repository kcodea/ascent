/**
 * THE BUBBLE POP RUNNER (a Rare hero attack): plays one Bubble Pop (the beats are in `heroBubbleConfig.ts`) and lands the
 * consequence on its impact beat (THE pop). Presentation only: the total and the blow are the engine's; this file only
 * decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses), the damage formation, the
 * `#stage` camera (applied ONCE: `overlayCamera`), the portraits (transform only, restored after), the voices, the dim,
 * reduced motion, finish / cancel and the safety timer.
 *
 * THE STREAM CONTRACT: each little bubble that blips on the face before the big one is a tick (FX and sound only). The
 * consequence (`onImpact`) lands exactly ONCE, on the pop.
 *
 * Perf: DOM moves are `transform` / `opacity` from the clock; no layout reads after the opening measure; pooled sprites
 * under a hard cap, textures painted once per session and pre-warmed during the formation; the updater unhooks the
 * moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { overlayCamera } from '../heroAttack/overlayCamera';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  bubbleCameraAt, bubbleCameraFocus, bubbleCues, bubbleDrifts, bubbleHand, bubblePlan, getHeroBubbleConfig,
  type BubbleCue, type BubbleDrift, type BubblePlan, type HeroBubbleConfig,
} from './heroBubbleConfig';
import { HeroBubbleScene, type HeroBubbleTextures } from './heroBubbleScene';
import { heroBubbleTextures } from './heroBubbleTextures';

export interface HeroBubbleOptions extends HeroAttackOptions {
  cfg?: HeroBubbleConfig;
  textures?: HeroBubbleTextures | null;
}

export interface HeroBubbleHandle extends HeroAttackHandle {
  readonly plan: BubblePlan;
  readonly drifts: { main: BubbleDrift | null; stream: readonly BubbleDrift[] };
  readonly scene: HeroBubbleScene | null;
  readonly mirrorsCamera: boolean;
}

export function bubbleSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 3571 + Math.round(distance) * 23 + (side === 'opp' ? 131 : 17)) >>> 0;
}

/** Play Bubble Pop. Returns a handle; the blow lands via `onImpact` on the pop. */
export function playHeroBubble(o: HeroBubbleOptions): HeroBubbleHandle {
  const c = o.cfg ?? getHeroBubbleConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = bubblePlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, bubbleCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hbubble',
  });

  const drifts = bubbleDrifts(plan, o.attacker, o.defender, radius, aRadius, c.lift);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();

  const textures = o.textures !== undefined ? o.textures : heroBubbleTextures();
  const scene = textures && !reduced
    ? new HeroBubbleScene(textures, {
      film: hexToNum(c.colorFilm), pink: hexToNum(c.colorPink), mint: hexToNum(c.colorMint), lilac: hexToNum(c.colorLilac), sky: hexToNum(c.colorSky), side: hexToNum(sideHex),
    }, { filmSpin: c.filmSpin, sheen: c.sheenAlpha, dropGravity: c.dropGravity, dropSpeed: c.dropSpeed }, s, bubbleSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const ocam = overlayCamera(scene, cameraEl, !!o.mount);
  const cam = new StageCamera(cameraEl, ocam.mirror);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxBlowClip, c.sfxBlipClip, c.sfxStretchClip, c.sfxPopClip, c.sfxSplashClip]);
  const hand = bubbleHand(o.attacker, o.defender, aRadius);

  const fire = (q: BubbleCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        ocam.decide();
        cam.start();
        break;
      case 'blow':
        cue(c.sfxBlowClip, c.sfxBlowGain, c.sfxBlowRate, { lenMs: 600, fadeMs: 240 });
        scene?.blow(hand, plan.size * radius, plan.releaseAt - plan.blowAt, plan.wobble);
        break;
      case 'stream': {
        const d = drifts.stream[q.i];
        const b = plan.stream[q.i];
        if (d && b) scene?.streamOut(d, b.size * radius, plan.wobble);
        break;
      }
      case 'release':
        cue(c.sfxBlipClip, c.sfxBlipGain * 0.5, c.sfxBlipRate - 0.4, { lenMs: 200, fadeMs: 90 });
        if (drifts.main) scene?.release(drifts.main);
        break;
      case 'hit':
        // A little bubble blips on the face, a step higher each time. FX only.
        cue(c.sfxBlipClip, c.sfxBlipGain, c.sfxBlipRate + 0.07 * q.i, { lenMs: 180, fadeMs: 80 });
        scene?.blip(q.i);
        break;
      case 'engulf':
        // The film stretches round the face (a soft rising whine, pitched down, under the strain).
        cue(c.sfxStretchClip, c.sfxStretchGain, c.sfxStretchRate, { lenMs: (plan.impactAt - plan.arriveAt) / speed, fadeMs: 120 });
        scene?.engulf(o.defender, plan.engulf * radius, plan.engulfAt - plan.arriveAt, plan.impactAt - plan.engulfAt);
        break;
      case 'impact':
        cue(c.sfxPopClip, c.sfxPopGain, c.sfxPopRate, { lenMs: 400, fadeMs: 160 });
        cue(c.sfxBlipClip, c.sfxBlipGain, c.sfxBlipRate - 0.2, { lenMs: 200, fadeMs: 80 });
        if (plan.splash > 0) cue(c.sfxSplashClip, c.sfxSplashGain, c.sfxSplashRate, { lenMs: 700, fadeMs: 260, tail: 0.1 });
        scene?.pop({ drops: plan.drops, tinies: plan.tinies, splash: plan.splash });
        seq.land();
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.releaseAt, plan.impactAt + 200);
    const cm = bubbleCameraAt(plan, c, t);
    const unit = local ? 1 : s;
    cam.apply(bubbleCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The hero puffs up as it blows (a swell), and gives a little push as the bubble leaves.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.releaseAt) sc = 1 + c.heroPuff * easeInOutSine((t - plan.blowAt) / Math.max(1, plan.releaseAt - plan.blowAt));
      else {
        const back = Math.max(0, spring(t - plan.releaseAt, 3, 90));
        sc = 1 + c.heroPuff * back;
        const f = c.heroPushPx * px * spring(t - plan.releaseAt, 4, 70);
        bx = toFoe.x * f; by = toFoe.y * f;
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    let fy = 0;
    let css: string | null = null;
    if (t >= plan.impactAt) {
      // The pop: a squash-and-boing, and a small drop.
      const k = spring(t - plan.impactAt, 4, 90);
      const sq = c.squash * (plan.level === 'big' ? 1.2 : 1) * k;
      fy = c.knockPx * k * px;
      css = Math.abs(k) < 0.004 ? null : `translate(0px, ${fy.toFixed(2)}px) scale(${(1 + sq).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
    } else if (t >= plan.arriveAt) {
      // Engulfed, the face floats a little inside the bubble.
      const u = clamp01((t - plan.arriveAt) / 200);
      fy = -c.floatPx * px * u * (0.6 + 0.4 * Math.sin((t - plan.arriveAt) * 0.012));
      css = `translate(0px, ${fy.toFixed(2)}px) scale(${(1 + 0.015 * u).toFixed(4)})`;
    } else if (plan.hits.length && t >= plan.hits[0]!) {
      let k = 0;
      for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 40));
      fy = -2.5 * k * px;
      css = Math.abs(fy) < 0.05 ? null : `translate(0px, ${fy.toFixed(2)}px)`;
    }
    foe.set(css);
    scene?.setFoeOffset(0, fy * unit);
  };

  const seq: Sequence<BubbleCue | FormationCue> = new Sequence<BubbleCue | FormationCue>({
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
    drifts,
    scene,
    get mirrorsCamera() { return ocam.on; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
