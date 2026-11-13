/**
 * THE FOURTH WALL RUNNER ("Fourth Wall", style `glass`; ANCIENT, dev-only until it gets a cosmetic): plays one Fourth
 * Wall hero attack (the beats are in `heroGlassConfig.ts`) and lands the consequence on its impact beat. Presentation
 * only: the total and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * THE SCREEN IS A PANE OF GLASS and the blow breaks it: a pebble chips it (I), two pebbles web it (II), a rock breaks a
 * pane out of it round the struck portrait (III), and on IV the striker punches it, one crack races edge to edge through
 * both portraits, the web creaks out, and the WHOLE SCREEN SHATTERS and falls away. The cracks and the shards are one
 * geometry, made once per blow from its seed (`glassGeo`), so the screen breaks exactly where it cracked.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses; IV's shatter gets a slow-mo DIP
 * through the frame source, never a freeze), the damage formation, the `#stage` camera (applied ONCE), the portraits
 * (transform only, restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * WHERE THE GLASS IS: the scene mounts on the shared above-portrait overlay, a fixed full-screen canvas over the game
 * view, so the cracks draw over the board, the rail and the portraits alike.
 *
 * THE CONTRACT: II's first pebble is a tick (FX and sound only). The consequence (`onImpact`) lands exactly ONCE, on the
 * impact beat (IV: the shatter).
 *
 * Perf (docs/performance.md): DOM moves are `transform` only, from the clock; no layout reads after the opening measure;
 * every crack sprite and shard mesh is built during the damage formation, never on a hot beat; a grown crack costs
 * nothing per frame; the shards rewrite two small arrays in place; no filters; the updater unhooks when the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices, type CueOpts } from '../heroAttack/attackSound';
import { playKoSting } from '../heroAttack/knockout';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  getHeroGlassConfig, glassCameraAt, glassCameraFocus, glassCues, glassGeo, glassPlan, glassScale, glassSeed, glassSlowExtraMs, stoneAt,
  type GlassCue, type GlassGeo, type GlassPlan, type HeroGlassConfig,
} from './heroGlassConfig';
import { HeroGlassScene, type HeroGlassTextures } from './heroGlassScene';
import { heroGlassTextures } from './heroGlassTextures';

export interface HeroGlassOptions extends HeroAttackOptions {
  cfg?: HeroGlassConfig;
  textures?: HeroGlassTextures | null;
}

export interface HeroGlassHandle extends HeroAttackHandle {
  readonly plan: GlassPlan;
  readonly geo: GlassGeo;
  readonly scene: HeroGlassScene | null;
  readonly mirrorsCamera: boolean;
}

/** Where in the creak clip each creak starts (its crackles, measured: about 160, 320, 600 and 760 ms in). */
const CREAK_STARTS = [130, 300, 570, 730, 30] as const;

/** Play the Fourth Wall. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroGlass(o: HeroGlassOptions): HeroGlassHandle {
  const c = o.cfg ?? getHeroGlassConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = glassPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, glassCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hglass',
  });

  // THE GLASS: the whole screen (a sandbox box: the box round the two portraits).
  const vw = typeof window === 'undefined' ? 1920 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 1080 : window.innerHeight;
  const screen = local
    ? { x: Math.min(o.attacker.x, o.defender.x) - dist * 0.3, y: Math.min(o.attacker.y, o.defender.y) - dist * 0.3, w: Math.abs(o.attacker.x - o.defender.x) + dist * 0.6, h: Math.abs(o.attacker.y - o.defender.y) + dist * 0.6 }
    : { x: 0, y: 0, w: vw, h: vh };
  const geo = glassGeo(plan, o.attacker, o.defender, radius, aRadius, c, screen, glassSeed(o.total, dist, o.side, o.rollSeed), s);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  const flip = o.attacker.x > o.defender.x ? -1 : 1;
  const stoneSize = plan.kind === 'pane' ? 1.7 : 1;

  const textures = o.textures !== undefined ? o.textures : heroGlassTextures();
  const scene = textures && !reduced
    ? new HeroGlassScene(textures, {
      glass: hexToNum(c.colorGlass), edge: hexToNum(c.colorEdge), shade: hexToNum(c.colorShade), flash: hexToNum(c.colorFlash), stone: hexToNum(c.colorStone), side: hexToNum(sideHex),
    }, {
      gravity: c.shardGravity, burst: c.shardBurst, spin: c.shardSpin, rim: c.shardRim, stonePx: c.stonePx, impactSize: c.impactSize, splitAlpha: c.splitAlpha,
    }, s, glassSeed(o.total, dist, o.side, o.rollSeed) ^ 0x51ed)
    : null;
  if (scene) {
    // Everything the blow will draw is built NOW, while the damage formation plays: nothing is made on a hot beat.
    scene.setArea(screen);
    scene.setCracks(geo.segs);
    if (geo.tris.length) scene.setShards(geo.tris, geo.origin, plan.kind === 'pane' ? 'pane' : 'shatter');
  }
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const cue = (clip: string, gain: number, rate: number, opts?: CueOpts): void =>
    voices.cue(clip, gain, rate * (0.88 + 0.12 * glassScale(plan, c, seq ? seq.t : 0)), opts);
  voices.warm([c.sfxThrowClip, c.sfxTickClip, c.sfxCreakClip, c.sfxRaceClip, c.sfxPaneClip, c.sfxShatterClip, c.sfxRepairClip, c.sfxThudClip]);
  // The last crack finishes growing here; after it the per-frame grow call is skipped.
  const grownAt = geo.segs.reduce((m, g) => Math.max(m, g.t1), 0) + 40;
  const chipPx = (size: number): number => radius * 1.5 * size;
  /** A point on the web that is cracking at a jump (the first crack that starts at or after it). */
  const crackingAt = (at: number): Pt => {
    const g = geo.segs.find((x) => x.t0 >= at) ?? geo.segs[geo.segs.length - 1];
    return g ? { x: g.bx, y: g.by } : geo.origin;
  };

  const fire = (q: GlassCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'throw':
        cue(c.sfxThrowClip, c.sfxThrowGain * (plan.kind === 'pane' ? 1.3 : 1), c.sfxThrowRate + 0.12 * q.i - (plan.kind === 'pane' ? 0.3 : 0), { lenMs: 260, fadeMs: 110 });
        break;
      case 'race': {
        // IV: the striker punches the glass. A chip where it hit, and the one crack is off (its sound peaks ~300 ms in).
        const at = geo.chips[0]?.at ?? o.attacker;
        scene?.chip(at, chipPx(geo.chips[0]?.size ?? 0.8));
        scene?.tap(at, 1.5);
        cue(c.sfxTickClip, c.sfxTickGain * 1.2, c.sfxTickRate * 0.8, { lenMs: 300, fadeMs: 120 });
        cue(c.sfxThudClip, c.sfxThudGain * 0.7, c.sfxThudRate * 1.25, { lenMs: 420, fadeMs: 180 });
        cue(c.sfxRaceClip, c.sfxRaceGain, c.sfxRaceRate * Math.min(1.5, Math.max(0.7, 520 / Math.max(1, plan.raceEnd - plan.raceAt))), { fadeMs: 120 });
        break;
      }
      case 'tap': {
        // II's first pebble: a tick on the glass, its chip and its first cracks. Not the blow.
        const at = geo.taps[q.i] ?? o.defender;
        scene?.chip(at, chipPx(geo.chips[q.i]?.size ?? 0.5));
        scene?.tap(at, 0.8);
        scene?.bounce(at, toFoe);
        cue(c.sfxTickClip, c.sfxTickGain * 0.85, c.sfxTickRate * 1.08, { lenMs: 300, fadeMs: 120 });
        break;
      }
      case 'creak': {
        // The cracks jump outward: a short window of the creak clip (a different crackle each time), a hairline flash.
        const n = q.i % CREAK_STARTS.length;
        cue(c.sfxCreakClip, c.sfxCreakGain * (plan.kind === 'shatter' ? 0.9 + 0.08 * q.i : 1), c.sfxCreakRate * (0.92 + 0.06 * n), { startMs: CREAK_STARTS[n], lenMs: 230, fadeMs: 90 });
        scene?.creak(crackingAt(q.at), plan.kind === 'shatter' ? 1.4 : 1);
        // IV: the web's own chip appears as the racing crack reaches the struck portrait (the first jump).
        if (plan.kind === 'shatter' && q.i === 0 && geo.chips[1]) { scene?.chip(geo.chips[1].at, chipPx(geo.chips[1].size)); scene?.tap(geo.chips[1].at, 1); }
        break;
      }
      case 'impact':
        if (plan.kind === 'shatter') {
          // THE WHOLE SCREEN SHATTERS: the cracks are gone (the shards' own edges take over) and everything falls.
          scene?.setMarksAlpha(0);
          scene?.setSplit(o.attacker, o.defender, 0, 0);
          scene?.breakOut();
          scene?.shatterFx(geo.origin, plan.ko);
          cue(c.sfxShatterClip, c.sfxShatterGain, c.sfxShatterRate * (plan.ko ? 0.94 : 1), { tail: c.sfxTailMix, fadeMs: 400 });
          cue(c.sfxThudClip, c.sfxThudGain, c.sfxThudRate * 0.85, { lenMs: 900, fadeMs: 350 });
          if (plan.ko) playKoSting(voices, sound, (ms) => ms / speed);
        } else {
          const i = geo.taps.length - 1;
          const at = geo.taps[i] ?? o.defender;
          scene?.chip(at, chipPx(geo.chips[i]?.size ?? 0.5));
          scene?.tap(at, plan.kind === 'pane' ? 1.8 : plan.kind === 'web' ? 1.1 : 0.9);
          scene?.bounce(at, toFoe, stoneSize);
          cue(c.sfxTickClip, c.sfxTickGain * (plan.kind === 'pane' ? 1.25 : 1), c.sfxTickRate * (plan.kind === 'pane' ? 0.72 : plan.kind === 'web' ? 0.96 : 1), { lenMs: 320, fadeMs: 130 });
          if (plan.kind === 'pane') cue(c.sfxThudClip, c.sfxThudGain * 0.8, c.sfxThudRate, { lenMs: 500, fadeMs: 200 });
        }
        seq.land();
        break;
      case 'break':
        // III: the pane lets go.
        scene?.breakOut();
        scene?.paneBreak(geo.origin, radius * 1.2);
        cue(c.sfxPaneClip, c.sfxPaneGain, c.sfxPaneRate, { tail: c.sfxTailMix, fadeMs: 250 });
        break;
      case 'repair':
        scene?.repair(geo.origin, radius * 1.25);
        cue(c.sfxRepairClip, c.sfxRepairGain, c.sfxRepairRate, { lenMs: 500, fadeMs: 250 });
        break;
      default:
        break;
    }
  };

  // ── the per-frame paint ──
  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.tier >= 4 ? 380 : 200));
    const cm = glassCameraAt(plan, c, t, toFoe);
    const unit = local ? 1 : s;
    cam.apply(glassCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    if (scene) {
      if (t <= grownAt) scene.growCracks(t);
      if (plan.kind === 'shatter') {
        if (t < plan.impactAt) {
          // The held beat: the picture sits a hair apart across the main crack, slipping a notch with every creak.
          let notch = 0;
          for (const at of plan.jumps) if (t >= at) notch++;
          const a = c.splitAlpha * clamp01((t - plan.raceAt) / Math.max(1, plan.raceEnd - plan.raceAt));
          if (geo.main) scene.setSplit(geo.main.a, geo.main.b, a, notch * 1.5 * s);
        }
      } else {
        scene.setMarksAlpha(t < plan.healAt ? 1 : 1 - clamp01((t - plan.healAt) / Math.max(1, plan.healEnd - plan.healAt)));
        for (let i = 0; i < plan.stones.length; i++) {
          const st = stoneAt(plan.stones[i]!, geo.hand, geo.taps[i] ?? o.defender, c.stoneArc, t);
          scene.setStone(i, st.p, st.u, st.phase === 'fly', stoneSize);
        }
        if (plan.kind === 'pane') {
          scene.setHole(t < plan.breakAt ? 0 : t < plan.repairAt ? 0.5 * clamp01((t - plan.breakAt) / 70) : 0.5 * (1 - clamp01((t - plan.repairAt) / 200)));
        }
      }
    }
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The wind-up (a lean back), then the flick (a snap forward). IV: the hero PUNCHES THE GLASS: it swells at the
      // screen and springs back.
      let bx = 0, by = 0, rot = 0, sc = 1;
      const lean = t < plan.fireAt ? easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt)) : Math.max(0, spring(t - plan.fireAt, 3, 90));
      bx -= toFoe.x * c.heroWindPx * px * lean; by -= toFoe.y * c.heroWindPx * px * lean;
      rot -= 3 * flip * lean;
      if (plan.kind === 'shatter') sc -= 0.06 * lean;
      if (t >= plan.fireAt) {
        const f = c.heroThrowPx * px * Math.max(0, spring(t - plan.fireAt, 5, 60)); bx += toFoe.x * f; by += toFoe.y * f;
        if (plan.kind === 'shatter') sc += 0.2 * Math.exp(-(t - plan.fireAt) / 110) * Math.abs(Math.cos((t - plan.fireAt) / 90));
      }
      const still = Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(rot) < 0.01 && Math.abs(sc - 1) < 1e-4;
      hero.set(still ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    let css: string | null = null;
    if (t >= plan.impactAt) {
      const k = spring(t - plan.impactAt, 4.5, 90);
      const knock = c.knockPx * (0.6 + 0.5 * plan.k) * k * px;
      const sq = c.squash * (0.7 + 0.5 * plan.k) * k;
      fx = toFoe.x * knock; fy = toFoe.y * knock;
      css = Math.abs(k) < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
    } else {
      let k = 0;
      for (const at of plan.hits) if (t >= at) k += Math.max(0, spring(t - at, 6, 40)) * 7 * px;
      fx = toFoe.x * k; fy = toFoe.y * k;
      css = Math.abs(fx) + Math.abs(fy) < 0.05 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
    }
    foe.set(css);
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<GlassCue | FormationCue> = new Sequence<GlassCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    // IV's slow-mo dip on the shatter: the frame source hands the ONE clock a scaled step (a smooth ramp, never 0).
    frames: (fn: (dt: number) => void) => (o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)))((dt) => fn(dt * (seq && !seq.done ? glassScale(plan, c, seq.t) : 1))),
    safetyMs: o.safety !== false ? (plan.endAt + glassSlowExtraMs(plan, c)) / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      // The sequence is over: nothing of the glass may stay on the screen while the last splinters drain.
      scene?.setMarksAlpha(0); scene?.setHole(0); scene?.setSplit(o.attacker, o.defender, 0, 0);
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
