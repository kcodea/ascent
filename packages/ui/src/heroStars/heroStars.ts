/**
 * THE WRITTEN IN THE STARS RUNNER ("Written in the Stars"; ANCIENT; dev-only, no cosmetic yet): plays one constellation
 * hero attack (the beats and the geometry are in `heroStarsConfig.ts`) and lands the consequence on its impact beat
 * (the arrow of starlight, or IV's falling star). Presentation only: the total and the blow are the engine's; this file
 * only decides WHEN on screen they happen.
 *
 * CONSTELLATIONS: the board dims to a night sky, stars light one by one as thin lines reach them, and the finished
 * figure comes alive and strikes: I an arrow, II a bow that draws, III an archer, IV the striking hero's own portrait
 * as a medallion in the stars, whose arm plucks a star from the sky and lets it fall on the struck hero.
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
  aliveAmount, drawAmount, getHeroStarsConfig, shotAt, skyAmount, slotAt, starFigure, starsCameraAt, starsCameraFocus, starsCues, starsPlan,
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
  const shotLen = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const dir = { x: (to.x - from.x) / shotLen, y: (to.y - from.y) / shotLen };
  const shotAngle = Math.atan2(dir.y, dir.x);
  const written = plan.kind === 'written';
  // The arrow of starlight is as long as the constellation arrow it was (never shorter than the dial).
  const shotSize = written ? plan.size * 1.15 : Math.max(1, (figure?.arrowLen ?? 0) / Math.max(1, c.arrowPx * s));
  const trailLen = plan.kind === 'arrow' ? radius * 2.2 : plan.kind === 'bow' ? radius * 3.4 : Infinity;

  const textures = o.textures !== undefined ? o.textures : heroStarsTextures();
  const scene = textures && !reduced && figure
    ? new HeroStarsScene(textures, { star: hexToNum(c.colorStar), gold: hexToNum(c.colorGold), line: hexToNum(c.colorLine), sky: hexToNum(c.colorSky), side: hexToNum(sideHex) }, {
      starPx: c.starPx, lineWidth: c.lineWidth, twinkle: c.twinkle, ghostAlpha: c.ghostAlpha, portraitAlpha: c.portraitAlpha, arrowPx: c.arrowPx,
      trailWidth: c.trailWidth, impactSize: c.impactSize,
    }, s, starsSeed(o.total, dist, o.side, o.rollSeed))
    : null;
  if (scene && figure) {
    scene.setSky(screen, plan.skyStars);
    scene.setFigure(figure, figure.stars.map((st) => slotAt(plan, st.slot)), figure.edges.map((e) => slotAt(plan, e.slot)), plan.stepMs);
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
  voices.warm([c.sfxSkyClip, c.sfxTickClip, c.sfxLooseClip, c.sfxWhooshClip, c.sfxFallClip]);
  // A big figure lights a star every few dozen ms: one tick for every second star, so it never becomes a rattle.
  const tickEvery = plan.kind === 'hunter' || written ? 2 : 1;
  let ticks = 0;

  const fire = (q: StarsCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'sky':
        // The night arrives: a soft swell.
        cue(c.sfxSkyClip, c.sfxSkyGain * (0.8 + 0.2 * plan.k), c.sfxSkyRate, { fadeMs: 500 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'star':
        // A star is reached: a soft tick (a hair of pitch variation, fixed per star).
        if (ticks++ % tickEvery === 0) cue(c.sfxTickClip, c.sfxTickGain, c.sfxTickRate * (0.94 + 0.12 * ((q.i * 0.618) % 1)));
        scene?.starPop(q.i);
        break;
      case 'alive':
        scene?.comeAlive();
        break;
      case 'draw':
        if (written) {
          // The arm reaches and the star is plucked: a lower, fuller tick.
          cue(c.sfxTickClip, c.sfxTickGain * 1.5, c.sfxTickRate * 0.7);
          scene?.plucked(from, radius);
        }
        break;
      case 'loose':
        scene?.loosed(from, shotAngle, radius);
        if (written) {
          // The descent: the part of the clip BEFORE its landing, placed so the landing falls on the blow.
          const rate = c.sfxFallRate > 0 ? c.sfxFallRate : 1;
          const fallReal = (plan.impactAt - plan.looseAt) / speed;
          const heard = fallReal * rate; // clip ms played before the blow
          if (c.sfxFallHitMs > heard) cue(c.sfxFallClip, c.sfxFallGain, rate, { startMs: c.sfxFallHitMs - heard, lenMs: heard + 40, fadeMs: 40 });
          else cue(c.sfxFallClip, c.sfxFallGain, rate, { delayMs: fallReal - c.sfxFallHitMs / rate, lenMs: c.sfxFallHitMs + 40, fadeMs: 40 });
        } else {
          // The string's snap, and the airy pass of the arrow under it.
          cue(c.sfxLooseClip, c.sfxLooseGain * (0.8 + 0.1 * plan.tier), c.sfxLooseRate * (1.08 - 0.04 * plan.tier), { fadeMs: 120 });
          cue(c.sfxWhooshClip, c.sfxWhooshGain * (0.8 + 0.1 * plan.tier), c.sfxWhooshRate, { startMs: c.sfxWhooshStartMs, lenMs: 700, fadeMs: 260 });
        }
        break;
      case 'impact':
        // The landing: the falling star clip from its landing on (the arrows play it softer and a touch higher).
        if (written) {
          cue(c.sfxFallClip, c.sfxFallGain, c.sfxFallRate, { startMs: c.sfxFallHitMs, tail: c.sfxTailMix, fadeMs: 500 });
          // The other stars answer: the sky's shimmer blooms again, softly (from past its swell in).
          cue(c.sfxSkyClip, c.sfxBloomGain, c.sfxSkyRate * 1.12, { startMs: 380, fadeMs: 700 });
        }
        else cue(c.sfxFallClip, c.sfxHitGain * (0.75 + 0.1 * plan.tier), c.sfxHitRate, { startMs: c.sfxFallHitMs, tail: c.sfxTailMix, fadeMs: 400 });
        scene?.setShot(false);
        scene?.impact(to, dir, radius, plan.tier);
        // The hunter's line of light and the falling star's trail hang in the sky a moment.
        if (plan.kind === 'hunter' || written) scene?.linger(from, to, c.trailLingerMs, shotSize);
        if (plan.ko) { scene?.koFlourish(to, radius); playKoSting(voices, sound, (ms) => ms / speed, 0.4); }
        seq.land();
        break;
      default:
        break;
    }
  };

  // ── the per-frame paint ──
  const F: SkyFrame = { t: 0, sky: 0, veil: plan.veil, draw: 0, alive: 0, ghost: 0, arrow: 1, pluck: 0, shimmerAt: Infinity, shimmerX: o.defender.x, shimmerY: o.defender.y };
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
      F.shimmerAt = t >= plan.impactAt ? plan.impactAt : Infinity;
      scene.frame(F);
      const st = shotAt(plan, t);
      if (st.phase === 'fly') scene.setShot(true, from.x + (to.x - from.x) * st.u, from.y + (to.y - from.y) * st.u, shotAngle, from.x, from.y, shotSize, written, trailLen);
      else if (st.phase === 'nocked') scene.setShot(false);
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
      const k = spring(t - plan.impactAt, 4.5, 90);
      const knock = c.knockPx * (0.7 + 0.5 * plan.k) * k * px;
      const sq = c.squash * (0.8 + 0.5 * plan.k) * k;
      fx = dir.x * knock; fy = dir.y * knock;
      css = Math.abs(k) < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 + sq * 0.6).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
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
