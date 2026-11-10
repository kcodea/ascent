/**
 * THE MODE'S DESCRIPTION NEVER SITS ON THE TEAM PLATE (R-PARTY-CAPTION-01, Duos audit 2026-11-09: once a teammate joined,
 * "You and a teammate against three teams." was drawn through the "Your team" plate). The line is lowered into the stage's
 * head slot only while that slot is empty; with a plate there (`headed`) it keeps its own row under the tabs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'partyHome.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tsx = readFileSync(join(__dirname, 'PartyHome.tsx'), 'utf8');

describe('R-PARTY-CAPTION-01: the description and the head plate never overlap', () => {
  it('the lowered line goes back to its own row while the head slot holds a plate', () => {
    const lowered = css.indexOf('html:not([data-ph-compact]) .ph-desc { translate: 0 calc(54 * var(--phu)); }');
    const headed = css.indexOf('html:not([data-ph-compact]) .ph-desc.headed { translate: none; }');
    expect(lowered).toBeGreaterThan(-1);
    expect(headed).toBeGreaterThan(lowered); // later in the sheet, and more specific: it wins
  });

  it('`headed` is on exactly when the head slot draws a plate: the team name, or a room title / rule', () => {
    expect(tsx).toContain("${teamLabel || (mode.party === 'rivals' && (versusRoom || rule)) ? ' headed' : ''}");
    // The two plates the head slot can draw, under the same conditions.
    expect(tsx).toContain("{!teamLabel && mode.party === 'rivals' && (versusRoom || rule) && (");
    expect(tsx).toContain('{teamLabel && (');
  });
});
