import { CARD_INDEX } from '@game/content';
import { CONFIG, spellDisplayText, type BoardCard } from '@game/sim';
import type { CardView } from './Card';
import {
  abhorrentHorrorText, ascendProgressText, cadenceProgressText, cardTypeTallyText, clingProgressText,
  escalatingCastText, guelProgressText, monkProgressText, scTribeBuffPerSpellText, sergeantText, soulsmanText,
  summonBuffText, summonImproveText, summonScalingText, tallyBuffText, taragosaText, transformProgressText,
  undeadBuyAtkText, watcherText,
} from './cardText';

/** Run-wide state + optional per-instance accruals for the live-text chain. Per-instance fields are absent
 *  (0) for a not-yet-owned shop / Discover preview — those helpers then fall back to the printed text. */
export interface LiveTextParams {
  tier: number;
  golden: boolean;
  spellBonus: number; spellBonusH: number; frontToBackBonus: number;
  spellsThisTurn: number; spellsCast: number; deathrattlesTriggered: number;
  clingEnchant?: { attack: number; health: number };
  fodderConsumed?: { attack: number; health: number };
  undeadBuyAtk: number; soulsmanGold: number; cardBuffs?: Record<string, { attack: number; health: number }>;
  spellProgress?: number; ascendProgress?: number; summonBonus?: number; overflowBonus?: number; hpGrantBonus?: number; eotTick?: number;
  /** Gold spent this recruit turn — Patch Job shows the current total it'll grant (steps × per-step value). */
  goldSpent?: number;
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
      ? `**Discover** a **Tier ${Math.min(CONFIG.maxTier, p.tier + 1)}** minion.`
      : c.spell
        ? spellDisplayText(c.id, p.spellBonus, p.frontToBackBonus, p.spellBonusH, p.goldSpent ?? 0)
        : transformProgressText(c.id, p.spellProgress ?? 0) ??
            ascendProgressText(c.id, p.ascendProgress ?? 0) ??
            taragosaText(c.id, p.golden, p.spellBonus, p.spellBonusH) ??
            watcherText(c.id, p.golden, p.spellBonus, p.spellBonusH) ?? // Watcher: live Lantern buff +x/+y (base + spell power, both stats)
            abhorrentHorrorText(c.id, p.fodderConsumed, p.golden) ??
            summonScalingText(c.id, p.spellsThisTurn) ??
            scTribeBuffPerSpellText(c.id, p.golden, p.spellsThisTurn) ??
            summonBuffText(c.id, p.summonBonus ?? 0) ??
            summonImproveText(c.id, p.summonBonus ?? 0, p.golden) ??
            sergeantText(c.id, p.golden, p.hpGrantBonus ?? 0) ??
            tallyBuffText(c.id, p.deathrattlesTriggered) ??
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
  live?: { undeadBuyAtk?: number; soulsmanGold?: number; cardBuffs?: Record<string, { attack: number; health: number }>; castMult?: number; goldSpent?: number },
): CardView {
  const c = CARD_INDEX[inst.cardId];
  const spell = c.spell === true || c.id === 'discoverspell';
  // The full live rule text (+ golden variant) — shared with the shop / Discover via liveCardText.
  const { text, goldenText } = liveCardText(inst.cardId, {
    tier, golden: !!inst.golden, spellBonus, spellBonusH, frontToBackBonus, spellsThisTurn, spellsCast,
    deathrattlesTriggered, clingEnchant, fodderConsumed,
    undeadBuyAtk: live?.undeadBuyAtk ?? 0, soulsmanGold: live?.soulsmanGold ?? 0, cardBuffs: live?.cardBuffs,
    goldSpent: live?.goldSpent ?? 0,
    spellProgress: inst.spellProgress, ascendProgress: inst.ascendProgress, summonBonus: inst.summonBonus,
    overflowBonus: inst.overflowBonus,
    hpGrantBonus: inst.hpGrantBonus, eotTick: inst.eotTick,
  });
  // `override` shows transient stats during the End-of-Turn animation (the per-proc value the minion
  // is at on this beat), so its numbers visibly tick up as each effect procs. Otherwise the real stats.
  // Lantern of Souls is a run-wide Undead aura — fold it on top of the shown stats for any Undead so
  // the board/hand reflect it in the shop too (combat re-derives the same bump). Spells are never Undead.
  const undead = !spell && (inst.tribe === 'undead' || c.tribe2 === 'undead' || !!c.universalTribe);
  const auraAtk = undead ? undeadAtkBonus : 0;
  const auraHp = undead ? undeadHpBonus : 0;
  return {
    name: c.name, cardId: c.id, tribe: inst.tribe, tribe2: c.tribe2,
    attack: (override?.attack ?? inst.attack) + auraAtk, health: (override?.health ?? inst.health) + auraHp,
    keywords: inst.keywords, text,
    goldenText,
    golden: inst.golden,
    tier: c.tier, spell, target: c.target, castMult: spell ? live?.castMult : undefined,
    baseAttack: inst.golden ? c.attack * 2 : c.attack,
    baseHealth: inst.golden ? c.health * 2 : c.health,
    buffs: inst.buffs,
  };
}
