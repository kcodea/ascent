import type { QuestObjective, QuestReward, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * Display strings for quests, DERIVED from the quest data (no authored text on `QuestDef`). Used by the quest
 * shop cards (QuestCard) and the active-quest panel (QuestPanel), and kept here so both read identically.
 * Scaling rewards (Warm Embers' remaining Shouts, Trail Rations' repeat countdown) take a live-state hook so a
 * taken quest never prints a stale number — the card-text live-accuracy rule.
 */
const EVENT_VERB: Record<QuestObjective['event'], string> = { buy: 'Buy', play: 'Play', sell: 'Sell', roll: 'Roll', summon: 'Summon', shout: 'Play' };
const EVENT_NOUN: Record<QuestObjective['event'], string> = { buy: 'cards', play: 'minions', sell: 'minions', roll: 'times', summon: 'minions', shout: 'Shouts' };

/** Plural tribe noun for objective text ("Summon 4 Undead"). Undead is invariant. */
const TRIBE_PLURAL: Record<Tribe, string> = { beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs', demon: 'Demons', neutral: 'minions' };
const TRIBE_SINGULAR: Record<Tribe, string> = { beast: 'Beast', dragon: 'Dragon', undead: 'Undead', mech: 'Mech', demon: 'Demon', neutral: 'minion' };

/** "Play 3 minions" / "Summon 4 Undead" / "Play 2 Shouts" / "Roll 2 times". */
export function questObjectiveText(o: QuestObjective): string {
  const noun = o.event === 'summon' && o.tribe ? TRIBE_PLURAL[o.tribe] : EVENT_NOUN[o.event];
  return `${EVENT_VERB[o.event]} ${o.count} ${noun}`;
}

/** "a random Beast" / "2 random Undead" (Undead invariant). */
function randomMinionPhrase(tribe: Tribe, n: number): string {
  const noun = n === 1 ? TRIBE_SINGULAR[tribe] : TRIBE_PLURAL[tribe];
  return `${n === 1 ? 'a' : n} random ${noun}`;
}

/**
 * The reward, one line. `live` (when given, i.e. rendering a TAKEN quest in the panel) surfaces the current
 * value instead of the authored one: Warm Embers' remaining Shout-doubles, and Trail Rations' live repeat
 * countdown / whether the repeat has already fired.
 */
export function questRewardText(r: QuestReward, live?: { completed?: boolean; shoutCharges?: number; repeatTurns?: number }): string {
  switch (r.kind) {
    case 'buffBoard':
      return `Your board gets +${r.attack}/+${r.health}`;
    case 'grant': {
      const parts: string[] = [];
      if (r.randomTribe && (r.randomCount ?? 0) > 0) parts.push(randomMinionPhrase(r.randomTribe, r.randomCount!));
      for (const id of r.cards ?? []) parts.push(`a ${CARD_INDEX[id]?.name ?? 'card'}`);
      let text = parts.length ? (parts[0]!.startsWith('a ') || /^\d/.test(parts[0]!) ? `Get ${parts.join(' + ')}` : parts.join(' + ')) : '';
      if (r.repeatInTurns) {
        if (live?.completed) {
          text += live.repeatTurns && live.repeatTurns > 0 ? `. Repeats in ${live.repeatTurns} turn${live.repeatTurns === 1 ? '' : 's'}` : '. Repeat granted';
        } else {
          text += `. Repeats in ${r.repeatInTurns} turns`;
        }
      }
      return text;
    }
    case 'shoutDouble': {
      const n = live?.shoutCharges ?? r.count;
      if (live && n <= 0) return 'Shout-doubling spent';
      return `Your next ${n} ${n === 1 ? 'Shout triggers' : 'Shouts trigger'} twice`;
    }
    default:
      return '';
  }
}

/** Live objective progress: "2 / 3", or "Complete" once met. */
export function questProgressText(progress: number, o: QuestObjective, completed: boolean): string {
  return completed ? 'Complete' : `${Math.min(progress, o.count)} / ${o.count}`;
}
