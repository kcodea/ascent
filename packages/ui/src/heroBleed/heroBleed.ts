/**
 * THE BLEED RUNNER: plays one Bleed ("Hemorrhage") hero attack (the beats are in `heroBleedConfig.ts`) and lands the
 * consequence on its impact beat (the last cut, or Tier IV's bloody explosion). Presentation only: the
 * total it shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on
 * screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera mirrored onto the Pixi root, the portraits (transform only,
 * restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer. What is Bleed's own: the
 * crescent paths, the cut rhythm, the wounds, the heartbeat, the eight zips, the explosion, its camera and its sound.
 *
 * THE CUT CONTRACT: every cut that lands before the last is a tick (FX and sound only; at Tier IV every cut is). The
 * consequence (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last cut (Tier IV: on the explosion;
 * every zip before it is a tick).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites are pooled per layer with a hard cap, textures painted once per session and
 * pre-warmed during the formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  bleedCameraAt, bleedCameraFocus, bleedCues, bleedPlan, getHeroBleedConfig, rakeLines, zipGeos,
  slashGeos, type BleedCue, type BleedPlan, type HeroBleedConfig, type MegaGeo, type SlashGeo,
} from './heroBleedConfig';
import { HeroBleedScene, type HeroBleedTextures } from './heroBleedScene';
import { heroBleedTextures } from './heroBleedTextures';

export interface HeroBleedOptions extends HeroAttackOptions {
  cfg?: HeroBleedConfig;
  textures?: HeroBleedTextures | null;
}

export interface HeroBleedHandle extends HeroAttackHandle {
  readonly plan: BleedPlan;
  /** Every slash's path (empty under reduced motion). Exposed for tests and the capture rig. */
  readonly geos: readonly SlashGeo[];
  /** Tier IV's first zip line (null below IV or under reduced motion). */
  readonly mega: MegaGeo | null;
  /** Every Tier IV zip's line, in order (empty below IV or under reduced motion). */
  readonly zips: readonly MegaGeo[];
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroBleedScene | null;
}

/** The seed a fight's droplets are scattered from: the same fight (same blow, same geometry) bleeds the same way. */
export function bleedSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 6151 + Math.round(distance) * 37 + (side === 'opp' ? 211 : 17)) >>> 0;
}

/** Play the Bleed attack. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroBleed(o: HeroBleedOptions): HeroBleedHandle {
  const c = o.cfg ?? getHeroBleedConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = bleedPlan({ total: o.total, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, bleedCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hbleed',
  });

  // A crescent's flight never rises above the top of the screen (or the sandbox box).
  const geos = slashGeos(plan, o.attacker, o.defender, radius, aRadius, c, (local ? 8 : 36) * s, nums.pts.hit);
  const cutDirs: Pt[] = geos.map((g) => ({ x: Math.cos(g.angle), y: Math.sin(g.angle) }));
  // The zips: each a line through the target, crossing it half-way. Each sweeps IN from the far side of the screen
  // (toward its middle), across the board, through the target and out past it, so every wide crescent crosses the
  // screen (a sandbox box: its own middle, a little past both heroes).
  const vw = typeof window === 'undefined' ? 1920 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 1080 : window.innerHeight;
  const middle = local ? { x: (o.attacker.x + o.defender.x) / 2, y: (o.attacker.y + o.defender.y) / 2 } : { x: vw / 2, y: vh / 2 };
  const zipSpan = local ? dist * 2.1 : Math.max(dist * 2.1, Math.hypot(vw, vh) * 1.7);
  const zips = plan.hemorrhage ? zipGeos(plan, o.attacker, o.defender, zipSpan, middle) : [];
  // Tier IV's claw rakes sweep a wide line too (the build-up), timed to cross the target as each rake bites.
  const rakes = rakeLines(plan, o.attacker, o.defender, zipSpan, middle);
  // Where the blood may land: the screen (a sandbox box: round both heroes).
  const area = local
    ? { x: Math.min(o.attacker.x, o.defender.x) - dist * 0.25, y: Math.min(o.attacker.y, o.defender.y) - dist * 0.25, w: Math.abs(o.attacker.x - o.defender.x) + dist * 0.5, h: Math.abs(o.attacker.y - o.defender.y) + dist * 0.5 }
    : { x: 0, y: 0, w: vw, h: vh };
  const zipDirs: Pt[] = zips.map((z) => ({ x: Math.cos(z.angle), y: Math.sin(z.angle) }));
  const mega = zips[0] ?? null;
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  // The direction the blow ARRIVES from: the last cut (I-III), the last zip (IV). The shake and the knockback follow it.
  const dir: Pt = zipDirs[zipDirs.length - 1] ?? cutDirs[cutDirs.length - 1] ?? toFoe;
  const flip = o.attacker.x > o.defender.x ? -1 : 1;

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first cut) ──
  const textures = o.textures !== undefined ? o.textures : heroBleedTextures();
  const scene = textures && !reduced
    ? new HeroBleedScene(textures, {
      core: hexToNum(c.colorCore), bright: hexToNum(c.colorBright), blood: hexToNum(c.colorBlood), deep: hexToNum(c.colorDeep), side: hexToNum(sideHex),
    }, {
      waveSize: c.waveSize, waveGlow: c.waveGlow, afterimages: c.afterimages, afterMs: c.afterMs, seamWidth: c.seamWidth, gashWidth: c.gashWidth,
      spray: c.spray, tickDrops: c.tickDrops, tint: c.tintAlpha, gravity: c.dropGravity, dripMs: c.dripMs, stainAlpha: c.stainAlpha,
      stainMs: c.stainMs, spatter: c.spatter, megaWidth: c.megaWidth, megaSize: c.megaSize, novaSize: c.novaSize, explosionSize: c.explosionSize,
    }, s, bleedSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxReadyClip, c.sfxSwingClip, c.sfxShingClip, c.sfxSliceClip, c.sfxFleshClip, c.sfxSplatClip, c.sfxImpactClip,
    c.sfxBigClip, c.sfxBeatClip, c.sfxWindClip, c.sfxMegaClip, c.sfxGushClip, c.sfxSpurtClip, c.sfxBlastClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const n = plan.slashes.length;
  const hand = geos[0]?.a ?? o.attacker;
  let hitStep = 0;

  const fire = (q: BleedCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The blade is drawn: a low metal whoosh.
        cue(c.sfxReadyClip, c.sfxReadyGain, c.sfxReadyRate, { lenMs: 700, fadeMs: 250 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(o.attacker.x, o.attacker.y, hand, aRadius, plan.swingAt - plan.chargeAt, n);
        cam.start();
        break;
      case 'swing': {
        // SHING: a swish pitched up (a little higher per slash) and the snap of the blade, entered at its crack.
        const g = geos[q.i];
        const lastOne = q.i === n - 1;
        cue(c.sfxSwingClip, c.sfxSwingGain * (lastOne ? 1 : 0.8), c.sfxSwingRate + 0.05 * q.i, { lenMs: c.sfxSwingLenMs, fadeMs: 120 });
        cue(c.sfxShingClip, c.sfxShingGain * (lastOne ? 1 : 0.75), c.sfxShingRate + 0.04 * q.i, { startMs: 440, lenMs: 180, fadeMs: 90 });
        if (g && scene) scene.swing(q.i, g, plan.slashes[q.i]!.lines > 1 ? 1.15 : 1, t - q.at);
        // IV: each rake also sweeps its wide line across the screen, crossing the target as the rake bites.
        const rl = rakes[q.i];
        if (rl && scene) scene.startMega(rl, plan.slashes[q.i]!.flightMs * 2);
        break;
      }
      case 'hit': {
        // A cut lands before the last: the slice, the flesh and a wet splat, pitched up each tick. FX only.
        const g = geos[q.i];
        cue(c.sfxSliceClip, c.sfxSliceGain * 0.8, c.sfxSliceRate + 0.05 * hitStep, { lenMs: 450, fadeMs: 160 });
        cue(c.sfxFleshClip, c.sfxFleshGain * 0.7, c.sfxFleshRate + 0.04 * hitStep, { lenMs: 300, fadeMs: 120 });
        cue(c.sfxSplatClip, c.sfxSplatGain * 0.65, c.sfxSplatRate + 0.05 * hitStep, { lenMs: 450, fadeMs: 180 });
        if (g) scene?.hit(g, o.defender.x, o.defender.y, radius, hitStep);
        hitStep++;
        break;
      }
      case 'beat':
        // A heartbeat: lub ... dub, low.
        cue(c.sfxBeatClip, c.sfxBeatGain, c.sfxBeatRate, { lenMs: 260, fadeMs: 120 });
        cue(c.sfxBeatClip, c.sfxBeatGain * 0.7, c.sfxBeatRate * 1.12, { lenMs: 220, fadeMs: 110, delayMs: real(150) });
        scene?.beat(o.defender.x, o.defender.y, radius, q.i);
        break;
      case 'wind':
        cue(c.sfxWindClip, c.sfxWindGain, c.sfxWindRate, { lenMs: Math.max(300, real(plan.megaAt - plan.windAt) + 200), fadeMs: 200 });
        scene?.windup(hand, Math.atan2(o.defender.y - o.attacker.y, o.defender.x - o.attacker.x), plan.megaAt - plan.windAt);
        break;
      case 'zip': {
        // ZIP: the big sweep (the first one heaviest), and the snap of the blade, climbing as they speed up.
        const z = zips[q.i];
        const first = q.i === 0;
        if (first) cue(c.sfxMegaClip, c.sfxMegaGain, c.sfxMegaRate, { tail: c.sfxTailMix, lenMs: 1400, fadeMs: 400 });
        else cue(c.sfxSwingClip, c.sfxSwingGain * 0.9, c.sfxSwingRate + 0.07 * q.i, { lenMs: c.sfxSwingLenMs, fadeMs: 100 });
        cue(c.sfxShingClip, c.sfxShingGain * (first ? 1.2 : 0.9), c.sfxShingRate - 0.2 + 0.06 * q.i, { startMs: 440, lenMs: 200, fadeMs: 90 });
        if (z) scene?.startMega(z, plan.zips[q.i]!.dur);
        break;
      }
      case 'zhit': {
        // It crosses the target: a slice and a splat (a tick, FX only), pitched up each zip.
        const z = zips[q.i];
        cue(c.sfxSliceClip, c.sfxSliceGain * 0.75, c.sfxSliceRate + 0.05 * q.i, { lenMs: 380, fadeMs: 140 });
        cue(c.sfxSplatClip, c.sfxSplatGain * 0.6, c.sfxSplatRate + 0.05 * q.i, { lenMs: 400, fadeMs: 160 });
        if (z) {
          scene?.zipCut(z.angle, o.defender.x, o.defender.y, radius, q.i);
          // ...and flings blood across the whole screen along its line, which stays until after the explosion.
          scene?.screenBlood(z, q.i, plan.impactAt - t + 1100, area);
        }
        break;
      }
      case 'tension':
        // The held breath before the burst: the wind-up clip, low, swelling into the explosion.
        cue(c.sfxWindClip, c.sfxWindGain * 0.8, c.sfxWindRate * 0.85, { lenMs: Math.max(200, real(plan.impactAt - plan.tensionAt) + 150), fadeMs: 150 });
        scene?.tension(o.defender.x, o.defender.y, radius, plan.impactAt - plan.tensionAt);
        break;
      case 'impact':
        if (plan.hemorrhage) {
          // THE BLOODY EXPLOSION: the blast, a heavy wet gush, the impact, the crack layered on, the flesh low.
          cue(c.sfxBlastClip, c.sfxBlastGain, c.sfxBlastRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs + 400, fadeMs: 500 });
          cue(c.sfxGushClip, c.sfxGushGain, c.sfxGushRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.05, { lenMs: 600, fadeMs: 220 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.15, c.sfxBigRate - 0.05, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxFleshClip, c.sfxFleshGain * 1.2, c.sfxFleshRate - 0.15, { lenMs: 400, fadeMs: 150 });
          cue(c.sfxSplatClip, c.sfxSplatGain, c.sfxSplatRate - 0.2, { lenMs: 800, fadeMs: 300 });
          scene?.explode(o.defender.x, o.defender.y, radius, zips[zips.length - 1] ?? null, { burst: plan.burst, drops: plan.drops, drips: plan.drips, flashAlpha: c.flashAlpha, toward: Math.atan2(o.attacker.y - o.defender.y, o.attacker.x - o.defender.x), area });
        } else {
          // THE LAST CUT: the slice, the impact, the flesh, the splat (heavier per tier); a crack on III.
          const g = geos[n - 1];
          cue(c.sfxSliceClip, c.sfxSliceGain, c.sfxSliceRate + 0.05 * hitStep, { tail: c.sfxTailMix, lenMs: 600, fadeMs: 200 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { lenMs: c.sfxImpactLenMs, fadeMs: 300 });
          cue(c.sfxFleshClip, c.sfxFleshGain, c.sfxFleshRate - 0.03 * (plan.tier - 1), { lenMs: 400, fadeMs: 150 });
          cue(c.sfxSplatClip, c.sfxSplatGain * (0.9 + 0.1 * plan.tier), c.sfxSplatRate - 0.04 * (plan.tier - 1), { lenMs: 700, fadeMs: 250 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          if (g) scene?.impact(g, o.defender.x, o.defender.y, radius, { tier: plan.tier, k: plan.k, burst: plan.burst, drops: plan.drops, flashAlpha: c.flashAlpha, cross: n === 2 });
        }
        seq.land();
        break;
      case 'bleed':
        // The wounds keep bleeding: a soft wet drip sound, FX only.
        cue(c.sfxSplatClip, c.sfxSplatGain * 0.35, c.sfxSplatRate + 0.25, { lenMs: 350, fadeMs: 150 });
        if (!plan.hemorrhage) scene?.bleed(o.defender.x, o.defender.y, radius, plan.drips);
        break;
      case 'close':
        scene?.close();
        break;
      case 'boom': {
        const a = (mega ? mega.angle : 0) + q.i * 2.1 - Math.PI / 2 * 0.6;
        const rr = radius * (0.35 + 0.15 * q.i);
        cue(c.sfxSpurtClip, c.sfxSpurtGain, c.sfxSpurtRate + q.i * 0.1, { lenMs: 450, fadeMs: 180 });
        scene?.spurt(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr * 0.8, 0.9 + 0.15 * q.i, a);
        break;
      }
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.swingAt, plan.impactAt + (plan.hemorrhage ? 420 : 200));
    const cm = bleedCameraAt(plan, c, t, dir, cutDirs, zipDirs);
    const unit = local ? 1 : s;
    cam.apply(bleedCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The draw: the hero draws BACK from the target and turns (the blade raised); each swing SNAPS it forward and
      // round. IV: a deeper draw through the wind-up, then a lunge and a whip round on EVERY zip, alternating.
      let bx = 0, by = 0, rot = 0, sc = 1;
      const coil = (u: number, k: number): void => {
        bx -= toFoe.x * c.heroCoilPx * px * u * k; by -= toFoe.y * c.heroCoilPx * px * u * k;
        rot -= c.heroSwingDeg * flip * u * k;
      };
      if (t < plan.swingAt) coil(easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.swingAt - plan.chargeAt)), 1);
      else {
        const back = Math.max(0, spring(t - plan.swingAt, 3, 90));
        coil(back, 1);
        for (const sl of plan.slashes) {
          if (sl.swingAt > t) continue;
          const f = spring(t - sl.swingAt, 5, 60);
          bx += toFoe.x * c.heroSwingPx * px * f; by += toFoe.y * c.heroSwingPx * px * f;
          rot += c.heroSwingDeg * flip * 1.4 * f;
        }
        if (plan.hemorrhage && t >= plan.windAt) {
          if (t < plan.megaAt) {
            const u = easeInOutSine((t - plan.windAt) / Math.max(1, plan.megaAt - plan.windAt));
            coil(u, 1.8);
            sc += 0.05 * u;
          } else {
            coil(Math.max(0, spring(t - plan.megaAt, 8, 30)), 1.8);
            plan.zips.forEach((z, i) => {
              if (z.at > t) return;
              const f = spring(t - z.at, 5, 70);
              bx += toFoe.x * c.heroSwingPx * 1.4 * px * f; by += toFoe.y * c.heroSwingPx * 1.4 * px * f;
              rot += c.heroSwingDeg * flip * 2 * f * (i % 2 ? -1 : 1);
              sc += 0.03 * Math.max(0, f);
            });
          }
        }
      }
      hero.set(Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(rot) < 0.01 && Math.abs(sc - 1) < 1e-4 ? null
        : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    if (foe.el || scene) {
      let css: string | null = null;
      if (t >= plan.impactAt) {
        // Knocked back along the blow and squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        fx = dir.x * knock; fy = dir.y * knock;
        css = Math.abs(k) < 0.004 ? null
          : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // Each cut nudges the target along its own line; IV's heartbeats throb it.
        let kx = 0, ky = 0;
        plan.slashes.forEach((sl, i) => {
          if (sl.arriveAt > t || !plan.hits.includes(sl.arriveAt)) return;
          const f = Math.max(0, spring(t - sl.arriveAt, 6, 45)) * 7 * px;
          const d = cutDirs[i] ?? dir;
          kx += d.x * f; ky += d.y * f;
        });
        // The zips jolt it down each line; the held tension trembles and swells it.
        plan.zips.forEach((z, i) => {
          if (z.hitAt > t) return;
          const f = Math.max(0, spring(t - z.hitAt, 6, 40)) * 9 * px;
          const d = zipDirs[i] ?? dir;
          kx += d.x * f; ky += d.y * f;
        });
        let sc = 1;
        for (const b of plan.beats) if (t >= b) sc += 0.04 * Math.max(0, spring(t - b, 4, 70));
        if (plan.hemorrhage && t >= plan.tensionAt) {
          const u = (t - plan.tensionAt) / Math.max(1, plan.impactAt - plan.tensionAt);
          const a = (0.5 + 2.5 * u * u) * px;
          kx += a * Math.sin(t * 0.23); ky += a * Math.sin(t * 0.31);
          sc += 0.05 * u * u;
        }
        fx = kx; fy = ky;
        css = Math.abs(kx) + Math.abs(ky) < 0.05 && sc - 1 < 1e-4 ? null : `translate(${kx.toFixed(2)}px, ${ky.toFixed(2)}px) scale(${sc.toFixed(4)})`;
      }
      foe.set(css);
    }
    // The wounds, drips, stains and the tint ride the portrait (the offset in the overlay's px).
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<BleedCue | FormationCue> = new Sequence<BleedCue | FormationCue>({
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
    geos,
    mega,
    zips,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
