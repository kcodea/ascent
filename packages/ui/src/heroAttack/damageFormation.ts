/**
 * THE DAMAGE FORMATION's DOM (owner ask 2026-09-28; the timeline and the rationale are in `formationConfig.ts`). Every
 * hero attack, Classic and every cosmetic, builds its blow on screen through this ONE class, then the style's own attack
 * carries the final number to the target:
 *
 *   minion tiers pulse left to right, their numbers pop up -> flow up and merge into one minion number -> the hero's
 *   tier number pops in at the hero -> the minion number joins it -> the full blow slams in -> (capped only) it crunches
 *   down to the cap under a "Damage capped" stamp -> the style's charge absorbs it -> the big hit number on impact.
 *
 * It replaced the per-style "combine" (`combineNumbers.ts`, 2026-09-28). The numbers are all the ENGINE's
 * (`FormationData`); nothing here adds a blow up.
 *
 * Perf (docs/performance.md): DOM only, written from the style's sequence clock: `transform` / `opacity` (plus a
 * number's text when it changes). Every element is built and positioned ONCE; nothing reads layout per frame (the one
 * `getComputedStyle` per tier badge is at construction). The badge pulse writes the badge's own inline transform only
 * inside its pulse window and puts it back exactly after. The layer is a top-level child of the host (above every
 * Pixi layer), carrying the stage's own scale.
 */
import { stageFit, toStage } from '../stage';
import type { AttackVoices } from './attackSound';
import { arcPoint, clamp01, easeInBack, easeInOutSine, easeOutBack, easeOutCubic, spring, type Pt } from './easing';
import { FORMATION_CLIP_KEYS, formationPlan, getFormationConfig, type FormationBeat, type FormationConfig, type FormationPlan } from './formationConfig';
import './damageFormation.css';

/** One surviving minion's contribution: its tier (the engine's), where its tier badge is, and the badge to pulse. */
export interface FormationMinion {
  value: number;
  /** The centre of its tier badge (screen px, or host px in `local` space). Null = a spot in a row is made up. */
  at: Pt | null;
  /** The badge element(s) that pulse (transform only, restored after). */
  badges?: readonly HTMLElement[];
}

/**
 * What the formation shows, all from the engine: the survivors' tiers (left to right), the striking hero's tier term,
 * the full blow before the cap, the blow that lands, and the round cap (null = unknown or uncapped).
 */
export interface FormationData {
  minions: readonly FormationMinion[];
  /** The striking side's tier term. Null when the result carries no breakdown (recorded before 2026-09-28). */
  hero: { value: number } | null;
  /** The full blow before the round cap. */
  full: number;
  /** THE blow that lands. */
  total: number;
  /** The round cap, or null when the round is uncapped or the result predates the field. */
  cap: number | null;
}

/** The cap beat plays only when the engine says the full blow was cut to the round cap. */
export function formationCapped(d: Pick<FormationData, 'full' | 'total' | 'cap'>): boolean {
  return d.cap !== null && Number.isFinite(d.full) && d.full > d.total;
}

/** The running minion total after each landing (the engine's tiers, in the order they land). */
export function minionCounts(values: readonly number[]): number[] {
  let run = 0;
  return values.map((v) => (run += Math.max(0, Math.round(v))));
}

/**
 * Every runner's formation setup: the tuned values and the plan. The plan's `endAt` is where the style's own attack
 * starts (its `leadIn`).
 */
export function planFormation(data: FormationData, cfg: FormationConfig | undefined, reduced: boolean): { fcfg: FormationConfig; fplan: FormationPlan } {
  const fcfg = cfg ?? getFormationConfig();
  const fplan = formationPlan({ minions: data.minions.length, hero: data.hero !== null, capped: formationCapped(data), reduced }, fcfg);
  return { fcfg, fplan };
}

/** What the formation reads off the style's plan (every style's plan carries these). */
export interface AttackBeats {
  reduced: boolean;
  /** 0..1 across the damage tiers. */
  k: number;
  /** The total starts diving into the attacker (the style's charge). */
  chargeAt: number;
  absorbEnd: number;
  /** The hit number punches in (Infinity = never: Classic shows its own). */
  impactAt: number;
  /** How far the rest of the screen dims (0 = never). */
  dim: number;
}

export interface DamageFormationOptions {
  data: FormationData;
  plan: FormationPlan;
  beats: AttackBeats;
  cfg: FormationConfig;
  attacker: Pt;
  attackerRadius?: number;
  defender: Pt;
  defenderRadius?: number;
  side?: 'player' | 'opp';
  /** The attacker's side colour (`--hb-side`). */
  sideHex: string;
  /** Points are in the host's own px (a sandbox box), not screen px. */
  local: boolean;
  host: HTMLElement | null;
  /** The stage scale (screen px per stage px). */
  scale: number;
  /** An extra class on the layer (the style's own). */
  className?: string;
  /** The style's voices (null = silent). */
  voices: AttackVoices | null;
}

/** Sizes in a sandbox box are drawn smaller (the box is a few hundred px). */
const LOCAL_K = 0.42;

interface BadgeState { el: HTMLElement; base: string; inline: string; on: boolean }

/** The formation's DOM: built once, painted per frame from the sequence clock, removed at the end. */
export class DamageFormation {
  private readonly layer: HTMLDivElement | null = null;
  private dimEl: HTMLDivElement | null = null;
  private readonly chips: HTMLDivElement[] = [];
  private readonly rings: HTMLDivElement[] = [];
  private readonly badges: BadgeState[][] = [];
  private mergeEl: HTMLDivElement | null = null;
  private mergeNum: HTMLElement | null = null;
  private heroEl: HTMLDivElement | null = null;
  private totalEl: HTMLDivElement | null = null;
  private totalNum: HTMLDivElement | null = null;
  private totalFlash: HTMLDivElement | null = null;
  private totalLbl: HTMLDivElement | null = null;
  private stampEl: HTMLDivElement | null = null;
  private readonly bursts: { el: HTMLDivElement; at: number; size: number; dur: number }[] = [];
  private slashEl: HTMLDivElement | null = null;
  private hitEl: HTMLDivElement | null = null;
  private lastMerge = -1;
  private lastTotal = -1;
  /** Screen-space points, computed once. */
  readonly pts: { badges: Pt[]; rests: Pt[]; merge: Pt; hero: Pt; formed: Pt; hit: Pt };
  private readonly counts: number[];
  private readonly u: number;
  private readonly data: FormationData;

  constructor(private readonly o: DamageFormationOptions) {
    const { cfg: c, plan, local, host } = o;
    // The plan decides how many minions play (a board holds 7); the data is trimmed to match, once.
    const data = o.data.minions.length === plan.n ? o.data : { ...o.data, minions: o.data.minions.slice(0, plan.n) };
    this.data = data;
    this.u = local ? LOCAL_K : o.scale;
    this.counts = minionCounts(data.minions.map((m) => m.value));
    const vw = local ? (host?.clientWidth || 300) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
    const vh = local ? (host?.clientHeight || 180) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
    this.pts = this.layout(vw, vh);
    // Decode every clip now, so the first pulse of a session is not the one waiting for its decode.
    o.voices?.warm(FORMATION_CLIP_KEYS.map((k) => c[k]));

    const doc = typeof document !== 'undefined' ? document : null;
    const layer = host && doc ? doc.createElement('div') : null;
    this.layer = layer;
    if (!layer || !host || !doc) return;
    layer.className = `hblast dform${local ? ' local' : ''}${o.side === 'opp' ? ' foe' : ''}${o.className ? ` ${o.className}` : ''}`;
    layer.setAttribute('aria-hidden', 'true');
    if (!local && typeof window !== 'undefined') {
      const fit = stageFit();
      if (fit.s !== 1) { layer.style.width = `${fit.lw}px`; layer.style.height = `${fit.lh}px`; layer.style.transform = `scale(${fit.s})`; }
    }
    const k = local ? LOCAL_K : 1;
    layer.style.setProperty('--hb-side', o.sideHex);
    layer.style.setProperty('--df-chip', `${c.chipSize * k}px`);
    layer.style.setProperty('--df-merge', `${c.mergeSize * k}px`);
    layer.style.setProperty('--df-hero', `${c.heroSize * k}px`);
    layer.style.setProperty('--hb-total', `${c.fullSize * (local ? 0.38 : 1)}px`);
    layer.style.setProperty('--df-stamp', `${c.stampSize * (local ? 0.38 : 1)}px`);
    const el = (cls: string, at: Pt, text?: string): HTMLDivElement => {
      const d = doc.createElement('div');
      d.className = cls;
      if (text !== undefined) d.textContent = text;
      this.place(d, at);
      d.style.opacity = '0';
      layer.appendChild(d);
      return d;
    };
    const cap = (parent: HTMLElement, num: string, caption: string): HTMLElement => {
      const b = doc.createElement('b'); b.textContent = num;
      const i = doc.createElement('i'); i.textContent = caption;
      parent.append(b, i);
      return b;
    };

    if (plan.beats.length && o.beats.dim > 0 && !local) this.dimEl = this.buildDim(doc, layer);

    // 1. Each minion: a pulse ring on its badge, and its number (it starts ON the badge and rises above it).
    data.minions.forEach((m, i) => {
      const at = this.pts.badges[i]!;
      this.rings.push(el('dform-ring', at));
      // No caption on a single tier: the badge it rises off says what it is.
      const chip = el('dform-chip', at);
      const num = doc.createElement('b'); num.textContent = `+${Math.max(0, Math.round(m.value))}`;
      chip.appendChild(num);
      this.chips.push(chip);
      this.badges.push((plan.reduced ? [] : (m.badges ?? [])).map((b) => {
        let base = '';
        try { const cs = getComputedStyle(b).transform; base = cs && cs !== 'none' ? cs : ''; } catch { base = ''; }
        return { el: b, base, inline: b.style.transform, on: false };
      }));
    });
    // 2. The minion number (where they merge).
    if (plan.n) {
      this.mergeEl = el('dform-merge', this.pts.merge);
      this.mergeNum = cap(this.mergeEl, '0', 'Minions');
      this.bursts.push({ el: el('dform-flare', this.pts.merge), at: plan.mergeAt, size: 1, dur: 360 });
      this.bursts.push({ el: el('dform-burst', this.pts.merge), at: plan.mergeAt, size: 1, dur: 480 });
    }
    // 3. The hero's number.
    if (data.hero) {
      this.heroEl = el('dform-hero', this.pts.hero);
      cap(this.heroEl, `+${Math.max(0, Math.round(data.hero.value))}`, 'Hero');
    }
    // 5-6. The full blow (and the cap stamp riding under it). The CSS class names are the old combine's, kept so the
    // total and the hit number read the same in every test and capture rig.
    const totalEl = el('hblast-total dform-total', this.pts.formed);
    const totalNum = doc.createElement('div'); totalNum.className = 'hblast-total-n'; totalNum.textContent = String(data.full);
    const totalFlash = doc.createElement('div'); totalFlash.className = 'hblast-total-n hblast-total-flash'; totalFlash.textContent = String(data.full);
    const totalLbl = doc.createElement('div'); totalLbl.className = 'hblast-total-l'; totalLbl.textContent = 'Damage';
    const stamp = doc.createElement('div'); stamp.className = 'dform-stamp'; stamp.textContent = 'Damage capped';
    totalFlash.style.opacity = '0';
    stamp.style.opacity = '0';
    totalEl.append(totalNum, totalFlash, totalLbl, stamp);
    this.totalEl = totalEl; this.totalNum = totalNum; this.totalFlash = totalFlash; this.totalLbl = totalLbl; this.stampEl = stamp;
    // A glow flash and a shockwave as the numbers combine (the full blow), and again, red, as the stamp slams on.
    this.bursts.push({ el: el('dform-flare big', this.pts.formed), at: plan.joinAt, size: 1.3, dur: 420 });
    this.bursts.push({ el: el('dform-burst big', this.pts.formed), at: plan.joinAt, size: 1.4, dur: 520 });
    if (plan.capped) {
      this.slashEl = el('dform-slash', this.pts.formed);
      this.bursts.push({ el: el('dform-flare cap', this.pts.formed), at: plan.capFrom, size: 1.1, dur: 320 });
      this.bursts.push({ el: el('dform-burst cap', this.pts.formed), at: plan.stampAt, size: 1.15, dur: 480 });
    }
    // THE HIT NUMBER: the blow, punched onto the struck hero on the impact frame (above every flash).
    if (Number.isFinite(o.beats.impactAt)) this.hitEl = el('hblast-hit', this.pts.hit, `-${data.total}`);
    host.appendChild(layer);
  }

  /** Screen (or host-local) px -> the CSS px written into a positioned element. */
  private readonly css = (v: number): number => (this.o.local ? v : toStage(v));

  private place(el: HTMLElement, p: Pt): void { el.style.left = `${this.css(p.x)}px`; el.style.top = `${this.css(p.y)}px`; }

  /** Every anchor, once: the badges, where each number rises to, the merge point, the hero number, the hit number. */
  private layout(vw: number, vh: number): DamageFormation['pts'] {
    const { o, u, data } = this;
    const { cfg: c } = o;
    const n = data.minions.length;
    const edge = (p: Pt, mx: number, my: number): Pt => ({ x: Math.min(vw - mx, Math.max(mx, p.x)), y: Math.min(vh - my, Math.max(my, p.y)) });
    // A made-up row when the caller knows no badge (the attacker's half of the screen, centred).
    const rowY = o.attacker.y > vh / 2 ? vh * 0.6 : vh * 0.36;
    const badges = data.minions.map((m, i) => m.at ?? { x: vw / 2 + (i - (n - 1) / 2) * Math.min(150 * u, vw / 8), y: rowY });
    const rests = badges.map((p) => ({ x: p.x, y: p.y - c.riseLift * u }));
    const xs = rests.map((p) => p.x), ys = rests.map((p) => p.y);
    // They flow toward the middle of the screen: UP off your row (the bottom one), DOWN off the foe's (the top one), so
    // the minion number never lands under the round title or off an edge.
    const top = ys.length ? Math.min(...ys) : vh / 2;
    const fromTop = top < vh * 0.45;
    const my = fromTop ? Math.max(...ys) + c.mergeLift * u * 1.8 : top - c.mergeLift * u;
    const merge = n
      ? edge({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: my }, c.mergeSize * u, c.mergeSize * u * 0.9 + vh * 0.04)
      : { x: vw / 2, y: vh / 2 };
    // The hero's number sits just off the portrait, toward the middle of the screen (the heroes sit near the edges).
    const toC = { x: vw / 2 - o.attacker.x, y: vh / 2 - o.attacker.y };
    const tl = Math.hypot(toC.x, toC.y) || 1;
    const ar = o.attackerRadius ?? o.defenderRadius ?? 90 * u;
    const off = ar * 1.1 + c.heroSize * u * 0.75;
    const hero = edge({ x: o.attacker.x + (toC.x / tl) * off, y: o.attacker.y + (toC.y / tl) * off }, c.heroSize * u, c.heroSize * u * 0.8);
    const formed = !n ? hero : (!data.hero || c.joinDir === 1 ? merge : hero);
    // The hit number: nudged from the struck hero toward the middle, kept inside the viewport.
    const toD = { x: vw / 2 - o.defender.x, y: vh / 2 - o.defender.y };
    const dl = Math.hypot(toD.x, toD.y) || 1;
    const rr = (o.defenderRadius ?? 100) * 0.55;
    const m = (o.local ? 0.1 : 0.09) * Math.min(vw, vh) + c.fullSize * 0.5 * (o.local ? 0.38 : o.scale);
    const hit = {
      x: Math.min(vw - m * 1.4, Math.max(m * 1.4, o.defender.x + (toD.x / dl) * rr)),
      y: Math.min(vh - m, Math.max(m, o.defender.y + (toD.y / dl) * rr)),
    };
    return { badges, rests, merge, hero, formed, hit };
  }

  /** The big tiers dim everything but the two heroes: two static spotlights set once, faded by OPACITY only. */
  private buildDim(doc: Document, layer: HTMLElement): HTMLDivElement {
    const { o } = this;
    const dimEl = doc.createElement('div');
    dimEl.className = 'hblast-dim';
    const r = Math.max(90, (o.defenderRadius ?? 120) * 1.25);
    const PAD = 80; // stage px of overscan, so the shake never reveals an undimmed edge
    const fit = typeof window !== 'undefined' ? stageFit() : { lw: 1920, lh: 1080 };
    dimEl.style.left = `${-PAD}px`; dimEl.style.top = `${-PAD}px`; dimEl.style.width = `${fit.lw + 2 * PAD}px`; dimEl.style.height = `${fit.lh + 2 * PAD}px`;
    const hole = (p: Pt): string => `radial-gradient(circle at ${(this.css(p.x) + PAD).toFixed(0)}px ${(this.css(p.y) + PAD).toFixed(0)}px, transparent ${this.css(r).toFixed(0)}px, #000 ${this.css(r * 1.7).toFixed(0)}px)`;
    const mask = `${hole(o.attacker)}, ${hole(o.defender)}`;
    dimEl.style.setProperty('mask-image', mask);
    dimEl.style.setProperty('-webkit-mask-image', mask);
    dimEl.style.opacity = '0';
    (doc.getElementById('stage') ?? layer).appendChild(dimEl);
    return dimEl;
  }

  /** A formation beat fires: its sound. (The pictures are all painted from the clock.) */
  fire(b: FormationBeat): void {
    const v = this.o.voices;
    if (!v) return;
    const c = this.o.cfg;
    const reduced = this.o.plan.reduced;
    const tick = { lenMs: c.sfxTickLenMs, fadeMs: 140 };
    switch (b.kind) {
      case 'pulse': v.cue(c.sfxPulseClip, c.sfxPulseGain, c.sfxPulseRate + (reduced ? 0 : b.i * c.sfxPulseStep), tick); break;
      case 'flow': v.cue(c.sfxFlowClip, c.sfxFlowGain, c.sfxFlowRate, { lenMs: 700, fadeMs: 220 }); break;
      case 'land': v.cue(c.sfxLandClip, c.sfxLandGain, c.sfxLandRate + b.i * c.sfxLandStep, tick); break;
      case 'merge': v.cue(c.sfxMergeClip, c.sfxMergeGain, c.sfxMergeRate); break;
      case 'hero': v.cue(c.sfxHeroClip, c.sfxHeroGain, c.sfxHeroRate, tick); break;
      case 'join': v.cue(c.sfxJoinClip, c.sfxJoinGain, c.sfxJoinRate); break;
      case 'full': v.cue(c.sfxFullClip, c.sfxFullGain, c.sfxFullRate, { lenMs: 600, fadeMs: 200 }); break;
      case 'cap': v.cue(c.sfxSlashClip, c.sfxSlashGain, c.sfxSlashRate, { lenMs: 800, fadeMs: 260 }); break;
      case 'crunch': v.cue(c.sfxCapClip, c.sfxCapGain, c.sfxCapRate, { lenMs: Math.max(200, c.capMs + 160), fadeMs: 180 }); break;
      case 'stamp': v.cue(c.sfxStampClip, c.sfxStampGain, c.sfxStampRate, { lenMs: 700, fadeMs: 240 }); break;
      default: break;
    }
  }

  /** The dim: in over `[inFrom, inTo]`, out over 420 ms from `outFrom`. Opacity only. */
  paintDim(t: number, inFrom: number, inTo: number, outFrom: number): void {
    if (!this.dimEl) return;
    const inA = clamp01((t - inFrom) / Math.max(1, inTo - inFrom));
    const out = clamp01((t - outFrom) / 420);
    this.dimEl.style.opacity = String((this.o.beats.dim * easeInOutSine(inA) * (1 - out)).toFixed(3));
  }

  /** Write every number for sequence time `t`: transform / opacity only (plus a number's text when it changes). */
  paint(t: number): void {
    if (this.o.plan.reduced) { this.paintReduced(t); return; }
    this.paintMinions(t);
    this.paintMerge(t);
    this.paintHero(t);
    this.paintTotal(t);
    this.paintBursts(t);
    this.paintHit(t);
  }

  // ── the pieces ──

  private xf(el: HTMLElement, from: Pt, pos: Pt, sc: number, extra = ''): void {
    el.style.transform = `translate(-50%, -50%) translate(${this.css(pos.x - from.x).toFixed(1)}px, ${this.css(pos.y - from.y).toFixed(1)}px) scale(${Math.max(0.02, sc).toFixed(3)})${extra}`;
  }

  private paintMinions(t: number): void {
    const { plan: p, cfg: c } = this.o;
    const { badges, rests, merge } = this.pts;
    this.chips.forEach((chip, i) => {
      const at = badges[i]!, rest = rests[i]!;
      const pu = p.pulses[i]!, fl = p.flights[i]!, la = p.lands[i]!;
      // THE BADGE PULSE: its own transform, only inside its window, restored exactly after.
      const bu = (t - pu) / Math.max(1, c.pulseMs);
      for (const b of this.badges[i] ?? []) {
        if (bu >= 0 && bu < 1) {
          const env = bu < 0.22 ? easeOutCubic(bu / 0.22) : Math.max(0, 1 - easeInOutSine((bu - 0.22) / 0.78)) + 0.12 * Math.sin((bu - 0.22) * 9) * (1 - bu);
          b.el.style.transform = `${b.base} scale(${(1 + c.pulseStrength * env).toFixed(3)})`.trim();
          b.on = true;
        } else if (b.on) { b.el.style.transform = b.inline; b.on = false; }
      }
      // The ring on the badge.
      const ring = this.rings[i]!;
      const ru = (t - pu) / Math.max(1, c.pulseMs * 1.4);
      if (ru < 0 || ru >= 1 || c.ringSize <= 0) ring.style.opacity = '0';
      else {
        ring.style.opacity = String((0.95 * Math.pow(1 - ru, 1.4)).toFixed(3));
        ring.style.transform = `translate(-50%, -50%) scale(${(c.ringSize * (0.45 + 1.5 * easeOutCubic(ru))).toFixed(3)})`;
      }
      // The number: pops up off the badge, holds above it, then flows up into the merge.
      if (t < pu || t >= la) { chip.style.opacity = '0'; return; }
      let pos = rest, sc = 1, op = 1;
      if (t < pu + c.popMs) {
        const v = (t - pu) / Math.max(1, c.popMs);
        const e = easeOutCubic(v);
        pos = { x: at.x + (rest.x - at.x) * e, y: at.y + (rest.y - at.y) * e };
        sc = 0.25 + 0.75 * easeOutBack(v, 3.6);
        op = clamp01(v * 3.5);
      } else if (t >= fl) {
        const v = (t - fl) / Math.max(1, la - fl);
        const e = easeInBack(v, 1.5); // a little dip first (anticipation), then it commits
        const bow = c.mergeArc * (rest.x < merge.x ? -1 : 1) * (this.o.side === 'opp' ? -1 : 1);
        if (e < 0) {
          pos = { x: rest.x, y: rest.y - (e / 0.09) * 10 * this.u };
          sc = 1 + 0.1 * (-e / 0.09);
        } else {
          pos = arcPoint(rest, merge, bow, e);
          sc = 1.1 - 0.5 * e;
        }
        op = 1 - clamp01((v - 0.88) / 0.12);
      } else {
        // The wait above the badge: a small breath, so the row reads alive.
        sc = 1 + 0.03 * Math.sin((t - pu) * 0.012);
      }
      chip.style.opacity = String(op.toFixed(3));
      this.xf(chip, at, pos, sc);
    });
  }

  private paintMerge(t: number): void {
    const { plan: p, cfg: c } = this.o;
    const el = this.mergeEl, num = this.mergeNum;
    if (!el || !num || !p.n) return;
    const first = p.lands[0]!;
    if (t < first) { el.style.opacity = '0'; return; }
    let landed = 0;
    for (let i = 0; i < p.n; i++) if (t >= p.lands[i]!) landed = i + 1;
    const n = this.counts[landed - 1] ?? 0;
    if (n !== this.lastMerge) { num.textContent = `+${n}`; this.lastMerge = n; }
    const lastAt = p.lands[landed - 1]!;
    const since = t - lastAt;
    let sc: number;
    if (t >= p.mergeAt) {
      const v = (t - p.mergeAt) / Math.max(1, c.slamMs);
      sc = v < 0.2 ? 1 + 0.6 * easeOutCubic(v / 0.2) : 1 + 0.6 * Math.max(0, spring((v - 0.2) * c.slamMs, 3.2, c.slamMs * 0.3));
    } else {
      sc = (landed === 1 ? easeOutBack(clamp01(since / 140), 2.4) : 1) * (1 + 0.24 * Math.max(0, spring(since, 5, 70)));
    }
    sc *= 0.82 + 0.18 * (landed / p.n);
    let pos = this.pts.merge, op = 1;
    const joining = p.hero && c.joinDir === 0;
    if (t >= p.joinFrom && joining) {
      // THE JOIN: the minion number flies into the hero's.
      const v = (t - p.joinFrom) / Math.max(1, p.joinAt - p.joinFrom);
      const e = easeInBack(v, 0.7);
      pos = arcPoint(this.pts.merge, this.pts.hero, c.joinArc, Math.max(0, e));
      sc *= 1 - 0.3 * Math.max(0, e);
      op = t >= p.joinAt ? 0 : 1 - clamp01((v - 0.8) / 0.2);
    } else if (t >= p.joinAt) op = 0;
    el.style.opacity = String(op.toFixed(3));
    this.xf(el, this.pts.merge, pos, sc);
  }

  private paintHero(t: number): void {
    const { plan: p, cfg: c } = this.o;
    const el = this.heroEl;
    if (!el) return;
    if (t < p.heroAt) { el.style.opacity = '0'; return; }
    const v = (t - p.heroAt) / Math.max(1, c.popMs);
    let sc = 0.2 + 0.8 * easeOutBack(v, 3.6), op = clamp01(v * 3.5);
    let pos = this.pts.hero;
    if (p.n && c.joinDir === 1 && t >= p.joinFrom) {
      // The other direction: the hero's number flies into the minions'.
      const w = (t - p.joinFrom) / Math.max(1, p.joinAt - p.joinFrom);
      const e = easeInBack(w, 0.7);
      pos = arcPoint(this.pts.hero, this.pts.merge, c.joinArc, Math.max(0, e));
      sc *= 1 - 0.3 * Math.max(0, e);
      op *= 1 - clamp01((w - 0.8) / 0.2);
    } else if (p.n && t >= p.joinFrom) {
      // Braces for the minion number arriving.
      const w = clamp01((t - p.joinFrom) / Math.max(1, p.joinAt - p.joinFrom));
      sc *= 1 + 0.12 * easeInOutSine(Math.max(0, (w - 0.6) / 0.4));
    }
    if (t >= p.joinAt) op = 0;
    el.style.opacity = String(op.toFixed(3));
    this.xf(el, this.pts.hero, pos, sc);
  }

  private paintTotal(t: number): void {
    const { plan: p, cfg: c, beats } = this.o;
    const data = this.data;
    const { totalEl, totalNum, totalFlash, totalLbl, stampEl } = this;
    if (!totalEl || !totalNum || !totalFlash || !totalLbl || !stampEl) return;
    if (t < p.joinAt) { totalEl.style.opacity = '0'; return; }
    // THE VALUE: the full blow, then (capped) counting down to the blow that lands.
    let value = data.full;
    if (p.capped && t >= p.crunchAt) {
      const v = clamp01((t - p.crunchAt) / Math.max(1, p.capTo - p.crunchAt));
      value = Math.round(data.full - (data.full - data.total) * easeInOutSine(v));
    }
    if (!p.capped) value = data.total;
    if (value !== this.lastTotal) { totalNum.textContent = String(value); totalFlash.textContent = String(value); this.lastTotal = value; }
    // THE SLAM: it lands big and settles with an overshoot.
    const since = t - p.joinAt;
    let sc = 1 + (c.fullPop - 1) * Math.max(-0.12, spring(since, 3, c.slamMs * 0.32));
    let flash = clamp01(1 - since / 200);
    let dx = 0;
    if (p.capped && t >= p.crunchAt) {
      // THE SLASH lands and the CRUNCH starts at once (no freeze: owner 2026-09-28, "it looks like lag"): a white flash
      // and a jolt that decay over the first beats while the number is squeezed, rattled and counted down to the cap.
      const hitAge = t - p.capFrom;
      const jolt = Math.max(0, spring(hitAge, 5, 90));
      const v = clamp01((t - p.crunchAt) / Math.max(1, p.capTo - p.crunchAt));
      sc *= (1 - 0.16 * Math.sin(Math.PI * v)) * (1 + 0.12 * jolt);
      dx = c.capShake * this.u * (Math.sin((t - p.crunchAt) * 0.11) * (1 - v) * Math.min(1, v * 6 + 0.5) + 1.2 * jolt * Math.sin(hitAge * 0.35));
      flash = Math.max(flash, 0.85 * clamp01(1 - hitAge / 200));
      if (t >= p.capTo) {
        const s2 = t - p.capTo;
        sc *= 1 + 0.16 * Math.max(0, spring(s2, 4, 70));
        flash = Math.max(flash, 0.7 * clamp01(1 - s2 / 160));
      }
    }
    totalFlash.style.opacity = flash.toFixed(3);
    if (this.slashEl) {
      // A bright diagonal streak across the number on the slash: it sweeps in, then thins out and fades.
      const s4 = t - p.capFrom;
      if (s4 < 0 || s4 > 420) this.slashEl.style.opacity = '0';
      else {
        const sweep = easeOutCubic(s4 / 110);
        this.slashEl.style.opacity = (1 - clamp01((s4 - 160) / 260)).toFixed(3);
        this.slashEl.style.transform = `translate(-50%, -50%) rotate(-24deg) scale(${sweep.toFixed(3)}, ${(1 - 0.6 * clamp01((s4 - 110) / 310)).toFixed(3)})`;
      }
    }
    // The stamp (capped only): slams on at an angle and replaces the "Damage" caption.
    if (p.capped && t >= p.stampAt) {
      const s3 = t - p.stampAt;
      const ss = 1 + (c.stampPop - 1) * Math.max(-0.08, spring(s3, 3.5, 60));
      stampEl.style.opacity = clamp01(s3 / 50).toFixed(3);
      stampEl.style.transform = `rotate(${c.stampTilt}deg) scale(${ss.toFixed(3)})`;
      totalLbl.style.opacity = (1 - clamp01(s3 / 60)).toFixed(3);
    } else {
      stampEl.style.opacity = '0';
      totalLbl.style.opacity = '1';
    }
    let pos = this.pts.formed, op = clamp01(since / 60);
    if (t >= beats.chargeAt) {
      // Absorbed into the hero: a small lift (anticipation), then it dives in, shrinking and fading.
      const v = (t - beats.chargeAt) / Math.max(1, beats.absorbEnd - beats.chargeAt);
      const e = easeInBack(v, 1.4);
      pos = { x: pos.x + (this.o.attacker.x - pos.x) * e, y: pos.y + (this.o.attacker.y - pos.y) * e };
      sc *= 1 - 0.75 * clamp01(v);
      op *= 1 - clamp01((v - 0.6) / 0.4);
    }
    totalEl.style.opacity = op.toFixed(3);
    this.xf(totalEl, this.pts.formed, { x: pos.x + dx, y: pos.y }, sc);
  }

  private paintBursts(t: number): void {
    for (const b of this.bursts) {
      const v = (t - b.at) / b.dur;
      if (v < 0 || v >= 1) { b.el.style.opacity = '0'; continue; }
      b.el.style.opacity = (0.9 * Math.pow(1 - v, 1.6)).toFixed(3);
      b.el.style.transform = `translate(-50%, -50%) scale(${(b.size * (0.35 + 1.6 * easeOutCubic(v))).toFixed(3)})`;
    }
  }

  private paintHit(t: number): void {
    const { beats } = this.o;
    const hitEl = this.hitEl;
    if (!hitEl) return;
    if (t < beats.impactAt) { hitEl.style.opacity = '0'; return; }
    // Punches in huge on the impact frame, snaps down with an overshoot, holds, then rises and
    // fades: the classic damage-number read, at a size no flash can wash out.
    const since = t - beats.impactAt;
    const pop = 1 + (1.6 + 0.3 * beats.k) * Math.max(0, spring(since, 3, 70));
    const hold = 380 + 120 * beats.k;
    const rise = clamp01((since - hold) / 480);
    hitEl.style.opacity = String(1 - rise);
    hitEl.style.transform = `translate(-50%, -50%) translate(0px, ${(-70 * easeOutCubic(rise) - 10 * clamp01(since / 200)).toFixed(1)}px) scale(${Math.max(0.2, pop).toFixed(3)})`;
  }

  /** Reduced motion: the same stages as quick fades, nothing moves. */
  private paintReduced(t: number): void {
    const { plan: p, cfg: c, beats } = this.o;
    const data = this.data;
    const f = Math.max(1, c.reducedFadeMs);
    const fade = (from: number, to: number): number => clamp01((t - from) / f) * (1 - clamp01((t - to) / f));
    const end = beats.impactAt;
    this.chips.forEach((el, i) => { el.style.opacity = fade(p.pulses[i]!, p.lands[i]!).toFixed(3); this.xf(el, this.pts.badges[i]!, this.pts.rests[i]!, 1); });
    for (const r of this.rings) r.style.opacity = '0';
    if (this.mergeEl && this.mergeNum) {
      if (this.lastMerge < 0) { const n = this.counts[p.n - 1] ?? 0; this.mergeNum.textContent = `+${n}`; this.lastMerge = n; }
      this.mergeEl.style.opacity = fade(p.mergeAt, p.joinAt).toFixed(3);
      this.xf(this.mergeEl, this.pts.merge, this.pts.merge, 1);
    }
    if (this.heroEl) { this.heroEl.style.opacity = fade(p.heroAt, p.joinAt).toFixed(3); this.xf(this.heroEl, this.pts.hero, this.pts.hero, 1); }
    const { totalEl, totalNum, totalLbl, stampEl } = this;
    if (totalEl && totalNum && totalLbl && stampEl) {
      const value = p.capped && t >= p.capFrom ? data.total : (p.capped ? data.full : data.total);
      if (value !== this.lastTotal) { totalNum.textContent = String(value); this.lastTotal = value; }
      totalEl.style.opacity = fade(p.joinAt, Number.isFinite(end) ? end : beats.absorbEnd).toFixed(3);
      this.xf(totalEl, this.pts.formed, this.pts.formed, 1);
      const st = p.capped ? clamp01((t - p.capFrom) / f) : 0;
      stampEl.style.opacity = st.toFixed(3);
      stampEl.style.transform = `rotate(${c.stampTilt}deg)`;
      totalLbl.style.opacity = (1 - st).toFixed(3);
    }
  }

  /** Take the numbers (and the dim) off the page, and put every pulsed badge back exactly as it was. */
  remove(): void {
    for (const row of this.badges) for (const b of row) if (b.on) { b.el.style.transform = b.inline; b.on = false; }
    this.layer?.remove();
    this.dimEl?.remove();
  }
}
