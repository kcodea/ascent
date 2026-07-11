# SFX Manifest & Audio Wiring — Design Spec

**Date:** 2026-07-10
**Owner:** Mike (presentation)
**Status:** Draft for review

## Goal

Stand up a **single, always-accurate sound-effects manifest** that enumerates every audio asset the game
needs, plus the engine wiring required to play the sounds that aren't wired yet. The manifest is the
production tracker Mike records against; the wiring plan is the list of code hooks that make each new sound
category fire.

The manifest must never silently drift from the real card/hero/spell set — so its rows are **generated from
the game data** (`ALL_CARDS`, `SPELLS`, `HEROES`), while the human-owned columns (creative brief, recording
status) are **preserved across regenerations**.

## Scope of the sound set

Grounded in the current content (counts as of 2026-07-10):

| Group | Count | Sounds each | Rows |
|---|---|---|---|
| Minions (Neutral 26, Beasts 24, Dragons 22, Undead 24, Mechs 21, Demons 21) | 138 | play, death, effect | 414 |
| Tokens | 12 | play, death, effect | 36 |
| Spells | 44 | unique cast | 44 |
| Heroes | 23 | select, power | 46 |
| Spell default bed | 1 | — | 1 |
| System / UI cues (already exist) | ~30 | — | ~30 |

≈ **570 rows** total. Counts are illustrative; the generator is the source of truth and recomputes them.

## Current audio system (what already exists)

`packages/ui/src/sfx.ts` — a Web-Audio sound bank:
- Named cues (`sfx.buy`, `sfx.sell`, `sfx.roll`, `sfx.death`, `sfx.summon`, …), each an **mp3 sample with a
  synth fallback**. Master volume + mute (localStorage), a limiter bus, and dedupe throttles on combat cues.
- Sample loader globs `./audio/*.mp3` and `./audio/cards/*.mp3`, keyed by path-minus-`.mp3`
  (`./audio/cards/alley.mp3` → key `cards/alley`).
- **Per-card voicelines already work**: `sfx.cardVoice(cardId)` plays `audio/cards/<id>.mp3` layered over the
  generic landing/cast. Dispatched from `store.ts` on the `play` action for **both minions and spells**.
  Only `alley.mp3` + `stray.mp3` exist today.
- Combat SFX are fired per-moment in `packages/ui/src/choreo/channels/sfx.ts` (`playMomentSfx`) — but with
  **generic** cues (`death`, `cast`, `buff`, `shield`, `summon`), not per-card.

## Naming conventions

Filename determines the sample key, so the convention *is* the contract. Dotted variants live in `cards/`
and already match the `cards/*.mp3` glob; `heroes/` is a new globbed folder.

| Sound | File | Fires when | Wired today? |
|---|---|---|---|
| Minion **play** | `audio/cards/<id>.mp3` | minion played to board (over generic landing) | ✅ yes |
| Minion **death** | `audio/cards/<id>.death.mp3` | that minion dies in combat | ⚠️ new hook |
| Card **effect** | `audio/cards/<id>.effect.mp3` | signature effect procs (Battlecry in shop *or* Deathrattle/Start-of-Combat/trigger in combat) | ⚠️ new hook |
| Spell **unique cast** | `audio/cards/<id>.mp3` | spell cast (over default bed) | ✅ yes (spells use `cardVoice`) |
| Spell **default bed** | `audio/spellcast.mp3` | any spell cast | ⚠️ replace synth `castSpell()` |
| Hero **select** | `audio/heroes/<id>.mp3` | hero picked in HeroSelect | ⚠️ new hook |
| Hero **power** | `audio/heroes/<id>.power.mp3` | that hero's power activates | ⚠️ new hook |

**Layering model (unchanged):** a generic *bed* (landing / cast / death / summon) always plays; the per-card
clip layers on top when present. Every per-card clip is optional — absence is silent, never an error.

**Key-derivation caveat:** `alley.death.mp3` must key as `cards/alley.death` (strip only the trailing
`.mp3`). Confirm `sampleName()` in `sfx.ts` does this; adjust if it strips from the first dot.

## Deliverable 1 — the manifest doc (`docs/audio/sfx-manifest.md`)

One markdown file, two zones:

1. **Prose zone (hand-authored, never regenerated):** overview, the layering model, the naming-convention
   table, and the wiring plan (Deliverable 3). Sits above a `<!-- GENERATED BELOW — edit brief/status only -->`
   marker.
2. **Generated zone (owned by the generator):** one table per section — **System/UI · Heroes · Spells ·
   Neutral · Beasts · Dragons · Undead · Mechs · Demons · Tokens**. Each row has four columns:

   | Filename | Trigger | Creative brief | Status |

   - **Filename** & **Trigger** — regenerated from data every run (authoritative).
   - **Creative brief** — a grounded one-liner derived from the card's real name + primary effect
     (e.g. *"Alleycat — scrappy short street-cat meow, ~0.4s"*). **Auto-seeded once** on a row's first
     appearance, then **human-owned** (never overwritten).
   - **Status** — `⬜` (to record) / `🎙️` (recorded, in tree) / `✅` (recorded + wired). Human-owned;
     defaults `⬜` for a new row. The generator may auto-flip `⬜→🎙️` when the matching file exists on disk.

System/UI rows are emitted with Status `✅` (they already ship) so the manifest is complete, not just a TODO.

## Deliverable 2 — the generator (`npm run sfx:manifest`)

- **Location:** `packages/tools/src/sfxManifest.ts` (tools already depends on core + content + sim, so it can
  import `ALL_CARDS`, `SPELL_CARDS`, and `HEROES` directly). Root script `sfx:manifest` runs it via the same
  runner the other tools scripts use (tsx/vite-node — match existing).
- **Inputs:** `ALL_CARDS` split by tribe/token/spell; `HEROES`. Excludes `enemy` filler.
- **Merge / preservation algorithm:**
  1. Read the existing `sfx-manifest.md` (if present); parse every generated table into a map
     `Filename → { brief, status }`.
  2. Rebuild every row from current data (correct ids, triggers, section grouping).
  3. For each rebuilt row: if its Filename is in the map, **carry over brief + status**; else seed brief from
     the heuristic and set status `⬜` (a blank brief flags a genuinely new card at a glance).
  4. Optionally scan `packages/ui/src/audio/**` and flip status `⬜→🎙️` for filenames that now exist.
  5. Rewrite only the generated zone (below the marker); leave the prose zone byte-for-byte untouched.
- **Brief heuristic (first-seed only):** compose from `card.name`, tribe, and the card's dominant effect
  keyword (Battlecry / Deathrattle / Start-of-Combat / Taunt / vanilla). Formulaic but a real starting point;
  humans refine. This is the one blend of approach C into B — flag for veto at review.
- **Determinism:** no `Math.random`/`Date.now` in the generator output (repo rule); stable section + id
  ordering so reruns produce no spurious diffs.
- **Idempotent:** running it twice with no content change and no brief edits yields an identical file.

## Deliverable 3 — wiring plan (the new hooks)

Documented in the manifest's prose zone; implemented as its own PR(s) after the doc lands. Each hook is
additive and guarded by "clip present?" so it's silent until assets exist.

1. **Spell default bed** — route `sfx.castSpell()` to a real `spellcast` sample (synth fallback kept).
   *File:* `sfx.ts`. Per-spell unique clip already fires via `cardVoice` in `store.ts` — no change.
2. **Minion death (per-card)** — in `playMomentSfx` (`choreo/channels/sfx.ts`), when a non-Rise `death`
   event fires, also play `cards/<deadCardId>.death.mp3` (layered over the generic `death` bed). Needs the
   dead minion's `cardId` on the death event/moment — confirm it's available there.
3. **Card effect (per-card)** — one clip, two proc sites:
   - *Combat:* piggyback the existing effect-proc point that already fires `sfx.triggerPulse()` (the trigger
     medallion release) — add `cards/<id>.effect.mp3` there, deduped like the pulse.
   - *Shop:* in `store.ts`'s `play` path, when the played card's Battlecry actually resolves, fire
     `cards/<id>.effect.mp3`. (Reuse the existing onPlay-effect inspection already in that block.)
4. **Hero select** — in `HeroSelect.tsx`, on confirm, play `heroes/<heroId>.mp3` (replacing/augmenting the
   generic `pulse`).
5. **Hero power** — where the power button currently fires `sfx.pulse()` (StatusBar), branch to
   `heroes/<heroId>.power.mp3` when present, else the generic pulse.
6. **Loader** — add `./audio/heroes/*.mp3` to the `import.meta.glob` set; add `sampleVol` entries for the new
   categories; confirm dotted-filename key derivation.

## Out of scope (explicitly not now)

- Music / ambient beds. Voice-acting direction beyond the one-line briefs. Positional/spatial audio.
- Separate shop-vs-combat effect clips (decided: **one** effect sound per card).
- Curating which cards "deserve" an effect sound (decided: **every** card gets a row; recording priority is
  the Status column's job, not the manifest's).
- Any change to the combat replay / choreographer timing.

## Open decisions for review

1. **Auto-seed briefs (B+C blend) vs. blank-until-human (pure B)?** Spec assumes auto-seed-once. Veto here to
   leave briefs blank on first gen.
2. **Status auto-flip from disk** (`⬜→🎙️` when the file exists) — convenient, or noise? Spec assumes on.
3. **One combined file** (prose + generated tables with a marker) vs. **split** (prose doc + generated
   `sfx-manifest.generated.md`). Spec assumes combined, marker-guarded.
