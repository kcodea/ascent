// @vitest-environment jsdom
/**
 * SELF HOVER IN THE LOBBY RAIL (owner ask 2026-09-24: "add the same mouseover for self as we have for enemies").
 * Pins: hovering YOUR seat opens the same scout card an opponent's seat opens (same `.lobbyscout` markup, your
 * name + hero, intel read live off your run), leaving the seat closes it, and an opponent's hover is unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createLobbyRun, getHero } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { LobbyPanel } from './LobbyPanel';
import { useGame } from './store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const hover = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); }); };
const leave = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); }); };
const card = (): Element | null => document.body.querySelector('.lobbyscout');

describe('lobby rail: hover your own seat', () => {
  it('opens the same scout card for your seat as for an opponent', () => {
    const run = createLobbyRun(4242, 'warden');
    act(() => { useGame.setState({ run }); });
    ui = mount(<LobbyPanel lobby={run.lobby!} />);

    const mine = ui.container.querySelector('.lobbyseat.you')!;
    expect(mine).not.toBeNull();
    hover(mine);
    expect(card()).not.toBeNull();
    expect(card()!.textContent).toContain(run.lobby!.seats[0]!.label);
    expect(card()!.textContent).toContain(getHero('warden').name);
    expect(card()!.querySelector('[title]')).toBeNull();
    leave(mine);
    expect(card()).toBeNull();

    const theirs = ui.container.querySelector('.lobbyseat:not(.you)')!;
    hover(theirs);
    expect(card()).not.toBeNull();
    expect(card()!.textContent).not.toContain(run.lobby!.seats[0]!.label);
  });
});
