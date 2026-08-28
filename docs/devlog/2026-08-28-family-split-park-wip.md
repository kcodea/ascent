# 2026-08-28 — the convention deck, split by trigger; Orbit + Celestials parked

Two owner rulings from the 2026-08-28 Rulebook Triage sitting, both `revise`, both structural rather than
per-card. They changed how the convention deck is *built*, not just what it says.

## 1. `q-conv-family-economy` — the clustering was keyed on the wrong axis

Owner, verbatim:

> this family seems extremely varied. there are cards that proc on sell in this category, there are some
> shouts, there are cards that trigger from buying x cards, there are cards that learn other spells etc.
> this does not seem like a cohesive family of cards or rulings to me.

He was right, and the fault was the cluster key. `conventionQuestions.ts` clustered cards by their
**presentation family** (`PRESENTATION_POLICIES[...].family`) — which is a *presentation* concept, the beat
an effect gets, not a statement about when it fires. Several families collect factories that fire on
completely different moments. `economy` alone spanned **11 distinct trigger events**
(`onSell`, `minionSold`, `onBuy`, `cardsBought`, `spellBought`, `goldSpent`, `onRubyPlayed`, `rubyCast`,
`shopRefreshed`, `spellCastOnThis`, `startOfTurn`), so its card's headline claim — *"All 36 'economy' cards
trigger the same way"* — was simply **false**, and an approval on it would have ruled 36 cards the owner
never read as a group.

### The audit the ruling triggered

Sweeping every family the same way (distinct trigger events per family) found **exactly three** offenders:

| family | trigger events | verdict |
| --- | --- | --- |
| `economy` | 11 | **incoherent — split** (owner-flagged) |
| `economyReact` | 8 | **incoherent — split** (found by the audit) |
| `react` | 5 (`friendlyDemonDealtDamage`, `onConsume`, `onDamaged`, `onGainAttack`, `summonOverflow`) | **incoherent — split** (found by the audit) |
| `avenge`, `castPayoff`, `castReact`, `echo`, `endOfTurn`, `passive`, `rally`, `shout`, `shoutPayoff`, `shoutReact`, `slaughter`, `spellCast`, `startOfCombat`, `summonReact` | 1 each | coherent — **left alone, ids untouched** |

The 14 single-trigger families keep their card *and their id*: re-minting them would have cost the owner a
re-sitting for nothing.

### The re-cluster

The three offenders **dissolve**, and their `(factory, event)` pairs are pooled and re-clustered by trigger
group across all three at once — otherwise `economy` and `economyReact` would each mint a duplicate
"when you sell" card. Trigger groups live in `TRIGGER_GROUPS` in `conventionQuestions.ts`.

| old family (retired) | new cards |
| --- | --- |
| `q-conv-family-economy` (36 cards, 11 triggers) | `q-conv-trigger-sell` (10) · `q-conv-trigger-buy` (7) · `q-conv-trigger-goldSpent` (6) · `q-conv-trigger-ruby` (6) · `q-conv-trigger-residual` (6) |
| `q-conv-family-economyReact` (14 cards, 8 triggers) | (same five — pooled with economy) |
| `q-conv-family-react` (5 triggers) | `q-conv-trigger-damaged` (6) · `q-conv-trigger-consume` (2) · `q-conv-trigger-gainAttack` (2) · `q-conv-trigger-overflow` (2) |

**The residual is honest.** Four leftover triggers (`onGainCard`, `shopRefreshed`, `spellCastOnThis`,
`startOfTurn`) belong to no group and to each other even less. Rather than forcing a tenth false family, the
card says so out loud: *"These 6 are unrelated: they share no trigger. Ruling each individually is the honest
option."*

### The machine-checkable version of the complaint

`packages/sim/src/docbot/conventionCohesion.test.ts` is new and is the point of the PR. It asserts that every
non-residual cluster spans exactly **one** trigger group, and that **every listed member actually carries the
trigger its card names**. The mistake the owner caught by reading can no longer be made silently.

One drafting note worth keeping: the fly-through ratchet counts words *before the first em-dash*, so putting
an em-dash mid-sentence would have hidden half the claim from the bar it exists to enforce. The trigger cards
use a colon instead.

## 2. `q-conv-family-orbit` + `-orbitReact` — parked, not answered

Owner, verbatim:

> orbit is extremely work in progress and should not receive any true rules yet, neither should any celestial
> as they are temp minions

> as stated before, orbit and celestials are masssive works in progress right now.

The rulebook had no way to say "don't ask" — only *approved*, *needs-ruling*, *rejected*. A ruling on a moving
target is worse than no ruling, so **parking** is now a third state: not asked, not approved, and never
silently dropped.

`packages/rules/src/parked.ts` is the whole registry — a leaf module (zero imports, so `@game/sim` can take it
at runtime without dragging the rulebook toward the web bundle). Two classes today: `orbit` (the `orbit` +
`orbitReact` families and the `orbit` / `orbitFired` triggers) and `celestial` (the tribe, plus the
`CardDef.celestial` flag, which is a superset of the tribe field).

What parking does:

- **no questions** — the two family cards are not generated;
- **no inherited bindings** — parked content is stripped from *every* other convention card's member list, so
  approving "Taunt means X" can never quietly rule a Celestial;
- **contracts stamped, not dropped** — a new `ContentContract.parked` field (`reason: 'parked-wip'` + the
  owner's wording + the date). 16 active contracts carry it. `contractErrors()` refuses a parked contract
  stored as `approved`;
- **lanes keep verifying, stop asserting intent** — `contractCorroboration` and `contractOracle` still measure
  every aspect of a parked contract and keep the measurement in the row's detail, but downgrade a `disagree`
  to `uncovered` citing `parked-wip`, and withhold the finding. A disagreement about intent is meaningless
  where no intent exists yet;
- **visible in the counts** — `contracts:extract` always prints a PARKED block, even at zero.

**Un-parking is one edit**: delete the class's entry from `PARKED_CLASSES`. Nothing else hardcodes a parked
name; `conventionCohesion.test.ts` pins that (it fails if a parked family stops existing in
`PRESENTATION_POLICIES`, i.e. if the park went stale).

## Tombstones

Five ids retired in `registry/retired.ts`, all `2026-08-28`, none recycled — replacements carry new
`q-conv-trigger-*` ids, and the parked classes carry no id at all:

`q-conv-family-economy` · `q-conv-family-economyReact` · `q-conv-family-react` · `q-conv-family-orbit` ·
`q-conv-family-orbitReact`

The three the owner actually decided also carry their `revise` decision in `decisions.json`, so the record of
*why* survives regeneration on both sides (decision + tombstone). `packages/rules/src/parked.test.ts` checks
the quotes are really there.

## The deck

**63 → 67 convention cards.** Five retired, nine added; re-sitting cost is **9 new cards** for the owner —
one per genuine trigger moment, plus the one honest residual. Rules total 110 → 114, retired 43 → 49.

The re-sitting cost is not an estimate: after the rebase onto the restored decision set, `undecided()`
returns **exactly 9 rules — and they are exactly the nine new trigger cards.** Every other rule in the
rulebook is already decided (95 approved, 10 revised). The split cost the owner nine clicks and nothing else.

`docs/docbot2/final-report.md` updated to match (the doc-drift rail caught it, as designed — including two
numbers that were already stale on `main` before this branch: `needs-ruling` read 72 and the sabotage-proof
denominator read 51).

## Rebase note — the gilding merge

This branch predated the WP-D gilding work (#1280), which rewrote the same `familyQuestions` renderer. The
mechanical union interleaved two different rewrites into nonsense, so the resolution was: keep this branch's
cluster/parked structure and **re-apply main's gilding work on top of it**. Ported verbatim from
`origin/main`: `gildClaimFor()` with `OWNER_GILD_NOTES` (the owner's `avenge` / `castPayoff` / `echo`
annotations), `GILD_DEFAULT`, `GILD_NONE`, and the R-GILD-02 spells-never-gild / mixed-family derivations —
plus `QUEST_ARCHIVE_NOTE` on both quest-shape cards, the reworded `q-conv-global-gild-default` card, and the
`PARKED BY ARCHIVE` note on henchman pricing, all of which the verbatim restore had also dropped.

The **new trigger cards carry the gilding claim too** — `gildClaimFor` is keyed on the family name, and the
three families the owner annotated were all single-trigger and therefore untouched by the split, so the
re-clustered cards correctly fall through to the derived claim rather than inheriting someone else's note.
The residual card takes its gilding claim in `currentBehaviour` only: folding it into the statement would
assert one convention over cards that, by that card's own admission, share nothing. Parked classes emit no
cards, so they emit no gilding claims either.

- new: `packages/rules/src/parked.ts`, `packages/rules/src/parked.test.ts`,
  `packages/sim/src/docbot/conventionCohesion.test.ts`
- changed: `conventionQuestions.ts` (the re-cluster), `contractExtract.ts` (the stamp),
  `contractCorroboration.ts` + `contractOracle.ts` (measure-don't-assert), `contracts/schema.ts`
  (`ParkedContract`), `registry/retired.ts`, `registry/decisions.json`, `contracts-extract.ts` (the PARKED
  report block), `apps/web/vite.config.ts` (the `@game/rules/parked` alias — it must precede the bare
  `@game/rules` alias or it resolves to `…/index.ts/parked`).

No patch notes: nothing player-facing changed.
