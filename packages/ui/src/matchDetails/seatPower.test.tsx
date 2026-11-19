/**
 * @vitest-environment jsdom
 *
 * R-RESULTS-ANCIENT-01: a finished game's detail shows the shown board's HERO POWER with its picked ANCIENT (the settled
 * split face, the power's name, the Ancient's name; the hover tip prints the power text and the Ancient's pairing text).
 * Picking a lobby seat swaps in THAT seat's power + Ancient. A game with no Ancient shows the plain power, and an old
 * record (no hero id, no lobby) never breaks.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ANCIENTS, ancientOfferText, getHero, type MatchDetails, type MatchSeat } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { GameDetail, type GameDetailProps } from '../partyHome/pages/gameView';
import { SeatPower } from './SeatPower';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ancientColor } from '../ancients/ancientsConfig';

const plain = (md: string): string => md.replace(/\*\*/g, '');
const seat = (id: string, name: string, heroId: string, over: Partial<MatchSeat> = {}): MatchSeat => ({ id, name, heroId, health: 0, armor: 0, board: null, ...over });
const match: MatchDetails = {
  v: 1, endRound: 12, placement: 1, eliminated: false,
  seats: [
    seat('s0', 'Orangez', 'darah', { self: true, ancient: { id: 'death', heroId: 'darah', wave: 6 } }),
    seat('s1', 'Rooks', 'indy', { placement: 2, eliminatedRound: 12, ancient: { id: 'fortune', heroId: 'indy', wave: 7 } }),
    seat('s2', 'Lemon', 'indy', { placement: 3, eliminatedRound: 10 }),
  ],
};
const props = (over: Partial<GameDetailProps> = {}): GameDetailProps => ({
  place: 1, who: 'Orangez', heroName: 'Darah', record: '9-4', recordTone: 'up', rank: null, facts: [],
  match, own: true, skins: null, runes: [], replay: null, ...over,
});

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const q = (sel: string): Element | null => ui!.container.querySelector(sel);

describe('the results page shows the hero power with its Ancient (R-RESULTS-ANCIENT-01)', () => {
  it('the power plate: the split face, the power name, the Ancient name, and the pairing text in the tip', () => {
    ui = mount(<SeatPower heroId="darah" ancient={{ id: 'death', heroId: 'darah' }} who="Orangez" />);
    expect(q('.rgp-power .heropowerbtn .anc-split')).not.toBeNull();
    expect(q('.rgp-power-name')?.textContent).toBe(getHero('darah').power.name);
    expect(q('.rgp-power-anc')?.textContent).toBe(ANCIENTS.death.name);
    expect(q('.rgp-power-pop .herotip-anc')?.textContent).toBe(`(${ANCIENTS.death.name.replace(/^Ancient of /, '')})`);
    expect(q('.rgp-power-pop .herotip-rule')?.textContent).toBe(plain(getHero('darah').power.text));
    expect(q('.rgp-power-pop .foe-ancient-rule')?.textContent).toBe(plain(ancientOfferText('darah', 'death')));
    expect(q('.rgp-power')?.getAttribute('title')).toBeNull();
  });

  it('no Ancient: the plain power, no split and no pairing line', () => {
    ui = mount(<SeatPower heroId="darah" ancient={undefined} who="Orangez" />);
    expect(q('.rgp-power-name')?.textContent).toBe(getHero('darah').power.name);
    expect(q('.anc-split')).toBeNull();
    expect(q('.rgp-power-anc')).toBeNull();
    expect(q('.foe-ancient')).toBeNull();
  });

  it('an unknown Ancient id from another build reads as no Ancient; no hero id renders nothing', () => {
    ui = mount(<SeatPower heroId="darah" ancient={{ id: 'nope' as never, heroId: 'darah' }} who="Orangez" />);
    expect(q('.anc-split')).toBeNull();
    ui.unmount();
    ui = mount(<SeatPower heroId={undefined} who="Orangez" />);
    expect(ui.container.innerHTML).toBe('');
  });

  it('the game detail shows your own seat, then the picked seat, and the lobby tiles carry the Ancient badge', () => {
    ui = mount(<GameDetail {...props()} />);
    expect(q('.rgp-runes .rgp-power-anc')?.textContent).toBe(ANCIENTS.death.name);
    // R-LOBBY-TILE-ANCIENT-01: the face in the hero power frame at the head's right end, never on the portrait.
    expect(ui.container.querySelectorAll('.lp-tile .lp-tile-head > .heropowerbtn.lp-tile-anc .hpb-artwrap .anc-face').length).toBe(2);
    expect(ui.container.querySelectorAll('.lp-chip-portrait .lp-tile-anc').length).toBe(0);
    expect(q('.lp-tile[data-seat="s2"] .lp-tile-anc')).toBeNull();
    act(() => { (q('.lp-tile[data-seat="s1"]') as HTMLButtonElement).click(); });
    expect(q('.rgp-runes .rgp-power-name')?.textContent).toBe(getHero('indy').power.name);
    expect(q('.rgp-runes .rgp-power-anc')?.textContent).toBe(ANCIENTS.fortune.name);
    act(() => { (q('.lp-tile[data-seat="s2"]') as HTMLButtonElement).click(); });
    expect(q('.rgp-runes .rgp-power-name')?.textContent).toBe(getHero('indy').power.name);
    expect(q('.rgp-runes .rgp-power-anc')).toBeNull();
  });

  it('an old record with no lobby reads the Ancient off its stored board; none at all = the plain power', () => {
    ui = mount(<GameDetail {...props({ match: null, heroId: 'darah', ancient: { id: 'death', heroId: 'darah' } })} />);
    expect(q('.rgp-runes .rgp-power-anc')?.textContent).toBe(ANCIENTS.death.name);
    ui.render(<GameDetail {...props({ match: null, heroId: 'darah', ancient: null })} />);
    expect(q('.rgp-runes .rgp-power-name')?.textContent).toBe(getHero('darah').power.name);
    expect(q('.rgp-runes .rgp-power-anc')).toBeNull();
  });

  // R-ANCIENT-COLOUR-01 (owner 2026-11-19): the tip's "(Bonds)" tag and the "Ancient of Bonds" heading (and the pill's
  // label) are ONE colour: exactly ancientColor, with no filter or white mix in their CSS to make them drift.
  it("the tip tag, the Ancient heading and the pill label all print exactly the Ancient's name colour", () => {
    for (const id of ['bonds', 'death'] as const) {
      ui?.unmount();
      ui = mount(<SeatPower heroId="xerox" ancient={{ id, heroId: 'xerox' }} who="Claudebot1" />);
      const tag = (q('.rgp-power-pop .herotip-anc') as HTMLElement).style.color;
      const head = (q('.rgp-power-pop .foe-ancient-name') as HTMLElement).style.color;
      const pill = (q('.rgp-power-anc') as HTMLElement).style.getPropertyValue('--anc-c');
      const want = (() => { const el = document.createElement('i'); el.style.color = ancientColor(id); return el.style.color; })();
      expect(tag).toBe(want);
      expect(head).toBe(want);
      expect(pill).toBe(ancientColor(id));
    }
    const src = join(dirname(fileURLToPath(import.meta.url)), '..');
    const rule = (file: string, sel: string): string => {
      const css = readFileSync(join(src, file), 'utf8');
      const at = css.indexOf(`${sel} {`);
      expect(at, `${sel} in ${file}`).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(rule('styles.css', '.herotip-anc')).not.toMatch(/filter|color-mix/);
    expect(rule('ancients/ancients.css', '.foe-ancient-name')).not.toMatch(/filter|color-mix/);
    expect(rule('partyHome/pages/gamesPages.css', '.rgp-power-anc')).toMatch(/color: var\(--anc-c\);/);
  });
});
