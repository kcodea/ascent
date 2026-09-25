# 2026-09-25 — Announcer: the moment catalog's third batch (group C, 36 moments)

The third of the four groups wiring the team's moment catalog: moments that needed new tallies or signals. Each
has its one approved ElevenLabs take (`apps/web/public/announcer/<id>-1.mp3`). `CATALOG_BATCH_3_EVENTS` in
`announcer.ts` lists them. Presentation only: nothing in `packages/sim`, `core` or `content` changed.

- **New signal: the action log.** `AnnouncerStateLike.replayActions` is the store's own run log, appended in the
  SAME update as the run, so `newActions(s, prev)` is exactly what an update did. RefreshStreak (`roll`), the
  Runeforge pick / skip / re-roll, HeroPowerBig (10 `heroPower` actions in the whole log, counted only when one was
  just used) and the play-based lines (ChooseOnePlay, BothEffects, YazzusDouble, GreatPot) read it. Everything else
  is a diff of RunState fields (`frozen`, `discover*`, `ownedRunes`, `runeProcs`, `questOffer`, `activeQuests`,
  `equipmentActivationsThisTurn`, and the per-action FX payloads `recruitBuffFx` / `rubyRiderFx` / `starformFx`
  with their seqs).
- **New signal: the Shop clock.** `observeTurnClock` now remembers the reading: FastTurn reads it at End Turn,
  Idle counts 20 s of CLOCK from the last action (a paused clock, a Discover or an aim, never counts), TimeUp hears
  it reach 0. The game has no auto-End-Turn: at 0 the Shop locks and the player still presses End Turn, so TimeUp
  plays at the lock.
- **New signal: the pairing.** `deps.foe` (default: `playerOpponent`, the read the combat HUD already makes) is read
  once at the Face Omen: GhostFight, Outgunned (foe tier 2+ above), MirrorMatch (both boards' `boardIntel` main
  tribe), Rematch (the seat that dealt the player's single biggest hit) and the foe's pre-round win streak, which
  StreakStopper reads at the verdict.
- **The takes name things.** TribeBuyLines' take is the Kobold line, MirrorMatch's is "Kobold against Kobold", and
  SeasonalRune's is the birthday line, so those speak only for Kobolds / Happy Birthday until the other takes exist.
- **Chances:** TribeBuyLines 6%, DiscoverOpen 10% (a tier 6 minion Discover skips the roll: the new
  `PendingLine.certain`, which still honours a 0% dial). Everything else 1.
- **Priorities are Claude's proposal**, each beside its nearest live moment. Checked against the common co-pending
  cases: DiscoverOpen (9) sits under BackToShop (10) because Start-of-Turn Discovers land on the return; MirrorMatch
  (19) under EnteringCombat (20) so a turn-1 Kobold mirror cannot take "the first Face Omen"; EquipmentUsed (24)
  under Equipment (25); QuestOffered (34) under Runeforge (35).
- **Tests:** a suite-wide `beforeEach` mutes this batch like the first; its own suite has one test per moment.

Skipped, for the owner:
- **LastLife** ("any loss knocks you out"): needs a ruling on what "any loss" means (see the PR).
- **HeroPowerReady** ("usable for the first time"): most active powers are usable on turn 1, so it is unclear
  whether this is the first moment of the game or only powers that start locked.

Partial: FloRida is heard in the Shop only (its combat firing has no signal outside the replay); QuestOffered /
QuestComplete are wired but dormant while quests are archived.
