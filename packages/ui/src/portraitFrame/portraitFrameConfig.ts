import type { CSSProperties } from 'react';
import type { TunerControl, TunerSpec } from '../tunerSchema';
import SKIN_FRAME_GEOMETRY from './frameSkins.data.json';

/**
 * HERO PORTRAIT FRAMES (owner ask 2026-09-29: "put a tuner in so i can swap out the hero portrait frames ... this
 * should reflect in career/leaderboard/in-game as well for both player and opponents").
 *
 * One setting decides which ring every hero portrait in the game wears. Every portrait surface asks
 * `resolvePortraitFrame(side)` (through `usePortraitFrame`) and paints the answer with `<PortraitFrame>`, so
 * there is exactly ONE place that knows which art, how big and where.
 *
 * `current` is the BAKED default and means "keep today's per-surface look" (the gold CSS border on the combat
 * portrait, the copper ring PNG on the Career / ladder rows, and so on). The resolver returns null for it, the
 * surfaces render exactly what they rendered before this module existed, and production is unchanged until
 * the owner bakes another choice into DEFAULTS.
 *
 * GEOMETRY. Every surface has a round portrait DISC. A frame image is centred on that disc, sized as a multiple
 * of the disc's diameter so the ring's transparent HOLE lands just inside the disc's edge (the art tucks under
 * the ring's inner lip, the same 0.9 / 0.86 overlap the old `.portring` recipe used). The per-frame hole
 * measurements below were taken off each master's alpha, so every frame starts seated; the fit dials then
 * nudge it: frame scale (x), portrait scale (x, the art inside the disc), and x/y offset (% of the disc).
 * The fit can be global or overridden per frame.
 *
 * PORTRAIT FRAME COSMETICS (owner 2026-10-01: "we're adding portrait skins ... we want this to replace the default
 * portrait png when a skin is applied"). A crate item of the `portrait_frame` category IS a frame: its cosmetic id
 * (`frame_fire`, ...) is accepted as a `frameId` exactly like a tuner frame, its art lives in `art/frames/skins/` and
 * its hole was measured by `npm run art:frames` (`frameSkins.data.json`). Who wears which is decided OUTSIDE this
 * module (it never imports the store or the catalog): `usePortraitFrame` passes your equipped frame for `self`, and an
 * opponent surface passes the seat's recorded frame through "Show opponent cosmetics". A frame cosmetic WINS over the
 * tuner's choice; no frame (or an unknown id) falls back to the tuner, whose baked default is today's look.
 */

/** Every frame the picker offers. `current` = today's look (no image frame). */
export const FRAME_CHOICES = ['current', 'default', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant', 'rank1'] as const;
export type FrameChoice = (typeof FRAME_CHOICES)[number];
export type ImageFrameId = Exclude<FrameChoice, 'current'>;
export const IMAGE_FRAME_IDS = FRAME_CHOICES.filter((c): c is ImageFrameId => c !== 'current');

/** Whose portrait: the live player (`self`) or anyone else (`opp`: opponents, other ladder players). */
export type PortraitSide = 'self' | 'opp';

export const FRAME_LABELS: Record<FrameChoice, string> = {
  current: 'Current (today\'s look)',
  default: 'Default ring',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
  ascendant: 'Ascendant',
  rank1: 'Rank #1',
};

/** One frame's art, measured off its master's alpha: the image aspect (h / w), the transparent hole's diameter
 *  as a fraction of the image WIDTH, and the hole's centre as fractions of width / height. */
export interface FrameArt {
  aspect: number;
  holeD: number;
  holeCx: number;
  holeCy: number;
}

/** `default` reproduces the old `.portring` recipe exactly (hole 86% of the width, centred at 49.6% / 48.9%); the
 *  rest were measured 2026-09-29. Ascendant and Rank #1 have gems reaching into the hole, so theirs is the ring's
 *  inner edge between the gems, a touch generous; the per-frame fit is there to finish them by eye. */
export const FRAME_ART: Record<ImageFrameId, FrameArt> = {
  default: { aspect: 1572 / 1524, holeD: 0.86, holeCx: 0.496, holeCy: 0.489 },
  bronze: { aspect: 1, holeD: 0.84, holeCx: 0.494, holeCy: 0.4856 },
  silver: { aspect: 1, holeD: 0.841, holeCx: 0.4948, holeCy: 0.4864 },
  gold: { aspect: 1, holeD: 0.839, holeCx: 0.4948, holeCy: 0.486 },
  platinum: { aspect: 1, holeD: 0.8385, holeCx: 0.4956, holeCy: 0.4864 },
  diamond: { aspect: 1, holeD: 0.835, holeCx: 0.4988, holeCy: 0.486 },
  ascendant: { aspect: 1, holeD: 0.8, holeCx: 0.5, holeCy: 0.4892 },
  rank1: { aspect: 1, holeD: 0.82, holeCx: 0.4996, holeCy: 0.4829 },
};

/** The PORTRAIT FRAME cosmetics' measured holes, keyed by cosmetic id (written by `npm run art:frames`). */
export const SKIN_FRAME_ART: Readonly<Record<string, FrameArt>> = SKIN_FRAME_GEOMETRY;
export const SKIN_FRAME_IDS: readonly string[] = Object.keys(SKIN_FRAME_ART);
export const isSkinFrameId = (v: unknown): v is string => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKIN_FRAME_ART, v);

/** Any frame the renderer can paint: a tuner frame or a portrait frame cosmetic. */
export type AnyFrameId = ImageFrameId | string;
const artOf = (id: AnyFrameId): FrameArt | undefined => (FRAME_ART as Record<string, FrameArt>)[id] ?? SKIN_FRAME_ART[id];

/** The disc sits this much wider than the ring's hole, so its edge hides under the inner lip (0.9 / 0.86). */
const LIP = 0.9 / 0.86;

/** The art, keyed by id. Eager `?url` imports: URLs only (no bytes), resolved once at load. */
const FRAME_URLS = import.meta.glob('../art/frames/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const SKIN_FRAME_URLS = import.meta.glob('../art/frames/skins/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export function frameSrc(id: AnyFrameId): string | undefined {
  return isSkinFrameId(id) ? SKIN_FRAME_URLS[`../art/frames/skins/${id}.webp`] : FRAME_URLS[`../art/frames/frame_${id}.webp`];
}

/** The fit dials. `scale` multiplies the frame's measured size, `art` scales the portrait inside the disc, `dx` /
 *  `dy` move the frame in % of the disc's diameter. */
export interface FrameFit {
  scale: number;
  art: number;
  dx: number;
  dy: number;
}
export const NEUTRAL_FIT: FrameFit = { scale: 1, art: 1, dx: 0, dy: 0 };
export const FIT_RANGES: Record<keyof FrameFit, [number, number, number]> = {
  scale: [0.6, 1.6, 0.005],
  art: [0.5, 1.5, 0.005],
  dx: [-25, 25, 0.1],
  dy: [-25, 25, 0.1],
};

export type FitTarget = 'all' | ImageFrameId;

/** What persists (dev) / ships (prod). */
export interface PortraitFrameState {
  /** Your own portrait. */
  self: FrameChoice;
  /** Everyone else's (opponents, other ladder players) when `same` is off. */
  opp: FrameChoice;
  /** Same for everyone: opponents wear `self`. */
  same: boolean;
  /** Which fit the dials edit: the global one, or one frame's override. */
  fitTarget: FitTarget;
  /** `all` = the global fit; an image id = that frame's override (absent = it follows `all`). */
  fits: Partial<Record<FitTarget, FrameFit>>;
}

/** BAKED PRODUCTION DEFAULTS: today's look everywhere. Bake a frame choice or fit here to ship it. */
const DEFAULTS: PortraitFrameState = { self: 'current', opp: 'current', same: true, fitTarget: 'all', fits: {} };
export { DEFAULTS as PORTRAIT_FRAME_DEFAULTS };

const KEY = 'ascent.portraitframes';

const clamp = (v: number, [lo, hi]: [number, number, number]): number => Math.min(hi, Math.max(lo, v));
const isChoice = (v: unknown): v is FrameChoice => typeof v === 'string' && (FRAME_CHOICES as readonly string[]).includes(v);
const isTarget = (v: unknown): v is FitTarget => v === 'all' || (typeof v === 'string' && (IMAGE_FRAME_IDS as readonly string[]).includes(v));

export function clampFit(f: Partial<FrameFit> | undefined, base: FrameFit = NEUTRAL_FIT): FrameFit {
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    scale: clamp(num(f?.scale, base.scale), FIT_RANGES.scale),
    art: clamp(num(f?.art, base.art), FIT_RANGES.art),
    dx: clamp(num(f?.dx, base.dx), FIT_RANGES.dx),
    dy: clamp(num(f?.dy, base.dy), FIT_RANGES.dy),
  };
}

/** Sanitise anything (stored JSON, a pasted blob) into a valid state; unknown / out-of-range values fall back. */
export function sanitizePortraitFrameState(raw: unknown): PortraitFrameState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fits: PortraitFrameState['fits'] = {};
  const rawFits = (o.fits && typeof o.fits === 'object' ? o.fits : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawFits)) if (isTarget(k) && v && typeof v === 'object') fits[k] = clampFit(v as Partial<FrameFit>);
  return {
    self: isChoice(o.self) ? o.self : DEFAULTS.self,
    opp: isChoice(o.opp) ? o.opp : DEFAULTS.opp,
    same: typeof o.same === 'boolean' ? o.same : DEFAULTS.same,
    fitTarget: isTarget(o.fitTarget) ? o.fitTarget : DEFAULTS.fitTarget,
    fits,
  };
}

// DEV reads the tuner's localStorage; production always plays the baked DEFAULTS.
let state: PortraitFrameState = (() => {
  if (!import.meta.env.DEV) return sanitizePortraitFrameState(DEFAULTS);
  try {
    return sanitizePortraitFrameState(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return sanitizePortraitFrameState(DEFAULTS);
  }
})();

let version = 0;
const listeners = new Set<() => void>();
export function subscribePortraitFrames(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function getPortraitFrameVersion(): number {
  return version;
}
export function getPortraitFrameState(): PortraitFrameState {
  return state;
}

function commit(next: PortraitFrameState, persist = true): void {
  state = next;
  version++;
  cache.clear();
  if (persist) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }
  for (const fn of listeners) fn();
}

export function setPortraitFrameState(patch: Partial<PortraitFrameState>): void {
  commit(sanitizePortraitFrameState({ ...state, ...patch }));
}

export function resetPortraitFrames(): void {
  commit(sanitizePortraitFrameState(DEFAULTS), false);
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The fit a frame actually uses: its own override, else the global fit (a frame cosmetic has no override). */
export function effectiveFit(id: AnyFrameId, s: PortraitFrameState = state): FrameFit {
  return (s.fits as Record<string, FrameFit | undefined>)[id] ?? s.fits.all ?? NEUTRAL_FIT;
}

/** The frame a surface paints. A valid per-player `frameId` (a portrait frame cosmetic riding the snapshot or your
 *  loadout, or a tuner frame id) wins; otherwise the side's tuner choice, where opponents follow yours while "same
 *  for everyone" is on. An unknown or retired id is ignored (the caller drops retired ones). */
export function resolveFrameChoice(side: PortraitSide, frameId?: string | null, s: PortraitFrameState = state): FrameChoice | string {
  if (frameId && (isChoice(frameId) || isSkinFrameId(frameId))) return frameId;
  return side === 'opp' && !s.same ? s.opp : s.self;
}

/** Where the frame image sits, relative to the portrait disc's box (percent of the disc), plus the art scale. */
export interface FrameGeometry {
  /** Frame image width, % of the disc diameter. */
  width: number;
  /** The frame image's CENTRE, % of the disc box from its left / top. */
  cx: number;
  cy: number;
  art: number;
}

export function frameGeometry(id: AnyFrameId, fit: FrameFit): FrameGeometry {
  const a = artOf(id) ?? FRAME_ART.default;
  const w = (1 / (a.holeD * LIP)) * fit.scale; // frame width in disc diameters
  return {
    width: w * 100,
    // The hole's centre sits on the disc's centre, so the image centre is offset by (0.5 - hole) of the image.
    cx: 50 + (0.5 - a.holeCx) * w * 100 + fit.dx,
    cy: 50 + (0.5 - a.holeCy) * a.aspect * w * 100 + fit.dy,
    art: fit.art,
  };
}

/** What `<PortraitFrame>` paints and what the disc host needs. Referentially stable per (version, frame). */
export interface ResolvedFrame {
  id: AnyFrameId;
  src: string;
  /** Inline style for the frame `<img>` (static: set once, never animated). */
  imgStyle: CSSProperties;
  /** Inline style for the disc host: the portrait scale var. */
  hostStyle: CSSProperties;
  geometry: FrameGeometry;
}

/** Where a frame is painted. `socket` = YOUR in-game portrait (StatusBar), which sits in a socket baked into the
 *  board art and needs its own seat; `default` = every other surface (Career, ladder, lobby rail, match details, …). */
export type FrameSurface = 'default' | 'socket';

/** THE IN-GAME SOCKET FIT (owner-tuned 2026-10-01 on the Gilded frame): seats a frame over the board's baked socket.
 *  Applied ONLY to your in-game portrait; owner: "using this in career and other places seems to mess with the art,
 *  so can you only apply this fit to the in game portrait?". Other surfaces keep the tuner fit (neutral in prod). */
export const SOCKET_FIT: FrameFit = { scale: 1.005, art: 1, dx: 1.25, dy: -3.6 };

const cache = new Map<string, ResolvedFrame | null>();
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function resolveImageFrame(id: AnyFrameId, surface: FrameSurface = 'default'): ResolvedFrame | null {
  const key = `${surface}:${id}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const src = artOf(id) ? frameSrc(id) : undefined;
  let out: ResolvedFrame | null = null;
  if (src) {
    const g = frameGeometry(id, surface === 'socket' ? SOCKET_FIT : effectiveFit(id));
    out = {
      id,
      src,
      geometry: g,
      imgStyle: { width: `${r4(g.width)}%`, left: `${r4(g.cx)}%`, top: `${r4(g.cy)}%` },
      hostStyle: { '--pf-art': String(r4(g.art)) } as CSSProperties,
    };
  }
  cache.set(key, out);
  return out;
}

/** The whole lookup: null = keep the surface's current look. */
export function resolvePortraitFrame(side: PortraitSide, frameId?: string | null, surface: FrameSurface = 'default'): ResolvedFrame | null {
  const choice = resolveFrameChoice(side, frameId);
  return choice === 'current' ? null : resolveImageFrame(choice, surface);
}

/** For the hero-select ceremony, which draws its own ring at a tuned size around the default ring's geometry:
 *  the chosen frame expressed relative to the default ring (size multiplier + centre shift in ring widths). */
export function ringRelativeToDefault(f: ResolvedFrame): { src: string; size: number; dx: number; dy: number } {
  const base = frameGeometry('default', NEUTRAL_FIT);
  return {
    src: f.src,
    size: f.geometry.width / base.width,
    dx: (f.geometry.cx - base.cx) / base.width,
    dy: (f.geometry.cy - base.cy) / base.width,
  };
}

// ── The tuner's flat view ────────────────────────────────────────────────────────────────────────────────────

/** TunerPanel edits a flat object: the pickers plus the four fit dials of whichever fit `fitTarget` names. */
export interface PortraitFrameView {
  self: string;
  opp: string;
  same: number;
  fitTarget: string;
  scale: number;
  art: number;
  dx: number;
  dy: number;
}

export function readPortraitFrameView(s: PortraitFrameState = state): PortraitFrameView {
  const fit = s.fitTarget === 'all' ? (s.fits.all ?? NEUTRAL_FIT) : effectiveFit(s.fitTarget, s);
  return { self: s.self, opp: s.opp, same: s.same ? 1 : 0, fitTarget: s.fitTarget, ...fit };
}

export function writePortraitFrameNumber(key: keyof PortraitFrameView, value: number): void {
  if (key === 'same') { setPortraitFrameState({ same: value >= 0.5 }); return; }
  if (key === 'scale' || key === 'art' || key === 'dx' || key === 'dy') {
    const t = state.fitTarget;
    // Editing a frame's fit for the first time copies the global fit into its override, then moves one dial.
    const cur = t === 'all' ? (state.fits.all ?? NEUTRAL_FIT) : effectiveFit(t);
    setPortraitFrameState({ fits: { ...state.fits, [t]: clampFit({ ...cur, [key]: value }) } });
  }
}

export function writePortraitFrameString(key: keyof PortraitFrameView, value: string): void {
  if (key === 'self' && isChoice(value)) setPortraitFrameState({ self: value });
  else if (key === 'opp' && isChoice(value)) setPortraitFrameState({ opp: value });
  else if (key === 'fitTarget' && isTarget(value)) setPortraitFrameState({ fitTarget: value });
}

/** Drop the selected frame's own fit so it follows the global one again. */
export function clearFitOverride(): void {
  const t = state.fitTarget;
  if (t === 'all') return;
  const fits = { ...state.fits };
  delete fits[t];
  setPortraitFrameState({ fits });
}

const choiceLabels = Object.fromEntries(FRAME_CHOICES.map((c) => [c, FRAME_LABELS[c]])) as Record<string, string>;
const targetLabels: Record<string, string> = { all: 'All frames (global fit)', ...Object.fromEntries(IMAGE_FRAME_IDS.map((c) => [c, `${FRAME_LABELS[c]} only`])) };

const controls: TunerControl<Extract<keyof PortraitFrameView, string>>[] = [
  { key: 'self', label: 'Your frame', kind: 'select', options: FRAME_CHOICES, optionLabels: choiceLabels, hint: 'The ring around your own hero portrait, on every surface.', group: 'Frames', min: 0, max: 0, step: 0 },
  { key: 'same', label: 'Same for everyone', kind: 'toggle', onValue: 1, offValue: 0, hint: 'On: opponents and other players wear your frame. Off: they wear the frame picked below.', group: 'Frames', min: 0, max: 1, step: 1 },
  { key: 'opp', label: 'Opponents\' frame', kind: 'select', options: FRAME_CHOICES, optionLabels: choiceLabels, hint: 'The ring around opponents and other ladder players (used when Same for everyone is off).', group: 'Frames', min: 0, max: 0, step: 0 },
  { key: 'fitTarget', label: 'Fit applies to', kind: 'select', options: ['all', ...IMAGE_FRAME_IDS], optionLabels: targetLabels, hint: 'All frames edits the global fit. Picking one frame edits an override only that frame uses.', group: 'Fit', min: 0, max: 0, step: 0 },
  { key: 'scale', label: 'Frame scale', unit: '×', hint: 'The ring\'s size over its measured seat. Above 1 the ring grows outward, below 1 it bites into the portrait.', group: 'Fit', min: FIT_RANGES.scale[0], max: FIT_RANGES.scale[1], step: FIT_RANGES.scale[2] },
  { key: 'art', label: 'Portrait scale', unit: '×', hint: 'The hero art inside the ring. Below 1 shrinks it into the hole, above 1 zooms it.', group: 'Fit', min: FIT_RANGES.art[0], max: FIT_RANGES.art[1], step: FIT_RANGES.art[2] },
  { key: 'dx', label: 'Frame offset X', unit: '%', hint: 'Slide the ring left / right, in % of the portrait\'s width.', group: 'Fit', min: FIT_RANGES.dx[0], max: FIT_RANGES.dx[1], step: FIT_RANGES.dx[2] },
  { key: 'dy', label: 'Frame offset Y', unit: '%', hint: 'Slide the ring up / down, in % of the portrait\'s height.', group: 'Fit', min: FIT_RANGES.dy[0], max: FIT_RANGES.dy[1], step: FIT_RANGES.dy[2] },
];

export const SPEC: TunerSpec<PortraitFrameView> = {
  id: 'portraitframes', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Portrait frames',
  note: 'dev · live · every hero portrait',
  read: () => readPortraitFrameView(),
  write: (key, value) => writePortraitFrameNumber(key, value),
  writeColor: (key, value) => writePortraitFrameString(key, value),
  reset: resetPortraitFrames,
  defaults: readPortraitFrameView(sanitizePortraitFrameState(DEFAULTS)),
  controls,
  // Copy JSON: the whole state (every per-frame override too), ready to paste into DEFAULTS above.
  copy: () => JSON.stringify(state, null, 2),
  copyLabel: 'Copy JSON',
};
