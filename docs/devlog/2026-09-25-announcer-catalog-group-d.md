# 2026-09-25 — Announcer: the moment catalog's group D (per-hero / per-tribe moments, keyed takes)

Owner ask: wire the team's 98 idea moments. Group D are the moments the catalog wants per hero or per tribe
(heroPick, heroOpener, opponentHero, tribeTakeover, tribeSurge) plus firstGameEver and rankUp. Each has ONE approved
ElevenLabs take, and that take is the catalog's example line, so for the per-hero / per-tribe moments it NAMES one
hero or tribe ("Brackus. A king takes the field.", "Midas and his Gold again.", "Kobolds everywhere!", "Dragons are
surging this game."). None of them is a generic line that reads right for every key.

- **Keyed takes** (`KeyedTakes` in `announcer.ts`: `byKey` per hero id / tribe, plus a `generic` fallback): a keyed
  moment speaks only when its key has a take (or a generic take exists). The event's `ANNOUNCER_LINES` row is built
  from the map, and a queued line carries `takes` (the subset the no-repeat bag picks from), so adding a hero's or a
  tribe's line later is one entry in the map plus the mp3. Today each map has one key and no generic take:
  `HERO_PICK_TAKES.brackus`, `OPPONENT_HERO_TAKES.midas`, `TRIBE_TAKEOVER_TAKES.kobold`, `TRIBE_SURGE_TAKES.dragon`.
- **HeroPick** (16, over GameStart's 15): the hero picker is pre-run, so the gate is off there; the pick is what
  lands the run at wave 1, so HeroPick is queued with GameStart at run entry and replaces it for a hero with a line.
- **OpponentHero** (21, just over EnteringCombat): at the Face Omen, the foe's hero from `pairRunLobby` (the pairing
  the NOW FACING wipe shows, without preparing the foe's board). Skipped entirely when no standing seat has a take.
  The bye (a ghost fight) never speaks.
- **TribeTakeover** (29, between Triple and TribeFour): a tribe reaching 5+ on the board in the Shop (dual tribes
  count for both, an All-tribe minion for every tribe); once per tribe.
- **TribeSurge** (14, over BackToShop): Practice's `practiceConfig.tribeSurge`, on the return to the round-2 Shop, so
  the first Shop still hears GameStart. There are no "event" surges in the game yet.
- **RankUp** (95, terminal like the end lines): the rank screen is inside the gate (the run is over, still on
  screen). When the server's confirmed `rankResult.promoted` lands, the line queues no earlier than the end line
  (`endLineAt`) and bypasses the cooldown, so it follows the end line straight on; a Continue off the screen cancels it.
- **Not wired:** heroOpener (the catalog wants the HERO's voice; the take is the announcer's), and firstGameEver
  (no reliable account-level "games played" in the client: `profile.rank.revision` resets every season and never
  moves offline; the Career games count is a server fetch; a browser flag is not an account). Questions for the owner
  are in the PR.
