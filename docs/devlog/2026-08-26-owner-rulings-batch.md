# 2026-08-26 — Owner rulings batch: the triage board's 23 decisions, executed

The owner clicked through the full Rulebook triage board (22 cards + 1 stale) and the decisions landed in
`packages/rules/src/registry/decisions.json` (committed here — it was live-written by the dev-server
endpoint). This PR executes every ruling.

## Implemented (9 confirmed gaps → real behaviour)

Shop-side halves for six Echo/death-watcher minions, all dispatched through the new
`fireOnFriendDeath` helper (wired at the shop's three death sites) + seven new `RECRUIT_FACTORIES`:

- **Malphas** — Echo buffs the Shop (+8/+8) when fired in the shop phase (`deathrattleBuffShopPermanent`).
- **Runesnout Archivist** — Echo casts remembered spells on random friendly Beasts (`echoCastRememberedSpells`).
- **Scavvers** — Echo triggers adjacent Rallies via `fireShopRally` (`deathrattleTriggerAdjacentRally`).
- **Ashen Heir** — shop-destroyed Imps hand stats to a living Imp, else bank on `impBank`; the bank pays out
  to the next shop-summoned Imp (`impInheritOnDeath` / `impInheritOnSummon`).
- **Brood Matron** — friends dying in the shop breed Imps, `bredThisTurn` capped at 3, reset at rollover
  (`onFriendDeathSummon`).
- **Echo Mimic** — copies a shop-dead friend's Echo onto `grantedEffects` (`onFriendDeathGainEcho`).

Plus two cross-phase folds: **Reflector** spreads mid-combat Rubies once per fight (combat
`onRubyPlayedSpreadRandom`), and **Veinstorm** folds spell power into its Rubies. **Pack Leader**'s text now
says "played in the Shop". All pinned by `packages/sim/src/ownerRulings20260826.test.ts` (10 tests).

## Encoded (14 confirmations + overrides)

- 8 phase silences upgraded from `needs-triage` to `OWNER RULED` in `phaseRegistry.ts`; the factoryPhase
  triage ratchet is now **0**. `SPELL_POWER_EXCUSED` likewise (Veinstorm entry deleted; `rubyStatGain` ruled
  flat-by-design).
- **Cratering Hulk override**: the owner's two board REJECTs were reversed in chat — "combat only actually
  since the text says that" — with the standing note that shop-phase overflow triggers stay legal for
  non-combat-specific cards (Flowing Monk precedent). Both decisions overridden to approve, quote preserved.
- **Retired-rules tombstone** (`packages/rules/src/registry/retired.ts`): resolved queue items leave the
  pending board but their decisions must not dangle — 19 ids retired with dispositions (incl. the stale
  pre-audit `q-combatinert-b2_echohorn`). Integrity test now allows decisions on retired ids and checks each
  tombstone carries a real disposition.
- **Hunch staged** in the hero scan (a prior spell cast armed) — heroPowerLane silent pin 25 → 24.
- Reseed: the pending board is down to the **4 standing policy/watch cards**; floor lowered 15 → 4.

## Proposed (not implemented)

`docs/rulebook/rune-duplicate-stacking-proposal.md` — per-family duplicate stacking rules answering the
owner's REJECT on `q-policy-rune-duplicates` ("duplicates must always do SOMETHING"), with a ship-first
forge-filter + sweetener PR and Doc Bot enforcement once ruled.
