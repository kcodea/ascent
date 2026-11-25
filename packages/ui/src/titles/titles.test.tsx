// @vitest-environment jsdom
/**
 * TITLES (owner ask 2026-09-28: "it'd be cool to show them where possible"; owner review the same day: "it's too much
 * on the lobby rail and looks out of place other places too. i think it should show in like leaderboard/match details
 * views, but it looks bad in game").
 *  - `TitleBadge` paints a title in its rarity colour, a custom style's gradient when one is registered, and nothing
 *    for an unknown / retired / absent title;
 *  - a new run RECORDS the equipped title (`run.cosmetics.title`), so review surfaces can show other players' titles;
 *  - NO in-game surface shows a title: the lobby rail and the combat foe plate stay title-free even when every seat
 *    recorded one;
 *  - the Leaderboard rows show each player's equipped title, and "Show opponent cosmetics" off hides everyone's but
 *    yours.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETICS, SECRET_TITLE_COSMETICS, TITLE_LOOK_KEYS } from '@game/progression';
import { createLobbyRun, type RunLobby } from '@game/sim';

vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
const { fetchTopPlayers } = vi.hoisted(() => ({ fetchTopPlayers: vi.fn() }));
vi.mock('../remoteBoards', async (orig) => ({ ...(await orig<typeof import('../remoteBoards')>()), fetchTopPlayers, remoteEnabled: () => true }));

import { mount } from '../renderedText.mount';
import { useGame } from '../store';
import { applyServerCatalogState, resetProgressionForTests, useProgression } from '../progression/progressionStore';
import { LobbyPanel } from '../LobbyPanel';
import { Rankings } from '../Rankings';
import { CombatOpponent } from '../CombatOpponent';
import { TitleBadge } from './TitleBadge';
import { hasTitlePlate, titleLookOf } from './titleStyle';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
Element.prototype.scrollIntoView = function scrollIntoView(): void { /* jsdom has none */ };

const m = mount(<div />);
beforeEach(() => { resetProgressionForTests(); useGame.setState({ showOpponentSkins: true }); });
afterEach(() => { m.render(<div />); resetProgressionForTests(); });

const badge = (root: ParentNode = m.container): HTMLElement | null => root.querySelector<HTMLElement>('.titlebadge');

describe('TitleBadge', () => {
  it('paints each rarity in its colour class, with the catalog name', () => {
    const one = { common: 'title_wanderer', rare: 'title_star_chaser', epic: 'title_kingbreaker', legendary: 'title_the_unbroken' } as const;
    for (const [rarity, id] of Object.entries(one)) {
      m.render(<TitleBadge id={id} />);
      const b = badge()!;
      expect(b.classList.contains(`r-${rarity}`), id).toBe(true);
      expect(b.dataset.rarity).toBe(rarity);
      expect(b.textContent).toBe(COSMETICS.find((c) => c.id === id)!.name);
      expect(b.hasAttribute('title')).toBe(false); // no native tooltips (owner rule)
    }
  });

  it('reads a recorded snapshot the same way as a bare id', () => {
    m.render(<TitleBadge snapshot={{ heroAttack: 'attack_blast', title: 'alpha_tester' }} size="md" />);
    expect(badge()!.textContent).toBe('Alpha Tester');
    expect(badge()!.classList.contains('tb-md')).toBe(true);
  });

  it('shows nothing for an unknown, a wrong-category, an absent or a retired title', () => {
    for (const id of ['title_from_the_future', 'skin_albus_1', '', null, undefined]) {
      m.render(<TitleBadge id={id} />);
      expect(badge(), String(id)).toBeNull();
    }
    m.render(<TitleBadge snapshot={null} />);
    expect(badge()).toBeNull();
    m.render(<TitleBadge id="title_ironbeard" />);
    expect(badge()).not.toBeNull();
    act(() => applyServerCatalogState({ retiredIds: ['title_ironbeard'], disabledCategories: [] }));
    expect(badge()).toBeNull(); // the kill switch re-renders it away
  });

  it('a custom style (hero-mastery titles, later) paints its gradient and optional shimmer', () => {
    const styles = { title_ironbeard: { gradient: 'linear-gradient(90deg, #f00, #00f)', effect: 'shimmer' as const } };
    expect(titleLookOf({ title: 'title_ironbeard' }, styles)?.custom).toEqual(styles.title_ironbeard);
    m.render(<TitleBadge id="title_ironbeard" styles={styles} />);
    const b = badge()!;
    expect(b.classList.contains('tb-grad')).toBe(true);
    expect(b.classList.contains('tb-shimmer')).toBe(true);
    expect(b.style.getPropertyValue('--tb-grad')).toContain('linear-gradient');
    m.render(<TitleBadge id="title_wanderer" styles={styles} />);
    expect(badge()!.classList.contains('tb-grad')).toBe(false);
  });
});

describe('the master hero title (owner pick 2026-10-28: "they look gross with gold and red", replacing the golden plate)', () => {
  it('a master title wears the master look everywhere TitleBadge renders it; the base title keeps the normal look', () => {
    m.render(<TitleBadge id="title_hero_warden_master" />);
    const master = badge()!;
    expect(master.classList.contains('tb-master')).toBe(true);
    expect(master.textContent).toBe('Warded'); // the star and the sweep are pseudo-elements, never text
    expect(master.querySelector('.tb-stitch')).toBeNull(); // the retired golden plate's stitch layer is gone
    expect([...master.classList].some((c) => c.startsWith('r-'))).toBe(false); // no rarity rule paints over it
    expect(master.dataset.rarity).toBeTruthy();
    expect(master.hasAttribute('title')).toBe(false);
    // a custom gradient never paints over the master look
    m.render(<TitleBadge id="title_hero_warden_master" styles={{ title_hero_warden_master: { gradient: 'linear-gradient(#f00, #00f)', effect: 'shimmer' } }} />);
    expect(badge()!.classList.contains('tb-grad')).toBe(false);
    expect(badge()!.classList.contains('tb-shimmer')).toBe(false);
    m.render(<TitleBadge id="title_hero_warden" />);
    expect(badge()!.classList.contains('tb-master')).toBe(false);
    expect(badge()!.classList.contains('r-epic')).toBe(true);
    expect(badge()!.textContent).toBe('Warded');
  });

  it('its loops animate transform and opacity only, and stop under reduced motion (docs/performance.md)', () => {
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf8');
    const rules = [...css.matchAll(/([^{}]*\.tb-master[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(3);
    const animated = rules.filter(([, , body]) => /animation:(?!\s*none)/.test(body!));
    expect(animated.length).toBe(2); // the sweep and the star
    for (const [, sel, body] of rules) expect(body, sel).not.toMatch(/transition/);
    // Both keyframes are one-liners: every property they set is transform or opacity.
    for (const name of ['tbshimmer', 'tbmtwinkle']) {
      const line = css.split('\n').find((l) => l.startsWith(`@keyframes ${name} `));
      expect(line, name).toBeTruthy();
      const props = [...line!.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]);
      expect(props.length, name).toBeGreaterThan(0);
      for (const p of props) expect(['transform', 'opacity'], `${name}: ${p}`).toContain(p);
    }
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((x) => x[1]).join('\n');
    expect(reduced).toMatch(/\.titlebadge\.tb-master::after \{ animation: none/);
    expect(reduced).toMatch(/\.titlebadge\.tb-master::before \{ animation: none/);
  });
});

describe('themed secret titles (owner ask 2026-11-20: "more exciting/fun looking based on their tribes or whatever unlocks them")', () => {
  it('every secret title has a look, every look is used, and no other title has one', () => {
    expect(SECRET_TITLE_COSMETICS.every((c) => c.look && TITLE_LOOK_KEYS.includes(c.look))).toBe(true);
    // Game Breaker (a gift, owner 2026-11-25) is the one title besides the secret ones with a look, and the only lemon.
    expect(new Set(SECRET_TITLE_COSMETICS.map((c) => c.look))).toEqual(new Set(TITLE_LOOK_KEYS.filter((k) => k !== 'lemon')));
    expect(COSMETICS.filter((c) => c.look && !c.id.startsWith('title_secret_')).map((c) => [c.id, c.look])).toEqual([['title_game_breaker', 'lemon']]);
    expect(hasTitlePlate('title_secret_king_brills_jester')).toBe(true);
    expect(hasTitlePlate('title_hero_warden_master')).toBe(true);
    expect(hasTitlePlate('title_wanderer')).toBe(false);
    expect(hasTitlePlate(null)).toBe(false);
  });

  it('paints its theme in colour only (no icon, owner 2026-11-20) with the secret seal, the name as the only text, live on screen', () => {
    m.render(<TitleBadge id="title_secret_king_brills_jester" />);
    const dwarf = badge()!;
    expect(dwarf.classList.contains('tb-look-dwarf')).toBe(true);
    expect([...dwarf.classList].some((c) => c.startsWith('r-'))).toBe(false); // no rarity rule paints over it
    expect(dwarf.querySelector('img')).toBeNull();
    expect(dwarf.querySelector('.tb-seal')).not.toBeNull();
    expect(dwarf.classList.contains('tb-live')).toBe(true); // jsdom has no IntersectionObserver: always live
    expect(dwarf.textContent).toBe("King Brill's Jester");
    expect(dwarf.hasAttribute('title')).toBe(false);
    m.render(<TitleBadge id="title_secret_pacifist" />);
    expect(badge()!.classList.contains('tb-look-jester')).toBe(true);
    expect(badge()!.textContent).toBe('Pacifist');
  });

  it('Game Breaker (R-PROG-TITLE-GIFT-01): the lemon, its name the only text, and a leaf that may leave the box', () => {
    m.render(<TitleBadge id="title_game_breaker" />);
    const lemon = badge()!;
    expect(lemon.classList.contains('tb-look-lemon')).toBe(true);
    expect(lemon.textContent).toBe('Game Breaker');
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf8');
    expect(css.match(/\.titlebadge\.tb-look-lemon \{([^}]*)\}/)![1]).toMatch(/overflow: visible/);
  });

  it('every look has a rule, and its loops animate transform and opacity only, off under reduced motion', () => {
    const css = readFileSync(join(__dirname, '../styles.css'), 'utf8');
    for (const k of TITLE_LOOK_KEYS) expect(css, k).toContain(`.titlebadge.tb-look-${k} {`);
    const rules = [...css.matchAll(/([^{}]*\.tb-look[^{}]*)\{([^}]*)\}/g)];
    for (const [, sel, body] of rules) expect(body, sel).not.toMatch(/transition/);
    // The only animated layers are the two pseudo-elements, and both start PAUSED (running only with `tb-live`).
    const animated = rules.filter(([, , body]) => /(?:^|[\s;])animation:(?!\s*none)/.test(body!));
    expect(animated.map(([, sel]) => sel!.trim()).sort()).toEqual(['.titlebadge.tb-look-lemon .tb-seal', '.titlebadge.tb-look::after', '.titlebadge.tb-look::before']); // the lemon's leaf sways
    for (const [, sel, body] of animated) expect(body, sel).toMatch(/paused;/);
    expect(css).toMatch(/\.titlebadge\.tb-look\.tb-live::before, \.titlebadge\.tb-look\.tb-live::after \{ animation-play-state: running; \}/);
    // Every theme names an accent, and every accent's keyframes set transform and opacity only.
    const names = new Set<string>();
    for (const k of TITLE_LOOK_KEYS) {
      const body = css.match(new RegExp(`\\.titlebadge\\.tb-look-${k} \\{([^}]*)\\}`))![1]!;
      const m = body.match(/--lk-anim: (tblk-[a-z]+) /);
      expect(m, k).toBeTruthy();
      names.add(m![1]!);
    }
    names.add('tbshimmer').add('tblk-sway');
    for (const name of names) {
      const line = css.split('\n').find((l) => l.startsWith(`@keyframes ${name} `));
      expect(line, name).toBeTruthy();
      const props = [...line!.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]);
      for (const p of props) expect(['transform', 'opacity'], `${name}: ${p}`).toContain(p);
    }
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((x) => x[1]).join('\n');
    expect(reduced).toMatch(/\.titlebadge\.tb-look-lemon \.tb-seal \{ animation: none/);
    expect(css).toMatch(/\.titlebadge\.tb-look-lemon\.tb-live \.tb-seal \{ animation-play-state: running; \}/);
    expect(reduced).toMatch(/\.titlebadge\.tb-look::after \{ animation: none/);
    expect(reduced).toMatch(/\.titlebadge\.tb-look::before \{ animation: none/);
  });
});

describe('a new run records the equipped title', () => {
  it('newRun stamps run.cosmetics.title from the profile; nothing when none is equipped', () => {
    useProgression.setState({ mirror: { userId: 'u-1', accountXp: 0, accountLevel: 2, revision: 1, equippedTitleId: 'title_kingbreaker', titles: ['title_kingbreaker'] } });
    act(() => useGame.getState().newRun(4242, 'albus'));
    expect(useGame.getState().run.cosmetics).toEqual({ title: 'title_kingbreaker' });
    useProgression.setState({ mirror: { userId: 'u-1', accountXp: 0, accountLevel: 2, revision: 1, equippedTitleId: null, titles: [] } });
    act(() => useGame.getState().newRun(4243, 'albus'));
    expect('cosmetics' in useGame.getState().run).toBe(false);
  });
});

function table(): RunLobby {
  const run = createLobbyRun(99, 'albus', {}, 'practice', { opponents: 'bots', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribes: [] });
  const lobby = structuredClone(run.lobby!);
  lobby.seats.forEach((s, i) => { if (i > 0) s.cosmetics = { title: 'title_the_unbroken' }; });
  useGame.setState({ run: { ...run, phase: 'combat', lobby, cosmetics: { title: 'title_star_chaser' } }, combatStaged: true });
  return lobby;
}

describe('no in-game surface shows a title (owner review 2026-09-28)', () => {
  it('the lobby rail and the combat foe plate stay title-free even when every seat recorded one', () => {
    const lobby = table();
    m.render(<><LobbyPanel lobby={lobby} /><CombatOpponent /></>);
    expect(m.container.querySelector('.lobbyseat')).not.toBeNull();
    expect(document.querySelector('.combatopp-name')).not.toBeNull();
    expect(document.querySelectorAll('.titlebadge')).toHaveLength(0);
    act(() => useGame.setState({ combatStaged: false }));
  });
});

describe('the Leaderboard rows', () => {
  const rows = [
    { userId: 'u-1', author: 'Me', rating: 900, gamesPlayed: 12, equippedTitleId: 'title_star_chaser' },
    { userId: 'u-2', author: 'Rival', rating: 800, gamesPlayed: 9, equippedTitleId: 'title_the_unbroken' },
    { userId: 'u-3', author: 'Plain', rating: 700, gamesPlayed: 4 },
    { userId: 'u-4', author: 'Future', rating: 600, gamesPlayed: 3, equippedTitleId: 'title_from_the_future' },
  ];
  const titleOfRow = (name: string): string | null => {
    const row = [...document.querySelectorAll('.lb-trow-btn')].find((r) => r.querySelector('.lb-handle')?.textContent?.startsWith(name));
    return row?.querySelector('.titlebadge')?.textContent ?? null;
  };

  it("each player's equipped title, rarity-coloured; none when absent or unknown; opponents' hidden with the switch off", async () => {
    fetchTopPlayers.mockResolvedValue(rows);
    useGame.setState({ showRankings: true, account: { ...useGame.getState().account, userId: 'u-1' } });
    m.render(<Rankings />);
    await act(async () => { await Promise.resolve(); });
    expect(titleOfRow('Me')).toBe('Star Chaser');
    expect(titleOfRow('Rival')).toBe('The Unbroken');
    expect([...document.querySelectorAll('.lb-trow-btn .titlebadge')].map((e) => e.getAttribute('data-rarity'))).toEqual(['rare', 'legendary']);
    expect(titleOfRow('Plain')).toBeNull();
    expect(titleOfRow('Future')).toBeNull();
    act(() => useGame.getState().setShowOpponentSkins(false));
    expect(titleOfRow('Me')).toBe('Star Chaser');
    expect(titleOfRow('Rival')).toBeNull();
    act(() => useGame.setState({ showRankings: false }));
  });
});
