// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The browser's history, in miniature: entries, and an asynchronous `back` that fires popstate. */
function fakeHistory() {
  const entries: unknown[] = [null];
  let at = 0;
  const pending: number[] = [];
  vi.spyOn(history, 'pushState').mockImplementation((s) => { entries.length = at + 1; entries.push(s); at++; });
  vi.spyOn(history, 'replaceState').mockImplementation((s) => { entries[at] = s; });
  vi.spyOn(history, 'back').mockImplementation(() => { pending.push(-1); });
  return {
    flush(): void { while (pending.length) { pending.shift(); if (at === 0) continue; at--; window.dispatchEvent(new PopStateEvent('popstate', { state: entries[at] })); } },
    back(): void { pending.push(-1); this.flush(); },
    get at(): number { return at; },
  };
}
const esc = (): boolean => !window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

describe('R-PH-BACK-LAYERS-01: Esc and Back take the single top layer first', () => {
  let h: ReturnType<typeof fakeHistory>;
  let ph: typeof import('./phHistory');
  const added: [string, EventListener, boolean | undefined][] = [];
  beforeEach(async () => {
    vi.resetModules(); vi.restoreAllMocks(); h = fakeHistory(); ph = await import('./phHistory');
    const real = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(((t: string, f: EventListener, o?: boolean) => { added.push([t, f, o]); real(t, f, o); }) as typeof window.addEventListener);
  });
  afterEach(() => { for (const [t, f, o] of added.splice(0)) window.removeEventListener(t, f, o); });

  it('off the shell a layer does nothing at all', () => {
    const close = vi.fn();
    ph.phLayer(close)();
    expect(history.pushState).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
  it('a stack of layers closes from the top, one per press, Esc and Back alike', () => {
    ph.phEnable();
    const order: string[] = [];
    ph.phLayer(() => order.push('menu')); ph.phLayer(() => order.push('page')); ph.phLayer(() => order.push('pop-up'));
    expect(esc()).toBe(true); h.flush();
    expect(order).toEqual(['pop-up']);
    h.back();
    expect(order).toEqual(['pop-up', 'page']);
    expect(esc()).toBe(true); h.flush();
    expect(order).toEqual(['pop-up', 'page', 'menu']);
    expect(esc(), 'nothing left: Esc is the game\'s').toBe(false);
  });
  it('in a game with nothing open Back stays in the game, however many times', () => {
    ph.phEnable();
    for (let i = 0; i < 5; i++) { h.back(); expect(h.at).toBeGreaterThan(0); }
  });
  it('a page under a layer stays: the layer goes first', () => {
    const show = vi.fn();
    ph.phAttach(show);
    ph.phPagePushed('home'); ph.phPagePushed('career');
    const close = vi.fn();
    ph.phLayer(close);
    h.back();
    expect(close).toHaveBeenCalledOnce();
    expect(show).not.toHaveBeenCalled();
    h.back();
    expect(show).toHaveBeenCalledWith('home');
  });
  it('a layer closed by its own control gives its history entry back, in or out of order', () => {
    ph.phEnable();
    const a = vi.fn(); const b = vi.fn();
    const offA = ph.phLayer(a); const offB = ph.phLayer(b);
    const before = h.at;
    offA(); h.flush();
    expect(h.at, 'out of order: nothing moves yet').toBe(before);
    offB(); h.flush();
    expect(h.at).toBe(before - 2);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
  it('a search box with text clears on Esc, and nothing else goes', () => {
    ph.phEnable();
    const close = vi.fn(); ph.phLayer(close);
    const input = document.createElement('input'); input.type = 'search'; input.value = 'imp';
    document.body.append(input); input.focus();
    expect(esc()).toBe(true); h.flush();
    expect(input.value).toBe('');
    expect(close).not.toHaveBeenCalled();
    input.remove();
  });
});
