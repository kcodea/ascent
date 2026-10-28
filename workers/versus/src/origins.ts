/**
 * ALLOWED ORIGINS (`ALLOWED_ORIGINS`, comma-separated; `*` matches within one host label or a port): the game's site and
 * local dev. A browser request from any other origin is refused (403) before auth, and CORS only ever reflects an
 * allowed origin. Requests with no Origin (the measurement script, server-to-server) pass: the bearer token is the
 * real gate.
 */
export function originAllowed(origin: string | null, list: string | undefined): boolean {
  if (!origin) return true;
  for (const pat of (list ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const body = pat.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+');
    if (new RegExp(`^${body}$`, 'i').test(origin)) return true;
  }
  return false;
}

/**
 * One allowlist entry as `scripts/deploy.ts` accepts it from `VERSUS_ALLOWED_ORIGINS`: an https origin (no path), or
 * http on a local dev host. A bare `*` host, a path, or plain http to anywhere else is refused.
 */
export function validOrigin(o: string): boolean {
  if (/^https:\/\/\*(\.|$)/.test(o) && !/^https:\/\/\*\.[a-z0-9-]+\.[a-z]{2,}$/i.test(o)) return false;
  return /^https:\/\/[a-z0-9*][a-z0-9*.-]*(:[0-9*]+)?$/i.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9*]+)?$/i.test(o);
}
