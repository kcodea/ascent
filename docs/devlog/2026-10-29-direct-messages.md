# 2026-10-29: direct messages between friends (the friends hub)

Owner (2026-10-29): "start building in game messaging"; "In game messaging should be direct messages through the
friends list, click a friend and a chat overlay pops up". Scope: friend DMs only (no match / team / lobby chat).
Rules R-DM-01..05 (`packages/rules/src/registry/approved/foundation.ts`).

- **The friends hub** (`workers/versus/src/hub.ts`, wire `hubProtocol.ts` exported as `@game/versus-cf/hub`, rules
  `core/hubCore.ts`): one Durable Object per ACCOUNT (`hub:<userId>`, binding `HUB`, migration tag `v3`), one socket
  per open game at `GET /hub/ws` (Supabase JWT in the subprotocol like the room; guests 403). Hello carries my presence
  (the friends list's `PresenceReport` shape after the privacy switch); the hub calls `peerUpdate` on each friend's hub
  and learns who is connected from the answers, so both sides see each other at once. Presence changes ride the
  presence beat's own settle (the client sends `presence` when a beat answered and the presence moved). Last socket
  closing, or the 60 s sweep finding a dead one, fans out offline. Pings use the hibernation auto-response.
- **Sending**: hub checks the client id, the body (`cleanDmBody`: control / invisible characters out, spaces collapsed,
  1..500 characters) and the rate (5 / 10 s per account, in memory), then stores through `dm_cf_send` (key-gated with
  the existing `VERSUS_WRITER_SECRET` hash in `versus_cf_writer_keys`), then `deliver`s to the friend's hub and pushes to
  my other sockets. Postgres enforces friends only, blocks either way, the size, and a 30 / minute backstop; the same
  (sender, client id) answers the stored row (retry-safe).
- **Migration** `supabase/migrations/2026-11-12-direct-messages.sql` (written, NOT applied): `direct_messages`,
  `dm_reports`, RLS (own conversations only, no client writes), `dm_cf_send` / `dm_cf_friends` (writer),
  `dm_history` / `dm_unread` / `dm_mark_read` / `dm_report` (client), `dm_prune` + a daily pg_cron job `dm-prune`
  (90 days of messages, 180 of reports).
- **Client** (`packages/ui/src/friends/dm/`): `dmStore.ts` (socket lifecycle, outbox that survives a reconnect,
  unread counts read once per connection, history 50 at a time, live presence laid over the friends list when newer),
  `DmConversation.tsx` (inside the dock's `DmPanel`), `DmToast.tsx`, `profanity.ts` (reader-side mask, Settings switch
  "Filter bad words in messages", on by default). The Friends page gets Message, which opens the same panel over the
  page on a menu (`FriendsDock` renders a button-less shell there).
- **Tests**: `workers/versus/test/dm.db.test.ts` (PGlite: the SQL end to end), `hubCore.test.ts` (rules),
  `test/it/hub.it.ts` (real workerd: presence both ways, live delivery to every open game, refusals, rate limit),
  `packages/ui/src/friends/dm/dm.test.tsx` (the client with a fake hub).

**To go live**: apply the migration; deploy the Worker WITH `--persist` (a Worker without persistence answers every
send `unavailable`, so the composer says messages are not available). A Netlify pack built with `--versus-cf` carries it.

**Known limits / follow-ups**: the hub is on the per-content-revision Worker, so two friends on different builds do not
see each other's live presence (the friends list still shows them) and a message between them is delivered on the
recipient's next open rather than live. The `friends_beat` polling is untouched; the hub's presence is an overlay that
can replace it later. A friend added or removed reaches the hub's fan-out list within 2 minutes (cache).
