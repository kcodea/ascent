// @vitest-environment jsdom
/**
 * A FOE'S ANCIENT under its hero power (R-ANCIENTS-RELEASE-03): the combat foe's power tip and the rail's scout card
 * render `FoeAncientLine` off the board's captured `BoardSnapshot.ancient`. It names the Ancient and prints the pairing
 * text for the hero it was picked for; a board with no Ancient (none picked, an older capture) renders nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANCIENTS, ancientOfferText } from '@game/sim';
import { FoeAncientLine } from './FoeAncientLine';
import { mount, type Mounted } from '../renderedText.mount';

const plain = (md: string): string => md.replace(/\*\*/g, '');

describe('FoeAncientLine', () => {
  let m: Mounted | null = null;
  afterEach(() => { m?.unmount(); m = null; });

  it('names the Ancient and prints its pairing text for the pairing hero', () => {
    m = mount(<FoeAncientLine ancient={{ id: 'fortune', heroId: 'indy', wave: 9 }} />);
    expect(m.container.querySelector('.foe-ancient-name')?.textContent).toBe(ANCIENTS.fortune.name);
    expect(m.container.querySelector('.foe-ancient-rule')?.textContent).toBe(plain(ancientOfferText('indy', 'fortune')));
  });

  it('renders nothing for a board with no Ancient', () => {
    m = mount(<FoeAncientLine ancient={undefined} />);
    expect(m.container.innerHTML).toBe('');
  });

  it('is wired under the foe power in combat and on the scout card', () => {
    const combat = readFileSync(join(__dirname, '..', 'CombatOpponent.tsx'), 'utf8');
    const rail = readFileSync(join(__dirname, '..', 'LobbyPanel.tsx'), 'utf8');
    const card = readFileSync(join(__dirname, '..', 'RailScoutShowcase.tsx'), 'utf8');
    expect(combat).toContain('<FoeAncientLine ancient={next.board.snapshot?.ancient} />');
    // The rail's scout card hands the seat's Ancient to its showcase top (R-RAIL-SCOUT-SHOWCASE-01), which prints it.
    expect(rail).toContain('ancient={intel?.ancient}');
    expect(card).toContain('<FoeAncientLine ancient={anc} />');
  });
});
