// @vitest-environment jsdom
/**
 * SKINS in the lobby's seat list (2026-09-28): your seat wears the skin recorded on YOUR run; every other seat
 * wears its owner's recorded skin (the seat's `cosmetics`); "Show opponent skins" off reverts the OPPONENTS only;
 * a seat from before skins (no field) and a seat naming a retired / unknown item show default art.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun, type RunLobby } from '@game/sim';
import { mount } from '../renderedText.mount';
import { heroArt } from '../art';
import { LobbyPanel } from '../LobbyPanel';
import { useGame } from '../store';
import { applyServerCatalogState, resetProgressionForTests } from '../progression/progressionStore';

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const m = mount(<div />);
beforeEach(() => { resetProgressionForTests(); useGame.setState({ showOpponentSkins: true }); });
afterEach(() => { m.render(<div />); resetProgressionForTests(); });

function table(): RunLobby {
  const run = createLobbyRun(99, 'albus', {}, 'practice', { opponents: 'bots', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribes: [] });
  const lobby = structuredClone(run.lobby!);
  lobby.seats[1] = { ...lobby.seats[1]!, heroId: 'warden', cosmetics: { heroSkinByHeroId: { warden: 'skin_warden_1' } } };
  lobby.seats[2] = { ...lobby.seats[2]!, heroId: 'albus', cosmetics: { heroSkinByHeroId: { albus: 'skin_gone_forever' } } };
  useGame.setState({ run: { ...run, lobby, cosmetics: { heroSkinByHeroId: { albus: 'skin_albus_1' } } } });
  return lobby;
}
const face = (seatId: string): string => m.container.querySelector<HTMLImageElement>(`[data-seat="${seatId}"] img.lobbyface`)?.getAttribute('src') ?? '';

describe('the seat list', () => {
  it('your seat: your run\'s skin; an opponent: theirs; an unknown id / a seat from before skins: default art', () => {
    const lobby = table();
    m.render(<LobbyPanel lobby={lobby} />);
    expect(face('s0')).toContain('skin_albus_1');
    expect(face('s1')).toContain('skin_warden_1');
    expect(face('s2')).toBe(heroArt('albus'));
    expect(face('s3')).toBe(heroArt(lobby.seats[3]!.heroId));
  });

  it('"Show opponent skins" off: opponents revert, YOUR seat keeps its skin', () => {
    const lobby = table();
    m.render(<LobbyPanel lobby={lobby} />);
    act(() => useGame.getState().setShowOpponentSkins(false));
    expect(face('s0')).toContain('skin_albus_1');
    expect(face('s1')).toBe(heroArt('warden'));
  });

  it('the kill switch: a retired skin reverts on every seat (yours included) while the loadout still names it', () => {
    const lobby = table();
    m.render(<LobbyPanel lobby={lobby} />);
    act(() => applyServerCatalogState({ retiredIds: ['skin_albus_1', 'skin_warden_1'], disabledCategories: [] }));
    expect(face('s0')).toBe(heroArt('albus'));
    expect(face('s1')).toBe(heroArt('warden'));
  });
});
