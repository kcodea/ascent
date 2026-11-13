import { describe, expect, it } from 'vitest';
import { PROTECTED_NAMES, renameTerms } from './terms';

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

describe('renameTerms leaves proper content names alone (owner report 2026-11-13)', () => {
  it('keeps the Golden Monkey rune and Indy texts naming the Golden Monkey token', async () => {
    const { RUNE_INDEX, CARD_INDEX } = await import('@game/content');
    expect(renameTerms(RUNE_INDEX.rune_golden_monkey!.text)).toBe('Every **5** Refreshes, replace a minion in your Shop with a **Golden Monkey**.');
    const indy = Object.values(CARD_INDEX).find((c) => c.text?.includes('add a **Golden Monkey**'))!;
    expect(renameTerms(indy.text!)).toContain('add a **Golden Monkey** to the Shop');
    expect(renameTerms(indy.goldenText!)).toContain('**2 Golden Monkeys**');
  });

  it('protects every content name containing a renamed word, while the mechanic word still renames', () => {
    for (const name of ['Golden Monkey', 'Golden Ruby', 'Golden Touch', 'Golden Ale', 'Golden Splinter', 'Golden Handshake', 'The Golden Ledger']) {
      expect(PROTECTED_NAMES).toContain(name);
      expect(renameTerms(`Make it Golden, then get a **${name}**.`)).toBe(`Make it Gilded, then get a **${name}**.`);
    }
    expect(renameTerms('a golden Golden Monkeys pair')).toBe('a gilded Golden Monkeys pair');
  });

  it('every protected name survives renameTerms verbatim, and nothing else stops renaming', () => {
    for (const name of PROTECTED_NAMES) expect(renameTerms(name)).toBe(name);
    expect(renameTerms('Golden Monkeyshine is Golden')).toBe('Gilded Monkeyshine is Gilded');
  });
});
