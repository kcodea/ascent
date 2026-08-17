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

### Note

This directory is **Deno**, not part of the Node monorepo build: the repo's `tsc`/`eslint` skip it
(`supabase/**` is excluded), and `_shared/lobbyRating.ts` is intentionally dependency-free so it bundles
cleanly and the repo's Node test can read it for the parity check.
