# 2026-08-28 — Archiving the quest system, Fi, Coran and Henchmen

Owner ruling, verbatim:

> we have more or less retired quests for now. we can archive that system fully, it can be more or less turned
> off and away from our code for now as we are centering on runes for the foreseeable future. with that, coran
> and fi should be archived for now. they will be redesigned and should not show in our hero list for practice
> nor play for now. keep them archived but completely inactive for now.

And in the same triage sitting, on `q-conv-global-henchman-pricing` (REVISE): *"henchmen are not in the game
and are extremely WIP / being removed for now."*

## The shape of the change: archive, don't demolish

Nothing was deleted. `QUEST_DEFS`, `QUEST_INDEX`, the objective machinery, `applyQuestReward`, the quest UI,
`HENCHMEN` and both heroes' defs are all exactly where they were. What changed is that each system's single
**offer producer** now returns `null`:

| System | Chokepoint | Switch |
| --- | --- | --- |
| Quests | `questOfferPlan` (`packages/sim/src/quests.ts`) | `QUESTS_ARCHIVED` |
| Henchmen | `henchmanOffer` (`packages/sim/src/state.ts`) | `HENCHMEN_ARCHIVED` |

Both switches live in `packages/sim/src/config.ts` under one long docblock explaining the archive contract.

The reason this is *provable* rather than incidental is that each of those functions is genuinely the only
producer. `questOfferPlan` has exactly two callers — `createRun` (the turn-1 hero quest, which never passes
through a turn advance) and the turn-advance block in `reducer.ts` — and both generate nothing when it returns
null. With no offer there is no `questOffer`, so the overlay never opens, `buyQuest` never has an index to
take, `activeQuests` stays empty and objectives never tick. Same story for the henchman: `buyHenchman` refuses
without an offer, and the StatusBar chip renders only when the offer is non-null, so the UI needed no change
at all.

### Why `CONFIG.questsEnabled` could never have done this job

This is the trap, and it is worth writing down because the flag *looks* like a master switch. It is not. It
gates only the **universal** turn-5/11 offers, and the quest-native hero powers were deliberately checked
**above** it — that was the whole design, mirroring how the Runeforge leaves Runesmith/Runeguard native access
intact. Since 2026-07-31 `questsEnabled` was already `false`, and Fi and Coran's turn-1 offer was the one
remaining live quest path in the game. The new gate sits above everything, including that. `systemToggles.
test.ts` now pins it directly: arming `questsEnabled = true` cannot bring quests back.

### The heroes

Fi and Coran moved from `practiceOnly: true` (the weaker 2026-08-23 withhold: off the ladder, still playable
in Practice) to `wip: true`, which is the flag that means what the owner asked for — out of Play, out of
Practice, and out of `powerDiscoverPool`, so Mimic, the Void and Power Shifter cannot hand their powers out
either. Their defs stay in `HEROES`.

`practiceOnlyHeroes.test.ts` was renamed to `archivedHeroes.test.ts`, because its central assertion ("the flag
is the only difference between the two rosters") is exactly what the ruling invalidates — the two rosters are
now identical. The renamed suite keeps teaching the `wip` vs `practiceOnly` distinction, which is still the
thing to get right.

### One real bug found on the way

With the quest modal gone, `heroScan` started reading Fi and Coran **active**. The cause was the smell already
documented at the top of `heroPowerFamilies.ts`: the `heroPower` case's else-if chain ends in a **Fortify**
fall-through, and `heroQuest` was not in the explicit passive no-op list. It had never mattered, because both
heroes opened the run holding a quest modal and `modalOpen` refused the click before it reached the chain.
Archiving removed that accidental shield, and a `heroPower` action on Fi would have handed out a free
+Tier/+Tier buff. `heroQuest` is now in the passive list where it always belonged.

## Doc Bot: what happened to the coverage

The honest-accounting half of this was the larger part of the work. 117 quest contracts and 1 henchman
contract exist, and the failure mode to avoid was letting them quietly evaporate.

**The decision: keep every contract, and label the class.** `ARCHIVED_CONTENT_TYPES` in `contractExtract.ts`
names `quest` and `henchman` as archived content classes, and `archivedInventory()` counts them into the
report as `inventory.archived`. They are still extracted, still inside the WP B inventory gate, still swept by
the oracle and text lanes.

This is deliberately the **opposite** of how `ARCHIVED_CARDS` is treated (skipped from the inventory), and the
distinction is real: an archived *card* is moved out of the active content model entirely, so demanding
coverage for it would be demanding coverage of something that no longer exists. An archived *quest* is still
fully present in `QUEST_DEFS` and still fully resolvable — only its offer producer is gated. Dropping those
118 contracts would have deleted still-true coverage and silently shrunk every headline number in the report
(and would have tripped `contractOracle.test.ts`'s `>= 900` floor besides).

To make sure the number can never move unnoticed, `inventory.archived.total` was added to
`headlineNumbers()` — so the doc-drift rail requires `docs/docbot2/final-report.md` to state it, and the gate
fails the moment it changes.

- **economyScan's quest half: still running, unchanged.** It grants every quest through `devGrant`, which the
  archive deliberately leaves ungated, and asserts each reward's magnitude. `QUEST_SCAN_EXCUSED` stays empty
  and its `<= 0` ratchet stays where it was. No skip reason was needed, so none was invented.
- **The 8 `q-conv-quest-reward-*` conventions: parked, not retired.** (Note for the record: they are
  `needs-ruling`, not approved — `decisions.json` carries no `q-conv-*` entries at all.) They describe the
  reward *engine*'s shape, the owner may still rule on them, and a redesign revives the content, so retiring
  them would throw away a live question. Each now carries a `QUEST_ARCHIVE_NOTE` appended to its
  `currentBehaviour` — that field's job is to state what the implementation does *today* — saying the content
  is archived **and** that the enforcement lane still runs via `devGrant`.
- **`q-conv-global-henchman-pricing`: same treatment**, with its `currentBehaviour` noting the decay it
  describes can no longer be observed in play, while the decay *state* still accrues and is still asserted.
  Its REVISE decision is being landed by the sibling triage PR, so `decisions.json` was left untouched here.
- **`heroQuest` power family: kept, not reclassified to `'retired'`.** `retired` means "no hero wields it and
  the path is gone" — neither is true. A new `ARCHIVED_POWER_KINDS` set expresses the actual state, and
  `heroPowerStagers.test.ts` enforces that every hero wielding an archived kind is `wip`.
- **The Fi/Coran stagers: kept, with a changed job.** They used to drive the turn-1 offer to a pick and a step
  of progress; they now assert the archive holds (no offer on any seed, absent from every picker). The
  silent-queue verdicts stay `'stager'` — downgrading them to `'needs-stager'` would be a false claim of
  missing coverage, and deleting them would leave the archive itself unwatched.

## Save and replay safety

`questArchiveSaves.test.ts` is new and is the direct test of the archived-content contract: a run serialized
as it would have been *before* the archive — Fi, mid-run, a hero quest one step from its threshold, a pinned
`servedBoards` entry — must deserialize, resolve its quest through `QUEST_INDEX`, still advance, still pay out
its rune, keep its pinned opponents, survive a re-serialize round trip, and pick up no new quest for the rest
of the run.

That suite is also the argument against the tempting alternative implementation. Moving the quests into an
`ARCHIVED_QUESTS` list (mirroring `ARCHIVED_RUNES`) would have broken every assertion in it: `QUEST_INDEX`
lookups return undefined, the badge row drops the quest, banked `pendingQuestRewards` are silently discarded,
and `qaScenario.ts` rejects any saved scenario carrying the id. Gating the producer instead of emptying the
list is what buys all of that back.

## Test churn

Rewritten rather than deleted, in each case keeping the coverage that survives un-archiving:

- `heroQuests.test.ts` — the offer tests now call `generateQuestOffer` **directly** (it is still callable; only
  the *plan* is gated), so the draw rules, the variant-family exclusion and the no-leak guarantee stay under
  test. The journey counter and all seven reward payouts are driven from a seeded `activeQuests`, the way
  `run.test.ts` has always driven quest rewards. Fourteen hero quests' worth of reward-engine coverage — which
  the runes ride on — was preserved rather than dropped.
- `henchmen.test.ts` — asserts three separate claims: inert (no offer, `buyHenchman` no-ops even funded and
  even free), resolvable (registry + hero links), and **reversible** (the decay state still accrues, so
  un-archiving restores a correctly-priced offer rather than a stuck one).
- `run.test.ts`, `runes.test.ts`, `systemToggles.test.ts`, `runTelemetry.test.ts` — quest expectations
  inverted. Two are worth calling out: the wave-5 advance now asserts the shop is genuinely **playable** (a
  gate that produced no offer but still set the modal flag would soft-lock the run there), and the Epic
  Runeforge test now asserts it opens **immediately** on turn 11 instead of queuing behind a quest that can
  never appear — an armed `pendingEpicRuneforge` waiting on a modal that never opens would strand a rune the
  player was owed.

## Files

Switches: `packages/sim/src/config.ts`. Producers: `quests.ts`, `state.ts`. Heroes: `heroes.ts`. The passive
fix: `reducer.ts`. Doc Bot: `docbot/contractExtract.ts`, `docbot/heroPowerFamilies.ts`,
`docbot/conventionQuestions.ts`, `tools/src/docbot-report.lib.ts`, `tools/src/docbot-report.ts`. Player-facing:
`packages/ui/src/patchNotes.ts`. Docs: `docs/GAME-RULES.md`, `docs/CONTENT.md`, `docs/docbot2/final-report.md`.
