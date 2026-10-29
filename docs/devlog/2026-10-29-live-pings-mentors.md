# 2026-10-29: live pings + mentors

Owner design (2026-10-29): five pings (check, X, question, pass, sell) on shop cards, board minions, hand cards and
shop buttons; Duos teammates ping each other; a player can promote one spectator to Mentor, whose pings only that
player sees; players can ping on their own and spectators see those pings.

- **One wire contract** (`workers/versus/src/pings.ts`, imported by the UI as `@game/versus-cf/pings`): `PingMessage`,
  `PingMentorMessage`, `routePing` / `routePingMentor` (who may send, who receives), `PingRateLimiter` (3 / 2 s). The
  Versus room (`room.ts relayPing`) intercepts the `ping` / `ping_mentor` broadcast events, stamps `from` + `role`, and
  relays to the audience only. The CF live object for lobby/Practice (`liveGame.ts relayPing`, PR #2402) runs the same
  rule through `livePingRoom(owner, watchers, mentor)` (the player is `p1`, the stands are spectators) and stores the
  mentor under `pingMentor`.
- **Clears travel** (`ping_clear`, `routePingClear`): a click on a ping or a drag of its card clears it on every screen
  that shows it. The player, the teammate and the mentor may send one; a plain spectator clears only locally. Pings have
  no timer (owner: "spark ... then settle"); a ping also goes when its target leaves the screen.
- **Client adapter** (`packages/ui/src/pings/pingRuntime.ts`): `setPingSession(owner, { send, seat, mode, gameKey })`
  is installed by the Versus store, the live lobby publisher and the live watcher; every stream handler passes events
  to `receivePingEvent` first. Over Supabase the receiver re-checks the rule (the channel cannot authenticate senders).
- **Layer** (`PingLayer.tsx`): the fan menu (owner pick 2026-10-29 from three prototyped layouts: fan, ring, strip):
  Check, X, Question in an arc above the target; on a card, Pass and Sell below (Inspect left the fan the same day: a double right-click inspects, owner "remove the
  magnifying glass ping"; its art stays in the folder, unused). A shop button gets the
  top three only. Marks are portaled INTO the card element (they ride its transforms);
  a 4 Hz `isConnected` + query check (no layout read) clears a ping whose card left its zone; a drag clears it at once.
- **Phone**: `touchInput.holdFiresOn` takes a gate from the ping layer, so a hold on a play-zone card opens the menu
  only while pings are available (R-TOUCH-TAPINSPECT-01 otherwise unchanged); a press on a mark never pops the hand card.
- **Art**: the owner's six painted bubbles, cut to transparent 256 px WebPs (gradient-barrier flood fill from the image
  edges, soft 3% glow) in `packages/ui/src/art/pings/`.
