// @vitest-environment jsdom
/**
 * THE RAIL SCOUT CARD'S RUNE TIPS (owner ask 2026-11-01: "mouseover on runes here is important, and it should show any
 * relevant values if the player has value shown on their runes etc"; R-RAIL-SCOUT-RUNE-TIP-02).
 *
 * Pins:
 *  - the hover card stays up for a beat after the pointer leaves the seat, so the pointer can reach it, and it stays
 *    while the pointer is on it;
 *  - hovering a filled rune socket mounts the player's own rune tip (no native `title=`), and leaving unmounts it;
 *  - the tip prints LIVE values: your own seat reads the whole run (grown value + the meter in the pill, exactly as your
 *    rack badge), every other seat reads its captured board (the grown combat values and the turn's first spell).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { boardIntel, createLobbyRun, snapshotBoard, type RunState } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import { mount, type Mounted } from './renderedText.mount';
import { LobbyPanel } from './LobbyPanel';
import { useGame } from './store';
import { runeTipLines } from './runeTipBody';

let ui: Mounted | null = null;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); });

const fire = (el: Element, type: string, related: Element = document.body): void => {
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: related })); });
};
const wait = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
const card = (): Element | null => document.body.querySelector('.lobbyscout');

/** A run holding a grown Wild Hunt (2 + 10 grown = +12 on the next swing) and Overtime 5 Gold into its 12. */
function runWithRunes(): RunState {
  const run = createLobbyRun(4242, 'warden');
  return {
    ...run,
    ownedRunes: ['rune_wild_hunt', 'rune_overtime'],
    questFlags: { ...(run.questFlags ?? {}), runeWildHunt: 2 },
    runeWildHuntGrown: 10,
    runeThresholds: [{ sourceId: 'rune_overtime', meter: 'gold', per: 12, tick: 5, grantAle: 1 }],
  } as RunState;
}

describe('rail scout card: rune tips', () => {
  it('the hover card can be reached, and its rune sockets open the live rune tip', () => {
    const run = runWithRunes();
    act(() => { useGame.setState({ run }); });
    ui = mount(<LobbyPanel lobby={run.lobby!} />);
    const mine = ui.container.querySelector('.lobbyseat.you')!;
    fire(mine, 'mouseover');
    expect(card()).not.toBeNull();

    // Leaving the seat does not close it at once: the pointer is crossing the gap.
    fire(mine, 'mouseout');
    wait(60);
    expect(card()).not.toBeNull();
    // Entering the (portaled) card re-enters the seat in React's tree, which cancels the close.
    fire(card()!, 'mouseover');
    wait(1000);
    expect(card()).not.toBeNull();

    const socket = card()!.querySelector('.lrv-sc-socket.filled, .lobbyscout-socket.filled')!;
    expect(socket).not.toBeNull();
    expect(socket.querySelector('.questbadge-tip')).toBeNull(); // mounts on hover only
    fire(socket, 'pointerover');
    const tip = socket.querySelector('.questbadge-tip.scout-runepop')!;
    expect(tip).not.toBeNull();
    expect(tip.textContent).toContain('Wild Hunt');
    expect(tip.textContent).toContain('+12 Attack'); // the grown value, not the printed +2
    expect(card()!.querySelector('[title]')).toBeNull();

    const sockets = card()!.querySelectorAll('.lrv-sc-socket.filled, .lobbyscout-socket.filled');
    fire(socket, 'pointerout', sockets[1]!); // straight onto the next socket: leave one, enter the other
    expect(socket.querySelector('.questbadge-tip')).toBeNull();
    const tip2 = sockets[1]!.querySelector('.questbadge-tip')!;
    expect(tip2.textContent).toContain('Overtime');
    expect(tip2.textContent).toContain('5/12g'); // the meter, as the rack badge's pill shows it

    // Leaving the card closes it after the grace.
    fire(card()!, 'mouseout');
    wait(1000);
    expect(card()).toBeNull();
  });

  it("another seat's tip reads its captured board: grown combat values live, Shop meters at base", () => {
    const run = runWithRunes();
    const snap = snapshotBoard({ ...run, firstSpellThisTurnId: undefined });
    const intel = boardIntel({ minions: snap.minions, tier: snap.tier, snapshot: snap }, 3);
    expect(intel.runes).toEqual(['rune_wild_hunt', 'rune_overtime']);
    const src = { live: intel.runeLive ?? null, firstSpellId: intel.firstSpellId };
    expect(runeTipLines('rune_wild_hunt', src)!.text).toContain('+12 Attack');
    // A snapshot carries no Shop meter: the pill says the rune is active and invents no count.
    expect(runeTipLines('rune_overtime', src)!.state).toBe('Rune · active');
  });

  it("Rune of Recollection names the seat's first spell when the board recorded it, and says nothing when it did not", () => {
    const spell = Object.values(CARD_INDEX)[0]!; // any card: the line only names it
    const run = { ...runWithRunes(), ownedRunes: ['rune_recollection'], firstSpellThisTurnId: spell.id } as RunState;
    const snap = snapshotBoard(run);
    const intel = boardIntel({ minions: snap.minions, tier: snap.tier, snapshot: snap }, 3);
    expect(intel.firstSpellId).toBe(spell.id);
    expect(runeTipLines('rune_recollection', { live: intel.runeLive ?? null, firstSpellId: intel.firstSpellId })!.liveLine)
      .toBe(`Now: a copy of ${spell.name}`);
    expect(runeTipLines('rune_recollection', { live: null })!.liveLine).toBeNull();
    // Your own run always knows (none cast yet is an answer).
    expect(runeTipLines('rune_recollection', { run: { ...run, firstSpellThisTurnId: undefined } })!.liveLine)
      .toBe('Now: nothing cast yet this turn');
  });
});
