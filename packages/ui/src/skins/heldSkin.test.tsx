// @vitest-environment jsdom
/**
 * R-PROG-SKINS-17 (owner report 2026-10-15): "skins work but when a player grabs a minion with a skin, the minion shows
 * default art until played." Every surface that draws a minion card resolves the skin through the SAME scope the board
 * uses (`MinionSkins` -> `useMinionSkinMap`), including the layers mounted OUTSIDE Game's main scope:
 *  - the hand card and the card dragged out of the hand / shop (inside the run's scope; a portal keeps it);
 *  - the replay's drag ghost and the live-watch cursor's held card (outside it: `RunSkins` in Game.tsx);
 *  - right-click Inspect, which carries the skin the card wore where it was clicked (a foe's card keeps the foe's);
 *  - the ladder's final-team tiles (the board's recorded skins, through "Show opponent skins").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createPortal } from 'react-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX } from '@game/content';
import { cosmeticOf, type RunCosmeticSnapshot } from '@game/progression';
import type { BoardSnapshot } from '@game/sim';

vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));

import { Card, inspectViewOf, type CardView } from '../Card';
import { mount } from '../renderedText.mount';
import { artFor } from '../art';
import { useGame } from '../store';
import { resetProgressionForTests } from '../progression/progressionStore';
import { ReplayDragGhost } from '../replay/ReplayDragGhost';
import { Inspect } from '../Inspect';
import { LbTeam } from '../LadderBits';
import { MinionSkins, OwnSkins, RunSkins, skinArtOf } from './skins';

const m = mount(<div />);
const baseRun = useGame.getState().run;
beforeEach(() => { resetProgressionForTests(); localStorage.clear(); useGame.setState({ showOpponentSkins: true, replayDragGhost: null, inspect: null }); });
afterEach(() => { m.render(<div />); useGame.setState({ run: baseRun, replayDragGhost: null, inspect: null }); resetProgressionForTests(); });

const brian = (): CardView => {
  const d = CARD_INDEX.blackbelt!;
  return { name: d.name, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [], golden: false, text: d.text ?? '', tier: d.tier };
};
const MINE: RunCosmeticSnapshot = { minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } };
const FOE: RunCosmeticSnapshot = { minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } };
const mineUrl = skinArtOf(cosmeticOf('skin_blackbelt_2'))!;
const foeUrl = skinArtOf(cosmeticOf('skin_blackbelt_1'))!;
const defaultUrl = artFor('blackbelt')!;
const wearing = (snap: RunCosmeticSnapshot | null): void => useGame.setState({ run: { ...useGame.getState().run, cosmetics: snap ?? undefined } });
const srcIn = (root: ParentNode, sel: string): string | null => root.querySelector<HTMLImageElement>(`${sel} img.artimg`)?.getAttribute('src') ?? null;

describe('R-PROG-SKINS-17: a held minion wears its skin', () => {
  it('the three skin urls are distinct, so the assertions below can tell them apart', () => {
    expect(new Set([mineUrl, foeUrl, defaultUrl]).size).toBe(3);
  });

  it('the HAND card and the card dragged out of the hand paint the run\'s skin (the drag card is portaled, the scope follows it)', () => {
    wearing(MINE);
    m.render(
      <OwnSkins live={false}>
        <div className="handzone"><Card card={brian()} uid="h1" forceFull plated /></div>
        {createPortal(<div className="dragcard"><Card card={brian()} forceFull plated /></div>, document.body)}
      </OwnSkins>,
    );
    expect(srcIn(m.container, '.handzone')).toBe(mineUrl);
    expect(srcIn(document.body, '.dragcard')).toBe(mineUrl);
  });

  it('the REPLAY drag ghost wears the recorded run\'s skin under RunSkins; outside any scope it was default art (the bug)', () => {
    wearing(MINE);
    const ghost = { cardId: 'blackbelt', uid: 'h1', durMs: 400, pts: [[0.5, 0.9], [0.5, 0.5]] as [number, number][], key: 1, view: brian(), fromHand: true };
    act(() => useGame.setState({ replayDragGhost: ghost }));
    m.render(<ReplayDragGhost />);
    expect(srcIn(m.container, '.replay-dragghost')).toBe(defaultUrl);
    m.render(<RunSkins><ReplayDragGhost /></RunSkins>);
    expect(srcIn(m.container, '.replay-dragghost')).toBe(mineUrl);
  });

  it('Game.tsx mounts every out-of-scope layer that draws a held card (replay ghost, live-watch cursor) inside RunSkins', () => {
    const src = readFileSync(join(__dirname, '..', 'Game.tsx'), 'utf8');
    const blocks: [number, number][] = [];
    for (let i = src.indexOf('<RunSkins>'); i >= 0; i = src.indexOf('<RunSkins>', i + 1)) blocks.push([i, src.indexOf('</RunSkins>', i)]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const tag of ['<ReplayDragGhost />', '<ReplayCursorGhost />', '<LiveWatchBar />']) {
      const at = src.indexOf(tag);
      expect(at, `${tag} is mounted`).toBeGreaterThan(0);
      expect(blocks.some(([a, b]) => at > a && at < b), `${tag} sits inside <RunSkins>`).toBe(true);
    }
  });

  it('Inspect shows the skin the card wore where it was right-clicked: a foe\'s skin stays the foe\'s, an unskinned foe card stays default', () => {
    wearing(MINE);
    m.render(<MinionSkins snapshot={FOE}><Card card={brian()} /></MinionSkins>);
    act(() => { m.container.querySelector('.card')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    expect(useGame.getState().inspect?.skinArt).toBe(foeUrl);
    m.render(<OwnSkins live={false}><Inspect /></OwnSkins>);
    expect(srcIn(document.body, '.inspect-card')).toBe(foeUrl);
    // A foe card with NO skin, inspected while you own one for it: default art, never yours.
    act(() => useGame.setState({ inspect: inspectViewOf(brian(), undefined) }));
    expect(srcIn(document.body, '.inspect-card')).toBe(defaultUrl);
    // Your own card: your skin.
    act(() => useGame.setState({ inspect: inspectViewOf(brian(), mineUrl) }));
    expect(srcIn(document.body, '.inspect-card')).toBe(mineUrl);
  });

  it('the ladder\'s final-team tiles wear the board\'s recorded skins, and "Show opponent skins" off blanks them', () => {
    const d = CARD_INDEX.blackbelt!;
    const board = { heroId: 'albus', minions: [{ cardId: 'blackbelt', attack: d.attack, health: d.health, keywords: [], golden: false }], cosmetics: FOE } as unknown as BoardSnapshot;
    m.render(<LbTeam board={board} />);
    expect(srcIn(m.container, '.lb-team')).toBe(foeUrl);
    act(() => useGame.setState({ showOpponentSkins: false }));
    expect(srcIn(m.container, '.lb-team')).toBe(defaultUrl);
  });
});
