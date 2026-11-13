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

## Runic Beetle (2026-11-13)

Owner: "runic beetle should case the rise effect when selecting the rise option of his choose 1". The Rise option is a
targeted Shout (`battlecryGrantKeyword`), and the Shop already emits its grant as a `keywordChanged` on Beetle's own
beat, so binding `beetle` was enough to reach the launcher. Two changes: `givesRise` now reads Choose One options,
and the Shop launcher waits 120 ms for a giver that is not mounted yet (Beetle lands on the board in the same action
that gives the Rise) before launching. A giver that never appears shows the Rise with its landing sound.

**The first Beetle wiring played nothing** (owner: "No beam played"). The `keywordChanged` cue only runs for the End
of Turn timeline. A mid-turn action is resolved with plain `reduce` in production (the batch exists only in DEV, for
the Beat Lab), so no batch-driven cue can serve a mid-turn play. The fix reads the grant off the board
(`playedRiseGrants`): a minion that gains Rise in the action that lands a Rise-giving minion. My earlier probe showed
the batch and I took it as proof the cue would fire; it only proved the engine emits it.

## Sounds

Generated with ElevenLabs sound generation, three takes each of a wisp, a wraith breath and a spectral chime. Picked by
envelope, not by ear: the wisp that peaks 150 ms in and is gone by 400 ms (the beam's travel is 380 ms), the wraith that
swells, the chime with the cleanest decay. Trimmed and levelled to sit with the Execute set: wisp -16.3 LUFS, wraith
-17.5, chime -19.7. The wisp plays as a beam leaves; the wraith and chime play together as it lands. A cascade rings
them on its first three beams only.

## The landing chime replaced (2026-11-13)

Owner: "i dont like how high pitched it is", then "lets try low bell 2 and deep thrum 1. make sure they are a bit lower
than the other effects". The chime is gone; the landing is now the wraith with a low bell and a deep thrum under it.
Both new clips are levelled to -18.4 LUFS and play at 0.6 (about -4.5 dB, near -23), below the wraith (-17.5) and the
wisp (-16.3).

## Beams from spells, the hero power and runes (2026-11-13)

Owner: a spell that gives Rise, Execute or Ward sends the beam from the pointer when it is aimed and from the hero
portrait when it is not; Lord of the Risen sends it from the hero power slot; a rune sends it from its own slot.

- **Who gave it, mid-turn.** With no batch to ask, the store notes every action before it resolves
  (`noteShopActionOrigin` in `dispatch`: a hero power, an aimed spell, an unaimed spell, or nothing). The Shop reads a
  minion that gained the keyword off the board and pairs it with that note. Every action overwrites the note.
- **One launcher for all three keywords** (`fx/keywordBeam.ts`): `rise-beam`, `execute-beam`, `lastlight-beam`, each
  with its own hold and sounds, following its receiver. Ward's blast (`ward-gain-blast`) now waits for the landing.
- **End of Turn.** The `keywordChanged` presenter hands the cue a non-minion beat's source; a rune beat launches from
  `runeSlotPoint`, a hero beat from the hero power button.
- **Combat runes** (`fx/runeKeywordBeams.ts`). The engine logs a rune's fire as a `questTrigger` and its grant with no
  giving minion. A beat with one player rune fire gives its sourceless grants to that rune; Rising Graves gives one Rise
  per beat and fires once, so the fire carries into a directly following beat that holds only such grants.
- **Beetle's buff tendril is gone** on the minion its Rise beam travels to (`riseBeamOwnedRef`, the same per-action
  claim the Ale trail uses).
- **Not covered:** a rune that gives a keyword mid-turn in the Shop or at Start of Turn, and the foe's runes.

## Not covered

A Rise from a spell, a rune or a hero power has no giver minion and is unchanged. The scheduled play needs a live renderer and is not under test.
