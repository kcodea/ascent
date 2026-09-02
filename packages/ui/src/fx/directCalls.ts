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
  // The Auctioneer's Pulse — played on the TARGET minion instead of the generic `hero-power-target` spark.
  'auctioneer-hp': ['Recruit.tsx'],
  'choose-one-both': ['useChooseBothFx.ts'],   // the persistent (Both) marker on hand / shop / Discover cards
  'cia-hp': ['useCiaEnchantedFx.ts'],
  'click-puff': ['Recruit.tsx'],
  'tallyanimation1': ['Recruit.tsx'],   // the hero-duel tally→attack-pill effect
  coin: ['Recruit.tsx'],
  coins: ['useCombatReplay.ts'],
  'consume-pull': ['Recruit.tsx'],
  // Recruit.tsx dropped off on 2026-08-25: the defeat BOLT that played this on the Resolve bar was replaced
  // by the hero strike, whose impact goes through `playContactImpact` instead (see choreo/heroStrike.ts).
  'damage-burst': ['useCombatReplay.ts'],
  'death-dissolve': ['Recruit.tsx', 'useCombatReplay.ts'],
  // Bloodpot's USE def, called literally only by the tuner's test fire — the real play resolves it from the
  // Equipment's own `useFxId` (see the dynamic-site note below).
  'equipment-spark': ['EquipFxTuner.tsx', 'Recruit.tsx'],
  // The slot running out of uses. Fired from StatusBar because the allowance is what it is about, and the
  // slot is where the allowance is shown — there is no board unit to hang it on.
  'equipment-used-up': ['StatusBar.tsx'],
  'freeze-blast': ['FreezeButton.tsx'],
  'hero-power-spark': ['StatusBar.tsx'],
  'hero-power-target': ['Recruit.tsx'],
  'impact-dust': ['EndTurnButton.tsx', 'RefreshButton.tsx', 'choreo/channels/impact.ts'],
  'landing-dust': ['Recruit.tsx', 'useCombatReplay.ts'],
  // Recruit.tsx dropped off this list on 2026-08-08: the SHOP half is now played through a
  // `bindings.json` row (`rubyLanded`) by the recruit cue runner, not by a hardcoded id. The combat
  // half in score.ts is still a literal — see RUBY_LANDED_DEF.
  'ruby-gem-apply': ['choreo/score.ts'],
  'rune-buff-unit': ['Recruit.tsx', 'useCombatReplay.ts'],
  // The implosion on a rune's BADGE as the lock-in ceremony hands it over (owner ask 2026-08-31).
  'rune-select-implosion': ['useRuneArrivalFx.ts'],
  'rune-slot-break': ['QuestBadges.tsx'],
  'shop-buff-aura': ['useCombatReplay.ts'],
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
  // EQUIPMENT USE (2026-08-28). One `playDef(eq.useFxId, …)`: which def plays when an Equipment is used is
  // DATA — the Equipment names it, so a new one brings its own cue with no UI change.
  //
  // ARCHITECTURAL DEBT, stated rather than hidden: every other data-resolved def id comes from
  // `bindings.json` through one of the resolver files below, which is why "no dynamic call site outside the
  // binding resolvers" was true until now. An Equipment-use MOMENT belongs in `recruitCues.ts` alongside the
  // shop's other bindings; it lives at the cue site today because the moment/binding plumbing is a wider
  // change than the vertical slice called for. Moving it there deletes this entry.
  //
  // TWO of them since 2026-08-31: a Choose One Equipment plays its def when the PROMPT OPENS rather than when
  // the activation resolves (owner ask), so the same `eq.useFxId` is fired from a second site. Both are the
  // same data-resolved id; both go away together when the moment moves into `recruitCues.ts`.
  'Recruit.tsx': 2,
  // The same resolution in the TUNER's test fire: it plays the SELECTED Equipment's def so both cues can be
  // timed, rather than being hardwired to Bloodpot's. Same debt, same fix — moving the moment into
  // `recruitCues.ts` retires this line with the one above it.
  'EquipFxTuner.tsx': 1,
  // SIX since 2026-09-01: the `buffedOn` fan-out is a sixth `playDef(binding.def, …)`, playing ON each buffed
  // unit rather than travelling to it (Dragonflame). Same binding path, one more anchor convention.
  'choreo/score.ts': 7, // +1 on 2026-09-01: the `shoutFx` cue plays a `shout`-kind binding per re-fire proc
  // The shop's binding path, the recruit-phase twin of score.ts's. Six `playDef(binding.def, …)`: the
  // per-card cascade (`fireLand`), the shop-gem volley's single spanning play (`runShopRubiedSpan`), the
  // shop-wide buff aura's single camera-anchored play (`runShopBuffAllFire`), the `spellCast` cast-FX
  // resolver `runSpellCastFire`'s point-only fire plus its per-target fire, and `runBuffedOnFire`'s
  // play-on-the-buffed-minion (2026-09-01, the recruit half of the `buffedOn` fan-out above).
  'choreo/recruitCues.ts': 6,
  // The HUD's binding path — one `playDef(binding.def, …)` firing a rune's flourish on its own badge. Not a
  // moment cue: the combat score can only anchor to board units, so a rune badge is unreachable from it (see
  // `runeTriggerFx.ts`'s header) and this resolves its binding directly instead.
  'runeTriggerFx.ts': 1,
  // The death handler's projectile-Echo launch — one `playDef(echoBinding.def, …)` firing Fel Spikes' spike
  // volley from the dying body a beat before its damage lands (a `launchOnDeath` binding). Not a moment cue:
  // it deliberately fires OFF the damage beat, so it resolves its binding directly here (see `echoWaves`).
  // THREE since 2026-09-01: `fireBuffCasts` and `fireSelfBuffs` each play a spell's authored buff def INSTEAD
  // of their stock cue (the tendril and the in-place pulse). Both resolve through `authoredBuffDefFor` rather
  // than a moment binding, because an on-attack cast now resolves inside the wind-up — the moment belongs to
  // the ATTACK, so only the individual buff still knows which spell caused it. A spell that buffs a random
  // friendly can roll its own caster, which is why the self-buff channel needs it too. Same data-resolved
  // shape as the death-launch line above; same reason none of them is a literal.
  // FOUR since 2026-09-01: the fourth is `fireBuffCasts` playing the authored effect for a LABEL-sourced
  // grant (Gorun's Blade Mastery → `gorun-hp`), resolved through `labelBuffFxFor`. Data-resolved like the
  // three above, and for the same reason none of them is a literal.
  'useCombatReplay.ts': 4,
};

/** The files that fire `id` from code, or an empty array. Never null — callers render a list either way. */
export function directCallSites(id: string): readonly string[] {
  return DIRECT_CALL_SITES[id] ?? [];
}

/** Ids the game plays from code, sorted — the "played from code" section of the by-event lens. */
export function directCallDefIds(): string[] {
  return Object.keys(DIRECT_CALL_SITES).sort();
}
