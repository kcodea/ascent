# 2026-09-26: Ancients × the Warden, and Resilient Ward

The Warden's six Ancient pairings (the owner's words, 2026-09-26), built on the proof of concept from
[2026-09-25](2026-09-25-ancients-mvp.md), plus a new keyword variant, **Resilient Ward**. Still dev-only: Ancients
live behind the Scene Builder's Set 3 flag, and Resilient Ward is granted only by the Warden's Ancient of War, so
there is no patch note.

## Resilient Ward (`RW`)

- **Rule** (owner: "Takes 2 hits to break"). `RW` always rides beside Ward (`DS`), so every "has Ward" check in the
  engine, the text and the UI still sees a Ward. In combat (`applyDamage`, `simulate.ts`) the first hit is absorbed
  like a Ward's but only strips `RW` and emits the new **`wardDowngrade`** combat event; the minion keeps a plain
  Ward and the second hit breaks it as usual (`shield`). A body carrying `RW` alone is normalised to `DS + RW`
  (`instantiate`, the summon grant and the ascend paths).
- **Ward's existing rules, followed and pinned** (`core/src/combat/resilientWard.test.ts`):
  - **Execute:** both layers block it, and the venom is not spent until a hit lands.
  - **Destroy:** a shield-bypassing destroy skips both layers.
  - **Multi-hit:** each separate hit counts. A Flurry's second swing breaks the Ward the first one exposed, and each
    Cleave splash takes a layer off each neighbour.
  - **Rebirth:** it returns the full body with its Resilient Ward (`resilientBroken`, the twin of `wardBroken`).
  - **Not a break:** the downgrade does not fire `onLoseDivineShield` or count toward the break log.
- **Serialisation:** it is a keyword, so snapshots, saves, Xerox-style exact copies and hand-copy summons all carry it.
  On the run card it is permanent like Ward. Combat strips it from the combat body only.
- **Look** (`WardGlass` in `Card.tsx`; "RESILIENT WARD" in `styles.css`). It is the same Ward shell, re-tinted
  red-and-orange by swapping the shell's colour vars on `.wardglass.resil`, with a clean orange outline ring
  (`.wg-resil-rim`). When `RW` drops, the card plays one crack (`.wg-crack`): a jagged white crack line flashes, then
  six clip-polygon shards of the orange layer fly off and fade, revealing the plain Ward. It is transform/opacity
  only and unmounts on `animationend`. The one loop is the shell's existing opacity breathe. It has a
  reduced-motion fallback.
- **Choreography:** `wardDowngrade` is a `RESULT_TYPE` (it merges into the clash's impact), classified `shieldPop`
  (the Ward-break beat), and paced on its own `wardDowngrade` key (460, the same as `shield`). The Ward-break sound
  plays at the lunge's contact (`crackResilientWard`) and on the `auraBreak` cue for a non-attack hit. There is no
  blast, since a Ward still stands. The frame folds it in `useCombatReplay`, the log narrates it, and the trace,
  harness and Bug Board describe it.
- **Glossary pill:** "Resilient Ward: Takes 2 hits to break." (badge `RW`). It sits in the coverage test's KEEP list
  until a shipped text says it.

## The Warden's pairings (`ANCIENT_PAIRINGS.warden`)

| Ancient | Primitive | Hook | Phase |
| --- | --- | --- | --- |
| Death | `aegisDestroyGivesAttackAndWard` | reducer `grantWard`. The first pick opens `pendingTarget { heroPowerSlot }`; the second (`battlecryTarget`) replays `heroPower { uid, uid2 }` | Shop |
| Fortune | `wardBreakGold` (2) | `ancientAfterCombat` at settle, from `CombatResult.playerWardBreaks` → `bonusEmbersNextTurn` | Combat → next turn |
| War | `nextAegisResilient` (1) | reducer `grantWard`: `AncientsState.resilientAegisLeft` (set on the pick) | Shop |
| Genesis | `wardBreaksGetCopy` (3) | `ancientAfterCombat`: `wardBreaks` + `wardWindow` carry across combats | Combat → settle |
| Time | `eotBuffWarded` (+5/+5) | a virtual recurring End-of-Turn entry, `ancientTimeWard` (its own beat, projected, Chronos-repeated, replayed) | End of Turn |
| Bonds | `wardedGainBuffsWarded` (+5 Attack) | Shop: `ancientBondsReact` at the reducer's per-action stat diff, plus an End-of-Turn pass. Combat: `QuestCombatMods.ancientBonds` in `ctx.buff` | Both |

- **Player-only combat mods.** `ancientTrackWardBreaks` (Fortune and Genesis) makes `simulate` record the cardId of
  each friendly Ward break. It is off otherwise, so every other fight's result is byte-identical. `ancientBonds` is
  the Bonds half in combat.
- **The resolved hero-power text** shows the combined power, with no flavour. There are new placeholders:
  - `{aegis}`, the live Aegis grant;
  - `{wardLeft}`, Genesis' live countdown ("**N** more to go");
  - `powerTextSpent`, War's text once its Resilient Aegis is used (the base Aegis again).
- **Bonds, no recursion.** In combat a `ancientBondsFiring` guard stops the +5 from re-entering `ctx.buff`. In the
  Shop, gainers are resolved before any grant and the grants are never re-diffed. The End-of-Turn pass runs inside
  `applyEndOfTurn`, so its grants land before `faceOmen` prepares the fight. It marks every uid it handled
  (`AncientsState.bondsHandled`) so the per-action diff that runs after the fight is resolved does not repeat them.

## Judgement calls (flag to the owner)

- **Death replaces Aegis.** There is no "+5 Attack to Warded minions" after the transfer. The recipient always gains
  Ward, and a Resilient Ward on the victim travels as a Resilient Ward. The Attack moved is the victim's current
  Attack, and it is permanent.
- **War is exactly one Aegis** ("your next"). Every Aegis after it grants a plain Ward.
- **Fortune and Genesis count friendly Wards only**, and only real breaks (not the Resilient downgrade). Genesis
  counts from the pick, and its copy arrives at settle (to hand, else the board).
- **Bonds in the Shop fires once per gaining minion per action** (the `onGainStats` convention). An Aegis wave gives
  every Warded minion a gain, so each gives another +5. **In combat it fires per gain** as the gain lands, and the
  +5 lasts the fight unless the recipient is Engraved (the standing combat-buff rule).
- **Time is End of Turn only.** Minions with Ward at that moment count (Resilient ones too).
- **The owner's brief said "the normal gold Ward".** The shipped Ward shell is light blue, so the crack reveals the
  blue shell. The orange layer is the Resilient one.
- **Presentation gap:** the Shop Bonds grants and Death's transfer have their buff FX, but they are not projected as
  their own End-of-Turn / hero beats. The Death second pick arrives as a `battlecryTarget`, so the hero trigger does
  not wrap it.

## Tests

- `core/src/combat/resilientWard.test.ts` (12) covers the 2-hit rule, normalisation, a plain Ward unchanged,
  Execute, Flurry, Cleave, a bypassing destroy, Rebirth, determinism, the break log, and Bonds (one fire, no
  recursion, needs another Warded friend).
- `sim/src/ancientsWarden.test.ts` (19) covers all six pairings in their phases:
  - Death's two picks, cancel, real death and the RW transfer;
  - War: exactly one Resilient Aegis, permanent on the run card, downgraded in the fight;
  - Fortune's stacking Gold against the same fight without it;
  - Genesis' carry-over and countdown;
  - Time before the fight;
  - Bonds in the Shop, at End of Turn (no double at the boundary) and wired into combat;
  - the round trip.
- `ui/src/resilientWard.test.tsx` covers the shell, the crack on the downgrade, the pill, the beat classification,
  and no looping animation in the new CSS.
- Pins moved:
  - Doc Bot combat-mod lane 71 → 72: `ancientBonds` needs a Warded gainer beside another Warded friend, pinned in
    the core test.
  - The glossary badge count is now 17.
  - `playerWardBreaks` is EXEMPT in the live-tracking audit (paid at settle; every break already animates).
- Oracle: R-RWARD-01 (keywords) and R-ANCWARDEN-01 to 06 (heroes).
- Visual: headless Chrome at 1920×1080 on this branch's own dev server:
  - Scene Builder → Set 3 → Warden → Fill meter: the offer with the Warden texts;
  - the Resilient Ward idle;
  - a 7-frame break strip;
  - a live combat crack frame;
  - the Death recipient prompt and the "Resilient Ward" pill, driven in the Browser pane.
