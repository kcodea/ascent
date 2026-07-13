# Audio docs

> **Adding sound to the game? Start with [`RECORDING-GUIDE.md`](RECORDING-GUIDE.md)** — the full
> record → name → import → hear-it workflow, naming reference, mixing, and troubleshooting.

Both files below are **generated together** by `npm run sfx:manifest` from the real card/hero/spell data —
edit the manifest's Creative-brief/Status columns (preserved across runs), never the tables' Filename/Trigger.

- **`sfx-guide.html`** — the **sound recording worklist**: an interactive, offline checklist of every
  sound the game needs (filename, when it fires, a creative brief, and status), with search, filters,
  per-section progress, and copy-the-save-path buttons. **Just double-click it** to open in any browser —
  no server, no install, works offline. Your check-offs are saved in that browser (a personal tally); the
  canonical shared status is `sfx-manifest.md`. Auto-regenerated from the manifest each run (the layout lives
  in `sfx-guide.template.html`; the data is injected), so it never drifts from the card set.

- **`sfx-manifest.md`** — the canonical manifest (the source of truth for what to record and what's done).
  See the header in that file for the naming convention + recording workflow.

- **`sfx-guide.template.html`** — the guide's static layout (CSS/JS) with a data placeholder; not opened
  directly. `npm run sfx:manifest` injects the current rows into it to produce `sfx-guide.html`.
