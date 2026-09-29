/**
 * THE BACKSTAB RUNNER (a Rare hero attack): plays one Backstab (the beats are in `heroBackstabConfig.ts`) and lands the
 * consequence on its impact beat (the stab from behind). Presentation only: the total and the blow are the engine's;
 * this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses), the damage formation, the
 * `#stage` camera (applied ONCE: `stageCamera.ts`), the voices, the dim, reduced motion, finish / cancel and the safety
 * timer. Big opens with CLASSIC'S OWN LUNGE (`classicSwing`: the same coil, contact geometry and strike ease).
 *
 * THE PORTRAIT MOVES (as Classic and Enraged do): its pose is solved in screen px and written as a transform in the
 * portrait's own units (its ancestors' scale measured ONCE at the start), plus its OPACITY for the vanishes. The foe's
 * portrait is a <body> portal outside the `#stage` camera, so when it is the striker the camera's zoom and shake are
 * folded into its own transform. The striker is raised over the target for the whole attack (Classic's
 * `.duel-attacker-*` z-order). EVERY exit path (the end, `finish()`, `cancel()`, the safety timer) restores its
 * transform, its opacity and the z-order class exactly.
 *
 * THE CONTRACT: every hit before the last is a tick (FX and sound only). The consequence (`onImpact`) lands exactly
 * ONCE, on the stab from behind. The smoke home and the settle come after it and are looks only.
 *
 * Perf: DOM writes are `transform` / `opacity` from the clock; layout is read once at the start; pooled sprites under a
 * hard cap, textures painted once per session and pre-warmed during the formation; the updater unhooks the moment the
 * scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { classicSwing } from '../heroAttack/heroClassic';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  backstabCameraAt, backstabCues, backstabGeo, backstabPlan, backstabPose, getHeroBackstabConfig, hitDirs,
  type BackstabCue, type BackstabGeo, type BackstabPlan, type BackstabPose, type HeroBackstabConfig, type LungeGeo, type Spot,
} from './heroBackstabConfig';
import { HeroBackstabScene, type HeroBackstabTextures } from './heroBackstabScene';
import { heroBackstabTextures } from './heroBackstabTextures';

export interface HeroBackstabOptions extends HeroAttackOptions {
  cfg?: HeroBackstabConfig;
  textures?: HeroBackstabTextures | null;
}

export interface HeroBackstabHandle extends HeroAttackHandle {
  readonly plan: BackstabPlan;
  readonly geo: BackstabGeo;
  readonly scene: HeroBackstabScene | null;
  readonly mirrorsCamera: boolean;
  /** The striking portrait's pose at a sequence time (pure). */
  pose(t: number): BackstabPose;
}

export function backstabSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 2729 + Math.round(distance) * 31 + (side === 'opp' ? 157 : 29)) >>> 0;
}

/** One measure of a portrait: its screen size, and `inv` = its own transform px per screen px. */
function rectOf(el: HTMLElement | null | undefined, r: number): { width: number; height: number; inv: number } {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { width: r * 2, height: r * 2, inv: 1 };
    return { width: b.width, height: b.height, inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  } catch { return { width: r * 2, height: r * 2, inv: 1 }; }
}

/** Play the Backstab. Returns a handle; the blow lands via `onImpact` on the stab from behind. */
export function playHeroBackstab(o: HeroBackstabOptions): HeroBackstabHandle {
  const c = o.cfg ?? getHeroBackstabConfig();
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
  // Classic's swing between these two portraits (one measure of each), for Big's opening lunge.
  const aRect = local ? { width: aRadius * 2, height: aRadius * 2, inv: 1 } : rectOf(o.attackerEl, aRadius);
  const dRect = local ? { width: radius * 2, height: radius * 2, inv: 1 } : rectOf(o.defenderEl, radius);
  const swing = classicSwing(o.attacker, o.defender, aRect, dRect, aRect.inv);
  const kInv = aRect.inv > 0 ? 1 / aRect.inv : 1;
  const lunge: LungeGeo = {
    back: { x: swing.back.x * kInv, y: swing.back.y * kInv }, strike: { x: swing.strike.x * kInv, y: swing.strike.y * kInv },
    tilt: swing.leadTilt, swell: swing.windupScale, ease: swing.strikeEase,
  };
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = backstabPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, backstabCues(plan));
  // The frame the striker must stay inside (the screen, or the sandbox box).
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const geo = backstabGeo(o.attacker, o.defender, aRadius, radius, { x0: 0, y0: 0, x1: vw, y1: vh }, lunge, c);
  const dirs = hitDirs(plan, geo);
  const pose = (t: number): BackstabPose => backstabPose(plan, geo, c, o.attacker, t);

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hbackstab',
  });

  const textures = o.textures !== undefined ? o.textures : heroBackstabTextures();
  const scene = textures && !reduced
    ? new HeroBackstabScene(textures, {
      smoke: hexToNum(c.colorSmoke), shadow: hexToNum(c.colorShadow), violet: hexToNum(c.colorViolet), teal: hexToNum(c.colorTeal),
      flash: hexToNum(c.colorFlash), side: hexToNum(sideHex),
    }, s, backstabSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  // The striker's OPACITY (the vanishes), saved at the start and restored exactly on every exit.
  const heroOpacity0 = hero.el ? hero.el.style.opacity : '';
  const setOpacity = (a: number | null): void => { if (hero.el) hero.el.style.opacity = a === null ? heroOpacity0 : a.toFixed(3); };
  const heroUnit = 1 / (aRect.inv || 1);
  const foeUnit = 1 / (dRect.inv || 1);
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));
  // Raised over the struck portrait for the whole attack (Classic's own duel z-order classes).
  const zClass = o.side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player';
  const lift = !reduced && !local && !!hero.el && !!doc;
  let lifted = false;

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxVanishClip, c.sfxAppearClip, c.sfxSlashClip, c.sfxStabClip, c.sfxLungeClip]);

  const spotOf = (i: number): Spot => (plan.blinks[i]?.spot === 'side' ? geo.side : geo.behind);
  /** Where the blade meets the face for hit `i` (the ticks, then the impact): the rim facing the striker. */
  const cutAt = (dir: Pt): Pt => ({ x: o.defender.x - dir.x * radius * 0.5, y: o.defender.y - dir.y * radius * 0.5 });
  const vanishAt = (i: number): Pt => {
    if (i === 0) return plan.lunge ? geo.lungeAt : o.attacker;
    return spotOf(i - 1).contact;
  };

  const fire = (q: BackstabCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      case 'lunge':
        cue(c.sfxLungeClip, c.sfxLungeGain, c.sfxLungeRate);
        break;
      case 'vanish': {
        cue(c.sfxVanishClip, c.sfxVanishGain, c.sfxVanishRate + 0.06 * q.i, { lenMs: 420, fadeMs: 200 });
        scene?.vanish(vanishAt(q.i), aRadius, plan.smoke);
        break;
      }
      case 'appear': {
        cue(c.sfxAppearClip, c.sfxAppearGain, c.sfxAppearRate + 0.08 * q.i, { lenMs: 260, fadeMs: 120 });
        scene?.appear(spotOf(q.i).at, aRadius, plan.smoke);
        break;
      }
      case 'strike':
        cue(c.sfxSlashClip, c.sfxSlashGain, c.sfxSlashRate + 0.05 * q.i, { startMs: 440, lenMs: 200, fadeMs: 90 });
        break;
      case 'hit': {
        // A tick: the lunge's contact, or the stab from the side. FX and sound only.
        cue(c.sfxStabClip, c.sfxStabGain * 0.75, c.sfxStabRate + 0.08 * q.i, { lenMs: 400, fadeMs: 150 });
        const d = dirs[q.i] ?? geo.u;
        scene?.slash(cutAt(d), d, 0.85 * plan.slash, false);
        break;
      }
      case 'impact': {
        cue(c.sfxStabClip, c.sfxStabGain, c.sfxStabRate - 0.05, { lenMs: 550, fadeMs: 200, tail: 0.1 });
        cue(c.sfxSlashClip, c.sfxSlashGain * 0.8, c.sfxSlashRate - 0.15, { startMs: 440, lenMs: 220, fadeMs: 100 });
        const d = dirs[dirs.length - 1] ?? geo.u;
        scene?.slash(cutAt(d), d, plan.slash, true);
        seq.land();
        break;
      }
      case 'home':
        cue(c.sfxAppearClip, c.sfxAppearGain * 0.8, c.sfxAppearRate - 0.2, { lenMs: 260, fadeMs: 120 });
        scene?.appear(o.attacker, aRadius, plan.smoke * 0.8);
        break;
      default:
        break;
    }
  };

  const allHits = [...plan.hits, plan.impactAt];

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    const firstHit = allHits[0] ?? plan.impactAt;
    nums.paintDim(t, plan.chargeAt, Math.min(firstHit, plan.fadeOutEnd), plan.impactAt + 250);
    const cm = backstabCameraAt(plan, c, t, dirs);
    const unitS = local ? 1 : s;
    const focus = o.defender;
    cam.apply(focus, cm.zoom, cm.x, cm.y, unitS);
    // The camera's screen offset: a portrait OUTSIDE `#stage` folds it in by hand (so it stays glued to the scene).
    const ax = focus.x * (1 - cm.zoom) + cm.x * unitS, ay = focus.y * (1 - cm.zoom) + cm.y * unitS;
    const place = (at: Pt, off: Pt, inCam: boolean): Pt => (inCam || !cam.active
      ? off
      : { x: off.x * cm.zoom + at.x * (cm.zoom - 1) + ax, y: off.y * cm.zoom + at.y * (cm.zoom - 1) + ay });
    if (hero.el) {
      const p = pose(t);
      const off = place(o.attacker, p, heroInCam);
      const sc = p.scale * (heroInCam || !cam.active ? 1 : cm.zoom);
      const moved = Math.abs(off.x) > 0.05 || Math.abs(off.y) > 0.05 || Math.abs(sc - 1) > 1e-4 || Math.abs(p.rot) > 0.01;
      // The contact squash along the stab (a rotate-scale-rotate sandwich).
      let bd = geo.u;
      for (let i = 0; i < allHits.length; i++) if (t >= allHits[i]!) bd = dirs[i] ?? bd;
      const blow = (Math.atan2(bd.y, bd.x) * 180) / Math.PI;
      const sq = Math.abs(p.squash) > 0.002 ? ` rotate(${blow.toFixed(2)}deg) scale(${(1 - p.squash).toFixed(4)}, ${(1 + p.squash * 0.6).toFixed(4)}) rotate(${(-blow).toFixed(2)}deg)` : '';
      hero.set(!moved && !sq ? null
        : `translate(${(off.x / heroUnit).toFixed(2)}px, ${(off.y / heroUnit).toFixed(2)}px)${sq} rotate(${p.rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`);
      setOpacity(p.alpha >= 0.999 ? null : Math.max(0, p.alpha));
    }
    if (foe.el) {
      // Every hit jolts the target along the stab (from behind: TOWARD the striker's side); the last one hardest.
      let kx = 0, ky = 0, sq = 0;
      const px = local ? 0.45 : 1;
      for (let i = 0; i < allHits.length; i++) {
        const at = allHits[i]!;
        if (t < at) continue;
        const last = i === allHits.length - 1;
        const k = spring(t - at, last ? 4 : 5, last ? 90 : 60);
        const d = dirs[i] ?? geo.u;
        const knock = c.knockPx * (last ? 1 : 0.5) * k * px;
        kx += d.x * knock; ky += d.y * knock; sq += c.squash * (last ? 1 : 0.5) * k;
      }
      const off = place(o.defender, { x: kx, y: ky }, foeInCam);
      const z = foeInCam || !cam.active ? 1 : cm.zoom;
      const still = Math.abs(kx) < 0.05 && Math.abs(ky) < 0.05 && Math.abs(sq) < 0.002;
      foe.set(still && (foeInCam || !cam.active || Math.abs(z - 1) < 1e-4) ? null
        : `translate(${(off.x / foeUnit).toFixed(2)}px, ${(off.y / foeUnit).toFixed(2)}px) scale(${((1 + sq * 0.55) * z).toFixed(4)}, ${((1 - sq) * z).toFixed(4)})`);
    }
  };

  const seq: Sequence<BackstabCue | FormationCue> = new Sequence<BackstabCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); setOpacity(null); voices.unduck();
      if (lifted) { doc!.body.classList.remove(zClass); lifted = false; }
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    scene,
    pose,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
