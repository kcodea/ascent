// @vitest-environment jsdom
/**
 * VERSUS DUOS — THE SWAP CROSS-FADE (owner 2026-10-25: "The teammate view swap animation is really ugly", "The flip to
 * teammate view and back should be extremely fast and clean/smooth"; R-DUOS-VIEW-01). At the click a frozen GHOST of the
 * screen being left goes on top and the real screen swaps under it at once; the ghost then fades out (opacity keyframes
 * only, never the stage root, no team panel, no sweep) and is removed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const watch = vi.fn();
vi.mock('./spectate', async (orig) => ({ ...(await orig<typeof import('./spectate')>()), watchTeammate: (...a: unknown[]) => watch(...a) }));

const { useGame } = await import('../store');
const { useVersus } = await import('./versusStore');
const view = await import('./teammateView');

interface FakeAnim { keyframes: Keyframe[]; target: Element; onfinish: (() => void) | null; oncancel: (() => void) | null; cancel: () => void }
const anims: FakeAnim[] = [];
let rafs: FrameRequestCallback[] = [];
let now = 0;
const frame = (ms: number): void => { now += ms; const due = rafs; rafs = []; for (const f of due) f(now); };
beforeEach(() => {
  anims.length = 0;
  rafs = [];
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { rafs.push(f); return rafs.length; });
  (Element.prototype as { animate?: unknown }).animate = function (this: Element, keyframes: Keyframe[]) {
    const a: FakeAnim = { keyframes, target: this, onfinish: null, oncancel: null, cancel() {} };
    anims.push(a);
    return a;
  };
  document.body.innerHTML = '<div id="root"><div class="app"><span id="x">my board</span></div></div>';
  useVersus.setState({ match: { phase: 'shop', paused_at: null, group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } } } } } as never);
  useGame.setState({ run: { ...useGame.getState().run, mode: 'versus', phase: 'recruit' } } as never);
  watch.mockImplementation(() => { useGame.setState({ run: { ...useGame.getState().run, runId: 'spectate:m:p2' } } as never); });
});
afterEach(() => { useVersus.setState({ match: null } as never); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('the swap cross-fade', () => {
  it('ghosts the screen being left, swaps under it at once, then fades only the ghost (opacity) and removes it', () => {
    view.enterTeammateView();
    const ghost = document.querySelector('.duosghost');
    expect(ghost).not.toBeNull();
    expect(ghost!.textContent).toBe('my board'); // the frozen copy of the screen I clicked on
    expect(ghost!.querySelector('[id]')).toBeNull(); // no duplicate ids
    expect(ghost!.getAttribute('aria-hidden')).toBe('true');
    expect(watch).toHaveBeenCalledWith('p2'); // the swap happens at the click, under the ghost
    expect(document.querySelector('.duosswap')).toBeNull(); // no team panel any more
    expect(anims).toHaveLength(0); // the fade waits for the new screen to be drawn and calm
    frame(40); // the new screen's heavy build frame
    frame(4); frame(4); frame(4);
    expect(anims).toHaveLength(0); // calm, but its second busy frame can still come: not before 70 ms
    for (let i = 0; i < 40 && !anims.length; i++) frame(4);
    expect(anims).toHaveLength(1);
    expect(now).toBeGreaterThanOrEqual(70);
    expect(now).toBeLessThanOrEqual(80);
    expect(anims[0]!.target).toBe(ghost);
    for (const f of anims[0]!.keyframes) for (const k of Object.keys(f)) expect(['opacity', 'offset']).toContain(k);
    expect(anims.some((a) => a.target === document.getElementById('root'))).toBe(false);
    anims[0]!.onfinish?.();
    expect(document.querySelector('.duosghost')).toBeNull();
  });

  it('never waits long: the fade starts by the cap even if the new screen is slow to arrive', () => {
    watch.mockImplementation(() => undefined); // the teammate's frames are still on their way
    view.enterTeammateView();
    for (let i = 0; i < 60 && !anims.length; i++) frame(4);
    expect(anims).toHaveLength(1);
    expect(now).toBeLessThanOrEqual(170);
    anims[0]!.onfinish?.();
  });
});

describe('the swap as a View Transition (R-DUOS-VIEW-SWAP-01)', () => {
  // Owner 2026-10-29: "toggling yours and teammates screen ... needs to feel like you clicked the button and are viewing
  // the other players screen then clicking to get back and do it [without] massive hitching and jank".
  let pending: (() => void | Promise<void>) | null = null;
  let finish: (() => void) | null = null;
  beforeEach(() => {
    pending = null;
    document.body.classList.remove('duos-viewing');
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = (cb: () => void | Promise<void>) => {
      pending = cb;
      return { ready: Promise.resolve(), finished: new Promise<void>((r) => { finish = r; }) };
    };
  });
  afterEach(() => { delete (document as unknown as { startViewTransition?: unknown }).startViewTransition; document.documentElement.classList.remove('duos-vt'); });

  it('the browser snapshots my screen; the swap runs once in its update (no DOM ghost, no main-thread fade), and the class clears at the end', async () => {
    view.enterTeammateView();
    expect(document.querySelector('.duosghost')).toBeNull();
    expect(watch).not.toHaveBeenCalled(); // the old screen is captured first
    expect(document.documentElement.classList.contains('duos-vt')).toBe(true);
    pending!();
    expect(watch).toHaveBeenCalledWith('p2');
    expect(useGame.getState().run.runId).toBe('spectate:m:p2'); // in place when the update returns
    expect(document.body.classList.contains('duos-viewing')).toBe(true);
    expect(anims).toHaveLength(0); // the cross-fade is the browser's, on the compositor
    finish!();
    await Promise.resolve(); await Promise.resolve();
    expect(document.documentElement.classList.contains('duos-vt')).toBe(false);
  });

  it('phones keep the ghost (the snapshot textures cost phone memory and measured far worse there)', () => {
    expect(view.viewTransitionOf(document, true)).toBeNull();
    expect(view.viewTransitionOf(document, false)).not.toBeNull();
  });

  it('the shop closing between the click and the update leaves my own board on screen', () => {
    view.enterTeammateView();
    useVersus.setState({ match: { phase: 'combat', paused_at: null, group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } } } } } as never);
    pending!();
    expect(watch).not.toHaveBeenCalled();
    expect(document.body.classList.contains('duos-viewing')).toBe(false);
    finish!();
  });
});
