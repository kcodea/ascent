// @vitest-environment jsdom
/**
 * THE DEV CORNER SQUARES (R-DEV-CORNER-01, owner 2026-10-30: "put our dev tuner and dev scene builder tuner buttons
 * into a button like this"; moved bottom left 2026-10-31, R-CORNER-SPLIT-01: "move the dev tool buttons to the bottom
 * left, right of the friends list"): in a DEV build the dev tuning menu is a square of the bottom-left row, after Friends,
 * wearing the corner plaque. The minimized Scene Builder's anvil square was retired 2026-11-02 (R-SB-PANEL-CLOSE-01): the
 * panel minimizes to its own header bar, and after a close the dev menu's "Scene Builder" action brings it back. Pins:
 *  - the slot each takes (after Friends, closing up without it);
 *  - the plaque contract in styles.css (the row's size, offsets and look; no bare cursor; above every layer);
 *  - the dev tuner uses it, with an aria-label and the game's hover bubble, never a native `title=`;
 *  - they stay DEV-only: Game.tsx loads DevMenu and the Scene Builder behind `import.meta.env.DEV` lazy imports.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { devCornerSlot } from './friends/dock/FriendsDock';

const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
const styles = src('styles.css');

describe('the dev squares queue up right of Friends on the bottom-left row (R-CORNER-SPLIT-01)', () => {
  it('dev tuner at 1, just right of Friends (0)', () => {
    expect(devCornerSlot(true)).toBe(1);
  });
  it('close up one slot when there is no Friends button', () => {
    expect(devCornerSlot(false)).toBe(0);
  });
});

describe('the corner plaque (styles.css .cornerdev)', () => {
  const rule = styles.slice(styles.indexOf('.cornerdev {'), styles.indexOf('}', styles.indexOf('.cornerdev {')));
  it("sits on the bottom-left row's measured numbers (bottomLeft.ts): its square, a quarter-square apart, on its baseline", () => {
    expect(rule).toContain('--cd-cb: var(--bl-cb);');
    expect(rule).toContain('left: calc(var(--bl-l) + var(--cd-slot) * (var(--cd-cb) * 1.25)); bottom: var(--bl-b);');
    expect(rule).toContain('border-radius: calc(9 * var(--u))');
    expect(rule).not.toMatch(/right:/);
  });
  it("in a game they stack UP the edge from Friends (a full hand fills the bottom edge beside it)", () => {
    expect(styles).toContain('html[data-bl="game"] .cornerdev { left: var(--bl-l); bottom: calc(var(--bl-b) + var(--cd-slot) * var(--cd-cb) * 1.25); }');
  });
  it("wears the row's plaque (the gear / Compendium / Friends fill, rim and bevel)", () => {
    const plaque = 'border: 1.5px solid rgba(196, 160, 92, 0.6); background: linear-gradient(180deg, rgba(24, 36, 58, 0.92), rgba(13, 22, 39, 0.94));';
    expect(rule).toContain(plaque);
    const gear = styles.slice(styles.indexOf('.gearbtn {'), styles.indexOf('}', styles.indexOf('.gearbtn {')));
    expect(gear).toContain(plaque);
  });
  it('never paints a bare cursor (the global gauntlet does), and stays above every layer', () => {
    expect(rule).not.toMatch(/cursor:/);
    expect(styles).not.toMatch(/\.(devmenu-btn|sb-dock)[^{]*\{[^}]*cursor: pointer/);
    expect(Number(/z-index: (\d+)/.exec(rule)?.[1])).toBeGreaterThanOrEqual(3000);
  });
  it('the old floating round buttons are gone', () => {
    expect(styles).not.toMatch(/\.devmenu-btn \{ position: fixed/);
    expect(styles).not.toMatch(/\.sb-dock \{/);
  });
});

describe('the dev tuner uses the square', () => {
  it('the Scene Builder has no corner square any more (R-SB-PANEL-CLOSE-01): minimize is its header bar, the dev menu reopens it', () => {
    const sb = src('SceneBuilder.tsx');
    expect(sb).not.toContain('SceneBuilderDock');
    expect(sb).not.toContain('sb-dock');
    expect(src('DevMenu.tsx')).toContain("{ id: 'scenebuilder', icon: '🏗️', label: 'Scene Builder'");
  });
  it('the dev tuner: the gear square with the count badge, a hover bubble and an aria-label', () => {
    const dev = src('DevMenu.tsx');
    expect(dev).toContain('className={`devmenu-btn cornerdev gtip${shown.size ? \' has-open\' : \'\'}`}');
    expect(dev).toContain("data-tip={open ? undefined : 'Dev tuner'}");
    expect(dev).toContain('<Icon name="gear" />');
    expect(dev).toContain('const devSlot = useDevCornerSlot();');
    expect(dev).not.toMatch(/devmenu-btn[\s\S]{0,400}title=/);
  });
});

describe('DEV builds only', () => {
  it('Game.tsx loads the dev tuner and the Scene Builder only behind import.meta.env.DEV lazy imports', () => {
    const game = src('Game.tsx');
    expect(game).toContain("const DevMenu = import.meta.env.DEV ? lazy(() => import('./DevMenu')");
    expect(game).toMatch(/const SandboxDevPanels = import\.meta\.env\.DEV\s*\? lazy\(/);
    expect(game).not.toMatch(/^import .*from '\.\/(DevMenu|SceneBuilder)'/m);
  });
});
