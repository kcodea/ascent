import { describe, it, expect } from 'vitest';
import { cadenceProgressText, guelProgressText, tallyBuffText } from './cardText';

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

  it('cadenceProgressText shows Frontdrake’s live countdown to its next Dragon', () => {
    // every:3 — eotTick 0 → 3 turns; 1 → 2; 2 → 1 (singular); 3 → just granted, 3 again.
    expect(cadenceProgressText('frontdrake', 0)).toContain('{{Next in 3 turns.}}');
    expect(cadenceProgressText('frontdrake', 1)).toContain('{{Next in 2 turns.}}');
    expect(cadenceProgressText('frontdrake', 2)).toContain('{{Next in 1 turn.}}'); // singular
    expect(cadenceProgressText('frontdrake', 3)).toContain('{{Next in 3 turns.}}');
    expect(cadenceProgressText('sandbag', 1)).toBeNull(); // not a cadence card
  });
});
