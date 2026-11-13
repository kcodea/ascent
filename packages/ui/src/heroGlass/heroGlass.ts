/**
 * THE FOURTH WALL RUNNER ("Fourth Wall", style `glass`; ANCIENT, dev-only until it gets a cosmetic): plays one Fourth
 * Wall hero attack (the beats are in `heroGlassConfig.ts`) and lands the consequence on its impact beat. Presentation
 * only: the total and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * THE SCREEN IS A PANE OF GLASS and the blow breaks it. WHAT cracks it is rolled per fight from the stable roll seed
 * (`causeOf`): the striker's portrait headbutts it, an unseen fist knocks on it, a rising tone shakes it apart, a crack
 * creeps in from the screen edge, a stamped ring of force crazes it, a beam of light heats it until it pops, or a point
 * of light ricochets off the screen edges into it. Each cause leaves its own crack shape, scaled over the looks: a
 * small mark that heals (I), a spreading one (II), a big one whose pane breaks out and repairs (III); and on IV the
 * mark becomes one bold fracture that tears across the whole screen, the glass creaks and trembles through a long held
 * beat, and the WHOLE SCREEN SHATTERS at the viewer. Cracks and shards are made once per blow from its seed
 * (`glassGeo`), so the screen breaks exactly where it cracked.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses; IV's shatter gets a slow-mo DIP
 * through the frame source, never a freeze), the damage formation, the `#stage` camera (applied ONCE), the portraits
 * (transform only, restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * WHERE THE GLASS IS: the scene mounts on the shared above-portrait overlay, a fixed full-screen canvas over the game
 * view, so the cracks draw over the board, the rail and the portraits alike. That canvas rides the stage camera, so
 * each frame the scene's layers are handed the camera's inverse (`fixGlass`): the glass stays nailed to the screen
 * while the game zooms and shakes behind it.
 *
 * THE CONTRACT: every beat before the blow is FX and sound only. The consequence (`onImpact`) lands exactly ONCE, on
 * the impact beat (I to III: the glass first cracks; IV: the shatter).
 *
 * Perf (docs/performance.md): DOM moves are `transform` only, from the clock; one layout read per portrait at the start
 * (its scale) and none after; every crack sprite and shard mesh is built during the damage formation, never on a hot
 * beat; a grown crack costs nothing per frame; the shards rewrite two small arrays in place; no filters; the updater
 * unhooks when the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices, type CueOpts } from '../heroAttack/attackSound';
import { playKoSting } from '../heroAttack/knockout';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, easeOutCubic, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  causeOf, getHeroGlassConfig, glassCameraAt, glassCameraFocus, glassCues, glassGeo, glassPlan, glassScale, glassSeed, glassSlowExtraMs, legPoint,
  type GlassCause, type GlassCue, type GlassGeo, type GlassPlan, type HeroGlassConfig,
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
  /** What cracks the glass this blow (rolled from the roll seed, or forced by the DEV tuner). */
  readonly cause: GlassCause;
}

/** Where in the creak clip each creak starts (its crackles, measured: about 160, 320, 600 and 760 ms in). */
const CREAK_STARTS = [130, 300, 570, 730, 30] as const;

/** An element's own px per screen px (it sits in the scaled stage). One layout read, at the start. */
function unitOf(el: HTMLElement | null | undefined): number {
  try {
    const b = el?.getBoundingClientRect();
    return el && b && b.width > 0 && el.offsetWidth > 0 ? el.offsetWidth / b.width : 1;
  } catch { return 1; }
}

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
  // THE CAUSE, rolled from the stable per-blow seed (or forced by the DEV tuner).
  const cause = causeOf(o.rollSeed ?? glassSeed(o.total, dist, o.side), c);
  const plan = glassPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt, cause }, c);
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
  const seed = glassSeed(o.total, dist, o.side, o.rollSeed);
  const geo = glassGeo(plan, o.attacker, o.defender, radius, aRadius, c, screen, seed, s);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  const aim = Math.atan2(toFoe.y, toFoe.x);
  const flip = o.attacker.x > o.defender.x ? -1 : 1;

  const textures = o.textures !== undefined ? o.textures : heroGlassTextures();
  const scene = textures && !reduced
    ? new HeroGlassScene(textures, {
      glass: hexToNum(c.colorGlass), edge: hexToNum(c.colorEdge), shade: hexToNum(c.colorShade), flash: hexToNum(c.colorFlash), heat: hexToNum(c.colorHeat), side: hexToNum(sideHex),
    }, {
      gravity: c.shardGravity, burst: c.shardBurst, spin: c.shardSpin, rim: c.shardRim, lunge: c.shardLunge, dust: c.dust, impactSize: c.impactSize, splitAlpha: c.splitAlpha,
    }, s, seed ^ 0x51ed)
    : null;
  if (scene) {
    // Everything the blow will draw is built NOW, while the damage formation plays: nothing is made on a hot beat.
    scene.setArea(screen);
    scene.setCracks(geo.segs);
    if (geo.frost) scene.setFrost(geo.frost.at, geo.frost.r);
    if (geo.tris.length) scene.setShards(geo.tris, geo.origin, plan.kind === 'pane' ? 'pane' : 'shatter');
  }
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  // The headbutt carries the striker across the board: its own px per screen px (read once), and Classic's own duel
  // z-order class so it passes OVER the struck portrait.
  const heroUnit = local || reduced ? 1 : unitOf(o.attackerEl);
  const zClass = o.side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player';
  const lift = cause === 'butt' && !reduced && !local && !!hero.el && !!doc;
  let lifted = false;
  const cue = (clip: string, gain: number, rate: number, opts?: CueOpts): void =>
    voices.cue(clip, gain, rate * (0.88 + 0.12 * glassScale(plan, c, seq ? seq.t : 0)), opts);
  voices.warm([
    c.sfxWhooshClip, c.sfxTickClip, c.sfxCreakClip, c.sfxRaceClip, c.sfxPaneClip, c.sfxShatterClip, c.sfxCrashClip, c.sfxRepairClip, c.sfxThudClip,
    c.sfxBodyClip, c.sfxKnockClip, c.sfxSingClip, c.sfxPopClip,
  ]);
  // The last crack finishes growing here; after it the per-frame grow call is skipped.
  const grownAt = geo.segs.reduce((m, g) => Math.max(m, g.t1), 0) + 40;
  const chipPx = (size: number): number => radius * 1.5 * size;
  /** A point on the web that is cracking at a jump (the first crack that starts at or after it). */
  const crackingAt = (at: number): Pt => {
    const g = geo.segs.find((x) => x.t0 >= at) ?? geo.segs[geo.segs.length - 1];
    return g ? { x: g.bx, y: g.by } : geo.origin;
  };
  const causeMs = Math.max(1, plan.strikeAt - plan.fireAt);
  /** Real ms from the cause's start to the crack (a riser is placed to end there). */
  const causeReal = causeMs / speed;
  // The bolt's legs and when it reaches each point (every bounce lands on its beat).
  const boltTimes = [plan.fireAt, ...plan.pre, plan.strikeAt];
  const boltPath = geo.path.map((p) => ({ x: p.x, y: p.y }));
  // How loud and how big this look's crack is.
  const weight = plan.kind === 'chip' ? 0.8 : plan.kind === 'web' ? 1 : plan.kind === 'pane' ? 1.25 : 1.1;
  const tapSize = plan.kind === 'chip' ? 0.9 : plan.kind === 'web' ? 1.15 : plan.kind === 'pane' ? 1.7 : 1.3;
  const lungeD = Math.max(0, dist - (radius + aRadius) * 0.5);

  /** A window of the creak clip (a different crackle each time). */
  const creakCue = (i: number, gain: number, rate: number, lenMs = 230): void => {
    const n = i % CREAK_STARTS.length;
    cue(c.sfxCreakClip, c.sfxCreakGain * gain, c.sfxCreakRate * rate * (0.92 + 0.06 * n), { startMs: CREAK_STARTS[n], lenMs, fadeMs: 90 });
  };

  /** The cause begins: its own sound and its first light. */
  const begin = (): void => {
    switch (cause) {
      case 'butt':
        cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate * 1.1, { lenMs: 420, fadeMs: 160 });
        break;
      case 'hum':
        // A glass harmonic that RISES into the break: two voices a fifth apart, both ending on the crack.
        voices.riser(c.sfxSingClip, c.sfxSingGain * 1.4 * weight, c.sfxSingRate * 0.8, causeReal);
        voices.riser(c.sfxSingClip, c.sfxSingGain * weight, c.sfxSingRate * 1.2, causeReal);
        scene?.note(scene.toGlass(o.attacker), aRadius);
        break;
      case 'beam':
        voices.riser(c.sfxSingClip, c.sfxSingGain * 0.55, c.sfxSingRate * 1.7, causeReal);
        cue(c.sfxTickClip, c.sfxTickGain * 0.4, c.sfxTickRate * 1.8, { lenMs: 200, fadeMs: 90 });
        scene?.note(scene.toGlass(o.attacker), aRadius * 0.7);
        break;
      case 'ricochet':
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.8, c.sfxWhooshRate * 1.6, { lenMs: 300, fadeMs: 120 });
        break;
      case 'creep':
        // Pressure: a low groan under the whole creep.
        cue(c.sfxCreakClip, c.sfxCreakGain * 1.3, c.sfxCreakRate * 0.5, { lenMs: causeReal + 200, fadeMs: 200 });
        break;
      default:
        break;
    }
  };

  /** One of the cause's own beats before the crack. FX and sound only. */
  const beat = (i: number): void => {
    const u = clamp01(((plan.pre[i] ?? plan.fireAt) - plan.fireAt) / causeMs);
    switch (cause) {
      case 'knock':
        scene?.ripple(geo.origin, 0.8 + 0.25 * i);
        cue(c.sfxKnockClip, c.sfxKnockGain * (0.6 + 0.15 * i) * weight, c.sfxKnockRate * (1.12 - 0.06 * i), { lenMs: 320, fadeMs: 120 });
        break;
      case 'hum':
        scene?.humRings(geo.origin, radius, u);
        break;
      case 'creep': {
        const head = geo.path[i + 1] ?? geo.origin;
        scene?.creak(head, 1.3);
        creakCue(i, 1.7 * weight, 0.62, 300);
        cue(c.sfxTickClip, c.sfxTickGain * 0.6 * weight, c.sfxTickRate * 0.6, { lenMs: 300, fadeMs: 140 });
        break;
      }
      case 'shock':
        // THE STAMP: the ring is timed to cross the struck portrait exactly on the crack.
        scene?.shockRing(scene.toGlass(o.attacker), dist, causeMs);
        cue(c.sfxThudClip, c.sfxThudGain * weight, c.sfxThudRate * 0.9, { lenMs: 700, fadeMs: 280 });
        voices.riser(c.sfxWhooshClip, c.sfxWhooshGain * 0.9, c.sfxWhooshRate * 0.8, causeReal);
        break;
      case 'beam':
        scene?.spit(geo.origin, u);
        cue(c.sfxTickClip, c.sfxTickGain * (0.2 + 0.2 * u), c.sfxTickRate * (2 + 0.2 * i), { lenMs: 140, fadeMs: 70 });
        break;
      case 'ricochet': {
        const at = geo.path[i + 1] ?? geo.origin;
        scene?.tap(at, 0.7);
        cue(c.sfxTickClip, c.sfxTickGain * 0.75 * weight, c.sfxTickRate * (1.4 + 0.14 * i), { lenMs: 260, fadeMs: 110 });
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.5, c.sfxWhooshRate * (1.7 + 0.1 * i), { lenMs: 220, fadeMs: 100 });
        break;
      }
      default:
        break;
    }
  };

  /** THE GLASS FIRST CRACKS over the struck portrait (I to III: this is the blow; IV: a mark, then the tear). */
  const strike = (): void => {
    const at = geo.origin;
    const soft = cause === 'creep' || cause === 'shock' || cause === 'hum';
    scene?.tap(at, tapSize * (soft ? 0.7 : 1));
    switch (cause) {
      case 'butt':
        scene?.smear(at, radius, aim);
        cue(c.sfxBodyClip, c.sfxBodyGain * weight, c.sfxBodyRate * (plan.kind === 'chip' ? 1.1 : plan.kind === 'web' ? 1 : 0.9), { fadeMs: 200 });
        cue(c.sfxThudClip, c.sfxThudGain * 0.6 * weight, c.sfxThudRate, { lenMs: 520, fadeMs: 220 });
        cue(c.sfxTickClip, c.sfxTickGain * 0.6 * weight, c.sfxTickRate * 0.9, { lenMs: 300, fadeMs: 120 });
        break;
      case 'knock':
        scene?.ripple(at, 1.6);
        cue(c.sfxKnockClip, c.sfxKnockGain * 1.25 * weight, c.sfxKnockRate * 0.82, { fadeMs: 140 });
        cue(c.sfxThudClip, c.sfxThudGain * 0.55 * weight, c.sfxThudRate * 1.2, { lenMs: 460, fadeMs: 200 });
        cue(c.sfxTickClip, c.sfxTickGain * 0.8 * weight, c.sfxTickRate, { lenMs: 320, fadeMs: 130 });
        break;
      case 'hum':
        // It gives way all at once.
        scene?.humRings(at, radius, 1);
        cue(c.sfxTickClip, c.sfxTickGain * 1.3 * weight, c.sfxTickRate * 1.25, { lenMs: 320, fadeMs: 130 });
        cue(c.sfxPaneClip, c.sfxPaneGain * 0.95 * weight, c.sfxPaneRate * 1.2, { lenMs: 420, fadeMs: 180 });
        break;
      case 'creep':
        cue(c.sfxTickClip, c.sfxTickGain * 1.3 * weight, c.sfxTickRate * 0.75, { lenMs: 320, fadeMs: 130 });
        cue(c.sfxPopClip, c.sfxPopGain * 0.85 * weight, c.sfxPopRate * 0.8, { lenMs: 400, fadeMs: 160 });
        creakCue(4, 1.2 * weight, 0.7, 320);
        break;
      case 'shock':
        // The ring passes: the glass crazes with a dry crackle and a dull pressure pop.
        cue(c.sfxPopClip, c.sfxPopGain * weight, c.sfxPopRate * 0.7, { lenMs: 420, fadeMs: 160 });
        cue(c.sfxCreakClip, c.sfxCreakGain * 1.3 * weight, c.sfxCreakRate * 1.5, { startMs: 120, lenMs: 380, fadeMs: 140 });
        cue(c.sfxTickClip, c.sfxTickGain * 0.5 * weight, c.sfxTickRate * 1.1, { lenMs: 300, fadeMs: 120 });
        break;
      case 'beam':
        scene?.setBeam(at, at, 0, 0);
        scene?.ember(at, radius);
        scene?.spit(at, 1.6);
        cue(c.sfxPopClip, c.sfxPopGain * weight, c.sfxPopRate, { fadeMs: 160 });
        cue(c.sfxThudClip, c.sfxThudGain * 0.4 * weight, c.sfxThudRate * 1.4, { lenMs: 380, fadeMs: 160 });
        break;
      case 'ricochet':
        scene?.setBolt(at, 0, false);
        cue(c.sfxTickClip, c.sfxTickGain * 1.1 * weight, c.sfxTickRate * 0.85, { lenMs: 320, fadeMs: 130 });
        cue(c.sfxThudClip, c.sfxThudGain * 0.5 * weight, c.sfxThudRate * 1.3, { lenMs: 420, fadeMs: 180 });
        break;
      default:
        break;
    }
    // III: the weight of a pane about to go.
    if (plan.kind === 'pane') cue(c.sfxThudClip, c.sfxThudGain * 0.6, c.sfxThudRate * 0.9, { lenMs: 520, fadeMs: 220 });
  };

  const fire = (q: GlassCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      case 'fire':
        begin();
        break;
      case 'pre':
        beat(q.i);
        break;
      case 'strike':
        // IV: the cause cracks the glass. Not the blow.
        strike();
        break;
      case 'race':
        // IV: THE TEAR is off, both ways (the race clip swells to its peak about 300 ms in).
        cue(c.sfxRaceClip, c.sfxRaceGain, c.sfxRaceRate * Math.min(1.4, Math.max(0.6, 560 / Math.max(1, plan.raceEnd - plan.raceAt))), { fadeMs: 140 });
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.9, c.sfxWhooshRate * 0.75, { lenMs: 620, fadeMs: 240 });
        creakCue(1, 1.2, 0.8, 320);
        break;
      case 'tense': {
        // IV: THE HELD BEAT. A long low groan of the pane and a harmonic climbing into the shatter.
        const hold = Math.max(1, plan.impactAt - plan.raceEnd);
        cue(c.sfxCreakClip, c.sfxCreakGain * 1.2, c.sfxCreakRate * 0.55, { lenMs: hold / speed, fadeMs: 80 });
        voices.riser(c.sfxSingClip, c.sfxSingGain * 0.9, c.sfxSingRate * 0.6, hold / speed);
        voices.riser(c.sfxSingClip, c.sfxSingGain * 0.5, c.sfxSingRate * 0.9, hold / speed);
        break;
      }
      case 'creak': {
        // The cracks jump outward: a short window of the creak clip (a different crackle each time), a hairline flash.
        const ice = cause === 'creep' ? 0.7 : cause === 'shock' ? 1.4 : 1;
        creakCue(q.i, (plan.kind === 'shatter' ? 0.9 + 0.1 * q.i : 1.6) * weight, ice);
        if (plan.kind === 'shatter') cue(c.sfxTickClip, c.sfxTickGain * (0.25 + 0.05 * q.i), c.sfxTickRate * (0.7 + 0.05 * q.i), { lenMs: 200, fadeMs: 90 });
        scene?.creak(crackingAt(q.at), plan.kind === 'shatter' ? 1.6 : 1);
        break;
      }
      case 'impact':
        if (plan.kind === 'shatter') {
          // THE WHOLE SCREEN SHATTERS: the cracks are gone (the shards' own edges take over) and everything jumps at
          // the viewer, hangs, and falls.
          scene?.setMarksAlpha(0);
          scene?.setSplit(o.attacker, o.defender, 0, 0);
          scene?.setTension(0);
          scene?.setTremble(0, 0);
          scene?.setTearHead(0, geo.origin, false); scene?.setTearHead(1, geo.origin, false);
          scene?.breakOut();
          scene?.shatterFx(geo.origin, plan.ko);
          // A plate-glass crash, the first pass's shatter under it, a low boom and a body of weight; the long tinkle is
          // the crash clip's own tail.
          cue(c.sfxCrashClip, c.sfxCrashGain, c.sfxCrashRate * (plan.ko ? 0.94 : 1), { tail: c.sfxTailMix, fadeMs: 500 });
          cue(c.sfxShatterClip, c.sfxShatterGain, c.sfxShatterRate * (plan.ko ? 0.94 : 1), { tail: c.sfxTailMix, fadeMs: 400 });
          cue(c.sfxThudClip, c.sfxThudGain * 1.3, c.sfxThudRate * 0.7, { lenMs: 1300, fadeMs: 500 });
          cue(c.sfxBodyClip, c.sfxBodyGain * 0.8, c.sfxBodyRate * 0.6, { fadeMs: 300 });
          if (plan.ko) playKoSting(voices, sound, (ms) => ms / speed);
        } else strike();
        seq.land();
        break;
      case 'break':
        // III: the pane lets go.
        scene?.breakOut();
        scene?.paneBreak(geo.origin, radius * 1.2);
        cue(c.sfxPaneClip, c.sfxPaneGain, c.sfxPaneRate, { tail: c.sfxTailMix, fadeMs: 250 });
        cue(c.sfxThudClip, c.sfxThudGain * 0.7, c.sfxThudRate * 0.8, { lenMs: 700, fadeMs: 280 });
        break;
      case 'heal':
        // I and II: the glass heals with a faint shimmer (III's repair already rang).
        if (plan.kind !== 'pane') cue(c.sfxRepairClip, c.sfxRepairGain, c.sfxRepairRate * 1.25, { lenMs: 420, fadeMs: 220 });
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
  let chipIdx = 0;
  let forkIdx = 0;
  let moteAt = 0;
  let sparkAt = 0;

  /** The striker's portrait: its cause's own move. */
  const paintHero = (t: number, px: number): void => {
    if (!hero.el || t < plan.chargeAt) return;
    const F = plan.fireAt, K = plan.strikeAt;
    const lean = t < F ? easeInOutSine((t - plan.chargeAt) / Math.max(1, F - plan.chargeAt)) : Math.max(0, spring(t - F, 3, 90));
    let bx = -toFoe.x * c.heroWindPx * px * lean, by = -toFoe.y * c.heroWindPx * px * lean;
    let rot = -3 * flip * lean, sc = 1, along = 1, across = 1, sx = 1, sy = 1;
    const push = (d: number): void => { bx += toFoe.x * d * px; by += toFoe.y * d * px; };
    switch (cause) {
      case 'butt':
        if (t >= F) {
          // THE HEADBUTT: it launches itself at the glass over the target (swelling: it is coming AT the screen),
          // flattens against it for a beat like a face on a window, and bounces home.
          let e: number, flat = 0;
          if (t < K) e = Math.pow((t - F) / causeMs, 2.2);
          else {
            const after = t - K;
            flat = after < 80 ? 1 : Math.exp(-(after - 80) / 55);
            e = 1 - easeOutCubic(clamp01((after - 90) / 420));
          }
          bx += toFoe.x * lungeD * heroUnit * e; by += toFoe.y * lungeD * heroUnit * e;
          sc = 1 + 0.22 * e;
          along = 1 - 0.46 * flat; across = 1 + 0.3 * flat;
          rot *= 1 - e;
        }
        break;
      case 'knock': {
        // A jab at the glass with each knock, the last the hardest.
        let j = 0;
        for (const at of plan.pre) j += Math.max(0, spring(t - at, 6, 45)) * 9;
        j += Math.max(0, spring(t - K, 5, 60)) * 18;
        push(j);
        break;
      }
      case 'hum':
        // It sings: a steady swell that quickens with the tone.
        if (t >= F && t < K) { const u = (t - F) / causeMs; sc = 1 + 0.02 + 0.035 * u * Math.sin(t * (0.03 + 0.04 * u)); }
        break;
      case 'creep': {
        // It leans its whole weight on the glass, and lets go when the crack arrives.
        const u = t < F ? 0 : t < K ? (t - F) / causeMs : Math.max(0, spring(t - K, 3, 80));
        push(14 * u); sc = 1 + 0.06 * u;
        break;
      }
      case 'shock': {
        // THE STAMP: up through the ready, down hard on the beat.
        const up = t < F ? easeInOutSine((t - plan.chargeAt) / Math.max(1, F - plan.chargeAt)) : 0;
        const slam = t >= F ? Math.max(0, spring(t - F, 5, 70)) : 0;
        bx = 0; by = (-26 * up + 8 * slam) * px; rot = 0;
        sy = 1 + 0.06 * up - 0.22 * slam; sx = 1 - 0.03 * up + 0.16 * slam;
        break;
      }
      case 'beam':
        // Braced against the beam.
        if (t >= F && t < K) { push(-5); sc = 0.985 + 0.012 * Math.sin(t * 0.09); }
        break;
      default:
        // The ricochet: a flick.
        if (t >= F) push(c.heroThrowPx * Math.max(0, spring(t - F, 5, 60)));
        break;
    }
    const still = Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(rot) < 0.01 && Math.abs(sc - 1) < 1e-4 && Math.abs(along - 1) < 1e-4 && Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4;
    if (still) { hero.set(null); return; }
    const deg = (aim * 180) / Math.PI;
    const flatCss = Math.abs(along - 1) > 1e-4 ? ` rotate(${deg.toFixed(2)}deg) scale(${along.toFixed(4)}, ${across.toFixed(4)}) rotate(${(-deg).toFixed(2)}deg)` : '';
    hero.set(`translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px)${flatCss} rotate(${rot.toFixed(3)}deg) scale(${(sc * sx).toFixed(4)}, ${(sc * sy).toFixed(4)})`);
  };

  /** The struck portrait: nudged by the knocks, humming with the tone, knocked back (and on IV, reeling) by the blow. */
  const paintFoe = (t: number, px: number, unit: number): void => {
    let fx = 0, fy = 0;
    let css: string | null = null;
    if (t >= plan.impactAt) {
      const k = spring(t - plan.impactAt, 4.5, plan.kind === 'shatter' ? 130 : 90);
      const knock = c.knockPx * (0.6 + 0.5 * plan.k) * k * px;
      const sq = c.squash * (0.7 + 0.5 * plan.k) * k;
      fx = toFoe.x * knock; fy = toFoe.y * knock;
      // IV: it reels (a slow rock that dies away over most of a second).
      const reel = plan.kind === 'shatter' ? 7 * flip * spring(t - plan.impactAt, 2.4, 260) : 0;
      css = Math.abs(k) < 0.004 && Math.abs(reel) < 0.02 ? null
        : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) rotate(${reel.toFixed(3)}deg) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
    } else if (t >= plan.fireAt) {
      let k = 0;
      for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 40)) * 9 * px;
      if (cause === 'knock') for (const at of plan.pre) k += Math.max(0, spring(t - at, 7, 35)) * 4 * px;
      fx = toFoe.x * k; fy = toFoe.y * k;
      if (cause === 'hum' && t < plan.strikeAt) {
        // The image hums: a fast shiver across the line of the blow, growing with the tone.
        const u = (t - plan.fireAt) / causeMs;
        const v = (0.8 + 3.6 * u * u) * Math.sin(t * 0.24) * px;
        fx += -toFoe.y * v; fy += toFoe.x * v;
      }
      css = Math.abs(fx) + Math.abs(fy) < 0.05 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
    }
    foe.set(css);
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.fireAt, plan.impactAt + (plan.tier >= 4 ? 700 : 200));
    const cm = glassCameraAt(plan, c, t, toFoe);
    const unit = local ? 1 : s;
    const focus = glassCameraFocus(plan, t, o.attacker, o.defender);
    cam.apply(focus, cm.zoom, cm.x, cm.y, unit);
    if (scene) {
      // The glass does not move with the camera: hand the layers its inverse (the same numbers `cam.apply` wrote).
      if (cam.active || !cameraEl) scene.fixGlass(focus.x * (1 - cm.zoom) + cm.x * unit, focus.y * (1 - cm.zoom) + cm.y * unit, cm.zoom);
      if (t <= grownAt) scene.growCracks(t);
      while (chipIdx < geo.chips.length && t >= geo.chips[chipIdx]!.t) { const ch = geo.chips[chipIdx++]!; scene.chip(ch.at, chipPx(ch.size)); }
      if (geo.frost && t >= plan.strikeAt && t < plan.strikeAt + 400) scene.showFrost(0.55 * clamp01((t - plan.strikeAt) / 180));
      // The causes' own lights, between the start of the cause and the crack.
      if (t >= plan.fireAt && t < plan.strikeAt) {
        const u = (t - plan.fireAt) / causeMs;
        if (cause === 'beam') scene.setBeam(scene.toGlass(geo.hand), geo.origin, Math.min(1, u * 8) * (0.85 + 0.15 * Math.sin(t * 0.11)), u);
        else if (cause === 'ricochet' && boltPath.length >= 2) {
          const hand = scene.toGlass(geo.hand);
          boltPath[0]!.x = hand.x; boltPath[0]!.y = hand.y;
          const b = legPoint(boltPath, boltTimes, t);
          scene.setBolt(b.p, b.ang, true);
          if (t >= moteAt) { scene.boltMote(b.p); moteAt = t + 24; }
        }
      }
      if (plan.kind === 'shatter') {
        if (t < plan.impactAt && geo.main) {
          const m = geo.main;
          // THE TEAR's two heads, and a flash at every fork as it passes.
          if (t >= plan.raceAt && t <= plan.raceEnd + 40) {
            const d = m.v * (t - plan.raceAt);
            const on0 = d < m.rear, on1 = d < m.fwd;
            scene.setTearHead(0, { x: geo.origin.x + Math.cos(m.back) * Math.min(d, m.rear), y: geo.origin.y + Math.sin(m.back) * Math.min(d, m.rear) }, on0, t * 0.02);
            scene.setTearHead(1, { x: geo.origin.x - Math.cos(m.back) * Math.min(d, m.fwd), y: geo.origin.y - Math.sin(m.back) * Math.min(d, m.fwd) }, on1, -t * 0.02);
            if (t >= sparkAt) {
              if (on0) scene.tearSpark({ x: geo.origin.x + Math.cos(m.back) * d, y: geo.origin.y + Math.sin(m.back) * d }, m.back);
              if (on1) scene.tearSpark({ x: geo.origin.x - Math.cos(m.back) * d, y: geo.origin.y - Math.sin(m.back) * d }, m.back + Math.PI);
              sparkAt = t + 30;
            }
          }
          while (forkIdx < geo.forks.length && t >= geo.forks[forkIdx]!.t) {
            const f = geo.forks[forkIdx]!;
            scene.fork(f.at, f.ang);
            cue(c.sfxTickClip, c.sfxTickGain * 0.7, c.sfxTickRate * (0.62 + 0.06 * forkIdx), { lenMs: 300, fadeMs: 130 });
            creakCue(forkIdx + 2, 1.1, 0.9);
            forkIdx++;
          }
          // The held beat: the picture sits a hair apart across the tear, slipping a notch with every creak; a cold
          // light rises over the pane and the glass trembles harder and harder.
          let notch = 0;
          for (const at of plan.jumps) if (t >= at) notch++;
          const a = c.splitAlpha * clamp01((t - plan.raceAt) / Math.max(1, plan.raceEnd - plan.raceAt));
          scene.setSplit(m.a, m.b, a, notch * 1.5 * s);
          const tense = clamp01((t - plan.raceAt) / Math.max(1, plan.impactAt - plan.raceAt));
          const amp = c.tremblePx * s * tense * tense;
          scene.setTremble(amp * Math.sin(t * 0.61) * Math.sin(t * 0.137 + 1), amp * Math.cos(t * 0.83));
          scene.setTension(0.11 * clamp01((t - plan.raceEnd) / Math.max(1, plan.impactAt - plan.raceEnd)) ** 2);
        }
      } else {
        scene.setMarksAlpha(t < plan.healAt ? 1 : 1 - clamp01((t - plan.healAt) / Math.max(1, plan.healEnd - plan.healAt)));
        if (plan.kind === 'pane') {
          scene.setHole(t < plan.breakAt ? 0 : t < plan.repairAt ? 0.5 * clamp01((t - plan.breakAt) / 70) : 0.5 * (1 - clamp01((t - plan.repairAt) / 200)));
        }
      }
    }
    const px = local ? 0.45 : 1;
    paintHero(t, px);
    paintFoe(t, px, unit);
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
      if (lifted) { doc!.body.classList.remove(zClass); lifted = false; }
      // The sequence is over: nothing of the glass may stay on the screen while the last splinters and dust drain,
      // and the camera is back at rest, so the layers are too.
      scene?.setMarksAlpha(0); scene?.setHole(0); scene?.setSplit(o.attacker, o.defender, 0, 0);
      scene?.lightsOut(); scene?.setTremble(0, 0); scene?.fixGlass(0, 0, 1);
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    scene,
    cause,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
