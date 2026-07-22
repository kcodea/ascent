import type { CSSProperties } from 'react';

/**
 * EXECUTE (keyword `V`) persistent aura — a swirling ring of rage: red smoke, comet arcs, glints and drifting
 * shards. Pure CSS, following the Ward/Reborn/Flurry playbook: an `.execute` stack rendered by Card.tsx, so it
 * rides drag + the combat lunge for free and vanishes the instant the sim clears the `V` keyword (no Pixi
 * persistence — that's what fought `syncShields` for ward/reborn). Pixi stays reserved for the one-shot slash
 * on the actual Execute proc.
 *
 * Replaces the old lime "Venomous" treatment (rim glow + `.venomdrip` globs), retired 2026-07-21 with the
 * Toxin -> Execute rename (#625).
 *
 * LAYERING (owner ruling): the aura paints exactly like the Ward shell — OVER the art AND the frame, but UNDER
 * the badge chrome (tier pill / atk / hp / gem). That's z4, same as `.wardglass`. NOT Flurry's z2, which sits
 * under the frame.
 *
 * PERF: every gradient, mask and blur below is STATIC paint computed once here in JS; only transform (spin,
 * drift, twinkle) and opacity (breathe) animate — per the perf rule in docs/performance.md.
 *
 * DIFFERENT CONTRACT TO `wardConfig.ts`, deliberately: Ward reflects to `--wg-*` CSS vars and therefore has to
 * mirror every shipped value as a CSS fallback. Execute's layers are GENERATED (counts are dials, so the DOM
 * itself changes), so Card.tsx builds them from DEFAULTS here and production reads this module directly. There
 * is no second copy in styles.css to keep in sync — this file is the only source of truth for the look.
 *
 * Values owner-dialled on `apps/web/public/fx/execute-preview.html` (2026-07-21).
 */
export interface ExecuteConfig {
  // ---- aura box ----
  /** Aura box size as a fraction of the card width (--ccw). */
  size: number;
  /** Vertical centre of the aura (% of the card). */
  y: number;
  /** Width squash (× — negative flips). */
  sx: number;
  /** Height squash (× — negative flips). */
  sy: number;
  /** Breathe cycle (s). 0 = steady. */
  pulse: number;
  /** Breathe dip (opacity floor). */
  pulseMin: number;

  // ---- 1 · smoke: big soft blobs on two counter-spinning rings, each blob breathing on its own clock ----
  /** Blob count (split across the two counter-spinning rings). */
  smokeCount: number;
  /** Ring radius (% of the box). */
  smokeRadius: number;
  /** Blob size (% of the box). */
  smokeSize: number;
  /** Static blur (px). */
  smokeBlur: number;
  /** Blob opacity at the trough. */
  smokeA0: number;
  /** Blob opacity at the peak. */
  smokeA1: number;
  /** Blob scale at the trough. */
  smokeSc0: number;
  /** Blob scale at the peak. */
  smokeSc1: number;
  /** Ring spin period (s). */
  smokeSpin: number;
  /** Per-blob breathe period (s). */
  smokePulse: number;

  // ---- 2 · arcs: the bright comet streaks (same construction as the Flurry blades) ----
  /** Number of concentric arc rings. */
  arcCount: number;
  /** Outermost ring diameter (× the box). */
  arcD: number;
  /** Arc width squash (× — negative flips). Separate from the box's sx. */
  arcSx: number;
  /** Arc height squash (× — negative flips). */
  arcSy: number;
  /** Diameter step between rings. */
  arcGap: number;
  /** Band thickness (% of the ring radius). */
  arcThick: number;
  /** Comets per ring. */
  arcBlades: number;
  /** Comet tail length (° of arc). */
  arcTail: number;
  /** Leading-edge sharpness (° of arc). */
  arcEdge: number;
  /** Layer opacity (0–1). */
  arcAlpha: number;
  /** Static blur (px). */
  arcBlur: number;
  /** Spin period of the outermost ring (s); inner rings scale off it. */
  arcSpin: number;

  // ---- 3 · glints: 4-point star sparkles pinned round the ring ----
  /** Glint count. */
  glintCount: number;
  /** Ring radius (% of the box). */
  glintRadius: number;
  /** Spike length (px). */
  glintLen: number;
  /** Spike thickness (px). */
  glintThick: number;
  /** Peak opacity (0–1). */
  glintAlpha: number;
  /** Twinkle period (s). */
  glintSpin: number;

  // ---- 4 · shards: small diamonds drifting outward, each with a motion tail ----
  /** Shard count. */
  shardCount: number;
  /** Ring radius (% of the box). */
  shardRadius: number;
  /** Diamond size (px). */
  shardSize: number;
  /** Motion-tail length (px). 0 = no tail. */
  shardTail: number;
  /** Static blur (px) on the shard + its tail. */
  shardBlur: number;
  /** Outward drift distance (px). */
  shardOut: number;
  /** Sweep travelled during the drift (°). */
  shardSweep: number;
  /** Peak opacity (0–1). */
  shardAlpha: number;
  /** Drift period (s). */
  shardSpin: number;

  // ---- colours ----
  /** Smoke hot core. */
  smokeHot: string;
  /** Smoke mid body. */
  smokeMid: string;
  /** Comet arc colour. */
  arcColor: string;
  /** Glint colour. */
  glintColor: string;
  /** Shard + tail colour. */
  shardColor: string;
}

/**
 * Owner-dialled, 2026-07-22 (re-tuned in-game against the real card once the live tuner existed).
 *
 * The look landed much leaner than the first pass: SMOKE and GLINTS are off entirely (`smokeCount: 0`,
 * `glintCount: 0` — their other dials are inert but kept tunable), leaving three fast counter-rotating comet
 * rings and a sparse set of long-tailed shards. `sy: -1.02` flips the box vertically; `pulse: 0.8` is a quick
 * flicker rather than a slow breath.
 */
const DEFAULTS: ExecuteConfig = {
  size: 1.41,
  y: 46,
  sx: 1,
  sy: -1.02,
  pulse: 0.8,
  pulseMin: 0.81,
  smokeCount: 0,
  smokeRadius: 0,
  smokeSize: 5,
  smokeBlur: 0,
  smokeA0: 0,
  smokeA1: 0,
  smokeSc0: 0.3,
  smokeSc1: 0.3,
  smokeSpin: 3,
  smokePulse: 1,
  arcCount: 3,
  arcD: 0.83,
  arcSx: 0.92,
  arcSy: 1.21,
  arcGap: 0.06,
  arcThick: 4.5,
  arcBlades: 6,
  arcTail: 5,
  arcEdge: 45,
  arcAlpha: 1,
  arcBlur: 6.75,
  arcSpin: 12.9,
  glintCount: 0,
  glintRadius: 0,
  glintLen: 4,
  glintThick: 1,
  glintAlpha: 0,
  glintSpin: 0.5,
  shardCount: 12,
  shardRadius: 44,
  shardSize: 7.5,
  shardTail: 90,
  shardBlur: 3,
  shardOut: 78,
  shardSweep: 4,
  shardAlpha: 0.4,
  shardSpin: 2.5,
  smokeHot: '#ff2b3f',
  smokeMid: '#7d0d1c',
  arcColor: '#ff3346',
  glintColor: '#ffd9de',
  shardColor: '#ff4258',
};

/** Colour keys — rendered as swatches by the tuner, and excluded from the numeric slider ranges. */
export const EXECUTE_COLOR_KEYS = ['smokeHot', 'smokeMid', 'arcColor', 'glintColor', 'shardColor'] as const;

/** Every numeric (slider) key. */
export type ExecuteNumKey = Exclude<keyof ExecuteConfig, (typeof EXECUTE_COLOR_KEYS)[number]>;
export const EXECUTE_KEYS = Object.keys(DEFAULTS).filter(
  (k) => !(EXECUTE_COLOR_KEYS as readonly string[]).includes(k),
) as ExecuteNumKey[];

/** Slider bounds for the DEV tuner — [min, max, step] per key. Mirrors the preview rig's ranges. */
export const EXECUTE_RANGES: Record<ExecuteNumKey, [number, number, number]> = {
  size: [0.8, 2.6, 0.01],
  y: [20, 80, 1],
  sx: [-1.8, 1.8, 0.01],
  sy: [-1.8, 1.8, 0.01],
  pulse: [0, 12, 0.1],
  pulseMin: [0.1, 1, 0.01],
  smokeCount: [0, 24, 1],
  smokeRadius: [0, 70, 1],
  smokeSize: [5, 90, 1],
  smokeBlur: [0, 60, 1],
  smokeA0: [0, 1, 0.02],
  smokeA1: [0, 1, 0.02],
  smokeSc0: [0.3, 2, 0.02],
  smokeSc1: [0.3, 2, 0.02],
  smokeSpin: [3, 90, 1],
  smokePulse: [1, 20, 0.2],
  arcCount: [0, 6, 1],
  arcD: [0.3, 1.2, 0.005],
  arcSx: [-2, 2, 0.01],
  arcSy: [-2, 2, 0.01],
  arcGap: [0, 0.3, 0.005],
  arcThick: [1, 30, 0.5],
  arcBlades: [1, 8, 1],
  arcTail: [5, 200, 1],
  arcEdge: [2, 60, 1],
  arcAlpha: [0, 1, 0.02],
  arcBlur: [0, 12, 0.25],
  arcSpin: [0.5, 20, 0.1],
  glintCount: [0, 14, 1],
  glintRadius: [0, 70, 1],
  glintLen: [4, 80, 1],
  glintThick: [1, 12, 0.5],
  glintAlpha: [0, 1, 0.02],
  glintSpin: [0.5, 10, 0.1],
  shardCount: [0, 60, 1],
  shardRadius: [0, 80, 1],
  shardSize: [1, 14, 0.5],
  shardTail: [0, 90, 1],
  shardBlur: [0, 12, 0.25],
  shardOut: [0, 120, 2],
  shardSweep: [0, 180, 2],
  shardAlpha: [0, 1, 0.02],
  shardSpin: [2, 30, 0.5],
};

/** Tuner grouping — every key appears in exactly one group (enforced by test), so a new dial can't be silently
 *  unreachable in the panel. Mirrors the preview rig's sections. */
export const EXECUTE_GROUPS: { title: string; keys: ExecuteNumKey[] }[] = [
  { title: 'Aura box', keys: ['size', 'y', 'sx', 'sy', 'pulse', 'pulseMin'] },
  { title: '1 · Smoke', keys: ['smokeCount', 'smokeRadius', 'smokeSize', 'smokeBlur', 'smokeA0', 'smokeA1', 'smokeSc0', 'smokeSc1', 'smokeSpin', 'smokePulse'] },
  { title: '2 · Arcs', keys: ['arcCount', 'arcD', 'arcSx', 'arcSy', 'arcGap', 'arcThick', 'arcBlades', 'arcTail', 'arcEdge', 'arcAlpha', 'arcBlur', 'arcSpin'] },
  { title: '3 · Glints', keys: ['glintCount', 'glintRadius', 'glintLen', 'glintThick', 'glintAlpha', 'glintSpin'] },
  { title: '4 · Shards', keys: ['shardCount', 'shardRadius', 'shardSize', 'shardTail', 'shardBlur', 'shardOut', 'shardSweep', 'shardAlpha', 'shardSpin'] },
];

/** Colour swatches, grouped for the panel. */
export const EXECUTE_COLOR_GROUPS: { title: string; keys: (typeof EXECUTE_COLOR_KEYS)[number][] }[] = [
  { title: 'Colours', keys: ['smokeHot', 'smokeMid', 'arcColor', 'glintColor', 'shardColor'] },
];

// ---------------------------------------------------------------------------------------------------------
// static paint helpers (shared construction with flurryConfig — a comet conic masked to a band)
// ---------------------------------------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
/** N comet arcs: transparent gap → tail ramp → bright leading edge → hard cut. */
function cometBg(col: string, blades: number, tail: number, edge: number): string {
  const seg = 360 / blades;
  const stops = ['from -90deg'];
  for (let i = 0; i < blades; i++) {
    const a0 = i * seg;
    const tailStart = a0 + Math.max(0, seg - tail - edge);
    const edgeStart = a0 + Math.max(0, seg - edge);
    const end = a0 + seg;
    stops.push(`${rgba(col, 0)} ${a0}deg`);
    stops.push(`${rgba(col, 0)} ${tailStart}deg`);
    stops.push(`${rgba(col, 0.5)} ${edgeStart}deg`);
    stops.push(`${rgba(col, 1)} ${end - 0.5}deg`);
    stops.push(`${rgba(col, 0)} ${end}deg`);
  }
  return `conic-gradient(${stops.join(', ')})`;
}
/** A thin feathered ring, masking the conic to a band. */
function bandMask(thick: number): string {
  const outer = 99;
  const inner = Math.max(1, outer - thick);
  return `radial-gradient(closest-side, transparent ${inner - 2}%, #fff ${inner}%, #fff ${outer - 1}%, transparent ${outer}%)`;
}

// ---------------------------------------------------------------------------------------------------------
// layer build — mirrors the preview rig's apply() exactly, so the rig stays a faithful tuning surface
// ---------------------------------------------------------------------------------------------------------
export interface ExecuteLayers {
  /** Two counter-spinning smoke rings, each a spin style + its blobs. */
  smoke: { ring: CSSProperties; blobs: CSSProperties[] }[];
  /** Arc wrapper (the width/height squash) + the spinning rings inside it. */
  arcWrap: CSSProperties;
  arcs: CSSProperties[];
  glints: CSSProperties[];
  /** Each shard: the drifting wrapper, its optional tail, and the spinning diamond body. */
  shards: { outer: CSSProperties; tail: CSSProperties | null; body: CSSProperties }[];
}

/** Build every layer's static inline style from a config. Pure — no DOM, no side effects. */
export function buildExecuteLayers(c: ExecuteConfig): ExecuteLayers {
  // 1 · SMOKE — two counter-spinning rings so the mass roils instead of turning as one rigid wheel.
  const smoke: ExecuteLayers['smoke'] = [];
  if (c.smokeCount > 0) {
    for (const rev of [false, true]) {
      const n = Math.round(c.smokeCount / 2);
      const blobs: CSSProperties[] = [];
      for (let i = 0; i < n; i++) {
        const jitter = ((i * 37) % 17) / 17; // deterministic scatter — no Math.random churn on rebuild
        blobs.push({
          width: `${c.smokeSize}%`,
          height: `${c.smokeSize}%`,
          filter: c.smokeBlur > 0 ? `blur(${c.smokeBlur}px)` : undefined,
          animationDelay: `${(-jitter * c.smokePulse).toFixed(2)}s`,
          '--ex-rot': `${i * (360 / Math.max(1, n)) + (rev ? 180 / Math.max(1, n) : 0)}deg`,
          '--ex-r': `${c.smokeRadius}%`,
          '--ex-sc0': c.smokeSc0 * (0.85 + jitter * 0.3),
          '--ex-sc1': c.smokeSc1 * (0.85 + jitter * 0.3),
          '--ex-a0': c.smokeA0,
          '--ex-a1': c.smokeA1,
          '--ex-blob-hot': rgba(c.smokeHot, 0.55),
          '--ex-blob-mid': rgba(c.smokeMid, 0.5),
          '--ex-blob-s': `${(c.smokePulse * (0.7 + jitter * 0.6)).toFixed(2)}s`,
        } as CSSProperties);
      }
      smoke.push({
        ring: {
          animationDuration: `${c.smokeSpin * (rev ? 1.6 : 1)}s`,
          animationDirection: rev ? 'reverse' : 'normal',
        },
        blobs,
      });
    }
  }

  // 2 · ARCS — each ring a touch smaller + a touch slower, alternating direction.
  const arcs: CSSProperties[] = [];
  for (let i = 0; i < c.arcCount; i++) {
    const d = c.arcD - i * c.arcGap;
    arcs.push({
      inset: `${(1 - d) * 50}%`,
      background: cometBg(c.arcColor, c.arcBlades, c.arcTail, c.arcEdge),
      WebkitMaskImage: bandMask(c.arcThick),
      maskImage: bandMask(c.arcThick),
      filter: c.arcBlur > 0 ? `blur(${c.arcBlur}px)` : undefined,
      opacity: c.arcAlpha,
      animationDuration: `${(c.arcSpin * (1 + i * 0.45)).toFixed(2)}s`,
      animationDirection: i % 2 ? 'reverse' : 'normal',
    } as CSSProperties);
  }

  // 3 · GLINTS — staggered so they twinkle round the ring rather than in unison.
  const glints: CSSProperties[] = [];
  for (let i = 0; i < c.glintCount; i++) {
    glints.push({
      animationDuration: `${c.glintSpin}s`,
      animationDelay: `${(-(i * c.glintSpin) / Math.max(1, c.glintCount)).toFixed(2)}s`,
      '--ex-rot': `${i * (360 / Math.max(1, c.glintCount)) + 18}deg`,
      '--ex-r': `${c.glintRadius}%`,
      '--ex-gw': `${c.glintLen}px`,
      '--ex-gt': `${c.glintThick}px`,
      '--ex-ga': c.glintAlpha,
      '--ex-glint-c': c.glintColor,
    } as CSSProperties);
  }

  // 4 · SHARDS — diamonds drifting outward. The outer element carries ONLY placement + drift, so its local +Y
  // points along the direction of travel and the tail can simply hang off -Y; the 45deg diamond spin lives on
  // the inner body (on the parent it would pinwheel the tail around instead of trailing).
  const shards: ExecuteLayers['shards'] = [];
  for (let i = 0; i < c.shardCount; i++) {
    const j = ((i * 53) % 23) / 23;
    const dur = `${(c.shardSpin * (0.7 + j * 0.6)).toFixed(2)}s`;
    const delay = `${(-j * c.shardSpin).toFixed(2)}s`;
    shards.push({
      outer: {
        animationDuration: dur,
        animationDelay: delay,
        filter: c.shardBlur > 0 ? `blur(${c.shardBlur}px)` : undefined,
        '--ex-ss': `${c.shardSize}px`,
        '--ex-stail': `${c.shardTail}px`,
        '--ex-rot': `${i * (360 / Math.max(1, c.shardCount))}deg`,
        '--ex-r': `${(c.shardRadius * (0.75 + j * 0.5)).toFixed(1)}%`,
        '--ex-out': `${c.shardOut}px`,
        '--ex-sweep': `${c.shardSweep}deg`,
        '--ex-sa': c.shardAlpha,
        '--ex-shard-c': c.shardColor,
      } as CSSProperties,
      tail: c.shardTail > 0 ? { animationDuration: dur, animationDelay: delay } : null,
      body: { animationDuration: dur, animationDelay: delay },
    });
  }

  return { smoke, arcWrap: { transform: `scale(${c.arcSx}, ${c.arcSy})` }, arcs, glints, shards };
}

/** Box-level CSS vars for the `.execute` element (size / seat / squash / breathe). */
export function executeBoxStyle(c: ExecuteConfig): CSSProperties {
  return {
    '--ex-size': c.size,
    '--ex-y': `${c.y}%`,
    '--ex-sx': c.sx,
    '--ex-sy': c.sy,
    '--ex-pulse': `${c.pulse > 0 ? c.pulse : 9999}s`,
    '--ex-pulse-min': c.pulse > 0 ? c.pulseMin : 1,
  } as CSSProperties;
}

// ---------------------------------------------------------------------------------------------------------
// live store — the counts are dials, so a tuner change has to REBUILD the DOM, not just poke a CSS var (which
// is all Ward needs). Card.tsx subscribes via useSyncExternalStore; in production nothing ever notifies, so the
// snapshot is built once at module load and every card shares that one frozen object.
// ---------------------------------------------------------------------------------------------------------
const KEY = 'ascent.execute';

let cfg: ExecuteConfig = (() => {
  // DEV-only persistence: a stale or corrupt key must never reach players.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<ExecuteConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

/** The cached snapshot. MUST be a stable reference between changes — useSyncExternalStore loops otherwise. */
let snapshot: { cfg: ExecuteConfig; layers: ExecuteLayers; box: CSSProperties } = {
  cfg,
  layers: buildExecuteLayers(cfg),
  box: executeBoxStyle(cfg),
};
const listeners = new Set<() => void>();

export function getExecuteConfig(): ExecuteConfig {
  return cfg;
}
export function getExecuteSnapshot(): typeof snapshot {
  return snapshot;
}
export function subscribeExecute(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function commit(): void {
  snapshot = { cfg, layers: buildExecuteLayers(cfg), box: executeBoxStyle(cfg) };
  for (const fn of listeners) fn();
}

/** Keys currently differing from the shipped DEFAULTS — drives the tuner's "modified" banner. */
export function executeOverrides(): (keyof ExecuteConfig)[] {
  return (Object.keys(DEFAULTS) as (keyof ExecuteConfig)[]).filter((k) => cfg[k] !== DEFAULTS[k]);
}

export function setExecuteValue(key: keyof ExecuteConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
  commit();
}

export function resetExecuteConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  commit();
}
