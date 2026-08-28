# Destroy effects get their own beat — and Rise starts working in the shop

Owner report, 2026-08-28: Funeral on Loan and Graverobber "need their own beat and should not be an immediate
and janky pure result action." Funeral on Loan should visibly occupy a slot and then play its death + Echo;
Graverobber's target should show a death and Echo animation, and a correct Rise animation if it has Rise.

Two separate faults sat underneath that, one presentational and one mechanical.

## The presentational fault: departures emitted nothing

`withRecruitTrigger` — the primitive every shop beat is built on — diffs the board around an effect and emits
`cardSummoned` for bodies that ARRIVED. It never had the other half. A body that **left** the board produced
no consequence at all, so a shop destroy had literally nothing for the choreographer to hang an animation on:
the minion was simply absent once the phase committed. That is the whole of the "instant and janky."

Added the departure diff, and gave `CardDestroyedConsequence` two fields it needed to be useful:

- `index` — the slot the body vacated. Without a position the projection can only wink the card out wherever
  the committed board happens not to have it. This is the exact sibling of `cardSummoned.index`, added in
  2026-08-20 for the same reason.
- `rise` — the body is coming straight back, so the death plays but the slot is not treated as freed. Mirrors
  combat's `death.rise`.

Fodder and eaten Shop offers are not caught by this diff (they were never board minions, and carry their own
`fodderEaten` / `shopChanged: consumed`), so nothing is double-reported.

## The mechanical fault: Rise was combat-only

`rebornAvailable` is armed by combat's `instantiate`, and the shop destroy path just spliced the body off the
board. A Graverobber ate a Rise carrier outright. **Owner ruling 2026-08-28: Rise fires on shop destroys too.**

Every shop destroy now goes through one helper, `destroyMinionInShop`, which follows combat's death sequence
rather than re-inventing it:

1. the body LEAVES its slot first, so the Echo's summons can fill the space it vacated,
2. the Echo fires, with its Sylus/Uron/Elderhorn multipliers,
3. on-death watchers are notified (owner ruling 2026-08-26),
4. Rise returns the body to the RIGHT of whatever the Echo summoned — at **base Attack** (golden ×2) with
   **1 Health**, shedding buffs and granted keywords and spending the Rise.

Step 4 is the owner's own Rise contract, verbatim from the `q-conv-keyword-r` ruling: *"it returns with 1
health and base attack before any auras or effects are added."* The board cap gates it exactly as combat's
does — the Echo resolves first, and if its summons took the room the body does not come back.

The risen body gets a **fresh uid**. Combat keeps the uid because it emits an explicit `death` event; here the
departure diff detects a death by finding a uid that is no longer on the board, so reusing it would mean the
death animated nowhere — straight back to the bug being fixed. A fresh instance is also the honest model: base
stats, printed keywords, no buffs.

## Funeral on Loan is not routed through that helper — for ORDER only

The helper removes the body first (combat's order). A borrowed body must stay ON the board while its Echo
fires — positional Echoes need real neighbours (owner report 2026-08-04: a borrowed Dawnclaw "does not trigger
the adjacent shouts"). That is the whole reason it keeps its own path.

**It originally opted out of Rise as well, and that was wrong.** The reasoning was that a loan ending is not a
death, so a Rise would let a borrowed minion stay — the one thing the card must never allow. The owner
overruled it the same day: *"if a minion has rise that is discovered, it should rise in the same way a
destroyed minion with rise would."* A discovered Rise carrier really does leave you a body, and that is the
payoff for discovering one.

So the Rise return lives in one shared `riseReturn`, used by every shop path that kills a body — a Rise can
never mean two different things depending on which card did the killing. The risen body also clears its
`borrowed` flag: it is yours now, and leaving the flag on the clone would hand the next turn's expiry sweep a
card that is not in hand.

It instead gets two beats of its own — `system:destroy:shopArrival` then `system:destroy:shopDeath` — so the
body is seen to take a slot before the death takes it away. Gameplay and ordering are untouched.

Watchers are still not notified for a loan expiry, exactly as before. Whether a loan expiry *should* count as
a friendly death is an open design question, deliberately not answered while fixing presentation.

## The UI speaks combat's vocabulary

The same death should not read as two different events depending on which phase it happened in, so the shop
presenter reuses combat's exact choices:

- has an Echo → the painted skull-shatter (`pixiFx.deathrattle`),
- no Echo → the authored `death-dissolve` def,
- rising → neither; the body re-forms, so it must not dissolve. It gets a short bloom, and its return arrives
  through the ordinary summon path as a fresh body.

## Note on `RISING`

The rise flag is a module-local in `recruit.ts`, beside the existing `SPOILS` / `SABLE` locals — not a
`RunState` field. It must never serialize, and it must not exist differently depending on whether presentation
capture is on, which is exactly what a state field cleared inside a capture-only path would have done. It is
set fresh per destroy and never cleared on the way out, because the diff that reads it runs *after* the destroy
returns.


---

# Follow-up, same day: the two-step shop death

The beats above were real but did nothing on screen, and the owner's live test found it immediately:
Funeral on Loan "is still not occupying space long enough."

**The cause.** Only End of Turn ever PLAYS its beats. `preparePresentationAction` holds the previous board on
screen and reveals each consequence as its beat fires — and `faceOmen` is the only action wired to it. Every
other shop action resolves and commits in one frame; the batch is captured for the Beat Lab and nothing
performs it. So a borrowed minion, which exists only *inside* one reducer call and is never in the committed
board, had nothing to render.

**The owner's fix, which is better than the one I proposed.** Rather than generalising the End-of-Turn
playback machinery, make the landing REAL: *"the minion should be coded to literally land as if it was played,
but then the immediate next action is that it is destroyed."*

So a borrowed play is now two actions:

1. `play` lands the body at its drop slot and stops, leaving `pendingDeath`. The board really holds it, so it
   renders through the ordinary arrival path — no projection, no held state.
2. `resolveShopDeath` fires its Echo, removes it, and applies any Rise.

**What makes the intermediate state safe.** Every other action settles the same pending death FIRST, and a
resolve with nothing pending is a free no-op. So a bot, a test or a replay that simply keeps playing reaches
exactly the state a player who watched the animation reaches — the landing is visible only to whoever is
looking at the screen, and can never be built on. The UI's job is just a timer.

One bug worth recording: the first version resolved the pending death in `reduce`'s guard and returned early,
which skipped everything `reduce` does *after* `reduceCore` — the hand-arrival diff, the onGainAttack diff,
quest ticks, the FX scratch buffers. A borrowed Geode Guardian's Ruby cue silently stopped firing. It is a
real `reduceCore` case now, so it gets the same machinery every other action does.

## Echo summons land where the minion died

Separately, the owner asked that a dead minion's Echo summons "be summoned as if the minion died where it
did". They were not: `summon(card, nearUid)` splices next to the summoner, and `destroyMinionInShop` removed
the body first — so `nearUid` resolved to -1 and the summons APPENDED right-most. A Graverobber eating a
minion in slot 1 put its two Imps at the far end of the board.

Both shop deaths now keep the body in its slot while the Echo fires, marked `vacatingUid` (which also stops it
consuming a summon slot), then remove it. Combat reaches the same result the other way round — remove, then
summon into the vacated slot — and what matters is where the summons end up, which is what a player sees.
