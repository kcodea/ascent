import type { QuestReward } from '@game/core';
import { QUEST_DEFS } from './quests';
import { RUNES } from './runes';

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
};

const FLAG_TO_ID: Record<string, string> = (() => {
  const m: Record<string, string> = { ...EXTRA_COMBAT_FLAG_TO_ID };
  for (const def of [...QUEST_DEFS, ...RUNES]) {
    for (const flag of flagsOf(def.reward)) m[flag] = def.id;
  }
  return m;
})();

/** The completed-quest / owned-rune id whose combat effect arms `flag` — so the UI can glow the matching badge
 *  when a `questTrigger` fires. Null for an unmapped flag (the badge simply doesn't pulse). */
export function badgeIdForCombatFlag(flag: string): string | null {
  return FLAG_TO_ID[flag] ?? null;
}
