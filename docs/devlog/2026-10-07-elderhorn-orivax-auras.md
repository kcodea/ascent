# 2026-10-07 — Elderhorn and Orivax become board auras

Owner batch 2026-10-07. Both Tier 7 capstones were a Choose One that installed a PERMANENT run mode. Both are now
auras that work **only while the minion is on your board** (owner ruling: "While on board").

## What changed

- **Elderhorn** (`b2_elderhorn`): "Your Beasts' Rallies and Echoes trigger an additional time."
  - Declared as card data: `triggerMultiplier: { families: ['rally', 'deathrattle'], extra: 1, stacks: true, tribe: 'beast' }`.
  - `TriggerMultiplierDef` gained an optional `tribe` (additive kind only), and `extraTriggerFires` an optional
    `subjectHasTribe` test. A tribe-scoped multiplier is skipped by any call site that does not pass one. The three
    Rally/Echo call sites now pass it: combat `playerEchoExtras` (the dying body), the combat Rally repeat loop (the
    attacker), and the Shop `fireRecruitDeathrattles` (the dying body).
  - Rules carry over from the shared fold, so nothing else is bespoke: golden +2, every copy stacks, adds to Sylus /
    Uron / the run-wide extras, reads only the living board (selling or death ends it), served boards carry it.
- **Orivax** (`d2_orivax`), renamed from "Orivax, the Spellchoir": "Your Shouts trigger 2 additional times."
  - New card field `shoutExtraAura: 2`, read through the new core helper `boardShoutExtras` (golden doubles, copies
    stack) in exactly the two Shout folds: Shop `shoutFireCount` and combat `ctx.shoutCarryExtras`. Every Shout
    entry path in both phases already goes through one of those (R-SHOUT-TRIGGER-01), so played, Shop re-triggered
    and real-time combat Shouts all get it, each extra fire its own counted `shout` beat.
  - Why not a `triggerMultiplier` like Zyff: in combat the board multiplier (`drakkoRepeats`) is an OUTER loop and
    `shoutCarryExtras` an inner one, so a board multiplier MULTIPLIES with Rune of the Choir in combat (Zyff + Choir
    fires 4 there, 3 in the Shop). The owner asked for Orivax to ADD to the run-wide extras, and folding it into the
    Choir's channel makes it 1 + 2 + 1 = 4 in both phases.
- The old Choose One wiring is gone from both cards. The factories (`battlecryGrantBeastHunt`,
  `battlecryGrantBeastRitual`, `battlecryGrantShoutExtra`, `battlecryGrantFirstSpellMult`) and the run fields they
  feed stay, still read, so old saves and replays resolve. Their four presentation-policy entries were removed (the
  ghost tripwire: no live content fires them now).
- Doc Bot: `MultiplierContract` carries the new `tribe`, and the interaction sweep declares ×1 for a tribe-scoped
  multiplier on an off-tribe producer (it flagged Broodmother + Elderhorn until then).

## Judgement calls (flag to owner)

- **Golden**: additive "additional time" convention (owner vocabulary rule 2026-08-28): golden Elderhorn +2, golden
  Orivax +4.
- **Copies**: stack (the same rule; Sylus / Uron / Zyff all stack). Only the "trigger twice" factor cards (Drakko,
  Chronos) are best-copy.
- **Simultaneous death**: deaths resolve left to right. An Elderhorn dying in the same strike still doubles a Beast
  Echo that resolves before its own death (it is at 0 Health but not yet resolved), and not one after. Identical to
  Sylus; pinned by a Cleave test.
- **Forced Rallies ARE multiplied** (owner ruling 2026-10-07, asked "Should Elderhorn boost Rallies that fire without
  an attack? Saying yes would change Uron too": "yes"; R-RALLY-FORCED-01). Before, no Rally multiplier applied to a
  Rally fired without an attack in either phase. Now:
  - Combat `fireFreeRally` folds `rallyCardExtras` (Uron, Elderhorn, the legacy Hunt mode; extracted from the swing
    path so both read one definition) + `playerRallyExtras` (Law of Teeth, War Council, Rallying Offensive, Rune of
    Adventuring, Spark Permit's first Rally). Each extra re-runs the rallier's own effects + the rally-gated watchers,
    logs its own `sc` Rally line and bumps the tally.
  - Shop `fireShopRally` folds the new `shopRallyExtras`: Uron, Elderhorn, the Hunt mode, Law of Teeth, War Council,
    Rune of Adventuring. NOT Rallying Offensive (`rallyDoubleNext`, "next combat") or Spark Permit
    (`rallyFirstEachCombat`, "each combat"), whose text is combat-scoped. Each fire (base + extras) counts toward
    `lastRallyFires`, Call and Answer and Herding Horn. The welded Rallies pay once, as on a swing.
  - `RALLY_WATCHER_EFFECTS` is now exported from core so the Shop extras re-fire the same watcher set as combat.
- **Epic medallion** (owner ruling 2026-10-07, "fix their icons to now be the special gem icon that drakko/sylus use
  etc"): the "epic choose one" override is removed, so both wear the default epic gem (`medallions/epic.webp`), same
  as Drakko / Sylus, plain and golden (the epic medallion has no gilded variant).
- Pre-existing asymmetry noticed, not fixed: Drakko / Zyff × Rune of the Choir fires a different count in the Shop
  (additive) than in combat (multiplied).

## Verification

`packages/sim/src/elderhornOrivaxAuras.test.ts` (19 cases: combat + Shop Echo, combat Rally, non-Beast untouched,
golden, copies, Sylus stack, simultaneous death, sold / dead Elderhorn, legacy modes, Orivax Shop + combat 3 fires,
golden 5, + Choir 4 in both phases, enemy-side isolation, snapshot carry, determinism). Confirmed failing with the
engine change reverted. Oracle: R-AURA-ONBOARD-01 / -02 in `packages/rules/src/registry/approved/auras.ts`.
