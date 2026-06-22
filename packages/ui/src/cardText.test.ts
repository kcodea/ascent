import { describe, it, expect } from 'vitest';
import { tallyBuffText } from './cardText';

describe('cardText helpers', () => {
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
});
