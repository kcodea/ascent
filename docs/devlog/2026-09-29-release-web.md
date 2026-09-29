# 2026-09-29 — `npm run release:web` (the browser build, cut from origin/main, ready for Netlify)

Owner ask: *"i want my friend to be able to build the same type of zips from main to deploy to netlify"* — then,
once the manual steps were written out and it was clear how many footguns they carried: *"yes build the
release:web script"*.

## Where the browser build actually goes

**Netlify**, not itch.io. Nothing in the repo said so before this entry, which is the root of the confusion:
every script and filename on this path is named for itch (`package:itch`, `scripts/package-itch.ps1`,
`ascent-itch.zip`) because itch was the original target. The web zip outgrew itch's hard 1000-file cap — it is
~1785 files now — and moved to Netlify, which has no such limit. The naming never followed.

## Why a script and not a checklist

`npm run package:itch` zips **whatever is in the working folder**: main plus every uncommitted edit, plus every
untracked file a glob picks up (fx defs, art), on whatever branch the shared checkout was last switched to.
That is the same trap `release:desktop` was written for in September — every "the exe is missing X" report
traced back to a build like that. The badge prints a `*` when the tree was dirty, but nobody reads a badge
before uploading.

The manual path also ends in a **red error that must be ignored**: `package-itch.ps1` writes the zip, prints
`Created … (119,291 KB, 1785 files).`, and *then* checks the count against itch's cap, fails it, and
`exit 1`s — so npm reports the command failed even though the zip beside it is perfect. Telling a second
person "run this, it will look like it broke, upload the file anyway" is not a process.

## What it does

`scripts/release-web.mjs`, wired as `npm run release:web`, mirrors `scripts/release-desktop.mjs` step for step:

1. `git fetch origin`, resolve `origin/main` — that SHA is the release.
2. Check it out **detached** in `.claude/worktrees/release-web`, then refuse to continue unless `git status`
   there is completely empty and HEAD is exactly that SHA.
3. `npm ci` in that worktree — lockfile-exact, never the primary checkout's `node_modules`.
4. `npm run build:web` there.
5. **Verify the build.** The short SHA really is baked into a JS chunk (a stale `dist` cannot slip through),
   and every local file `index.html` points at exists on disk — the class of bug that shipped a blank damage
   splash in September, where a path resolved in dev and 404'd from the deployed bundle.
6. **Zip, then read the zip back and prove its shape**: `index.html` at the archive ROOT (one folder down and
   Netlify serves a directory listing instead of the game) and no backslash entry names. Zipping uses Windows'
   bsdtar by absolute path, for the reasons already documented in `package-itch-desktop.mjs` — `tar` on PATH is
   Git's GNU tar and cannot write zip, and `Compress-Archive` writes backslash entries that Linux reads as
   literal filenames.
7. Copy it out as `ascent-web-<sha>.zip` (now gitignored alongside `ascent-itch*.zip`).

The filename carries the same short SHA the title screen prints, computed the same way `vite.config.ts` does
(`git rev-parse --short HEAD`, whatever length git chooses) — so "which build is live?" is answered by reading
the badge, never by guessing at a timestamp.

No flags, and no skip-the-install escape hatch: this is the path a second person runs occasionally, and every
option is a way for the build to stop being `origin/main`.

## Not changed

`package:itch` stays exactly as it is — it is still the right tool for a quick local look at a production
build of your own working folder. Its README line now says so, instead of claiming it targets itch.io.
