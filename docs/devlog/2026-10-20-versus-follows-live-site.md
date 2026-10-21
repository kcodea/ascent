# Versus follows the live site: no more frozen matches after a content merge

**Owner report (2026-10-20):** two friends tried Versus and it "said they froze when both players are ready".

**Cause.** The versus-resolve Edge Function refuses any match whose game data differs from its own
(`content_mismatch`). Vaultkeeper (#2177) and the Kobold balance (#2178) went live on Netlify, so the client sent content
`c8e8a2a8` while the server still ran `08cc747a`. Three matches (Rooks vs IonLime) froze in round 1 and ended as
forfeits. Fixed on the spot by rebuilding the bundle at main, redeploying and running parity (13/13).

**Why not deploy on every merge.** Netlify is deployed by hand, later. A merge-time deploy would put the server AHEAD of
the live client, and freeze Versus the other way round until the next Netlify upload.

**Fix: the server follows the live site.**
- The prod build emits `version.json` (`{ version, sha, dirty, date }`, `apps/web/vite.config.ts`).
- `.github/workflows/versus-follow-live.yml` runs every 10 minutes (and on demand, with an optional commit id). It:
  1. reads the live site's `version.json`;
  2. asks versus-resolve for its content revision (`health`);
  3. remembers each commit's revision in the Actions cache, so a quiet check ends in seconds;
  4. on a mismatch, checks out the live commit, runs `versus:bundle`, deploys versus-resolve and runs `versus:parity`
     against the deployed function.

  It skips with a notice until it is configured, and when the live build has no `version.json` or was built from a
  dirty tree.
- `versus-parity` reads the publishable key from `VERSUS_PARITY_APIKEY` when there is no `apps/web/.env` (CI).

**Setup the owner must do once** (repo Settings > Secrets and variables > Actions):
- **secret `SUPABASE_ACCESS_TOKEN`:** a Supabase personal access token;
- **secret `SUPABASE_ANON_KEY`:** the publishable key;
- **variable `LIVE_SITE_URL`:** the live game's URL.

**Window that remains.** Up to about 10 minutes after a Netlify upload, plus the scheduled-run delay GitHub sometimes
adds. During that window a new-content client can't start a match. Running the workflow by hand from the Actions tab
right after a Netlify upload closes it immediately.
