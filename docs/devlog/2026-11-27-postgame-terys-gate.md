# 2026-11-27 — The end of a game: crystal gate, journey, Terys Gate

**Owner ask:** "gates close with a crystal forming again. you click it to shatter and play the same portal style animation that takes
you to a brand new post game screen. closing that out shows you at the main menu". Then the art: "use this for the returning art"
(first named the Portal of Kings, then "Rename it to Terys Gate"), "this is also the new background art in the menu". Rule R-LOCATION-13.

## What shipped

- **The ending fight leaves through the ENTRY gate** (`Recruit.tsx` `endCombat`): doors shut, the result is committed behind them,
  the crystal forms and waits. Falls back to the old end gate only if `postGameJourney` returns null (never today) and to the blue
  sweep under reduced motion.
- **A JOURNEY is a reveal with no parchments (`n = 0`)**: `outroAt(0) = L + JOURNEY_REST`; no words, no posters, no name sting or
  announcer line; the leaving wave washes in whatever `LocationRevealRequest.arrive` names (`arriveScreen`, generalised from hero select).
- **The hold** (`postGame.tsx`): the end screen mounts behind the doors; `usePostGameHeld` keeps RankScreen's GSAP sequence from
  starting until the wave arrives. The gate's `.finally` always lets it go.
- **Terys Gate** (`TERYS_GATE` in `locations.ts`, id `terys`): a place with no set (`setId` is optional now, `name` covers it,
  `locationById` resolves it). The post-game screen stands on it (`PostGameGround`: blurred, living, its ambience via `standAt`).
- **Menu backdrop** is `backdrops/terys-soft.webp` (1920x1080, 16:9 crop centred on the gate, 5px baked blur). `world-soft.webp`
  stays: `apps/dash` still uses it.

## Terys Gate's art, v1

No background was painted for a cut parallax, so it is ONE rigid piece (`layers.py p`): constant depth (nothing bends), layers 1-3
empty, wind only on the tree, banners and flowers, the four falls traced (`watermap.py`), 17 lights (the gate's heart, its runes,
the stars on its frame, the far castle, the floor star, the falls), and its own idea: the light inside the gate and its ring of runes
pulse out from its heart (`energy`, data.webp's blue). A real parallax needs the owner's background (method.md, section 3).

Sounds `ride-terys` / `ambience-terys` were generated with ElevenLabs (`sound.mjs`); measured -10.7 / -25.4 LUFS, trimmed to
`mix: { ride: 0.78, ambience: 1.5 }`. The restricted key cannot read the subscription, so the credits used were not reported by the API.

## The post-game screen (second pass, same day)

Owner: "The post game screen needs a massive revamp ... rank and xp gains ... (Red/green/gold variations) ... show all opponents and
their boards, turns eliminated ... all runes ancients ... announcer lines here like nice try ... look like a AAA experience." Picks:
two beats, a line pool per place, every board expanded. Rule R-POSTGAME-01.

- `postGame/PostGameScreen.tsx`. A first pass (a reskinned column, a 2x4 grid of seat cards, sentences everywhere) was judged "a 2/10"
  ("I need a 10/10 post game screen. Remove extra fluffy text too"). v2: Beat 1 is `RankScreen` (sequence, retries, scoring lock, XP
  panel untouched) laid out by grid areas under a full-width band of the result's colour; the numeral slams onto it on arrival with one
  word; rank and XP side by side; Continue (the menu's `.ph-start`) and Lobby in one row. "Unrated" and the end line are gone. Beat 2 is a
  scoreboard of 8 full-width rows (place, portrait, name, `SeatPower` with the Ancient, rune discs, `StoredTeam`, then a crown, "R9" or
  health). Its boards mount one seat a frame (idle) after the journey lands, under a hidden layer, so the switch is transform / opacity
  only; their keyword FX use still frames unless the row is hovered (styles.css).
- Journey colours: `TERYS_GATE_BY_RESULT` (gold / green / red), three defs with one id; the warm reveal and the atmosphere now compare
  the def itself, not its id.
- Announcer: `placeEvent` maps a place to its pool (new events thirdPlace, fourthPlace, midPlace, seventhPlace, lastPlace; two more
  takes each for GameWon and SecondPlace). 29 lines in the default voice plus the same in lemon, underdweller and little-inu (116 clips,
  all levelled to -20 LUFS). Generation used about 3,450 characters. The solo end line no longer fires as the phase flips behind the
  doors: while `isPostGameHeld()` it is parked (`pendingEnd`) and spoken when the hold lets go; "Promoted!" follows it.
- The victory placement now reads gold, not green (the 2026-09-20 ruling), to match the journey's colours.

- The end-of-game crystal carries no word (owner: "Remove the enter text from the post game gate crystal"): `RankedGateOptions.word: false`.

- THE ORDER (owner: "show the ranked gain/loss ... have the bar "lock" and turn red or gold. Then show experience / account related
  gains after that, then Into the post game rows"): the rank plate is compact (crest beside the bar). `planRankSequence` now ends a
  set-up with a `gate` step carrying a `tone` (gold for `promotionUnlocked`, red for `demotionUnlocked`, which had no beat before);
  the timeline adds `lockClasses` to the bar, and `RankBar`'s `lock` prop draws the same once settled (track lit, fill tinted, a
  padlock; the post-game plate glows with it). `RankScreen.onSettled` tells the screen, the XP panel follows, and `AUTO_LOBBY_MS`
  (4.2 s) later the screen moves into the lobby once, unless the player already moved. Filmed with the rank fixtures injected (the
  bench is offline): the Account XP panel itself was not seen.

- TERYS GATE SAYS ITS NAME (owner: "Let the gate art parallax play longer, and have the text say "terys gate" at the top of it like
  our other location text does. Have the ranked progress and experience from the game all happen on top of that art"): the journey
  builds the reveal's words for a named place with no parchments (the name's sting, no announcer line), keeps the name (no lift-off),
  and rests `JOURNEY_REST` 3.0 s. The result beat stands on the same picture, sharp (`layer0`, a slow 40 s drift, decoded while the
  journey plays) with the name in the reveal's own place and lettering; the band sits lower to clear it. The Lobby fades both to the
  blurred ground.
- DEV: `EndGameTuner` (🏁 End Practice game) ends the current Practice game at a chosen place on the next fight.

- POLISH (owner: "an overall 5/10 experience ... continue should take the player back to main menu, lobby should take the player to
  the post-game lobby screen ... make the gate look and feel more exciting, add the announcer lines in too"; the gate = the Terys Gate
  arrival): the result no longer moves into the lobby by itself (buttons only); the Scene Builder ending speaks its place's line
  (`announceEndLine`, a sandbox run's queue stays off) and shows a late-game table; at the landing the portal flares, a soft ring rolls
  out, rays turn and motes rise in the place's colour (`buildArrival`, CSS one-shots), the rune ring gets a light per glyph, the camera
  keeps pushing as it rests, and an arrival swell plays with the name (`arrive-terys`, ElevenLabs, -9.3 LUFS, trimmed to 0.38).
- The cut parallax was tried three times and rejected ("utterly terrible"); Terys Gate stays one flat layer.

## Open

- Rewatch sits on the lobby beat although the 2026-09-20 rank screen had none (it was in the owner's picked layout).
- Beat 1 with a ranked result (rank bar, promotion) and the XP panel were not seen in a test: the test bench is offline (unrated).
- Not heard or seen by the owner yet; not profiled on a production build; phones (light version) not checked.
