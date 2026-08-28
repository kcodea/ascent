import type { Keyword, QuestObjective, QuestObjectiveEvent, QuestReward, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * Display strings for quests, DERIVED from the quest data (no authored text on `QuestDef`). Used by the quest
 * shop cards (QuestCard) and the active-quest nodes (QuestBadges), and kept here so both read identically.
 * Scaling rewards (Warm Embers' remaining Shouts, Trail Rations' repeat countdown) take a live-state hook so a
 * taken quest never prints a stale number — the card-text live-accuracy rule.
 */
const EVENT_VERB: Partial<Record<QuestObjectiveEvent, string>> = { play: 'Play', sell: 'Sell', roll: 'Roll', shout: 'Play' };
const EVENT_NOUN: Partial<Record<QuestObjectiveEvent, string>> = { play: 'minions', sell: 'minions', roll: 'times', shout: 'Shouts' };

/** Plural tribe noun for objective text ("Summon 4 Undead"). Undead is invariant. */
const TRIBE_PLURAL: Record<Tribe, string> = { beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs', demon: 'Demons', neutral: 'minions', kobold: 'Kobolds', dwarf: 'Dwarves', celestial: 'Celestials' };
const TRIBE_SINGULAR: Record<Tribe, string> = { beast: 'Beast', dragon: 'Dragon', undead: 'Undead', mech: 'Mech', demon: 'Demon', neutral: 'minion', kobold: 'Kobold', dwarf: 'Dwarf', celestial: 'Celestial' };
/** Display name for a `grant.randomFilter` minion class ("a random Echo minion"). */
const FILTER_NAME: Record<'shout' | 'endOfTurn' | 'echo' | 'rally' | 'attachment', string> = { shout: 'Shout', endOfTurn: 'End of Turn', echo: 'Echo', rally: 'Rally', attachment: 'Attachment' };
/** Keyword → its Sunward display name (for "a Badgington with Flurry and Ward"). */
const KEYWORD_NAME: Partial<Record<Keyword, string>> = { W: 'Flurry', DS: 'Ward', V: 'Execute', T: 'Taunt', RL: 'Rally', SL: 'Slaughter', R: 'Rise', C: 'Cleave', ST: 'Stealth', IMM: 'Immune' };

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
      return `Cast ${o.count} Shop spells`;
    case 'castRuby':
      return `Cast ${o.count} ${o.count === 1 ? 'Ruby' : 'Rubies'}`;
    case 'shopStats':
      return `Grant ${o.count} total stats to Shop minions`;
    case 'consumeShopMinion':
      return `Consume ${o.count} Shop minions`;
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
    case 'journey':
      // Hero quests (Fi / Coran). Named for the counter AND its three sources, because every hero quest uses
      // this one objective — a player who reads it once never has to read it again.
      return `Travel ${o.count} steps — play a minion, cast a spell or upgrade`;
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
/**
 * Every recurring End-of-Turn effect's display line. A RECORD, not an if-chain: the previous chain ended in a
 * bare `: 'End of Turn: get a random Shout minion'`, so six effects that had no branch — including Open Tab's
 * `grantAles` — printed a sentence describing a completely different reward. Typing this as a total Record over
 * the union means a new effect fails to compile until its text is written.
 */
const EOT_EFFECT_TEXT: Record<Extract<QuestReward, { kind: 'recurringEndOfTurn' }>['effect'], string> = {
  lassoing: 'End of Turn: Cast Lasso and grant a random friendly minion +2/+2',
  triggerLeftmostShout: 'End of Turn: trigger your leftmost Shout',
  grantRandomShout: 'End of Turn: get a random Shout minion',
  grantAles3: 'End of Turn: get 3 random Dwarven Ales',
  quickStudy: 'End of Turn: get a Gold Font and 2 random Shop spells',
  grantRandomAttachments: 'End of Turn: get 2 random Attachments',
  buffMechsPerAttachment: 'End of Turn: give your Mechs +2/+2 for every Attachment they have',
  runeSpending: 'End of Turn: give your leftmost minion +1/+2 for each Gold you spent this turn',
  runeAction: 'End of Turn: give your leftmost minion +1/+1 for every card you played this turn',
  triggerLeftmostEcho: "End of Turn: trigger your leftmost minion's Echo",
  weldMoneyBotsEdgeMechs: 'End of Turn: weld a Money Bot onto your leftmost and rightmost Mech',
  undeadPlayedAtk: 'End of Turn: your Undead gain +3 Attack for each card you played this turn',
  attachClingDrones: 'End of Turn: weld a Cling Drone onto up to 3 of your Mechs',
  recastFirstSpell: 'End of Turn: cast the first spell you cast this turn again',
  grantAles: 'End of Turn: get 2 Dwarven Ales',
  copyFirstSpell: 'End of Turn: get a copy of the first spell you cast this turn',
  grantRuby: 'End of Turn: get a Ruby',
  grantRuby2: 'End of Turn: get 2 Rubies',
  grantFacetwright: "Start of every turn: get a Facetwright's Choice",
  demonEatsRightmostShop: 'End of Turn: your left-most Demon Consumes the right-most Shop minion',
};

export function questRewardText(r: QuestReward, live?: { completed?: boolean; shoutCharges?: number; repeatTurns?: number }): string {
  switch (r.kind) {
    case 'buffBoard':
      return `Your board gets +${r.attack}/+${r.health}`;
    case 'grant': {
      const parts: string[] = [];
      if (r.randomTribe && (r.randomCount ?? 0) > 0) parts.push(randomMinionPhrase(r.randomTribe, r.randomCount!));
      if ((r.randomSpell ?? 0) > 0) parts.push(r.randomSpell === 1 ? 'a random Shop spell' : `${r.randomSpell} random Shop spells`);
      if (r.randomFilter) parts.push(`a random ${FILTER_NAME[r.randomFilter]} minion${r.randomFilterExactTier ? ' of your tier' : ''}`);
      if ((r.randomAle ?? 0) > 0) parts.push(r.randomAle === 1 ? 'a random Dwarven Ale' : `${r.randomAle} random Dwarven Ales`);
      if ((r.randomRuby ?? 0) > 0) parts.push(r.randomRuby === 1 ? 'a Ruby' : `${r.randomRuby} Rubies`);
      // Gilded grants (Leader of the Pack → a Golden Pack Leader). Rendered before the plain cards.
      const goldenCounts = new Map<string, number>();
      for (const id of r.grantGolden ?? []) goldenCounts.set(id, (goldenCounts.get(id) ?? 0) + 1);
      for (const [id, n] of goldenCounts) {
        const name = CARD_INDEX[id]?.name ?? 'card';
        parts.push(n === 1 ? `a Golden ${name}` : `${n} Golden ${name}s`);
      }
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
    // The Aura vocabulary (owner ruling 2026-08-28): the run-wide "wherever they are" reach now prints as
    // "your <Tribe> Aura" — same effect, the noun carries the scope. See LG-SCOPE-01.
    case 'tribeAura':
      return `Your ${TRIBE_SINGULAR[r.tribe]} Aura has ${statPhrase(r.attack, r.health)}`;
    case 'scalingTribeAura': {
      const step = r.stepHealth > 0 ? `+${r.stepAttack}/+${r.stepHealth}` : `+${r.stepAttack}`;
      const per = r.event === 'summonCombat' ? `${TRIBE_PLURAL[r.tribe]} summoned in combat` : `${TRIBE_PLURAL[r.tribe]}`;
      return `Your ${TRIBE_SINGULAR[r.tribe]} Aura has ${statPhrase(r.attack, r.health)}. Improve by ${step} every ${r.per} ${per}`;
    }
    case 'recurringGrant': {
      const names = r.cards.map((id) => CARD_INDEX[id]?.name ?? 'a card');
      return `End of Turn: get ${names.join(' + ')}`;
    }
    case 'impAura':
      return `Improve your Imps by ${statPhrase(r.attack, r.health)}`;
    case 'beastPlayBuff':
      return `Your Beasts gain ${statPhrase(r.attack, r.health)} when played, improving every ${r.per} Beasts`;
    case 'combatFlag':
      switch (r.flag) {
        case 'runeCounterpoint':
          return 'When a friendly minion dies, your left-most minion attacks immediately';
        case 'runeOverflow':
          return `Whenever you summon a minion that does not fit, give your minions +${r.amount ?? 4}/+${r.amount ?? 4} permanently`;
        case 'runeFoodChain':
          return "Start of Combat: the first minion you summon gains your left-most Demon's stats this combat";
        case 'runeAttackingGems':
          return 'Cast a Ruby on all of your minions every friendly attack in combat';
        case 'runeBrood':
          return `When you have space in combat, summon an Imp with Ward and Taunt (${r.amount ?? 3} times per combat)`;
        case 'runeLivingEchoes':
          return `When you have space, summon a Sunmane Herald that attacks immediately (${r.amount ?? 3} times per combat)`;
        case 'runeWarChorus':
          return 'Your first Rally each combat triggers your left-most Shout';
        case 'runeHuntingBell':
          return 'Avenge (3): trigger your left-most Rally';
        case 'runeRemains':
          return `When you summon 5 minions in combat, give minions in the Shop +${r.amount ?? 3}/+${r.amount ?? 3}`;
        case 'runeReinvestment':
          return `After combat, give the next Shop +${r.amount ?? 1}/+${r.amount ?? 1} for every friendly minion you summoned`;
        case 'runeBloodAndCoin':
          return `Every 4 friendly deaths in combat, gain ${r.amount ?? 4} Gold next turn`;
        case 'runeWildHunt':
          return `When a Beast attacks, give your minions +${r.amount ?? 3} Health and improve this by ${r.amount ?? 3} permanently`;
        case 'runeLivingTreasure':
          return 'Your Gemheart Golems gain Rise';
        case 'runeGemstorm':
          return `Avenge (2): play ${r.amount ?? 2} Rubies on each friendly Kobold`;
        case 'runeLastCall':
          return 'Avenge (3): get a random Dwarven Ale';
        case 'runeCinderLedger':
          return `Avenge (3): improve your Imp Aura by +${r.amount ?? 6}/+${r.amount ?? 6}`;
        case 'runeProcession':
          return "Avenge (4): double your right-most minion's stats";
        case 'runeVanguard':
          return 'Start of Combat: give your three left-most minions Critical Strike and Ward';
        case 'runeFinality':
          return `When your last minion dies, summon ${r.amount ?? 7} Imps with Ward`;
        case 'runeHatchery':
          return 'Minions summoned by an Echo have +3/+3 and Taunt';
        case 'avengeFirstDouble':
          return 'Your first Avenge each combat triggers twice';
        case 'candlelightToll':
          return 'Give your Kobolds "Echo: get a Ruby"';
        case 'gemheartCharge':
          return 'Your Gemheart Golems attack immediately when summoned';
        case 'burningLegion':
          return `When an Imp attacks, summon a copy of it if you have room (${r.amount ?? 3} times)`;
        case 'bloodTrail':
          return 'Start of Combat: your leftmost minion gains "Slaughter: get a random Beast" this combat';
        case 'echoingCoop':
          return 'Start of Combat: trigger your Echoes';
        case 'lawOfTeeth':
          return 'Beast Slaughters and Rallies trigger an extra time';
        case 'oldHunt':
          return `Whenever a Beast attacks, improve your Beast Attack aura by +${r.amount ?? 0}`;
        case 'sharedCircuit':
          return `Start of Combat: give ${r.amount ?? 0} friendly Mechs Ward. When a Mech loses its Ward, pass it to another (up to ${r.amount ?? 0}× per combat)`;
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
          return 'Start of Combat: give your Dragons +2/+2 for every Shop spell cast this game';
        case 'emptyGraves':
          // Rewritten 2026-08-27 (found stale via q-interact-empty-graves-flat): the pre-2026-07-21 design
          // summoned a Gravebody; the flag now marks the leftmost minion with a Rally at Start of Combat.
          return 'Start of Combat: your leftmost minion gains "Rally: trigger your leftmost Echo"';
        case 'assemblyLine':
          return `Avenge (${r.amount ?? 4}): add a Money Bot to your hand`;
        case 'crateringMissive':
          return "Your Cratering Hulks' overflow buffs ALL your minions, not just your Undead";
        case 'passingSpears':
          return 'Your Spear Wardens gain "Echo: when this dies, give its stats to a friendly minion"';
      }
      return '';
    case 'shoutRepeat':
      return r.scope === 'always' ? 'Your Shouts trigger an extra time' : 'Your first Shout each round triggers twice';
    case 'endOfTurnRepeat':
      return 'Your End-of-Turn effects trigger an extra time';
    case 'recurringEndOfTurn':
      return EOT_EFFECT_TEXT[r.effect];
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
      return r.scope === 'always' ? 'Your Shop spells cast twice' : 'Your first Shop spell each turn casts twice';
    case 'minionCost':
      return `Minions cost ${r.cost} Gold from the shop`;
    // ── Hero quest rewards (Fi / Coran) ──
    case 'grantRune':
      return r.rarity === 'epic' ? 'Get a random Epic Rune' : 'Get a random Basic Rune';
    case 'freeFirstBuy':
      return 'Your first shop minion each turn is free';
    case 'tier7Access':
      return 'Tier 7 is unlocked this game';
    case 'gildCopies':
      return `You only need ${r.copies} copies to Gild minions`;
    case 'upgradeShopTier':
      return `Upgrade your Shop by ${r.by} Tier${r.by === 1 ? '' : 's'}`;
    case 'slaughterRepeat':
      return 'Your first Slaughter each combat triggers an extra time';
    case 'shoutEdgeBuff':
      return `Triggering Shouts give your leftmost and rightmost minion +${r.attack}/+${r.health}`;
    case 'goldFodder':
      return `Every ${r.per} Gold spent adds a Fodder to your shop and gives Fodder +${r.attack}/+${r.health}`;
    case 'attachmentDeal':
      return `Attachments cost ${r.cost} Gold, and there's always an Attachment in the shop`;
    case 'friedCircuits':
      return `Each minion you buy buffs shop Mechs +${r.stepAttack}/+${r.stepHealth}, improving by +${r.stepAttack}/+${r.stepHealth} each purchase`;
    case 'undeadSpellAura':
      return `Casting a Shop spell gives your Undead +${r.attack} Attack (in the shop and combat)`;
    case 'baneDemonAura':
      return `Your Banes' Shout payoff also gives your Demons +${r.attack}/+${r.health}`;
    case 'openEpicRuneforge':
      return 'Visit the Epic Runeforge at the start of next turn';
    case 'scheduleRuneforge':
      return r.onWave
        ? `Visit the ${r.forge === 'epic' ? 'Epic ' : ''}Runeforge on turn ${r.onWave}`
        : `Start of next turn, visit the ${r.forge === 'epic' ? 'Epic ' : ''}Runeforge${r.gold ? ` and gain ${r.gold} Gold that turn` : ''}`;
    // Set 2 quest rewards. These five were shipping with NO text at all — `default: return ''` meant the
    // quest card showed a name and an objective above an empty reward line.
    case 'tribeRallySlaughterExtra':
      return `Your ${TRIBE_PLURAL[r.tribe]} Rallies and Slaughters trigger an additional time`;
    case 'aleExtraCasts':
      return (r.amount ?? 1) === 1
        ? 'Your Dwarven Ales trigger an additional time'
        : `Your Dwarven Ales trigger ${r.amount} additional times`;
    case 'questGoldTribeBuff':
      return `Every ${r.per} Gold spent gives your ${TRIBE_PLURAL[r.tribe]} +${r.attack}/+${r.health}`;
    case 'rubyStatGain':
      return `Your Rubies gain +${r.attack}/+${r.health} permanently`;
    case 'rubyExtraCasts': {
      const times = r.amount === 1 ? 'an additional time' : `${r.amount} additional times`;
      return r.scope === 'firstEachTurn'
        ? `Your first Ruby each turn casts ${times}`
        : `Your Rubies cast ${times}`;
    }
    case 'runeThreshold': {
      const METER: Record<typeof r.meter, string> = { gold: 'Gold you spend', spellCast: 'Shop spells you cast', spellCastNonAle: 'Shop spells you cast (Dwarven Ales excluded)', castRuby: 'Rubies you cast', cardsBought: 'cards you buy', cardsPlayed: 'cards you play', playDragon: 'Dragons you play', shout: 'Shouts you trigger', consume: 'Shop minions you Consume' };
      const parts: string[] = [];
      if (r.grantSpell) parts.push(r.grantSpell === 1 ? 'get a random Shop spell' : `get ${r.grantSpell} random Shop spells`);
      if (r.grantAle) parts.push(r.grantAle === 1 ? 'get a random Dwarven Ale' : `get ${r.grantAle} random Dwarven Ales`);
      if (r.grantRuby) parts.push(r.grantRuby === 1 ? 'get a Ruby' : `get ${r.grantRuby} Rubies`);
      for (const id of r.grantCards ?? []) parts.push(`get a ${CARD_INDEX[id]?.name ?? id}`);
      if (r.castStatSpell) parts.push(r.castStatSpell === 1 ? 'cast a random stat-granting Shop spell' : `cast ${r.castStatSpell} random stat-granting Shop spells`);
      if (r.grantGoldNextTurn) parts.push(`gain ${r.grantGoldNextTurn} Gold next turn`);
      if (r.buff) {
        const b = r.buff;
        const who = b.target === 'imps' ? 'your Imps'
          : b.target === 'shop' || b.target === 'shopTurn' ? 'minions in the Shop'
          : b.target === 'spells' ? 'your spells'
          : b.target === 'tribe' ? `your ${b.tribe ? TRIBE_PLURAL[b.tribe] : 'minions'}`
          : 'the right-most minion in the Shop';
        // `step` escalates, so the printed rule has to name the improvement as well as the current grant —
        // the live-accuracy rule, applied to the generated text too.
        parts.push(`give ${who} ${statPhrase(b.attack, b.health)}${b.step ? ` and improve this by ${statPhrase(b.step.attack, b.step.health)}` : ''}`);
      }
      return `Every ${r.per} ${METER[r.meter]}, ${parts.join(' and ')}${r.oncePerTurn ? ' (once per turn)' : ''}`;
    }
    case 'runeFacetwright':
      return "Your Facetwright's Choice casts give both effects";
    case 'runeSpellstone':
      return 'Rubies you cast count as Shop spells';
    case 'runeWhiteWolf':
      return 'Once per turn, when you buy a Shop spell, teach it to a Mage-Pup';
    case 'runeProfitSharing':
      return `Whenever you gain Gold, give your ${TRIBE_PLURAL[r.tribe]} +${r.attack}/+${r.health}`;
    case 'runeDuplication':
      return 'After you forge your Epic Rune, this transforms into a copy of it';
    case 'runeSharedTable':
      return `Your Dwarven Ale casts each give one friendly minion of each type +${r.attack}/+${r.health}`;
    case 'runeRedirection':
      return 'Rubies played on your left-most minion also cast on your right-most minion';
    case 'runeBrokerage':
      return 'Your Ruby Brokers can be triggered endlessly';
    case 'runeSellRubies':
      return `Get ${r.count === 1 ? 'a Ruby' : `${r.count} Rubies`} when you sell a minion`;
    case 'runeOpenMarket':
      return `The first time you Consume a Shop minion each turn, give your Shop +${r.attack}/+${r.health} permanently`;
    case 'motherlode':
      return `Whenever you get a Ruby, play a copy on ${r.count} random friendly ${r.tribe ? TRIBE_PLURAL[r.tribe] : 'minions'}`;
    case 'consumeDoubleFirstEachTurn':
      return 'The first time your Demons Consume a Shop minion each turn, they Consume another';
    case 'spellCost':
      return `Your Shop spells cost ${r.cost} less`;
    case 'endlessVerse':
      return `The first spell you cast each turn casts twice. Trigger ${r.per} Shouts to reset this`;
    case 'shopBuff':
      return `Give Shop minions +${r.attack}/+${r.health}`;
    case 'shopBuffPerShouts':
      return `Every ${r.per} Shouts you trigger, give Shop minions +${r.attack}/+${r.health}`;
    case 'shopBuffOnRefresh':
      return `After you refresh, give Shop minions +${r.attack}/+${r.health}, improving by +${r.step}/+${r.step} every ${r.per} refreshes`;
    case 'shopAuraGrowing':
      return `Shop minions have +${r.attack}/+${r.health}, improving by +${r.step}/+${r.step} every ${r.per} refreshes`;
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

/** Live run-state a scaling/stat reward folds into its tooltip (the current magnitude, not the authored one).
 *  Computed by `QuestBadges` from the RunState; all optional so callers pass only what they have. */
export interface QuestRewardLive {
  /** The Beast run aura's current total (`beastBuyAtk`/`beastBuyHp`) — folds tribeAura + scalingTribeAura +
   *  The Old Hunt + Pack Mentality growth. */
  beastAura?: { attack: number; health: number };
  /** Lifetime spells cast this run (Umbral Energy = +2/+2 per). */
  spellsCast?: number;
  /** For a scalingTribeAura: how far into the current step (progress) and the step size (per) — drives the
   *  "+X/+Y in N more" countdown. */
  scaling?: { progress: number; per: number };
  /** Den Marker (`beastPlayBuff`): Beasts played/summoned so far (`run.denMarker.count`) — drives the current
   *  per-play grant (base + step × steps done) and the countdown to the next improve. */
  denMarkerCount?: number;
  /** Endless Inventory (`shopBuffOnRefresh`): the accrued improvement and progress toward the next step —
   *  drives "Now: … +N/+N per refresh · +1/+1 in 2 more". */
  shopRefresh?: { grown: number; tick: number };
  /** Rune of Recollection (`copyFirstSpell`): the id of the FIRST spell cast this turn, so the badge can
   *  name the card you are actually about to be handed instead of describing the rule (owner ask
   *  2026-08-03). Absent until something is cast. */
  firstSpellId?: string;
}

/** The reward's LIVE ongoing magnitude for the badge tooltip — the CURRENT value a scaling/stat reward is
 *  producing right now (card-text live-accuracy rule, applied to quest rewards). Returns null for rewards with
 *  no live-varying magnitude (their authored `questRewardText` already reads correctly). */
/**
 * Build the `QuestRewardLive` snapshot from a run. Extracted (2026-08-22) so every surface that prints a
 * reward reads the SAME live state: QuestBadges' node hover and the hero-power tooltip, which shows a granted
 * quest's reward beside its objective. Two hand-built copies of this object would drift the moment a new
 * scaling reward lands, and a stale printed number is a defect under the live-accuracy rule.
 *
 * Structurally typed on purpose — `questText.ts` sits below `@game/sim` and must not import RunState.
 */
export function questRewardLiveOf(run: {
  beastBuyAtk?: number; beastBuyHp?: number; spellsCast?: number;
  questScalingAuras?: { tribe: Tribe; event: QuestObjectiveEvent; progress: number; per: number }[];
  denMarker?: { count: number };
  shopBuffOnRefresh?: { grown: number; tick: number };
  shopAuraGrow?: { grown: number; tick: number };
  firstSpellThisTurnId?: string;
}, r: QuestReward): QuestRewardLive {
  const scaling = r.kind === 'scalingTribeAura'
    ? (run.questScalingAuras ?? []).find((a) => a.tribe === r.tribe && a.event === r.event)
    : undefined;
  return {
    beastAura: { attack: run.beastBuyAtk ?? 0, health: run.beastBuyHp ?? 0 },
    spellsCast: run.spellsCast ?? 0,
    scaling: scaling ? { progress: scaling.progress, per: scaling.per } : undefined,
    denMarkerCount: run.denMarker?.count ?? 0,
    shopRefresh: run.shopBuffOnRefresh
      ? { grown: run.shopBuffOnRefresh.grown, tick: run.shopBuffOnRefresh.tick }
      : run.shopAuraGrow ? { grown: run.shopAuraGrow.grown, tick: run.shopAuraGrow.tick } : undefined,
    firstSpellId: run.firstSpellThisTurnId,
  };
}

export function questRewardLiveText(r: QuestReward, live: QuestRewardLive): string | null {
  const beast = (): string | null => {
    const a = live.beastAura;
    return a && (a.attack > 0 || a.health > 0) ? `Now: Beasts ${statPhrase(a.attack, a.health)}` : null;
  };
  switch (r.kind) {
    case 'recurringEndOfTurn': {
      // Rune of Recollection promises "a copy of the first spell you cast this turn" — which names no
      // card, so until you cast something the badge cannot tell you WHAT you are getting. Resolve it live.
      if (r.effect !== 'copyFirstSpell') return null;
      const spell = live.firstSpellId ? CARD_INDEX[live.firstSpellId] : undefined;
      return spell ? `Now: a copy of ${spell.name}` : 'Now: nothing cast yet this turn';
    }
    case 'shopAuraGrowing': {
      // Rune of the Wheel: the badge shows the aura's CURRENT total and the countdown to the next improve —
      // the printed +2/+2 goes stale the moment the first step lands (card-text live-accuracy rule).
      const g = live.shopRefresh;
      if (!g) return null;
      const a = r.attack + g.grown, h = r.health + g.grown;
      const toNext = r.per > 0 ? r.per - (g.tick % r.per) : 0;
      const next = r.step > 0 && toNext > 0 ? ` · +${r.step}/+${r.step} in ${toNext} more refresh${toNext === 1 ? '' : 'es'}` : '';
      return `Now: Shop minions have ${statPhrase(a, h)}${next}`;
    }
    case 'shopBuffOnRefresh': {
      // The magnitude compounds, so the badge must show what the NEXT refresh actually gives — printing the
      // base rate alone goes stale the moment the first step lands (card-text live-accuracy rule).
      const g = live.shopRefresh;
      if (!g) return null;
      const a = r.attack + g.grown, h = r.health + g.grown;
      const toNext = r.per > 0 ? r.per - (g.tick % r.per) : 0;
      const next = r.step > 0 && toNext > 0 ? ` · +${r.step}/+${r.step} in ${toNext} more refresh${toNext === 1 ? '' : 'es'}` : '';
      return `Now: Shop minions ${statPhrase(a, h)} per refresh${next}`;
    }
    case 'tribeAura':
      return r.tribe === 'beast' ? beast() : null;
    case 'scalingTribeAura': {
      if (r.tribe !== 'beast') return null;
      const base = beast();
      if (!base) return null;
      if (!live.scaling || live.scaling.per <= 0) return base;
      const toNext = live.scaling.per - (live.scaling.progress % live.scaling.per);
      const step = r.stepHealth > 0 ? `+${r.stepAttack}/+${r.stepHealth}` : `+${r.stepAttack}`;
      return `${base} · ${step} in ${toNext} more`;
    }
    case 'beastPlayBuff': {
      // Den Marker: the current per-play grant is base + step × (improves done); count = Beasts played so far.
      const count = live.denMarkerCount ?? 0;
      const steps = r.per > 0 ? Math.floor(count / r.per) : 0;
      const a = r.attack + r.step * steps, h = r.health + r.step * steps;
      const toNext = r.per > 0 ? r.per - (count % r.per) : 0;
      const next = r.step > 0 && toNext > 0 ? ` · +${r.step}/+${r.step} in ${toNext} more Beast${toNext === 1 ? '' : 's'}` : '';
      return `Now: Beasts ${statPhrase(a, h)} when played${next}`;
    }
    case 'combatFlag':
      if (r.flag === 'oldHunt') return beast();
      if (r.flag === 'umbralEnergy') {
        const n = 2 * (live.spellsCast ?? 0);
        return `Now: Dragons +${n}/+${n} at Start of Combat (${live.spellsCast ?? 0} Shop spells cast)`;
      }
      return null;
    default:
      return null;
  }
}
