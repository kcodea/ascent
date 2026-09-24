# 2026-09-24: Spell effects and sounds from every source (the Dragonflame disconnect) + Great Pot's cast effect

Owner report, verbatim:

> dragonflame animation is not playing from the gilded ledger etc. why? all spell animations and sfx should be wired
> to play whenever a spell or minion is cast/played from any source. can you find the disconnect?

Same day, same branch: the owner authored a Great Pot cast effect (`fx/defs/greatpot.json`, sound clip `bloodpot`)
and asked for it to be wired like Growth and Waking Rift, from every source and in every phase.

Stacks on #1679 (the rune cast flourish).

## Root cause

Not the UI. #1676 already routed a rune's Dragonflame buff to Dragonflame's column (`playRuneCastBuffFx`), keyed on
the buff record's `spellId` + `sourceRuneId`. The records never had them.

- `applyCastEffects` (recruit.ts) runs each cast effect inside ONE `captureBuffFx(…, 'spell', …, spellId, runeId)`,
  the capture that stamps the tag.
- Dragonflame's factory `spellBuffRandomPerTribe` (recruit.ts, the R-REPEAT-01 per-repeat capture, then line ~8676)
  opens its OWN `captureBuffFx(ctx.state, undefined, 'spell', …)` per repeat, with no tag.
- `captureBuffFx` skips any target a nested capture already recorded (`innerTargets`), so the tagged outer capture
  recorded nothing, and every Dragonflame record went out as a plain sourceless spell buff.
- The Shop replay (`replayBuffFxEvents`) saw no `sourceRuneId` and drew the generic descend. No column, no
  `sfx.dragonflame`. Same for a minion's cast (Mage-Pup taught Dragonflame, Flamebeat Drake's shop Rally).

Reproduced: Gilded Ledger at 6/7 Gold, two Dragons and a Beast, `rngCursor` 4, one Refresh. Before: 3 records,
`kind: 'spell'`, no `spellId`, no `sourceRuneId`. After: all three tagged.

The same nested-capture shape was in Great Pot (`buffOnePerTribe`, per recipient) and the targeted Gifts (Ironclad
Favor, Unbridled Might, Parting Gifts). No other `on: 'cast'` factory has it.

## Fix

Sim (`packages/sim/src/recruit.ts`):

- `castTagStack`: `applyCastEffects` pushes `{ spellId, runeId, casterUid }` for a tagged cast (a rune or a minion
  actor; the player's cast stays untagged, as before).
- `captureCastBuffFx(state, run)`: a cast factory's own nested capture, reading that tag. Used by Dragonflame,
  Great Pot and the three Gifts. Only those five use it, so a rune reaction that fires inside a cast (a summon
  overflow, a gain-card rune) never borrows the spell's tag.
- `BuffFxEvent.castByUid` (state.ts) and `statsChanged.castByUid` (core presentation events): the MINION that cast
  it, the twin of `sourceRuneId` / `castByRune`, so a travelling row can leave the caster's body.

UI:

- `playCastFanOutBuffFx` (fx/spellCastFx.ts): THE per-buff play for every non-player caster. `buffedOn`
  (Dragonflame) plays on the minion; `buffed` (an Ale, Great Pot) travels from the rune node, from the caster, or
  lands on the minion when there is no source. The row's sound goes through `spellCastSoundAllowed` (the 120 ms burst
  gap). `playRuneCastBuffFx` now delegates to it.
- Shop + legacy End of Turn (`replayBuffFxEvents`): a tagged buff that is not a rune's plays the row from its
  caster (`castByUid`, else `sourceUid`) instead of the descend.
- Authoritative End of Turn: new `castFanOutGain` presenter hook for a minion's gain.
- Combat (`fireBuffCasts`, and the self-buff branch): a `buffed` row plays from the caster instead of the tendril.
  Dragonflame keeps its existing `buffWave` path.
- The player's volley (`runSpellCastFire`, `runBuffedOnFire`) now drops the Sound layer on every play after the
  first, so a def with a Sound layer (Great Pot's `bloodpot`) rings once per volley.
- The player's own claim (`spellHits`, `aleOwned`) excludes `castByUid` records, so a minion's cast in the same
  action is never swept into the player's volley.

Great Pot: `bindings.json` `greatpot` -> `{ def: 'greatpot', fanOut: 'buffed' }`. The def's anchors are cursor /
travel / target, so it is a per-buff travelling row exactly like the Ales: cursor = the release point (hand), the
rune node (rune), the caster (minion); target = the buffed minion. The row replaces the tendril per buff. The def's
layer values are untouched; its clip `bloodpot` resolves to `audio/bloodpot.wav`. Great Pot has no combat
resolution (`buffOnePerTribe` is not a combat factory), so it never casts in combat.

## Audit: spell × source, BEFORE -> AFTER

A = the spell's own animation, S = its own sound. Only Dragonflame (`cards/sp_dragonflame.effect.mp3`, via the
binding and via `sfx.cardEffect` on combat `sc`), Growth, Waking Rift, Lasso and Great Pot have a spell-specific
sound; the Ales have none anywhere.

| Spell | Player (hand) | Shop rune (Ledger, Spell Market, Recurrence, Might, repeat runes) | Shop minion (Mage-Pup, shop Rally) | End of Turn (authoritative / legacy) | Combat (minion / Spellhide rune) |
|---|---|---|---|---|---|
| Growth, Waking Rift | A S | A S | A S | A S | A S |
| Dragonflame | A S | **descend, silent -> A S** | **descend, silent -> A S** | rune A S; minion **nothing -> A S** / legacy **descend -> A S** | A S |
| Great Pot (new) | **sparks + descend -> A S** | **descend -> A S** | **descend -> A S** | **-> A S** | n/a (no combat factory) |
| Bloody / Champion's / Defensive Ale | A | A (node) | **descend -> A (from the caster)** | rune A; minion **nothing -> A** | **tendril -> A** |
| Golden / Reinforcing Ale (no buffs) | A (single play) | **flourish only -> A on the node** | **nothing -> A on the caster** | **nothing -> A (node / caster)** | **nothing -> A on the caster** |
| Rubies | A S | A S | A S | A S | A S |
| Lasso | A S | Lassoing: A S from its badge; any other rune: **hand row -> that rune's badge** | Rope Wrangler A S from its body; other minion casts **hand row -> the caster** | A S | n/a |
| Staff of Guel (`shop-buff-purple`) | A | A | A | authoritative: **nothing -> A**; legacy A | A |
| Unbound spells | sparks + `castSpell` | flourish + stock trail from the node | cast preview + descend | same | tendril |

Generic cast sound (`sfx.castSpell`): BEFORE, only the player's hand cast rang it; a rune cast (flourish) and a
minion cast (cast preview) were silent in every phase. AFTER: every cast rings it (Shop records, both End-of-Turn
paths, combat `sc`), through one per-spell burst gate (`playGenericCastSound`, 120 ms) that the player's own cast
uses too, so a repeat rune's share of the player's cast, two Fatecarvers, or a rune's "twice" ring once.

Combat Dragonflame: BEFORE, a cast NOT on a swing (Spellhide's re-cast, any standalone buff wave) played the column
TWICE per unit (the `fxDef` `buffedOn` branch and `fireBuffCasts`). AFTER: once (`fireBuffCasts` owns it). A cast on
a swing (Flamebeat Drake, Warflame) was already once.

## Minion arrival, BEFORE -> AFTER

| Path | Animation | Sound |
|---|---|---|
| Player plays from hand | plate dissolve, `landing-dust`, `cardpop`, `minionPlayed` def, Ward blast | `play`, `cardVoice`, `cardEffect` (Battlecry), `summon(token)`, `taunt`, `shield` |
| Battlecry token (same action) | `cardpop` (delayed) **+ `landing-dust`** | `summon(tokenId)` |
| Rune / hero power / quest / Discover-to-board / spell summon (Shop) | `cardpop` **+ `landing-dust`** | **none -> `summon` (+ token voice)** |
| End of Turn summon (authoritative `cardSummoned`) | `cardpop` **+ `landing-dust`** | beat glow / pulse **+ `summon`** |
| Combat summon | `summonpop` + `landing-dust` | `summon(cardId)` once per moment |

The summon sound is gated PER CLIP (`summonClipAllowed` in sfx.ts, the 120 ms burst gap): a mass summon rings the
general `summon` pop once and each token's own voiceline once. The player's own play is excluded from the Shop arrival
watcher (`playerPlacedRef`), since it already lands with dust and its play sound; a gild keeps its own animation.

## Follow-up (same day): the owner's answers, relayed

The coordinator relayed the owner's answers to the open items: the ask ("all spell animations and sfx should be wired
to play whenever a spell or minion is cast/played from any source") and the cross-phase default already decide them.

1. Rune and minion casts ring the generic cast sound. Done (`playGenericCastSound`).
2. Golden / Reinforcing Ale from a rune or minion play the Ale's row once at the source. Done (`sourceOnlyCastRow`,
   `playCastAtSource`, `playMinionSpellCastFx`): the rune node, the caster's body, or the combat caster.
3. Lasso from any rune or minion leaves the real caster. Done in the sim: `applyCastEffects` defaults `_origin` to
   `rune:<id>` / `board:<uid>` from the cast actor; `fireLassoBeam` reads `rune:<id>`.
4. Staff of Guel on the authoritative End of Turn. Done: the trigger scope emits `auraChanged` `shopBuff` when
   `tavernBuyBonus` rises, and the new `shopBuffAll` presenter hook plays the `shopBuffAll` cue.
5. Minion arrival from any source. Done (table above).
6. Equipment stays excluded (R-PRESENT-10).
7. Combat Dragonflame double play. Real, fixed (`score.ts`, the `fxDef` `buffedOn` branch skips a buff whose spell
   has an authored per-buff def).
8. Rune of Lassoing + Rope Wrangler: REPORT ONLY. Confirmed a gameplay gap: Rope Wrangler's `castSpell` recruit
   factory (recruit.ts, `castSpell: (ctx, self, params, payload)`) calls `applyCastEffects` directly, while
   Lassoing's +2/+2 lives in the `castSpell()` FUNCTION, so the Wrangler's End-of-Turn Lasso steals but the board
   gains nothing (probe: stray stays 2/2). The same bypass skips Spellweaving and the rest of `castSpell()`'s
   bookkeeping for every minion using that factory (Soul Defiler's Staff of Guel too). Pinned as a known-gap test;
   needs an owner go-ahead to change.

## Tests

Follow-up: `packages/sim/src/spellFxEverySource.test.ts` gains the Lasso origin (Mage-Pup, Rune of Recurrence, the
player), the `shopBuff` aura (Soul Defiler at End of Turn) and the Lassoing + Wrangler known gap;
`packages/ui/src/fx/spellFxEverySource2.test.ts` covers items 1-5 and 7; `packages/ui/src/fx/summonSfxGate.test.ts`
the per-clip summon gate.


- `packages/sim/src/spellFxEverySource.test.ts`: Gilded Ledger -> Dragonflame (every repeat tagged with spell +
  rune) and -> Great Pot; a Mage-Pup's Dragonflame / Great Pot / Bloody Ale name the caster; Flamebeat Drake's shop
  Rally; the player's own cast stays untagged; the End-of-Turn `statsChanged` carries `castByUid`. 7 of 9 fail
  without the sim fix.
- `packages/ui/src/fx/spellFxEverySource.test.ts`: Dragonflame from a rune and a minion (column on the minion, one
  sound per burst, a later wave rings again); Great Pot binding, player volley (one `bloodpot`), rune (from the
  node), minion (from the caster); the End-of-Turn presenter hook; the Shop / combat routing order.
- `packages/ui/src/choreo/bindings.test.ts`: the `greatpot` row.

## Live check (port 5287, throwaway run)

Ledger at 6/7 Gold, Refresh: `rune-cast-flourish`, then `dragonflame` x3 on the buffed Dragon, and three 1.2 s
sample starts (the Dragonflame clip, one per repeat wave). Great Pot from the Ledger: `greatpot` x2 (one per type),
one `bloodpot` start. No console errors.

## Live check, follow-up (port 5287, throwaway run)

- Gilded Ledger rolling Dragonflame: flourish, 3 `dragonflame` plays, the Dragonflame clip per wave, and now the
  cast clip once.
- A Mage-Pup taught Golden Ale, played from hand: `coin-ale` on the Pup, plus the cast clip.
- Two Strays put on the board by a non-player source: `landing-dust` on each, the summon pop and the Stray's voice
  once each (the per-clip gate).

## Oracle

R-PHASE-01 (foundation) amended with the owner quote, the tag rule, the shared per-buff play, and the open items.
