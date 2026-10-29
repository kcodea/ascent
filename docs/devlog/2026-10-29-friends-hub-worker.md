# 2026-10-29: the friends hub moves to its own version-independent Worker

Owner approved (2026-10-29): "move the FriendHub off the per-content-version Versus Worker onto its own
version-independent Worker", so every build's players share one hub. Follow-up to `2026-10-29-direct-messages.md`.

- **`ascent-hub`** (`workers/versus/hub.wrangler.toml`, entry `src/hubWorker.ts`): one stable Worker name, `FriendHub`
  Durable Object with its own append-only migrations (tag `v1`). Never renamed per version: a new name would be a new,
  empty namespace. No engine in it (25 KiB bundle). Same auth (`auth.ts`, Supabase JWKS) and origin allowlist. The
  Versus Worker's `HUB` binding, `/hub/ws` route and its `v3` migration are gone (they never shipped).
- **Own writer secret**: `HUB_WRITER_SECRET` (`node workers/versus/scripts/writer-secret.mjs ascent-hub`), its sha256 a
  row of the same `versus_cf_writer_keys` table (note `ascent-hub`), so `dm_cf_send` needs no change.
- **Versioning** (`hubProtocol.ts`): the hub accepts every client protocol from `HUB_PROTOCOL_MIN` up; both sides ignore
  unknown fields and push types; only raising `HUB_PROTOCOL_MIN` cuts old clients off (close 4409). The hello now
  carries the client's `build` (informational) and the answer the hub's `protocol`.
- **Deploy only on change**: `npm run hub:deploy` (`scripts/deploy-hub.ts`) hashes the hub's sources (the entry and its
  transitive relative imports plus the toml), stamps it as `HUB_CODE`, and skips the deploy when the live `/health`
  already answers that hash. `release:web --versus-cf` runs it after the Versus Worker, checks `/health`, sets the
  writer secret on first persist, and bakes `VITE_FRIENDS_HUB_URL` (trusted only when it is exactly
  `https://ascent-hub.team-ascent.workers.dev`). Dev: `npm run hub:dev` (:8788) and `?hubUrl=http://127.0.0.1:8788`.
- **Tests**: `test/it/hub.it.ts` now runs on the hub's own Worker, including clients on two content revisions and two
  protocols (with unknown fields) seeing each other and messaging live, an old protocol refused, and the Versus Worker
  no longer answering `/hub/ws`; `test/hubDeploy.test.ts` (source set, hash, stable config); `hubUrl.test.ts`.
