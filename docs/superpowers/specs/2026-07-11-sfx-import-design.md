# SFX Drop-Folder Importer — Design Spec

**Date:** 2026-07-11
**Owner:** Mike (audio workflow) · lives in `packages/tools` (shared tooling)
**Status:** Draft for review

## Goal

Cut the friction of getting recorded audio clips into the game. A CLI — `npm run sfx:import` — takes
loosely-named `.mp3` files from a drop folder, **resolves each to its exact target** in
`packages/ui/src/audio/…` (knowing display-name↔id, e.g. Pennycat→`alley`, Yirin→`rohan`), moves it there,
and refreshes the manifest. Confident matches move; anything ambiguous is left in place and reported — never
a silent wrong move.

This is the "drag to import" the sandboxed claude.ai guide can't do (a web page there can't write to the
repo). Native OS drag into a folder + one command does the job, identically for both devs.

## Workflow

1. Record + export clips, named naturally by **display name OR internal id** + a **variant word**:
   `Pennycat death.mp3`, `warden power.mp3`, `alley effect.mp3`, `Yirin.mp3`.
2. Drop them into `audio-inbox/` at the repo root (gitignored; the script creates it if missing).
3. `npm run sfx:import` → resolves, moves into `packages/ui/src/audio/<path>`, prints a summary, then runs
   `npm run sfx:manifest` so statuses flip `⬜→🎙️`.

## Naming → target rules

Targets follow the manifest's filename convention (all under `packages/ui/src/audio/`):

| Variant token(s) in the filename | Target |
|---|---|
| `death` | `cards/<id>.death.mp3` |
| `effect` \| `battlecry` \| `deathrattle` \| `shout` \| `echo` | `cards/<id>.effect.mp3` |
| `power` \| `heropower` | `heroes/<id>.power.mp3` |
| `select` \| `pick` \| `choose` (or a bare hero, no variant) | `heroes/<id>.mp3` |
| `play` \| `cast` \| none (a card) | `cards/<id>.mp3` |

Card vs hero is decided by the variant (power/select ⇒ hero) and by which registry the resolved id belongs
to. The plain-clip case (`cards/<id>.mp3` vs `heroes/<id>.mp3`) resolves by whether the id is a card or hero.

## Architecture

Two units, split so the hard part (matching) is pure and testable:

### `packages/tools/src/sfx-import.lib.ts` (pure — no fs)
- **`buildIndex(cards, heroes)`** → an index of `{ cardIds:Set, heroIds:Set, nameToId:Map (slugged display
  name → id, for both registries, hero variants tagged), effectCardIds:Set (cards with an onPlay/onDeath/…
  effect, so we can flag a `.effect` clip for a vanilla card) }`. Fed the real `ALL_CARDS`/`HEROES` by the
  runner; tests feed fixtures.
- **`parseName(basename)`** → `{ variant: 'play'|'death'|'effect'|'select'|'power'|null, phrase: string }` —
  lowercases, splits on space/`_`/`-`/`.`, pulls the variant keyword(s), the remainder is the id/name phrase.
- **`resolveId(phrase, index)`** → `{ id, kind:'card'|'hero', confidence:'exact'|'fuzzy', score } | null` —
  exact id → exact name-slug → fuzzy (Levenshtein, accept only within a tight threshold *and* unambiguous;
  ties/too-far ⇒ null with the near-misses as suggestions).
- **`matchFile(basename, index)`** → one of:
  - `{ ok:true, target:'cards/alley.death.mp3', id, variant, confidence }`
  - `{ ok:false, reason, suggestions:string[] }` (unresolved id, ambiguous, variant/kind mismatch, or a
    `.effect` for a vanilla card → reason `"<name> has no effect to voice"`).
- A small **Levenshtein** + **slugify** helper live here (no deps).

### `packages/tools/src/sfx-import.ts` (runner — fs + orchestration)
- Reads `audio-inbox/` (creates it with a short `README.txt` if absent).
- For each entry: skip non-`.mp3` (note it); `matchFile`; collision check against
  `packages/ui/src/audio/<target>`.
- **Applies confident matches** (move, or copy with `--keep`); leaves the rest.
- Prints a grouped summary: **Moved** (file → target), **Skipped** (exists / not mp3), **Unmatched**
  (reason + suggestions). Exit 0 always (a report, not a failure) unless a real fs error.
- After ≥1 move (and not `--dry`), runs the manifest regen (`sfx-manifest.ts`) so statuses update.
- Flags: `--dry` (preview, no writes), `--keep` (copy not move), `--force` (overwrite existing targets),
  `--inbox <dir>` (override the drop folder).

## Data flow

`audio-inbox/*.mp3` → `parseName` → `resolveId` → `matchFile` → (confident) move → `packages/ui/src/audio/…`
→ `sfx:manifest` → status `🎙️`. Ambiguous files stay in the inbox for a rename + re-run.

## Error handling

- **Ambiguous / unresolved** → not moved; reported with suggestions (the safe default).
- **Target exists** → skipped unless `--force`.
- **Non-mp3** → skipped with "export as .mp3".
- **`.effect` for a vanilla card** → skipped with an explanation (no effect fires, so no clip is needed).
- **fs errors** (permission, disk) → surface the message, non-zero exit.

## Testing

`sfx-import.lib.test.ts` (pure, fixtures — no fs, no `@game/*`):
- `parseName`: variant extraction across separators (`Pennycat death`, `pennycat_death`, `pennycat-death`,
  `pennycat.death`), and no-variant.
- `resolveId`: exact id (`alley`), display name (`pennycat`→`alley`, `yirin`→`rohan`), fuzzy typo
  (`penycat`→`alley`), ambiguous/too-far → null + suggestions.
- `matchFile`: full names → targets for each variant; hero select vs power; exact-basename passthrough
  (`alley.death` already-correct); vanilla `.effect` → not-ok with reason.

The runner's fs/move is thin and verified by a real `--dry` run over a temp inbox during implementation.

## Out of scope

- Audio format conversion (wav→mp3), normalization, trimming. (Skip non-mp3 with a note.)
- Interactive prompts / TUI — the report-and-rerun loop replaces them.
- Writing to the repo from the claude.ai artifact (impossible; that's why this is a local CLI).
- Any change to the manifest generator or the audio wiring (this only *calls* `sfx:manifest`).

## Open decisions for review

1. **Auto-run `sfx:manifest` after a successful import** — assumed **on** (convenient; keeps status live).
   Off → the script just prints the command. Toggle via `--no-manifest` regardless.
2. **Fuzzy threshold** — assumed conservative (Levenshtein ≤2 for ids/names of length ≥4, and only if the
   best candidate clearly beats the runner-up). Prefer more matches (looser) or fewer surprises (stricter)?
3. **Move vs copy default** — assumed **move** (empties the inbox); `--keep` copies. OK, or default to copy?
