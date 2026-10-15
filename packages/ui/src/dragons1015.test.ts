import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { BoardCard } from '@game/sim';
import { attackImmuneText, humKeepText, seedEchoNote } from './cardText';
import { instView, liveCardText, SEED_KEPT_ROW } from './instView';
import { buffExpiryNote } from './buffExpiry';

/**
 * SET 3 DRAGON BATCH 2 (owner 2026-10-15): the live-text surfaces. Engine behaviour is pinned in
 * `packages/sim/src/set3Dragons1015.test.ts`.
 */
const bag = { tier: 5, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0 };
const card = (cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid: 'u1', cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};

describe('Immune Iggy: "(Twice per combat)" counts down live in combat', () => {
  it('printed before its first swing; N left after each; Gilded counts from 4; Bounty Bot is untouched', () => {
    expect(attackImmuneText('d3_iggy', false, 0)).toBe(CARD_INDEX['d3_iggy']!.text);
    expect(attackImmuneText('d3_iggy', false, 1)).toContain('{{(1 left this combat)}}');
    expect(attackImmuneText('d3_iggy', false, 5)).toContain('{{(0 left this combat)}}');
    expect(attackImmuneText('d3_iggy', true, 1)).toContain('{{(3 left this combat)}}');
    expect(attackImmuneText('bountybot', false, 1)).toBeNull();
    expect(liveCardText('d3_iggy', { ...bag, attacksMade: 1 }).text).toContain('1 left this combat');
  });
});

describe('Hum: the keeps left this turn', () => {
  it('printed until it keeps one; then the count left (Gilded: of 2)', () => {
    expect(humKeepText('d3_hum', false, 0)).toBe(CARD_INDEX['d3_hum']!.text);
    expect(humKeepText('d3_hum', false, 1)).toContain('{{(0 left this turn)}}');
    expect(humKeepText('d3_hum', true, 1)).toContain('{{(1 left this turn)}}');
  });
});

describe('Seed: every body carrying Drake Pup Echo stacks prints them (owner: "(x12)")', () => {
  it('one stack prints the Echo; more print the count', () => {
    expect(seedEchoNote(0)).toBe('');
    expect(seedEchoNote(1)).toBe('[[Echo: Summon a 3/3 Drake Pup with Taunt.]]');
    expect(seedEchoNote(12)).toBe('[[Echo: Summon a 3/3 Drake Pup with Taunt (x12).]]');
    expect(liveCardText('d3_hum', { ...bag, seedEchoes: 12 }).text).toContain('(x12)');
    expect(liveCardText('venom', { ...bag, seedEchoes: 1 }).text).toContain('Drake Pup');
  });

  it('the Shop board view folds permanent + this turn\'s stacks, and the buffs panel lists both lanes', () => {
    const v = instView(card('d3_hum', { seedEchoes: 12, seedEchoesTemp: 1, buffs: [{ source: 'Runebind', attack: 2, health: 2, count: 1 }] }), 1);
    expect(v.text).toContain('(x13)');
    const rows = v.buffs ?? [];
    expect(rows.find((b) => b.source === SEED_KEPT_ROW)).toMatchObject({ attack: 0, health: 0, count: 12 });
    expect(rows.find((b) => b.source === 'Seed')).toMatchObject({ attack: 0, health: 0, count: 1 });
    expect(buffExpiryNote('Seed')).toBe('until your next turn'); // the temporary lane
    expect(buffExpiryNote(SEED_KEPT_ROW)).toBeNull(); // Hum kept these: permanent
  });
});
