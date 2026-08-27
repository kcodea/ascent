# Text oracle tranches 2 + 3 — summons, economy, and the target/cardinality gate (Docbot PR 5)

Extends the text-as-oracle lane (tranche 1, printed stat buffs) with the next two families from the Docbot
handoff (§7.1/§7.2) plus the §7.4 recipient oracle. Three new modules under `packages/sim/src/docbot/`,
each following tranche 1's architecture: derived subject worklists (never hand-listed), typed excuse
registries with stale checks, two-sided ratchets, verify-before-alarm, and a sabotage test proving the
instrument alarms on doctored expectations.

## Tranche 2 — summons (`textOracleSummons.ts`)

Parses the FIRST imperative summon clause from live card text — count ("a"/"two"/"7"), token identity
("Gemheart Golems" → `gemheart-shard`, plural-resolved against `CARD_INDEX` names), printed body stats
("1/1"), Gilded/Golden, and granted keywords ("with **Taunt** and **Ward**" → `T`/`DS` on the summoned
body) — then executes through the real drivers (reducer `play` for Shouts/spells, one `simulate()` for
Echo/Start of Combat/Avenge/Rally) and reconciles the observed summons on every parsed axis. Watcher texts
("When you summon a Beast…") are filtered by an imperative-position guard, so tranche 1's buff family can't
false-enroll. **31 subjects, all reconciled** (1 lane: shout, 30: combat), one `needs-triage`:

- **Copy-summon gilding disagreement (owner question):** gilded Mirrorhide Rhino's `scSummonCopy` copies
  keep the Gilded badge; gilded Ex-Galloper's `echoSummonCopyNoEcho` copies carry the exact gilded stats
  (12/12) but a PLAIN badge. Stats are exact either way — should "exact copy" include the badge?

Measured gilding semantics are documented on `reconcileSummons`: "Gilded 1/1 Trooper" means a gilded 2/2
body; a golden run may summon gilded tokens whose goldenText folds the doubling into printed stats without
saying "Gilded" (Void Cubs), so golden runs alarm on that axis only when gilding is promised and absent.

Because the summon factories live deep in the two factory maps, tranche 1's brace-scanner
(`extractFactoryEntries`, which stops early — ~95 of ~400 entries, enough for its own floored family) was
supplemented with `extractEntriesByLine`, keyed on the maps' mechanical `  id: (` entry-head layout.
Tranche 1's own pins are untouched.

## Tranche 3 — economy (`textOracleEconomy.ts`)

A flat-axis grammar (immediate / future "next turn|shop" / max-Gold / "Sells for N" / "Sell: get N") that
rejects rates, thresholds and schedules by construction (§7.5), reconciled with the economyScan probe
patterns — exact `embers` / `bonusEmbersNextTurn` / `maxGoldBonus` deltas through real actions. Three
derived worklists: **7 card subjects** (6 reconciled, 1 confirmed bug below), **2 runes** (both reconciled,
including the immediate-vs-next-turn TIMING of the printed wording; 7 gold-mentioning runes typed out of
grammar and pinned by name), **2 hero powers** (Nadja's max-Gold, Robin's per-sell future Gold — both
reconciled through the real `heroPower`/`sell` actions).

- **CONFIRMED BUG (excused `confirmed-bug-pending-fix`, not fixed here per the PR-5 mandate):**
  `c3_herald` (Herald of the Divide, ARCHIVED — reachable only via old saves/replays) authors
  `params: { gold: 2 }` but `battlecryGainGoldNextTurn` reads `params.amount` (default 1) — the Dawn Shout
  banks **1** Gold next turn while the text prints **2** (golden: measured 2, printed 4). The CONTENT
  PARAMS diverge; Paymaster Pimm authors `amount:` correctly through the same factory. Fix: rename the key
  in `cards/archive.ts`; the fix PR deletes the excuse.
- Measured engine asymmetry documented on `reconcileEconomy`: the quest/rune reward engine's `gainMaxGold`
  refills the raised max into this turn's bank; the card factory `gainMaxMana` (Gold Font) does not.

## Target/cardinality oracle (`targetCardinality.ts`, §7.4)

Normalizes each tranche-1 SHOP-lane subject's effect into an `ObservedGrant` (source, recipients with
uid/tribe/position/self, per-recipient amounts, phase) by re-driving tranche 1's OWN fixtures (tribeRow /
shoutRow / shopBase, now exported), and checks recipient COUNT and ELIGIBILITY against the parsed target
language: "a friendly X" (exactly one, right tribe), "your (other) Xs" (every eligible fixture body, no
ineligible one), "adjacent", "a minion and its neighbours" (aim-anchored), "left-/right-most", self-gains.
Of the 36 tranche-1 subjects: **11 reconciled**, 18 combat-lane (typed out-of-lane), 6 in the pinned
ambiguous-prose queue (§7.5 — e.g. "2 random friendly Dwarves"), 1 excused (`k_alchemist`, a Ruby-aura
channel grant with no board recipient set). The sabotage test proves a doctored recipient list — an
ineligible extra body, a missed eligible body, two bodies for a printed "a minion" — alarms.

## Notes

- No gameplay, docbot CLI, or `docs/docbot.md` changes; tranche-1 pins untouched except exporting the
  shared fixtures and doc-commenting the export.
- No patch notes (dev tooling only).
