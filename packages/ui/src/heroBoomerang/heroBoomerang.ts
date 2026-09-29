/**
 * THE BOOMERANG RUNNER (a Rare hero attack): plays one Boomerang (the beats are in `heroBoomerangConfig.ts`) and lands
 * the consequence on its impact beat (the last thwack). Presentation only: the total and the blow are the engine's; this
 * file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses), the damage formation, the
 * `#stage` camera (applied ONCE: `overlayCamera`), the portraits (transform only, restored after), the voices, the dim,
 * reduced motion, finish / cancel and the safety timer.
 *
 * THE DOUBLE THWACK CONTRACT: a thwack before the last is a tick (FX and sound only). The consequence (`onImpact`) lands
 * exactly ONCE, on the last thwack. The swing home and the catch come after it and are looks only.
 *
 * Perf: DOM moves are `transform` / `opacity` from the clock; no layout reads after the opening measure; pooled sprites
 * under a hard cap, two ribbon strips per boomerang made once, textures painted once per session and pre-warmed during
 * the formation; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { overlayCamera } from '../heroAttack/overlayCamera';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  boomerangCameraAt, boomerangCameraFocus, boomerangCues, boomerangMotions, boomerangPlan, getHeroBoomerangConfig,
  type BoomerangCue, type BoomerangMotion, type BoomerangPlan, type HeroBoomerangConfig,
} from './heroBoomerangConfig';
import { HeroBoomerangScene, type HeroBoomerangTextures } from './heroBoomerangScene';
import { heroBoomerangTextures } from './heroBoomerangTextures';

export interface HeroBoomerangOptions extends HeroAttackOptions {
  cfg?: HeroBoomerangConfig;
  textures?: HeroBoomerangTextures | null;
}

export interface HeroBoomerangHandle extends HeroAttackHandle {
  readonly plan: BoomerangPlan;
  readonly motions: readonly BoomerangMotion[];
  readonly scene: HeroBoomerangScene | null;
  readonly mirrorsCamera: boolean;
}

export function boomerangSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 4513 + Math.round(distance) * 29 + (side === 'opp' ? 173 : 19)) >>> 0;
}

/** Play the Boomerang. Returns a handle; the blow lands via `onImpact` on the last thwack. */
export function playHeroBoomerang(o: HeroBoomerangOptions): HeroBoomerangHandle {
  const c = o.cfg ?? getHeroBoomerangConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = boomerangPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, boomerangCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hboomerang',
  });

  const motions = boomerangMotions(plan, o.attacker, o.defender, radius, aRadius, (local ? 8 : 36) * s, nums.pts.hit);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  const lastIn = motions[motions.length - 1]?.arrive ?? toFoe;

  const textures = o.textures !== undefined ? o.textures : heroBoomerangTextures();
  const scene = textures && !reduced
    ? new HeroBoomerangScene(textures, {
      wood: hexToNum(c.colorWood), grain: hexToNum(c.colorGrain), teal: hexToNum(c.colorTeal), tealDeep: hexToNum(c.colorTealDeep),
      flash: hexToNum(c.colorFlash), side: hexToNum(sideHex),
    }, { px: c.boomPx, trailMs: c.trailMs, trailWidth: c.trailWidth, whirl: c.whirl, thwack: c.thwackSize, catchMs: c.catchMs }, s, boomerangSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const ocam = overlayCamera(scene, cameraEl, !!o.mount);
  const cam = new StageCamera(cameraEl, ocam.mirror);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxThrowClip, c.sfxWhirlClip, c.sfxThwackClip, c.sfxKnockClip, c.sfxCatchClip]);
  const hand = motions[0]?.rel ?? o.attacker;

  const fire = (q: BoomerangCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(hand, plan.throwAt - plan.chargeAt);
        ocam.decide();
        cam.start();
        break;
      case 'throw': {
        const m = motions[q.i];
        cue(c.sfxThrowClip, c.sfxThrowGain, c.sfxThrowRate + 0.06 * q.i, { lenMs: 300, fadeMs: 120 });
        // The whirl: a woosh as it swings wide, and another as it swings home.
        cue(c.sfxWhirlClip, c.sfxWhirlGain, c.sfxWhirlRate + 0.05 * q.i, { delayMs: (plan.throws[q.i]!.outMs * 0.35) / speed, lenMs: 420, fadeMs: 180 });
        cue(c.sfxWhirlClip, c.sfxWhirlGain * 0.8, c.sfxWhirlRate - 0.1 + 0.05 * q.i, { delayMs: (plan.throws[q.i]!.outMs + plan.throws[q.i]!.backMs * 0.3) / speed, lenMs: 420, fadeMs: 200 });
        if (m && scene) scene.throw(m, plan.size, plan.spinHz, q.i, t - q.at);
        break;
      }
      case 'hit': {
        cue(c.sfxThwackClip, c.sfxThwackGain * 0.8, c.sfxThwackRate + 0.08, { lenMs: 350, fadeMs: 140 });
        cue(c.sfxKnockClip, c.sfxKnockGain * 0.7, c.sfxKnockRate + 0.1, { lenMs: 250, fadeMs: 100 });
        const m = motions[q.i];
        if (m) scene?.thwack(q.i, m.hit, m.arrive, 0.85, Math.round(plan.chips * 0.6));
        break;
      }
      case 'impact': {
        cue(c.sfxThwackClip, c.sfxThwackGain, c.sfxThwackRate, { lenMs: 450, fadeMs: 160, tail: 0.08 });
        cue(c.sfxKnockClip, c.sfxKnockGain, c.sfxKnockRate, { lenMs: 300, fadeMs: 120 });
        const m = motions[q.i];
        if (m) scene?.thwack(q.i, m.hit, m.arrive, plan.level === 'big' ? 1.25 : 1.05, plan.chips);
        seq.land();
        break;
      }
      case 'catch':
        cue(c.sfxCatchClip, c.sfxCatchGain, c.sfxCatchRate + 0.08 * q.i, { lenMs: 300, fadeMs: 120 });
        scene?.catchAt(q.i);
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.throwAt, plan.impactAt + 200);
    const cm = boomerangCameraAt(plan, c, t, lastIn);
    const unit = local ? 1 : s;
    cam.apply(boomerangCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The wind back (a lean away and a twist), the throw (a snap toward the target), and a little pop on each catch.
      let sc = 1, bx = 0, by = 0, rot = 0;
      if (t < plan.throwAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.throwAt - plan.chargeAt));
        bx = -toFoe.x * c.heroWindPx * px * u; by = -toFoe.y * c.heroWindPx * px * u;
        rot = -4 * u * (toFoe.x >= 0 ? 1 : -1);
      } else {
        const back = Math.max(0, spring(t - plan.throwAt, 3, 80));
        bx = -toFoe.x * c.heroWindPx * px * back; by = -toFoe.y * c.heroWindPx * px * back;
        rot = -4 * back * (toFoe.x >= 0 ? 1 : -1);
        for (const th of plan.throws) {
          if (th.throwAt > t) continue;
          const f = c.heroThrowPx * px * spring(t - th.throwAt, 5, 60);
          bx += toFoe.x * f; by += toFoe.y * f;
        }
      }
      for (const at of plan.catches) if (t >= at) sc += c.catchPop * Math.max(0, spring(t - at, 4, 70));
      const still = Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(rot) < 0.01;
      hero.set(still ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    let css: string | null = null;
    let kx = 0, ky = 0;
    for (let i = 0; i < plan.hits.length; i++) {
      const k = Math.max(0, spring(t - plan.hits[i]!, 6, 45));
      const d = motions[i]?.arrive ?? lastIn;
      kx += d.x * k * 8; ky += d.y * k * 8;
    }
    if (t >= plan.impactAt) {
      const k = spring(t - plan.impactAt, 4.5, 80);
      const knock = c.knockPx * (plan.level === 'big' ? 1.2 : 1) * k * px;
      const sq = c.squash * (plan.level === 'big' ? 1.2 : 1) * k;
      fx = lastIn.x * knock + kx * px; fy = lastIn.y * knock + ky * px;
      css = Math.abs(k) < 0.004 && Math.abs(kx) + Math.abs(ky) < 0.05 ? null
        : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
    } else if (Math.abs(kx) + Math.abs(ky) >= 0.05) {
      fx = kx * px; fy = ky * px;
      css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
    }
    foe.set(css);
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<BoomerangCue | FormationCue> = new Sequence<BoomerangCue | FormationCue>({
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
    scene,
    get mirrorsCamera() { return ocam.on; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
