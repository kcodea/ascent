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
  // The persistent AMPLIFIED glow on the Equipment slot (owner-authored 2026-09-22): a looping, slot-centred play
  // started while the selected Equipment will Amplify AND has a charge to spend, fired by literal id from its hook.
  'amplified-slot': ['useAmplifiedSlotFx.ts'],
  'ancient-slam': ['ancients/ancientsSmoke.ts'],
  // The Auctioneer's Pulse — played on the TARGET minion instead of the generic `hero-power-target` spark.
  'auctioneer-hp': ['Recruit.tsx'],
  'choose-one-both': ['useChooseBothFx.ts'],   // the persistent (Both) marker on hand / shop / Discover cards
  'cia-hp': ['useCiaEnchantedFx.ts'],
  'click-puff': ['Recruit.tsx'],
  'tallyanimation1': ['Recruit.tsx'],   // the hero-duel tally→attack-pill effect
  // The generic buff-other ribbon (owner-authored 2026-09-02, replacing the stripped procedural tendril). Fired
  // from the ONE shared buff-other path so the combat replay and the shop draw the same trail; a card's own
  // authored def still takes precedence upstream of it (see `fireBuffFx`).
  'tendril-trail': ['buffFxRender.ts'],
  // The Spirit ribbon is fired by its LITERAL id (2026-09-17): its hits are staggered, so the call sits in its own
  // branch beside the per-tribe dynamic one.
  'tendril-trail-spirit': ['buffFxRender.ts'],
  // The owner-authored Undead Aura surge (2026-09-16): every rise of the run-wide Undead Aura, both phases.
  'undead-aura-buff': ['Recruit.tsx', 'useCombatReplay.ts'],
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
  // THE GILD (owner redesign 2026-09-24, replacing plateGild's centre-screen fuse): one play PER consumed copy,
  // from where it stood into the new gilded card — the poof, the arc and the landing are all this one def.
  'gild-trail': ['ancients/AncientMeter.tsx', 'gildTrail.ts'],
  // A HAND card getting stronger — minion, spell, Ruby or token (owner-authored 2026-09-15, replacing the CSS
  // spell-buff grow/shrink + mote blast). Fired from the one `playHandBuffOn` every surface's fan-out lands on:
  // the shop's hand diff, the End-of-Turn presenters and the combat replay's `handBuff` beat scan.
  'hand-buff': ['handBuffFx.ts'],
  // The "Good Luck" game-start intro's spark burst (2026-09-24), off the words' centre as they fade in.
  'good-luck-intro': ['goodLuck/GoodLuckIntro.tsx'],
  'dice-land': ['DiceRoll.tsx'],
  // The DOWN-RANK hit (owner-authored 2026-09-21): a shockwave off the crest, then a blue→orange shard fall as
  // the old crest drops — fired by the post-game rank timeline at every demotion beat (division and medal).
  'down-rank': ['rank/rankTimeline.ts'],
  'hero-power-spark': ['StatusBar.tsx'],
  'hero-power-target': ['Recruit.tsx'],
  'impact-dust': ['EndTurnButton.tsx', 'RefreshButton.tsx', 'choreo/channels/impact.ts'],
  'landing-dust': ['Recruit.tsx', 'useCombatReplay.ts'],
  // THE LASSO (owner-authored 2026-09-22): stealing a Shop minion throws a rope at it — from the spell's drop
  // point, from Rope Wrangler's medallion, from the Equipment slot (Whiplass-o) or from the rune badge (Rune of
  // Lassoing). One `fireLassoBeam` in Recruit.tsx serves the action cascade and both End-of-Turn paths.
  lasso: ['Recruit.tsx'],
  // Recruit.tsx dropped off this list on 2026-08-08: the SHOP half is now played through a
  // `bindings.json` row (`rubyLanded`) by the recruit cue runner, not by a hardcoded id. The combat
  // half in score.ts is still a literal — see RUBY_LANDED_DEF.
  'ruby-gem-apply': ['choreo/score.ts'],
  // The cross-target RE-CAST ribbon (owner-authored 2026-09-15): a spell / Ruby landing a second time on a
  // DIFFERENT body because of where the first cast landed. The shop half fires from the `bounceFx` watcher in
  // Recruit.tsx (Star Crash, Crash Course, Reflector, Distillation, Redirection, the Conduit); the combat half
  // from the `bounceFx` channel in score.ts (Trouble, Candle Conduit, a Resonance Idol / Reflector spread).
  // `spell-bounce` is a PLACEHOLDER palette-swap of `ruby-bounce` until the owner tunes it in the workbench.
  'ruby-bounce': ['Recruit.tsx', 'choreo/score.ts'],
  // The RANK-UP hit (owner-authored 2026-09-20): a ring collapsing onto the crest, then a gold shard burst as
  // the new crest lands — fired by the post-game rank timeline at the promotion beat (division and medal).
  'rank-up': ['rank/rankTimeline.ts'],
  'rebirth-flame': ['choreo/channels/aura.ts'],
  // A RESILIENT Ward's first hit (owner 2026-09-26): orange spark shards off the shell edge, over the card's CSS shatter.
  'resilient-ward-shatter': ['choreo/channels/aura.ts'],
  'rune-buff-unit': ['Recruit.tsx', 'useCombatReplay.ts'],
  // THE RUNE CAST FLOURISH (2026-09-24, owner: "a bit of flair … a 'magic' element to it? nothing crazy"): the glyph
  // flash on a casting rune's node, and the mote it sends to where a single-play spell effect lands. Every rune
  // cast in every phase reaches these through `fx/spellCastFx.ts` (`playRuneSpellCastFx`).
  'rune-cast-flourish': ['fx/runeCastFlourish.ts'],
  'rune-cast-mote': ['fx/runeCastFlourish.ts'],
  // The implosion on a rune's BADGE as the lock-in ceremony hands it over (owner ask 2026-08-31).
  'rune-select-implosion': ['useRuneArrivalFx.ts'],
  'rune-slot-break': ['QuestBadges.tsx'],
  // THE DISCOVER ENTRANCE (2026-09-25): the golden dust under each arriving Discover / Choose One option, and the glints
  // over its face.
  'discover-arrive': ['discoverEntrance/entrance.ts'],
  'discover-glint': ['discoverEntrance/entrance.ts'],
  // THE RUNEFORGE ENTRANCE (2026-09-24): the dust puff under each landing rune tablet, the embers off the forge
  // floor as it opens, and the Epic forge's flare as its last tablet lands.
  'runeforge-embers': ['runeforgeEntrance/entrance.ts'],
  'runeforge-epic-flare': ['runeforgeEntrance/entrance.ts'],
  // The Ancients reuse the Runeforge landing dust as-is (tinted) for each slam and the eruption (2026-09-25).
  'runeforge-land-dust': ['ancients/ancientsSmoke.ts', 'runeforgeEntrance/entrance.ts'],
  // The mid-combat Shop-buff bloom (owner-authored 2026-09-02, replacing `shop-buff-aura` on this surface). The
  // shop-row play goes through the `shopBuffAll` binding instead — see `runShopBuffAllFire`.
  'shop-buff-purple': ['useCombatReplay.ts'],
  'shop-tier-up': ['TavernUpButton.tsx'],
  'spell-bounce': ['Recruit.tsx', 'choreo/score.ts'], // see `ruby-bounce` above — the spell family's placeholder twin
  // The Starform's pulls (owner-authored 2026-09-12): the token eating a Shop minion (from the meal's
  // `shopEaten` ghost, in place of `consume-pull`), a Celestial consuming the token, and the Collapse — one
  // play per receiver. Fired from the two `shopEaten` / `starformFxSeq` watchers in Recruit.tsx.
  'starform-pull': ['Recruit.tsx'],
  'starform-create': ['Recruit.tsx'], // the token's creation cue (owner def 2026-09-14) — on the token's slot, every creator
  'strike-impact': ['choreo/channels/impact.ts'],
  // The persistent per-badge milestone effects (owner 2026-09-19): a looping, badge-tracking play started for
  // every unit whose Attack / Health has reached the final tier (≥5000), fired by literal id per stat.
  'test-ascent-frame-attack': ['fx/milestoneBadgeFx.ts'],
  'test-ascent-frame-health': ['fx/milestoneBadgeFx.ts'],
  // A consumed / death-lost Ward (owner-authored 2026-09-09, replacing the `shatterAt('shield')` shard-burst;
  // the `sfx.shieldBreak` sound is unchanged). Fired from the aura channel's two Ward-loss sites.
  'ward-lost-blast': ['choreo/channels/aura.ts'],
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
  // A THIRD site for the same data-resolved id since 2026-09-22 (owner ruling "spiritbinder one beam per fire"):
  // the beam cascade plays `playDef(beam.fxId, …)` once PER FIRE for an Equipment flagged `useFxTargetsBuffed`,
  // where `beam.fxId` is that Equipment's own `useFxId` (Spiritbinder's `spiritbinder`). Same debt, same fix —
  // the moment belongs in `recruitCues.ts`, and moving it there retires this line with the two above.
  'equipBeamCascade.ts': 1,
  // The same resolution in the TUNER's test fire: it plays the SELECTED Equipment's def so both cues can be
  // timed, rather than being hardwired to Bloodpot's. Same debt, same fix — moving the moment into
  // `recruitCues.ts` retires this line with the one above it.
  'EquipFxTuner.tsx': 1,
  // SIX since 2026-09-01: the `buffedOn` fan-out is a sixth `playDef(binding.def, …)`, playing ON each buffed
  // unit rather than travelling to it (Dragonflame). Same binding path, one more anchor convention.
  // +1 on 2026-09-01: the `shoutFx` cue plays a `shout`-kind binding per re-fire proc.
  // EIGHT since 2026-09-21: the `pummelFx` cue plays a `pummelTrigger`-kind binding (the owner's
  // `pummel-trigger`) per damage-meter crossing, resolved per EVENT like `rallyFx`/`shoutFx` — see
  // `channels/pummelFired.ts`. Same binding path; not a direct call.
  // NINE since 2026-09-21: `playCardMechanic` — ONE `playDef(binding.def, …)` shared by the `startOfCombatFx`
  // and `avengeFx` scan channels (the By-card binder's "On Start of Combat" / "On Avenge" cues), resolving
  // `bindingFor(cardId, 'startOfCombat'|'avenge')` per acting card. One helper, one play, both channels.
  'choreo/score.ts': 9,
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
  // FIVE since 2026-09-10: the fifth is `fireBuffCasts` playing the authored effect for a SOURCE MINION whose
  // own on-attack buff has no spell behind it (Paragon's rally-buff → `lightning-bolt-blue`), resolved through
  // `sourceBuffDefFor`. The source-card mirror of the spell path above — same absorbed-into-the-wind-up reason
  // it can't be a moment binding, same data-resolved shape.
  // SIX since 2026-09-21: the By-card binder's ON WATCHER cue — one `playDef(wb.def, …)` resolving
  // `bindingFor(cardId, 'watcher')` on each watcher uid answering an ally's attack. A derived-pulse binding
  // (no moment kind), so it fires at the watcher-pulse site rather than through the score.
  'useCombatReplay.ts': 6,
  // PER-TRIBE BUFF RIBBON (2026-09-09). One `playDef(`tendril-trail-${tribe}`, …)` in `fireBuffFx`: the buffer's
  // TRIBE picks its ribbon variant, so the id is data-resolved (from the tribe) rather than a literal — the
  // same shape as a binding, keyed on the source's tribe instead of a `bindings.json` row. The generic
  // `tendril-trail` fallback in the sibling branch stays a literal and remains in `DIRECT_CALL_SITES`.
  'buffFxRender.ts': 1,
  // STAT MILESTONE (2026-09-14). One `playDef(binding.def, …)` in `fireStatMilestone`: which def plays for a
  // badge crossing a tier is resolved via `bindingFor(cardId, statMilestoneKind(tier))`, the same binding path
  // as score.ts/recruitCues.ts/runeTriggerFx.ts — a fourth resolver, keyed on the `statMilestoneN` family
  // instead of a `RecruitMoment`/`CombatEvent` kind because there is no event to hang a moment off (see that
  // file's header).
  'fx/statMilestone.ts': 1,
  // MILESTONE HIT (2026-09-24). One `playDef(milestone.def, …)` in `playContactImpact`: a plain melee hit whose
  // attacker's Attack badge is tier 4/5/6 (pink/purple/blue) plays `bindingFor(cardId, attackHitMilestoneKind(tier))`
  // in place of the stock sparks + ring. Resolved from the `attackHitMilestoneN` family, not a literal.
  'choreo/channels/impact.ts': 1,
  // A SPELL'S OWN CAST EFFECT (2026-09-24, Growth's `growth-effect`). One `playDef(binding.def, …)` in
  // `playSpellCastFx`, resolving the spell's card-level `spellCast` row via `spellCastFxFor` — the one play every
  // phase's cast path shares (the shop's rune / minion records, the End-of-Turn beats, the combat `spellCastFx` cue) — and `playRuneCastBuffFx`, a rune cast's per-buff row (`spellCastFanOutFor`: an Ale, Dragonflame).
  // …and `playCastAtSource` (2026-09-24 follow-up), a no-buff row (Golden / Reinforcing Ale) once at a rune's or minion's source.
  'fx/spellCastFx.ts': 3,
};

/** The files that fire `id` from code, or an empty array. Never null — callers render a list either way. */
export function directCallSites(id: string): readonly string[] {
  return DIRECT_CALL_SITES[id] ?? [];
}

/** Ids the game plays from code, sorted — the "played from code" section of the by-event lens. */
export function directCallDefIds(): string[] {
  return Object.keys(DIRECT_CALL_SITES).sort();
}
