# Replay audit — and the rune lock-in ceremony now plays in replays

**Owner ask (2026-08-30):** *"can you also audit our replay system? some things like rune select feel lacking
because we dont see hover data it seems, also we added the new rune lock in ceremony, and that doesnt appear
to play during the replays which it absolutely should."*

Both complaints are real, and they are **the same defect wearing two hats**.

## What the replay actually records

Three channels, and knowing the list explains everything that is missing:

| channel | what it holds | where it lives |
|---|---|---|
| **frames** | `ShopView` (a projection of `RunState`) per action, plus full `CombatResult`s | `replayV2.ts` |
| **inspectTrail** | the centred inspect panel opening/closing, with the recorded `CardView` | `replayV2.ts` |
| **dragPaths** | the pointer path of a drag-driven action | `dragTrace.ts` |

The first is everything the **reducer** owns. The second and third exist because someone noticed, twice, that
a specific piece of *presentation* was store-level enough to capture.

## The structural gap

**Anything held in a component's local `useState` and triggered by a DOM handler cannot be recorded, and
therefore cannot replay.** Nothing observes it; there is no channel it could travel on.

Both complaints are instances:

- **The hover previews.** `RuneCard` keeps its preview in `const [tip, setTip] = useState(...)`, shown from
  `onMouseEnter`. It never touches the store, so no trail sees it. The same pattern — verified — is in
  `QuestCard`, `StatusBar` (the Hunch tip) and `LobbyPanel`. **None of it replays, and none of it can today.**
- **The lock-in ceremony.** `startRuneLockIn` is called from `RuneCard`'s `onBuy`, i.e. from the click. Replay
  applies recorded *state*; it never runs a click handler, so the ceremony had nothing to fire it.

The distinction that matters: the ceremony was **fixable now** because the thing that triggers it (a rune was
bought) IS in the recorded state. The hovers are not, because the thing that triggers them (the pointer
entered a card) is nowhere in the recording at all. That is a capture-side feature, not a playback fix.

## The fix shipped here: the ceremony

Playback arms it in `renderFrame`, on a frame whose `cause` is `buyRune`.

The hard part is **timing**: the ceremony re-renders clones at the real cards' exact rects, and buying a rune
clears `runeforgeOffer`, which unmounts the forge on the same frame. So it is measured *immediately before*
the `setState` that replaces the view — the last instant the row exists — and applied *inside* that same
`setState`, which also keeps it to one render and lands it after `frameResets()` (which now clears a stale
ceremony when you scrub away from one).

Live play cannot share that hook, because only the click handler knows which element was clicked. Both paths
therefore converge on one shared `captureRuneLockIn`, so a replayed ceremony is measured exactly as a live
one is — two copies would drift, and the drift would show as the cards jumping on the first frame.

### Which rune was bought?

Not answerable from the outcome: `buyRune` clears the whole offer. Diffing owned runes works — **except for a
duplicate purchase**, where the list does not grow and all three candidates look identical.

So frames now record the causing action's index (`causeIndex`, optional, on both keyframes and deltas, carried
through `expandFrames`). Recordings made before today fall back to the owned-rune diff, and when that is
ambiguous they play **no** ceremony. A missing flourish on an old replay is a fair trade for never crowning
the wrong rune.

`causeIndex` is deliberately general (any action with an `index`), not rune-specific — the next "reproduce the
choice, not just its outcome" case gets it free.

## What is still missing, in priority order

1. **Hover trails.** The owner's "we dont see hover data". Needs a capture channel: a coalesced trail of
   (target, open/close, tMs) — `appendInspectEvent`'s rules already model this well — plus lifting the four
   components' local tip state to something observable. This is the big one, and it is capture-side.
2. **Other handler-driven flourishes.** The same audit question should be asked of every cue added from now
   on: *is this triggered by state, or by a click?* If by a click, it will not replay.
3. **A general principle worth adopting:** presentation that a viewer is meant to SEE should be derivable
   from the recorded stream. The ceremony now is. The hovers are not yet.
