import { CARD_INDEX } from '@game/content';
import { CONFIG, spellAttackBonus, spellDisplayText, spellHealthBonus, type BoardCard, type RunState } from '@game/sim';
import type { CardView } from './Card';
import {
  abhorrentHorrorText, ascendProgressText, cadenceProgressText, cardTypeTallyText, chefRaagText, clingProgressText,
  cryptDrakeText, karthusText, engraveTallyText, escalatingCastText, guelProgressText, hunterText, monkProgressText, packLeaderText, runescaleText, scTribeBuffPerPlayedText,
  ritualistText, sergeantText, soulsmanText, squirlScoutText, stepProgress, stewardText, summonBuffText, summonImproveText, summonScalingText, tallyBuffText,
  trailForagerText, transformProgressText, undeadBuyAtkText, watcherText,
} from './cardText';

/** Run-wide state + optional per-instance accruals for the live-text chain. Per-instance fields are absent
 *  (0) for a not-yet-owned shop / Discover preview — those helpers then fall back to the printed text. */
export interface LiveTextParams {
  tier: number;
  golden: boolean;
  spellBonus: number; spellBonusH: number; frontToBackBonus: number; frontToBackBonusH?: number;
  spellsThisTurn: number; spellsCast: number; deathrattlesTriggered: number;
  /** Rune of Mastery: how many times an Improve step applies (2 with the rune, else 1). Spirit Worgen's
   *  per-spell scaling folds it so the printed per-play grant matches what the sim actually adds. */
  improveReps?: number;
  clingEnchant?: { attack: number; health: number };
  fodderConsumed?: { attack: number; health: number };
  undeadBuyAtk: number; soulsmanGold: number; cardBuffs?: Record<string, { attack: number; health: number }>;
  /** The run-wide Imp Aura — Chef Raag's Echo grants your board this much (floored at +1/+1). Player-only:
   *  `enemyScalers` doesn't carry it, so an enemy Raag falls back to its printed text. */
  impAura?: { attack: number; health: number };
  spellProgress?: number; ascendProgress?: number; summonBonus?: number; overflowBonus?: number; hpGrantBonus?: number; eotTick?: number; eotBonus?: number; sellBonus?: number;
  /** Card ids you've played this recruit turn — Pack Leader / Spirit Worgen show their live per-play scaling. In
   *  COMBAT an enemy passes a pre-counted NUMBER instead (its snapshot doesn't carry the played ids). */
  playedThisTurn?: string[] | number;
  /** Combat-only per-instance accruals (from the MinionSnapshot), so the unified text covers combat-scaling cards
   *  too: Crypt Drake's total Attack seen, and an Engrave minion's permanent run gain. Absent (0) in the shop. */
  attackSeen?: number;
  permaGain?: { attack: number; health: number };
  /** Squirl Scout's run-wide accrued grant size — its live "+N/+N" next grant. */
  squirlScoutBuff?: number;
  /** Gold spent this recruit turn — Patch Job shows the current total it'll grant (steps × per-step value). */
  goldSpent?: number;
  /** Rune of Pillaging's raised Gold Pouch payout — the pouch's text shows its live value ("Gain 2 Gold."). */
  goldPouchValue?: number;
  /** Name of the most recent spell cast this run (`lastSpellCastId` → name) — Steward of Spells shows what it copies. */
  lastSpellName?: string;
  /** Triple-reward Discover spell: the tier captured when it was granted, so its "peek one tier up" text stays
   *  frozen (falls back to the live run tier when absent). */
  grantedTier?: number;
  /** The run's tier ceiling (`maxTierFor(run.rift)`) — Summit raises it to 7, so the Discover spell's printed
   *  "Tier N" must clamp to the RUN's ceiling, not the global one. Falls back to CONFIG.maxTier. */
  maxTier?: number;
}

/**
 * Compose a card's LIVE rule text (scaling values folded in — Guel's current grant, Grim's tally, Taragosa,
 * Sergeant, …, each green via `{{…}}`) plus its golden variant. The single source of truth used by the recruit
 * board (`instView`), the shop, and Discover, so a card ALWAYS shows its current value wherever it's offered.
 */
export function liveCardText(cardId: string, p: LiveTextParams): { text: string; goldenText: string | undefined } {
  const c = CARD_INDEX[cardId];
  const text =
    c.id === 'discoverspell'
      ? `**Discover** a **Tier ${Math.min(p.maxTier ?? CONFIG.maxTier, (p.grantedTier ?? p.tier) + 1)}** minion.` // frozen at grant tier
      : c.spell
        ? spellDisplayText(c.id, p.spellBonus, p.frontToBackBonus, p.spellBonusH, p.goldSpent ?? 0, p.frontToBackBonusH ?? p.frontToBackBonus, p.goldPouchValue ?? 0)
        : transformProgressText(c.id, p.spellProgress ?? 0) ??
            ascendProgressText(c.id, p.ascendProgress ?? 0) ??
            cryptDrakeText(c.id, p.golden, p.attackSeen ?? 0, p.summonBonus ?? 0) ?? // live grant + combat countdown
            karthusText(c.id, p.golden, p.summonBonus ?? 0) ?? // Karthus: live per-Slaughter grant
            engraveTallyText(c.id, p.permaGain) ?? // combat-only: null in the shop (no permaGain)
            watcherText(c.id, p.golden, p.spellBonus, p.spellBonusH) ?? // Watcher: live Lantern buff +x/+y (base + spell power, both stats)
            abhorrentHorrorText(c.id, p.fodderConsumed, p.golden) ??
            summonScalingText(c.id, p.spellsThisTurn * (p.improveReps ?? 1), p.golden) ?? // Spirit Worgen: recruit-only per-play scaling (per-spell part ×2 under Rune of Mastery)
            chefRaagText(c.id, p.golden, p.impAura) ?? // Chef Raag: live Imp-Aura grant (floored at +1/+1)
            runescaleText(c.id, p.golden, p.spellProgress ?? 0) ??
            scTribeBuffPerPlayedText(c.id, p.golden, p.playedThisTurn) ??
            packLeaderText(c.id, p.summonBonus ?? 0, p.golden) ??
            summonBuffText(c.id, p.summonBonus ?? 0, p.golden) ??
            summonImproveText(c.id, p.summonBonus ?? 0, p.golden) ??
            hunterText(c.id, p.summonBonus ?? 0, p.golden) ??
            trailForagerText(c.id, p.golden, p.sellBonus ?? 0) ??
            squirlScoutText(c.id, p.golden, p.squirlScoutBuff ?? 0) ??
            sergeantText(c.id, p.golden, p.hpGrantBonus ?? 0) ??
            ritualistText(c.id, p.golden, p.eotBonus ?? 0) ?? // Ritualist: live per-tick Fodder/Imp grant (climbs each End of Turn)
            stewardText(c.id, p.golden, p.lastSpellName) ??
            tallyBuffText(c.id, p.deathrattlesTriggered, p.golden) ??
            guelProgressText(c.id, p.golden, p.spellProgress ?? 0) ?? // per-instance: a shop/hand Guel reads at base
            monkProgressText(c.id, p.golden, p.summonBonus ?? 0, p.overflowBonus ?? 0) ??
            clingProgressText(c.id, p.clingEnchant) ??
            cadenceProgressText(c.id, p.eotTick ?? 0) ??
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
  return { text: text + metric, goldenText: goldenBase !== undefined ? goldenBase + metric : undefined };
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
  live?: { undeadBuyAtk?: number; soulsmanGold?: number; impAura?: { attack: number; health: number }; cardBuffs?: Record<string, { attack: number; health: number }>; castMult?: number; goldSpent?: number; goldPouchValue?: number; playedThisTurn?: string[]; squirlScoutBuff?: number; lastSpellName?: string; frontToBackBonusH?: number; onBoard?: boolean; eotTickOverride?: number; improveReps?: number },
): CardView {
  const c = CARD_INDEX[inst.cardId];
  const spell = c.spell === true || c.id === 'discoverspell';
  // During the End-of-Turn animation the cadence tick is PROJECTED one turn ahead (the reducer only commits
  // it in `faceOmen`, after the beats play), so the card text + step counter climb in sync with the medallion
  // pulse instead of jumping a turn later. Outside the animation this is the committed value.
  const eotTickShown = live?.eotTickOverride ?? inst.eotTick;
  // The full live rule text (+ golden variant) — shared with the shop / Discover via liveCardText.
  const { text, goldenText } = liveCardText(inst.cardId, {
    tier, golden: !!inst.golden, spellBonus, spellBonusH, frontToBackBonus, frontToBackBonusH: live?.frontToBackBonusH ?? frontToBackBonus, spellsThisTurn, spellsCast,
    deathrattlesTriggered, clingEnchant, fodderConsumed,
    undeadBuyAtk: live?.undeadBuyAtk ?? 0, soulsmanGold: live?.soulsmanGold ?? 0, cardBuffs: live?.cardBuffs, impAura: live?.impAura,
    goldSpent: live?.goldSpent ?? 0, goldPouchValue: live?.goldPouchValue ?? 0,
    spellProgress: inst.spellProgress, ascendProgress: inst.ascendProgress, summonBonus: inst.summonBonus,
    overflowBonus: inst.overflowBonus,
    hpGrantBonus: inst.hpGrantBonus, eotTick: eotTickShown, eotBonus: inst.eotBonus, sellBonus: inst.sellBonus,
    playedThisTurn: live?.playedThisTurn, squirlScoutBuff: live?.squirlScoutBuff,
    lastSpellName: live?.lastSpellName, grantedTier: inst.grantedTier, improveReps: live?.improveReps,
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
  const shownText = c.ruby ? `Give a minion **+${shownAtk}/+${shownHp}**.` : text;
  return {
    name: c.name, cardId: c.id, tribe: inst.tribe, tribe2: c.tribe2,
    universalTribe: !!c.universalTribe || !!(inst as { allTribes?: boolean }).allTribes,
    attack: shownAtk, health: shownHp,
    keywords: inst.keywords, text: shownText,
    goldenText,
    golden: inst.golden,
    tier: c.tier, spell, ruby: c.ruby, target: c.target, castMult: spell ? live?.castMult : undefined,
    baseAttack: inst.golden ? c.attack * 2 : c.attack,
    baseHealth: inst.golden ? c.health * 2 : c.health,
    buffs: inst.buffs,
    // Shop/board counter: only render once it has PROGRESS — a fresh 0/N reads as noise (owner ruling), so
    // hide at 0 and surface it from 1/N up. (Combat keeps its own 0/N → fades in on the first tick.)
    stepProgress: live?.onBoard
      ? ((): ReturnType<typeof stepProgress> => {
          const sp = stepProgress(inst.cardId, {
            spellProgress: inst.spellProgress, summonBonus: inst.summonBonus,
            ascendProgress: inst.ascendProgress, eotTick: eotTickShown, goldTick: inst.goldTick, buyTick: inst.buyTick,
          });
          return sp && sp.current > 0 ? sp : null;
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
    { undeadBuyAtk: run.undeadBuyAtk, soulsmanGold: run.soulsmanGold ?? 0, cardBuffs: run.cardBuffs, improveReps: run.runeMastery ? 2 : 1 },
  );
}
