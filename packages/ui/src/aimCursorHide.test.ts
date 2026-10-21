// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { aimCursorHidden, aimCursorTouched, installAimCursorHide, setAimCursorHidden } from './aimCursorHide';

// R-PERF-AIM-CURSOR-01 (desktop jank pass 2026-10-18): the aim hides the OS cursor on the element under the pointer,
// never through a universal `body.aiming *` rule that restyles the whole page twice per aim.
const over = (el: Element): void => { el.dispatchEvent(new Event('pointerover', { bubbles: true })); };

describe('aim cursor hide', () => {
  afterEach(() => { setAimCursorHidden(false); document.body.innerHTML = ''; });

  it('hides the cursor on the element the pointer was already over when the aim starts, and on every one it enters', () => {
    installAimCursorHide();
    document.body.innerHTML = '<button id="a"></button><div id="b"><span id="c"></span></div>';
    const a = document.getElementById('a')!; const c = document.getElementById('c')!;
    over(a); // the pointer sits on the hero power button before the aim
    setAimCursorHidden(true);
    expect(aimCursorHidden()).toBe(true);
    expect(a.style.getPropertyValue('cursor')).toBe('none');
    expect(a.style.getPropertyPriority('cursor')).toBe('important');
    over(c); // the pointer travels onto a minion
    expect(c.style.getPropertyValue('cursor')).toBe('none');
    expect(aimCursorTouched()).toBe(2);
  });

  it('restores each element exactly when the aim ends (an inline cursor it already had comes back)', () => {
    installAimCursorHide();
    document.body.innerHTML = '<div id="a" style="cursor: grab"></div><div id="b"></div>';
    const a = document.getElementById('a')!; const b = document.getElementById('b')!;
    setAimCursorHidden(true);
    over(a); over(b);
    setAimCursorHidden(false);
    expect(a.style.getPropertyValue('cursor')).toBe('grab');
    expect(b.style.getPropertyValue('cursor')).toBe('');
    expect(aimCursorTouched()).toBe(0);
    over(b); // after the aim, entering an element writes nothing
    expect(b.style.getPropertyValue('cursor')).toBe('');
  });

  it('no stylesheet rule keys on body.aiming (toggling the flag must restyle nothing)', () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/\.aiming/);
  });
});
