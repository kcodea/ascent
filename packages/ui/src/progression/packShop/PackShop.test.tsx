// @vitest-environment jsdom
/**
 * The pack shop shell (Task 8), rendered under jsdom with a FAKE scene (jsdom has no WebGL) and a fake opener: one
 * purchase per drop, the kept / dropped request ids, every refusal, playing a pack, the keyboard buy, reduced motion and
 * the empty / large edges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { BuyPackOutcome, OwnedPack, PackOffer, PackShelf } from '@game/progression';
import { mount, type Mounted } from '../../renderedText.mount';
import type { PackOpenerProps } from '../packOpening/PackOpener';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

vi.mock('./shopSounds', () => ({
  createShopSounds: () => {
    const nop = (): void => undefined;
    return { pickUp: nop, shake: nop, overLine: nop, till: nop, land: nop, refuse: nop, rack: nop, play: nop, dispose: nop };
  },
}));

let openerProps: PackOpenerProps | null = null;
vi.mock('../packOpening/PackOpener', () => ({
  PackOpener: (p: PackOpenerProps) => {
    openerProps = p;
    return <div data-testid="fake-opener" data-queue={p.queue.map((q) => q.packId).join(',')} />;
  },
}));

/** Every target the wallet counter was given, in order (the real tally rolls toward them on rAF). */
const tallyTargets: number[] = [];
vi.mock('../packOpening/AetherTally', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    AetherTally: forwardRef<{ setTarget(v: number): void; gulp(): void }>(function FakeTally(_p, ref) {
      useImperativeHandle(ref, () => ({ setTarget: (v: number) => { tallyTargets.push(v); }, gulp: () => undefined }), []);
      return <span className="pkop-aether-orb" />;
    }),
  };
});

import { PackShop, SHOP_PLAY_TRAVEL_MS, type PackShopProps } from './PackShop';
import type { ShopScene, ShopSceneEvents } from './shopScene';

const look = (id: string, name: string) => ({ kind: 'rarity', id, name, guaranteedFloor: 'rare' } as const);
const SHELVES: PackShelf[] = [{ id: 'packs', name: 'Packs' }, { id: 'boxes', name: 'Boxes' }];
const offer = (offerId: string, name: string, price: number, over: Partial<PackOffer> = {}): PackOffer =>
  ({ offerId, look: look(offerId, name), price, shelf: 'packs', contains: 1, ...over });
const OFFERS: PackOffer[] = [offer('rare', 'Rare Pack', 200), offer('epic', 'Epic Pack', 500), offer('box', 'Rare Box', 1000, { shelf: 'boxes', contains: 10 })];
const owned = (packId: string, name = 'Rare Pack'): OwnedPack => ({ packId, look: look('rare', name) });
const R = { left: 100, top: 100, width: 80, height: 120 };

interface Fake { calls: string[]; events: ShopSceneEvents; scene: ShopScene }
let fakes: Fake[] = [];
/** When set, `payAether` keeps its progress callback here for the test to step, instead of landing at once. */
let holdStream = false;
let stream: ((frac: number, done: boolean) => void) | null = null;
const sceneFactory: NonNullable<PackShopProps['sceneFactory']> = (_host, events) => {
  const f: Fake = { calls: [], events, scene: null as unknown as ShopScene };
  const ids = (xs: readonly { offerId?: string; packId?: string }[]): string => xs.map((x) => x.offerId ?? x.packId).join(',');
  f.scene = {
    setShelf: (o) => { f.calls.push('setShelf:' + ids(o)); },
    setHand: (p) => { f.calls.push('setHand:' + ids(p)); },
    setAffordable: (s) => { f.calls.push('setAffordable:' + [...s].join(',')); },
    scrollBy: (n) => { f.calls.push('scrollBy:' + n); },
    buySettled: (ok) => { f.calls.push('buySettled:' + ok); },
    rectOf: () => R,
    gainAether: (_to, progress) => { f.calls.push('gain'); progress(1, true); },
    payAether: (_from, id, progress) => {
      f.calls.push('payAether:' + id);
      if (holdStream) { stream = progress; return; }
      progress(0.5, false); progress(1, true);
    },
    setInputEnabled: (on) => { f.calls.push('input:' + on); },
    setVisible: (on, ms) => { f.calls.push(`visible:${on}:${ms}`); },
    destroy: () => { f.calls.push('destroy'); },
  };
  fakes.push(f);
  return f.scene;
};
const fake = (): Fake => fakes[fakes.length - 1]!;
const fire = (fn: (e: ShopSceneEvents) => void): void => { act(() => { fn(fake().events); }); };

let m: Mounted | null = null;
let buys: { offerId: string; requestId: string }[] = [];
let answer: { resolve: (o: BuyPackOutcome) => void; reject: (e: unknown) => void } | null = null;
const buy: PackShopProps['buy'] = (offerId, requestId) => {
  buys.push({ offerId, requestId });
  return new Promise<BuyPackOutcome>((resolve, reject) => { answer = { resolve, reject }; });
};
const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const settle = async (o: BuyPackOutcome): Promise<void> => { await act(async () => { answer!.resolve(o); await flush(); }); };
const fail = async (): Promise<void> => { await act(async () => { answer!.reject(new Error('timeout')); await flush(); }); };
const opens = vi.fn(() => new Promise<never>(() => undefined));
let props: PackShopProps;
const render = (over: Partial<PackShopProps> = {}): void => {
  props = { shelves: SHELVES, offers: OFFERS, hand: [owned('h1')], aether: 1000, buy, open: opens, sceneFactory, reducedMotion: false, ...over };
  if (m) m.render(<PackShop {...props} />);
  else m = mount(<PackShop {...props} />);
};
const live = (): string => document.querySelector('.pks-live')?.textContent ?? '';
const balance = (): string => document.querySelector('[data-testid="pks-balance"]')?.textContent ?? '';
const btn = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find((b) => b.textContent === label);
const btns = (label: string): HTMLButtonElement[] => [...document.querySelectorAll('button')].filter((b) => b.textContent === label);
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
const key = (k: string): void => { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };
const shelfItem = (id: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`[data-offer="${id}"]`)!;
const handLabels = (): string[] => [...document.querySelectorAll('ul[aria-label="Your hand"] button')].map((b) => b.textContent ?? '');

beforeEach(() => { fakes = []; buys = []; answer = null; openerProps = null; opens.mockClear(); tallyTargets.length = 0; holdStream = false; stream = null; });
afterEach(() => { m?.unmount(); m = null; });

describe('PackShop', () => {
  it('a drop across the line buys once, with one request id, and adds the pack to the hand', async () => {
    render();
    expect(fake().calls.slice(0, 3)).toEqual(['setShelf:rare,epic', 'setHand:h1', 'setAffordable:rare,epic,box']);
    fire((e) => { e.onPickUp('shelf', 'rare'); });
    expect(document.querySelector('.pks-line-words')?.textContent).toBe('200 Aether');
    fire((e) => { e.onDrop('buy', 'rare', R); });
    expect(buys).toHaveLength(1);
    expect(buys[0]!.offerId).toBe('rare');
    expect(buys[0]!.requestId).toMatch(/\S{8,}/);
    expect(document.querySelector('.pks-line-words')).toBeNull();
    const before = fake().calls.length;
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    const after = fake().calls.slice(before);
    // the order the scene needs: the stream, then the pack into the hand, then the hand that holds it
    expect(after.slice(0, 3)).toEqual(['payAether:rare', 'buySettled:true', 'setHand:h1,n1']);
    expect(after).toContain('setAffordable:rare,epic');
    expect(balance()).toBe('800 Aether');
    expect(live()).toBe('Bought Rare Pack');
    expect(handLabels()).toEqual(['Rare Pack, Open', 'Rare Pack, Open']);
    // the parent catches up: the pack is not shown twice
    render({ hand: [owned('h1'), owned('n1')], aether: 800 });
    expect(handLabels()).toHaveLength(2);
    expect(buys).toHaveLength(1);
  });

  it('a second drop while a purchase is pending never calls buy again', async () => {
    render();
    fire((e) => { e.onDrop('buy', 'rare', R); });
    fire((e) => { e.onDrop('buy', 'epic', R); });
    fire((e) => { e.onDrop('buy', 'rare', R); });
    expect(buys).toHaveLength(1);
    expect(fake().calls.filter((c) => c.startsWith('buySettled'))).toEqual([]);
    // Esc does not close mid-purchase, nor does the Close button
    const onClose = vi.fn();
    render({ onClose });
    key('Escape');
    expect(btn('Close')!.disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    expect(fake().calls.filter((c) => c.startsWith('buySettled'))).toEqual(['buySettled:true']);
    fire((e) => { e.onDrop('buy', 'epic', R); });
    expect(buys.map((b) => b.offerId)).toEqual(['rare', 'epic']);
  });

  it('a purchase that rejects keeps its request id: buying the same offer at the same price sends the same id', async () => {
    render();
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await fail();
    expect(fake().calls.at(-1)).toBe('buySettled:false');
    expect(live()).toBe('Could not buy the pack. Try again.');
    expect(balance()).toBe('1000 Aether');
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await settle({ status: 'error', reason: 'failed' });
    expect(live()).toBe('Could not buy the pack. Try again.');
    fire((e) => { e.onDrop('buy', 'rare', R); });
    expect(buys).toHaveLength(3);
    expect(new Set(buys.map((b) => b.requestId)).size).toBe(1);
    // another offer is another attempt
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    fire((e) => { e.onDrop('buy', 'epic', R); });
    expect(buys[3]!.requestId).not.toBe(buys[0]!.requestId);
  });

  it('a definite refusal drops the id: the next attempt sends a new one', async () => {
    render();
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await settle({ status: 'error', reason: 'sold_out' });
    expect(fake().calls.at(-1)).toBe('buySettled:false');
    expect(live()).toBe('Sold out');
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    fire((e) => { e.onDrop('buy', 'rare', R); });
    expect(buys).toHaveLength(3);
    // sold_out, then ok: each answer spent its id
    expect(new Set(buys.map((b) => b.requestId)).size).toBe(3);
  });

  it('price_changed returns the pack, shows the new price from props, and announces it', async () => {
    render();
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await settle({ status: 'error', reason: 'price_changed' });
    expect(fake().calls.at(-1)).toBe('buySettled:false');
    // the parent re-renders with the server's new quote
    render({ offers: OFFERS.map((o) => (o.offerId === 'rare' ? { ...o, price: 250 } : o)) });
    expect(live()).toBe('The price changed. It is now 250 Aether');
    expect(shelfItem('rare').textContent).toContain('250 Aether');
    expect(fake().calls).toContain('setShelf:rare,epic');
    fire((e) => { e.onPickUp('shelf', 'rare'); });
    expect(document.querySelector('.pks-line-words')?.textContent).toBe('250 Aether');
    // a later price move, with no purchase, says nothing new
    render({ offers: OFFERS.map((o) => (o.offerId === 'rare' ? { ...o, price: 300 } : o)) });
    expect(live()).toBe('The price changed. It is now 250 Aether');
  });

  it('price_changed after the parent already sent the new quote announces it at once; a vanished offer says so', async () => {
    render();
    fire((e) => { e.onDrop('buy', 'rare', R); });
    render({ offers: OFFERS.map((o) => (o.offerId === 'rare' ? { ...o, price: 250 } : o)) });
    expect(live()).toBe('');
    await settle({ status: 'error', reason: 'price_changed' });
    expect(live()).toBe('The price changed. It is now 250 Aether');
    fire((e) => { e.onDrop('buy', 'epic', R); });
    render({ offers: OFFERS.filter((o) => o.offerId !== 'epic') });
    await settle({ status: 'error', reason: 'price_changed' });
    expect(live()).toBe('The price changed');
  });

  it('insufficient announces how much is missing and leaves the wallet unchanged', async () => {
    render();
    const handBefore = handLabels();
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await settle({ status: 'error', reason: 'insufficient', aether: 150 });
    expect(fake().calls.at(-1)).toBe('buySettled:false');
    expect(live()).toBe('Need 50 more Aether');
    expect(balance()).toBe('1000 Aether');
    expect(fake().calls.some((c) => c.startsWith('payAether'))).toBe(false);
    expect(handLabels()).toEqual(handBefore);
    // a carried pack the wallet cannot cover says so at the line
    render({ aether: 150 });
    fire((e) => { e.onPickUp('shelf', 'rare'); });
    expect(document.querySelector('.pks-line-words')?.textContent).toBe('Need 50 more Aether');
  });

  it('a guest outcome returns the pack and changes nothing in the hand', async () => {
    render();
    fire((e) => { e.onDrop('buy', 'rare', R); });
    const handCalls = fake().calls.filter((c) => c.startsWith('setHand')).length;
    await settle({ status: 'error', reason: 'guest' });
    expect(fake().calls.at(-1)).toBe('buySettled:false');
    expect(live()).toBe('Sign in to buy packs');
    expect(fake().calls.filter((c) => c.startsWith('setHand'))).toHaveLength(handCalls);
    expect(handLabels()).toEqual(['Rare Pack, Open']);
    expect(balance()).toBe('1000 Aether');
  });

  describe('playing a hand pack', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    const opener = (): Element | null => document.querySelector('[data-testid="fake-opener"]');

    it('waits for the pack to travel, then hides the scene and mounts PackOpener with that pack first and the rest of the hand after it', () => {
      render({ hand: [owned('h1'), owned('h2', 'Epic Pack'), owned('h3')] });
      fire((e) => { e.onPickUp('hand', 'h2'); e.onDrop('play', 'h2', R); });
      expect(opener()).toBeNull();
      expect(fake().calls.some((c) => c.startsWith('visible:'))).toBe(false);
      act(() => { vi.advanceTimersByTime(SHOP_PLAY_TRAVEL_MS - 1); });
      expect(opener()).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      expect(fake().calls.at(-1)).toBe('visible:false:200');
      expect(opener()?.getAttribute('data-queue')).toBe('h2,h1,h3');
      expect(openerProps!.open).toBe(opens);
      expect(openerProps!.entryFadeMs).toBe(200);
    });

    it('a second play during the wait is ignored', () => {
      render({ hand: [owned('h1'), owned('h2', 'Epic Pack'), owned('h3')] });
      fire((e) => { e.onDrop('play', 'h2', R); });
      fire((e) => { e.onDrop('play', 'h3', R); });
      act(() => { vi.advanceTimersByTime(SHOP_PLAY_TRAVEL_MS * 3); });
      expect(opener()?.getAttribute('data-queue')).toBe('h2,h1,h3');
      expect(fake().calls.filter((c) => c === 'visible:false:200')).toHaveLength(1);
    });

    it('on close of the opener the hand is updated first, then the scene is shown', () => {
      render({ hand: [owned('h1'), owned('h2', 'Epic Pack'), owned('h3')] });
      fire((e) => { e.onDrop('play', 'h2', R); });
      act(() => { vi.advanceTimersByTime(SHOP_PLAY_TRAVEL_MS); });
      // the opener opens h2 and h1 (Open next), then closes
      act(() => {
        openerProps!.onOpened!({ packId: 'h2', pack: look('epic', 'Epic Pack'), cards: [] });
        openerProps!.onOpened!({ packId: 'h1', pack: look('rare', 'Rare Pack'), cards: [] });
      });
      const before = fake().calls.length;
      act(() => { openerProps!.onClose!(); });
      expect(fake().calls.slice(before, before + 2)).toEqual(['setHand:h3', 'visible:true:200']);
      act(() => { openerProps!.onClosed!(); });
      expect(fake().calls.filter((c) => c === 'visible:true:200')).toHaveLength(1);
      expect(opener()).toBeNull();
      expect(handLabels()).toEqual(['Rare Pack, Open']);
    });

    it('a play from a button or the hand item (no drag) hides the scene and mounts the opener at once', () => {
      render({ hand: [owned('h1'), owned('h2', 'Epic Pack')] });
      click(btns('Rare Pack, Open')[0]);
      expect(fake().calls.at(-1)).toBe('visible:false:200');
      expect(opener()?.getAttribute('data-queue')).toBe('h1,h2');
      expect(fake().calls).not.toContain('input:false');
    });

    it('while the pack travels the shop is busy: input is off, Buy and a second Open do nothing, then input returns on close', () => {
      render({ hand: [owned('h1'), owned('h2', 'Epic Pack')] });
      fire((e) => { e.onDrop('play', 'h2', R); });
      expect(fake().calls.at(-1)).toBe('input:false');
      // a Buy press (the tag's button) and a second Open press
      click(shelfItem('epic'));
      click(btn('Buy for 500 Aether'));
      expect(buys).toHaveLength(0);
      click(btns('Rare Pack, Open')[0]);
      fire((e) => { e.onPickUp('shelf', 'rare'); e.onDrop('buy', 'rare', R); });
      expect(buys).toHaveLength(0);
      expect(fake().calls.at(-1)).toBe('buySettled:false');
      act(() => { vi.advanceTimersByTime(SHOP_PLAY_TRAVEL_MS); });
      expect(opener()?.getAttribute('data-queue')).toBe('h2,h1');
      const before = fake().calls.length;
      act(() => { openerProps!.onClose!(); openerProps!.onClosed!(); });
      expect(fake().calls.slice(before)).toContain('input:true');
    });

    it('on close, focus returns to the played hand item if it is still in the hand, else to the dialog', () => {
      render({ hand: [owned('h1'), owned('h2', 'Epic Pack')] });
      click(btns('Rare Pack, Open')[0]);
      act(() => { openerProps!.onClose!(); });
      expect(document.activeElement?.getAttribute('data-pack')).toBe('h1');
      act(() => { openerProps!.onClosed!(); });
      click(btns('Epic Pack, Open')[0]);
      act(() => { openerProps!.onOpened!({ packId: 'h2', pack: look('epic', 'Epic Pack'), cards: [] }); openerProps!.onClose!(); openerProps!.onClosed!(); });
      expect(document.activeElement).toBe(document.querySelector('.pks'));
    });

    it('the way back is a crossfade: the shop rises as the opener starts to leave, and the opener unmounts only when its fade is done', () => {
      render({ hand: [owned('h1'), owned('h2', 'Epic Pack')] });
      click(btns('Rare Pack, Open')[0]);
      expect(openerProps!.exitFadeMs).toBe(200);
      expect(document.querySelector('.pks')!.classList.contains('pks-away')).toBe(true);
      const before = fake().calls.length;
      act(() => { openerProps!.onClose!(); });
      // the shop comes back now: its words and the scene rise while the opener fades out over it
      expect(document.querySelector('.pks')!.classList.contains('pks-away')).toBe(false);
      expect(fake().calls.slice(before)).toEqual(['setHand:h1,h2', 'visible:true:200']);
      expect(opener()).not.toBeNull();
      // nothing can be played or picked up until the opener has gone
      click(btns('Epic Pack, Open')[0]);
      expect(opener()?.getAttribute('data-queue')).toBe('h1,h2');
      act(() => { openerProps!.onClosed!(); });
      expect(opener()).toBeNull();
      expect(fake().calls.slice(before)).toEqual(['setHand:h1,h2', 'visible:true:200', 'input:true']);
    });

    it('unmounting during the wait leaves no timer firing', () => {
      render({ hand: [owned('h1'), owned('h2', 'Epic Pack')] });
      fire((e) => { e.onDrop('play', 'h2', R); });
      const pending = vi.getTimerCount();
      const calls = fake().calls;
      m!.unmount(); m = null;
      expect(vi.getTimerCount()).toBeLessThan(pending);
      act(() => { vi.advanceTimersByTime(SHOP_PLAY_TRAVEL_MS * 2); });
      expect(calls.some((c) => c === 'visible:false:200')).toBe(false);
    });
  });

  it('keyboard: Enter selects, Enter on Buy purchases; Escape does nothing while a purchase is pending', async () => {
    const onClose = vi.fn();
    render({ onClose });
    // focus looks at the pack (scrolling it onto the pedestal) and Enter (a button's click) selects it
    act(() => { shelfItem('epic').focus(); });
    expect(fake().calls.at(-1)).toBe('scrollBy:1');
    expect(document.querySelector('[data-testid="pks-tag"]')?.textContent).toContain('500 Aether');
    expect(btn('Buy for 500 Aether')).toBeUndefined();
    click(shelfItem('epic'));
    const buyBtn = btn('Buy for 500 Aether');
    expect(buyBtn).toBeTruthy();
    expect(document.activeElement).toBe(buyBtn);
    // Enter on Buy: the purchase, with the scene's input held until it answers
    click(buyBtn);
    expect(buys.map((b) => b.offerId)).toEqual(['epic']);
    expect(fake().calls.at(-1)).toBe('input:false');
    click(buyBtn);
    expect(buys).toHaveLength(1);
    key('Escape');
    expect(onClose).not.toHaveBeenCalled();
    const before = fake().calls.length;
    await settle({ status: 'ok', packs: [owned('n1', 'Epic Pack')], aether: 500 });
    const after = fake().calls.slice(before);
    expect(after).toContain('input:true');
    expect(after).toContain('payAether:epic');
    expect(after.some((c) => c.startsWith('buySettled'))).toBe(false);
    expect(after).toContain('setHand:h1,n1');
    expect(live()).toBe('Bought Epic Pack');
    expect(document.activeElement).toBe(shelfItem('epic'));
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the first mount plays the entrance once: the words start away (pks-enter) and are released two frames later; never under reduced motion', async () => {
    render();
    const root = document.querySelector('.pks')!;
    expect(root.classList.contains('pks-enter')).toBe(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(root.classList.contains('pks-enter')).toBe(false);
    m!.unmount(); m = null;
    render({ reducedMotion: true });
    expect(document.querySelector('.pks')!.classList.contains('pks-enter')).toBe(false);
    expect(document.querySelector('.pks')!.classList.contains('pks-still')).toBe(true);
  });

  it('reduced motion renders the grid with Buy and Open buttons and no scene', async () => {
    render({ reducedMotion: true, hand: [owned('h1'), owned('h2', 'Epic Pack')] });
    expect(fakes).toHaveLength(0);
    expect(document.querySelector('.pks-fx')).toBeNull();
    expect(btn('Buy for 200 Aether')).toBeTruthy();
    expect(btn('Buy for 500 Aether')).toBeTruthy();
    expect(btns('Open')).toHaveLength(2);
    click(btn('Buy for 200 Aether'));
    expect(buys.map((b) => b.offerId)).toEqual(['rare']);
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    expect(btns('Open')).toHaveLength(3);
    expect(balance()).toBe('800 Aether');
    // a box on its own shelf
    click(btn('Boxes'));
    expect(btn('Buy for 1000 Aether')!.getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).toContain('Need 200 more Aether');
    click(btn('Buy for 1000 Aether'));
    expect(buys).toHaveLength(1);
    click(btns('Open')[1]);
    expect(document.querySelector('[data-testid="fake-opener"]')?.getAttribute('data-queue')).toBe('h2,h1,n1');
  });

  it('an empty shelf and an empty hand render without throwing; a hand of 30 announces 30 packs', () => {
    render({ shelves: [], offers: [], hand: [] });
    expect(document.body.textContent).toContain('Nothing on this shelf');
    expect(document.body.textContent).toContain('Your hand, 0 packs');
    expect(fake().calls.slice(0, 3)).toEqual(['setShelf:', 'setHand:', 'setAffordable:']);
    const thirty = Array.from({ length: 30 }, (_, i) => owned('p' + i));
    render({ shelves: [], offers: [], hand: thirty });
    expect(document.body.textContent).toContain('Your hand, 30 packs');
    expect(handLabels()).toHaveLength(30);
    expect(fake().calls).toContain('setHand:' + thirty.map((p) => p.packId).join(','));
  });

  it('the wallet rolls down once, by the stream, even when the parent sends the new balance mid-stream', async () => {
    holdStream = true;
    render();
    tallyTargets.length = 0; // (the mount's own target, the starting balance)
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    act(() => { stream!(0.25, false); });
    render({ aether: 800, hand: [owned('h1'), owned('n1')] }); // the caller updates its own balance on the answer
    act(() => { stream!(0.5, false); stream!(0.75, false); });
    act(() => { stream!(1, true); });
    const t = [...tallyTargets];
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeLessThanOrEqual(t[i - 1]!);
    expect(t).toEqual([950, 900, 850, 800]);
  });

  it('a scene torn down mid-stream (reduced motion turns on) finishes the stream: later balances reach the counter', async () => {
    holdStream = true;
    render();
    tallyTargets.length = 0;
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    act(() => { stream!(0.5, false); });
    expect(tallyTargets).toEqual([900]);
    render({ reducedMotion: true }); // the scene is destroyed; its flows never report done
    expect(fake().calls.at(-1)).toBe('destroy');
    expect(tallyTargets.at(-1)).toBe(800); // the counter lands on the answered balance
    act(() => { stream!(1, true); }); // a stale callback, were one to come, changes nothing
    expect(tallyTargets.at(-1)).toBe(800);
    render({ reducedMotion: true, aether: 650 });
    expect(tallyTargets.at(-1)).toBe(650);
    expect(balance()).toBe('650 Aether');
  });

  it('a teardown mid-stream lands on a balance the parent sent during the stream', async () => {
    holdStream = true;
    render();
    tallyTargets.length = 0;
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    act(() => { stream!(0.25, false); });
    render({ aether: 790 }); // deferred while the stream runs
    render({ aether: 790, reducedMotion: true });
    expect(tallyTargets).toEqual([950, 790]);
  });

  it('a parent balance that lands before the answer waits for the stream', async () => {
    holdStream = true;
    render();
    tallyTargets.length = 0; // (the mount's own target, the starting balance)
    fire((e) => { e.onDrop('buy', 'rare', R); });
    render({ aether: 800 });
    expect(tallyTargets).toEqual([]); // no roll yet: the stream will carry it
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    act(() => { stream!(0.5, false); stream!(1, true); });
    expect(tallyTargets).toEqual([900, 800]);
    // a later change with no stream in flight still moves the counter
    render({ aether: 1200 });
    expect(tallyTargets.at(-1)).toBe(1200);
  });

  it('two identical outcomes in a row are both spoken: the region empties when a purchase starts', async () => {
    render();
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await settle({ status: 'ok', packs: [owned('n1')], aether: 800 });
    expect(live()).toBe('Bought Rare Pack');
    fire((e) => { e.onDrop('buy', 'rare', R); });
    expect(live()).toBe('');
    await settle({ status: 'ok', packs: [owned('n2')], aether: 600 });
    expect(live()).toBe('Bought Rare Pack');
    fire((e) => { e.onDrop('buy', 'rare', R); });
    await fail();
    fire((e) => { e.onDrop('buy', 'rare', R); });
    expect(live()).toBe('');
    await fail();
    expect(live()).toBe('Could not buy the pack. Try again.');
  });

  it("Escape is the shop's own key: it closes the shop and the game's Esc listener (Settings) never hears it", () => {
    const onClose = vi.fn();
    const appEsc = vi.fn();
    const game = (e: KeyboardEvent): void => { if (e.key === 'Escape') appEsc(); };
    window.addEventListener('keydown', game);
    try {
      render({ onClose });
      key('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(appEsc).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', game); }
  });

  it('keyboard: a failed buy keeps focus on the Buy button (never disabled under it), so the keys still work', async () => {
    render();
    act(() => { shelfItem('rare').focus(); });
    click(shelfItem('rare'));
    const buyBtn = btn('Buy for 200 Aether')!;
    expect(document.activeElement).toBe(buyBtn);
    click(buyBtn);
    expect(buyBtn.disabled).toBe(false);
    expect(buyBtn.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(buyBtn);
    await fail();
    expect(document.activeElement).toBe(buyBtn);
    expect(buyBtn.getAttribute('aria-disabled')).toBe('false');
    // the dialog's arrow keys still reach the scene
    act(() => { buyBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(fake().calls.at(-1)).toBe('scrollBy:1');
    // and a retry from the same button sends the same request id
    click(buyBtn);
    expect(buys.map((b) => b.requestId)).toEqual([buys[0]!.requestId, buys[0]!.requestId]);
  });

  it('the rack starts on the middle offer: keyboard focus scrolls from there', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => offer(id, id.toUpperCase() + ' Pack', 100));
    render({ offers: five });
    act(() => { shelfItem('a').focus(); });
    expect(fake().calls.at(-1)).toBe('scrollBy:-2');
    act(() => { shelfItem('e').focus(); });
    expect(fake().calls.at(-1)).toBe('scrollBy:4');
  });
});
