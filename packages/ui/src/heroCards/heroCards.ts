/**
 * THE CARD SHARK RUNNER: plays one Card Shark hero attack (the beats are in `heroCardsConfig.ts`) and lands the
 * consequence on its impact beat (the last card sticking, or the flush bursting). Presentation only: the total it shows
 * and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera, the portraits (transform only, restored after), the voices, the
 * dim, reduced motion, finish / cancel and the safety timer. What is Card Shark's own: the hand, the card paths, the
 * royal flush, its camera and its sound.
 *
 * THE CAMERA IS APPLIED ONCE. Since the scaled stage (#1762) the shared FX canvas lives INSIDE `#stage`, so the DOM
 * camera already zooms and shakes it; the Pixi root mirrors the camera only when its canvas is NOT inside the camera
 * element (a sandbox that mounts its own canvas elsewhere). Mirroring both applied it twice and made FX overshoot the
 * portrait at peak zoom (found by the Banana attack, PR #1839).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites are pooled per layer and capped, textures painted once per session and pre-warmed
 * during the formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { canvasInCamera } from '../heroAttack/cameraMirror';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  cardArrivalDir, cardMotions, cardsCameraAt, cardsCameraFocus, cardsCues, cardsPlan, fanPoses, getHeroCardsConfig, heldPoses,
  type CardMotion, type CardsCue, type CardsPlan, type FanPose, type HeroCardsConfig,
} from './heroCardsConfig';
import { HeroCardsScene, type HeroCardsTextures } from './heroCardsScene';
import { heroCardsTextures } from './heroCardsTextures';

export interface HeroCardsOptions extends HeroAttackOptions {
  cfg?: HeroCardsConfig;
  textures?: HeroCardsTextures | null;
}

export interface HeroCardsHandle extends HeroAttackHandle {
  readonly plan: CardsPlan;
  /** Every card's flight (empty under reduced motion). Exposed for tests and the capture rig. */
  readonly motions: readonly CardMotion[];
  /** Where the cards are held (Small, Medium) or fanned (Big) before they leave. */
  readonly hand: readonly FanPose[];
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroCardsScene | null;
}

/** The seed a fight's confetti is scattered from: the same fight (same blow, same geometry) bursts the same way. */
export function cardsSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 17)) >>> 0;
}

/** Play Card Shark. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroCards(o: HeroCardsOptions): HeroCardsHandle {
  const c = o.cfg ?? getHeroCardsConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = cardsPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, cardsCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hcards',
  });

  // The view the Big hand must stay inside (measured once, at the start).
  const view = local ? { w: o.host?.clientWidth || 400, h: o.host?.clientHeight || 300 } : { w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 };
  const cardH = c.cardLength * s * plan.size;
  const hand = plan.reduced ? [] : plan.flush
    ? fanPoses(plan.cards.length, o.attacker, o.defender, aRadius, cardH * c.fanSize, c, view)
    : heldPoses(plan, o.attacker, o.defender, aRadius);
  const motions = cardMotions(plan, o.attacker, o.defender, radius, aRadius, plan.flush ? cardH * c.fanSize : cardH, c, (local ? 8 : 36) * s, nums.pts.hit, hand);
  const last = motions[motions.length - 1];
  const dir = cardArrivalDir(last, o.attacker, o.defender);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  const handCentre = hand.length ? { x: hand.reduce((a, p) => a + p.x, 0) / hand.length, y: hand.reduce((a, p) => a + p.y, 0) / hand.length } : o.attacker;

  // ── Pixi ──
  const textures = o.textures !== undefined ? o.textures : heroCardsTextures();
  const scene = textures && !reduced
    ? new HeroCardsScene(textures, {
      ivory: hexToNum(c.colorIvory), red: hexToNum(c.colorRed), gold: hexToNum(c.colorGold), ink: 0x1b1620, side: hexToNum(sideHex),
    }, { length: c.cardLength, glow: c.cardGlow, ghosts: c.ghostAlpha, quiver: c.quiver, confetti: c.confetti, gravity: c.confettiGravity }, s, cardsSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  let mirrorOn = true;
  const mirror = scene ? { setCamera: (ax: number, ay: number, z: number): void => { if (mirrorOn) scene.setCamera(ax, ay, z); else scene.setCamera(0, 0, 1); } } : null;
  const cam = new StageCamera(cameraEl, mirror);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxDrawClip, c.sfxFlickClip, c.sfxSnapClip, c.sfxThunkClip, c.sfxPunchClip, c.sfxImpactClip, c.sfxBigClip,
    c.sfxDealClip, c.sfxFlipClip, c.sfxRevealClip, c.sfxBurstClip, c.sfxSparkleClip,
  ]);
  const n = plan.cards.length;
  const sizeK = plan.size * (plan.flush ? c.fanSize : 1);
  let hitStep = 0;

  const fire = (q: CardsCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // A card is drawn: a soft riffle, and (Small, Medium) the cards snap into the hand face up.
        cue(c.sfxDrawClip, c.sfxDrawGain, c.sfxDrawRate, { lenMs: 500, fadeMs: 200 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(plan.flush ? handCentre : (hand[0] ?? o.attacker), (plan.flush ? (plan.deals[0] ?? plan.throwAt) : plan.throwAt) - plan.chargeAt);
        if (scene && !plan.flush) plan.cards.forEach((cp, i) => scene.hold(i, cp.face, hand[i]!, plan.size * (cp.size ?? 1)));
        mirrorOn = !canvasInCamera(cameraEl, !!o.mount);
        cam.start();
        break;
      case 'deal':
        cue(c.sfxDealClip, c.sfxDealGain, c.sfxDealRate + 0.04 * q.i, { lenMs: 300, fadeMs: 120 });
        scene?.deal(q.i, plan.cards[q.i]!.face, { x: o.attacker.x + toFoe.x * aRadius * 0.5, y: o.attacker.y + toFoe.y * aRadius * 0.5 }, hand[q.i]!, sizeK, c.dealMs);
        break;
      case 'flip':
        cue(c.sfxFlipClip, c.sfxFlipGain, c.sfxFlipRate + 0.06 * q.i, { lenMs: 260, fadeMs: 100 });
        scene?.flip(q.i, c.flipMs);
        break;
      case 'gold':
        // THE ROYAL FLUSH turns gold: a bright reveal and a sparkle.
        cue(c.sfxRevealClip, c.sfxRevealGain, c.sfxRevealRate, { lenMs: 1200, fadeMs: 400 });
        cue(c.sfxSparkleClip, c.sfxSparkleGain, c.sfxSparkleRate, { lenMs: 900, fadeMs: 300 });
        scene?.gild(c.goldMs);
        break;
      case 'throw': {
        // SNAP: a quick swish and a whip-snap (a little higher per card). The flush fires all five at once: one big swish.
        if (plan.flush && q.i > 0) { scene?.throw(q.i, plan.cards[q.i]!.face, motions[q.i]!, sizeK, t - q.at); break; }
        cue(c.sfxFlickClip, c.sfxFlickGain * (plan.flush ? 1.3 : 1), c.sfxFlickRate + 0.05 * q.i - (plan.flush ? 0.25 : 0), { lenMs: c.sfxFlickLenMs, fadeMs: 110 });
        cue(c.sfxSnapClip, c.sfxSnapGain, c.sfxSnapRate + 0.05 * q.i, { startMs: 440, lenMs: 170, fadeMs: 80 });
        const m = motions[q.i];
        if (m && scene) scene.throw(q.i, plan.cards[q.i]!.face, m, plan.flush ? sizeK : plan.size * (plan.cards[q.i]!.size ?? 1), t - q.at);
        break;
      }
      case 'hit':
        // THUNK: a card before the last sticks. FX and sound only.
        cue(c.sfxThunkClip, c.sfxThunkGain * 0.85, c.sfxThunkRate + 0.06 * hitStep, { lenMs: 420, fadeMs: 150 });
        cue(c.sfxPunchClip, c.sfxPunchGain * 0.7, c.sfxPunchRate + 0.05 * hitStep, { lenMs: 260, fadeMs: 100 });
        scene?.hit(q.i, hitStep);
        hitStep++;
        break;
      case 'impact':
        if (plan.flush) {
          // THE FLUSH BURSTS into card confetti.
          cue(c.sfxBurstClip, c.sfxBurstGain, c.sfxBurstRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 300 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate, { lenMs: 600, fadeMs: 200 });
          cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxSparkleClip, c.sfxSparkleGain * 0.8, c.sfxSparkleRate + 0.1, { lenMs: 900, fadeMs: 300 });
          scene?.burst(o.defender.x, o.defender.y, radius, { burst: plan.burst, sparks: plan.sparks, flashAlpha: c.flashAlpha });
        } else {
          // THE LAST CARD: the thunk, a punch and the impact; a crack on the three of a kind.
          cue(c.sfxThunkClip, c.sfxThunkGain, c.sfxThunkRate + 0.06 * hitStep, { tail: c.sfxTailMix, lenMs: 520, fadeMs: 180 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.1 * plan.level), c.sfxImpactRate, { lenMs: c.sfxImpactLenMs, fadeMs: 280 });
          cue(c.sfxPunchClip, c.sfxPunchGain, c.sfxPunchRate - 0.05 * plan.level, { lenMs: 320, fadeMs: 120 });
          if (plan.level >= 2) cue(c.sfxBigClip, c.sfxBigGain * 0.8, c.sfxBigRate, { lenMs: 600, fadeMs: 220 });
          scene?.impact(n - 1, radius, { level: plan.level, burst: plan.burst, sparks: plan.sparks, flashAlpha: c.flashAlpha });
        }
        seq.land();
        break;
      case 'dissolve':
        scene?.dissolve();
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.throwAt, plan.impactAt + (plan.flush ? 380 : 200));
    const cm = cardsCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(cardsCameraFocus(plan, t, o.attacker, o.defender, plan.flush ? handCentre : null), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The ready: a small lean back and swell; every card leaving (dealt, or thrown) flicks the hero toward the target.
      let sc = 1, bx = 0, by = 0;
      const readyEnd = plan.flush ? (plan.deals[0] ?? plan.throwAt) : plan.throwAt;
      if (t < readyEnd) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, readyEnd - plan.chargeAt));
        sc = 1 + 0.035 * u;
        bx = -toFoe.x * c.heroCoilPx * px * u; by = -toFoe.y * c.heroCoilPx * px * u;
      } else {
        const back = Math.max(0, spring(t - readyEnd, 3, 90));
        sc = 1 + 0.035 * back;
        bx = -toFoe.x * c.heroCoilPx * px * back; by = -toFoe.y * c.heroCoilPx * px * back;
        const flicks = plan.flush ? [...plan.deals, plan.throwAt] : plan.cards.map((d) => d.throwAt);
        for (const at of flicks) {
          if (at > t) continue;
          const f = c.heroFlickPx * px * spring(t - at, 5, 60) * (plan.flush && at !== plan.throwAt ? 0.35 : 1);
          bx += toFoe.x * f; by += toFoe.y * f;
        }
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let css: string | null = null;
      if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.5 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        fx = dir.x * knock; fy = dir.y * knock;
        css = Math.abs(k) < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        let k = 0;
        for (const at of plan.hits) k += at <= t ? Math.max(0, spring(t - at, 6, 45)) : 0;
        fx = dir.x * k * 6 * px; fy = dir.y * k * 6 * px;
        css = k < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
      }
      foe.set(css);
    }
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<CardsCue | FormationCue> = new Sequence<CardsCue | FormationCue>({
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
    motions,
    hand,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
