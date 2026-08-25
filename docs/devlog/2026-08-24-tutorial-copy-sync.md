# 2026-08-24 — `npm run tutorial:sync`: pull tutorial copy from the authoring sheet

The Learn Ascent tutorial copy is authored in a Google Sheet (one row per step: `ID`, `Title`, `Body copy`,
`Why (rationale)`). Until now, swapping a sheet revision into the code was a hand pass over
`learnAscent.ts`. This adds a reusable tool that does it in one command.

`packages/tools/src/tutorial-copy-sync.ts`, wired as **`npm run tutorial:sync`**:

- **Default is a dry run** — reports which step's `title`/`body`/`why` would change, writes nothing.
  `-- --apply` writes; `-- --gid=NNN --sheet=ID` points at a different tab/sheet.
- **The `ID` column is the step id.** The tool DETECTS each step's syntactic home from the source rather than
  hardcoding a round list: a factory call (`heroPowerReminderStep` / `endTurnStep` / `tierStep` /
  `freeBuildStep` / `combatDebriefStep`, whose title/body/why are positional args) or an inline object literal
  with `title:` / `body:` / `why:` keys. `order-demo` is the course's `orderDemo` block (body + debrief).
- **`why` add / remove is handled** for the forms that have a slot (literals, `tierStep`, `freeBuildStep`,
  `combatDebriefStep`). A `why` the sheet gives to a form with **no** slot (a hero-power or end-turn beat) is a
  **hard error**, not a silent drop — the message says to fix the sheet or change the step's form.
- **Verifies after writing**: it re-reads every field back out of the written file and confirms it equals the
  sheet, and prints the gate command (`typecheck && lint && test && build:web`) to run next.
- **Emit style minimises churn**: single-quoted literals (the file's style) unless the value contains a
  `'`, in which case it emits a double-quoted literal — so an unchanged string re-emits byte-identical.

**The sheet is the source of truth.** A wording fix made ONLY in the code is overwritten the next time this
runs. (Concretely: the five typo corrections currently in `learnAscent.ts` differ from the sheet, so a
`tutorial:sync --apply` today would revert them — the fixes belong in the sheet.) The tool's header comment
says this too.

This PR adds only the tool + the npm script; it does not touch the tutorial copy.
