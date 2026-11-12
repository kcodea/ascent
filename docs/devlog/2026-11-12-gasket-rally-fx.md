# Gasket's Rally: effect on Gasket, board-wide burst, sound (2026-11-12)

Owner: "its the effect on gasket himself, bind it to on rally", then "i added a gasket-burst effect that i want to go
off right after the rally effect".

## What plays now

1. Gasket rears back and the Rally medallion pulses. The `gasket` def (now anchored to Source) plays on him, with its
   sound as a second def (`sfx-gasket-rally`, bound through `also`).
2. He holds the wind-up 210 ms longer (`holdMs` on the `rally` binding), so the damage pass lands on the sizzle that
   sits 650 ms into the sound clip.
3. Each damage pass plays `gasket-burst` ONCE (camera-anchored, board-wide), then stays 200 ms (`settleMs`) before
   the next beat: a reaction, the second pass of a Gilded Gasket, or his own strike.

The old binding (the `gasket` def fanned out on every struck unit) is gone, so victims show the stock hit burst.

## New binding vocabulary

- `fanOut: 'pass'`: once per wave pass on the source, never on the card's own melee strike (a `damage` moment with no
  `wave`). Claims no stock hit burst.
- `holdMs` (a `rally` binding): extra wind-up hold after the medallion pulse. Rides `windupSettleMs`.
- `settleMs` (a `pass` binding): extra time the pass stays on screen after its damage (`passSettleMs`, read by the
  beat clock in `useCombatReplay`).
- The own-Rally play and the `pass` play both honour `also`.

## Known limits

- The damage and sizzle line up at 1x. The hold scales with combat speed and the sound does not.
- The sound plays once per swing; a Gilded Gasket's second pass has the burst but no second sizzle.
- Deaths from a pass resolve inside the pass's own beat, so `settleMs` does not delay them.

## The sound

Generated with ElevenLabs sound effects (drafts in the gitignored `vo-drafts/gasket/`) and mixed with ffmpeg: a thump
and a gurgle stacked for the belch, a gas rollout at 300 ms, three sizzles from 650 ms. Rule: R-FX-WAVE-WINDUP-01
(amended).
