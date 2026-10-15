// @vitest-environment jsdom
/**
 * VERSUS: the opponent's hero block (owner 2026-10-14). Pinned: it mirrors your own hero block (portrait disc in their
 * frame, name plate, heart pill, status pill), carries no tier badge, NO round pips ("dont put the round
 * results under there"), and its pulses are one-shot: none on mount, one on a status change, one on a lost heart.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import type { LobbySeatState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { VersusFoe } = await import('./VersusFoe');
const { useVersus } = await import('./versusStore');
const { setIdentity } = await import('../identity');

const seat = (resolve: number): LobbySeatState => ({ id: 's1', label: 'LazerLemon', heroId: 'indy', resolve, armor: 0, alive: true } as unknown as LobbySeatState);
const match = (p: Record<string, unknown>) => ({
  id: 'm', p1_user: 'me', p2_user: 'them', phase: 'shop', round: 3, paused_at: null, paused_seat: null,
  p1_locked: false, p2_locked: false, p1_ready: false, p2_ready: false, p1_auto: false, p2_auto: false, ...p,
}) as never;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; useVersus.setState({ match: null }); setIdentity(null); });

const onGuides = vi.fn();
const render = (resolve: number) => <VersusFoe foe={seat(resolve)} art={undefined} frame={null} round={4} faceProps={{}} onGuides={onGuides} guidesOpen={false} />;

describe('the Versus opponent block', () => {
  it('mirrors your block: portrait, name plate, hearts, Round plate, a Guides plate; no tier badge, no round pips', () => {
    setIdentity({ userId: 'me' } as never);
    useVersus.setState({ match: match({}) });
    ui = mount(render(5));
    expect(document.querySelector('.vsfoe-face .combatopp-portrait')).not.toBeNull();
    expect(document.querySelector('.vsfoe-name.hudpill-name')?.textContent).toBe('LazerLemon');
    expect(document.querySelector('.vsfoe-hp.hudpill-hp .hpval')?.textContent).toBe('5');
    expect(document.querySelector('.vsfoe-round')?.textContent).toBe('Round 4');
    expect(document.querySelector('.vsfoe-tier, .vsfoe-socket, .vsfoe-pips, .endpip')).toBeNull();
    const guides = document.querySelector<HTMLButtonElement>('button.vsfoe-guides');
    expect(guides?.textContent).toBe('Guides');
    act(() => { guides!.click(); });
    expect(onGuides).toHaveBeenCalledTimes(1);
  });

  it('shows no status while they shop; Locked in arrives with one shine across the portrait', () => {
    setIdentity({ userId: 'me' } as never);
    useVersus.setState({ match: match({}) });
    ui = mount(render(5));
    expect(document.querySelector('.vsfoe-status')).toBeNull();
    expect(document.querySelector('.vsfoe-shine')).toBeNull();
    act(() => { useVersus.setState({ match: match({ p2_locked: true }) }); });
    expect(document.querySelector('.vsfoe-status')?.textContent).toBe('Locked in');
    expect(document.querySelectorAll('.vsfoe-shine')).toHaveLength(1);
    act(() => { useVersus.setState({ match: match({ paused_seat: 'p2' }) }); });
    expect(document.querySelector('.vsfoe-status.away')?.textContent).toBe('Disconnected');
  });

  it('a lost heart ticks down with your heart pill hit (shake + "-1"), never on mount', () => {
    vi.useFakeTimers();
    try {
      ui = mount(render(5));
      expect(document.querySelector('.vsfoe-hp.hit, .resfx')).toBeNull();
      ui.render(render(4));
      expect(document.querySelector('.vsfoe-hp .hpval')?.textContent).toBe('5'); // holds until the block has settled
      act(() => { vi.advanceTimersByTime(450); });
      expect(document.querySelector('.vsfoe-hp.hit .hpval')?.textContent).toBe('4');
      expect(document.querySelector('.vsfoe-hp .resfx')?.textContent).toBe('−1');
      act(() => { vi.advanceTimersByTime(1100); });
      expect(document.querySelector('.vsfoe-hp.hit, .resfx')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
