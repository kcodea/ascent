// @vitest-environment jsdom
/**
 * CINDY'S GOLDEN GRATITUDE: THE PASS STREAM PLAYS FOR EVERY BUY (bug report 2026-11-14 on PR #2707, R-DUOS-CINDY-01):
 * "when the TEAMMATE drag-buys a minion while Golden Gratitude is armed, NO pass stream plays on the teammate's screen".
 *
 * The send is shipped (and its stream asked for) inside the store commit, before React mounts the minion the buy made:
 * a fresh uid, not on screen yet, so the stream found no source and played nothing, for a click buy and a drag buy
 * alike. It now waits for that card (`playWhenOnScreen`), and falls back to the hero portrait if it never shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  // jsdom has no Web Animations: a stand-in so the send runs its real path (and rings its cue).
  if (!('animate' in Element.prototype)) (Element.prototype as unknown as { animate: () => unknown }).animate = () => ({ onfinish: null, oncancel: null, cancel() {}, finish() {} });
});

const { playEntryFlight, GRATITUDE_WAIT_FRAMES } = await import('./passLob');
const { sfx } = await import('../sfx');
const { CARD_INDEX } = await import('@game/content');
const { createVersusRun, reduce } = await import('@game/sim');
type RunState = ReturnType<typeof createVersusRun>;

const DUOS = { v: 1 as const, mode: 'duos' as const, modifiers: [] };
const PLAIN = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.tier === 1 && c.effects.length === 0)!.id;

/** A teammate run that bought a minion while Cindy's Golden Gratitude was armed: its outbox holds the copy send. */
function paid(seed: number): { run: RunState; entry: NonNullable<RunState['duos']>['outbox'][number] } {
  const cindy = reduce({ ...createVersusRun(11, 'cindy', 'set2', DUOS), phase: 'recruit' } as RunState, { type: 'heroPower' });
  const arm = cindy.duos!.outbox[0]!;
  let mate = { ...createVersusRun(seed, 'warden', 'set2', DUOS), phase: 'recruit', hand: [], board: [], embers: 50, spell: null, shop: [{ uid: 's0', cardId: PLAIN }] } as RunState;
  mate = reduce(mate, { type: 'receivePass', from: 'p1', seq: arm.seq, card: { ...arm.card, passFrom: 'team', team: arm.team } as never });
  mate = reduce(mate, { type: 'buy', uid: 's0' });
  return { run: mate, entry: mate.duos!.outbox.find((e) => e.gratitude)! };
}

const box = { left: 10, top: 10, width: 100, height: 140, right: 110, bottom: 150, x: 10, y: 10, toJSON: () => ({}) };
function el(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  const node = host.firstElementChild as HTMLElement;
  node.getBoundingClientRect = () => box as DOMRect;
  document.body.appendChild(node);
  return node;
}

let frames: FrameRequestCallback[] = [];
const tick = (n = 1): void => { for (let i = 0; i < n; i++) { const now = frames; frames = []; for (const f of now) f(0); } };
let sent: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  sent = vi.spyOn(sfx, 'duosPassSend').mockImplementation(() => undefined);
  const door = el('<div data-duos-mate=""><div class="duosdock-disc"></div></div>');
  (door.firstElementChild as HTMLElement).getBoundingClientRect = () => box as DOMRect;
});
afterEach(() => { sent.mockRestore(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('the Golden Gratitude send streams once the bought minion is on screen', () => {
  it('the bought card mounts AFTER the commit (a click or a drag buy): the stream still plays, once', () => {
    const { run, entry } = paid(21);
    const bought = run.hand[0]!.uid;
    expect(playEntryFlight(entry, run)).toBe(true);
    expect(sent).not.toHaveBeenCalled(); // the commit frame: no card to leave from yet
    tick(2);
    expect(sent).not.toHaveBeenCalled();
    el(`<div class="card" data-uid="${bought}"></div>`); // React mounts it (a drag buy lands it)
    tick();
    expect(sent).toHaveBeenCalledTimes(1);
    frames = []; // (the plate dissolve's own next frame draws on a canvas jsdom does not have)
    expect(playEntryFlight(entry, run), 'a retry of the same send streams once').toBe(false);
  });

  it('a card that never shows (folded by a triple) streams from my hero portrait instead', () => {
    const { run, entry } = paid(22);
    el('<div class="statusbar"><div class="hero"><div class="f"></div></div></div>');
    (document.querySelector('.statusbar .hero .f') as HTMLElement).getBoundingClientRect = () => box as DOMRect;
    playEntryFlight(entry, run);
    tick(GRATITUDE_WAIT_FRAMES + 2);
    expect(sent).toHaveBeenCalledTimes(1);
  });
});
