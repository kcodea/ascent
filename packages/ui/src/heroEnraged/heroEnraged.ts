/**
 * THE ENRAGED STRIKE RUNNER: plays one Enraged Strike (the beats are in `heroEnragedConfig.ts`) and lands the
 * consequence on its impact beat (the last strike, or Tier IV's meteor). Presentation only: the total it shows and the
 * blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock with a hit-stop,
 * the damage formation, the `#stage` camera mirrored onto the Pixi root, the portraits (transform only, restored after),
 * the voices, the dim, reduced motion, finish / cancel and the safety timer. What is its own: the lunge itself (Classic's
 * silhouette, the hero PORTRAIT drives into the foe), the aura, the afterimages, the strikes and the meteor.
 *
 * THE STRIKE CONTRACT: every strike before the last is a tick (FX, a short hit-stop and a sound). The consequence
 * (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last strike (Tier IV: on the meteor).
 *
 * THE PORTRAIT MOVES IN SCREEN SPACE. The pose is solved in screen px (the same space as the Pixi overlay), then written
 * as a transform in the portrait's own units: the scale of its ancestors is measured ONCE at the start (a scaled stage,
 * the foe frame's tuner scale). The foe's portrait is a <body> portal outside the `#stage` camera, so when it is the one
 * lunging, the camera's zoom and shake are folded into its own transform, and it stays glued to its afterimages.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites are pooled per layer, textures painted once per session and pre-warmed during the
 * formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playEmberCrackle, playRageTone, playRumble } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  enragedCameraAt, enragedCameraFocus, enragedCues, enragedGeo, enragedPlan, enragedPose, getHeroEnragedConfig,
  type EnragedCue, type EnragedGeo, type EnragedPlan, type HeroEnragedConfig, type HeroPose,
} from './heroEnragedConfig';
import { HeroEnragedScene, type HeroAt, type HeroEnragedTextures } from './heroEnragedScene';
import { heroEnragedTextures, portraitGhostTexture } from './heroEnragedTextures';

export interface HeroEnragedOptions extends HeroAttackOptions {
  cfg?: HeroEnragedConfig;
  textures?: HeroEnragedTextures | null;
}

export interface HeroEnragedHandle extends HeroAttackHandle {
  readonly plan: EnragedPlan;
  readonly geo: EnragedGeo;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroEnragedScene | null;
  /** The striking hero's pose at a sequence time (pure). */
  pose(t: number): HeroPose;
}

/** The seed a fight's sparks are scattered from: the same fight (same blow, same geometry) throws the same sparks. */
export function enragedSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 41 + (side === 'opp' ? 173 : 9)) >>> 0;
}

/** Screen px per the element's own transform px (its ancestors' scale), measured once. 1 when it cannot be read. */
function unitOf(el: HTMLElement | null | undefined): number {
  if (!el) return 1;
  try {
    const w = el.offsetWidth;
    const r = el.getBoundingClientRect().width;
    return w > 0 && r > 0 ? r / w : 1;
  } catch { return 1; }
}

/** Play the Enraged Strike. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroEnraged(o: HeroEnragedOptions): HeroEnragedHandle {
  const c = o.cfg ?? getHeroEnragedConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = enragedPlan({ total: o.total, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, enragedCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // The Tier IV rise never lifts the hero off the top of the screen (or the sandbox box).
  const geo = enragedGeo(o.attacker, o.defender, aRadius, radius, c, (local ? 4 : 24) * s);
  const pose = (t: number): HeroPose => enragedPose(plan, geo, c, t);
  const first = plan.strikes[0];

  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'henraged',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the aura ignites) ──
  const textures = o.textures !== undefined ? o.textures : heroEnragedTextures();
  const scene = textures && !reduced
    ? new HeroEnragedScene(textures, {
      core: hexToNum(c.colorCore), hot: hexToNum(c.colorHot), side: hexToNum(sideHex), shade: hexToNum(c.colorShade), smoke: hexToNum(c.colorSmoke),
    }, {
      auraSize: c.auraSize, flames: c.flames, flameLength: c.flameLength, ghosts: c.ghosts, ghostStepMs: c.ghostStepMs, ghostAlpha: c.ghostAlpha,
      wakeWidth: c.wakeWidth, wakeMs: c.wakeMs, ringSize: c.ringSize, ring2Size: c.ring2Size, slashLength: c.slashLength, slashWidth: c.slashWidth,
      sparkSpeed: c.sparkSpeed, emberLife: c.emberLife, craterSize: c.craterSize, debris: c.debris,
    }, s, enragedSeed(o.total, dist, o.side))
    : null;
  if (scene) {
    const heroAt = (t: number): HeroAt => { const p = pose(t); return { x: o.attacker.x + p.x, y: o.attacker.y + p.y, s: p.scale, heat: p.heat }; };
    const img = o.attackerEl?.querySelector?.('img') ?? null;
    scene.setHero(heroAt, aRadius, portraitGhostTexture(img as HTMLImageElement | null));
  }
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits (their ancestors' scale and whether the camera carries them, measured once) ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const heroUnit = local ? 1 : unitOf(hero.el);
  const foeUnit = local ? 1 : unitOf(foe.el);
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));
  // Raise the striking portrait over the struck one for the lunge (Classic's own duel z-order classes).
  const zClass = o.side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player';
  const lift = !reduced && !local && !!hero.el && !!doc;
  let lifted = false;

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxRoarClip, c.sfxWindupClip, c.sfxChargeClip, c.sfxWhooshClip, c.sfxTickClip, c.sfxSlashClip, c.sfxImpactClip,
    c.sfxPunchClip, c.sfxThumpClip, c.sfxBigClip, c.sfxMeteorClip, c.sfxDebrisClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const heroScreen = (t: number): Pt => { const p = pose(t); return { x: o.attacker.x + p.x, y: o.attacker.y + p.y }; };

  const fire = (q: EnragedCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The rage builds: a riser whose climax lands on the first drive; the other buses dip.
        if (first) voices.riser(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate, real((plan.meteor ? plan.apexAt : first.driveAt) - plan.chargeAt));
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'windup': {
        // Classic's windup clip, a roar, and the growl rising to the drive (IV: to the top of the rise).
        const buildTo = plan.meteor ? plan.apexAt : (first?.driveAt ?? plan.impactAt);
        cue(c.sfxWindupClip, c.sfxWindupGain, c.sfxWindupRate);
        cue(c.sfxRoarClip, c.sfxRoarGain * (0.85 + 0.15 * plan.tier / 2), c.sfxRoarRate - 0.08 * plan.k, { lenMs: 1400, fadeMs: 400, delayMs: real(60) });
        voices.keep(playRageTone('attack', { gain: c.sfxToneGain * (0.8 + 0.3 * plan.k), buildMs: real(buildTo - plan.windupAt), lowHz: c.sfxToneLowHz, highHz: c.sfxToneHighHz * (1 + 0.25 * plan.k) }));
        voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain * 0.6, durMs: real(buildTo - plan.windupAt + 400) }));
        scene?.startWindup(plan.aura, c.dust * (plan.meteor ? 1.6 : 1), buildTo - plan.windupAt);
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      }
      case 'rise':
        // The meteor gathers: a rumble building to the apex, the aura becomes a fireball.
        voices.keep(playRumble('attack', { gain: c.sfxRumbleGain, buildMs: real(plan.apexAt - plan.riseAt), holdMs: real(Math.max(0, plan.impactAt - plan.apexAt)), tailMs: 250, lowHz: 55, highHz: 420 }));
        scene?.rise();
        break;
      case 'drive': {
        const st = plan.strikes[q.i]!;
        // The dash: a whoosh, each a little higher (the meteor lower and heavier); speed lines along the line of it.
        cue(c.sfxWhooshClip, c.sfxWhooshGain * (st.final ? 1 : 0.8), st.meteor ? c.sfxWhooshRate * 0.8 : c.sfxWhooshRate + 0.06 * q.i, { lenMs: 700, fadeMs: 250 });
        const from = heroScreen(t);
        const to = { x: o.attacker.x + geo.contact.x, y: o.attacker.y + geo.contact.y };
        const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        scene?.drive(from, { x: (to.x - from.x) / len, y: (to.y - from.y) / len }, len, Math.round(c.speedLines * (st.final ? 1 : 0.6) * (st.meteor ? 1.5 : 1)), st.meteor);
        break;
      }
      case 'tick':
        // A strike before the last: a hard smack and a rip (pitched up each time), a short freeze. FX only.
        cue(c.sfxTickClip, c.sfxTickGain, c.sfxTickRate + 0.05 * q.i);
        cue(c.sfxSlashClip, c.sfxSlashGain * 0.8, c.sfxSlashRate + 0.08 * q.i, { lenMs: 500, fadeMs: 180 });
        cue(c.sfxPunchClip, c.sfxPunchGain * 0.6, c.sfxPunchRate + 0.05 * q.i);
        scene?.tick(o.defender.x, o.defender.y, geo.u, radius, q.i, plan.k);
        seq.hitStop(Math.round(plan.hitStopMs * 0.4));
        break;
      case 'impact': {
        // THE BLOW: a heavy hammer, a punch, a low (tight, never boomy) thump, a rip; a crack on the big tiers; the meteor
        // adds a ground impact. Embers crackle on while the foe smoulders.
        const k = plan.k;
        cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.15 * k), c.sfxImpactRate - 0.04 * k, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
        cue(c.sfxPunchClip, c.sfxPunchGain, c.sfxPunchRate - 0.03 * k);
        cue(c.sfxThumpClip, c.sfxThumpGain * (0.8 + 0.3 * k), c.sfxThumpRate, { lenMs: 700, fadeMs: 250 });
        if (plan.slashes > 0) cue(c.sfxSlashClip, c.sfxSlashGain, c.sfxSlashRate - 0.05 * k, { lenMs: 600, fadeMs: 200 });
        if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
        if (plan.meteor) cue(c.sfxMeteorClip, c.sfxMeteorGain, c.sfxMeteorRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs * 1.3, fadeMs: 500 });
        voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain, durMs: real(c.smoulderMs + 300) }));
        const vw = local ? (host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
        const vh = local ? (host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
        const u = plan.meteor ? meteorDir() : geo.u;
        scene?.impact(o.defender.x, o.defender.y, u, radius, {
          k, burst: plan.burst, sparks: plan.sparks, embers: plan.embers, slashes: plan.slashes, flashAlpha: c.flashAlpha,
          meteor: plan.meteor, smoulderMs: c.smoulderMs, screen: Math.hypot(vw, vh),
        });
        seq.hitStop(plan.hitStopMs);
        seq.land();
        break;
      }
      case 'boom': {
        const a = q.i * 2.1 + 0.9;
        const rr = radius * (1.3 + 0.35 * (q.i % 2));
        cue(c.sfxDebrisClip, c.sfxDebrisGain, c.sfxDebrisRate + q.i * 0.07, { lenMs: 500, fadeMs: 200 });
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr * 0.6, 0.9 + 0.12 * q.i);
        break;
      }
      case 'recover':
        scene?.recover();
        break;
      default:
        break;
    }
  };

  /** The meteor's slam direction (the apex to the contact): the shake, the sparks and the bow ring follow it. */
  function meteorDir(): Pt {
    const dx = geo.contact.x - geo.apex.x, dy = geo.contact.y - geo.apex.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  }
  const shakeDir = plan.meteor ? meteorDir() : geo.u;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.windupAt, first ? first.driveAt : plan.impactAt, plan.impactAt + 300);
    const cm = enragedCameraAt(plan, c, t, shakeDir);
    const focus = enragedCameraFocus(plan, t, o.attacker, o.defender);
    const unitS = local ? 1 : s;
    cam.apply(focus, cm.zoom, cm.x, cm.y, unitS);
    // The camera's screen offset (what `#stage` is translated by): a portrait OUTSIDE it folds it in by hand.
    const ax = focus.x * (1 - cm.zoom) + cm.x * unitS, ay = focus.y * (1 - cm.zoom) + cm.y * unitS;
    const place = (at: Pt, off: Pt, inCam: boolean): Pt => (inCam || !cam.active
      ? off
      : { x: off.x * cm.zoom + at.x * (cm.zoom - 1) + ax, y: off.y * cm.zoom + at.y * (cm.zoom - 1) + ay });
    if (hero.el) {
      const p = pose(t);
      const moved = Math.abs(p.x) > 0.05 || Math.abs(p.y) > 0.05 || Math.abs(p.scale - 1) > 1e-4 || Math.abs(p.rot) > 0.01;
      const off = place(o.attacker, p, heroInCam);
      const sc = p.scale * (heroInCam || !cam.active ? 1 : cm.zoom);
      hero.set(!moved && !cam.active ? null
        : `translate(${(off.x / heroUnit).toFixed(2)}px, ${(off.y / heroUnit).toFixed(2)}px) rotate(${p.rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`);
    }
    scene?.follow(t);
    if (foe.el) {
      // Each tick nudges the foe along the blow; THE impact knocks it back hard and squashes it (the meteor: down).
      let kx = 0, ky = 0, sq = 0;
      const px = local ? 0.45 : 1;
      for (const at of plan.ticks) if (t >= at) { const k = Math.max(0, spring(t - at, 6, 50)); kx += geo.u.x * k * 12 * px; ky += geo.u.y * k * 12 * px; sq += k * c.squash * 0.35; }
      if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, 4, 95);
        const knock = c.knockPx * (0.8 + 0.5 * plan.k) * (plan.meteor ? 0.7 : 1) * k * px;
        kx += shakeDir.x * knock; ky += shakeDir.y * knock;
        sq += c.squash * (0.8 + 0.5 * plan.k) * (plan.meteor ? 1.4 : 1) * k;
      }
      const off = place(o.defender, { x: kx, y: ky }, foeInCam);
      const z = foeInCam || !cam.active ? 1 : cm.zoom;
      const still = Math.abs(kx) < 0.05 && Math.abs(ky) < 0.05 && Math.abs(sq) < 0.002;
      foe.set(still && !cam.active ? null
        : `translate(${(off.x / foeUnit).toFixed(2)}px, ${(off.y / foeUnit).toFixed(2)}px) scale(${((1 + sq * 0.55) * z).toFixed(4)}, ${((1 - sq) * z).toFixed(4)})`);
    }
  };

  const seq: Sequence<EnragedCue | FormationCue> = new Sequence<EnragedCue | FormationCue>({
    cues, speed, fire, freezeKinds: ['impact', 'tick'],
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? (plan.endAt + plan.hitStopMs * 2) / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      if (lifted) { doc!.body.classList.remove(zClass); lifted = false; }
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    scene,
    pose,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
