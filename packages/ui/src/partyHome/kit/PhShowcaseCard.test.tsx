// @vitest-environment jsdom
/**
 * THE SHOWCASE CARD (party home kit): the landscape player card that replaced the tall flag banner. Pins what the card prints
 * (name, title, crest, rank label, points, bar), that mirroring flips only the art, that a long name stays one line, that
 * nothing carries a native tooltip, and that an open seat (the ghost) shows its own content under its label.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../../renderedText.mount';

// TitleBadge reads the progression store; guard the pixi import chain's canvas probe as rankSurfaces.test.tsx does.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

import { nameEm, nameFontCqw, PHS_NAME_FLOOR_CQW, PHS_NAME_MAX_CQW, PHS_RANK_MAX_CQW, PhShowcaseCard, PhShowcaseGhost, rankLabelCqw } from './PhShowcaseCard';
import { pointsText, rankLabel } from '../../rank/rankFormat';
import { medalKey } from '../../rank/types';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const root = (): HTMLElement => ui!.container.firstElementChild as HTMLElement;

describe('PhShowcaseCard', () => {
  it('renders name, title badge, crest, rank label and points', () => {
    ui = mount(<PhShowcaseCard size="full" label="Mike. Options" name="Mike" titleId="title_ironbeard" rank={{ divisionIndex: 7, points: 40 }} />);
    const el = root();
    expect(el.className).toContain('phs-card');
    expect(el.className).toContain('phs-full');
    expect(el.querySelector('.phs-pname')?.textContent).toBe('Mike');
    expect(el.querySelector('.titlebadge')).not.toBeNull();
    expect(el.querySelector('.rankcrest')).not.toBeNull();
    expect(el.textContent).toContain(rankLabel(7));
    expect(el.textContent).toContain(pointsText({ divisionIndex: 7, points: 40 }));
    expect((el.querySelector('.phs-bar > i') as HTMLElement).style.width).toBe('40%');
    expect(el.querySelector('button.phs-press')).not.toBeNull();
  });

  it('the bar wears the medal tint class Career uses (owner 2026-11-23: "Match Career")', () => {
    for (const divisionIndex of [0, 3, 7, 10, 13, 16]) {
      ui?.unmount();
      ui = mount(<PhShowcaseCard size="full" label="Mike" name="Mike" rank={{ divisionIndex, points: 10 }} />);
      expect(root().querySelector('.phs-bar')?.classList.contains(`rankbar-${medalKey(divisionIndex)}`)).toBe(true);
    }
  });

  it('null rank reads Unranked with no bar', () => {
    ui = mount(<PhShowcaseCard size="half" label="Rook" name="Rook" fallbackLine="Level 12" rank={null} />);
    const el = root();
    expect(el.textContent).toContain('Unranked');
    expect(el.textContent).toContain('Level 12');
    expect(el.querySelector('.phs-bar')).toBeNull();
  });

  it('no title and no fallback keeps the title line with a non-breaking-space spacer', () => {
    ui = mount(<PhShowcaseCard size="half" label="Rook" name="Rook" rank={null} />);
    expect(root().querySelector('.phs-title')?.textContent).toBe('\u00A0');
  });

  it('mirrored only flips the art', () => {
    ui = mount(<PhShowcaseCard size="half" label="Rook" name="Rook" art="/rook.webp" rank={null} rival mirrored />);
    const el = root();
    expect(el.className).toContain('phs-mirrored');
    expect(el.className).toContain('phs-rival');
    const name = el.querySelector('.phs-pname') as HTMLElement;
    expect(name).not.toBeNull();
    expect(name.style.transform).toBe('');
    const img = el.querySelector('.phs-art img') as HTMLImageElement;
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(img.getAttribute('draggable')).toBe('false');
  });

  it('compact keeps a long name on one line', () => {
    const long = 'X'.repeat(40);
    ui = mount(<PhShowcaseCard size="compact" label={long} name={long} rank={{ divisionIndex: 2, points: 10 }} />);
    const el = root();
    expect(el.className).toContain('phs-compact');
    const name = el.querySelector('.phs-pname');
    expect(name).not.toBeNull();
    expect(name!.textContent).toBe(long);
  });

  it('no title attribute anywhere', () => {
    ui = mount(<PhShowcaseCard size="full" label="Mike" name="Mike" titleId="title_ironbeard" art="/a.webp" rank={{ divisionIndex: 7, points: 40 }}
      mine badge={<span>Leader</span>} band={<span>Ready</span>} youLabel onClick={() => {}} haspopup />);
    expect(root().querySelector('[title]')).toBeNull();
    expect(root().querySelector('svg title')).toBeNull();
  });
});

describe('PhShowcaseGhost', () => {
  it('ghost renders its children and label', () => {
    ui = mount(<PhShowcaseGhost size="compact" label="Open seat. Invite a friend" onClick={() => {}}><span className="probe">Invite</span></PhShowcaseGhost>);
    const el = root();
    expect(el.className).toContain('phs-ghost');
    expect(el.querySelector('.probe')?.textContent).toBe('Invite');
    expect(el.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('Open seat. Invite a friend');
  });
});

// R8 (2026-11-23): a name up to PLAYER_NAME_MAX (24, ChangeName.tsx) sits on one line at every card size. The info column
// is at least 43cqw wide (full / half; compact is 45), so a fitted name's width (em x size) must stay within it.
describe('the name fits one line', () => {
  const COLUMN_CQW = 43;
  const widthCqw = (name: string): number => nameEm(name) * nameFontCqw(name);
  it('keeps a short name at the full size', () => {
    expect(nameFontCqw('Mike')).toBe(PHS_NAME_MAX_CQW);
    expect(nameFontCqw('Kevin')).toBe(PHS_NAME_MAX_CQW);
  });
  it('steps a longer name down, wider letters further', () => {
    const eleven = nameFontCqw('EMBERMOTH42');
    expect(eleven).toBeLessThan(PHS_NAME_MAX_CQW);
    expect(eleven).toBeGreaterThan(4.5);
    expect(nameFontCqw('WWWWWWWWWWW')).toBeLessThan(nameFontCqw('IIIIIIIIIII'));
    expect(nameFontCqw('A'.repeat(16))).toBeLessThan(nameFontCqw('A'.repeat(12)));
  });
  it('fits every 24-letter name, even all W, without going under the floor', () => {
    for (const n of ['W'.repeat(24), 'M'.repeat(24), 'WMWMWMWMWMWMWMWMWMWMWMWM', 'A'.repeat(24), 'EMBERMOTH42EMBERMOTH4242']) {
      expect(nameFontCqw(n), n).toBeGreaterThanOrEqual(PHS_NAME_FLOOR_CQW);
      expect(widthCqw(n), n).toBeLessThanOrEqual(COLUMN_CQW);
    }
  });
  it('pins the mapping', () => {
    expect([4, 8, 11, 16, 24].map((len) => nameFontCqw('A'.repeat(len)))).toEqual([8.4, 6.91, 5.02, 3.45, 2.3]);
    expect(nameFontCqw('W'.repeat(24))).toBe(1.72);
  });
});

// R10 (2026-11-23): every rank label rankLabel() can print fits its slot at every card size (21cqw at full and half,
// 26.7cqw at compact: what the well leaves after padding, crest and gap); short labels keep 3.4cqw.
describe('the rank label fits its slot', () => {
  const SLOT = { full: 21, half: 21, compact: 26.7 } as const;
  const labels = Array.from({ length: 18 }, (_, i) => rankLabel(i));
  it('covers the whole ladder, Ascendant III the longest', () => {
    expect(labels).toContain('Ascendant III');
    expect(Math.max(...labels.map((l) => nameEm(l)))).toBe(nameEm('Ascendant III'));
  });
  it('fits every label at full, half and compact', () => {
    for (const size of ['full', 'half', 'compact'] as const) {
      for (const l of labels) {
        const width = (nameEm(l) + 0.02 * l.length) * rankLabelCqw(l, size);
        expect(width, `${l} @ ${size}`).toBeLessThanOrEqual(SLOT[size]);
      }
    }
  });
  it('pins the mapping', () => {
    expect(rankLabelCqw('Gold I', 'full')).toBe(PHS_RANK_MAX_CQW);
    expect(rankLabelCqw('Bronze I', 'compact')).toBe(PHS_RANK_MAX_CQW);
    expect(rankLabelCqw('Ascendant III', 'full')).toBe(2.44);
    expect(rankLabelCqw('Ascendant III', 'compact')).toBe(3.1);
    expect(rankLabelCqw('Platinum III', 'half')).toBe(2.81);
  });
});
