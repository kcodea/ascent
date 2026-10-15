// @vitest-environment jsdom
/**
 * VERSUS input bleed (live PvP 2026-10-14). Mike: "you can right click the units on the end match screen ... and it
 * happens behind the end match screen". Kevin: "if you are right clicked on a unit from that screen and a new round
 * starts the right click stays". Pinned: nothing UNDER the match stats overlay is inspectable, and opening / closing the
 * stats closes an inspect left open. Then (owner 2026-10-14: "add the ability to right click and view the buffs etc"):
 * the overlay's OWN board cards inspect, with the round's buff breakdown, above the overlay; switching rounds closes
 * it; Esc closes the inspect first, then the overlay.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const { VersusMatchStats } = await import('./VersusMatchStats');
const { setVersusStatsOpen } = await import('./versusStore');

const CID = Object.keys((await import('@game/content')).CARD_INDEX)[0]!;
const snap = { uid: 'u1', cardId: CID, name: 'Snap', tribe: 'neutral', attack: 5, health: 6, keywords: [], buffs: [{ source: 'Tome', attack: 3, health: 4, count: 1 }] };
const record = {
  matchId: 'm', myName: 'Alpha', foeName: 'Test Bot', myHero: null, foeHero: null, myCosmetics: null, foeCosmetics: null,
  outcome: 'win' as const, endReason: 'hearts' as const, myHearts: 3, foeHearts: 0,
  rounds: [{ round: 1, result: 'win' as const, myHearts: 7, foeHearts: 6, mine: [{ cardId: CID, attack: 5, health: 6 }], foe: [], myRunes: [], foeRunes: ['rune_broodpit'], mineSnap: [snap] as never[], foeSnap: [] },
    { round: 2, result: 'lose' as const, myHearts: 6, foeHearts: 6, mine: [], foe: [], myRunes: [], foeRunes: [] }],
};

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; useGame.setState({ inspect: null }); });

describe('Versus overlays never let an inspect through', () => {
  it('a right-click on an overlay board card opens its inspect with the round buffs; nothing else under it does', () => {
    const onClose = vi.fn();
    ui = mount(<VersusMatchStats record={record} onClose={onClose} />);
    // Round 2 is picked by default (the last): pick round 1, whose board carries the snapshot.
    act(() => { (document.querySelector('.vsms-pips .endpip') as HTMLButtonElement).click(); });
    const scrim = document.querySelector('.vsms-scrim')!;
    act(() => { scrim.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    expect(useGame.getState().inspect).toBeNull();
    const panel = document.querySelector('.mdd-panel')!;
    act(() => { panel.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    expect(useGame.getState().inspect).toBeNull();
    const card = document.querySelector('.vsms-side .cv2-tile:not(.empty) .card')!;
    act(() => { card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    const insp = useGame.getState().inspect;
    expect(insp?.attack).toBe(5);
    expect(insp?.buffs).toEqual([{ source: 'Tome', attack: 3, health: 4, count: 1 }]);
    // switching rounds closes it
    act(() => { (document.querySelectorAll('.vsms-pips .endpip')[1] as HTMLButtonElement).click(); });
    expect(useGame.getState().inspect).toBeNull();
    // Esc: the inspect first, then the overlay
    useGame.setState({ inspect: { name: 'x' } as never });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(useGame.getState().inspect).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an older round without snapshots shows the stored card, inspectable without a breakdown', () => {
    const old = { ...record, rounds: [{ ...record.rounds[0]!, mineSnap: undefined }] };
    ui = mount(<VersusMatchStats record={old} onClose={() => undefined} />);
    const card = document.querySelector('.vsms-side .cv2-tile:not(.empty) .card')!;
    act(() => { card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    expect(useGame.getState().inspect?.attack).toBe(5);
    expect(useGame.getState().inspect?.buffs).toBeUndefined();
  });

  it('shows VICTORY for a win (the lobby end screen numeral)', () => {
    ui = mount(<VersusMatchStats record={record} onClose={() => undefined} />);
    expect(document.querySelector('.vsms-verdict.won .endplace-num')?.textContent).toBe('Victory');
  });

  it('no "Previous match" heading or summary; each player row has a portrait, hearts and the round runes', () => {
    ui = mount(<VersusMatchStats record={{ ...record, myHero: 'warden', foeHero: 'indy' }} onClose={() => undefined} />);
    act(() => { (document.querySelector('.vsms-pips .endpip') as HTMLButtonElement).click(); }); // round 1
    expect(document.body.textContent).not.toMatch(/Previous match|Pick a round/);
    expect(document.querySelector('.mdd-head, .mdd-sub')).toBeNull();
    expect(document.querySelectorAll('.vsms-side .mds-portrait')).toHaveLength(2);
    expect([...document.querySelectorAll('.vsms-hearts')].map((n) => n.textContent)).toEqual(['6', '7']);
    const runeRows = [...document.querySelectorAll('.vsms-side .mds-runes')];
    expect(runeRows[0]!.querySelectorAll('.cv2-rune').length).toBe(1);
    expect(runeRows[1]!.querySelector('.mds-norunes')?.textContent).toBe('No runes');
  });

  it('opening or closing the stats closes an inspect left open', () => {
    useGame.setState({ inspect: { name: 'x' } as never });
    setVersusStatsOpen(true);
    expect(useGame.getState().inspect).toBeNull();
    useGame.setState({ inspect: { name: 'x' } as never });
    setVersusStatsOpen(false);
    expect(useGame.getState().inspect).toBeNull();
  });
});
