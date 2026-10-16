// @vitest-environment jsdom
/**
 * BIG STAT BADGES (owner report 2026-10-16: "the badges got messed up for some reason when they go into the 1000's,
 * please fix"). R-BADGE-FIT-01.
 *
 * Two things went wrong together once a stat got big: the printed number (sized for three glyphs) ran wider than
 * the badge's disc, and the milestone frame art (the pink / blue / crystal tiers, intentional since 2026-09-14) was
 * fixed px, so on a small card (the Career / Recent Games / Match details strip) a board-sized frame sat on a
 * tile-sized card and overlapped the portrait and the other badge. The fix keeps the tier art and (1) steps the
 * number down by glyph count (`statFit` → `data-fit`), (2) scales every milestone px by --ccw / --ccw-board.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Card, type CardView } from './Card';
import { formatStat, statFit } from './formatStat';
import { tierOf } from './choreo/statMilestones';
import { mount } from './renderedText.mount';

/** The owner's test values: 999, 1000, 10k, 104k, 209k, 1.2M. */
const CASES: Array<{ n: number; text: string; fit: string | undefined; tier: number }> = [
  { n: 999, text: '999', fit: undefined, tier: 4 },
  { n: 1000, text: '1000', fit: '4', tier: 4 },
  { n: 10_000, text: '10000', fit: '5', tier: 6 },
  { n: 104_000, text: '104k', fit: '4', tier: 6 },
  { n: 209_000, text: '209k', fit: '4', tier: 6 },
  { n: 1_200_000, text: '1.2m', fit: '4', tier: 6 },
];

describe('big stat badges: formatting + fit bucket + milestone tier at the owner thresholds', () => {
  for (const c of CASES) {
    it(`${c.n} prints "${c.text}", fit ${c.fit ?? 'none'}, milestone tier ${c.tier}`, () => {
      expect(formatStat(c.n)).toBe(c.text);
      expect(statFit(formatStat(c.n))).toBe(c.fit);
      expect(tierOf('attack', c.n)).toBe(c.tier);
      expect(tierOf('health', c.n)).toBe(c.tier);
    });
  }

  it('the fit bucket is the glyph count, from four glyphs up (7+ shares one bucket)', () => {
    expect(statFit('7')).toBeUndefined();
    expect(statFit('95')).toBeUndefined();
    expect(statFit('174')).toBeUndefined();
    expect(statFit('99999')).toBe('5');
    expect(statFit('999.9k')).toBe('6');
    expect(statFit('-101.1k')).toBe('7');
  });
});

describe('big stat badges: the rendered card', () => {
  const m = mount(<div />);
  afterAll(() => m.unmount());
  const view = (attack: number, health: number): CardView => ({
    name: 'Test', cardId: 'ce3_seer', tribe: 'neutral', attack, health, keywords: [], text: '', tier: 1,
    baseAttack: 1, baseHealth: 1,
  } as CardView);

  it('a 104k / 209k minion keeps its milestone tier and stamps the fit bucket on both numbers', () => {
    m.render(<Card card={view(104_000, 209_000)} suppressPop />);
    const atk = m.container.querySelector<HTMLElement>('.badge.atk')!;
    const hp = m.container.querySelector<HTMLElement>('.badge.hp')!;
    expect(atk.dataset.milestone).toBe('6');
    expect(hp.dataset.milestone).toBe('6');
    expect(atk.querySelector('.value')!.textContent).toBe('104k');
    expect(atk.querySelector<HTMLElement>('.value')!.dataset.fit).toBe('4');
    expect(hp.querySelector('.value')!.textContent).toBe('209k');
    expect(hp.querySelector<HTMLElement>('.value')!.dataset.fit).toBe('4');
  });

  it('a three-glyph stat carries no fit bucket (the authored size, unchanged)', () => {
    m.render(<Card card={view(95, 174)} suppressPop />);
    for (const v of m.container.querySelectorAll<HTMLElement>('.badge > .value')) expect(v.hasAttribute('data-fit')).toBe(false);
  });
});

describe('big stat badges: the CSS contract', () => {
  const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
  const rule = (sel: string): string => {
    const i = css.indexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };

  it('every fit bucket statFit can return has a font scale', () => {
    for (const b of ['4', '5', '6', '7']) expect(css).toMatch(new RegExp(`\\.badge > \\.value\\[data-fit='${b}'\\] \\{ --sv-fit: 0\\.\\d+; \\}`));
  });

  it('every badge number font multiplies the fit scale', () => {
    expect(rule('.badge > .value')).toContain('var(--sv-fit, 1)');
    expect(rule('.card.compact .badge > .value')).toContain('var(--sv-fit, 1)');
    expect(rule(".card.compact .badge:not([data-milestone='0']) > .value")).toMatch(/var\(--ms-k, 1\) \* var\(--sv-fit, 1\)/);
    expect(rule(".badge:not([data-milestone='0']) > .value")).toMatch(/var\(--ms-k, 1\) \* var\(--sv-fit, 1\)/);
  });

  it('the milestone frame, glow and tint scale with the card (--ms-k), 1 on the board card', () => {
    expect(css).toMatch(/--ccw-board: var\(--ccw\);/);
    expect(css).toMatch(/\.badge \{ --ms-k: calc\(var\(--ccw\) \/ var\(--ccw-board, var\(--ccw\)\)\); \}/);
    for (const sel of ['.badge > .msframe', '.badge > .msglow', '.badge > .mstint']) {
      expect(rule(sel)).toMatch(/width: calc\(60px \* var\(--msf-scale, 1\)[^;]*\* var\(--ms-k, 1\)\);/);
    }
  });

  it('no looping animation was added to the badge (perf rule)', () => {
    for (const sel of ['.badge > .msframe', '.badge > .msglow', '.badge > .mstint']) expect(rule(sel)).not.toMatch(/animation/);
  });
});
