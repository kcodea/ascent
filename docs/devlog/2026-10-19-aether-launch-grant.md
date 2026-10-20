# 2026-10-19 — The Aether launch gift: 1,000 Aether for every account, and an "Introducing Aether" note

Mike: "lets give everyone 1,000 Aether as part of the announcement of this change", along with a popup the first time
a player lands on the Collection "that has the exact pop in effect and style as the play confirmation screen". The
copy is his, with "an currency" read as "a currency". Rule: R-PROG-AETHER-05. R-PROG-AETHER-01 was amended, since it
said an account starts with 0.

## Server: `supabase/migrations/2026-10-19-aether-launch-grant.sql`

- `aether_launch_grant(user)` pays 1,000 through `aether_apply` as one ledger row (reason `grant`, source
  `aether_launch`). Because the ledger is unique per (user, reason, source), nothing can ever pay an account twice.
- `aether_rollout()` is replaced. It does everything it did before and also pays every profile, moving each paid
  account's progression revision. It now answers `{accounts, crates, granted}`.
- An after-insert trigger on `profiles` pays any profile created while Aether is on: a new account's first game, or a
  guest's first save. That keeps "everyone" true for players who join later.
- If the file runs after the launch (the switch already on), its last block pays the profiles that already exist.
- `AETHER_LAUNCH_GRANT` (packages/progression/src/aether.ts) is the TS copy of the amount. The note names it, and
  `aetherLaunchGrant.db.test.ts` checks that it matches the SQL constant.

## Client: `packages/ui/src/progression/AetherIntroPopup.tsx`

The note is the Ranked confirmation's own markup and classes (`.rankedconfirm-ov`, `.rankedconfirm`, `.rc-crest`,
`.rc-title`, `.rc-btn-yes`), so it has the same frame, veil, `rc-pop` bounce and `rc-out` exit, and none of its motion
is new. collection.css only adds three things:
- a z-index that lifts it over `.lbpage`, up to the New Rewards layer;
- a slightly wider text measure;
- the gold gift line and the sign-off.

When it shows:
- Only when Aether is live and the account's own profile has loaded. The server pays every profile, so the "on us"
  line is always true.
- Once per account per device. The seen flag is `ascent.aetherIntro.seen.<userId>` in localStorage, and if storage
  is blocked it falls back to once per session.
- The New Rewards summary (the backdated milestone chests, for example) waits until the note is closed.

Claude's calls: the single button reads "Continue", and the sign-off is centred to match the window.

## Updated launch runbook

1. Paste `supabase/migrations/2026-10-18-aether.sql`, then `supabase/migrations/2026-10-19-aether-launch-grant.sql`
   (both are also at the end of `schema.sql`).
2. Deploy `submit-progression`, `progression-inventory` and `gauntlet-clear`.
3. Ship the client.
4. Run `select public.aether_rollout();`. It now also pays the 1,000.
