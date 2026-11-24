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

import { FLIP_LIFT, FLIP_LIFT_GUARANTEED, REVEAL_STACK_X, REVEALED_SCALE } from './cardFlip';
import { CARD_PLATE_SRC, FACE_H, FACE_W, PackFace, SLOT_X, SLOT_Y, edgePose, facePose, warmFaceArt } from './packFaces';
import { PackOpener, type PackOpenerProps, type PackOpenOutcome } from './PackOpener';
import type { PackSceneEvents } from './packScene';

const card = (rewardId: string, over: Partial<PackCard> = {}): PackCard => ({ rewardId, rarity: 'rare', guaranteed: false, duplicate: null, ...over });

let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; stageScale.s = 1; });
const face = (): HTMLElement => document.querySelector('[data-testid="pack-face"]') as HTMLElement;

describe('PackFace', () => {
  it('an art category renders its art with decoding="sync"', () => {
    m = mount(<PackFace card={card('skin_albus_1')} phase="featured" />);
    const img = face().querySelector('.pkf-art img')!;
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

  it('the ribbon carries the rarity medallion (decorative, decoding="sync") and Ancient reads Ancient', () => {
    m = mount(<PackFace card={card('alpha_tester', { rarity: 'ancient' })} phase="featured" />);
    const icon = face().querySelector('.pkf-ribbon img')!;
    expect(icon.getAttribute('decoding')).toBe('sync');
    expect(icon.getAttribute('alt')).toBe('');
    expect(icon.getAttribute('src')).toContain('medallions/ascent_rarity_ancient.webp');
    expect(face().querySelector('.pkf-ribbon')!.textContent).toBe('Ancient');
    expect(face().textContent).not.toContain('Ascendant');
  });

  it('every face wears the card plate (decorative, decoding="sync") with the content inside its window', () => {
    for (const id of ['skin_albus_1', 'alpha_tester', 'no_such_reward']) {
      m?.unmount();
      m = mount(<PackFace card={card(id)} phase="featured" />);
      const plate = face().querySelector('img.pkf-plate')!;
      expect(plate, id).toBeTruthy();
      expect(plate.getAttribute('src')).toBe(CARD_PLATE_SRC);
      expect(plate.getAttribute('src')).toContain('packs/cosmetic-card-plate.webp');
      expect(plate.getAttribute('decoding')).toBe('sync');
      expect(plate.getAttribute('alt')).toBe('');
      const win = face().querySelector('.pkf-win')!;
      for (const k of ['.pkf-cat', '.pkf-art', '.pkf-name', '.pkf-ribbon']) expect(win.querySelector(k), `${id} ${k}`).toBeTruthy();
    }
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

describe('the face poses', () => {
  const vp = { w: 1920, h: 1080 };
  const at = (cx: number, cy: number, w: number) => {
    const h = w * 1.5;
    return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2, x: cx - w / 2, y: cy - h / 2 };
  };

  it('the face is 2:3, the same shape as the plate and the scene card', () => {
    expect(FACE_W / FACE_H).toBeCloseTo(2 / 3);
  });

  it('the featured slot sits right of centre, the zoomed stack left of it, level with each other', () => {
    expect(SLOT_X).toBeGreaterThan(0.5);
    expect(REVEAL_STACK_X).toBeLessThan(0.5);
    expect(SLOT_Y).toBeGreaterThan(0.3);
    expect(SLOT_Y).toBeLessThan(0.6);
  });

  it('the featured pose is the handoff scale x REVEALED_SCALE (the lift taken out): slightly larger than the draw pile', () => {
    const from = at(700, 500, 520); // a zoomed back at edge-on, much bigger than the layout size
    const edge = edgePose(from, vp);
    expect(edge.sx).toBeCloseTo(520 / FACE_W);
    expect(edge.r).toBe(0);
    for (const [guaranteed, lift] of [[false, FLIP_LIFT], [true, FLIP_LIFT_GUARANTEED]] as const) {
      for (const phase of ['handoff', 'featured'] as const) {
        const p = facePose(phase, { index: 0, count: 5 }, from, vp, guaranteed);
        expect(p.sx, phase).toBeCloseTo((edge.sx / (1 + lift)) * REVEALED_SCALE);
        expect(p.sy, phase).toBeCloseTo((edge.sy / (1 + lift)) * REVEALED_SCALE);
        expect(p.x, phase).toBe(0); // at the slot, square
        expect(p.y, phase).toBe(0);
        expect(p.r, phase).toBe(0);
      }
    }
    expect(REVEALED_SCALE).toBeGreaterThan(1);
    expect(REVEALED_SCALE).toBeLessThan(1.25);
    // the edge pose sits on the back; the slot is to its right
    expect(edge.x).toBeCloseTo(700 - vp.w * SLOT_X);
    expect(edge.x).toBeLessThan(0);
  });

  it('earlier faces stack in the revealed pile at the top face size, nudged a few px and a degree or two', () => {
    const from = at(700, 500, 520);
    const top = facePose('featured', { index: 4, count: 5 }, from, vp);
    for (let i = 0; i < 4; i++) {
      const p = facePose('tray', { index: i, count: 5 }, from, vp);
      expect(p.sx).toBeCloseTo(top.sx);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(10);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(10);
      expect(Math.abs(p.r)).toBeGreaterThan(0);
      expect(Math.abs(p.r)).toBeLessThanOrEqual(3);
    }
  });

  it('the summary keeps its own smaller scale and lays every face out in one row centred in the theatre', () => {
    const from = at(700, 500, 520);
    const xs = [0, 1, 2, 3, 4].map((i) => facePose('summary', { index: i, count: 5 }, from, vp));
    for (const p of xs) { expect(p.sx).toBeLessThan(1); expect(p.y).toBe(xs[0]!.y); expect(p.r).toBe(0); }
    expect(xs[2]!.x + vp.w * SLOT_X).toBeCloseTo(vp.w / 2);
    for (let i = 1; i < 5; i++) expect(xs[i]!.x).toBeGreaterThan(xs[i - 1]!.x);
  });

  it('a handed-off face renders at the pile pose once it arrives', async () => {
    const from = at(700, 500, 520);
    m = mount(<PackFace card={card('alpha_tester')} phase="handoff" from={from} slot={{ index: 0, count: 5 }} />);
    await act(async () => { await Promise.resolve(); });
    const k = (520 / FACE_W / (1 + FLIP_LIFT)) * REVEALED_SCALE;
    const t = face().style.transform;
    expect(t).toContain('translate(0px, 0px) rotate(0deg)');
    const [sx, sy] = /scale\(([\d.]+), ([\d.]+)\)/.exec(t)!.slice(1).map(Number);
    expect(sx).toBeCloseTo(k);
    expect(sy).toBeCloseTo(k);
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
      // the card plate (once) + two art faces + the one shared rarity medallion (all four cards are rare)
      expect(held).toHaveLength(4);
      expect(decoded).toHaveLength(4);
      expect(held.filter((img) => img.src.includes('packs/cosmetic-card-plate.webp'))).toHaveLength(1);
      for (const img of held) expect(img.decoding).toBe('sync');
    } finally {
      HTMLImageElement.prototype.decode = orig;
    }
  });
});
