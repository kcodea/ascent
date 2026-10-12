# 2026-10-12: Publishing, bookmarks and the Community list (step 3 of 4)

Owner ask (2026-10-11): "i'd like the ability to edit existing guides while in game and save them. The existing
[guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that, one
should be able to create a new guide either from scratch or by duplicating an existing guide."

Spec: `docs/superpowers/specs/2026-10-11-community-guides-design.md` (the decision table in its section 0 says a
player's guide is shown to everyone once published, ranked by bookmark count, with a Community section in the
Compendium and bookmarked guides in the lobby rail). Plan:
`docs/superpowers/plans/2026-10-12-community-guides-3-community.md`. Step 1 (storage and reading) is
`docs/devlog/2026-10-12-guides-storage.md`, step 2 (the editor) is `docs/devlog/2026-10-12-guides-editor.md`. This is
the publishing step. Moderation (Report, hide, the team's tools) is step 4.

## What shipped

- **The shared rules** (`packages/guides`): a guide record carries `publishedAt`, the moment it first went public. A
  draft can carry a save id, which the server writes into the row's `last_save_id` (`save_id` is only the key it
  travels under in the document handed to the SQL). A player's guide title and tagline are checked against the
  reserved names (see the decisions below). New limits: 200 bookmarks per account
  (`bookmarksPerPlayer`), 20 guides per page of the Community list (`communityPage`), 40 characters of search text
  (`searchQuery`). The Deno copies under `supabase/functions/_shared/` are regenerated, not hand-edited.
- **The SQL** (`supabase/migrations/2026-10-13-guides-community.sql`, the same block appended to `schema.sql`):
  - `guides.last_save_id`. `guide_save` given the id of a save this account already made answers that row and writes
    nothing, before the rate limit, so a replay is never counted or refused. A replay is recognised only when it
    names the same guide (or no guide, for a new one).
  - `guide_own_row`: the caller's own player guide, for the function to re-check before publishing.
  - `guide_set_published`: the author makes a guide public or private. Publishing is refused while the team has it
    hidden (`guide_hidden`) and when the row is not at the revision whose text was checked (`conflict`). It counts
    toward the 30 writes an hour; unpublishing does not. Publishing does not change the revision. `published_at` is
    set the first time and kept.
  - `guide_bookmark`: bookmark a published guide that is not yours and not Team Ascent's, or remove a bookmark. 200 at
    most. Removing answers a count only for a public guide, so a removal leaks the count of nothing else.
  - A trigger keeps `guides.bookmark_count` true however a bookmark comes or goes (this function, a deleted guide, a
    deleted account). The trigger function is revoked from every role, `service_role` included: only the trigger
    runs it.
  - Indexes: the last save id, Community by most bookmarked, Community by newest (both with empty dates last and
    matching the client's order), and bookmarks by guide. The functions a caller runs (`guide_save`,
    `guide_own_row`, `guide_set_published`, `guide_bookmark`) are closed to the public, `anon` and
    `authenticated`, and open to `service_role` only.
  - The migration's header warns that running the step 1 file alone afterwards puts the old `guide_save` back.
- **The function** (`guide-write`): three new ops, `setPublished`, `bookmark` and `unbookmark`. Publishing reads the
  stored guide (`guide_own_row`), runs every text rule on the stored title, tagline, write-up, nicknames and "by" line
  (the word list may have changed since the guide was saved), and only then publishes, naming the revision it
  checked. A malformed answer from the database reads as `guide_malformed` and a bookmark count is never below 0.
- **The seam** (`guidesRemote.ts`): two writes (`setPublishedRemote`, `bookmarkGuideRemote`) and two reads
  (`fetchBookmarkedGuides`, `fetchCommunityPage`). The Community read asks the server for one page plus one row, to
  learn whether there is another page. Search text is cleaned (quotes, backslashes, percent, underscore, star and
  control characters become spaces) and cut to 40 characters, so it can only ever be a search. A bookmark whose guide is no longer
  readable (private or hidden) is dropped from the read.
- **The store** (`guidesStore.ts`): four pills (Team Ascent, My guides, Bookmarked, Community) and a `bookmarked`
  list that belongs to the signed-in account and is cleared with `mine`. "The same guide" now compares the row id,
  the revision, published, hidden and the bookmark count, so a server change that does not bump the revision (a
  publish, a hide, a bookmark count) reaches an open session. A browser `online` event re-reads guides when the game
  loaded offline. `guideBookmarked` files a confirmed bookmark at once, for the account that pressed it.
- **The editor** (`GuideEditor.tsx`, `guideDrafts.ts`): each press of Save carries a save id (`newSaveId`), kept for
  a retry of the identical document and replaced the moment any field, the revision, or the guide's identity changes
  (Overwrite and "became a new guide" each get a new id). Two nickname rows with the same word are refused. The
  reading view and the editor's preview now link a card name only as a whole word, so "important" no longer links "imp".
- **The guide card** (`CompendiumGuideCard.tsx`, moved out of the host): Publish and Unpublish, Delete and Bookmark.
  Publish asks on the card ("Everyone will be able to read it"); Delete asks on the card ("It cannot be brought
  back"); keyboard focus moves to the question's safe answer and back to the button after it. Unpublish and Bookmark
  ask nothing. The buttons sit in a two-column grid. Under My guides a guide wears Private or Published, and Hidden by
  Team Ascent or Not in this set where they apply. Publish is off for a guide the team has hidden. A player cannot
  bookmark their own guide or a Team Ascent guide: the button is not drawn.
- **The Guides tab** (`CompendiumGuides.tsx`, `CommunityGuides.tsx`, `MinionBook.tsx`): four pills. Bookmarked lists
  this account's bookmarks for the chosen set. Community asks the server: the set, the lit tribe pills (Neutral
  included), the search box, and the sort (Most bookmarked or Newest). Twenty guides at a time, with a "Show more
  guides" button. Typing in search waits 300 ms for a pause, so a word is one request. A failed load says so below
  the cards, with Try again, and a failed next page keeps the pages already shown. When guides cannot be reached the
  two new pills are off. The Compendium subtitle now says what the chosen pill shows (this closes a gap listed in
  step 2's devlog).
- **The lobby rail** (`LobbyPanel.tsx`, `LobbyGuides.tsx`): a "Bookmarked" section under "Your guides", for the
  guides whose tribe is in the lobby, counted in the header. Like the other lists it is a snapshot taken when the
  Guides view opens, drawn only for the account it was taken for. Those rows have no Edit button.

## Decisions that differ from the spec

The owner (Mike) approved the plan as a whole on 2026-10-12 ("approved, go subagent-driven"), including the ten items
below.

1. Publish is a button on the guide's card under My guides, not a switch inside the editor. Publishing is its own
   server call with its own text re-check and its own refusals; behind Save it would be two calls with two ways to
   fail behind one press. The card asks once. Unpublish does not ask.
2. The pill and the button say "Bookmarked" and "Bookmark", not "Saved". The editor already says "Saved to My
   guides." The sort reads "Most bookmarked". The rail's section is "Bookmarked".
3. The Community list grows with a "Show more guides" button, not on scroll. No scroll listener, and it is reachable
   by keyboard.
4. Community pages are held by the Community list, not by the guides store. They depend on the set, the tribe pills,
   the search text and the sort, and are thrown away when any of those change.
5. A player cannot bookmark their own guide or a Team Ascent guide. Their own would be a vote for themselves in a list
   ranked by bookmarks; Team Ascent guides are always in the rail. The server refuses as well as the card.
6. Reserved names also guard a player guide's title and tagline, on every save and at publish. Carried from step 1.
7. A Delete button on the card under My guides, asking first. It closes the dead end at the 20-guide cap, where the
   only Delete was inside the editor. Carried from step 2.
8. Community search matches the title, tagline and "by" line, not the write-up. A search over every write-up needs
   an index this step does not add.
9. Report is not in this step. It belongs to step 4 with the rest of moderation.
10. Write-ups stay one paragraph. Nothing changes until the owner says.

Rulings made during the build, in plain terms:

- **The title rule is narrower than the "by" line rule** (this departs from the plan, which said to reuse the "by"
  line check). A player guide's title and tagline are refused only when the two words "Team Ascent" stand side by
  side as whole words, or when one of the staff words (admin, moderator, developer, official) stands alone. "Ascent
  team comps", "Steam Ascent" and "Unofficial" are allowed. The "by" line keeps the stricter rule: it joins the words
  first, so both "Team Ascent" and "Ascent Team" are refused there. If this is wrong, a title such as "Ascent Team
  picks" gets through, and the team can hide it in step 4.
- **A bookmark is filed for the account that pressed Bookmark** (this departs from the plan's signature:
  `guideBookmarked` takes a fourth argument, the pressing account). One the server confirms after that account left
  is dropped from the list. The server did record it, so it returns on that account's next load. Before this, a late
  answer was filed under whoever was signed in next.
- **The SQL review's findings were taken in one round:** a removal answers a count only for a public guide; a retried
  save must name the same guide; the Community indexes declare the same order as the client; a header warning about
  re-running the step 1 file; the trigger function is revoked from `service_role` too; five test gaps closed.
- **Not taken from that review:** a stranger can tell, from "not allowed" versus "not found", that a private guide id
  exists. Step 1's save and delete already give the same bit, and an id is a random uuid.
- **Focus after a successful Delete falls to the page.** It belongs to the focus pass.
- **A guide can be deleted or published from its card while an unsaved edit of it waits on the Resume bar.** A resumed
  edit of a deleted guide already becomes a new guide with a sentence (step 2), and publishing does not change the
  revision, so a resumed edit of a published guide saves normally, word-checked.
- **A mutation-proved fix needs no second reviewer.** Small test-only or three-line fixes were checked by reading the
  diff, with a record of each test failing when the code it pins was broken.
- **The Community card's keyboard care is the card's care:** Show more and Try again hand focus back after an answer
  lands, without scrolling past the guides just added.
- **The wide button row became a grid.** Four buttons in one row (Edit, Duplicate, Publish, Delete) would have left the
  title under 200 px at two cards across.

## Found by the task reviews and fixed before this entry

- A bookmark confirmed after the account changed was filed under the next account (the critical one; see the ruling
  above). The test that asserted that outcome was wrong and was replaced, and the in-flight privacy test was made
  able to fail.
- The first title rule refused ordinary titles such as "Best Ascent team comps" and "Steam Ascent".
- Nothing pinned that publishing is counted toward the 30 writes an hour; removing a bookmark leaked the bookmark
  count of any guide id; a replay could answer a different guide than the request named.
- Publishing re-checked the stored text but only the title was pinned by a test, so a slip in the write-up, tagline,
  nickname or "by" line mapping could have let blocked stored text go public with every test green. Each field is now
  pinned. A bookmark count of -3 or a non-number was passed through; it is now 0.
- The Community and bookmark reads' order assertions pinned only column names, not the direction or where empty
  dates go. They now compare the whole order.
- The card's "is it gone" flag was cleared on unmount and never set again, so under React's development double mount
  a card stayed busy for good after its first action. Fixed with a test.
- Three cases of the "own guide only" rule (another author's guide, a guide with no server row, a guest) were not
  pinned. They are, each shown to fail when its check is removed.

## Found by the whole-branch review and fixed before the pull request

- Nothing said how to take a guide down between this step and step 4: no card offers the team a Hide, and Report is
  step 4. The runbook now gives the SQL to find a guide, hide it, undo that, and delete it.
- A publish or unpublish whose answer was lost said "Nothing was changed", although the server may have done it. The
  card now says "Could not reach the server. Check again in a moment to see whether it changed." and the guides are
  read again, so the card shows what is true as soon as the server answers.
- No test joined the client, the function's handler and the SQL for any step 3 operation: the one end-to-end test ran
  only the step 1 file. It now runs both files and walks a retried save, a publish, a second account's bookmark, an
  unpublish, a second publish and a publish refused for its stored title, through the client's own functions. The
  two sides agreed at every step.
- The pressed Bookmark button told a screen reader its state twice (a name that changed, and "pressed"). It now keeps
  one name, "Bookmark" and the guide's title, and "pressed" alone says it is bookmarked.
- Nothing pinned that another account's bookmarks never light "Bookmarked" on a card. A test does now. The code was
  right.
- The Compendium subtitle counted My guides and Bookmarked from whatever the store held, even when it held them for
  another account (the guides themselves were not drawn). It now counts them only for the signed-in account.
- Opening and closing the editor from Community put the sort back on Most bookmarked. The sort is now kept.
- A control character pasted into the search box reached the server, and the list read as "could not load". Control
  characters now become spaces.
- Two test gaps parked by the task reviews are closed: the save id's fallback paths, and the rail's bookmarked rows
  (the count for a single bookmark, the count after an account change, a bookmark with a Team Ascent guide's id).
  Closing them showed that the rail test's "not for a tribe outside the lobby" case had never run: every lobby of the
  live set holds all of its tribes. That test now takes a tribe out of the lobby by hand, and fails if there is none.

## Known gaps (for the owner)

- A Community card's bookmark count does not move after pressing Bookmark until the list is read again. The store has
  the new count; the list does not.
- A pressed "Bookmarked" button looks the same as "Bookmark" apart from its word. The card sets a class, but no rule
  styles it.
- A bookmark whose guide went private (or was hidden) still uses one of the 200 and cannot be seen or removed until the
  guide is public again. It comes back by itself if the guide does.
- Under Bookmarked, a player with bookmarks for other sets only reads "No guides match these filters."
- The title rule is a rough one. "TeamAscent" (one word) and plurals such as "Developers" pass a title, and "my team
  ascent run" is refused. The "by" line still catches "TeamAscent". A look-alike letter from another alphabet still
  passes (older than this step).
- Community search does not look in the write-up.
- There is no Report yet (step 4).
- The look of the new buttons, pills, the sort row and the Show more row is a first cut and has NOT been rendered yet
  at the time of writing. The widths were reasoned from the stylesheet. Expected to look slightly off: the sort row sits
  a grid gap below the toolbar and reads detached from it; the Show more button sits at the left edge, not centred;
  "Bookmarked" is a longer word than "Bookmark", so the button grows by a few pixels when pressed.
- Removing a bookmark under Bookmarked removes the card, so a keyboard player's focus falls to the page. So does focus
  after a successful Delete.
- Opening the editor from a Community card (Duplicate) and closing it asks the Community list again from the first
  page, with the scroll at the top. Switching pills and back does the same. The sort is kept in both cases.
- A guide that is public stays public while it is edited. Each save is word-checked, and the change shows in
  Community at once.
- A retried new-guide save that arrives after a later save of that same guide makes a second guide, because a row
  remembers only its latest save id. It needs the first save to time out, the guide to be saved again from elsewhere,
  and then the old press to be retried. A new guide whose save landed unseen while the editor closed, then resumed from
  the device copy, can also be created twice.
- The whole-name test for card names ignores accented letters, in both the editor and the reading view (they agree).
- A page of Community that cannot be read at all reads as empty when more may exist.
- The advisory lock that holds the 20-guide, 200-bookmark and 30-an-hour limits under two parallel calls from one
  account rests on reasoning: the test database has one connection, so no test can race two calls.
- A few small test gaps parked by the task reviews remain (for example the title rule's tests are thin). None hides a
  known defect.
- A save that timed out, was then edited, and is pressed again still makes a second guide. For a guide that already
  existed it reads "Someone else saved this guide while you were editing." instead. A changed guide is a new save by
  design; only an unchanged one is recognised as a retry. Nothing is lost: Overwrite works, and the extra guide can be
  deleted from its card.
- Bookmark and unbookmark are not rate limited. The 200 cap bounds how many are held, not how often they are toggled.
  The count stays true.
- The "Based on" line is not re-checked at publish. It is a snapshot of text that passed the rules of its day.
- A publish, unpublish or bookmark whose answer is lost shows a sentence, and the true state shows only after the next
  read of the guides. A publish or unpublish asks for that read at once. A bookmark does not, and its sentence still
  says nothing was changed.
- When that read after a lost publish answer cannot reach the server either, the whole Guides tab reads "Guides are
  offline." and its buttons are off, with the sentence still on the card. It comes back when the browser reports it is
  online again, or when the Guides tab is reopened. Before this fix a lost publish answer left the tab as it was.
- Removing a bookmark at the instant its guide is deleted can fail once. A second press works.
- Until step 4 the only way to take a published guide down is the SQL in the runbook.

## Performance

To be filled by the render measurement before the pull request opens.

## Not verified here

Nothing in this step was run against the live Supabase project. The migration is run, and `guide-write` is
redeployed, by the owner; neither is done by this work. The two-account check in the runbook (`supabase/README.md`,
"Publishing and bookmarks (step 3)", item 4) has never been run. The advisory lock holding the caps under two
parallel calls rests on reasoning, not a test (the test database has one connection). Nothing has been rendered yet:
how the new screens look, and how focus behaves in a real browser, are unchecked. What was exercised: the SQL against
an in-process database (the real functions, with the step 1 file run first), the handler against a fake database, the
seam against a fake client, and the screens against jsdom. One walk joins the layers: the client's own write functions
against the real handler against the real SQL in that in-process database (`guidesRoundTrip.test.ts`). The takedown
SQL in the runbook was checked against the table's column names by reading, not run.

## Carried to the next steps

Open from this step for the owner: the word-list review (publishing makes player text public); the look pass on the
editor, the toolbar, the new buttons and the pills; the owner's look at the "Missing or removed" slot (carried from
step 1).

For a polish pass or step 4 (not taken here):

- One focus pass: after Keep editing, after a pick fills a row, after un-picking a pill, after a discard, after a
  successful Delete, and after removing a bookmark under Bookmarked.
- The other states with no way forward except reopening the tab: a read of the player's own guides that times out
  after an account change shows "You have not written a guide yet."; a team flag that could not be read shows no Edit
  and no Import, with no sign that it is unknown; after Import the re-read can join a read already in flight, so the
  Import button can linger.
- A nickname word over the length limit gets the "needs a word and a card" sentence, which does not mention length.
- Whether a write-up may have paragraphs.
- The Community card's bookmark count following a press, and a style for a pressed Bookmarked button.
- Community search over the write-up, which needs an index.
- A guard on the card when an unsaved edit of the guide waits on the Resume bar, if the owner wants one.
- Whether bookmarks on guides that went private should be shown, or cleared.

Step 4 (moderation):

- Report, on each Community card.
- A hidden Team Ascent guide stays readable.
- "Based on" snapshots outlive a hidden source.
- Whether an author may edit a guide the team has hidden. Today's SQL allows it and the spec says the author may edit
  or delete it; the Edit button is drawn today. (Publish is off for a hidden guide.)
- A hidden player guide that is already bookmarked leaves the bookmarker's list silently; its bookmark count stays.
- A Hide and a Delete for the team on any guide's card. Until then, the SQL in the runbook.
- A rate limit on bookmark toggles.
- Re-checking the "Based on" snapshot at publish.
- The server comparing content on a replayed save id, instead of trusting the id alone. Today the same id with a
  different document answers the old row and writes nothing; the client never sends that, and the safety is one
  comparison in the editor.
