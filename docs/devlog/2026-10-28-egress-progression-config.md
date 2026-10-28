# 2026-10-28 — Supabase cleanup P1.2: progression config once per session, catalog by hash

Scope: `docs/design/2026-10-28-supabase-cleanup.md` section 3.1b items 2-3. Each progression probe sent four
single-column `progression_config` reads (epoch, crates_enabled, achievements_epoch, aether_enabled) and read the whole
`cosmetic_catalog` (459 items) + `cosmetic_categories` to learn the kill switch. On prod that was ~87,000 x each in 16
days, ~3 GB of the egress from the catalog alone.

## What changed

- `progressionRemote.ts fetchProgressionConfig()`: ONE `select('*')` of row 1, kept for the session once answered (a
  failed read is not kept). The four `fetch*Enabled` probes derive from it with the old semantics (missing table =
  off; missing column = off; transport failure = could not ask). `select('*')` so an older server just lacks columns.
- `fetchServerCatalogState()` asks only for switched-off items (`or(active.eq.false, admin_off.eq.true)`; a pre-skins
  server: `eq(active, false)`). `parseServerCatalogState` keeps nothing else, so the answer is identical.
- `refreshServerCatalog()` skips the catalog read when `progression_config.catalog_state_hash` equals the hash the
  cached answer (`ascent.cosmetics.server`) was read under (`ascent.cosmetics.server.hash`). No hash = read as before.
- Migration `supabase/migrations/2026-11-07-catalog-state-hash.sql` (NOT applied): adds the column, a SECURITY DEFINER
  statement trigger on both catalog tables that sets it to the md5 of the kill-switch columns, and backfills it.
  `catalog_hash` (the code catalog hash) is not reused because it does not move on a manual `admin_off` flip.

## Measured (fake server answering the real code catalog, `progressionConfigOnce.test.ts`)

- Catalog read: 31,229 B -> 786 B (3 retired) when it does run.
- 3 sessions x 5 probes: 476,115 B and 75 requests before -> 1,170 B and 5 requests after (3 config reads, 1 catalog +
  categories read on the first session, then hash hits).
- `catalogStateHash.db.test.ts` runs the migration on PGlite after the progression files: filled at once, moves on an
  item / category `admin_off` flip and on a code-sync retire, returns to the same value when undone, ignores columns the
  client does not read, re-runs cleanly.

Rule: R-EGRESS-02 (foundation). No player-visible change, no patch note. Lead: apply the migration (order-independent;
the client works with or without it). No Edge Function redeploy.
