import { artMemoryStats, artQueueStats, artState } from './artPreload';
import { useGame } from './store';

/**
 * THE POP-IN PROBE (owner 2026-11-04: "i am seeing a ton of art pop in. how do we resolve that once and for all where we
 * simply never have to worry about it again?"). Opt-in (`popInFlag.ts`), lazy, and read-only as far as the game goes: it
 * watches every image the game puts on screen and reports each one that was not ready to paint the moment it mounted,
 * with why. `window.__popin.text()` is the report to paste; `.report()` the same as data.
 *
 * WHAT IT CAN SEE, per image that reaches the screen:
 *   - <img>: at the mutation (after React's commit, before the paint) it reads `complete`. Not complete = the element
 *     paints without its picture until the load event, and the wait is the load event minus the mount.
 *   - CSS images (background, mask, border-image, also on ::before / ::after): scanned off the commit, in small slices.
 *   - Complete images: `decode()` asks the compositor for the picture and times the answer against a 1 x 1 image asked at
 *     the same moment. A gap over REDECODE_MS means the compositor had dropped it and is decoding it again.
 *   - Every image the network stack saw after the boot gate opened (Resource Timing), which also catches what no DOM
 *     scan can: Pixi textures, hover-only CSS rules.
 *
 * WHAT IT CANNOT SEE: the tile a GPU draws. A blank tile on a moving layer, or a frame the compositor showed with the
 * picture missing, happens below anything a page can observe; only a trace or a screen recording proves that frame. The
 * decode() probe also warms what it asks for, so a repeat within DEDUPE_MS is not asked again.
 */

export type PopInCause =
  /** The art pipe never heard of this URL: nothing preloaded it. */
  | 'not-in-plan'
  /** The pipe knows it but had not finished it (a phone's stream, or the gate let go early). */
  | 'pipe-pending'
  /** Bytes came from the server (a 200). */
  | 'network'
  /** The browser held the bytes but asked the server first (a 304): the Cache-Control on the file. */
  | 'revalidate'
  /** Bytes came from the disk cache: Blink's memory cache had dropped them. */
  | 'disk'
  /** Loaded asynchronously with no network or disk trace (a same-document reload). */
  | 'async'
  /** The picture was loaded but the compositor had dropped its decoded pixels. */
  | 'redecode';

export interface PopInEvent {
  url: string;
  /** Short name for the report: the file name without its build hash. */
  name: string;
  kind: 'img' | 'css';
  screen: string;
  /** ms since page start. */
  at: number;
  cause: PopInCause;
  /** How long the picture was not ready after it mounted (or over the baseline, for a redecode). */
  waitMs: number;
  /** On screen when it mounted (rect in the viewport, not hidden by an ancestor)? */
  seen: boolean;
  /** Decoded size in KB, when known. */
  kb?: number;
  /** The element's `decoding` attribute: anything but `sync` lets the compositor paint a large image late. */
  decoding?: string;
  /** Element class, for finding the renderer. */
  where?: string;
}

export interface LateFetch { url: string; name: string; via: 'network' | 'revalidate' | 'disk'; initiator: string; ms: number; kb: number; screen: string; planned: boolean }

/** The compositor keeps a decoded picture for a while; more than this over the 1 x 1 baseline means it decoded again. */
export const REDECODE_MS = 8;
/** One URL is probed once in this window: seven copies of a frame in one shop are one question. */
export const DEDUPE_MS = 3000;
const MAX_EVENTS = 4000;
const IMG_FILE = /\.(webp|png|jpe?g|svg|gif|avif)(\?|$)/i;

/** `/assets/oval-beast-Ab12cD_e.webp` -> `oval-beast`. Exported for its test. */
export function shortName(url: string): string {
  const file = url.split('?')[0]!.split('/').pop() ?? url;
  return file.replace(/\.[a-z0-9]+$/i, '').replace(/-[A-Za-z0-9_-]{8}$/, '');
}

/** What a Resource Timing entry says about where the bytes came from. Exported for its test. */
export function viaOf(e: { transferSize: number; encodedBodySize: number } | undefined): 'network' | 'revalidate' | 'disk' | 'async' {
  if (!e) return 'async';
  if (e.transferSize === 0) return e.encodedBodySize > 0 ? 'disk' : 'async';
  return e.transferSize < e.encodedBodySize ? 'revalidate' : 'network';
}

/** Why an element that was not complete at mount had to wait. The plan comes first: it is the fix. Exported for its test. */
export function causeOfWait(state: ReturnType<typeof artState>, via: ReturnType<typeof viaOf>): PopInCause {
  if (state === 'unknown') return 'not-in-plan';
  if (state === 'pending') return 'pipe-pending';
  return via;
}

export interface PopInSummary {
  total: number;
  byCause: Partial<Record<PopInCause, number>>;
  byScreen: Record<string, number>;
  top: { name: string; cause: PopInCause; n: number; worstMs: number; screen: string; kind: string; url: string }[];
}

/** Fold events into what the report prints. Counts only what was on screen. Exported for its test. */
export function summarize(events: readonly PopInEvent[], topN = 25): PopInSummary {
  const seen = events.filter((e) => e.seen);
  const byCause: PopInSummary['byCause'] = {};
  const byScreen: Record<string, number> = {};
  const rows = new Map<string, PopInSummary['top'][number]>();
  for (const e of seen) {
    byCause[e.cause] = (byCause[e.cause] ?? 0) + 1;
    const scr = e.screen.replace(/ r\d+$/, '');
    byScreen[scr] = (byScreen[scr] ?? 0) + 1;
    const k = `${e.cause}|${e.url}`;
    const r = rows.get(k);
    if (r) { r.n++; r.worstMs = Math.max(r.worstMs, e.waitMs); } else rows.set(k, { name: e.name, cause: e.cause, n: 1, worstMs: e.waitMs, screen: scr, kind: e.kind, url: e.url });
  }
  const top = [...rows.values()].sort((a, b) => b.n * b.worstMs - a.n * a.worstMs).slice(0, topN);
  return { total: seen.length, byCause, byScreen, top };
}

// ─── the probe ──────────────────────────────────────────────────────────────────────────────────────────────────────

const events: PopInEvent[] = [];
const late: LateFetch[] = [];
const mounts = { img: 0, css: 0, probed: 0 };
const lastAsked = new Map<string, number>();
const lastEntry = new Map<string, PerformanceResourceTiming>();
const cssEl = new WeakMap<Element, string>();
let installed = false;
let po: PerformanceObserver | null = null;

/** Queue keys are the URL as the plan wrote it (a path); elements and stylesheets hand back absolute URLs. */
const pathOf = (u: string): string => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname + (x.search === '?mask' ? x.search : '') : x.href; } catch { return u; } };

/** The plan's key for a URL. A build with a relative base writes bundled art as an absolute URL and public art as
 *  `./frames/x.webp`; an element's attribute and a stylesheet hand back either. */
function stateOf(u: string): ReturnType<typeof artState> {
  const path = pathOf(u);
  let abs = u;
  try { abs = new URL(u, location.href).href; } catch { /* keep u */ }
  for (const k of [u, abs, `.${path}`, path]) {
    const s = artState(k);
    if (s !== 'unknown') return s;
  }
  return 'unknown';
}

function screenNow(): string {
  try {
    const s = useGame.getState();
    if (s.run && !s.showTitle) return `${s.run.phase === 'combat' ? 'combat' : s.run.phase === 'recruit' ? 'shop' : String(s.run.phase)} r${s.run.wave}`;
    if (s.heroChoices) return 'hero-select';
    if (s.showTitle) return `title:${s.titleView}`;
  } catch { /* store not up */ }
  return 'boot';
}

function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
  // The element's own opacity is the art-pending hide, which IS the pop-in: judge its ancestors.
  const parent = el.parentElement;
  return !parent || typeof parent.checkVisibility !== 'function' || parent.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

function push(e: PopInEvent): void {
  if (events.length < MAX_EVENTS) events.push(e);
}

/** A picture that takes one frame to come back from the compositor when nothing needs decoding. */
const TINY = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
function baselineDecode(): Promise<number> {
  const t = performance.now();
  const i = new Image();
  i.src = TINY;
  return i.decode().then(() => performance.now() - t, () => 0);
}

/** Ask the compositor for `img` and report how much longer it took than a picture that needs no decoding. */
function askDecode(img: HTMLImageElement): Promise<number> {
  mounts.probed++;
  const t = performance.now();
  const base = baselineDecode();
  return img.decode().then(async () => {
    const dt = performance.now() - t;
    return Math.max(0, dt - (await base));
  }, () => 0);
}

const dedupe = (url: string): boolean => {
  const now = performance.now();
  if (now - (lastAsked.get(url) ?? -1e9) < DEDUPE_MS) return false;
  lastAsked.set(url, now);
  return true;
};

const classOf = (el: Element): string => (typeof el.className === 'string' ? el.className : '').split(' ')[0] ?? '';
const decodedKb = (el: HTMLImageElement): number => Math.round(el.naturalWidth * el.naturalHeight * 4 / 1024);

function watchImg(el: HTMLImageElement): void {
  const raw = el.getAttribute('src');
  if (!raw || /^(data|blob):/i.test(raw)) return;
  mounts.img++;
  const url = pathOf(raw);
  const at = performance.now();
  const screen = screenNow();
  const state = stateOf(raw);
  const decoding = el.getAttribute('decoding') ?? 'auto';
  const where = classOf(el);
  let seen = false;
  requestAnimationFrame(() => { seen = el.isConnected && onScreen(el); });
  if (!el.complete) {
    const done = (): void => {
      el.removeEventListener('load', done); el.removeEventListener('error', done);
      const waitMs = performance.now() - at;
      // The entry is queued a task after the load event.
      window.setTimeout(() => {
        for (const r of po?.takeRecords() ?? []) note(r as PerformanceResourceTiming);
        const entry = lastEntry.get(url);
        const via = viaOf(entry && entry.startTime >= at - 50 ? entry : undefined);
        push({ url, name: shortName(url), kind: 'img', screen, at, cause: causeOfWait(state, via), waitMs: Math.round(waitMs), seen, decoding, where, kb: decodedKb(el) });
      }, 30);
    };
    el.addEventListener('load', done); el.addEventListener('error', done);
    return;
  }
  if (!dedupe(url)) return;
  void askDecode(el).then((over) => {
    if (over <= REDECODE_MS && state !== 'unknown') return;
    push({ url, name: shortName(url), kind: 'img', screen, at, cause: state === 'unknown' ? 'not-in-plan' : 'redecode', waitMs: Math.round(over), seen, decoding, where, kb: decodedKb(el) });
  });
}

const CSS_URL = /url\(["']?([^"')]+)["']?\)/g;
/** URLs seen as a mask: asked for in CORS mode, as the browser does, or the probe would load a copy of its own. */
const MASKED = new Set<string>();
function cssImages(el: Element): string[] {
  const out: string[] = [];
  for (const pseudo of [null, '::before', '::after']) {
    const cs = getComputedStyle(el, pseudo);
    if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
    for (const v of [cs.backgroundImage, cs.maskImage, cs.borderImageSource]) {
      if (!v || v === 'none' || !v.includes('url(')) continue;
      for (const m of v.matchAll(CSS_URL)) {
        if (/^(data|blob):|^#/i.test(m[1]!)) continue;
        out.push(m[1]!);
        if (v === cs.maskImage) MASKED.add(m[1]!);
      }
    }
  }
  return out;
}

function checkCss(el: Element, raw: string): void {
  mounts.css++;
  const url = pathOf(raw);
  if (!dedupe(url)) return;
  const at = performance.now();
  const screen = screenNow();
  const seen = onScreen(el);
  const state = stateOf(raw);
  const where = classOf(el);
  const img = new Image();
  if (MASKED.has(raw)) img.crossOrigin = 'anonymous';
  img.src = raw;
  const wasComplete = img.complete;
  void askDecode(img).then((over) => {
    for (const r of po?.takeRecords() ?? []) note(r as PerformanceResourceTiming);
    const entry = lastEntry.get(url);
    const via = viaOf(entry && entry.startTime >= at - 1500 ? entry : undefined);
    const base = { url, name: shortName(url), kind: 'css' as const, screen, at, seen, kb: decodedKb(img), where, decoding: 'auto' };
    if (state === 'unknown') push({ ...base, cause: 'not-in-plan', waitMs: Math.round(over) });
    else if (!wasComplete || via !== 'async') push({ ...base, cause: state === 'pending' ? 'pipe-pending' : via, waitMs: Math.round(entry?.duration ?? over) });
    else if (over > REDECODE_MS) push({ ...base, cause: 'redecode', waitMs: Math.round(over) });
  });
}

/** Elements waiting for their CSS scan: read off the commit, a few ms at a time, so the probe never holds a frame. */
const cssQueue: Element[] = [];
let cssTimer = 0;
function drainCss(): void {
  cssTimer = 0;
  const t = performance.now();
  while (cssQueue.length && performance.now() - t < 3) {
    const el = cssQueue.pop()!;
    if (!el.isConnected || !el.getClientRects().length) continue;
    const sig = cssImages(el).join('|');
    if (!sig || cssEl.get(el) === sig) continue;
    cssEl.set(el, sig);
    for (const u of sig.split('|')) checkCss(el, u);
  }
  if (cssQueue.length) cssTimer = window.setTimeout(drainCss, 16);
}
function queueCss(el: Element): void {
  if (cssQueue.length < 3000) cssQueue.push(el);
  if (!cssTimer) cssTimer = window.setTimeout(drainCss, 16);
}

function scan(node: Node): void {
  if (!(node instanceof Element)) return;
  if (node instanceof HTMLImageElement) watchImg(node);
  queueCss(node);
  for (const el of node.querySelectorAll('*')) {
    if (el instanceof HTMLImageElement) watchImg(el);
    queueCss(el);
  }
}

function note(e: PerformanceResourceTiming): void {
  if (!IMG_FILE.test(e.name)) return;
  const path = pathOf(e.name);
  lastEntry.set(path, e);
  if (!(window as unknown as { __artGate?: unknown }).__artGate) return; // the boot gate's own loading is the plan working
  const via = viaOf(e);
  if (via === 'async') return;
  const state = stateOf(e.name);
  // The pipe's own background lanes (`idle`) still load after the gate. That is the plan working, not a miss.
  if (state === 'pending') return;
  if (late.length < MAX_EVENTS) late.push({ url: path, name: shortName(path), via, initiator: e.initiatorType, ms: Math.round(e.duration), kb: Math.round(e.encodedBodySize / 1024), screen: screenNow(), planned: state !== 'unknown' });
}

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const x = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = gl && x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return 'unknown'; }
}

export interface PopInReport extends PopInSummary {
  env: Record<string, unknown>;
  mounts: typeof mounts;
  offScreen: number;
  late: { total: number; byVia: Record<string, number>; notInPlan: number; top: { name: string; via: string; n: number; initiator: string; ms: number; planned: boolean }[] };
}

function report(): PopInReport {
  const q = artQueueStats();
  const byVia: Record<string, number> = {};
  const rows = new Map<string, { name: string; via: string; n: number; initiator: string; ms: number; planned: boolean }>();
  for (const l of late) {
    byVia[l.via] = (byVia[l.via] ?? 0) + 1;
    const k = `${l.via}|${l.url}`;
    const r = rows.get(k);
    if (r) { r.n++; r.ms = Math.max(r.ms, l.ms); } else rows.set(k, { name: l.name, via: l.via, n: 1, initiator: l.initiator, ms: l.ms, planned: l.planned });
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const sum = summarize(events);
  return {
    ...sum,
    env: {
      origin: location.origin, build: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : '?', ua: navigator.userAgent, gpu: gpuName(),
      dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`, viewport: `${innerWidth}x${innerHeight}`,
      cores: navigator.hardwareConcurrency, deviceMemoryGB: nav.deviceMemory ?? null, sessionS: Math.round(performance.now() / 1000),
      gate: (window as unknown as { __artGate?: unknown }).__artGate ?? null, art: artMemoryStats(),
      queue: { done: q.done, queued: q.queued, inFlight: q.inFlight, failed: q.failed, backingOff: q.backingOff, retries: q.retries },
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    },
    mounts: { ...mounts },
    offScreen: events.length - sum.total,
    late: { total: late.length, byVia, notInPlan: late.filter((l) => !l.planned).length, top: [...rows.values()].sort((a, b) => b.n - a.n || b.ms - a.ms).slice(0, 25) },
  };
}

function text(): string {
  const r = report();
  return [
    'ASCENT pop-in report',
    JSON.stringify(r.env),
    `mounts: ${r.mounts.img} img, ${r.mounts.css} css, ${r.mounts.probed} decode probes`,
    `POP-INS on screen: ${r.total}  ${JSON.stringify(r.byCause)}`,
    `by screen: ${JSON.stringify(r.byScreen)}`,
    `off screen: ${r.offScreen}`,
    'top offenders (cause, name, count, worst ms, screen, kind):',
    ...r.top.map((t) => `  ${t.cause.padEnd(12)} ${t.name} x${t.n} ${t.worstMs}ms ${t.screen} ${t.kind}`),
    `late fetches after the gate: ${r.late.total} ${JSON.stringify(r.late.byVia)} (not in plan: ${r.late.notInPlan})`,
    ...r.late.top.map((t) => `  ${t.via.padEnd(10)} ${t.name} x${t.n} ${t.ms}ms ${t.initiator}${t.planned ? '' : ' NOT-IN-PLAN'}`),
  ].join('\n');
}

function reset(): void {
  events.length = 0; late.length = 0;
  mounts.img = 0; mounts.css = 0; mounts.probed = 0;
  lastAsked.clear();
}

/** The small on-screen panel: counts, and a button that copies the report. Plain DOM: it must not touch React's tree. */
function panel(): void {
  const el = document.createElement('div');
  el.setAttribute('data-popin-panel', '');
  el.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:2147483000;background:rgba(8,12,24,.86);color:#e8d9a8;font:11px/1.35 ui-monospace,Consolas,monospace;padding:6px 8px;border:1px solid rgba(232,217,168,.35);border-radius:4px;max-width:300px;white-space:pre-wrap';
  const body = document.createElement('div');
  const copy = document.createElement('button');
  copy.textContent = 'Copy report';
  copy.style.cssText = 'margin-top:4px;font:inherit;color:inherit;background:rgba(232,217,168,.14);border:1px solid rgba(232,217,168,.35);border-radius:3px;padding:1px 6px';
  copy.addEventListener('click', () => { void navigator.clipboard?.writeText(text()).then(() => { copy.textContent = 'Copied'; window.setTimeout(() => { copy.textContent = 'Copy report'; }, 1200); }); });
  el.append(body, copy);
  document.body.appendChild(el);
  window.setInterval(() => {
    const s = summarize(events, 0);
    body.textContent = `pop-ins ${s.total}\n${Object.entries(s.byCause).map(([k, v]) => `${k} ${v}`).join('\n')}\nlate fetches ${late.length}`;
  }, 1000);
}

export function installPopIn(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Resource Timing keeps 250 entries by default; the boot gate alone is ~2,000.
  performance.setResourceTimingBufferSize?.(20000);
  try {
    po = new PerformanceObserver((list) => { for (const e of list.getEntries()) note(e as PerformanceResourceTiming); });
    po.observe({ type: 'resource', buffered: true });
  } catch { po = null; }
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') { for (const n of r.addedNodes) if (!(n instanceof Element && n.closest('[data-popin-panel]'))) scan(n); }
      else if (r.target instanceof HTMLImageElement && r.attributeName === 'src') watchImg(r.target);
      else if (r.target instanceof Element && r.attributeName === 'class') queueCss(r.target);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class'] });
  (window as unknown as { __popin?: unknown }).__popin = { report, text, reset, events, late };
  if (document.body) panel(); else window.addEventListener('DOMContentLoaded', panel, { once: true });
}
