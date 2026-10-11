# Editable and community guides — design

**Date:** 2026-10-11 · **Status:** design approved in chat, spec awaiting owner review · **Owner:** Mike

Guides stop being fixed data in the game's code. They move to the server, gain an in-game editor, and open up to
players: the existing guides become **Team Ascent** guides that only Mike and KC can change, and any signed-in
player can write a guide from scratch or by duplicating one, keep it private, or publish it for everyone.

## 0. What the owner asked for, and what was decided

**The ask (2026-10-11):** "i'd like the ability to edit existing guides while in game and save them. The existing
[guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that, one
should be able to create a new guide either from scratch or by duplicating an existing guide."

**Owner decisions made while designing:**

| Question | Decision |
|---|---|
| Who sees a player's guide | Everyone, once published (community guides) |
| When a Team Ascent edit reaches players | Right away, on their next load. No release needed |
| Where community guides show | Rail = Team Ascent + your own + bookmarked. Compendium gets a Community section |
| Moderation | Team can hide or delete; players can report; publishing needs a signed-in account; basic word filter |
| A new guide's starting state | Private, with a Publish switch |
| Community ranking | By bookmark count. No separate like button |
| Duplicates | A new private guide credited to the duplicator, with a "Based on ..." line |
| A card that is archived or removed | The portrait greys out and reads "Missing or removed" |
| A new set going live | A guide carries over when every card it references exists in the new set |
| Author name | A per-guide "by" line the author can edit. "Team Ascent" and lookalikes are reserved |

**Success looks like:** Mike opens the Compendium mid-run, fixes a line in the Sunmane guide, saves, and KC sees it
on next load without a build. A player duplicates Sunmane, rewrites it, publishes it, and another player bookmarks
it and finds it in their rail when Beasts are in the lobby. A non-team player cannot change a Team Ascent guide by
any means, including a tampered client.

## 1. Permissions

| Action | Guest (anonymous account) | Signed-in player | Team (Mike, KC) |
|---|---|---|---|
| Read Team Ascent and published guides | yes | yes | yes |
| Bookmark | no | yes | yes |
| Create, duplicate | no, prompts sign-in | yes | yes |
| Edit, delete own guide | n/a | yes | yes |
| Publish, unpublish own guide | n/a | yes | yes |
| Edit a Team Ascent guide | no | no | yes |
| Report | no | yes | yes |
| Hide, unhide, delete anyone's guide; read reports | no | no | yes |
| Import built-in guides; run set carry-over | no | no | yes |

- **Team** is a server-side list of account ids (`guide_team`). The client reads only "am I on it" to decide whether
  to draw team buttons. The server is what refuses the write.
- **Team Ascent guides** carry `official = true`. Their "by" line is always `Team Ascent`, they are always public,
  and any team member can edit any of them. When a team member creates a guide, the editor asks: Team Ascent guide,
  or one under your own name.
- **Guests** are anonymous accounts (`Identity.anonymous`). Elsewhere in the game they may write (boards, bug
  reports); here they may not, by the owner's moderation decision. Create, Duplicate, Bookmark and Report stay
  visible and open the existing sign-in gate (`GuestSignIn`).
- **A hidden guide** stays visible to its author with a "Hidden by Team Ascent" note. The author may edit or delete
  it but cannot make it public again; only the team can unhide it.

**Limits** (owner may change the numbers):

| Limit | Value |
|---|---|
| Guides per player (not counting Team Ascent guides) | 20 |
| Bookmarks per player | 200 |
| Title | 1 to 40 characters |
| Tagline | 0 to 80 |
| Write-up | 1 to 1,200 |
| "By" line | 1 to 24 (the display-name length) |
| Core cards | 1 to 6 |
| Enabler cards | 0 to 6 |
| Tribes | 0 to 2 (none = Neutral), plus 0 to 1 "pairs with" |
| Nicknames ("also highlight") | 0 to 6 |
| Report note | 0 to 300 |
| Saves | 30 per hour per account |
| Reports | 10 per day per account, one per guide |

## 2. Data model (server)

One migration, `supabase/migrations/<date it lands>-guides.sql`, with the identical block appended to `schema.sql`, in the
repo's idempotent paste-and-run style.

### `guides`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `slug` | text unique, nullable | Only on the imported built-in guides (`set2-beast-sunmane`), so the import is idempotent and the offline fallback can be matched to its server row |
| `author_id` | uuid → `auth.users` | The creator. For official guides, the team member who created or imported it |
| `byline` | text | Shown as "by ...". Forced to `Team Ascent` when `official` |
| `official` | boolean | A Team Ascent guide |
| `published` | boolean | Forced true when `official` |
| `published_at` | timestamptz | Set the first time it is published; drives "Newest" |
| `hidden` | boolean | Team moderation. Plus `hidden_by`, `hidden_at` |
| `sets` | text[] | The sets this guide shows in (section 5). GIN index |
| `tribes`, `pairs_with` | text[] | Empty `tribes` = Neutral |
| `icon_card` | text | Card id |
| `title`, `tagline`, `body` | text | |
| `core`, `enablers`, `mentions` | text[] | Card ids. `mentions` is derived at save (section 4) |
| `aliases` | jsonb | Nickname → card id |
| `forked_from` | uuid, on delete set null | |
| `forked_title`, `forked_byline` | text | Snapshot, so "Based on Sunmane by Team Ascent" survives the original being deleted or renamed |
| `bookmark_count` | int | Maintained by a trigger on `guide_bookmarks` |
| `revision` | int | Bumped on every save; used for edit conflicts (section 4) |
| `created_at`, `updated_at`, `updated_by` | | |

### `guide_bookmarks`, `guide_reports`, `guide_team`

- `guide_bookmarks (user_id, guide_id, created_at)`, primary key on both, cascade on guide delete.
- `guide_reports (id, guide_id, reporter_id, reason, note, status, resolved_by, resolved_at, created_at)`, unique on
  `(guide_id, reporter_id)`. `reason` is one of `offensive`, `spam`, `impersonation`, `other`. `status` is `open`,
  `dismissed` or `actioned`.
- `guide_team (user_id pk, added_at)`.

### Row-level security

Reads are direct. Writes have **no client policy at all**: the only writer is the server function in section 3.

- `guides` select: `official or (published and not hidden) or author_id = auth.uid() or is_guide_team()`.
- `guide_bookmarks` select: own rows.
- `guide_reports` select: team only.
- `guide_team` select: own row only. `is_guide_team()` is a `security definer` helper.

**Seeding the team.** Account ids cannot be known in a migration and the two emails must not be committed. The
migration ends with a commented, fill-in-the-emails statement the owner runs once in the SQL editor:
`insert into guide_team (user_id) select id from auth.users where email in ('...', '...')`.

## 3. The write path: one server function

`supabase/functions/guide-write/index.ts`, in the shape of `submit-bug-report`: it verifies the caller's token, takes
`user_id` from the token and never from the body, then writes as the service role. One endpoint, an `op` field:

| `op` | Who | What |
|---|---|---|
| `save` | author; team for official | Create or update. Carries the `revision` it loaded |
| `setPublished` | author | Refused while `hidden` |
| `delete` | author; team for any | Hard delete |
| `bookmark`, `unbookmark` | signed-in | |
| `report` | signed-in | One per guide per account |
| `setHidden` | team | Hide or unhide. Hiding marks that guide's open reports `actioned` |
| `resolveReport` | team | Dismiss |
| `importBuiltIns` | team | Section 6 |
| `retagSets` | team | Section 5 |

Checks on `save`, in order: authenticated and not anonymous; the caller owns the row, or the row is official and the
caller is on the team; a non-team caller cannot set `official`; field shapes and the limits in section 1; card ids
match the id pattern and counts; the word filter over title, tagline, write-up, "by" line and nicknames; the
reserved-name rule on the "by" line; the 20-guide cap on create; the rate limit; the `revision` matches.

Refusals return a stable code (`not_allowed`, `blocked_text` with the **field** but not the word, `reserved_name`,
`too_many_guides`, `rate_limited`, `conflict`, `guide_hidden`) that the editor turns into a plain sentence.

**The server does not know the card list.** It checks the shape of card ids, not that they exist. Teaching the
function the card list would mean redeploying it every time a card ships, or new cards would be refused in guides.
The client already greys out any id it cannot resolve (section 4), so a tampered save can at worst produce a guide
with greyed slots, which is reportable. *Rejected alternative:* a generated card index shipped with the function.

### Shared rules package

Limits, shape validation, the word filter and the set-membership function are needed by the function, by the client
and by tests. Following the `@game/progression` pattern: a new dependency-free package `packages/guides/`
(`@game/guides`) is the source of truth, and `npm run guides:shared` generates the Deno copy under
`supabase/functions/_shared/guides*.ts`, never hand-edited. The word list lives in its own module that only the
function and the tests import, so it never ships in the player's bundle.

### The word filter

The game has no word filter today; this is the first. It normalises text (lower case, accents stripped, common
letter swaps such as `1` for `i`, repeated letters collapsed) and matches on word boundaries, so an innocent word that
merely contains a blocked one passes. Reserved "by" lines, after the same normalising: `team ascent`, `ascent team`,
`ascent official`, and the standalone words `admin`, `moderator`, `developer`, `official`.

Two tests keep it honest: every card, hero, rune and tribe name in the game passes the filter, and all 11 existing
guides pass it unchanged. The owner reviews the word list before the publishing step ships.

## 4. Client

Everything new sits under `packages/ui/src/guides/`. `store.ts` gets one small addition (the deep link below) and
nothing else, since it is a serialised hot file.

| File | Job |
|---|---|
| `guidesRemote.ts` | The Supabase seam. Reads with an explicit `.limit` / `.range` (R-NET-01, the 1,000-row guard). Writes through `functions.invoke('guide-write')`. A capability probe in the progression style: `no-backend`, `off` (migration not run), `offline`, `on` |
| `guidesStore.ts` | Its own small store: official guides, my guides, bookmarked guides, community pages, the team flag, the capability state |
| `guides.ts` | The `Guide` type grows `sets`, `byline`, `official`, `published`, `hidden`, `authorId`, `forkedFrom*`, `revision`. `guidesFor` stays a pure function and now takes the list to filter |
| `guides.bundled.ts` | The 11 built-in guides, as the offline fallback (section 6) |
| `GuideEditor.tsx`, `GuideCardPicker.tsx`, `guideDraft.ts` | The editor, the card search, and the on-device draft |
| `CompendiumGuides.tsx`, `LobbyGuides.tsx`, `GuideParts.tsx` | Gain the source pills, per-card actions, the rail sections and pencil, and the missing-card slot |

### Loading, and never making the rail wait

- Guides load once in the background after identity is established at boot, and again when the Compendium Guides
  tab opens. Nothing blocks on it.
- Until the first load lands, and whenever the capability is not `on`, the list is the bundled fallback. So the rail
  is never empty and never shows a spinner.
- **An open rail never reshuffles.** The rail reads a snapshot taken when its Guides view opens. A background
  refresh applies the next time the view opens.

### The editor

It lives in the Compendium Guides tab. The guide card becomes editable in place, so the author edits the same card
players read.

| Field | Control |
|---|---|
| Title, tagline, write-up | Typed on the card. A counter appears near the limit |
| "By" line | Typed. Starts as the account's display name. Read-only `Team Ascent` on official guides |
| Tribes | Tribe pills; none lit = Neutral. Optional "pairs with" tribe |
| Art icon | Click the icon to pick any card from the set |
| Core, Enablers | **+** opens a search over this set's cards; click to add, drag to reorder, **×** to remove |
| Card names in the write-up | Automatic. On save, the write-up is scanned for this set's card names (longest first, whole words, case-insensitive) and the hits are stored as `mentions`. The reading view keeps using the stored list, so it costs nothing extra at read time |
| Nicknames | An "also highlight" list: a word and the card it means (`Oona` → King Oona) |

- **Buttons:** Save, Cancel, Delete, and a Publish switch (absent on official guides, which are always public).
- **Unsaved changes:** leaving the editor asks first. The in-progress text is also kept on the device
  (`localStorage`, try/catch, per-viewer convenience only) and offered back on the next open.
- **Edit conflicts:** a save carries the `revision` it loaded. If someone else saved in between (Mike and KC on the
  same Team Ascent guide), the editor says so and offers Reload or Overwrite.
- **Missing cards block a save.** If a guide being edited holds a missing card, Save is disabled until it is
  removed; a "Remove missing cards" button does it in one click. This guarantees a saved guide is whole in the set
  it was saved in.
- **Typing never triggers game hotkeys.** The global key handlers (bug reporter, Esc menu and others) must ignore
  events that start in the editor's inputs. To be verified handler by handler during planning.
- **Starting a guide:** a **New guide** button at the top of the tab and a **Duplicate** button on every card. Both
  open the editor on a private copy.
- **From the rail:** the author's own guides, and Team Ascent guides for the team, show a pencil. It opens the
  Compendium directly on that guide in edit mode (`bookOpensTo` gains a guides target). The rail itself has no
  editor: it is too narrow to write in.

### Browsing

The Guides tab gets source pills: **Team Ascent · My guides · Saved · Community**, and **Reports** for the team
only. The existing tribe pills and search box apply to all of them.

- **Community:** author's "by" line on each card; sort by Most saved or Newest; 20 per page, loading more on scroll.
  Search and tribe filtering run on the server here (the list is paged), with the search box debounced.
- **Per-card actions:** Bookmark, Duplicate, Report; Edit and Delete on your own; Hide and Delete for the team.
- **My guides** lists every guide the player owns regardless of set, each wearing its state: Private, Published,
  Hidden by Team Ascent, or "Not in this set" with its missing cards greyed. That is where an author repairs a guide
  that did not carry over.
- **Reports:** the reported guide, the reason and note, how many accounts reported it, and Hide / Dismiss.
- **The rail:** Team Ascent first, then the player's own, then bookmarked; each list still filtered to the tribes in
  the lobby, Neutral always shown, exactly as today. Guides stay off in the Tutorial.

### Missing or removed cards

`GuideUnits` currently drops a portrait it cannot resolve. It instead draws a greyed slot labelled "Missing or
removed": the card's greyed art when the card still exists but is no longer in the set (archived, as Fel Conjurer was
on 2026-10-10), and a blank grey slot when the id resolves to nothing. No hover preview. A name in the write-up that
points at a missing card stays as plain text.

### Offline and not-yet-migrated

Built-in guides show. New guide, Duplicate, Bookmark, Report and the Community pill are disabled with a short
"Guides are offline" note. Nothing throws, and no run is blocked.

### House rules this must follow

No `title=` attributes (use `aria-label` and `.gtip[data-tip]`, with `.tt-on` twins for touch). No bare
`cursor: pointer`. Portals go into `stageHost()`. No raw `vw` / `vh`. Every `<img>` has `decoding="sync"`. No em
dashes in player-facing text (the guide tests already pin this). Player help text describes what the player sees,
not how it is built.

## 5. Sets and carry-over

A guide no longer belongs to exactly one set. It carries `sets`, the sets it shows in, and `guidesFor(set, tribes)`
filters on that.

**The rule** (one pure function in `@game/guides`, given the card pools): a guide belongs in set S when the art
icon, every Core card, every Enabler and every card named in the write-up are all in S's pool, and its tribes and
"pairs with" tribe are all on S's roster.

- **On save**, the client computes `sets` for every known set and sends it. Because a save requires no missing
  cards, the set being edited in is always included.
- **When a set launches**, a team member runs **Carry guides over** from the Reports pill. Their client pages
  through every guide, applies the rule, shows a preview ("84 carry over, 31 stay behind"), and on confirm submits
  the new tags through the `retagSets` op.
- **A card archived mid-set does not untag anything.** The guide stays put and that one card greys out, per the
  owner's ruling. Tags only move on a save or a carry-over.

*Changed from what was described in chat:* carry-over and the built-in import were described as commands run from
a terminal. They are team-only buttons in game instead. A terminal command would need the server's master key on a
developer machine; a team button reuses the same permission check as everything else and needs nothing installed.

**Interaction with the active-set Compendium (#2035, merged):** players only see the active set. A guide that did
not carry over is therefore invisible to other players until its set returns, and visible to its author only under
My guides.

## 6. The built-in guides

- **Import.** The team-only `importBuiltIns` op inserts the bundled guides as official rows, keyed by `slug`. It
  never overwrites an existing row, so it is safe to press twice. Until it has been pressed, players see the bundled
  copies; nothing depends on a particular moment.
- **Fallback.** The bundled copies stay in the game for offline play and for a server that has not been migrated.
- **Keeping the fallback fresh.** Live edits will drift ahead of the bundled copies. `npm run guides:pull` reads the
  official guides (they are public, so no special key) and regenerates `guides.bundled.ts`. Run before a release.
- **Tests that change.** `guides.test.ts` today pins the owner's exact titles and card lists for each guide. Once
  guides are edited live, those pins would fight every `guides:pull`, so they are retired. The structural checks
  stay and run against the bundled file: unique ids, at least one Core card, every card resolves and is in the set,
  the icon has art, tribes belong to the set, no em dashes.

## 7. Performance

Performance is the north star, and the rail is on screen during play.

- The rail's guide list is bounded: official guides for the lobby's tribes, at most 20 of the player's own, at most
  200 bookmarks, all filtered to the lobby's tribes before anything mounts. Collapsed rail cards do not build their
  portraits until opened, as today.
- The Community list mounts through the existing `LazyCell` path with `content-visibility: auto`, 20 at a time.
- The editor's card-name highlighting runs over the whole set's names only while editing, debounced, never in the
  reading view.
- Nothing new animates in a loop. No per-frame layout reads.
- **Measured before each UI step ships**, on the production build: opening the rail's Guides view and the Compendium
  Guides tab with a long list (20 own + 200 bookmarked), against today's numbers from the 2026-10-09 devlog (no long
  task over 50 ms).

## 8. Testing

| Area | What is pinned |
|---|---|
| Permissions | Every row of the section 1 table against the function's decision logic, including a non-team account saving an official guide, a non-team account setting `official`, and a guest creating |
| Limits and rate limits | Each limit at and past its edge; the 20-guide cap; one report per guide |
| Word filter | Blocked text is refused per field; reserved "by" lines are refused for non-team; every card, hero, rune and tribe name passes; the 11 existing guides pass |
| Row-level security | Documented SQL checks run against the live project after the migration: a private guide is unreadable by another account; a hidden guide is readable only by its author and the team |
| Set membership | A guide with every card present carries over; one missing Core, Enabler, icon or named card keeps it behind; a tribe missing from the roster keeps it behind |
| Missing cards | Archived card renders greyed with the label; unknown id renders the blank slot; neither has a hover preview |
| Editor | Create, duplicate ("Based on" line), edit, publish, unpublish, delete; unsaved-changes prompt; draft restore; conflict prompt; Save disabled with a missing card; guest is sent to sign-in |
| Remote seam | The `gauntletRemote.test.ts` style: a faked client, each error path classified, every read bounded |
| Capability states | `no-backend`, `off`, `offline`, `on`: the fallback shows and the right controls disable |
| Existing behaviour | `compendiumGuides.test.tsx` and `lobbyGuidesRail.test.tsx` keep passing; `stageTripwire.test.ts` and the `title=` lint stay green |

## 9. Delivery: four pull requests

Each is shippable alone. Team Ascent editing arrives at step 2, before any player-written text is public.

1. **Storage and reading.** The migration, `@game/guides` (limits, validation, word filter, reserved names, set
   membership), the `guide-write` function with `save` / `delete` / `importBuiltIns`, `guidesRemote` +
   `guidesStore`, the bundled fallback split, `sets`-based `guidesFor`, and the missing-card slot. No visible change
   beyond the greyed slot. The word filter runs on every save from this step on, private guides included, so
   publishing never has to re-check old text.
2. **The editor.** Team members edit Team Ascent guides. Players create and duplicate **private** guides. My guides
   pill. Rail pencil and the rail's "yours" section.
3. **Community.** The Publish switch and `setPublished`, Community and Saved pills, bookmarks, the rail's
   bookmarked section. The owner reads the word list before this step ships.
4. **Moderation and release tools.** Report, Hide, the Reports pill, Carry guides over, `npm run guides:pull`.

Every gameplay-facing step adds a `patchNotes.ts` entry and a devlog file. The rules wiki gets a short Guides entry
at step 3. `supabase/README.md` gets the deploy steps at step 1.

## 10. Coordination

- **Kevin.** The migration, `schema.sql` and a new server function sit on his side of the ownership map. He should
  know before step 1 opens, and review it.
- **Hot files.** `schema.sql` (append only) and `store.ts` (one deep-link field). Everything else is new files or
  the guides folder.
- **Needed from the owner before step 1 goes live:** the two account emails, entered directly in the SQL editor and
  not committed. **Before step 3:** a read of the word list and the limits.

## 11. Not in this design

Likes or star ratings, comments, images or formatting in the write-up, edit history, notifications to authors,
filtering account display names elsewhere in the game, guides for heroes or runes, translation, manual ordering of
Team Ascent guides (they sort by the set's tribe order, Neutral last, then creation order), and browsing guides for
a set that is not active.
