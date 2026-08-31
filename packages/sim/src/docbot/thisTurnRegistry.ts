/**
 * THE "THIS TURN" REGISTRY — R-TURN-01's printed-text half (owner ruling 2026-08-27, q-carry-demand-encore):
 *
 *   "'This turn' terminology runs from shop through that turn's combat, and ends at the start of the next
 *    shop turn. so this effect should absolutely carry over into combat. use this language and logic moving
 *    forward and to retroactively fix issues."
 *
 * The subject list is DERIVED, never hand-curated: `thisTurnRule.test.ts` sweeps every content def whose
 * PRINTED text says "this turn" (cards + golden texts, runes, quests, gifts, hero powers) and requires each
 * id to carry a classification here. A new "this turn" effect therefore cannot ship unclassified, and a
 * stale entry (the text no longer says "this turn") fails loudly.
 *
 * Kinds:
 *   · 'conforms'            — the turn-scoped state IS readable/consumable through that turn's combat
 *                             (threaded into the combat side, resolved at End of Turn while the tally is
 *                             live, or replayed at settle before the rollover clears it). Cite the channel.
 *   · 'no-combat-meaning'   — nothing in the combat half of the turn can consume it (shop costs, sells,
 *                             buys, shop-offer enchants, plays from hand). Say why combat can't touch it.
 *   · 'violation-fixed'     — was a gap; fixed, with the PR/channel cited.
 *   · 'confirmed-violation' — the scan found a real gap that is NOT yet fixed. Visible and ratcheted in the
 *                             test — this list must never grow silently, and each entry cites R-TURN-01.
 */

export interface ThisTurnClassification {
  kind: 'conforms' | 'no-combat-meaning' | 'violation-fixed' | 'confirmed-violation';
  /** One line a future reader can verify, citing the carry channel or the reason combat can't consume it. */
  why: string;
}

export const THIS_TURN_CLASSIFIED: Readonly<Record<string, ThisTurnClassification>> = {
  // ── Equipment ──
  k3_prismpick: { kind: 'no-combat-meaning', why: 'Prismpick Artificer prints the wording of its Equipment: "your next Choose One card this turn gains both effects". Choose One is resolved when a HAND card is played in the SHOP — a fight never plays one — so the armed charge has no combat half to lose. It is cleared at the turn rollover and excused in the carry-over scan for the same reason (R-TURN-01 conform).' },

  // ── gifts ──
  gift_encore: { kind: 'violation-fixed', why: 'Demand an Encore, "your Shouts trigger an extra time this turn": the extras used to evaporate at the shop/combat boundary. Fixed 2026-08-27 under R-TURN-01 — threaded as questCombatMods.encoreExtra, consumed by ctx.shoutCarryExtras on EVERY combat-triggered Shout (a turn-long buff, mirroring the shop counter).' },
  gift_arcane_clearance: { kind: 'no-combat-meaning', why: 'this-turn Shop-spell discount; nothing in the combat half of the turn can pay a cost (R-TURN-01 conform)' },
  gift_friends_family: { kind: 'no-combat-meaning', why: 'this-turn Shop-minion discount; nothing in the combat half of the turn can pay a cost (R-TURN-01 conform)' },

  // ── Start-of-Combat readers of a shop-turn tally — the tally IS threaded into the combat side ──
  dw_oaf: { kind: 'conforms', why: 'ARCHIVED. SoC repeats per Dwarven Ale cast this turn — reads arena.alesLastTurn(), threaded as combatSide.alesLastTurn = s.alesCastThisTurn at the faceOmen build' },
  abhorrenthorror: { kind: 'conforms', why: 'SoC gains the Fodder consumed this turn — threaded as combatSide.fodderConsumedAtk/Hp at the faceOmen build' },
  runescale: { kind: 'conforms', why: 'SoC buffs per Shop spell cast this turn — reads ctx.spellsThisTurnFor, threaded as combatSide.spellsThisTurn' },

  // ── combat-triggered Shouts whose economy body replays at SETTLE, while the turn is still open ──
  d2_recaller: { kind: 'conforms', why: 'Shout copies the last Shop spell cast this turn (lastSpellThisTurnId, the turn-scoped field — audit 2026-07-31). A combat-triggered fire defers to settle (replayEconomyBattlecry), which runs BEFORE the rollover clears the field — the R-TURN-01 window is intact' },
  dw_dorrin: { kind: 'conforms', why: 'Baby Gastrid: Shout buffs per Gold spent this turn. A combat-triggered fire defers to settle, where the recruit factory reads the still-live goldSpentThisTurn and auto-picks an eligible Dwarf (2026-08-25 fix) — the window read is correct; the buff landing on the run board post-fight is the standing economy-defer convention' },

  // ── instant spells that read the tally at cast (the cast IS inside the window) ──
  patchjob: { kind: 'conforms', why: 'instant: reads goldSpentThisTurn at cast time' },
  hoardflame: { kind: 'conforms', why: 'instant: reads the Dragons-played tally at cast time' },

  // ── End-of-Turn consumers — EoT resolves in the shop half, with the whole turn\'s tally live ──
  chronostaff: { kind: 'conforms', why: '"EoT effects trigger 1 more time this turn": folded into endOfTurnRepeats at faceOmen, so the extra applies to the EoT that ends this very turn' },
  ropewrangler: { kind: 'conforms', why: 'EoT casts Lasso per 6 Gold spent this turn — resolves at EoT with the full tally' },
  dw_foreman: { kind: 'conforms', why: 'EoT buffs per card played this turn — resolves at EoT with the full tally' },
  d2_runefire: { kind: 'conforms', why: 'ARCHIVED. EoT re-casts the last Shop spell cast this turn — resolves at EoT while the record is live' },
  d2_spellvault: { kind: 'conforms', why: 'ARCHIVED. EoT copies the first Shop spell cast this turn — resolves at EoT while the record is live' },
  rune_spending: { kind: 'conforms', why: 'EoT buffs per Gold spent this turn — resolves at EoT with the full tally' },
  rune_recollection: { kind: 'conforms', why: 'EoT copies the first spell cast this turn — resolves at EoT while the record is live' },
  rune_action: { kind: 'conforms', why: 'EoT buffs per card played this turn — resolves at EoT with the full tally' },
  rune_recurrence: { kind: 'conforms', why: 'EoT re-casts the first Shop spell cast this turn — resolves at EoT while the record is live' },
  rune_lapidary: { kind: 'conforms', why: 'EoT plays a Ruby per card played this turn — resolves at EoT with the full tally; the Ruby buffs bake onto the board before combat' },

  // ── shop-action scopes: nothing in the combat half can consume them ──
  quicksale: { kind: 'no-combat-meaning', why: '"the next minion you sell this turn": selling exists only in the shop half' },
  funeralonloan: { kind: 'no-combat-meaning', why: '"if you play it this turn": playing from hand exists only in the shop half; the borrowed flag is run bookkeeping cleared at the rollover' },
  spiritworgen: { kind: 'no-combat-meaning', why: 'the improve clause reads spells cast this turn at TRIGGER time, and its trigger (you play a Beast/Dragon) exists only in the shop half' },
  dm_nightmarket: { kind: 'no-combat-meaning', why: 'shop-OFFER enchant for this turn; a bought minion\'s stats bake permanently, the un-bought enchant enchants offers combat never sees' },
  rune_merchants_chorus: { kind: 'no-combat-meaning', why: 'shop-OFFER enchant for this turn (tavernBuyBonusTurn); same shape as dm_nightmarket' },

  // ── hero powers ──
  'hero:frank': { kind: 'no-combat-meaning', why: 'Frantic Frank\'s Clearance marks SHOP minions 2 Gold this turn; costs exist only in the shop half' },
  'hero:sable': { kind: 'conforms', why: 'Soulbind\'s bond is threaded as questCombatMods.soulbind and simulate() mirrors stat gains between the bound bodies IN combat — the bind spans the whole turn as printed' },
  'hero:mimic': { kind: 'conforms', why: 'the adopted power is the run\'s power until the next turn-start Discover replaces it, so it is live through this turn\'s combat' },
};
