# 2026-10-14 — Versus on the lobby screens (1:1)

Owner (via the coordinator): the Versus interface must reuse the existing lobby UI 1:1. Built on feat/versus-phase0.

**How.** A Versus run now carries a synthetic two-seat `RunLobby` (`packages/sim/src/versus/lobbyView.ts`,
`versusLobby`): seat `s0` is the player, seat `s1` the opponent as an `authored` seat whose board for round N is the
board they actually fought with (read off the player's own result, `initial.enemy`). Hearts ride the seats'
`resolve` (7, no Armor, no loss cap). The client rebuilds it only when its key moves (`syncVersusLobby` in
`versusStore.ts`: a round commits, the fight lands / settles / is left, heroes are revealed). Every lobby surface then
works unchanged: the rail (one row in Versus), `CombatOpponent`, NOW FACING, Fight Recap, the hero strike, scouting,
emote placement (the opponent's emotes arrive under seat `s1`).

**What it is not.** The reducer never settles it: `settleLobbyRound`, the settle-time seat charge and the
`advanceCombat` lobby branch skip `mode: 'versus'`, so Resolve / Armor never move and the run never ends by it.
Persistence gates: `isResumableRun` excludes Versus, the run-end upload block excludes it, captured boards are
lobby-mode only, the lobby is stamped `unrated`. `versusLobbyGates.test.ts` drives Versus rounds through the real
store commit path and asserts no save, no captured boards, no ledger / pool / history / rank / replay writes.

**Screens.**
- Entry: `requestRankedGate(onShut, 'entry', { onPress })` (new optional `onPress`; `cancelRankedGate()`): the
  crystal press is the player's ready (`pressGate`), held until the match exists, then it shatters onto Hero Select
  (`pendingMode: 'versus'`, `heroChoices` = the private three). A closed gate window opens the doors quietly.
- Hero Select: the shop's own `ShopTimer` (now exported from Recruit) fed `hero_deadline` (`VersusHeroTimer`), no
  Back, no Health pills, the pick locks on the card click (`lockVersusHeroPick`; the ceremony takes seconds). The
  launch curtain waits for the run, with a "Waiting for your opponent..." card.
- Hearts in the Health box (`StatusBar`), rail is the opponent only, no max-damage chip.
- Concede: Esc menu, two taps (`primary: 'concede'`).
- End: the End Combat press of the deciding fight (`versusMatchEndsAtPress`) or, with nothing left to watch, the
  match completing, plays the end gate onto the room. The room's "Previous match stats" opens `VersusMatchStats`
  (Match details panel + round pips + both boards per round).
- Music on; announcer on minus `VERSUS_SILENT_EVENTS` (table / Health / damage / placement / rank lines).
- Deleted: the Versus HUD strip, its end card, the room's gate buttons / pills, `VersusHeroPick.tsx`.

**Known gap.** The opponent's tavern tier is only on a result when they won the round (`damageBreakdown.oppTier`);
other rounds carry the last known tier forward (round 1 shows 1). Stamping both tiers on the round row would need a
resolver change; not done.

## Follow-up: the game start and the rounds, as a lobby game (owner 2026-10-14)

Owner: "let the full hero select animation play out before going to lobby. show the good luck screen, then have the
timer start per usual ... do not have round countdowns. when the players get back in together the round begins."

- **Game start.** The run waits for Hero Select's own launch (`versusStore` holds it as `pendingPresent`), so the
  whole ceremony plays; the curtain then runs the ordinary Good Luck intro (`shouldPlayGoodLuckIntro` admits
  `versus`). A timeout pick plays the same ceremony for the server's hero (`useVersusTimeoutHero`); once both heroes
  are locked, a finished ceremony starts on its own after 1.5 s.
- **Clock starts.** New migration `supabase/migrations/2026-10-14-versus-shop-start.sql`: a shop's clock starts the
  moment both players are back (no 3 s lead); round 1 opens with no clock until both clients call `versus_intro_done`
  (or the 45 s `intro_deadline` passes, through `versus_reconcile`). `VERSUS_TRANSITION_LEAD_MS` is gone,
  `VERSUS_INTRO_CAP_SECONDS` replaces it.
- **Waiting.** No text, no dimming: an invisible hold (`.vshold`) and the End Turn gem's own pill (`EndTurnButton`
  `note`) reading "Players ready N/2" (`versusTurn`). The disconnect pause uses the game's `.pool-wait` panel.
- **Removed:** the "Locked in" / "Waiting for" / "Round N starts in" cards and their CSS, and every room / browser
  class left from the earlier bespoke screens.

## Follow-up: the turn state, concede, the rail (owner 2026-10-14)

- **"i got back from combat and was set in the ready state."** The pill, the hold and the clock now read one explicit
  state (`packages/ui/src/versus/versusTurn.ts`: shop / locked / back / intro / waiting / none). A combat row past its
  cap is stale (re-read, never a pill); a lock the clock made shows no pill. The likely trigger on 5173 was a hot patch:
  re-executing `versusStore.ts` minted a second session store, so the screen read a frozen match row. The session store
  and the test bot now reload the page on a hot patch, like the main store (store.ts, 2026-09-23).
- **Concede shuts the gate at once** (owner rule): mine (the Esc menu), the opponent's (Realtime), and every other
  non-hearts end, in every phase (hero select, Good Luck, shop, mid-fight). Behind the doors the match is torn down
  (replay FX faded, sounds cut, the run never rebuilt) and the room keeps Previous match stats. A hearts finish still
  plays its deciding fight first. `versusEndsNow`; dev handle `concedeVersusBot()`.
- **The one-row rail** sits level with the End Turn gem on the right (`.vsrail`, `--lby-top: 36%` of the stage).

## Follow-up: an accurate scout card (live PvP test 2026-10-14)

"your lobby info isnt like real time. shows you as tier 1": the opponent's tier was only known from fights they
won. `supabase/migrations/2026-10-14-versus-scout.sql` (additive: columns, a 7-argument `versus_submit` overload, a
`before insert` trigger on `versus_rounds`) records BOTH seats' public state on every committed round: the tier read off
the locked side, plus the triples, quest and rune ids the client sends with every candidate and lock
(`versusScoutOf`). The two-seat lobby feeds it into the authored seat (`authoredTiers`, new `authoredScouts`), so the
rail, the scout card (tier, gilded, build, runes) and the combat Shop Tier show the opponent as of their last fought
lock. Never carried forward. The resolver bundle and the content revision are unchanged. The scout card's fight rows
read "-1" per lost heart.

## Follow-up: the opponent's hero block replaces the rail (2026-10-14)

Owner on the head-to-head rail card: "1.5/10", then on the first floating block: "3/10, i need a 9/10". The Opponents
view draws no rail panel. `versus/VersusFoe.tsx` mirrors your own hero block on the right, the socket centred on the
board's vertical middle: the board's own painted hero socket (`apps/web/public/frames/versus_socket.webp`, cut from
`augustfullboard.webp` around the socket under your hero, alpha-masked; no CSS-drawn ring), the portrait disc seated in
it with the opponent's portrait-frame cosmetic over it in their skin, your name plate across the bottom rim, your heart
pill (your pill's hit: the shake and rising "-1", the number ticking down once the block is back from the fight), a
compact Tier corner badge (the tavern gem + "Tier N") on the lower-right rim, and a small Round plate above. Status
shows only when it matters (Locked in / Ready / Away / Disconnected) as a small gold-rimmed pill under the hearts, with
one shine across the portrait when they lock in. The Guides tab sits above-left of the socket, clear of everything. No
round pips (owner: "dont put the round results under there"). Concept B and its dev switch are deleted.

## Follow-up: match stats overlay (2026-10-14)

No "Previous match" heading or summary line (owner: "completely unnecessary here"): Victory / Defeat, then the pips
(now on the Gem plate: the result colour, the gold edge, the bevel), then the round. Each player's row shows Match
details' seat portrait (skin + frame), name and hero, hearts, their board, and their runes as of that round's lock
(`versus_rounds.pN_scout.runes`, via `SeatRunes`). The Versus hero-select ceremony has no Start Game button (it starts
on its own a beat after the ceremony).

## Follow-up: a paused match takes no input (2026-10-14)

Owner: "i was able to hero power during this, fix that" (the disconnect veil). The store refuses run actions at the
action layer while paused (`versusRefuses` in `dispatch` / `preparePresentationAction` / the hero-power and Equipment
aims); a held shop refuses the player's own actions. End Turn and End Combat send nothing while paused; the fight's beat
clock, a pending shop death and the fight-landing End Turn wait for the resume. R-VERSUS-PAUSE-INPUT-01.
