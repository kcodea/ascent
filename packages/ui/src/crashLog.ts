/**
 * PHONE CRASH BREADCRUMBS (R-TOUCH-PLAY-MEMORY-01, owner 2026-10-18: pressing Play on an iPhone crashed the page and
 * he has no Mac, so no Safari Web Inspector to see why).
 *
 * When iOS kills the page for memory nothing runs: no error, no `pagehide`. So the page writes a short trail to
 * localStorage as it goes (`crumb`): the step's name, the time since the page loaded, and the memory it can see
 * (decoded audio MB, decoded <img> count + MB, WebGL contexts, the JS heap where the browser reports it). Since
 * R-TOUCH-GPU-MEMORY-01 each step also records the WebGL contexts still ALIVE (not lost) with their drawing-buffer MB,
 * the running animations / will-change / filter counts, and the phone diagnostics switches in force (phoneDiag.ts). Leaving
 * the page normally (`pagehide`, or the page going hidden) marks the session CLEAN. A session found on the next load
 * still unclean ended without that: it crashed, after its last breadcrumb.
 *
 * Cheap by design: a write per step (tens per session) plus a heartbeat every 5 s while visible. Never per frame.
 * It records on a phone (`LITE_ART`) or with `?crashlog=1`; desktop without the flag records nothing.
 *
 * The readout (CrashLogReadout.tsx) shows with `?crashlog=1` (remembered, `?crashlog=0` forgets it), and, because a
 * Home Screen web app cannot be given a query (it always opens its start URL, with storage of its own), also in a
 * standalone phone app on the first load after a crash.
 */
import { LITE_ART } from './phoneArt';
import { activeDiagLabel } from './phoneDiag';

export const CRASH_LOG_KEY = 'ascent.crashlog.v1';
export const CRASH_LOG_SHOW_KEY = 'ascent.crashlog.show';
const MAX_CRUMBS = 40;
const MAX_CRASHES = 3;
const HEARTBEAT_MS = 5000;

/** One breadcrumb. Short keys: the whole log is a few KB of localStorage. */
export interface Crumb {
  /** step */ s: string;
  /** ms since the page loaded */ t: number;
  /** decoded audio MB */ a?: number;
  /** decoded <img> count on the page */ i?: number;
  /** decoded <img> MB on the page */ im?: number;
  /** WebGL contexts made / still in the page */ g?: number; gl?: number;
  /** WebGL contexts still ALIVE (made and not lost, in the page or not) and their drawing buffers, MB (w x h x 4) */
  ga?: number; gmb?: number;
  /** GPU-relevant DOM, counted once per step (never in the heartbeat): running animations, `will-change` elements,
   *  elements with a filter / backdrop-filter, 2D canvases in the page */
  an?: number; wc?: number; fl?: number; c2?: number;
  /** R-TOUCH-CRASH-REPORT-02 (2026-10-23), steps only: a rough COMPOSITED-LAYER estimate, MB, and how many elements went
   *  into it: every element with a running animation or `will-change`, at the size WebKit would back it (its on-screen
   *  box x DPR^2 x 4, clipped to the window; under a transformed stage its full STAGE size, see stage.ts). A model, not
   *  a reading: the browser does not expose its layers to script. */
  ly?: number; ln?: number;
  /** the live WebGL contexts' drawing buffers, `WxH` each (steps only) */ gs?: string;
  /** the phone diagnostics switches active this session (phoneDiag.ts), `nofx+res1` */ pd?: string;
  /** the stage was shrunk with CSS zoom at this step (a phone's menus), not a transform */ z?: 1;
  /** the stage was shrunk with a transform at this step (layers paid at stage size) */ xf?: 1;
  /** the browser scaled the PAGE at this step (R-PHONE-PAGESCALE-01): the page scale (layers paid at on-screen size) */ ps?: number;
  /** JS heap MB (Chrome only) */ h?: number;
  /** step details */ x?: Record<string, string | number>;
}
export interface CrashSession { id: string; at: number; clean: boolean; crumbs: Crumb[]; alive?: Crumb }
export interface CrashLogStore { cur?: CrashSession; crashes: CrashSession[] }

/** Pure: fold the stored log into a new session. An unclean previous session with any breadcrumb becomes a crash. */
export function beginSession(prev: CrashLogStore | null, id: string, at: number): CrashLogStore {
  const crashes = [...(prev?.crashes ?? [])];
  const last = prev?.cur;
  if (last && !last.clean && last.crumbs.length > 0) crashes.unshift(last);
  return { cur: { id, at, clean: false, crumbs: [] }, crashes: crashes.slice(0, MAX_CRASHES) };
}

/** Pure: add a breadcrumb, keeping the first one (the boot) and the newest MAX_CRUMBS - 1. A `progress` crumb
 *  replaces the newest one when that is the same step (so a long stream is one line, not forty). */
export function pushCrumb(session: CrashSession, c: Crumb, progress = false): void {
  const top = session.crumbs[session.crumbs.length - 1];
  if (progress && top && top.s === c.s && session.crumbs.length > 1) { session.crumbs[session.crumbs.length - 1] = c; return; }
  session.crumbs.push(c);
  if (session.crumbs.length > MAX_CRUMBS) session.crumbs.splice(1, session.crumbs.length - MAX_CRUMBS);
}

/** Pure: the step a crashed session last reached (its heartbeat counts when it is newer). */
export function lastStep(session: CrashSession): Crumb | undefined {
  const c = session.crumbs[session.crumbs.length - 1];
  if (session.alive && (!c || session.alive.t > c.t)) return { ...session.alive, s: `${c?.s ?? 'boot'} (still alive ${Math.round((session.alive.t - (c?.t ?? 0)) / 1000)} s later)` };
  return c;
}

/** Pure: one breadcrumb as a short line of plain text. */
export function describeCrumb(c: Crumb): string {
  const parts = [`${(c.t / 1000).toFixed(1)} s`];
  if (c.a !== undefined) parts.push(`audio ${c.a} MB`);
  if (c.i !== undefined) parts.push(`images ${c.i} (${c.im ?? 0} MB)`);
  if (c.ga !== undefined) parts.push(`WebGL ${c.ga} alive (${c.gl ?? 0} in page) of ${c.g ?? 0} made, ${c.gmb ?? 0} MB`);
  else if (c.g !== undefined) parts.push(`WebGL ${c.gl ?? 0} of ${c.g}`);
  if (c.an !== undefined) parts.push(`anims ${c.an}, will-change ${c.wc ?? 0}, filters ${c.fl ?? 0}, 2D canvases ${c.c2 ?? 0}`);
  if (c.ly !== undefined) parts.push(`layers est ${c.ly} MB (${c.ln ?? 0})`);
  if (c.gs) parts.push(`GL buffers ${c.gs}`);
  if (c.z) parts.push('stage zoom');
  if (c.xf) parts.push('stage transform');
  if (c.ps) parts.push(`page scale ${c.ps}`);
  if (c.pd) parts.push(`switches ${c.pd}`);
  if (c.h !== undefined) parts.push(`heap ${c.h} MB`);
  if (c.x) for (const [k, v] of Object.entries(c.x)) parts.push(`${k} ${v}`);
  return parts.join(', ');
}

// --- the live recorder ---

type Probe = () => number;
const probes: { audio?: Probe } = {};
/** Modules that own a number register it (sfx.ts the decoded audio), so this file imports none of them. */
export function registerCrashProbe(name: 'audio', p: Probe): void { probes[name] = p; }

const glCanvases: HTMLCanvasElement[] = [];
const glContexts: WebGLRenderingContext[] = [];
let store: CrashLogStore | null = null;
const onceSteps = new Set<string>();
const round = (n: number): number => Math.round(n * 10) / 10;

function queryFlag(): string | null {
  try { return new URLSearchParams(window.location.search).get('crashlog'); } catch { return null; }
}
function enabled(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  return LITE_ART || queryFlag() === '1';
}
function save(): void {
  if (!store) return;
  try { localStorage.setItem(CRASH_LOG_KEY, JSON.stringify(store)); } catch { /* full or blocked: the log is best-effort */ }
}
/** Count the GPU-relevant DOM (one style read per element, capped). Steps only: never the 5 s heartbeat. */
/** `full`: every element's style is read (steps). `anim` (a light step, R-TOUCH-CRASH-REPORT-02): only the running
 *  animations and their boxes, no per-element style read, so it can run mid-animation (the gate, the ceremony). */
function domScan(c: Crumb, full: boolean): void {
  try {
    const running = typeof document.getAnimations === 'function' ? document.getAnimations().filter((a) => a.playState === 'running') : [];
    c.an = running.length;
    const layered = new Set<Element>();
    for (const a of running) {
      const t = (a.effect as KeyframeEffect | null)?.target;
      if (t && !(t instanceof HTMLCanvasElement)) layered.add(t);
    }
    let wc = 0; let fl = 0; let n = 0;
    if (full) for (const el of Array.from(document.querySelectorAll('#root *'))) {
      if (++n > 6000) break;
      const cs = getComputedStyle(el);
      if (cs.willChange && cs.willChange !== 'auto') { wc++; if (!(el instanceof HTMLCanvasElement)) layered.add(el); }
      const bf = (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter;
      if ((cs.filter && cs.filter !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none') || (bf && bf !== 'none')) fl++;
    }
    const est = layerEstimate(layered);
    c.ly = est.mb; c.ln = est.n;
    if (!full) return;
    c.wc = wc; c.fl = fl;
    c.c2 = Array.from(document.querySelectorAll('canvas')).filter((cv) => !glCanvases.includes(cv)).length;
  } catch { /* no DOM */ }
}
/** The layer model for `domScan` (see `Crumb.ly`). Steps only, never the heartbeat; at most a few hundred rect reads. */
function layerEstimate(els: Set<Element>): { mb: number; n: number } {
  const dpr = window.devicePixelRatio || 1;
  const vw = window.innerWidth; const vh = window.innerHeight;
  const stage = document.getElementById('stage');
  const m = stage?.style.transform ? /scale\(([\d.]+)\)/.exec(stage.style.transform) : null;
  const s = m ? Number(m[1]) || 1 : 1; // a transformed stage: WebKit backs a layer at its stage size
  // A page scale (R-PHONE-PAGESCALE-01): rects are in layout px and the browser backs each layer at its on-screen size.
  const ps = Number(document.documentElement.getAttribute('data-page-scale')) || 1;
  let px = 0; let n = 0;
  for (const el of els) {
    if (++n > 400) break;
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    px += (w / s) * (h / s) * ps * ps;
  }
  return { mb: round((px * dpr * dpr * 4) / 1048576), n: Math.min(n, els.size) };
}
function measure(s: string, x?: Record<string, string | number>, scan: 'full' | 'anim' | false = 'full'): Crumb {
  const c: Crumb = { s, t: Math.round(typeof performance !== 'undefined' ? performance.now() : 0) };
  try { if (probes.audio) c.a = round(probes.audio()); } catch { /* probe failed */ }
  try {
    let n = 0; let b = 0;
    for (const img of Array.from(document.images)) if (img.complete && img.naturalWidth) { n++; b += img.naturalWidth * img.naturalHeight * 4; }
    c.i = n; c.im = round(b / 1048576);
  } catch { /* no DOM */ }
  c.g = glCanvases.length;
  c.gl = glCanvases.filter((cv) => cv.isConnected).length;
  let alive = 0; let px = 0;
  for (let k = 0; k < glCanvases.length; k++) {
    try { if (glContexts[k]?.isContextLost()) continue; } catch { continue; }
    alive++; px += glCanvases[k]!.width * glCanvases[k]!.height;
  }
  c.ga = alive; c.gmb = round((px * 4) / 1048576);
  if (scan) {
    domScan(c, scan === 'full');
    const sizes: string[] = [];
    for (let k = 0; k < glCanvases.length; k++) {
      try { if (glContexts[k]?.isContextLost()) continue; } catch { continue; }
      sizes.push(`${glCanvases[k]!.width}x${glCanvases[k]!.height}`);
    }
    if (sizes.length) c.gs = sizes.join(',');
  }
  const pd = activeDiagLabel();
  if (pd) c.pd = pd;
  try {
    const st = document.getElementById('stage')?.style;
    if (st?.zoom) c.z = 1;
    else if (st?.transform) c.xf = 1;
    const ps = Number(document.documentElement.getAttribute('data-page-scale'));
    if (ps > 0) c.ps = ps;
  } catch { /* no DOM */ }
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (mem) c.h = round(mem.usedJSHeapSize / 1048576);
  if (x) c.x = x;
  return c;
}

/** Record a step. A no-op unless the log is on (a phone, or `?crashlog=1`). */
export function crumb(step: string, x?: Record<string, string | number>): void {
  if (!store?.cur) return;
  pushCrumb(store.cur, measure(step, x));
  save();
}
/**
 * A LIGHT step (R-TOUCH-CRASH-REPORT-02): the memory numbers, the WebGL buffers and the layer estimate from the running
 * animations only, without reading every element's style. For moments that are themselves animating (the hero
 * ceremony, the launch curtain, the falling gate), where a full scan of a big screen could cost a frame.
 */
export function crumbLight(step: string, x?: Record<string, string | number>): void {
  if (!store?.cur) return;
  pushCrumb(store.cur, measure(step, x, 'anim'));
  save();
}
/** Record progress of a running step: overwrites its own previous breadcrumb while nothing else came between. */
export function crumbProgress(step: string, x?: Record<string, string | number>): void {
  if (!store?.cur) return;
  pushCrumb(store.cur, measure(step, x), true);
  save();
}
/** Record a step only the first time it happens this session (reverb built, a Pixi layer's first init). */
export function crumbOnce(step: string, x?: Record<string, string | number>): void {
  if (!store?.cur || onceSteps.has(step)) return;
  onceSteps.add(step);
  crumb(step, x);
}

/**
 * A step plus a short trail after it (R-TOUCH-GPU-MEMORY-01: the owner's phone died within 5 s of the mode home, between
 * two heartbeats): `<step> painted` two frames later, then `<step> +1 s`, `+2.5 s` and `+4 s`. Returns a cancel for an
 * unmount. A no-op (and a no-op cancel) unless the log is on.
 */
export function crumbTrail(step: string, x?: Record<string, string | number>, light = false): () => void {
  if (!store?.cur) return () => {};
  const rec = light ? crumbLight : crumb; // light: for a trail over an animation (crumbLight)
  rec(step, x);
  let raf = 0;
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => { raf = 0; rec(`${step} painted`); }); });
  const timers = [1000, 2500, 4000].map((ms) => window.setTimeout(() => rec(`${step} +${ms / 1000} s`), ms));
  return () => { if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf); timers.forEach((t) => window.clearTimeout(t)); };
}

/** True when this page load is recording (a phone, or `?crashlog=1`). The crash upload (crashReport.ts) only runs then,
 *  so a desktop load without the flag sends nothing, even with an old log in its storage. */
export function crashLogActive(): boolean { return store !== null; }
/** The crashed sessions on record, newest first. */
export function crashedSessions(): CrashSession[] { return store?.crashes ?? readStore()?.crashes ?? []; }
/** Forget the recorded crashes (the readout's Close). */
export function clearCrashes(): void {
  if (store) { store.crashes = []; save(); }
}
function readStore(): CrashLogStore | null {
  try {
    const raw = localStorage.getItem(CRASH_LOG_KEY);
    const v = raw ? (JSON.parse(raw) as CrashLogStore) : null;
    return v && Array.isArray(v.crashes) ? v : null;
  } catch { return null; }
}

/** Should the readout show: the flag (remembered), or a standalone phone app on the first load after a crash. */
export function crashReadoutWanted(): boolean {
  if (typeof window === 'undefined') return false;
  const q = queryFlag();
  try {
    if (q === '1') localStorage.setItem(CRASH_LOG_SHOW_KEY, '1');
    if (q === '0') localStorage.removeItem(CRASH_LOG_SHOW_KEY);
    if (localStorage.getItem(CRASH_LOG_SHOW_KEY) === '1') return true;
  } catch { /* blocked storage: the flag alone */ }
  if (q === '1') return true;
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true
    || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return LITE_ART && standalone && crashedSessions().length > 0;
}

function start(): void {
  if (!enabled()) return;
  const id = Math.random().toString(36).slice(2, 8); // presentation only: the Math.random ban covers core/content/sim
  store = beginSession(readStore(), id, Date.now());
  // Count WebGL contexts as they are made (one wrapper call per getContext; nothing per frame).
  try {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, opts?: unknown) {
      const ctx = (orig as (this: HTMLCanvasElement, t: string, o?: unknown) => RenderingContext | null).call(this, type, opts);
      if (ctx && /webgl/.test(type) && !glCanvases.includes(this)) { glCanvases.push(this); glContexts.push(ctx as WebGLRenderingContext); }
      return ctx;
    } as typeof orig;
  } catch { /* leave getContext alone */ }
  crumb('boot', { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
  const markClean = (): void => { if (store?.cur && !store.cur.clean) { store.cur.clean = true; save(); } };
  window.addEventListener('pagehide', markClean);
  // Back from the back/forward cache after a pagehide marked the session clean: it is live again (R-TOUCH-CRASH-REPORT-02).
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted && store?.cur) { store.cur.clean = false; crumb('resumed'); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markClean();
    else if (store?.cur) { store.cur.clean = false; crumb('resumed'); }
  });
  setInterval(() => {
    if (!store?.cur || document.visibilityState === 'hidden') return;
    store.cur.alive = measure('alive', undefined, false);
    save();
  }, HEARTBEAT_MS);
}

start();
