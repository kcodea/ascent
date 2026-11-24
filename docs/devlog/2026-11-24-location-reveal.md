# 2026-11-24: The location reveal, and locations in Practice

Owner design 2026-11-23/24, built from the approved prototype. Rules R-LOCATION-01, R-LOCATION-02. A location IS a set
(`SetDef.location`): Set 2 is The Outskirts, Set 3 The Underbelly. Nothing about the engine or the live switch changed.

## The pieces (`packages/ui/src/locationReveal/`)

- `revealTimeline.ts`: the whole sequence as pure functions of time. The picture, the words and the sound all read it, so
  they cannot drift. Wall time leans for an instant on the landing and never stops (the owner rejected every freeze).
- `revealGl.ts` + `revealShaders.ts`: one WebGL 2 canvas that draws any moment from the time alone. Built while the gate is
  shut, one small step a frame (all shaders handed over at once, one picture decoded off-thread a frame, every stage drawn
  once unseen). A machine that cannot draw it gets the light version.
- `revealPlayer.ts`: the DOM and the rAF loop. The full version IS the picture from the press (it starts exactly on the
  gate's own doors and crystal, same `cover` fit). The light version (phones) sits behind the gate's own opening doors.
- `heroArrive.ts`: the canvas is transparent behind the leaving wave, so hero select, mounted all along behind it, is washed
  in; each piece rises when the wave reaches it (WAAPI on `translate` / `scale` / `opacity`, measured once).
- `revealSound.ts`: every cue laid on the audio clock at the press, on the `ui` bus; the line on the Announcer channel.

## The gate

`RankedGateOptions.reveal` (location asked once the doors are shut, request on the break). With no reveal, or a null answer,
the gate is exactly what it was. Practice now requests the gate itself (`startPracticeThroughGate`). A reveal that throws or
rejects opens the gate: it was possible to strand a player at the crystal in an early build, and a test now pins it.

## 21:9

The owner's paintings are 21:9 (6336 x 2688), so the stage is one whole painting: 21:9 shows all of it, 16:9 its full height
around `focus` (`slideFor`, never past an edge). The gate's doors keep their own 16:9 `cover` fit inside that stage
(`gateHeight / stageHeight`), so the first frame lands exactly on the gate's. The canvas draws the window's own rows, up to
1440; a machine whose heavy frame takes over 9 ms steps down to 900, and over 26 ms gets the light version.

## Art

`apps/web/public/locations/<id>/`. The paintings are the owner's upscaled 21:9 ones. The four parallax layers are cut from them
(`.claude/location-reveal-prototype/layers11.py` in the primary checkout, untracked) and wait for the owner's own layers.
Sounds: ElevenLabs, except the gate's own cues.
