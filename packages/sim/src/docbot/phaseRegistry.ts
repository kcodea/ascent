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
  onConsume: 'recruit',
  onGainCard: 'recruit',
  onGetRuby: 'recruit',
  cardsBought: 'recruit',
  goldSpent: 'recruit',
  minionSold: 'recruit',
  spellBought: 'recruit',
  shopRefreshed: 'recruit',
  rubyCast: 'recruit',
  startOfTurn: 'recruit',
  equip: 'recruit', // Equipment is a SHOP mechanic — granted on play and rebuilt at Start of Turn, never in combat
  endOfTurn: 'recruit', // combat carries a few arena-backed EoT bodies for replay effects; dispatch itself is shop-side
  orbit: 'recruit', // Celestial alignment is a shop mechanic
  orbitFired: 'recruit',
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
  onPlay: 'both', // shop play + combat re-fires (Ryme, parting cries, Rune of Shared Scripture) — the Conductor chokepoint
  onDeath: 'both', // combat deaths + shop-side Echo re-fires (Funeral on Loan, Echohorn family)
  onSummon: 'both', // summons happen in both phases (recruit dispatch: fireOnSummon)
  onAttack: 'both', // combat attacks + shop Rally dispatcher (fireShopRally)
  startOfCombat: 'both', // simulate + the shop-side SoC dispatcher (fireShopStartOfCombat)
  onGainAttack: 'both', // combat + the recruit-side scaling-aura dispatcher (recruitHuntGuard site)
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
  // ── onPlay (Shouts) with no combat factory: the economy-defer set. `replayCombatBattlecry` defers these to
  //    settle and replays them through their recruit factory — correct so long as the reason still holds. ──
  battlecryDoubleNextSpell: { phase: 'combat', kind: 'no-surface', why: 'arms a run flag (next spell casts twice); nothing to double mid-fight, replays at settle' },
  battlecryScoutSpread: { phase: 'combat', kind: 'other-channel', why: 'grows the run-wide squirlScoutBuff; combat reads the carried value, the increment is a play-time event' },
  battlecryDestroyForSpell: { phase: 'combat', kind: 'no-surface', why: 'destroys a SHOP offer to gain its spell; no shop exists mid-fight' },
  getEchoAndTrigger: { phase: 'combat', kind: 'no-surface', why: 'grants an Echo chosen in the shop and triggers it there; a re-fire has no chosen Echo to reproduce' },
  battlecryCopyEcho: { phase: 'combat', kind: 'state-missing', why: 'Gravetwin copies a CHOSEN target’s Echo; a combat re-fire has no way to reproduce the choice (documented in replayCombatBattlecry)' },
  battlecryAllDemonsConsume: { phase: 'combat', kind: 'no-surface', why: 'Demons Consume from the SHOP; no shop exists mid-fight, replays at settle' },
  battlecryBuffTargetPerGoldSpent: { phase: 'combat', kind: 'state-missing', why: 'Baby Gastrid scales off goldSpentThisTurn, which CombatContext does not carry (documented in replayCombatBattlecry)' },
  battlecryGildTarget: { phase: 'combat', kind: 'no-surface', why: 'gilds a shop/board target through the recruit gild pipeline; deferred to settle' },
  battlecryArmGrimoire: { phase: 'combat', kind: 'no-surface', why: 'arms a run flag; nothing to arm against mid-fight' },
  battlecryCopyCastSpell: { phase: 'combat', kind: 'state-missing', why: 'copies/casts a spell chosen at play; a re-fire has no chosen spell' },
  buffShopPermanent: { phase: 'combat', kind: 'no-surface', why: 'permanent SHOP enchant; no shop exists mid-fight, replays at settle' },
  battlecryTargetConsumesShop: { phase: 'combat', kind: 'no-surface', why: 'target Consumes a shop minion; no shop mid-fight' },
  buffRightmostSlotPermanent: { phase: 'combat', kind: 'no-surface', why: 'enchants a shop SLOT; no shop mid-fight' },
  triggerAdjacentOrbits: { phase: 'combat', kind: 'no-surface', why: 'Orbit is a shop mechanic (TRIGGER_PHASES.orbit = recruit); nothing to wake mid-fight' },
  battlecryConsumeShopRandom: { phase: 'combat', kind: 'no-surface', why: 'Consumes a random shop minion; no shop mid-fight' },

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
  onTribePlayedBuffSelfPerSpell: { phase: 'combat', kind: 'no-surface', why: 'OWNER RULED 2026-08-26: correct — Vaultkeeper does not gain stats from combat summons.' },

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
]);
