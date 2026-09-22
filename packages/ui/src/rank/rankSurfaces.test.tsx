// @vitest-environment jsdom
/**
 * The SHARED rank presentation the other surfaces mount — the Title's Play card plate, the Career card, the
 * Rankings rows — pinned once here: the crest is the in-run hero frame with a division plate, the bar prints
 * the one helper's label / points / gate line, and the Rankings ordering is division-then-points with legacy
 * (rank-less) rows kept behind, untouched. The crest's ring is the hero-select ceremony's heroportrait.png,
 * painted by CSS — so the DOM carries the disc and the plate only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../renderedText.mount';

// `Rankings` pulls the store (→ pixi), which probes a 2D canvas at import; jsdom has none (see Career.test).
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

import { RankBar, RankCrest } from './RankBar';
import { sortRankAware } from '../Rankings';
import type { PlayerRow } from '../remoteBoards';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

describe('RankCrest', () => {
  it('is the medal disc seated in the game\'s portrait ring (.portring > .hero > .f > img.heroimg) with a composited division plate', () => {
    ui = mount(<RankCrest divisionIndex={7} size="big" />);
    const crest = ui.container.querySelector('.rankcrest')!;
    expect(crest.className).toContain('portring');
    expect(crest.className).toContain('rankcrest-big');
    expect(crest.className).toContain('rankcrest-gold');
    expect(crest.querySelector('.hero > .f > img.heroimg')).not.toBeNull();
    expect(crest.querySelector('.rankcrest-plate')?.textContent).toBe('II');
    expect(crest.getAttribute('aria-hidden')).toBe('true');
  });
  it('I / II / III plates, and one art file per medal', () => {
    ui = mount(<><RankCrest divisionIndex={0} /><RankCrest divisionIndex={1} /><RankCrest divisionIndex={2} /><RankCrest divisionIndex={17} /></>);
    expect([...ui.container.querySelectorAll('.rankcrest-plate')].map((p) => p.textContent)).toEqual(['I', 'II', 'III', 'III']);
    const srcs = [...ui.container.querySelectorAll<HTMLImageElement>('img.heroimg')].map((i) => i.getAttribute('src') ?? '');
    expect(srcs[0]).toMatch(/bronze/);
    expect(srcs[3]).toMatch(/ascendant/);
  });
});

describe('RankBar', () => {
  it('prints the label, the points and a scaleX fill; the gate line only on the gate and only when asked', () => {
    ui = mount(<RankBar position={{ divisionIndex: 7, points: 60 }} size="mini" />);
    const bar = ui.container.querySelector('.rankbar')!;
    expect(bar.className).toContain('rankbar-mini');
    expect(bar.className).toContain('rankbar-gold');
    expect(bar.querySelector('.rankbar-label')?.textContent).toBe('Gold II');
    expect(bar.querySelector('.rankbar-points')?.textContent).toBe('60 / 100');
    expect((bar.querySelector('.rankbar-fill') as HTMLElement).style.transform).toBe('scaleX(0.6)');
    expect(bar.querySelector('.rankbar-gate')).toBeNull();
    expect(bar.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('60');

    ui.render(<RankBar position={{ divisionIndex: 8, points: 100 }} size="big" caption="900 MMR" />);
    const gate = ui.container.querySelector('.rankbar')!;
    expect(gate.className).toContain('on-gate');
    expect(gate.querySelector('.rankbar-gate')?.textContent).toBe('Promotion game ready. Finish 1st to advance.');
    expect(gate.querySelector('.rankbar-caption')?.textContent).toBe('900 MMR');

    ui.render(<RankBar position={{ divisionIndex: 8, points: 100 }} showGate={false} />);
    expect(ui.container.querySelector('.rankbar-gate')).toBeNull();
    expect(ui.container.querySelector('.rankbar')!.className).toContain('on-gate'); // the tip still lights
  });
  it('prints the DEMOTION-game line only from the profile flag — a 0 alone is ambiguous — and names the division at stake', () => {
    ui = mount(<RankBar position={{ divisionIndex: 6, points: 0 }} size="mini" />);
    expect(ui.container.querySelector('.rankbar-gate')).toBeNull();
    ui.render(<RankBar position={{ divisionIndex: 6, points: 0 }} size="mini" demotionReady />);
    expect(ui.container.querySelector('.rankbar-gate')?.textContent).toBe('Demotion game. Finish top 4 to stay in Gold I.');
    ui.render(<RankBar position={{ divisionIndex: 7, points: 0 }} size="mini" demotionReady />);
    expect(ui.container.querySelector('.rankbar-gate')?.textContent, 'every division has the gate now (owner 2026-09-21)').toBe('Demotion game. Finish top 4 to stay in Gold II.');
    expect(ui.container.querySelector('.rankbar-gate')!.className).toContain('demo');
    expect(ui.container.querySelector('.rankbar')!.className).not.toContain('on-gate'); // no endpoint glow at 0
  });
  it('the stack layout (Career card) reads crest → bar → points → NAME → caption', () => {
    ui = mount(<RankBar position={{ divisionIndex: 7, points: 60 }} size="big" layout="stack" caption="760 MMR" />);
    const bar = ui.container.querySelector('.rankbar')!;
    expect(bar.className).toContain('rankbar-stack');
    const order = ['.rankcrest', '.rankbar-track', '.rankbar-points', '.rankbar-label', '.rankbar-caption'].map((sel) => bar.querySelector(sel)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & 4, `${i}`).toBe(4);
    expect(bar.querySelector('.rankbar-label')?.textContent).toBe('Gold II');
  });
  it('Ascendant III reads an uncapped RP counter over a full bar', () => {
    ui = mount(<RankBar position={{ divisionIndex: 17, points: 130 }} />);
    expect(ui.container.querySelector('.rankbar-points')?.textContent).toBe('130 RP');
    expect((ui.container.querySelector('.rankbar-fill') as HTMLElement).style.transform).toBe('scaleX(1)');
    expect(ui.container.querySelector('.rankbar-gate')).toBeNull();
  });
});

describe('Rankings ordering', () => {
  const row = (author: string, rating: number, rank?: { divisionIndex: number; points: number }): PlayerRow =>
    ({ userId: author, author, rating, gamesPlayed: 5, ...(rank ? { rank } : {}) } as PlayerRow);
  it('leaves a rank-less (legacy) list untouched', () => {
    const rows = [row('a', 900), row('b', 800)];
    expect(sortRankAware(rows)).toBe(rows);
  });
  it('sorts by division, then points, ranked rows ahead of legacy rows in their server order', () => {
    const rows = [
      row('legacy-hi', 5000),
      row('gold2-100', 700, { divisionIndex: 7, points: 100 }),
      row('gold1-0', 800, { divisionIndex: 8, points: 0 }),
      row('legacy-lo', 100),
      row('gold1-40', 840, { divisionIndex: 8, points: 40 }),
    ];
    expect(sortRankAware(rows).map((r) => r.author)).toEqual(['gold1-40', 'gold1-0', 'gold2-100', 'legacy-hi', 'legacy-lo']);
  });
});
