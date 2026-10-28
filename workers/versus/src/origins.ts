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
