# 2026-10-28 · Versus on Cloudflare: Live Games rows and invite checks at send time

Two gaps left after the Ranked Duos port (`docs/versus-cf-cutover.md`, "Still open").

**Live Games (R-VERSUS-CF-LIVE-01).** Parity, mode by mode: on Supabase only Ranked Duos teams are Live Games rows
(`duos:<room>`, heartbeated by the first seat's client every 15 s); 1v1, Group and Versus Duos are watched from Friends
("In a game" + Watch), whose presence already carried `cf:<room>`. So the work is the Ranked Duos row. The ROOM now
writes it (`duos:cf:<room>`) through a new key-gated function, `versus_cf_live` (same writer secret + publishable key as
`versus_cf_persist`; it can only upsert or remove a `duos:cf:` row; name, medal and rating are read from the team in
SQL). Egress: a "latest wins" slot (`workers/versus/src/live.ts`) writes only when the listing's key changes (appears,
round, phase, team, ends) plus a 2-minute keep-alive; spectator joins and requests never write. A full test match writes
about two rows per round. Because the room no longer beats every 15 s, a Cloudflare row carries `live_until` (4 minutes
past its last write) and the read policy shows it until then; every other row keeps the 60 s rule. The client skips its
own heartbeat for a Cloudflare room (`publishesOwnRow`), and Live Games' Watch already decoded `duos:cf:` to a `cf:` ref
that the router sends to the Worker.

**Invites (R-VERSUS-CF-INVITE-01).** Postgres cannot see a Cloudflare room, so the room vouches for the invite: the
client asks `invite_proof` on its room socket, the room runs `friends_invite`'s own checks (open, inviter in, invitee
out, the room's invite kind) and answers `<exp>.<hmac-sha256>` over `ascent.invite.v1|room|from|to|kind|exp`, keyed with
sha256(writer secret), the very value `versus_cf_writer_keys` already stores. `friends_invite(p_user, p_kind, p_target,
p_proof default null)` refuses a `cf:` target without a valid proof for exactly that invite (`room_check`). Chosen over a
room-status table (a write per room change plus reads: the egress this move sheds) and over Postgres calling the Worker
(HTTP inside a transaction). No new secret to provision; the proof is bound to both users, the room and the kind, and
lives two minutes. The old three-argument function is dropped so PostgREST never sees two candidates; older clients'
three-argument calls land on the new one through the default.

Migration: `supabase/migrations/2026-11-08-versus-cf-live-games-invites.sql` (write only; not applied). No
versus-resolve redeploy (no core/content/sim change).

Still open: spectator XP for a Cloudflare match (`spectate_beat` reads Supabase room membership).

Tests: `workers/versus/test/liveInvite.test.ts` (listing per mode, friends-only, the throttle over a whole match, the
keep-alive, retry, wake, the invite codes, the HMAC), `workers/versus/test/cfLiveInvite.db.test.ts` (PGlite: both SQL
pieces, forged / expired / re-targeted proofs, the 4-minute window), a workerd invite test in `test/it/room.it.ts`, and
client tests in `versusRouter.test.ts` + `friends.test.tsx` (cf presence in every mode, proof before send).
