# 2026-11-21 Per-Ancient tendril FX: the routing (R-FX-ANCIENT-TENDRIL-02)

Owner ask: "create bespoke tendril effects for each of the 6 ancients when they trigger a combat or shop effect ... set
up the structure to quickly put in these new bespoke effects for each ancient using the FX workbench."

## Before

Every Ancient stat grant (R-FX-ANCIENT-TENDRIL-01) reached `fireBuffFx` as `cardId: ''`, `tribe: 'neutral'`, so all six
Ancients drew the same gold `rune-buff-trail`. The `trigger`-origin pairings (Frank, Warden, Midas x Bonds;
R-FX-ANCIENT-ORIGIN-01) drew the triggering minion's TRIBE tendril. Nothing downstream knew which Ancient fired.

## What shipped

- `packages/ui/src/fx/ancientTendrils.ts`: one def id per Ancient, `ancient-tendril-<death|fortune|war|genesis|time|bonds>`,
  looked up by id at fire time (`getDef`). Saving that id in the FX workbench makes it live; no code change. The stat roll
  lands on the def's ribbon `travelMs` (else its first target layer's `at`).
- `fireBuffFx` takes `ancient`: a saved def plays ahead of the tribe variants (so a minion-origin grant is still the
  Ancient's), with the generic trail's no-stacking sound rule. Unsaved: unchanged.
- Sim tag `BuffFxEvent.ancient`: set on every hero-power Shop record (`addBuff`'s tag and `markHeroPowerGrants`, which
  replaced six copies of the `fromHeroPower` loop in ancients.ts) and on a `trigger`-origin grant's minion-sourced record
  (`TRIGGER_GRANTS`, the capture twin of `SELF_SHARES`).
- Combat: `BuffCast.label` keeps the label when `from` moved the origin onto a body. Start/End of Turn hero beats pass
  their `label` to `heroPowerGain`.
- Power-name labels: "Rounded Spellbook" and "Pocket Magic" are Bonds-only. "Aegis" is BOTH Warden x Bonds and Warden x
  Time, so it resolves through the side's picked Ancient, which is known for the player only. A foe's "Aegis" grant plays
  the generic trail.

- The lookup never reads the def registry before the primitives register (`hasPrimitives()`): the registry caches its
  first read with unknown-primitive layers dropped, so an early `getDef` from `fireBuffFx` would have stripped EVERY def
  for the session. Pinned by `ancientTendrilReadiness.test.ts`.

First def: `ancient-tendril-genesis` (owner-authored, a beam plus a source and a target emitter; no ribbon, so the roll
lands on the target emitter's `at`, 120 ms). The other five Ancients play the gold trail until theirs are saved.
