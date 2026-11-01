# 2026-11-01 · Salandaman counts the whole team

Owner change 2026-11-01: Salandaman (Duos Beast, T4 4/4) "has +4/+4 for each of your team's Salandaman's that have died
this game", clarified as "this means it counts both sides game wide". Branch `feat/salandaman-team-tally`. Rule
R-DUOS-SALANDAMAN-TEAM-01 (approved/foundation.ts; R-DUOS-BATCHA-03 notes the widening).

## What

- Text: "Has **+4/+4** for each of your team's **Salandamans** that died this game." Live text (both chains, via
  `cardTypeTallyText`) prints the team total and count; Spear Warden keeps its own wording.
- `cardDeathScaler` takes `team: true`. Every death of such a card also sends the teammate a new team effect,
  `{ kind: 'cardDeath', cardId, count }` (`TeamEffect` in core types):
  - **Combat** (`noteCardDeath`): `ctx.sendTeam(..., false, true)`, so it is real time by construction (the `teamSend` beat,
    queued when the fight lands, held until the replay reaches it, R-DUOS-RUNES-02).
  - **Shop** (`noteShopCardDeath`): `queueTeamEffect`.
- The receiver (`receiveTeamEffect`, the recorded `receivePass` action, so replays reproduce it) grows its own tally at its
  OWN def's per-death rate (the payload only names the card and the count, clamped 1..10; a non-team or unknown card
  does nothing). Any phase, so it lands mid-fight. Shared body with the Shop death: `growCardDeathTally`.
- **Tag-team** (one `simulate` per team fight): a team-tally death on a side whose reserve has not stepped in yet is
  banked (`mateCardGains`); at step-in it is folded into the reserve's run context (`cardBuffs`, so summons / Rises built
  from base inherit it) and onto the stepping-in bodies. It is never in the reserve's own carry: the teammate's run gets it
  from the team effect, so nothing is counted twice. Symmetric (either side).

## Notes

- The Worker relays team objects without checking the kind (`groupMatch.pass` checks only `passFrom: 'team'` + an object),
  so no Worker code change; the Worker resolves fights with `@game/core`, so the next pack's Worker redeploy picks up the
  tag-team change. Each death is one team row, inside the Worker's 60-per-round team-effect cap.
- Scene Builder: the placeholder teammate's channel is generic (`sbDuosChannel.ts`), so a Salandaman dying in my fight or
  destroyed in either Shop reaches the other run. The placeholder never fights, so its combat deaths cannot be shown there.
