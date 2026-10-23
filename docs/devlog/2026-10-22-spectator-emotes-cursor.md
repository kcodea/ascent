# 2026-10-22 — Spectators see the player's emotes and combat cursor; replays too (R-SPECTATE-EMOTE-02, R-SPECTATE-COMBATCURSOR-01, R-REPLAY-EMOTE-01)

Owner reports (2026-10-22): "spectators arent seeing when a player emotes, i think only the player sees the emotes.
please fix this." and "i dont think spectators can see player mouse behavior in combat (or emotes) which would be
nice to see."

**Root causes**

- *Live ranked watching:* the player's client kept the default emote transport, the local loopback
  (`emotes/emoteTransport.ts`). An emote was delivered to the player's own bubble and never left the client. The live
  publisher sent frames, action tags and the cursor, but nothing for emotes.
- *Versus spectators:* both players' emotes already travel on the room channel (`emote`), but
  `receiveVersusEmote` drops everything when this client holds no seat (`mine === null`), which is exactly a
  spectator. Players seeing each other's emotes already worked (fixed 2026-10-16) and is unchanged.
- *Replays:* the spectator stream (R-REPLAY-STREAM-01) had no emote channel, and `EmoteLayer` schedules nothing during
  a replay.
- *Combat cursor:* the player's cursor source was never gated by phase, so a watched player already sent it in combat.
  The spectator overlay (`SpectatorCursor`) returned nothing while the run was in combat, and the replay recorder,
  the replay feed and the Recruit capture effect were all shop-only. The replay clock also stood still for the
  whole of a combat frame (no step is armed while the arena plays).

**What changed**

- `emoteTransport.ts`: `subscribeSentEmotes`, told once per emote this player says, whatever transport is
  installed. It delivers nothing locally, so the speaker's bubble still comes back exactly once.
- `livePublisher.ts`: while someone watches (only then), each emote the player says goes out on the game's channel
  as the Versus wire message for seat `p1`. The channel is `self: false`, so no echo.
- `versusEmotes.ts`: `receiveWatchedEmote(payload, watchedSeat)`: the watched seat's emote is shown as `s0` (the
  hero portrait, where the player sees their own), the other seat's as the Versus foe. Refused for a seated player,
  malformed payloads, and a second emote from the same seat inside the cooldown (receiver-side flood guard, the
  channel is a public broadcast). Wired in `liveWatch.ts` and in `versusStore.ts` (spectators only).
- `SpectatorCursor.tsx`: drawn in combat too (no held card there). Hover mirroring already resolves `u:<uid>` to the
  combat unit (`Unit` carries `data-uid`), so the unit preview opens for the watchers.
- Replay: `StreamSegment.em` (`[ms since t0, seat, emote id]`, optional, capped at 64 per segment) in
  `packages/sim/src/replayStream.ts`; the recorder records the cursor in combat and every seat emote delivered on
  the player's screen (never a spectator chip `w:`); the stream player feeds the hand in combat frames and delivers
  emotes when the replay clock reaches them (one skipped past by more than 1.5 s is dropped, never popped late);
  `replayClockMs` now runs through a combat frame from `combatShownAtReal`, held while paused and re-anchored on a
  speed change. `EmoteLayer` still names the fight's foe during a replay so a recorded foe emote finds the foe
  portrait.
- Old replays: a segment without `em` is still a valid segment and plays exactly as before; an older build reading a
  new replay ignores the field.

**Perf.** The player side adds nothing per frame. The cursor source already ran in combat whenever someone watched;
what is new is that a recorded (ranked / Practice) run keeps the recorder subscribed through the fight, which costs at
most one 20 Hz tick that builds one message (one anchor rect read) while the pointer moves, and nothing when it is
still. Numbers for the PR are in its Verification section.

**No server change.** Emotes ride the existing Realtime broadcast channels; no SQL, no Edge Function.
