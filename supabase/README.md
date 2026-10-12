# Supabase — server-side (accounts C3+)

The game is a client-first app; the only server code lives here.

## Email delivery — Gmail SMTP now, a verified domain at release

**The mail provider is a two-stage plan.** Right now auth email goes out through a dedicated **Gmail account
over SMTP**, which reaches anyone and costs nothing. At full release it moves to **Resend on a verified
domain**. Both are pure dashboard config — no code in this repo knows or cares which is in use.

### Why NOT Resend today (the 2026-08-17 finding)

Owner testing found sign-in email arriving only in the owner's own inbox. That was **not** a
misconfiguration: a Resend account with no verified domain may only send from the shared
`onboarding@resend.dev`, and that address may only deliver *to the address the Resend account was registered
with*. Every other recipient is refused at the API and no setting lifts it. If that symptom ever returns,
check which provider the SMTP settings point at before touching templates.

Two things that look like fixes but are not:

- **A different Gmail address as the Resend *sender*.** `gmail.com` can never be verified in Resend —
  verification publishes DKIM/SPF at the domain's nameservers, which we don't control for Google. (Gmail as
  the *SMTP server*, below, is a completely different mechanism and does work.)
- **Supabase's built-in email service.** Mirror-image restriction: it only delivers to members of the
  project's org, is capped at 2 messages/hour, and on the Free plan the lowest role we could grant a tester
  is **Developer** (Read-Only is Team/Enterprise-only) — i.e. content access to the live project. Never trade
  database access for a test email.

### Current config — Gmail SMTP (works for any recipient, no domain)

Uses a **dedicated personal Gmail** — `teamascentsupport@gmail.com`, profile name "Team Ascent" (created
2026-08-17). Deliberately not the owner's main address: the App Password is a live credential, and this keeps
it isolated from anything personal. Must stay a personal account — Workspace/school accounts can't create App
Passwords.

1. On that Gmail account, turn on **2-Step Verification** (App Passwords require it and the option is hidden
   until it's on), then create an **App Password** at <https://myaccount.google.com/apppasswords> — app
   *Mail*, device *Other → "Supabase SMTP"*. The 16-character value is shown once.
2. **Supabase → Project Settings → Authentication → SMTP Settings**, *Enable Custom SMTP* on:
   - Host `smtp.gmail.com`, port `465`
   - Username — the **full Gmail address**
   - Password — the App Password (**not** the account password)
   - Sender address — the same Gmail address; sender name `ASCENT`
3. Confirm both templates still carry `{{ .Token }}` (next section).
4. Test to an address that is **not** the owner's.

Known limits, all fine for a friends-scale test and none fine for release: Gmail caps at ~500 recipients/day,
Supabase applies a 30/hour default to custom SMTP (raise under Authentication → Rate Limits if needed), and
**the From address is forced to the Gmail account** — friends will see mail from `something@gmail.com`, not
from an ASCENT address. Google's terms also don't cover bulk transactional sending, which is why this is a
bridge and not the destination.

### Release config — Resend on a verified domain

Do this when the release domain is registered; it removes every limit above and gets a real `noreply@` sender.

1. **Register the domain.** Any registrar works; the DKIM/SPF records just need to go wherever its
   nameservers point.
2. **Resend → Domains → Add Domain.** It emits a DKIM `TXT` record, an SPF `TXT`, and an `MX` on a `send.`
   subdomain. Paste all of them into DNS verbatim. *On Cloudflare, set these to DNS-only (grey cloud) — proxying
   them breaks verification.* Verification usually clears in minutes; DNS propagation can stretch it to a few
   hours.
3. **Wait for Resend to show the domain Verified** before testing. A send attempted mid-verification fails in
   the same owner-only way and reads as "still broken".
4. **Supabase → Project Settings → Authentication → SMTP Settings**, with *Enable Custom SMTP* on:
   - Host `smtp.resend.com`, port `465` (use `587` if egress blocks 465)
   - Username `resend` — the literal string, not an email address
   - Password — a Resend **API key** (create one scoped to sending; it is shown once)
   - Sender address on the newly verified domain, e.g. `noreply@<domain>`; sender name `ASCENT`
5. **Re-check both email templates still contain `{{ .Token }}`** (next section) — saving SMTP settings does
   not touch templates, but this is the step whose absence broke the code path once before.
6. **Raise the auth rate limit.** Supabase caps custom-SMTP auth email at a low default (~30/hour); it's under
   Authentication → Rate Limits and needs to reflect expected sign-ins.
7. **Test end-to-end to an address that is NOT the Resend account owner's** — that is the entire point of the
   exercise, and an owner-inbox test proves nothing here. Verify the 6-digit code arrives and completes
   sign-in in the exe.
8. **Retire the Gmail bridge** — swap the section above for this one, revoke the Gmail App Password (it's a
   live credential on a personal account for as long as it exists), and update `docs/roadmap.md` +
   `docs/devlog.md`.

## Email sign-in — CODE delivery (required for the desktop exe)

The exe has no web origin, so a magic *link* can't return to it — the player types a **6-digit code** from the
email instead. For that code to arrive, the email templates must include the token. In the dashboard under
**Authentication → Emails**, make sure **both** of these templates contain `{{ .Token }}`:

- **Magic Link** — used when a returning player signs in on a fresh device.
- **Change Email Address** — used when an anonymous session is upgraded to an email account (the common case).

A minimal body that shows the code (keep or drop the link line as you like):

```html
<p>Your ASCENT sign-in code is:</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>Or, on the web, you can <a href="{{ .ConfirmationURL }}">click here</a> instead.</p>
```

No Site URL / redirect allow-list is needed for the exe path (that's only for the web link). Everything else
(Email provider enabled, signups allowed, anonymous sign-ins on) is the standard C1/C2 dashboard state.


## `functions/submit-rating` — authoritative rating (C3)

The **only** writer of `profiles.rating`. A client sends `{ runId, placement }` (never a rating); the function,
running as the service role, reads the caller's stored rating and computes the new one itself from the same
placement-delta table the client uses (`functions/_shared/lobbyRating.ts`, kept in parity with the sim by
`packages/ui/src/lobbyRatingParity.test.ts`). One rating per `(user, run)` via the `rated_runs` ledger, plus a
per-player rate limit.

### Deploy (owner)

Do these two together — the SQL revokes the client's legacy fallback, so deploy the function **first**:

```bash
# 1. deploy the function (needs the Supabase CLI + `supabase login` + a linked project)
supabase functions deploy submit-rating

# 2. then run the C3 block in ../schema.sql (creates rated_runs, revokes submit_own_rating from clients)
```

Until both are done the client keeps using the `submit_own_rating` RPC fallback and nothing breaks — C3 simply
isn't enforcing yet.

The function reads its config from the standard Edge-Function env (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`), which Supabase injects automatically — no secrets to set by hand.

## `functions/submit-progression` — account XP + titles (2026-09-27)

The **only** writer of `profiles.account_xp` / `account_level` and `player_titles`. A client sends
`{ mode, runId, rulesVersion, ... }` (never an XP number); the function verifies the JWT and calls the
`settle_progression` database function as the service role. Its logic lives in `_shared/progressionServer.ts`
and `_shared/progressionRules.ts`, both **GENERATED** from `packages/progression` by `npm run progression:shared`
(CI fails if they drift, so never edit them by hand). Deploy: `supabase functions deploy submit-progression`.
The full owner runbook (migration, deploy, the epoch switch, anon probes) is in
`docs/devlog/2026-09-27-account-progression-mvp.md`.

## `functions/progression-inventory` — open crates, equip titles (2026-09-28)

The **only** path that opens a level crate, grants a cosmetic from one, or changes the equipped title. A client
sends `{ action: 'open_crate', crateId }` or `{ action: 'equip_title', titleId }`; the function verifies the JWT and
calls `open_crate` / `equip_title` as the service role (reward chosen at open time, never a duplicate, an empty
pool keeps the crate sealed; equip checks ownership). Logic in `_shared/progressionInventory.ts` +
`_shared/progressionCosmetics.ts`, both **GENERATED** by `npm run progression:shared`. Deploy:
`npx supabase functions deploy progression-inventory`. Runbook: `docs/devlog/2026-09-28-progression-crates.md`.

## The Collection's seen list (2026-10-11)

Which owned items a player has looked at (the Collection's NEW badge) is saved on the account:
`player_cosmetics.seen_at`, written only by `mark_cosmetics_seen(p_ids)` (the caller's own items). No Edge Function
and nothing to deploy: run `migrations/2026-10-11-cosmetics-seen.sql` in the SQL Editor once. Its first run marks
everything owned so far as seen. A client that reaches a database from before it keeps the list on the device.

## Guides on the server (2026-10-12)

Guides (Team Ascent's and, from the next steps, players') live in `public.guides`. Spec:
`docs/superpowers/specs/2026-10-11-community-guides-design.md`.

1. **Run the migration.** Paste `supabase/migrations/2026-10-12-guides.sql` into the SQL Editor and Run. It is
   idempotent and depends on nothing but `auth.users`.
2. **Add the team, once.** In the SQL Editor, with the two real emails typed in (never commit them):
   `insert into public.guide_team (user_id) select id from auth.users where email in ('<mike>', '<kc>') on conflict do nothing;`
   Then check it took: `select count(*) from public.guide_team;` should say 2.
   Also check that the write locks took. Each of these two queries should answer `f` (false):
   `select has_function_privilege('authenticated', 'public.guide_save(uuid, jsonb)', 'execute');`
   `select has_table_privilege('authenticated', 'public.guides', 'insert');`
   Why check by hand: the tests model Supabase's default grants rather than using the real ones, so only the live
   project can show that the migration's revokes beat them.
3. **Deploy the function.** `npx supabase functions deploy guide-write`.
   Deploying `guide-write` lets any signed-in account save PRIVATE guides by calling the function directly, before
   the editor exists; deploy it with the editor (step 2) unless you want it earlier.

Until step 1 runs, the client reads "relation does not exist", treats guides as switched off, and shows its built-in
guides: shipping the client first is safe. Until the built-in guides are imported (a team-only button that arrives
with the editor), the table has no official rows and every player still sees the built-in guides. Import the built-in
guides BEFORE creating any new Team Ascent guide, because the moment the server has one usable official guide the
client shows the server's list instead of the eleven built-in ones.

`functions/guide-write` imports `_shared/guides*.ts`, which are GENERATED from `packages/guides/src` by
`npm run guides:shared` (CI fails if they drift, so never edit them by hand). The function is the only writer: the
tables have no client write policy. The function refuses guests, answers before reading the body, and caps the body
at 64 KB in bytes.

### The editor (step 2)

Nothing new to run in SQL. The client now calls `guide-write`, so:

1. **Deploy the function** if it is not deployed yet: `npx supabase functions deploy guide-write`.
2. **Import the built-in guides, once.** Signed in as a team account, open the Compendium, Guides, and press
   **Import built-in guides**. It is offered only to the team and only while the built-in copies are showing. Do this
   before creating any new Team Ascent guide.
3. **Check row-level security with two real accounts** (this has never been run against the live project):
   - Account A (not on the team): New guide, save. It appears under My guides.
   - Account B: it must NOT see A's guide anywhere. In the SQL editor, `select count(*) from public.guides where not official;` shows it exists; B's Compendium does not.
   - Account A: a Team Ascent guide shows no Edit button. Team account: it does, and an edit shows for A after reopening the Compendium.
   - Guest: New guide asks to sign in.

### Publishing and bookmarks (step 3)

1. **Read the word list and the limits first.** Publishing makes player text public. The list is
   `packages/guides/src/wordFilter.ts` (`WORDS`, `STEMS`, the reserved names); the limits are `GUIDE_LIMITS` in
   `packages/guides/src/types.ts`. Change either in a pull request, then run `npm run guides:shared`.
2. **Run the migration.** Paste `supabase/migrations/2026-10-13-guides-community.sql` into the SQL Editor and Run,
   after the 2026-10-12 file. It is idempotent. It adds `last_save_id` (a retried save is recognised only when it
   names the same guide), the functions `guide_own_row`, `guide_set_published` and `guide_bookmark`, a trigger that
   keeps `bookmark_count` true, and four indexes (the last save id, Community by most bookmarked, Community by
   newest, and bookmarks by guide). The trigger function is revoked from every role.
   **Do not run the 2026-10-12 file alone after this one.** It puts the old `guide_save` back, and a retried save is
   no longer recognised. If that happens, run the 2026-10-13 file again.
   Check the locks took. Each of these should answer `f`:
   `select has_function_privilege('authenticated', 'public.guide_set_published(uuid, uuid, boolean, int)', 'execute');`
   `select has_function_privilege('authenticated', 'public.guide_bookmark(uuid, uuid, boolean)', 'execute');`
   `select has_function_privilege('authenticated', 'public.guide_own_row(uuid, uuid)', 'execute');`
3. **Redeploy the function.** `npx supabase functions deploy guide-write`. Until then Publish and Bookmark answer
   "Something went wrong. Nothing was changed." Saving keeps working either way.
4. **Check with two real accounts** (never yet run against the live project):
   - Account A: write a guide, Publish it from its card under My guides. It reads Published.
   - Account B: it is in Community. Bookmark it: it shows under Bookmarked, and in B's lobby rail when its tribe is in
     the lobby. B's card for it has no Edit button. The rail shows a new bookmark the next time its Guides view is
     opened: it does not change while that view is open, so close it and open it again.
   - Community and Bookmarked show the guides of the set being shown. Pick the guide's set in the Compendium's set
     picker if it is not there.
   - Account A: Unpublish. After B reopens the Compendium it is gone from Community and from B's Bookmarked.
     Publish again: it is back in B's Bookmarked without B doing anything.
   - Account A: put "Team Ascent" in the title and Save: it is refused, naming the title.
   - Guest: Community can be read; Bookmark asks to sign in.
   - If a desktop build lags behind the function: an older client that saves a title the new title rule refuses is
     told 'That "by" line is reserved. Pick another name.' The save is refused correctly; only the part it names is
     wrong. It goes away when that client updates.
5. **Taking a guide down before step 4.** There is no Hide button yet. Until there is, do it in the SQL Editor.
   Find it: `select id, title, byline, published_at from public.guides where not official and published order by published_at desc limit 50;`
   Hide it (on the server it leaves Community, Bookmarked and every lobby rail at once; a game that is already open
   drops it the next time it opens the Compendium's Guides tab or is restarted; its author still sees it, marked
   "Hidden by Team Ascent", and cannot publish that guide again): `update public.guides set hidden = true, hidden_at = now() where id = '<id>';`
   A hide stops that guide, not its author: they can still Duplicate it and publish the copy, which is a new guide. Run
   the Find query again afterwards. Blocking an account is step 4's work.
   Undo: `update public.guides set hidden = false, hidden_at = null where id = '<id>';`
   Delete it for good: `delete from public.guides where id = '<id>';`

### Note

This directory is **Deno**, not part of the Node monorepo build: the repo's `tsc`/`eslint` skip it
(`supabase/**` is excluded), and `_shared/lobbyRating.ts` is intentionally dependency-free so it bundles
cleanly and the repo's Node test can read it for the parity check.
