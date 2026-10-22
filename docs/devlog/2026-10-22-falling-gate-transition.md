# The shop <-> combat transition becomes a falling wooden gate (2026-10-21 / 22)

**Why:** after the curtain moved above every in-game layer (z3000, R-PRESENT-17), the owner still saw "random flashes
of various elements over the transition curtain ... milisecond flashes". Remaining suspect: the curtain itself. It
bloomed out of the End Turn gem by animating `clip-path`, a shape recomputed every frame, and on the heavy End Turn frame
a frame of it could come out wrong or not be drawn. A throwaway test swapped in the ranked gate (doors that only slide,
`transform`) and the owner saw "not a single issue". So the fix was the MOTION, not the art: the owner's question "if i
provided PNG's instead, would that improve anything?" was half right (PNG doors were not the cause; transform-only
motion was).

**Iterations the owner tried and dropped (all on the branch, none shipped):** the ranked gate itself, a sliding vortex
panel, a Pixi displacement "smoke" warp on it, a stone gate with the opponent carved in, a branded-on-impact burn. Kept:
a falling gate.

**What shipped (R-PRESENT-35):**
- `.wipecurtain` is one full-screen layer of the owner's wood gate art (`transition-gate.webp`, 2560x1440 source trimmed
  to its edges, see-through gaps backed in dark wood). It moves by `transform` only: parked above, falls (accelerating),
  slams (`wipeslam`: a 3.4% rebound and smaller jolts), holds, then is cranked up (`wipecrank`: four jerky pulls, swaying
  from its top). The state machine is unchanged (`wipeMachine.ts`), plus a `parked` class on `combat` so a run resumed
  mid-fight never plays the crank. The crank ends on `animationend` (`onWipeAnimEnd`), the fall on `transitionend`.
- A hidden FOOT (`::after`, its bottom beam mirrored) sits below the gate while it falls and holds, so the landing bounce
  never opens a gap at the floor while the scene swaps behind it.
- THE POSTER (`.wipeposter`, `transition-poster.webp`): its own layer, sized and placed by the gate's cover-fit height so
  it stays between the straps on any aspect ratio, hanging from its top-centre nail (`transform-origin` measured off the
  art). It swings on the slam (`posterslam`) and the crank (`postercrank`); NOW FACING / RETURNING TO SHOP ride on it,
  tilted -3.3 degrees to match the paper. Text is white with a 2px black outline.
- Landing dust: `gateFx.land()` (new), the ranked gate's particle layer, lifted over the curtain while it is up.
- Holds: 2.4 s into combat, 2.0 s back (`WIPE_DEFAULTS`). The wipe FX bloom/inhale and the ring/bar fronts are retired.
- SOUNDS (`sfx.wipeGate`, `WIPE_GATE_LAYERS`): drop whoosh; four thuds + a page-turn flap layered on impact (lead-in
  silences skipped so they land on the frame); crank, gears, metal groan and the ranked gate's grind (its own fader,
  `wipegateopen`) layered on the crank, each cut at 1.5 s with a 0.2 s fade and a 40% reverb (1.2 s tail, pre-built).
  Every clip has its own desk fader; the levels in `config.ts` are the owner's by-ear mix.

**Art to re-measure when it changes:** the poster's nail (48.4%, 9.8%), its tilt (-3.3 deg), its place on the gate (49%
of the gate's height, middle 48.4% down) and the gate art's aspect (1.7777) are all measured off the current files.
