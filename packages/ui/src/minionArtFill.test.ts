import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// R-MINION-ART-FILL-01 (owner 2026-11-15: "the card art in the game is slightly too small. i can see the flat bottom
// edge of every card in its minion frame. can we expand the art size itself by 5% across the board for minions?").
// A minion's art is a square picture in a taller oval window, so at the old zoom its bottom edge stopped a few pixels
// above the frame's bottom rim. Every oval minion's art is now drawn 5% larger. jsdom does not lay out, so this pins
// the CSS: the boost is a multiplier on --artZoom (a card with its own Card Art entry sets --artZoom inline and must
// still get it), it is 1.05, and it lives on the oval minion only.
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

/** The bodies of EVERY rule whose selector list ends with `lastSelector`, joined (a selector can have several rules). */
function body(lastSelector: string): string {
  const esc = lastSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...css.matchAll(new RegExp(`^${esc}\\s*\\{([^}]*)\\}`, 'gm'))];
  if (!all.length) throw new Error(`no rule for selector: ${lastSelector}`);
  return all.map((m) => m[1]).join('\n');
}

describe('oval minion art is drawn 5% larger than its zoom (R-MINION-ART-FILL-01)', () => {
  it('the oval minion family carries --artBoost: 1.05', () => {
    expect(body('.card.compact.stdframe')).toMatch(/--artBoost:\s*1\.05;/);
  });

  it('the oval art scale is --artZoom times --artBoost, so per-card zooms grow too', () => {
    expect(body('.card.compact.stdframe .art canvas')).toContain('scale(calc(var(--artZoom) * var(--artBoost)))');
  });

  it('the whole art is still shown, never cropped to fill', () => {
    expect(body('.card.compact.stdframe .art canvas')).toContain('object-fit: contain');
  });

  it('spells and Taunt shields keep their own scale', () => {
    expect(body('.card.compact.spellframe .art canvas')).toContain('scale(var(--artZoom))');
    expect(body('.card.compact.taunt .art canvas')).toContain('scale(var(--artZoom, 1))');
    expect(body('.card.compact.spellframe')).not.toContain('--artBoost');
  });
});
