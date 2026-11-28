// @vitest-environment jsdom
/**
 * The title's Collection plaque follows the same switches as the party home's top bar (PhTopNav): with packs on it shows
 * even while the crate switch is off, and its hover text never says packs open there (they open only in the Shop).
 * Final pack-economy review 2026-11-28.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from './renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./remoteBoards', async (importOriginal) => ({ ...(await importOriginal<typeof import('./remoteBoards')>()), remoteEnabled: () => false }));
// The old title menu (a production build always wears the party home; a DEV client can turn it off to compare).
vi.mock('./partyHome/partyHomeFlag', async (importOriginal) => ({ ...(await importOriginal<typeof import('./partyHome/partyHomeFlag')>()), usePartyHome: () => false }));

import { Title } from './Title';
import { useGame } from './store';
import { useProgression } from './progression/progressionStore';

let ui: Mounted | null = null;
const collectionButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('.titlenav .menubtn')].find((b) => b.querySelector('.mblabel')?.textContent === 'Collection');

beforeEach(() => {
  vi.stubEnv('DEV', false); // the DEV build always shows the plaque; check the switches a player's build reads
  useGame.setState({ showTitle: true, titleView: 'menu', savedRun: null });
});
afterEach(() => {
  ui?.unmount(); ui = null;
  vi.unstubAllEnvs();
  useProgression.setState({ capability: 'off', cratesCapability: 'off', packsCapability: 'off' });
});

describe('the title Collection plaque', () => {
  it('shows with packs on while the crate switch is off, and its tip does not send you there to open packs', () => {
    useProgression.setState({ capability: 'on', cratesCapability: 'off', packsCapability: 'on' });
    ui = mount(<Title onSettings={() => {}} />);
    const btn = collectionButton();
    expect(btn).toBeDefined();
    expect(btn!.dataset.tip).not.toMatch(/open your packs/i);
    expect(btn!.dataset.tip).toBe('Wear your titles, skins and other cosmetics');
  });

  it('stays hidden with both switches off', () => {
    useProgression.setState({ capability: 'on', cratesCapability: 'off', packsCapability: 'off' });
    ui = mount(<Title onSettings={() => {}} />);
    expect(collectionButton()).toBeUndefined();
  });
});
