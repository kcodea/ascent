import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// R-TRIPLE-HINT-OVAL-01: the triple hints never draw the tribe-colour box ring on a framed (oval / shield) card.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('triple hints on framed cards (R-TRIPLE-HINT-OVAL-01)', () => {
  it('drops the box ring for both hints on the oval and the shield', () => {
    const rule = css.match(/\.card\.compact\.stdframe\.tripready, \.card\.compact\.stdframe\.matetrip,\s*\.card\.compact\.taunt\.tripready, \.card\.compact\.taunt\.matetrip \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).not.toContain('var(--c)');
  });
});
