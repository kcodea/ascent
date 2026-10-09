import { stageHost } from './stage';

/**
 * GILDED CARD NAMES (owner spec 2026-10-09). Every card name is drawn ONCE as gradient-filled letters (CSS
 * `background-clip: text`, see `.drawer .cn` in styles.css) and then run through an SVG filter that builds the
 * rest of the treatment from the letter shape itself. From the outside in:
 *
 *   drop shadow  — the grown letter, blurred, offset down + a wider soft halo
 *   #775a33      — OUTER stroke: the letter grown outward (sits outside the glyph edge)
 *   #c7ad88      — INNER stroke 1: the letter itself, against the edge
 *   #f4e9d4      — INNER stroke 2: the letter shrunk once
 *   gradient     — the letter shrunk twice (#fbfcf7 → #decca9, set in CSS)
 *
 * WHY A FILTER: a CSS text stroke always straddles the glyph edge (half in, half out), so it cannot draw an
 * inner stroke. The owner's spec has the two light strokes truly INSIDE the letter; growing/shrinking the
 * letter's alpha (feMorphology) is the only way to get that on live, wrapping HTML text.
 *
 * WHY ONE FILTER PER SIZE: SVG filter radii are pixels, but the ring widths are em (they must scale with the
 * name). Each name asks for the filter matching its own font size; sizes are bucketed to 0.5px and each
 * bucket's filter is built once and shared by every name that size, so a board of cards shares two or three.
 */

/** Ring widths, em. Dialled in by the owner on the preview page (2026-10-09). */
export const CARD_NAME_RINGS = {
  outer: 0.005,
  inner1: 0.02,
  inner2: 0.03,
  /** Shadow spread multiplier (1 = the base tight shadow). */
  spread: 1.85,
} as const;

export const CARD_NAME_COLOURS = {
  outer: '#775a33',
  inner1: '#c7ad88',
  inner2: '#f4e9d4',
} as const;

const r = (n: number): string => String(Math.round(n * 1000) / 1000);

/** The filter's SVG markup for a name rendered at `px` font size. Pure — tested directly. */
export function cardNameFilterMarkup(id: string, px: number): string {
  const { outer, inner1, inner2, spread } = CARD_NAME_RINGS;
  const c = CARD_NAME_COLOURS;
  const grow = outer * px;
  const in1 = inner1 * px;
  const in2 = (inner1 + inner2) * px;
  const blur = 0.05 * px * spread;
  const dy = 0.05 * px * spread;
  const halo = 0.14 * px * spread;
  // The region is generous because the halo spreads well past a short name ("Imp"); `.cn` also carries
  // transparent inline padding so its bounding box has room for it.
  return `<filter id="${id}" x="-30%" y="-60%" width="160%" height="220%" color-interpolation-filters="sRGB">`
    + `<feMorphology in="SourceAlpha" operator="dilate" radius="${r(grow)}" result="grown"/>`
    + `<feMorphology in="SourceAlpha" operator="erode" radius="${r(in1)}" result="in1"/>`
    + `<feMorphology in="SourceAlpha" operator="erode" radius="${r(in2)}" result="in2"/>`
    + `<feGaussianBlur in="grown" stdDeviation="${r(blur)}" result="b1"/>`
    + `<feOffset in="b1" dy="${r(dy)}" result="b1o"/>`
    + `<feGaussianBlur in="grown" stdDeviation="${r(halo)}" result="b2"/>`
    + `<feFlood flood-color="#000" flood-opacity="1"/><feComposite in2="b1o" operator="in" result="sh1"/>`
    + `<feFlood flood-color="#000" flood-opacity="0.6"/><feComposite in2="b2" operator="in" result="sh2"/>`
    + `<feFlood flood-color="${c.outer}"/><feComposite in2="grown" operator="in" result="L0"/>`
    + `<feFlood flood-color="${c.inner1}"/><feComposite in2="SourceAlpha" operator="in" result="L1"/>`
    + `<feFlood flood-color="${c.inner2}"/><feComposite in2="in1" operator="in" result="L2"/>`
    + `<feComposite in="SourceGraphic" in2="in2" operator="in" result="L3"/>`
    + `<feMerge><feMergeNode in="sh2"/><feMergeNode in="sh1"/><feMergeNode in="L0"/>`
    + `<feMergeNode in="L1"/><feMergeNode in="L2"/><feMergeNode in="L3"/></feMerge>`
    + `</filter>`;
}

/** Font size → its 0.5px bucket. */
export function cardNameBucket(px: number): number {
  return Math.max(1, Math.round(px * 2) / 2);
}

export function cardNameFilterId(bucket: number): string {
  return `cn-gild-${String(bucket).replace('.', '_')}`;
}

let defs: SVGDefsElement | null = null;
const built = new Set<number>();

/** The `filter` value for a name at `px` font size, building that size's filter on first use. */
export function cardNameFilter(px: number): string {
  const bucket = cardNameBucket(px);
  const id = cardNameFilterId(bucket);
  if (!built.has(bucket) && typeof document !== 'undefined') {
    if (defs === null || !defs.isConnected) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.position = 'absolute';
      svg.style.pointerEvents = 'none';
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.appendChild(defs);
      stageHost().appendChild(svg);
      built.clear();
    }
    defs.insertAdjacentHTML('beforeend', cardNameFilterMarkup(id, bucket));
    built.add(bucket);
  }
  return `url(#${id})`;
}

/**
 * ONE LINE, ALWAYS (owner 2026-10-09). A name never wraps: it may run up to `CARD_NAME_MAX_W` × the text column
 * (just inside the plate's gold trim), and a name wider than that shrinks its own font (`--cn-fit`) until it fits.
 * Every other name keeps the full size.
 *
 * Measuring is batched: every name that needs (re)fitting is queued and handled in ONE microtask that does all the
 * reads first and all the writes after, so a shop full of cards costs one layout, not one per card. The microtask
 * still runs before the browser paints, so a name never shows at the wrong size. Names re-fit when the window resizes
 * (the card width follows the window height) and when web fonts finish loading (the fallback font measures
 * differently).
 */
export const CARD_NAME_MAX_W = 1.06;

/** The font scale that fits a name `needPx` wide (measured at full size) into `boundPx`. Pure — tested directly. */
export function cardNameFit(needPx: number, boundPx: number): number {
  if (!(needPx > 0) || !(boundPx > 0)) return 1;
  return Math.min(1, Math.floor((boundPx / needPx) * 1000) / 1000);
}

const mounted = new Set<HTMLElement>();
const pending = new Set<HTMLElement>();
const fitOf = new WeakMap<HTMLElement, number>();
let flushQueued = false;
let globalHooks = false;

function flush(): void {
  flushQueued = false;
  const els = [...pending].filter((el) => el.isConnected);
  pending.clear();
  // READS — all of them before any write.
  const reads = els.map((el) => {
    const text = el.firstElementChild as HTMLElement | null;
    const drawer = el.parentElement;
    return {
      el,
      px: parseFloat(getComputedStyle(el).fontSize),
      textW: text?.offsetWidth ?? 0,
      boundW: (drawer?.clientWidth ?? 0) * CARD_NAME_MAX_W,
    };
  });
  // WRITES.
  for (const { el, px, textW, boundW } of reads) {
    if (!(px > 0)) continue;
    const cur = fitOf.get(el) ?? 1;
    const fit = cardNameFit(textW / cur, boundW);   // measure as if at full size, so re-fitting is stable
    if (fit !== cur) {
      fitOf.set(el, fit);
      el.style.setProperty('--cn-fit', String(fit));
    }
    el.style.setProperty('--cn-filter', cardNameFilter((px / cur) * fit));
  }
}

function queue(el: HTMLElement): void {
  pending.add(el);
  if (!flushQueued) { flushQueued = true; queueMicrotask(flush); }
}

function requeueAll(): void { for (const el of mounted) queue(el); }

/** Fit + gild a mounted `.cn` (its first child is the text span). Returns the unmount cleanup. */
export function trackCardName(el: HTMLElement): () => void {
  mounted.add(el);
  if (!globalHooks && typeof window !== 'undefined') {
    globalHooks = true;
    let raf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(requeueAll);
    });
    document.fonts?.addEventListener?.('loadingdone', requeueAll);
  }
  queue(el);
  return () => { mounted.delete(el); pending.delete(el); };
}
