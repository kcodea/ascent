# Spectating in sync with the player: cursor, hover, drag gap, aim, late join, watchers (2026-10-15)

Seven owner reports from live spectating (Versus and Live Games), fixed together because they share the cursor
broadcast. Oracle rules R-SPECTATE-CURSOR-01, -HOVER-01, -JOIN-01, -DRAGGAP-01, -AIM-01, -WATCHERS-01, -AV-04.

## The wire (no protocol version, every field optional)

- **Cursor** (`versus/cursorSpace.ts`): a sample is anchored to the element under the pointer (`u:<uid>` for a card or
  minion, `s:<data-spec>` for End Turn, Upgrade, Refresh, Freeze, the hero power slots, Equipment, runes and quests),
  as a fraction of its rect, plus game-box fractions (`gx/gy`, the centred 16:9 `.app` box from `stage.ts gameBoxOf`)
  and the old window fractions (`x/y`) for older clients. The old window fractions were the bug: the game is a
  letterboxed 16:9 box, so a 16:9 player's End Turn landed elsewhere on a 16:10 or 21:9 spectator. One rect read per
  sample on each side (15 Hz while moving), none per frame.
- **Hover**: the anchor key is the hovered target. The spectator fires `mouseover`/`pointerover` (no related target)
  on its own element, so every component's own hover handler opens its own preview; CSS `:hover` tips light with the
  existing `tt-on` chain (as touch taps do). No extra message.
- **Drag gap**: the player's drag decision rides the drag field (`g`), and the spectator writes it into the drag store
  the rows already read (the replay ghost-hold fix, fed live).
- **Aim**: the aim start is anchored, and `aim.t` names the target; the spectator snaps the line end to it and lights
  it. `Recruit` no longer attaches its own aim listeners while viewing (the watched run's `pendingTarget` used to wire
  the spectator's mouse to the arrow).
- **Late join**: a broadcast keyframe sent mid-fight carries `cb` (wave, beat). A spectator entering or coming back
  mid-fight asks for a keyframe and seeks (the replay `seekTo`, no fast-forward). A late fight with no beat (older
  player) cuts to the shop when the player is back there.

## Watchers indicator

`WatchersBadge` (top left, shop and combat) from the watcher rows: Versus room members, or the live watcher rows via
the new `lobby_live_watch_as` / `lobby_live_watchers` RPCs (`2026-10-15-lobby-live-watcher-identity.sql`, NOT applied
by this PR). A server without it falls back to plain "Spectator" plates. A leaving live watcher broadcasts
`spectate_bye`, so the player recounts at once.

## Audio in Live Games

Verified with a two-tab local loopback (the real publisher and watcher over BroadcastChannel, every `sfx` call
logged): shop, combat and music matched the player call for call. The only difference was a REFUSED action (a buy with
no Gold) tagged for the stands, which rang a buy sound for the spectator; refused actions are no longer tagged.
