/**
 * THE BANANA BARRAGE RUNNER (Oona's Banana Cannon): plays one Banana Barrage hero attack (the beats are in
 * `heroBananaConfig.ts`) and lands the consequence on its impact beat (the last banana splatting, or at Tier IV the
 * finisher: the fourth slam jamming the giant golden banana into the struck hero). Presentation only: the total it
 * shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on screen they
 * happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera mirrored onto the Pixi root, the portraits (transform only,
 * restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer. What is the barrage's own:
 * King Oona's painted bananas and splats (her card FX's art and clips), the fling rhythm, the Tier IV jam (the STRIKING
 * PORTRAIT dashes across and pounds the stuck giant, Mortal Kombat style), its camera and its sound.
 *
 * THE BARRAGE CONTRACT: every splat before the last is a tick (FX and sound only; at Tier IV the warm-ups, the landing
 * and every slam before the finisher are). The consequence (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites are pooled per layer, the painted sheets decoded during the formation and uploaded by
 * warm sprites, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  arrivalDir, bananaCameraAt, bananaCameraFocus, bananaCues, bananaPlan, bananaRig, getHeroBananaConfig, jamGeo, jamPose,
  type BananaCue, type BananaPlan, type BananaRig, type HeroBananaConfig,
} from './heroBananaConfig';
import { HeroBananaScene, type HeroBananaTextures } from './heroBananaScene';
import { heroBananaTextures, preloadBananaSheets, refreshBananaSheets } from './heroBananaTextures';

export interface HeroBananaOptions extends HeroAttackOptions {
  cfg?: HeroBananaConfig;
  textures?: HeroBananaTextures | null;
}

export interface HeroBananaHandle extends HeroAttackHandle {
  readonly plan: BananaPlan;
  /** Every banana's flight (none under reduced motion). Exposed for tests and the capture rig. */
  readonly rig: BananaRig;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroBananaScene | null;
  /** Whether the camera is mirrored onto the Pixi root (false when the canvas sits inside the camera element). */
  readonly mirrorsCamera: boolean;
}

/** The seed a fight's juice is scattered from: the same fight (same blow, same geometry) splats the same way. */
export function bananaSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 5)) >>> 0;
}

/** One measure of a portrait: its screen size, and `inv` = its own transform px per screen px (as Classic takes it). */
function rectOf(el: HTMLElement | null | undefined, r: number): { width: number; height: number; inv: number } {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { width: r * 2, height: r * 2, inv: 1 };
    return { width: b.width, height: b.height, inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  } catch { return { width: r * 2, height: r * 2, inv: 1 }; }
}

/** Play the Banana Barrage. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroBanana(o: HeroBananaOptions): HeroBananaHandle {
  const c = o.cfg ?? getHeroBananaConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  if (!reduced && o.textures === undefined) preloadBananaSheets();
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = bananaPlan({ total: o.total, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, bananaCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hbanana',
  });

  // A banana's arc never rises above the top of the screen (the giant hangs in view); bananas splat clear of the big -N.
  const ceil = (local ? 8 : 36) * s;
  // The giant's length on screen (the scene draws it at bananaPx x giantSize x the stage scale).
  const giantLen = c.bananaPx * c.giantSize * s;
  const rig = bananaRig(plan, o.attacker, o.defender, radius, aRadius, c, ceil, nums.pts.hit, c.giantHangY * s, giantLen);
  const last = rig.shots[rig.shots.length - 1];
  const giantIdx = plan.giant ? plan.shots.length - 1 : -1;
  const jg = jamGeo(o.attacker, o.defender, aRadius, radius, giantLen, plan.slams.length, c);
  /** Blood from the `bloodStart`-th slam on: 1 on it, 2 on the next, and so on (owner: "increasing amounts"). */
  const bloodOf = (k: number): number => Math.max(0, k + 1 - Math.round(c.bloodStart) + 1);
  // The direction the blow ARRIVES from: the last banana's heading, or (Tier IV) the jam's line.
  const dir = plan.giant ? jg.u : arrivalDir(last, o.attacker, o.defender);
  const toFoe = jg.u;

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first banana) ──
  const textures = o.textures !== undefined ? o.textures : heroBananaTextures();
  const scene = textures && !reduced
    ? new HeroBananaScene(textures, {
      juice: hexToNum(c.colorJuice), amber: hexToNum(c.colorAmber), cream: hexToNum(c.colorCream), gold: hexToNum(c.colorGold),
      spark: hexToNum(c.colorSpark), side: hexToNum(sideHex),
    }, {
      bananaPx: c.bananaPx, bloodAmount: c.bloodAmount, juiceDrips: c.juiceDrips, dripMs: c.dripMs, trailSparks: c.trailSparks, splatPx: c.splatPx, splatMs: c.splatMs, tickJuice: c.tickJuice,
      juiceSpeed: c.juiceSpeed, juiceLifeMs: c.juiceLifeMs, juicePx: c.juicePx, launchSparks: c.launchSparks, giantSplat: c.giantSplat,
      ringSplats: c.ringSplats, showerBananas: c.showerBananas, shockSize: c.shockSize, goldRays: c.goldRays,
    }, s, bananaSeed(o.total, dist, o.side))
    : null;
  if (scene) scene.setView(local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920),
    local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080));
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  // THE MIRROR, only when the canvas is NOT inside the camera element. Since the scaled stage (#1762) the shared
  // overlay canvas lives INSIDE #stage, so the DOM camera already zooms and shakes it; mirroring the camera onto the
  // Pixi root as well applied it TWICE, and every splat drifted away from the focus by the zoom (owner 2026-09-29: the
  // first volley "looks like it is overshot due to the zoom"). Decided once, when the camera starts (the slot is up).
  let mirrorOn = true;
  const mirror = scene ? { setCamera: (ax: number, ay: number, z: number): void => { if (mirrorOn) scene.setCamera(ax, ay, z); else scene.setCamera(0, 0, 1); } } : null;
  const canvasInCamera = (): boolean => {
    if (!cameraEl) return false;
    try {
      if (o.mount) return cameraEl.querySelector('canvas') !== null;
      const c = doc?.querySelector('canvas.pixifx-above');
      return !!c && cameraEl.contains(c);
    } catch { return false; }
  };
  const cam = new StageCamera(cameraEl, mirror);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  // The jam moves the striking portrait a long way: measured once (its own transform px per screen px), as Enraged does.
  const aRect = local ? { inv: 1 } : rectOf(o.attackerEl, aRadius);
  const dRect = local ? { inv: 1 } : rectOf(o.defenderEl, radius);
  const heroUnit = 1 / (aRect.inv || 1);
  const foeUnit = 1 / (dRect.inv || 1);
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxLaunchClip, c.sfxWhooshClip, c.sfxSplatClip, c.sfxPowerClip, c.sfxImpactClip, c.sfxChargeClip, c.sfxGlintClip, c.sfxDropClip, c.sfxSlamClip, c.sfxBoomClip]);
  let hitStep = 0;
  const splatSound = (gain: number, rate: number): void => {
    cue(c.sfxSplatClip, c.sfxSplatGain * gain, c.sfxSplatRate * rate, { lenMs: 600, fadeMs: 200 });
  };

  const fire = (q: BananaCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The golden jungle flourish on the hero: a warm rising power-up (Oona's), the bloom opening.
        refreshBananaSheets();
        cue(c.sfxChargeClip, c.sfxChargeGain * 0.6, c.sfxChargeRate * 1.2, { lenMs: 700, fadeMs: 250 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.flourish(o.attacker.x, o.attacker.y, aRadius, plan.fireAt - plan.chargeAt);
        mirrorOn = !canvasInCamera();
        cam.start();
        break;
      case 'fire': {
        // Oona's launch (the giant: lower, heavier, with a whoosh).
        refreshBananaSheets();
        const m = rig.shots[q.i];
        const sp = plan.shots[q.i];
        const giant = sp?.giant ?? false;
        cue(c.sfxLaunchClip, c.sfxLaunchGain * (giant ? 1.4 : 1), c.sfxLaunchRate * (giant ? 0.72 : 1 + 0.04 * (q.i % 6)), { lenMs: giant ? 1200 : 700, fadeMs: 250 });
        if (giant) cue(c.sfxWhooshClip, c.sfxWhooshGain * 1.6, c.sfxWhooshRate * 0.7, { lenMs: 600, fadeMs: 200 });
        if (m && scene) scene.fling(m, giant ? sp!.size : plan.size * (sp?.size ?? 1), t - q.at, q.i);
        if (!giant && q.i === plan.shots.filter((x) => !x.giant).length - 1 && !plan.giant) scene?.release();
        if (!giant && plan.giant && q.i === plan.shots.length - 2) scene?.release();
        break;
      }
      case 'hit': {
        // A banana SPLATS before the last: Oona's splat, pitched up each tick. FX only.
        splatSound(0.8, 1 + 0.05 * hitStep);
        scene?.hit(q.i, o.defender.x, o.defender.y, radius, hitStep);
        hitStep++;
        break;
      }
      case 'glint':
        // THE ROYAL BANANA: the hero blazes gold (Oona's power-up, low and long; a sparkle).
        cue(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate, { lenMs: Math.max(300, (plan.shots[giantIdx]!.fireAt - plan.glintAt) / speed + 250), fadeMs: 200 });
        cue(c.sfxGlintClip, c.sfxGlintGain, c.sfxGlintRate, { lenMs: 900, fadeMs: 300, delayMs: 120 / speed });
        scene?.flourish(o.attacker.x, o.attacker.y, aRadius, plan.shots[giantIdx]!.fireAt - plan.glintAt, true);
        break;
      case 'hang':
        // It hangs at the top: the crown glint rings, then the descending whoosh as the target ring locks on.
        cue(c.sfxGlintClip, c.sfxGlintGain * 1.2, c.sfxGlintRate * 1.3, { lenMs: 700, fadeMs: 250 });
        cue(c.sfxDropClip, c.sfxDropGain, c.sfxDropRate, { lenMs: Math.max(250, (plan.landAt - plan.hangAt) / speed + 150), fadeMs: 150, delayMs: 120 / speed });
        if (last) scene?.hang(q.i, last.b, radius, plan.landAt - plan.hangAt);
        break;
      case 'land':
        // THWUMP: it lands in the struck hero's rim and sticks there, a stake.
        splatSound(1.2, 0.7);
        cue(c.sfxImpactClip, c.sfxImpactGain * 1.2, c.sfxImpactRate * 0.8, { lenMs: 500, fadeMs: 180 });
        scene?.land(q.i, { entry: jg.entry, u: jg.u, len: giantLen, depth: jg.depths[0]!, face: { x: o.defender.x, y: o.defender.y, r: radius } });
        break;
      case 'dash':
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 1.5, c.sfxWhooshRate, { lenMs: 400, fadeMs: 150 });
        break;
      case 'slam':
        // A SLAM driving the stake in: a meaty smack and a squelch, heavier and lower each time. FX only.
        cue(c.sfxImpactClip, c.sfxImpactGain * (1.1 + 0.2 * q.i), c.sfxImpactRate * (1 - 0.05 * q.i), { lenMs: 450, fadeMs: 160 });
        splatSound(1 + 0.15 * q.i, 0.92 - 0.05 * q.i);
        cue(c.sfxSlamClip, c.sfxSlamGain * (0.35 + 0.12 * q.i), c.sfxSlamRate * (1.25 - 0.06 * q.i), { lenMs: 500, fadeMs: 180 });
        if (bloodOf(q.i) > 0) cue(c.sfxBoomClip, c.sfxBoomGain * (0.8 + 0.3 * bloodOf(q.i)), 0.8, { lenMs: 400, fadeMs: 150 });
        scene?.slam(q.i, jg.depths[q.i + 1]!, bloodOf(q.i), plan.slams.length);
        break;
      case 'impact':
        if (plan.giant) {
          // THE FINISHER: the slam, a heavy crunch, Oona's splat low and her power-up on top.
          cue(c.sfxSlamClip, c.sfxSlamGain, c.sfxSlamRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxImpactClip, c.sfxImpactGain * 2, c.sfxImpactRate * 0.75, { lenMs: 600, fadeMs: 200 });
          splatSound(1.6, 0.6);
          cue(c.sfxPowerClip, c.sfxPowerGain * 1.2, c.sfxPowerRate * 0.9, { lenMs: 900, fadeMs: 300 });
          const lastK = Math.max(0, plan.slams.length - 1);
          scene?.slam(lastK, jg.depths[lastK + 1]!, bloodOf(lastK), plan.slams.length);
          scene?.finale(q.i, o.defender.x, o.defender.y, radius, { burst: plan.burst, juice: plan.juice, flashAlpha: c.flashAlpha });
        } else {
          // THE LAST BANANA: Oona's splat and her power-up (as her card plays them), a smack under it, bigger per tier.
          splatSound(1.1 + 0.1 * plan.tier, 1 - 0.05 * (plan.tier - 1));
          cue(c.sfxPowerClip, c.sfxPowerGain, c.sfxPowerRate, { tail: c.sfxTailMix, lenMs: 900, fadeMs: 300 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.8 + 0.1 * plan.tier), c.sfxImpactRate, { lenMs: 500, fadeMs: 200 });
          scene?.impact(q.i, o.defender.x, o.defender.y, radius, { k: plan.k, burst: plan.burst, juice: plan.juice, splats: plan.splats, flashAlpha: c.flashAlpha });
        }
        seq.land();
        break;
      case 'boom': {
        const a = q.i * 2.1 + 0.7;
        const rr = radius * (1.25 + 0.2 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.1, { lenMs: 420, fadeMs: 160 });
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr * 0.9, 0.9 + 0.12 * q.i);
        break;
      }
      default:
        break;
    }
  };

  const blowDeg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    // The dim frames the two heroes at rest; the jam moves the striker across the board, so at Tier IV the dim lifts as
    // the dash starts and both heroes stay bright through every slam (owner 2026-09-29: "make the hero less dimmed").
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.giant ? plan.dashAt - 260 : plan.impactAt + 200);
    const cm = bananaCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    const focus = bananaCameraFocus(plan, t, o.attacker, o.defender);
    cam.apply(focus, cm.zoom, cm.x, cm.y, unit);
    // The camera's screen offset: a portrait OUTSIDE the camera element folds it in by hand (as Enraged does).
    const ax = focus.x * (1 - cm.zoom) + cm.x * unit, ay = focus.y * (1 - cm.zoom) + cm.y * unit;
    const place = (at: Pt, off: Pt, inCam: boolean): Pt => (inCam || !cam.active
      ? off
      : { x: off.x * cm.zoom + at.x * (cm.zoom - 1) + ax, y: off.y * cm.zoom + at.y * (cm.zoom - 1) + ay });
    const px = local ? 0.45 : 1;
    let strikerAt: { x: number; y: number; r: number } | null = null;
    if (t >= plan.chargeAt) {
      // The hero coils back through the flourish and FLINGS toward the target on each banana; at Tier IV it then dashes
      // across and pounds the stuck giant (the jam), then flies home.
      const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      const settle = plan.giant ? 1 - clamp01((t - plan.dashAt) / 120) : 1 - clamp01((t - plan.impactAt) / 260);
      let bx = -toFoe.x * c.heroCoilPx * px * u * settle, by = -toFoe.y * c.heroCoilPx * px * u * settle;
      let sc = 1 + 0.035 * u * settle;
      if (plan.giant && t >= plan.glintAt && t < plan.dashAt) {
        const g = clamp01((t - plan.glintAt) / Math.max(1, plan.shots[giantIdx]!.fireAt - plan.glintAt));
        sc += 0.05 * g * (t < plan.shots[giantIdx]!.fireAt ? 1 : 0);
      }
      for (const sp of plan.shots) {
        if (sp.fireAt > t) continue;
        const f = c.heroFlingPx * px * (sp.giant ? 2 : 1) * Math.max(0, spring(t - sp.fireAt, 4, 80));
        bx += toFoe.x * f; by += toFoe.y * f;
      }
      const jp = jamPose(plan, jg, c, t);
      bx += jp.x; by += jp.y; sc *= jp.scale;
      const off = place(o.attacker, { x: bx, y: by }, heroInCam);
      const z = heroInCam || !cam.active ? 1 : cm.zoom;
      const sq = Math.abs(jp.squash) > 0.002 ? ` rotate(${blowDeg.toFixed(2)}deg) scale(${(1 - jp.squash).toFixed(4)}, ${(1 + jp.squash * 0.6).toFixed(4)}) rotate(${(-blowDeg).toFixed(2)}deg)` : '';
      const still = Math.abs(sc - 1) < 1e-4 && Math.abs(off.x) + Math.abs(off.y) < 0.05 && !sq && Math.abs(jp.rot) < 0.01 && !cam.active;
      hero.set(still ? null
        : `translate(${(off.x / heroUnit).toFixed(2)}px, ${(off.y / heroUnit).toFixed(2)}px)${sq} rotate(${jp.rot.toFixed(2)}deg) scale(${(sc * z).toFixed(4)})`);
      strikerAt = { x: o.attacker.x + bx, y: o.attacker.y + by, r: aRadius * sc * 1.03 };
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let kx = 0, ky = 0, sqz = 0, tremble = 0;
      if (plan.giant && t >= plan.hangAt && t < plan.landAt) {
        // The golden ring locks on: the target cowers (a tremble growing as the giant falls).
        const u = clamp01((t - plan.hangAt) / Math.max(1, plan.landAt - plan.hangAt));
        tremble = (0.3 + 1.6 * u * u) * px;
        kx += tremble * Math.sin(t * 0.23); ky += tremble * Math.sin(t * 0.31);
      }
      // Every tick nudges the target along the blow; the landing thumps it down; each slam jolts it back, harder.
      for (const at of plan.hits) {
        if (t < at) continue;
        const slamI = plan.slams.indexOf(at);
        const k = Math.max(0, spring(t - at, slamI >= 0 ? 5 : 6, slamI >= 0 ? 80 : 45));
        // Every slam knocks and dents the target harder than the last.
        const knock = (slamI >= 0 ? c.knockPx * (0.55 + 0.3 * slamI) : at === plan.landAt && plan.giant ? 10 : 6) * k * px;
        const kd = at === plan.landAt && plan.giant ? { x: 0, y: 1 } : dir;
        kx += kd.x * knock; ky += kd.y * knock;
        if (slamI >= 0) sqz += k * c.squash * (0.5 + 0.25 * slamI);
      }
      if (t >= plan.impactAt) {
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * (plan.giant ? 1.8 : 1) * k * px;
        kx += dir.x * knock; ky += dir.y * knock;
        sqz += c.squash * (0.8 + 0.4 * plan.k) * (plan.giant ? 1.8 : 1) * k;
      }
      fx = kx; fy = ky;
      const off = place(o.defender, { x: kx, y: ky }, foeInCam);
      const z = foeInCam || !cam.active ? 1 : cm.zoom;
      const still = Math.abs(kx) < 0.05 && Math.abs(ky) < 0.05 && Math.abs(sqz) < 0.002;
      // The DENT: compressed ALONG the blow (a rotate-scale-rotate sandwich), bulging across it, springing back.
      foe.set(still && !cam.active ? null
        : `translate(${(off.x / foeUnit).toFixed(2)}px, ${(off.y / foeUnit).toFixed(2)}px) rotate(${blowDeg.toFixed(2)}deg) scale(${((1 - sqz) * z).toFixed(4)}, ${((1 + sqz * 0.55) * z).toFixed(4)}) rotate(${(-blowDeg).toFixed(2)}deg)`);
    }
    // The stuck giant, the splats and the target ring ride the portrait (the offset in the overlay's px).
    scene?.setFoeOffset(fx * unit, fy * unit);
    // THE CUT: the striking portrait on top of the banana (and every banana effect) while it is in the jam.
    const jamming = plan.giant && t >= plan.dashAt && t < plan.homeAt;
    scene?.setCuts(jamming ? strikerAt : null);
  };

  const seq: Sequence<BananaCue | FormationCue> = new Sequence<BananaCue | FormationCue>({
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
    rig,
    scene,
    get mirrorsCamera() { return mirrorOn; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
