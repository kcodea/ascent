# 2026-09-16 — Set 3 batch 2, tranche C: Rebirth, Amplified Equipment, six cross-system runes

**Branch:** `feat/set3-runes-c` → base `feat/set3-runes-batch2`. Sibling tranches A (Spirit / Reveler / Shop-spell
runes) and B (Starform consume/collapse + Equipment cost runes) landed in parallel; this tranche owns the core
Keyword union + the combat simulator, the Equipment **Amplified** state, and four cross-system runes.

## Owner rulings implemented

1. **Rebirth** is a NEW keyword (`RB`, distinct from Rise): a dying minion returns ONCE with its full current
   body — stats, granted buffs, keywords, effects. Combat: a new branch at the top of `killOrReborn` (before the
   Rise branch); shop: `rebirthReturn` beside `riseReturn`, wired into both shop death paths. Ordering rules
   chosen and pinned (`core/src/combat/rebirth.test.ts`, documented in GAME-RULES): Rebirth before Rise; the
   Echo fires on the Rebirth death and the body returns to the right of what it summoned; the death is a real
   death; a Ward carried at any point this fight is restored (`wardBroken` set); Taunt etc. retained; NOT a
   Rise (`onRise` silent); IS a summon in full; full board = overflow; not re-armed. Presentation reuses the Rise
   beat / FX (`reborn { rebirth: true }`, the Card dome, the `rise` glyph) as placeholders.
2. **Rune of Rebirth** (`rune_rebirth`, id kept) now grants Rebirth to one random friendly minion at Start of
   Combat (a `keyword RB` event on its own beat). The old exact-copy Echo graft, its `sc.grantsEcho` marker and
   the UI's per-body `[[Rebirth]]` text tag (`rebirthOwner` / `grantedEcho` / `rebirthTag.test.ts`) are retired —
   the keyword pill is the per-instance read now. The recruit-side SoC replay grants a permanent `RB`.
3. **Amplified** Equipment state: `PlayerEquipmentState.amplified` (per Equipment id, capped at 1), consumed by
   the next activation which then runs `(1 + extra) × 2` triggers; survives the Start-of-Turn rebuild for
   Equipment still held. `GrantedEquipment.usedThisTurn` records activation (pool or own charge) for Rune of
   Amplification's End-of-Turn pass. UI: the charge tally turns BLUE (`.hpb-tally.amplified`), the tooltip says
   so, and `data-fx="equipment-amplified"` on the tally is the binding point for the owner's future cue.
4. **Red Giant**: `redGiantSpellBite` in `sim/starform.ts` — after every Starform Shop-minion consume, one seeded
   `rngCursor` roll (always advanced, so replays match regardless of the row); on a hit the spell slot (else the
   right-most spell offer in the row) leaves, a copy goes to hand via `conjureToHand`, the token gains +8/+8.
5. Every rune `sets: ['set3']`, tribe-gated where the text names a tribe; patch note prepended.

## The six runes

Basic (end of `RUNES`): **Amplification** (4, Universal), **Soul Script** (5, Undead + Celestial). Epic (end of
`EPIC_RUNES`): **Grand Workshop** (6, Universal), **Red Giant** (5, Celestial), **Final Gate** (6, Undead),
**Dreamed Graves** (4, Undead). New reward kinds `runeAmplification` / `runeGrandWorkshop` / `runeRedGiant` /
`runeSoulScript`; new combat flags `runeFinalGate` / `runeDreamedGraves` (+ presentation-policy rows).

- **Soul Script** — the Starform counts as Undead through the existing tribe predicates, not card by card: the
  token's stand-in carries `addedTribes: ['undead']` (every `isTribe` reader — consume watchers, tribe filters);
  `starformSpellAimsToken(def, state)` lets an Undead-aimed friendly spell aim it (the reducer passes state; the
  UI's aim sites still pass the def alone, so an Undead-aimed spell's reticle does not yet reach the token —
  follow-up for the UI owner); the Undead ATTACK Aura is baked onto the token at purchase / creation
  (`starformSoulScriptBake`, latched per token) and every later `buffUndeadAttackEverywhere` lands live; the
  `battlecryBuffTribe` recruit chokepoint sends "your Undead +a/+h" to the token; `auraFxTargets` washes it.
  "Consumed by Undead" is satisfied by the shared Shop-consume body (any eater, the token included) — there is
  no tribe-restricted consume in the codebase to widen.
- **Final Gate** — `finalGateGraves` records every Undead that REALLY died (printed body, death order; a
  Rise/Rebirth whose return overflowed counts, one that came back does not). The wipe check mirrors the
  Crucible's, runs AFTER it inside the same `withEchoDefer`, fires once per combat, draws three without
  replacement via the combat rng, and summons printed bodies.
- **Dreamed Graves** — `pendingHandSummon[side]` is set by the two hand-summon ctx paths (`summonCopyFromHand`,
  `takeRandomHandMinion`) and consumed by `placeSummon` (landed or overflowed); the first landed hand-summon
  gains `RB` on its own beat. Fixing this exposed that `summonCopyFromHand` stamped `fromHandUid` on "the last
  event" — now found by uid.

## Verification

`core/src/combat/rebirth.test.ts` (19), `sim/src/set3RunesTrancheC.test.ts` (18), `runeRebirthMark.test.ts`
rewritten, the old Rune of Rebirth combat test updated, `RUNES.length` 142 → 144. Full gates: typecheck, lint,
test, audit, text:audit, docbot, build:web (see the PR).

## Follow-ups

- Rebirth FX / glyph and the Amplified cue are owner-authored; both have binding points, nothing plays yet.
- UI aim for Undead-aimed spells on a Soul Script token (pass `run` into the five `starformSpellAimsToken`
  call sites in `Recruit.tsx`).
- `boardFeatures.TRACKED` deliberately excludes `RB` — its length feeds the trained board model's feature vector.
