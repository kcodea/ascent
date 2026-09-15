# `hand-buff` — one authored cue for every card that gets stronger IN HAND

Owner ask 2026-09-15: a new authored def, `hand-buff` (two shard bursts off the card + a `react` layer with
`part: "card"`, `reach: "self"` that pops the hand card itself), must play on a HAND card whenever that card's
printed stats go up — a **minion** in hand gaining stats (Hearth Whisperer, Nurturer, Shared Spirit, Hand Soap,
Rising Tide / Tidebud / Bondweaver's hand halves, Spiritbinder…) AND a **spell / Ruby / Clue / token** whose
printed value rises (Quick Study, Sugarnova's "next Shop spell +2/+2", Coppercoat Spellsword, Aeon Guard, Rune
of the Spellstone, spell power, Ruby strength…). It REPLACES the previous hand-buff presentation.

## What was replaced, and why

The old cue was the **spell-buff** cue (owner 2026-07-23): `spellBuffFx.ts` (a module-level "fire from
anywhere" bus), `spellBuffFxConfig.ts` + `SpellBuffFxTuner.tsx` (the ✨ Spell Buff tuner), and in `Card.tsx`
the `.spellbuff` class (CSS `sbgrow`/`sbshrink` scale keyframes) plus the `.sbsparks` / `.sbspark` CSS mote
blast. It only ever covered **spells and Rubies** — `Recruit`'s hand watcher skipped minions with the comment
"minions keep the existing green buff flash", but that flash (`.cardbuff`) had been retired on 2026-08-04 and
`captureBuffFx` diffs the **board** only, so a minion buffed in hand played **nothing** in the shop and only its
badge rolled in combat. It also never went through the def pipeline, so it could not be re-authored in the
workbench. All of it is deleted; nothing else used the `sb*` keyframes or the `spellbufffx` tuner key.

`to-hand.json` / the `toHand` binding is the card-ARRIVES-in-hand cue (a `toHand` combat event) — untouched.

## What ships

- `packages/ui/src/fx/defs/hand-buff.json` — the owner's def, copied verbatim (absent `*On` filter toggles
  default off, like every other def in the folder).
- `packages/ui/src/handBuffFx.ts` — the replacement bus. `fireHandBuff(uids)` plays `hand-buff` **once per
  card**, anchored on that hand card's element (`[data-zone="hand"] .card[data-uid]`), carrying
  `uids: {source, target}` so the `react` layer finds its subject; several cards buffed by one event cascade
  left→right on the shop's `RUBY_GAP_MS` — never one batched play (choreography rule). `diffHandBuffs` is the
  pure shop read: value cards (spell / Ruby) diff `text|attack/health` (any change, as before); everything
  else diffs stats and fires only on a **gain**. `fireHandBuffOnHandSpells` / `…Rubies` keep the spell-power
  and Ruby-power presenter call sites (Recruit EoT beats, mid-combat `sc` narrations) on the same cue.
- **Combat**: `handBuffUidsIn(beat, events)` scans the on-screen beat for player-side `handBuff` events
  (the engine signal R-HAND-02 added on 2026-09-09) and fires one play per event, on the same beat
  `handBuffsShownThrough` grows the badge. No sim-side change.
- **End of Turn**: a hand minion buffed at EoT needs no presenter — the projection's `handStats` ride
  `handStatOverride` into `handViews` on the beat while the phase is still `recruit`, so the shop diff sees it
  exactly when it lands; the phase-flip skip still prevents the settle double-play.
- `fx/combatAnchors.ts`'s `unitSelector` gained the hand row as a **third** alternative (after warband and
  tavern, so a board body always wins over a hand copy): a `react` layer resolves its subject through it, and
  until now a hand card was unreachable. Recruit's combat `findEl` is unchanged.
- Registered in `fx/directCalls.ts` (`'hand-buff': ['handBuffFx.ts']`) + the enumerating test.
- Dev hook: `window.__handBuffTest()` fires the cue on every card in hand (replaces `__spellBuffTest`).

## Tests

`packages/ui/src/handBuffFx.test.tsx` (jsdom): the shop diff names (a) a minion whose stats rose and (b) a
spell whose printed value rose — and not a drawn card, an unchanged card, a text-only tick or a stat loss;
the combat scan names one uid per player-side `handBuff` event in a beat; `fireHandBuff` binds `hand-buff` to
the hand card's element with its uid, plays once per card on the gap, plays nothing for an off-screen uid, and
its teardown cancels queued lands; and the shared unit selector reaches a hand card.
