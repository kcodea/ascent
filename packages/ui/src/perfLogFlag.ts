/**
 * WHETHER THE PHONE PERF LOG RECORDS THIS LOAD (R-PHONE-PERFLOG-01, owner 2026-10-26 on his iPhone: "Lots of animations
 * aren't showing on phone, and general performance is abysmal. How do we optimize this??").
 *
 * The log (phonePerfLog.ts) records on every phone (`LITE_ART`, the same gate as the crash log), and on any other browser
 * with `?perflog=1`. The on-screen readout shows with `?perflog=1` (remembered; `?perflog=0` forgets it). A desktop load
 * without the flag records nothing and pays nothing: every hook checks `PERF_LOG_ON`, a constant.
 *
 * Its own module with one dependency (phoneArt) so the FX ledger and the WebGL counter can read it without importing the
 * recorder (which pulls in the perf monitor and the stores).
 */
import { LITE_ART } from './phoneArt';

export const PERF_LOG_SHOW_KEY = 'ascent.perflog.show';

function queryFlag(): string | null {
  try { return new URLSearchParams(window.location.search).get('perflog'); } catch { return null; }
}

/** Pure: does a load record, given whether it is a phone and its `?perflog=` value and remembered show flag. */
export function perfLogWantedFor(phone: boolean, q: string | null, remembered: boolean): boolean {
  if (q === '0') return phone; // `?perflog=0` hides the readout; a phone still records (and uploads)
  return phone || q === '1' || remembered;
}

/** Pure: should the readout show (the flag, remembered until `?perflog=0`). */
export function perfReadoutWantedFor(q: string | null, remembered: boolean): boolean {
  if (q === '0') return false;
  return q === '1' || remembered;
}

function readShow(): { q: string | null; remembered: boolean } {
  if (typeof window === 'undefined') return { q: null, remembered: false };
  const q = queryFlag();
  let remembered = false;
  try {
    if (q === '1') localStorage.setItem(PERF_LOG_SHOW_KEY, '1');
    if (q === '0') localStorage.removeItem(PERF_LOG_SHOW_KEY);
    remembered = localStorage.getItem(PERF_LOG_SHOW_KEY) === '1';
  } catch { /* blocked storage: the flag alone */ }
  return { q, remembered };
}

const SHOW = readShow();

/** True when this load records the perf log (a phone, or the flag). Fixed for the session. */
export const PERF_LOG_ON: boolean = typeof window !== 'undefined' && perfLogWantedFor(LITE_ART, SHOW.q, SHOW.remembered);

/** True when the on-screen readout shows this load. */
export const PERF_READOUT_ON: boolean = perfReadoutWantedFor(SHOW.q, SHOW.remembered);
