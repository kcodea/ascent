/**
 * @vitest-environment jsdom
 *
 * R-LOBBY-PICKER-VIEWER-01: a recorded lobby's own seat is "You" only for the player who recorded it. Viewing someone
 * else's game (Recent Games, another player's Career) names that seat by its recorded name, says "IonLime's board" over
 * the board, "Back to IonLime's", and "Knocked IonLime out" on the seat that did.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchDetails, MatchSeat } from '@game/sim';
import { HEROES } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { LobbyTiles, ShowingLine, seatName } from './LobbyPicker';

const H = HEROES[0]!.id;
const seat = (id: string, name: string, placement: number | undefined, over: Partial<MatchSeat> = {}): MatchSeat => ({
  id, name, heroId: H, health: 0, armor: 0, board: null, ...(placement !== undefined ? { placement } : {}), ...over,
});
const details: MatchDetails = {
  v: 1, endRound: 13, placement: 1, eliminated: false, knockedOutBy: undefined,
  seats: [seat('me', 'IonLime', undefined, { self: true }), seat('s2', 'Orangez', 2, { eliminatedRound: 13 }), seat('s3', 'Rooks', 3, { eliminatedRound: 11 })],
} as MatchDetails;
const lostTo: MatchDetails = { ...details, placement: 4, eliminated: true, knockedOutBy: 's2' } as MatchDetails;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const names = (): string[] => [...ui!.container.querySelectorAll('.lp-chip-name')].map((n) => n.textContent ?? '');

describe('the lobby picker names the recorded player by who is looking (R-LOBBY-PICKER-VIEWER-01)', () => {
  it('your own game: your seat is You and the board line says Your board', () => {
    ui = mount(<><ShowingLine seat={null} details={details} onBack={() => {}} own /><LobbyTiles details={details} selectedId={null} onPick={() => {}} own /></>);
    expect(names()).toEqual(['You', 'Orangez', 'Rooks']);
    expect(ui.container.querySelector('.lp-showing-v')?.textContent).toBe('Your board');
    expect(ui.container.querySelector('.lp-tile.self')).not.toBeNull();
  });
  it('someone else\'s game: their seat is their name, never You', () => {
    ui = mount(<><ShowingLine seat={null} details={details} onBack={() => {}} own={false} /><LobbyTiles details={details} selectedId={null} onPick={() => {}} own={false} /></>);
    expect(names()).toEqual(['IonLime', 'Orangez', 'Rooks']);
    expect(ui.container.querySelector('.lp-showing-v')?.textContent).toBe('IonLime\'s board');
    expect(ui.container.querySelector('.lp-tile.self')).toBeNull();
    expect(ui.container.textContent).not.toMatch(/\bYou\b|\byour\b/i);
  });
  it('someone else\'s game: picking a seat offers Back to their board, and the killer reads Knocked IonLime out', () => {
    ui = mount(<><ShowingLine seat={lostTo.seats[1]!} details={lostTo} onBack={() => {}} own={false} /><LobbyTiles details={lostTo} selectedId="s2" onPick={() => {}} own={false} /></>);
    expect(ui.container.querySelector('.lp-back')?.textContent).toMatch(/Back to IonLime's$/);
    expect(ui.container.querySelector('[data-seat="s2"]')?.getAttribute('aria-label')).toMatch(/Knocked IonLime out\./);
    ui.render(<LobbyTiles details={lostTo} selectedId="s2" onPick={() => {}} own />);
    expect(ui.container.querySelector('[data-seat="s2"]')?.getAttribute('aria-label')).toMatch(/Knocked you out\./);
    expect(ui.container.querySelector('[data-seat="s2"]')?.getAttribute('aria-label')).toMatch(/Knocked IonLime out\./);
    ui.render(<LobbyTiles details={lostTo} selectedId="s2" onPick={() => {}} own />);
    expect(ui.container.querySelector('[data-seat="s2"]')?.getAttribute('aria-label')).toMatch(/Knocked you out\./);
  });
  it('a seat still standing reads Still in once, and a seat that is out keeps its fate (R-LOBBY-TILE-STILL-IN-01)', () => {
    const open: MatchDetails = { ...details, placement: 0, seats: [seat('me', 'IonLime', undefined, { self: true }), seat('s2', 'Orangez', undefined), seat('s3', 'Rooks', 7, { eliminatedRound: 11 })] } as MatchDetails;
    ui = mount(<LobbyTiles details={open} selectedId={null} onPick={() => {}} own={false} />);
    const places = [...ui.container.querySelectorAll('.lp-chip-place')].map((n) => n.textContent);
    expect(places).toEqual(['Still in', 'Still in', '7thOut R11']);
    expect(ui.container.querySelector('[data-seat="s2"]')?.getAttribute('aria-label')).not.toMatch(/Still in.*Still in/);
  });
  it('seatName is You only for the recorded seat of your own game', () => {
    expect(seatName(details.seats[0]!, true)).toBe('You');
    expect(seatName(details.seats[0]!, false)).toBe('IonLime');
    expect(seatName(details.seats[1]!, true)).toBe('Orangez');
  });
});
