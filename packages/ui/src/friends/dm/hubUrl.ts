/**
 * WHERE THE FRIENDS HUB IS (R-DM-01). One stable Worker for every build (`ascent-hub`, owner 2026-10-29), so the URL is
 * the same for every pack: it is baked in by the release script (`VITE_FRIENDS_HUB_URL`, only with `--versus-cf`) and
 * trusted only when it is exactly the live hub. A build without it has no hub: messages show as not available and the
 * friends list keeps working on its presence beat.
 *
 * DEV: a dev build (or a browser with the Versus test tools on) may point at a local `npm run hub:dev` with
 * `?hubUrl=http://127.0.0.1:8788` (kept for the tab; `?hubUrl=off` clears it).
 */
import { FRIENDS_HUB_LIVE_URL } from '@game/versus-cf/hub';

const KEY = 'ascent.hubUrl';

/** The baked URL, trusted only when it is the live hub (a typo never sends players elsewhere). */
export function bakedHubUrl(raw: string | undefined): string | null {
  const url = (raw ?? '').trim().replace(/\/$/, '');
  return url === FRIENDS_HUB_LIVE_URL ? url : null;
}

function devHubUrl(): string | null {
  try {
    if (typeof window === 'undefined' || !(import.meta.env.DEV || localStorage.getItem('ascent.versus') === '1')) return null;
    const q = new URLSearchParams(window.location.search).get('hubUrl');
    if (q === 'off') sessionStorage.removeItem(KEY);
    else if (q && (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(q) || q === FRIENDS_HUB_LIVE_URL)) sessionStorage.setItem(KEY, q);
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let cached: string | null | undefined;
export function friendsHubUrl(): string | null {
  if (cached === undefined) cached = devHubUrl() ?? bakedHubUrl(import.meta.env.VITE_FRIENDS_HUB_URL as string | undefined);
  return cached;
}
