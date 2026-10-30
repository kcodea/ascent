/**
 * WHERE THE FRIENDS HUB IS (R-DM-01, R-DM-HUB-URL-01). One stable Worker for every build (`ascent-hub`, owner
 * 2026-10-29), so the URL is the same for every build and needs no per-pack setting:
 *
 *   1. DEV override: a dev build (or a browser with the Versus test tools on) may point at a local `npm run hub:dev` with
 *      `?hubUrl=http://127.0.0.1:8788` (kept for the tab; `?hubUrl=off` clears it).
 *   2. The baked URL (`VITE_FRIENDS_HUB_URL`, set by `release:web -- --versus-cf`), trusted only when it is exactly the
 *      live hub (a typo never sends players elsewhere).
 *   3. OTHERWISE the live hub, whenever this page's origin is one the hub accepts (`HUB_PAGE_ORIGINS`, the hub's
 *      `ALLOWED_ORIGINS`): the Netlify site and a local dev server. This is the fix for "why are messages unavailable?"
 *      (owner 2026-10-29): a build without the release flag (a dev server, a pack cut without `--versus-cf`) used to carry
 *      no hub at all, so every chat said "Messages are not available right now." even though the hub was up. A page the
 *      hub would refuse (the desktop app's `app://` origin, an unknown host) still gets no hub: it would only be refused.
 */
import { FRIENDS_HUB_LIVE_URL } from '@game/versus-cf/hub';

const KEY = 'ascent.hubUrl';

/**
 * The page origins the live hub accepts: a copy of `ALLOWED_ORIGINS` in `workers/versus/hub.wrangler.toml` (a test keeps
 * the two equal). `*` matches a port.
 */
export const HUB_PAGE_ORIGINS = ['https://ascent-game-web.netlify.app', 'http://localhost:*', 'http://127.0.0.1:*'] as const;

/** The baked URL, trusted only when it is the live hub (a typo never sends players elsewhere). */
export function bakedHubUrl(raw: string | undefined): string | null {
  const url = (raw ?? '').trim().replace(/\/$/, '');
  return url === FRIENDS_HUB_LIVE_URL ? url : null;
}

/** The live hub when the hub accepts this page's origin, else null (it would refuse the socket). */
export function defaultHubUrl(origin: string | null | undefined): string | null {
  if (!origin) return null;
  const o = origin.toLowerCase();
  for (const pat of HUB_PAGE_ORIGINS) {
    // `*` is a port: everything before it must match exactly, and only digits may follow.
    const star = pat.indexOf('*');
    if (star < 0 ? o === pat : o.startsWith(pat.slice(0, star)) && /^[0-9]+$/.test(o.slice(star))) return FRIENDS_HUB_LIVE_URL;
  }
  return null;
}

/** A hub that accepts dev tokens (`dev.<userId>.dev`): a local one only, never the live hub. */
export const isLocalHub = (url: string): boolean => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);

function devHubUrl(): string | null {
  try {
    if (typeof window === 'undefined' || !(import.meta.env.DEV || localStorage.getItem('ascent.versus') === '1')) return null;
    const q = new URLSearchParams(window.location.search).get('hubUrl');
    if (q === 'off') sessionStorage.removeItem(KEY);
    else if (q && (isLocalHub(q) || q === FRIENDS_HUB_LIVE_URL)) sessionStorage.setItem(KEY, q);
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function pageOrigin(): string | null {
  try {
    // Unit tests never reach the live hub (jsdom's page is http://localhost:3000).
    if (import.meta.env.MODE === 'test' || typeof window === 'undefined') return null;
    return window.location.origin;
  } catch {
    return null;
  }
}

let cached: string | null | undefined;
export function friendsHubUrl(): string | null {
  if (cached === undefined) {
    cached = devHubUrl() ?? bakedHubUrl(import.meta.env.VITE_FRIENDS_HUB_URL as string | undefined) ?? defaultHubUrl(pageOrigin());
  }
  return cached;
}
