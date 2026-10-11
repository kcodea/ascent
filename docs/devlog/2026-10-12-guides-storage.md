# 2026-10-12: Guides move to the server (step 1 of 4)

Owner ask (2026-10-11): "i'd like the ability to edit existing guides while in game and save them. The existing
[guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that, one
should be able to create a new guide either from scratch or by duplicating an existing guide."

Spec: `docs/superpowers/specs/2026-10-11-community-guides-design.md`. Plan:
`docs/superpowers/plans/2026-10-11-community-guides-1-storage.md`. This is the storage and reading step. Nothing a
player sees changes yet: the editor is step 2, publishing step 3, moderation step 4.

## What shipped

- **`@game/guides`** (`packages/guides/`): wire types, the owner's limits, draft validation, the game's first word
  filter, the set carry-over rule, and the `guide-write` handler. Dependency-free; `npm run guides:shared` generates
  the Deno copies and a test fails CI when they drift.
- **Database** (`supabase/migrations/2026-10-12-guides.sql`): `guides`, `guide_team`, `guide_bookmarks`,
  `guide_reports` and `guide_writes` (a save log for the rate limit). Read under row-level security (official, or
  published and not hidden, or your own, or you are on the team). No client write policy: `guide_save`,
  `guide_delete` and `guide_import_builtins` are the only writers and only the service role may call them. They hold
  the row rules: official = team only, 20 guides per player, 30 saves an hour, a stale revision is a conflict.
  Official (Team Ascent) rows store no author, so they depend on no account, and a deleted player's guides are
  deleted with the account. Each account's saves are serialised with an advisory lock so a burst of parallel saves
  cannot beat the 20-guide cap or the 30-per-hour limit. Table writes and the write functions are revoked from
  client roles as a second line behind row-level security.
- **`guide-write`** Edge Function: verifies the token, refuses guests, and answers 401 / 403 before reading the body.
  It refuses a body over 64 KB measured in bytes (a declared-size check before reading, then a tested byte count)
  before parsing it, then runs the handler.
- **Client**: `guidesStore` loads the official guides in the background when identity lands; the eleven built-in
  guides (`guides.bundled.ts`) show until the server answers with at least one usable guide. The rail takes its
  snapshot in a layout effect, before paint, when its Guides view opens, so a refresh never moves a card under the
  reader; the Compendium subscribes.
- **Sets**: a guide carries `sets` instead of one `set`. `guidesFor` filters on it. One built-in guide (Ale) now
  also qualifies for Set 3 under the carry-over rule, which is invisible while Set 3 is not live; Set 2's guides and
  their order are unchanged.
- **A card that left**: its portrait stays in the row, greyed and labelled "Missing or removed", with no hover. The
  slot is inert for every part of the card (a spell's cost coin re-enables pointer events otherwise), and a nickname
  for a missing card is not linked.

## Decisions that differ from the spec

1. The art icon does not count toward set membership (the Imps guide's icon is a token in no set's pool).
2. Official guides keep today's order: a `sort_order` column, guides grouped by first tribe in the order each tribe
   first appears once the list is ordered by `sort_order` then id, Neutral last. A tribe's guides stay adjacent even
   when orders tie.
3. A dropped connection keeps the last loaded list rather than falling back to the built-in copies mid-session.
4. `store.ts` gets the boot call (one import, two lines).
5. The import button waits for step 2; the op and its tests are here.
6. Official rows store `author_id = null` and the foreign key is `on delete cascade` (the spec said the author is
   the team member who created the guide). A team member leaving cannot delete Team Ascent guides, and a deleted
   player's guides do not linger. `updated_by` still records the last editor.
7. The invisible-character set is wider than first planned: zero-width characters, the bidi controls including the
   isolates (U+2066 to U+2069, U+061C), and blank-rendering fillers (U+00AD, U+034F, U+180E, U+2800, U+3164,
   U+FFA0, the Hangul fillers U+115F and U+1160, the Khmer inherent vowels U+17B4 and U+17B5). A title made only of
   them is refused. The set also strips U+200C and U+200D, which splits joined emoji and affects Persian and Indic
   text; acceptable for an English-language game. The emoji variation selectors (U+FE00 to U+FE0F) are left alone.
8. Reserved "by" lines are compared with repeated letters collapsed, so "Teaam Ascent" and "Aadmin" are refused too.
9. A server row tagged with the tribe `neutral` is treated as a Neutral guide rather than dropped.
10. Card ids and nicknames `__proto__`, `constructor` and `prototype` are refused by the server and treated as
    unknown cards by the client, because the card index is a plain object.

## Owner actions before step 2 can be used

Run the migration, add the two team accounts, deploy `guide-write` (`supabase/README.md`, "Guides on the server").

## Known gaps (for the owner)

- The word filter is deliberately basic. Known to pass today: a stretched vowel inside a doubled-letter stem, plurals
  and suffixed forms of whole-word entries, and non-Latin lookalike letters (which also get past the Team Ascent
  reservation). Nothing public depends on it until publishing ships in step 3; the owner reviews the list before
  then. Report and Hide (step 4) are the real defence.
- "!" inside a word is read as the letter i, at the end of a word it is punctuation; whole-word matching also blocks
  innocent uses such as a name containing a listed word. Two consequences of that rule pass today and are for the
  list review: a doubled "!!" inside a word ("sh!!t"), and a listed word whose last letter is written as "!".
- The look of the "Missing or removed" slot is a first cut that has not been judged in a real render.
- The advisory lock cannot be raced in PGlite (one connection), so it is verified by reading, not by a test.
- Deleting an imported built-in guide is undone by the next import.

## Performance

Measured headlessly (the logic only): with the content package already loaded, importing the guides module costs
14 to 19 ms once, under `tsx`, which includes transpiling its files on the fly; the bundled game pays less. That is
the eleven built-in guides plus the card-id sets for the three sets. `guidesFor` takes about 0.002 ms a call and
`guideMissingIds` about 0.0002 ms a guide, and both sit behind `useMemo`. Nothing was added to a per-frame path and
nothing animates.

NOT measured: the DevTools render pass on the production build that `docs/performance.md` asks for (opening the
rail's Guides view and the Compendium Guides tab). This step draws nothing new unless a guide holds a missing card,
which cannot happen before the step 2 import. That measurement is owed with step 2, where the screens change.

## Not verified here

Row-level security and the write functions are executed against PGlite, not the live project. The live check (a
private guide unreadable by a second account) is in the step 2 plan, when there is a way to create one.

The three local test timeouts in `packages/ui/src/audio/master.test.ts` and `packages/ui/src/audioDefaultMix.test.ts`
fail identically on the code from before this branch on the development machine; CI is the gate.

## Carried to the next steps

Step 2 (the editor):

- A team edit of a Team Ascent guide must send `official: true` (the server refuses a mismatch rather than ignoring
  it).
- The built-in import must run before any new Team Ascent guide is created.
- Treat the capability `unknown` as not on.
- Re-read guides on an identity change even while a read is in flight.
- The live two-account check of row-level security.
- The owner's look at the "Missing or removed" slot before the first import makes it reachable.

Step 3 (publishing):

- Publishing must re-run the text rules on the stored guide, because the word list will have changed since it was
  saved.
- The owner's word-list review.
- Player titles imitating Team Ascent.

Step 4 (moderation):

- A hidden Team Ascent guide stays readable.
- "Based on" snapshots outlive a hidden source.
