/**
 * PAID IN FULL'S RUNNER (the rubber stamp, a Rare hero attack): plays one attack (the beats are in
 * `heroStampConfig.ts`) and lands the consequence on its impact beat (the last thunk). Presentation only: the total it
 * shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they
 * happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), as every style does: one clock (it never pauses), the
 * damage formation, the `#stage` camera (applied ONCE: `stageCamera.ts`), the portraits (transform only, restored after),
 * the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE THREE-STAMP CONTRACT: every thunk before the last is a tick (a mark, dust, ink and sound only). The consequence
 * (`onImpact`) lands exactly ONCE, on the last thunk.
 *
 * Perf: DOM moves are `transform` written from the clock; nothing reads layout after the opening measure; the Pixi
 * sprites are pooled (a hard cap), the textures painted once per session and pre-warmed during the formation, the
 * stamp's pose is written into one reused object, and the updater unhooks the moment the scene drains.
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
  stampCameraAt, stampCameraFocus, stampCues, stampPlan, stampPress, stampTrack, getHeroStampConfig,
  type StampCue, type StampPlan, type StampTrack, type HeroStampConfig,
} from './heroStampConfig';
import { HeroStampScene, type HeroStampTextures } from './heroStampScene';
import { heroStampTextures } from './heroStampTextures';

export interface HeroStampOptions extends HeroAttackOptions {
  cfg?: HeroStampConfig;
  textures?: HeroStampTextures | null;
}

export interface HeroStampHandle extends HeroAttackHandle {
  readonly plan: StampPlan;
  /** The stamp's whole track (empty under reduced motion). */
  readonly track: StampTrack;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroStampScene | null;
  /** Whether the camera is mirrored onto the Pixi root (false when the canvas already rides the camera element). */
  readonly mirrorsCamera: boolean;
}

/** The seed a fight's marks are rolled from when the caller gives none: the same fight stamps the same crooked marks. */
export function stampSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 13)) >>> 0;
}

/** Each thunk's pitch and loudness: the ticks light and climbing down, the last one the lowest and the fullest. */
function thunkVoice(i: number, n: number): { rate: number; gain: number } {
  if (n <= 1) return { rate: 1, gain: 0.9 };
  if (i === n - 1) return { rate: 0.86, gain: 1 };
  return { rate: 1.16 - 0.1 * i, gain: 0.6 + 0.08 * i };
}

/** Play Paid in Full. Returns a handle; the blow lands via `onImpact` on the last thunk. */
export function playHeroStamp(o: HeroStampOptions): HeroStampHandle {
  const c = o.cfg ?? getHeroStampConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = stampPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, stampCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hstamp',
  });

  const seed = (o.rollSeed ?? stampSeed(o.total, dist, o.side)) >>> 0;
  const track = stampTrack(plan, { a: o.attacker, d: o.defender, radius, aRadius, ceilY: (local ? 6 : 28) * s, seed, avoid: nums.pts.hit }, c);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  // The stamp presses DOWN its own axis: the struck portrait is pushed that way and squashed across it.
  const press = { x: -track.upD.x, y: -track.upD.y };
  const axisDeg = (track.rotD * 180) / Math.PI;
  const thunks = plan.thunks.length;

  const textures = o.textures !== undefined ? o.textures : heroStampTextures();
  const scene = textures && !reduced
    ? new HeroStampScene(textures, {
      ink: hexToNum(c.colorInk), inkDeep: hexToNum(c.colorInkDeep), shine: hexToNum(c.colorShine), dust: hexToNum(c.colorDust),
    }, { markSize: c.markSize }, s, seed)
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxWhooshClip, c.sfxThunkClip, c.sfxPadClip]);

  const thunk = (i: number, final: boolean): void => {
    const v = thunkVoice(i, thunks);
    // The clip's hit is about 20 ms in: start a touch inside it so the sound sits on the frame the die lands.
    cue(c.sfxThunkClip, c.sfxThunkGain * v.gain, c.sfxThunkRate * v.rate, { startMs: 8, lenMs: 340, fadeMs: 140, tail: final ? 0.08 : 0 });
    scene?.thunk(i, {
      final, big: plan.level === 'big', skull: plan.knockout, droplets: plan.droplets,
      hold: plan.markFadeAt - plan.thunks[i]!, fade: plan.markFadeMs,
    });
  };

  const fire = (q: StampCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.start(plan, track, t - q.at);
        cam.start();
        break;
      case 'pad':
        cue(c.sfxPadClip, c.sfxPadGain, c.sfxPadRate, { startMs: 10, lenMs: 280, fadeMs: 120 });
        scene?.padTap();
        break;
      case 'launch':
        cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate, { lenMs: Math.min(420, plan.flightMs + 60), fadeMs: 160 });
        break;
      case 'hit':
        thunk(q.i, false); // a tick: FX and sound only
        break;
      case 'impact':
        thunk(thunks - 1, true);
        seq.land();
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.launchAt, plan.impactAt + 200);
    const cm = stampCameraAt(plan, c, t, press);
    const unit = local ? 1 : s;
    cam.apply(stampCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The ready: a small dip back as the stamp comes out; the launch pushes the hero toward the target, then home.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.launchAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.launchAt - plan.chargeAt));
        sc = 1 - 0.03 * u;
        bx = -toFoe.x * c.heroDipPx * px * u; by = -toFoe.y * c.heroDipPx * px * u + 2 * px * u;
      } else {
        const back = Math.max(0, spring(t - plan.launchAt, 3, 80));
        const f = c.heroPushPx * px * spring(t - plan.launchAt, 5, 60);
        sc = 1 - 0.03 * back + 0.02 * Math.max(0, f / Math.max(1, c.heroPushPx * px));
        bx = -toFoe.x * c.heroDipPx * px * back + toFoe.x * f; by = -toFoe.y * c.heroDipPx * px * back + toFoe.y * f;
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    // The struck portrait: pressed along the stamp's axis and squashed flat across it, ringing out after every thunk.
    const k = t >= plan.thunks[0]! ? stampPress(plan, t) : 0;
    let fx = 0, fy = 0;
    if (Math.abs(k) < 0.004) foe.set(null);
    else {
      const sq = c.squash * k;
      fx = press.x * c.knockPx * k * px; fy = press.y * c.knockPx * k * px;
      const squash = `scale(${(1 + sq * 0.55).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      foe.set(Math.abs(axisDeg) < 0.5
        ? `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) ${squash}`
        : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) rotate(${axisDeg.toFixed(2)}deg) ${squash} rotate(${(-axisDeg).toFixed(2)}deg)`);
    }
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<StampCue | FormationCue> = new Sequence<StampCue | FormationCue>({
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
    track,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
