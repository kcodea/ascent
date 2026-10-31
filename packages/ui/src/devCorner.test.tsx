// @vitest-environment jsdom
/**
 * THE DEV CORNER SQUARES (R-DEV-CORNER-01, owner 2026-10-30: "put our dev tuner and dev scene builder tuner buttons
 * into a button like this"; moved bottom left 2026-10-31, R-CORNER-SPLIT-01: "move the dev tool buttons to the bottom
 * left, right of the friends list"): in a DEV build the dev tuning menu and the minimized Scene Builder are squares of the
 * bottom-left row, after Friends, wearing the corner plaque. Pins:
 *  - the slot each takes (after Friends, closing up without it);
 *  - the plaque contract in styles.css (the row's size, offsets and look; no bare cursor; above every layer);
 *  - both buttons use it, with an aria-label and the game's hover bubble, never a native `title=`;
 *  - they stay DEV-only: Game.tsx loads DevMenu and the Scene Builder behind `import.meta.env.DEV` lazy imports.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from './renderedText.mount';
import { devCornerSlot } from './friends/dock/FriendsDock';
import { SceneBuilderDock } from './SceneBuilder';

const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
const styles = src('styles.css');

describe('the dev squares queue up right of Friends on the bottom-left row (R-CORNER-SPLIT-01)', () => {
  it('dev tuner at 1 and Scene Builder at 2, just right of Friends (0)', () => {
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

describe('both dev buttons use the square', () => {
  let m: Mounted | null = null;
  afterEach(() => { m?.unmount(); m = null; });
  it('the minimized Scene Builder: the anvil square, a hover bubble and an aria-label, no native tooltip', () => {
    const restore = vi.fn();
    m = mount(<SceneBuilderDock onRestore={restore} />);
    const btn = m.container.querySelector<HTMLButtonElement>('button.sb-dock.cornerdev.gtip');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Restore Scene Builder');
    expect(btn!.getAttribute('data-tip')).toBe('Scene Builder');
    expect(btn!.hasAttribute('title')).toBe(false);
    expect(btn!.style.getPropertyValue('--cd-slot')).toMatch(/^[1-2]$/);
    expect(btn!.querySelector('svg')).not.toBeNull();
    act(() => { btn!.click(); });
    expect(restore).toHaveBeenCalledTimes(1);
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
