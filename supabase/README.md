# Supabase — server-side (accounts C3+)

The game is a client-first app; the only server code lives here.

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

### Note

This directory is **Deno**, not part of the Node monorepo build: the repo's `tsc`/`eslint` skip it
(`supabase/**` is excluded), and `_shared/lobbyRating.ts` is intentionally dependency-free so it bundles
cleanly and the repo's Node test can read it for the parity check.
