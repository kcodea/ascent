# 2026-10-26 — Hero Select is spectatable; Duos teammate's hero choices

Owner asks (2026-10-26), verbatim:

- "I want spectating to show up when a player goes into hero select. this should work in all modes. hero select should
  be spectatable." (R-SPECTATE-HEROSELECT-01)
- "in duos, the teammate's hero options should be visible as well. there should be teammate portrait in the bottom right,
  like it is in game, but have the player's portrait to be clickable and view the hero options so they can work together
  on who to pick." (R-DUOS-HEROSELECT-01). A suggestion / ping system comes later; not built.

Branch `feat/hero-select-spectate`. Rules: GAME-RULES (Versus "Spectators watch Hero Select too", Duos "Your teammate's
hero choices", Live games "Listed from Hero Select"); oracle `approved/foundation.ts`; patch note 2026-10-26.

## The wire: a Hero Select frame

`spectatorView.ts`: a new message kind `hero` beside `key` / `delta`, carrying the screen whole (`HeroSelectFrame`:
`offer`, `picked`, `reroll`, `canReroll`, `mode`), sanitised on the way in (`heroSelectFrame`: hero ids are short
strings, the pick must be offered, the mode is `versus` or `lobby`). Nothing else travels: no seed, no pool, no entry id.
`nextHeroSelectMessage` sends only on a change (or a watcher's key request), takes the publisher's next seq and clears
`last`, so the first run message after it is always a keyframe, which replaces the Hero Select on the receiver
(`applySpectatorMessage`). An older client simply ignores the new kind.

## Publishers (same cadence rules as the run's frames, no new loop)

- **Versus** (`versusStore.ts heroFrames`): an idle-time deferred writer (120 ms), poked by a store subscription when
  my Hero Select's inputs move (offer, re-roll, my pick, the room, the match). Only while someone may watch
  (`watcherCount`: the stands, players out of a group match, a Duos teammate). Broadcast only, NEVER persisted:
  `versus_spectator_frames` is readable by every member and the offer is private, so a late joiner asks
  (`spectate_key`, already throttled) and gets it on the next publish. The run publisher starts above the last Hero
  Select seq.
- **The pick** lives in Hero Select's own ceremony reducer, so the screen reports it (`hero-select/ownHeroPick.ts`); a
  click, the Versus clock's pick and a timeout all go through it.
- **"On screen", not the server phase.** Found live: the LAST pick in ends `hero_select` on the server at once, while the
  player's screen still plays that pick's ceremony for seconds, so a frame gated on the phase never carried the last
  pick. Publishing (and the Duos teammate view) key on "my Hero Select is on my screen" (`heroChoices` until the launch
  curtain's `startVersusRun`).
- **Test bots** (`versusBot.ts`, `VersusBotDriver.heroSelectShown`) publish their Hero Select like a person's client.
- **Live Games** (`livePublisher.ts`): a ranked Hero Select (`pendingMode: 'lobby'` + a ranked entry) is listed under the
  entry's run id, the same id the run takes at the pick, so Hero Select flows into the same listed game with no
  re-listing. Heartbeat phase `hero` (hero = the pick, else the first offered), its frame stored like a keyframe (a lobby
  has no opponent to hide it from). The action / cursor tap stays off on Hero Select, as in Versus. A server without the
  migration answers `bad_phase` once: Hero Select is then not listed for the session (never a failing call every 15 s)
  and the game lists from its shop, as before.

## Watchers

- `spectate.ts`: `hero_select` is a live phase; at it a spectator with nothing cached asks the players. While the watched
  seat has a Hero Select and no run view, `useSpectate.hero` holds it (one object per distinct screen) and the watch
  screen opens on it (the store's own screen set aside, as for the shop). A seat switch updates the seat and its Hero
  Select in one store update (live run showed one frame of the other player's heroes before).
- `hero-select/HeroSelectWatch.tsx` (mounted in `Game.tsx` after `HeroSelect`, before the launch curtain): draws
  `<HeroSelect watch>` from the frame, with the stands' chrome (`SpectatorBar`; a live game's `LiveWatchBar` is already
  mounted) raised above it (`body:has(.heroselect.hswatch) .vsspec`).
- `HeroSelect` watch mode: the same screen; clicks pick and re-roll nothing; the re-roll buttons show while unused
  (inert, default gauntlet cursor per the cursor rule) and the swap plays when the player spends it; the watched pick plays
  its ceremony (`HeroSelectCeremony watch`: no Start Game, no Versus auto-start, no Pixi layer when another Hero Select
  runs one underneath); the Versus clock face (driving it only when it is the only Hero Select on screen,
  `VersusHeroTimer drive`).

## Duos: the teammate's choices

`DuosMateDock heroSelect`: the in-game dock on Hero Select (default place: there is no hero disc of mine to mirror), face =
their pick (from their frames, `useSpectate.matePick`) else their profile picture, else their initial; the team's Health box waits for the game (no pool before
the heroes are in). Click: `enterTeammateHeroView` (the shop view's cross-fade, `turn(swap, changed)`), which shows their
Hero Select over mine with the team-colour frame; my own portrait there (or Esc / letting go of Tab) comes back. My own
Hero Select stays mounted underneath (clock, pick, ceremony). It closes when my launch curtain takes my Hero Select. The
teammate frames reach only my teammate's client view (the room filter `isMateFrame`); the other team never draws them.

**Ranked Duos reuse:** the view needs only a teammate seat whose Hero Select frames reach `spectate.ts` (`trackDuosMatch`
+ `receiveSpectate`) and `enterTeammateHeroView`; the dock and the layer are mode-agnostic.

## Verification

- Unit: `versus/spectateHeroSelect.test.tsx` (the wire, the stands' flow into the shop, other-match frames ignored, the
  Duos cache / view / close at launch, the read-only screen, the re-roll swap, the Live Games listing from Hero Select,
  delisting on Back, Practice never listed, the refused hero phase). Bot: `versusBot.db.test.ts` (its Hero Select shows its
  three and the hero it plays). PGlite: `sim/lobby/lobbyLiveHeroSelect.db.test.ts` (refused before the migration; after:
  listed at Hero Select, watchable, frame stored, flows into the shop row; idempotent).
- Live (dev server of the branch on :5194, live backend, headless Chrome with two isolated profiles, Claudebot5 host +
  Claudebot9 in the stands, test bots Claudebot6-8; every room closed, browsers closed): Versus 1v1, Group (3 players) and
  Duos: the spectator opened on the host's Hero Select within about 2 s of it, saw the re-roll swap, the pick and its
  ceremony, then the first shop; in Duos the spectator switched to a bot's Hero Select (key 2) and back; the host's
  bottom-right teammate portrait showed the teammate's pick, clicking it showed their choices and pick ceremony in the team
  frame, and the own portrait brought the host back. Screenshots kept outside the repo.
- NOT verified live: the Live Games watch of a ranked Hero Select. It needs `2026-10-26-lobby-live-hero-select.sql`
  applied (the listing refuses the `hero` phase until then); covered by the unit and PGlite tests.

## Deploy (the lead)

Apply `supabase/migrations/2026-10-26-lobby-live-hero-select.sql` (after `2026-10-15-lobby-live.sql`). No Edge Function
changed (no versus-resolve redeploy), no content revision change.

## Known limits

- The room's broadcast channel reaches every member's client, so an opponent's client RECEIVES a player's Hero Select
  frames (as it already receives their shop frames); it never draws them. Hiding them at the transport would need a
  separate stands channel (a later seam).
