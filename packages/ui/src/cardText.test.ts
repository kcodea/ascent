import { describe, it, expect } from 'vitest';
import { abhorrentHorrorText, cadenceProgressText, cardTypeTallyText, guelProgressText, monkProgressText, sergeantText, soulsmanText, summonBuffText, summonImproveText, summonScalingText, tallyBuffText, taragosaText, undeadBuyAtkText, watcherText } from './cardText';

describe('cardText helpers', () => {
  it("monkProgressText shows Flowing Monk's live grant + countdown to the next step (golden-aware)", () => {
    // 0 overflows: grant +2/+2, 5 to the next step — the current value shows from the very start.
    expect(monkProgressText('monk', false, 0)).toContain('{{+2/+2}}');
    expect(monkProgressText('monk', false, 0)).toContain('{{5 to go}}');
    // 7 overflows: floor(7/5)=1 → grant +4/+4; 7%5=2 → 3 to the next step.
    expect(monkProgressText('monk', false, 7)).toContain('{{+4/+4}}');
    expect(monkProgressText('monk', false, 7)).toContain('{{3 to go}}');
    // Golden, 5 overflows: 2 × (1 + 1) × 2 = +8/+8; per-step shows +4/+4.
    expect(monkProgressText('monk', true, 5)).toContain('{{+8/+8}}');
    expect(monkProgressText('monk', true, 5)).toContain('**+4/+4**');
    // A tripled golden carrying a flat combine bonus (+10) reads base 4 + 10 = +14/+14.
    expect(monkProgressText('monk', true, 0, 10)).toContain('{{+14/+14}}');
    expect(monkProgressText('monk', true, 0, 10)).toContain('{{5 to go}}');
    // Non-Monk card → null (falls back to printed text).
    expect(monkProgressText('sandbag', false, 3)).toBeNull();
  });
  it('guelProgressText shows Guel’s live grant + countdown to the next step (golden-aware)', () => {
    // 0 spells cast: grant +1/+1, 4 to the next step.
    expect(guelProgressText('guel', false, 0)).toContain('{{+1/+1}}');
    expect(guelProgressText('guel', false, 0)).toContain('{{4 to go}}');
    // 5 spells: floor(5/4)=1 → grant +2/+2; 5%4=1 → 3 to the next step.
    expect(guelProgressText('guel', false, 5)).toContain('{{+2/+2}}');
    expect(guelProgressText('guel', false, 5)).toContain('{{3 to go}}');
    // Golden, 4 spells: (1 + floor(4/4)) × 2 = +4/+4; per-step shows +2/+2.
    expect(guelProgressText('guel', true, 4)).toContain('{{+4/+4}}');
    expect(guelProgressText('guel', true, 4)).toContain('**+2/+2**');
    // Non-Guel card → null (falls back to printed text).
    expect(guelProgressText('sandbag', false, 8)).toBeNull();
  });


  it('tallyBuffText shows Grim’s live +N/+N from the run Deathrattle tally', () => {
    // Grim: "give your Beasts **+1/+1** for each Deathrattle triggered this game" — with 4 triggered,
    // the printed +1/+1 becomes a green {{+4/+4}}.
    expect(tallyBuffText('grim', 4)).toContain('{{+4/+4}}');
    expect(tallyBuffText('grim', 4)).not.toContain('**+1/+1**'); // the printed value was replaced
  });

  it('tallyBuffText falls back (null) at a zero tally or on a non-tally card', () => {
    expect(tallyBuffText('grim', 0)).toBeNull(); // nothing triggered yet → printed text
    expect(tallyBuffText('sandbag', 5)).toBeNull(); // not a tally-buff card
  });

  it('run-wide metric helpers surface live values (Soulsman gold, undeadBuyAtk contributors, Eternal Knight tally)', () => {
    // Soulsman: total max-Gold earned this run.
    expect(soulsmanText('soulsman', 5)).toContain('{{Gained 5 Gold this run.}}');
    expect(soulsmanText('soulsman', 0)).toBeNull();
    expect(soulsmanText('grim', 5)).toBeNull();
    // The undeadBuyAtk contributors show what a freshly-acquired Undead will inherit.
    for (const id of ['deathswarmer', 'forsakenweaver', 'karthus']) {
      expect(undeadBuyAtkText(id, 4)).toContain('{{New Undead arrive +4 Attack.}}');
    }
    expect(undeadBuyAtkText('deathswarmer', 0)).toBeNull();
    expect(undeadBuyAtkText('spore', 4)).toBeNull(); // not a contributor
    // Eternal Knight: run-wide card-type enchant accrued from deaths.
    expect(cardTypeTallyText('knit', { attack: 9, health: 6 })).toContain('{{Now +9/+6 this run.}}');
    expect(cardTypeTallyText('knit', { attack: 0, health: 0 })).toBeNull();
    expect(cardTypeTallyText('spore', { attack: 9, health: 6 })).toBeNull();
  });

  it('sergeantText shows the live Deathrattle HP grant (base + accrual, golden-aware)', () => {
    expect(sergeantText('sergeant', false, 4)).toContain('{{+6 Health}}'); // 2 base + 4 accrued
    expect(sergeantText('sergeant', true, 4)).toContain('{{+8 Health}}'); // 4 base (golden) + 4 accrued
    expect(sergeantText('sergeant', false, 0)).toBeNull(); // no accrual yet → printed text
    expect(sergeantText('grim', false, 4)).toBeNull(); // not Sergeant
  });

  it('summonImproveText (Mama Bear) shows the live per-summon grant = (2 base + accrued), golden-aware', () => {
    expect(summonImproveText('mamabear', 4, false)).toContain('{{+6/+6}}'); // 2 base + 4 accrued
    expect(summonImproveText('mamabear', 2, true)).toContain('{{+8/+8}}'); // (2 + 2) × 2 golden (from goldenText)
    expect(summonImproveText('mamabear', 0, false)).toBeNull(); // no accrual yet → printed +2/+2
    expect(summonImproveText('sandbag', 4, false)).toBeNull(); // not a per-summon-improve card
  });

  it('summonScalingText (Spirit Worgen) shows the live per-summon gain = base + spells cast this turn', () => {
    expect(summonScalingText('spiritworgen', 3)).toContain('{{+6/+6}}'); // base 3 + 3 spells this turn
    expect(summonScalingText('spiritworgen', 0)).toBeNull(); // no spells this turn → printed +3/+3
    expect(summonScalingText('grim', 3)).toBeNull(); // not a spells-this-turn scaler
  });

  it('taragosaText scales Growth with spell power (golden casts twice)', () => {
    expect(taragosaText('taragosa', false, 4, 4)).toContain('{{+7/+8}}'); // base 3/4 + spell power 4/4
    expect(taragosaText('taragosa', true, 4, 4)).toContain('{{+14/+16}}'); // ×2 (Growth twice)
    expect(taragosaText('taragosa', false, 0, 0)).toBeNull(); // no spell power → printed +3/+4
    expect(taragosaText('tara', false, 4, 4)).toBeNull(); // not Taragosa
  });

  it('watcherText shows the live Lantern buff (base + spell power); golden casts twice', () => {
    expect(watcherText('watcher', false, 2)).toContain('{{+5 Attack}}'); // base 3 + spell power 2
    expect(watcherText('watcher', true, 2)).toContain('{{+10 Attack}}'); // (3 + 2) × 2 casts
    expect(watcherText('watcher', false, 0)).toBeNull(); // no spell power → printed +3 (golden +6)
    expect(watcherText('spore', false, 2)).toBeNull(); // not Watcher
  });

  it('abhorrentHorrorText shows the pending Start-of-Combat gain from Fodder consumed this turn (golden-aware)', () => {
    // 4/4 of Fodder consumed → it'll gain +4/+4 next combat (green); golden doubles to +8/+8.
    expect(abhorrentHorrorText('abhorrenthorror', { attack: 4, health: 4 }, false)).toContain('{{+4/+4 next combat}}');
    expect(abhorrentHorrorText('abhorrenthorror', { attack: 4, health: 4 }, true)).toContain('{{+8/+8 next combat}}');
    // Nothing consumed yet, or a non-Abhorrent card → null (falls back to printed text).
    expect(abhorrentHorrorText('abhorrenthorror', { attack: 0, health: 0 }, false)).toBeNull();
    expect(abhorrentHorrorText('abhorrenthorror', undefined, false)).toBeNull();
    expect(abhorrentHorrorText('sandbag', { attack: 4, health: 4 }, false)).toBeNull();
  });

  it('cadenceProgressText shows Frontdrake’s live countdown, reading “End of this turn.” on the proc turn', () => {
    // every:3 — eotTick 0 → 3 turns; 1 → 2; 2 → THIS turn's End of Turn lands it (one shy of a multiple);
    // 3 → just granted, 3 again.
    expect(cadenceProgressText('frontdrake', 0)).toContain('{{Next in 3 turns.}}');
    expect(cadenceProgressText('frontdrake', 1)).toContain('{{Next in 2 turns.}}');
    expect(cadenceProgressText('frontdrake', 2)).toContain('{{End of this turn.}}'); // procs at this turn's EOT
    expect(cadenceProgressText('frontdrake', 5)).toContain('{{End of this turn.}}'); // also one shy (5 % 3 === 2)
    expect(cadenceProgressText('frontdrake', 3)).toContain('{{Next in 3 turns.}}');
    expect(cadenceProgressText('sandbag', 1)).toBeNull(); // not a cadence card
  });

  it('cadenceProgressText also covers Money Maker’s every-2-turns cadence', () => {
    expect(cadenceProgressText('moneymaker', 0)).toContain('{{Next in 2 turns.}}');
    expect(cadenceProgressText('moneymaker', 1)).toContain('{{End of this turn.}}'); // one shy (1 % 2 === 1)
  });

  it('summonBuffText shows Kennelmaster’s live Start-of-Combat Beast aura (base + Avenge bonus)', () => {
    // Kennelmaster's aura is +(1 + summonBonus)/+(same); the printed +1/+1 becomes the live value.
    expect(summonBuffText('kennel', 0)).toBeNull(); // fresh → falls back to printed +1/+1
    expect(summonBuffText('kennel', 2)).toContain('{{+3/+3}}'); // base 1 + summonBonus 2
    expect(summonBuffText('sandbag', 3)).toBeNull(); // not a summon-buff / aura card
  });
});
