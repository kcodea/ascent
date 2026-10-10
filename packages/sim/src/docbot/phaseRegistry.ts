/**
 * DOC BOT — the trigger × phase contract.
 *
 * ASCENT dispatches every card effect by looking its factory id up in a phase-specific map and calling it with
 * `?.` — `RECRUIT_FACTORIES[effect.do]?.(...)` in the shop, `FACTORIES[effect.do]?.(...)` in combat. That shape
 * is deliberate (each phase implements only what is meaningful there), but its failure mode is SILENCE: a
 * factory missing from a map where its trigger dispatches is not an error, it is a no-op nobody sees. Three
 * owner-reported bugs in one day (2026-08-26) had exactly this shape:
 *
 *   • Conductor's Shout re-fired in combat → `battlecryConductorAdjacent` had no combat factory → nothing.
 *   • Beefy / Lantern Light cast in combat (fixed 2026-08-19) → not in `COMBAT_CASTABLE_SPELL_DOS` → fizzled.
 *   • The `replayCombatBattlecry` docblock carries a FULL HAND AUDIT dated 2026-08-04 — and Conductor still
 *     slipped through, because a comment audit checks the world once while the world keeps moving.
 *
 * This file turns that comment audit into data. `factoryPhase.test.ts` walks every (trigger, factory) pair in
 * content against it and fails when a pair has no implementation in a phase where its trigger dispatches and
 * no registered excuse. Adding a new Shout/Echo/etc. factory therefore forces a decision AT AUTHORING TIME:
 * implement the other phase, or write down why not.
 *
 * ── How to update ─────────────────────────────────────────────────────────────────────────────────────────
 * New trigger        → add it to TRIGGER_PHASES (find its dispatch sites first; do not guess).
 * New dual-phase     → implement both sides, or add a PHASE_EXCUSED entry with a real reason.
 *   factory
 * 'needs-triage'     → an inherited unknown. The test tolerates it (landing Doc Bot must not require ruling
 *                      on 20 legacy gaps at once) but `npm run docbot` reports it loudly. Triage = play the
 *                      trigger in the excused phase and either implement, or upgrade the excuse.
 */

/** Where a trigger's dispatch sites live. 'recruit' = shop-side only, 'combat' = simulate-side only,
 *  'both' = the same trigger has live dispatch sites in each phase. Derived by reading the dispatchers, not
 *  from card text — see the audit notes beside each entry. */
export const TRIGGER_PHASES: Readonly<Record<string, 'recruit' | 'combat' | 'both'>> = {
  // ── recruit-only: the trigger is an economy event; combat has no dispatch site for it ──
  cast: 'recruit', // shop spell casts; combat's NARROW named-spell lane is checked separately (castLane below)
  onBuy: 'recruit',
  onSell: 'recruit',
  onTribePlayed: 'recruit', // set 3 Spirits: a minion PLAYED from hand — a shop event by definition
  onConsume: 'recruit',
  // 2026-08-29: WAS 'recruit' ("combat has no dispatch site for it") — false, and the misclassification is
  // exactly what hid the Gangplank bug: `factoryPhase` skips the combat side of a trigger declared
  // recruit-only, so a missing combat factory was never a hole. Combat emits it from `ctx.grantToHand` and
  // `ctx.grantRubies`. See `combatEmitAgreement.test.ts`, the oracle that now derives this from source.
  onGainCard: 'both',
  onGetRuby: 'recruit',
  cardsBought: 'recruit',
  goldSpent: 'recruit',
  minionSold: 'recruit',
  onRise: 'both', // a friendly Rise — combat's `bus.emit('onRise')` and the shop's `fireOnRise` (owner 2026-09-09)
  spellBought: 'recruit',
  shopRefreshed: 'recruit',
  rubyCast: 'recruit',
  startOfTurn: 'recruit',
  equip: 'recruit', // Equipment is a SHOP mechanic — granted on play and rebuilt at Start of Turn, never in combat
  equipmentActivated: 'recruit', // Set 3 Neutrals (2026-09-18): the reducer's `activateEquipment` success path (fireEquipmentActivated) — Rig; Equipment is never activated in combat
  endOfTurn: 'recruit', // combat carries a few arena-backed EoT bodies for replay effects; dispatch itself is shop-side
  orbit: 'recruit', // Celestial alignment is a shop mechanic
  orbitFired: 'recruit',
  starformGained: 'recruit', // the Starform is a SHOP token — it only grows in the shop (fireStarformGained)
  starformRemoved: 'recruit', // …and only leaves the shop there (consume / collapse / dismiss — fireStarformRemoved)
  spellCast: 'recruit', // the shop-side watcher; combat spell-cast watchers dispatch through their own factory ids, all present
  spellCastOnThis: 'recruit',
  battlecryTriggered: 'recruit', // Karwind-family watchers; combat re-fires notify via the caller, through combat factories already present

  // ── combat-only: the trigger cannot happen in the shop ──
  avenge: 'combat',
  onKill: 'combat',
  onDamaged: 'combat',
  friendlyDemonDealtDamage: 'combat',

  // ── dual-phase: both dispatchers exist; every factory used on this trigger must cover both or be excused ──
  onRubyPlayed: 'both', // shop plays + Bloodbinder-family playing Rubies mid-fight
  // COMBAT only, and it is not a dispatched trigger at all: `playRubyOn` SCANS living friendlies for it
  // (Candle Conduit's bounce, Trouble's self-cast). There is no recruit equivalent — the shop's Ruby
  // path is `fireOnRubyPlayed`, which is the `onRubyPlayed` row above.
  rubyPlayedAnywhere: 'combat',
  // Ruby Roach. A RECRUIT-only signal: it fires from the play path beside the play-count meter, and there is
  // no combat equivalent because Choose One is resolved in the shop, never mid-fight.
  chooseOnePlayed: 'recruit',
  onPlay: 'both', // shop play + combat re-fires (Ryme, parting cries, Rune of Shared Scripture) — the Conductor chokepoint
  onDeath: 'both', // combat deaths + shop-side Echo re-fires (Funeral on Loan, Echohorn family)
  onSummon: 'both', // summons happen in both phases (recruit dispatch: fireOnSummon)
  onAttack: 'both', // combat attacks + shop Rally dispatcher (fireShopRally)
  startOfCombat: 'both', // simulate + the shop-side SoC dispatcher (fireShopStartOfCombat)
  onGainAttack: 'both', // combat + the recruit-side scaling-aura dispatcher (recruitHuntGuard site)
  onGainStats: 'recruit', // Set 3 batch 2 (2026-09-16): the reducer's per-action stat diff (fireStatGainReactors) — Handy Flame; combat does not emit it yet
  summonOverflow: 'both', // Nanon in combat; recruit dispatches it too (echo replays on a full board)
  passive: 'both', // marker effects read by direct `effects.some(...)` scans in both phases, never dispatched
};

/** A registered reason a (trigger, factory) pair does NOT implement one of its trigger's phases. */
export interface PhaseExcuse {
  /** The phase the factory deliberately does not implement. */
  phase: 'recruit' | 'combat';
  /**
   * Why that is correct — or 'needs-triage' when nobody has ruled yet:
   *  'no-surface'   — the phase has nothing for it to act on (no shop/Gold/hand mid-fight; no killer in a shop).
   *  'outside-map'  — the phase DOES implement it, via a bespoke branch rather than the factory map (cite it).
   *  'other-channel'— the phase gets equivalent behaviour through a different mechanism (e.g. a run-wide aura).
   *  'state-missing'— the effect reads state the other phase does not carry (cite what).
   *  'needs-triage' — Doc Bot found the gap; no ruling exists. Tolerated, reported, must not grow silently.
   */
  kind: 'no-surface' | 'outside-map' | 'other-channel' | 'state-missing' | 'needs-triage';
  /** One line a future reader can verify — for 'outside-map', where the bespoke branch lives. */
  why: string;
}

/**
 * The excuse table. Seeded 2026-08-26 from a full walk of content against the real dispatch maps
 * (`RECRUIT_FACTORY_IDS` × `FACTORIES`); the onPlay entries encode the hand audit that previously lived only
 * in `replayCombatBattlecry`'s docblock (dated 2026-08-04) — the audit Conductor slipped past.
 */
export const PHASE_EXCUSED: Readonly<Record<string, PhaseExcuse>> = {
  // ── onPlay (Shouts) with no combat factory: ONLY the SHOP-ONLY set (`SHOP_ONLY_SHOUTS` in core/effects/factories.ts,
  //    R-REALTIME-03, owner 2026-09-26: "all shouts should be real time in combat"). Each fires LIVE in combat (its
  //    line, every Shout counter) and settle applies its Shop part once. Every other Shout has a combat factory. ──
  armChooseBoth: { phase: 'combat', kind: 'no-surface', why: "SHOP_ONLY_SHOUTS: Double Dealer arms her own 'first Choose One "
    + "this turn' latch; Choose One is played from HAND in the SHOP. A combat re-fire logs its line live; settle arms "
    + 'her run card once (Start of Turn re-arms her anyway)' },
  rallyGrantFirstSpellCopy: { phase: 'recruit', kind: 'no-surface', why: 'Comet Conductor is "once per COMBAT" by its text; a shop Rally pass (Rune of the Chef) is not a fight, and the copy is the payout of the fight' },
  // ── Set 3 Celestials, THE STARFORM ROSTER (2026-09-12): the token lives IN THE SHOP; no shop exists mid-fight ──
  battlecryCreateStarformOrBuff: { phase: 'combat', kind: 'no-surface', why: 'SHOP_ONLY_SHOUTS: Star Seed creates / feeds the Starform, a SHOP token (starform.ts). A combat re-fire logs its line live; settle feeds the token once' },
  battlecryStarformConsumeShop: { phase: 'combat', kind: 'no-surface', why: 'SHOP_ONLY_SHOUTS: the Starform eats a Shop minion. A combat re-fire logs its line live; settle applies the meal once' },
  battlecryReplayTargetEndOfTurn: { phase: 'combat', kind: 'no-surface', why: 'SHOP_ONLY_SHOUTS: Roomworks triggers an End of Turn effect, which only resolves in the Shop. A combat re-fire logs its line live; settle replays it once (owner 2026-10-10)' },
  battlecryCollapseStarform: { phase: 'combat', kind: 'no-surface', why: 'SHOP_ONLY_SHOUTS: Solburn collapses the Starform, a SHOP token. A combat re-fire logs its line live; settle collapses it once' },
  collapseExtraTargets: { phase: 'combat', kind: 'no-surface', why: "Nova Herald's passive MARKER — read by `collapseExtraTargetsOf` at Collapse time, a SHOP-only moment (the Starform is a shop offer); the recruit map holds a never-dispatched stub" },
  // Trouble's self-Ruby. Combat DOES implement it — just not through the factory map: `rubyPlayedAnywhere`
  // is a passive marker that `playRubyOn` SCANS living friendlies for (the same shape Candle Conduit's
  // `rubyBounceExtra` uses), because the reaction has to run inside the Ruby application it reacts to.
  rubySelfCastPerOtherRuby: { phase: 'combat', kind: 'outside-map', why: 'implemented in `playRubyOn` (core/effects/factories.ts), which scans living friendlies for the `rubyPlayedAnywhere` marker rather than dispatching it' },
  scGainStatsOfHighestHealthHand: { phase: 'recruit', kind: 'no-surface', why: 'Handbound Titan gains the hand minion\'s stats "this combat" — a temporary combat gain; a shop-side SoC replay (Twilight) has nothing temporary to grant' },
  rallyGiveTribeAttackOfHighestAttackHand: { phase: 'recruit', kind: 'no-surface', why: 'Flamebanner Marshal\'s Rally Attack is combat-only by owner ruling ("all attack only unless engraved"); a shop rally has no fight to grant it for' },
  battlecryAllDemonsConsume: { phase: 'combat', kind: 'no-surface', why: 'SHOP_ONLY_SHOUTS: Consume is a Shop action (onConsume + the Fodder tally are recruit-only; the meal is permanent). A combat re-fire logs its line live; settle feeds the Demons once' },
  battlecryTargetConsumesShop: { phase: 'combat', kind: 'no-surface', why: 'SHOP_ONLY_SHOUTS: the target eats a random SHOP minion. A combat re-fire logs its line live; settle applies the meal once' },
  buffRightmostSlotPermanent: { phase: 'combat', kind: 'no-surface', why: 'SHOP_ONLY_SHOUTS: enchants a Shop SLOT (+ Rune of the Display Case). A combat re-fire logs its line live; settle enchants once' },
  triggerAdjacentOrbits: { phase: 'combat', kind: 'no-surface', why: 'SHOP_ONLY_SHOUTS: Orbit is a shop mechanic (TRIGGER_PHASES.orbit = recruit). A combat re-fire logs its line live; settle wakes the Relay’s own neighbours once' },
  battlecryConsumeShopRandom: { phase: 'combat', kind: 'no-surface', why: 'SHOP_ONLY_SHOUTS: eats a random SHOP minion. A combat re-fire logs its line live; settle applies the meal once' },

  // ── onDeath (Echoes) with no recruit factory: fires when a shop-side Echo replay (Funeral on Loan,
  //    Echohorn) reaches it. The no-surface ones are sound; the needs-triage ones are EXACTLY the
  //    Funeral-on-Loan bug shape and want a ruling: trigger each in the shop and watch. ──
  deathrattleDestroyKiller: { phase: 'recruit', kind: 'no-surface', why: 'destroys the KILLER; a shop-side Echo replay has no killer' },
  echoResummonDeadBeasts: { phase: 'recruit', kind: 'no-surface', why: 'resummons Beasts that died THIS COMBAT; the shop has no dead-this-combat list' },

  // ── onSummon / summonOverflow / onGainAttack with no recruit factory ──
  onSummonSelfBuff: { phase: 'recruit', kind: 'no-surface', why: 'OWNER RULED 2026-08-26: combat-only per its printed text ("when a minion is summoned in combat"). Shop overflow triggers stay legal for non-combat-specific cards (Flowing Monk precedent).' },
  onSummonTribeBuffThenDouble: { phase: 'recruit', kind: 'no-surface', why: 'OWNER RULED 2026-08-26: correct as-is (combat-only summons doubling).' },
  onSummonImpBuff: { phase: 'recruit', kind: 'other-channel', why: 'the shop applies the Imp aura through the run-wide impBuff channel at mint time' },
  onSummonOverflowBuffTribe: { phase: 'recruit', kind: 'no-surface', why: 'OWNER RULED 2026-08-26: Cratering Hulk stays combat-only per its text; shop overflow triggers remain legal for cards that are not combat-specific.' },
  onGainAttackImproveHpGrant: { phase: 'recruit', kind: 'outside-map', why: 'hand-mirrored in recruit.ts (~line 418: "in the shop here, mirrored in combat by onGainAttackImproveHpGrant")' },

  // ── implemented outside the map on the RECRUIT side ──
  gainEmbers: { phase: 'recruit', kind: 'outside-map', why: 'special-cased in castSpell (recruit.ts ~8405: the gainEmbers override) so the printed value can fold in bonuses' },
  rubyStatMultiplier: { phase: 'recruit', kind: 'outside-map', why: 'a passive MARKER — both phases read it with direct effects.some() scans; the combat map holds a stub, the shop scans directly' },

  // ── more onSummon-family gaps surfaced by this test's own first run (2026-08-26) ──
  onTribePlayedConsumeShop: { phase: 'combat', kind: 'no-surface', why: 'Consumes from the SHOP on a tribe play; no shop mid-fight' },
  summonBuffTribeImprove: { phase: 'combat', kind: 'no-surface', why: 'OWNER RULED 2026-08-26: correct — Den Mother does not feed from combat summons.' },
  countTribeSummon: { phase: 'combat', kind: 'no-surface', why: 'OWNER RULED 2026-08-26: correct — "played" means from hand in the shop; combat summons do not feed the counter (Pack Leader text clarified to say "in the Shop").' },
  onTribeSummonedBuffTribe: { phase: 'combat', kind: 'no-surface', why: 'OWNER RULED 2026-08-26: correct — "when you play a Dwarf" is a shop event.' },
  onTribeSummonedBuffRandomOthers: { phase: 'combat', kind: 'no-surface', why: 'Hank Pepe (set 3) — the same ruling as Chef Gary Toast above: "when you play a Dwarf" is a shop event, and combat summons are not plays.' },

  // ── onRubyPlayed in combat (Bloodbinder-family plays real Rubies mid-fight) ──
  rubyPlayedGold: { phase: 'combat', kind: 'no-surface', why: 'OWNER RULED 2026-08-26: correct — no Gold from combat-played Rubies.' },

  // ── passive markers ──
  goldSpentScaleSelf: { phase: 'combat', kind: 'other-channel', why: 'stats are synced at shop time (syncGoldSpentScalers); combat receives the already-scaled body' },

  // ── startOfCombat factories are fully dual-covered today; onAttack too. Nothing to excuse. ──
};

/**
 * The named-spell combat cast lane — ONLY the factories that route through `arena.castNamedSpell` →
 * `castNamedSpellInCombat`, whose gate (`combatCastable`) makes an unimplemented spell FIZZLE WITHOUT
 * COUNTING, silently. Beefy and Lantern Light shipped exactly that way (fixed 2026-08-19). The tripwire:
 * every spell these factories name must pass `combatCastable`.
 *
 * Deliberately NOT here: the cast factories that INLINE their spell's effect inside `arena.castRepeat(id,
 * body)` — rallyCastSpell, rallyCastTribeAttack, onAllyAttackCastGrowth, endOfTurnCastSpellOnSelf. Those
 * supply their own body, so the gate never sees them and they cannot fizzle this way (this test's own first
 * run flagged Watcher/Lantern of Souls before that distinction was drawn — a false positive worth recording:
 * an inlined cast works in combat even when its spell's own factory would not).
 */
export const COMBAT_CASTING_FACTORIES: ReadonlySet<string> = new Set([
  'rallyCastNamedSpell', // Flamebeat Drake
  'onTribeAttackCastNamedSpell', // Warflame
  'onBattlecryCastNamedSpell', // Firebird (2026-10-07)
]);

/**
 * ── COMBAT-EMIT WAIVERS (added 2026-08-29, after the Gangplank miss) ───────────────────────────────────────
 *
 * `combatEmitAgreement.test.ts` scans `packages/core/src` for `bus.emit('<trigger>')` and demands that every
 * trigger COMBAT ACTUALLY EMITS is declared 'combat' or 'both' above — or waived here with a reason.
 *
 * WHY THIS EXISTS. `TRIGGER_PHASES` is hand-maintained from "find its dispatch sites first; do not guess",
 * and `onGainCard` was written down as recruit-only with the note *"combat has no dispatch site for it"*.
 * That was wrong — `ctx.grantToHand` had existed the whole time — and because `factoryPhase` derives
 * `needCombat` FROM this table, the misclassification made the combat half of the check disappear. The lane
 * that exists to catch missing combat factories could not see a missing combat factory. One wrong word in a
 * registry silently switched off a whole rail.
 *
 * So the registry is no longer trusted on this point: the emit sites in the engine are, and a disagreement
 * has to be either fixed or written down.
 *
 * A waiver is NOT "combat doesn't really emit this". It is "combat emits it, and the factory ids its handlers
 * use are covered another way" — which must stay true and stay stated.
 */
export const COMBAT_EMIT_WAIVED: Readonly<Record<string, string>> = {
  // Combat DOES emit these, but the bodies that answer them are registered under DIFFERENT factory ids than
  // the recruit-side watchers content declares against this trigger — so demanding a combat factory for the
  // recruit pair would be demanding the wrong thing. Both were audited on 2026-08-29 alongside the Gangplank
  // fix and their combat factories are present.
  battlecryTriggered: "combat re-fires notify through the caller; its handlers are separate combat factory ids, all present (audited 2026-08-29)",
  spellCast: "the recruit pair is the SHOP watcher; combat's spell-cast watchers dispatch through their own factory ids, all present (audited 2026-08-29)",
  // Not a card trigger at all — an internal keyword-loss signal with no `on:` in any card, so no content pair
  // exists for it to classify. Left unlisted in TRIGGER_PHASES on purpose.
  onLoseDivineShield: 'engine-internal signal, never authored as a card trigger (no content uses it as `on`)',
};
