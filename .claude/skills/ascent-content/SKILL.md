---
name: ascent-content
description: Add, modify, archive, reprice, retribe or audit ASCENT content — cards, spells, runes, quests, heroes, tokens, set manifests — and wire card/rune art. Use when changing content data or its art/text. Not for engine primitives (use ascent-gameplay) or meta analysis without edits.
---

# ASCENT Content Authoring

Source of truth is live code under `packages/content/src/` and `packages/sim/src/heroes.ts`. Search by **id
and by displayed name** — either may have changed. Never trust a count in a document; generate it
(see `docs/CONTENT.md`).

## Before adding anything: check it does not already exist

Three separate batches have arrived containing cards or runes that already shipped under the same name doing
something different. A name collision is rejected by the validator, and a *duplicate effect* is worse — it
ships. Grep the rune/card arrays for the name AND for the effect's distinctive phrase before building.
Surface collisions to the owner instead of guessing which one wins.

## Adding a HERO: ask whether its power joins the discoverable pool

Standing owner instruction (2026-08-22). Three systems Discover hero powers — **Mimic** (a new one every
turn), **Void** (two, kept for the run) and the **Power Shifter** spell (T5) — and all three read one
function: `powerDiscoverPool` in `packages/sim/src/heroes.ts`.

Those pools are **deny-lists**, so a new hero is offerable the moment it ships unless you name it. That
default is often right, but never automatic — ask the owner. Powers that usually want excluding:

- ones that only act at **run creation** (a start-of-game grant is a strange thing to adopt on turn 9),
- ones tied to a **schedule** (a turn-N forge or quest that has already passed),
- ones that would be degenerate or dead on **Mimic's one-turn** disguise.

Excluding is one id in `MIMIC_EXCLUDED` / `VOID_EXCLUDED`; the shared kind-level bans live in
`UNDISCOVERABLE_KINDS`. If a power IS adoptable but has a creation-time gift, wire that gift into
`seedAdoptedPower` (reducer.ts) so an adopter actually receives it.

## Authoring rules

- Drawable cards go in the correct set directory (`cards/set1|set2|set3/`) and must be included by the set
  manifest in `sets.ts`.
- **Pool membership is ARRAY membership.** A rune is Basic because it lives in `RUNES` and Epic because it
  lives in `EPIC_RUNES`; `epic: true` is only the card's kicker. Moving a rune between pools means moving the
  def, not flipping the flag.
- **`sets: [...]` gates a rune/quest to particular sets — and set 1 is disabled.** A def gated to a disabled
  set silently never appears; omit the field for "every set". This is the difference between "archived" and
  "invisible", and it has fooled us before.
- `token: true` = resolves but is never drawable (reward-only, generated, forge-only minions). `CARD_INDEX` is
  global, so an out-of-set granted card still resolves — that is why a rune may safely hand out a card the
  current set does not sell.
- Preserve ids when changing balance or text unless the owner asks for a migration.
- Every Gilded effect must be explicit and mechanically sensible — doubling is not always right.
- Prefer existing effect primitives; a new one belongs to `ascent-gameplay`.
- **Card text says what the card does now.** A live-scaling value must print its current number on every
  surface. A clause describing a mechanic the card no longer has — or one that cannot happen in the active set
  — is a defect, not flavour.
- **All-types cards** (`universalTribe: true`) must NOT restate "counts as all tribes" in their text; the ALL
  pill says it. They print `tribe: 'neutral'` in data and count as every tribe via the shared tribe helpers.

## Art

Masters live outside the repo (`C:/Game Assets/Ascent Art/…`). Copy a master to
`packages/ui/src/art/<minions|spells|runes|…>/<id>.png` and run `npm run optimize-art` — it converts to WebP
and deletes the PNG. **Only wire art whose filename matches the card id or name.** Never guess from an
unattributed file; flag the ambiguity instead. Art is keyed by id, so a retribe or rename needs no rewiring.

## Verification

- Plain and Gilded text agree with the implementation.
- Tier, stats, tribe(s), keywords, token status, set membership are right.
- Discover/random pools can actually produce what the text promises.
- Named granted cards exist in the global index.
- The effect has a beat hook if the player must perceive it.
- Archived content is excluded without breaking saves/replays that resolve ids globally.

Run focused vitest plus `npm run audit`, `npm run text:audit`, `npm run typecheck`. Roster-count assertions in
the set tests will need updating when you add a card — that is expected, not a failure to route around.
