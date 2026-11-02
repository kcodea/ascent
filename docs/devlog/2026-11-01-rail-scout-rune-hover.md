# 2026-11-01 · Rail scout card: hoverable runes with live values

Owner ask 2026-11-01 (screenshot of a Docked rail seat's hover card): "mouseover on runes here is important, and it should
show any relevant values if the player has value shown on their runes etc". Branch `feat/rail-scout-rune-hover`. Rule
R-RAIL-SCOUT-RUNE-TIP-02 (approved/runes.ts).

## What was wrong

- The hover card closed the instant the pointer left the seat (and was `pointer-events: none`), so its runes could only
  be reached on a PINNED card (click / right-click).
- On the Docked rail even the pinned card's rune tip never appeared: `.lrv-sc-socket` set `display: flex` on hover but the
  shared `.questbadge-tip` stays `opacity: 0` unless a `.questbadge:hover` (or the classic `.lobbyscout-socket:hover`)
  rule lifts it.
- The tip printed only `liveRuneText` and a bare "Rune · active" pill, so your own seat lacked the meters your rack shows.

## What

- `runeTipBody.tsx`: ONE rune-tip body (`RuneTipBody` / pure `runeTipLines`) used by the rack (QuestBadges) and the
  scout card, so they cannot drift. Source = a whole run (every value + `runeTally` meter) or a captured board
  (`runeLive` + first spell).
- LobbyPanel: `leaveScout` closes the hover card 160 ms after the seat is left; the portaled card is the seat's React
  child, so entering it re-enters the seat (cancels the close) and leaving it closes it. `.lobbyscout` takes the pointer.
- `ScoutRuneSocket` mounts the tip only while hovered (pointer enter / leave, so touch taps work via touchInput.ts), and
  `ScoutRuneTip` measures once on mount to flip below / slide sideways so it stays on screen.
- Sim passthrough: `SeatIntel.firstSpellId` (from `BoardSnapshot.firstSpellThisTurnId`) so Recollection can name the spell.

## Live-value coverage by seat kind

- Your own seat (and the watched player's when spectating): the whole run, everything live incl. meters.
- Every other seat (recorded snapshot, hybrid, authored tutorial seats, Versus 1v1 / group / Duos opponents and the Duos
  teammate, Ranked Duos): the captured `BoardSnapshot`: Wild Hunt, Packcraft, Beastial Swarm, Borrowed Flame and
  Recollection live; Shop meters (runeThresholds, Wheel, Ledger, Wages, Baller, per-turn charges) print base, no count.
- Closing that gap needs the snapshot to record the meters (e.g. a `runeTallies` map captured in `snapshotBoard`): a
  snapshot/wire change, proposed, not built.

## Relation to PR #2513 (Mike, `fix/rail-scout-rune-tip`, R-RAIL-SCOUT-RUNE-TIP-01)

#2513 lights the socket tip with CSS on the PINNED Docked card only, and keeps the hover card click-through (its test
asserts that). This branch fixes the same transparent tip, so it SUPERSEDES #2513, and it parts with #2513 on one point:
the owner's 2026-11-01 ask is about the HOVER card, so the hover card takes the pointer while it is open (it closes 160 ms
after the pointer leaves the seat or the card). It opens beside the rail (over the board), and takes the pointer only while
the pointer is on it. If #2513 lands first, its CSS rule and its click-through test are replaced by this branch's.
