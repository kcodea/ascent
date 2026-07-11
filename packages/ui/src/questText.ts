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
/** Display name for a `grant.randomFilter` minion class ("a random Echo minion"). */
const FILTER_NAME: Record<'shout' | 'endOfTurn' | 'echo' | 'rally' | 'attachment', string> = { shout: 'Shout', endOfTurn: 'End of Turn', echo: 'Echo', rally: 'Rally', attachment: 'Attachment' };
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
      // "Kill N enemies" — this objective counts any enemy a friendly minion fells by attacking, NOT the
      // Slaughter keyword. The word "Slaughter" is reserved for the keyword-trigger objective (The Red Trail).
      return `Kill ${o.count} ${o.count === 1 ? 'enemy' : 'enemies'}${withTribe}`;
    case 'slaughterKeyword':
      // "Trigger N Slaughters" — the Slaughter KEYWORD firing (a minion with an on-kill effect scoring a kill).
      return `Trigger ${o.count} ${o.count === 1 ? 'Slaughter' : 'Slaughters'}`;
    case 'summonCombat':
      return `Summon ${o.count} ${o.tribe ? TRIBE_PLURAL[o.tribe] : 'minions'} in combat`;
    case 'deathrattle':
      return `Trigger ${o.count} ${o.count === 1 ? 'Echo' : 'Echoes'}`;
    case 'friendlyDeath':
      return `Have ${o.count} friendly ${o.count === 1 ? 'minion' : 'minions'} die`;
    case 'rally':
      return `Trigger ${o.count} ${o.count === 1 ? 'Rally' : 'Rallies'}`;
    case 'playAttachment':
      return `Play ${o.count} ${o.count === 1 ? 'Attachment' : 'Attachments'}`;
    case 'consumeFodder':
      return `Consume ${o.count} Fodder`;
    case 'consumeStats':
      return `Consume ${o.count} total stats`;
    case 'summonImp':
      return `Summon ${o.count} ${o.count === 1 ? 'Imp' : 'Imps'}`;
    case 'winRound':
      return `Win ${o.count} ${o.count === 1 ? 'round' : 'rounds'}`;
    case 'castSpell':
      return `Cast ${o.count} spells`;
    case 'authorsHand':
      return `Trigger Shout, Echo, and Rally ${o.count} times each`;
    case 'sell':
      return `Sell ${o.count} ${o.tribe ? TRIBE_PLURAL[o.tribe] : 'minions'}`;
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

/** The objective as one or more display lines. Most objectives are a single line (`questObjectiveText`); the
 *  Author's Hand compound objective breaks into three progress lines — "Shouts triggered 0/6", "Echoes
 *  triggered 0/6", "Rallies triggered 0/6" — each showing its own sub-tally (0 in the shop, live in the panel).
 *  `sub` (the reducer's per-key `subProgress`) fills the current counts; omit it (or pass zeros) for an untaken
 *  quest so the choice box reads "0/N". */
export function questObjectiveLines(o: QuestObjective, sub?: { shout: number; echo: number; rally: number }, partProgress?: number[]): string[] {
  if (o.event === 'authorsHand') {
    const n = (v: number): string => `${Math.min(v, o.count)}/${o.count}`;
    return [
      `Shouts triggered ${n(sub?.shout ?? 0)}`,
      `Echoes triggered ${n(sub?.echo ?? 0)}`,
      `Rallies triggered ${n(sub?.rally ?? 0)}`,
    ];
  }
  // Compound (Fried Circuits / Forsaken Will): one line per part with its own live fraction.
  if (o.event === 'compound' && o.parts) {
    return o.parts.map((p, i) => `${questObjectiveText(p)} · ${Math.min(partProgress?.[i] ?? 0, p.count)}/${p.count}`);
  }
  return [questObjectiveText(o)];
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
      if (r.randomFilter) parts.push(`a random ${FILTER_NAME[r.randomFilter]} minion${r.randomFilterExactTier ? ' of your tier' : ''}`);
      // Group duplicate card ids so "['keyfindings','keyfindings']" reads "2 Key Findings" (not "a X + a X").
      const cardCounts = new Map<string, number>();
      for (const id of r.cards ?? []) cardCounts.set(id, (cardCounts.get(id) ?? 0) + 1);
      for (const [id, n] of cardCounts) {
        const kws = r.grantKeywords?.length ? ` with ${keywordPhrase(r.grantKeywords)}` : '';
        const name = CARD_INDEX[id]?.name ?? 'card';
        parts.push(n === 1 ? `a ${name}${kws}` : `${n} ${name}${kws}`);
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
        case 'sharedCircuit':
          return `Start of Combat: give ${r.amount ?? 0} friendly Mechs Ward`;
        case 'deepHunger':
          return 'Start of Combat: your leftmost Demon gains "Slaughter: add 3 Fodder to your next shop"';
        case 'contractRewrite':
          return 'Start of Combat: your rightmost Demon gains "Echo: summon 2 Imps with Ward"';
        case 'pitWithoutEnd':
          return `Your last friendly death each combat summons ${r.amount ?? 0} Imps`;
        case 'doubleLeftmostAttack':
          return 'Start of Combat: your leftmost minion gains double its Attack';
        case 'feedingLine':
          return 'Whenever a Beast Slaughters, your next Beast attacks immediately';
        case 'umbralEnergy':
          return 'Start of Combat: give your Dragons +2/+2 for every spell cast this game';
        case 'emptyGraves':
          return 'Your first friendly death each combat summons a 1/1 Gravebody that copies your leftmost Echo';
      }
      return '';
    case 'shoutRepeat':
      return r.scope === 'always' ? 'Your Shouts trigger an extra time' : 'Your first Shout each round triggers twice';
    case 'endOfTurnRepeat':
      return 'Your End-of-Turn effects trigger an extra time';
    case 'recurringEndOfTurn':
      return r.effect === 'triggerLeftmostShout' ? 'End of Turn: trigger your leftmost Shout'
        : r.effect === 'grantRandomAttachments' ? 'End of Turn: get 2 random Attachments'
        : 'End of Turn: get a random Shout minion';
    case 'gainGold':
      return `Get ${r.amount} Gold`;
    case 'echoRepeat':
      return r.scope === 'always' ? 'Your Echoes trigger an extra time' : 'Your first Echo each combat triggers twice';
    case 'boneThrone':
      return `Avenge (${r.every}): trigger your leftmost Echo`;
    case 'rallyRepeat':
      return r.scope === 'always' ? 'Your Rallies trigger an extra time' : 'Your first Rally each combat triggers twice';
    case 'fodderReward': {
      const parts: string[] = [];
      if (r.fodder) parts.push(`Add ${r.fodder} Fodder to your next shop`);
      if ((r.attack ?? 0) > 0 || (r.health ?? 0) > 0) parts.push(`Fodder gains ${statPhrase(r.attack ?? 0, r.health ?? 0)}`);
      return parts.join('. ');
    }
    case 'gainMaxGold':
      return `Gain +${r.amount} max Gold`;
    case 'discover':
      return r.tier ? `Discover a Tier ${r.tier} minion` : 'Discover a card from your tier';
    case 'dupeFirstBuy':
      return 'Get a second copy of the first minion you buy each turn';
    case 'spellRepeat':
      return r.scope === 'always' ? 'Your spells cast twice' : 'Your first spell each turn casts twice';
    case 'minionCost':
      return `Minions cost ${r.cost} Gold from the shop`;
    case 'slaughterRepeat':
      return 'Your first Slaughter each combat triggers an extra time';
    case 'shoutEdgeBuff':
      return `Triggering Shouts give your leftmost and rightmost minion +${r.attack}/+${r.health}`;
    case 'goldFodder':
      return `Every ${r.per} Gold spent adds a Fodder to your shop and gives Fodder +${r.attack}/+${r.health}`;
    case 'attachmentDeal':
      return `Attachments cost ${r.cost} Gold, and there's always an Attachment in the shop`;
    case 'friedCircuits':
      return `Each minion you buy buffs shop Mechs +${r.step}/+${r.step}, improving by +${r.step}/+${r.step} each purchase`;
    case 'undeadSpellAura':
      return `Casting a spell gives your Undead +${r.attack} Attack (in the shop and combat)`;
    case 'openEpicRuneforge':
      return 'Visit the Epic Runeforge at the start of next turn';
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
