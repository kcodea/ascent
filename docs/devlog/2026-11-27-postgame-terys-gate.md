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

## Open

- The crystal still shows the painted "ENTER" word at the end of a game: a different word needs owner lettering.
- The post-game screen shows the same results as before, over the new place; a redesign of its content is the owner's call.
- Not heard or seen by the owner yet; not profiled on a production build; phones (light version) not checked.
