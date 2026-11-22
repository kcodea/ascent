/**
 * ERROR + CRASH REPORTS ON EVERY CLIENT (R-CRASH-REPORT-DESKTOP-01, owner 2026-11-22, ahead of the Steam invite-only
 * playtest on the desktop app). crashReport.ts sends a phone's crashed sessions; this sends everything else, from the
 * desktop exe, a desktop browser and a phone alike, to the same table (`client_crash_reports`):
 *
 *  - `error`        an uncaught error (window `error`)
 *  - `rejection`    an unhandled promise rejection
 *  - `render`       a crash the React ErrorBoundary caught (ErrorBoundary.tsx)
 *  - `crash-session` a session that ended without leaving the page (a killed tab / renderer), found on the next load by
 *                   a tiny sentinel in localStorage. Phones (and `?crashlog=1`) skip it: crashLog.ts already does this
 *                   with full breadcrumbs.
 *  - from the desktop shell (apps/desktop/crashReports.cjs), written to a file by the MAIN process and handed over on the
 *    next session: `renderer-gone` (crash, OOM, killed), `child-gone` (GPU / utility process), `renderer-hang`,
 *    `main-exception`, `main-rejection`.
 *
 * LIMITS: one report per error signature per session (kind + name + message + top stack frames), at most
 * MAX_PER_SESSION errors a session and MAX_PER_DAY reports a day per device; nothing is sampled. Every text is
 * redacted (`redact`: emails, tokens, keys, URL queries and fragments, the user's home folder) and capped, the step
 * trail is the last 12 step NAMES only (never their details), and a row stays under MAX_ROW_CHARS.
 *
 * COST: nothing per frame. Capturing is a few string operations on the error; the upload waits for the transport
 * (Game.tsx, after mount), then UPLOAD_DELAY_MS, then idle; one request per report per load, at most MAX_TRIES loads.
 * The sentinel writes a few hundred bytes on idle after a step (at most every SENTINEL_MIN_GAP_MS) and every
 * HEARTBEAT_MS while visible. Nothing here ever throws into the game.
 */
import { crashLogActive, onRecentStep, recentSteps, type RecentStep } from './crashLog';
import { tryInsert, type CrashInsert, type CrashReportRow } from './crashReport';
import { appInfo, clientPlatform, type ClientPlatform } from './clientPlatform';
import { takeDesktopCrashReports } from './desktop';

export const ERR_PENDING_KEY = 'ascent.errreport.pending.v1';
export const ERR_DAY_KEY = 'ascent.errreport.day.v1';
export const ERR_SENTINEL_KEY = 'ascent.errreport.sessions.v1';
/** Errors reported from one page load (crashes handed over from an earlier launch do not count here). */
export const MAX_PER_SESSION = 5;
/** Reports a day from one device (every kind). */
export const MAX_PER_DAY = 20;
/** Reports waiting to send, kept across loads. */
export const MAX_PENDING = 8;
/** Loads that may try one report. */
export const MAX_TRIES = 3;
/** A row's JSON budget (the table refuses a payload of 64 KB; error rows stay far smaller). */
export const MAX_ROW_CHARS = 16_000;
export const UPLOAD_DELAY_MS = 6000;
/** An unclean session counts as crashed only once its last sign of life is this old (another tab may still be alive). */
export const SENTINEL_STALE_MS = 45_000;
const SENTINEL_DROP_MS = 3 * 86_400_000;
const SENTINEL_MAX = 4;
const SENTINEL_MIN_GAP_MS = 5000;
const HEARTBEAT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_MESSAGE = 300;
const MAX_STACK = 3000;
const MAX_STACK_LINES = 15;
const MAX_COMPONENT_STACK = 1500;

export type ErrorKind =
  | 'error' | 'rejection' | 'render' | 'crash-session'
  | 'renderer-gone' | 'child-gone' | 'renderer-hang' | 'main-exception' | 'main-rejection';
const DESKTOP_KINDS: ReadonlySet<string> = new Set(['renderer-gone', 'child-gone', 'renderer-hang', 'main-exception', 'main-rejection']);

type Detail = Record<string, string | number | boolean>;

/** One report, as it waits in localStorage. */
export interface ErrorRecord {
  /** `session_key` (64 chars max). */
  key: string;
  kind: ErrorKind;
  /** The dedupe signature (8 hex chars). */
  sig: string;
  at: number;
  platform: ClientPlatform;
  name: string;
  message: string;
  stack: string;
  componentStack?: string;
  steps: RecentStep[];
  detail?: Detail;
  /** The load's session id it came from. */
  session: string;
  tries: number;
}

// ── redaction ────────────────────────────────────────────────────────────────────────────────────────────────────

const RULES: [RegExp, string][] = [
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[jwt]'],
  [/\b(?:sb_(?:publishable|secret)_|sk-|sk_live_|sk_test_)[A-Za-z0-9_-]{8,}/g, '[key]'],
  // a URL keeps its scheme, host and path; its query and fragment (magic-link tokens, api keys) are dropped
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'()<>]*)[?#][^\s"'()<>]*/gi, '$1?[redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b(bearer\s+)[^\s"'&,;)]+/gi, '$1[redacted]'],
  [/\b(token|apikey|api_key|access_token|refresh_token|password|secret|authorization)(\s*[=:]\s*)("?)[^\s"'&,;)]+/gi, '$1$2$3[redacted]'],
  // the player's home folder (a Windows or Unix user name) in a desktop stack or path
  [/([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/\s'"]+/gi, '$1~'],
  [/(\/(?:Users|home)\/)[^/\s'"]+/g, '$1~'],
  // any other long opaque run (a token, a hash-like secret)
  [/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]'],
];
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Pure: a text with anything personal or secret taken out, capped at `max` characters. */
export function redact(s: unknown, max = MAX_MESSAGE): string {
  let t = typeof s === 'string' ? s : s == null ? '' : String(s);
  if (t.length > max * 4) t = t.slice(0, max * 4); // bound the regex work on a huge text
  for (const [re, to] of RULES) t = t.replace(re, to);
  t = t.replace(CONTROL, '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Pure: a stack redacted, its first MAX_STACK_LINES lines, within MAX_STACK characters. */
export function redactStack(stack: unknown): string {
  if (typeof stack !== 'string' || !stack) return '';
  const lines = stack.split('\n').slice(0, MAX_STACK_LINES).map((l) => redact(l, 400));
  return lines.join('\n').slice(0, MAX_STACK);
}

// ── describing an error ──────────────────────────────────────────────────────────────────────────────────────────

/** Pure: name, message and stack of anything thrown or rejected (an Error, a string, an object, nothing). */
export function describeError(e: unknown): { name: string; message: string; stack: string } {
  try {
    if (e instanceof Error || (e && typeof e === 'object' && 'message' in (e as object))) {
      const o = e as { name?: unknown; message?: unknown; stack?: unknown };
      return { name: redact(o.name ?? 'Error', 80), message: redact(o.message), stack: redactStack(o.stack) };
    }
    if (typeof e === 'string') return { name: 'Error', message: redact(e), stack: '' };
    if (e === undefined || e === null) return { name: 'Error', message: String(e), stack: '' };
    let text = '';
    try { text = JSON.stringify(e) ?? String(e); } catch { text = String(e); }
    return { name: typeof e === 'object' ? 'Object' : typeof e, message: redact(text), stack: '' };
  } catch { return { name: 'Error', message: 'unreadable', stack: '' }; }
}

/** Pure: noise the browser raises that is not a defect (never reported). */
export function isNoise(name: string, message: string, stack: string): boolean {
  if (/^ResizeObserver loop/.test(message)) return true;
  if (/^Script error\.?$/.test(message) && !stack) return true; // a cross-origin script: no detail to act on
  if (name === 'AbortError') return true; // a cancelled fetch / play()
  return false;
}

/** Pure: FNV-1a, 32 bits, as 8 hex characters. */
export function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Pure: what makes two reports "the same error": kind, name, message (numbers folded) and the top 3 stack frames. */
export function errorSignature(kind: string, name: string, message: string, stack: string): string {
  const msg = message.replace(/\d+/g, '#').slice(0, 160);
  const frames = stack.split('\n').map((l) => l.trim()).filter((l) => /^at\s|@/.test(l)).slice(0, 3);
  return hash32(`${kind}|${name}|${msg}|${frames.join('|')}`);
}

// ── the caps ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DayCount { d: string; n: number }
export type Verdict = 'ok' | 'dup' | 'session-cap' | 'day-cap';

/** The device's day (UTC), `YYYY-MM-DD`. */
export const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

export function parseDay(raw: string | null): DayCount | null {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<DayCount>) : null;
    return v && typeof v.d === 'string' && typeof v.n === 'number' ? { d: v.d, n: v.n } : null;
  } catch { return null; }
}

/**
 * Pure: may this report go out? A signature already reported this session is a duplicate; after MAX_PER_SESSION this
 * session's errors stop (`handedOver`, a crash from an earlier launch, skips that cap); after MAX_PER_DAY on this device
 * today everything stops.
 */
export function gate(
  sig: string, seen: ReadonlySet<string>, sessionCount: number, day: DayCount | null, today: string, handedOver = false,
): Verdict {
  if (seen.has(sig)) return 'dup';
  if (!handedOver && sessionCount >= MAX_PER_SESSION) return 'session-cap';
  const n = day && day.d === today ? day.n : 0;
  if (n >= MAX_PER_DAY) return 'day-cap';
  return 'ok';
}

// ── records ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CaptureInput {
  kind: 'error' | 'rejection' | 'render';
  error: unknown;
  /** window `error` only: where it was thrown (redacted; a URL loses its query). */
  source?: string; line?: number; col?: number;
  componentStack?: string | null;
}

/** Pure: the record for a captured error, or null for noise. */
export function captureRecord(
  input: CaptureInput, ctx: { session: string; at: number; steps: RecentStep[]; platform: ClientPlatform },
): ErrorRecord | null {
  const d = describeError(input.error);
  if (isNoise(d.name, d.message, d.stack)) return null;
  const sig = errorSignature(input.kind, d.name, d.message, d.stack);
  const detail: Detail = {};
  if (input.source) detail.source = redact(input.source, 200);
  if (typeof input.line === 'number') detail.line = input.line;
  if (typeof input.col === 'number') detail.col = input.col;
  return {
    key: `${input.kind}:${ctx.session}:${sig}`.slice(0, 64),
    kind: input.kind, sig, at: ctx.at, platform: ctx.platform,
    name: d.name, message: d.message, stack: d.stack,
    ...(input.componentStack ? { componentStack: redact(input.componentStack, MAX_COMPONENT_STACK) } : {}),
    steps: ctx.steps.slice(-12).map((s) => ({ s: redact(s.s, 80), t: s.t })),
    ...(Object.keys(detail).length ? { detail } : {}),
    session: ctx.session, tries: 0,
  };
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v ? redact(v, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Pure: a desktop shell report (apps/desktop/crashReports.cjs) as a record, or null when it is not one. Every field
 *  is re-checked and redacted here: the file is the main process's, but nothing read is trusted blindly. */
export function desktopRecord(raw: unknown, session: string): ErrorRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = typeof r.kind === 'string' && DESKTOP_KINDS.has(r.kind) ? (r.kind as ErrorKind) : null;
  const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : null;
  const at = num(r.at);
  if (!kind || !id || at === undefined) return null;
  const detail: Detail = {};
  const put = (k: string, v: string | number | undefined): void => { if (v !== undefined) detail[k] = v; };
  put('reason', str(r.reason, 40)); put('exitCode', num(r.exitCode)); put('processType', str(r.processType, 40));
  put('serviceName', str(r.serviceName, 80)); put('uptimeS', num(r.uptimeS));
  const app = (r.app ?? {}) as Record<string, unknown>;
  put('exeVersion', str(app.version, 40)); put('electron', str(app.electron, 40)); put('chrome', str(app.chrome, 40));
  const os = (r.os ?? {}) as Record<string, unknown>;
  put('os', str(os.platform, 20)); put('osRelease', str(os.release, 40)); put('arch', str(os.arch, 20));
  const mem = (r.mem ?? {}) as Record<string, unknown>;
  put('memTotalMB', num(mem.totalMB)); put('memFreeMB', num(mem.freeMB));
  const name = str(r.name, 80) ?? (kind.startsWith('main') ? 'main' : str(r.processType, 40) ?? 'renderer');
  const message = str(r.message, MAX_MESSAGE) ?? str(r.reason, 40) ?? kind;
  const stack = redactStack(r.stack);
  return {
    key: `${kind}:${id}`.slice(0, 64), kind, sig: errorSignature(kind, name, message, stack), at, platform: 'desktop',
    name, message, stack, steps: [], detail, session, tries: 0,
  };
}

// ── the crashed-session sentinel ─────────────────────────────────────────────────────────────────────────────────

/** One page load's sign of life. `clean` once it left the page (or went hidden); `last` its newest sign of life. */
export interface SentinelEntry { id: string; at: number; last: number; clean: boolean; steps: RecentStep[] }

export function parseSentinel(raw: string | null): SentinelEntry[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is SentinelEntry => !!e && typeof e === 'object' && typeof (e as SentinelEntry).id === 'string'
      && typeof (e as SentinelEntry).at === 'number' && typeof (e as SentinelEntry).last === 'number'
      && Array.isArray((e as SentinelEntry).steps));
  } catch { return []; }
}

/**
 * Pure: a new load's view of the sentinel. An entry that is unclean, has a step, and showed no life for
 * SENTINEL_STALE_MS crashed (an unclean entry still fresh may be another open tab: it is kept, not reported). Clean and
 * crashed entries are dropped; entries older than 3 days go silently. `next` adds this load's own entry.
 */
export function readSentinel(prev: SentinelEntry[], id: string, now: number): { crashed: SentinelEntry[]; next: SentinelEntry[] } {
  const crashed: SentinelEntry[] = [];
  const keep: SentinelEntry[] = [];
  for (const e of prev) {
    if (e.clean || now - e.last > SENTINEL_DROP_MS) continue;
    if (now - e.last >= SENTINEL_STALE_MS) { if (e.steps.length > 0) crashed.push(e); continue; }
    keep.push(e);
  }
  const next = [...keep.slice(-(SENTINEL_MAX - 1)), { id, at: now, last: now, clean: false, steps: [] }];
  return { crashed, next };
}

/** Pure: the record for a crashed session. */
export function crashSessionRecord(e: SentinelEntry, session: string, platform: ClientPlatform): ErrorRecord {
  const last = e.steps[e.steps.length - 1];
  const message = `ended without leaving the page after ${last ? redact(last.s, 80) : 'no step'}`;
  return {
    key: `crash-session:${e.id}@${e.at}`.slice(0, 64), kind: 'crash-session', sig: hash32(`crash-session|${e.id}|${e.at}`),
    at: e.last, platform, name: 'crash-session', message, stack: '',
    steps: e.steps.slice(-12), detail: { durationMs: Math.max(0, e.last - e.at) }, session, tries: 0,
  };
}

/**
 * Pure: one crash told twice, once by the desktop shell (`renderer-gone`, with the reason) and once by the sentinel
 * (`crash-session`, with the steps), becomes ONE report: the shell's, carrying the session's steps. A crashed session
 * pairs with a renderer-gone report whose time is within 2 minutes of the session's last sign of life.
 */
export function mergeDesktopCrashes(sessions: ErrorRecord[], desktop: ErrorRecord[]): ErrorRecord[] {
  const left = [...sessions];
  const out = desktop.map((d) => {
    if (d.kind !== 'renderer-gone') return d;
    const i = left.findIndex((s) => Math.abs(s.at - d.at) <= 120_000);
    if (i < 0) return d;
    const [s] = left.splice(i, 1);
    return { ...d, steps: s!.steps, detail: { ...(d.detail ?? {}), ...(s!.detail ?? {}) } };
  });
  return [...out, ...left];
}

// ── the row ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RowEnv { ua: string; standalone: boolean; screen: { w: number; h: number; dpr: number; vw: number; vh: number } }

/** Pure: the row for one record; the stack, then the steps, are trimmed to keep it under MAX_ROW_CHARS. */
export function buildErrorRow(rec: ErrorRecord, env: RowEnv, app: { version: string; sha: string; date: string; dirty: boolean }): CrashReportRow {
  let stack = rec.stack;
  let steps = rec.steps;
  const make = (): Record<string, unknown> => ({
    v: 2, kind: rec.kind, platform: rec.platform, app,
    error: { name: rec.name, message: rec.message, stack, sig: rec.sig },
    ...(rec.componentStack ? { componentStack: rec.componentStack } : {}),
    ...(rec.detail ? { detail: rec.detail } : {}),
    steps, session: rec.session, at: new Date(rec.at).toISOString(),
    device: { screen: env.screen },
  });
  let payload = make();
  while (JSON.stringify(payload).length > MAX_ROW_CHARS && (stack.length > 0 || steps.length > 0)) {
    if (stack.length > 500) stack = stack.slice(0, Math.floor(stack.length / 2));
    else if (steps.length > 0) steps = steps.slice(1);
    else stack = '';
    payload = make();
  }
  return {
    last_step: redact(`${rec.kind}: ${rec.name}: ${rec.message}`, 200),
    ua: redact(env.ua, 400),
    standalone: env.standalone,
    build: `${app.version}+${app.sha}${app.dirty ? '-dirty' : ''}`.slice(0, 120),
    session_key: rec.key.slice(0, 64),
    payload,
  };
}

export function parsePending(raw: string | null): ErrorRecord[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(v)) return [];
    return v.filter((r): r is ErrorRecord => !!r && typeof r === 'object' && typeof (r as ErrorRecord).key === 'string'
      && typeof (r as ErrorRecord).kind === 'string' && typeof (r as ErrorRecord).tries === 'number'
      && Array.isArray((r as ErrorRecord).steps)).slice(-MAX_PENDING);
  } catch { return []; }
}

// ── the live reporter ────────────────────────────────────────────────────────────────────────────────────────────

/** Storage + clock + transport, injected so the tests run the whole flow with no DOM. */
export interface ReporterDeps {
  read: (key: string) => string | null;
  write: (key: string, v: string) => void;
  now: () => number;
  env: () => RowEnv;
  /** Schedule `fn` off the hot path (idle, or a timer); `delayMs` first. */
  later: (fn: () => void, delayMs: number) => void;
  online: () => boolean;
  /** Call `fn` once when the network comes back. */
  whenOnline: (fn: () => void) => void;
}

export interface Reporter {
  capture: (input: CaptureInput) => void;
  /** Crashes from an earlier launch (the sentinel's, the desktop shell's): skip the per-session cap. */
  handOver: (recs: ErrorRecord[]) => void;
  setTransport: (getInsert: () => CrashInsert | null, getFallback?: () => CrashInsert | null) => void;
  /** Resolves when the current flush (if any) finished. Tests only. */
  idle: () => Promise<void>;
  pending: () => ErrorRecord[];
  session: string;
}

export function createReporter(deps: ReporterDeps, session: string, platform: ClientPlatform, steps: () => RecentStep[]): Reporter {
  const seen = new Set<string>();
  let sessionCount = 0;
  let pending = parsePending(safeRead(deps, ERR_PENDING_KEY));
  for (const p of pending) seen.add(p.sig);
  const attempted = new Set<string>();
  let transport: { insert: () => CrashInsert | null; fallback: () => CrashInsert | null } | null = null;
  let scheduled = false;
  let again = false;
  let flushing: Promise<void> | null = null;
  let firstFlush = true;

  const persist = (): void => { safeWrite(deps, ERR_PENDING_KEY, JSON.stringify(pending)); };

  const add = (rec: ErrorRecord, handedOver: boolean): void => {
    const today = dayOf(deps.now());
    const day = parseDay(safeRead(deps, ERR_DAY_KEY));
    if (pending.some((p) => p.key === rec.key)) return;
    const v = gate(rec.sig, seen, sessionCount, day, today, handedOver);
    if (v !== 'ok') return;
    seen.add(rec.sig);
    if (!handedOver) sessionCount++;
    pending.push(rec);
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
    safeWrite(deps, ERR_DAY_KEY, JSON.stringify({ d: today, n: (day && day.d === today ? day.n : 0) + 1 }));
    persist();
    schedule();
  };

  const flush = async (): Promise<void> => {
    if (!transport) return;
    let insert: CrashInsert | null = null;
    let fallback: CrashInsert | null = null;
    try { insert = transport.insert(); } catch { insert = null; }
    try { fallback = transport.fallback(); } catch { fallback = null; }
    if (!insert && !fallback) return;
    const app = appInfo();
    let env: RowEnv;
    try { env = deps.env(); } catch { env = { ua: '', standalone: false, screen: { w: 0, h: 0, dpr: 1, vw: 0, vh: 0 } }; }
    for (const rec of [...pending]) {
      if (attempted.has(rec.key)) continue; // one try per report per load: no retry loop
      attempted.add(rec.key);
      rec.tries += 1;
      persist(); // counted before the request: a page that dies mid-upload still spends the try
      let ok = false;
      try {
        const row = buildErrorRow(rec, env, app);
        if (insert) ok = await tryInsert(insert, row, REQUEST_TIMEOUT_MS);
        if (!ok && fallback) ok = await tryInsert(fallback, row, REQUEST_TIMEOUT_MS);
      } catch { ok = false; }
      if (ok || rec.tries >= MAX_TRIES) pending = pending.filter((p) => p.key !== rec.key);
      persist();
    }
  };

  const run = (): void => {
    scheduled = false;
    if (!deps.online()) { deps.whenOnline(() => schedule()); return; }
    flushing = flush().catch(() => undefined).finally(() => {
      flushing = null;
      if (again) { again = false; schedule(); }
    });
  };

  function schedule(): void {
    if (!transport || pending.every((p) => attempted.has(p.key))) return;
    if (flushing) { again = true; return; }
    if (scheduled) return;
    scheduled = true;
    const delay = firstFlush ? UPLOAD_DELAY_MS : 2000;
    firstFlush = false;
    try { deps.later(run, delay); } catch { scheduled = false; }
  }

  return {
    session,
    capture: (input) => {
      try {
        const rec = captureRecord(input, { session, at: deps.now(), steps: steps(), platform });
        if (rec) add(rec, false);
      } catch { /* never throws into the game */ }
    },
    handOver: (recs) => { for (const r of recs) { try { add(r, true); } catch { /* skip it */ } } },
    setTransport: (getInsert, getFallback = () => null) => {
      transport = { insert: getInsert, fallback: getFallback };
      schedule();
    },
    idle: async () => { while (flushing) await flushing; },
    pending: () => pending.map((p) => ({ ...p })),
  };
}

function safeRead(d: ReporterDeps, k: string): string | null { try { return d.read(k); } catch { return null; } }
function safeWrite(d: ReporterDeps, k: string, v: string): void { try { d.write(k, v); } catch { /* full or blocked storage */ } }

// ── wiring (main.tsx installs it first thing; Game.tsx hands it the transport; ErrorBoundary reports) ──────────────

let reporter: Reporter | null = null;

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };

function browserDeps(): ReporterDeps {
  return {
    read: (k) => localStorage.getItem(k),
    write: (k, v) => localStorage.setItem(k, v),
    now: () => Date.now(),
    env: () => {
      const nav = navigator as Navigator & { standalone?: boolean };
      let standalone = nav.standalone === true;
      try { standalone = standalone || matchMedia('(display-mode: standalone)').matches; } catch { /* no media queries */ }
      return {
        ua: nav.userAgent ?? '', standalone,
        screen: { w: screen?.width ?? 0, h: screen?.height ?? 0, dpr: window.devicePixelRatio || 1, vw: window.innerWidth, vh: window.innerHeight },
      };
    },
    later: (fn, delayMs) => {
      window.setTimeout(() => {
        const ric = (window as IdleWindow).requestIdleCallback;
        if (typeof ric === 'function') ric(fn, { timeout: 10_000 }); else fn(); // Safari: the timer sends
      }, delayMs);
    },
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    whenOnline: (fn) => {
      const on = (): void => { window.removeEventListener('online', on); fn(); };
      window.addEventListener('online', on);
    },
  };
}

/** The sentinel (desktop exe + desktop browser; a phone's crashLog.ts does this already). Returns this load's crashes. */
function installSentinel(deps: ReporterDeps, id: string, platform: ClientPlatform): ErrorRecord[] {
  const { crashed, next } = readSentinel(parseSentinel(safeRead(deps, ERR_SENTINEL_KEY)), id, deps.now());
  let entries = next;
  const mine = (): SentinelEntry | undefined => entries.find((e) => e.id === id);
  let lastSave = 0;
  let saveQueued = false;
  const save = (): void => {
    saveQueued = false;
    // Re-read: another tab may have written its own entry since.
    const others = parseSentinel(safeRead(deps, ERR_SENTINEL_KEY)).filter((e) => e.id !== id);
    const me = mine();
    if (me) { me.steps = recentSteps(); if (!me.clean) me.last = deps.now(); }
    entries = [...others.slice(-(SENTINEL_MAX - 1)), ...(me ? [me] : [])];
    lastSave = deps.now();
    safeWrite(deps, ERR_SENTINEL_KEY, JSON.stringify(entries));
  };
  const queueSave = (): void => {
    if (saveQueued) return;
    saveQueued = true;
    deps.later(save, Math.max(0, SENTINEL_MIN_GAP_MS - (deps.now() - lastSave)));
  };
  save();
  onRecentStep(queueSave);
  const setClean = (clean: boolean): void => { const me = mine(); if (me) { me.clean = clean; save(); } };
  window.addEventListener('pagehide', () => setClean(true));
  window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) setClean(false); });
  document.addEventListener('visibilitychange', () => setClean(document.visibilityState === 'hidden'));
  window.setInterval(() => { if (document.visibilityState !== 'hidden') queueSave(); }, HEARTBEAT_MS);
  return crashed.map((e) => crashSessionRecord(e, id, platform));
}

/**
 * Install the reporter: the global listeners, the sentinel, and the desktop shell's hand-over. Idempotent; never
 * throws. Nothing is sent until `setErrorReportTransport` (Game.tsx, after mount).
 */
export function installErrorReporting(): void {
  if (reporter || typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const deps = browserDeps();
    const platform = clientPlatform();
    const id = Math.random().toString(36).slice(2, 8); // presentation only: the Math.random ban covers core/content/sim
    const rep = createReporter(deps, id, platform, recentSteps);
    reporter = rep;
    window.addEventListener('error', (e: ErrorEvent) => {
      rep.capture({ kind: 'error', error: e.error ?? e.message, source: e.filename, line: e.lineno, col: e.colno });
    });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => { rep.capture({ kind: 'rejection', error: e.reason }); });
    let crashed: ErrorRecord[] = [];
    try { if (!crashLogActive()) crashed = installSentinel(deps, id, platform); } catch { crashed = []; }
    if (platform === 'desktop') {
      void takeDesktopCrashReports().then((raw) => {
        const desk = raw.map((r) => desktopRecord(r, id)).filter((r): r is ErrorRecord => r !== null);
        rep.handOver(mergeDesktopCrashes(crashed, desk));
      }, () => rep.handOver(crashed));
    } else rep.handOver(crashed);
  } catch { /* reporting is best-effort */ }
}

/** Report an error caught somewhere else (the ErrorBoundary). Never throws. */
export function reportError(kind: CaptureInput['kind'], error: unknown, componentStack?: string | null): void {
  try { reporter?.capture({ kind, error, componentStack }); } catch { /* best-effort */ }
}

/** Hand the reporter its inserts (Game.tsx, once on mount): the pending reports go out a few seconds later, on idle. */
export function setErrorReportTransport(getInsert: () => CrashInsert | null, getFallback?: () => CrashInsert | null): void {
  try { reporter?.setTransport(getInsert, getFallback); } catch { /* best-effort */ }
}
