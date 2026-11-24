// @vitest-environment jsdom
/**
 * The pack card faces (Task 8): one layout per face (category label, art or emblem, name, rarity ribbon, NEW or
 * DUPLICATE + Aether), the unknown-reward face, the edge-on handoff measured at the edge event, and the art warm-up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { PackCard, PackOpenResult } from '@game/progression';
import { mount, type Mounted } from '../../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

// rectToStage with a scale the test can change between mount and the edge event.
const stageScale = vi.hoisted(() => ({ s: 1 }));
vi.mock('../../stage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../stage')>();
  return {
    ...real,
    rectToStage: (r: { left: number; top: number; width: number; height: number }) => {
      const k = stageScale.s;
      const left = r.left / k, top = r.top / k, width = r.width / k, height = r.height / k;
      return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
    },
  };
});
vi.mock('./packSounds', () => ({
  createPackSounds: () => new Proxy({}, { get: () => () => undefined }),
}));

import { PackFace, warmFaceArt } from './packFaces';
import { PackOpener, type PackOpenerProps, type PackOpenOutcome } from './PackOpener';
import type { PackSceneEvents } from './packScene';

const card = (rewardId: string, over: Partial<PackCard> = {}): PackCard => ({ rewardId, rarity: 'rare', guaranteed: false, duplicate: null, ...over });

let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; stageScale.s = 1; });
const face = (): HTMLElement => document.querySelector('[data-testid="pack-face"]') as HTMLElement;

describe('PackFace', () => {
  it('an art category renders its art with decoding="sync"', () => {
    m = mount(<PackFace card={card('skin_albus_1')} phase="featured" />);
    const img = face().querySelector('img')!;
    expect(img).toBeTruthy();
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(img.getAttribute('src')).toBeTruthy();
    expect(face().querySelector('.pkf-emblem')).toBeNull();
    expect(face().querySelector('.pkf-cat')!.textContent).toBe('Hero skin');
  });

  it('an emblem category renders its emblem and no img', () => {
    m = mount(<PackFace card={card('alpha_tester')} phase="featured" />);
    expect(face().querySelector('.pkf-art img')).toBeNull();
    const svg = face().querySelector('.pkf-emblem svg')!;
    expect(svg).toBeTruthy();
    expect(face().querySelector('.pkf-emblem')!.getAttribute('data-emblem')).toBe('title');
    expect(face().querySelector('.pkf-cat')!.textContent).toBe('Title');
  });

  it('an unknown reward renders the update-the-game face', () => {
    m = mount(<PackFace card={card('no_such_reward')} phase="featured" />);
    expect(face().querySelector('.pkf-art img')).toBeNull();
    expect(face().querySelector('.pkf-emblem')!.getAttribute('data-emblem')).toBe('unknown');
    expect(face().querySelector('.pkf-name')!.textContent).toBe('New reward');
    expect(face().textContent).toContain('Update the game to see it');
  });

  it('a duplicate shows the stamp and +N Aether, a new card shows NEW', () => {
    m = mount(<PackFace card={card('alpha_tester', { duplicate: { aether: 25 } })} phase="featured" />);
    expect(face().querySelector('.pkf-dup')!.textContent).toContain('Duplicate');
    expect(face().querySelector('.pkf-aether')!.textContent).toBe('+25 Aether');
    expect(face().querySelector('.pkf-new')).toBeNull();
    m.render(<PackFace card={card('alpha_tester')} phase="featured" />);
    expect(face().querySelector('.pkf-new')!.textContent).toBe('New');
    expect(face().querySelector('.pkf-dup')).toBeNull();
  });

  it('shows the rarity ribbon and puts the breathing glow only on a featured Legendary / Ancient', () => {
    m = mount(<PackFace card={card('alpha_tester', { rarity: 'legendary' })} phase="featured" />);
    expect(face().querySelector('.pkf-ribbon')!.textContent).toBe('Legendary');
    expect(face().classList.contains('pkf-glow')).toBe(true);
    m.render(<PackFace card={card('alpha_tester', { rarity: 'legendary' })} phase="tray" />);
    expect(face().classList.contains('pkf-glow')).toBe(false);
    m.render(<PackFace card={card('alpha_tester', { rarity: 'epic' })} phase="featured" />);
    expect(face().classList.contains('pkf-glow')).toBe(false);
  });

  it('the ribbon carries the rarity medallion (decorative, decoding="sync") and Ancient reads Ascendant', () => {
    m = mount(<PackFace card={card('alpha_tester', { rarity: 'ancient' })} phase="featured" />);
    const icon = face().querySelector('.pkf-ribbon img')!;
    expect(icon.getAttribute('decoding')).toBe('sync');
    expect(icon.getAttribute('alt')).toBe('');
    expect(icon.getAttribute('src')).toContain('medallions/ascent_rarity_ancient.webp');
    expect(face().querySelector('.pkf-ribbon')!.textContent).toBe('Ascendant');
    expect(face().textContent).not.toContain('Ancient');
  });

  it('no title attribute and no inline cursor style', () => {
    const ids = ['skin_albus_1', 'alpha_tester', 'announcer_lemon', 'attack_blast', 'emote_hi', 'no_such_reward'];
    for (const phase of ['handoff', 'featured', 'tray', 'summary'] as const) {
      for (const id of ids) {
        m?.unmount();
        m = mount(<PackFace card={card(id, { duplicate: { aether: 5 } })} phase={phase} slot={{ index: 0, count: 5 }}
          from={{ left: 1, top: 2, width: 100, height: 150, right: 101, bottom: 152, x: 1, y: 2 }} />);
        const root = face();
        expect(root.querySelectorAll('[title]')).toHaveLength(0);
        expect(root.querySelectorAll('title')).toHaveLength(0);
        for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) expect(el.style?.cursor ?? '').toBe('');
        for (const img of root.querySelectorAll('img')) expect(img.getAttribute('decoding')).toBe('sync');
      }
    }
  });
});

describe('the handoff', () => {
  const LOOK = { kind: 'rarity', id: 'rare', name: 'Rare Pack', guaranteedFloor: 'rare' } as const;
  let events: PackSceneEvents | null = null;
  const sceneFactory: NonNullable<PackOpenerProps['sceneFactory']> = (_h, _l, _n, _s, ev) => {
    events = ev;
    return { setBacks: () => undefined, flipTop: () => true, quickOpen: () => undefined, resetSealed: () => undefined,
      setInputEnabled: () => undefined, setSpeed: () => undefined, destroy: () => undefined };
  };
  beforeEach(() => { events = null; });

  it('the handoff face starts at rectToStage(rect) computed at the edge event', async () => {
    let resolve: ((o: PackOpenOutcome) => void) | null = null;
    const open = (): Promise<PackOpenOutcome> => new Promise((r) => { resolve = r; });
    m = mount(<PackOpener queue={[{ packId: 'p1', look: LOOK }]} open={open} sceneFactory={sceneFactory} reducedMotion={false} />);
    act(() => { events!.onPop(); events!.onStripFree(); events!.onSleeveDropped(); events!.onZoomed(); });
    const result: PackOpenResult = { packId: 'p1', pack: LOOK, cards: [card('alpha_tester'), card('skin_albus_1', { guaranteed: true })] };
    await act(async () => { resolve!({ status: 'ok', result }); await Promise.resolve(); });
    // The window is resized between mount and the edge: the LATER scale must be used.
    stageScale.s = 2;
    act(() => { document.querySelector('.pkop-fx')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    act(() => { events!.onFlipEdge(0, { left: 100, top: 40, width: 200, height: 300 }); });
    const f = document.querySelector('[data-testid="pack-face"][data-phase="handoff"]') as HTMLElement;
    expect(f).toBeTruthy();
    expect(f.getAttribute('data-from')).toBe('50,20,100,150');
  });
});

describe('warmFaceArt', () => {
  it('decodes each art face once and skips emblem faces', () => {
    const decoded: string[] = [];
    const orig = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function (this: HTMLImageElement) { decoded.push(this.src); return Promise.resolve(); };
    try {
      const held = warmFaceArt([card('skin_albus_1'), card('alpha_tester'), card('emote_hi'), card('no_such_reward')]);
      // two art faces + the one shared rarity medallion (all four cards are rare)
      expect(held).toHaveLength(3);
      expect(decoded).toHaveLength(3);
      for (const img of held) expect(img.decoding).toBe('sync');
    } finally {
      HTMLImageElement.prototype.decode = orig;
    }
  });
});
