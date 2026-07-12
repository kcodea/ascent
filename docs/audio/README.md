# Audio docs

- **`sfx-guide.html`** — the **sound recording worklist**: an interactive, offline checklist of every
  sound the game needs (filename, when it fires, a creative brief, and status), with search, filters,
  per-section progress, and copy-the-save-path buttons. **Just double-click it** to open in any browser —
  no server, no install, works offline. Your check-offs are saved in that browser (a personal tally); the
  canonical shared status is `sfx-manifest.md`, refreshed by `npm run sfx:manifest`.

  It's a snapshot of the manifest at the time it was generated. To refresh it against the current card set,
  ask Claude to rebuild it from `sfx-manifest.md` (or we can wire `npm run sfx:manifest` to emit it too).

- **`sfx-manifest.md`** — the canonical, generated manifest (the source of truth for what to record and
  what's done). See the header in that file for the naming convention + recording workflow.
