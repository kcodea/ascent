// @vitest-environment jsdom
/**
 * R-TITLE-CONTINUE-01 (owner 2026-10-18, "continue text is cut off"): the title's gold Continue plaque stacks its
 * round line UNDER the label (`.mbstack`), so the note can never run past the plaque's clipped right edge. Pinned
 * against the real Title + store, plus the stylesheet rules that make the stack a column that wraps, not clips.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type Mounted } from './renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('./remoteBoards')>()), remoteEnabled: () => false }));

import { Title } from './Title';
import { useGame } from './store';

let ui: Mounted | null = null;
beforeEach(() => { useGame.setState({ showTitle: true, titleView: 'menu', savedRun: { wave: 58 } as never }); });
afterEach(() => { ui?.unmount(); ui = null; useGame.setState({ savedRun: null }); });

describe('the title Continue button', () => {
  it('stacks the round line under the CONTINUE label, beside the trash button', () => {
    ui = mount(<Title onSettings={() => {}} />);
    const row = document.querySelector('.titlenav .continuerow');
    expect(row).not.toBeNull();
    const btn = row!.querySelector('.menubtn.active')!;
    const stack = btn.querySelector(':scope > .mbstack');
    expect(stack).not.toBeNull();
    expect([...stack!.children].map((c) => c.className)).toEqual(['mblabel', 'mbnote']);
    expect(stack!.querySelector('.mbnote')?.textContent).toBe('Round 58');
    // The discard button is still the row's other seat, and nothing here uses a native tooltip.
    expect(row!.lastElementChild?.classList.contains('clearrun')).toBe(true);
    expect(document.querySelector('[title]')).toBeNull();
  });

  it('styles the stack as a column whose note wraps instead of clipping', () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    const rule = (sel: string): string => {
      const i = css.indexOf(`${sel} {`);
      expect(i, sel).toBeGreaterThan(-1);
      return css.slice(i, css.indexOf('}', i));
    };
    expect(rule('.titlenav .continuerow .menubtn.active .mbstack')).toMatch(/flex-direction: column/);
    expect(rule('.titlenav .continuerow .menubtn.active .mbstack')).toMatch(/min-width: 0/);
    const note = rule('.titlenav .continuerow .menubtn.active .mbnote');
    expect(note).toMatch(/margin-left: 0/);
    expect(note).toMatch(/white-space: normal/);
  });
});
