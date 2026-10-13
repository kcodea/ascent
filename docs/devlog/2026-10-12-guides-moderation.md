# 2026-10-12: Reports, hiding and the release tools (step 4 of 4)

Owner ask (2026-10-11): "i'd like the ability to edit existing guides while in game and save them. The existing
[guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that, one
should be able to create a new guide either from scratch or by duplicating an existing guide."

Spec: `docs/superpowers/specs/2026-10-11-community-guides-design.md` (section 9, item 4; sections 1, 3, 4, 5 and 6 for
the rules). Plan: `docs/superpowers/plans/2026-10-12-community-guides-4-moderation.md`. Earlier steps: storage and
reading is `docs/devlog/2026-10-12-guides-storage.md`, the editor is `docs/devlog/2026-10-12-guides-editor.md`,
publishing and the Community list is `docs/devlog/2026-10-12-guides-community.md`. This is the last step: players can
report a guide, the team can hide it, and the team has the two tools for a release (carrying guides over to a new set,
and refreshing the built-in guides). It adds a migration and changes the Edge Function's handler, which sit on Kevin's
side of the ownership map.

## What shipped

- **The shared rules** (`packages/guides`): the four report reasons (offensive, spam, impersonation, other), and four
  limits in `GUIDE_LIMITS`: a report's note is at most 300 characters, 10 reports a day for each account, 120
  bookmark changes an hour for each account, and 200 guides in one carry-over request. `validateReport` checks the
  reason (never changed or guessed) and cleans the note, then counts its characters after cleaning, so a note of
  invisible characters is empty and a long one is refused. The Deno copies under `supabase/functions/_shared/` are
  regenerated, not hand-edited.
- **The SQL** (`supabase/migrations/2026-10-14-guides-moderation.sql`, the same block appended to `schema.sql`). The
  "14" orders the file after the 2026-10-12 and 2026-10-13 files; it is not a date promise.
  - `guide_report`: a signed-in player reports someone else's published guide that is not hidden. Never your own guide,
    never a Team Ascent guide, and a guide you cannot read answers "not found". One report for each account and
    guide, for good (the check looks at every report ever sent, open or not), and 10 a day. The note is at most 300
    characters.
  - `guide_set_hidden`: the team hides or unhides a player's guide. A Team Ascent guide cannot be hidden (it is edited
    or deleted). Hiding marks the guide's open reports actioned. Hiding a guide that is already hidden keeps who hid
    it first, and when. A missing direction is refused, not read as "unhide".
  - `guide_dismiss_reports`: the team dismisses every open report of one guide, and is told how many.
  - `guide_retag_set`: the team adds one set to up to 200 named guides. It only ever adds: a guide that already has
    the set is skipped, and no set is ever removed, so a card archived mid-set does not untag a guide. The text and
    the revision are not touched, so an author who is editing is not disturbed.
  - `guide_bookmark_log` and a limit in `guide_bookmark`: 120 changes an hour for each account. A call that changes
    nothing is not counted, the check comes before anything is read (so it cannot be used to probe), and a missing
    direction is refused. Log rows older than a day are cleared as the account changes bookmarks.
  - Indexes for the open reports, for a reporter's recent reports, and for the team's hidden list (newest first).
  - The four new functions are closed to the public, `anon` and `authenticated`, and open to `service_role` only, as
    in step 3. Every team operation checks `guide_team` in SQL; the client's idea of who is on the team is never
    trusted.
- **The function** (`guide-write`): four new ops, `report`, `setHidden`, `resolveReport` and `retagSets`. The id comes
  from the verified token, as before. New stable refusals: `already_reported` (409), `report_limit` (429),
  `bad_report` (422), `bad_set` and `bad_ids` (400). `retagSets` accepts only a set id of the right shape and 1 to
  200 distinct ids. **The "Based on" line is now re-checked at publish**: if the title or "by" line of the guide a
  copy was made from now breaks the word rules, the copy cannot be published, and the player is told why and to write
  it as a new guide instead.
- **The seam** (`guidesRemote.ts`): four writes (`reportGuideRemote`, `setHiddenRemote`, `dismissReportsRemote`,
  `retagSetRemote`) and three reads (`fetchOpenReports`, `fetchHiddenGuides`, `fetchGuideTags`). The reads page through
  the whole result like every other list (R-NET-01) and are answered in full only for a team account (row-level
  security on `guide_reports` and the read rule on `guides`); anyone else gets no rows. The tag read takes the sets,
  tribes and cards of every guide and has a longer limit (30 seconds) than the others.
- **The helpers and sentences** (`guideReports.ts`, `guideMessages.ts`): `groupReports` (one group for each guide, the
  most reported first), `planCarryOver` (a guide carries over when every card and tribe it names is in the new set,
  the same rule a save uses) and `batches`. Sentences for `report` and for the team's actions never say more than is
  true: a report or a hide whose answer was lost says to check again, not that it failed.
- **The card** (`CompendiumGuideCard.tsx`): **Report** on someone else's published guide, under every pill. It opens a
  small form on the card: one of four reasons (needed), a note (optional, 300 characters), Send report and Cancel. A
  guest is asked to sign in before the form opens ("Sign in to write, bookmark and report guides."). After a report
  the button reads Reported and cannot be pressed again, and the card says "Reported. Thank you." A **refused report
  keeps the reason and the note that were typed**, so Try again is one press. The team is also offered **Hide** (asks
  first), **Unhide** and **Delete** on any player's guide, under every pill; a hidden guide wears "Hidden by Team
  Ascent" for the team too. These buttons, and Edit on a Team Ascent guide, and Import, are drawn **only for the
  account that holds the team flag**: the store's flag belongs to the account it was read for, and a card is drawn
  anew when the account changes. A delete whose answer was lost (the author's own too) says "Could not reach the
  server. Check again in a moment to see whether it was deleted." and reads the guides again.
- **The Reports pill** (`ReportsPanel.tsx`): a fifth pill, drawn only for a team account while guides are on. It
  holds three things. **Open reports**: one entry for each reported guide, the most reported first, with a summary
  such as "3 reports: 2 Spam, 1 Offensive.", up to five of the newest notes, the guide's card, and a Dismiss reports
  button that dismisses all of that guide's open reports together. **Hidden guides**: every hidden guide, with Unhide
  and Delete, so a guide hidden straight from Community (no report) can still be found. **Carry guides over**: pick
  the set, press Check to read the three numbers (how many carry over, how many stay behind, how many already have
  the set), then Carry over, which sends the ids in batches of 200 and says how far it got if one batch fails.
  Nothing about reports is held in the guides store; the panel reads its own data and drops it the moment the account
  changes.
<!-- CHECK AFTER TASK 6 -->
- **`npm run guides:pull`** (`packages/tools/src/guides-pull.ts`, with the pure text maker in
  `packages/guides/src/bundledSource.ts`): rewrites `guides.bundled.ts` whole from the live Team Ascent guides, so the
  offline fallback matches what players see online. It only reads: one anonymous request with the public key from
  `apps/web/.env`, with a 15 second limit. It stops, and writes nothing, on: an answer that is not OK, a short or
  uncounted answer (the server's own total must match the rows it sent), a row it cannot read, a Team Ascent guide
  that is in no set, or no guides at all. Its closing hint, and the runbook, say to run `npx vitest run
  packages/ui/src/guides` (the whole folder, so every card in every guide must resolve), then commit the file. The
  output is plain ASCII.
- **The built-in guides' pins are retired.** No test pins the built-in guides' titles, slugs or count any more, so a
  live edit followed by a pull never needs a test edit. The structural checks stay (every card resolves, every guide
  has a set, ids are unique). Two owner pins the plan did not name went with them: the Ale card-list test and the
  Golden Ale icon pin.
- **Docs**: a patch notes entry, one sentence in the rules wiki answer about guides (and the alias "report"), and the
  runbook section "Reports, hiding and release tools (step 4)" in `supabase/README.md`.

## Decisions that differ from the spec

**These ten are provisional. The owner has not reviewed this plan.** While step 3 ran the owner said "keep going - dont
stop for anything"; the plan was written and started under that, and its decisions were listed to the owner in chat as
open to veto. If any is wrong, the cost is a change in the pull request, which the owner can refuse or have changed;
nothing here is deployed or run against the live project.

1. The Reports pill holds three things, not one: open reports, hidden guides, and Carry guides over. The spec puts
   Carry guides over there already; hidden guides need a home so a guide hidden without a report (straight from
   Community) can be found and unhidden.
2. Dismiss is for a guide, not for one report. A guide's open reports are shown together and dismissed together.
3. Carry guides over only ever adds the new set to a guide. It never removes a set. The spec says a card archived
   mid-set does not untag a guide, and recomputing every tag would do exactly that.
4. The team cannot hide a Team Ascent guide. They edit or delete it. (A hidden official guide would still be readable
   under step 1's read rule.) This closes step 3's carried item "a hidden Team Ascent guide stays readable" by
   refusing the hide.
5. A report's note is not word-filtered. Only the team reads it. It is cleaned and limited to 300 characters.
6. Bookmark changes are limited to 120 an hour for each account. Carried from step 3's review; the number is the
   owner's to change (`bookmarkChangesPerHour`, and the same number in the SQL).
7. The "Based on" line is re-checked at publish. Carried from step 3's review.
8. `npm run guides:pull` rewrites `guides.bundled.ts` whole. Hand-written comments inside that file's entries are lost
   on the first pull, and the owner's exact titles and card lists stop being pinned by tests, as the spec says.
9. Blocking an account is not in this step, and not in the spec. A hide stops a guide, not its author: a copy is a
   new guide and shows up in Community like any other. The Reports pill is where the team sees it come back.
10. No Report on your own guide or on a Team Ascent guide. The button is not drawn and the server refuses.

Rulings made while building, each with what it costs if it is wrong:

- **The plan was started without a separate review** (the note above). If wrong: the work ends in a pull request the
  owner can refuse or have changed.
- **Task 1 (the shared rules): a test-only fix needed no second reviewer.** The reviewer found the report tests used
  plain strings, so counting before cleaning, counting UTF-16 units, refusing a null note or tidying the reason would
  all have passed. Five tests were added and the code was broken three ways to see each fail. If wrong: the
  whole-branch review reads it.
- **Task 2 (the SQL): the review's minor findings 3 to 11 were taken as well as the two important ones** (the shipped
  bookmark rules and the per-guide, per-account rules are pinned; a null direction is refused; retag is null-safe;
  hiding keeps the first hider; two indexes). The owner runs this file once by hand, so hardening is cheapest before
  it ships. If wrong: a slightly larger diff.
- **Task 2: two minor findings were not fixed** and are listed under Known gaps: a report racing a hide, and carry-over
  taking a guide to nine sets. Also noted for the owner: an account that reported a guide cannot report it again after
  it is unhidden.
- **Task 5 (the card): a refused report keeps the reason and the note** (the plan said the form opens empty). Losing 300
  typed characters on "try again" is worse. If wrong: six lines.
- **Task 5: a delete whose answer was lost says to check again, for the author's own delete too, and reads the guides
  again**, the same reasoning as step 3's publish. If wrong: one sentence.
- **Task 5: the guest line reads "Sign in to write, bookmark and report guides."** If wrong: one sentence.
- **Task 5: the team's buttons are drawn only for the account that holds the flag**, not from the store's raw team flag
  (the review found the raw flag could be a previous account's after a missed read; the server refused the presses
  either way). The same fix was made in the lobby rail, inside the Reports pill task. If wrong: a small diff in a file
  that task did not list.
- **Task 5: six deviations from the plan were kept**, each with a test: a refresh keeps the drawn guides until the
  answer lands (the plan's design unmounted the card and lost its sentence), Try again repeats the last ask, a report
  that cannot even be asked answers the offline sentence, cards are keyed by the account, the card can note the
  outcome of an action, and focus after a sent report goes to the sentence.
- **Task 5: three review items were not changed.** A refresh after a team action takes the Community list back to its
  first page; Unhide is reachable only where a hidden guide is drawn (the Reports pill's hidden list does that); and
  Escape in the report form closes the Compendium, as it does for every other card question. The first and last are
  listed under Known gaps.
- **Task 7 (`guides:pull`): its fix round widened the file list to three other test files** that pinned built-in slugs,
  the count and an alias. The task's purpose is that a live edit plus a pull never needs a test edit, and the plan's
  list missed them. If wrong: test-only changes the final review reads. Two minor findings were not taken (below).
- **The Reports pill task started while the card's re-review was still reading.** The re-review was read-only and any
  fix went to the pill's implementer by message, so the two never edited a file at once. If wrong: one extra fix
  round.

## Found by the task reviews and fixed before this entry

<!-- CHECK AFTER FIX WAVE -->
- Step 1's report tests could not fail for the three mistakes that matter (see the ruling above). They can now.
- The SQL review found the shipped bookmark rules and the rules that depend on a second guide or a second account
  were unpinned. They are pinned now, and sixteen mutants of the file each fail a test.
- The round-trip walk (the client's own functions against the real handler against the real SQL) found no
  disagreement between the sides. It did find the plan wrong in one place: a publish of a guide that is already
  published is a no-op, answered before the hidden check, so "the author publishing a hidden guide is refused" is only
  true after an unpublish. The walk pins both.
- A hidden guide stays published, so its author's card under My guides shows Unpublish (which works), never a Publish
  that quietly does nothing.
- The card unmounted and lost its sentence on a refresh; a refresh now keeps the drawn guides until the answer lands.
- The card drew the team's buttons from the store's raw flag. They are now drawn only for the account that holds it.
- A refused report threw away what was typed. It now keeps it.
- A delete whose answer was lost said it had failed. It now says to check again.
- The built-in guides were pinned by title, slug, count or an alias in several test files, which would have broken on
  the first pull. They no longer are. The pull script first did not stop on an unreadable row, a guide with no set, a
  short answer or a hung connection; it does now.

## Known gaps (for the owner)

- A report that arrives at the same moment as a hide can stay open on a hidden guide. One Dismiss clears it.
- Carry-over can take a guide to nine sets once nine sets exist, and its author's next save would then be refused
  (a guide holds at most eight).
- `guides:pull` writes a live guide that has no slug into the built-in file under its row id.
- Nothing compares the committed built-in file to its own render, so a hand edit that drifts from the generator's
  layout is not caught.
- A refresh after a team action (hide, unhide, delete) takes the Community list back to its first page, and the team
  member loses their place.
- Escape in the report form closes the Compendium, as it does for every other question on a card.
- The report note is not word-filtered. The team reads it; nobody else can.
- There is no account blocking. A hide stops a guide, not its author: they can duplicate it and publish the copy.
- An account that reported a guide cannot report it again after it is unhidden.
- "Based on" snapshots outlive a hidden source. Publishing re-checks the line against the word rules only.
- An author can still Edit a guide the team has hidden (the spec says they may). Publish is off for it, and it stays
  hidden whatever they change.
- A hidden player guide that is already bookmarked leaves the bookmarker's list silently, and its bookmark count stays.
- Two small test gaps from the pull script's review: the start of the Content-Range pattern is not pinned, and the rail
  highlight test assumes every mention and nickname appears in its guide's write-up, so a live guide that breaks that
  would redden it after a pull.
- <!-- CHECK AFTER FIX WAVE: gaps the whole-branch review parks go here if the fix wave does not take them -->
- The look of everything new is a first cut that has not been judged by the owner (see Not verified here).

## Performance

Nothing was measured in this run, so no number is given. What can be said from reading the code: typing in the report
note redraws the form only, never the card (the draft lives in a ref); the Reports pill reads its data once when it
opens and again after an action; every list read is paged; nothing animates and no layout is read per frame. For the
owner, two minutes on the production build (the routine of steps 2 and 3, pointed at the new controls): open the
Compendium's Guides tab, press Report on a Community card and type a 300-character note; then, signed in as a team
account, open the Reports pill with many reports and many hidden guides and scroll it; no long task over 50 ms is the
bar. The measurements owed from steps 1 to 3 are still owed too.

## Not verified here

Nothing in this step was run against the live Supabase project. The migration is not run, `guide-write` is not
redeployed, and `npm run guides:pull` has never been run (the script has only been read and tested against fakes).
The runbook's two-account check (`supabase/README.md`, "Reports, hiding and release tools (step 4)", item 3) has never
been run. What was exercised: the SQL against an in-process database (the real functions, with the earlier files run
first, and sixteen mutants of the new file each failing a test), the handler against a fake database, the seam against
a fake client, the screens against jsdom, and one walk that joins the client, the handler and the SQL
(`guidesRoundTrip.test.ts`). The advisory lock holding the limits under two parallel calls from one account rests on
reasoning, as in step 3 (the test database has one connection).
<!-- CHECK AFTER RENDER --> No screen of this step has been rendered yet at the time of writing.

## What is left of the whole design

This gathers the carried lists of all four steps, so the next person has one list.

Owner actions before this is live:

- Run the three migrations in order (2026-10-12, 2026-10-13, 2026-10-14), add the two team accounts, deploy
  `guide-write`, import the built-in guides before creating any new Team Ascent guide, and run the runbook's
  two-account checks for steps 2, 3 and 4. None has been run against the live project.
- Read the word list and the limits (publishing makes player text public), and the new limits in this step.
- Judge the look of the editor, the toolbar, the new buttons, pills and the Reports pill, and the "Missing or removed"
  slot. All were rendered once at most with made-up data.

Questions only the owner can answer:

- Whether a write-up may have paragraphs (today it is one).
- Whether bookmarks on guides that went private should be shown, or cleared (they use one of the 200 and cannot be
  seen until the guide is public again).
- Whether an author should be able to edit a guide the team has hidden.
- Whether account blocking is wanted, now that a hide stops a guide and not its author.

Polish not taken:

- One focus pass: after Keep editing, after a pick fills a row, after un-picking a pill, after a discard, after a
  successful Delete, and after removing a bookmark under Bookmarked.
- A style for a pressed Bookmarked button, and the Community card's bookmark count following a press.
- The states with no way forward except reopening the tab (a team flag that could not be read shows no Edit and no
  Import with no sign that it is unknown; a read of the player's own guides that times out after an account change
  says "You have not written a guide yet.").
- A nickname word over the length limit gets a sentence that does not mention length.
- A guard on the card when an unsaved edit of the guide waits on the Resume bar.
- Closing the editor or the Compendium outright does not ask; reordering is by arrows, not drag; the Compendium still
  announces "Press Esc or Tab to close" while the editor has taken both keys.
- A refused Edit from the rail (the guide was deleted since the snapshot) lands on the Guides tab with no
  explanation; deleting an imported built-in guide is undone by the next import; the server caps a team member's own
  guides at 20 as well.
- The word filter and the title rule are rough by design (known passes: "TeamAscent", plurals such as "Developers",
  look-alike letters from another alphabet).
- Community search does not look in the write-up; that needs an index.
- The server does not compare content on a replayed save id (the editor's one comparison is the safety), and a retried
  new-guide save that arrives after a later save makes a second guide.
- The measurements owed from every step (the DevTools render pass on the production build).

Not in the design at all (spec section 11): likes or star ratings, comments, images or formatting in the write-up, edit
history, notifications to authors, filtering account display names elsewhere in the game, guides for heroes or runes,
translation, and manual ordering.
