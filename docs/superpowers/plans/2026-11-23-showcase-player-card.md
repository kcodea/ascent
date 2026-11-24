# Showcase Player Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flag banner (`PhBanner`) with a landscape showcase player card on the Play lineup and in Versus rooms, show every seated player's rank, and add a four-tab cosmetics window opened from tabs on your own card.

**Architecture:** One new party-home kit component (`PhShowcaseCard`, sized full / half / compact through container units) replaces `PhBanner` at every call site. Other players' rank comes from the `profiles` rank columns added to the existing seat-data read. The cosmetics window wraps today's portrait window body as its Avatar tab and adds Frame / Title / Card plate tabs that save through the same calls Collection uses.

**Tech Stack:** React 18 + TypeScript, Zustand (`useGame`, `useProgression`), plain CSS in the party-home kit, Vitest + `renderedText.mount`.

**Spec:** `docs/superpowers/specs/2026-11-23-showcase-player-card-design.md`. Mockup (look reference, CSS starting numbers): https://claude.ai/artifact/UXUMq5r5HM7HVV2EkuuFoV (v11).

## Global Constraints

- Three PRs, each its own branch off latest `origin/main` in a worktree under `.claude/worktrees/`, `npm install` in it first; squash-merge after `verify` is green. Never push to `main`.
- Before each PR: `npm run typecheck && npm run lint && npm test && npm run build:web` all green.
- Each PR adds a `Systems` entry at the top of `packages/ui/src/patchNotes.ts` (one block per date; add to an existing 2026-11-2x block if present).
- No `title=` attribute, no SVG `<title>`; hover text via `aria-label` / `.gtip[data-tip]`.
- No bare `cursor: pointer` (or any keyword cursor); let the global `button` rule paint the gauntlet.
- Portals go into `stageHost()`; no raw `vw` / `vh` / viewport `@media` in CSS.
- No looping animation of `box-shadow` / `filter` / `background` / `border-radius`; hover lifts are one-shot `transform` transitions.
- Every `<img>` gets `decoding="sync"` and `draggable={false}` (as `PhBanner` does today).
- A hover-only reveal needs its `.tt-on` twin; touch-only styles live in `touchUi.css` under `html[data-touch-ui]`.
- The card is `React.memo`'d; props stay referentially stable (R-VERSUS-ROOM-MOUNTED-01: room cards must not remount on a seat-data re-read).
- Rival art is mirrored (`scaleX(-1)` on the art only); text never mirrors. Mirroring is by position (right of the VS mark / right-hand Duos column), never by "rival".
- The medallion is not clickable. No card plate and no portrait frame are drawn on the card.

## Review Focus

1. A long name, no title, and no rank on a **compact** card: the name ellipsizes, the title line keeps its height, the well reads "Unranked" with no bar. (Task 2 test.)
2. A teammate whose `rank_season` is an older season reads as the fresh-season start; a server that refuses the rank columns still returns avatar and title. (Task 1 tests.)
3. Closing the cosmetics window (Esc / ✕ / veil) with unapplied picks discards them; a save that fails keeps the window open with an error line and leaves the other saves applied. (Task 6 tests.)
4. In a Versus room, pressing a card tab on your own card never starts a drag or opens the seat menu, and sitting in p2 puts your (unmirrored-text, mirrored-art) card on the right. (Task 4 and Task 7 tests.)
5. Guests (anonymous accounts) see no tabs and cannot open the window by any path. (Task 7 test.)

---

## PR 1 — branch `feat/showcase-card-lineup`

### Task 1: Every seat's rank in the seat-data read

**Files:**
- Modify: `packages/ui/src/versus/versusSeatCard.ts` (`SeatServerData`, `PlayerCardSource`, `fetchProfiles`, `sameSeatData`, `seatCardSource`)
- Test: `packages/ui/src/versus/versusSeatCard.test.tsx`

**Interfaces:**
- Produces: `SeatServerData.rank?: RankPosition`; `PlayerCardSource.rank: RankPosition | null`; `export function seatRankOfRow(r: Record<string, unknown>): RankPosition | null`. `RankPosition` is `{ divisionIndex: number; points: number }` from `@game/sim`.

- [ ] **Step 1: Write the failing tests** in `versusSeatCard.test.tsx`:

```ts
describe('seatRankOfRow', () => {
  it('reads the live season', () => {
    expect(seatRankOfRow({ rank_season: RANK_SEASON, rank_division: 7, rank_points: 40 })).toEqual({ divisionIndex: 7, points: 40 });
  });
  it('an older season reads as the fresh-season start', () => {
    expect(seatRankOfRow({ rank_season: 'old-season', rank_division: 12, rank_points: 80 })).toEqual(initialRankedProfile().position);
  });
  it('never ranked (no division) is null', () => {
    expect(seatRankOfRow({ rank_season: null, rank_division: null })).toBeNull();
  });
});
it('seatCardSource carries the server rank for anyone, and `self.rank` for you', () => { /* server { rank:{divisionIndex:3,points:10} } → src.rank toEqual it; own with self.rank null → null */ });
it('fetchSeatData keeps avatar + title when the rank columns are refused', async () => { /* mock client: select containing "rank_division" returns { error }, narrower select returns a row; expect titleId set, rank undefined */ });
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run packages/ui/src/versus/versusSeatCard.test.tsx` → FAIL (`seatRankOfRow` not exported).
- [ ] **Step 3: Implement.** `seatRankOfRow`: `rank_division` not a number → `null`; `rank_season !== RANK_SEASON` → `initialRankedProfile().position` (only `divisionIndex`, `points`); else `parseRankedProfile`-validated `{ divisionIndex, points }`, falling back to the initial position. Import `RANK_SEASON`, `initialRankedProfile`, `parseRankedProfile`, `type RankPosition` from `@game/sim`. In `fetchProfiles` prepend two selects to the fall-back chain: `'user_id, favorite_hero, equipped_title_id, avatar, rank_season, rank_division, rank_points'` (only when `canReadProfileAvatar()`), then `'user_id, favorite_hero, equipped_title_id, rank_season, rank_division, rank_points'`, then the existing three. Set `rank` only when `seatRankOfRow` is non-null. `sameSeatData` also compares `rank?.divisionIndex` and `rank?.points`. `seatCardSource`: `self` gains `rank: RankPosition | null`; own → `self ? self.rank : server?.rank ?? null`; others → `server?.rank ?? null`.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** — `feat(ui): seat data reads every player's rank`.

### Task 2: `PhShowcaseCard` kit component

**Files:**
- Create: `packages/ui/src/partyHome/kit/PhShowcaseCard.tsx`, `packages/ui/src/partyHome/kit/phShowcase.css`
- Modify: `packages/ui/src/partyHome/kit/index.tsx` (export)
- Test: `packages/ui/src/partyHome/kit/PhShowcaseCard.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type PhCardSize = 'full' | 'half' | 'compact';
  export function PhShowcaseCard(p: {
    size: PhCardSize; label: string; name: string; art?: string;
    eyebrow?: ReactNode; titleId?: string | null; fallbackLine?: string | null; // "Level 12" when no title
    rank: RankPosition | null; mine?: boolean; rival?: boolean; mirrored?: boolean;
    badge?: ReactNode; band?: ReactNode; youLabel?: boolean;
    onClick?: () => void; haspopup?: boolean; expanded?: boolean;
    overlay?: ReactNode; under?: ReactNode; index?: number; className?: string;
  }): JSX.Element;                                  // React.memo'd
  export function PhShowcaseGhost(p: { size: PhCardSize; label: string; onClick?: () => void; index?: number; className?: string; overlay?: ReactNode; children: ReactNode }): JSX.Element;
  export function PhShowcaseBand(p: { tone: 'ready' | 'in_game' | 'pools'; children: ReactNode }): JSX.Element;
  ```
  Root class `phs-card phs-<size>` (+ `phs-mine`, `phs-rival`, `phs-mirrored`); the press target is a `<button className="phs-press">` covering the card; `overlay` renders after it (menus); `under` renders below the card outside the button (Task 7's tabs).

- [ ] **Step 1: Write the failing tests** (mount with `../../renderedText.mount`, as `rank/rankSurfaces.test.tsx` does):
  - `renders name, title badge, crest, rank label and points` — rank `{ divisionIndex: 7, points: 40 }`: text contains `rankLabel(7)` and `pointsText({divisionIndex:7,points:40})`.
  - `null rank reads Unranked with no bar` — no `.phs-bar` element.
  - `mirrored only flips the art` — root has `phs-mirrored`; `.phs-name` has no inline transform.
  - `compact keeps a long name on one line` — name `'X'.repeat(40)`: `.phs-name` present, root has `phs-compact`.
  - `no title attribute anywhere` — `root.querySelector('[title]')` is null.
  - `ghost renders its children and label` — `aria-label` equals the label.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/partyHome/kit/PhShowcaseCard.test.tsx` → FAIL.
- [ ] **Step 3: Implement** from the mockup's `.sc` rules: `container-type: inline-size`, widths per size set by the row (`phs-row` rules below), aspect 16/10 (compact 16/8); left 56% art with fade (`::after` gradient, static); right info column: eyebrow, `.phs-name` (nowrap + ellipsis), title via `TitleBadge` (or `fallbackLine`, or a ` ` spacer), rank well with `RankCrest size="row"`, `rankLabel`, `.phs-bar` width `barFraction(rank) * 100%`, `pointsText(rank)`. Leader / Host badge top corner of the art; band across the art's bottom. Row CSS in the same file: `.phs-row` (flex, centred), `.phs-row.duel` (VS between), `.phs-row.grid` (2 × 2), `.phs-row.teams` (two columns + VS), with `.phs-vs` and team labels reusing `.ph-pairlbl.mine/.rival`. `.phs-row.grid` and `.phs-row.teams` take the same height.
- [ ] **Step 4: Run** → PASS. Also `npx vitest run packages/ui/src/stageTripwire.test.ts` → PASS (no vw/vh).
- [ ] **Step 5: Commit** — `feat(ui): showcase player card kit component`.

### Task 3: The Play lineup uses the card

**Files:**
- Modify: `packages/ui/src/partyHome/PartyHome.tsx` (`Member`, members build ~172-193, `myMedal` ~259, cards/row ~516-550, `BannerCard`, `OpenSeat`)
- Modify: `packages/ui/src/patchNotes.ts`
- Test: `packages/ui/src/partyHome/partyLineup.test.tsx` (create), plus any existing partyHome test whose selectors targeted `.ph-cardwrap`

**Interfaces:**
- Consumes: Task 1 `PlayerCardSource.rank`; Task 2 `PhShowcaseCard`, `PhShowcaseGhost`, `PhShowcaseBand`, row classes.
- Produces: `Member.rank: RankPosition | null` (was `{ divisionIndex; label }`); `useVersusRoomHome(root, phone, onInvite, myRank: RankPosition | null)` (was `myMedal: ReactNode`) — Task 4 implements the room side; in this task only change the call and the parameter type, passing `myRank` through to where `myMedal` was used and rendering the old medal from it so the room still compiles.

- [ ] **Step 1: Write the failing tests** in `partyLineup.test.tsx` (pure helpers exported from PartyHome.tsx so they test without the store):
  - `export function cardSizeFor(seats: number): PhCardSize` → `1→'full'`, `2→'half'`, `3→'compact'`, `4→'compact'`.
  - `export function mirroredAt(modeId: string, i: number): boolean` → `('versus',1)` true, `('versus',0)` false, `('vduos',2)` true, `('vduos',1)` false, `('group',3)` false, `('duos',1)` false.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/partyHome/partyLineup.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Self rank = `useCurrentRank()`; teammate rank = `src.rank`; demo mate `{ divisionIndex: 7, points: 40 }`. Size = `cardSizeFor(members.length + open)`. `BannerCard` → `PhShowcaseCard` with eyebrow = the selected mode's `label` from `partyModes`, `titleId`, `fallbackLine` = `Level N` when no title, `mirrored={mirroredAt(mode.id, i)}`, `rival` as today, `badge={leader ? <PhLeaderBadge/> : undefined}`, band per today's `stateOf` (`Ready` / `In game`), `youLabel` when more than one seat, phone → `heroThumb(m.art)`, press → today's menu. `OpenSeat` and the pending-invite seat → `PhShowcaseGhost` (keep "Cancel" as `overlay`). Row: `versus` → `phs-row duel`, `group` → `phs-row grid`, `vduos` → `phs-row teams` with the existing "Your team" / "Rivals" labels, else `phs-row`. Replace the `.ph-cards nN` wrapper for the lineup only.
- [ ] **Step 4: Run** `npx vitest run packages/ui/src/partyHome` → PASS (update selectors in existing tests that targeted the flag; do not weaken assertions).
- [ ] **Step 5: Patch notes** — `Systems`: "The Play page shows each player as a new showcase card with their portrait, title and rank — including your teammate's rank."
- [ ] **Step 6: Gates + PR** — run the four gates; `gh pr create` titled `feat(ui): showcase player card on the Play lineup`; arm `gh pr merge --auto --squash`.

## PR 2 — branch `feat/showcase-card-versus-room` (off `main` after PR 1 merges)

### Task 4: Versus room seats use the card

**Files:**
- Modify: `packages/ui/src/partyHome/versusRoomHome.tsx` (`Face` + `useFace`, `BannerFoot` → removed, `seatCard`, `SeatBanner`, `GhostCard`, `useVersusRoomHome` signature, row building)
- Modify: `packages/ui/src/patchNotes.ts`
- Test: `packages/ui/src/partyHome/versusRoomCards.test.tsx` (create)

**Interfaces:**
- Consumes: Task 2 components; Task 3 `cardSizeFor`, `myRank`; Task 1 `PlayerCardSource.rank`.
- Produces: `export function roomMirrored(mode: VersusRoomMode, side: VersusGroupSeat): boolean`.

- [ ] **Step 1: Write the failing tests:** `roomMirrored('duel','p2')` true, `('duel','p1')` false, `('duos','p3')` true, `('duos','p4')` true, `('duos','p2')` false, `('group', any)` false. And `export function recordEyebrow(r: VersusRecord | null): string` → `{wins:3,losses:1}` → `'3W 1L'`, `null` → `''`.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/partyHome/versusRoomCards.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** `Face` gains `rank`. `SeatBanner` → `PhShowcaseCard` (size: duel `'half'`, group/duos `'compact'`), `mirrored={roomMirrored(mode, side)}`, rival rule unchanged, rank = own ? `myRank` : `face.rank`, eyebrow `recordEyebrow(face.record)`, Host badge, band: pools → `PhShowcaseBand tone="pools"` with today's heart / armor markup and aria-label; sealed → `tone="in_game"` "Getting ready". Keep `vsr-dragwrap` around the card with `onPointerDown`, keep every `vsr-*` class the drag code reads (`vsr-seat vsr-s-<side>`, `vsr-mineseat`, `vsr-over`, `vsr-src`, `vsr-target`, `vsr-open`). Open seats → `PhShowcaseGhost` with the same labels, "Take seat" text and Add-bot overlay. `GhostCard` renders the same card at seat size, inert. Rows: duel → `phs-row duel`, group → `phs-row grid`, duos → `phs-row teams`. Seats stay in `seatTeams(mode)` order.
- [ ] **Step 4: Run** `npx vitest run packages/ui/src/partyHome packages/ui/src/versus` → PASS (existing room tests, including the R-VERSUS-ROOM-MOUNTED-01 memo test, stay green).
- [ ] **Step 5: Patch notes** — "Versus rooms use the new player cards: every seat shows its rank, and the far side faces you across the VS mark."
- [ ] **Step 6: Gates + PR** — `feat(ui): showcase player cards in Versus rooms`; arm auto-merge.

## PR 3 — branch `feat/cosmetics-window` (off `main` after PR 2 merges)

### Task 5: Extract the portrait window body

**Files:**
- Modify: `packages/ui/src/AvatarPicker.tsx`
- Test: existing `packages/ui/src/AvatarPicker*.test.tsx` (run unchanged)

**Interfaces:**
- Produces: `export function AvatarTabBody(p: { selected: string | null; onSelect: (id: string) => void; onApply: (id: string) => void }): JSX.Element` — today's tabs (My Skins / Heroes / Minions / Hero Powers), search, filter and grid, with no dialog chrome, no side preview and no buttons.

- [ ] **Step 1:** Move the grid / search / filter / sub-tab state of `PortraitWindow` into `AvatarTabBody`; `PortraitWindow` renders `AvatarTabBody` inside its existing dialog so behaviour is unchanged.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src -t "portrait|avatar"` → PASS, unchanged.
- [ ] **Step 3: Commit** — `refactor(ui): portrait window body as AvatarTabBody`.

### Task 6: The four-tab cosmetics window

**Files:**
- Create: `packages/ui/src/cosmetics/CosmeticsWindow.tsx`, `packages/ui/src/cosmetics/cosmeticsWindow.css`, `packages/ui/src/cosmetics/cosmeticsPending.ts`
- Modify: `packages/ui/src/store.ts` (add `cosmeticsTab` + `openCosmetics`), `packages/ui/src/Game.tsx` (mount `CosmeticsWindow` in place of `AvatarPicker`)
- Test: `packages/ui/src/cosmetics/cosmeticsPending.test.ts`, `packages/ui/src/cosmetics/CosmeticsWindow.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type CosmeticsTab = 'avatar' | 'frame' | 'title' | 'plate';
  // store.ts (keeps avatarPickerOpen as the open flag, so every existing reset still closes it):
  cosmeticsTab: CosmeticsTab;            // default 'avatar'
  openCosmetics: (tab?: CosmeticsTab) => void;   // sets avatarPickerOpen: true, cosmeticsTab: tab ?? 'avatar'
  openAvatarPicker: () => void;          // unchanged name, now = openCosmetics('avatar')
  // cosmeticsPending.ts
  export interface Loadout4 { avatar: string | null; frame: string | null; title: string | null; plate: string | null }
  export function changedKeys(now: Loadout4, pending: Loadout4): (keyof Loadout4)[];
  export async function applyPending(now: Loadout4, pending: Loadout4, save: {
    avatar: (id: string | null) => void; frame: (id: string | null) => Promise<boolean>;
    title: (id: string | null) => Promise<boolean>; plate: (id: string | null) => Promise<boolean>;
  }): Promise<(keyof Loadout4)[]>;       // returns the keys whose save FAILED
  ```
  Real `save`: `avatar` → `setPlayerAvatar`; `frame` → `equipCosmetic('portrait_frame', '', id)`; `title` → `equipTitle(id)`; `plate` → `equipCosmetic('card_plate', '', id)`.

- [ ] **Step 1: Write the failing tests.** `cosmeticsPending.test.ts`: `changedKeys` returns only differing keys; `applyPending` calls only changed savers; a saver resolving `false` is returned as failed while the others still ran. `CosmeticsWindow.test.tsx`: opens on the tab passed to `openCosmetics('frame')` (tab with `aria-selected="true"` reads "Frame"); one press selects (Use enabled), Esc closes and the store loadout is unchanged; frame tiles contain no avatar `<img>` besides the ring (`.cw-frame img` count = 1 per tile); a failed save shows the error line and the window stays open.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/cosmetics` → FAIL.
- [ ] **Step 3: Implement.** Dialog chrome as `PortraitWindow` (`phk-dialog ph-tokens`, `usePhLayer`, Esc, portal into `stageHost()`), `PhTabs` with counts, one pending `Loadout4` seeded from the live values (avatar: `playerAvatar`; frame: `useOwnPortraitFrameId()`; title: `mirrorFor(...)?.equippedTitleId`; plate: `cardPlateOf(useLiveLoadout())`). Lists: owned only — `albumOf('portrait_frame' | 'title' | 'card_plate', COSMETICS, owned)` filtered by `ownedIds`; frame tile art `frameSrc(id)` alone; title tiles `TitleBadge`; plate tile `plateLookOf(c)?.thumb`; "In use" tag on the live value; "No title" / default frame / standard plate tiles map to `null`. Side preview: Avatar / Title → `PhShowcaseCard size="full"` wearing the pending values; Frame → the ring large; Card plate → `InlinePlateCard` with `PLATE_SAMPLE_CARD`. Buttons: "Use" (enabled when `changedKeys` non-empty) → `applyPending`, close on no failures; "Reset to default" sets the current tab's key to `null`. Double press on a tile = select + apply + close. Error copy reuses Collection's ("Could not change your portrait frame. Try again." etc.). Guest gate unchanged (`account.anonymous` → render nothing).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(ui): four-tab cosmetics window`.

### Task 7: Tabs on your card, routing, and deleting the flag

**Files:**
- Create: `packages/ui/src/partyHome/kit/PhCardTabs.tsx` (CSS in `phShowcase.css`)
- Modify: `packages/ui/src/partyHome/PartyHome.tsx`, `packages/ui/src/partyHome/versusRoomHome.tsx`, `packages/ui/src/partyHome/ChangeName.tsx` (`selfCardMenu` drops `changePortrait`), `packages/ui/src/partyHome/changeName.test.tsx`, `packages/ui/src/AvatarPicker.tsx` (dialog wrapper removed; `AvatarTabBody` stays), `packages/ui/src/partyHome/kit/index.tsx`, `packages/ui/src/partyHome/partyHome.css` (remove flag rules), `packages/ui/src/patchNotes.ts`
- Delete: `packages/ui/src/partyHome/kit/PhBanner.tsx`
- Test: `packages/ui/src/partyHome/kit/PhCardTabs.test.tsx`

**Interfaces:**
- Consumes: Task 6 `openCosmetics`, `CosmeticsTab`; Task 2 `under` prop.
- Produces: `export function PhCardTabs(p: { avatarSrc?: string; frameId: string | null; titleId: string | null; plateThumb?: string; onOpen: (tab: CosmeticsTab) => void }): JSX.Element` — four buttons Avatar · Frame · Title · Card plate, each with its thumb (round avatar; the frame ring alone; a dot in the title's rarity colour; the plate thumb).

- [ ] **Step 1: Write the failing tests:** pressing "Frame" calls `onOpen('frame')` (same for the other three); the Frame thumb holds one `<img>` (the ring) and no avatar; a `pointerdown` on a tab calls `stopPropagation` (dispatch on a tab inside a parent with an `onPointerDown` spy → spy not called); no `[title]` attribute.
- [ ] **Step 2: Run** `npx vitest run packages/ui/src/partyHome/kit/PhCardTabs.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Tabs hang centred below the card (`under` slot), folder-tab shape, one-shot hover lift; the card's row reserves the tabs' height. Render them only on your own card and only when `!account.anonymous`, on Play and in the Versus room (outside `vsr-dragwrap`'s handle: stop `pointerdown` propagation). `selfCardMenu` → `{ changeName, viewCareer }` (update `changeName.test.tsx` to match). Title.tsx's portrait press keeps calling `openAvatarPicker` (now the Avatar tab). Then delete `PhBanner.tsx`, its exports and its CSS (`.ph-cardwrap`, `.ph-bfoot`, `.ph-card`, `.ph-card-in`, `.ph-art`, `.ph-lead`, `.ph-foot`, `.ph-rod`, `.ph-cards.nN` banner sizing, `.ph-invmed`, `.ph-openlbl`, `.ph-opensub`) after `git grep -n "PhBanner\|ph-cardwrap\|ph-rod"` shows no other user.
- [ ] **Step 4: Run** `npx vitest run packages/ui/src` → PASS.
- [ ] **Step 5: Patch notes** — "Change your avatar, portrait frame, title and card plate right from your player card: four tabs under it open one window."
- [ ] **Step 6: Gates + PR** — `feat(ui): cosmetics tabs on your player card; retire the flag banner`; arm auto-merge.
