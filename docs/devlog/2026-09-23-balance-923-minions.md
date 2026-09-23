# 2026-09-23 — Balance 9/23, tranche 1: minion stat lines + simple number tweaks

Owner balance batch "9/23", the first tranche: the pure data changes. Fourteen minion stat lines and six
number/param tweaks, all in `packages/content/src/cards/**`; no engine change. (The mechanic rewrites in the
same batch — Conductor, Traveling Skald, Rope Wrangler, Soul Defiler, Moira, Impossible Todd, Muster General,
Exgalloper — are a separate tranche and were not touched here.)

## Stat lines (before → after)

| Card | Set | Before | After |
| --- | --- | --- | --- |
| Beggy | 2 | 1/2 | 2/3 |
| Chicken Brawl | 2 | 3/1 | 4/2 |
| Deepvein Tender | 2 | 1/2 | 2/3 |
| Geode Guardian | 2 | 3/3 | 4/3 |
| Imp Overseer | 1 | 1/2 | 3/3 |
| Kennelmaster | 1 | 1/3 | 2/4 |
| Mirrorwing | 2 | 2/4 | 3/4 |
| Right Hand Hank | 2 | 3/1 | 4/1 |
| Axeman | 2 | 4/4 | 2/2 |
| Dunkey | 2 | 4/6 | 5/6 |
| Gemline Martyr | 2 | 3/5 | 4/6 |
| Grobbus | 2 | 3/6 | 3/7 |
| King Oona | 2 | 4/6 | 6/6 |
| Sunmane Herald | 2 | 3/3 | 5/3 |

## Number / param tweaks

- **Embermouth Whelp** — `onBattlecryBuffSelf` +1/+1 → +1/+2 (gilded text +2/+4; the card already doubles).
- **Hellrider** — `onShopRefreshGainRightmostShopStats` `every: 4` → `every: 3`; same payoff.
- **Gemstorm Instigator** — `avengePlayRubies` `rubies: 2` → `3` (gilded 6); Avenge (2) unchanged.
- **Gem Sage** (rune-only) — now "When you cast a **Shop spell** on this, get **3 Rubies**." (gilded 6). This is a
  trigger swap, not just a number: `onGetRuby → onGetRubyDuplicate` became `spellCastOnThis → getRubies`, both
  existing primitives, so it stayed data-only. Verified by probe that a **Ruby** cast on the Sage does NOT fire it
  (Rubies go through `playRubyOn`, never `castSpell`), so there is no Ruby-for-Rubies loop; only real targeted
  Shop spells pay. The `onGetRubyDuplicate` factory is now unused by any card (left in place; not this PR's job).
- **Legion Shepherd** — Echo summons 2 Imps instead of 1 (gilded 4); the +5/+5 Imp buff is unchanged.
- **Staff of Guel** — `spellBuffShop` +3/+3 → +3/+4; text "Give minions in the shop **+3/+4** permanently."

## Rails that moved (numbers pinned in tests follow the owner's numbers; no intent weakened)

- `run.test.ts`, `shopBuffAllFx.test.ts` — Staff of Guel +3/+4 (buy buff, Fodder enchant, live text `{{+4/+5}}`).
- `set2Demons.test.ts`, `cardText.test.ts` — Shepherd 2 / 4 Imps (the plural live-Imp annotation now runs on
  BOTH texts); Hellrider fires on the 3rd refresh, the Market Tormentor ordering fixture sits at `eotTick: 2`.
- `contentBatchAug14.test.ts` — Grobbus 3/7; Hellrider titles.
- `runeMinionsAug20.test.ts` — the Gem Sage test now proves the new shape (a spell on another minion pays
  nothing; one on the Sage mints 3; gilded 6; a plain mint is no longer doubled).
- `recastMultiplier.test.ts` — the content-derived `spellCastOnThis` lane anchored on a
  `(ctx, self, params, payload)` signature; `getRubies` takes no payload, so the anchor now falls back to the
  three-arg form (indent-anchored so `getRubies` cannot land inside `endOfTurnGetRubies`). Same grading.
- `presentation policies` — `factory:onGetRubyDuplicate:onGetRuby` (ghost) → `factory:getRubies:spellCastOnThis`
  (ownBeat / economy, the bucket its `spellCastOnThis` siblings sit in).
- `KNOWN_TEXT_MISMATCH` — `k_gemsage` pinned as a **parser-limitation** (`wrong-trigger`): the grammar reads
  "When you cast a Shop spell on this" as the generic `spellCast` trigger; the extracted contract's
  `spellCastOnThis` is right and the text is the owner's wording.
- Generated registries regenerated through `npm run docbot:sync` (never hand-edited).
- `packages/tools/src/balance/aggregate.test.ts` is a synthetic fixture and did not move.
- `borrowedEcho.test.ts` (Shepherd's borrowed Echo lands 2 Imps), `set2Beasts.test.ts` (Oona 6/6),
  `set2Dragons.test.ts` (Embermouth grows to 3/4 off a shop Shout), `balance/strategy/packages.test.ts`
  (set-2 census: tempo 37/5 → 38/6 — a body moved into the tempo package).

## One real bug the batch exposed: the greedy bot could stall a lobby (fixed here, R-TARGET-04)

The full gate had the seed-4 drakko lobby stuck in `recruit` at round 15 (`runLobby.test.ts` "ends by
ELIMINATION", `replayV2.test.ts` "finished by elimination" + the two roundMarks tests that read the same run).
Probe: the greedy `DEFAULT_BOT` aimed **Appetite Agent** (a `targetTribe: demon` Shout) at a **2/3 Beggy** —
the balance pass had made Beggy the highest-scored body on that board — the reducer refused the off-tribe aim
and returned the SAME state, and `playOut` reads `next === s` as "the bot is stuck" and stops. The bot's
`pendingTarget` branch picked the best-scored body with no self / tribe check at all, so it was a latent stall
since the reducer grew its guards (tribe 2026-08-03, self 2026-09-18); the divergence just found a board that
hit it. **Fix** (`packages/sim/src/bots/policy.ts`): probe `reduce()` per candidate exactly as
`balance/pilots.ts` already does — best-scored LEGAL board body, then a shop or hand target, then
`cancelChoice`. Regression test in `bots/bots.test.ts`; approved rule **R-TARGET-04** in
`packages/rules/src/registry/approved/targeting.ts` (evidence: the found bug, the code, the test — no owner
ruling was needed, it restates R-TARGET-03 + the tribe guard from the automated player's side).

With the bot unstuck, seed 4 plays to the end and — for the first time — hits the NO-GHOST-REMATCH branch of
`ghostFor` (owner 2026-09-19): a fresher corpse was passed over because it would have been a rematch for the
bye holder. The "ghost is the most recently fallen seat" test predated that rule, so it is TIGHTENED rather than
excused: every passed-over fresher corpse must be a rematch (asserted from the encounter log), otherwise it
still fails.

## Doc drift rail (`docbot-report.test.ts`)

The Gem Sage trigger swap moved six headline numbers (contracts with direct execution, no-driver shapes,
interaction graph nodes / edges / candidate pairs / covered rows). `docs/docbot2/final-report.md` carried them
as literals; the generator's own header says headline numbers are `{{placeholders}}` filled at read time, so
those six literals are now placeholders (`{{contracts.withDirectExecution.of}}`, `{{contracts.noDriverForShape}}`,
`{{interactions.graphNodes}}`, `{{interactions.graphEdges}}`, `{{interactions.candidatePairs}}`,
`{{interactions.covered}}`) and the rail passes without anyone hand-maintaining a count again.

## Load-only timeouts (isolated, green)

`fightLedgerFetch`, `perfCounterNames`, `fx/directCalls`, `fx/primitives/prewarm` timed out in the full run under
load and pass in isolation — the known fx-timeout-under-load class, not this change.

Oracle: **R-TARGET-04** for the bot fix; the balance numbers themselves carry no rule. Patch note: "Balance 9/23: minions" (2026-09-23).
