# 2026-10-12: Reports, hiding and the release tools (step 4 of 4)

Owner ask (2026-10-11): "i'd like the ability to edit existing guides while in game and save them. The existing
[guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that, one
should be able to create a new guide either from scratch or by duplicating an existing guide."

Spec: `docs/superpowers/specs/2026-10-11-community-guides-design.md` (section 9, item 4; sections 1, 3, 4, 5 and 6 for
the rules). Plan: `docs/superpowers/plans/2026-10-12-community-guides-4-moderation.md`. Earlier steps: storage and
reading is `docs/devlog/2026-10-12-guides-storage.md`, the editor is `docs/devlog/2026-10-12-guides-editor.md`,
publishing and the Community list is `docs/devlog/2026-10-12-guides-community.md`. This is the last step: players can
report a guide, the team can hide it, and the team has the two tools for a release (carrying guides over to a new set,
and refreshing the built-in guides). It adds a migration and changes the Edge Function's handler (`supabase/`, which
the ownership map does not name; `packages/guides` and `packages/tools` are Kevin's side), so Kevin should read those.

## What shipped

- **The shared rules** (`packages/guides`): the four report reasons (offensive, spam, impersonation, other), and four
  limits in `GUIDE_LIMITS`: a report's note is at most 300 characters, 10 reports a day for each account, 120
  bookmark changes an hour for each account, and 200 guides in one carry-over request. `validateReport` checks the
  reason (never changed or guessed) and cleans the note, then counts its characters after cleaning, so a note of
  invisible characters is empty and a long one is refused. The Deno copies under `supabase/functions/_shared/` are
  regenerated, not hand-edited.
- **The SQL** (`supabase/migrations/2026-10-14-guides-moderation.sql`, the same block appended to `schema.sql`). The
  "14" orders the file after the 2026-10-12 and 2026-10-13 files; it is not a date promise. The database test takes
  its edges (10, 120, 200, 300) from `GUIDE_LIMITS` and reads the same numbers out of the migration text, so changing a
  limit in one place and not the other turns a test red.
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
  200 distinct ids (ids that differ only by letter case count as the same). **The "Based on" line is now re-checked at
  publish**: if the title or "by" line of the guide a copy was made from now breaks the word rules, the copy cannot be
  published, and the player is told why and to write it as a new guide instead.
- **The seam** (`guidesRemote.ts`): four writes (`reportGuideRemote`, `setHiddenRemote`, `dismissReportsRemote`,
  `retagSetRemote`) and three reads (`fetchOpenReports`, `fetchHiddenGuides`, `fetchGuideTags`). The reads page through
  the whole result like every other list (R-NET-01). Only the open-reports read is closed to everyone but the team
  (row-level security on `guide_reports`: anyone else gets no rows). The hidden-guides and tag reads return what the
  account may already read: for the team every hidden guide and every guide, for a player their own hidden guides and
  the public ones. The Reports pill is not drawn for anyone else. The three reads wait 30 seconds (the others 4),
  because each open report carries its whole guide and a wave of reports is when the list is longest.
- **The helpers and sentences** (`guideReports.ts`, `guideMessages.ts`): `groupReports` (one group for each guide, the
  most reported first, at most five notes, and how many more there are), `planCarryOver` (a guide carries over when
  every card and tribe it names is in the new set, the same rule a save uses) and `batches`. **One rule for every
  sentence about a write: no sentence says a write did not happen unless the server answered a known refusal for
  it.** The known refusals of each action are written down once (`KNOWN_REFUSALS`); a lost answer, an unreadable one
  or a code nobody knows reads "Check again in a moment to see whether it changed." (or "...it was deleted.", "...they
  were imported."), and the screen then reads the guides again. A report is the one exception in its words: there is
  nothing to check, and pressing again is safe, so it reads "Something went wrong. Try again in a moment."
- **The card** (`CompendiumGuideCard.tsx`): **Report** on someone else's published guide, under every pill. It opens a
  small form on the card: one of four reasons (needed), a note (optional, 300 characters), Send report and Cancel. A
  guest is asked to sign in before the form opens: the line reads "Sign in to write, bookmark and report guides."
  (followed by "It is free and takes a minute." when sign-in is possible). After a report the button reads Reported
  and cannot be pressed again, and the card says "Reported. Thank you." A **refused report keeps the reason and the
  note that were typed**, so trying again is one press. Inside the form, **Tab and Shift+Tab move focus as usual and
  Escape is Cancel** (the game's own Tab and Escape keys, which close the Compendium, do not reach it). The team is
  also offered **Hide** (asks first), **Unhide** and **Delete** on any player's guide, under every pill, and its card
  reads "Hidden by Team Ascent" when hidden and "Published" or "Private" (a hidden guide may be private too). A
  guide's author sees one badge, "Hidden by Team Ascent", where it said Published. These buttons, and Edit on a Team
  Ascent guide, and Import, are drawn **only for the account that holds the team flag**: the store's flag belongs to
  the account it was read for, a card is drawn anew when the account changes, and the lobby list follows the same rule.
  A delete whose answer was lost, or came and could not be read, says "Could not reach the server. Check again in a
  moment to see whether it was deleted." or "Something went wrong. Check again in a moment to see whether it was
  deleted." (the author's own delete too) and reads the guides again. The import note ("Imported N guides.") is said
  only to the account that pressed.
- **The Reports pill** (`ReportsPanel.tsx`): a fifth pill, drawn only while guides are on and the guides store holds
  the team flag for the account that is signed in (while guides are not on, it is drawn switched off). It holds three
  things. **Open reports**: one entry for each reported guide, the most reported first, with a summary such as "3
  reports: 2 Spam, 1 Offensive.", up to five of the newest notes (then "and 3 more notes."), the guide's card, and a
  Dismiss reports button that dismisses all of that guide's open reports together. **Hidden guides**: every hidden
  guide, with Unhide and Delete, so a guide hidden straight from Community (no report) can still be found; a guide
  that is both reported and hidden is drawn in both lists. **Carry guides over**: pick the set, press Check to read the
  three numbers ("84 guides carry over to Set 3. 31 stay behind. 12 already have it."), then Carry over, which sends
  the ids in batches of 200. While a run is going, and when it stops, the line counts the ids sent ("Carried over 200
  of 284."; a stopped run adds "so far. Press Check to continue."). When it has finished it says the server's own
  number ("Carried over 84 guides to Set 3.", or "No guide needed carrying over to Set 3." when the server changed
  none). When a run ends and a batch landed or may have, the guides are read again, so every list shows them in the
  new set without a restart. The two lists are read together and each stands alone: if one cannot be read the other
  still shows and the failed one says "Could not load the reports." or "Could not load the hidden guides." with Try
  again; each says "Loading reports." or "Loading hidden guides." only until its first answer, and what is drawn stays
  until a newer answer lands. The Dismiss buttons are off from the press until the lists have been read again, so the
  same reports are never dismissed twice; afterwards keyboard focus goes to the Dismiss button of the group now in that
  place (or the "Open reports" heading when none is left). The panel belongs to one account (it is keyed by the
  account), holds none of its data in the guides store or on the device, and is thrown away the moment the account
  changes; an answer that lands after the account changed is dropped and a run sends no further batch. A card under
  Reports offers no Edit. While guides go offline the panel is taken away and the tab says "Guides are offline." The
  subtitle reads "Reports and tools for Team Ascent." The line a Check or a run answers with is scrolled into view.
- **`npm run guides:pull`** (`packages/tools/src/guides-pull.ts`, with the pure text maker in
  `packages/guides/src/bundledSource.ts`): rewrites `guides.bundled.ts` whole from the live Team Ascent guides, so the
  offline fallback matches what players see online. It only reads: one anonymous request with the public key from
  `apps/web/.env`, with a 15 second limit. It stops, and writes nothing, on: an answer that is not OK, a short or
  uncounted answer (the server's own total must match the rows it sent), a row it cannot read, a Team Ascent guide
  that is in no set, more than 50 Team Ascent guides (the most one press of Import can send), or no guides at all. Its
  closing hint, and the runbook, say to run `npx vitest run packages/ui/src/guides` (the whole folder, so every card in
  every guide must resolve), then commit the file. The output is plain ASCII.
- **The built-in guides' pins are retired.** No test pins the built-in guides' titles, slugs or count any more, so a
  live edit followed by a pull never needs a test edit. The structural checks stay (every card resolves, every guide
  has a set, ids are unique, and the count stays within what Import can send). Two owner pins the plan did not name
  went with them: the Ale card-list test and the Golden Ale icon pin.
- **Docs**: a patch notes entry, one sentence in the rules wiki answer about guides (and the alias "report"), and the
  runbook section "Reports, hiding and release tools (step 4)" in `supabase/README.md`, with a table of what a player
  or the team reads while the migration and the function are only half done.

## Decisions that differ from the spec

**These ten are provisional. The owner has not reviewed this plan.** While step 3 ran the owner said "keep going - dont
stop for anything"; the plan was written and started under that, and its decisions were listed to the owner in chat as
open to veto. Every decision and ruling below is listed for the owner to overrule. If any is wrong, the cost is a
change in the pull request, which the owner can refuse or have changed; nothing here is deployed or run against the
live project.

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
   new guide and shows up in Community like any other. The team sees the copy in Reports only if a player reports it.
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
- **Task 2: two minor findings were not fixed**, a report racing a hide and carry-over taking a guide to nine sets, and
  one note for the owner was kept: an account that reported a guide cannot report it again. All three are under Known
  gaps. If wrong: each is one small change.
- **Task 5 (the card): a refused report keeps the reason and the note** (the plan said the form opens empty). Losing 300
  typed characters on "try again" is worse. If wrong: six lines.
- **Task 5: a delete whose answer was lost says to check again, for the author's own delete too, and reads the guides
  again**, the same reasoning as step 3's publish. If wrong: one sentence.
- **Task 5: the guest line reads "Sign in to write, bookmark and report guides."** If wrong: one sentence.
- **Task 5: the team's buttons are drawn only for the account that holds the flag**, not from the store's raw team flag
  (the review found the raw flag could be a previous account's after a missed read; the server refused the presses
  either way). If wrong: a small diff.
- **The lobby list's team flag was fixed the same way, inside the Reports pill task.** If wrong: a small diff in a file
  that task did not list.
- **Task 5: six deviations from the plan were kept**, each with a test: a refresh keeps the drawn guides until the
  answer lands (the plan's design unmounted the card and lost its sentence), Try again repeats the last ask, a report
  that cannot even be asked answers the offline sentence, cards are keyed by the account, the card can note the
  outcome of an action, and focus after a sent report goes to the sentence. If wrong: each is small to revert.
- **Task 5: three review items were not changed.** A refresh after a team action takes the Community list back to its
  first page; Unhide is reachable only where a hidden guide is drawn (the Reports pill's hidden list does that); and
  Escape closes the Compendium as it does for every other card question. The Escape ruling was later reversed for the
  report form (below). If wrong: each is one small change; the first is a Known gap.
- **Task 6 (the Reports pill): its deviations from the brief were kept** (no Edit under Reports, the panel keyed by the
  account, Dismiss off until the lists are read again, the refusal drawn inside its group, headings in the
  Compendium's section style, one extra CSS rule so each note has its own line) except one: the done line first
  counted the ids sent and now says the server's number.
- **Task 6: the review's fixes were taken** (the session shows carried-over guides at once; the lobby gate's team half is
  pinned; the done line; a loading line for the hidden list; the layout gap), **and four items were not changed**: everything
  is listed at once with Carry guides over below the hidden list, the tribe pills and search box do nothing under
  Reports, a run is abandoned quietly when the panel is left, and the reports read carries each report's whole guide.
  All four are Known gaps. If wrong: each is one small change.
- **The Reports pill task started while the card's re-review was still reading,** and the whole-branch review started
  beside the pill's re-review. Both re-reviews were read only, so no two agents edited a file at once. If wrong: one
  extra fix round.
- **Task 7 (`guides:pull`): its fix round widened the file list to three other test files** that pinned built-in slugs,
  the count and an alias. The task's purpose is that a live edit plus a pull never needs a test edit, and the plan's
  list missed them. If wrong: test-only changes. The slug-less guide and the missing render comparison were not taken
  (Known gaps).
- **The fix wave took the whole-branch review's items** under the one rule for sentences (above), and **reversed the
  Escape ruling for the report form only**: it holds typed text, so Escape is Cancel there, and Tab moves focus. If
  wrong: a few lines in one form.
- **No oracle rule was added** for the team-flag fixes or any other review finding. The repo asks every bug fix to add
  an approved rule in `packages/rules`, but an approved rule needs the owner's own words as evidence, there are none
  here, and the registry holds no guides rule at all (steps 1 to 3 added none). Instead one pending question,
  `q-guides-team-flag-account`, asks the owner to rule who is drawn the team's controls (the account the flag was read
  for, not whichever account is signed in now). If wrong: the owner says so on the pull request and a rule is added
  with their words, pinned by `guidesReport.test.tsx` and `lobbyGuidesRail.test.tsx`.
- **`guides:pull` still writes each guide's oldest set tag** (a reviewer wanted the newest; the two reviewers
  disagreed). It matters only after a carry-over, a card archived mid-set from the newer set and a player who is
  offline. If wrong: one line in `bundledSource.ts` and a test.
- **These docs were corrected once, after the fix wave and the render,** not alongside each change. If wrong: they were
  inaccurate for the length of that work, on an unpushed branch.

## Found by the reviews and the render, and fixed before this entry

- **Task reviews.** The report tests could not fail for the three mistakes that matter. The SQL's shipped bookmark rules
  and the rules that need a second guide or a second account were unpinned. The round-trip walk found the plan wrong in
  one place: a publish of a guide that is already published is a no-op, answered before the hidden check, so "the
  author publishing a hidden guide is refused" is only true after an unpublish. A hidden guide stays published, so its
  author's card shows Unpublish, never a Publish that quietly does nothing. The card unmounted and lost its sentence on
  a refresh. The card drew the team's buttons from the store's raw flag. A refused report threw away what was typed.
  A delete whose answer was lost said it had failed. The built-in guides were pinned by title, slug, count or an alias
  in several test files, which would have broken on the first pull, and the pull script did not stop on an unreadable
  row, a guide with no set, a short answer or a hung connection.
- **The Reports pill review.** After a carry-over the session went on showing the old sets until a restart (the
  comparison of "the same guides" ignored sets, and nothing read again). The lobby gate's team half was unpinned. The
  done line counted ids sent instead of the server's number.
- **The whole-branch review.** Tab inside the report form closed the Compendium and threw the report away: the game's
  Tab key reached the form. Sentences claimed "nothing was changed" or "it was not deleted" after answers that can
  follow a write that landed (a publish whose answer could not be read, a lost bookmark, a lost import). The team could
  not tell a private guide from a public one outside My guides. `guides:pull` could write more guides than one press of
  Import can send. The SQL's numbers were not tied to the shared limits. The team's lists waited 4 seconds. Only five
  notes were drawn with no word that there were more. A dead `drop index` statement sat in the migration. A save from
  a game build older than a set removes the set a carry-over added (docs only; see Known gaps).
- **The fix wave itself found one more.** A test written first showed the import note ("Imported 3 guides.") being
  shown to the next account when the answer landed after an account change. It is now said only to the account that
  pressed.
- **The render.** After Check, the result line was drawn just below the visible edge of the scroll box, so a moderator
  had to scroll to read it. It is now scrolled into view.
- **This entry's own docs.** The first version said a hidden guide is seen only by its author (the team sees it too),
  said the Reports pill is where the team sees a hidden guide's copy come back (it does not), said every new read is
  closed to non-team accounts (only one is), and had the Hide check never bookmark the guide.

## Known gaps (for the owner)

- A report that arrives at the same moment as a hide can stay open on a hidden guide. One Dismiss clears it.
- Carry-over can take a guide to nine sets once nine sets exist, and its author's next save would then be refused
  (a guide holds at most eight).
- A save from a game build older than a set drops the set a carry-over added (the client recomputes the sets it knows
  and the server writes what it is sent). Run Carry guides over again a few days after launch. The code fix, a save
  that keeps the sets the build does not know, is a later step.
- `guides:pull` writes a live guide that has no slug under its row id.
- `guides:pull` writes each guide's oldest set tag.
- Nothing compares the committed built-in file to its own render, so a hand edit that drifts from the generator's
  layout is not caught.
- A refresh after a team action (hide, unhide, delete) takes the Community list back to its first page, and the team
  member loses their place.
- Escape cancels the report form, but elsewhere on a card it still closes the Compendium. Tab past Cancel leaves the
  form as usual, and the next Tab, pressed outside it, closes the Compendium and takes a half-written report with it.
- The report note is not word-filtered. The team reads it; nobody else can. A NUL character in a note is not stripped.
- There is no account blocking. A hide stops a guide, not its author: they can duplicate it and publish the copy.
- One report for each account and guide, ever: an account that reported a guide cannot report it again after the guide
  is unhidden, nor after its report is dismissed (so a guide edited into something bad after a dismissal cannot be
  re-reported by the same player).
- Everything under Reports is listed at once, and Carry guides over sits below the hidden list, so it is a long scroll
  when there are many hidden guides.
- The tribe pills and the search box do nothing under Reports.
- A carry-over run is abandoned quietly if the panel is left (another pill, the editor, closing the Compendium, an
  account change): safe to repeat. Leave the tab open until it says Carried over.
- The open-reports read carries each report's whole guide.
- Only five notes are drawn for a reported guide, then "and N more notes."
- A moderator who reports a guide from its card under Reports sees the old count until another action reads again.
- The Dismiss buttons can stay off for up to 30 seconds on a stalled connection (they wait for the lists to be read
  again, and the team's reads wait 30 seconds). The first open says "Loading reports." for as long.
- After a lost answer plus a failed re-read, the Guides tab stays "offline" until the browser's online event, an
  account change, or leaving the Guides tab and coming back. Nothing false is shown. A lost bookmark or import can reach
  this now, as a lost publish or hide could.
- `unavailable` (the function is not deployed) and an old function's `bad_op` read "check again" although nothing can
  have landed.
- A hidden Team Ascent guide cannot happen (the team cannot hide one). "Based on" snapshots still outlive a hidden
  source; publishing re-checks that line against the word rules only.
- An author can still Edit a guide the team has hidden (the spec says they may). Publish is off for it, and it stays
  hidden whatever they change.
- A hidden player guide that is already bookmarked leaves the bookmarker's list silently, and its bookmark count stays.
- The author of a hidden guide can read, on their own row, the id of the team account that hid it (step 1 already
  exposes `updated_by` the same way).
- No oracle rule exists for the team-flag fixes. The repo asks for one with the owner's words as evidence and there is no
  such quote; one pending question, `q-guides-team-flag-account`, asks for the ruling.
- A few small test and seam gaps from the task reviews remain. None hides a known defect.
- Nothing about timing was measured in any of the four steps (see Performance). The spec's section 7 asks for a
  measurement on the production build before each UI step ships; it is undelivered, and is the owner's call.
- The look of everything new is a first cut that the owner has not judged. It was rendered once (see Not verified here).

## Performance

Nothing was measured in this run, so no number is given. What can be said from reading the code: typing in the report
note redraws the form only, never the card (the draft lives in a ref); the Reports pill reads its data once when it
opens and again after an action; every list read is paged; nothing animates and no layout is read per frame. For the
owner, two minutes on the production build (the routine of steps 2 and 3, pointed at the new controls): open the
Compendium's Guides tab, press Report on a Community card and type a 300-character note; then, signed in as a team
account, open the Reports pill with many reports and many hidden guides and scroll it, and press Check in Carry guides
over with the full guide table (it reads every guide) and watch for a pause; no long task over 50 ms is the bar. The
measurements owed from steps 1 to 3 are still owed too.

## Not verified here

Nothing in this step was run against the live Supabase project. The migration is not run, `guide-write` is not
redeployed, and `npm run guides:pull` has never been run (the script has only been read and tested against fakes). The
runbook's two-account check (`supabase/README.md`, "Reports, hiding and release tools (step 4)", item 3) has never been
run. Real PostgREST never answered the embedded reports read or its row-level security, and two parallel calls from one
account were never run (the test database has one connection; the advisory lock rests on reasoning, as in step 3).

What was exercised: the SQL against an in-process database (the real functions, with the earlier files run first), the
handler against a fake database, the seam against a fake client, the screens against jsdom, and one walk that joins
the client, the handler and the SQL (`guidesRoundTrip.test.ts`). At the end of the fix wave the guides, UI and rules
suites passed twice in a row, with every file that mounts the Compendium or the lobby list; the whole repository suite
was not run.

**Rendered once.** The branch was served on a local server with a made-up local account, and the Supabase client's
answers were faked inside the page, so nothing reached the live project. Seen: a player's Community card; the report
form, with a real Tab and Shift+Tab moving focus while the Compendium stayed open; a sent report (the button reads
Reported, "Reported. Thank you." holds focus); the team's card; the Reports pill with two groups and a hidden guide;
and Check and a carry-over. Switching the fake to a non-team account removed the pill and the panel at once. No box
collapsed or overflowed. It found one thing, fixed: the result line was below the visible edge of the scroll box, and
is now scrolled into view (seen again after the fix: the scroll box moved and the line was fully visible, and the page itself did not scroll). **Not rendered:** Hide, Unhide, Delete and Dismiss pressed for
real (their calls and re-reads are covered by tests and the round trip), the offline pill, and a stopped run. No timing
was measured.

## What is left of the whole design

This gathers the carried lists of all four steps, so the next person has one list.

Owner actions before this is live:

- Run the three migrations in order (2026-10-12, 2026-10-13, 2026-10-14), add the two team accounts, deploy
  `guide-write` (this branch's), import the built-in guides before creating any new Team Ascent guide, and run the
  runbook's two-account checks for steps 2, 3 and 4. None has been run against the live project.
- Read the word list and the limits (publishing makes player text public), and the new limits in this step.
- Rule on the pending question about who is drawn the team's controls, and judge the look of the editor, the toolbar,
  the new buttons, the pills and the Reports pill, and the "Missing or removed" slot.
- A few days after a new set goes live, run Carry guides over again.

Questions only the owner can answer:

- Whether a write-up may have paragraphs (today it is one).
- Whether bookmarks on guides that went private should be shown, or cleared (they use one of the 200 and cannot be
  seen until the guide is public again).
- Whether an author should be able to edit a guide the team has hidden.
- Whether account blocking is wanted, now that a hide stops a guide and not its author.

Later steps (code):

- A save that keeps the set tags the build does not know, so a carry-over is durable.
- A "Try again" on the offline line, and a kinder line when the function or an operation is simply not there yet.

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
