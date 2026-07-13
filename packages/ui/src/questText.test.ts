import { describe, it, expect } from 'vitest';
import type { QuestObjective, QuestReward } from '@game/core';
import { questObjectiveLines, questObjectiveText, questRewardText, questRewardLiveText } from './questText';
import { stewardText } from './cardText';

describe('questText — objectives', () => {
  const cases: [QuestObjective, string][] = [
    [{ event: 'summon', count: 4, tribe: 'beast' }, 'Summon 4 Beasts'],
    [{ event: 'buy', count: 4, tribe: 'beast' }, 'Buy 4 Beasts'],
    [{ event: 'slaughter', count: 2 }, 'Kill 2 enemies'],
    [{ event: 'slaughter', count: 6, tribe: 'beast' }, 'Kill 6 enemies with Beasts'],
    [{ event: 'slaughter', count: 1 }, 'Kill 1 enemy'],
    [{ event: 'summonCombat', count: 8 }, 'Summon 8 minions in combat'],
    [{ event: 'summonCombat', count: 14, tribe: 'beast' }, 'Summon 14 Beasts in combat'],
    [{ event: 'attack', count: 12, tribe: 'beast' }, 'Attack 12 times with Beasts'],
    [{ event: 'deathrattle', count: 14 }, 'Trigger 14 Echoes'],
  ];
  for (const [o, text] of cases) {
    it(`${o.event}${o.tribe ? `/${o.tribe}` : ''} → "${text}"`, () => expect(questObjectiveText(o)).toBe(text));
  }
});

describe('questObjectiveLines — compound objectives', () => {
  it('a normal objective is a single line', () => {
    expect(questObjectiveLines({ event: 'deathrattle', count: 14 })).toEqual(['Trigger 14 Echoes']);
  });
  it("Author's Hand breaks into 3 progress lines, 0/N when untaken", () => {
    expect(questObjectiveLines({ event: 'authorsHand', count: 6 })).toEqual([
      'Shouts triggered 0/6',
      'Echoes triggered 0/6',
      'Rallies triggered 0/6',
    ]);
  });
  it("Author's Hand fills live sub-progress (clamped to the count)", () => {
    expect(questObjectiveLines({ event: 'authorsHand', count: 6 }, { shout: 2, echo: 6, rally: 9 })).toEqual([
      'Shouts triggered 2/6',
      'Echoes triggered 6/6',
      'Rallies triggered 6/6',
    ]);
  });
});

describe('stewardText — Steward of Spells live copy target', () => {
  it('names the most recent spell (highlighted), for normal + golden', () => {
    expect(stewardText('stewardofspells', false, 'Growth')).toBe('**End of Turn:** get a copy of {{Growth}}.');
    expect(stewardText('stewardofspells', true, 'Growth')).toBe('**End of Turn:** get **2** copies of {{Growth}}.');
  });
  it('is null until a spell has been cast, and null for other cards', () => {
    expect(stewardText('stewardofspells', false, undefined)).toBeNull();
    expect(stewardText('badgington', false, 'Growth')).toBeNull();
  });
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

  it('impAura reads the current improvement magnitude', () => {
    expect(questRewardText({ kind: 'impAura', attack: 1, health: 1 })).toBe('Improve your Imps by +1/+1');
  });
  it('assemblyLine combatFlag reads its Avenge cadence', () => {
    expect(questRewardText({ kind: 'combatFlag', flag: 'assemblyLine', amount: 4 })).toBe('Avenge (4): add a Money Bot to your hand');
  });
  it('buffMechsPerAttachment recurring effect states the per-attachment grant', () => {
    expect(questRewardText({ kind: 'recurringEndOfTurn', effect: 'buffMechsPerAttachment' })).toBe('End of Turn: give your Mechs +2/+2 for every Attachment they have');
  });
  it('turn-11 recurring effects each render their own End-of-Turn line', () => {
    expect(questRewardText({ kind: 'recurringEndOfTurn', effect: 'spearWardenEcho' })).toBe('End of Turn: each Spear Warden gives another minion +2/+2');
    expect(questRewardText({ kind: 'recurringEndOfTurn', effect: 'undeadPlayedAtk' })).toBe('End of Turn: your Undead gain +3 Attack for each card you played this turn');
    expect(questRewardText({ kind: 'recurringEndOfTurn', effect: 'crateringMissive' })).toBe('End of Turn: give your whole board +1/+1 for each Cratering Hulk you have');
    expect(questRewardText({ kind: 'recurringEndOfTurn', effect: 'attachClingDrones' })).toBe('End of Turn: weld a Cling Drone onto up to 3 of your Mechs');
  });
  it('baneDemonAura states the Demon widen', () => {
    expect(questRewardText({ kind: 'baneDemonAura', attack: 2, health: 2 })).toBe("Your Banes' Battlecry payoff also gives your Demons +2/+2");
  });
});

describe('questText — live reward magnitude (badge tooltip)', () => {
  it('scalingTribeAura folds the current Beast aura + the countdown to the next step', () => {
    const r: QuestReward = { kind: 'scalingTribeAura', tribe: 'beast', attack: 4, health: 4, per: 5, event: 'summonCombat', stepAttack: 4, stepHealth: 4 };
    expect(questRewardLiveText(r, { beastAura: { attack: 12, health: 12 }, scaling: { progress: 7, per: 5 } }))
      .toBe('Now: Beasts +12/+12 · +4/+4 in 3 more');
  });
  it('tribeAura shows the current Beast aura total', () => {
    expect(questRewardLiveText({ kind: 'tribeAura', tribe: 'beast', attack: 2, health: 2 }, { beastAura: { attack: 6, health: 6 } }))
      .toBe('Now: Beasts +6/+6');
  });
  it('umbralEnergy shows its live per-spell Start-of-Combat grant', () => {
    expect(questRewardLiveText({ kind: 'combatFlag', flag: 'umbralEnergy' }, { spellsCast: 5 }))
      .toBe('Now: Dragons +10/+10 at Start of Combat (5 spells cast)');
  });
  it('returns null for a reward with no live-varying magnitude', () => {
    expect(questRewardLiveText({ kind: 'gainGold', amount: 10 }, {})).toBeNull();
  });
});
