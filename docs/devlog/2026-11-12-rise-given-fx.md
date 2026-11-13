# "On Rise given": the Rise givers send a beam (2026-11-12)

Owner: "i made a rise beam as well. should be wired in all the exact same ways as the ward beam and execute beam were
... any instance of more than one rise being applied at the same time should be staggered. this effect should work in
both shop and in combat."

## What plays now

- **A new card mechanic slot, `riseGiven`.** Mumi, Wolvie, Anubis and Gravewarden bind the owner's `rise-beam`.
  `givesRise` offers the slot to any card whose effect gives another minion Rise.
- **Combat.** The engine stamps the giving body on every Rise grant (`keyword` event, `source`), a forced Echo
  included (Spots and Echohorn name the Echo's owner, not themselves). An Echo's giver died earlier in the same beat, so
  its beams leave from its slot 400 ms after its skull, from the Ward path's two death call sites. A living giver
  (Gravewarden, a forced Echo) launches as the beat starts.
- **A cascade, never a volley.** Every launch path spaces its grants `RISE_GIVEN_GAP_MS` (180 ms) apart, and each
  receiver's Rise dome is held (`fx/riseHold.ts`) until its OWN beam lands. The launcher passes `index: 0` so the
  def's per-index stagger does not add to the gap.
- **The Shop.** A Rise given on a minion's own beat arrives as a `keywordChanged` with the giver, the path Execute
  added. The beam replaces the generic keyword flash. If the giver is no longer on screen the flash plays as before.
- **Anubis.** His board-wide grant is split over several beats by the engine's narration lines. The launcher remembers
  where a dead giver stood, so the later beats still launch from his slot.
- **A backstop.** If the replay's skull handling never launches an Echo's grants, they launch 1400 ms after the beat
  starts, so a Rise can never sit hidden for the full 3 s hold.
- **A rising body keeps its slot.** `settledSlotCenter` no longer treats a `dying rising` unit as leaving the row,
  so a beam aimed past a Mumi that is itself rising does not land half a slot off.

## Sounds

Generated with ElevenLabs sound generation, three takes each of a wisp, a wraith breath and a spectral chime. Picked by
envelope, not by ear: the wisp that peaks 150 ms in and is gone by 400 ms (the beam's travel is 380 ms), the wraith that
swells, the chime with the cleanest decay. Trimmed and levelled to sit with the Execute set: wisp -16.3 LUFS, wraith
-17.5, chime -19.7. The wisp plays as a beam leaves; the wraith and chime play together as it lands. A cascade rings
them on its first three beams only.

## Not covered

A Rise from a spell, a rune or a hero power has no giver minion and is unchanged. A Shop giver that has left the
screen falls back to the flash. The scheduled play needs a live renderer and is not under test.
