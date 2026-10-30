// @vitest-environment jsdom
/**
 * THE DEV CORNER SQUARES (R-DEV-CORNER-01, owner 2026-10-30: "put our dev tuner and dev scene builder tuner buttons
 * into a button like this, and put them in the bottom right"): in a DEV build the dev tuning menu and the minimized
 * Scene Builder are squares of the bottom-right corner row, after Friends, wearing the row's plaque. Pins:
 *  - the slot each takes (after Friends, closing up without it, stepping to the corner where the row is covered);
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

describe('the dev squares queue up after Friends in the corner row', () => {
  it('dev tuner at 4 and Scene Builder at 5, just left of Friends (3)', () => {
    expect(devCornerSlot(true, '')).toBe(4);
  });
  it('close up one slot when there is no Friends button', () => {
    expect(devCornerSlot(false, '')).toBe(3);
  });
  it('step down to the corner beside Friends where the row is covered', () => {
    expect(devCornerSlot(true, 'corner')).toBe(1);
    expect(devCornerSlot(false, 'corner')).toBe(0);
  });
});

describe('the corner-row plaque (styles.css .cornerdev)', () => {
  const rule = styles.slice(styles.indexOf('.cornerdev {'), styles.indexOf('}', styles.indexOf('.cornerdev {')));
  it('sits on the row\'s own numbers: 40u squares, 10 px apart, 16 px in from the right and bottom edges', () => {
    expect(rule).toContain('--cd-cb: calc(40 * var(--u));');
    expect(rule).toContain('right: calc(var(--edge-r) + 16px + var(--cd-slot) * (var(--cd-cb) + 10px)); bottom: calc(var(--edge-b) + 16px);');
    expect(rule).toContain('border-radius: calc(9 * var(--u))');
  });
  it('wears the row\'s plaque (the gear / Compendium / Rules / Friends fill, rim and bevel)', () => {
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
  it('follows the row on touch screens and both phone framings', () => {
    expect(styles).toContain('html[data-touch-ui] .cornerdev { --cd-cb: var(--touch-cb); }');
    expect(styles).toContain('html[data-touch-ui][data-phone-zoom] .cornerdev { --cd-cb: 66px; right: calc(var(--pz-bxr) + 1920px - 1897px + var(--cd-slot) * 74px);');
    expect(styles).toContain('left: calc(var(--bar-x) + (2725px - var(--cd-slot) * 155px) * var(--scale)); }');
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
    expect(btn!.style.getPropertyValue('--cd-slot')).toMatch(/^[1-6]$/);
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
