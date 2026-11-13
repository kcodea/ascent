import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KEYWORD_BEAMS } from './keywordBeam';
import { getDef } from './fxDefs';
import { defArrivalMs } from './defArrival';

/**
 * THE CRIT BEAM (R-FX-CRIT-GIVEN-01, owner 2026-11-13): Critical Strike given by a spell, a hero power or a rune
 * travels on `crit-beam`, from the same origins as Rise, Execute, Ward and Flurry.
 */
describe('the Critical Strike beam', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('is in the library, travels, and is the beam for Critical Strike', () => {
    expect(KEYWORD_BEAMS.CR.def).toBe('crit-beam');
    expect(getDef('crit-beam')).toBeDefined();
    // Read from the file: the library drops layers here, where no primitive is registered.
    expect(defArrivalMs(JSON.parse(read('./defs/crit-beam.json')))).toBeGreaterThan(0);
  });
  it('it has a launch and a landing sound, both in the library', () => {
    expect(KEYWORD_BEAMS.CR).toEqual({ def: 'crit-beam', launchSfx: 'sfx-crit-sting', landSfx: 'sfx-crit-shing' });
    for (const id of ['sfx-crit-sting', 'sfx-crit-shing']) expect(getDef(id), id).toBeDefined();
  });
  it('the Shop sends it mid-turn (a board read) and at End of Turn (a rune or the hero)', () => {
    const recruit = read('../Recruit.tsx');
    expect(recruit).toContain("if (prevCR!.get(c.uid) === false && c.keywords.includes('CR')) gains.push('CR');");
    expect(recruit).toContain("prevCritRef.current = new Map(run.board.map((c) => [c.uid, c.keywords.includes('CR')]));");
    expect(recruit).toContain("keyword === 'DS' || keyword === 'W' || keyword === 'CR' ||");
  });
  it('it holds no look back, and never the Ward dome by mistake', () => {
    expect(read('./keywordBeam.ts')).toContain("else if (kw === 'DS') holdWard(uid, ms);");
  });
});
