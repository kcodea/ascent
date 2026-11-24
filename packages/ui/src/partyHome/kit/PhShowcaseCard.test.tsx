// @vitest-environment jsdom
/**
 * THE SHOWCASE CARD (party home kit): the landscape player card that replaces the tall banner. Pins what the card prints
 * (name, title, crest, rank label, points, bar), that mirroring flips only the art, that a long name stays one line, that
 * nothing carries a native tooltip, and that an open seat (the ghost) shows its own content under its label.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../../renderedText.mount';

// TitleBadge reads the progression store; guard the pixi import chain's canvas probe as rankSurfaces.test.tsx does.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

import { PhShowcaseCard, PhShowcaseGhost } from './PhShowcaseCard';
import { pointsText, rankLabel } from '../../rank/rankFormat';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const root = (): HTMLElement => ui!.container.firstElementChild as HTMLElement;

describe('PhShowcaseCard', () => {
  it('renders name, title badge, crest, rank label and points', () => {
    ui = mount(<PhShowcaseCard size="full" label="Mike. Options" name="Mike" titleId="title_ironbeard" rank={{ divisionIndex: 7, points: 40 }} />);
    const el = root();
    expect(el.className).toContain('phs-card');
    expect(el.className).toContain('phs-full');
    expect(el.querySelector('.phs-name')?.textContent).toBe('Mike');
    expect(el.querySelector('.titlebadge')).not.toBeNull();
    expect(el.querySelector('.rankcrest')).not.toBeNull();
    expect(el.textContent).toContain(rankLabel(7));
    expect(el.textContent).toContain(pointsText({ divisionIndex: 7, points: 40 }));
    expect((el.querySelector('.phs-bar > i') as HTMLElement).style.width).toBe('40%');
    expect(el.querySelector('button.phs-press')).not.toBeNull();
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
    const name = el.querySelector('.phs-name') as HTMLElement;
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
    const name = el.querySelector('.phs-name');
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
