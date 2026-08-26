/**
 * DOC BOT TRIPWIRE 3 — raw tribe comparisons are FROZEN DEBT, not a pattern to copy.
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
 * all-types nuance changes no game rule; and pool-DRAW filters conceptually (whether an all-types card is
 * drawable as every tribe is an open balance question, owner-deferred 2026-08-26 in #1216) — but since those
 * live inside recruit.ts they sit inside its pinned count like everything else.
 *
 * PURE DATA on purpose — this module is re-exported through @game/sim's public entrypoint, which the web
 * bundle consumes, so it must not touch node:fs. The scanner lives with its consumers
 * (`tribePredicates.test.ts` and `packages/tools/src/docbot.ts`), both node-only.
 */

/** The correctness-critical files, each pinned at its 2026-08-26 count. Lower a number when you convert
 *  sites to the predicates; never raise one — implement via `isTribe` / `defIsTribe` / `isTribeOf` instead. */
export const TRIBE_RATCHET: Readonly<Record<string, number>> = {
  'packages/sim/src/recruit.ts': 49, // includes isTribe/defIsTribe's own definitional comparisons + owner-deferred pool-draw sites
  'packages/sim/src/reducer.ts': 14,
  'packages/sim/src/snapshot.ts': 3, // was 4; beastsPlayed converted to defIsTribe in the Doc Bot PR (see derivations.test.ts)
  'packages/sim/src/quests.ts': 1,
  'packages/core/src/combat/simulate.ts': 33, // has isTribeOf; 11 sites carry no universalTribe guard on the line — triage candidates
  'packages/core/src/effects/factories.ts': 36,
  'packages/core/src/effects/arena.ts': 13, // ⚠ 13 sites, ZERO universalTribe guards — the arena serves BOTH phases; top triage priority
};

export const PREDICATE_FILES = Object.keys(TRIBE_RATCHET);

/** The raw-comparison pattern, as source so each consumer builds its own (never-global) RegExp. */
export const RAW_TRIBE_COMPARE_SOURCE = String.raw`\.tribe2? [!=]== `;
