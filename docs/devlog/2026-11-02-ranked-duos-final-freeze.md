# 2026-11-02 · Ranked Duos: the end always reaches both teammates; a closed room stops waking

Live report 2026-11-02 ~15:29 UTC (Orangez + LazerLemon, team "hilton hotels", match `bc3ba9c7…`, room `67cd0ee6…`,
Worker `ascent-versus-v1-63fb56b5`): "the last fight mike got frozen and combat didnt start". Orangez ended in the party;
Lemon sat on the round 13 shop (0 Gold, 14 Health) with no way out: "how do we end the game? ... like how is it not the
same logic". Branch `fix/ranked-duos-final-freeze`. Rules R-RANKED-DUOS-END-01, R-VERSUS-CF-ALARM-IDLE-01.

## What the live evidence says (Workers Logs + Supabase, read only)

- **The server was fine.** Round 13 closed and resolved inside one WebSocket message at 15:28:02.460 (`close` +
  `resolve_ok`, about 8 s into the 30 s overtime by the schedule). The team lost 19 damage from 14 Health, was placed 3rd,
  the match completed at 15:28:02.46 and `ranked_finish` landed (match, seats, teams, rounds, rating).
- **One client never applied it.** Orangez played the fight and went back through the end gate. Lemon's screen stayed on
  the shop. His sockets: two opened 457 ms apart at 15:05:55 (a timed-out first connect, most likely), one died 1006 at
  15:22:09 with the other still open, and the last closed cleanly at 15:30:36 (his reload). Nothing logged on the server
  side for 15:22 to 15:30 explains it: no pause, no resolve error, no auto.
- **A second report, same day (owner, the WIN at round 14, match `de677759…`):** "combat seemingly restarted, then when
  it finished just sat at the end combat state and 'returning to shop' just returned to combat". Leaving through the menu
  worked. Same Worker, same clean server side (`close` + `resolve_ok` at 15:56:23.083, placed 1st).

## Root cause (reproduced in two headless browsers on the local Worker)

`onMatch` called `trackDuosMatch(match.phase !== 'complete' ? match : null)`. At the end that `null` cleared the spectate
module's `asPlayer`, so a SEATED Duos player was treated as the stands. Duos players keep receiving the teammate's live
frames (the teammate view's cache), and the teammate's client was still publishing its deciding fight. The next such frame
went through the stands' path: the watch screen opened over the player's own game. So the player saw the teammate's fight
start again ("combat seemingly restarted"), their End Combat gem was the watch screen's, the shop curtain led back into the
teammate's fight, and the end gate never came. When the teammate's fight result was not in the module's rounds, the watch
screen held the teammate's previous frame instead: their round 13 shop, their hero in the hero slot (Lemon's screenshot).
The default watched seat is p1, so it hit the p2 teammate (Lemon) unless p1 had opened the teammate view first.

Reproduced on the bench build (two headless shells, `scripts/versus-qa`, wrangler dev): at the end Bob (p2) sat on
`run.runId = spectate:<match>:p1`, `useSpectate.active = true`, in combat, while Ann was back in the party. Fixed build:
both in the party. The chaos harness never caught it: it runs the store, not the watch screen's render.

## Fix (client)

- `trackDuosMatch` keeps a finished match: the seated player stays a player (the teammate view closes, the frames stay
  cached). A seat-less client of a Duos match (a team knocked out to the stands) still clears it, as the stands. And a
  finished match that is not on screen never opens on it (`watchDone`), so a player back in the room is not pulled onto
  the teammate's last fight by a trailing frame.
- `endBackstop` (`versusStore.ts`, every 500 ms tick, local only so it runs with a dead connection too): while a finished
  match is still on this player's game screen, the teammate view is left and the run is driven again (the deciding fight
  lands and plays; its End Combat gem ends the match as before). A shop still on screen 15 s after the end with nothing
  animating (60 s hard cap for a long End of Turn) closes the end gate and opens on the room. A fight on screen is never
  cut.
- The Esc menu on a finished match reads "Leave match" ("The match is over. Back to the room.") and goes through the end
  gate. Nothing is sent to the server.

## Fix (Worker): closed rooms woke ~15 times a second, for ever

Found in the same logs: the room DO kept alarming after the match (from 15:30:36, when its last socket closed), and so
did six other closed rooms across three Worker versions, for over a day. `rearm` asks for an alarm NOW while a closed
room has not forgotten itself, but `drainOutbox` returned before the forget whenever nothing was queued
(`outboxRetryAt == null`). Now only a retry backoff holds the drain. The workerd test counts 67 alarms in 2 s before the
fix, 0 after. Side effect: a fresh instance after a wake now drains jobs it finds in storage too.

**Deploys:** the Worker fix needs a Versus Worker deploy (`npm run versus:cf:deploy`). The looping rooms live on the OLD
Workers (`ascent-versus-v1-525f9162`, `-bb7740f2`, `-63fb56b5`), which a new deploy does not touch: deleting those old
Worker versions (or one redeploy of each) stops them. The client fix ships with the next Netlify pack.

## Flagged, not fixed here

- `ranked_finish` carries no submissions for the DECIDING round (`versus_group_submissions` stops at round 12 for this
  match): the final round's subs are folded into history only when the next shop opens, which never comes. The duo run
  recorded from this game misses its last board.
