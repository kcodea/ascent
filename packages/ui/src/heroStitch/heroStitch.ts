/**
 * THE SOUL STITCH RUNNER (the Ancient of Bonds' hero attack, an ANCIENT): plays one Soul Stitch (the beats are in
 * `heroStitchConfig.ts`) and lands the consequence on its impact beat (the snap, the yank, the pins ripping out, or
 * the heart-knot bursting). Presentation only: the total and the blow are the engine's; this file only
 * decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), as every style does: one clock (it never pauses), the damage
 * formation, the `#stage` camera (applied ONCE: `stageCamera.ts`), the portraits (transform only, restored after), the
 * voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE PORTRAITS are tied together by the thread, and the thread's ends ride them (the scene is handed their offsets
 * every frame). I-II: on the tug the striker leans BACK and the struck portrait is yanked TOWARD it, then the snap
 * knocks it back. III: the struck portrait is STRETCHED toward the striker against five pins (a linear transform about
 * its own centre, its far rim held), then snaps back as they rip out. IV: the struck portrait is DRAGGED across the
 * board into the heart-knot, crushed small, and flung home. III and IV's * pose is solved in screen px and written in the portrait's own units (its ancestors' scale measured ONCE at the start),
 * with the camera folded in for a portrait that lives outside the camera element (the foe's is a <body> portal), so
 * the knot stays tied round it. It is raised over the other portrait while it is dragged (the `.duel-attacker-*`
 * z-order of ITS side). EVERY exit (the end, `finish()`, `cancel()`, the safety timer) puts both portraits' transforms
 * back exactly and removes the z-order class (only if this attack added it).
 *
 * THE CONTRACT: every piercing and stitch before the impact is a tick (FX and sound only). The consequence
 * (`onImpact`) lands exactly ONCE, on the impact.
 *
 * Perf: DOM moves are `transform` written from the clock; layout is read once at the start (IV only); the Pixi sprites
 * are pooled under a hard cap, the thread meshes rewritten in place, the textures painted once per session and
 * pre-warmed during the formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { restingRect } from '../heroBlast/portraits';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, easeOutCubic, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { playKoSting } from '../heroAttack/knockout';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  KNOT_PULSES, dragAt, getHeroStitchConfig, knotAt, needleAt, stitchCameraAt, stitchCameraFocus, stitchCues, stitchGeo, stitchPlan, stitchTimeScale, slowMoExtraMs, stretchAt, tugAt,
  type HeroStitchConfig, type StitchCue, type StitchGeo, type StitchPlan,
} from './heroStitchConfig';
import { HeroStitchScene, type HeroStitchTextures } from './heroStitchScene';
import { heroStitchTextures } from './heroStitchTextures';

export interface HeroStitchOptions extends HeroAttackOptions {
  cfg?: HeroStitchConfig;
  textures?: HeroStitchTextures | null;
}

export interface HeroStitchHandle extends HeroAttackHandle {
  readonly plan: StitchPlan;
  /** Every needle's path (empty under reduced motion). */
  readonly geo: StitchGeo;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). */
  readonly scene: HeroStitchScene | null;
  /** Whether the camera is mirrored onto the Pixi root (false when the canvas already rides the camera). */
  readonly mirrorsCamera: boolean;
  /** IV: the struck portrait's drag at a sequence time (screen px), pure. Zero on other tiers. */
  foeDrag(t: number): Pt;
}

/** The seed a fight's shards are scattered from: the same fight bursts the same way. */
export function stitchSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 4513 + Math.round(distance) * 41 + (side === 'opp' ? 223 : 19)) >>> 0;
}

/** I-II: the struck portrait's pull at `t` (px along `-u` toward the striker, and a tremble). Pure. */
export function foePull(p: StitchPlan, c: HeroStitchConfig, t: number): { yank: number; tremble: number } {
  if (p.kind !== 'needle' && p.kind !== 'cross') return { yank: 0, tremble: 0 };
  const tug = tugAt(p, t);
  return { yank: c.foeYankPx * tug, tremble: 0.3 * tug };
}

/**
 * One measure of a portrait, read ONCE, AT REST (`restingRect`: the foe's portrait drops in scaling up, and a tuner
 * preview starts while that is still running, so a plain measure there read it small and the drag over-shot the knot;
 * owner review 2026-10-02: "the heart isn't over the target enough"): `inv` = its own transform px per screen px (its
 * ancestors' scale), and `ox, oy` = where the round art's centre `art` sits from the wrapper's centre (the transform
 * origin), screen px, so a stretch or a crush is solved about the ART, not the wrapper (the player's holds its name).
 */
function measure(el: HTMLElement | null | undefined, art: Pt): { inv: number; ox: number; oy: number } {
  try {
    const b = el ? restingRect(el, el.closest('.combatopp') ?? el) : null;
    if (!el || !b || !(b.width > 0) || !(el.offsetWidth > 0)) return { inv: 1, ox: 0, oy: 0 };
    return { inv: el.offsetWidth / b.width, ox: art.x - (b.left + b.width / 2), oy: art.y - (b.top + b.height / 2) };
  } catch { return { inv: 1, ox: 0, oy: 0 }; }
}

/** Play Soul Stitch. Returns a handle; the blow lands via `onImpact` on the impact. */
export function playHeroStitch(o: HeroStitchOptions): HeroStitchHandle {
  const c = o.cfg ?? getHeroStitchConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = stitchPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, stitchCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hstitch',
  });

  const geo = stitchGeo(plan, o.attacker, o.defender, aRadius, radius, c, (local ? 8 : 36) * s);
  const u = geo.u;
  const big = plan.kind === 'bound';
  /** III and IV move the struck portrait far or reshape it: solved exactly in screen px. */
  const exact = plan.kind === 'bound' || plan.kind === 'pinned';

  const textures = o.textures !== undefined ? o.textures : heroStitchTextures();
  const scene = textures && !reduced
    ? new HeroStitchScene(textures, {
      thread: hexToNum(c.colorThread), lilac: hexToNum(c.colorLilac), deep: hexToNum(c.colorDeep), gold: hexToNum(c.colorGold),
      bone: hexToNum(c.colorBone), side: hexToNum(sideHex),
    }, {
      needleSize: c.needleSize, needleGlow: c.needleGlow, threadWidth: c.threadWidth, threadGlow: c.threadGlow, sag: c.sag, tautMs: c.tautMs,
      twangPx: c.twangPx, knotSize: c.knotSize, ripRibbons: c.ripRibbons, rainShards: c.rainShards,
    }, plan, geo, { x: o.defender.x, y: o.defender.y, r: radius }, s, stitchSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  // III-IV place the portraits exactly: screen px -> their own px (measured once), with the camera folded in for a
  // portrait outside the camera element. I-II keep the approved small moves as they are.
  const heroM = exact && !local ? measure(hero.el, o.attacker) : { inv: 1, ox: 0, oy: 0 };
  const foeM = exact && !local ? measure(foe.el, o.defender) : { inv: 1, ox: 0, oy: 0 };
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));
  // IV: the dragged portrait is raised over the other one (its own side's duel z-order), only while this attack runs.
  const foeZ = o.side === 'opp' ? 'duel-attacker-player' : 'duel-attacker-opp';
  const canRaise = big && !reduced && !local && !!foe.el && !!doc;
  let raised = false;

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxSummonClip, c.sfxLaunchClip, c.sfxPierceClip, c.sfxStitchClip, c.sfxTugClip, c.sfxSnapClip, c.sfxImpactClip,
    c.sfxThumpClip, c.sfxShatterClip, c.sfxTwangClip, c.sfxDragClip, c.sfxKnotClip, c.sfxStrainClip, c.sfxStrikeClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const unit = local ? 1 : s;
  const px = local ? 0.45 : 1;
  /** IV's small moves in screen px (a sandbox box moves less). */
  const mv = local ? 0.45 : unit;
  let pierced = 0;

  /** IV: the struck portrait's drag (screen px) at `t`. */
  const foeDrag = (t: number): Pt => {
    const k = dragAt(plan, t) * geo.drag;
    return { x: -u.x * k, y: -u.y * k };
  };

  // The portraits' offsets this frame, in SCREEN px (what the scene and the impact read).
  const off = { hx: 0, hy: 0, fx: 0, fy: 0 };

  const fire = (q: StitchCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The needles crystallise on the rim: a crystal shimmer.
        cue(c.sfxSummonClip, c.sfxSummonGain, c.sfxSummonRate, { lenMs: 900, fadeMs: 300 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.summon(o.attacker, aRadius);
        cam.start();
        break;
      case 'launch':
        // Each needle: a thin whip of air, a step higher each time.
        cue(c.sfxLaunchClip, c.sfxLaunchGain * (big ? 0.8 : 1), c.sfxLaunchRate + 0.06 * q.i, { lenMs: 300, fadeMs: 120 });
        scene?.launch(q.i);
        break;
      case 'pierce': {
        // A tick: a crystal ting as the needle goes in (and a soft whisper of thread behind it). FX only.
        cue(c.sfxPierceClip, c.sfxPierceGain * (0.85 + 0.05 * pierced), c.sfxPierceRate + 0.05 * pierced, { lenMs: 450, fadeMs: 180 });
        if (q.i === 0 || !big) cue(c.sfxStitchClip, c.sfxStitchGain * 0.7, c.sfxStitchRate, { lenMs: 500, fadeMs: 220 });
        const st = needleAt(plan, geo, q.i, t);
        if (st.visible) scene?.pierce({ x: st.x, y: st.y }, { x: Math.cos(st.rot), y: Math.sin(st.rot) }, big ? 0.75 : plan.kind === 'pinned' ? 0.85 : 1);
        pierced++;
        break;
      }
      case 'sewn': {
        const n = geo.needles[q.i];
        const end = n?.sew[n.sew.length - 1];
        if (end) scene?.sewn(end);
        if (!big) cue(c.sfxPierceClip, c.sfxPierceGain * 0.5, c.sfxPierceRate + 0.2, { lenMs: 260, fadeMs: 120 });
        break;
      }
      case 'tug':
        if (plan.kind === 'pinned') {
          // III: the hero leans back on all five: a taut-string TWANG, a wind-up, a riser as the portrait strains.
          cue(c.sfxTwangClip, c.sfxTwangGain, c.sfxTwangRate, { lenMs: 500, fadeMs: 200, tail: 0.1 });
          cue(c.sfxTugClip, c.sfxTugGain, c.sfxTugRate * 0.95, { lenMs: 700, fadeMs: 200 });
          voices.riser(c.sfxStrainClip, c.sfxStrainGain * 0.8, c.sfxStrainRate * 1.1, real(plan.impactAt - plan.tugAt));
          scene?.tug(o.attacker, aRadius, false);
        } else if (big) {
          // IV: the YANK: a wind-up, a heavy drag, and a riser that climaxes on the burst.
          cue(c.sfxTugClip, c.sfxTugGain * 1.2, c.sfxTugRate * 0.85, { lenMs: 700, fadeMs: 200 });
          cue(c.sfxDragClip, c.sfxDragGain, c.sfxDragRate, { lenMs: 900, fadeMs: 300 });
          voices.riser(c.sfxStrainClip, c.sfxStrainGain, c.sfxStrainRate, real(plan.impactAt - plan.tugAt));
          scene?.tug(o.attacker, aRadius, true);
          if (canRaise && !doc!.body.classList.contains(foeZ)) { doc!.body.classList.add(foeZ); raised = true; }
        } else {
          // I-II: the hero takes the thread and pulls: a wind-up.
          cue(c.sfxTugClip, c.sfxTugGain, c.sfxTugRate, { lenMs: 700, fadeMs: 200 });
          scene?.tug(o.attacker, aRadius, false);
        }
        break;
      case 'knot':
        // IV: the target lands in the knot: a gold clank, a ring snapping in round it.
        cue(c.sfxKnotClip, c.sfxKnotGain, c.sfxKnotRate, { lenMs: 600, fadeMs: 220 });
        cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate, { lenMs: 400, fadeMs: 160 });
        scene?.knotted(o.defender);
        break;
      case 'cinch':
        if (q.i > KNOT_PULSES) {
          // TIER V: the DOUBLE-CINCH: the knot squeezes once more, hard, in a prismatic flash (a heavy clank and a thump).
          cue(c.sfxKnotClip, c.sfxKnotGain * 1.25, c.sfxKnotRate * 0.85, { lenMs: 500, fadeMs: 200 });
          cue(c.sfxThumpClip, c.sfxThumpGain * 1.1, c.sfxThumpRate - 0.1, { lenMs: 400, fadeMs: 160 });
          scene?.koCinch(o.defender); // rides the dragged portrait (`follow`), exactly as the cinches do
          break;
        }
        // IV: the knot cinches tighter: a gold clink climbing each time, sparks off the heart.
        cue(c.sfxKnotClip, c.sfxKnotGain * (0.6 + 0.1 * q.i), c.sfxKnotRate * (1 + 0.12 * q.i), { lenMs: 300, fadeMs: 120 });
        scene?.cinch(o.defender, q.i);
        break;
      case 'tied': {
        // IV: the knot is tied shut: a higher clank and a crystal ting at the clasp.
        cue(c.sfxKnotClip, c.sfxKnotGain * 1.1, c.sfxKnotRate * 1.3, { lenMs: 500, fadeMs: 200 });
        cue(c.sfxPierceClip, c.sfxPierceGain, c.sfxPierceRate * 0.9, { lenMs: 400, fadeMs: 160 });
        scene?.tied({ x: o.defender.x, y: o.defender.y - 0.564 * radius * c.knotSize });
        break;
      }
      case 'strike':
        // IV: the hero strikes down the laces: a rush of air.
        cue(c.sfxLaunchClip, c.sfxLaunchGain * 1.3, c.sfxLaunchRate * 0.65, { lenMs: 500, fadeMs: 200 });
        break;
      case 'impact': {
        const dNow = { x: o.defender.x + off.fx, y: o.defender.y + off.fy };
        if (plan.kind === 'pinned') {
          // III: five crystal SNAPS one on another as the pins rip out, a twang, the hit and the splinters.
          for (let k = 0; k < plan.needles.length; k++) {
            cue(c.sfxSnapClip, c.sfxSnapGain * (0.75 - 0.05 * k), c.sfxSnapRate + 0.08 * k, { lenMs: 500, fadeMs: 200, delayMs: real(18 * k) });
          }
          cue(c.sfxPierceClip, c.sfxPierceGain * 1.2, c.sfxPierceRate * 0.85, { lenMs: 500, fadeMs: 200 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate, { lenMs: 700, fadeMs: 260 });
          cue(c.sfxShatterClip, c.sfxShatterGain, c.sfxShatterRate * 1.1, { lenMs: 900, fadeMs: 300 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.06, { lenMs: 500, fadeMs: 180 });
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.8, c.sfxBoomRate * 1.15, { delayMs: real(30), lenMs: 600, fadeMs: 220 });
        } else if (big) {
          // IV: every lace SNAPS, the hero's strike lands, the knot bursts, the crystal chimes out.
          cue(c.sfxSnapClip, c.sfxSnapGain * 1.15, c.sfxSnapRate * 0.85, { lenMs: 900, fadeMs: 300, tail: 0.12 });
          cue(c.sfxStrikeClip, c.sfxStrikeGain, c.sfxStrikeRate, { lenMs: 1000, fadeMs: 320, tail: 0.15 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.1, { lenMs: 800, fadeMs: 300 });
          cue(c.sfxShatterClip, c.sfxShatterGain * 1.1, c.sfxShatterRate * 0.9, { lenMs: 1100, fadeMs: 400 });
          cue(c.sfxRumbleClip, c.sfxRumbleGain, c.sfxRumbleRate, { lenMs: 1200, fadeMs: 400, tail: 0.2 });
          cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate, { delayMs: real(90), lenMs: 700, fadeMs: 250 });
          cue(c.sfxRainClip, c.sfxRainGain, c.sfxRainRate, { delayMs: real(420), lenMs: 1200, fadeMs: 500 });
          cue(c.sfxSummonClip, c.sfxSummonGain * 0.8, c.sfxSummonRate * 1.25, { delayMs: real(220), lenMs: 1000, fadeMs: 400 });
        } else {
          // I-II: the taut thread snaps (a whip crack), the bright hit, a low punch; shards for II.
          cue(c.sfxSnapClip, c.sfxSnapGain * (0.9 + 0.08 * plan.tier), c.sfxSnapRate - 0.04 * (plan.tier - 1), { lenMs: 900, fadeMs: 300, tail: 0.12 });
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { lenMs: 700, fadeMs: 260 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 500, fadeMs: 180 });
          if (plan.tier >= 2) cue(c.sfxShatterClip, c.sfxShatterGain * 0.6, c.sfxShatterRate, { lenMs: 900, fadeMs: 300 });
        }
        scene?.impact(big ? dNow : o.defender, big ? radius * c.crush : radius, u, {
          shards: plan.shards, burst: plan.burst, t, foe: { x: off.fx, y: off.fy }, hero: { x: off.hx, y: off.hy },
        });
        // TIER V: the Ancient prism over the gold and violet burst, and the KO sting.
        if (plan.ko) {
          scene?.koFlourish(dNow, radius * c.crush, plan.burst);
          playKoSting(voices, sound, real);
        }
        seq.land();
        break;
      }
      case 'home':
        // IV: the target thuds back onto its spot.
        cue(c.sfxThumpClip, c.sfxThumpGain * 0.8, c.sfxThumpRate + 0.1, { lenMs: 400, fadeMs: 160 });
        break;
      default:
        break;
    }
  };

  /** I-II: the approved moves (portrait px, scaled by the stage like every other style). */
  const paintSmall = (t: number): void => {
    const tug = tugAt(plan, t);
    let hx = 0, hy = 0, hs = 1;
    if (t >= plan.chargeAt) {
      if (t < plan.launchAt) hs = 1 + c.heroSwell * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.launchAt - plan.chargeAt));
      else hs = 1 + c.heroSwell * Math.max(0, spring(t - plan.launchAt, 4, 80));
      let flick = 0;
      for (const q of plan.needles) flick += (t >= q.launchAt ? 1 : 0) * Math.max(0, spring(t - q.launchAt, 5, 50));
      const pull = c.heroPullPx * (t < plan.impactAt ? tug : spring(t - plan.impactAt, 3.5, 90));
      const d = (6 * flick - pull) * px;
      hx = u.x * d; hy = u.y * d;
    }
    hero.set(Math.abs(hs - 1) < 1e-4 && Math.abs(hx) + Math.abs(hy) < 0.05 ? null : `translate(${hx.toFixed(2)}px, ${hy.toFixed(2)}px) scale(${hs.toFixed(4)})`);
    let fx = 0, fy = 0, sx = 1, sy = 1;
    if (t < plan.impactAt) {
      let k = 0;
      for (const at of plan.hits) k += (at <= t ? 1 : 0) * Math.max(0, spring(t - at, 6, 45));
      const pl = foePull(plan, c, t);
      const tr = pl.tremble * 2.2 * px;
      fx = u.x * (k * 5 * px - pl.yank * px) + tr * Math.sin(t * 0.23);
      fy = u.y * (k * 5 * px - pl.yank * px) + tr * Math.sin(t * 0.31 + 1);
    } else {
      const k = spring(t - plan.impactAt, 4.5, 80);
      const knock = c.knockPx * (0.7 + 0.5 * plan.k) * k * px;
      const sq = c.squash * (0.8 + 0.5 * plan.k) * k;
      fx = u.x * knock; fy = u.y * knock;
      sx = 1 - sq; sy = 1 + sq * 0.6;
    }
    const still = Math.abs(fx) + Math.abs(fy) < 0.05 && Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4;
    foe.set(still ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`);
    off.hx = hx * unit; off.hy = hy * unit; off.fx = fx * unit; off.fy = fy * unit;
  };

  /**
   * III: PINNED, and IV: BOUND TOGETHER. Solved in SCREEN px. III: the striker leans back on the five threads and
   * springs home on the snap; the target STRETCHES toward it about its far rim (`stretchAt`), trembling, and snaps back
   * through a squash, plus a knock. IV: the striker swells, flicks on each launch, LEANS BACK on the yank and holds,
   * LUNGES at the knot on the strike and springs home; the target is dragged into the knot (`dragAt`), crushed with it
   * (`knotAt`), trembling as it strains, and flung home on the burst with a squash, exactly on its spot from `homeAt`.
   */
  const paintExact = (t: number, cm: { zoom: number; x: number; y: number }, focus: Pt): { hx: number; hy: number; fx: number; fy: number; m: [number, number, number, number] } => {
    const pin = plan.kind === 'pinned';
    let hd = 0, hs = 1;
    if (t >= plan.chargeAt) {
      if (t < plan.launchAt) hs = 1 + c.heroSwell * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.launchAt - plan.chargeAt));
      else hs = 1 + c.heroSwell * Math.max(0, spring(t - plan.launchAt, 4, 80));
      let flick = 0;
      for (const q of plan.needles) flick += (t >= q.launchAt ? 1 : 0) * Math.max(0, spring(t - q.launchAt, 5, 50));
      const lean = pin
        ? c.heroPullPx * 1.4 * (t < plan.impactAt ? tugAt(plan, t) : spring(t - plan.impactAt, 3.5, 90))
        : c.heroPullPx * 1.5 * (t < plan.strikeAt! ? tugAt(plan, t) : 0);
      let lunge = 0;
      if (pin) lunge = 0;
      else if (t >= plan.strikeAt! && t < plan.impactAt) {
        const v = (t - plan.strikeAt!) / Math.max(1, plan.impactAt - plan.strikeAt!);
        lunge = c.heroLungePx * (v < 0.3 ? -0.6 * Math.sin((v / 0.3) * Math.PI * 0.5) : -0.6 + 1.6 * easeOutCubic((v - 0.3) / 0.7));
      } else if (t >= plan.impactAt) lunge = c.heroLungePx * Math.max(0, spring(t - plan.impactAt, 3, 110));
      hd = (6 * flick - lean + lunge) * mv;
    }
    const drag = foeDrag(t);
    const tie = knotAt(plan, t);
    const st = stretchAt(plan, c, t);
    const strain = plan.strikeAt !== null && t >= plan.knotAt! && t < plan.impactAt ? Math.min(1, (t - plan.knotAt!) / Math.max(1, plan.impactAt - plan.knotAt!)) : 0;
    let fx = drag.x, fy = drag.y, fsx = 1, fsy = 1;
    // III: the stretch along the line to the striker (its far rim held): the centre slides toward the striker.
    let m: [number, number, number, number] = [1, 0, 0, 1];
    if (pin) {
      const ku = 1 + st, kn = 1 - 0.3 * st;
      m = [ku * u.x * u.x + kn * u.y * u.y, (ku - kn) * u.x * u.y, (ku - kn) * u.x * u.y, ku * u.y * u.y + kn * u.x * u.x];
      fx -= u.x * radius * st; fy -= u.y * radius * st;
    }
    if (t < plan.impactAt) {
      let k = 0;
      for (const at of plan.hits) k += (at <= t ? 1 : 0) * Math.max(0, spring(t - at, 6, 45));
      const tr = (pin ? 1.6 * tugAt(plan, t) : 0.3 * tugAt(plan, t) + 1.4 * strain) * 2.2 * mv;
      fx += u.x * k * 5 * mv + tr * Math.sin(t * 0.23);
      fy += u.y * k * 5 * mv + tr * Math.sin(t * 0.31 + 1);
      const crush = 1 - (1 - c.crush) * tie;
      fsx = crush; fsy = crush;
    } else if (pin) {
      // Snapped back: the stretch rings out through a squash (`stretchAt`), and a knock along the line.
      const k = spring(t - plan.impactAt, 4.5, 85);
      fx += u.x * c.knockPx * (0.7 + 0.5 * plan.k) * k * mv; fy += u.y * c.knockPx * (0.7 + 0.5 * plan.k) * k * mv;
    } else {
      // Flung home: the crush springs back out with a squash; the knock is along the line (away from the striker).
      const since = t - plan.impactAt;
      const back = 1 - (1 - c.crush) * Math.max(0, 1 - since / 140);
      const k = spring(since, 4, 95);
      const sq = c.squash * 1.3 * k;
      fx += u.x * c.knockPx * 0.6 * k * mv; fy += u.y * c.knockPx * 0.6 * k * mv;
      fsx = back * (1 - sq); fsy = back * (1 + sq * 0.6);
    }
    if (!pin) m = [fsx, 0, 0, fsy];
    // Screen offsets -> each portrait's own transform: the camera folded in for a portrait outside the camera element.
    const ax = focus.x * (1 - cm.zoom) + cm.x * unit, ay = focus.y * (1 - cm.zoom) + cm.y * unit;
    const fold = (at: Pt, ox: number, oy: number, inCam: boolean): { x: number; y: number; z: number } => (inCam || !cam.active
      ? { x: ox, y: oy, z: 1 }
      : { x: ox * cm.zoom + at.x * (cm.zoom - 1) + ax, y: oy * cm.zoom + at.y * (cm.zoom - 1) + ay, z: cm.zoom });
    const hx = u.x * hd, hy = u.y * hd;
    // A linear map M about the ART's centre, written about the wrapper's (the transform origin): the extra shift
    // (I - M)(art - origin) keeps the art's centre where the offset puts it.
    const place = (el: HTMLElement, at: Pt, me: { inv: number; ox: number; oy: number }, ox: number, oy: number, mm: readonly number[], inCam: boolean): void => {
      const f = fold(at, ox, oy, inCam);
      const a = mm[0]! * f.z, b = mm[1]! * f.z, cc = mm[2]! * f.z, dd = mm[3]! * f.z;
      const x = f.x + (me.ox - (mm[0]! * me.ox + mm[1]! * me.oy)) * f.z, y = f.y + (me.oy - (mm[2]! * me.ox + mm[3]! * me.oy)) * f.z;
      const moved = Math.abs(x) > 0.05 || Math.abs(y) > 0.05 || Math.abs(a - 1) > 1e-4 || Math.abs(dd - 1) > 1e-4 || Math.abs(b) > 1e-4 || Math.abs(cc) > 1e-4;
      // CSS matrix(a, b, c, d, e, f) maps x' = a x + c y, y' = b x + d y.
      const tf = `translate(${(x * me.inv).toFixed(2)}px, ${(y * me.inv).toFixed(2)}px) matrix(${a.toFixed(4)}, ${cc.toFixed(4)}, ${b.toFixed(4)}, ${dd.toFixed(4)}, 0, 0)`;
      (el === hero.el ? hero : foe).set(moved ? tf : null);
    };
    if (hero.el) place(hero.el, o.attacker, heroM, hx, hy, [hs, 0, 0, hs], heroInCam);
    if (foe.el) place(foe.el, o.defender, foeM, fx, fy, m, foeInCam);
    off.hx = hx; off.hy = hy; off.fx = fx; off.fy = fy;
    return { hx, hy, fx, fy, m };
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.launchAt, plan.impactAt + 260);
    const cm = stitchCameraAt(plan, c, t, u);
    const focus = stitchCameraFocus(plan, t, o.attacker, o.defender, foeDrag(t));
    cam.apply(focus, cm.zoom, cm.x, cm.y, unit);
    if (exact) {
      const r = paintExact(t, cm, focus);
      scene?.draw(t, { heroX: r.hx, heroY: r.hy, foeX: r.fx, foeY: r.fy, foeM: r.m });
    } else {
      paintSmall(t);
      scene?.draw(t, { heroX: off.hx, heroY: off.hy, foeX: off.fx, foeY: off.fy });
    }
  };

  const seq: Sequence<StitchCue | FormationCue> = new Sequence<StitchCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    // IV's slow-mo dip on the burst: the frame source hands the ONE clock a scaled step (a smooth ramp, never 0).
    frames: (fn: (dt: number) => void) => (o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)))((dt) => fn(dt * (seq && !seq.done ? stitchTimeScale(plan, c, seq.t) : 1))),
    safetyMs: o.safety !== false ? (plan.endAt + slowMoExtraMs(plan, c)) / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck(); scene?.hideOwn();
      if (raised) { doc!.body.classList.remove(foeZ); raised = false; }
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    scene,
    foeDrag,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
