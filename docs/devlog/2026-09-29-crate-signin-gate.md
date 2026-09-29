# 2026-09-29: guests create an account to open crates (the crate sign-in gate)

Owner ask: *"ask players not signed in to sign in when they try to open a crate? we'd like players to create sign
ins for account progression"*. Offered a soft nudge or a hard gate, the owner chose the **hard gate**: a guest
(anonymous account) cannot open a crate until they create an account.

## What the player sees

- Guests still earn crates and still see them sealed in the Collection's crate bay (the crates are the incentive).
  For a guest the bay adds "Create a free account to open them." and the Open button wears a small lock.
- Any Open (the bay's Open / Open all, the New rewards pop-up's Open / Open all) shows a small modal in the New
  rewards pop-up's shell instead of the crate theatre:
  - **Create an account to open crates**
  - Your crates, level and collection are saved to your account.
  - It is free and takes a minute. You only need an email.
  - (small, under a rule) Already have an account? Signing in switches to it. Crates earned as a guest stay on
    this guest.
  - Buttons: **Not now** and **Create account** (closes the modal, opens the existing account panel). Esc and a
    click outside close it.
- When the account flips to non-anonymous (the auth `onChange` lands) the modal closes itself if still open, the
  lock and hint go, and the next Open goes straight to the theatre. No reload: `begin` reads `anonymous` on
  every click.
- **No backend** (no Supabase env, or the session could not be made, so `userId` is null): the modal instead says
  "Accounts are unavailable" / "You need an account to open crates, and accounts cannot be reached right now." /
  "Your crates stay sealed. Try again later." with a single OK. It never opens the account panel, which would
  only fail with "No account backend is configured for this build."

## The one crate-open path

Every player-facing crate open goes through `begin(all)` in `packages/ui/src/progression/CollectionScreen.tsx`
(the CrateBay buttons and `NewRewardsPopup`'s `onOpenCrates`). The gate lives there, so it covers every entry
point. Nothing else calls the crate theatre with a real open: the post-game panel only points at the Collection
(no Open button since 2026-09-28), and the Title / sidebar / Career plaques only navigate. The DEV crate FX preview
(`CratePreview`, practice crates, never the server) and the tuner are deliberately not gated.

## The existing-account warning (owner-flagged edge case)

`signInWithEmail` upgrades a guest in place (`updateUser({ email })`, same `user_id`, crates and XP carry over).
When the email already belongs to ANOTHER account it falls back to OTP sign-in into THAT account, and the guest's
server data (XP, crates, collection, since progression shipped) stays behind on the guest. That branch now returns
`{ ok: true, existing: true }` (`SignInResult` in `identity.ts`), and the account panel's code step swaps its
"Your current progress upgrades to that account, and nothing is lost." note (false in this branch) for a warning:
"This email already has an account. Signing in switches to it. Crates and progress earned as a guest stay on this
guest." The old comment in `remoteBoards.ts` claiming the guest's data was "never uploaded" was stale and is fixed.

## Not done

The gate is client-side. The `progression-inventory` Edge Function does not refuse an anonymous open, so a guest
with devtools could still open a crate. Low stakes (cosmetics, their own crates); a server check is a small
follow-up if the owner wants it.

Oracle: **R-PROG-CRATE-04** (foundation). Tests: `CollectionScreen.test.tsx` (the gate block), `Crates.test.tsx`
(the pop-up path), `AccountPanel.test.tsx` (the warning).
