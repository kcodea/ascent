/**
 * THE PHONE PERF + FX LOG (R-PHONE-PERFLOG-01, owner 2026-10-26 on his iPhone, Netlify build 792caa34a: "Lots of
 * animations aren't showing on phone, and general performance is abysmal. How do we optimize this??").
 *
 * We have no Mac, so no Safari Web Inspector, and Windows emulation is not an iPhone (Playwright WebKit composites in
 * software; Chromium's 4x throttle is a proxy). So the phone measures itself, and sends the numbers home:
 *
 *  - FRAMES PER SCENE. Every presented frame (the perf monitor's frame ring, already sampled on every load: this adds no
 *    rAF loop and no per-frame work) is filed under a scene: menu, hero select, shop, drag, combat, Runeforge, game over,
 *    transition (the 2 s after a phase starts: the monitor's warm-up). Per scene: frames, seconds, p50 / p95 / p99 /
 *    worst, frames over 16.7 / 33.3 / 50 / 100 ms, long tasks. Plus a 10 s window timeline (its main scene, p95, worst,
 *    frames over budget, effects asked for and missed). Read once a second, when the monitor closes its bucket.
 *  - STATE every 15 s: WebGL contexts made / in the page / alive / lost now, loss + restore events, drawing-buffer MB;
 *    every live Pixi renderer (size, resolution, backing size, context lost); decoded <img> MB; the JS heap where the
 *    browser reports it; running animations; DOM nodes; the measured display refresh (a 30 Hz phone is in Low Power
 *    Mode); Reduce Motion. Peaks are kept.
 *  - THE FX LEDGER (fxLedger.ts): every effect asked for vs started, and why the rest did not draw.
 *
 * WHERE IT GOES. The on-screen readout (PerfLogReadout.tsx) with `?perflog=1`, and ONE row per upload into the existing
 * crash-report table (`client_crash_reports`, insert-only, no new table or column: `last_step = 'perf-report'`,
 * `session_key = 'perf:<id>@<start>'`, the log in `payload`). It uploads when the page goes hidden (the app switched
 * away or closed: a keepalive REST insert), at most MAX_UPLOADS times a session and only with new frames since the
 * last; a session the phone never got to send (it crashed, or was killed in the background) is sent on the next load;
 * and the readout has a Send button. Each upload carries the whole session so far (`seq` counts them): read the newest
 * row per session.
 *
 * Off (desktop without `?perflog=1`): nothing here subscribes, wraps or stores anything.
 */
import { FLAG_WARM, perfMonitor, type PerfBucket } from './perfMonitor';
import { dragStore } from './dragStore';
import { PERF_LOG_ON } from './perfLogFlag';
import { decodedImagesSnapshot, webglSnapshot } from './crashLog';
import { fxLedgerMisses, fxLedgerSnapshot, fxLedgerTotals, pixiAppsSnapshot, type FxLedgerRow } from './fxLedger';
import { LITE_ART, LITE_ART_REASON } from './phoneArt';
import { activeDiagLabel } from './phoneDiag';
import type { CrashInsert, CrashReportRow } from './crashReport';

export const PERF_LOG_KEY = 'ascent.perflog.v1';
export const PERF_REPORT_STEP = 'perf-report';
/** Uploads per session at most (each one the whole session so far). */
export const MAX_UPLOADS = 4;
/** Frames that must have been added since the last upload before a hidden page uploads again. */
export const MIN_NEW_FRAMES = 300;
/** The payload's JSON budget (the table refuses a payload over 64 KB). */
export const MAX_PERF_PAYLOAD_CHARS = 46_000;
const WINDOW_MS = 10_000;
const MAX_WINDOWS = 120;
const MAX_EVENTS = 120;
const SNAP_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const NEXT_LOAD_DELAY_MS = 8000;

export type PerfScene = 'menu' | 'heroselect' | 'shop' | 'drag' | 'combat' | 'runeforge' | 'gameover' | 'transition' | 'other';
export const PERF_SCENES: readonly PerfScene[] = ['menu', 'heroselect', 'shop', 'drag', 'combat', 'runeforge', 'gameover', 'transition', 'other'];
export type PerfScreen = 'menu' | 'heroselect' | 'run';

// ── pure: the frame histogram ─────────────────────────────────────────────────────────────────────────────────────

/** Bins: 0.5 ms wide under 50 ms, 5 ms to 250, 50 ms to 1000, then one overflow bin. */
export const HIST_BINS = 156;
export function binOf(ms: number): number {
  if (!(ms >= 0)) return 0;
  if (ms < 50) return Math.floor(ms * 2);
  if (ms < 250) return 100 + Math.floor((ms - 50) / 5);
  if (ms < 1000) return 140 + Math.floor((ms - 250) / 50);
  return 155;
}
/** The upper edge of a bin, ms (the overflow bin: Infinity). */
export function binUpper(i: number): number {
  if (i < 100) return (i + 1) / 2;
  if (i < 140) return 50 + (i - 99) * 5;
  if (i < 155) return 250 + (i - 139) * 50;
  return Infinity;
}

export interface FrameAcc {
  hist: Uint32Array;
  n: number; ms: number; worst: number;
  o17: number; o33: number; o50: number; o100: number;
  /** long tasks (where the browser reports them; Safari does not) and the longest */
  lt: number; ltMax: number;
}
export function newAcc(): FrameAcc {
  return { hist: new Uint32Array(HIST_BINS), n: 0, ms: 0, worst: 0, o17: 0, o33: 0, o50: 0, o100: 0, lt: 0, ltMax: 0 };
}
export function addFrame(a: FrameAcc, dt: number): void {
  a.hist[binOf(dt)]!++;
  a.n++; a.ms += dt;
  if (dt > a.worst) a.worst = dt;
  if (dt > 16.7) a.o17++;
  if (dt > 33.4) a.o33++;
  if (dt > 50) a.o50++;
  if (dt > 100) a.o100++;
}
/** Pure: the q-quantile of an accumulator, from its histogram (a bin's upper edge, never past the worst frame). */
export function quantile(a: FrameAcc, q: number): number {
  if (a.n === 0) return 0;
  const want = Math.max(1, Math.ceil(q * a.n));
  let seen = 0;
  for (let i = 0; i < HIST_BINS; i++) {
    seen += a.hist[i]!;
    if (seen >= want) return Math.min(binUpper(i), a.worst);
  }
  return a.worst;
}

export interface SceneSummary {
  /** frames, seconds of frames */ n: number; s: number;
  p50: number; p95: number; p99: number; worst: number;
  /** frames over 16.7 / 33.3 / 50 / 100 ms */ o17: number; o33: number; o50: number; o100: number;
  /** long tasks and the longest, ms (0 where unsupported) */ lt: number; ltMax: number;
}
const r1 = (n: number): number => Math.round(n * 10) / 10;
export function summarizeAcc(a: FrameAcc): SceneSummary {
  return {
    n: a.n, s: r1(a.ms / 1000),
    p50: r1(quantile(a, 0.5)), p95: r1(quantile(a, 0.95)), p99: r1(quantile(a, 0.99)), worst: r1(a.worst),
    o17: a.o17, o33: a.o33, o50: a.o50, o100: a.o100, lt: a.lt, ltMax: r1(a.ltMax),
  };
}

/** Pure: the scene a frame belongs to, from its ring flag (warm-up bit + phase code), the screen and whether a card is
 *  being dragged. A drag wins; then a warm-up (the 2 s after a phase starts) is a transition; then the screen; then the
 *  run's phase. */
export function classifyFrame(flag: number, screen: PerfScreen, dragging: boolean): PerfScene {
  if (dragging && screen === 'run') return 'drag';
  if (flag & FLAG_WARM) return 'transition';
  if (screen === 'menu') return 'menu';
  if (screen === 'heroselect') return 'heroselect';
  switch (flag >> 1) {
    case 1: return 'shop';
    case 2: return 'combat';
    case 3: return 'runeforge';
    case 4: return 'gameover';
    default: return 'other';
  }
}

/** Pure: is the frame interval (t - dt, t] inside any of the spans (a hidden page, or a drag)? `spans` are ordered;
 *  an open span has `to` = Infinity. */
export function inSpans(spans: readonly { from: number; to: number }[], t0: number, t1: number): boolean {
  for (const s of spans) if (t1 > s.from && t0 < s.to) return true;
  return false;
}

// ── the live recorder ────────────────────────────────────────────────────────────────────────────────────────────

interface WindowRec {
  /** s since the log started */ t: number;
  /** the scene with the most frames */ sc: PerfScene;
  n: number; p95: number; worst: number; o17: number; o33: number;
  /** effects asked for / not drawn in the window */ fx: number; miss: number;
}
interface StateSnap {
  t: number;
  gl: ReturnType<typeof webglSnapshot>;
  pixi: ReturnType<typeof pixiAppsSnapshot>;
  img: ReturnType<typeof decodedImagesSnapshot>;
  heap: number | null;
  anims: number; nodes: number; hz: number; hzDetected: boolean;
}

const startAt = Date.now();
const sessionId = Math.random().toString(36).slice(2, 8); // presentation only: the Math.random ban covers core/content/sim
const scenes = new Map<PerfScene, FrameAcc>();
let win = newAcc();
let winScenes = new Map<PerfScene, number>();
let winStart = 0;
let winFx = { req: 0, miss: 0 };
const windows: WindowRec[] = [];
const events: { t: number; e: string; x?: string }[] = [];
const hiddenSpans: { from: number; to: number }[] = [];
const dragSpans: { from: number; to: number }[] = [];
let lastFrameT = -1;
let totalFrames = 0;
let skippedHidden = 0;
let lastScene: PerfScene | null = null;
let lastScreen: PerfScreen | null = null;
let lastGl = { lostEvents: 0, restoredEvents: 0 };
let snap: StateSnap | null = null;
const peak = { glAlive: 0, glMb: 0, pixiAlive: 0, imgMb: 0, heap: 0, anims: 0, nodes: 0, glLostNow: 0 };
let lastSnapAt = -Infinity;
let lastLostLabels = '';
let persistQueued = false;
let uploads = 0;
let sentFrames = 0;
let lastUploadNote = '';
let deps: { insert: () => CrashInsert | null; rest: () => CrashInsert | null } | null = null;
let ltSupported = false;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);
const secs = (ms: number): number => Math.round(ms / 100) / 10;

function note(e: string, x?: string): void {
  events.push({ t: secs(now()), e, ...(x ? { x } : {}) });
  if (events.length > MAX_EVENTS) events.splice(1, events.length - MAX_EVENTS); // keep the first (boot) one
}

/** The screen right now, from the DOM (once a second, at the bucket close: three selector reads). */
function currentScreen(): PerfScreen {
  if (typeof document === 'undefined') return 'menu';
  if (document.querySelector('.heroselect')) return 'heroselect';
  if (document.querySelector('.titlescreen')) return 'menu';
  if (document.querySelector('.app')) return 'run';
  return 'menu';
}

function accFor(s: PerfScene): FrameAcc {
  let a = scenes.get(s);
  if (!a) { a = newAcc(); scenes.set(s, a); }
  return a;
}

function closeWindow(at: number): void {
  if (win.n > 0) {
    let sc: PerfScene = 'other'; let best = -1;
    for (const [k, v] of winScenes) if (v > best) { best = v; sc = k; }
    const tot = fxLedgerTotals(fxLedgerSnapshot().rows);
    const miss = missedOf(tot.out);
    windows.push({
      t: secs(winStart), sc, n: win.n, p95: r1(quantile(win, 0.95)), worst: r1(win.worst), o17: win.o17, o33: win.o33,
      fx: tot.req - winFx.req, miss: miss - winFx.miss,
    });
    if (windows.length > MAX_WINDOWS) windows.splice(0, windows.length - MAX_WINDOWS);
    winFx = { req: tot.req, miss };
  }
  win = newAcc(); winScenes = new Map(); winStart = at;
}

function missedOf(out: Partial<Record<string, number>>): number {
  let m = 0;
  for (const [k, n] of Object.entries(out)) if (n && k !== 'started' && k !== 'thinned' && k !== 'degraded' && k !== 'waiting') m += n;
  return m;
}

/** Drain the frames the monitor's ring gained since the last call and file each under its scene. */
function drain(b: PerfBucket | null): void {
  const ring = perfMonitor.frameRing();
  if (ring.n === 0) return;
  const screen = currentScreen();
  if (screen !== lastScreen) { note('screen', screen); lastScreen = screen; }
  const size = ring.dt.length;
  const start = (ring.head - ring.n + size) % size;
  let sceneOfBucket: PerfScene | null = null;
  for (let k = 0; k < ring.n; k++) {
    const i = (start + k) % size;
    const t = ring.t[i]!;
    if (t <= lastFrameT) continue;
    lastFrameT = t;
    const dt = ring.dt[i]!;
    if (inSpans(hiddenSpans, t - dt, t)) { skippedHidden++; continue; }
    const scene = classifyFrame(ring.flag[i]!, screen, inSpans(dragSpans, t - dt, t));
    sceneOfBucket = scene;
    if (scene !== lastScene) {
      if (scene !== 'drag' && lastScene !== 'drag') note('scene', scene); // drags come and go: counted, not logged
      lastScene = scene;
    }
    addFrame(accFor(scene), dt);
    addFrame(win, dt);
    winScenes.set(scene, (winScenes.get(scene) ?? 0) + 1);
    totalFrames++;
    if (t - winStart >= WINDOW_MS) closeWindow(t);
  }
  if (b && sceneOfBucket && !b.hidden) {
    const a = accFor(sceneOfBucket);
    const n = b.longTasks?.length ?? (b.task > 0 ? 1 : 0);
    a.lt += n;
    if (b.task > a.ltMax) a.ltMax = b.task;
  }
  // Trim spans no frame can fall in any more.
  while (hiddenSpans.length > 0 && hiddenSpans[0]!.to < lastFrameT) hiddenSpans.shift();
  while (dragSpans.length > 0 && dragSpans[0]!.to < lastFrameT) dragSpans.shift();
}

function takeSnap(b: PerfBucket | null): StateSnap {
  const gl = webglSnapshot();
  if (gl.lostEvents !== lastGl.lostEvents) note('gl lost', `${gl.lostEvents - lastGl.lostEvents} (alive ${gl.alive}, lost in page ${gl.lostNow})`);
  if (gl.restoredEvents !== lastGl.restoredEvents) note('gl restored', String(gl.restoredEvents - lastGl.restoredEvents));
  lastGl = { lostEvents: gl.lostEvents, restoredEvents: gl.restoredEvents };
  const pixi = pixiAppsSnapshot();
  const img = decodedImagesSnapshot();
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  let anims = 0;
  try { anims = typeof document.getAnimations === 'function' ? document.getAnimations().length : 0; } catch { /* none */ }
  const s: StateSnap = {
    t: secs(now()), gl, pixi, img, heap: mem ? r1(mem.usedJSHeapSize / 1048576) : null, anims,
    nodes: b?.nodes ?? (typeof document !== 'undefined' ? document.getElementsByTagName('*').length : 0),
    hz: perfMonitor.display.refreshHz, hzDetected: perfMonitor.display.detected,
  };
  peak.glAlive = Math.max(peak.glAlive, gl.alive); peak.glMb = Math.max(peak.glMb, gl.mb);
  peak.glLostNow = Math.max(peak.glLostNow, gl.lostNow);
  peak.pixiAlive = Math.max(peak.pixiAlive, pixi.alive.length); peak.imgMb = Math.max(peak.imgMb, img.mb);
  peak.heap = Math.max(peak.heap, s.heap ?? 0); peak.anims = Math.max(peak.anims, anims); peak.nodes = Math.max(peak.nodes, s.nodes);
  const lostLabels = pixi.alive.filter((a) => a.lost).map((a) => a.label).join(',');
  if (lostLabels !== lastLostLabels) { note(lostLabels ? 'pixi renderer lost' : 'pixi renderers ok', lostLabels || undefined); lastLostLabels = lostLabels; }
  snap = s;
  return s;
}

function onBucket(b: PerfBucket): void {
  try {
    drain(b);
    const t = now();
    if (t - lastSnapAt >= SNAP_MS) {
      lastSnapAt = t;
      // Off the frame callback: the snapshot + the stored copy (a JSON of a few tens of KB) run in their own task.
      if (!persistQueued) { persistQueued = true; window.setTimeout(() => { persistQueued = false; persist(); }, 0); }
    } else {
      // Context losses are noted the second they happen (two counter reads), not at the next 15 s snapshot.
      const gl = webglSnapshot();
      if (gl.lostEvents !== lastGl.lostEvents || gl.restoredEvents !== lastGl.restoredEvents) takeSnap(b);
    }
  } catch { /* the log never breaks the game */ }
}

// ── the payload ──────────────────────────────────────────────────────────────────────────────────────────────────

function deviceInfo(): Record<string, unknown> {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { standalone?: boolean; deviceMemory?: number };
  let standalone = nav.standalone === true;
  let reducedMotion = false;
  try {
    standalone = standalone || matchMedia('(display-mode: standalone)').matches;
    reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* no media queries */ }
  const scr = typeof screen !== 'undefined' ? screen : undefined;
  return {
    ua: nav.userAgent ?? '', standalone, reducedMotion,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    screen: { w: scr?.width ?? 0, h: scr?.height ?? 0 },
    viewport: typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : null,
    pageScale: typeof document !== 'undefined' ? Number(document.documentElement.getAttribute('data-page-scale')) || 1 : 1,
    lite: LITE_ART, liteReason: LITE_ART_REASON, diag: activeDiagLabel(),
    cores: nav.hardwareConcurrency ?? null, memoryGb: nav.deviceMemory ?? null,
    hz: perfMonitor.display.refreshHz, hzDetected: perfMonitor.display.detected,
    longTasksSupported: ltSupported,
  };
}

function buildId(): string {
  try { return `${__APP_VERSION__}+${__BUILD_SHA__}${__BUILD_DIRTY__ ? '-dirty' : ''}`; } catch { return 'unknown'; }
}

/** Pure: the ledger trimmed for the payload: totals, the worst misses, and the busiest kinds with their outcomes. */
export function ledgerForPayload(rows: Record<string, FxLedgerRow>, overflow: number): Record<string, unknown> {
  const busiest = Object.entries(rows).sort((a, b) => b[1].req - a[1].req).slice(0, 40);
  return { totals: fxLedgerTotals(rows), misses: fxLedgerMisses(rows, 25), busiest: Object.fromEntries(busiest), overflow };
}

/** The whole log as the upload's payload (the scenes, windows, events, state, the FX ledger). */
export function perfPayload(): Record<string, unknown> {
  drain(null);
  const st = takeSnap(null);
  const sc: Record<string, SceneSummary> = {};
  for (const s of PERF_SCENES) { const a = scenes.get(s); if (a && a.n > 0) sc[s] = summarizeAcc(a); }
  const all = newAcc();
  for (const a of scenes.values()) {
    for (let i = 0; i < HIST_BINS; i++) all.hist[i]! += a.hist[i]!;
    all.n += a.n; all.ms += a.ms; all.worst = Math.max(all.worst, a.worst);
    all.o17 += a.o17; all.o33 += a.o33; all.o50 += a.o50; all.o100 += a.o100; all.lt += a.lt; all.ltMax = Math.max(all.ltMax, a.ltMax);
  }
  const led = fxLedgerSnapshot();
  const counters: Record<string, number> = {};
  for (const [k, v] of Object.entries(perfMonitor.counterSnapshot())) if (/fault|ctx|culled|particles|layers|filters/.test(k)) counters[k] = v;
  return {
    v: 1, kind: 'perf',
    session: { id: sessionId, at: new Date(startAt).toISOString(), durS: secs(now()), frames: totalFrames, hiddenSkipped: skippedHidden, seq: uploads + 1 },
    device: deviceInfo(),
    build: buildId(),
    all: summarizeAcc(all),
    scenes: sc,
    windows: [...windows],
    events: [...events],
    state: st, peak: { ...peak },
    fx: ledgerForPayload(led.rows, led.overflow),
    counters,
  };
}

/** Pure: the row for a payload, trimmed (oldest windows, then events, then the busiest ledger rows) to fit. */
export function buildPerfRow(payload: Record<string, unknown>, env: { ua: string; standalone: boolean; build: string }, key: string): CrashReportRow {
  const p = { ...payload } as Record<string, unknown> & { windows?: unknown[]; events?: unknown[]; fx?: Record<string, unknown> };
  const size = (): number => JSON.stringify(p).length;
  while (size() > MAX_PERF_PAYLOAD_CHARS && Array.isArray(p.windows) && p.windows.length > 6) p.windows = p.windows.slice(Math.ceil(p.windows.length / 4));
  while (size() > MAX_PERF_PAYLOAD_CHARS && Array.isArray(p.events) && p.events.length > 10) p.events = p.events.slice(Math.ceil(p.events.length / 4));
  if (size() > MAX_PERF_PAYLOAD_CHARS && p.fx) p.fx = { ...p.fx, busiest: {} };
  return {
    last_step: PERF_REPORT_STEP,
    ua: env.ua.slice(0, 400),
    standalone: env.standalone,
    build: env.build.slice(0, 120),
    session_key: key.slice(0, 64),
    payload: p,
  };
}

const sessionKey = (): string => `perf:${sessionId}@${startAt}`;

function envOf(payload: Record<string, unknown>): { ua: string; standalone: boolean; build: string } {
  const d = (payload.device ?? {}) as { ua?: string; standalone?: boolean };
  return { ua: d.ua ?? '', standalone: d.standalone === true, build: String(payload.build ?? 'unknown') };
}

interface Persisted { key: string; frames: number; sentFrames: number; tries: number; row: CrashReportRow }

function persist(): void {
  if (!PERF_LOG_ON) return;
  try {
    const payload = perfPayload();
    const rec: Persisted = { key: sessionKey(), frames: totalFrames, sentFrames, tries: 0, row: buildPerfRow(payload, envOf(payload), sessionKey()) };
    localStorage.setItem(PERF_LOG_KEY, JSON.stringify(rec));
  } catch { /* full or blocked storage: the log is best-effort */ }
}

async function tryInsert(insert: CrashInsert, row: CrashReportRow): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(insert(row)),
      new Promise<{ error: unknown }>((r) => { timer = setTimeout(() => r({ error: 'timeout' }), REQUEST_TIMEOUT_MS); }),
    ]);
    return !res.error;
  } catch { return false; } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Send one row: the given routes in order until one succeeds. Never rejects. */
export async function sendPerfRow(row: CrashReportRow, routes: readonly (CrashInsert | null)[]): Promise<boolean> {
  for (const r of routes) if (r && await tryInsert(r, row)) return true;
  return false;
}

/** Upload the session so far. `hidden`: the page is going away, so the keepalive REST route goes first. */
export async function uploadPerfNow(hidden = false): Promise<boolean> {
  if (!PERF_LOG_ON || !deps || uploads >= MAX_UPLOADS) return false;
  const payload = perfPayload();
  const row = buildPerfRow(payload, envOf(payload), sessionKey());
  const frames = totalFrames;
  uploads++;
  let insert: CrashInsert | null = null; let rest: CrashInsert | null = null;
  try { insert = deps.insert(); } catch { insert = null; }
  try { rest = deps.rest(); } catch { rest = null; }
  const ok = await sendPerfRow(row, hidden ? [rest, insert] : [insert, rest]);
  if (ok) { sentFrames = frames; lastUploadNote = `sent #${uploads} at ${secs(now())} s`; persist(); }
  else lastUploadNote = `send #${uploads} failed at ${secs(now())} s`;
  return ok;
}

/** The previous load's session, if it has frames it never sent (it crashed, or was killed in the background). */
async function uploadPrevious(): Promise<void> {
  if (!deps) return;
  let prev: Persisted | null = null;
  try { prev = JSON.parse(localStorage.getItem(PERF_LOG_KEY) ?? 'null') as Persisted | null; } catch { prev = null; }
  if (!prev || !prev.row || prev.key === sessionKey()) return;
  if (prev.frames <= prev.sentFrames || prev.tries >= 3) { try { localStorage.removeItem(PERF_LOG_KEY); } catch { /* */ } return; }
  prev.tries++;
  try { localStorage.setItem(PERF_LOG_KEY, JSON.stringify(prev)); } catch { /* */ }
  let insert: CrashInsert | null = null; let rest: CrashInsert | null = null;
  try { insert = deps.insert(); } catch { insert = null; }
  try { rest = deps.rest(); } catch { rest = null; }
  const row = { ...prev.row, payload: { ...prev.row.payload, sentNextLoad: true } };
  if (await sendPerfRow(row, [insert, rest])) {
    try {
      // Only clear it if this load has not already written its own log over it.
      const cur = JSON.parse(localStorage.getItem(PERF_LOG_KEY) ?? 'null') as Persisted | null;
      if (cur?.key === prev.key) localStorage.removeItem(PERF_LOG_KEY);
    } catch { /* */ }
  }
}

// ── the readout's view ───────────────────────────────────────────────────────────────────────────────────────────

export interface PerfLogView {
  durS: number; frames: number; hz: number; hzDetected: boolean;
  scenes: { scene: PerfScene; sum: SceneSummary }[];
  gl: ReturnType<typeof webglSnapshot> | null;
  pixi: ReturnType<typeof pixiAppsSnapshot> | null;
  imgMb: number; heap: number | null;
  fx: { req: number; started: number; missed: number; top: { kind: string; missed: number; why: string }[] };
  upload: string; uploads: number;
}

/** A view for the readout (every 2 s; cheap: no DOM scan beyond the WebGL / image counts). */
export function perfLogView(): PerfLogView {
  drain(null);
  const rows = fxLedgerSnapshot().rows;
  const tot = fxLedgerTotals(rows);
  return {
    durS: secs(now()), frames: totalFrames, hz: perfMonitor.display.refreshHz, hzDetected: perfMonitor.display.detected,
    scenes: PERF_SCENES.filter((s) => (scenes.get(s)?.n ?? 0) > 0).map((s) => ({ scene: s, sum: summarizeAcc(scenes.get(s)!) })),
    gl: webglSnapshot(), pixi: pixiAppsSnapshot(), imgMb: decodedImagesSnapshot().mb, heap: snap?.heap ?? null,
    fx: { req: tot.req, started: tot.out.started ?? 0, missed: missedOf(tot.out), top: fxLedgerMisses(rows, 6) },
    upload: lastUploadNote, uploads,
  };
}

/** True when this load records (the readout reads it). */
export function perfLogActive(): boolean { return PERF_LOG_ON; }

// ── install ──────────────────────────────────────────────────────────────────────────────────────────────────────

let started = false;
function start(): void {
  if (!PERF_LOG_ON || started || typeof window === 'undefined') return;
  started = true;
  try { ltSupported = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] }).supportedEntryTypes?.includes('longtask') === true; } catch { ltSupported = false; }
  winStart = now();
  note('boot', `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`);
  perfMonitor.subscribe(onBucket);
  // Drag spans from the drag store (it notifies on a state change, never per pointer move).
  let dragging = false;
  dragStore.subscribe(() => {
    const on = dragStore.get().drag?.active === true;
    if (on === dragging) return;
    dragging = on;
    const t = now();
    if (on) dragSpans.push({ from: t, to: Infinity });
    else { const s = dragSpans[dragSpans.length - 1]; if (s && s.to === Infinity) s.to = t; }
  });
  document.addEventListener('visibilitychange', () => {
    const t = now();
    if (document.visibilityState === 'hidden') {
      hiddenSpans.push({ from: t, to: Infinity });
      note('hidden');
      persist();
      if (totalFrames - sentFrames >= MIN_NEW_FRAMES) void uploadPerfNow(true);
    } else {
      const s = hiddenSpans[hiddenSpans.length - 1];
      if (s && s.to === Infinity) s.to = t;
      note('visible');
    }
  });
  window.addEventListener('pagehide', () => persist());
}

/**
 * Game.tsx, once on mount: hand over the two upload routes (the Supabase client insert, the publishable-key REST
 * insert) and send the previous load's unsent session on idle. Returns the cancel for the unmount. A no-op when off.
 */
export function installPerfLog(insert: () => CrashInsert | null, rest: () => CrashInsert | null): () => void {
  if (!PERF_LOG_ON || typeof window === 'undefined') return () => {};
  start();
  deps = { insert, rest };
  const timer = window.setTimeout(() => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const go = (): void => { void uploadPrevious(); };
    if (typeof ric === 'function') ric(go, { timeout: 10_000 }); else go();
  }, NEXT_LOAD_DELAY_MS);
  return () => { window.clearTimeout(timer); };
}

start();
