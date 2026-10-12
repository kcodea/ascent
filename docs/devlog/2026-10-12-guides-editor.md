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
  404) reads `unavailable`. `guideMessages.ts` turns each code into a plain sentence that says what to do next.
- **The store** (`guidesStore.ts`): holds the team flag and the player's own guides next to Team Ascent's. A save or a
  delete updates the lists at once. A read that was already in flight when a save landed does not overwrite it: it
  re-reads instead. When the identity changes (another account, or none) the team flag and the player's guides are
  cleared at once, before any read answers, and a pending rail edit request is dropped.
- **Drafts** (`guideDrafts.ts`): the editable form of a guide, and the step from that form to the server document. The
  named cards and the sets are worked out when the guide is saved, not typed by the author. A card in the guide that is
  not in the set (Core, Enablers, or the card a nickname points at) is "missing" and blocks the save until it is
  removed. A half-typed nickname (a word with no card, or a card with no word) also blocks the save, with a sentence.
- **The device draft** (`guideDraftStore.ts`): one unsaved guide, kept in this browser (`ascent.guideDraft`), written a
  moment after each change, at once when a save is refused, and when the editor is closed from outside. The editor
  remembers what the slot held when it opened and what it last wrote itself, and only ever undoes or clears its own
  write. It is a per-device convenience, not the saved guide.
- **The card picker** (`GuideCardPicker.tsx`): search the set's cards by name, Enter picks the top match.
- **The editor** (`GuideEditor.tsx`): the guide card a reader sees, made editable. Art icon, title, tagline, "by" line,
  Team Ascent or My own (team only), tribes and a "pairs with" tribe, the write-up, Core and Enablers rows (add, remove,
  move earlier or later), nicknames, and a live preview under the text box where card names light up. Every field is
  locked while a save, delete or refetch is on its way, so typed text cannot be lost to the answer. If the server says
  someone else saved first, the editor offers "Load their version" or "Overwrite with mine" and pre-selects neither.
  Cancel, Esc and Delete ask first. A guide deleted elsewhere while it was being edited becomes a new guide: the editor
  says "This guide was deleted. Press Save again to keep your text as a new guide." Esc closes the card inspect overlay
  first, then the picker, then asks to leave; it stands aside while the bug reporter is open.
- **The Guides tab** (`CompendiumGuides.tsx`): Team Ascent and My guides pills, New guide, Duplicate on every guide,
  Edit on the guides the account may change, badges (Private, Hidden by Team Ascent, Not in this set), a "Based on"
  line on a copy, and a line for a guest that says to sign in. When the server cannot be reached the buttons that write
  are disabled and the tab says so. A team account sees "Import built-in guides" while the built-in copies are showing.
  There is one device slot, so one unsaved guide at a time: while one is waiting, New guide, Edit and Duplicate ask the
  author to Resume or Discard it first (Discard asks again). A saved new guide switches the tab to My guides so it is
  visible.
- **The lobby rail** (`LobbyGuides.tsx`, `LobbyPanel.tsx`): "Your guides" appear under Team Ascent's, the header count
  includes them, and an open card has an Edit button when the guide can be changed. Edit sets the edit request, then
  opens the Compendium on that guide. The button is drawn only when guides come from the server. The rail's snapshot
  remembers which account it was taken for and hides the player's own guides the moment the account changes.

## Decisions that differ from the spec

The owner (Mike) approved the plan as a whole on 2026-10-11 ("approved, go subagent-driven") and raised no objection
to any of the nine items below.

1. Reordering cards uses two arrow buttons, not drag. A row holds at most six cards, and arrows work with mouse, touch
   and keyboard. Drag can be added later without changing anything else.
2. Editing takes over the Guides tab. While a guide is being edited the list is hidden, so tribe pills and search
   cannot filter the card away from its author.
3. Closing the Compendium outright does not ask. Cancel, Esc and Delete ask. The X button or a click outside keeps the
   unfinished guide on the device and offers it back with Resume.
4. Buttons are words, not icons. The icon set has no pencil, copy, bin or plus.
5. A guest who presses New guide or Duplicate sees an inline "Sign in to write your own guides" line with a Create
   account button, not the portrait sign-in pop-up.
6. Card names light up in a live preview under the text box, not inside it. A text box cannot colour part of its text.
7. "Import before creating a Team Ascent guide" is enforced by the client only: the option is absent until the import
   has run. The two people it constrains are the team.
8. A copy of a built-in guide made before the import has no "Based on" line, because there is no server row to point at.
9. `store.ts` is not touched. This one did NOT hold: one line in `packages/ui/src/store.ts` changed. The identity
   `onChange` now calls `loadGuides()` unconditionally (it used to be skipped when there was no account), so signing out
   clears the previous account's guides at once. A privacy rule outranks the hot-file rule here. The rail's Edit link
   still reaches the Compendium through the guides store, not a new field on the game store.

Rulings made during the build, in plain terms:

- Step 2 was built on top of step 1's branch while step 1's pull request was open, and took `main` in once step 1 was
  merged. The branch now differs from `main` by step 2's work only.
- Wording: a refusal that the player can act on names the next step ("Duplicate it to make your own.", "Your text is
  kept on this device."). A network failure with no HTTP status reads as offline, and that has its own test.
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
- The editor draws every tribe the guide holds, even ones not on this set's roster (an off-roster "pairs with" can be
  set to None), so a guide that did not carry over to a set can be repaired.
- The Save button is on whenever the editor is not busy (a save with no change is harmless). A save that lands after
  the editor closed still updates the lists, and clears the device draft only if the stored draft is still the one it
  sent, so a closed editor cannot leave a draft that Resume would save a second time. Every failed save writes the
  device draft at once, so "kept on this device" is true by construction.
- The conflict bar takes focus itself, not a button, because its first button replaces the author's text and a stray
  Enter after a keyboard save would throw the work away.
- The device-draft rules went through four rounds and ended as one model (the editor remembers what the slot held at
  open and what it wrote itself). A first idea, "clear the device copy when a change is undone", was withdrawn because
  it wiped a resumed draft.
- A kept draft with nothing in it (no title, write-up, tagline or cards) is not offered back. An ask (sign in, or
  Resume or discard first) scrolls into view and takes focus. Resume reads the device again when pressed and drops the
  bar if the draft is gone. The Resume bar belongs to the account it was read for.
- The warning text in the editor uses the theme's warning colour. The editor's radii, shadows and hover text copy the
  Compendium's own style and were left as they are, for the owner's look pass.
- Rail: the header count includes the player's own guides, and the snapshot is tied to the account it was taken for.
  This narrows "the rail never changes while it is open" in exactly one case, a change of account, because privacy
  outranks it.

## Known gaps (for the owner)

- Every player guide is private until step 3. Nothing a player writes is visible to anyone else yet.
- The look is a first cut and has not been judged in a real render: the corner radii, the panel colours, and the text
  sizes in the editor and the toolbar. The design linter flags some of them. The owner decides.
- Closing the Compendium outright (X, or a click outside) does not ask. The draft is kept and Resume offers it back.
- Reordering is by arrows, not drag.
- Focus falls to the page when the editor opens or closes, and closing the editor returns the list to its top.
- One device slot is shared by every account on a device: account A's typing can overwrite account B's waiting draft.
  The draft is only offered back to the account that wrote it.
- The Compendium subtitle under My guides still describes Team Ascent's build lines ("N guides. Build lines for ...").
- A refused Edit from the rail (the guide was deleted since the rail's snapshot was taken) lands on the Guides tab with
  no explanation.

## Performance

To be filled by the render measurement before the pull request opens.

## Not verified here

Nothing in this step was run against the live Supabase project. The `guide-write` function is not deployed, the
migration from step 1 is run by the owner, and the two-account row-level-security check has never been run (the
runbook is `supabase/README.md`, "The editor (step 2)", item 3). Until the function is deployed, a save answers "Guides
cannot be saved yet. Try again later." and the text is kept on the device. The Import button, the Edit button on a Team
Ascent guide, and every save have only been exercised against test doubles of the seam.

Deploying `guide-write` is the owner's action. It is not done by this work.

## Carried to the next steps

Step 2 (this step) is done once the owner has run the runbook. Open from this step for the owner: the look pass on the
editor and toolbar, and the owner's look at the "Missing or removed" slot (carried from step 1).

Step 3 (publishing):

- Publishing must re-run the text rules on the stored guide, because the word list will have changed since it was
  saved.
- The owner's word-list review.
- Player titles imitating Team Ascent.
- A write that times out at 15 seconds reads as offline but may still land. A retried create can then make a second
  guide, and a retried update reads as "someone else saved". An idempotency key would close it.

Step 4 (moderation):

- A hidden Team Ascent guide stays readable.
- "Based on" snapshots outlive a hidden source.
- Whether the server lets an author edit a guide that the team has hidden (the Edit button is drawn today).
