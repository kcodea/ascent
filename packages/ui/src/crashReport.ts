/**
 * PHONE CRASH REPORTS (R-TOUCH-CRASH-REPORT-01, owner 2026-10-22: "I still can't even play it because of the crashing,
 * but I want to make this mobile experience flawless end to end").
 *
 * crashLog.ts finds a crashed session on the next load, but only the phone in hand could read it (the readout). This
 * sends each crashed session to Supabase (`client_crash_reports`, supabase/migrations/2026-10-22-client-crash-reports.sql)
 * once, so a crash reaches us without the owner copying anything off the screen.
 *
 *  - WHEN: only while the crash log is recording this load (a phone, or `?crashlog=1`); a desktop load without the flag
 *    sends nothing. A few seconds after the game mounts, on idle: never on the boot path, never per frame.
 *  - ONCE: a session is marked sent in localStorage only after the insert succeeded. Each session gets at most
 *    MAX_ATTEMPTS tries across loads (the try is counted BEFORE the request, so a page that dies mid-upload still uses
 *    one up), one request per session per load, no retry loop.
 *  - NEVER THROWS: no backend configured (no client), offline, the table not created yet, RLS refusing: all resolve
 *    quietly. It is insert-only: no row is ever read back (the table has no select policy).
 *  - TWO ROUTES (2026-10-23, R-TOUCH-CRASH-REPORT-02: two real iPhone crashes sent nothing). The Supabase client insert
 *    first (it carries the signed-in user); when that errors, hangs or throws, the same row goes once more as a plain
 *    REST insert with only the publishable key (`fallback`: role anon, no auth client, no session refresh, no lock),
 *    in the same try. A load that starts OFFLINE waits for the `online` event before it spends a try. Safari has no
 *    `requestIdleCallback`; the delay timer then runs the upload itself (tested).
 */
import { crashedSessions, crashLogActive, lastStep, type CrashSession } from './crashLog';
import { LITE_ART } from './phoneArt';
import { activeDiagLabel } from './phoneDiag';

export const CRASH_REPORTED_KEY = 'ascent.crashlog.reported.v1';
export const CRASH_REPORT_TABLE = 'client_crash_reports';
/** Tries per crashed session, across loads. */
export const MAX_ATTEMPTS = 3;
/** The payload's JSON budget (the table refuses a payload over 64 KB; this keeps well under it). */
export const MAX_PAYLOAD_CHARS = 48_000;
/** Wait this long after the game mounts, then for idle: the title paints first. */
export const UPLOAD_DELAY_MS = 6000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REMEMBERED = 20;

/** What localStorage remembers: the sessions sent, and the tries spent on the ones not sent yet. */
export interface ReportedState { done: string[]; tries: Record<string, number> }

/** The row the client inserts. Top-level columns for filtering; everything else in `payload`. */
export interface CrashReportRow {
  last_step: string;
  ua: string;
  standalone: boolean;
  build: string;
  session_key: string;
  payload: Record<string, unknown>;
}

/** The device facts read once at upload time (injected, so the tests need no DOM). */
export interface CrashReportEnv {
  ua: string;
  standalone: boolean;
  screen: { w: number; h: number; dpr: number; vw: number; vh: number };
  build: string;
  buildDate: string;
  lite: boolean;
  diag: string;
}

export type CrashInsert = (row: CrashReportRow) => PromiseLike<{ error: unknown }>;

/** One crashed session's identity: the recorder's short id plus its start time (ids alone may repeat). */
export const sessionKey = (s: CrashSession): string => `${s.id}@${s.at}`;

export function parseReported(raw: string | null): ReportedState {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<ReportedState>) : null;
    const done = Array.isArray(v?.done) ? v!.done.filter((d): d is string => typeof d === 'string') : [];
    const tries: Record<string, number> = {};
    if (v?.tries && typeof v.tries === 'object') for (const [k, n] of Object.entries(v.tries)) if (typeof n === 'number') tries[k] = n;
    return { done, tries };
  } catch { return { done: [], tries: {} }; }
}

/** Pure: the crashed sessions still to send, oldest first: not sent yet and under MAX_ATTEMPTS tries. */
export function pendingReports(crashes: readonly CrashSession[], st: ReportedState): CrashSession[] {
  return crashes.filter((s) => {
    const k = sessionKey(s);
    return !st.done.includes(k) && (st.tries[k] ?? 0) < MAX_ATTEMPTS;
  }).reverse();
}

/** Pure: the row for one crashed session. Trims the middle crumbs (never the first, the boot) to fit the budget. */
export function buildReport(s: CrashSession, env: CrashReportEnv, crashCount: number): CrashReportRow {
  const last = lastStep(s);
  const crumbs = [...s.crumbs];
  const duration = Math.max(last?.t ?? 0, s.alive?.t ?? 0);
  const make = (): Record<string, unknown> => ({
    v: 1,
    session: { id: s.id, at: new Date(s.at).toISOString(), durationMs: duration, crumbs, alive: s.alive ?? null },
    lastStep: last ?? null,
    crashesOnRecord: crashCount,
    trimmedCrumbs: s.crumbs.length - crumbs.length,
    device: { ua: env.ua, standalone: env.standalone, screen: env.screen, lite: env.lite, diag: env.diag },
    build: { id: env.build, date: env.buildDate },
  });
  let payload = make();
  while (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS && crumbs.length > 2) { crumbs.splice(1, 1); payload = make(); }
  return {
    last_step: (last?.s ?? 'none').slice(0, 200),
    ua: env.ua.slice(0, 400),
    standalone: env.standalone,
    build: env.build.slice(0, 120),
    session_key: sessionKey(s),
    payload,
  };
}

/** Pure: remember a sent session (newest MAX_REMEMBERED) and drop the tries of sessions no longer on record. */
function settle(st: ReportedState, crashes: readonly CrashSession[]): ReportedState {
  const live = new Set(crashes.map(sessionKey));
  const tries: Record<string, number> = {};
  for (const [k, n] of Object.entries(st.tries)) if (live.has(k) && !st.done.includes(k)) tries[k] = n;
  return { done: st.done.slice(-MAX_REMEMBERED), tries };
}

export interface UploadDeps {
  crashes: readonly CrashSession[];
  insert: CrashInsert | null;
  /** The second route when `insert` fails: a plain REST insert with the publishable key (see the header). */
  fallback?: CrashInsert | null;
  env: CrashReportEnv;
  read: () => string | null;
  write: (v: string) => void;
  timeoutMs?: number;
}

/** One insert with a timeout; true when it succeeded. Never rejects. */
async function tryInsert(insert: CrashInsert, row: CrashReportRow, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(insert(row)),
      new Promise<{ error: unknown }>((r) => { timer = setTimeout(() => r({ error: 'timeout' }), timeoutMs); }),
    ]);
    return !res.error;
  } catch { return false; } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Send the pending crashed sessions, one request each, in order. Resolves to the number sent; never rejects. */
export async function uploadCrashReports(d: UploadDeps): Promise<number> {
  if ((!d.insert && !d.fallback) || d.crashes.length === 0) return 0;
  let st = parseReported(d.read());
  const save = (): void => { try { d.write(JSON.stringify(st)); } catch { /* blocked storage: best-effort */ } };
  let sent = 0;
  for (const s of pendingReports(d.crashes, st)) {
    const k = sessionKey(s);
    st.tries[k] = (st.tries[k] ?? 0) + 1;
    save(); // counted before the request: a page that dies mid-upload still spends the try
    let ok = false;
    try {
      const row = buildReport(s, d.env, d.crashes.length);
      const ms = d.timeoutMs ?? REQUEST_TIMEOUT_MS;
      if (d.insert) ok = await tryInsert(d.insert, row, ms);
      if (!ok && d.fallback) ok = await tryInsert(d.fallback, row, ms);
    } catch { ok = false; }
    if (ok) { st.done.push(k); delete st.tries[k]; sent++; }
    save();
  }
  st = settle(st, d.crashes);
  save();
  return sent;
}

function readEnv(): CrashReportEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  let standalone = nav.standalone === true;
  try { standalone = standalone || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches); } catch { /* no media queries */ }
  const scr = typeof screen !== 'undefined' ? screen : undefined;
  return {
    ua: nav.userAgent ?? '',
    standalone,
    screen: { w: scr?.width ?? 0, h: scr?.height ?? 0, dpr: window.devicePixelRatio || 1, vw: window.innerWidth, vh: window.innerHeight },
    build: `${__APP_VERSION__}+${__BUILD_SHA__}${__BUILD_DIRTY__ ? '-dirty' : ''}`,
    buildDate: __BUILD_DATE__,
    lite: LITE_ART,
    diag: activeDiagLabel(),
  };
}

/**
 * Schedule the upload (Game.tsx, once on mount). `getInsert` returns null when no backend is configured. Returns a
 * cancel for the unmount. A no-op unless the crash log is recording this load and a crash is on record.
 */
export function scheduleCrashReportUpload(
  getInsert: () => CrashInsert | null, getFallback: () => CrashInsert | null = () => null,
): () => void {
  if (typeof window === 'undefined' || !crashLogActive()) return () => {};
  // Taken NOW, at mount: the readout's Close forgets the crashes, and a quick tap on it must not cancel the report.
  const crashes = [...crashedSessions()];
  if (crashes.length === 0) return () => {};
  let idle = 0;
  let cancelled = false;
  const run = (): void => {
    if (cancelled) return;
    let insert: CrashInsert | null = null;
    let fallback: CrashInsert | null = null;
    try { insert = getInsert(); } catch { insert = null; }
    try { fallback = getFallback(); } catch { fallback = null; }
    void uploadCrashReports({
      crashes,
      insert,
      fallback,
      env: readEnv(),
      read: () => { try { return localStorage.getItem(CRASH_REPORTED_KEY); } catch { return null; } },
      write: (v) => localStorage.setItem(CRASH_REPORTED_KEY, v),
    }).catch(() => 0);
  };
  // Offline at the moment it would send (a phone on a train): wait for the network instead of spending a try.
  const whenOnline = (): void => { window.removeEventListener('online', whenOnline); run(); };
  const go = (): void => {
    if (cancelled) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { window.addEventListener('online', whenOnline); return; }
    run();
  };
  const timer = window.setTimeout(() => {
    // Safari (iOS included) has no requestIdleCallback: then the timer itself sends.
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') idle = ric(go, { timeout: 10_000 });
    else go();
  }, UPLOAD_DELAY_MS);
  return () => {
    cancelled = true;
    window.removeEventListener('online', whenOnline);
    window.clearTimeout(timer);
    const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (idle && typeof cic === 'function') cic(idle);
  };
}
