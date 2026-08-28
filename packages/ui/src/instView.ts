import type { Keyword } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { CONFIG, chooseBothActive, dominantBoardTribe, hasTier7Access, rubyStatBonus, runeStacksOf, spellAttackBonus, spellDisplayText, spellHealthBonus, type BoardCard, type RunState } from '@game/sim';
import type { CardView } from './Card';
import {
  abhorrentHorrorText, ascendProgressText, asymSummonBuffText, cadenceProgressText, cardTypeTallyText, chefRaagText, clingProgressText,
  cryptDrakeText, drunkenOafText, karthusText, engraveTallyText, escalatingCastText, guelProgressText, herzogText, hunterText, monkProgressText, packLeaderText, runescaleText, scTribeBuffPerPlayedText,
  archivistText, ashenHeirText, chooseBothText, attackGrantImproveText, castSpellPerGoldText, copyCastSpellText, runeModifiedNote, type RuneTextFlags, improvingSummonText, perCardPlayedText, rougeRogueText, perGoldSpentText, rallySpreadText, shopBuffImproveText, spellThresholdText, ritualistText, sergeantText, soulsmanText, squirlScoutText, conductorText, stepProgress, sporebatText, stewardText, thundeerText, summonBuffText, summonEscalatingText, summonFlatZooText, summonImproveText, soldProgressText, summitTierText, summonScalingText, tallyBuffText,
  ancientWandererText, ascendantTierText, musterTrooperText,
  taughtSpellText, trailForagerText, transformProgressText, undeadBuyAtkText, watcherText, withImpStats,
} from './cardText';

/** Run-wide state + optional per-instance accruals for the live-text chain. Per-instance fields are absent
 *  (0) for a not-yet-owned shop / Discover preview — those helpers then fall back to the printed text. */
export interface LiveTextParams {
  tier: number;
  golden: boolean;
  /** Rune of the Mammoth owned — the Mammoth's live text goes 1:1 symmetric. */
  runeMammoth?: boolean;
  /** Runes that change a specific card's printed RULE — surfaced as a green note on that card. */
  runeFlags?: RuneTextFlags;
  /** Rune of Rebirth handed THIS body the exact-copy Echo (combat only — the replay sets it from
   *  `sc.grantsEcho`). Per-instance: the rune picks one random friendly minion, so only that card prints it. */
  rebirthOwner?: boolean;
  spellBonus: number; spellBonusH: number; frontToBackBonus: number; frontToBackBonusH?: number; growthBonus?: number; juggler?: boolean;
  spellsThisTurn: number; spellsCast: number; deathrattlesTriggered: number;
  /** Rubies cast this run — the other half of the spell umbrella Herzog/Vaultkeeper read. */
  rubyCasts?: number;
  /** Rune of Mastery: how many times an Improve step applies (2 with the rune, else 1). Spirit Worgen's
   *  per-spell scaling folds it so the printed per-play grant matches what the sim actually adds. */
  improveReps?: number;
  clingEnchant?: { attack: number; health: number };
  fodderConsumed?: { attack: number; health: number };
  undeadBuyAtk: number; soulsmanGold: number; cardBuffs?: Record<string, { attack: number; health: number }>;
  /** The run-wide Imp Aura — Chef Raag's Echo grants your board this much (floored at +1/+1). Player-only:
   *  `enemyScalers` doesn't carry it, so an enemy Raag falls back to its printed text. */
  impAura?: { attack: number; health: number };
  spellProgress?: number; ascendProgress?: number; summonBonus?: number; overflowBonus?: number; hpGrantBonus?: number; eotTick?: number; eotBonus?: number; sellBonus?: number; soldProgress?: number; tier7Access?: boolean;
  /** Card ids you've played this recruit turn — Pack Leader / Spirit Worgen show their live per-play scaling. In
   *  COMBAT an enemy passes a pre-counted NUMBER instead (its snapshot doesn't carry the played ids). */
  playedThisTurn?: string[] | number;
  /** Combat-only per-instance accruals (from the MinionSnapshot), so the unified text covers combat-scaling cards
   *  too: Crypt Drake's total Attack seen, and an Engrave minion's permanent run gain. Absent (0) in the shop. */
  attackSeen?: number;
  permaGain?: { attack: number; health: number };
  /** Squirl Scout's run-wide accrued grant size — its live "+N/+N" next grant. */
  squirlScoutBuff?: number;
  conductorBuff?: number;
  /** True once the card is a real body (board or combat) rather than a shop/hand offer — Conductor reads the
   *  CURRENT snowball there, not "what playing this would make it". */
  onBoard?: boolean;
  /** Gold spent this recruit turn — Patch Job shows the current total it'll grant (steps × per-step value). */
  goldSpent?: number;
  /** Gold spent across the WHOLE RUN (`RunState.goldSpent`) — Ancient Wanderer's "+1/+1 per 3 Gold spent this
   *  run" prints the bonus it is actually carrying. Deliberately separate from `goldSpent` above, which is the
   *  per-TURN meter every other helper here reads: the two say different things and a card names which it
   *  means. Player-only in combat (an enemy snapshot carries no run), like the other run-scoped scalers. */
  goldSpentRun?: number;
  /** Rune of Pillaging's raised Gold Pouch payout — the pouch's text shows its live value ("Gain 2 Gold."). */
  goldPouchValue?: number;
  /** Name of the most recent spell cast this run (`lastSpellCastId` → name) — Steward of Spells shows what it copies. */
  lastSpellName?: string;
  /** Runesnout Archivist's journal, resolved to spell NAMES. */
  rememberedSpellNames?: readonly string[];
  /** Ashen Heir's banked Imp stats (combat only). */
  impBank?: { attack: number; health: number };
  /** The first / last Shop spell cast THIS TURN (names) — Spellvault Drake and Recaller print what they copy. */
  firstSpellThisTurnName?: string;
  lastSpellThisTurnName?: string;
  /** Spell Warden's own since-placed first-spell record (`BoardCard.boardFirstSpellId` → name). */
  keeperFirstSpellName?: string;
  /** The board's dominant tribe — Ruby Shipment names the type it would hand over right now. */
  topTribe?: string | null;
  /** Triple-reward Discover spell: the tier captured when it was granted, so its "peek one tier up" text stays
   *  frozen (falls back to the live run tier when absent). */
  grantedTier?: number;
  /** The run's tier ceiling (`maxTierFor(run.rift)`) — Summit raises it to 7, so the Discover spell's printed
   *  "Tier N" must clamp to the RUN's ceiling, not the global one. Falls back to CONFIG.maxTier. */
  maxTier?: number;
  /** The run's Ruby bonus (Set 2) — Veinstorm shows the live Ruby stat line (1/1 + this) it grants the shop. */
  rubyBonus?: { attack: number; health: number };
  /** Sunmane Herald's live escalating rally value (combat-only) — its printed "+3" is only the opening rung. */
  rallySpreadAtk?: number;
  /** Mage-Pup: the spell Moonhowl Mentor taught THIS token, so its Shout line can print that spell's actual
   *  rule instead of "the spell this was taught". Absent on every other card. */
  taughtSpellId?: string;
  /** Choose One: the branch this INSTANCE picked (`BoardCard.chosenOption`). Once chosen, the card only does
   *  that one thing, so it prints only that branch — listing the road not taken is a lie about what the body
   *  on your board now does (owner 2026-07-24). Absent for a shop/Discover preview, which still shows both. */
  chosenOption?: number;
  /** (BOTH): every branch of this Choose One is already enabled for this instance — a golden `chooseBothWhenGolden`
   *  card, or Facetwright / Veinbreaker under their runes. Computed by the ONE shared predicate
   *  (`chooseBothActive` in `@game/sim`) that also decides whether the reducer prompts, so the printed text and
   *  the actual behaviour can never disagree: the card prints a coloured (Both) with BOTH option texts. */
  chooseBoth?: boolean;
  /** Dwarven Ales cast this recruit turn (`run.alesCastThisTurn`) — Drunken Oaf prints how many times its
   *  Start of Combat will actually fire. Player-only: an enemy's snapshot carries no Ale count, so a served
   *  Oaf falls back to its printed text like every other run-scoped scaler. */
  alesThisTurn?: number;
  /** Rune of the Zoo (combat only): the player's combat-summon tally at the current beat — Beardsley prints
   *  the buff the NEXT summon will actually get (base × golden × (this + 1)). Undefined = no rune / shop. */
  zooSummons?: number | null;
}

/**
 * Compose a card's LIVE rule text (scaling values folded in — Guel's current grant, Grim's tally, Taragosa,
 * Sergeant, …, each green via `{{…}}`) plus its golden variant. The single source of truth used by the recruit
 * board (`instView`), the shop, and Discover, so a card ALWAYS shows its current value wherever it's offered.
 */
export function liveCardText(cardId: string, p: LiveTextParams): { text: string; goldenText: string | undefined } {
  const c = CARD_INDEX[cardId];
  // A RESOLVED Choose One prints only the branch it became — the other option is no longer something this body
  // can do. Applies to every Choose One card, golden included (a golden reads its option's `goldenText`, which
  // is where the doubled magnitude lives). Returned before the scaling chain below because no Choose One option
  // currently carries a live-scaling value; when one does, its helper must be threaded through here too.
  const picked = p.chosenOption !== undefined ? c.chooseOne?.[p.chosenOption] : undefined;
  if (picked) return { text: picked.text, goldenText: picked.goldenText ?? picked.text };
  // (BOTH) — the branches are all enabled, so there is no choice to print. Deliberately AFTER `picked`: a body
  // that already resolved one branch keeps doing only that branch even if a rune arrives afterwards.
  if (p.chooseBoth) {
    const both = chooseBothText(cardId, p.golden);
    if (both) return { text: both, goldenText: both };
  }
  // A taught Mage-Pup prints the spell it will cast, resolved through the SAME live spell-text chain the shop
  // uses — so a taught Spirit Fire shows its spell-power-boosted numbers, not the printed base.
  if (p.taughtSpellId) {
    const taught = taughtSpellText(c.id, p.taughtSpellId, spellDisplayText(
      p.taughtSpellId, p.spellBonus, p.frontToBackBonus, p.spellBonusH, p.goldSpent ?? 0,
      p.frontToBackBonusH ?? p.frontToBackBonus, p.goldPouchValue ?? 0,
      { rubyBonus: p.rubyBonus, playedThisTurn: Array.isArray(p.playedThisTurn) ? p.playedThisTurn : undefined, tier: p.tier },
    ));
    if (taught) return { text: taught, goldenText: taught };
  }
  const text =
    c.id === 'discoverspell'
      ? `**Discover** a **Tier ${Math.min(p.maxTier ?? CONFIG.maxTier, (p.grantedTier ?? p.tier) + 1)}** minion.` // frozen at grant tier
      : c.spell
        ? spellDisplayText(c.id, p.spellBonus, p.frontToBackBonus, p.spellBonusH, p.goldSpent ?? 0, p.frontToBackBonusH ?? p.frontToBackBonus, p.goldPouchValue ?? 0, { rubyBonus: p.rubyBonus, playedThisTurn: Array.isArray(p.playedThisTurn) ? p.playedThisTurn : undefined, tier: p.tier, topTribe: p.topTribe as never, growthBonus: p.growthBonus })
        : transformProgressText(c.id, p.spellProgress ?? 0) ??
            ascendProgressText(c.id, p.ascendProgress ?? 0) ??
            cryptDrakeText(c.id, p.golden, p.attackSeen ?? 0, p.summonBonus ?? 0) ?? // live grant + combat countdown
            rallySpreadText(c.id, p.golden, p.rallySpreadAtk) ?? // Sunmane: the rally's CURRENT (doubled) grant
            karthusText(c.id, p.golden, p.summonBonus ?? 0) ?? // Karthus: live per-Slaughter grant
            engraveTallyText(c.id, p.permaGain) ?? // combat-only: null in the shop (no permaGain)
            watcherText(c.id, p.golden, p.spellBonus, p.spellBonusH) ?? // Watcher: live Lantern buff +x/+y (base + spell power, both stats)
            abhorrentHorrorText(c.id, p.fodderConsumed, p.golden) ??
            summonScalingText(c.id, p.spellsThisTurn * (p.improveReps ?? 1), p.golden) ?? // Spirit Worgen: recruit-only per-play scaling (per-spell part ×2 under Rune of Mastery)
            chefRaagText(c.id, p.golden, p.impAura) ?? // Chef Raag: live Imp-Aura grant (floored at +1/+1)
            runescaleText(c.id, p.golden, p.spellProgress ?? 0) ??
            scTribeBuffPerPlayedText(c.id, p.golden, p.playedThisTurn) ??
            drunkenOafText(c.id, p.golden, p.alesThisTurn) ?? // Drunken Oaf: how many times it repeats right now

            packLeaderText(c.id, p.summonBonus ?? 0, p.golden) ??
            asymSummonBuffText(c.id, p.summonBonus ?? 0, p.golden) ?? // Groveweaver: live asymmetric grant
            summonEscalatingText(c.id, p.golden, p.summonBonus) ?? // Beardsley: the current escalating grant + countdown
            summonFlatZooText(c.id, p.golden, p.zooSummons) ?? // Beardsley under Rune of the Zoo: the NEXT summon's live grant
            summonBuffText(c.id, p.summonBonus ?? 0, p.golden) ??
            summitTierText(c.id, p.tier7Access ?? false) ?? // Beyond the Summit: only promise Tier 7 when reachable
            summonImproveText(c.id, p.summonBonus ?? 0, p.golden) ??
            attackGrantImproveText(c.id, p.summonBonus ?? 0, p.golden, p.runeMammoth) ?? // Menagerie Mammoth: escalating grant (+Health with the rune)
            soldProgressText(c.id, p.soldProgress ?? 0) ?? // Runic Archivist: sales still owed
            hunterText(c.id, p.summonBonus ?? 0, p.golden) ??
            trailForagerText(c.id, p.golden, p.sellBonus ?? 0) ??
            thundeerText(c.id, p.summonBonus ?? 0, p.golden) ??
            squirlScoutText(c.id, p.golden, p.squirlScoutBuff ?? 0) ??
            conductorText(c.id, p.golden, p.conductorBuff ?? 0, p.improveReps, p.onBoard) ??
            sergeantText(c.id, p.golden, p.hpGrantBonus ?? 0) ??
            ritualistText(c.id, p.golden, p.eotBonus ?? 0) ?? // Ritualist: live per-tick Fodder/Imp grant (climbs each End of Turn)
            stewardText(c.id, p.golden, p.lastSpellName) ??
            sporebatText(c.id, p.golden, p.lastSpellName) ?? // Sporebat: name the stored spell it will cast
            archivistText(c.id, p.golden, p.rememberedSpellNames) ?? // Runesnout Archivist: name its whole journal
            ashenHeirText(c.id, p.impBank) ?? // Ashen Heir: what the next Imp actually inherits
            copyCastSpellText(c.id, p.golden, { firstThisTurn: p.firstSpellThisTurnName, lastThisTurn: p.lastSpellThisTurnName, keeperFirst: p.keeperFirstSpellName }) ?? // the Dragon copiers name the spell they will give
            improvingSummonText(c.id, p.summonBonus ?? 0, p.golden) ?? // Oona / Broodwright: the Avenge-improved grant
            rougeRogueText(c.id, p.golden, p.summonBonus ?? 0) ?? // Rouge Rogue: its per-combat escalating Imp grant
            tallyBuffText(c.id, p.deathrattlesTriggered, p.golden) ??
            ancientWandererText(c.id, p.goldSpentRun ?? 0, p.golden) ?? // Ancient Wanderer: the +A/+H it HAS right now
            musterTrooperText(c.id, p.summonBonus ?? 0, p.golden) ?? // Muster General: the Trooper's live stat line
            ascendantTierText(c.id, p.golden, p.tier7Access ?? false) ?? // Skybound Ascendant: the tier it can ACTUALLY reach
            perGoldSpentText(c.id, p.goldSpent ?? 0, p.golden) ?? // Baby Gastrid: the Health it grants RIGHT NOW
            castSpellPerGoldText(c.id, p.goldSpent ?? 0, p.golden) ?? // Rope Wrangler: live Lasso cast count
            perCardPlayedText(c.id, Array.isArray(p.playedThisTurn) ? p.playedThisTurn.length : 0, p.golden) ?? // Foreman: same, per card played
            shopBuffImproveText(c.id, p.summonBonus ?? 0, p.golden) ?? // Soul Defiler: its climbing Shop buff
            guelProgressText(c.id, p.golden, p.spellProgress ?? 0) ??
            herzogText(c.id, p.golden, p.spellsCast + (p.rubyCasts ?? 0)) ?? // Herzog/Vaultkeeper: scales with the SPELL umbrella (Shop Spells + Rubies)
            spellThresholdText(c.id, p.golden, p.spellProgress ?? 0) ?? // Mykel: spells remaining until it fires // per-instance: a shop/hand Guel reads at base
            monkProgressText(c.id, p.golden, p.summonBonus ?? 0, p.overflowBonus ?? 0) ??
            clingProgressText(c.id, p.clingEnchant) ??
            cadenceProgressText(c.id, p.eotTick ?? 0, p.golden) ??
            escalatingCastText(c.id, p.golden, p.eotTick ?? 0, p.spellBonus, p.spellBonusH) ??
            c.text;
  const metric =
    soulsmanText(c.id, p.soulsmanGold) ??
    undeadBuyAtkText(c.id, p.undeadBuyAtk) ??
    cardTypeTallyText(c.id, p.cardBuffs?.[c.id]) ??
    '';
  // Golden card whose live text resolved (differs from the printed fallback) → that IS the golden-aware live
  // value; feed it as the golden text. Otherwise fall back to the printed goldenText.
  const goldenBase = p.golden && text !== c.text ? text : c.goldenText;
  // RUNE-NOTE post-pass (owner rule 2026-08-02): a rune that changes this card's printed RULE says so on the
  // card, composing with whatever live values the chain injected above. Both variants carry it.
  const runeNote = runeModifiedNote(c.id, p.runeFlags);
  const noted = runeNote ? `${text} ${runeNote}` : text;
  const notedGolden = goldenBase !== undefined && runeNote ? `${goldenBase} ${runeNote}` : goldenBase;
  // Live Imp-stat annotation (owner 2026-08-11): fold the summoned Imp's current X/Y into the "summon … Imp"
  // phrase, ON TOP of whatever the scaling chain produced. A no-op for non-summoners. Both variants carry it.
  const impText = withImpStats(cardId, noted, p.impAura);
  const impGolden = notedGolden !== undefined ? withImpStats(cardId, notedGolden, p.impAura) : undefined;
  // RUNE OF REBIRTH — the "Rebirth" word in BLUE (the `[[…]]` marker; Card renders `.descrune`).
  //
  // PER-INSTANCE, not run-wide (owner report 2026-08-22: "it is putting the rebirth text on all my minions I
  // control, not the single one it triggers on"). The rune gives the exact-copy Echo to ONE random friendly
  // minion at Start of Combat, so keying the tag off the run flag printed a rule on all seven bodies that
  // only one of them would ever have. `rebirthOwner` is set by the combat replay for the body the grant
  // actually landed on (`sc.grantsEcho`).
  //
  // Nothing carries it in the SHOP by design: before the fight begins no minion has been chosen yet, so there
  // is no true card to put it on — the rune's own badge is what says you hold it.
  const rebirthTag = p.rebirthOwner && !c.spell && !c.ruby && c.id !== 'discoverspell' ? ' [[Rebirth]]' : '';
  return {
    text: impText + metric + rebirthTag,
    goldenText: impGolden !== undefined ? impGolden + metric + rebirthTag : undefined,
  };
}

/**
 * Compose a live `CardView` for a board/hand minion instance — the single source of truth for how a minion
 * reads on the recruit board AND the end-screen final warband. It folds every live value into the card:
 * scaling rule text (Guel's current grant, Sergeant's climbing Deathrattle, Mama Bear, Taragosa, …) with the
 * changed number wrapped in `{{…}}` (green), run-wide auras (Lantern of Souls on Undead), and appended metric
 * tags (Soulsman's Gold, the undeadBuyAtk a new Undead inherits, Eternal Knight's run-wide enchant). Pure —
 * given the instance + the run-wide live inputs, it derives the display without touching game state.
 */
export function instView(
  inst: BoardCard,
  tier = 1,
  override?: { attack: number; health: number },
  spellBonus = 0,
  spellBonusH = 0,
  spellsThisTurn = 0,
  deathrattlesTriggered = 0,
  undeadAtkBonus = 0,
  undeadHpBonus = 0,
  frontToBackBonus = 0,
  _wave = 1, // (was Hoarder's sell-scaling; kept positional so call sites don't shift)
  spellsCast = 0,
  clingEnchant?: { attack: number; health: number },
  fodderConsumed?: { attack: number; health: number },
  live?: { undeadBuyAtk?: number; soulsmanGold?: number; impAura?: { attack: number; health: number }; cardBuffs?: Record<string, { attack: number; health: number }>; castMult?: number; goldSpent?: number; goldSpentRun?: number; goldPouchValue?: number; playedThisTurn?: string[]; squirlScoutBuff?: number; conductorBuff?: number; lastSpellName?: string; rememberedSpellNames?: readonly string[]; impBank?: { attack: number; health: number }; firstSpellThisTurnName?: string; lastSpellThisTurnName?: string; topTribe?: string | null; frontToBackBonusH?: number; onBoard?: boolean; eotTickOverride?: number; improveReps?: number; rubyCasts?: number; rubyBonus?: { attack: number; health: number }; grimoireCharged?: boolean; runeMammoth?: boolean; runeFlags?: RuneTextFlags; tier7Access?: boolean; alesThisTurn?: number; /** The run flags the (Both) predicate reads (`runeFacetwright` / `runeUnbrokenVein`) — passed rather than a precomputed boolean so the ONE predicate stays the only place the rule lives. */ chooseBothState?: { runeFacetwright?: boolean; runeUnbrokenVein?: boolean } },
): CardView {
  const c = CARD_INDEX[inst.cardId];
  const spell = c.spell === true || c.id === 'discoverspell';
  // During the End-of-Turn animation the cadence tick is PROJECTED one turn ahead (the reducer only commits
  // it in `faceOmen`, after the beats play), so the card text + step counter climb in sync with the medallion
  // pulse instead of jumping a turn later. Outside the animation this is the committed value.
  const eotTickShown = live?.eotTickOverride ?? inst.eotTick;
  // The full live rule text (+ golden variant) — shared with the shop / Discover via liveCardText.
  // (BOTH) — the ONE predicate, shared with the printed text below and with the reducer's prompt decision.
  const chooseBoth = chooseBothActive(live?.chooseBothState ?? {}, inst, c);
  const { text, goldenText } = liveCardText(inst.cardId, {
    tier, golden: !!inst.golden, spellBonus, spellBonusH, frontToBackBonus, frontToBackBonusH: live?.frontToBackBonusH ?? frontToBackBonus, spellsThisTurn, spellsCast, rubyCasts: live?.rubyCasts,
    deathrattlesTriggered, clingEnchant, fodderConsumed,
    undeadBuyAtk: live?.undeadBuyAtk ?? 0, soulsmanGold: live?.soulsmanGold ?? 0, cardBuffs: live?.cardBuffs, impAura: live?.impAura,
    goldSpent: live?.goldSpent ?? 0, goldSpentRun: live?.goldSpentRun ?? 0, goldPouchValue: live?.goldPouchValue ?? 0,
    spellProgress: inst.spellProgress, ascendProgress: inst.ascendProgress, summonBonus: inst.summonBonus,
    overflowBonus: inst.overflowBonus,
    hpGrantBonus: inst.hpGrantBonus, eotTick: eotTickShown, eotBonus: inst.eotBonus, sellBonus: inst.sellBonus, soldProgress: inst.soldProgress,
    playedThisTurn: live?.playedThisTurn, squirlScoutBuff: live?.squirlScoutBuff, conductorBuff: live?.conductorBuff, onBoard: live?.onBoard, alesThisTurn: live?.alesThisTurn,
    lastSpellName: live?.lastSpellName, grantedTier: inst.grantedTier, improveReps: live?.improveReps,
    rememberedSpellNames: live?.rememberedSpellNames, impBank: live?.impBank,
    firstSpellThisTurnName: live?.firstSpellThisTurnName, lastSpellThisTurnName: live?.lastSpellThisTurnName,
    keeperFirstSpellName: inst.boardFirstSpellId ? CARD_INDEX[inst.boardFirstSpellId]?.name : undefined,
    topTribe: live?.topTribe,
    runeMammoth: live?.runeMammoth,
    runeFlags: live?.runeFlags,
    rubyBonus: live?.rubyBonus,
    tier7Access: live?.tier7Access,
    chosenOption: inst.chosenOption, // a resolved Choose One prints only the branch it became
    chooseBoth, // (Both) — no choice to print
    taughtSpellId: inst.taughtSpellId, // a Mage-Pup prints the spell it was taught
  });
  // `override` shows transient stats during the End-of-Turn animation (the per-proc value the minion
  // is at on this beat), so its numbers visibly tick up as each effect procs. Otherwise the real stats.
  // Lantern of Souls is a run-wide Undead aura — fold it on top of the shown stats for any Undead so
  // the board/hand reflect it in the shop too (combat re-derives the same bump). Spells are never Undead.
  const undead = !spell && (inst.tribe === 'undead' || c.tribe2 === 'undead' || !!c.universalTribe);
  const auraAtk = undead ? undeadAtkBonus : 0;
  const auraHp = undead ? undeadHpBonus : 0;
  const shownAtk = (override?.attack ?? inst.attack) + auraAtk;
  const shownHp = (override?.health ?? inst.health) + auraHp;
  // A Ruby renders with the spell look (no stat footer), so its GRANT must live in the text — "+A/+H" where
  // A/H are the stats it was minted with (base 1/1 + the run's rubyBonus). Live by construction: the numbers
  // ARE the card's current stats.
  // A BUFFED Ruby (minted above its printed 1/1 by the run's `rubyBonus`, or grown in hand) shows its grant in
  // green via the standard `{{…}}` modified-value marker — the same cue every other scaled number uses.
  const rubyVal = `+${shownAtk}/+${shownHp}`;
  // Next-combat spell grants (Last Stand, …): the granting spell's name rides the text as a gold
  // parenthesized tag — ((label)) renders via the Card's `desctemp` marker — and the promised keyword badge
  // previews on the minion until combat spends it.
  const tempTags = (inst.tempGrants ?? []).map((g) => ` ((${g.label}))`).join('');
  const shownKeywords = inst.tempGrants?.length
    ? [...inst.keywords, ...inst.tempGrants.map((g) => g.keyword as Keyword).filter((k) => !inst.keywords.includes(k))]
    : inst.keywords;
  const shownText = c.ruby
    ? `Give a minion **${shownAtk > c.attack || shownHp > c.health ? `{{${rubyVal}}}` : rubyVal}**${c.rubyGrantKeyword === 'DS' ? '. Also give it **Ward** if it is a **Kobold**' : ''}.`
    : text;
  return {
    name: c.name, cardId: c.id, tribe: inst.tribe, tribe2: c.tribe2,
    chosenOption: inst.chosenOption, // a resolved Choose One also wears the ART of the branch it became
    // (Both) MARKER hook — a card still WAITING to be played (hand). A body already on the board has resolved
    // its Choose One, so it is not a promise any more and carries no marker.
    chooseBothKey: chooseBoth && !live?.onBoard ? inst.uid : undefined,
    universalTribe: !!c.universalTribe || !!(inst as { allTribes?: boolean }).allTribes,
    attack: shownAtk, health: shownHp,
    keywords: shownKeywords, text: shownText + tempTags,
    goldenText,
    golden: inst.golden,
    tier: c.tier, spell, ruby: c.ruby, target: c.target,
    // Rubies show the ×N badge too (owner 2026-07-24) — this gate dropped it for anything not flagged `spell`,
    // and a Ruby carries `ruby: true` WITHOUT `spell: true`, so a multi-cast Ruby showed no badge at all.
    castMult: spell || c.ruby ? live?.castMult : undefined,
    baseAttack: inst.golden ? c.attack * 2 : c.attack,
    baseHealth: inst.golden ? c.health * 2 : c.health,
    buffs: inst.buffs,
    // Shop/board counter: only render once it has PROGRESS — a fresh 0/N reads as noise (owner ruling), so
    // hide at 0 and surface it from 1/N up. (Combat keeps its own 0/N → fades in on the first tick.)
    stepProgress: live?.onBoard
      ? ((): ReturnType<typeof stepProgress> => {
          const sp = stepProgress(inst.cardId, {
            spellProgress: inst.spellProgress, summonBonus: inst.summonBonus,
            ascendProgress: inst.ascendProgress, eotTick: eotTickShown, goldTick: inst.goldTick, buyTick: inst.buyTick, playTick: inst.playTick, rubyCastTick: inst.rubyCastTick,
            shoutTick: inst.shoutTick, soldProgress: inst.soldProgress, grimoireCharged: live?.grimoireCharged,
            orbitTick: inst.orbitTick, // CELESTIAL Orbit (N) — the shop-phase cadence counter
          });
          // Normally a fresh 0/N is hidden as noise (owner ruling). The Living Grimoire is the deliberate
          // exception: 0/3 is the whole point there — it's how you see the card is SPENT and how far the
          // recharge has come (owner ask 2026-07-24).
          const showsZero = inst.cardId === 'd2_grimoire';
          return sp && (sp.current > 0 || showsZero) ? sp : null;
        })() ?? undefined
      : undefined,
  };
}

/** A live `CardView` for a final-warband minion — wires the run-wide inputs into `instView` so scaling cards
 *  (Guel, Sergeant, Taragosa, …) show their *accumulated* magnitude at run's end, not the printed base, and
 *  run-wide auras (Lantern of Souls on Undead) fold into the shown stats. Shared by the end screen and the
 *  final-board capture (leaderboard / Career), so all three read identically. */
export function liveBoardView(m: BoardCard, run: RunState): CardView {
  return instView(
    m, run.tier, undefined, spellAttackBonus(run), spellHealthBonus(run), run.spellsThisTurn,
    run.deathrattlesTriggered, run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus,
    run.wave, run.spellsCast, run.cardBuffs?.cling, run.fodderConsumedThisTurn,
    // The FULL live object (audit 2026-08-06: this passed 4 fields, so Squirl Scout / Kringle / Steward /
    // the Dragon copiers / rune notes all read base on the final warband). Mirrors Recruit's `live` memo.
    {
      undeadBuyAtk: run.undeadBuyAtk, soulsmanGold: run.soulsmanGold ?? 0, cardBuffs: run.cardBuffs,
      improveReps: run.runeMastery ? 1 + runeStacksOf(run, 'rune_mastery') : 1, impAura: run.impBuff, // +1 per Mastery copy (owner 2026-08-27)
      goldSpent: run.goldSpentThisTurn ?? 0, goldSpentRun: run.goldSpent, goldPouchValue: run.goldPouchValue,
      playedThisTurn: run.playedThisTurn, squirlScoutBuff: run.squirlScoutBuff, conductorBuff: run.conductorBuff,
      lastSpellName: run.lastSpellCastId ? CARD_INDEX[run.lastSpellCastId]?.name : undefined,
      rememberedSpellNames: (run.rememberedSpellIds ?? []).map((id) => CARD_INDEX[id]?.name).filter((n): n is string => !!n),
      firstSpellThisTurnName: run.firstSpellThisTurnId ? CARD_INDEX[run.firstSpellThisTurnId]?.name : undefined,
      lastSpellThisTurnName: run.lastSpellThisTurnId ? CARD_INDEX[run.lastSpellThisTurnId]?.name : undefined,
      topTribe: dominantBoardTribe(run), rubyBonus: rubyStatBonus(run), tier7Access: hasTier7Access(run),
      runeMammoth: !!run.questFlags?.runeMammoth,
      runeFlags: { matriarch: !!run.runeMatriarch, brokerage: !!run.runeBrokerage, livingTreasure: !!run.questFlags?.runeLivingTreasure },
      chooseBothState: { runeFacetwright: run.runeFacetwright, runeUnbrokenVein: run.runeUnbrokenVein },
    },
  );
}
