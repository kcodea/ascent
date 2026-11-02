// @vitest-environment jsdom
/**
 * DUOS — A CARD THAT COMPLETES MY TEAMMATE'S TRIPLE (owner 2026-11-02, R-DUOS-MATE-TRIPLE-01): "this is referring to when a
 * teammate has a pair, and the minion shows up in your shop. we need something that shows you can give that to your
 * teammate for a triple."
 *
 *  - `mateTripleKey` names the cards a run is one copy short of a Gild on (board + hand, non-Golden, never a spell /
 *    Ruby / noTriple), at the run's OWN Gild count (2 copies under Twin Gilding: one held is enough);
 *  - a teammate frame feeds it live (`noteMateFrame`), a new match forgets it, and my screen reads it only while it is
 *    mine (never while I watch my teammate's screen);
 *  - the Card wears `.matetrip` + teal arrows, and my own triple hint wins on an offer that completes both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import type { BoardCard } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./fx/playDef', () => ({ canPlayDefs: () => false, playDef: () => null }));

const { mount } = await import('../renderedText.mount');
const { Card } = await import('../Card');
const { instView } = await import('../instView');
const { mateTripleKey, mateTripleIds, noteLocalMateTriples, useMateTriples } = await import('./mateTriples');
const signals = await import('./duosMateSignals');
const resetDuosMateSignals = (): void => act(() => signals.resetDuosMateSignals());
const noteMateFrame = (...a: Parameters<typeof signals.noteMateFrame>): void => act(() => signals.noteMateFrame(...a));
const { useMateTripleKey } = await import('./useMateTriples');
const { useVersus } = await import('./versusStore');
const { useSpectate } = await import('./spectate');

const here = dirname(fileURLToPath(import.meta.url));
const defs = Object.values(CARD_INDEX);
const minions = defs.filter((d) => !d.spell && !d.ruby && !d.noTriple && !d.token);
const A = minions[0]!.id;
const B = minions[1]!.id;
const SPELL = defs.find((d) => d.spell)!.id;
let n = 0;
const c = (cardId: string, golden = false): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid: `u${++n}`, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden } as BoardCard;
};
const run = (board: BoardCard[], hand: BoardCard[], extra: Record<string, unknown> = {}) => ({ heroId: 'warden', board, hand, ...extra });

function setMatch(): void {
  useVersus.setState({ match: { round: 3, phase: 'shop', group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } }, raw: { seats: [] } } } } as never);
}

beforeEach(() => { resetDuosMateSignals(); setMatch(); useSpectate.setState({ teammate: false }); noteLocalMateTriples(null); });
afterEach(() => { resetDuosMateSignals(); useVersus.setState({ match: null } as never); });

describe('mateTripleKey: the cards a run is one copy short of a Gild on', () => {
  it('a pair across board and hand counts; a single copy, a Golden copy and a spell do not', () => {
    expect(mateTripleKey(run([c(A)], [c(A)]))).toBe(A);
    expect(mateTripleKey(run([c(A)], []))).toBe('');
    expect(mateTripleKey(run([c(A), c(A, true)], []))).toBe('');
    expect(mateTripleKey(run([], [c(SPELL), c(SPELL)]))).toBe('');
    expect(mateTripleKey(run([c(B), c(A)], [c(B), c(A)]))).toBe([A, B].sort().join('|'));
  });

  it('reads the run\'s own Gild count: under Twin Gilding (Gild at 2) one held copy is enough', () => {
    expect(mateTripleKey(run([c(A)], [], { runeTwinGilding: true }))).toBe(A);
  });

  it('anything that is not a run reads as none', () => {
    expect(mateTripleKey(null)).toBe('');
    expect(mateTripleKey({ board: [c(A), c(A)] })).toBe('');
    expect(mateTripleIds('').size).toBe(0);
  });
});

describe('the teammate frame feeds it live, my own screen reads it', () => {
  function Probe(): JSX.Element { return <i data-k={useMateTripleKey()} />; }
  const m = mount(<div />);
  afterEach(() => m.render(<div />));
  const key = (): string | null => m.container.querySelector('i')!.getAttribute('data-k');

  it('a frame of my teammate\'s seat lands its pairs; their next frame (the pair broken up) clears it', () => {
    m.render(<Probe />);
    noteMateFrame('p2', null, { wave: 3, phase: 'recruit', ...run([c(A), c(A)], []) }, undefined);
    m.render(<Probe />);
    expect(key()).toBe(A);
    noteMateFrame('p2', null, { wave: 3, phase: 'recruit', ...run([c(A)], []) }, undefined);
    m.render(<Probe />);
    expect(key()).toBe('');
  });

  it('an opponent seat\'s pairs never mark my shop; a new match forgets my teammate\'s', () => {
    noteMateFrame('p3', null, { wave: 3, phase: 'recruit', ...run([c(B), c(B)], []) }, undefined);
    m.render(<Probe />);
    expect(key()).toBe('');
    noteMateFrame('p2', null, { wave: 3, phase: 'recruit', ...run([c(A), c(A)], []) }, undefined);
    resetDuosMateSignals();
    m.render(<Probe />);
    expect(key()).toBe('');
    expect(useMateTriples.getState().bySeat).toEqual({});
  });

  it('while I watch my teammate\'s screen it reads none (their own triple hint shows there)', () => {
    noteMateFrame('p2', null, { wave: 3, phase: 'recruit', ...run([c(A), c(A)], []) }, undefined);
    act(() => useSpectate.setState({ teammate: true }));
    m.render(<Probe />);
    expect(key()).toBe('');
  });

  it('an unchanged frame writes nothing (no store churn per frame)', () => {
    noteMateFrame('p2', null, { wave: 3, phase: 'recruit', ...run([c(A), c(A)], []) }, undefined);
    const before = useMateTriples.getState();
    noteMateFrame('p2', null, { wave: 3, phase: 'recruit', ...run([c(A), c(A)], []) }, undefined);
    expect(useMateTriples.getState()).toBe(before);
  });
});

describe('the Card wears the teal triple hint', () => {
  const m = mount(<div />);
  afterEach(() => m.render(<div />));
  const view = () => instView(c(A), 1, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, {});

  it('mateTriple: `.matetrip` and the teal arrows; tripleReady alongside it keeps the gold hint only', () => {
    m.render(<Card card={view()} mateTriple />);
    expect(m.container.querySelector('.card')!.classList.contains('matetrip')).toBe(true);
    expect(m.container.querySelector('.triparrows.mate')).not.toBeNull();
    m.render(<Card card={view()} mateTriple tripleReady />);
    expect(m.container.querySelector('.card')!.classList.contains('matetrip')).toBe(false);
    expect(m.container.querySelector('.card')!.classList.contains('tripready')).toBe(true);
    expect(m.container.querySelector('.triparrows.mate')).toBeNull();
  });

  it('the styling animates opacity / transform only (the kwglow rule)', () => {
    const css = readFileSync(join(here, '../styles.css'), 'utf8');
    const block = css.slice(css.indexOf('/* DUOS: MY TEAMMATE\'S TRIPLE'), css.indexOf('/* (Reborn\'s rising'));
    expect(block).toContain('.card.matetrip');
    expect(block).toContain('.triparrows.mate .ta');
    expect([...block.matchAll(/animation:\s*([\w-]+)/g)].map((x) => x[1]).every((k) => k === 'kwglow' || k === 'none')).toBe(true);
  });
});
