# 2026-11-22 — Moderation tab: DM reports, name flags, one name filter

Owner ask: "build the reporting dash and account name and party name flags" (R-NAME-FILTER-01, feat/dash-moderation).

**The name filter.** `packages/sim/src/nameFilter.ts` is the one list for every name a player chooses. Two tiers: a
short slur list is BLOCKED (`name_blocked`, client text "That name is not allowed. Please pick another one."), a broader
list (swearing, sexual words, staff impersonation, nazi / hitler / rape) is FLAGGED for review. Reads through
look-alikes (0 o, 1 i, 3 e, 4 a, 5 s, 7 t, 9 g, @ $ ! |), spacing, stretched letters and camelCase, and a second reading
with digits as spaces ("Fag1"). SUB terms match anywhere in the joined name, WORD terms (spic, coon, cock, ass...) only
as a whole word, so "Spicy", "Raccoon", "Peacock", "Assassin", "Niger" pass. A test proves every word of the guides
filter and the DM filter is caught. Mirrored verbatim in SQL (`moderation.name_verdict`); the db test compares the four
lists and ~170 verdicts between TS and SQL.

**Where names are checked.**
- `profiles.author` and `duos_teams.name`: a BEFORE trigger (`moderation.name_guard`) refuses a slur and a name a
  moderator reset for that target, and writes a flag for the broader list (one open flag per target; a clean rename
  closes it). `uploadPlayerProfile` retries without the name on `name_blocked`, so games played never freezes.
- Versus room names live only in the Cloudflare room (Supabase's versus_rooms is retired): `newRoomState` refuses a
  slur, and a flagged name is reported through the key-gated `moderation_cf_flag` (writer secret, the SQL re-reads it).
- Client: the Change name window and the title chip keep the field open with the refusal line; the room name field
  shows it and Start stays off; Duos team and room errors use the same text.
- Guide titles keep their own filter. NOT covered: the name copied onto other rows (snapshots, Versus member
  display names, lobby watcher names) is the account name at the time; a reset does not rewrite those copies, and the
  player's local name stays on their own device (the server keeps `Player` and refuses the old name).

**DM reports.** `dm_reports` gains `reviewed_at / reviewed_by / note / context`. `dm_report` now copies up to 3
messages before and 2 after the reported one at report time (messages are pruned after a day). dm_prune unchanged.

**Dashboard.** `Analytics | Moderation` in the nav, count of open items on the tab. Report queue (open / reviewed /
all) with the conversation, sender report count, Mark reviewed + note, Reset sender name. Names queue (open / done /
all) with kind, matched term, owner, current name, Looks fine / Reset name with an in-card confirm. Search any account
(name, `Name#1234`, id) or team. Action log. Routes under `apps/dash/functions/api/moderation/`, same Access guard,
POSTs same-origin + JSON + `x-dash-action`; actor = verified email; actions drop the cache. Service-role-only SQL.

**Verified:** PGlite db tests (grants, verdict parity, guard, flags, actions + log, reset memory, context), handler tests
(401/403/500 on every route, the POST guard, actor, cache drop, 409 pass-through), modLogic + fixture tests, Worker test,
Change name test. Screenshots with fixture data (desktop, confirm, phone, after an action).

**Owner to do:** apply `supabase/migrations/2026-11-28-moderation.sql` (after the DM, ranked-duos, cf-writer and
analytics migrations), redeploy the dashboard and the Versus Worker. The migration flags names already stored once.
