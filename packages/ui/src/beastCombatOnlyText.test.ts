import { describe, it, expect } from 'vitest';
import { QUEST_DEFS } from '@game/content';
import { liveCardText } from './instView';
import { questRewardLiveOf, questRewardLiveText, questRewardText } from './questText';
import { runeTally } from './runeTally';

/**
 * R-AURA-03 (owner 2026-09-28) — the LIVE TEXT half: Beast buffs are "Give all Beasts +X/+Y this combat" and every
 * surface prints the CURRENT value. `liveCardText` is the one chain the shop, board, hand, Discover, end screen
 * AND the combat `Unit` read (Unit.tsx calls it with the combat body's own `summonBonus`), so pinning it here pins
 * both phases.
 */

// The minimal live-text bag the cardText tests use; the fields a Beast card reads are overridden per case.
const bag = { tier: 6, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0 };

describe('Kennelmaster prints its CURRENT grant (base + Avenge improvements), plain and gilded', () => {
  it.each([
    [0, false, '**+1 Attack**'],
    [3, false, '{{+4 Attack}}'],
    [3, true, '{{+8 Attack}}'],
  ])('summonBonus %i, golden %s → %s', (summonBonus, golden, want) => {
    const t = liveCardText('kennel', { ...bag, golden, summonBonus } as never);
    const shown = golden ? t.goldenText! : t.text;
    expect(shown).toContain(want);
    expect(shown).toContain('Give all **Beasts**');
    expect(shown).toContain('this combat');
    expect(shown).not.toMatch(/Beast Aura/);
  });
});

describe('Trophy Stalker prints its grown grant', () => {
  it('summonBonus 10 → +15/+15 this combat (gilded +30/+30)', () => {
    expect(liveCardText('trophystalker', { ...bag, summonBonus: 10 } as never).text).toContain('{{+15/+15}} this combat');
    expect(liveCardText('trophystalker', { ...bag, golden: true, summonBonus: 10 } as never).goldenText).toContain('{{+30/+30}}');
  });
});

describe('Grim is flat: the Echo tally no longer changes its text', () => {
  it.each([0, 4, 20])('%i Echoes so far → still +8/+8 (gilded +16/+16)', (n) => {
    expect(liveCardText('grim', { ...bag, deathrattlesTriggered: n } as never).text).toBe('**Echo:** Give all **Beasts** **+8/+8** this combat.');
    expect(liveCardText('grim', { ...bag, golden: true, deathrattlesTriggered: n } as never).goldenText).toBe('**Echo:** Give all **Beasts** **+16/+16** this combat.');
  });
});

describe('Pack Mentality + The Old Hunt quest text (badge + hero-power tooltip)', () => {
  const pack = QUEST_DEFS.find((q) => q.id === 'q_pack_mentality')!;
  const hunt = QUEST_DEFS.find((q) => q.id === 'q_the_old_hunt')!;

  it('the printed rewards drop the Beast Aura for the combat-only template', () => {
    expect(questRewardText(pack.reward)).toBe('Start of Combat: give all Beasts +4/+4 this combat. Improve this by +4/+4 every 5 Beasts summoned in combat');
    expect(questRewardText(hunt.reward)).toBe('Whenever a Beast attacks, give all Beasts +3/+3 this combat');
  });

  it('Pack Mentality shows its CURRENT level and the countdown, read off the run', () => {
    const run = { questScalingAuras: [{ tribe: 'beast' as const, event: 'summonCombat' as const, per: 5, progress: 3, attack: 12, health: 12 }] };
    expect(questRewardLiveText(pack.reward, questRewardLiveOf(run, pack.reward))).toBe('Now: Beasts +12/+12 this combat · +4/+4 in 2 more');
  });
});

describe('Rune of Beastial Swarm shows its current per-death grant', () => {
  it('the rune pill reads the improved level', () => {
    expect(runeTally({ questFlags: { runeBeastialSwarm: true }, beastialSwarmLevel: 6 } as never, 'rune_beastial_swarm')).toBe('+6/+6');
  });
});
