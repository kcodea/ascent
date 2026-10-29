/**
 * The "End of Turn" banner is retired (owner 2026-10-29: "there is 'end of turn' text that pops up once you hit the end
 * turn gem. that is redundant now. we can remove that"). Pins that neither the banner nor its styles come back.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string): string => readFileSync(resolve(__dirname, f), 'utf8');

describe('the End of Turn banner is gone', () => {
  it('Recruit renders no End of Turn title, and the stylesheet has no rule for one', () => {
    const recruit = read('Recruit.tsx');
    expect(recruit).not.toMatch(/className="eotbanner"|className="eot-text"|endTurnFlash/);
    expect(recruit).not.toMatch(/>\s*End of Turn\s*</);
    expect(read('styles.css')).not.toMatch(/\.eotbanner|\.eot-text|@keyframes eotpop/);
  });
});
