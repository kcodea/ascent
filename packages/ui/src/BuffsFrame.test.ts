import { describe, it, expect } from 'vitest';
import { createRun, type RunState } from '@game/sim';
import type { CombatEvent } from '@game/core';
import { combatBuffDelta, gatherRunBuffs } from './runBuffs';

describe('gatherRunBuffs', () => {
  it('returns no rows on a fresh run (window stays hidden)', () => {
    expect(gatherRunBuffs(createRun(1))).toHaveLength(0);
  });

  it('surfaces each active run-wide buff with its live value', () => {
    const run: RunState = {
      ...createRun(1, 'warden'), tier: 4, spellsCast: 8,
      spellBonus: { attack: 0, health: 2 },
      undeadBuyAtk: 3,
      impBuff: { attack: 2, health: 3 },
      cardBuffs: { fred: { attack: 2, health: 2 }, knit: { attack: 6, health: 4 } },
      board: [
        { uid: 'mb', cardId: 'mamabear', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false, summonBonus: 2 },
        { uid: 'gl', cardId: 'guel', tribe: 'neutral', attack: 4, health: 4, keywords: [], golden: false, spellProgress: 8 },
      ],
    };
    const byKey = Object.fromEntries(gatherRunBuffs(run).map((r) => [r.key, r.value]));
    expect(byKey.spell).toBe('+0/+2'); // hero amplify 0 + spellBonus health 2
    expect(byKey.undead).toBe('+3/+0'); // undeadBuyAtk 3
    expect(byKey.fodder).toBe('+2/+2');
    expect(byKey.knit).toBe('+6/+4'); // Spear Warden run-wide enchant
    expect(byKey.imp).toBe('+2/+3');
    expect(byKey.mamabear).toBe('+4/+4'); // base 2 + accrued 2
    expect(byKey.guel).toBe('+3/+3'); // base 1 + floor(spellProgress 8 / 4) = 2 (per-instance, not run-wide)
  });

  it('surfaces tavern buys, cling drones, and the actual max-gold gained (soulsmanGold)', () => {
    const run: RunState = {
      ...createRun(1),
      tavernBuyBonus: { atk: 3, hp: 2 },
      cardBuffs: { cling: { attack: 2, health: 2 } },
      soulsmanGold: 2, // a golden Soulsman gained +2 — the buff shows the real value, not a count
    };
    const byKey = Object.fromEntries(gatherRunBuffs(run).map((r) => [r.key, r.value]));
    expect(byKey.tavern).toBe('+3/+2');
    expect(byKey.cling).toBe('+2/+2'); // labelled "Cling Drones"
    expect(byKey.gold).toBe('+2'); // soulsmanGold = the actual Gold gained, not a count
  });

  it('totals the per-summon grant across every Mama Bear on board', () => {
    const run: RunState = {
      ...createRun(1),
      board: [
        // base 2 + accrued 2 = 4
        { uid: 'a', cardId: 'mamabear', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false, summonBonus: 2 },
        // (base 2 + accrued 0) × golden 2 = 4
        { uid: 'b', cardId: 'mamabear', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: true },
      ],
    };
    const byKey = Object.fromEntries(gatherRunBuffs(run).map((r) => [r.key, r.value]));
    expect(byKey.mamabear).toBe('+8/+8'); // 4 + 4 summed across both
  });

  it('drops Mama Bear / Guel rows once they leave the board', () => {
    const run: RunState = { ...createRun(1), impBuff: { attack: 1, health: 1 }, board: [] };
    const keys = gatherRunBuffs(run).map((r) => r.key);
    expect(keys).toContain('imp');
    expect(keys).not.toContain('mamabear');
    expect(keys).not.toContain('guel');
  });

  it('folds the live combat delta into the spell-power + Max Gold rows', () => {
    const run: RunState = { ...createRun(1), spellBonus: { attack: 0, health: 2 }, soulsmanGold: 1 };
    const byKey = Object.fromEntries(
      gatherRunBuffs(run, { spellAttack: 1, spellHealth: 5, rubyAttack: 0, rubyHealth: 0, gold: 2, auras: {} }).map((r) => [r.key, r.value]),
    );
    expect(byKey.spell).toBe('+1/+7'); // base 0/2 + combat 1/5
    expect(byKey.gold).toBe('+3'); // base 1 + combat 2
  });

  it('surfaces a spell-power row from the combat delta alone (zero base)', () => {
    const byKey = Object.fromEntries(
      gatherRunBuffs(createRun(1), { spellAttack: 0, spellHealth: 4, rubyAttack: 0, rubyHealth: 0, gold: 0, auras: {} }).map((r) => [r.key, r.value]),
    );
    expect(byKey.spell).toBe('+0/+4'); // a Bladesmith firing mid-combat lights the row up from nothing
  });
});

describe('combatBuffDelta', () => {
  it('sums spell-power narrations + player max-Gold procs up to the played beat', () => {
    const events: CombatEvent[] = [
      { type: 'sc', source: 'a', text: '+0/+3 Spell Power' },
      { type: 'sc', source: 'a', text: 'Ghastly Bladesmith readies' }, // unrelated sc — ignored
      { type: 'maxGold', target: 's', side: 'player', amount: 1 },
      { type: 'sc', source: 'b', text: '+1/+0 Spell Power' },
      { type: 'maxGold', target: 's', side: 'player', amount: 1 },
    ];
    expect(combatBuffDelta(events, 0)).toEqual({ spellAttack: 0, spellHealth: 0, rubyAttack: 0, rubyHealth: 0, gold: 0, auras: {} }); // nothing played
    expect(combatBuffDelta(events, 3)).toEqual({ spellAttack: 0, spellHealth: 3, rubyAttack: 0, rubyHealth: 0, gold: 1, auras: {} }); // first sc + first gold
    expect(combatBuffDelta(events, events.length)).toEqual({ spellAttack: 1, spellHealth: 3, rubyAttack: 0, rubyHealth: 0, gold: 2, auras: {} }); // all
  });

  it('ignores enemy-side max-Gold procs (only your economy counts)', () => {
    const events: CombatEvent[] = [{ type: 'maxGold', target: 'e', side: 'enemy', amount: 5 }];
    expect(combatBuffDelta(events, 1).gold).toBe(0);
  });

  it('sums PLAYER Ruby Power telegraphs up to the played beat — the Dawnclaw/Deepvein live tick (owner report 2026-08-04)', () => {
    const events: CombatEvent[] = [
      { type: 'sc', source: 'm1', text: "Dawnclaw triggers Deepvein Tender's Battlecry" }, // narration — ignored
      { type: 'sc', source: 'm0', side: 'player', text: '+0/+1 Ruby Power' },
      { type: 'sc', source: 'e2', side: 'enemy', text: '+2/+2 Ruby Power' }, // an enemy Crownvein — NOT yours
      { type: 'sc', source: 'm0', side: 'player', text: '+1/+0 Ruby Power' },
    ];
    expect(combatBuffDelta(events, 1)).toMatchObject({ rubyAttack: 0, rubyHealth: 0 }); // narration alone ticks nothing
    expect(combatBuffDelta(events, 2)).toMatchObject({ rubyAttack: 0, rubyHealth: 1 }); // Deepvein's gain, AT its beat
    expect(combatBuffDelta(events, 3)).toMatchObject({ rubyAttack: 0, rubyHealth: 1 }); // the enemy gain never counts
    expect(combatBuffDelta(events, events.length)).toMatchObject({ rubyAttack: 1, rubyHealth: 1 });
  });

  it('the Ruby power row ticks up live in combat (run value + the played delta)', () => {
    const run = { rubyBonus: { attack: 0, health: 1 }, board: [] } as unknown as Parameters<typeof gatherRunBuffs>[0];
    const rows = gatherRunBuffs(run, { spellAttack: 0, spellHealth: 0, rubyAttack: 0, rubyHealth: 1, gold: 0, auras: {} });
    expect(rows.find((r) => r.key === 'ruby')?.value).toBe('+0/+2');
    // …and a mid-combat gain lights the row up from nothing, just like Spell power does.
    const fresh = { board: [] } as unknown as Parameters<typeof gatherRunBuffs>[0];
    const lit = gatherRunBuffs(fresh, { spellAttack: 0, spellHealth: 0, rubyAttack: 1, rubyHealth: 1, gold: 0, auras: {} });
    expect(lit.find((r) => r.key === 'ruby')?.value).toBe('+1/+1');
  });
});
