import type { QuestReward } from '@game/core';
import { QUEST_DEFS } from './quests';
import { RUNES, EPIC_RUNES } from './runes';

/** The combat-flag name(s) a reward arms — combatFlag rewards carry it directly; Bone Throne's death-paced
 *  trigger sets `boneThroneStep`; `multi` recurses. Other reward kinds arm no combat flag. */
function flagsOf(reward: QuestReward): string[] {
  switch (reward.kind) {
    case 'combatFlag': return [reward.flag];
    case 'boneThrone': return ['boneThroneStep'];
    case 'multi': return reward.rewards.flatMap(flagsOf);
    default: return [];
  }
}

/** flag → the quest/rune id that armed it, derived once from the content. A `questTrigger` combat event carries
 *  the flag; the UI resolves it to the badge id so it can pulse the matching node. */
/** Combat runes whose reward kind carries no `combatFlag` (rallyRepeat / echoRepeat), yet which now emit a
 *  `questTrigger` so their badge bursts. `flagsOf` cannot derive these — the reward has no flag field — so the
 *  mapping is explicit. Safe against the shared state fields those effects use (rallyExtraAlways, etc.): the
 *  badge only renders, and so only bursts, for a rune the player actually owns. */
const EXTRA_COMBAT_FLAG_TO_ID: Record<string, string> = {
  runeStampede: 'rune_stampede',
  runeAdventuring: 'rune_adventuring',
  runeCatacomb: 'rune_catacomb',
  runeDrakeSkull: 'rune_drake_skull', // shoutEdgeBuff (tribe) — a combat Shout fire's edge buff
  twinSunOath: 'q_twin_sun_oath',      // shoutEdgeBuff — a combat Shout fire's edge buff
  runeChoir: 'rune_choir', // shoutRepeat — a combat-triggered Shout's standing extra (R-SHOUT-TRIGGER-01)
  runeConduit: 'rune_conduit', // runeConduit (no combatFlag) — a combat Ruby's extra bounce (owner 2026-10-16)
  // Runes whose reward KIND is their own primitive (no `combatFlag` to derive), yet whose combat effect logs a
  // `questTrigger` under that name (R-RUNE-COMBAT-FLASH-01, 2026-10-16). Unmapped, they fired invisibly.
  runeFiveBanners: 'rune_five_banners',   // Start of Combat: the Five Banners' buff
  runeEnchantment: 'rune_enchantment',    // a Shop Spell cast in combat
  runeHeldStrength: 'rune_held_strength', // Start of Combat: the held stats land
  runeLastTool: 'rune_last_tool',         // the grafted Echo's Equipment discount
  runeAncestralRoar: 'rune_ancestral_roar', // a dying Dragon's Shout fires as an Echo
};

/** flag → EVERY quest/rune id whose combat effect arms it, in content order (extras, quests, basic runes, Epic runes).
 *
 *  R-RUNE-COMBAT-FLASH-01 (2026-10-16): this used to scan `RUNES` only, so every EPIC rune's flag (the Wild Hunt and ~50
 *  more) resolved to null and its badge never bounced in combat, though the engine logged each fire. It scans the same
 *  rune lists `combatFlagOwner` (the beat registry) does. A list, not one id, because a flag can be shared: Rune of
 *  the Crowded Crypt and Rune of Overflow both arm `runeOverflow`, and whichever of the two you own must pulse. */
const FLAG_TO_IDS: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  const add = (flag: string, id: string): void => {
    const ids = (m[flag] ??= []);
    if (!ids.includes(id)) ids.push(id);
  };
  for (const [flag, id] of Object.entries(EXTRA_COMBAT_FLAG_TO_ID)) add(flag, id);
  for (const def of [...QUEST_DEFS, ...RUNES, ...EPIC_RUNES]) {
    for (const flag of flagsOf(def.reward)) add(flag, def.id);
  }
  return m;
})();

const NO_IDS: readonly string[] = [];

/** Every completed-quest / owned-rune id whose combat effect arms `flag` (empty for an unmapped flag). A `questTrigger`
 *  pulses each of these badges that is on screen; a badge only renders for a rune or quest that side holds. */
export function badgeIdsForCombatFlag(flag: string): readonly string[] {
  return FLAG_TO_IDS[flag] ?? NO_IDS;
}

/** The completed-quest / owned-rune id whose combat effect arms `flag` — so the UI can glow the matching badge
 *  when a `questTrigger` fires. Null for an unmapped flag (the badge simply doesn't pulse). The LAST owner in content
 *  order when a flag is shared; prefer `badgeIdsForCombatFlag`, which returns them all. */
export function badgeIdForCombatFlag(flag: string): string | null {
  const ids = FLAG_TO_IDS[flag];
  return ids && ids.length > 0 ? ids[ids.length - 1]! : null;
}
