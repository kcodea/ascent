/**
 * VERSUS ON CLOUDFLARE: room references and the build's own Worker (R-VERSUS-CF-ONLY-01).
 *
 * Every Versus room lives on the Versus Worker (Cloudflare Durable Objects) since 2026-10-29 (owner: "why are we using
 * supabase for versus instead of cloudflare? stop doing that"). There is no per-mode switch and no Supabase room any
 * more; what is left here is:
 *
 *   - the room reference that leaves the client (friend invites, the Friends "Watch" id, a Live Games row):
 *     `cf:<room id>`. `friends_invite` checks a `cf:` invite against the room's signed proof (R-VERSUS-CF-INVITE-01).
 *     A BARE id is a pre-Cloudflare (Supabase) room from an older client: decoded as such so a caller can say it is
 *     gone instead of trying it;
 *   - the trust rule for the Worker URL a pack bakes in: only EXACTLY the Worker for this build's own engine.
 */
import { contentRevision } from '@game/content';
import { versusCfLiveUrl } from './versusCfRemote';

/** Where a room reference points: the Worker, or a retired Supabase room (an older client's bare id). */
export type VersusHost = 'supabase' | 'cf';

const CF_PREFIX = 'cf:';
/** A room id as it travels in an invite / presence / listing: `cf:<id>`. */
export const encodeRoomRef = (roomId: string): string => `${CF_PREFIX}${roomId}`;
/** The other way: `cf:<id>` is a Worker room; a bare id is a retired Supabase room (an older client's invite or row). */
export function decodeRoomRef(ref: string): { roomId: string; host: VersusHost } {
  return ref.startsWith(CF_PREFIX) ? { roomId: ref.slice(CF_PREFIX.length), host: 'cf' } : { roomId: ref, host: 'supabase' };
}

/**
 * The embedded Worker URL is trusted only when it is EXACTLY the Worker for this build's own engine. Anything else (a
 * pack built against a different content revision, a typo) is ignored, and the build talks to the Worker named after
 * its own engine instead of one that would refuse every hello with `version_mismatch`.
 */
export function embeddedCfUrl(raw: string | undefined, rev: string = contentRevision()): string | null {
  const url = (raw ?? '').trim().replace(/\/$/, '');
  return url && url === versusCfLiveUrl(rev) ? url : null;
}
