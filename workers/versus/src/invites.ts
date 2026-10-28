/**
 * VERSUS ON CLOUDFLARE — friend invites into a Cloudflare room, checked WHEN SENT (R-VERSUS-CF-INVITE-01).
 *
 * Postgres cannot see a Cloudflare room, so `friends_invite` cannot check by itself that the room is open and that the
 * inviter is in it. The room can. The client asks its room (`invite_proof`, on the socket it already holds); the room
 * runs the checks (`RoomCore.inviteCheck`) and answers a short-lived PROOF; the client hands the proof to
 * `friends_invite`, which verifies it before writing the invite (supabase/migrations/2026-11-08-versus-cf-live-games-invites.sql).
 *
 * The proof is `<expiry epoch seconds>.<hex HMAC-SHA256>` over
 *   `ascent.invite.v1|<room>|<from>|<to>|<kind>|<expiry>`
 * keyed with sha256-hex(VERSUS_WRITER_SECRET): the very value `versus_cf_writer_keys` already stores, so the SQL can
 * verify it with no new secret to provision and the secret itself never leaves the Worker. Binding room, inviter,
 * invitee and kind means a proof cannot be replayed for anyone or anything else; the expiry keeps it to two minutes.
 *
 * Why not the alternatives: a room-status table in Supabase would cost a write on every room change plus reads (the
 * egress this move exists to shed), and Postgres calling the Worker would put an HTTP call inside a transaction.
 */

export const INVITE_PROOF_TTL_S = 120;
export const INVITE_PROOF_DOMAIN = 'ascent.invite.v1';

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

/** sha256-hex of the writer secret: the HMAC key (and the row `versus_cf_writer_keys` holds). */
export async function inviteKeyOf(secret: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(secret)));
}

export const invitePayload = (p: { room: string; from: string; to: string; kind: string; exp: number }): string =>
  `${INVITE_PROOF_DOMAIN}|${p.room.toLowerCase()}|${p.from.toLowerCase()}|${p.to.toLowerCase()}|${p.kind}|${p.exp}`;

/** Sign a checked invite. `nowMs` is the Worker's clock. */
export async function signInviteProof(
  secret: string,
  p: { room: string; from: string; to: string; kind: string },
  nowMs: number,
): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + INVITE_PROOF_TTL_S;
  const key = await crypto.subtle.importKey('raw', enc.encode(await inviteKeyOf(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, enc.encode(invitePayload({ ...p, exp }))));
  return `${exp}.${sig}`;
}
