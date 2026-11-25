// @vitest-environment jsdom
/**
 * The pack card faces (Task 8): one layout per face (category label, art or emblem, name, rarity ribbon, NEW or
 * DUPLICATE + Aether), the unknown-reward face, the edge-on handoff measured at the edge event, and the art warm-up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

import { FLIP_LIFT, FLIP_LIFT_GUARANTEED, PILE_MAX_H, REVEAL_STACK_X, REVEALED_SCALE } from './cardFlip';
import { cardPlateSrc } from './packRarity';
import { FACE_H, FACE_W, PackFace, SLOT_X, SLOT_Y, edgePose, facePose, warmFaceArt } from './packFaces';
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
    // a hero skin sits in the portrait ring it wears in a game (the Collection's piece), with no cosmetic frame
    expect(face().querySelector('.pkf-art .cv2-heroframe.pkf-heroring img.heroimg')).toBeTruthy();
  });

  it('a title has no art window: the painted Titles medallion over the title in its own badge (owner 2026-11-24)', () => {
    m = mount(<PackFace card={card('alpha_tester')} phase="featured" />);
    const art = face().querySelector('.pkf-art')!;
    expect(art.classList.contains('pkf-art-bare')).toBe(true);
    expect(art.querySelector('.pkf-emblem')!.getAttribute('data-emblem')).toBe('title');
    expect(art.querySelector('.pkf-emblem img.pkf-medal')!.getAttribute('src')).toContain('menu/titles.webp');
    expect(art.querySelector('.pkf-emblem svg')).toBeNull();
    const badge = art.querySelector('.titlebadge.pkf-title')!;
    expect(badge.textContent).toBe('Alpha Tester');
    expect(face().querySelector('.pkf-name')).toBeNull(); // the badge is the name
    expect(face().querySelector('.pkf-cat')!.textContent).toBe('Title');
  });

  it('the cosmetic type sits under the rarity, white between rules of the rarity colour, and a card plate is cropped from its top like the Collection tile (owner 2026-11-24)', () => {
    m = mount(<PackFace card={card('plate_blossom')} phase="featured" />);
    expect(face().querySelector('.pkf-ribbon')!.nextElementSibling!.classList.contains('pkf-cat')).toBe(true);
    const sheet = readFileSync(join(__dirname, 'packOpening.css'), 'utf8');
    expect(/\.pkf-cat \{[^}]*\}/.exec(sheet)![0]).toMatch(/color: #fff;/);
    expect(sheet).toContain('.pkf-cat::before { background: linear-gradient(90deg, transparent, var(--rc));');
    expect(sheet).toContain('.pkf-cat::after { background: linear-gradient(90deg, var(--rc), transparent);');
    expect(face().querySelector('.pkf-art')!.previousElementSibling).toBeNull(); // the window opens with the art
    expect(face().querySelector('.pkf-art img.pkf-img-plate')).toBeTruthy();
    const css = readFileSync(join(__dirname, 'packOpening.css'), 'utf8');
    const rule = /\.pkf-img-plate \{[^}]*\}/.exec(css)![0];
    expect(rule).toMatch(/object-fit: cover/);
    expect(rule).toMatch(/object-position: 50% 0/);
    m.unmount();
    m = mount(<PackFace card={card('alpha_tester')} phase="featured" />); // a title: the same place
    expect(face().querySelector('.pkf-ribbon')!.nextElementSibling!.classList.contains('pkf-cat')).toBe(true);
    expect(face().querySelectorAll('.pkf-cat')).toHaveLength(1);
  });

  it('the name sits in a thin navy frame like the preview window (owner 2026-11-24)', () => {
    m = mount(<PackFace card={card('skin_albus_1')} phase="featured" />);
    expect(face().querySelector('.pkf-name > span')!.textContent).toBeTruthy();
    const rule = /.pkf-name {[^}]*}/.exec(readFileSync(join(__dirname, 'packOpening.css'), 'utf8'))![0];
    expect(rule).toContain('background: rgba(9, 18, 38, 0.6)'); // the plate navy at 60%
    expect(rule).toMatch(/border-radius/);
    expect(rule).toContain("box-shadow: 0 0 0 2px var(--gold)");
  });

  it('an announcer shows the painted Announcers medallion in the window, not a drawn icon', () => {
    m = mount(<PackFace card={card('announcer_lemon')} phase="featured" />);
    const art = face().querySelector('.pkf-art')!;
    expect(art.classList.contains('pkf-art-bare')).toBe(false);
    expect(art.querySelector('.pkf-emblem img.pkf-medal')!.getAttribute('src')).toContain('menu/announcers.webp');
    expect(art.querySelector('svg')).toBeNull();
    expect(face().querySelector('.pkf-name')!.textContent).toBe('Lemon');
  });

  it('an attack animation plays in the Collection sandbox, embedded: by itself on the top face, never under it', () => {
    m = mount(<PackFace card={card('attack_cards')} phase="featured" />);
    expect(face().querySelector('.pkf-art [data-testid="hapv-embedded"] .hapv-stage')).toBeTruthy();
    expect(face().querySelector('.pkf-art button')).toBeNull(); // no Preview button on a card
    expect(face().querySelector('.pkf-name')!.textContent).toBe('Card Shark');
    const src = readFileSync(join(__dirname, 'packFaces.tsx'), 'utf8');
    expect(src).toMatch(/autoKey=\{lands \? phase : null\}/); // top pile face and the summary row only
  });

  it('the art window is the solid plate navy, so the foil never shows through it (owner 2026-11-24)', () => {
    const css = readFileSync(join(__dirname, 'packOpening.css'), 'utf8');
    expect(/\.pkf-art \{[^}]*\}/.exec(css)![0]).toMatch(/background: #091226;/);
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

  it('the rarity aura sits on the top pile face and every summary face, never on a face under the top one', () => {
    const slot = { index: 1, count: 5 };
    const aura = (): HTMLElement | null => face().querySelector('.pkf-card > .pkf-aura');
    for (const phase of ['featured', 'handoff', 'summary'] as const) {
      m?.unmount();
      m = mount(<PackFace card={card('alpha_tester', { rarity: 'rare' })} phase={phase} slot={slot} />);
      expect(aura(), phase).toBeTruthy();
      // its colour is the rarity's own token: the face wears r-<rarity>, which the aura's shadow reads (--rc / --rc-a)
      expect(face().classList.contains('r-rare')).toBe(true);
    }
    m?.unmount();
    m = mount(<PackFace card={card('alpha_tester', { rarity: 'legendary' })} phase="tray" slot={slot} />);
    expect(aura()).toBeNull();
  });

  it('the aura breathes by tier: Common / Rare static, Epic gentle, Legendary / Ancient strong (pkf-glow)', () => {
    const want = { common: 'none', rare: 'none', epic: 'gentle', legendary: 'strong', ancient: 'strong' } as const;
    for (const [rarity, pulse] of Object.entries(want) as [keyof typeof want, string][]) {
      for (const phase of ['featured', 'summary'] as const) {
        m?.unmount();
        m = mount(<PackFace card={card('alpha_tester', { rarity })} phase={phase} slot={{ index: 0, count: 5 }} />);
        const el = face().querySelector('.pkf-aura') as HTMLElement;
        expect(el.getAttribute('data-glow'), `${rarity} ${phase}`).toBe(pulse);
        expect(el.classList.contains(`pkf-aura-${pulse}`)).toBe(true);
        expect(face().classList.contains(`r-${rarity}`)).toBe(true);
        expect(face().classList.contains('pkf-glow')).toBe(pulse === 'strong');
        const o = Number(el.style.opacity);
        expect(o).toBeGreaterThan(0);
        expect(o).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the rarity: its name alone in the window, its medallion on the card bottom edge outside the window (owner 2026-11-24)', () => {
    m = mount(<PackFace card={card('alpha_tester', { rarity: 'ancient' })} phase="featured" />);
    expect(face().querySelector('.pkf-ribbon img')).toBeNull();
    expect(face().querySelector('.pkf-win .pkf-rarity-icon')).toBeNull();
    const icon = face().querySelector('.pkf-card > img.pkf-rarity-icon')!;
    const css = readFileSync(join(__dirname, 'packOpening.css'), 'utf8');
    const label = /\.pkf-ribbon > span \{[^}]*\}/.exec(css)![0];
    expect(label).toMatch(/color: var\(--rc\)/);
    expect(label).toMatch(/text-shadow/);
    expect(label).not.toMatch(/background|border-radius|box-shadow/); // no pill
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
      // the face wears its rarity's own plate, the same one its Pixi back wore (owner 2026-11-24: "it should serve as both")
      expect(plate.getAttribute('src')).toBe(cardPlateSrc('rare'));
      expect(plate.getAttribute('src')).toContain('packs/card-plate-rare.webp');
      expect(plate.getAttribute('decoding')).toBe('sync');
      expect(plate.getAttribute('alt')).toBe('');
      const win = face().querySelector('.pkf-win')!;
      // a title's badge is its name line (no `.pkf-name`)
      for (const k of ['.pkf-cat', '.pkf-art', id === 'alpha_tester' ? '.pkf-title' : '.pkf-name', '.pkf-ribbon']) expect(win.querySelector(k), `${id} ${k}`).toBeTruthy();
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

describe('the face holo', () => {
  const holo = (): HTMLElement | null => face().querySelector('[data-testid="pkf-holo"]');

  it('Epic and up wear the holo at their tier (x the holo knob); Common / Rare do not', () => {
    for (const [r, want] of [['epic', 0.3], ['legendary', 0.5], ['ancient', 0.8]] as const) {
      m?.unmount();
      m = mount(<PackFace card={card('skin_albus_1', { rarity: r })} phase="featured" />);
      expect(holo(), r).toBeTruthy();
      expect(Number(holo()!.style.opacity), r).toBeCloseTo(want);
      expect(holo()!.querySelector('.pkf-holo-sheet'), r).toBeTruthy();
    }
    for (const r of ['common', 'rare'] as const) {
      m?.unmount();
      m = mount(<PackFace card={card('skin_albus_1', { rarity: r })} phase="featured" />);
      expect(holo(), r).toBeNull();
    }
  });

  it('is the card background: over the plate, under the item, the text and the rarity (owner 2026-11-24)', () => {
    m?.unmount();
    m = mount(<PackFace card={card('skin_albus_1', { rarity: 'legendary' })} phase="featured" />);
    const layer = holo()!;
    expect(layer.previousElementSibling?.classList.contains('pkf-tint')).toBe(true); // plate, tint, foil, content
    expect(layer.nextElementSibling?.classList.contains('pkf-win')).toBe(true);
    // the rarity tint is cut to the same traced window (no straight edge across the notch), under the foil
    const tint = face().querySelector('.pkf-tint') as HTMLElement;
    expect(tint.style.getPropertyValue('--pkf-window')).toMatch(/packs\/card-plate-window\.webp/);
    expect(tint.previousElementSibling?.classList.contains('pkf-plate')).toBe(true);
    expect(layer.querySelector('.pkf-name, .pkf-ribbon, .pkf-art')).toBeNull();
  });

  it('is cut to the plate window traced from the plates, not a rounded box (owner 2026-11-24: "theres a gap")', () => {
    m?.unmount();
    m = mount(<PackFace card={card('skin_albus_1', { rarity: 'ancient' })} phase="featured" />);
    expect(holo()!.style.getPropertyValue('--pkf-window')).toMatch(/packs\/card-plate-window\.webp/);
    const css = readFileSync(join(__dirname, 'packOpening.css'), 'utf8');
    const rule = /\.pkf-holo \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toMatch(/inset: 0/);
    expect(rule).toMatch(/mask: var\(--pkf-window\)/);
    expect(rule).not.toMatch(/border-radius/);
  });

  const SWEEP = '.pkf-holo-sweep, .pkf-holo-sweep-row';

  it('sweeps once on the pile top and the summary row, never on a face under the top one or under reduced motion', () => {
    const ancient = card('skin_albus_1', { rarity: 'ancient' });
    for (const phase of ['featured', 'summary'] as const) {
      m?.unmount();
      m = mount(<PackFace card={ancient} phase={phase} slot={{ index: 0, count: 3 }} />);
      expect(holo()!.querySelector(SWEEP), phase).toBeTruthy();
      expect(face().classList.contains('pkf-hover'), phase).toBe(true); // it follows the pointer
      m.unmount();
      m = mount(<PackFace card={ancient} phase={phase} slot={{ index: 0, count: 3 }} still />);
      expect(holo(), phase).toBeTruthy(); // still there, static
      expect(holo()!.querySelector(SWEEP), phase).toBeNull();
      expect(face().classList.contains('pkf-hover'), phase).toBe(false);
    }
    m?.unmount();
    m = mount(<PackFace card={ancient} phase="tray" slot={{ index: 0, count: 3 }} />);
    expect(holo()!.querySelector(SWEEP)).toBeNull();
    expect(face().classList.contains('pkf-hover')).toBe(false);
  });

  it('the top pile face sweeps AGAIN when it joins the summary row (a distinct sweep class and animation)', () => {
    const epic = card('skin_albus_1', { rarity: 'epic' });
    const slot = { index: 0, count: 3 };
    m = mount(<PackFace card={epic} phase="featured" slot={slot} />);
    const sheet = holo()!.querySelector('.pkf-holo-sheet')!;
    expect(sheet.classList.contains('pkf-holo-sweep')).toBe(true);
    m.render(<PackFace card={epic} phase="summary" slot={slot} />);
    const after = holo()!.querySelector('.pkf-holo-sheet')!;
    expect(after.classList.contains('pkf-holo-sweep')).toBe(false);
    expect(after.classList.contains('pkf-holo-sweep-row')).toBe(true);
    // each class names its own keyframes, so the browser starts a fresh animation on the swap
    const css = readFileSync(join(__dirname, 'packOpening.css'), 'utf8');
    const anim = (cls: string) => new RegExp(`\\.${cls} \\{ animation: ([\\w-]+) `).exec(css)?.[1];
    expect(anim('pkf-holo-sweep')).toBe('pkf-holo-sweep');
    expect(anim('pkf-holo-sweep-row')).toBe('pkf-holo-sweep-row');
  });

  it('when the follow turns off (the face goes under the top one) a queued frame is dropped and the layer recentres', () => {
    const raf: FrameRequestCallback[] = [];
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { raf.push(cb); return raf.length; });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    try {
      const c = card('skin_albus_1', { rarity: 'legendary' });
      const slot = { index: 0, count: 3 };
      m = mount(<PackFace card={c} phase="featured" slot={slot} />);
      const root = face();
      vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
      act(() => { root.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 0, clientY: 0, relatedTarget: null })); });
      act(() => { root.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 90, clientY: 10 })); });
      act(() => { raf.shift()!(0); });
      const layer = holo()!.querySelector<HTMLElement>('.pkf-holo-move')!;
      expect(layer.style.getPropertyValue('--hx')).toBe('0.900');
      act(() => { root.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 80 })); });
      expect(raf.length).toBe(1); // one frame queued
      m.render(<PackFace card={c} phase="tray" slot={slot} />);
      expect(cancel).toHaveBeenCalledWith(1);
      expect(face().classList.contains('pkf-hover')).toBe(false);
      const after = holo()!.querySelector<HTMLElement>('.pkf-holo-move')!;
      expect(after.style.getPropertyValue('--hx')).toBe('0.5');
      expect(after.style.getPropertyValue('--hy')).toBe('0.5');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('follows the pointer with a CSS var on its moving layer (the rect read once, at pointerenter)', () => {
    const raf: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { raf.push(cb); return raf.length; });
    try {
      m = mount(<PackFace card={card('skin_albus_1', { rarity: 'legendary' })} phase="featured" />);
      const root = face();
      const rect = vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 200, height: 300 } as DOMRect);
      act(() => {
        // jsdom has no PointerEvent; React reads the type and the coordinates (enter is synthesised from pointerover)
        root.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 100, clientY: 50, relatedTarget: null }));
      });
      for (const [x, y] of [[150, 125], [250, 275]]) {
        act(() => { root.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y })); });
      }
      expect(rect).toHaveBeenCalledTimes(1); // at pointerenter only, never per move
      expect(raf.length).toBe(1); // throttled: one frame for both moves
      act(() => { raf.shift()!(0); });
      const layer = holo()!.querySelector<HTMLElement>('.pkf-holo-move')!;
      expect(layer.style.getPropertyValue('--hx')).toBe('0.750');
      expect(layer.style.getPropertyValue('--hy')).toBe('0.750');
    } finally {
      vi.unstubAllGlobals();
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

  it('no card ever shrinks while it lands: for every lift in use the pile scale is at least the edge scale', () => {
    const from = at(700, 500, 400);
    const edge = edgePose(from, vp);
    for (const [guaranteed, lift] of [[false, FLIP_LIFT], [true, FLIP_LIFT_GUARANTEED]] as const) {
      expect(1 + lift).toBeLessThanOrEqual(REVEALED_SCALE);
      const p = facePose('featured', { index: 0, count: 5 }, from, vp, guaranteed);
      expect(p.sx).toBeGreaterThanOrEqual(edge.sx - 1e-9);
      expect(p.sy).toBeGreaterThanOrEqual(edge.sy - 1e-9);
    }
  });

  it('the pile face is capped at PILE_MAX_H of the theatre height', () => {
    const from = at(700, 500, 700); // a back far taller than the theatre allows
    for (const phase of ['featured', 'tray'] as const) {
      const p = facePose(phase, { index: 1, count: 5 }, from, vp);
      expect(p.sy * FACE_H).toBeLessThanOrEqual(PILE_MAX_H * vp.h + 1e-6);
      expect(p.sx / p.sy).toBeCloseTo((from.width / FACE_W) / (from.height / FACE_H)); // the shape is kept
    }
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

  it('the summary row is as big as the revealed pile unless it must shrink to fit, in one row centred in the theatre', () => {
    const big = { w: 1920, h: 1080 };
    // one card: the summary face is exactly the revealed pile's size
    const small = at(700, 300, 200);
    const pile = facePose('featured', { index: 0, count: 1 }, small, big);
    const one = facePose('summary', { index: 0, count: 1 }, small, big);
    expect(one.sx).toBeCloseTo(pile.sy);
    expect(one.sy).toBeCloseTo(pile.sy);
    // five cards: never bigger than the pile, but far bigger than a thumbnail, and the row fits the theatre
    const from = at(700, 500, 520);
    const xs = [0, 1, 2, 3, 4].map((i) => facePose('summary', { index: i, count: 5 }, from, big));
    const pileK = facePose('featured', { index: 4, count: 5 }, from, big).sy;
    for (const p of xs) {
      expect(p.sx).toBeLessThanOrEqual(pileK + 1e-9);
      expect(p.sx * FACE_W).toBeGreaterThan(300);
      expect(p.y).toBe(xs[0]!.y); expect(p.r).toBe(0);
    }
    const halfW = (xs[0]!.sx * FACE_W) / 2;
    expect(xs[0]!.x + big.w * SLOT_X - halfW).toBeGreaterThanOrEqual(0);
    expect(xs[4]!.x + big.w * SLOT_X + halfW).toBeLessThanOrEqual(big.w);
    expect(xs[2]!.x + big.w * SLOT_X).toBeCloseTo(big.w / 2);
    for (let i = 1; i < 5; i++) expect(xs[i]!.x).toBeGreaterThan(xs[i - 1]!.x);
  });

  it('a handed-off face renders at the pile pose once it arrives', async () => {
    const from = at(400, 300, 300); // small enough to stay under the height cap in jsdom's viewport
    m = mount(<PackFace card={card('alpha_tester')} phase="handoff" from={from} slot={{ index: 0, count: 5 }} />);
    await act(async () => { await Promise.resolve(); });
    const k = (300 / FACE_W / (1 + FLIP_LIFT)) * REVEALED_SCALE;
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
      // the rare plate (once) + the window mask (once) + two art faces + the one shared rarity medallion (all four are rare)
      expect(held).toHaveLength(5);
      expect(decoded).toHaveLength(5);
      expect(held.filter((img) => img.src.includes('packs/card-plate-rare.webp'))).toHaveLength(1);
      for (const img of held) expect(img.decoding).toBe('sync');
    } finally {
      HTMLImageElement.prototype.decode = orig;
    }
  });
});
