import { describe, it, expect } from 'vitest';
import { abhorrentHorrorText, cadenceProgressText, cardTypeTallyText, guelProgressText, sergeantText, soulsmanText, tallyBuffText, undeadBuyAtkText } from './cardText';

describe('cardText helpers', () => {
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
    expect(cardTypeTallyText('skullblade', { attack: 9, health: 6 })).toBeNull();
  });

  it('sergeantText shows the live Deathrattle HP grant (base + accrual, golden-aware)', () => {
    expect(sergeantText('sergeant', false, 4)).toContain('{{+6 Health}}'); // 2 base + 4 accrued
    expect(sergeantText('sergeant', true, 4)).toContain('{{+8 Health}}'); // 4 base (golden) + 4 accrued
    expect(sergeantText('sergeant', false, 0)).toBeNull(); // no accrual yet → printed text
    expect(sergeantText('grim', false, 4)).toBeNull(); // not Sergeant
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
});
