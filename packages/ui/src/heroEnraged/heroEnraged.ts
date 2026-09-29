/**
 * THE ENRAGED STRIKE RUNNER: plays one Enraged Strike (the beats are in `heroEnragedConfig.ts`) and lands the
 * consequence on its impact beat (the last strike, or Tier IV's haymaker). Presentation only: the total it shows and the
 * blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (never paused),
 * the damage formation, the `#stage` camera mirrored onto the Pixi root, the portraits (transform only, restored after),
 * the voices, the dim, reduced motion, finish / cancel and the safety timer. What is its own: the lunge itself (Classic's
 * silhouette, the hero PORTRAIT drives at the foe), the aura, the afterimages, the combo and the haymaker.
 *
 * THE STRIKE CONTRACT: every strike before the last is a tick (its own full impact: FX and a sound). The consequence
 * (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last strike (Tier IV: on the haymaker).
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
import { hitPower, playContactImpact } from '../choreo/channels/impact';
import { AttackVoices } from '../heroAttack/attackSound';
import { getClassicConfig } from '../heroAttack/classicConfig';
import { classicSwing } from '../heroAttack/heroClassic';
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
  /** Fire Classic's own strike burst and smack under the enraged impact (default: yes; tests switch it off). */
  impactFx?: boolean;
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

/**
 * One measure of a portrait (the swing's geometry and its own transform scale), exactly as Classic takes it: its
 * screen size, and `inv` = its own transform px per screen px (it may sit inside a scaled wrapper).
 */
function rectOf(el: HTMLElement | null | undefined, r: number): { width: number; height: number; inv: number } {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { width: r * 2, height: r * 2, inv: 1 };
    return { width: b.width, height: b.height, inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  } catch { return { width: r * 2, height: r * 2, inv: 1 }; }
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
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // CLASSIC'S SWING between these two portraits (one measure of each; in a sandbox the host px are already the
  // portrait's own px), so the coil, the corner-first contact, the strike's length and ease are exactly Classic's.
  const aRect = local ? { width: aRadius * 2, height: aRadius * 2, inv: 1 } : rectOf(o.attackerEl, aRadius);
  const dRect = local ? { width: radius * 2, height: radius * 2, inv: 1 } : rectOf(o.defenderEl, radius);
  const swing = classicSwing(o.attacker, o.defender, aRect, dRect, aRect.inv);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = enragedPlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt, swing: swing.times, tempo: getClassicConfig().tempo }, c);
  const cues = withFormation(fplan, enragedCues(plan));
  // The coil and the Tier IV rise never take the hero off the screen (or out of the sandbox box).
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const geo = enragedGeo(o.attacker, o.defender, aRadius, radius, c, { x0: 0, y0: 0, x1: vw, y1: vh }, swing, aRect.inv);
  const pose = (t: number): HeroPose => enragedPose(plan, geo, c, t);
  // Toward the middle of the screen from the struck hero (sparks bounce back that way, so a corner hero keeps its spray).
  const inward = ((): Pt => {
    const x = vw / 2 - o.defender.x, y = vh / 2 - o.defender.y;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x: -geo.u.x, y: -geo.u.y };
  })();
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
      auraSize: c.auraSize, flames: c.flames, flameLength: c.flameLength, ghosts: c.ghosts, ghostSpacing: c.ghostSpacing, ghostAlpha: c.ghostAlpha, ghostFadeMs: c.ghostFadeMs,
      wakeWidth: c.wakeWidth, wakeMs: c.wakeMs, ringSize: c.ringSize, ring2Size: c.ring2Size, slashLength: c.slashLength, slashWidth: c.slashWidth,
      sparkSpeed: c.sparkSpeed, emberLife: c.emberLife, craterSize: c.craterSize, debris: c.debris,
      crescentSize: c.crescentSize, shockSize: c.shockSize, burstSize: c.burstSize, sparkInward: c.sparkInward, rimCracks: c.rimCracks, scorch: c.scorch, scorchMs: c.scorchMs, emberStorm: c.emberStorm,
    }, s, enragedSeed(o.total, dist, o.side))
    : null;
  if (scene) {
    const heroAt = (t: number): HeroAt => { const p = pose(t); return { x: o.attacker.x + p.x, y: o.attacker.y + p.y, s: p.scale, heat: p.heat }; };
    const img = o.attackerEl?.querySelector?.('img') ?? null;
    scene.setHero(heroAt, aRadius, portraitGhostTexture(img as HTMLImageElement | null));
  }
  if (scene) {
    // The claws rake the side of the struck portrait AWAY from the big `-N` (which sits toward the middle of the screen).
    const hp = nums.pts.hit;
    const ax = o.defender.x - hp.x, ay = o.defender.y - hp.y;
    const al = Math.hypot(ax, ay);
    scene.setClawOffset(al > 1 ? { x: (ax / al) * radius * 0.3, y: (ay / al) * radius * 0.3 } : { x: 0, y: 0 });
  }
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits (their ancestors' scale and whether the camera carries them, measured once) ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const heroUnit = 1 / (aRect.inv || 1);
  const foeUnit = 1 / (dRect.inv || 1);
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));
  // Raise the striking portrait over the struck one for the lunge (Classic's own duel z-order classes).
  const zClass = o.side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player';
  const lift = !reduced && !local && !!hero.el && !!doc;
  let lifted = false;

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxRoarClip, c.sfxWindupClip, c.sfxChargeClip, c.sfxWhooshClip, c.sfxTickClip, c.sfxSlashClip, c.sfxImpactClip,
    c.sfxPunchClip, c.sfxThumpClip, c.sfxBigClip, c.sfxHaymakerClip, c.sfxRubbleClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const heroScreen = (t: number): Pt => { const p = pose(t); return { x: o.attacker.x + p.x, y: o.attacker.y + p.y }; };

  const fire = (q: EnragedCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The rage builds: a riser whose climax lands on the first drive; the other buses dip.
        if (first) voices.riser(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate, real(first.driveAt - plan.chargeAt));
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'windup': {
        // Classic's windup clip and the growl rising to the drive; embers crackle.
        const buildTo = first?.driveAt ?? plan.impactAt;
        cue(c.sfxWindupClip, c.sfxWindupGain, c.sfxWindupRate);
        voices.keep(playRageTone('attack', { gain: c.sfxToneGain * (0.8 + 0.3 * plan.k), buildMs: real(buildTo - plan.windupAt), lowHz: c.sfxToneLowHz, highHz: c.sfxToneHighHz * (1 + 0.25 * plan.k) }));
        voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain * 0.6, durMs: real(buildTo - plan.windupAt + 400) }));
        scene?.startWindup(plan.aura, c.motes, buildTo - plan.windupAt);
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      }
      case 'burst': {
        // THE RAGE BURST: the roar tears out as the portrait flares and heat rings rip off the rim, right before the drive.
        cue(c.sfxRoarClip, c.sfxRoarGain * (0.85 + 0.25 * plan.k), c.sfxRoarRate - 0.08 * plan.k, { lenMs: 1300, fadeMs: 380 });
        const at = heroScreen(t);
        scene?.burst(at.x, at.y, aRadius * pose(t).scale, c.burstSize * (1 + 0.35 * plan.k));
        break;
      }
      case 'coil': {
        // A combo hit's anticipation: a short grunt of the growl, the flames surge (FX only).
        const at = heroScreen(t);
        scene?.coil(at.x, at.y, aRadius * pose(t).scale, plan.strikes[q.i]!.power);
        break;
      }
      case 'rear': {
        // THE HAYMAKER'S BUILD: the hero rears way back and UP; the biggest roar, a rumble and the growl build to the blow;
        // the rage goes to its maximum (the flames tower, the halo blazes, heat rings tear off).
        const last = plan.strikes[plan.strikes.length - 1]!;
        cue(c.sfxRoarClip, c.sfxRoarGain * 1.25, c.sfxRoarRate - 0.12, { lenMs: 1600, fadeMs: 450, delayMs: real(60) });
        voices.keep(playRageTone('attack', { gain: c.sfxToneGain * 1.2, buildMs: real(last.contactAt - plan.rearAt), lowHz: c.sfxToneLowHz * 1.1, highHz: c.sfxToneHighHz * 1.5 }));
        voices.keep(playRumble('attack', { gain: c.sfxRumbleGain, buildMs: real(last.contactAt - plan.rearAt), holdMs: 0, tailMs: 180, lowHz: 60, highHz: 480 }));
        scene?.rear();
        break;
      }
      case 'drive': {
        const st = plan.strikes[q.i]!;
        // The dash: a whoosh entering as the strike blurs (so it rushes INTO the hit), pitched up the combo, the haymaker
        // lower and heavier; speed lines along its line; a fresh streak, afterimages and scorch each time.
        cue(c.sfxWhooshClip, c.sfxWhooshGain * (0.75 + 0.35 * st.power), st.haymaker ? c.sfxWhooshRate * 0.8 : c.sfxWhooshRate + 0.05 * q.i, {
          lenMs: 700, fadeMs: 250, delayMs: real((st.contactAt - st.driveAt) * (st.haymaker ? 0.3 : 0.45)),
        });
        const from = heroScreen(t);
        const to = { x: o.attacker.x + geo.contact.x, y: o.attacker.y + geo.contact.y };
        const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        scene?.drive(from, { x: (to.x - from.x) / len, y: (to.y - from.y) / len }, len, Math.round(c.speedLines * (0.5 + 0.5 * st.power) * (st.haymaker ? 1.6 : 1)), st.haymaker);
        break;
      }
      case 'tick': {
        // A combo hit before the last: its own full impact (a flash, a rip, sparks, cracks on the rim, the foe knocked
        // back, a camera punch), bigger up the combo, with a hard smack pitched up each time. FX only: the blow waits.
        const pw = plan.strikes[q.i]!.power;
        cue(c.sfxTickClip, c.sfxTickGain * (0.8 + 0.4 * pw), c.sfxTickRate + 0.05 * q.i);
        cue(c.sfxSlashClip, c.sfxSlashGain * (0.6 + 0.4 * pw), c.sfxSlashRate + 0.07 * q.i, { lenMs: 500, fadeMs: 180 });
        cue(c.sfxPunchClip, c.sfxPunchGain * (0.55 + 0.35 * pw), c.sfxPunchRate + 0.04 * q.i);
        scene?.tick(o.defender.x, o.defender.y, geo.u, radius, q.i, pw, inward);
        break;
      }
      case 'impact': {
        // THE BLOW: a heavy hammer, a punch, a tight low thump, a rip; a crack on the big tiers; the haymaker adds its own
        // knockout clip. Embers crackle on while the foe smoulders.
        const k = plan.k;
        cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.15 * k), c.sfxImpactRate - 0.04 * k, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
        cue(c.sfxPunchClip, c.sfxPunchGain, c.sfxPunchRate - 0.03 * k);
        cue(c.sfxThumpClip, c.sfxThumpGain * (0.8 + 0.3 * k), c.sfxThumpRate, { lenMs: 700, fadeMs: 250 });
        if (plan.slashes > 0) cue(c.sfxSlashClip, c.sfxSlashGain, c.sfxSlashRate - 0.05 * k, { lenMs: 600, fadeMs: 200 });
        if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
        if (plan.haymaker) cue(c.sfxHaymakerClip, c.sfxHaymakerGain, c.sfxHaymakerRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs * 1.2, fadeMs: 450 });
        voices.keep(playEmberCrackle('attack', { gain: c.sfxCrackleGain, durMs: real(c.smoulderMs + 300) }));
        const u = plan.haymaker ? hayDir : geo.u;
        if (o.impactFx !== false && !local && o.defenderEl) {
          // Classic's own strike burst and smack underneath (the struck portrait's recoil is ours): the enraged blow is
          // unmistakably the same blow, amplified.
          try {
            playContactImpact(o.defenderEl, u.x, u.y, hitPower(o.total * getClassicConfig().impactPower * (1.4 + 0.3 * k)), speed, o.defender, 0, false, false, false, false, false, true);
          } catch { /* no FX layer here */ }
        }
        scene?.impact(o.defender.x, o.defender.y, u, radius, {
          k, burst: plan.burst, sparks: plan.sparks, embers: plan.embers, slashes: plan.slashes, flashAlpha: c.flashAlpha,
          haymaker: plan.haymaker, smoulderMs: c.smoulderMs, screen: Math.hypot(vw, vh), into: inward,
        });
        seq.land();
        break;
      }
      case 'boom': {
        const a = q.i * 2.1 + 0.9;
        const rr = radius * (1.4 + 0.35 * (q.i % 2));
        cue(c.sfxRubbleClip, c.sfxRubbleGain, c.sfxRubbleRate + q.i * 0.07, { lenMs: 500, fadeMs: 200 });
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

  /** The haymaker's direction as it lands (down its arc into the foe): the shake, the sparks and the crescent follow it. */
  const hayDir = ((): Pt => {
    const dx = geo.contact.x - geo.arc.x, dy = geo.contact.y - geo.arc.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  })();
  const shakeDir = plan.haymaker ? hayDir : geo.u;
  const blowDeg = (Math.atan2(geo.u.y, geo.u.x) * 180) / Math.PI;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    // The dim comes in with the windup and deepens as the haymaker rears back.
    nums.paintDim(t, plan.windupAt, first ? first.driveAt : plan.impactAt, plan.impactAt + 300);
    const cm = enragedCameraAt(plan, c, t, shakeDir);
    const focus = enragedCameraFocus(plan, t, o.attacker, o.defender, { x: o.attacker.x + geo.rear.x, y: o.attacker.y + geo.rear.y });
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
      // The squash / stretch along the blow (a rotate-scale-rotate sandwich): compressed on a hit or a coil, stretched on
      // a recoil and a dash.
      const sq = Math.abs(p.squash) > 0.002 ? ` rotate(${blowDeg.toFixed(2)}deg) scale(${(1 - p.squash).toFixed(4)}, ${(1 + p.squash * 0.6).toFixed(4)}) rotate(${(-blowDeg).toFixed(2)}deg)` : '';
      hero.set(!moved && !cam.active && !sq ? null
        : `translate(${(off.x / heroUnit).toFixed(2)}px, ${(off.y / heroUnit).toFixed(2)}px)${sq} rotate(${p.rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`);
    }
    scene?.follow(t);
    if (foe.el) {
      // EVERY hit knocks the foe back along the blow and squashes it, harder up the combo; THE impact hardest.
      let kx = 0, ky = 0, sq = 0;
      const px = local ? 0.45 : 1;
      for (const s0 of plan.strikes) {
        if (s0.final || t < s0.contactAt) continue;
        const k = spring(t - s0.contactAt, 5, 70);
        const knock = c.knockPx * (0.35 + 0.45 * s0.power) * k * px;
        kx += geo.u.x * knock; ky += geo.u.y * knock; sq += k * c.squash * (0.4 + 0.5 * s0.power);
      }
      if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, 4, 95);
        const knock = c.knockPx * (0.8 + 0.5 * plan.k) * (plan.haymaker ? 1.2 : 1) * k * px;
        kx += shakeDir.x * knock; ky += shakeDir.y * knock;
        sq += c.squash * (0.8 + 0.5 * plan.k) * (plan.haymaker ? 1.4 : 1) * k;
      }
      const off = place(o.defender, { x: kx, y: ky }, foeInCam);
      const z = foeInCam || !cam.active ? 1 : cm.zoom;
      const still = Math.abs(kx) < 0.05 && Math.abs(ky) < 0.05 && Math.abs(sq) < 0.002;
      foe.set(still && !cam.active ? null
        : `translate(${(off.x / foeUnit).toFixed(2)}px, ${(off.y / foeUnit).toFixed(2)}px) scale(${((1 + sq * 0.55) * z).toFixed(4)}, ${((1 - sq) * z).toFixed(4)})`);
    }
  };

  const seq: Sequence<EnragedCue | FormationCue> = new Sequence<EnragedCue | FormationCue>({
    // NO hit-stop and no pinned beats (owner 2026-09-28: "remove the freezeing frame from all of the animations. it looks
    // like lag"): the clock never stops; the weight comes from the flash, the squash, the knockback, the shake and sound.
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
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
