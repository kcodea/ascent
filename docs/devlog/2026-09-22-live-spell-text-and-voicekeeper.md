# 2026-09-22 — live spell text in combat, and the sale that never checked for a triple

Three owner reports from one screenshot (a shop hand holding two Front to Back and two Spell Warden):

> front to backs text/maybe all spells? not updating in real time from buffs in combat.

> rune of adventuring should affect the # shown for spell buffs too, since it re-triggers things like chorus
> drake etc.

> also voicekeeper selling needs a triple check

All three are fixed here. Two of them turned out to be the same bug, and it was not where the readouts are.

## A — the display-only combat previews were being swallowed by the reducer's phase guard

The expected story was "spell power has no preview channel, escalation has one and only `liveOptsFromRun`
reads it". That is true, and it is not the root cause. `reduceCore`'s phase guard reads:

```ts
if (state.phase !== 'recruit' && action.type !== 'resolveCombat' && action.type !== 'settleCombat') return state;
```

Every display-only combat preview is dispatched by the combat replay — i.e. while `phase === 'combat'`, the
one phase that guard rejects. Probed directly:

```
recruit | escalation {"attack":2,"health":2} | spellsCast 1 | deaths 1
combat  | escalation undefined              | spellsCast undefined | deaths undefined
```

So **all five** preview channels were dead: `combatEscalationPreview`, `combatSpellCastPreview`,
`combatFriendlyDeathPreview`, `combatBladeAttackPreview`, and the new spell-power one. Front to Back's step
froze for the fight, and so did Yirin's Attunement counter, Cindara's Hoard tracker and Gorun's Blade Mastery
countdown — three hero pills built specifically to tick live, silently frozen since they shipped. The
escalation preview had never worked in play at all, which is why the 2026-08-07 fix looked correct in review.

The fix is one predicate: the five preview actions are exempt from the phase guard, and from the modal guard
as well (a Discover raised mid-fight must not freeze a readout either). They carry no gameplay — `settleCombat`
clears every one of them and applies the real carry-backs — so letting them through cannot double-count.

**Spell power additionally had no text channel.** `grantSpellPower`'s narration drove a flourish and a hand-card
pop; the printed number kept reading `run.spellBonus`, which is written only at settle. The comment in
`spellPowerNarration` admitted as much: "run state doesn't change until settle, so mid-fight there is nothing
for that diff to see". Added `fxSpellPowerPreview`, fed from **`combatBuffDelta`** — the existing fold of the
simulator's `"+A/+H Spell Power"` narrations over `events[0, processedEnd)`, already computed each beat for the
Buffs panel. A fold, not an accumulator: it is published as an **absolute** value, so skipping or scrubbing the
fight lands on the right number where a per-event accumulate would double-count. Zero new events, zero extra
work per beat, and the base log is byte-identical.

Three display-only accessors (`spellAttackBonusLive`, `spellHealthBonusLive`, `spellEscalationLive`) fold the
previews on top of the banked run value, and every card-text surface now reads those: the hand and board memos,
the shop offers and spell slot, the related-cards popup, the combat-granted fly-in, and `Unit.tsx`. The raw
`spellAttackBonus` / `spellHealthBonus` are untouched — the reducer's cast math reads them, and a cosmetic
replay value must never reach real buff magnitudes.

`Recruit.tsx`'s hand-maintained `useMemo` dep arrays are the silent failure mode here (a dropped input reviews
clean and does nothing in play), so the escalation value is kept as two scalars, `ftbBonus` / `ftbBonusH`, and a
source-scan test counts their uses against their dep mentions.

## B — Rune of Adventuring: the simulation was already right

Probed through `simulate()` before touching anything. A Chorus Drake against a wall:

```
baseline                          | rallies 45 | spellPower {"attack":0,"health":45} | narrations 45
rallyExtraAlways: 1 (Adventuring) | rallies 90 | spellPower {"attack":0,"health":90} | narrations 90
```

Exactly double, with one narration per fire. **No simulation change was needed.** B is a strict subset of A:
because the readout is a fold over those per-fire narrations, the doubling reaches the printed number for free,
with no multiplier arithmetic in the UI at all. That is the general lesson worth keeping — derive the readout
from the events, and every multiplier that already works in the sim works in the text.

## C — the sell case was the one hand-growing case that never checked for a triple

Confirmed by probe before fixing: Voicekeeper on board, two plain Chroniclers in hand, sell a third Chronicler —
three plain copies in hand, no Gild.

The reducer uses an explicit-call convention: each case that can grow the hand calls `checkTriples` itself
(twenty call sites). `case 'sell'` returns early and never did. The shared post-action hand-growth check in
`reduce()` cannot cover it either, because its `handBefore` is captured *after* `reduceCore` has already landed
the grant — that check exists for quest-granted cards.

Fixed in the `sell` case, gated on the hand actually growing. The gate matters: an ungated `checkTriples` after
every sale would also combine copies that were merely standing there before the sale, which is a different rule
and broke the Runic Archivist tests (five identical sandbags on a board). With the gate, a sale can only ever
combine a copy the sale itself just granted.

Not moved into `settleMinionSale`: `checkTriples` is private to `reducer.ts`, and `recruit.ts` imports nothing
from `reducer.ts` (the reverse is a cycle). No double-trigger: the other sale routes (Dissipate, Parting Gifts,
Rune of the Altar) already run the check through the spell-play or rune-buy path, and `checkTriples` is
idempotent. The Triple Reward needs no extra code — `grantGoldenDiscover` fires when the Gilded card is
*played* — but the test proves it.

## Left alone, deliberately

`rubyBonus`, `growthBonus`, `clueBonus`, `starCrashBonus`, `undeadBuyAtk`, `cardBuffs` and `impAura` are stale
in combat by exactly the same mechanism (settle-only carry-backs read raw by the combat surfaces).
`gainRubyBonus` even emits a `"+A/+H Ruby Power"` narration that the replay consumes for FX and never
accumulates. Same shape, and now cheap to fix on top of this — but a separate PR.

`liveTrackingAudit.test.ts` classified `playerSpellPower` as LIVE throughout the bug, because the flourish
counted. Its entry now names the preview, so the next session does not read "classified LIVE" and conclude the
surface is fine.

One parity gap found and **not** touched, because it is a gameplay change needing an owner ruling: in recruit,
`spellBuffTargetEscalating` multiplies its step by `improveReps(state)` (Rune of Mastery); the combat twin does
not, though `ctx.improveRepsFor(side)` exists. So under Rune of Mastery a recruit cast improves twice and a
combat cast improves once. Whichever way that is resolved, the narration must carry the same total the gain
carries, or the derived readout will disagree with what settle banks.

## Oracle

- `R-TEXT-06` — a printed number keeps moving during combat, and lands where settle banks it.
- `R-MULT-05` — a multiplier reaches the printed number, not only the outcome.
- `R-SHOP-03` — a card granted by a sale can complete a Gild.
