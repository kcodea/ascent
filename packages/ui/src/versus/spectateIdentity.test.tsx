// @vitest-environment jsdom
/**
 * VERSUS SPECTATOR IDENTITY (live bug 2026-10-14: "it shows the spectators name in the bottom left as well"). On the
 * watch screen every "you" surface is the WATCHED player's, read off the watched run's own two-seat lobby, never the
 * local profile. The inverse holds too: a player's own screen shows their own name, whoever is in the stands.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const sp = await import('./spectate');

function Probe() { return <span id="who">{sp.useWatchedName() ?? 'NOT SPECTATING'}</span>; }
const withLobby = (label: string) => ({ ...useGame.getState().run, lobby: { seats: [{ id: 's0', label }, { id: 's1', label: 'Their Foe' }] } as never });

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; sp.useSpectate.setState({ active: false }); });

describe('the watch screen shows the watched player, never the spectator', () => {
  it('spectating: the watched seat label; not spectating: nothing (the own profile name is used)', () => {
    useGame.setState({ playerName: 'Spectator Me', run: withLobby('Watched Player') });
    sp.useSpectate.setState({ active: true });
    ui = mount(<Probe />);
    expect(document.getElementById('who')?.textContent).toBe('Watched Player');
    ui.unmount();
    sp.useSpectate.setState({ active: false });
    ui = mount(<Probe />);
    expect(document.getElementById('who')?.textContent).toBe('NOT SPECTATING');
  });
});
