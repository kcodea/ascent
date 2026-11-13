/**
 * THE WRITTEN IN THE STARS RUNNER ("Written in the Stars"; attack_stars, ANCIENT): plays one constellation
 * hero attack (the beats, the geometry and the variations are in `heroStarsConfig.ts`) and lands the consequence on its
 * impact beat. Presentation only: the total and the blow are the engine's; this file only decides WHEN on screen they
 * happen, and which variation plays (rolled from the blow's stable `rollSeed`, so a replay plays the same one).
 *
 * CONSTELLATIONS: the board dims to a night sky, stars light one by one as lines reach them, and the finished figure
 * comes alive and strikes. Tier 1 an arrow and Tier 2 a bow, traced in one of five places; Tier 3 a hunter, a wolf or a
 * serpent; Tier 4 written in the stars (the striker's portrait as a medallion plucks a star that falls as a comet), the
 * wheel (it turns, locks and fires a beam), the giant (it rises and brings its fist down) or the nova (the whole sky
 * falls into one point over the struck hero, which drops and explodes). Each look and place has its own sound accents.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (never held, never scaled), the damage
 * formation, the `#stage` camera (applied ONCE), the portraits (transform only, restored after), the voices, the dim,
 * reduced motion, finish / cancel and the safety timer. The dark of the night is two layers: the shared DOM dim (which
 * leaves the two heroes lit) and the scene's own blue-black veil quad over everything.
 *
 * THE CONTRACT: the consequence (`onImpact`) lands exactly ONCE, on the shot's arrival.
 *
 * Perf (docs/performance.md): DOM moves are `transform` only, from the clock; no layout reads after the opening measure
 * (the portraits are measured by the caller); the sky and the constellation are sprites made once per attack and only
 * moved and faded; one reused frame object carries the per-frame amounts; textures are painted once per session and
 * pre-warmed during the formation; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices, type CueOpts } from '../heroAttack/attackSound';
import { playKoSting } from '../heroAttack/knockout';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  aliveAmount, drawAmount, figureAmount, flareAmount, gatherAmount, getHeroStarsConfig, hushAmount, shotAt, shotArrival, skyAmount, slotAt, spinAmount,
  starFigure, starsCameraAt, starsCameraFocus, starsCues, starsPlan, starsVariant, swellAmount,
  type HeroStarsConfig, type StarFigure, type StarsCue, type StarsKind, type StarsLaunch, type StarsPlan, type StarsVariant,
} from './heroStarsConfig';
import { HeroStarsScene, type HeroStarsTextures, type SkyFrame } from './heroStarsScene';
import { heroStarsTextures, portraitStarTexture } from './heroStarsTextures';

export interface HeroStarsOptions extends HeroAttackOptions {
  cfg?: HeroStarsConfig;
  textures?: HeroStarsTextures | null;
}

export interface HeroStarsHandle extends HeroAttackHandle {
  readonly plan: StarsPlan;
  /** The variation this blow plays (rolled from its `rollSeed`, or forced by the DEV tuner). */
  readonly variant: StarsVariant;
  readonly figure: StarFigure | null;
  readonly scene: HeroStarsScene | null;
  readonly mirrorsCamera: boolean;
}

/**
 * The sky's scatter is seeded: the blow's own roll when the fight gives one, else the blow itself (a replay matches).
 * Without a `rollSeed` it is also the seed the variation rolls from.
 */
export function starsSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, rollSeed?: number): number {
  const own = (Math.round(total) * 6977 + Math.round(distance) * 43 + (side === 'opp' ? 251 : 29)) >>> 0;
  return typeof rollSeed === 'number' && Number.isFinite(rollSeed) ? ((Math.imul(rollSeed >>> 0, 2654435761) ^ own) >>> 0) : own;
}

/**
 * Tiers 1 and 2: each place the figure is traced has its own sound accents: the snap's pitch, how long the arrow's pass
 * of air lasts (a shot across the open sky crosses the whole of it), and, from high above, the falling whistle under it.
 */
const LAUNCH_SOUND: Record<StarsLaunch, { pitch: number; whoosh: number; snap: number; fall: boolean }> = {
  striker: { pitch: 1, whoosh: 1, snap: 1, fall: false },
  high: { pitch: 1.06, whoosh: 0.9, snap: 0.9, fall: true },
  low: { pitch: 0.92, whoosh: 1.2, snap: 1.05, fall: false },
  struck: { pitch: 1.12, whoosh: 0.55, snap: 1.3, fall: false },
  open: { pitch: 0.88, whoosh: 1.45, snap: 1, fall: false },
};

/**
 * The shot per look: its head and size (in struck portrait radii; the arrows are sized from their figure), the tail's
 * width (radii; 0 = the arrows' own dial), how much of the path the tail covers, and how long it hangs (x the dial).
 */
const SHOT_LOOK: Record<StarsKind, { head: number; tail: number; span: number; linger: number }> = {
  arrow: { head: 0, tail: 0, span: 0.5, linger: 0.5 },
  bow: { head: 0, tail: 0, span: 0.65, linger: 0.5 },
  hunter: { head: 0, tail: 0, span: 1, linger: 1 },
  wolf: { head: 0.7, tail: 0.16, span: 0.55, linger: 0.8 },
  serpent: { head: 0.6, tail: 0.1, span: 0.4, linger: 0.6 },
  written: { head: 0, tail: 0.5, span: 1, linger: 1.3 },
  wheel: { head: 1.3, tail: 0.42, span: 1, linger: 1.7 },
  giant: { head: 1.2, tail: 0.55, span: 0.6, linger: 1 },
  nova: { head: 0, tail: 0.4, span: 1, linger: 1 },
};

/** Play Written in the Stars. Returns a handle; the blow lands via `onImpact` when the shot arrives. */
export function playHeroStars(o: HeroStarsOptions): HeroStarsHandle {
  const c = o.cfg ?? getHeroStarsConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  // THE VARIATION (where Tiers 1 and 2 are traced, Tier 3's figure, Tier 4's finisher): rolled from the stable per-blow
  // seed (a replay plays the same), or forced by the DEV tuner.
  const variant = starsVariant(o.rollSeed ?? starsSeed(o.total, dist, o.side), c);
  const plan = starsPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt, variant }, c);
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hstars',
  });

  const vw = typeof window === 'undefined' ? 1920 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 1080 : window.innerHeight;
  // The sky the figures must stay inside: the screen, or (a sandbox box) the area round the two portraits.
  const screen = local
    ? { x: Math.min(o.attacker.x, o.defender.x) - dist * 0.3, y: Math.min(o.attacker.y, o.defender.y) - dist * 0.3, w: Math.abs(o.attacker.x - o.defender.x) + dist * 0.6, h: Math.abs(o.attacker.y - o.defender.y) + dist * 0.6 }
    : { x: 0, y: 0, w: vw, h: vh };
  const figure = starFigure(plan, { attacker: o.attacker, defender: o.defender, radius, attackerRadius: aRadius, bounds: screen, launch: variant.launch }, c);
  const cues = withFormation(fplan, starsCues(plan, figure));
  const from = figure?.shotFrom ?? o.attacker, to = figure?.shotTo ?? o.defender;
  const ctrl = figure?.shotCtrl ?? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  // The line the shot ARRIVES on (the camera's hit, the struck portrait's knock) and the line it LEAVES on.
  const dir = figure ? shotArrival(figure) : { x: 1, y: 0 };
  const leaveAngle = Math.atan2(ctrl.y - from.y, ctrl.x - from.x);
  const kind = plan.kind;
  const written = kind === 'written';
  const T4 = plan.tier === 4;
  // The head: the arrow of starlight, as long as the constellation arrow it was (never shorter than the dial); a comet;
  // or a spark leading the riders and the beam. The tail: wider with the tier, widest behind the comet and the beam; it
  // hangs along the path after the blow.
  const look = SHOT_LOOK[kind];
  const lead = figure?.lead ?? 'arrow';
  const headPx = lead === 'arrow' ? Math.max(c.arrowPx * s, figure?.arrowLen ?? 0) : lead === 'comet' ? c.cometSize * radius * (written ? 1 : 0.85) : look.head * radius;
  const tailPx = look.tail > 0 ? look.tail * radius : c.trailWidth * s * (1 + 0.35 * (plan.tier - 1));
  const tailSpan = look.span;
  const lingerMs = Math.max(1, c.trailLingerMs * look.linger);
  const ls = LAUNCH_SOUND[plan.launch];

  const textures = o.textures !== undefined ? o.textures : heroStarsTextures();
  const scene = textures && !reduced && figure
    ? new HeroStarsScene(textures, { star: hexToNum(c.colorStar), gold: hexToNum(c.colorGold), line: hexToNum(c.colorLine), sky: hexToNum(c.colorSky), side: hexToNum(sideHex) }, {
      starPx: c.starPx, lineWidth: c.lineWidth, twinkle: c.twinkle, ghostAlpha: c.ghostAlpha, portraitAlpha: c.portraitAlpha, impactSize: c.impactSize,
      tier: plan.tier, swell: c.swell, hush: c.hush,
    }, s, starsSeed(o.total, dist, o.side, o.rollSeed))
    : null;
  if (scene && figure) {
    scene.setSky(screen, plan.skyStars);
    scene.setFigure(figure, figure.stars.map((st) => slotAt(plan, st.slot)), figure.edges.map((e) => slotAt(plan, e.slot)), plan.stepMs);
    scene.setPath(from, ctrl, to, lead, headPx, tailPx);
    if (written) {
      // "This hero, in the stars": the portrait image already on screen, copied once per image (never re-read after).
      let img: Element | null = null;
      try { img = o.attackerEl?.querySelector?.('img') ?? null; } catch { img = null; }
      scene.setPortrait(portraitStarTexture(img as HTMLImageElement | null));
    }
  }
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const cue = (clip: string, gain: number, rate: number, opts?: CueOpts): void => voices.cue(clip, gain, rate, opts);
  const own = kind === 'wolf' ? [c.sfxHowlClip] : kind === 'serpent' ? [c.sfxHissClip] : kind === 'wheel' ? [c.sfxGrindClip, c.sfxBeamClip]
    : kind === 'giant' ? [c.sfxRumbleClip] : kind === 'nova' ? [c.sfxImplodeClip] : [];
  voices.warm([c.sfxSkyClip, c.sfxTickClip, c.sfxLooseClip, c.sfxWhooshClip, c.sfxFallClip, c.sfxRiseClip, c.sfxBoomClip, c.sfxThrumClip, ...own]);
  // A big figure lights a star every few dozen ms: one tick for every second star, so it never becomes a rattle.
  const tickEvery = plan.tier >= 3 ? 2 : 1;
  const tickCount = Math.max(1, Math.ceil(((figure?.stars.filter((x) => !x.pluck).length ?? 1)) / tickEvery));
  let stars = 0, ticks = 0;
  const real = (ms: number): number => ms / speed;
  const T = plan.tier;

  /** The falling whistle of the star clip, placed so its landing falls on the blow (`fallMs` real ms from now). */
  const fallWhistle = (gain: number, fallReal: number): void => {
    const rate = c.sfxFallRate > 0 ? c.sfxFallRate : 1;
    const heard = fallReal * rate; // clip ms played before the blow
    if (c.sfxFallHitMs > heard) cue(c.sfxFallClip, gain, rate, { startMs: c.sfxFallHitMs - heard, lenMs: heard + 40, fadeMs: 40 });
    else cue(c.sfxFallClip, gain, rate, { delayMs: fallReal - c.sfxFallHitMs / rate, lenMs: c.sfxFallHitMs + 40, fadeMs: 40 });
  };
  /** A heavy, slowed rush of air whose peak arrives just before the blow. */
  const rush = (gain: number, fallReal: number): void => {
    const wr = 0.78, peakMs = 650, lead2 = Math.max(0, fallReal - 70);
    cue(c.sfxWhooshClip, gain, wr, { startMs: Math.max(0, peakMs - lead2 * wr), delayMs: Math.max(0, lead2 - peakMs / wr), fadeMs: 300 });
  };

  const fire = (q: StarsCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'sky':
        // The night arrives: the shimmer swells in (fuller and a touch lower on the bigger looks).
        cue(c.sfxSkyClip, c.sfxSkyGain * (0.8 + 0.2 * plan.k), c.sfxSkyRate * (1.06 - 0.1 * plan.k), { fadeMs: 500 });
        // The giant: the deep rumble of it rising, from its feet up, under the trace.
        if (kind === 'giant') cue(c.sfxRumbleClip, c.sfxRumbleGain, c.sfxRumbleRate, { delayMs: real(plan.traceAt - plan.chargeAt), fadeMs: 400 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'star':
        // A star is reached: a tick, CLIMBING in pitch through the trace (about an octave from the first to the last).
        if (stars++ % tickEvery === 0) {
          const u = tickCount > 1 ? ticks / (tickCount - 1) : 0.5;
          cue(c.sfxTickClip, c.sfxTickGain * (0.85 + 0.3 * u), c.sfxTickRate * (0.72 + 0.68 * Math.min(1, u)) * (kind === 'giant' ? 0.8 : 1));
          ticks++;
        }
        scene?.starPop(q.i);
        break;
      case 'alive':
        // The figure is whole: the shimmer answers (a short bloom). The wolf lifts its head and howls.
        cue(c.sfxSkyClip, c.sfxBloomGain * (1.5 + 0.15 * T), c.sfxSkyRate * 1.26, { startMs: 380, lenMs: 520, fadeMs: 320 });
        if (kind === 'wolf') cue(c.sfxHowlClip, c.sfxHowlGain, c.sfxHowlRate, { fadeMs: 300 });
        scene?.comeAlive();
        break;
      case 'draw': {
        const windowMs = real(plan.looseAt - plan.drawAt);
        switch (kind) {
          case 'written':
            // The arm reaches and the star is taken: a low, full tick; then the rise builds under the swelling star and
            // peaks on the moment it falls.
            cue(c.sfxTickClip, c.sfxTickGain * 1.6, c.sfxTickRate * 0.6);
            scene?.plucked(from, radius);
            voices.riser(c.sfxRiseClip, c.sfxRiseGain, c.sfxRiseRate * 0.9, windowMs);
            break;
          case 'wheel':
            // The wheel starts to turn: a low knock, then its grind, loudest while it turns fast and dying away into the
            // lock (the ratchet ticks as it turns are played from the paint).
            cue(c.sfxTickClip, c.sfxTickGain * 1.6, c.sfxTickRate * 0.5);
            cue(c.sfxGrindClip, c.sfxGrindGain, c.sfxGrindRate, { lenMs: real(plan.lockAt - plan.drawAt) * c.sfxGrindRate + 220, fadeMs: 260 });
            break;
          case 'giant':
            // The fist goes up: the rise peaks on the moment it comes down.
            cue(c.sfxTickClip, c.sfxTickGain * 1.4, c.sfxTickRate * 0.5);
            voices.riser(c.sfxRiseClip, c.sfxRiseGain, c.sfxRiseRate * 0.8, windowMs);
            break;
          case 'nova':
            // The sigil closes and the sky is drawn in: the implosion, placed to end as the point lets go, over the rise.
            scene?.plucked(from, radius * 1.4);
            voices.riser(c.sfxImplodeClip, c.sfxImplodeGain, c.sfxImplodeRate, windowMs);
            voices.riser(c.sfxRiseClip, c.sfxRiseGain * 0.6, c.sfxRiseRate * 0.85, windowMs);
            break;
          case 'wolf':
            // The crouch: a low tick and a short rise into the spring.
            cue(c.sfxTickClip, c.sfxTickGain * 1.2, c.sfxTickRate * 0.55);
            voices.riser(c.sfxRiseClip, c.sfxRiseGain * 0.6, c.sfxRiseRate * 1.15, windowMs);
            break;
          case 'serpent':
            // The coil: the hiss.
            cue(c.sfxHissClip, c.sfxHissGain, c.sfxHissRate, { fadeMs: 200 });
            break;
          default:
            if (T >= 2) {
              // The bow draws: the rise, placed so it peaks on the loose.
              voices.riser(c.sfxRiseClip, c.sfxRiseGain * (0.5 + 0.12 * T), c.sfxRiseRate * 1.3, windowMs);
            } else {
              // The arrow pulls back: one low tick.
              cue(c.sfxTickClip, c.sfxTickGain * 1.2, c.sfxTickRate * 0.62);
            }
        }
        break;
      }
      case 'hold':
        if (T4) scene?.swelling(from, radius * (kind === 'nova' ? 1.6 : 1));
        break;
      case 'lock':
        // The wheel locks: a heavy clunk (the first moment of the boom, short and high) and a hard tick, a ring on the marker.
        cue(c.sfxBoomClip, c.sfxBoomGain * 0.7, c.sfxBoomRate * 1.5, { lenMs: 320, fadeMs: 180 });
        cue(c.sfxTickClip, c.sfxTickGain * 1.8, c.sfxTickRate * 0.45);
        scene?.plucked(from, radius);
        break;
      case 'loose': {
        scene?.loosed(from, leaveAngle, radius);
        const flyReal = real(plan.impactAt - plan.looseAt);
        switch (kind) {
          case 'written':
            // The comet: the falling star's whistle, its landing on the blow, over a heavy rush of air peaking just before.
            fallWhistle(c.sfxFallGain, flyReal);
            rush(c.sfxWhooshGain * 2.4, flyReal);
            cue(c.sfxLooseClip, c.sfxLooseGain * 0.7, c.sfxLooseRate * 0.6, { fadeMs: 160 });
            break;
          case 'nova':
            // The point lets go: a short whistle and a hard rush, low.
            fallWhistle(c.sfxFallGain * 0.9, flyReal);
            rush(c.sfxWhooshGain * 2, flyReal);
            cue(c.sfxThrumClip, c.sfxThrumGain, c.sfxThrumRate * 0.7, { fadeMs: 200 });
            break;
          case 'wheel':
            // The beam: it fires all at once along the pointer's line; its own clip, with the snap high over it.
            scene?.beam(from, to, radius * 0.5, real(plan.impactAt - plan.looseAt) + 520);
            cue(c.sfxBeamClip, c.sfxBeamGain, c.sfxBeamRate, { tail: c.sfxTailMix, fadeMs: 500 });
            cue(c.sfxLooseClip, c.sfxLooseGain * 0.8, c.sfxLooseRate * 1.2, { fadeMs: 120 });
            break;
          case 'giant':
            // The fist comes down: a huge slowed rush and a deep thrum as the arm swings.
            rush(c.sfxWhooshGain * 2.6, flyReal);
            cue(c.sfxThrumClip, c.sfxThrumGain * 1.1, c.sfxThrumRate * 0.6, { fadeMs: 260 });
            break;
          case 'wolf':
            // The spring: a thrum off the ground and the rush of the leap.
            cue(c.sfxThrumClip, c.sfxThrumGain * 0.9, c.sfxThrumRate * 0.8, { fadeMs: 200 });
            rush(c.sfxWhooshGain * 1.6, flyReal);
            break;
          case 'serpent':
            // The strike: the hiss's sharp end and a fast pass of air.
            cue(c.sfxHissClip, c.sfxHissGain * 1.1, c.sfxHissRate * 1.15, { startMs: 380, fadeMs: 160 });
            cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate * 1.2, { startMs: c.sfxWhooshStartMs, lenMs: 500, fadeMs: 200 });
            break;
          default:
            // The string: its snap over a deep thrum, and the pass of the arrow (each place has its own accents).
            cue(c.sfxLooseClip, c.sfxLooseGain * (0.8 + 0.1 * T) * (T <= 2 ? ls.snap : 1), c.sfxLooseRate * (1.08 - 0.04 * T) * (T <= 2 ? ls.pitch : 1), { fadeMs: 120 });
            cue(c.sfxThrumClip, c.sfxThrumGain * (0.7 + 0.12 * T), c.sfxThrumRate * (1.12 - 0.06 * T) * (T <= 2 ? ls.pitch : 1), { fadeMs: 200 });
            cue(c.sfxWhooshClip, c.sfxWhooshGain * (0.8 + 0.1 * T), c.sfxWhooshRate, { startMs: c.sfxWhooshStartMs, lenMs: 700 * (T <= 2 ? ls.whoosh : 1), fadeMs: 260 });
            if (T <= 2 && ls.fall) fallWhistle(c.sfxFallGain * 0.5, flyReal);
        }
        break;
      }
      case 'impact':
        if (T4) {
          // The landing: the deep boom and its tail, the falling star's own landing, and the sky's shimmer blooming
          // again over it (the other stars answering).
          cue(c.sfxBoomClip, c.sfxBoomGain * (kind === 'giant' || kind === 'nova' ? 1.15 : 1), c.sfxBoomRate * (kind === 'giant' ? 0.9 : 1), { tail: c.sfxTailMix, fadeMs: 700 });
          cue(c.sfxFallClip, c.sfxFallGain * 0.7, c.sfxFallRate, { startMs: c.sfxFallHitMs, tail: c.sfxTailMix, fadeMs: 500 });
          cue(c.sfxSkyClip, c.sfxBloomGain * (kind === 'nova' ? 1.6 : 1), c.sfxSkyRate * 1.12, { startMs: 380, fadeMs: 700 });
        } else {
          // The arrows and the beasts: the first moment of the boom, quieter and higher (a thump, not a blast), under the landing.
          cue(c.sfxBoomClip, c.sfxBoomGain * (0.3 + 0.1 * T), c.sfxBoomRate * (1.75 - 0.15 * T), { lenMs: 420 + 140 * T, fadeMs: 260 });
          cue(c.sfxFallClip, c.sfxHitGain * (0.75 + 0.1 * T), c.sfxHitRate, { startMs: c.sfxFallHitMs, tail: c.sfxTailMix, fadeMs: 400 });
        }
        scene?.impact(to, dir, radius, T, plan.flash);
        if (kind === 'nova') scene?.novaBurst(to, radius);
        if (plan.ko) { scene?.koFlourish(to, radius); playKoSting(voices, sound, (ms) => ms / speed, 0.4); }
        seq.land();
        break;
      case 'scatter':
        // The lines break into falling sparks: the shimmer once more, lower and long (shorter for a beast).
        cue(c.sfxSkyClip, c.sfxBloomGain * (T4 ? 0.8 : 0.6), c.sfxSkyRate * (T4 ? 0.86 : 1), { startMs: 380, fadeMs: T4 ? 1100 : 600 });
        scene?.scatter(T4 ? c.sparkFallMs : Math.max(300, (plan.endAt - plan.scatterAt) * 1.2));
        break;
      default:
        break;
    }
  };

  // ── the per-frame paint ──
  const F: SkyFrame = {
    t: 0, sky: 0, veil: plan.veil, draw: 0, alive: 0, ghost: 0, arrow: 1, pluck: 0, swell: 0, hush: 0, spin: 0, ride: 0, loosed: false, gather: 0, flare: 0, fig: 1,
    shimmerAt: Infinity, shimmerX: to.x, shimmerY: to.y,
  };
  // The wheel's ratchet: a tick each time a spoke passes (every twelfth of a turn).
  const notch = Math.PI / 6;
  let lastNotch = 0;
  let tailOn = false;
  // Tier 4's portrait fades in while the bust is traced (the second half of the trace).
  const ghostFrom = slotAt(plan, Math.floor(plan.slots * 0.45));
  const centre = figure?.centre ?? o.attacker;
  const flip = dir.x < 0 ? -1 : 1;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.traceAt, plan.outAt);
    const cm = starsCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(starsCameraFocus(plan, t, centre, o.defender), cm.zoom, cm.x, cm.y, unit);
    const alive = aliveAmount(plan, t);
    const w = drawAmount(plan, t);
    if (scene) {
      const gone = t < plan.looseAt ? 1 : 1 - clamp01((t - plan.looseAt) / 70);
      F.t = t; F.sky = skyAmount(plan, t); F.draw = w; F.alive = alive; F.arrow = gone;
      // The ghost: written in the stars' portrait fades in while the bust is traced; the giant's body stays until the
      // blow; the hunter's goes with the arrow.
      const ghostEnd = kind === 'giant' ? plan.impactAt : plan.looseAt;
      F.ghost = written ? clamp01((t - ghostFrom) / Math.max(1, plan.tracedAt - ghostFrom)) : alive * (t < ghostEnd ? 1 : 1 - clamp01((t - ghostEnd) / 280));
      F.pluck = T4 ? 0.12 + 0.88 * Math.max(0, Math.min(1, w)) : 0;
      F.swell = swellAmount(plan, t); F.hush = hushAmount(plan, t); F.flare = flareAmount(plan, t); F.fig = figureAmount(plan, t);
      F.spin = (figure?.spinTurns ?? 0) * spinAmount(plan, t); F.gather = gatherAmount(plan, t);
      const st = shotAt(plan, t);
      F.ride = st.phase === 'fly' ? st.u : st.phase === 'done' ? 1 : 0; F.loosed = t >= plan.looseAt;
      F.shimmerAt = t >= plan.impactAt ? plan.impactAt : Infinity;
      scene.frame(F);
      if (kind === 'wheel' && sound) {
        const n = Math.floor(Math.abs(F.spin) / notch);
        if (n > lastNotch && t < plan.lockAt) cue(c.sfxTickClip, c.sfxTickGain * 0.7, c.sfxTickRate * (0.55 + 0.2 * (n % 2)));
        lastNotch = Math.max(lastNotch, n);
      }
      if (st.phase === 'fly') { scene.shotFrame(st.u, st.u - tailSpan, true, 1); tailOn = true; }
      else if (st.phase === 'done' && tailOn) {
        // The line of light hangs along the path, draining toward the hit as it fades.
        const x = clamp01((t - plan.impactAt) / lingerMs);
        scene.shotFrame(1, 1 - tailSpan * (1 - x * x), false, 1 - x * x);
        if (x >= 1) tailOn = false;
      }
    }
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The hero rises a little as its constellation comes alive, leans back with the draw, and rocks on the loose.
      const lift = c.heroLiftPx * px * alive * (t < plan.impactAt ? 1 : Math.exp(-(t - plan.impactAt) / 160));
      const lean = (t < plan.looseAt ? Math.max(0, w) : 0) * c.heroLiftPx * 0.6 * px;
      const rock = t >= plan.looseAt ? c.heroLiftPx * 0.8 * px * Math.max(0, spring(t - plan.looseAt, 5, 70)) : 0;
      const bx = -dir.x * lean + dir.x * rock, by = -lift * 0.5 - dir.y * lean + dir.y * rock;
      const sc = 1 + 0.025 * alive * (t < plan.impactAt ? 1 : Math.exp(-(t - plan.impactAt) / 160));
      const rot = -1.6 * flip * (t < plan.looseAt ? Math.max(0, w) : 0);
      const still = Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(rot) < 0.01 && Math.abs(sc - 1) < 1e-4;
      hero.set(still ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    let css: string | null = null;
    if (t >= plan.impactAt) {
      // The struck portrait is ROCKED: knocked along the line of the hit, tipped and squashed, reeling longer the
      // bigger the look.
      const k = spring(t - plan.impactAt, 4.5 - 1.3 * plan.k, 90 + 130 * plan.k);
      const knock = c.knockPx * (0.7 + 1.1 * plan.k) * k * px;
      const sq = c.squash * (0.8 + 0.7 * plan.k) * k;
      const tip = (2 + 5 * plan.k) * flip * k;
      fx = dir.x * knock; fy = dir.y * knock;
      css = Math.abs(k) < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) rotate(${tip.toFixed(3)}deg) scale(${(1 + sq * 0.6).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
    }
    foe.set(css);
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<StarsCue | FormationCue> = new Sequence<StarsCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      scene?.endSky();
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    variant,
    figure,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
