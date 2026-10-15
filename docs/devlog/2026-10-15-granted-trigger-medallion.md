# Granted triggers show on the portrait medallion (2026-10-15)

Owner, with a screenshot of Hum carrying four kept Seed Echoes and no badge: "hum with the echo whisper on it should get
the echo badge, same for other minions that dont have a badge that takes precedence". Oracle R-MEDAL-GRANTED-01.

## What changed

- `resolveMech` (packages/ui/src/mechIcon.ts) now reads the card's printed effects PLUS `CardView.grantedTriggers`,
  then sorts them with the existing precedence (first text mention, then keyword order, then the global order). A
  printed badge that outranks the grant keeps the gem; a body with none wears the granted one. A granted `onAttack` /
  `onKill` graft counts as Rally / Slaughter on that body, never as a Watcher.
- `packages/ui/src/grantedTriggers.ts` builds the list. `grantedTriggersOfBoard` covers Shop, hand, board, end screen,
  stored and scouted boards and the Sandbox foe (Seed stacks, permanent and temporary; `copiedEcho`; `grantedEffects`;
  an `echoStripped` copy drops its Echoes). `grantedTriggersOfSnapshot` covers the combat `Unit` and the Versus inspect
  view (the snapshot's new field, Seed stacks, the Auctioneer's Rally). Both return ONE shared frozen array per shape,
  so `cardViewEqual` (where it is now a reference-compared key) and the `Unit` memo comparator see no churn.
- Core: `MinionSnapshot.grantedTriggers` (deduped `{ on, do }` pairs), filled in `simulate`'s `snapshot()` from the
  live effects that are not the printed def's (identity compare). Seed stacks and `rallyTriggerOwnShout` are left out
  since they already ride `seedEchoes` / `grantedRallyShout`. Absent when nothing is granted, so existing logs are
  unchanged.
- Card memoizes the resolve on `cardId` / `keywords` / `text` / `grantedTriggers`.

Expiry is live by construction: `expireWhisperBuffs` clears `seedEchoesTemp` at the next Start of Turn, and the view
rebuilds without the trigger.

## Known gap

A trigger grafted DURING a fight (Grave Body's `grantDeathrattle`, Contract Rewrite) has no combat event of its own, so
that fight's medallion does not move. Fixing it needs a new combat event (shared `CombatEvent` vocabulary); not done.

## Verification

`packages/ui/src/grantedMedallion.test.tsx`: Hum with Seed stacks (kept and temporary) shows Echo; Haven Drake keeps
Shout when granted Echo; copied / grafted Echo; granted Rally graft reads Rally; stored and Versus views; shared-array
stability; a real Gardener -> Seed -> next turn flow drops the gem; the combat snapshot carries a graft (and not Seed
or printed effects); the combat `Unit` renders the Echo medallion.
