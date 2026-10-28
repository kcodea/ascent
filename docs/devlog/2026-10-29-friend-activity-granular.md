# 2026-10-29 — Friends: what a friend is doing (granular activity + privacy switch)

Owner ask: "Can we get more granular player online text in friends list like in main menu, browsing career, browsing
leaderboard, watching a replay, and then better in game granularity too". Rule: R-FRIENDS-ACTIVITY-01.

**What.** An online friend's row now names the screen (Main menu, Choosing a mode, Browsing Career / Leaderboard /
Hall / Recent / Live Games, Collection, Compendium, Patch Notes, Settings, Friends, Hero Select + mode, Practice setup,
Versus browser / Duo party browser, In a Versus room "3 of 4 players · Waiting/Starting", In a Duo party with X,
Watching X, Watching a replay: own / a friend's by name / a stranger's unnamed). In a game the step is richer:
Picking a hero, Shopping, Ending turn, Fighting <name> or "a recorded board", Knocked out Nth (Versus, watching the
rest), Won the game / Finished Nth (end screen), plus the Ranked Duos / Versus Duos teammate. The row stays two lines;
`friendDetail` puts every line in the row's `data-tip` hover/tap. Settings > Friends: "Show friends what I'm doing"
(default on, `friendsPrefs.ts`, localStorage) — off sends only Online / In a game + mode (no detail, no watch target).

**How.** `FriendActivity` (gameStatus.ts) rides the same `p_game` slot as `FriendGameStatus`, told apart by `act`; the
game status gains optional `step`/`foe`/`mate`/`final` (older clients read `phase` and ignore them). Everything is
derived from stores already on the device; whose replay comes from `startReplay`'s meta (`authorId`, set by Career and
Recent Games; no meta = a Rewatch = own). The lobby foe is `forcedOpponent` or `pairRunLobby` (cheap; cached per
lobby + round), never `playerOpponent` (its board prepare is expensive).

**Egress.** Only the COARSE key triggers a beat (`gameCoarseKey` + `activityKey`: no Health/Armor/tier/place; a lobby
End Turn rides along). A change waits `CHANGE_SETTLE_MS` = 1.5 s (each change re-arms it; a flip straight back cancels
it; never later than the regular beat). Scripted 35-minute session (`friendsBeatBudget.test.ts`): **46 beats before
(80/h) -> 53 after (92/h); 36 with the switch off.** The test pins <= 125% of the baseline.

**Server.** `supabase/migrations/2026-11-10-friends-activity.sql` (NOT applied): `friends_beat` keeps `p_game` for
'online' too, `friends__presence` returns it for online. Same signature; until applied the server drops online
activity silently (in-game status unchanged). No versus-resolve redeploy (UI-only + SQL).
