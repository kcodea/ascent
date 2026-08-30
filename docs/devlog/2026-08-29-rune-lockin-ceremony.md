# The Runeforge gets a lock-in ceremony

*2026-08-29*

Owner ask: *"an animation similar to the hero ceremony for when a player locks in a rune selection. i want the
runes to disappear, and the selected rune to move front and center, and 'lock in' then fade back to the normal
game board. a quick animation that simply tells the player that they locked in this choice. no additional
clicks needed, just a short ceremony animation."*

## Similar to the hero ceremony, and deliberately much shorter

It borrows the hero ceremony's *structure* — one timing object, no magic milliseconds distributed across the
component (`runeLockInTiming.ts`, shaped like `heroCeremonyTiming.ts`) — and almost none of its length.

That difference is the brief. The hero ceremony ends on a **Start Game** button: it is a threshold, you are
choosing who you will be for half an hour, and it may take its time. This one ends **on its own**, happens
mid-run, possibly several times a game, and its whole job is to say *"that one, yes, it's yours"* and get out
of the way. Anything a player would want to skip is too long — so it is **1.36s** end to end with nothing to
click.

The sequence: click → the unchosen runes sweep out, staggered → the chosen one flies to centre and grows →
it settles with a snap as a gold frame clamps shut on it and a flash bursts out → a beat → everything fades
back to the board.

## The gameplay resolves FIRST

The buy dispatches immediately and the ceremony plays over the top. That ordering is the one the rest of the
game uses and it is not negotiable here: a ceremony that had to finish before the rune was yours could **eat
the purchase** if it were interrupted — a reload, an error, a fast Esc. "The animation was cut off" is a
worse-looking bug and a far better one to have than "my rune vanished".

## Which forces the interesting constraint: it renders clones

Because the buy resolves first, `run.runeforgeOffer` clears and the forge overlay unmounts **on the same
frame**. There is nothing left on screen to animate.

So the ceremony captures every card's rect at click time — one read, never re-measured — and re-renders the
cards itself, pinned to those exact positions. The handover is invisible because the clones open exactly where
the originals were. From there the layer owns the whole sequence.

The clones are inert (`onBuy` is a no-op, the layer is `pointer-events: none`), which is what *"no additional
clicks needed"* has to mean in practice: not merely that you don't have to click, but that you **can't**.

The ceremony state lives in `Recruit` rather than inside the forge overlay for the same reason — anything
owned by that subtree would unmount with it.

## A bug the dev demo caught

The wrapper originally took its width and height from the captured rect. That made the *wrapper* the authority
on how big a card is, and the moment the two disagreed the card sat **off-centre inside a perfectly centred
box** — visible immediately in the demo, where the preview invents its own rects.

It shrink-wraps its card now, so the wrapper's box *is* the card's box by construction and the travel delta
lands the card's own centre on the screen's. Verified: card centre 944/661 against a screen centre of 944/660.

Worth keeping as a shape: a measurement that is *derived* twice will eventually disagree with itself. Better
to have one authority.

## Tuning it

Dev menu → 🔒 **Test Rune Lock-In** replays it with three real runes, no Runeforge wave required.
`window.__runeLockIn(8)` runs it at 8× so the beats can actually be judged — `stretchLockIn` scales every
value, so what you see slowly is the same choreography rather than a different one with different overlaps.

## Perf

Every motion is `transform` + `opacity`, and every one is **one-shot** — the ban in CLAUDE.md is on looping
paint animations. Rects are read once at the click and never again. The layer is portalled to `<body>`, above
the FX canvas, rather than fighting `.app`'s stacking context (`docs/performance.md` §4).

Reduced motion is the one place this diverges from the project rule that ASCENT does **not** gate animation on
`prefers-reduced-motion` — because that rule exists to protect motion carrying *gameplay information*, and
this ceremony carries none the board does not already show. The beats still land in the same order at the same
times; only the travel is removed.

---

## Follow-up: the caption goes, the gold clamp arrives

Two owner notes, the same evening.

**"remove the locked in text that shows up."** Gone. The beat it sat on stays, because the words were never
the thing doing the work: the card arriving hard, after an overshoot, is what says *that is decided*. The
caption was narrating something the motion already said.

**"a rectangle gold glow that closes in quickly on the rune and then a flash emits from the [rune]."** A gold
frame closes from well outside the card down onto it, and a burst fires the instant it lands.

Three decisions in that, each of which was wrong first:

1. **The clamp LANDS on the lock beat; it does not start there.** The first version gated it on the `locked`
   phase, so the card snapped and *then* a frame appeared — two events. It is armed on `focus` and delayed by
   `lockAtMs − clampMs − focusDelayMs`, so the frame slamming shut and the card's snap are the same instant.
   That coincidence is the whole effect.
2. **The flash is sized in `vmin`, not percentages.** Percentage width *and height* both resolve against the
   containing block's **width**, so a card-relative burst came out barely wider than the card it was meant to
   burst out of — it read as a glow behind the art rather than light leaving the rune.
3. **It blends `screen`.** Painted normally it sat over the card as a warm haze: technically on top, reading
   as a filter. Screen only ever brightens what is beneath, which is what a flash actually does to the thing
   it comes from.

Both effects live **inside the chosen card's wrapper**, so they inherit its travel and scale for free — no
second set of coordinates to keep in step, and the frame cannot arrive anywhere but exactly on the rune.

The glow is a **static** box-shadow on an element whose transform and opacity animate — the `kwglow` pattern.
A shrinking shadow would repaint every frame of the close for no gain.

