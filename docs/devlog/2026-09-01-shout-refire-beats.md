# 2026-09-01 — a re-fired Shout is a counted event, and each fire is a beat

## The report

Owner's board: Cinderchef (Rally) · Dawnclaw (Echo: trigger an adjacent Shout) · gilded Wardkeeper · gilded
Drakko (Shouts trigger three times) · Hawkus (a Rally triggers your left-most Echo). *"Not enough triggers went
off"* on Cinderchef's first swing.

The engine was right: Hawkus forces Dawnclaw's Echo, which fires Wardkeeper's Shout, and Drakko's gild makes
that three fires (+6 Spell Power; the fight carried +12 back with Dawnclaw's real death). The replay showed
one, for three stacked reasons:

- each fire was an `sc` NARRATION line, and narration is absorbed silently into the swing's wind-up;
- the watcher pulse is a set of units, so Dawnclaw and Wardkeeper pulsed once each however many fires;
- the three "+2/+0 Spell Power" floats fired at the same instant on the same pixel.

And the Procs tab tallied every narration line under "Start of Combat" — "Dawnclaw — 3×", wrong twice over.

## The pattern already in the game

A Rally proc is COUNTED at the signal: the engine logs one `rally` event per proc inside the repeat loop,
`ralliesFiredIn` groups them per rallier→ally pair, the wind-up stretches by one `RALLY_PROC_STRIDE_MS` per
extra proc, and the `rallyFx` cascade plays one pulse→sparkle per proc. Option 1 of the three the owner was
offered: apply exactly that to Shout re-fires.

## What changed

**Engine.** A new `CombatEvent`, `{ type: 'shout', source, target }`, and one chokepoint, `fireShout`, that
logs it, runs the Battlecry's combat effect and emits `battlecryTriggered` — the same three parts every
re-trigger site did by hand. Dawnclaw / Ryme, Thunderous Sovereign, Chorus Drake and the arena's `replayShout`
(Embercrest & co.) all route through it; their "X triggers Y's Battlecry" narration lines are GONE, replaced
by the event (the shared arena body no longer narrates either — the shop's narrate was already a no-op). The
parting cry (`sc` with `cast: true`) is untouched: a self re-fire on death, presented as a cast.

**Compiler.** `shout` is NOT absorbed into the wind-up. A `shout` opens its own moment and collapses the
consequences behind it — the same set a swing absorbs (a buff wave, a Ruby, a card to hand, its "+2/+0 Spell
Power" narration) — until the next fire, action or result. So a Drakko-repeated Shout is one moment PER FIRE:
its own frame commit, its own number roll, its own beat of screen time, on the swing path and the death path
alike. Mirrored in `buildBeats`, the equivalence oracle. `shout: 'sc'` for pacing (720 ms — enough for the
650 ms roll), `'reaction'` for the timing family; scored like a buff wave plus `shoutFx`.

**The swing parks.** `shoutsAheadOf` asks whether a fire sits between the exchange and the attacker's own
strike; if so the swing PARKS at the top of its wind-up — the Echohorn hold, `holdAfterWindup` — and the
fires play as their own beats while it holds the pose. The strike resumes on the attacker's own damage beat
through the existing `heldLungeRef` release (struck / died / target gone), untouched.

**Per fire.** `shoutFx` (a cue on every kind, scanning `shout` events) pulses the re-triggering unit with the
reaction medallion and blooms the Shout's owner, and plays a def bound at the re-trigger card's `shout` kind
at the pair's anchors. The fire's consequences are its moment's own events and play through the ordinary
channels — buff tendrils, the stat roll, the Spell Power float. The Combat Log names each fire; the Procs tab
has a Shout section.

### The version that was rejected first

The first cut absorbed the fires into the wind-up and paced them as cues on the Rally cascade, stretching the
wind-up one stride per fire. The owner, watching it live: *"resolve shouts immediately instead of in
chunks/sequences, and without numbers going up, everything just stands still."* Right on both counts — a cue
inside one beat can stagger pulses and floats, but the beat's frame commits every effect at once, so the
stats landed together and the attacker stood frozen through the stretched pause. Chunks with numbers rolling
per fire need one MOMENT per fire, which is the version above.

### …and the parked strike had to land like a swing

Watching the park model live, the owner: *"the subsequent attack after triggering doesn't have time to land a
normal lunge attack … they attack immediately / resolve their attack extremely fast."* The park's RELEASE was
the Echohorn one: the clock advanced into the attacker's damage beat on a timer (the 260 ms stillness), and
the layout effect resumed the strike as that beat became current — so the frame committed the damage and the
health while the attacker was still travelling. A normal swing never does that: its lunge's contact IS the
advance.

Now the beat clock resumes the parked timeline itself, after the stillness, and the lunge's contact fires
`onParkedContact` — bound at resume time to the advance into the damage beat. The numbers land on the hit. A
fallback timer (`PARKED_RESUME_FALLBACK_MS`) advances anyway if a gutted timeline never reaches contact, so a
park cannot stall the fight; the layout-effect release only clears the park for a strike the clock already
resumed. This closes the "Known, not fixed" note in `2026-09-01-swing-consequences-and-beats.md` for
Echohorn too — same path.

## Lanes

- `core/combat/shoutFired.test.ts` — the owner's board: three `shout` events on the first swing, three more on
  Dawnclaw's death, +12 carried back; plain Drakko two, none one; no Shout neighbour → no event; the old
  narration line is gone.
- `ui/choreo/channels/shoutFired.test.ts` — the scan (pairs, count), the compiler's one-moment-per-fire with
  each fire owning its consequences (and the oracle agreeing), the death path, the hold covering the roll,
  `shoutsAheadOf` (park / no fire / fire after the strike / cancelled swing), and source pins: the replay asks
  it where it decides to park, the clock owns the resume, and contact — not a timer — advances into the
  damage beat.
- Existing pins that counted the narration lines (Ryme, Sovereign, the Echohorn→Dawnclaw→Drakko→Sylus chain,
  the Embercrest × Drakko matrix row, the live mid-combat trigger beats) now count `shout` events — same
  numbers, honest source. The mid-combat trigger lane now expects Deepvein's Ruby Power narration and the
  Excavator's Rubies INSIDE their fires' moments.

## Not done

The per-fire visual is the stock pair (watcher pulse + frame bloom + float); nothing is authored at the `shout`
kind yet. The binding slot exists — a Dawnclaw or Ryme def would play per fire at the pair's anchors.
