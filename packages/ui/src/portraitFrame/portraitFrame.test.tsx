// @vitest-environment jsdom
/**
 * HERO PORTRAIT FRAMES (dev tuner, owner ask 2026-09-29). Pins: production's baked default is today's look (no
 * frame anywhere); the player / opponent split and "same for everyone"; a per-player frame id (the ranked-reward
 * hook) wins; the fit dials clamp and can be overridden per frame; the default ring reproduces the old
 * `.portring` geometry; every hero-portrait surface goes through the ONE shared renderer; the ladder frame renders
 * the resolved ring per side; the tuner is registered; and the new CSS stays inside the scaled stage's rules.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { LbHeroFrame } from '../LadderBits';
import {
  FIT_RANGES,
  IMAGE_FRAME_IDS,
  PORTRAIT_FRAME_DEFAULTS,
  SPEC,
  clearFitOverride,
  effectiveFit,
  frameGeometry,
  frameSrc,
  getPortraitFrameState,
  readPortraitFrameView,
  resetPortraitFrames,
  resolveFrameChoice,
  resolvePortraitFrame,
  ringRelativeToDefault,
  sanitizePortraitFrameState,
  setPortraitFrameState,
  writePortraitFrameNumber,
  writePortraitFrameString,
  NEUTRAL_FIT,
} from './portraitFrameConfig';

const SRC = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

beforeEach(() => { localStorage.clear(); resetPortraitFrames(); });
afterEach(() => { resetPortraitFrames(); });

describe('baked production defaults', () => {
  it('ship today\'s look: no frame for you or your opponents', () => {
    expect(PORTRAIT_FRAME_DEFAULTS.self).toBe('current');
    expect(PORTRAIT_FRAME_DEFAULTS.opp).toBe('current');
    expect(resolvePortraitFrame('self')).toBeNull();
    expect(resolvePortraitFrame('opp')).toBeNull();
  });

  it('production never reads the tuner\'s localStorage', () => {
    const src = read('portraitFrame/portraitFrameConfig.ts');
    expect(src).toMatch(/if \(!import\.meta\.env\.DEV\) return sanitizePortraitFrameState\(DEFAULTS\)/);
  });

  it('every image frame has its art wired', () => {
    for (const id of IMAGE_FRAME_IDS) expect(frameSrc(id), id).toBeTruthy();
  });
});

describe('the player / opponent split', () => {
  it('each side resolves its own frame when "same for everyone" is off', () => {
    setPortraitFrameState({ self: 'gold', opp: 'diamond', same: false });
    expect(resolvePortraitFrame('self')?.id).toBe('gold');
    expect(resolvePortraitFrame('opp')?.id).toBe('diamond');
  });

  it('"same for everyone" puts your frame on opponents too', () => {
    setPortraitFrameState({ self: 'gold', opp: 'diamond', same: true });
    expect(resolvePortraitFrame('opp')?.id).toBe('gold');
  });

  it('a per-player frame id (the future ranked-reward hook) wins over the tuner; junk ids are ignored', () => {
    setPortraitFrameState({ self: 'gold', opp: 'diamond', same: false });
    expect(resolveFrameChoice('opp', 'rank1')).toBe('rank1');
    expect(resolveFrameChoice('opp', 'not-a-frame')).toBe('diamond');
    expect(resolvePortraitFrame('self', 'current')).toBeNull();
  });

  it('resolved frames are referentially stable until the tuner changes', () => {
    setPortraitFrameState({ self: 'gold' });
    const a = resolvePortraitFrame('self');
    expect(resolvePortraitFrame('self')).toBe(a);
    writePortraitFrameNumber('scale', 1.2);
    expect(resolvePortraitFrame('self')).not.toBe(a);
  });
});

describe('the tuner values', () => {
  it('defaults: global fit is neutral and the view reads the baked state', () => {
    expect(readPortraitFrameView()).toEqual({ self: 'current', opp: 'current', same: 1, fitTarget: 'all', ...NEUTRAL_FIT });
    expect(SPEC.defaults).toEqual(readPortraitFrameView());
  });

  it('clamps every fit dial to its range', () => {
    writePortraitFrameNumber('scale', 99);
    writePortraitFrameNumber('art', -5);
    writePortraitFrameNumber('dx', 1000);
    writePortraitFrameNumber('dy', -1000);
    expect(readPortraitFrameView()).toMatchObject({ scale: FIT_RANGES.scale[1], art: FIT_RANGES.art[0], dx: FIT_RANGES.dx[1], dy: FIT_RANGES.dy[0] });
  });

  it('sanitises stored junk back to valid values', () => {
    const s = sanitizePortraitFrameState({ self: 'emerald', opp: 42, same: 'yes', fitTarget: 'nope', fits: { gold: { scale: 'x', dx: 400 }, bogus: {} } });
    expect(s.self).toBe('current');
    expect(s.opp).toBe('current');
    expect(s.same).toBe(true);
    expect(s.fitTarget).toBe('all');
    expect(s.fits).toEqual({ gold: { scale: 1, art: 1, dx: FIT_RANGES.dx[1], dy: 0 } });
  });

  it('string writes only accept known frames', () => {
    writePortraitFrameString('self', 'gold');
    writePortraitFrameString('opp', 'emerald');
    expect(getPortraitFrameState().self).toBe('gold');
    expect(getPortraitFrameState().opp).toBe('current');
  });

  it('a per-frame fit override applies to that frame only, and clears back to the global fit', () => {
    writePortraitFrameNumber('scale', 1.1); // global
    writePortraitFrameString('fitTarget', 'gold');
    writePortraitFrameNumber('dx', 5);
    expect(effectiveFit('gold')).toEqual({ scale: 1.1, art: 1, dx: 5, dy: 0 });
    expect(effectiveFit('diamond')).toEqual({ scale: 1.1, art: 1, dx: 0, dy: 0 });
    clearFitOverride();
    expect(effectiveFit('gold')).toEqual(effectiveFit('diamond'));
  });

  it('reset drops the stored values', () => {
    setPortraitFrameState({ self: 'gold' });
    expect(localStorage.getItem('ascent.portraitframes')).not.toBeNull();
    resetPortraitFrames();
    expect(localStorage.getItem('ascent.portraitframes')).toBeNull();
    expect(resolvePortraitFrame('self')).toBeNull();
  });
});

describe('geometry', () => {
  it('the default ring reproduces the old .portring recipe (ring 1/0.9 of the disc, offset to its hole)', () => {
    const g = frameGeometry('default', NEUTRAL_FIT);
    expect(g.width).toBeCloseTo(100 / 0.9, 1);
    expect(g.cx).toBeCloseTo(50 + (0.5 - 0.496) * g.width, 3);
    expect(g.art).toBe(1);
  });

  it('scale grows the ring, offsets move its centre in % of the disc', () => {
    const a = frameGeometry('gold', NEUTRAL_FIT);
    const b = frameGeometry('gold', { scale: 1.2, art: 0.9, dx: 3, dy: -2 });
    expect(b.width).toBeCloseTo(a.width * 1.2, 5);
    expect(b.art).toBe(0.9);
    expect(b.cx - 50).toBeCloseTo((a.cx - 50) * 1.2 + 3, 5);
  });

  it('the hero ceremony ring is the default ring for the default frame', () => {
    setPortraitFrameState({ self: 'default' });
    const r = ringRelativeToDefault(resolvePortraitFrame('self')!);
    expect(r.size).toBeCloseTo(1, 6);
    expect(r.dx).toBeCloseTo(0, 6);
  });
});

describe('every hero-portrait surface goes through the shared renderer', () => {
  // [file, the side(s) it asks for]
  const SURFACES: [string, RegExp][] = [
    ['HeroSelect.tsx', /usePortraitFrame\('self'\)/],
    ['hero-select/HeroSelectCeremony.tsx', /usePortraitFrame\('self'\)/],
    ['StatusBar.tsx', /usePortraitFrame\('self'\)/],
    ['CombatOpponent.tsx', /usePortraitFrame\('opp'\)/],
    ['Recruit.tsx', /usePortraitFrame\('opp'\)/], // Now Facing
    ['LobbyPanel.tsx', /usePortraitFrame\('self'\)[\s\S]*usePortraitFrame\('opp'\)/],
    ['EndScreen.tsx', /usePortraitFrame\('self'\)/],
    ['FightRecap.tsx', /usePortraitFrame\('opp'\)/],
    ['OpponentFrame.tsx', /usePortraitFrame\('opp'\)/],
    // Career and the Collection's hero-skin preview paint the shared ring component, which asks for its side.
    ['portraitFrame/HeroPortraitRing.tsx', /usePortraitFrame\(side\)/],
    ['LadderBits.tsx', /usePortraitFrame\(side\)/], // Hall, Rankings, Recent Games
    ['matchDetails/MatchScoreboard.tsx', /usePortraitFrame\(self \? 'self' : 'opp'\)/],
    ['Title.tsx', /usePortraitFrame\('self'\)/],
  ];
  it.each(SURFACES)('%s', (file, side) => {
    const src = read(file);
    expect(src).toMatch(side);
    // The ceremony draws its own ring <img>; every other surface paints the shared component.
    if (!file.includes('Ceremony')) expect(src).toMatch(/<PortraitFrame frame=\{/);
  });

  it('Career passes its page owner side; the Collection previews a hero skin in the same ring as self', () => {
    expect(read('Career.tsx')).toMatch(/<HeroPortraitRing [^>]*side=\{useContext\(CareerSkinContext\)\.own \? 'self' : 'opp'\}/);
    expect(read('progression/CollectionScreen.tsx')).toMatch(/<HeroPortraitRing art=\{art\}/);
  });

  it('Rankings passes your own row as self', () => {
    expect(read('Rankings.tsx')).toMatch(/<LbHeroFrame heroId=\{r\.favoriteHero\} side=\{mine \? 'self' : 'opp'\} \/>/);
  });
});

describe('the ladder frame renders the resolved ring per side', () => {
  let m: Mounted | null = null;
  afterEach(() => { m?.unmount(); m = null; });

  it('current: the markup is exactly today\'s (no ring element, no pf-on)', () => {
    m = mount(<><LbHeroFrame heroId="albus" /><LbHeroFrame heroId="albus" side="self" /></>);
    expect(m.container.querySelector('.pframe-box')).toBeNull();
    expect(m.container.querySelector('.pf-on')).toBeNull();
  });

  it('gold for you, diamond for opponents, and a live swap re-renders', () => {
    setPortraitFrameState({ self: 'gold', opp: 'diamond', same: false });
    m = mount(<><LbHeroFrame heroId="albus" side="self" /><LbHeroFrame heroId="albus" /></>);
    const frames = [...m.container.querySelectorAll<HTMLElement>('.pframe-box')].map((e) => e.dataset.frame);
    expect(frames).toEqual(['gold', 'diamond']);
    expect(m.container.querySelectorAll('.lb-heroframe.pf-on')).toHaveLength(2);
    act(() => { setPortraitFrameState({ same: true }); });
    expect([...m.container.querySelectorAll<HTMLElement>('.pframe-box')].map((e) => e.dataset.frame)).toEqual(['gold', 'gold']);
    // The ring is a static <img> with an inline % box; the host carries the portrait scale var.
    const img = m.container.querySelector<HTMLImageElement>('.pframe')!;
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(img.style.width).toMatch(/%$/);
  });
});

describe('the tuner is registered and the CSS respects the scaled stage', () => {
  it('lives in the dev hub, the emblem table and the reset-all registry', () => {
    expect(read('DevMenu.tsx')).toMatch(/key: 'portraitframes'[^\n]*C: PortraitFrameTuner/);
    expect(read('tunerSchema.ts')).toMatch(/portraitframes: '/);
    expect(read('tunerAll.ts')).toMatch(/SPEC as PortraitFramesSpec[\s\S]*PortraitFramesSpec,/);
  });

  it('the frame CSS uses no raw vw / vh, no viewport @media, no looping animation and no plain cursor', () => {
    const css = read('styles.css');
    const block = css.slice(css.indexOf('HERO PORTRAIT FRAMES (dev tuner 2026-09-29'));
    expect(block.length).toBeGreaterThan(100);
    const body = block.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/(?<![\w-])-?[\d.]+[dsl]?v[wh]\b/);
    expect(body).not.toMatch(/@media/);
    expect(body).not.toMatch(/animation|transition/);
    expect(body).not.toMatch(/cursor:/);
  });

  it('the renderer never portals or measures layout', () => {
    for (const f of ['portraitFrame/PortraitFrame.tsx', 'portraitFrame/portraitFrameConfig.ts', 'PortraitFrameTuner.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/createPortal|getBoundingClientRect|document\.body\.append/);
      expect(src, f).not.toMatch(/\btitle=/);
    }
  });
});
