import type { Keyword, QuestObjective, QuestObjectiveEvent, QuestReward, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * Display strings for quests, DERIVED from the quest data (no authored text on `QuestDef`). Used by the quest
 * shop cards (QuestCard) and the active-quest panel (QuestPanel), and kept here so both read identically.
 * Scaling rewards (Warm Embers' remaining Shouts, Trail Rations' repeat countdown) take a live-state hook so a
 * taken quest never prints a stale number — the card-text live-accuracy rule.
 */
const EVENT_VERB: Partial<Record<QuestObjectiveEvent, string>> = { play: 'Play', sell: 'Sell', roll: 'Roll', shout: 'Play' };
const EVENT_NOUN: Partial<Record<QuestObjectiveEvent, string>> = { play: 'minions', sell: 'minions', roll: 'times', shout: 'Shouts' };

/** Plural tribe noun for objective text ("Summon 4 Undead"). Undead is invariant. */
const TRIBE_PLURAL: Record<Tribe, string> = { beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs', demon: 'Demons', neutral: 'minions' };
const TRIBE_SINGULAR: Record<Tribe, string> = { beast: 'Beast', dragon: 'Dragon', undead: 'Undead', mech: 'Mech', demon: 'Demon', neutral: 'minion' };
/** Keyword → its Sunward display name (for "a Badgington with Flurry and Ward"). */
const KEYWORD_NAME: Partial<Record<Keyword, string>> = { W: 'Flurry', DS: 'Ward', V: 'Toxin', T: 'Taunt', RL: 'Rally', SL: 'Slaughter', R: 'Rise', C: 'Cleave', ST: 'Stealth', IMM: 'Immune' };

/** Objective one-liner: "Play 3 minions" / "Summon 4 Beasts" / "Slaughter 6 enemies with Beasts" /
 *  "Attack 12 times with Beasts" / "Summon 8 minions in combat" / "Trigger 14 Echoes". */
export function questObjectiveText(o: QuestObjective): string {
  const withTribe = o.tribe ? ` with ${TRIBE_PLURAL[o.tribe]}` : '';
  switch (o.event) {
    case 'attack':
      return `Attack ${o.count} times${withTribe}`;
    case 'slaughter':
      return `Slaughter ${o.count} ${o.count === 1 ? 'enemy' : 'enemies'}${withTribe}`;
    case 'summonCombat':
      return `Summon ${o.count} ${o.tribe ? TRIBE_PLURAL[o.tribe] : 'minions'} in combat`;
    case 'deathrattle':
      return `Trigger ${o.count} ${o.count === 1 ? 'Echo' : 'Echoes'}`;
    case 'friendlyDeath':
      return `Have ${o.count} friendly ${o.count === 1 ? 'minion' : 'minions'} die`;
    case 'summon':
      return `Summon ${o.count} ${o.tribe ? TRIBE_PLURAL[o.tribe] : 'minions'}`;
    case 'buy':
      return `Buy ${o.count} ${o.filter === 'shout' ? 'Shout minions' : o.tribe ? TRIBE_PLURAL[o.tribe] : 'cards'}`;
    case 'shout':
      return `Trigger ${o.count} ${o.count === 1 ? 'Shout' : 'Shouts'}`;
    case 'spendGold':
      return `Spend ${o.count} Gold`;
    case 'endOfTurn':
      return `Trigger ${o.count} End-of-Turn effect${o.count === 1 ? '' : 's'}`;
    case 'tribeStats':
      return `Give ${o.tribe ? TRIBE_PLURAL[o.tribe] : 'minions'} ${o.count} total stats`;
    default:
      return `${EVENT_VERB[o.event] ?? o.event} ${o.count} ${EVENT_NOUN[o.event] ?? ''}`.trim();
  }
}

/** "a random Beast" / "2 random Undead" (Undead invariant). */
function randomMinionPhrase(tribe: Tribe, n: number): string {
  const noun = n === 1 ? TRIBE_SINGULAR[tribe] : TRIBE_PLURAL[tribe];
  return `${n === 1 ? 'a' : n} random ${noun}`;
}

/** "+3/+2" (both) or "+3 Attack" (attack-only) — shared stat phrasing for aura rewards. */
function statPhrase(attack: number, health: number): string {
  return health > 0 ? `+${attack}/+${health}` : `+${attack} Attack`;
}

/** Keyword list → "Flurry and Ward" / "Flurry, Ward and Rush". */
function keywordPhrase(kws: Keyword[]): string {
  const names = kws.map((k) => KEYWORD_NAME[k] ?? k);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
      if ((r.randomSpell ?? 0) > 0) parts.push(r.randomSpell === 1 ? 'a random spell' : `${r.randomSpell} random spells`);
      for (const id of r.cards ?? []) {
        const kws = r.grantKeywords?.length ? ` with ${keywordPhrase(r.grantKeywords)}` : '';
        parts.push(`a ${CARD_INDEX[id]?.name ?? 'card'}${kws}`);
      }
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
    case 'tribeAura':
      return `Your ${TRIBE_PLURAL[r.tribe]} have ${statPhrase(r.attack, r.health)} wherever they are`;
    case 'scalingTribeAura': {
      const step = r.stepHealth > 0 ? `+${r.stepAttack}/+${r.stepHealth}` : `+${r.stepAttack}`;
      const per = r.event === 'summonCombat' ? `${TRIBE_PLURAL[r.tribe]} summoned in combat` : `${TRIBE_PLURAL[r.tribe]}`;
      return `Your ${TRIBE_PLURAL[r.tribe]} have ${statPhrase(r.attack, r.health)} wherever they are. Improve by ${step} every ${r.per} ${per}`;
    }
    case 'recurringGrant': {
      const names = r.cards.map((id) => CARD_INDEX[id]?.name ?? 'a card');
      return `End of Turn: get ${names.join(' + ')}`;
    }
    case 'combatFlag':
      switch (r.flag) {
        case 'bloodTrail':
          return 'Start of Combat: your leftmost minion gains "Slaughter: get a random Beast" this combat';
        case 'echoingCoop':
          return 'Start of Combat: trigger your Echoes';
        case 'lawOfTeeth':
          return 'Beast Slaughters and Rallies trigger an extra time';
        case 'oldHunt':
          return `Whenever a Beast attacks, improve your Beast Attack aura by +${r.amount ?? 0}`;
      }
      return '';
    case 'shoutRepeat':
      return r.scope === 'always' ? 'Your Shouts trigger an extra time' : 'Your first Shout each round triggers twice';
    case 'endOfTurnRepeat':
      return 'Your End-of-Turn effects trigger an extra time';
    case 'recurringEndOfTurn':
      return r.effect === 'triggerLeftmostShout' ? 'End of Turn: trigger your leftmost Shout' : 'End of Turn: get a random Shout minion';
    case 'gainGold':
      return `Get ${r.amount} Gold`;
    case 'echoRepeat':
      return r.scope === 'always' ? 'Your Echoes trigger an extra time' : 'Your first Echo each combat triggers twice';
    case 'boneThrone':
      return `Every ${r.every} friendly deaths, trigger your leftmost Echo`;
    case 'multi':
      return r.rewards.map((sub) => questRewardText(sub)).join('. ');
    default:
      return '';
  }
}

/** Live objective progress: "2 / 3", or "Complete" once met. */
export function questProgressText(progress: number, o: QuestObjective, completed: boolean): string {
  return completed ? 'Complete' : `${Math.min(progress, o.count)} / ${o.count}`;
}
