/**
 * THE COMBINE BEAT every hero attack opens with (moved out of the Blast, 2026-09-28, when Quake joined it): the
 * contributing numbers (captioned Tier / Minion) pop in where they come from, fly on an arc into ONE total that ticks
 * up with each landing, slam on the ENGINE's number, then dive into the attacking hero. The big `-N` hit number
 * punches onto the struck hero on the impact beat, and the big tiers dim everything but the two heroes.
 *
 * DOM only, written from the style's sequence clock: transform / opacity (plus the counter's text when it changes).
 * The layer is a top-level child of the host (above every Pixi layer, so nothing covers the numbers), carrying the
 * stage's own scale. Class names are the Blast's (`hblast-*`, styled in `heroBlast.css`); a style adds its own class
 * to the layer.
 */
import { stageFit, toStage } from '../stage';
import { arcPoint, clamp01, easeInBack, easeInOutSine, easeOutBack, easeOutCubic, spring, type Pt } from './easing';

export interface CombinePart {
  value: number;
  /** Where the number flies from (its card, the hero). Null = it appears at the combine point. */
  from: Pt | null;
  /** The attacker's Tier (the leading term): captioned "Tier". Survivors are captioned "Minion". */
  base?: boolean;
}

/** What the combine reads off a style's plan (both plans carry these fields). */
export interface CombinePlan {
  reduced: boolean;
  /** 0..1 across the tiers. */
  k: number;
  total: number;
  capped: boolean;
  spawns: number[];
  launches: number[];
  arrivals: number[];
  counts: number[];
  mergeAt: number;
  slamPop: number;
  /** The total starts diving into the attacker. */
  chargeAt: number;
  absorbEnd: number;
  /** The hit number punches in. */
  impactAt: number;
  /** How far the rest of the screen dims (0 = never). */
  dim: number;
}

export interface CombineConfig {
  chipSize: number;
  totalSize: number;
  tickPop: number;
  slamMs: number;
  combineBackPx: number;
  combineArc: number;
  reducedFadeMs: number;
}

export interface CombineNumbersOptions {
  parts: readonly CombinePart[];
  combineAt: Pt;
  attacker: Pt;
  defender: Pt;
  defenderRadius?: number;
  side?: 'player' | 'opp';
  /** The attacker's side colour (`--hb-side`). */
  sideHex: string;
  /** Points are in the host's own px (a sandbox box), not screen px. */
  local: boolean;
  host: HTMLElement | null;
  /** The Pixi size multiplier (the stage scale). */
  scale: number;
  cfg: CombineConfig;
  plan: CombinePlan;
  /** An extra class on the layer (the style's own). */
  className?: string;
}

/** The combine's DOM: built once, painted per frame, removed at the end. */
export class CombineNumbers {
  private readonly layer: HTMLDivElement | null = null;
  private readonly chips: HTMLDivElement[] = [];
  private dimEl: HTMLDivElement | null = null;
  private hitEl: HTMLDivElement | null = null;
  private totalEl: HTMLDivElement | null = null;
  private totalNum: HTMLDivElement | null = null;
  private totalLbl: HTMLDivElement | null = null;
  private totalFlash: HTMLDivElement | null = null;
  private lastCount = -1;
  private lastArriveAt = -1;
  private arrivedN = 0;

  constructor(private readonly o: CombineNumbersOptions) {
    const { cfg: c, plan, local, host } = o;
    const doc = typeof document !== 'undefined' ? document : null;
    const css = this.css;
    const place = (el: HTMLElement, p: Pt): void => { el.style.left = `${css(p.x)}px`; el.style.top = `${css(p.y)}px`; };
    const layer = host && doc ? doc.createElement('div') : null;
    this.layer = layer;
    if (!layer || !host || !doc) return;
    layer.className = `hblast${local ? ' local' : ''}${o.side === 'opp' ? ' foe' : ''}${o.className ? ` ${o.className}` : ''}`;
    layer.setAttribute('aria-hidden', 'true');
    if (!local && typeof window !== 'undefined') {
      const fit = stageFit();
      if (fit.s !== 1) { layer.style.width = `${fit.lw}px`; layer.style.height = `${fit.lh}px`; layer.style.transform = `scale(${fit.s})`; }
    }
    layer.style.setProperty('--hb-side', o.sideHex);
    layer.style.setProperty('--hb-chip', `${c.chipSize * (local ? 0.42 : 1)}px`);
    layer.style.setProperty('--hb-total', `${c.totalSize * (local ? 0.38 : 1)}px`);
    if (plan.dim > 0 && !local) {
      // The big tiers dim everything but the two heroes: a static mask with two clear spotlights (set once, never
      // animated), faded in and out by OPACITY only. It lives in `#stage` (under the Pixi light, over the board).
      const dimEl = doc.createElement('div');
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
      this.dimEl = dimEl;
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
      this.chips.push(el);
    });
    const totalEl = doc.createElement('div');
    totalEl.className = 'hblast-total';
    const totalNum = doc.createElement('div'); totalNum.className = 'hblast-total-n'; totalNum.textContent = '0';
    const totalFlash = doc.createElement('div'); totalFlash.className = 'hblast-total-n hblast-total-flash'; totalFlash.textContent = String(plan.total);
    const totalLbl = doc.createElement('div'); totalLbl.className = 'hblast-total-l'; totalLbl.textContent = 'Damage';
    totalEl.append(totalNum, totalFlash, totalLbl);
    totalFlash.style.opacity = '0';
    place(totalEl, o.combineAt);
    totalEl.style.opacity = '0';
    layer.appendChild(totalEl);
    this.totalEl = totalEl; this.totalNum = totalNum; this.totalFlash = totalFlash; this.totalLbl = totalLbl;
    // THE HIT NUMBER: the blow, big and outlined, punched onto the struck hero on the impact frame (above every flash).
    const hitEl = doc.createElement('div');
    hitEl.className = 'hblast-hit';
    hitEl.textContent = `-${plan.total}`;
    // Nudged from the hero's centre toward the middle of the screen (the heroes sit near corners), and kept inside
    // the viewport so the punch-in never clips off an edge.
    const vw = local ? (host.clientWidth || 300) : (typeof window !== 'undefined' ? window.innerWidth : 1920);
    const vh = local ? (host.clientHeight || 180) : (typeof window !== 'undefined' ? window.innerHeight : 1080);
    const toC = { x: vw / 2 - o.defender.x, y: vh / 2 - o.defender.y };
    const tl = Math.hypot(toC.x, toC.y) || 1;
    const rr = (o.defenderRadius ?? 100) * 0.55;
    const m = (local ? 0.1 : 0.09) * Math.min(vw, vh) + c.totalSize * 0.5 * (local ? 0.38 : o.scale);
    const hitAt = {
      x: Math.min(vw - m * 1.4, Math.max(m * 1.4, o.defender.x + (toC.x / tl) * rr)),
      y: Math.min(vh - m, Math.max(m, o.defender.y + (toC.y / tl) * rr)),
    };
    place(hitEl, hitAt);
    hitEl.style.opacity = '0';
    layer.appendChild(hitEl);
    this.hitEl = hitEl;
    host.appendChild(layer);
  }

  /** Screen (or host-local) px -> the CSS px written into a positioned element. */
  private readonly css = (v: number): number => (this.o.local ? v : toStage(v));

  /** A number landed in the total (index `i`, at sequence time `at`). */
  arrive(i: number, at: number): void { this.lastArriveAt = at; this.arrivedN = i + 1; }
  /** The last number landed: the slam. */
  merge(at: number): void { this.lastArriveAt = at; }

  /** The dim: in over `[inFrom, inTo]`, out over 420 ms from `outFrom`. Opacity only. */
  paintDim(t: number, inFrom: number, inTo: number, outFrom: number): void {
    if (!this.dimEl) return;
    const inA = clamp01((t - inFrom) / Math.max(1, inTo - inFrom));
    const out = clamp01((t - outFrom) / 420);
    this.dimEl.style.opacity = String((this.o.plan.dim * easeInOutSine(inA) * (1 - out)).toFixed(3));
  }

  /** Write the numbers for sequence time `t`: transform/opacity only (and the counter's text when it changes). */
  paint(t: number): void {
    const { o } = this;
    const { plan, cfg: c, local } = o;
    const css = this.css;
    const { chips, totalEl, totalNum, totalLbl, totalFlash, hitEl } = this;
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
        if (this.lastCount !== plan.total) { totalNum.textContent = String(plan.total); this.lastCount = plan.total; totalLbl.textContent = plan.capped ? 'Max Damage' : 'Damage'; }
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
          const pull = (-e / 0.09) * c.combineBackPx * (local ? 0.45 : o.scale);
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
    const n = this.arrivedN === 0 ? plan.total : plan.counts[this.arrivedN - 1]!;
    if (n !== this.lastCount) { totalNum.textContent = String(n); this.lastCount = n; totalLbl.textContent = plan.capped && n >= plan.total ? 'Max Damage' : 'Damage'; }
    // Every landing squashes the total; the slam overshoots big and settles.
    const since = t - (this.lastArriveAt < 0 ? firstIn : this.lastArriveAt);
    const slam = this.lastArriveAt >= plan.mergeAt;
    let sc: number;
    if (slam) {
      const u = since / Math.max(1, c.slamMs);
      sc = u < 0.22 ? 1 + (plan.slamPop - 1) * easeOutCubic(u / 0.22) : 1 + (plan.slamPop - 1) * Math.max(0, spring((u - 0.22) * c.slamMs, 3.2, c.slamMs * 0.28));
      totalFlash.style.opacity = String(clamp01(1 - since / 180));
    } else {
      sc = 1 + c.tickPop * Math.max(0, spring(since, 5, 70)) + 0.06 * this.arrivedN;
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
  }

  /** Take the numbers (and the dim) off the page. */
  remove(): void { this.layer?.remove(); this.dimEl?.remove(); }
}
