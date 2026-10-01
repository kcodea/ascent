/**
 * THE FEL RUNNER: plays one Fel ("Chaos Bolt") hero attack (the beats are in `heroFelConfig.ts`) and lands the
 * consequence on its impact beat (the last bolt bursting, or Tier IV's eruption). Presentation only: the total it shows
 * and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never pauses),
 * the damage formation, the `#stage` camera (on the FX once: stageCamera.ts), the portraits (transform only, restored
 * after), the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE VOLLEY CONTRACT: every bolt that lands before the last is a tick (FX and a crackle of sound only). The consequence
 * (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last bolt (Tier IV: on the eruption).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites and fire particles are pooled with hard caps, textures painted once per session and
 * pre-warmed during the formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playEmberCrackle, playRumble } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  boltMotions, felArrivalDir, felCameraAt, felCameraFocus, felCues, felMeteorMotion, felPlan, getHeroFelConfig,
  type BoltMotion, type FelCue, type FelMeteorMotion, type FelPlan, type HeroFelConfig,
} from './heroFelConfig';
import { HeroFelScene, type HeroFelTextures } from './heroFelScene';
import { heroFelTextures } from './heroFelTextures';

export interface HeroFelOptions extends HeroAttackOptions {
  cfg?: HeroFelConfig;
  textures?: HeroFelTextures | null;
}

export interface HeroFelHandle extends HeroAttackHandle {
  readonly plan: FelPlan;
  /** Every bolt's life (empty under reduced motion). */
  readonly motions: readonly BoltMotion[];
  /** The Tier IV chaos meteor's fall (null below Tier IV and under reduced motion). */
  readonly meteor: FelMeteorMotion | null;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroFelScene | null;
}

/** The seed a fight's fel fire is scattered from: the same fight burns the same fire. */
export function felSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6271 + Math.round(distance) * 53 + (side === 'opp' ? 409 : 23)) >>> 0;
}

/** Play Fel. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroFel(o: HeroFelOptions): HeroFelHandle {
  const c = o.cfg ?? getHeroFelConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = felPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, felCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const px = local ? 0.45 : 1;
  const ceilY = local ? 8 * s : 0;
  const motions = boltMotions(plan, o.attacker, o.defender, aRadius, radius, c, s * px, ceilY);
  const meteor = felMeteorMotion(plan, o.attacker, o.defender, radius, c, 0);
  const last = motions[motions.length - 1];
  const dir = plan.hand && meteor ? meteor.dir : felArrivalDir(last, o.attacker, o.defender);
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const screen = Math.max(vw, vh);

  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hfel',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first bolt) ──
  const textures = o.textures !== undefined ? o.textures : heroFelTextures();
  const scene = textures && !reduced
    ? new HeroFelScene(textures, {
      core: hexToNum(c.colorCore), hot: hexToNum(c.colorHot), fel: hexToNum(c.colorFel), deep: hexToNum(c.colorDeep),
      ember: hexToNum(c.colorEmber), smoke: hexToNum(c.colorSmoke), shell: hexToNum(c.colorShell), rune: hexToNum(c.colorRune),
      side: hexToNum(sideHex),
    }, {
      kindle: c.kindle, sigilSize: c.sigilSize, motes: c.motes, boltFlame: c.boltFlame, boltGlow: c.boltGlow, shell: c.shell,
      crackle: c.crackle, trail: c.trail, trailSmoke: c.trailSmoke, turbulence: c.turbulence, buoyancy: c.buoyancy, smoke: c.smoke,
      embers: c.embers, impactSize: c.impactSize, shards: c.shards, burnSize: c.burnSize, gateSize: c.gateSize, eruptMs: c.eruptMs,
      eruptHeight: c.eruptHeight, burnoutMs: c.burnoutMs, ash: c.ash, scorch: c.scorch,
    }, s * px, felSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o));
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxGatherClip, c.sfxFormClip, c.sfxLaunchClip, c.sfxWhooshClip, c.sfxHitClip, c.sfxBlastClip, c.sfxImpactClip,
    c.sfxThumpClip, c.sfxBigClip, c.sfxGateClip, c.sfxMeteorClip, c.sfxEruptClip, c.sfxShatterClip, c.sfxBoomClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const n = plan.bolts.length;
  const d = o.defender;
  let hitStep = 0;

  const fire = (q: FelCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        // The gather: a dark, rising draw of power and a fel crackle through it.
        cue(c.sfxGatherClip, c.sfxGatherGain, c.sfxGatherRate, { lenMs: 1100, fadeMs: 380 });
        if (sound) voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain * 0.5, durMs: real(plan.fireAt - plan.chargeAt + 200) }));
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, aRadius, plan.fireAt - plan.chargeAt, n);
        cam.start();
        break;
      case 'grow': {
        const great = plan.bolts[q.i]?.great;
        cue(c.sfxFormClip, c.sfxFormGain * (great ? 1.3 : 0.7 + 0.3 / n), c.sfxFormRate + (great ? -0.1 : 0.06 * q.i), { lenMs: great ? 900 : 520, fadeMs: 220 });
        const m = motions[q.i];
        if (m) scene?.grow(m, Math.min(1, 1.3 / Math.sqrt(n)));
        break;
      }
      case 'fire': {
        // The release: a fel spike (a step higher each; the great bolt lower and heavier) and a whoosh.
        const great = plan.bolts[q.i]?.great;
        cue(c.sfxLaunchClip, c.sfxLaunchGain * (great ? 1.2 : q.i === n - 1 ? 1 : 0.8), c.sfxLaunchRate + (great ? -0.12 : 0.05 * q.i), { lenMs: 900, fadeMs: 300 });
        cue(c.sfxWhooshClip, c.sfxWhooshGain * (great ? 1.2 : 1), c.sfxWhooshRate + 0.04 * q.i, { lenMs: 600, fadeMs: 240 });
        const m = motions[q.i];
        if (m) scene?.fireBolt(m);
        break;
      }
      case 'hit': {
        const m = motions[q.i];
        cue(c.sfxHitClip, c.sfxHitGain, c.sfxHitRate + 0.06 * hitStep, { lenMs: 600, fadeMs: 240 });
        if (m && scene) {
          scene.land(m);
          scene.impact(m.to.x, m.to.y, radius, { size: 0.8 + 0.1 * plan.k, big: false, dir: felArrivalDir(m, o.attacker, d), flashAlpha: c.flashAlpha, embers: Math.round(plan.embers * 0.3) });
          if (plan.burn > 0 && !plan.hand) scene.burn(d.x, d.y, radius, plan.burn * (0.2 + 0.1 * hitStep), 240 + 60 * hitStep);
        }
        hitStep++;
        break;
      }
      case 'gate':
        // THE HAND: the rune circle opens over the target with an implosion; a rumble builds under the fall.
        cue(c.sfxGateClip, c.sfxGateGain, c.sfxGateRate, { lenMs: 1400, fadeMs: 400 });
        if (sound) {
          voices.keep(playRumble('attack', {
            gain: c.sfxRoarGain, buildMs: real(plan.impactAt - plan.gateAt), holdMs: real(80), tailMs: real(900),
            lowHz: c.sfxRoarLowHz, highHz: c.sfxRoarHighHz,
          }));
        }
        scene?.openGate(d.x, d.y, radius, plan.impactAt - plan.gateAt);
        break;
      case 'meteor':
        voices.riser(c.sfxMeteorClip, c.sfxMeteorGain, c.sfxMeteorRate, real(plan.impactAt - plan.meteorAt));
        if (meteor) scene?.startMeteor(meteor);
        break;
      case 'impact':
        if (plan.hand) {
          // THE ERUPTION: the ground-shaking boom, the fel blast, the circle shattering, a skull-crack and a punch.
          cue(c.sfxEruptClip, c.sfxEruptGain, c.sfxEruptRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxBlastClip, c.sfxBlastGain * 1.1, c.sfxBlastRate - 0.08, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.08, { lenMs: 900, fadeMs: 300 });
          cue(c.sfxShatterClip, c.sfxShatterGain, c.sfxShatterRate, { lenMs: 900, fadeMs: 300 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.15, c.sfxBigRate - 0.05, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxThumpClip, c.sfxThumpGain * 1.1, c.sfxThumpRate - 0.05, { lenMs: 500, fadeMs: 180 });
          if (sound) voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain, durMs: real(c.eruptMs + c.burnoutMs) }));
          scene?.erupt(d.x, d.y, radius, { burst: plan.burst, flashAlpha: c.flashAlpha, embers: plan.embers, screen });
          // Lingering fel flames on the struck rim after the pillar.
          scene?.burn(d.x, d.y, radius, plan.burn, Math.min(plan.burnMs, Math.max(0, plan.endAt - plan.impactAt - 100)));
        } else {
          const great = plan.bolts[n - 1]?.great ?? false;
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate - (great ? 0.08 : 0), { lenMs: 900, fadeMs: 300 });
          cue(c.sfxBlastClip, c.sfxBlastGain * (0.8 + 0.06 * plan.tier), c.sfxBlastRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 500, fadeMs: 180 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          if (sound && plan.burn > 0) voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain * Math.min(1, plan.burn), durMs: real(plan.burnMs + 600) }));
          if (last && scene) {
            scene.land(last);
            scene.impact(last.to.x, last.to.y, radius, { size: (1.05 + 0.1 * plan.tier) * (great ? 1.25 : 1), big: true, dir, flashAlpha: c.flashAlpha, embers: plan.embers });
          }
          if (great) scene?.flareUp(d.x, d.y, radius, Math.min(1.4, plan.burn));
          scene?.burn(d.x, d.y, radius, plan.burn, Math.min(plan.burnMs, Math.max(0, plan.endAt - plan.impactAt - 100)));
        }
        seq.land();
        break;
      case 'boom': {
        const a = q.i * 2.3 + 0.9;
        const rr = radius * (0.8 + 0.2 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.1, { lenMs: 420, fadeMs: 180 });
        scene?.boom(d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr * 0.8, radius, 0.9 + 0.15 * q.i);
        break;
      }
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.hand ? 420 : 200));
    const cm = felCameraAt(plan, c, t, dir);
    cam.apply(felCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, local ? 1 : s);
    const aim = felArrivalDir(undefined, o.attacker, o.defender);
    if (hero.el && t >= plan.chargeAt) {
      // Swell while the power gathers; a sharp recoil along the line on each release; Tier IV: a lift as the hand
      // calls the circle down on the target.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.fireAt) sc = 1 + c.heroSwell * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      else sc = 1 + c.heroSwell * Math.max(0, spring(t - plan.fireAt, 4, 70));
      for (const r of plan.bolts) {
        const k = r.launchAt <= t ? Math.max(0, spring(t - r.launchAt, 3.5, 55)) : 0;
        const big = r.great ? 1.6 : 1;
        bx -= aim.x * c.recoilPx * px * k * big; by -= aim.y * c.recoilPx * px * k * big;
      }
      if (plan.hand && t >= plan.gateAt) {
        const k = Math.max(0, spring(t - plan.gateAt, 3, 110));
        sc += c.heroSwell * 1.3 * k;
        by -= 10 * px * k;
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    if (foe.el) {
      let css: string | null = null;
      if (plan.hand && t >= plan.gateAt && t < plan.impactAt) {
        // The circle has it: it trembles harder as the meteor nears (the clock never stops).
        const u = clamp01((t - plan.gateAt) / Math.max(1, plan.impactAt - plan.gateAt));
        const a = (0.3 + 2.6 * u * u) * px;
        css = `translate(${(a * Math.sin(t * 0.47)).toFixed(2)}px, ${(a * Math.sin(t * 0.53)).toFixed(2)}px)`;
      } else if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${(dir.x * knock).toFixed(2)}px, ${(dir.y * knock).toFixed(2)}px) scale(${(1 + sq * 0.6).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        css = k < 0.004 ? null : `translate(${(aim.x * k * 6 * px).toFixed(2)}px, ${(aim.y * k * 6 * px).toFixed(2)}px)`;
      }
      foe.set(css);
    }
  };

  const seq: Sequence<FelCue | FormationCue> = new Sequence<FelCue | FormationCue>({
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
    meteor,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
