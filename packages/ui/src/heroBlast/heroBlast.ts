/**
 * THE BLAST RUNNER: plays one Blast hero attack (the beats are in `heroBlastConfig.ts`) and lands the consequence on
 * its impact beat. Presentation only: the total it shows and the blow it lands are handed in, already decided by the
 * engine; this file only decides WHEN on screen they happen.
 *
 * ONE CLOCK. The numbers (DOM), the camera, the two portraits, the Pixi scene and the sound cues all read one
 * sequence clock advanced per frame by `dt x speed`. The HIT-STOP holds that clock still for 60 to 90 ms on the
 * impact frame (everything freezes on the brightest frame), which is why the consequence, the flash and the damage
 * number can never drift apart, and why slow motion and `finish()` are exact.
 *
 * LAYERS (why here). The foe's portrait lives in a `#stage` portal that paints above everything inside `#root`, so FX
 * drawn on the in-root overlay land UNDER it. The Blast therefore draws its Pixi on the above-portrait slot, puts
 * its numbers in `#stage` (above the portraits), and moves the CAMERA on `#stage` itself (composed with the stage's
 * own scale), mirroring the same transform onto the Pixi root so the FX and the portraits zoom and shake as one.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock (plus the counter's
 * text when it changes); nothing reads layout after the opening measure (the caller passes points and radii); the
 * camera layer is promoted (`will-change`) only while it moves; Pixi sprites are pooled and the updater unhooks the
 * moment the scene drains. A safety timer finishes the sequence if frames stop (a hidden tab), so the blow lands.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { duckSfxBuses, getFxClipBuffer, playTailedClip, type SfxHandle } from '../sfx';
import { stageFit, stageScale, toStage } from '../stage';
import {
  blastCues, blastPlan, getHeroBlastConfig, hexToNum, type BlastCue, type BlastPlan, type HeroBlastConfig,
} from './heroBlastConfig';
import { HeroBlastScene, type HeroBlastTextures } from './heroBlastScene';
import { heroBlastTextures } from './heroBlastTextures';
import './heroBlast.css';

type Pt = { x: number; y: number };

export interface HeroBlastPart {
  value: number;
  /** Where the number flies from (its card, the hero). Null = it appears at the combine point. */
  from: Pt | null;
  /** The attacker's Tier (the leading term): captioned "Tier". Survivors are captioned "Minion". */
  base?: boolean;
}

export interface HeroBlastOptions {
  parts: readonly HeroBlastPart[];
  /** THE blow, as the engine decided it. */
  total: number;
  /** The parts summed past the round cap (the total reads "Max Damage"). */
  capped?: boolean;
  /** Whose blow: sets the colour language (yours gold, theirs red). */
  side?: 'player' | 'opp';
  /** Centres of the striking and the struck hero (screen px, or host px in `local` space). */
  attacker: Pt;
  defender: Pt;
  /** The struck portrait's radius (the white hit flash covers it). */
  defenderRadius?: number;
  /** Where the numbers merge. */
  combineAt: Pt;
  /** Playback speed (combat speed x the tuner's slow motion). */
  speed?: number;
  reduced?: boolean;
  cfg?: HeroBlastConfig;
  /** The consequence: fired exactly once, on the impact beat (or by `finish()` if it never got there). */
  onImpact: () => void;
  /** The sequence is over (not fired by `cancel()`). */
  onDone?: () => void;
  /** The portraits, for the charge swell / recoil and the hit squash / knockback (transform only; restored after). */
  attackerEl?: HTMLElement | null;
  defenderEl?: HTMLElement | null;
  // ── seams (tests, the Collection sandbox) ──
  frames?: (fn: (dtMs: number) => void) => () => void;
  mount?: (c: Container) => () => void;
  textures?: HeroBlastTextures | null;
  host?: HTMLElement | null;
  camera?: HTMLElement | null;
  sound?: boolean;
  safety?: boolean;
  /** `local`: every point is in the HOST's own px (a sandbox box), not screen px. */
  space?: 'screen' | 'local';
  /** Pixi size multiplier (default: the stage scale). A small sandbox box draws smaller. */
  pixiScale?: number;
}

export interface HeroBlastHandle {
  readonly plan: BlastPlan;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroBlastScene | null;
  /** Sequence ms elapsed (at speed; the hit-stop does not advance it). */
  elapsed(): number;
  readonly impacted: boolean;
  readonly done: boolean;
  /** Jump to the end: land the blow if it has not landed, clean up, fire onDone. */
  finish(): void;
  /** Stop and clean up WITHOUT landing (leaving the fight mid-sequence, as Classic's timers are cleared). */
  cancel(): void;
}

const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOutSine = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
/** Back-out: overshoot, then settle. */
const easeOutBack = (t: number, k = 2.2): number => { const x = clamp01(t) - 1; return 1 + (k + 1) * x * x * x + k * x * x; };
/** Back-in: a small pull away first (anticipation), then commit. */
const easeInBack = (t: number, k = 1.6): number => { const x = clamp01(t); return (k + 1) * x * x * x - k * x * x; };
/** A damped spring from 1 to 0: rings `hz` times a second and dies with time constant `tau` ms. */
const spring = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/** The quadratic arc a number flies on: bowed sideways by `arc` x the distance. */
function arcPoint(a: Pt, b: Pt, arc: number, t: number): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const c = { x: (a.x + b.x) / 2 + (-dy / d) * arc * d, y: (a.y + b.y) / 2 + (dx / d) * arc * d };
  const m = 1 - t;
  return { x: m * m * a.x + 2 * m * t * c.x + t * t * b.x, y: m * m * a.y + 2 * m * t * c.y + t * t * b.y };
}

/**
 * The camera at sequence time `t` (px in the space the points are in): a push toward the line of fire through the
 * charge (anticipation); a small punch on the slam; an instant punch-in on impact that decays exponentially
 * (overshoot, settle); and a DIRECTIONAL shake along the bolt's line (a damped spring, a fifth of it across), with
 * smaller kicks on each shot and each trailing hit. At `t === impactAt` the frame is already displaced along the
 * bolt, which is the frame the hit-stop holds. Pure, so it is tested directly.
 */
export function cameraAt(p: BlastPlan, c: HeroBlastConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const slam = t - p.mergeAt;
  if (slam >= 0 && slam < 260) z += 0.012 * Math.exp(-slam / 70);
  if (t >= p.chargeAt && t < p.impactAt) z += p.zoom * easeInOutSine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
  else if (t >= p.impactAt) {
    const since = t - p.impactAt;
    z += (p.zoom + p.punch) * Math.exp(-since / Math.max(1, c.zoomOutMs / 4));
  }
  const perp = { x: -dir.y, y: dir.x };
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => {
    const age = t - at;
    if (age < 0) return;
    const s = spring(age, hz, tau);
    const across = amp * 0.2 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += dir.x * amp * s + perp.x * across;
    y += dir.y * amp * s + perp.y * across;
  };
  p.bolts.forEach((b) => kick(b.fireAt, -p.shakePx * 0.18, 45, 14));
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16);
  p.bolts.slice(1).forEach((b) => kick(b.arriveAt, p.shakePx * 0.35, 40, 18));
  p.booms.forEach((at) => kick(at, p.shakePx * 0.3, 45, 18));
  // The beam holds with a low rumble (across and along), fading as it thins out.
  if (p.beam && t > p.impactAt && t < p.impactAt + c.beamHoldMs + 200) {
    const age = t - p.impactAt;
    const r = p.shakePx * 0.22 * (age < c.beamHoldMs ? 1 : 1 - (age - c.beamHoldMs) / 200);
    x += perp.x * r * Math.sin(age * 0.21) + dir.x * r * 0.5 * Math.sin(age * 0.33);
    y += perp.y * r * Math.sin(age * 0.21) + dir.y * r * 0.5 * Math.sin(age * 0.33);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera pushes in: anchored on the ATTACKER through the charge (the world gathers around the hero), panning
 * with the bolt in flight, and anchored on the DEFENDER from the impact on. A zoom anchored on a point keeps that point
 * still, so the struck hero never gets pushed off the edge of the screen by the punch-in (the midpoint did that: both
 * portraits sit near corners). Pure.
 */
export function cameraFocus(p: BlastPlan, t: number, a: Pt, d: Pt): Pt {
  if (t <= p.fireAt) return a;
  if (t >= p.impactAt) return d;
  const u = (t - p.fireAt) / Math.max(1, p.impactAt - p.fireAt);
  const e = 0.3 * u + 0.7 * u * u; // follows the lead bolt (the scene's boltEase)
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}

function reducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Play the Blast. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroBlast(o: HeroBlastOptions): HeroBlastHandle {
  const c = o.cfg ?? getHeroBlastConfig();
  const reduced = o.reduced ?? reducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const dir = { x: (o.defender.x - o.attacker.x) / (dist || 1), y: (o.defender.y - o.attacker.y) / (dist || 1) };
  const plan = blastPlan({ values: o.parts.map((p) => p.value), total: o.total, distance: dist, reduced }, c);
  const cues = blastCues(plan);
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  /** Screen (or host-local) px -> the CSS px written into a positioned element. */
  const css = (v: number): number => (local ? v : toStage(v));
  const doc = typeof document !== 'undefined' ? document : null;

  // ── DOM: the numbers ──
  // They sit in a TOP-LEVEL layer (a child of <body>, above the Pixi overlay) so no flash, beam or portrait can ever
  // cover them: readability first. It carries the stage's own scale, so its children are laid out in stage px.
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const layer = host && doc ? doc.createElement('div') : null;
  const chips: HTMLDivElement[] = [];
  let dimEl: HTMLDivElement | null = null;
  let hitEl: HTMLDivElement | null = null;
  let totalEl: HTMLDivElement | null = null, totalNum: HTMLDivElement | null = null, totalLbl: HTMLDivElement | null = null, totalFlash: HTMLDivElement | null = null;
  const place = (el: HTMLElement, p: Pt): void => { el.style.left = `${css(p.x)}px`; el.style.top = `${css(p.y)}px`; };
  if (layer && host && doc) {
    layer.className = `hblast${local ? ' local' : ''}${o.side === 'opp' ? ' foe' : ''}`;
    layer.setAttribute('aria-hidden', 'true');
    if (!local && typeof window !== 'undefined') {
      const fit = stageFit();
      if (fit.s !== 1) { layer.style.width = `${fit.lw}px`; layer.style.height = `${fit.lh}px`; layer.style.transform = `scale(${fit.s})`; }
    }
    layer.style.setProperty('--hb-side', sideHex);
    layer.style.setProperty('--hb-chip', `${c.chipSize * (local ? 0.42 : 1)}px`);
    layer.style.setProperty('--hb-total', `${c.totalSize * (local ? 0.38 : 1)}px`);
    if (plan.dim > 0 && !local) {
      // The big tiers dim everything but the two heroes: a static mask with two clear spotlights (set once, never
      // animated), faded in and out by OPACITY only. It lives in `#stage` (under the Pixi light, over the board).
      dimEl = doc.createElement('div');
      dimEl.className = 'hblast-dim';
      const r = Math.max(90, (o.defenderRadius ?? 120) * 1.25);
      const PAD = 80; // stage px of overscan, so the shake never reveals an undimmed edge
      const vw = typeof window !== 'undefined' ? stageFit().lw : 1920, vh = typeof window !== 'undefined' ? stageFit().lh : 1080;
      dimEl.style.left = `${-PAD}px`; dimEl.style.top = `${-PAD}px`; dimEl.style.width = `${vw + 2 * PAD}px`; dimEl.style.height = `${vh + 2 * PAD}px`;
      const hole = (p: Pt): string => `radial-gradient(circle at ${(css(p.x) + PAD).toFixed(0)}px ${(css(p.y) + PAD).toFixed(0)}px, transparent ${css(r).toFixed(0)}px, #000 ${css(r * 1.7).toFixed(0)}px)`;
      const mask = `${hole(o.attacker)}, ${hole(o.defender)}`;
      dimEl.style.setProperty('mask-image', mask);
      dimEl.style.setProperty('-webkit-mask-image', mask);
      dimEl.style.opacity = '0';
      (doc.getElementById('stage') ?? layer).appendChild(dimEl);
    }
    o.parts.forEach((p) => {
      const el = doc.createElement('div');
      el.className = `hblast-chip${p.base ? ' base' : ''}`;
      const n = doc.createElement('b'); n.textContent = `+${Math.max(0, Math.round(p.value))}`;
      const cap = doc.createElement('i'); cap.textContent = p.base ? 'Tier' : 'Minion';
      el.append(n, cap);
      place(el, p.from ?? o.combineAt);
      el.style.opacity = '0';
      layer.appendChild(el);
      chips.push(el);
    });
    totalEl = doc.createElement('div');
    totalEl.className = 'hblast-total';
    totalNum = doc.createElement('div'); totalNum.className = 'hblast-total-n'; totalNum.textContent = '0';
    totalFlash = doc.createElement('div'); totalFlash.className = 'hblast-total-n hblast-total-flash'; totalFlash.textContent = String(plan.total);
    totalLbl = doc.createElement('div'); totalLbl.className = 'hblast-total-l'; totalLbl.textContent = 'Damage';
    totalEl.append(totalNum, totalFlash, totalLbl);
    totalFlash.style.opacity = '0';
    place(totalEl, o.combineAt);
    totalEl.style.opacity = '0';
    layer.appendChild(totalEl);
    // THE HIT NUMBER: the blow, big and outlined, punched onto the struck hero on the impact frame (above every flash).
    hitEl = doc.createElement('div');
    hitEl.className = 'hblast-hit';
    hitEl.textContent = `-${plan.total}`;
    // Nudged from the hero's centre toward the middle of the screen (the heroes sit near corners), and kept inside
    // the viewport so the punch-in never clips off an edge.
    const vw = local ? (host.clientWidth || 300) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
    const vh = local ? (host.clientHeight || 180) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
    const toC = { x: vw / 2 - o.defender.x, y: vh / 2 - o.defender.y };
    const tl = Math.hypot(toC.x, toC.y) || 1;
    const rr = (o.defenderRadius ?? 100) * 0.55;
    const m = (local ? 0.1 : 0.09) * Math.min(vw, vh) + c.totalSize * 0.5 * (local ? 0.38 : s);
    const hitAt = {
      x: Math.min(vw - m * 1.4, Math.max(m * 1.4, o.defender.x + (toC.x / tl) * rr)),
      y: Math.min(vh - m, Math.max(m, o.defender.y + (toC.y / tl) * rr)),
    };
    place(hitEl, hitAt);
    hitEl.style.opacity = '0';
    layer.appendChild(hitEl);
    host.appendChild(layer);
  }

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the charge) ──
  const textures = o.textures !== undefined ? o.textures : heroBlastTextures();
  const scene = textures && !reduced
    ? new HeroBlastScene(textures, { core: hexToNum(c.colorCore), side: hexToNum(sideHex) }, s, c.trailLength)
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const camera = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  let cameraOn = false;
  let camBase = '';
  let camSaved: Record<string, string> | null = null;
  const CAM_PROPS = ['display', 'position', 'left', 'top', 'width', 'height', 'transform', 'transform-origin', 'will-change'] as const;
  const heroEl = reduced ? null : (o.attackerEl ?? null);
  const heroPrev = heroEl ? heroEl.style.transform : '';
  const foeEl = reduced ? null : (o.defenderEl ?? null);
  const foePrev = foeEl ? foeEl.style.transform : '';
  const radius = o.defenderRadius ?? 120 * s;

  let t = 0;
  let stopLeft = 0;
  let cueIdx = 0;
  let impacted = false;
  let done = false;
  let ended = false;
  let lastCount = -1;
  let lastArriveAt = -1;
  let arrivedN = 0;
  let unhook: (() => void) | null = null;
  let safety = 0;
  let ducked = false;
  const voices: SfxHandle[] = [];

  interface CueOpts { tail?: number; lenMs?: number; fadeMs?: number; startMs?: number; delayMs?: number }
  const cue = (clip: string, gain: number, rate: number, opts: CueOpts = {}): void => {
    if (!sound || !clip || !(gain > 0)) return;
    const tail = opts.tail ?? 0;
    const h = playTailedClip(clip, 'attack', {
      gain, rate, startMs: opts.startMs, lenMs: opts.lenMs, delayMs: opts.delayMs,
      tail: { fadeOutMs: opts.fadeMs ?? 0, reverbMix: tail, reverbSec: tail > 0 ? 0.6 : 0 },
    });
    if (h) voices.push(h);
  };
  // Warm every clip now, so the first cue of a session is not the one that has to wait for its decode.
  if (sound) for (const k of ['sfxGatherClip', 'sfxTickClip', 'sfxSlamClip', 'sfxChargeClip', 'sfxFireClip', 'sfxBeamClip', 'sfxImpactClip', 'sfxThumpClip', 'sfxBigClip', 'sfxBoomClip'] as const) {
    try { if (c[k]) getFxClipBuffer(c[k]); } catch { /* no audio here */ }
  }
  /** The riser, placed so its climax lands exactly on the release: its tail when it is longer than the charge, a
   *  delayed start when shorter. */
  const riser = (): void => {
    const buf = (() => { try { return getFxClipBuffer(c.sfxChargeClip); } catch { return null; } })();
    const chargeReal = (plan.fireAt - plan.chargeAt) / speed;
    const r = c.sfxChargeRate > 0 ? c.sfxChargeRate : 1;
    if (!buf) { cue(c.sfxChargeClip, c.sfxChargeGain, r); return; }
    const clipMs = buf.duration * 1000;
    const heard = chargeReal * r; // clip-time consumed over the charge
    if (clipMs > heard) cue(c.sfxChargeClip, c.sfxChargeGain, r, { startMs: clipMs - heard });
    else cue(c.sfxChargeClip, c.sfxChargeGain, r, { delayMs: chargeReal - clipMs / r });
  };

  const land = (): void => { if (impacted) return; impacted = true; o.onImpact(); };

  const startCamera = (): void => {
    if (!camera || cameraOn || !doc) return;
    camSaved = Object.fromEntries(CAM_PROPS.map((k) => [k, camera.style.getPropertyValue(k)]));
    camBase = camera.style.transform || '';
    // `#stage` is `display: contents` on an unscaled screen (no box to transform): give it the same fixed full-screen
    // box the scaled stage already has, for the few hundred ms the camera moves. Same layout, so nothing reflows.
    try {
      if (getComputedStyle(camera).display === 'contents') {
        camera.style.display = 'block'; camera.style.position = 'fixed'; camera.style.left = '0'; camera.style.top = '0';
        camera.style.width = '100%'; camera.style.height = '100%';
      }
    } catch { /* no layout engine: fine */ }
    camera.style.transformOrigin = '0 0';
    camera.style.willChange = 'transform';
    cameraOn = true;
  };
  const resetCamera = (): void => {
    scene?.setCamera(0, 0, 1);
    if (!camera || !cameraOn || !camSaved) return;
    for (const k of CAM_PROPS) { const v = camSaved[k]; if (v) camera.style.setProperty(k, v); else camera.style.removeProperty(k); }
    cameraOn = false;
  };
  const resetPortraits = (): void => { if (heroEl) heroEl.style.transform = heroPrev; if (foeEl) foeEl.style.transform = foePrev; };
  const unduck = (): void => { if (ducked) { duckSfxBuses(1); ducked = false; } };
  const teardownDom = (): void => { layer?.remove(); dimEl?.remove(); resetCamera(); resetPortraits(); unduck(); };
  const teardownPixi = (): void => {
    unhook?.(); unhook = null;
    if (scene) { unmount?.(); scene.destroy(); }
  };

  const fire = (q: BlastCue): void => {
    switch (q.kind) {
      case 'launch':
        if (q.i === 0) cue(c.sfxGatherClip, c.sfxGatherGain, 1, { lenMs: 800, fadeMs: 250 });
        break;
      case 'arrive': {
        lastArriveAt = q.at;
        arrivedN = q.i + 1;
        // Balatro: every landing ticks the total with its own pop and a pitch step up.
        if (!plan.reduced) cue(c.sfxTickClip, c.sfxTickGain, c.sfxTickRate + q.i * c.sfxTickStep, { lenMs: c.sfxTickLenMs, fadeMs: 140 });
        if (q.i < plan.arrivals.length - 1) scene?.mergeTick(o.combineAt.x, o.combineAt.y, q.i);
        break;
      }
      case 'merge':
        lastArriveAt = q.at;
        cue(c.sfxSlamClip, c.sfxSlamGain, c.sfxSlamRate);
        scene?.mergeSlam(o.combineAt.x, o.combineAt.y);
        break;
      case 'charge':
        riser();
        if (sound && c.sfxDuck < 1) { duckSfxBuses(c.sfxDuck, 'combat'); ducked = true; }
        scene?.startCharge(o.attacker.x, o.attacker.y, plan.fireAt - plan.chargeAt, 0.9 + 0.6 * plan.k, plan.motes);
        startCamera();
        break;
      case 'fire': {
        const b = plan.bolts[q.i]!;
        if (plan.beam) {
          cue(c.sfxFireClip, c.sfxFireGain, c.sfxFireRate * 0.9);
          cue(c.sfxBeamClip, c.sfxBeamGain, c.sfxBeamRate);
          scene?.beam(o.attacker, o.defender, b.travelMs, c.beamHoldMs, b.size, t - q.at);
        } else {
          if (q.i === 0) cue(c.sfxFireClip, c.sfxFireGain, c.sfxFireRate);
          scene?.fire(o.attacker, o.defender, b.travelMs, b.size, b.curve, t - q.at);
        }
        break;
      }
      case 'impact':
        cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
        cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 600, fadeMs: 200 });
        if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
        scene?.impact(o.defender.x, o.defender.y, dir, plan.k, plan.flashScale, c.flashAlpha, plan.sparks, radius, plan.tier);
        stopLeft = plan.hitStopMs;
        land();
        break;
      case 'hit': {
        const b = plan.bolts[q.i]!;
        const j = 26 * s;
        scene?.hit(o.defender.x + (Math.random() - 0.5) * j, o.defender.y + (Math.random() - 0.5) * j, dir, b.size);
        break;
      }
      case 'boom': {
        // Secondary explosions ring the struck hero, alternating sides, each a little higher in pitch.
        const a = (q.i * 2.4) + Math.atan2(dir.y, dir.x);
        const rr = radius * (0.55 + 0.2 * (q.i % 2));
        cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate + q.i * 0.06, { lenMs: c.sfxBoomLenMs, fadeMs: 260 });
        scene?.boom(o.defender.x + Math.cos(a) * rr, o.defender.y + Math.sin(a) * rr, 0.8 + 0.15 * plan.tier);
        break;
      }
      case 'end':
        ended = true;
        break;
      default:
        break;
    }
  };

  /** Write the DOM for sequence time `t`: transform/opacity only (and the counter's text when it changes). */
  const paintDom = (): void => {
    if (plan.reduced) {
      const f = Math.max(1, c.reducedFadeMs);
      const out = t >= plan.impactAt ? clamp01((t - plan.impactAt) / f) : 0;
      chips.forEach((el) => {
        el.style.opacity = String(clamp01(t / f) * (1 - clamp01((t - plan.mergeAt) / f)));
        el.style.transform = 'translate(-50%, -50%)';
      });
      if (totalEl && totalNum && totalLbl) {
        totalEl.style.opacity = String(clamp01((t - plan.mergeAt) / f) * (1 - out));
        totalEl.style.transform = 'translate(-50%, -50%)';
        if (lastCount !== plan.total) { totalNum.textContent = String(plan.total); lastCount = plan.total; totalLbl.textContent = plan.capped ? 'Max Damage' : 'Damage'; }
      }
      return;
    }
    o.parts.forEach((p, i) => {
      const el = chips[i];
      if (!el) return;
      const from = p.from ?? o.combineAt;
      const sp = plan.spawns[i]!, la = plan.launches[i]!, ar = plan.arrivals[i]!;
      if (t < sp || t >= ar) { el.style.opacity = '0'; return; }
      let pos = from, sc = 1, op = 1;
      if (t < la) {
        const u = (t - sp) / Math.max(1, la - sp);
        sc = 0.2 + 0.8 * easeOutBack(Math.min(1, u * 1.6)); op = clamp01(u * 4);
      } else {
        const u = (t - la) / Math.max(1, ar - la);
        const e = easeInBack(u, 1.6); // dips to about -0.09 at u = 0.43, then commits
        if (e < 0) {
          const dx = o.combineAt.x - from.x, dy = o.combineAt.y - from.y;
          const d = Math.hypot(dx, dy) || 1;
          const pull = (-e / 0.09) * c.combineBackPx * (local ? 0.45 : s);
          pos = { x: from.x - (dx / d) * pull, y: from.y - (dy / d) * pull };
          sc = 1 + 0.12 * (-e / 0.09);
        } else {
          pos = arcPoint(from, o.combineAt, c.combineArc, e);
          sc = 1 + 0.12 - 0.5 * e; // stretches out of the pull, shrinks as it is swallowed
        }
      }
      el.style.opacity = String(op);
      el.style.transform = `translate(-50%, -50%) translate(${css(pos.x - from.x).toFixed(1)}px, ${css(pos.y - from.y).toFixed(1)}px) scale(${sc.toFixed(3)})`;
    });
    if (!totalEl || !totalNum || !totalLbl || !totalFlash) return;
    const firstIn = plan.arrivals.length ? plan.arrivals[0]! : plan.mergeAt;
    if (t < firstIn) { totalEl.style.opacity = '0'; return; }
    const n = arrivedN === 0 ? plan.total : plan.counts[arrivedN - 1]!;
    if (n !== lastCount) { totalNum.textContent = String(n); lastCount = n; totalLbl.textContent = plan.capped && n >= plan.total ? 'Max Damage' : 'Damage'; }
    // Every landing squashes the total; the slam overshoots big and settles.
    const since = t - (lastArriveAt < 0 ? firstIn : lastArriveAt);
    const slam = lastArriveAt >= plan.mergeAt;
    let sc: number;
    if (slam) {
      const u = since / Math.max(1, c.slamMs);
      sc = u < 0.22 ? 1 + (plan.slamPop - 1) * easeOutCubic(u / 0.22) : 1 + (plan.slamPop - 1) * Math.max(0, spring((u - 0.22) * c.slamMs, 3.2, c.slamMs * 0.28));
      totalFlash.style.opacity = String(clamp01(1 - since / 180));
    } else {
      sc = 1 + c.tickPop * Math.max(0, spring(since, 5, 70)) + 0.06 * arrivedN;
      totalFlash.style.opacity = String(0.6 * clamp01(1 - since / 90));
    }
    if (hitEl) {
      if (t < plan.impactAt) hitEl.style.opacity = '0';
      else {
        // Punches in huge on the impact frame (held by the hit-stop), snaps down with an overshoot, holds, then rises
        // and fades: the classic damage-number read, at a size no flash can wash out.
        const since = t - plan.impactAt;
        const pop = 1 + (1.6 + 0.3 * plan.k) * Math.max(0, spring(since, 3, 70));
        const hold = 380 + 120 * plan.k;
        const rise = clamp01((since - hold) / 480);
        hitEl.style.opacity = String(1 - rise);
        hitEl.style.transform = `translate(-50%, -50%) translate(0px, ${(-70 * easeOutCubic(rise) - 10 * clamp01(since / 200)).toFixed(1)}px) scale(${Math.max(0.2, pop).toFixed(3)})`;
      }
    }
    let pos = o.combineAt, op = 1;
    if (t >= plan.chargeAt) {
      // Absorbed into the hero: a small lift (anticipation), then it dives in, shrinking and fading.
      const u = (t - plan.chargeAt) / Math.max(1, plan.absorbEnd - plan.chargeAt);
      const e = easeInBack(u, 1.4);
      pos = { x: o.combineAt.x + (o.attacker.x - o.combineAt.x) * e, y: o.combineAt.y + (o.attacker.y - o.combineAt.y) * e };
      sc *= 1 - 0.75 * clamp01(u);
      op = 1 - clamp01((u - 0.6) / 0.4);
    }
    totalEl.style.opacity = String(op);
    totalEl.style.transform = `translate(-50%, -50%) translate(${css(pos.x - o.combineAt.x).toFixed(1)}px, ${css(pos.y - o.combineAt.y).toFixed(1)}px) scale(${Math.max(0.05, sc).toFixed(3)})`;
  };

  const paintCamera = (): void => {
    if (plan.reduced) return;
    if (dimEl) {
      const inA = clamp01((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      const out = clamp01((t - plan.impactAt - (plan.beam ? c.beamHoldMs : 200)) / 420);
      dimEl.style.opacity = String((plan.dim * easeInOutSine(inA) * (1 - out)).toFixed(3));
    }
    const cam = cameraAt(plan, c, t, dir);
    const f = cameraFocus(plan, t, o.attacker, o.defender);
    // One transform for the DOM (outermost, in screen px, over the stage's own scale) and the same for Pixi.
    const ax = f.x * (1 - cam.zoom) + cam.x * (local ? 1 : s);
    const ay = f.y * (1 - cam.zoom) + cam.y * (local ? 1 : s);
    if (camera && cameraOn) camera.style.transform = `translate(${ax.toFixed(2)}px, ${ay.toFixed(2)}px) scale(${cam.zoom.toFixed(4)})${camBase ? ` ${camBase}` : ''}`;
    if (cameraOn || !camera) scene?.setCamera(ax, ay, cam.zoom);
    if (heroEl) {
      // Swell through the charge, a recoil away from the shot on fire, then settle.
      let sc = 1, back = 0;
      if (t >= plan.chargeAt && t < plan.fireAt) sc = 1 + c.heroSwell * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      else if (t >= plan.fireAt) {
        const since = t - plan.fireAt;
        sc = 1 + c.heroSwell * Math.max(0, spring(since, 4, 60));
        back = c.recoilPx * Math.max(0, spring(since, 3, 70));
      }
      heroEl.style.transform = Math.abs(sc - 1) < 1e-4 && Math.abs(back) < 0.05 ? heroPrev
        : `translate(${(-dir.x * back).toFixed(2)}px, ${(-dir.y * back).toFixed(2)}px) scale(${sc.toFixed(4)})`;
    }
    if (foeEl && t >= plan.impactAt) {
      // Knocked back along the bolt and squashed, springing home.
      const since = t - plan.impactAt;
      const k = spring(since, 4.5, 90);
      const knock = c.knockPx * (0.7 + 0.3 * plan.k) * k;
      const sq = c.squash * k;
      foeEl.style.transform = Math.abs(k) < 0.004 ? foePrev
        : `translate(${(dir.x * knock).toFixed(2)}px, ${(dir.y * knock).toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
    }
  };

  const complete = (): void => {
    if (done) return;
    land();
    done = true;
    if (safety) window.clearTimeout(safety);
    teardownDom();
    o.onDone?.();
  };

  const step = (dtMs: number): void => {
    if (done && !scene) return;
    let adv = Math.max(0, Math.min(100, dtMs)) * speed;
    // THE HIT-STOP: real time is spent holding the impact frame before the clock moves again.
    if (stopLeft > 0) { const hold = Math.min(stopLeft, adv); stopLeft -= hold; adv -= hold; }
    if (!done) {
      t += adv;
      while (cueIdx < cues.length && cues[cueIdx]!.at <= t) {
        const q = cues[cueIdx++]!;
        fire(q);
        if (q.kind === 'impact') { t = q.at; break; } // freeze exactly ON the impact frame
      }
      paintDom();
      paintCamera();
    }
    const alive = scene ? scene.update(done ? Math.max(0, Math.min(100, dtMs)) * speed : adv) : false;
    if (ended && !done) complete();
    // Keep ticking after the end only while Pixi particles drain; then unhook.
    if (done && !alive) teardownPixi();
  };

  const frames = o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn));
  unhook = frames(step);
  if (o.safety !== false && typeof window !== 'undefined') {
    safety = window.setTimeout(() => { if (!done) { complete(); teardownPixi(); } }, (plan.endAt + plan.hitStopMs) / speed + 2500);
  }

  return {
    plan,
    scene,
    elapsed: () => t,
    get impacted() { return impacted; },
    get done() { return done; },
    finish: () => { if (!done) complete(); teardownPixi(); },
    cancel: () => {
      if (safety) window.clearTimeout(safety);
      done = true;
      for (const v of voices) v.stop();
      teardownDom();
      teardownPixi();
    },
  };
}
