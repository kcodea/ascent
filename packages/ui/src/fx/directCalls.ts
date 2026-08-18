/**
 * Which defs the GAME plays by calling `playDef('<id>', …)` straight from code, rather than through a
 * `choreo/bindings.json` entry.
 *
 * WHY THIS EXISTS. The FX library's coverage map only ever knew about bindings, so "no binding" was rendered
 * as "nothing plays this". That was true right up until the migration that moved `coins`, `click-puff`,
 * `damage-burst`, `landing-dust`, `impact-dust`, `death-dissolve` and `strike-impact` out of hand-written
 * `pixiFx` methods and into defs fired directly — at which point seven effects that play constantly began
 * displaying as inert, and the one label "unbound" started covering three different truths. This module is
 * the third truth.
 *
 * WHY IT CANNOT DRIFT. It is a committed SNAPSHOT of `scanDirectCalls()` over `packages/ui/src`, and
 * `directCalls.test.ts` re-derives that scan from the real files on every `npm test` and asserts it equals
 * what is written here. Add a direct call and forget to update this file and CI goes red, naming the def and
 * the file. The alternative — a hand-kept list — would rot on exactly the next migration, which is the defect
 * this fixes, so the enforcing test is the load-bearing half of the mechanism, not a nicety.
 *
 * To regenerate after adding a call: run `npm test`; the failure prints the expected object.
 *
 * THE LIMIT, stated rather than hidden. The scan reads string LITERALS. A call whose id is an expression
 * cannot be resolved without running the game, so those sites are listed in `DYNAMIC_CALL_SITES` below and
 * surfaced in the library's by-event lens instead of being quietly dropped. Today every one of them is
 * `choreo/score.ts` playing `binding.def` — i.e. the binding path, which the coverage map already shows in
 * full — so nothing is currently under-reported. The test pins that set, so a NEW dynamic call site fails CI
 * and has to be looked at rather than silently shrinking the map.
 */

/** def id → the `packages/ui/src`-relative files that fire it. Generated; see the header. */
export const DIRECT_CALL_SITES: Readonly<Record<string, readonly string[]>> = {
  'ale-bubbles': ['Recruit.tsx', 'choreo/score.ts'],
  'click-puff': ['Recruit.tsx'],
  coin: ['Recruit.tsx'],
  coins: ['useCombatReplay.ts'],
  'damage-burst': ['Recruit.tsx', 'useCombatReplay.ts'],
  'death-dissolve': ['useCombatReplay.ts'],
  'freeze-blast': ['FreezeButton.tsx'],
  'hero-power-spark': ['StatusBar.tsx'],
  'hero-power-target': ['Recruit.tsx'],
  'impact-dust': ['EndTurnButton.tsx', 'RefreshButton.tsx', 'choreo/channels/impact.ts'],
  'landing-dust': ['Recruit.tsx', 'useCombatReplay.ts'],
  // Recruit.tsx dropped off this list on 2026-08-08: the SHOP half is now played through a
  // `bindings.json` row (`rubyLanded`) by the recruit cue runner, not by a hardcoded id. The combat
  // half in score.ts is still a literal — see RUBY_LANDED_DEF.
  'ruby-gem-apply': ['choreo/score.ts'],
  'shop-tier-up': ['TavernUpButton.tsx'],
  'strike-impact': ['choreo/channels/impact.ts'],
  'watcher-pulse': ['useCombatReplay.ts'],
};

/**
 * `playDef` calls whose def id is an expression — the scan's blind spot, counted per file on purpose.
 *
 * All five are `score.ts` firing a resolved binding's `def`, which is how a BINDING plays; they are not direct
 * calls and must never be counted as one. (Four are the `fxDef` cue's fan-out branches — primary, damaged,
 * selfBuffed and buffed; the fifth is the `rallyFx` cue, which resolves a binding per rally event rather than
 * per moment — see `channels/rallyFired.ts`.) Counts rather than line numbers: a line pin would go red every
 * time anything above it moved, which trains people to update it without reading — the opposite of a guard.
 */
export const DYNAMIC_CALL_SITES: Readonly<Record<string, number>> = {
  'choreo/score.ts': 5,
  // The shop's binding path, the recruit-phase twin of score.ts's. Five `playDef(binding.def, …)`: the
  // per-card cascade (`fireLand`), the shop-gem volley's single spanning play (`runShopRubiedSpan`), the
  // shop-wide buff aura's single camera-anchored play (`runShopBuffAllFire`), and the `spellCast` cast-FX
  // resolver `runSpellCastFire`'s point-only fire plus its per-target fire.
  'choreo/recruitCues.ts': 5,
};

/** The files that fire `id` from code, or an empty array. Never null — callers render a list either way. */
export function directCallSites(id: string): readonly string[] {
  return DIRECT_CALL_SITES[id] ?? [];
}

/** Ids the game plays from code, sorted — the "played from code" section of the by-event lens. */
export function directCallDefIds(): string[] {
  return Object.keys(DIRECT_CALL_SITES).sort();
}
