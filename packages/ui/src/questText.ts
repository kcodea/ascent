import type { QuestObjective, QuestReward } from '@game/core';

/**
 * Display strings for quests, DERIVED from the quest data (no authored text on `QuestDef`). Used by the quest
 * shop cards (QuestCard) and the active-quest panel (QuestPanel), and kept here so both read identically.
 */
const EVENT_VERB: Record<QuestObjective['event'], string> = { buy: 'Buy', play: 'Play', sell: 'Sell', roll: 'Roll' };
const EVENT_NOUN: Record<QuestObjective['event'], string> = { buy: 'cards', play: 'minions', sell: 'minions', roll: 'times' };

/** "Play 3 minions" / "Buy 2 cards" / "Roll 2 times". */
export function questObjectiveText(o: QuestObjective): string {
  return `${EVENT_VERB[o.event]} ${o.count} ${EVENT_NOUN[o.event]}`;
}

/** The reward, one line. Skinny: the flat board buff. Grows with the reward palette. */
export function questRewardText(r: QuestReward): string {
  switch (r.kind) {
    case 'buffBoard':
      return `Your board gets +${r.attack}/+${r.health}`;
    default:
      return '';
  }
}

/** Live objective progress: "2 / 3", or "Complete" once met. */
export function questProgressText(progress: number, o: QuestObjective, completed: boolean): string {
  return completed ? 'Complete' : `${Math.min(progress, o.count)} / ${o.count}`;
}
