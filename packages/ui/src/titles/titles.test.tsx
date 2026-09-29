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
import { COSMETICS } from '@game/progression';
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
import { titleLookOf } from './titleStyle';

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
