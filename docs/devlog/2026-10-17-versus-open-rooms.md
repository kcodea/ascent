# Versus: the menus show when a room is open (2026-10-17)

Owner ask (Kevin): "can we add a way to show if a lobby is up in versus mode so players know to look".
R-VERSUS-OPEN-ROOMS-01.

## What shipped

- `supabase/migrations/2026-10-17-versus-open-rooms.sql`: `versus_open_rooms(protocol, content)`, SECURITY INVOKER,
  read-only, signed-in only. Returns `{ open, seatOpen }`: open rooms with a member seen in the last 2 minutes (the
  prune rule of `versus_list_rooms`), on the caller's protocol + content revision, that the caller is not in.
  `seatOpen` = those with a player seat free. **The owner applies it**; until then the client gets `not_deployed`,
  shows nothing, and stops asking for the session.
- `menuPoll.ts`: ONE shared timer (45 s) for the menu counts. The Live Games count (`live/liveCount.ts`) moved onto
  it. A tick asks only while a menu is on screen (`showTitle || practiceSetupOpen`) and the tab is visible; a count may
  add a gate (Versus: `versusEnabled()` and no Versus match of mine live).
- `versus/versusOpenRooms.ts` + `versus/VsOpenBadge.tsx`; `Title.tsx` (Play badge, Versus tile glow + "N open" chip,
  the data-tip on the Play wrapper / tile); `MenuSidebar.tsx` (Play badge + wrapper data-tip). CSS: the kwglow recipe
  (opacity of a `::before` with a static shadow), `.paused` while unfocused, static under reduced motion.

## Why a SQL function and not a PostgREST count

RLS already lets signed-in players read rooms and members, but a head-only count cannot apply the 2-minute freshness
rule on the server clock, exclude the viewer's own room, or count free seats in one request. The function returns two
integers and can see nothing the caller could not already read.

## Judgement calls

- Counted: every joinable Open room (an open seat OR players waiting), so a full-seated room still waiting to start
  counts. Rooms on a different protocol / content revision are left out (joining them fails with `version_mismatch`).
- The Play badge is a small dark-red count disc (Play stays the gold CTA), the same red as the Live chip.
- The Title's hook sits above its `showTitle` early return, so it stays subscribed while the title is hidden; the
  `menuOnScreen` gate is what guarantees no request during a match (pinned by the test).
