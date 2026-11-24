# Showcase player card (replaces the flag banner)

Date: 2026-11-23 · Owner: Mike · Mockup: https://claude.ai/artifact/UXUMq5r5HM7HVV2EkuuFoV (v11, private to Mike)

## Why

After the party-home overhaul, Hero Select and the Compendium got the "showcase" look (landscape inspect card, gold
metal, navy plate). The Play page still shows each player as a tall **flag** (`PhBanner`). Mike wants the flag gone
entirely and replaced by a showcase-style **player card** that shows who you are at a glance (portrait, name, title,
rank) and lets you change your look **right there**, through a cosmetics window modelled on the rebuilt portrait
window (`AvatarPicker`, PR #2808).

Success: on the Play page and in a Versus room every seat is a showcase card; your own card carries four tabs (Avatar,
Frame, Title, Card plate) that open one cosmetics window; every player's rank medallion shows on their card.

## Goals

- Replace `PhBanner` everywhere it is used: the Play party lineup (`PartyHome.tsx`), the Versus room seats
  (`versusRoomHome.tsx`) and the preview inside the portrait window (`AvatarPicker.tsx`). Then delete `PhBanner`.
- One card component that works at three sizes: **full** (1 seat), **half** (2 seats side by side) and **compact**
  (4 seats as a 2 × 2 block, or two columns of two with VS between in Versus Duos).
- Show every seated player's **rank medallion** (division art + label + MMR bar), not only your own.
- A **four-tab cosmetics window**: Avatar, Frame, Title, Card plate.

## Non-goals

- Hero Select: it already has its own showcase (`hero-select/HeroShowcase.tsx`) and does not change.
- No new cosmetics, no catalog or server changes, no change to how cosmetics are owned or equipped.
- No Worker / Supabase schema change (everything needed is already readable, see Constraints).
- Other surfaces that draw frames (end screen, Career, opponent disc) are untouched.

## Anti-goals (would make this a failure even if it works)

- Any flag silhouette surviving ("i do not want the flag at all").
- The START button moving when the seat count changes (Group ↔ Versus Duos must take the same block).
- A frame hitch, drag stutter or looping paint animation on the Play page (CLAUDE.md performance rules).
- A rival's card that can be edited, or tabs on anyone's card but your own.

## The card (decided with Mike)

Landscape card, about 16:10 (compact about 16:8), on the kit's navy plate with the gold inset edge. Every inner size
scales with the card's own width (container units), so one design serves all three sizes.

- **Left ~56%: the portrait splash.** The player's portrait art (`playerCardArt`) cropped to fill, fading into the
  plate. No portrait frame on the card.
- **Right: info column.** Eyebrow (mode and queue, e.g. "Ranked · Solo"; in Versus, the Versus record "3W 1L", which
  the flag kept in its foot) → NAME (big, uppercase) → **title pill** in its rarity colour (`TitleBadge` data) → a
  **rank well**: medallion art (`art/ranks/*.webp`), division label, MMR bar and MMR number.
- **The medallion is not clickable.** It always shows the player's current rank.
- **No card plate on the card.** (The floating mini card that leaned on the corner is removed from every card.)
- **Badges and states** carry over from the flag: Leader / Host badge (crown, top corner of the portrait), a Ready
  (green) / In game (orange) band across the bottom of the portrait, a small "You" label on your own card when more
  than one seat shows, a soft gold halo on your card.
- **Rivals** (Versus 1v1 far side, Versus Duos right column): the card is **mirrored** so both portraits face the VS
  mark: art on the right, text right-aligned, and the **art itself is flipped** (decided: mirror the art too). The
  edge turns red. Text never mirrors.
- **Open seat**: same card outline, dashed gold, a `+` medallion, "Invite" (and the existing optional-seat / bot
  actions where the flag has them today).

### Layouts per mode (from `partyModes.ts` seat counts)

| Mode | Seats | Layout |
|---|---|---|
| Ranked, Practice, Gauntlet, Learn | 1 | one **full** card |
| Ranked Duos | 2 teammates | two **half** cards side by side |
| Versus 1v1 | 2 rivals | half card · VS · mirrored half card |
| Versus Group | up to 4 | **compact** 2 × 2 block |
| Versus Duos | 2 vs 2 | two columns of two compact cards, "Your team" (green) / "Rivals" (red) labels, VS between; right column mirrored |

Group and Versus Duos take the same block so switching between them doesn't move START. On Play your card is first
(the lineup already puts you first). **In a Versus room seats stay in their real seat order** (`seatTeams(mode)`), so
drag-to-seat (`seatZoneAt`, `seatDropOf`, the ghost's snap-back) keeps working unchanged: if you sit in p2 your card is
on the right. **Mirroring is by position, not by who is a rival:** the card on the right of the VS mark (1v1) and the
right-hand column (Duos) are mirrored so both sides face the VS mark; Versus Group has no VS mark and no mirroring. The
red edge marks rivals of the viewer wherever they sit. Spectators see the same seats, with no card of their own.

### Pressing a card

- **Play, your card:** a press opens today's menu (Change name, View Career). "Change portrait" leaves the menu, since
  the Avatar tab does that. The portrait and title are not separate buttons.
- **Play, a teammate's card:** today's menu, unchanged.
- **Versus room:** unchanged. Your card is the drag handle; a press opens Move to seat N / Move to spectators. The
  tabs are their own buttons below the card, outside the drag handle, so they never start a drag.

### During a Versus match

The bottom band keeps today's third use: while a match runs, a seated card's band shows **Health and Armor** (today's
`pools` strip in `SeatBanner`), and "Getting ready" while the room is sealed. A Group player who is out keeps today's
treatment.

### Phones

No separate arrangement: the same three sizes inside the scaled stage, phone mode (`useCompact`) keeps its smaller
`heroThumb` art and its own action row, as today.

### The four tabs on your card

Only on **your own** card, centred along its **bottom edge**, hanging below it like folder tabs: **Avatar · Frame ·
Title · Card plate**. Each tab shows a tiny version of what you have on: your avatar (round), your frame (the ring on its
own, **no avatar inside**), a dot in your title's rarity colour, your card plate. Pressing a tab opens the cosmetics
window on that tab. The layout reserves room under your card for the tabs so nothing overlaps the next row.

## The cosmetics window

Same anatomy and behaviour as the rebuilt portrait window: `PhDialog` veil, kit tabs, a scrolling grid with only the
list scrolling, a side panel with the selection's name and a live preview, **"Use"** and **"Reset to default"**. A
press **selects**; a double press applies and closes; "Use" applies and closes; Esc closes (`usePhLayer`). Only what
you own is listed; the item in use wears the "In use" tag; tiles have the rarity edge.

- **Avatar** — today's portrait window content, unchanged: My Skins / Heroes / Minions / Hero Powers sub-tabs, search,
  per-tab filter. (The mockup showed skins only; the real tab keeps everything the portrait window offers today.)
  Saves through `setPlayerAvatar` exactly as now.
- **Frame** — owned portrait frames, each tile the ring on its own (no avatar inside); the preview shows the selected
  ring large. Saves with `equipCosmetic('portrait_frame', '', id | null)`.
- **Title** — owned titles as rarity-coloured pills, plus "No title". Saves with `equipTitle(id | null)`.
- **Card plate** — owned card plates. Saves with `equipCosmetic('card_plate', '', id | null)`.
- Side preview for Avatar / Title / Card plate tabs: your card at full size wearing the selection (Card plate shows the
  plate itself, since the card no longer draws it).

The window replaces the old portrait window: every place that opens the portrait window today
(`openAvatarPicker`, the Title-screen portrait, the banner menu's "Change portrait") opens this window on the Avatar
tab.

## Constraints found in the code (origin/main, 2026-11-23)

- **Other players' rank needs no server work.** `profiles.rank_division / rank_points / rank_season` are granted to
  `anon` + `authenticated` (`supabase/migrations/2026-09-29-hide-profile-email.sql`), and the leaderboard already reads
  them for everyone. The seat data fetch (`fetchProfiles` in `packages/ui/src/versus/versusSeatCard.ts`) reads
  `profiles` for every seat; add the three rank columns there, carry them through `SeatServerData` →
  `PlayerCardSource`, and apply the same stale-season rule as `rankedProfileOfRow` (`remoteBoards.ts`: a row whose
  `rank_season` isn't the current `RANK_SEASON` reads as a fresh start). Keep the existing fall-back chain of narrower
  selects so an older server still works.
- Your own rank stays `useCurrentRank()` (`rank/rankSource.ts`).
- Your title: `mirrorFor(currentUserId(), s.mirror)?.equippedTitleId`; frame: `useOwnPortraitFrameId()`; plate:
  `cardPlateOf(useLiveLoadout())`. Other players' title / avatar come from `fetchProfiles`.
- The Versus room keeps its drag-to-swap-seat and tap-a-seat menu (`versusRoomHome.tsx`); the card must stay the drag
  handle and the drag ghost.
- Stage rules (CLAUDE.md): portal into `stageHost()`; no `vw`/`vh`; no `title=`; no bare `cursor: pointer`; hover-only
  reveals need `.tt-on` twins; touch-only styling under `html[data-touch-ui]`.
- Performance: no looping animation of paint properties; memoize the card; don't read layout per frame.

## Approaches considered

- **A. New card component, shipped in three PRs (chosen).** A new kit component lives beside `PhBanner` until its last
  use is gone. Each PR is small enough to check on its own, and `main` never shows a half-built screen.
- **B. One PR.** Same work at once; one large diff across the lineup, the Versus room, the portrait window and the
  equips. Harder to review and to back out.
- **C. Restyle `PhBanner` in place.** Fewer call-site edits, but the flag's API is built around a tall portrait with a
  free-form foot; forcing a landscape card with rank / title slots into it leaves a component that fights its shape.

Mike chose A, **with other players' ranks included from the first PR**.

## Delivery: three PRs

1. **Card + Play lineup + everyone's rank.** New card component in the party home kit (with its CSS), used by the
   Play lineup at every seat count, including open seats, Leader badge, Ready / In game. Add the rank columns to the
   seat-data fetch so teammates show their medallion. Your own card's portrait keeps today's tap menu (Change portrait
   / View Career) until PR 3. Patch notes entry.
2. **Versus room seats.** Swap the seat banners for the card in all three Versus layouts (1v1 mirrored, Group 2 × 2,
   Duos columns), keeping drag-to-swap, the drag ghost, the Host badge, records in the eyebrow and every rival's rank.
   Patch notes entry.
3. **Cosmetics window + card tabs.** The four-tab window (Avatar tab = today's portrait window body), the four tabs
   on your card, every portrait-window entry point routed to it, the window preview using the new card, then delete
   `PhBanner` and its CSS. Patch notes entry.

## Left to the builder

- Component and file names, how the card is split into pieces, and the exact CSS numbers (start from the mockup).
- How the Avatar tab reuses the portrait window body (extract a body component from `AvatarPicker.tsx` is the obvious
  route).
- Tests: rank columns parsed and season-checked; mirrored rival layout; tabs only on your own card; each tab saves
  through the right call; the window opens on the tab pressed.

## Calls I made (Mike to check)

- **No rank yet → "Unranked" well** (plain label, no bar) instead of hiding the well, so every card has the same shape.
- **Guests**: no tabs on the card (guests can't change their portrait today, and can't own cosmetics).
- **Only the tabs open the window.** Pressing your card keeps today's menu (Change name, View Career) without "Change
  portrait"; in a Versus room pressing a card stays the drag / seat menu. (The mockup also made your portrait and title
  clickable; dropped so the press doesn't clash with the menu and the drag.)
- **Versus seats keep their real order**; mirroring is by position (right of VS), so drag-to-seat is untouched. Your
  card is on the right when you sit in p2.
- **Health and Armor** stay in the bottom band during a match, as today.
- **Phones** use the same three card sizes, no separate layout.
- **Changes you make show on your own card immediately**; teammates and rivals see your new avatar / title on their
  next seat-data refresh, as they do today.
