# 2026-10-12 — The ranked gate: doors slam shut on "Yes" and open on hero select

**Owner ask:** "once the player hits the 'yes continue' button, i want an animation equipped with sound effects and
everything. where two gates slide in with a grinding motion and sound and slam shut with smoke and sparks that emit
from the impact. and then after a brief 1 second delay, they shudder and open again to reveal the hero select
screen".

The owner supplied the art (a stone, brass and steel gate, generated from a prompt written in this session) and the
four sounds (recorded in Cubase).

## The sequence

Fitted to the owner's four clips, whose loud parts were measured before any timing was chosen:

| At | What |
| --- | --- |
| 0 ms | The confirmation leaves. The doors start in from the sides: three heavy lurches, then the last runs away into the slam. `gateclose` plays (its grind is steady for ~1.5 s). |
| 1500 ms | **Slam.** `gateslam` (the hit is at the clip's start). The pair recoils, the seam flashes, sparks spray off the whole seam and fall, dust rolls off the seam and the floor. |
| 1720 ms | Behind the shut doors, `startLobby` runs: the ranked entry is committed and the mode picker is swapped for hero select. |
| 2500 ms | **Shudder**, one second after the slam. `gaterattle`. Dust shakes loose from the top, a few sparks spit from the seam. |
| 2900 ms | `gateopen` starts (its clunk sits ~0.4 s in, so it lands as the doors part). |
| 3200 ms | The doors crack apart, catch, then haul open. |
| 4700 ms | Clear of the screen. The gate unmounts. |

## How it is built

- **`packages/ui/src/rankedGate/`**:
  - `rankedGateTiming.ts`: the clock, pure. One timing object, `rankedGateTimeline`, and the `--rg-*` durations
    the stylesheet reads. Tune the feel here.
  - `rankedGateController.ts`: the seam. The gate must outlive the Title (the swap happens behind the shut doors
    and unmounts the Title), so the Title only calls `requestRankedGate(startLobby)`. `onShut` runs EXACTLY ONCE
    whatever happens: no gate mounted, a gate that throws, a second press, reduced motion.
  - `RankedGate.tsx`: mounted in Game above every screen (z 700). Plain timers set once per sequence; it renders
    nothing between gates and takes every pointer event while it plays.
  - `rankedGate.css`: the motion, `transform` + `opacity` only. A door's travel and its grind vibration sit on two
    nested elements so they never share one transform. The pair shakes as one body, so the seam stays shut.
  - `gateFx.ts`: the smoke and sparks, a small Pixi layer of its own (the `wipeFx.ts` pattern), ticking only while
    a burst is alive. Fed the seam's screen position, measured once at the slam.
- **Art:** the owner's 1672x941 gate, cut at its seam (column 836, found by scanning for the darkest centre
  column) into `apps/web/public/frames/ranked-gate-left.webp` / `-right.webp`. Each half is `cover`ed and anchored
  on its seam side, so the doors meet exactly at any window shape.
- **Sound:** `audio/gateclose.mp3`, `gateslam.mp3`, `gaterattle.mp3`, `gateopen.mp3`, each on a fader of the same
  name (ui bus, 0.6), played by `sfx.gate(cue)`.
- **Warm-up:** opening the confirmation decodes the two door images and the four cues and starts the FX layer, so
  the first gate of a session has its art, sound and sparks.
- **Reduced motion:** no gate. The swap happens at once.

## Then: a hit on the press

**Owner ask, same day:** "can we add this sound when the player clicks 'yes continue'?" (a 7.2 s cinematic hit:
the impact is at the very start, then a long tail).

`audio/gateintro.mp3`, its own fader (`gateintro`, ui bus, 0.6), played as `sfx.gate('intro')` from the Title's
`confirmRanked`, on the press itself. It is NOT one of the gate's timed cues: it plays on every "Yes", including
when reduced motion skips the gate. Its tail runs under the grind and the slam. Warmed with the other cues when the
confirmation opens.

**Then, after hearing it:** "there seems to be a slight delay before i hear the sound. is it possible to have it
play any sooner? and can we up the volume of it by about 20%". Two delays were found and removed:

- The button acted on `click`, which only fires when the mouse button comes back UP (typically 80 to 150 ms after
  it goes down). "Yes, let's go." now acts on pointer DOWN (left button), keeping `onClick` for the keyboard; the
  `open` guard makes the release a no-op.
- The file opens on 49 ms of dead silence before the hit (measured in 10 ms windows). `sfx.gate('intro')` now
  starts 45 ms in (`GATE_INTRO_SLICE`), with no re-encode.

Volume: the `gateintro` fader 0.6 -> 0.72.

## Then: blue embers, and 20% more of everything

**Owner asks, after seeing it:** "can we add some blue particles that float upward like sparks from a fire when
the doors close shut? and can we amp up the overall effects by about 20%", then: "not including the motion of the
gates itself".

- **Blue embers** (`gateFx.ember`): at the slam, 84 small additive blue glows lift off the seam (more from its
  lower half) and off the floor either side of it, over the first half second. Each gets a small sideways kick,
  then floats up at 70 to 260 px/s, swaying wider and flickering as it fades over 1.3 to 3 s. The last of them are
  still rising as the doors open.
- **+20%:** one dial, `FX_AMOUNT = 1.2` in gateFx.ts. Every particle count is multiplied by it (slam sparks
  170 -> 204, seam dust 38 -> 46, floor dust 26 -> 31, shudder dust 22 -> 26, shudder sparks 30 -> 36) and the seam
  flash is 20% bigger. The doors' travel, recoil and shudder (rankedGate.css) are unchanged, as asked.

## Judgement calls to confirm with the owner

- **Length: 4.7 s**, every time a ranked lobby starts, and it cannot be skipped. That is longer than the "about 3
  seconds" first quoted: the clips are 2.3 to 2.9 s each and the sequence was fitted to them. Shortening is a
  change to `RANKED_GATE_TIMING`.
- The doors come in from the left and right.
- Dust is still drifting for a moment as the doors open. It is left to fade rather than cut off.

## Verified

- `rankedGate.test.tsx` (19 tests): the clock's order and the 1 second hold; the seam's exactly-once contract; the
  real component on fake timers (each phase, each cue in order, the FX call with the measured seam, the swap after
  the slam and before the doors part, nothing left mounted); reduced motion; the shipped files and faders; a CSS
  tripwire (compositor-only keyframes, no viewport units, no bare cursor).
- In a real render of this branch's production build: the shut gate fills the screen with the two halves meeting
  on the seam; half-closed doors sit over the mode picker with their edge shadow; and the live sequence ran on the
  expected clock (closing 0, shut 1517, shudder 2508, opening 3214, gone 4707 ms) with the mode picker swapped for
  hero select while shut, ending on hero select with the ranked entry stored.
- **Not watched or heard:** the preview pane runs hidden, so no animation frame was seen in motion, the particles
  were only seen frozen, and no sound was heard. The feel (the lurches, the recoil, the spark and dust amounts, the
  cue timing against the picture) needs the owner's eyes and ears.
- `audio/master.test.ts` and `audioDefaultMix.test.ts` time out on this machine with and without this change
  (checked by reverting the sound files); CI is the gate for those.
