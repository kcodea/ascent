# 2026-10-13 — The ranked gate waits on a crystal: it forms, pulses, and the press that shatters it opens the gate

**Owner asks (with the crystal art and a mock of it on the gate's centre diamond):**

> "the sliding gate screen is perfect, but i want to attempt to make it even better. 1. can you amplify the blue
> particles by 200%? i want that to be a major part of the sparks that emit. secondly. i want to add some more logic
> to how that screen works. once the gate closes with the slam. i want it to sit in that position as the center gold
> diamond forms the blue crystal ... then i want the crystal to be steadily pulsing until the player clicks it with
> their mouse. upon clicking it, i want the crystal to shatter, which then triggers the gate to slide open, revealing
> the character select screen"

Then, with a recording: "here is the sound for the crystal shattering. this should happen right when the crystal is
clicked".

## What changed

The gate was one clock (close, slam, a fixed 1 s hold, shudder, open). It is now TWO clocks with the player's hand
between them (`rankedGateTiming.ts`):

| Clock | At | What |
| --- | --- | --- |
| From "Yes" | 0 ms | The doors grind in. `gateclose`. |
| | 1500 ms | Slam: `gateslam`, recoil, flash, sparks, dust, blue embers. |
| | 1720 ms | Behind the shut doors, `startLobby` (the swap to hero select). |
| | 2150 ms | The centre diamond starts to form the crystal: blue motes spiral into it, a glow swells. |
| | 3250 ms | ARMED: the crystal is whole, pulsing, shedding embers, and takes focus. |
| ... | | The gate sits shut for as long as the player likes. |
| From the press | 0 ms | Shatter: `gateshatter`, shards, flash, a ring of embers. The doors shudder (`gaterattle`). |
| | 400 ms | `gateopen` starts. |
| | 700 ms | The doors crack apart, catch, haul open. |
| | 2200 ms | Clear. The gate unmounts. |

- **The crystal** is a real `<button>` inside the doors' body (so it shakes with them), there from forming until
  it has shattered. It acts on pointer DOWN (left button) like "Yes, let's go."; `onClick` is the keyboard's path
  and the armed crystal takes focus, so Enter or Space opens the gate. Only the armed crystal can be pressed.
- **Its place** is fixed in the gate ART's pixels (`RANKED_GATE_ART`: centre row 430.5 of 941, 236 px square, read
  off the art and checked against the owner's mock in a real render). The stylesheet scales that by the doors' own
  `cover` scale (`.rgate-doors` is a size container; `--rg-u` is one art pixel in screen px), and
  `rankedGateCrystalAt` gives the FX layer the same point. So it stays on the diamond at any window shape,
  ultrawide included.
- **Blue embers x3** at the slam (70 -> 210 before `FX_AMOUNT`, so 84 -> 252), and three new effects in
  `gateFx.ts`: `gather` (forming), `ambient` (a dozen embers a second off the waiting crystal) and `shatter`
  (56 shards, a flash, 144 embers thrown in a ring that then float up).
- **Sound:** `gateshatter.mp3` is the owner's recording, played on the press and started 24 ms in (the file opens
  on 26 ms of silence). The crystal FORMING has no recording: the `gateform` fader plays the existing gem-apply
  chime as a stand-in (`GATE_CLIP` in sfx.ts).
- Reduced motion still skips the gate, so there is no crystal to press: the swap happens at once.

## Judgement calls to confirm with the owner

- "Amplify by 200%" was read as three times as many (plus 200%), not twice.
- The doors still SHUDDER (with the rattle) as the crystal shatters, then open 0.7 s after the press. The ask was
  "shatter, which then triggers the gate to slide open"; the shudder was kept as the gate's reaction to it.
- The gate waits forever. There is no timeout and no skip: the crystal is the only way through.
- The ambient trickle of embers off the waiting crystal was not asked for.
- The forming sound is a stand-in.
- The crystal art is 232 px square, shown at about 280 px on a 1080p screen (more on larger ones), so it is
  slightly soft. A larger source would sharpen it.

## Verified

- `rankedGate.test.tsx` (25 tests): both clocks, the crystal's place at 16:9 and ultrawide, the exactly-once seam,
  and the real component on fake timers: forming is not pressable, the armed gate does not move in ten minutes,
  only a left press or the keyboard opens it, the release after a press is not a second press, and nothing is
  left mounted. Plus the shipped files, faders, and the compositor-only CSS tripwire (16 keyframes).
- In a real render (the gate branch's dev server, 1600x900): the armed crystal sits centred on the emblem's
  diamond, covering the gold diamond inside the steel recess, as in the owner's mock.
- **Not watched or heard:** the forming, the pulse, the shatter and every particle effect. The preview pane does
  not run animation frames. They are the owner's to judge on the dev server.
