# The Taunt beam (2026-11-13)

Owner: "now im making a taunt beam".

- **Taunt joins the generic keyword launcher** (`fx/keywordBeam.ts`, `KEYWORD_BEAMS.T` -> `taunt-beam`). Every origin
  the other keywords have comes with it: pointer, hero portrait, hero power slot, rune slot, Start of Turn source,
  either side in combat.
- **The held frame.** Taunt's look is the whole shield frame, read in six places in `Card.tsx`. They now read one
  value, `tauntShown` (has Taunt and is not held, `fx/tauntHold.ts`), so the ordinary frame stays until the beam lands.
- **Marked Target.** The banked spell gives Taunt to the FOE's rightmost minion; the beam leaves the caster's cast card
  and crosses the board. Pinned on a real simulated fight.
- **Not a travel:** a body that arrives with Taunt (a summon, a Discover that grants it, Summoning Bulwark on a new
  body). No minion gives another minion Taunt, so there is no "On Taunt given" binding kind.
- **Sounds (owner: "i just need a woosh sound. i already have the taunt sound for when the taunt is applied").** A
  whoosh as the beam leaves: the owner's own `deeptauntwoosh.mp3`, cut to start at its rise (1.05 s in) and faded out from 1.65 s to
  2.2 s (owner: "its a bit much, can we have it fade earlier?"), -18.4 LUFS at gain 1 (the Crit level). The existing `sfx.taunt()` rings as the
  beam lands. `store.ts` rang it at the grant, a beat early; it now skips that when a beam is on the way.
- **Timing pass (owner: "the card is switching over to the taunt frame a bit late", "JUST a bit earlier").** Two
  causes. The shield frame image was only requested when the hold lifted, so its fetch and decode started AT the
  landing: `Card.tsx` now warms it while the beam flies. And the look landed exactly on the tip's arrival (380 ms):
  `KEYWORD_LAND_LEAD_MS.T` lands the frame and the Taunt sound 90 ms before it. The whoosh is back at level 1, recut
  shorter (starts 1.22 s into the original, 0.78 s long).
- The Taunt sound leads the frame by 170 ms (100, then a further 70 on the owner's ask) (`TAUNT_SOUND_LEAD_MS`; owner: "can we have the taunt deploy sound come in
  100 ms earlier"): at 1x it rings 120 ms after launch, the frame appears at 290 ms.
- **Shop offers (owner: "i can bulwark a minion in shop, it should get the same effect").** The mid-turn board read
  only watched the warband. It now reads `keywordBeamUnits(run.board, run.shop)`: an offer's keywords are its card's own
  plus `ShopCard.keywords`. Every keyword beam gains this, not only Taunt. Pinned on a real Bulwark cast on an offer.
- The owner re-saved `taunt-beam` at a 140 ms flight. The 90 ms frame lead then put the frame 50 ms after launch
  (owner: "the taunt frame is now switching too early"), so the lead is 30 ms: the frame appears at 110 ms.
- Final: the frame appears at a FIXED 160 ms after launch (`KEYWORD_LAND_AT_MS.T`; owner: "have the frame switch
  (appear) at 160 ms"), replacing the lead-before-arrival number, so re-saving the beam no longer moves it.
- Then 190 ms (owner: "delay the frame another 30ms").
