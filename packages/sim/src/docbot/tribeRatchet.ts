/**
 * DOC BOT LANE `tribePredicates` — raw tribe comparisons are FROZEN DEBT, not a pattern to copy.
 *
 * The owner's ruling (2026-08-26): "all types need to trigger all types of interactions." The shared
 * predicates — `isTribe`/`defIsTribe` in the shop, `isTribeOf` in combat, `arena.isTribe` in the arena — are
 * what know that (plus the Anomaly Reactor's `allTribes` mark and spell-added tribes). A hand-rolled
 * `x.tribe === 'beast' || x.tribe2 === 'beast'` knows none of it, and four owner-reported bugs in one day
 * (Voicekeeper, Trade-In, Pack Leader, the snapshot drift) were exactly this shape.
 *
 * 145 raw comparisons predate the ruling. Rewriting them wholesale in one PR would be an unreviewable
 * balance-relevant diff, so instead: a RATCHET. Each correctness-critical file's count is pinned; it may only
 * go DOWN. Adding a raw comparison anywhere in these files fails CI with instructions to use the predicate;
 * converting sites lets you lower the pin, and the pin never rises again.
 *
 * Deliberately NOT covered: bots/, productionBots/, buildTags, boardFeatures — heuristic scoring where
 * all-types nuance changes no game rule. Pool-DRAW filters are NOT exempt any more: the owner ruled 2026-10-21
 * (R-ALL-TYPES-EVERYWHERE-01) that an All-types card belongs to every tribe's pool, so they use the predicates too.
 *
 * PURE DATA on purpose — this module is re-exported through @game/sim's public entrypoint, which the web
 * bundle consumes, so it must not touch node:fs. The scanner lives with its consumers
 * (`tribePredicates.test.ts` and `packages/tools/src/docbot.ts`), both node-only.
 */

/** The correctness-critical files, each pinned at its 2026-08-26 count. Lower a number when you convert
 *  sites to the predicates; never raise one — implement via `isTribe` / `defIsTribe` / `isTribeOf` instead. */
export const TRIBE_RATCHET: Readonly<Record<string, number>> = {
  'packages/sim/src/recruit.ts': 7, // 2026-10-21: every remaining def/instance tribe filter became defIsTribe / isTribe / isTribeNatural (R-ALL-TYPES-EVERYWHERE-01); the 7 left are definitional, comments, or non-card params. 2026-10-20: Deep Delve Writ's steal pool became `offerIsTribe` (R-WRIT-ALL-TYPES-01). 2026-09-27: 11 run-tribe gates became core `inRunTribes` (Practice Tribes). Earlier: 2026-09-19: auraFxTargets' shop branch + fireOnGainCard's Heavy Payroll gate became defIsTribe
  'packages/sim/src/reducer.ts': 5, // 2026-10-21: tribe pools, the tribe drip, quest ticks and the buy watchers became defIsTribe (R-ALL-TYPES-EVERYWHERE-01). 2026-09-27: the tier-grant run-tribe gate became `inRunTribes`. Earlier: 2026-09-18: the sell case's Foundry check moved to recruit.ts (`settleMinionSale`) and became `defIsTribe`
  'packages/sim/src/snapshot.ts': 3, // was 4; beastsPlayed converted to defIsTribe in the Doc Bot PR (see derivations.test.ts)
  'packages/sim/src/quests.ts': 1,
  'packages/core/src/combat/simulate.ts': 24, // 2026-10-21: the unguarded Dragon / Kobold / Mech sites became isTribeOf / defIsTribe (R-ALL-TYPES-EVERYWHERE-01). 2026-09-27: the random-minion run-tribe gate became `inRunTribes`; has isTribeOf. The 2 sites with no guard on the line are a guard continued on the next line and the Centerline type read
  'packages/core/src/effects/factories.ts': 32, // 2026-10-21: the Ruby-play tribe filters and the random-tribe summon pools became bodyIsTribe / defIsTribe (R-ALL-TYPES-EVERYWHERE-01)
  'packages/core/src/effects/arena.ts': 11, // 2026-10-21: the Magnetic Mech grant pool became defIsTribe; the other 11 compare a param, not a card (2026-09-27: the Summit grant gate became `inRunTribes`)
};

export const PREDICATE_FILES = Object.keys(TRIBE_RATCHET);

/** The raw-comparison pattern, as source so each consumer builds its own (never-global) RegExp. */
export const RAW_TRIBE_COMPARE_SOURCE = String.raw`\.tribe2? [!=]== `;
