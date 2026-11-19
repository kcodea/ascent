/**
 * Recent Games polish (owner 2026-11-06):
 *  - R-SFX-GAMEROWS-01: a game row and a lobby tile hover-tick and click-thock like every other menu button.
 *  - R-LOBBY-TILE-EDGE-01: a lobby tile's gold edge and its result band paint above the Game strength blur.
 *  - R-LOBBY-TILE-BLUR-01 (2026-11-19): the portrait ring and the Ancient disc paint UNDER it; the ring is the disc's outer size.
 * Both are static source contracts: the sound listeners live in Game.tsx (one delegated pair for the app), the edge in CSS.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const noComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Recent Games polish', () => {
  it('R-SFX-GAMEROWS-01: game rows and lobby tiles are not on the menu-sound mute list', () => {
    const game = noComments(src('../../Game.tsx'));
    const m = game.match(/const MENU_SFX_SKIP = ([\s\S]*?);\n/);
    expect(m, 'MENU_SFX_SKIP').not.toBeNull();
    const skip = m![1]!;
    for (const cls of ['.gs-item', '.gs-list', '.lp-tile', '.lp-back']) expect(skip, cls).not.toContain(cls);
    // and they are buttons, so the shared listeners (button, [role="button"]) pick them up
    expect(src('../../GameSplit.tsx')).toMatch(/<button[\s\S]{0,200}className=\{`gs-item/);
    expect(src('../../matchDetails/LobbyPicker.tsx')).toMatch(/<button[\s\S]{0,200}className=\{`lp-tile/);
  });

  it('R-LOBBY-TILE-EDGE-01: the tile edge and band sit above the Game strength overlay', () => {
    const css = noComments(src('./gamesPages.css'));
    const rule = (sel: string): string => {
      const i = css.indexOf(`${sel} {`);
      expect(i, sel).toBeGreaterThan(-1);
      return css.slice(i, css.indexOf('}', i));
    };
    const after = rule('.rgp .lp-tile::after');
    expect(after).toMatch(/z-index:\s*2/);
    expect(after).toMatch(/box-shadow:\s*inherit/);
    expect(after).toMatch(/pointer-events:\s*none/);
    expect(rule('.rgp .lp-tile::before')).toMatch(/z-index:\s*2/);
    // the overlay it must clear stays at z 1
    const base = noComments(src('../../styles.css'));
    const i = base.indexOf('.lp-tile-strength {');
    expect(base.slice(i, base.indexOf('}', i))).toMatch(/z-index:\s*1/);
  });

  it('R-LOBBY-TILE-BLUR-01: the portrait ring and the Ancient stack under the Game strength overlay, at one size', () => {
    const base = noComments(src('../../styles.css'));
    // Both carry z 2 layers (the ring's ::after, the Ancient's art wrap): each must be its own stacking context, or it
    // escapes over the overlay (z 1) and stays sharp.
    const iso = base.match(/([^{}]*)\{\s*isolation:\s*isolate;\s*\}/g)?.join(' ') ?? '';
    expect(iso).toMatch(/\.lp-chip-portrait/);
    expect(iso).toMatch(/\.lp-tile-anc/);
    // The ring is the Ancient's outer size: its 36px face plus the 1.5px edge each side, and the head takes the growth back.
    expect(base).toMatch(/\.lp-tile \.lp-chip-portrait \.cv2-heroframe \{ --ring: 39px; \}/);
    expect(base).toMatch(/\.lp-tile-anc\.heropowerbtn \{ --u: calc\(36px \/ 128\)/);
    expect(base).toMatch(/\.lp-tile \.lp-chip-portrait \{ margin-block: -1\.5px; \}/);
    const ph = noComments(src('./gamesPages.css'));
    expect(ph).toMatch(/\.rgp \.lp-tile \.lp-chip-portrait \.cv2-heroframe \{ --ring: calc\(39 \* var\(--phu\)\); \}/);
  });
});
