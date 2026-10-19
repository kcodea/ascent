/**
 * PHONE CRASH BREADCRUMBS (R-TOUCH-PLAY-MEMORY-01, owner 2026-10-18: pressing Play on an iPhone crashed the page and
 * he has no Mac, so no Safari Web Inspector to see why).
 *
 * When iOS kills the page for memory nothing runs: no error, no `pagehide`. So the page writes a short trail to
 * localStorage as it goes (`crumb`): the step's name, the time since the page loaded, and the memory it can see
 * (decoded audio MB, decoded <img> count + MB, WebGL contexts, the JS heap where the browser reports it). Leaving
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
  if (c.g !== undefined) parts.push(`WebGL ${c.gl ?? 0} of ${c.g}`);
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
function measure(s: string, x?: Record<string, string | number>): Crumb {
  const c: Crumb = { s, t: Math.round(typeof performance !== 'undefined' ? performance.now() : 0) };
  try { if (probes.audio) c.a = round(probes.audio()); } catch { /* probe failed */ }
  try {
    let n = 0; let b = 0;
    for (const img of Array.from(document.images)) if (img.complete && img.naturalWidth) { n++; b += img.naturalWidth * img.naturalHeight * 4; }
    c.i = n; c.im = round(b / 1048576);
  } catch { /* no DOM */ }
  c.g = glCanvases.length;
  c.gl = glCanvases.filter((cv) => cv.isConnected).length;
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
      if (ctx && /webgl/.test(type) && !glCanvases.includes(this)) glCanvases.push(this);
      return ctx;
    } as typeof orig;
  } catch { /* leave getContext alone */ }
  crumb('boot', { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
  const markClean = (): void => { if (store?.cur && !store.cur.clean) { store.cur.clean = true; save(); } };
  window.addEventListener('pagehide', markClean);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markClean();
    else if (store?.cur) { store.cur.clean = false; crumb('resumed'); }
  });
  setInterval(() => {
    if (!store?.cur || document.visibilityState === 'hidden') return;
    store.cur.alive = measure('alive');
    save();
  }, HEARTBEAT_MS);
}

start();
