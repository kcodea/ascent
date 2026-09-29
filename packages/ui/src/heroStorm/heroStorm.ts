/**
 * THE STORM CALL RUNNER: plays one Storm Call hero attack (the beats are in `heroStormConfig.ts`) and lands the
 * consequence on its impact beat (the Small arc, the Medium second branch, or the Big strike). Presentation only: the
 * total it shows and the blow it lands are handed in, already decided by the engine.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera, the portraits (transform only, restored after), the voices, the
 * dim, reduced motion, finish / cancel and the safety timer. What is Storm Call's own: the bolt geometry, the fork, the
 * cloud, the static jitter, its camera and its sound.
 *
 * THE CAMERA IS APPLIED ONCE (as Card Shark, see `../heroCards/heroCards.ts`): the Pixi root mirrors the DOM camera only
 * when its canvas is NOT already inside the camera element.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; strips and sprites are pooled and capped, bolt vertices rewritten in place, textures painted once
 * per session and pre-warmed during the formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { canvasInCamera } from '../heroAttack/cameraMirror';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  getHeroStormConfig, stormArrivalDir, stormCameraAt, stormCameraFocus, stormCues, stormGeometry, stormPlan,
  type HeroStormConfig, type StormCue, type StormGeo, type StormPlan,
} from './heroStormConfig';
import { HeroStormScene, type HeroStormTextures } from './heroStormScene';
import { heroStormTextures } from './heroStormTextures';

export interface HeroStormOptions extends HeroAttackOptions {
  cfg?: HeroStormConfig;
  textures?: HeroStormTextures | null;
}

export interface HeroStormHandle extends HeroAttackHandle {
  readonly plan: StormPlan;
  /** Every bolt's ends, the cloud and the strike points (empty under reduced motion). */
  readonly geo: StormGeo;
  readonly scene: HeroStormScene | null;
}

/** The seed a fight's crackle is drawn from: the same fight (same blow, same geometry) crackles the same way. */
export function stormSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 4969 + Math.round(distance) * 53 + (side === 'opp' ? 401 : 29)) >>> 0;
}

/** The static jitter of a struck portrait: a fixed stutter (a new offset every 30 ms), deterministic. Unit square. */
export function staticJitter(t: number): { x: number; y: number } {
  const q = Math.floor(t / 30);
  const h = (k: number): number => { const s = Math.sin(q * 12.9898 + k * 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
  return { x: h(1), y: h(2) };
}

/** Play Storm Call. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroStorm(o: HeroStormOptions): HeroStormHandle {
  const c = o.cfg ?? getHeroStormConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = stormPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, stormCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hstorm',
  });

  // The view (measured once, at the start): the cloud stays inside it and the Big flash covers it.
  const view = local ? { w: o.host?.clientWidth || 400, h: o.host?.clientHeight || 300 } : { w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 };
  const geo = stormGeometry(plan, o.attacker, o.defender, radius, aRadius, c, s, view);
  const dir = stormArrivalDir(plan, geo, o.attacker, o.defender);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();

  // ── Pixi ──
  const textures = o.textures !== undefined ? o.textures : heroStormTextures();
  const scene = textures && !reduced
    ? new HeroStormScene(textures, {
      core: hexToNum(c.colorCore), bolt: hexToNum(c.colorBolt), violet: hexToNum(c.colorViolet), cloud: hexToNum(c.colorCloud), side: hexToNum(sideHex),
    }, { width: c.boltWidth, glow: c.glowWidth, regenMs: c.regenMs, fadeMs: c.fadeMs }, s, stormSeed(o.total, dist, o.side))
    : null;
  scene?.setView(view.w, view.h);
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
  voices.warm([c.sfxChargeClip, c.sfxZapClip, c.sfxCrackClip, c.sfxImpactClip, c.sfxStaticClip, c.sfxCallClip, c.sfxRumbleClip, c.sfxThunderClip]);
  const strikePt = geo.strikes[geo.strikes.length - 1] ?? o.defender;
  const releases = plan.bolts.filter((b) => b.kind !== 'branch').map((b) => b.at);

  const fire = (q: StormCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // Static gathers on the hero: a rising charge hum and crackles round its rim.
        cue(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate, { lenMs: 700, fadeMs: 250 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, aRadius, plan.boltAt - plan.chargeAt, c.chargeArcs);
        mirrorOn = !canvasInCamera(cameraEl, !!o.mount);
        cam.start();
        break;
      case 'bolt': {
        const b = plan.bolts[q.i]!;
        const g = geo.bolts[q.i];
        if (b.kind === 'call') cue(c.sfxCallClip, c.sfxCallGain, c.sfxCallRate, { lenMs: 600, fadeMs: 220 });
        else if (b.kind !== 'branch') cue(c.sfxCrackClip, c.sfxCrackGain * 0.7, c.sfxCrackRate + 0.1, { lenMs: 260, fadeMs: 100 });
        if (g && scene) scene.bolt(b.kind, g, { leaderMs: b.leaderMs, holdMs: b.holdMs, width: b.width, jag: b.jag, forks: b.forks, late: t - q.at });
        break;
      }
      case 'gather':
        // The storm gathers over the target: a low rumble under it.
        cue(c.sfxRumbleClip, c.sfxRumbleGain * 0.7, c.sfxRumbleRate, { lenMs: 1400, fadeMs: 600 });
        if (geo.cloud && scene) scene.gather(geo.cloud.x, geo.cloud.y, geo.cloudR, c.gatherMs);
        break;
      case 'rumble':
        cue(c.sfxRumbleClip, c.sfxRumbleGain * (0.8 + 0.2 * q.i), c.sfxRumbleRate + 0.05 * q.i, { lenMs: 900, fadeMs: 400 });
        scene?.rumble();
        break;
      case 'hit': {
        // The first branch strikes: a zap, FX only; static starts crawling over the struck hero.
        const p = geo.strikes[0] ?? o.defender;
        cue(c.sfxZapClip, c.sfxZapGain * 0.8, c.sfxZapRate, { lenMs: 450, fadeMs: 160 });
        cue(c.sfxStaticClip, c.sfxStaticGain, c.sfxStaticRate, { lenMs: 500, fadeMs: 200 });
        scene?.zap(p.x, p.y, radius, plan.sparks);
        scene?.crawl(o.defender.x, o.defender.y, radius, plan.staticEnd - plan.staticAt, c.staticArcs);
        break;
      }
      case 'impact':
        if (plan.storm) {
          // THE STRIKE: thunder, a hard zap and the impact.
          cue(c.sfxThunderClip, c.sfxThunderGain, c.sfxThunderRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs * 1.4, fadeMs: 500 });
          cue(c.sfxZapClip, c.sfxZapGain, c.sfxZapRate - 0.2, { lenMs: 600, fadeMs: 200 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.1, { lenMs: c.sfxImpactLenMs, fadeMs: 300 });
          cue(c.sfxStaticClip, c.sfxStaticGain * 1.3, c.sfxStaticRate - 0.2, { lenMs: 700, fadeMs: 300 });
          scene?.crawl(o.defender.x, o.defender.y, radius, plan.staticEnd - plan.staticAt, c.staticArcs + 1);
        } else {
          cue(c.sfxZapClip, c.sfxZapGain, c.sfxZapRate - 0.1 * (plan.level - 1), { tail: c.sfxTailMix, lenMs: 600, fadeMs: 200 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.1 * plan.level), c.sfxImpactRate, { lenMs: c.sfxImpactLenMs, fadeMs: 300 });
          if (plan.level >= 2) cue(c.sfxCrackClip, c.sfxCrackGain, c.sfxCrackRate, { lenMs: 600, fadeMs: 220 });
          else scene?.crawl(o.defender.x, o.defender.y, radius, 300, 1);
        }
        scene?.strike(strikePt.x, strikePt.y, radius, { level: plan.level, burst: plan.burst, sparks: plan.sparks, flashAlpha: c.flashAlpha, screen: c.screenFlash });
        seq.land();
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.storm ? plan.rumbleAt : plan.boltAt, plan.impactAt + (plan.storm ? 380 : 200));
    const cm = stormCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(stormCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The charge: a lean back and a little swell; every bolt the hero throws (or the call) thrusts it forward.
      let sc = 1, bx = 0, by = 0;
      if (t < plan.boltAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.boltAt - plan.chargeAt));
        sc = 1 + 0.035 * u;
        bx = -toFoe.x * c.heroCoilPx * px * u; by = -toFoe.y * c.heroCoilPx * px * u;
        // A faint hum of static in the hero as it charges.
        const j = staticJitter(t);
        bx += j.x * 0.8 * u * px; by += j.y * 0.8 * u * px;
      } else {
        const back = Math.max(0, spring(t - plan.boltAt, 3, 90));
        sc = 1 + 0.035 * back;
        bx = -toFoe.x * c.heroCoilPx * px * back; by = -toFoe.y * c.heroCoilPx * px * back;
        for (const at of releases) {
          if (at > t) continue;
          const f = c.heroThrustPx * px * spring(t - at, 5, 60);
          if (plan.storm && at === plan.boltAt) by -= f; // the call: the hero thrusts UP at the sky
          else { bx += toFoe.x * f; by += toFoe.y * f; }
        }
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let css: string | null = null;
      let sx = 1, sy = 1;
      if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.5 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        fx = dir.x * knock; fy = dir.y * knock;
        if (Math.abs(k) >= 0.004) { sx = 1 - sq; sy = 1 + sq * 0.6; }
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        let k = 0;
        for (const at of plan.hits) k += at <= t ? Math.max(0, spring(t - at, 6, 45)) : 0;
        fx = dir.x * k * 6 * px; fy = dir.y * k * 6 * px;
      }
      // STATIC: the struck portrait jitters (a fixed stutter) while static crawls over it.
      if (t >= plan.staticAt && t < plan.staticEnd) {
        const env = 1 - clamp01((t - plan.staticAt) / Math.max(1, plan.staticEnd - plan.staticAt));
        const j = staticJitter(t);
        fx += j.x * c.jitterPx * env * px; fy += j.y * c.jitterPx * env * px;
      }
      if (Math.abs(fx) + Math.abs(fy) >= 0.05 || sx !== 1) css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)${sx !== 1 ? ` scale(${sx.toFixed(4)}, ${sy.toFixed(4)})` : ''}`;
      foe.set(css);
    }
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<StormCue | FormationCue> = new Sequence<StormCue | FormationCue>({
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
    geo,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
