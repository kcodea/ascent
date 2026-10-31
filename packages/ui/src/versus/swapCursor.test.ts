/**
 * THE GAME CURSOR THROUGH THE TEAMMATE SWAP (owner 2026-10-31: "clicking your teammate breaks the cursor for some reason,
 * at least in scene builder. fix that"; R-CURSOR-ROOT-01). While a View Transition runs, Chrome hit-tests the DOCUMENT
 * ELEMENT (the ::view-transition snapshots cover the page), so the cursor is `html`'s own. With none set it was `auto`:
 * the OS arrow, kept until the mouse moved. `html` now always carries the gauntlet, and the open one while the swap's
 * transition (`duos-vt`) runs, the portrait's own cursor.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
const versus = readFileSync(join(__dirname, 'versus.css'), 'utf8');

describe('R-CURSOR-ROOT-01: the gauntlet cursor on the page root', () => {
  it('html carries the default gauntlet, so the bare page never shows the OS arrow', () => {
    expect(styles).toContain("html { cursor: url('/cursors/gauntlet_default.svg') 6 2, auto; }");
  });
  it('while the teammate swap transition runs, html shows the open gauntlet (the portrait under the hand)', () => {
    expect(versus).toContain("html.duos-vt { cursor: url('/cursors/gauntlet_open.svg') 6 2, pointer; }");
  });
  it('the swap toggles exactly that class on the document element', () => {
    const src = readFileSync(join(__dirname, 'teammateView.tsx'), 'utf8');
    expect(src).toContain("root.classList.add('duos-vt')");
    expect(src).toContain('const root = document.documentElement;');
  });
});
