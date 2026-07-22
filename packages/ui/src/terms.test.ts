import { describe, expect, it } from 'vitest';
import { renameTerms } from './terms';

describe('renameTerms (B3 keyword pass)', () => {
  it('renames the player-facing keyword vocabulary', () => {
    expect(renameTerms('**Battlecry:** Summon a minion.')).toBe('**Shout:** Summon a minion.');
    expect(renameTerms('**Deathrattle:** deal 3.')).toBe('**Echo:** deal 3.');
    expect(renameTerms('Give a friendly minion **Divine Shield**.')).toBe('Give a friendly minion **Ward**.');
    expect(renameTerms('gains **Windfury**')).toBe('gains **Flurry**');
    expect(renameTerms('grant **Venomous**')).toBe('grant **Execute**');
    expect(renameTerms('**Reborn.**')).toBe('**Rise.**');
    expect(renameTerms('Magnetize onto a friendly Mech.')).toBe('Attach onto a friendly Mech.');
    expect(renameTerms('a friendly **Magnetic** minion')).toBe('a friendly **Attachment** minion');
    expect(renameTerms('make it Golden')).toBe('make it Gilded');
  });

  it('handles plurals with proper forms', () => {
    expect(renameTerms('your Deathrattles proc 1 more time')).toBe('your Echoes proc 1 more time');
    expect(renameTerms('buy 5 Battlecries')).toBe('buy 5 Shouts');
    expect(renameTerms('two Divine Shields')).toBe('two Wards');
  });

  it('leaves kept terms untouched', () => {
    const keep = '**Taunt**, Avenge (3), Choose One, Start of Combat, End of Turn, Rally, Cleave, Consume, Discover';
    expect(renameTerms(keep)).toBe(keep);
  });
});
