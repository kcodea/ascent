# Keshi the Protector — hero design

**Date:** 2026-08-16
**Branch:** `feat/hero-keshi`
**Status:** approved, ready for implementation plan

## Summary

A new hero, **Keshi the Protector**, whose passive power **Keshi's Crown** banks the tavern tier of every
card purchased and grants a **Triple Reward** each time the bank reaches 25.

The mechanic reuses an existing engine primitive verbatim: `grantGoldenDiscover()` in
`packages/sim/src/reducer.ts` is already the Triple Reward — the tier-frozen `discoverspell` a golden minion
grants when played. No new reward machinery is needed; the hero is a counter plus a call to that function.

## Hero definition

Added to `HEROES` in `packages/sim/src/heroes.ts`:

| Field | Value |
|---|---|
| `id` | `keshi` |
| `name` | `Keshi the Protector` |
| `blurb` | *Tend the tavern and it tends you — every card bought coaxes the crown into bloom.* |
| `resolve` | `30` (roster-wide default) |
| `armor` | `10` |
| `henchman` | none (optional field; deferred) |
| `wip` | not set — ships live in the picker |

Power:

| Field | Value |
|---|---|
| `name` | `Keshi's Crown` |
| `kind` | `crownTally` (new `HeroPowerKind`) |
| `passive` | `true` |
| `text` | `Get a **Triple Reward** every 25 shop tiers worth of cards you purchase.` |

**Armor rationale.** The roster runs 2–20, median ~14, with strong always-on passives sitting low (Emissary
Vale 7, Tradesman 9, Foreman Flint 10, Robin 2). Keshi's Crown is a repeatable run-long value engine —
projected ~140–150 banked points over a 17-round course, i.e. **5–6 Triple Rewards** — which is stronger than
Drakko's one-shot quest (armor 13). 10 places Keshi in the strong-passive band: the engine has to survive
early pressure before it pays.

## The rule

### What counts

**Any card purchased with Gold**, scored by that card's `tier` (1–7). Every `CardDef` carries a `tier`,
spells included (`CardDefSchema` in `packages/content/src/schema.ts`), so the value is always well-defined.

Five distinct buy paths exist in the reducer and **all five** must score:

1. Normal minion bought from the Shop (`case 'buy'`, main path)
2. Held / displaced minion bought back (`case 'buy'`, `offer.held` branch)
3. Spell bought from the right-hand spell slot (`case 'buy'`, `s.spell` branch)
4. Spell offer bought out of the minion row — Spell Cart (`case 'buy'`, `card.spell` branch)
5. `case 'buyHenchman'`

Anything acquired *without* a purchase does not score: Discovers, quest and rune grants, tokens, conjured
copies, triple-combine goldens.

> **Prior art for the split-path hazard:** `applySpellBought` originally fired only from the spell slot, so
> Moonhowl Mentor silently did nothing for spells bought from the minion row (owner report 2026-07-24). Every
> path gets the call, and the tests cover each one.

### Accumulate and pay out

A single helper, `keshiCrownBuy(s, def)`, following the established
`drakkoQuestBuy` / `chronosQuestBuy` / `gorrQuestBuy` shape:

```
if the run's hero is not keshi        → no-op
s.keshiTierPoints += def.tier
while s.keshiTierPoints >= 25:
    if the hand is full → break (hold the bank; see below)
    grantGoldenDiscover(s)
    s.keshiTierPoints = 0
```

**Overflow is discarded** — the counter resets to `0`, not to the remainder (owner spec: "start it back at 0
when that occurs"). Both precedents exist in the codebase; Cassen's `cassenKills` subtracts its threshold
instead. Keshi resets.

Since the maximum tier is 7 and the threshold is 25, a single purchase can never award two rewards. The loop
is written as a `while` regardless so the code cannot break if tiers or the threshold change later.

### What the reward is

`grantGoldenDiscover(s)` — unchanged, called as-is. It pushes a `discoverspell` card into hand with
`grantedTier: s.tier` frozen at grant time, so the "peek one tier up" is fixed to the tavern tier you were on
when it fired and taverning up afterwards cannot inflate it. This is *exactly* the reward from gilding a
minion and playing it, which is the stated design intent.

**Rune of the Corrupted Tome** rides along for free and is correct to inherit: it grants two Triple Rewards
instead of one, and Keshi's payouts get that too.

### Full hand — hold the bank

`grantGoldenDiscover` returns early and silently drops the card when the hand is at `handCap(s)`. Every other
hand-capped grant in the engine accepts that loss, but Keshi's entire power is this payout, so it gets special
handling: **the helper checks the hand cap first and holds the bank instead of paying out.** The counter stays
at 25 or more and pays on the next purchase that finds room. Consequences, all intended:

- The tally can legitimately read `27/25`. The UI prints `keshiTierPoints` raw, so no clamping.
- Tier keeps accruing on top while held — a purchase made with a full hand still banks its tier.
- The `while` loop `break`s on a full hand rather than spinning.

## State

One new field on `RunState` (`packages/sim/src/state.ts`):

```ts
/** Keshi hero: shop tiers banked toward the next Triple Reward (Keshi's Crown pays out at 25, then resets). */
keshiTierPoints: number;
```

Initialised to `0` in `createRun`. `RunState` is a plain serialisable object, so save/restore and replay
determinism come for free — no serializer changes.

## Presentation

### Policy registry (required — CI gate)

`packages/core/src/presentation/policies.ts` gains:

```ts
'hero:keshi:crownTally': { policy: 'passive', family: 'passive' },
```

`heroPolicies.test.ts` fails CI for any hero missing a registry entry, and fails again for any `hero:*` key
with no live hero behind it. Matching the other passive economy heroes (`hero:pete:contraband`,
`hero:flint:companyRate`, `hero:vale:unitedFront`).

### Hero panel

`packages/ui/src/StatusBar.tsx`:

- **`powerTally`** (the Avenge-style numerals above the diamond) — new case returning
  `` `${run.keshiTierPoints}/25` ``. Always shown; the power never completes, so it never fades.
- **`powerLine`** (the line under the hero name) — passive branch reading
  `Keshi's Crown · 14/25`, alongside the existing `quest` / `questChronos` / `collision` counter lines.

This satisfies the CLAUDE.md live-value rule: the displayed number is the real current bank, not a static
placeholder.

## Art

The owner-supplied masters:

- `C:\Users\micha\Desktop\Reference Art\Keshi the Protector.png` → `packages/ui/src/art/heroes/keshi.png`
- `C:\Users\micha\Desktop\Reference Art\keshi hero power.png` → `packages/ui/src/art/powers/keshi.png`

Then `npm run optimize-art`, which downscales to ≤512px WebP and removes the PNG (masters stay out of repo).
`art.ts` picks both up automatically via `import.meta.glob` keyed on the hero id — no wiring code.

**Known cosmetic caveat:** the power button is a circle with `object-fit: cover`, and its README asks for a
transparent background. The supplied wreath image carries the full forest backdrop, so the button will show
green around the wreath rather than a clean cutout. Accepted as-is; swapping in a cutout later is a drop-in
file replacement.

## Testing

New tests in `packages/sim/src/run.test.ts`, alongside the Drakko and Chronos quest tests:

1. **Accumulation** — buying a tier-6 minion moves the counter 0 → 6; a tier-1 minion adds 1.
2. **All five buy paths score** — one case per path (shop minion, held minion, spell slot, spell in row,
   henchman), asserting the counter advanced.
3. **Payout at the threshold** — crossing 25 grants exactly one `discoverspell`, carrying
   `grantedTier === s.tier`.
4. **Reset, not carry** — a purchase taking the bank to 27 leaves the counter at `0`, not `2`.
5. **Repeatable** — a second 25 pays out again.
6. **Hero-gated** — a non-Keshi run never accumulates (mirrors the existing `t.drakkoBuys` check).
7. **Non-purchase grants don't score** — a Discovered or quest-granted minion leaves the counter untouched.
8. **Full hand holds the bank** — crossing 25 with a full hand grants nothing and leaves the counter at 25+;
   a later purchase made with room pays out and resets.

Existing gates that must stay green: `heroPolicies.test.ts` (registry entry), the run determinism test, and
`npm run typecheck && npm run lint && npm test && npm run build:web`.

## Files touched

| File | Change |
|---|---|
| `packages/sim/src/heroes.ts` | `crownTally` added to `HeroPowerKind`; the `keshi` `HeroDef` entry |
| `packages/sim/src/state.ts` | `keshiTierPoints` field + `createRun` init |
| `packages/sim/src/reducer.ts` | `keshiCrownBuy` helper; called from the 5 buy paths |
| `packages/core/src/presentation/policies.ts` | `hero:keshi:crownTally` policy entry |
| `packages/ui/src/StatusBar.tsx` | `powerTally` case + passive `powerLine` case |
| `packages/ui/src/art/heroes/keshi.webp` | portrait (via `optimize-art`) |
| `packages/ui/src/art/powers/keshi.webp` | power button (via `optimize-art`) |
| `packages/sim/src/run.test.ts` | the seven tests above |
| `docs/devlog.md`, `docs/roadmap.md`, `README.md` | required per-commit doc updates |

## Out of scope

- A henchman for Keshi (the `henchman` field stays unset).
- Bespoke FX or SFX for the payout — it reuses the existing Triple Reward presentation.
- Any change to `grantGoldenDiscover` itself or to how Triple Rewards behave for other heroes.
- Rebalancing the 25 threshold after playtest — a one-number change if it lands wrong.
