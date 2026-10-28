# 2026-10-28 — Supabase cleanup P1.1: login startup runs once per account, not per auth event

Scope: `docs/design/2026-10-28-supabase-cleanup.md` section 3.1b. Supabase fires `onAuthStateChange` on INITIAL_SESSION,
every TOKEN_REFRESHED (about hourly) and again when a hidden tab becomes visible. `initAccounts` ran the whole login
fan-out on every fire: the progression probe (4 `progression_config` reads, the full 458-row cosmetic catalog, profile,
crates x2, achievements, Aether), guides, the upload / rank / bug-report flushes, the Gauntlet read, and for real
accounts cloud saves, the profile pull and `claimHandle` (an UPDATE on `profiles`). Measured on prod over 16 days:
~87,000 fan-outs, ~1M statements, ~3.6 GB of egress, 5,551 profile UPDATEs for 58 profiles.

## What changed (client only, `packages/ui`)

- `identityGate.ts`: `createAccountStartupGate()` keys an identity on `(userId, anonymous, email)` and lets a report
  through only when that key changes (sign-out = `none`). Counters: `authEvents`, `startups`, `skipped`.
- `store.ts`: the boot restore and every `onChange` both go through ONE gate and ONE `runAccountStartup(id)` (the union
  of the old boot and onChange branches), so INITIAL_SESSION no longer doubles the boot work either. The `account`
  mirror is written only on a change, so a token refresh no longer re-renders account subscribers.
- `remoteBoards.ts claimHandle`: reads `discriminator, author` (both are client-readable; `email` is not), and skips the
  UPDATE when the row already has this name and a tag and this device last wrote this email for this user
  (`ascent.handleclaim` in localStorage). The first claim per device still writes once.
- DEV counter: `window.__ascentAuthStartup` and a `console.debug('[auth] identity event', ...)` per fire.

## Measured

`identityGate.test.ts` replays a realistic 8-hour session (boot + INITIAL_SESSION + 8 token refreshes + 40 refocus
fires = 50 identity reports): before, 50 fan-outs; after, 1 (`{ authEvents: 50, startups: 1, skipped: 49 }`). At the
prod per-fan-out cost (~3.6 GB / 87k = ~41 KB and ~11 statements), that session drops from ~2.0 MB to ~41 KB and from
~550 to ~11 statements. `claimHandle`: 6 calls with nothing changed = 1 UPDATE (was 6).

Rule: R-EGRESS-01 (persistence). No player-visible change, no patch note, no migration.
