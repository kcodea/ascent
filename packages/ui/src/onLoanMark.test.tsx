// @vitest-environment jsdom
/**
 * FUNERAL ON LOAN — THE "ON LOAN" MARKER (owner 2026-10-13: "theres no visual distinction between a card granted by
 * funeral on loan and other cards, so players may accidentally play it and destroy it").
 *
 *   · A BORROWED card waiting in hand carries `onLoan` on its view; the body that lands on the board does not, and
 *     neither does an ordinary card. The flag rides the view, so the hand card AND its drag copy both wear it.
 *   · The Card renders the "On Loan" tag and the smoke wisps for that view, and nothing for any other.
 *   · A view that gains or loses the flag is NOT equal to its old self (or the memo would keep a stale card).
 *   · The smoke's only loop animates transform + opacity (the perf rule: no paint property in a looping animation).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import type { BoardCard } from '@game/sim';
import { Card, type CardView } from './Card';
import { cardViewEqual } from './cardViewEqual';
import { instView } from './instView';
import { mount } from './renderedText.mount';

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
  it('a borrowed card in hand does; an ordinary hand card and the landed board body do not', () => {
    expect(handView(body({ borrowed: true })).onLoan).toBe(true);
    expect(handView(body()).onLoan).toBeUndefined();
    expect(boardView(body({ borrowed: true })).onLoan).toBeUndefined();
  });

  it('the loan ending (the sim clears `borrowed` at the next turn) changes the view, so the card re-renders', () => {
    const loaned = handView(body({ borrowed: true }));
    const kept = handView(body({ borrowed: undefined }));
    expect(cardViewEqual(loaned, kept)).toBe(false);
    expect(cardViewEqual(loaned, handView(body({ borrowed: true })))).toBe(true);
  });
});

describe('On Loan — what the card shows', () => {
  it('the tag reads "On Loan" above the card, with its smoke; an ordinary card shows neither', () => {
    m.render(<Card card={handView(body({ borrowed: true }))} forceFull plated />);
    const mark = m.container.querySelector('.card.onloan .cardloan');
    expect(mark, 'the marker sits inside the loaned card').not.toBeNull();
    expect(mark!.querySelector('.cardloan-tag')!.textContent).toBe('On Loan');
    expect(mark!.querySelectorAll('.cardloan-wisp').length).toBeGreaterThan(0);
    for (const w of mark!.querySelectorAll('.cardloan-wisp')) expect(w.querySelector('.cardloan-wisp-paint')).not.toBeNull();
    // Screen readers get the consequence, never a native browser tooltip.
    expect(mark!.getAttribute('aria-label')).toContain('destroyed');
    expect(m.container.querySelector('[title]')).toBeNull();

    m.render(<div />);
    m.render(<Card card={handView(body())} forceFull plated />);
    expect(m.container.querySelector('.cardloan')).toBeNull();
    expect(m.container.querySelector('.card.onloan')).toBeNull();
  });
});

describe('On Loan — the smoke obeys the perf rule', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');
  it('the looping `loanwisp` keyframes touch transform and opacity only', () => {
    const block = /@keyframes loanwisp \{([\s\S]*?)\n\}/.exec(css);
    expect(block, 'the keyframes exist').not.toBeNull();
    const props = [...block![1]!.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) expect(['transform', 'opacity']).toContain(p);
  });
  it('the animated wisp carries no paint of its own: the gradient is on the static child', () => {
    const wisp = /\.cardloan-wisp \{([\s\S]*?)\}/.exec(css)![1]!;
    expect(wisp).not.toMatch(/background|filter|box-shadow/);
    expect(/\.cardloan-wisp-paint \{([\s\S]*?)\}/.exec(css)![1]!).toMatch(/radial-gradient/);
  });
});
