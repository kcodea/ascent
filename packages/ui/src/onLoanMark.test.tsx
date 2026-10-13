// @vitest-environment jsdom
/**
 * FUNERAL ON LOAN — THE "ON LOAN" MARKER (owner 2026-10-13: "theres no visual distinction between a card granted by
 * funeral on loan and other cards, so players may accidentally play it and destroy it").
 *
 *   · A BORROWED card waiting in hand carries `onLoanKey` on its view; the body that lands on the board does not,
 *     and neither does an ordinary card. The key rides the view, so the hand card AND its drag copy both wear it.
 *   · The Card prints "On Loan" above the card as plain text with a dark drop shadow (no pill), stamps the
 *     `data-on-loan` hook, and draws NO smoke of its own.
 *   · The smoke is the owner-authored `funeral-on-loan` Pixi loop: one looping, card-following play per loaned
 *     card (capped), retired the moment the loan ends.
 *   · A view that gains or loses the key is NOT equal to its old self (or the memo would keep a stale card).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import type { BoardCard } from '@game/sim';
import { Card, type CardView } from './Card';
import { cardViewEqual } from './cardViewEqual';
import { instView } from './instView';
import { mount } from './renderedText.mount';

let plays: { id: string; loop: boolean; follows: boolean }[] = [];
const disposers: ReturnType<typeof vi.fn>[] = [];
vi.mock('./fx/playDef', () => ({
  canPlayDefs: () => true,
  playDef: (id: string, _anchors: unknown, opts: { loop?: boolean; follow?: unknown } = {}) => {
    plays.push({ id, loop: !!opts.loop, follows: typeof opts.follow === 'function' });
    const d = vi.fn();
    disposers.push(d);
    return d;
  },
}));

const here = dirname(fileURLToPath(import.meta.url));
const m = mount(<div />);
afterEach(() => { m.render(<div />); });

const ECHO = 'dm_shepherd'; // an Echo minion: what Funeral on Loan Discovers
const body = (over: Partial<BoardCard> = {}): BoardCard => {
  const def = CARD_INDEX[ECHO]!;
  return { uid: 'h1', cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false, ...over } as BoardCard;
};
const handView = (c: BoardCard): CardView => instView(c, 1, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { inHand: true });
const boardView = (c: BoardCard): CardView => instView(c, 1, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { onBoard: true });

describe('On Loan — which cards carry the marker', () => {
  it('a borrowed card in hand does (keyed by its uid); an ordinary hand card and the landed board body do not', () => {
    expect(handView(body({ borrowed: true })).onLoanKey).toBe('h1');
    expect(handView(body()).onLoanKey).toBeUndefined();
    expect(boardView(body({ borrowed: true })).onLoanKey).toBeUndefined();
  });

  it('the loan ending (the sim clears `borrowed` at the next turn) changes the view, so the card re-renders', () => {
    const loaned = handView(body({ borrowed: true }));
    const kept = handView(body({ borrowed: undefined }));
    expect(cardViewEqual(loaned, kept)).toBe(false);
    expect(cardViewEqual(loaned, handView(body({ borrowed: true })))).toBe(true);
  });
});

describe('On Loan — what the card shows', () => {
  it('prints "On Loan" above the card and stamps the smoke hook; an ordinary card shows neither', () => {
    m.render(<Card card={handView(body({ borrowed: true }))} forceFull plated />);
    const card = m.container.querySelector<HTMLElement>('.card.onloan');
    expect(card, 'the loaned card is marked').not.toBeNull();
    expect(card!.dataset.onLoan, 'the hook the smoke loop follows').toBe('h1');
    const mark = card!.querySelector('.cardloan');
    expect(mark!.querySelector('.cardloan-tag')!.textContent).toBe('On Loan');
    // The smoke is the Pixi loop, never DOM: the mark holds the text and nothing else.
    expect(mark!.children.length).toBe(1);
    // Screen readers get the consequence, never a native browser tooltip.
    expect(mark!.getAttribute('aria-label')).toContain('destroyed');
    expect(m.container.querySelector('[title]')).toBeNull();

    m.render(<div />);
    m.render(<Card card={handView(body())} forceFull plated />);
    expect(m.container.querySelector('.cardloan')).toBeNull();
    expect(m.container.querySelector('[data-on-loan]')).toBeNull();
  });

  it('the text is plain: a dark drop shadow, no pill (owner 2026-10-13), and nothing in it animates', () => {
    const css = readFileSync(join(here, 'styles.css'), 'utf8');
    const tag = /\n\.cardloan-tag \{([\s\S]*?)\}/.exec(css)![1]!;
    expect(tag).toMatch(/text-shadow:[^;]*rgba\(0, 0, 0/);
    expect(tag).not.toMatch(/background|border|padding|box-shadow|animation/);
    // The CSS smoke of the first passes is gone for good: the effect is the def.
    expect(css).not.toMatch(/cardloan-wisp|cardloan-haze|@keyframes loan/);
  });
});

describe('On Loan — the smoke is the owner-authored Pixi loop', () => {
  beforeEach(() => { plays = []; disposers.length = 0; });
  afterEach(() => { for (const el of document.querySelectorAll('[data-test-loan]')) el.remove(); });

  /** A mounted card element carrying the `data-on-loan` hook the smoke binds to. */
  const stubCard = (key: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('data-on-loan', key);
    el.setAttribute('data-test-loan', '');
    el.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 140, right: 110, bottom: 150, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(el);
    return el;
  };

  it('the def it plays is committed', () => {
    const def = JSON.parse(readFileSync(join(here, 'fx/defs/funeral-on-loan.json'), 'utf8')) as { id: string; layers: unknown[] };
    expect(existsSync(join(here, 'fx/defs/funeral-on-loan.json'))).toBe(true);
    expect(def.id).toBe('funeral-on-loan');
    expect(def.layers.length).toBeGreaterThan(0);
  });

  it('one looping, card-following play per loaned card, and none for a key with no card', async () => {
    const { useOnLoanFx } = await import('./useOnLoanFx');
    stubCard('a');
    const Harness = ({ keys }: { keys: string[] }): null => { useOnLoanFx(keys); return null; };
    const h = mount(<Harness keys={['a']} />);
    expect(plays).toEqual([{ id: 'funeral-on-loan', loop: true, follows: true }]);
    plays = [];
    h.render(<Harness keys={['a', 'ghost']} />);
    expect(plays, 'a key with no card in the DOM starts nothing').toEqual([]);
    h.unmount();
  });

  it('retires the loop the moment the loan ends or the board is covered, and on unmount: no leaked player', async () => {
    const { useOnLoanFx } = await import('./useOnLoanFx');
    stubCard('a');
    const Harness = ({ keys }: { keys: string[] }): null => { useOnLoanFx(keys); return null; };
    const h = mount(<Harness keys={['a']} />);
    const [da] = disposers;
    h.render(<Harness keys={[]} />); // the turn rolled over, the card was played, or an overlay took the screen
    expect(da, 'the loop is retired').toHaveBeenCalledTimes(1);
    h.render(<Harness keys={['a']} />); // still on loan when the overlay closes: it smokes again
    expect(plays.length).toBe(2);
    h.unmount();
    expect(disposers[1], 'unmount tears the live loop down').toHaveBeenCalledTimes(1);
  });

  it('caps the loops alive at once, so a hand of loaned cards cannot run away with the particle count', async () => {
    const { useOnLoanFx, ON_LOAN_FX_CAP } = await import('./useOnLoanFx');
    const keys = ['a', 'b', 'c', 'd'];
    for (const k of keys) stubCard(k);
    const Harness = ({ ks }: { ks: string[] }): null => { useOnLoanFx(ks); return null; };
    const h = mount(<Harness ks={keys} />);
    expect(plays.length).toBe(ON_LOAN_FX_CAP);
    h.unmount();
  });

  it('a card mid-drag hides its smoke for that frame without ending the loop', async () => {
    const { useOnLoanFx } = await import('./useOnLoanFx');
    const el = stubCard('a');
    let follow: (() => { x: number; y: number } | null) | undefined;
    const fx = await import('./fx/playDef');
    const spy = vi.spyOn(fx, 'playDef').mockImplementation((_id, _a, opts) => { follow = opts?.follow as typeof follow; return vi.fn(); });
    const Harness = (): null => { useOnLoanFx(['a']); return null; };
    const h = mount(<Harness />);
    expect(follow!()).toEqual({ x: 60, y: 80 });
    el.classList.add('dragsrc');
    expect(follow!()).toBeNull();
    h.unmount();
    spy.mockRestore();
  });
});
