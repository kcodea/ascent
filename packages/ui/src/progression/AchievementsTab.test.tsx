// @vitest-environment jsdom
/**
 * THE CAREER ACHIEVEMENTS TAB (achievements batch 1, 2026-09-28). Owner direction: "we'll need an achievements tab
 * in career next to practice. most should show, with their reward, but the hidden ones will be blurred or say
 * "Hidden"". Two layers: the pure view model (what shows, to whom) and the rendered tab (tiles, filters,
 * categories, the hidden blur), plus the stage / performance tripwires on its stylesheet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACHIEVEMENTS, ACHIEVEMENT_INDEX, type AchievementDef } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import { achievementView, completedDateText, passesFilter } from './achievementsModel';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const fetchAchievementCompletions = vi.fn<(userId: string) => Promise<Array<{ id: string; completedAt: string | null }> | undefined>>();
const fetchOwnAchievementProgress = vi.fn<() => Promise<Record<string, number> | undefined>>();
const fetchRetiredAchievementIds = vi.fn<() => Promise<string[] | undefined>>();
vi.mock('./progressionRemote', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./progressionRemote')>()),
  fetchAchievementCompletions: (id: string) => fetchAchievementCompletions(id),
  fetchOwnAchievementProgress: () => fetchOwnAchievementProgress(),
  fetchRetiredAchievementIds: () => fetchRetiredAchievementIds(),
}));
vi.mock('../remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../remoteBoards')>()), remoteEnabled: () => true }));

const { AchievementsTab } = await import('./AchievementsTab');

const HIDDEN: AchievementDef = { ...ACHIEVEMENT_INDEX['career.games.1']!, id: 'hidden.test_feast', name: 'Secret Feast Name', requirement: 'Secret requirement text.', hidden: true, rewards: { xp: 777, titleId: null } };

describe('the view model', () => {
  const base = { completions: [{ id: 'career.games.1', completedAt: '2026-09-28T10:00:00Z' }], progress: { 'career.games.10': 4, 's2.kobold.rubies_life_500': 900, 'economy.spend_turn_20': 12 }, retired: [], activeSetId: 'set2' };

  it('every achievement shows (with its reward); categories and Set 2 tribe groups in order', () => {
    const v = achievementView(base);
    expect(v.total).toBe(ACHIEVEMENTS.length);
    expect(v.categories.map((c) => c.label)).toEqual(['Career', 'Ranked', 'Heroes', 'Economy and Build', 'Mechanics', 'Runes', 'Set 2']);
    expect(v.categories.find((c) => c.id === 'set2')!.groups.map((g) => g.label)).toEqual(['Kobolds', 'Dwarves', 'Dragons', 'Beasts', 'Demons', 'Cross-tribe', 'Runes']);
    expect(v.categories.find((c) => c.id === 'heroes')!.groups).toHaveLength(35);
    expect(v.done).toBe(1);
    expect(v.xpEarned).toBe(25);
  });

  it('progress only on the owner page, only for counting achievements, clamped to the target', () => {
    const own = achievementView(base).categories.flatMap((c) => c.groups.flatMap((g) => g.tiles));
    const byId = (id: string) => own.find((t) => t.def.id === id)!;
    expect(byId('career.games.10').progress).toBe(4);
    expect(byId('s2.kobold.rubies_life_500').progress).toBe(500);
    expect(byId('economy.spend_turn_20').progress).toBeNull(); // a one-turn feat: no bar
    expect(byId('career.games.1').progress).toBeNull(); // completed
    const visitor = achievementView({ ...base, progress: null }).categories.flatMap((c) => c.groups.flatMap((g) => g.tiles));
    expect(visitor.every((t) => t.progress === null)).toBe(true);
  });

  it('a hidden achievement is concealed until completed; a retired one drops out unless completed; another set reads Legacy', () => {
    const v = achievementView({ ...base, defs: [...ACHIEVEMENTS, HIDDEN], retired: ['career.games.50', 'career.games.1'], activeSetId: 'set3' });
    const tiles = v.categories.flatMap((c) => c.groups.flatMap((g) => g.tiles));
    expect(tiles.find((t) => t.def.id === HIDDEN.id)!.concealed).toBe(true);
    expect(tiles.find((t) => t.def.id === 'career.games.50')).toBeUndefined();
    expect(tiles.find((t) => t.def.id === 'career.games.1')!.completed).toBe(true); // retired but already earned: kept
    expect(tiles.filter((t) => t.def.setId === 'set2').every((t) => t.legacy)).toBe(true);
    const done = achievementView({ ...base, defs: [HIDDEN], completions: [{ id: HIDDEN.id, completedAt: null }] });
    expect(done.categories[0]!.groups[0]!.tiles[0]!.concealed).toBe(false);
  });

  it('filters and the completion date text', () => {
    const t = achievementView(base).categories[0]!.groups[0]!.tiles;
    const done = t.find((x) => x.completed)!;
    const open = t.find((x) => !x.completed)!;
    expect([passesFilter(done, 'completed'), passesFilter(done, 'progress'), passesFilter(open, 'progress'), passesFilter(open, 'all')]).toEqual([true, false, true, true]);
    expect(completedDateText('2026-09-28T10:00:00Z')).toMatch(/^Completed Sep 2[78], 2026$/);
    expect(completedDateText(null)).toBe('Completed');
  });
});

describe('the rendered tab', () => {
  let ui: Mounted | null = null;
  const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
  const all = (sel: string): string[] => [...ui!.container.querySelectorAll(sel)].map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim());
  const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
  const button = (label: string): HTMLButtonElement | undefined => [...ui!.container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement | undefined;

  beforeEach(() => {
    try { localStorage.removeItem('ascent.career.achievements.cat'); } catch { /* jsdom */ }
    fetchAchievementCompletions.mockReset().mockResolvedValue([{ id: 'career.games.1', completedAt: '2026-09-28T10:00:00Z' }, { id: 's2.kobold.rubies_turn_8', completedAt: '2026-09-28T11:00:00Z' }]);
    fetchOwnAchievementProgress.mockReset().mockResolvedValue({ 'career.games.10': 3 });
    fetchRetiredAchievementIds.mockReset().mockResolvedValue([]);
  });
  afterEach(() => { ui?.unmount(); ui = null; });

  it('own page: the Career category first, name + requirement + reward on every tile, the date on a completed one, a progress bar', async () => {
    ui = mount(<AchievementsTab userId="me" own ownerName="Kev" />);
    await flush();
    expect(all('.ach-cat-name')).toEqual(['Career', 'Ranked', 'Heroes', 'Economy and Build', 'Mechanics', 'Runes', 'Set 2']);
    expect(all('.ach-cat-count')[0]).toBe('1 / 17');
    const first = ui.container.querySelector('.ach-tile.done')!;
    expect(first.querySelector('.ach-tile-name')!.textContent).toBe('First Steps');
    expect(first.querySelector('.ach-tile-xp')!.textContent).toBe('+25 XP');
    expect(first.querySelector('.ach-done')!.textContent).toMatch(/^Completed Sep 2[78], 2026$/);
    expect(all('.ach-tile-req')).toContain('Complete 10 games.');
    expect(all('.ach-prog-num')).toContain('3 / 10');
    expect(fetchOwnAchievementProgress).toHaveBeenCalledTimes(1);
  });

  it('another player: completions show, progress is never asked for or drawn', async () => {
    ui = mount(<AchievementsTab userId="them" own={false} ownerName="Rival" />);
    await flush();
    expect(fetchAchievementCompletions).toHaveBeenCalledWith('them');
    expect(fetchOwnAchievementProgress).not.toHaveBeenCalled();
    expect(ui.container.querySelectorAll('.ach-prog')).toHaveLength(0);
    expect(ui.container.querySelectorAll('.ach-tile.done').length).toBe(1);
  });

  it('categories and filters: Set 2 grouped by tribe; Completed and In progress split the tiles', async () => {
    ui = mount(<AchievementsTab userId="me" own ownerName="Kev" />);
    await flush();
    click(button('Set 2'));
    expect(all('.ach-group-head')).toEqual(['Kobolds', 'Dwarves', 'Dragons', 'Beasts', 'Demons', 'Cross-tribe', 'Runes']);
    click(button('Completed'));
    expect(all('.ach-tile-name')).toEqual(['Cut and Set']);
    click(button('In progress'));
    expect(all('.ach-tile-name')).toHaveLength(43);
    expect(all('.ach-tile-name')).not.toContain('Cut and Set');
  });

  it('a server failure offers Retry, which reads again', async () => {
    fetchAchievementCompletions.mockResolvedValueOnce(undefined);
    ui = mount(<AchievementsTab userId="me" own ownerName="Kev" />);
    await flush();
    expect(all('.cv2-state-title')).toEqual(['Couldn’t reach the server']);
    click(button('Retry'));
    await flush();
    expect(ui.container.querySelectorAll('.ach-tile').length).toBeGreaterThan(0);
  });

  it('no native tooltips and no em dashes in the tab', async () => {
    ui = mount(<AchievementsTab userId="me" own ownerName="Kev" />);
    await flush();
    expect(ui.container.querySelectorAll('[title]')).toHaveLength(0);
    expect(ui.container.textContent).not.toMatch(/—|--/);
  });
});

describe('the hidden tile (rendered)', () => {
  it('shows "Hidden" over a blurred placeholder, never the name, requirement or reward', async () => {
    vi.resetModules();
    vi.doMock('@game/progression', async (importOriginal) => {
      const real = await importOriginal<typeof import('@game/progression')>();
      return { ...real, ACHIEVEMENTS: Object.freeze([...real.ACHIEVEMENTS.filter((a) => a.category === 'career'), { ...HIDDEN, category: 'career' as const }]) };
    });
    const { AchievementsTab: Tab } = await import('./AchievementsTab');
    fetchAchievementCompletions.mockReset().mockResolvedValue([]);
    fetchOwnAchievementProgress.mockReset().mockResolvedValue({});
    fetchRetiredAchievementIds.mockReset().mockResolvedValue([]);
    const ui = mount(<Tab userId="me" own ownerName="Kev" />);
    await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
    try {
      const tile = ui.container.querySelector('.ach-tile.concealed');
      expect(tile).not.toBeNull();
      expect(tile!.querySelector('.ach-hidden-label')!.textContent).toBe('Hidden');
      expect(tile!.querySelector('.ach-blur')).not.toBeNull();
      expect(ui.container.textContent).not.toContain('Secret Feast Name');
      expect(ui.container.textContent).not.toContain('Secret requirement text.');
      expect(ui.container.textContent).not.toContain('+777 XP');
    } finally {
      ui.unmount();
      vi.doUnmock('@game/progression');
    }
  });
});

describe('the stylesheet: stage and performance tripwires', () => {
  const css = readFileSync(join(__dirname, 'achievements.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('no raw viewport units, no viewport @media, no cursor rules', () => {
    expect(css).not.toMatch(/(?<![\w-])-?[\d.]+[dsl]?v[wh]\b/);
    expect(css).not.toMatch(/@media[^{]*\((min-|max-)?(width|height|aspect-ratio)\s*:/);
    expect(css).not.toMatch(/cursor\s*:/);
  });
  it('nothing loops, and the hidden blur is static', () => {
    expect(css).not.toMatch(/infinite/);
    expect(css).toMatch(/\.ach-blur\s*\{[^}]*filter:\s*blur\(\d+px\)/);
    expect(css).not.toMatch(/transition:[^;]*filter/);
  });
});
