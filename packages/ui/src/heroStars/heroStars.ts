/**
 * THE WRITTEN IN THE STARS RUNNER ("Written in the Stars"; ANCIENT; dev-only, no cosmetic yet): plays one constellation
 * hero attack (the beats and the geometry are in `heroStarsConfig.ts`) and lands the consequence on its impact beat
 * (the arrow of starlight, or IV's falling star). Presentation only: the total and the blow are the engine's; this file
 * only decides WHEN on screen they happen.
 *
 * CONSTELLATIONS: the board dims to a night sky, stars light one by one as lines reach them, and the finished figure
 * comes alive and strikes: I an arrow, II a bow that draws, III an archer, IV the striking hero's own portrait as a
 * medallion in the stars, whose arm plucks a star from the sky; the star swells while the sky holds its breath and
 * falls on the struck hero as a comet. Every shot is a bolt of starlight with a long tail that hangs along its path;
 * every blow is a nova of stardust, a flash on the sky, the struck portrait rocked and the stars jolted, scaled by
 * the tier. IV's lines then scatter into falling sparks.
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
  aliveAmount, drawAmount, figureAmount, flareAmount, getHeroStarsConfig, hushAmount, shotAt, shotArrival, skyAmount, slotAt, starFigure, starsCameraAt,
  starsCameraFocus, starsCues, starsPlan, swellAmount,
  type HeroStarsConfig, type StarFigure, type StarsCue, type StarsPlan,
} from './heroStarsConfig';
import { HeroStarsScene, type HeroStarsTextures, type SkyFrame } from './heroStarsScene';
import { heroStarsTextures, portraitStarTexture } from './heroStarsTextures';

export interface HeroStarsOptions extends HeroAttackOptions {
  cfg?: HeroStarsConfig;
  textures?: HeroStarsTextures | null;
}

export interface HeroStarsHandle extends HeroAttackHandle {
  readonly plan: StarsPlan;
  readonly figure: StarFigure | null;
  readonly scene: HeroStarsScene | null;
  readonly mirrorsCamera: boolean;
}

/** The sky's scatter is seeded: the blow's own roll when the fight gives one, else the blow itself (a replay matches). */
export function starsSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, rollSeed?: number): number {
  const own = (Math.round(total) * 6977 + Math.round(distance) * 43 + (side === 'opp' ? 251 : 29)) >>> 0;
  return typeof rollSeed === 'number' && Number.isFinite(rollSeed) ? ((Math.imul(rollSeed >>> 0, 2654435761) ^ own) >>> 0) : own;
}

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
  const plan = starsPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt }, c);
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
  const figure = starFigure(plan, { attacker: o.attacker, defender: o.defender, radius, attackerRadius: aRadius, bounds: screen }, c);
  const cues = withFormation(fplan, starsCues(plan, figure));
  const from = figure?.shotFrom ?? o.attacker, to = figure?.shotTo ?? o.defender;
  const ctrl = figure?.shotCtrl ?? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  // The line the shot ARRIVES on (the camera's hit, the struck portrait's knock) and the line it LEAVES on.
  const dir = figure ? shotArrival(figure) : { x: 1, y: 0 };
  const leaveAngle = Math.atan2(ctrl.y - from.y, ctrl.x - from.x);
  const written = plan.kind === 'written';
  // The head: the arrow of starlight, as long as the constellation arrow it was (never shorter than the dial); IV: the
  // comet. The tail: wider with the tier, widest behind the comet; I and II trail part of the path, III and IV all of
  // it, and it hangs there after the blow.
  const headPx = written ? c.cometSize * radius : Math.max(c.arrowPx * s, figure?.arrowLen ?? 0);
  const tailPx = written ? radius * 0.5 : c.trailWidth * s * (1 + 0.35 * (plan.tier - 1));
  const tailSpan = plan.kind === 'arrow' ? 0.5 : plan.kind === 'bow' ? 0.65 : 1;
  const lingerMs = Math.max(1, c.trailLingerMs * (written ? 1.3 : plan.tier >= 3 ? 1 : 0.5));

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
    scene.setPath(from, ctrl, to, written, headPx, tailPx);
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
  voices.warm([c.sfxSkyClip, c.sfxTickClip, c.sfxLooseClip, c.sfxWhooshClip, c.sfxFallClip, c.sfxRiseClip, c.sfxBoomClip, c.sfxThrumClip]);
  // A big figure lights a star every few dozen ms: one tick for every second star, so it never becomes a rattle.
  const tickEvery = plan.kind === 'hunter' || written ? 2 : 1;
  const tickCount = Math.max(1, Math.ceil(((figure?.stars.length ?? 1) - (written ? 1 : 0)) / tickEvery));
  let stars = 0, ticks = 0;
  const real = (ms: number): number => ms / speed;
  const T = plan.tier;

  const fire = (q: StarsCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'sky':
        // The night arrives: the shimmer swells in (fuller and a touch lower on the bigger looks).
        cue(c.sfxSkyClip, c.sfxSkyGain * (0.8 + 0.2 * plan.k), c.sfxSkyRate * (1.06 - 0.1 * plan.k), { fadeMs: 500 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'star':
        // A star is reached: a tick, CLIMBING in pitch through the trace (about an octave from the first to the last).
        if (stars++ % tickEvery === 0) {
          const u = tickCount > 1 ? ticks / (tickCount - 1) : 0.5;
          cue(c.sfxTickClip, c.sfxTickGain * (0.85 + 0.3 * u), c.sfxTickRate * (0.72 + 0.68 * Math.min(1, u)));
          ticks++;
        }
        scene?.starPop(q.i);
        break;
      case 'alive':
        // The figure is whole: the shimmer answers (a short bloom).
        cue(c.sfxSkyClip, c.sfxBloomGain * (1.5 + 0.15 * T), c.sfxSkyRate * 1.26, { startMs: 380, lenMs: 520, fadeMs: 320 });
        scene?.comeAlive();
        break;
      case 'draw': {
        const windowMs = real(plan.looseAt - plan.drawAt);
        if (written) {
          // The arm reaches and the star is taken: a low, full tick; then the rise builds under the swelling star and
          // peaks on the moment it falls.
          cue(c.sfxTickClip, c.sfxTickGain * 1.6, c.sfxTickRate * 0.6);
          scene?.plucked(from, radius);
          voices.riser(c.sfxRiseClip, c.sfxRiseGain, c.sfxRiseRate * 0.9, windowMs);
        } else if (T >= 2) {
          // The bow draws: the rise, placed so it peaks on the loose.
          voices.riser(c.sfxRiseClip, c.sfxRiseGain * (0.5 + 0.12 * T), c.sfxRiseRate * 1.3, windowMs);
        } else {
          // The arrow pulls back: one low tick.
          cue(c.sfxTickClip, c.sfxTickGain * 1.2, c.sfxTickRate * 0.62);
        }
        break;
      }
      case 'hold':
        if (written) scene?.swelling(from, radius);
        break;
      case 'loose':
        scene?.loosed(from, leaveAngle, radius);
        if (written) {
          // The comet: the falling star's whistle, placed so its landing falls on the blow, over a heavy rush of air
          // whose peak arrives just before it.
          const rate = c.sfxFallRate > 0 ? c.sfxFallRate : 1;
          const fallReal = real(plan.impactAt - plan.looseAt);
          const heard = fallReal * rate; // clip ms played before the blow
          if (c.sfxFallHitMs > heard) cue(c.sfxFallClip, c.sfxFallGain, rate, { startMs: c.sfxFallHitMs - heard, lenMs: heard + 40, fadeMs: 40 });
          else cue(c.sfxFallClip, c.sfxFallGain, rate, { delayMs: fallReal - c.sfxFallHitMs / rate, lenMs: c.sfxFallHitMs + 40, fadeMs: 40 });
          const wr = 0.78, peakMs = 650, lead = Math.max(0, fallReal - 70);
          cue(c.sfxWhooshClip, c.sfxWhooshGain * 2.4, wr, { startMs: Math.max(0, peakMs - lead * wr), delayMs: Math.max(0, lead - peakMs / wr), fadeMs: 300 });
          cue(c.sfxLooseClip, c.sfxLooseGain * 0.7, c.sfxLooseRate * 0.6, { fadeMs: 160 });
        } else {
          // The string: its snap over a deep thrum, and the pass of the arrow.
          cue(c.sfxLooseClip, c.sfxLooseGain * (0.8 + 0.1 * T), c.sfxLooseRate * (1.08 - 0.04 * T), { fadeMs: 120 });
          cue(c.sfxThrumClip, c.sfxThrumGain * (0.7 + 0.12 * T), c.sfxThrumRate * (1.12 - 0.06 * T), { fadeMs: 200 });
          cue(c.sfxWhooshClip, c.sfxWhooshGain * (0.8 + 0.1 * T), c.sfxWhooshRate, { startMs: c.sfxWhooshStartMs, lenMs: 700, fadeMs: 260 });
        }
        break;
      case 'impact':
        if (written) {
          // The landing: the deep boom and its tail, the falling star's own landing, and the sky's shimmer blooming
          // again over it (the other stars answering).
          cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate, { tail: c.sfxTailMix, fadeMs: 700 });
          cue(c.sfxFallClip, c.sfxFallGain * 0.7, c.sfxFallRate, { startMs: c.sfxFallHitMs, tail: c.sfxTailMix, fadeMs: 500 });
          cue(c.sfxSkyClip, c.sfxBloomGain, c.sfxSkyRate * 1.12, { startMs: 380, fadeMs: 700 });
        } else {
          // The arrows: the first moment of the boom, quieter and higher (a thump, not a blast), under the landing.
          cue(c.sfxBoomClip, c.sfxBoomGain * (0.3 + 0.1 * T), c.sfxBoomRate * (1.75 - 0.15 * T), { lenMs: 420 + 140 * T, fadeMs: 260 });
          cue(c.sfxFallClip, c.sfxHitGain * (0.75 + 0.1 * T), c.sfxHitRate, { startMs: c.sfxFallHitMs, tail: c.sfxTailMix, fadeMs: 400 });
        }
        scene?.impact(to, dir, radius, T, plan.flash);
        if (plan.ko) { scene?.koFlourish(to, radius); playKoSting(voices, sound, (ms) => ms / speed, 0.4); }
        seq.land();
        break;
      case 'scatter':
        // The lines break into falling sparks: the shimmer once more, lower and long.
        cue(c.sfxSkyClip, c.sfxBloomGain * 0.8, c.sfxSkyRate * 0.86, { startMs: 380, fadeMs: 1100 });
        scene?.scatter(c.sparkFallMs);
        break;
      default:
        break;
    }
  };

  // ── the per-frame paint ──
  const F: SkyFrame = { t: 0, sky: 0, veil: plan.veil, draw: 0, alive: 0, ghost: 0, arrow: 1, pluck: 0, swell: 0, hush: 0, flare: 0, fig: 1, shimmerAt: Infinity, shimmerX: to.x, shimmerY: to.y };
  let tailOn = false;
  // IV's portrait fades in while the bust is traced (the second half of the trace).
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
      F.ghost = written ? clamp01((t - ghostFrom) / Math.max(1, plan.tracedAt - ghostFrom)) : alive * (t < plan.looseAt ? 1 : 1 - clamp01((t - plan.looseAt) / 280));
      F.pluck = written ? 0.12 + 0.88 * Math.max(0, Math.min(1, w)) : 0;
      F.swell = swellAmount(plan, t); F.hush = hushAmount(plan, t); F.flare = flareAmount(plan, t); F.fig = figureAmount(plan, t);
      F.shimmerAt = t >= plan.impactAt ? plan.impactAt : Infinity;
      scene.frame(F);
      const st = shotAt(plan, t);
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
