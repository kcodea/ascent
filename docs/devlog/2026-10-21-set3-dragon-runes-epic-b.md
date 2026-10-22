# Set 3 Dragon runes, Epic B: the four Whisper Epics (2026-10-21)

Owner content ask 2026-10-21. Four Epic Dragon runes (Set 3 only, Dragon-gated, in `EPIC_RUNES`), built in parallel
with the Basic tier (`feat/set3-dragon-runes-basic`) and the other Epics (`feat/set3-dragon-runes-epic-a`).

Name check: SAME 0, CHANGED 0, NEW 4 (no existing rune or card uses these names or this effect).

| Rune | Owner text | Cost |
|---|---|---|
| Rune of Lasting Words | The first Whisper you cast from hand on each Dragon each turn is permanent. | 5 |
| Rune of Twin Tongues | Whispers cast from hand also cast on another friendly Dragon. | 5 |
| Rune of the Opened Vault | Get a Shush. After you activate Jar of Secrets, your next Whisper cast from hand casts twice. | 5 |
| Rune of Bequeathed Secrets | The first Dragon you sell each turn gives its Whisper stat bonuses to your left-most Dragon permanently. | 5 |

## How

- Each arms a `questFlags` flag through the `combatFlag` reward (the Open Grave shape); all four hooks are Shop-only.
- **One from-hand chokepoint**: the reducer's Whisper branch now calls `castWhisperFromHand` (sim/whisper.ts) once
  per cast. It wraps the shared `castSpell` with Lasting Words (snapshot, cast, keep) and Twin Tongues (the copy).
- **Hum's keep is shared**: `keepWhisperCastDelta` (recruit.ts) is the one "this cast is permanent" body, used by
  Hum and Lasting Words. It now also records the kept stats on the body (`whisperKept`).
- **Opened Vault**: `activateEquipment` arms `RunState.openedVaultArmed` after a Jar of Secrets activation; the
  Whisper branch spends it and adds one cast per copy of the rune.
- **Bequeathed Secrets**: hooked in `fireOnMinionSold` beside Rune of the Last Word. Payload is
  `whisperStatBonusesOf(sold)` = temporary `whisperBuffs` + `whisperKept`.

New state: `BoardCard.lastingWordsUsedThisTurn` (per-turn latch, cleared at the flip), `BoardCard.whisperKept`
(lifetime record, summed on a triple), `RunState.bequeathedUsedThisTurn` (per-turn), `RunState.openedVaultArmed`
(waits until spent). Both BoardCard fields are classified in the snapshot audits (`snapshotRegistry.ts`,
`snapshotFidelity.test.ts`): the latch is turn-scoped, the record is shop-only (read only on a sale; the stats
themselves are already in attack/health, so a served board fights identically). No new effect factory.

## Interpretations (owner approved the readings 2026-10-22)

1. Lasting Words: "permanent" = Hum's keep (stats, Whisper keyword, Seed stacks). A Yazzus or Opened Vault repeat is a
   second cast, so only the first is kept. The first cast spends the Dragon's latch even when it had nothing to keep.
2. Twin Tongues: "another friendly Dragon" = one random other Dragon (seeded), never the target; none = no copy. The
   copy is a full cast (counts for spell tallies and Whisper watchers) but not from hand. Untargeted Whispers (Well of
   Dragons, Clutch) are not copied. Each repeat from hand copies too. One copy per rune copy held.
3. Opened Vault: "casts twice" = the same cast resolves once more on the same target, added to Yazzus. One charge at
   most, kept across turns until a Whisper is cast from hand; a refused cast keeps it. Only a real activation arms it.
4. Bequeathed Secrets: "its Whisper stat bonuses" = the Whisper stats it carries now (temporary this turn + kept for
   good), not every Whisper it ever received. Spent by the first Dragon sold even with nothing to give. Inherited stats
   are not Whisper stats (no chain).
5. Duplicates: Lasting Words pays the sweetener; the other three scale per copy held.
6. Costs come from docs/set3-dragon-rune-draft-30.md (owner ruling 2026-10-22): 5 Gold each (the placeholders were 4 / 4 / 3 / 3).

Twin Tongues + Runic Transposition: tested after Epic A merged (2026-10-22). The copy goes through `castSpell` like
every other cast, so the twin also gets the Transposition Attack (a Bait copy lands +8/+5).
