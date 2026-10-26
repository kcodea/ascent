# 2026-10-25 — The return trip's cold start: a picture mask and undrawn layers

**Owner report:** "we are still getting reports of the images glitching and not loading straight away for the return to
shop animation. i need a deep dive on this issue." The 2026-10-23 fix (decode the door cut-out in script, use it only
once decoded, R-PRESENT-36) had not held.

**Method (reusable).** A harness page (the game's real `styles.css` and the vista's exact markup over a RED page, the
art preloaded as Recruit does, the trip played twice with the game's timings) recorded by Chrome's own screencast over
the DevTools protocol, every presented frame, in real Chrome on the GPU (an off-screen window with occlusion and
background throttling off) and headless. Scored per trip: red share (scene not drawn), when the scene first shows, and
each cold-trip frame against the warm trip's frame at the same offset.

**What it showed.**
- The hold's first frame on a session's first trip: 79% red. The door cut-out was a 2560 x 1440 picture used as a CSS
  mask; until the COMPOSITOR has decoded it, a mask hides all it applies to. A gradient mask or an SVG clip-path: clean.
- Cold, the scene first showed at 153 to 175 ms (warm: ~50 ms): the five layers are 14.1 MB decoded each, drawn and
  decoded only when first shown. The dive started a frame late. `img.decode()` in script does not help (different
  cache); `<img decoding="sync">` layers did not help either. Drawing the scene once out of sight did, but a warm-up at
  load had decayed 60 s later.

**The fix.** The door is a vector clip (`vistaDoor.ts`, traced from the owner's own door drawing, 44 points); the
cut-out picture is deleted (and its phone copy); the doorway darkening uses the painted interior's own picture with a
static `filter: brightness(0)` instead of a picture mask. As a fight's replay ends (End Combat opens only then), the
trip's hold and dive play once unseen (`.wipevista.warming`: z -1 behind the game, 1%); the vista's animation
handlers only move the machine on a real trip (`vistaDrivesMachine`). Measured after 60 s cold: scene at 44 to 57 ms,
no missing frames, frame-for-frame with a warm trip, even with End Combat pressed 0.2 s after it opens.

**Not covered:** the falling gate (one 2455 x 1381 picture) is not warmed and was not measured.
