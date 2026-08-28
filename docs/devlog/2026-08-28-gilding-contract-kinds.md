# 2026-08-28 — Gilding contract kinds: token, reshape, extra-proc, not-applicable

Four convention cards came back **REVISE** with one shared message. The contract schema now knows what
gilding actually does, and the oracle checks each shape instead of asserting one flat ×2.

## The owner's rulings (verbatim)

| card | ruling |
| --- | --- |
| `q-conv-family-avenge` | "in some cases it summons more minions when gilded, in other cases it summons a gilded token instead. dunkey for example summons a gilded armadiyo, whereas gilded gemstorm instigator would proc an additional time (double its rubies)" |
| `q-conv-family-castPayoff` | "some versions double their numbers, some versions double their payoff or be unique. for example, gilded baal doubles its consume quantity, but high king mykel goes from 1 adjacent to both adjacent minions." |
| `q-conv-family-echo` | "i would say most of the time a gilded echo doubles its value, but like said previously, in some cases it summons a gilded token instead. i think doubling the output is the safe baseline with outliers being other behavior" |
| `q-conv-family-spellCast` | "spells cannot be gilded" |

Read as a shape vocabulary: **doubling the output is the safe baseline**, with three sanctioned outlier
shapes and one inapplicability. That is now two approved rules — **R-GILD-01** (the baseline + outliers) and
**R-GILD-02** (spells are never gilded) — both pinned to a new `gildingKinds` enforcement lane.

## What the schema gained

`GildedDeltaContract` (packages/rules/src/contracts/schema.ts) grew from *multiply / reshape / none / other*
to the full vocabulary. It is **additive** — `multiply` IS the ×factor baseline and was not renamed, so every
curated contract and every existing check kept working:

- `multiply` — the ×factor baseline.
- `gilded-token` — same count, **gilded token identity** (Dunkey → a gilded Armadiyo). Carries `token.cardId` + count.
- `reshape` — the gild changes the effect's **shape** (High King Mykel: one adjacent Shout → both).
- `extra-proc` — one **extra resolution** rather than a bigger number (Gemstorm Instigator).
- `not-applicable` — the object can never BE gilded; carries the **reason**.
- `none` / `other` retained.

Every claim also carries a **`basis`** — the same honesty device as `TriggerContract.phaseBasis` — so a
*derived* shape can never masquerade as an owner ruling.

Friction item 9 (verbatim text is never stored on a contract) still holds: a reshape carries
`goldenTextSource: 'index:goldenText'`, a **pointer** to where the checker reads the printed gilded text,
never the string itself.

## What the extractor derives, and where it refuses

The ladder, in order, is:

1. spell / Ruby → `not-applicable` — R-GILD-02. **The engine already agreed**: `checkTriples` skips both.
2. `noTriple` → `none`.
3. an owner ruling names the shape → that shape (`basis: 'owner-ruling'`).
4. the summon factory's **`goldenTokens` param** → `gilded-token` (the strongest signal there is).
5. no `goldenText` → `multiply` ×2, the baseline.
6. `goldenText` naming a "Gilded/Golden ⟨X⟩" the plain text does not → `gilded-token`.
7. a **pinned** summon count (`fixed` / the overflow factory) beside doubled magnitudes → `reshape`, because
   no single factor describes a partial gild.
8. `goldenText` whose number skeleton matches and whose numbers are each ×1 or ×2 → `multiply` ×2 (the text
   merely writes the doubling out).
9. a different skeleton → `reshape` — the authored text *is* the statement of the gilded form.
10. anything else → **UNRESOLVED**: kind `other`, `basis: 'unresolved'`, and `gildedDelta.shape` pushed onto
    `extraction.unparsed`. Never a guessed shape, never a silent pass. The validator *rejects* an
    `unresolved` basis whose gap is not on that visible queue.

`extra-proc` is deliberately **not derivable** — an extra proc and a doubled printed number are the same
text. It enters only through an owner ruling.

## The shape across all 901 contracts

| kind | count |
| --- | --- |
| `multiply` | 165 |
| `reshape` | 147 |
| `not-applicable` | 117 |
| `gilded-token` | 6 (`b2_dunkey`, `b2_trex`, `dw_chickenbrawl`, `manasaber`, `n2_muster`, `steadfast`) |
| `none` | 2 |
| `other` (unresolved) | 2 (`k_deepdelve`, `taragosaheir`) |
| `extra-proc` | 1 (`k_gemstorm`) |
| no claim (rune / quest / hero-power / curated) | 461 |

By basis: `derived:golden-text` 259 · `derived:ungildable` 119 · `derived:default` 44 · `derived:token-id` 6
· `owner-ruling` 3 · `unresolved` 2.

**Before this PR every one of the 281 cards with authored golden text was blanket-`reshape`.** 118 of them
were plain written-out doublings, three were identity gilds, and 91 spells had a gilding claim they can
never satisfy.

## The oracle

- `gildedCountRelation()` is the one place the shape vocabulary becomes a checkable law: `multiply` → ×factor,
  `extra-proc` → ×(1 + extra), `gilded-token` → **equal**, everything else → no count claim at all.
- A new **`gilded-shape` driver** runs the six gilded-token contracts through the real engine and reads the
  summon events' `golden` flag: the count must not move, every token the *gilded* body summons must be
  golden, and no token the *plain* body summons may be. It **owns** the `gilded` template for those
  contracts, so the count-only death-summon driver never shadows the identity check.
- `reshape` defers to the authored golden text (typed skip `gild-stated-by-golden-text`, and the text lane's
  `missing-gilded-delta` check alarms if the text vanishes).
- `not-applicable` is skipped **with its reason** (`gild-not-applicable`) — 119 skips that used to be
  unresolved noise.
- Four new typed skip reasons; the ledger (`applicable = executed + skipped`) still balances.

## Findings

Encoding the rulings surfaced four cards whose gild is **partial** — the summon count is pinned while the
magnitudes double: `amunrab` (7 Imps stay 7, +5/+5 → +10/+10), `impking`, `nanon` (overflow), and
`manasaber` (pinned count, gilded Cubs). All four are engine-measured and **correct as authored**; the old
blanket ×2 reading was the thing that was wrong, and each now classifies honestly (`reshape`, or
`gilded-token` for `manasaber`).

`k_deepdelve` and `taragosaheir` both go **2× → 3×** when gilded, which no ×2 baseline describes. They are
the two `unresolved` contracts — visibly queued for an owner ruling rather than guessed at.

**No engine-vs-ruling disagreement was found.** Every card the owner named behaves exactly as he described:
gilded Dunkey summons one gilded Armadiyo, gilded Void Panther gilds its Cubs, gilded Wolves Den doubles
3 → 6, gilded Baal doubles its consume quantity, gilded High King Mykel's golden text reads "both adjacent",
and `checkTriples` refuses to gild a spell.

## Enforcement

`packages/sim/src/docbot/gildingKinds.test.ts` (20 tests) — the encoding, the owner's named exemplars driven
through the real engine, R-GILD-02 structurally, extractor determinism, the registry-vs-fresh-extraction
drift guard, and sabotage for every new branch. `rules.test.ts` additionally pins that the four REVISE
decisions survive regeneration and that the regenerated cards no longer assert the retired flat claim.

No patch notes: this is encoding, not a gameplay change.
