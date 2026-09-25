// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { DiscoverPeekToggle } from './DiscoverPeekToggle';

/** THE PEEK TOGGLE (owner ask 2026-09-25): one button, two states, gold-trimmed, no native tooltip. */
let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; });
const btn = (): HTMLButtonElement => m!.container.querySelector('button.disc-toggle.disc-peek') as HTMLButtonElement;

describe('the Discover peek toggle', () => {
  it('open: reads "Peek at board" with an inline SVG eye, not pressed', () => {
    m = mount(<DiscoverPeekToggle minimized={false} options={3} onToggle={() => {}} />);
    expect(btn().textContent).toBe('Peek at board');
    expect(btn().getAttribute('aria-pressed')).toBe('false');
    expect(btn().querySelector('svg.disc-peek-icon')).not.toBeNull();
    expect(btn().querySelector('.disc-peek-count')).toBeNull();
  });

  it('minimized: reads "Return to Discover" with the option count, pressed', () => {
    m = mount(<DiscoverPeekToggle minimized options={3} onToggle={() => {}} />);
    expect(btn().classList.contains('is-min')).toBe(true);
    expect(btn().querySelector('.disc-peek-label')?.textContent).toBe('Return to Discover');
    expect(btn().querySelector('.disc-peek-count')?.textContent).toBe('3 options');
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    m.unmount();
    m = mount(<DiscoverPeekToggle minimized options={1} onToggle={() => {}} />);
    expect(btn().querySelector('.disc-peek-count')?.textContent).toBe('1 option');
  });

  it('a click toggles; there is no native title tooltip and no em dash in the text', () => {
    let n = 0;
    m = mount(<DiscoverPeekToggle minimized={false} options={3} onToggle={() => { n++; }} />);
    act(() => { btn().click(); });
    expect(n).toBe(1);
    expect(m.container.querySelector('[title]')).toBeNull();
    expect(btn().textContent).not.toMatch(/—|--/);
  });
});
