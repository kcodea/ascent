# The round rail's collapse chevron is gone

**Owner report (2026-08-30):** *"the replay rail extension arrow dances around when you try and click it.
remove that functionality."*

## Why it danced

The chevron toggled the metrics dock (Gold / Acts / Tier per round) beside the replay round rail. It was
anchored to the dock's outer edge:

```css
.rounddock-handle       { left: 100%; transition: left 180ms ease-out; }
.rounddock-handle.open  { left: calc(100% - 4px + var(--rrl-dock-w, 128px)); }
```

So the button's own position was a function of the state it toggled. Clicking it slid it **128 px sideways
over 180 ms** — out from under the pointer — and clicking again slid it back. Chasing it was the only way to
press it twice, which is exactly the "dances around" in the report.

This is a general trap worth naming: **a control must not be positioned by the state it controls.** A toggle
that moves when toggled cannot be pressed twice without re-aiming.

## What was removed

The chevron, the `dockOpen` state, and the `toggleDock` callback — plus the handle's CSS. The dock is now
always open, which was already the intent: the code's own comment described it as *"the feature, not a
power-user extra"*, so the collapse was hiding the thing the rail exists to show.

`.rounddock.open` is kept as the single state the aside renders in, rather than unpicking the dock's layout
rules for no gain.

Nothing else referenced any of it — the whole feature lived inside `RoundRail.tsx` and one CSS block.

## Verified

Live, against a real 17-round replay: the rail still lists all 17 rounds, the dock still renders all 17
metric rows and reports open, and `.rounddock-handle` is gone from the DOM entirely.
