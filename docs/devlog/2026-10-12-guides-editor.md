# 2026-10-12: The guide editor (step 2 of 4)

Owner ask (2026-10-11): "i'd like the ability to edit existing guides while in game and save them. The existing
[guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that, one
should be able to create a new guide either from scratch or by duplicating an existing guide."

Spec: `docs/superpowers/specs/2026-10-11-community-guides-design.md`. Plan:
`docs/superpowers/plans/2026-10-11-community-guides-2-editor.md`. Step 1 (storage and reading) is
`docs/devlog/2026-10-12-guides-storage.md`. This is the editor step. A player's guide is still private to them:
publishing is step 3, moderation step 4.

## What shipped

- **The seam** (`guidesRemote.ts`): it can now save, delete and import guides through the `guide-write` function, and
  read one guide by id, the signed-in player's own guides, and whether the account is on the team. Every refusal comes
  back as a stable code. A call that never reaches the server reads `offline`; a function that is not deployed (HTTP
  404) reads `unavailable`. The guide in a save answer is read with its own reader (`parseGuideAnswer`), because the
  function answers a record it has already read, not a table row. `guideMessages.ts` turns each code into a plain
  sentence for the action that was refused (a save, a delete or the import).
- **The store** (`guidesStore.ts`): holds the team flag and the player's own guides next to Team Ascent's, and the user
  id those guides belong to (`mineOwner`). A save or a delete updates the lists at once. A read that was already in
  flight when a save landed does not overwrite it: it re-reads instead. When the identity changes (another account, or
  none) the team flag and the player's guides are cleared at once, before any read answers, and a pending rail edit
  request is dropped. A saved player guide is kept only when its author is the account at the keyboard.
- **Drafts** (`guideDrafts.ts`): the editable form of a guide, and the step from that form to the server document. The
  named cards and the sets are worked out when the guide is saved, not typed by the author. A card in the guide that is
  not in the set (Core, Enablers, or the card a nickname points at) is "missing" and blocks the save until it is
  removed. A half-typed nickname (a word with no card, or a card with no word) also blocks the save, with a sentence.
- **The device draft** (`guideDraftStore.ts`): one unsaved guide per account, kept in this browser under
  `ascent.guideDraft:<userId>`. It is written a moment after each change, at once when a save of unsaved changes is
  refused, and when the editor is closed from outside. The editor remembers what the slot held when it opened and what
  it last wrote itself, and only ever undoes or clears its own write. It is a per-device convenience, not the saved
  guide.
- **The card picker** (`GuideCardPicker.tsx`): search the set's cards by name. Enter picks the top match of what was
  typed. With nothing typed, Enter picks nothing.
- **The editor** (`GuideEditor.tsx`): the guide card a reader sees, made editable. Art icon, title, tagline, "by" line,
  Team Ascent or My own (team only), tribes and a "pairs with" tribe, the write-up, Core and Enablers rows (add, remove,
  move earlier or later), nicknames, and a live preview under the text box where card names light up. The title box has
  focus when the editor opens. The write-up is one paragraph: Enter adds no line break there and a pasted line break
  becomes one space. Every field is locked while a save, delete or refetch is on its way, so typed text cannot be lost
  to the answer. If the server says someone else saved first, the editor offers "Load their version" or "Overwrite with
  mine" and pre-selects neither. Cancel and Esc ask only when the guide has unsaved changes; with none they close at
  once. Delete always asks. A guide deleted elsewhere while it was being edited becomes a new guide: the editor says
  "This guide was deleted. Press Save again to keep your text as a new guide." Esc closes the card inspect overlay
  first, then the picker, then takes away a question that is showing (and does nothing else), then asks to leave; it
  stands aside while the bug reporter is open.
- **The Guides tab** (`CompendiumGuides.tsx`): Team Ascent and My guides pills, New guide, Duplicate on every guide,
  Edit on the guides the account may change, a "Based on" line on a copy, and a line for a guest that says to sign in.
  The badges (Private, Hidden by Team Ascent, Not in this set) are drawn only under the My guides pill. When the server
  cannot be reached the buttons that write are disabled and the tab says so. A team account sees "Import built-in
  guides" while the built-in copies are showing. There is one device slot per account, so one unsaved guide at a time
  per account: while one is waiting, New guide, Edit and Duplicate ask the author to Resume or Discard it first (Discard
  asks again). A player who already has 20 guides is told so when they press New guide or Duplicate, before anything is
  written. When the editor reports that a new player guide was saved, the tab switches to My guides and says "Saved to
  My guides."
- **The lobby rail** (`LobbyGuides.tsx`, `LobbyPanel.tsx`): "Your guides" appear under Team Ascent's, the header count
  includes them, and an open card has an Edit button when the guide can be changed. Edit sets the edit request, then
  opens the Compendium on that guide. The button is drawn only when guides come from the server. The rail's snapshot
  takes the player's own guides only when the store holds them for the signed-in account, remembers which account it
  was taken for, and hides those guides the moment the account changes.

## Decisions that differ from the spec

The owner (Mike) approved the plan as a whole on 2026-10-12 ("approved, go subagent-driven") and raised no objection
to any of the nine items below.

1. Reordering cards uses two arrow buttons, not drag. A row holds at most six cards, and arrows work with mouse, touch
   and keyboard. Drag can be added later without changing anything else.
2. Editing takes over the Guides tab. While a guide is being edited the list is hidden, so tribe pills and search
   cannot filter the card away from its author.
3. Closing the Compendium outright does not ask. Cancel and Esc ask when there are unsaved changes, and Delete always
   asks. The X button or a press on the dimmed surround keeps the unfinished guide on the device and offers it back
   with Resume.
4. Buttons are words, not icons. The icon set has no pencil, copy, bin or plus.
5. A guest who presses New guide or Duplicate sees an inline "Sign in to write your own guides" line with a Create
   account button, not the portrait sign-in pop-up.
6. Card names light up in a live preview under the text box, not inside it. A text box cannot colour part of its text.
7. "Import before creating a Team Ascent guide" is enforced by the client only: the option is absent until the import
   has run. The two people it constrains are the team.
8. A copy of a built-in guide made before the import has no "Based on" line, because there is no server row to point at.
9. `store.ts` is not touched. This one did NOT hold: two lines in `packages/ui/src/store.ts` changed. The identity
   `onChange` now calls `loadGuides()` unconditionally (it used to be skipped when there was no account), so signing out
   clears the previous account's guides at once. `signOutAccount` also calls `loadGuides()` itself. The second line
   exists because a sign-out whose request fails (the device is offline) fires no identity change at all, so the first
   line never ran and the last account's private guides stayed in the lobby rail for the next person. A privacy rule
   outranks the hot-file rule here. The rail's Edit link still reaches the Compendium through the guides store, not a
   new field on the game store.

Rulings made during the build, in plain terms:

- Step 2 was built on top of step 1's branch while step 1's pull request was open, and took `main` in once step 1 was
  merged. The branch now differs from `main` by step 2's work only.
- Wording: a refusal that the player can act on names the next step ("Duplicate it to make your own."). A network
  failure with no HTTP status reads as offline, and that has its own test.
- A delete that the server answers "not found" counts as done: the guide is already gone, so the editor closes.
- A save that the server answers "not found" (the guide was deleted elsewhere) turns the draft into a new guide, and
  so does "Load their version" or "Overwrite with mine" with the same answer. The dead guide is also dropped from the
  lists. Without this the only way out was Delete, which throws the text away.
- A read that started before a local save or delete does not undo it. After a change of account, `team`, `mine`, a
  pending rail edit request and the Compendium pill (back to Team Ascent) are all reset.
- Nickname cards count as named cards: they are checked for "missing" like Core and Enablers, and "Remove missing
  cards" also drops a nickname row whose card is missing. Nickname cards get their slots in the hover list before the
  write-up's own names, so a long write-up cannot make a valid nickname fail. A "pairs with" tribe that is not on the
  set is reported as pairs-with, not as tribes.
- The editor draws every tribe the guide holds, even ones not on this set's roster, so a guide that did not carry over
  to a set can be repaired. Such a tribe's pill says "(not in this set)" in its text, and so does an off-roster "pairs
  with" choice, which can be set to None.
- The Save button is on whenever the editor is not busy (a save with no change is harmless). A save that lands after
  the editor closed still updates the lists, and clears the device draft only if the stored draft is still the one it
  sent, so a closed editor cannot leave a draft that Resume would save a second time.
- A refused save writes the device draft at once when there are unsaved changes. A guide with no unsaved changes
  writes nothing. The sentence the player reads says "kept on this device" only when the device holds the text at that
  moment. With nothing kept, an offline refusal reads "Could not reach the server. Try again."
- The conflict bar takes focus itself, not a button, because its first button replaces the author's text and a stray
  Enter after a keyboard save would throw the work away.
- The device-draft rules went through four rounds and ended as one model (the editor remembers what the slot held at
  open and what it wrote itself). A first idea, "clear the device copy when a change is undone", was withdrawn because
  it wiped a resumed draft.
- A kept draft with nothing in it (no title, write-up, tagline or cards) is not offered back. An ask (sign in, Resume
  or discard first, or the 20-guide cap) scrolls into view and takes focus. Resume reads the device again when pressed
  and opens what the device holds at that moment; if it holds nothing, the bar is dropped and the tab says "That guide
  was already saved." The Resume bar belongs to the account it was read for.
- The warning text in the editor uses the theme's warning colour. The panels (the picker, the question bars, the
  toolbar notes) use the Compendium's chip background and its 7px corner, and the badge uses 12.5px text. The other
  radii, shadows and hover text copy the Compendium's own style and were left as they are, for the owner's look pass.
- Rail: the header count includes the player's own guides, and the snapshot is tied to the account it was taken for.
  This narrows "the rail never changes while it is open" in exactly one case, a change of account, because privacy
  outranks it.

## Found by the whole-branch review and fixed before the pull request

One review of the whole branch ran after every task was done. It found one critical problem, four important ones and
some smaller ones. All of the following were fixed, each with a test that failed first.

- W1 (critical): the guide in a save answer was read with the reader for table rows. The function answers a record
  whose keys are already in camelCase, so the author, the art icon, "pairs with", the "Based on" line and the order
  were silently lost. A player's own just-saved guide then had no Edit button until the game was restarted. A second
  edit of a Team Ascent guide would have written the loss back to the server: the icon reset to the first Core card and
  the "pairs with" tribe wiped, for every player. No test saw it because the seam test's fake answered with a table
  row, a shape the real function never sends, and the other tests replaced the seam altogether. Now the answer is read
  as what it is, either shape parses, and a tripwire test fails when the record gains a field the reader does not
  carry.
- W2: a sign-out whose request failed left the last account's private guides in the lobby rail. Now `signOutAccount`
  clears them itself, the store records whose guides it holds, and the rail and My guides draw them only for that
  account.
- W3: a save that landed after its author signed out (or another account signed in) joined the next account's list.
  Now a saved player guide is kept only when its author is the account at the keyboard.
- W4: at the 20-guide cap a player could write a whole guide and then be refused. Now New guide and Duplicate say "You
  already have 20 guides. Delete one to make room." before the editor opens. Edit, Resume and a team account are not
  stopped.
- W5: there was one device slot for every account, so a second account's typing overwrote the first account's waiting
  guide. Now each account has its own slot (`ascent.guideDraft:<userId>`).
- W6: leaving a resumed guide that was never saved asked "Discard your changes?" and then removed the whole guide. Now
  it asks "Discard this unsaved guide? It cannot be brought back."
- W7: "Load their version" on a resumed draft that was not changed left that stale draft offered again. Now it leaves
  the device.
- W8: a refused delete and a refused import spoke in save sentences, and a refused save said "kept on this device"
  even when nothing was kept. Now each action has its own words, and "kept on this device" is said only when it is
  true.
- W9: Esc did not answer the question that was showing: it closed the editor from under a delete question, or swapped
  one question for another. Now Esc takes the showing question away and does nothing else.
- W10: dragging a text selection out of the Compendium window and releasing on the dimmed surround closed the
  Compendium. Now the surround closes it only when the press also began on the surround.
- W11: the write-up box accepted line breaks that the saved guide does not keep. Now Enter adds no line break there
  and a pasted line break becomes one space.
- W12: focus fell to the page when the editor opened. Now the title box has focus.

The same wave also took the smaller items queued by the task reviews: Enter on an empty card search picks nothing; the
off-roster tribe pill says "(not in this set)"; the panel look values named above; Resume opens the guide the device
holds at that moment; "Saved to My guides." comes from the editor's report, not from the list growing; the toolbar is
marked busy for a screen reader until it is known whether guides can be written; an error note that replaces a status
note is announced; and the Resume bar's Discard question is withdrawn when the bar hides.

## Known gaps (for the owner)

- Every player guide is private until step 3. Nothing a player writes is visible to anyone else yet.
- The look is a first cut and has not been judged in a real render: the corner radii, the panel colours, and the text
  sizes in the editor and the toolbar. The design linter still flags some of them. The owner decides.
- Closing the Compendium outright (X, or a press on the dimmed surround) does not ask. The draft is kept and Resume
  offers it back.
- Reordering is by arrows, not drag.
- Focus falls to the page when the editor closes, and closing the editor returns the list to its top.
- At the cap, if the 20th guide was made on another device since this game last read the list, the player can still
  write a guide that is refused, and cannot delete an old one without discarding it. Closing this needs a Delete on
  the My guides card, or Edit while a draft waits. That is step 3.
- The Compendium still announces "Press Esc or Tab to close" while the editor has taken both keys.
- An offline sign-out does not end the Supabase session at all. This is older than this work and wider than guides;
  this step only makes sure the guides are cleared.
- A write-up is one paragraph. The server flattens line breaks. Whether guides should have paragraphs is the owner's
  call for step 3.
- The Compendium subtitle under My guides still describes Team Ascent's build lines ("N guides. Build lines for ...").
- A refused Edit from the rail (the guide was deleted since the rail's snapshot was taken) lands on the Guides tab with
  no explanation.

## Performance

To be filled by the render measurement before the pull request opens.

## Not verified here

Nothing in this step was run against the live Supabase project. The `guide-write` function is not deployed, the
migration from step 1 is run by the owner, and the two-account row-level-security check has never been run (the
runbook is `supabase/README.md`, "The editor (step 2)", item 3). Until the function is deployed, a save answers "Guides
cannot be saved yet. Try again later." and unsaved text is kept on the device. The Import button, the Edit button on a
Team Ascent guide, and every save have only been exercised against test doubles: of the seam, of the Supabase client,
and (in the round-trip test) the real handler over the real SQL in an in-process database.

Deploying `guide-write` is the owner's action. It is not done by this work.

## Carried to the next steps

Step 2 (this step) is done once the owner has run the runbook. Open from this step for the owner: the look pass on the
editor and toolbar, and the owner's look at the "Missing or removed" slot (carried from step 1).

Step 3 (publishing):

- Publishing must re-run the text rules on the stored guide, because the word list will have changed since it was
  saved.
- The owner's word-list review.
- Player titles imitating Team Ascent.
- A client-made id as an idempotency key, before guides are public. A save that times out at 15 seconds reads as
  offline but may still land, and a retry then makes a second guide or a false "someone else saved".
- `sameList` treats "same row id and revision" as "same guide", so any server change that does not bump `revision`
  (publish, bookmark counts, hide, retag) will not reach an open session. Bump `revision` in those functions, or
  compare `updatedAt`.
- Two nickname rows with the same word: the later one wins silently.
- The reading view links a card name inside a longer word, while the editor's mentions are whole-name.
- One focus pass: after Keep editing, after a pick fills a row, after un-picking a pill, after a discard.
- Re-probe on the browser `online` event. A game that loaded offline stays offline until the Guides tab is reopened
  or the identity changes, and the Resume bar is hidden meanwhile.
- The other states with no way forward except reopening the tab: a read of the player's own guides that times out
  after an account change shows "You have not written a guide yet."; a team flag that could not be read shows no Edit
  and no Import, with no sign that it is unknown; after Import the re-read can join a read already in flight, so the
  Import button can linger.
- A nickname word over the length limit gets the "needs a word and a card" sentence, which does not mention length.
- A Delete on the My guides card, or Edit while a draft waits (the cap gap above).
- Whether a write-up may have paragraphs (the gap above).

Step 4 (moderation):

- A hidden Team Ascent guide stays readable.
- "Based on" snapshots outlive a hidden source.
- Whether an author may edit a guide the team has hidden. Today's SQL allows it and the spec says the author may edit
  or delete it; the Edit button is drawn today.
