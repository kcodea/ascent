/**
 * THE BLAST RUNNER: plays one Blast hero attack (see `heroBlastConfig.ts` for the beats) and lands the consequence
 * on its impact beat. Presentation only: the total it shows and the blow it lands are handed in, already decided by
 * the engine; this file only decides WHEN on screen they happen.
 *
 * ONE CLOCK. The numbers (DOM), the camera (a transform on `#root`), the Pixi scene and the sound cues all read the
 * same sequence clock, advanced per frame by `dt x speed`. That is what makes the tuner's slow motion exact, keeps
 * the impact flash, the damage number and the Resolve drop on the same frame, and lets `finish()` jump straight to
 * the end state.
 *
 * Perf (docs/performance.md): the numbers and the camera animate `transform` / `opacity` only, written from the
 * clock; nothing reads layout after the opening measure (the caller passes screen points); the camera layer is
 * promoted (`will-change`) only while it moves; Pixi sprites are pooled and the updater unhooks the moment the scene
 * drains. A safety timer finishes the sequence if frames stop (a hidden tab), so the blow always lands.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { sfx } from '../sfx';
import { stageScale, toStage } from '../stage';
import {
  blastCues, blastPlan, getHeroBlastConfig, hexToNum, type BlastCue, type BlastPlan, type HeroBlastConfig,
} from './heroBlastConfig';
import { HeroBlastScene, type HeroBlastTextures } from './heroBlastScene';
import { heroBlastTextures } from './heroBlastTextures';
import './heroBlast.css';

type Pt = { x: number; y: number };

export interface HeroBlastPart {
  value: number;
  /** Screen point the number flies from (its card, the hero). Null = it appears at the combine point. */
  from: Pt | null;
  /** The attacker's tier (the leading term): drawn gold, like the Classic tally's tier. */
  base?: boolean;
}

export interface HeroBlastOptions {
  parts: readonly HeroBlastPart[];
  /** THE blow, as the engine decided it. */
  total: number;
  /** The parts summed past the round cap (the total reads "Max Damage"). */
  capped?: boolean;
  /** Screen centres of the striking and the struck hero. */
  attacker: Pt;
  defender: Pt;
  /** Screen point the numbers merge at. */
  combineAt: Pt;
  /** Playback speed (combat speed x the tuner's slow motion). */
  speed?: number;
  reduced?: boolean;
  cfg?: HeroBlastConfig;
  /** The consequence: fired exactly once, on the impact beat (or by `finish()` if it never got there). */
  onImpact: () => void;
  /** The sequence is over (not fired by `cancel()`). */
  onDone?: () => void;
  /** The attacker's portrait, for the charge swell + recoil (transform only; restored after). */
  attackerEl?: HTMLElement | null;
  // ── seams (tests) ──
  frames?: (fn: (dtMs: number) => void) => () => void;
  mount?: (c: Container) => () => void;
  textures?: HeroBlastTextures | null;
  host?: HTMLElement | null;
  camera?: HTMLElement | null;
  sound?: boolean;
  safety?: boolean;
}

export interface HeroBlastHandle {
  readonly plan: BlastPlan;
  /** Sequence ms elapsed (at speed). */
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
const easeOutBack = (t: number, k = 1.8): number => { const x = clamp01(t) - 1; return 1 + (k + 1) * x * x * x + k * x * x; };
/** Back-in: a small pull away first (anticipation), then commit. */
const easeInBack = (t: number, k = 1.5): number => { const x = clamp01(t); return (k + 1) * x * x * x - k * x * x; };

/** The quadratic arc a number flies on: bowed sideways by `arc` x the distance. */
function arcPoint(a: Pt, b: Pt, arc: number, t: number): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const c = { x: (a.x + b.x) / 2 + (-dy / d) * arc * d, y: (a.y + b.y) / 2 + (dx / d) * arc * d };
  const m = 1 - t;
  return { x: m * m * a.x + 2 * m * t * c.x + t * t * b.x, y: m * m * a.y + 2 * m * t * c.y + t * t * b.y };
}

/**
 * The camera at sequence time `t`: push in through the charge (anticipation), a punch on impact (overshoot), then
 * ease back to rest (settle); plus the sum of decaying shake impulses. Pure, so it is tested directly.
 */
export function cameraAt(p: BlastPlan, c: HeroBlastConfig, t: number): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  if (t >= p.chargeAt && t < p.fireAt) z = p.zoom * easeInOutSine((t - p.chargeAt) / Math.max(1, p.fireAt - p.chargeAt));
  else if (t >= p.fireAt && t < p.impactAt) z = p.zoom;
  else if (t >= p.impactAt) {
    const punchMs = 70;
    const peak = p.zoom + c.zoomPunch * (0.6 + 0.4 * p.k);
    z = t < p.impactAt + punchMs
      ? p.zoom + (peak - p.zoom) * easeOutCubic((t - p.impactAt) / punchMs)
      : peak * (1 - easeOutCubic((t - p.impactAt - punchMs) / Math.max(1, c.zoomOutMs)));
  }
  let x = 0, y = 0;
  const kicks: { at: number; amp: number; dur: number }[] = [
    ...p.bolts.map((b) => ({ at: b.fireAt, amp: p.shakePx * 0.16, dur: 110 })),
    { at: p.impactAt, amp: p.shakePx, dur: Math.max(1, c.shakeMs) },
    ...p.bolts.slice(1).map((b) => ({ at: b.arriveAt, amp: p.shakePx * 0.35, dur: 160 })),
  ];
  kicks.forEach((k, i) => {
    const age = t - k.at;
    if (age < 0 || age > k.dur) return;
    const fall = Math.pow(1 - age / k.dur, 2);
    x += k.amp * fall * Math.sin(age * 0.165 + i * 1.7);
    y += k.amp * fall * Math.cos(age * 0.197 + i * 2.3);
  });
  return { zoom: 1 + Math.max(0, z), x, y };
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
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const plan = blastPlan({ values: o.parts.map((p) => p.value), total: o.total, distance: dist, reduced }, c);
  const cues = blastCues(plan);
  const s = typeof window === 'undefined' ? 1 : stageScale();

  // ── DOM: the numbers ──
  const host = o.host !== undefined ? o.host : (typeof document !== 'undefined' ? (document.getElementById('root') ?? document.body) : null);
  const layer = host ? document.createElement('div') : null;
  const chips: HTMLDivElement[] = [];
  let totalEl: HTMLDivElement | null = null, totalNum: HTMLDivElement | null = null, totalLbl: HTMLDivElement | null = null;
  const place = (el: HTMLElement, p: Pt): void => { el.style.left = `${toStage(p.x)}px`; el.style.top = `${toStage(p.y)}px`; };
  if (layer && host) {
    layer.className = 'hblast';
    layer.setAttribute('aria-hidden', 'true');
    o.parts.forEach((p) => {
      const el = document.createElement('div');
      el.className = `hblast-chip${p.base ? ' base' : ''}`;
      el.textContent = `+${Math.max(0, Math.round(p.value))}`;
      place(el, p.from ?? o.combineAt);
      el.style.opacity = '0';
      layer.appendChild(el);
      chips.push(el);
    });
    totalEl = document.createElement('div');
    totalEl.className = 'hblast-total';
    totalNum = document.createElement('div'); totalNum.className = 'hblast-total-n'; totalNum.textContent = '0';
    totalLbl = document.createElement('div'); totalLbl.className = 'hblast-total-l'; totalLbl.textContent = 'Damage';
    totalEl.append(totalNum, totalLbl);
    place(totalEl, o.combineAt);
    totalEl.style.opacity = '0';
    layer.appendChild(totalEl);
    host.appendChild(layer);
  }

  // ── Pixi ──
  const textures = o.textures !== undefined ? o.textures : heroBlastTextures();
  const scene = textures && !reduced
    ? new HeroBlastScene(textures, { core: hexToNum(c.colorCore), bolt: hexToNum(c.colorBolt), impact: hexToNum(c.colorImpact) }, s, c.trailDensity)
    : null;
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'over')))(scene.root) : null;

  // ── camera + the hero ──
  const camera = reduced ? null : (o.camera !== undefined ? o.camera : (typeof document !== 'undefined' ? document.getElementById('root') : null));
  const focus = { x: (o.attacker.x + o.defender.x) / 2, y: (o.attacker.y + o.defender.y) / 2 };
  let cameraOn = false;
  const heroEl = reduced ? null : (o.attackerEl ?? null);
  const heroPrev = heroEl ? heroEl.style.transform : '';
  const dir = { x: (o.defender.x - o.attacker.x) / (dist || 1), y: (o.defender.y - o.attacker.y) / (dist || 1) };

  let t = 0;
  let cueIdx = 0;
  let impacted = false;
  let done = false;
  let ended = false;
  let lastCount = -1;
  let lastArriveAt = -1;
  let unhook: (() => void) | null = null;
  let safety = 0;

  const land = (): void => { if (impacted) return; impacted = true; o.onImpact(); };

  const resetCamera = (): void => {
    if (!camera || !cameraOn) return;
    camera.style.removeProperty('transform'); camera.style.removeProperty('transform-origin'); camera.style.removeProperty('will-change');
    cameraOn = false;
  };
  const resetHero = (): void => { if (heroEl) heroEl.style.transform = heroPrev; };
  const teardownDom = (): void => { layer?.remove(); resetCamera(); resetHero(); };
  const teardownPixi = (): void => {
    unhook?.(); unhook = null;
    if (scene) { unmount?.(); scene.destroy(); }
  };

  const fire = (cue: BlastCue): void => {
    switch (cue.kind) {
      case 'launch':
        if (cue.i === 0 && sound) sfx.tallyTravel(c.sfxGatherGain);
        break;
      case 'arrive': {
        if (cue.i === 0 && sound) sfx.tallyCounter(c.sfxCountGain);
        lastArriveAt = cue.at;
        const last = cue.i === plan.arrivals.length - 1;
        if (!last) scene?.mergeBurst(o.combineAt.x, o.combineAt.y, false);
        break;
      }
      case 'merge':
        lastArriveAt = cue.at;
        if (sound) sfx.attackPillAdd(c.sfxMergeGain);
        scene?.mergeBurst(o.combineAt.x, o.combineAt.y, true);
        break;
      case 'charge':
        if (sound) sfx.runeSelectImplosion(c.sfxChargeGain);
        scene?.startCharge(o.attacker.x, o.attacker.y, plan.fireAt - plan.chargeAt, 0.8 + 0.5 * plan.k, c.chargeMotes);
        if (camera && !cameraOn) {
          camera.style.willChange = 'transform';
          camera.style.transformOrigin = `${toStage(focus.x)}px ${toStage(focus.y)}px`;
          cameraOn = true;
        }
        break;
      case 'fire': {
        const b = plan.bolts[cue.i]!;
        if (cue.i === 0 && sound) sfx.blastFire(c.sfxFireGain);
        scene?.fire(o.attacker, o.defender, b.travelMs, b.size, b.curve, t - cue.at);
        break;
      }
      case 'impact':
        if (sound) { sfx.tallyImpact(c.sfxImpactGain); sfx.blastSmack(c.sfxSmackGain); }
        scene?.impact(o.defender.x, o.defender.y, dir, plan.k, plan.flashScale, c.flashAlpha, plan.sparks);
        land();
        break;
      case 'hit': {
        const b = plan.bolts[cue.i]!;
        scene?.hit(o.defender.x + (Math.random() - 0.5) * 30 * s, o.defender.y + (Math.random() - 0.5) * 30 * s, dir, b.size);
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
      if (!totalEl || !totalNum) return;
      const f = c.reducedFadeMs;
      const a = t < f ? t / f : t < plan.impactAt ? 1 : 1 - (t - plan.impactAt) / f;
      totalEl.style.opacity = String(clamp01(a));
      if (lastCount !== plan.total) { totalNum.textContent = String(plan.total); lastCount = plan.total; totalLbl!.textContent = plan.capped ? 'Max Damage' : 'Damage'; }
      totalEl.style.transform = 'translate(-50%, -50%)';
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
        const u = (t - sp) / Math.max(1, c.popInMs);
        sc = 0.35 + 0.65 * easeOutBack(u); op = clamp01(u * 2.5);
      } else {
        const u = (t - la) / Math.max(1, ar - la);
        // Pull back a touch (anticipation), then commit on the arc; shrink into the total as it arrives.
        const e = easeInBack(u, 1.5); // dips to about -0.08 at u = 0.4, then commits
        if (e < 0) {
          const dx = o.combineAt.x - from.x, dy = o.combineAt.y - from.y;
          const d = Math.hypot(dx, dy) || 1;
          const pull = (-e / 0.08) * c.combineBackPx * s;
          pos = { x: from.x - (dx / d) * pull, y: from.y - (dy / d) * pull };
        } else pos = arcPoint(from, o.combineAt, c.combineArc, e);
        sc = 1 + 0.12 * Math.max(0, -e / 0.08) - 0.35 * u;
      }
      el.style.opacity = String(op);
      el.style.transform = `translate(-50%, -50%) translate(${toStage(pos.x - from.x)}px, ${toStage(pos.y - from.y)}px) scale(${sc})`;
    });
    if (!totalEl || !totalNum) return;
    const firstIn = plan.arrivals.length ? plan.arrivals[0]! : plan.mergeAt;
    if (t < firstIn) { totalEl.style.opacity = '0'; return; }
    let n = plan.total;
    for (let i = 0; i < plan.arrivals.length; i++) if (t < plan.arrivals[i]!) { n = i === 0 ? 0 : plan.counts[i - 1]!; break; }
    if (n !== lastCount) { totalNum.textContent = String(n); lastCount = n; totalLbl!.textContent = plan.capped && n >= plan.total ? 'Max Damage' : 'Damage'; }
    // Squash on every arrival; the final merge pops big (overshoot, settle).
    const since = t - (lastArriveAt < 0 ? firstIn : lastArriveAt);
    const isMerge = lastArriveAt >= plan.mergeAt;
    const kick = isMerge ? c.mergePop - 1 : 0.18;
    const popDur = isMerge ? 300 : 160;
    let sc = 1 + kick * Math.max(0, 1 - since / popDur) * Math.sin(Math.min(Math.PI, (since / popDur) * Math.PI * 1.15) + 0.25);
    let pos = o.combineAt, op = 1;
    if (t >= plan.chargeAt) {
      // Absorbed into the hero: a small lift, then it dives in, shrinking and fading.
      const u = (t - plan.chargeAt) / Math.max(1, plan.absorbEnd - plan.chargeAt);
      const e = easeInBack(u, 1.2);
      pos = { x: o.combineAt.x + (o.attacker.x - o.combineAt.x) * e, y: o.combineAt.y + (o.attacker.y - o.combineAt.y) * e };
      sc *= 1 - 0.7 * clamp01(u);
      op = 1 - clamp01((u - 0.55) / 0.45);
    }
    totalEl.style.opacity = String(op);
    totalEl.style.transform = `translate(-50%, -50%) translate(${toStage(pos.x - o.combineAt.x)}px, ${toStage(pos.y - o.combineAt.y)}px) scale(${Math.max(0.05, sc)})`;
  };

  const paintCamera = (): void => {
    if (camera && cameraOn) {
      const cam = cameraAt(plan, c, t);
      camera.style.transform = `translate(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px) scale(${cam.zoom.toFixed(4)})`;
    }
    if (heroEl && !plan.reduced) {
      // Swell through the charge; recoil away from the shot on fire; settle back.
      let sc = 1, back = 0;
      if (t >= plan.chargeAt && t < plan.fireAt) sc = 1 + 0.06 * easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.fireAt - plan.chargeAt));
      else if (t >= plan.fireAt) {
        const u = (t - plan.fireAt) / 260;
        sc = 1 + 0.06 * (1 - easeOutCubic(u));
        back = u < 1 ? 10 * Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u) : 0;
      }
      heroEl.style.transform = u0(sc, back) ? '' : `translate(${(-dir.x * back).toFixed(2)}px, ${(-dir.y * back).toFixed(2)}px) scale(${sc.toFixed(4)})`;
    }
  };
  const u0 = (sc: number, back: number): boolean => Math.abs(sc - 1) < 1e-4 && Math.abs(back) < 1e-3;

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
    if (!done) {
      t += Math.max(0, Math.min(100, dtMs)) * speed;
      while (cueIdx < cues.length && cues[cueIdx]!.at <= t) fire(cues[cueIdx++]!);
      paintDom();
      paintCamera();
    }
    const alive = scene ? scene.update(Math.max(0, Math.min(100, dtMs)) * speed) : false;
    if (ended && !done) complete();
    // Keep ticking after the end only while Pixi particles drain (embers); then unhook.
    if (done && !alive) teardownPixi();
  };

  const frames = o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn));
  unhook = frames(step);
  if (o.safety !== false && typeof window !== 'undefined') {
    safety = window.setTimeout(() => { if (!done) { complete(); teardownPixi(); } }, plan.endAt / speed + 2500);
  }

  return {
    plan,
    elapsed: () => t,
    get impacted() { return impacted; },
    get done() { return done; },
    finish: () => { if (!done) { complete(); } teardownPixi(); },
    cancel: () => {
      if (safety) window.clearTimeout(safety);
      done = true;
      teardownDom();
      teardownPixi();
    },
  };
}
