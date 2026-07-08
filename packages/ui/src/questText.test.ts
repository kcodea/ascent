import { describe, it, expect } from 'vitest';
import type { QuestObjective, QuestReward } from '@game/core';
import { questObjectiveText, questRewardText } from './questText';

describe('questText — objectives', () => {
  const cases: [QuestObjective, string][] = [
    [{ event: 'summon', count: 4, tribe: 'beast' }, 'Summon 4 Beasts'],
    [{ event: 'buy', count: 4, tribe: 'beast' }, 'Buy 4 Beasts'],
    [{ event: 'slaughter', count: 2 }, 'Slaughter 2 enemies'],
    [{ event: 'slaughter', count: 6, tribe: 'beast' }, 'Slaughter 6 enemies with Beasts'],
    [{ event: 'slaughter', count: 1 }, 'Slaughter 1 enemy'],
    [{ event: 'summonCombat', count: 8 }, 'Summon 8 minions in combat'],
    [{ event: 'summonCombat', count: 14, tribe: 'beast' }, 'Summon 14 Beasts in combat'],
    [{ event: 'attack', count: 12, tribe: 'beast' }, 'Attack 12 times with Beasts'],
    [{ event: 'deathrattle', count: 14 }, 'Trigger 14 Echoes'],
  ];
  for (const [o, text] of cases) {
    it(`${o.event}${o.tribe ? `/${o.tribe}` : ''} → "${text}"`, () => expect(questObjectiveText(o)).toBe(text));
  }
});

describe('questText — rewards', () => {
  const cases: [QuestReward, string][] = [
    [{ kind: 'tribeAura', tribe: 'beast', attack: 3, health: 0 }, 'Your Beasts have +3 Attack wherever they are'],
    [{ kind: 'grant', cards: ['badgington'], grantKeywords: ['W', 'DS'] }, 'Get a Badgington with Flurry and Ward'],
    [{ kind: 'recurringGrant', cards: ['feedalpha'] }, 'End of Turn: get Feed the Alpha'],
    [{ kind: 'combatFlag', flag: 'lawOfTeeth' }, 'Beast Slaughters and Rallies trigger an extra time'],
    [{ kind: 'combatFlag', flag: 'echoingCoop' }, 'Start of Combat: trigger your Echoes'],
    [{ kind: 'combatFlag', flag: 'oldHunt', amount: 7 }, 'Whenever a Beast attacks, improve your Beast Attack aura by +7'],
  ];
  for (const [r, text] of cases) {
    it(`${r.kind}/${'flag' in r ? r.flag : ''} → "${text}"`, () => expect(questRewardText(r)).toBe(text));
  }

  it('scalingTribeAura states the base grant, step, and cadence', () => {
    const r: QuestReward = { kind: 'scalingTribeAura', tribe: 'beast', attack: 3, health: 1, per: 5, event: 'summonCombat', stepAttack: 3, stepHealth: 1 };
    expect(questRewardText(r)).toBe('Your Beasts have +3/+1 wherever they are. Improve by +3/+1 every 5 Beasts summoned in combat');
  });
});
