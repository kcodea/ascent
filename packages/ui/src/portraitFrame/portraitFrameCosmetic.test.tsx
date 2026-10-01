// @vitest-environment jsdom
/**
 * PORTRAIT FRAME COSMETICS on the portrait (owner 2026-10-01: "we're adding portrait skins ... we want this to
 * replace the default portrait png when a skin is applied"). Pins: every catalog frame has art + measured geometry;
 * a frame cosmetic id resolves to its ring for either side and wins over the tuner; YOUR equipped frame (the live
 * loadout) is what a `self` portrait wears with no explicit id; an opponent's recorded frame shows only while "Show
 * opponent cosmetics" is on; unknown / retired ids fall back to the default (today's look, or the tuner's).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { COSMETICS } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';

vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));

import { LbHeroFrame } from '../LadderBits';
import { opponentSkins } from '../skins/skins';
import { frameIdOf } from './PortraitFrame';
import {
  SKIN_FRAME_ART, SKIN_FRAME_IDS, frameGeometry, frameSrc, resetPortraitFrames, resolvePortraitFrame, setPortraitFrameState, NEUTRAL_FIT,
} from './portraitFrameConfig';
import { applyServerCatalogState, resetProgressionForTests, useProgression } from '../progression/progressionStore';

const FRAMES = COSMETICS.filter((c) => c.category === 'portrait_frame');
let m: Mounted | null = null;

beforeEach(() => { localStorage.clear(); resetPortraitFrames(); resetProgressionForTests(); });
afterEach(() => { m?.unmount(); m = null; resetPortraitFrames(); applyServerCatalogState(null, false); resetProgressionForTests(); });

const wear = (frame: string | null): void => {
  useProgression.setState({
    mirror: { userId: 'u-1', accountXp: 0, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [], cosmetics: frame ? [frame] : [], loadout: frame ? { portraitFrame: frame } : {} },
  });
};
const ringsIn = (el: HTMLElement): (string | undefined)[] => [...el.querySelectorAll<HTMLElement>('.pframe-box')].map((e) => e.dataset.frame);

describe('the frame art and its measured seat', () => {
  it('every catalog frame has its webp and a measured hole; nothing else is in the geometry file', () => {
    expect([...SKIN_FRAME_IDS].sort()).toEqual(FRAMES.map((c) => c.assets.art).sort());
    for (const c of FRAMES) {
      expect(frameSrc(c.id), c.id).toBeTruthy();
      const a = SKIN_FRAME_ART[c.id]!;
      expect(a.holeD, c.id).toBeGreaterThan(0.6);
      expect(a.holeD, c.id).toBeLessThan(0.95);
      expect(Math.abs(a.holeCx - 0.5), c.id).toBeLessThan(0.05);
      expect(Math.abs(a.holeCy - 0.5), c.id).toBeLessThan(0.05);
      expect(a.aspect, c.id).toBeGreaterThan(0.9);
      // the ring is wider than the disc it frames, and its hole is centred on the disc
      expect(frameGeometry(c.id, NEUTRAL_FIT).width, c.id).toBeGreaterThan(100);
    }
  });
});

describe('the resolver', () => {
  it('a frame cosmetic id resolves to its ring on either side and wins over the tuner; an unknown id falls back', () => {
    expect(resolvePortraitFrame('opp', 'frame_fire')?.id).toBe('frame_fire');
    expect(resolvePortraitFrame('self', 'frame_gold')?.id).toBe('frame_gold');
    expect(resolvePortraitFrame('opp', 'frame_not_real')).toBeNull(); // today's look
    setPortraitFrameState({ self: 'diamond', opp: 'diamond', same: false });
    expect(resolvePortraitFrame('opp', 'frame_water')?.id).toBe('frame_water');
    expect(resolvePortraitFrame('opp', 'frame_not_real')?.id).toBe('diamond');
    // referentially stable (memoised parents keep their props)
    expect(resolvePortraitFrame('opp', 'frame_water')).toBe(resolvePortraitFrame('self', 'frame_water'));
  });

  it('frameIdOf: the live frame of a snapshot; "Show opponent cosmetics" off drops it; retired drops it', () => {
    const snap = { portraitFrame: 'frame_reaper' };
    expect(frameIdOf(opponentSkins(true, snap))).toBe('frame_reaper');
    expect(frameIdOf(opponentSkins(false, snap))).toBeNull();
    expect(frameIdOf({ portraitFrame: 'frame_unknown' })).toBeNull();
    applyServerCatalogState({ retiredIds: ['frame_reaper'], disabledCategories: [] }, false);
    expect(frameIdOf(snap)).toBeNull();
  });
});

describe('a portrait wears it', () => {
  it('your own portrait (side self, no id) wears YOUR equipped frame; opponents never do; taking it off restores today\'s look', () => {
    wear('frame_gold');
    m = mount(<><LbHeroFrame heroId="albus" side="self" /><LbHeroFrame heroId="albus" /></>);
    expect(ringsIn(m.container)).toEqual(['frame_gold']);
    act(() => wear(null));
    expect(ringsIn(m.container)).toEqual([]);
    expect(m.container.querySelector('.pf-on')).toBeNull();
  });

  it('an opponent row wears its recorded frame only through the opponent cosmetics switch', () => {
    m = mount(<>
      <LbHeroFrame heroId="albus" frameId={frameIdOf(opponentSkins(true, { portraitFrame: 'frame_ice' }))} />
      <LbHeroFrame heroId="albus" frameId={frameIdOf(opponentSkins(false, { portraitFrame: 'frame_ice' }))} />
    </>);
    expect(ringsIn(m.container)).toEqual(['frame_ice']);
  });

  it('a retired equipped frame falls back to the default at once (the server kill switch)', () => {
    wear('frame_fire');
    m = mount(<LbHeroFrame heroId="albus" side="self" />);
    expect(ringsIn(m.container)).toEqual(['frame_fire']);
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: ['portrait_frame'] }, false));
    expect(ringsIn(m.container)).toEqual([]);
  });
});
