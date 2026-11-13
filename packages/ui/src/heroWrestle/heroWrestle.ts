/**
 * THE WRESTLING RUNNER ("Top Rope", a Legendary): plays one Wrestle attack (the beats are in `heroWrestleConfig.ts`) and
 * lands the consequence on its impact beat (the chop, the slam, the elbow, the clothesline). Presentation only: the
 * total and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses and never changes speed), the
 * damage formation, the `#stage` camera (applied ONCE: `stageCamera.ts`), the voices, the dim, reduced motion, finish /
 * cancel and the safety timer.
 *
 * BOTH PORTRAITS MOVE: the striker walks over and wrestles the struck one (it is lifted, slammed, shoved flat, whipped
 * into the ropes, clotheslined and pinned). Each pose is solved in screen px and written as a transform in the
 * portrait's own units (its ancestors' scale measured ONCE at the start); the squash is in SCREEN axes, so a portrait on
 * its back still flattens against the mat. A portrait outside the `#stage` camera (the foe's <body> portal) folds the
 * camera's zoom and shake into its own transform. The striker is raised over the target for the whole attack (Classic's
 * `.duel-attacker-*` z-order). EVERY exit path (the end, `finish()`, `cancel()`, the safety timer, and an unmount, which
 * cancels) restores both transforms, the striker's opacity, the z-order class and the socket shades exactly, and hides
 * the ring, the spotlight, the elbow star and the shadow.
 *
 * THE EMPTY SOCKET (`SocketShade` below): the board's backdrop paints a pitch-black soft disc under each resting
 * portrait (the portrait's drop shadow and its "hero shade", `.boardbg-shade` in styles.css, pinned to the RESTING spot
 * by design). With the portrait away wrestling for seconds that disc reads as a hole in the UI, so it is switched off
 * while a portrait is out of its socket and put back exactly as it was before it gets home.
 *
 * THE CONTRACT: the consequence (`onImpact`) lands exactly ONCE, on the impact. The shove, the ropes, the landing on the
 * mat, the count and the bell are ticks.
 *
 * Perf: DOM writes are `transform` from the clock; layout is read once at the start; pooled sprites under a hard cap
 * plus the own objects (the ring's 33 sprites, the light, the star, the shadow); textures painted once per session and
 * pre-warmed during the formation; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { hexToNum, prefersReducedMotion, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  CLIMB_HOPS, getHeroWrestleConfig, ringLayout, strikerPose, variantOf, victimPose, wrestleCameraAt, wrestleChair, wrestleCues, wrestleDizzy, wrestleElbow,
  wrestleFrameTransform, wrestleGeo, wrestlePlan, wrestlePost, wrestleRing, wrestleShadow, wrestleShots, wrestleSpot, wrestleView,
  type HeroWrestleConfig, type WrestleCtx, type WrestleCue, type WrestleGeo, type WrestlePlan, type WrestlePose, type WrestleVariant,
} from './heroWrestleConfig';
import { HeroWrestleScene, type HeroWrestleTextures } from './heroWrestleScene';
import { heroWrestleTextures } from './heroWrestleTextures';

export interface HeroWrestleOptions extends HeroAttackOptions {
  cfg?: HeroWrestleConfig;
  textures?: HeroWrestleTextures | null;
}

export interface HeroWrestleHandle extends HeroAttackHandle {
  readonly plan: WrestlePlan;
  readonly geo: WrestleGeo;
  /** The variant this blow rolled (from `rollSeed`; the tuner can force one). */
  readonly variant: WrestleVariant;
  readonly scene: HeroWrestleScene | null;
  readonly mirrorsCamera: boolean;
  /** The striking and the struck portraits' poses at a sequence time (pure). */
  striker(t: number): WrestlePose;
  victim(t: number): WrestlePose;
}

export function wrestleSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 2711 + Math.round(distance) * 41 + (side === 'opp' ? 197 : 23)) >>> 0;
}

/**
 * The backdrop's shades under the two portraits (see the header). SHARED CAUSE, fixed here for this attack only: every
 * attack that takes the player's portrait out of its socket (Baseball, Soccer, Basketball, Backstab...) uncovers the same
 * black disc, because the shadow is a static gradient in the backdrop layer rather than part of the portrait; they are
 * away for a moment, this one for seconds. The shades are custom properties read by `.boardbg-shade`'s gradients, so an
 * inline override on those elements turns one circle off without touching the others (the hero power's stays). Two style
 * writes per portrait per attack (off, back on), never per frame; every prior inline value is restored exactly.
 */
const SHADE_PROPS = { player: [['--psh-a', '0'], ['--bd-shade-r', '0px']], opp: [['--bd-oshade-r', '0px']] } as const;
export class SocketShade {
  private els: HTMLElement[] | null = null;
  private saved: Map<HTMLElement, Record<string, string>> = new Map();
  private readonly off = { player: false, opp: false };

  constructor(private readonly doc: Document | null) {}

  /** Whether `who`'s shade is switched off right now. */
  hidden(who: 'player' | 'opp'): boolean { return this.off[who]; }

  set(who: 'player' | 'opp', hide: boolean): void {
    if (!this.doc || this.off[who] === hide) return;
    this.off[who] = hide;
    try {
      this.els ??= [...this.doc.querySelectorAll<HTMLElement>('.boardbg-shade')];
      for (const el of this.els) {
        let was = this.saved.get(el);
        if (!was) { was = {}; this.saved.set(el, was); }
        for (const [k, v] of SHADE_PROPS[who]) {
          if (hide) { if (!(k in was)) was[k] = el.style.getPropertyValue(k); el.style.setProperty(k, v); }
          else if (was[k]) el.style.setProperty(k, was[k]!); else el.style.removeProperty(k);
        }
      }
    } catch { /* no DOM here: nothing to hide */ }
  }

  /** Put both shades back exactly (every exit). */
  restore(): void { this.set('player', false); this.set('opp', false); }
}

/** One measure of a portrait: its screen size, and `inv` = its own transform px per screen px. */
function rectOf(el: HTMLElement | null | undefined, r: number): { width: number; height: number; inv: number } {
  try {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { width: r * 2, height: r * 2, inv: 1 };
    return { width: b.width, height: b.height, inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  } catch { return { width: r * 2, height: r * 2, inv: 1 }; }
}

/**
 * A portrait pose as a CSS transform in its own units (`unit` = screen px per own px), or null when at rest. The squash
 * (and the turn on the spot, `flip`) is written OUTSIDE the rotation, so it is in screen axes (a portrait lying flat
 * squashes against the floor). The squash is capped so a portrait never vanishes into a line.
 */
export function poseCss(off: Pt, p: WrestlePose, sc: number, unit: number): string | null {
  const moved = Math.abs(off.x) > 0.05 || Math.abs(off.y) > 0.05 || Math.abs(sc - 1) > 1e-4 || Math.abs(p.rot) > 0.01;
  const q = Math.max(-0.4, Math.min(0.72, p.squash));
  const f = Math.abs(p.flip) < 0.06 ? (p.flip < 0 ? -0.06 : 0.06) : p.flip;
  const sq = Math.abs(q) > 0.002 || Math.abs(f - 1) > 1e-3 ? ` scale(${((1 + q * 0.6) * f).toFixed(4)}, ${(1 - q).toFixed(4)})` : '';
  if (!moved && !sq) return null;
  return `translate(${(off.x / unit).toFixed(2)}px, ${(off.y / unit).toFixed(2)}px)${sq} rotate(${p.rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
}

const ORIGIN: Pt = { x: 0, y: 0 };

/** Play the Wrestle attack. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroWrestle(o: HeroWrestleOptions): HeroWrestleHandle {
  const c = o.cfg ?? getHeroWrestleConfig();
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
  const aRect = local ? { inv: 1 } : rectOf(o.attackerEl, aRadius);
  const dRect = local ? { inv: 1 } : rectOf(o.defenderEl, radius);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const variant = variantOf(o.rollSeed ?? wrestleSeed(o.total, dist, o.side), c);
  const plan = wrestlePlan({ total: o.total, knockout: o.knockout, reduced, leadIn: fplan.endAt, variant }, c);
  const cues = withFormation(fplan, wrestleCues(plan));
  const vw = local ? (o.host?.clientWidth || 400) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
  const vh = local ? (o.host?.clientHeight || 300) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
  const frame = { x0: 0, y0: 0, x1: vw, y1: vh };
  const geo = wrestleGeo(o.attacker, o.defender, aRadius, radius, frame, plan.kind, c, plan.variant);
  const ctx: WrestleCtx = { p: plan, g: geo, c, a: o.attacker, d: o.defender, aR: aRadius, dR: radius };
  const shots = wrestleShots(ctx);
  const striker = (t: number): WrestlePose => strikerPose(ctx, t);
  const victim = (t: number): WrestlePose => victimPose(ctx, t);
  const sides = ringLayout(geo, aRadius, radius);
  const sd = geo.s;
  // The way the blow drives the view: the chop goes sideways (away from the striker), the clothesline back the way the
  // struck portrait came, the chair, the slams, the elbow and the cutter straight down into the mat.
  const blowDir: Pt = plan.kind === 'chop' && plan.variant === 1 ? { x: -sd, y: 0 } : plan.kind === 'pin' && plan.variant === 1 ? { x: sd, y: 0 } : { x: 0, y: 1 };

  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hwrestle',
  });

  const textures = o.textures !== undefined ? o.textures : heroWrestleTextures();
  const scene = textures && !reduced
    ? new HeroWrestleScene(textures, {
      mat: hexToNum(c.colorMat), flash: hexToNum(c.colorFlash), pow: hexToNum(c.colorPow), hand: hexToNum(c.colorHand), spot: hexToNum(c.colorSpot), side: hexToNum(sideHex),
    }, { ropeSize: c.ropeSize, wordSize: c.wordSize, frameW: vw, frameH: vh }, aRadius, radius, s, o.rollSeed ?? wrestleSeed(o.total, dist, o.side))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const heroOpacity0 = hero.el ? hero.el.style.opacity : '';
  const heroUnit = 1 / (aRect.inv || 1);
  const foeUnit = 1 / (dRect.inv || 1);
  const heroInCam = !!(cameraEl && hero.el && cameraEl.contains(hero.el));
  const foeInCam = !!(cameraEl && foe.el && cameraEl.contains(foe.el));
  const zClass = o.side === 'opp' ? 'duel-attacker-opp' : 'duel-attacker-player';
  const lift = !reduced && !local && !!hero.el && !!doc;
  let lifted = false;
  // The socket shades: each portrait's is off from the moment it leaves its socket until just before it is home.
  const shade = new SocketShade(reduced || local ? null : doc);
  const strikerSide: 'player' | 'opp' = o.side === 'opp' ? 'opp' : 'player';
  const victimSide: 'player' | 'opp' = o.side === 'opp' ? 'player' : 'opp';
  const victimAwayAt = plan.kind === 'chop' ? (plan.variant === 1 ? plan.impactAt : Infinity) : plan.kind === 'slam' ? plan.liftAt! : plan.gripAt;

  const cue: AttackVoices['cue'] = (clip, gain, rate, opts) => voices.cue(clip, gain, rate, opts);
  voices.warm([
    c.sfxWhooshClip, c.sfxChopClip, c.sfxSlamClip, c.sfxBoomClip, c.sfxBellClip, c.sfxWooClip, c.sfxCheerClip, c.sfxThudClip, c.sfxRopeClip, c.sfxSlapClip,
    c.sfxRoarClip, c.sfxOohClip, c.sfxVoiceClip, c.sfxChairClip, c.sfxBigClip, c.sfxFlashClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const whoosh = (gain: number, rate: number, lenMs = 420): void => cue(c.sfxWhooshClip, c.sfxWhooshGain * gain, c.sfxWhooshRate * rate, { lenMs, fadeMs: lenMs * 0.4 });
  /** A body on the mat: the canvas slap (`slam`) over the deep hollow thump of the ring (`thud`). `k` = how heavy. */
  const matHit = (k: number, rate = 1): void => {
    cue(c.sfxSlamClip, c.sfxSlamGain * k, c.sfxSlamRate * rate);
    cue(c.sfxThudClip, c.sfxThudGain * k, c.sfxThudRate * rate * 0.94);
  };
  const boom = (k: number, rate = 1, lenMs = 900): void => cue(c.sfxBoomClip, c.sfxBoomGain * k, c.sfxBoomRate * rate, { lenMs, fadeMs: lenMs * 0.4, tail: 0.1 });
  /**
   * The crowd drawing breath through a held beat: an "ooh" that swells for `ms` (the wait before the hit), then cuts.
   * The clip is loudest between about 1.0 and 1.8 s in, so it is entered late enough that its loudest part ends on the hit.
   */
  const swell = (k: number, ms: number): void => cue(c.sfxOohClip, c.sfxOohGain * k, c.sfxOohRate, { startMs: Math.min(1100, Math.max(200, 1750 - real(ms))), lenMs: real(ms) + 180, fadeMs: 180 });
  const crowd = (k: number, delay: number, lenMs = 1700): void => cue(c.sfxCheerClip, c.sfxCheerGain * k, c.sfxCheerRate, { delayMs: real(delay), startMs: 420, lenMs, fadeMs: lenMs * 0.45 });
  const woo = (k: number, delay: number, rate = 1): void => cue(c.sfxWooClip, c.sfxWooGain * k, c.sfxWooRate * rate, { delayMs: real(delay) });
  const foeAt = (t: number): Pt => { const p = victim(t); return { x: o.defender.x + p.x, y: o.defender.y + p.y }; };
  const flashK = c.flash;
  // I: the hand print goes on the side of the struck portrait AWAY from the shared hit number (which is nudged from the
  // portrait toward the middle of the frame), so the number never covers it.
  const awayLen = Math.hypot(o.defender.x - vw / 2, o.defender.y - vh / 2) || 1;
  // Kept on screen (the struck portrait is usually in a corner), and it outlasts the number.
  const pm = radius * 0.8;
  const printAt: Pt = {
    x: Math.min(Math.max(o.defender.x + ((o.defender.x - vw / 2) / awayLen) * radius * 0.36, Math.min(pm, vw / 2)), Math.max(vw - pm, vw / 2)),
    y: Math.min(Math.max(o.defender.y + ((o.defender.y - vh / 2) / awayLen) * radius * 0.36, Math.min(pm, vh / 2)), Math.max(vh - pm, vh / 2)),
  };

  const flashes = (n: number, ms: number): void => {
    if (c.crowdFlashes <= 0) return;
    scene?.crowdFlashes(n * c.crowdFlashes, ms);
    cue(c.sfxFlashClip, c.sfxFlashGain * Math.min(1.5, 0.5 + n / 16), c.sfxFlashRate, { lenMs: Math.min(1700, real(ms) + 400), fadeMs: 300 });
  };
  /** A HEAVY body on the mat: the canvas slap and the ring's thud, the deep slam with its sub under them, and the boom. */
  const bigHit = (k: number, rate = 1): void => {
    matHit(k, rate);
    cue(c.sfxBigClip, c.sfxBigGain * k, c.sfxBigRate * rate);
  };

  const fire = (q: WrestleCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    const onMat = { x: geo.mat.x, y: geo.mat.y };
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        if (lift && !lifted) { doc!.body.classList.add(zClass); lifted = true; }
        break;
      case 'walk':
        whoosh(0.8, 0.8, 500);
        // Tier 4: the ring stands up (the ropes creak taut), the bell rings it in, the crowd is already on its feet.
        if (plan.kind === 'pin') {
          cue(c.sfxRopeClip, c.sfxRopeGain * 0.5, c.sfxRopeRate * 1.3, { lenMs: 520, fadeMs: 260 });
          cue(c.sfxBellClip, c.sfxBellGain * 0.6, c.sfxBellRate, { delayMs: real(120), lenMs: 700, fadeMs: 300 });
          crowd(0.8, 60, 1500);
          flashes(8, 600);
        }
        break;
      case 'grip':
        // They lock up (two bodies meeting). The chop has no lock-up: it winds up instead (a low rising whoosh).
        if (plan.kind === 'chop') {
          if (plan.variant === 1) { whoosh(0.8, 0.6, c.chopWindMs + 60); swell(0.7, plan.impactAt - t); }
          else whoosh(0.7, 0.75, c.chairRiseMs + 80);
        } else {
          cue(c.sfxSlamClip, c.sfxSlamGain * 0.3, c.sfxSlamRate * 1.9, { lenMs: 160, fadeMs: 80 });
          cue(c.sfxThudClip, c.sfxThudGain * 0.3, c.sfxThudRate * 1.35, { lenMs: 260, fadeMs: 140 });
        }
        break;
      case 'chair':
        // The chair is up: a clank of metal, and the crowd sees it ("ooh") all the way to the hit.
        cue(c.sfxChairClip, c.sfxChairGain * 0.3, c.sfxChairRate * 1.5, { lenMs: 220, fadeMs: 120 });
        swell(1, plan.impactAt - t);
        whoosh(0.8, 0.7, c.chairWindMs);
        break;
      case 'swing':
        whoosh(1.3, plan.variant === 2 ? 1.1 : 1.5, 260);
        if (plan.variant === 1) scene?.slapArc({ x: (geo.grab.x + o.defender.x) / 2 + sd * radius * 0.2, y: o.defender.y }, -sd, radius);
        break;
      case 'lift':
        // Up it goes: a long low whoosh, and the crowd draws breath all the way to the slam.
        whoosh(1.1, 0.68, 560);
        swell(1, plan.impactAt - t);
        break;
      case 'top':
        // Caught at the top: the weight settles (a dull knock); the airplane spin whooshes round and round.
        cue(c.sfxThudClip, c.sfxThudGain * 0.22, c.sfxThudRate * 1.5, { lenMs: 220, fadeMs: 120 });
        if (plan.variant === 1 && c.spinTurns > 0) {
          const per = (c.hangMs - 260) / Math.max(1, Math.round(c.spinTurns));
          for (let i = 0; i < Math.round(c.spinTurns); i++) cue(c.sfxWhooshClip, c.sfxWhooshGain * (0.7 + 0.15 * i), c.sfxWhooshRate * (0.8 + 0.12 * i), { delayMs: real(60 + per * (i + 0.3)), lenMs: 300, fadeMs: 140 });
          woo(0.6, c.hangMs * 0.5, 1.05);
        } else {
          woo(0.5, c.hangMs * 0.4, 0.9);
        }
        break;
      case 'drop':
        whoosh(1.5, 1.3, 260);
        break;
      case 'bounce':
        matHit(0.42, 1.3);
        scene?.matRing(onMat, radius, 0.7, 1);
        break;
      case 'down':
        // Tier 3: shoved flat on its back (a tick), the turnbuckle rises, the striker climbs (a hop and a thud each).
        matHit(0.55, 1.18);
        scene?.matRing(onMat, radius, 0.8, 2);
        for (let i = 0; i < CLIMB_HOPS; i++) {
          cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.6, c.sfxWhooshRate * (1 + 0.12 * i), { delayMs: real((c.climbMs * i) / CLIMB_HOPS), lenMs: 220, fadeMs: 100 });
          cue(c.sfxThudClip, c.sfxThudGain * 0.3, c.sfxThudRate * (1.4 + 0.08 * i), { delayMs: real((c.climbMs * (i + 1)) / CLIMB_HOPS), lenMs: 220, fadeMs: 110 });
        }
        break;
      case 'perch':
        // Up top: the spotlight snaps on, the crowd goes wild, every camera in the house goes off.
        cue(c.sfxSlapClip, c.sfxSlapGain * 0.6, c.sfxSlapRate * 1.8, { lenMs: 160, fadeMs: 80 });
        woo(1.1, 60, 1.05);
        cue(c.sfxRoarClip, c.sfxRoarGain * 0.55, c.sfxRoarRate, { delayMs: real(200), lenMs: real(c.perchMs), fadeMs: 300 });
        flashes(14, c.perchMs * 0.8);
        break;
      case 'dive':
        whoosh(1.7, 0.9, 420);
        swell(0.8, plan.impactAt - t);
        break;
      case 'whip':
        whoosh(1.4, 1.2, 420);
        scene?.rush(foeAt(t), sd, radius);
        break;
      case 'rope':
        // The far ropes take it (a tick): they creak out to full stretch, and the crowd draws breath.
        cue(c.sfxRopeClip, c.sfxRopeGain, c.sfxRopeRate);
        cue(c.sfxThudClip, c.sfxThudGain * 0.4, c.sfxThudRate * 1.25, { lenMs: 300, fadeMs: 160 });
        swell(0.9, plan.impactAt - t);
        scene?.ropeTwang(geo.ropeHit, sd);
        break;
      case 'fling':
        // Snapped back off them.
        whoosh(1.6, 1.45, 320);
        cue(c.sfxRopeClip, c.sfxRopeGain * 0.8, c.sfxRopeRate * 1.6, { lenMs: 300, fadeMs: 160 });
        scene?.rush(geo.ropeHit, -sd, radius);
        scene?.ropeTwang(geo.ropeMax, sd);
        break;
      case 'land':
        // Flat on its back on the mat (a tick, but the second heaviest thing in the attack).
        bigHit(1.05, 0.95);
        boom(0.8, 1, 800);
        scene?.matShock(onMat, radius, plan.burst * 0.85, 2);
        scene?.flash(onMat, flashK * 0.6);
        break;
      case 'exit':
        // The cutter: the striker is gone off the screen. The ropes it ran through twang; the crowd murmurs.
        cue(c.sfxRopeClip, c.sfxRopeGain * 0.6, c.sfxRopeRate * 1.4, { lenMs: 300, fadeMs: 150 });
        // The crowd's murmur rises under the whole stagger, the voice yelling over it, until the leap.
        swell(0.8, (plan.leapAt ?? t) - t);
        break;
      case 'voice':
        // "Watch out! Watch out! Watch out!" (its third shout lands on the leap).
        cue(c.sfxVoiceClip, c.sfxVoiceGain, c.sfxVoiceRate);
        break;
      case 'leap':
        // Out of nowhere: a whoosh in from the edge, streaks, the crowd's gasp.
        whoosh(1.8, 0.95, 420);
        cue(c.sfxWooClip, c.sfxWooGain * 0.9, c.sfxWooRate * 1.1, { delayMs: real(80), lenMs: 500, fadeMs: 200 });
        scene?.flyBy(geo.entry.x < o.defender.x ? { x: frame.x0 + aRadius * 0.6, y: geo.entry.y } : { x: frame.x1 - aRadius * 0.6, y: geo.entry.y }, -sd, aRadius);
        break;
      case 'catch':
        whoosh(1.2, 1.4, 200);
        break;
      case 'hop':
        whoosh(1.1, 0.9, 360);
        break;
      case 'cover':
        // It drops on top for the pin.
        matHit(0.8, 1.12);
        // The crowd is on its feet through the count.
        crowd(0.9, 60, 1700);
        scene?.matRing(onMat, radius, 0.9, 2);
        break;
      case 'count': {
        // ONE, TWO, THREE: the number slams down, the mat is slapped, the crowd counts along, each louder than the last.
        cue(c.sfxSlapClip, c.sfxSlapGain * (1 + 0.15 * q.i), c.sfxSlapRate);
        cue(c.sfxChopClip, c.sfxChopGain * (0.45 + 0.1 * q.i), c.sfxChopRate * 1.25);
        cue(c.sfxThudClip, c.sfxThudGain * (0.4 + 0.1 * q.i), c.sfxThudRate * 1.4, { lenMs: 300, fadeMs: 150 });
        cue(c.sfxWooClip, c.sfxWooGain * (0.5 + 0.25 * q.i), c.sfxWooRate * (0.94 + 0.05 * q.i), { delayMs: real(40), lenMs: 420, fadeMs: 200 });
        scene?.count(geo.count, q.i);
        scene?.matSlap({ x: geo.mat.x + sd * radius * 1.25, y: geo.mat.y + radius * 0.55 }, radius, 1 + 0.2 * q.i);
        flashes(3 + 2 * q.i, 260);
        break;
      }
      case 'bell':
        // DING DING DING: it is over, and the crowd loses its mind.
        cue(c.sfxBellClip, c.sfxBellGain, c.sfxBellRate);
        cue(c.sfxRoarClip, c.sfxRoarGain, c.sfxRoarRate, { delayMs: real(90) });
        crowd(1.1, 200, 2600);
        flashes(24, 900);
        scene?.bell({ x: geo.count.x, y: geo.count.y }, radius);
        scene?.winner(geo.win, aRadius, plan.burst);
        break;
      case 'impact': {
        if (plan.kind === 'chop' && plan.variant === 2) {
          // THE CHAIR SHOT: a hollow steel crash with a body under it, BONK, the chair bursting into light.
          cue(c.sfxChairClip, c.sfxChairGain, c.sfxChairRate);
          cue(c.sfxThudClip, c.sfxThudGain * 0.8, c.sfxThudRate * 1.2, { lenMs: 320, fadeMs: 160 });
          woo(1.3, 120, 0.95);
          crowd(0.7, 260, 1300);
          const ch = wrestleChair(ctx, plan.impactAt);
          const head = { x: ch.x, y: ch.y };
          scene?.chairBurst(head, radius, plan.burst);
          scene?.wallop(head, radius, plan.burst * 0.8);
          // BONK goes on the open side, over the striker (the struck one is usually tucked in a corner).
          scene?.word('bonk', { x: geo.grab.x + sd * aRadius * 1.4, y: geo.grab.y - aRadius * 0.7 }, plan.burst, sd * 0.12, 820, 1.2);
          flashes(6, 500);
        } else if (plan.kind === 'chop') {
          // THE CHOP: a flat smack with a body under it, the hand print, and the crowd's "WOO".
          cue(c.sfxChopClip, c.sfxChopGain * 1.4, c.sfxChopRate);
          cue(c.sfxThudClip, c.sfxThudGain * 0.9, c.sfxThudRate * 1.25, { lenMs: 320, fadeMs: 160 });
          woo(1.4, 110);
          crowd(0.6, 260, 1200);
          scene?.chop(o.defender, printAt, -sd, plan.burst, plan.rings);
          scene?.word('woo', { x: geo.grab.x + sd * aRadius * 1.5, y: geo.grab.y - aRadius * 0.55 }, plan.burst, sd * 0.1, 760);
          flashes(5, 500);
        } else if (plan.kind === 'slam') {
          // THE BODY SLAM (or THE SUPLEX).
          bigHit(1, plan.variant === 2 ? 0.92 : 1);
          boom(0.9, 1, 800);
          woo(1, 140, 0.94);
          crowd(1, 220, 1500);
          scene?.wallop({ x: geo.mat.x, y: geo.mat.y + radius * 0.45 }, radius, plan.burst);
          scene?.matShock(onMat, radius, plan.burst, plan.rings);
          scene?.flash(onMat, flashK * 0.75);
          scene?.word('slam', { x: geo.stand.x + sd * aRadius * 1.5, y: geo.stand.y - aRadius * 0.9 }, plan.burst, sd * 0.08, 900, 1.25);
          flashes(10, 700);
        } else if (plan.kind === 'elbow') {
          // THE ELBOW DROP or THE SPLASH: the heaviest hit of the first three tiers.
          bigHit(1.2, plan.variant === 2 ? 0.85 : 0.9);
          boom(1.15, 0.95, 1000);
          cue(c.sfxChopClip, c.sfxChopGain * 0.55, c.sfxChopRate * 0.8);
          woo(0.9, 100, 0.92);
          cue(c.sfxRoarClip, c.sfxRoarGain, c.sfxRoarRate, { delayMs: real(130), lenMs: 2200, fadeMs: 900 });
          scene?.wallop({ x: geo.mat.x, y: geo.mat.y + radius * 0.45 }, radius, plan.burst);
          scene?.matShock(onMat, radius, plan.burst * (plan.variant === 2 ? 1.2 : 1), plan.rings);
          scene?.flash(onMat, flashK);
          if (plan.variant === 2) scene?.word('splash', { x: geo.mat.x + sd * radius * 1.6, y: geo.mat.y - radius * 1.3 }, plan.burst, sd * 0.1, 950, 1.3);
          flashes(16, 900);
        } else if (plan.variant === 2) {
          // THE JUMPING CUTTER: driven into the mat out of nowhere.
          bigHit(1.3, 0.85);
          boom(1.2, 0.95, 1000);
          cue(c.sfxChopClip, c.sfxChopGain, c.sfxChopRate * 0.75);
          cue(c.sfxRoarClip, c.sfxRoarGain * 1.1, c.sfxRoarRate, { delayMs: real(80), lenMs: 2400, fadeMs: 900 });
          crowd(1, 200, 1800);
          scene?.wallop({ x: geo.mat.x, y: geo.mat.y }, radius, plan.burst * 1.15);
          scene?.matShock(onMat, radius, plan.burst, plan.rings);
          scene?.flash(onMat, flashK);
          flashes(20, 900);
        } else {
          // THE CLOTHESLINE: the hardest single blow in the attack.
          cue(c.sfxChopClip, c.sfxChopGain * 1.2, c.sfxChopRate * 0.82);
          cue(c.sfxThudClip, c.sfxThudGain * 1.2, c.sfxThudRate * 0.95);
          cue(c.sfxBigClip, c.sfxBigGain * 0.7, c.sfxBigRate * 1.1);
          boom(1.05, 1.1, 800);
          woo(1.1, 110, 0.9);
          crowd(1, 200, 1600);
          const at = { x: (geo.meet.x + geo.block.x) / 2 + sd * radius * 0.2, y: geo.meet.y - radius * 0.1 };
          scene?.slapArc(at, sd, radius, 1.6);
          scene?.wallop(at, radius, plan.burst * 1.15);
          scene?.flash(at, flashK);
          whoosh(1, 0.9, 400);
          flashes(12, 700);
        }
        seq.land();
        break;
      }
      default:
        break;
    }
  };

  let lastStep = -Infinity;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.walkAt, plan.impactAt + 300);
    // THE CAMERA: the framing (zooms and pans, clamped so no edge of the board shows), times the punch, plus the shake.
    const cm = wrestleCameraAt(plan, c, t, blowDir);
    const view = wrestleView(shots, t, o.defender);
    const zoom = view.zoom * cm.zoom;
    const ft = wrestleFrameTransform(zoom, view.lx, view.ly, view.pan, frame, c.pan);
    const unitS = local ? 1 : s;
    cam.apply(ORIGIN, zoom, ft.ax / unitS + cm.x, ft.ay / unitS + cm.y, unitS);
    // The camera's screen offset: a portrait OUTSIDE `#stage` folds it in by hand (so it stays glued to the scene).
    const ax = ft.ax + cm.x * unitS, ay = ft.ay + cm.y * unitS;
    const place = (at: Pt, off: Pt, inCam: boolean): Pt => (inCam || !cam.active
      ? off
      : { x: off.x * zoom + at.x * (zoom - 1) + ax, y: off.y * zoom + at.y * (zoom - 1) + ay });
    // The socket shades are off only while their portrait is out of its socket (two writes each, never per frame).
    const away = t < plan.homeEnd - 70;
    shade.set(strikerSide, away && t >= plan.walkAt + 50);
    shade.set(victimSide, away && t >= victimAwayAt);
    const hp = striker(t), fp = victim(t);
    if (hero.el) hero.set(poseCss(place(o.attacker, hp, heroInCam), hp, hp.scale * (heroInCam || !cam.active ? 1 : zoom), heroUnit));
    if (foe.el) foe.set(poseCss(place(o.defender, fp, foeInCam), fp, fp.scale * (foeInCam || !cam.active ? 1 : zoom), foeUnit));
    if (scene) {
      scene.setFoeOffset(fp.x, fp.y);
      if (plan.kind === 'pin') scene.setRing(sides, wrestleRing(ctx, t));
      else if (plan.kind === 'elbow') { scene.setSpot(wrestleSpot(ctx, t, frame.y0)); scene.setElbow(wrestleElbow(ctx, t)); scene.setPost(wrestlePost(ctx, t)); }
      else if (plan.kind === 'chop' && plan.variant === 2) scene.setChair(wrestleChair(ctx, t));
      if (plan.kind === 'slam' || plan.kind === 'elbow') { const sh = wrestleShadow(ctx, t); scene.setShadow(sh.at, sh.k); }
      scene.setDizzy(wrestleDizzy(ctx, t));
      // Footfalls on the walk in (three strides), and on the walk home.
      if (t >= plan.walkAt && t < plan.gripAt && t - lastStep >= (plan.gripAt - plan.walkAt) / 3) {
        scene.step({ x: o.attacker.x + hp.x, y: o.attacker.y + hp.y }, aRadius, geo.grab.x >= o.attacker.x ? -1 : 1);
        lastStep = t;
      }
    }
  };

  const seq: Sequence<WrestleCue | FormationCue> = new Sequence<WrestleCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck(); shade.restore();
      if (hero.el) hero.el.style.opacity = heroOpacity0;
      scene?.hideOwn();
      if (lifted) { doc!.body.classList.remove(zClass); lifted = false; }
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    variant: plan.variant,
    scene,
    striker,
    victim,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
