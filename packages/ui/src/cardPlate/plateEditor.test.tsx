// @vitest-environment jsdom
/**
 * THE CARD PLATE EDITOR (owner 2026-10-18: "create a tuner that would allow me to select each Card Plate and individually
 * edit the card plates frame and interior size and positioning"; "i need to be able to do it on an individual card plate
 * level, not a tuner that affects all cards"). A live edit moves ONE plate, on every card wearing it, and nothing else;
 * the frame's size carries its interior with it; Reset drops every unsaved edit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import type { BoardCard } from '@game/sim';
import { Card } from '../Card';
import { instView } from '../instView';
import { mount, type Mounted } from '../renderedText.mount';
import { MinionSkins } from '../skins/skins';
import { CARD_PLATE_LOOKS, clearLivePlateTuning, livePlateLook, plateTuningOf, setLivePlateTuning } from './cardPlateLook';

const handCard = (uid: string): BoardCard =>
  ({ uid, cardId: 'k_pouchpincher', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false, grantedTier: 3 }) as unknown as BoardCard;

let ui: Mounted | null = null;
afterEach(() => { act(() => clearLivePlateTuning()); ui?.unmount(); ui = null; });

const renderWearing = (plate: string | null): HTMLElement => {
  ui = mount(<div />);
  const view = instView(handCard('u1'), 3, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { inHand: true });
  act(() => ui!.render(<MinionSkins snapshot={plate ? { cardPlate: plate } as never : null}><Card card={view} uid="u1" plated forceFull /></MinionSkins>));
  return ui.container.querySelector('.card') as HTMLElement;
};

describe('the Card Plate Editor', () => {
  it('a live edit moves the chosen plate on a card already on screen, and only that plate', () => {
    const topaz = renderWearing('plate_topaz'); // drawn at 1x and never saved from the editor, so a nudge reads back as set
    expect(topaz.style.getPropertyValue('--plate-frame-y')).toBe('');
    act(() => setLivePlateTuning('plate_topaz', 'frameY', 0.05));
    expect(topaz.style.getPropertyValue('--plate-frame-y')).toBe('0.05');
    act(() => setLivePlateTuning('plate_topaz', 'interiorX', -0.02));
    expect(topaz.style.getPropertyValue('--plate-interior-x')).toBe('-0.02');
    // Another plate, and the shipped looks, are untouched.
    expect(livePlateLook('plate_honey')).toBe(CARD_PLATE_LOOKS.plate_honey);
    expect(CARD_PLATE_LOOKS.plate_topaz.frameY).toBeUndefined();
  });

  it('a card with no plate never picks up an edit', () => {
    const plain = renderWearing(null);
    act(() => setLivePlateTuning('plate_goop', 'frameY', 0.05));
    expect(plain.style.getPropertyValue('--plate-frame-y')).toBe('');
  });

  it('the frame size carries the interior: the interior numbers stay the fit on the unscaled frame', () => {
    const before = plateTuningOf('plate_battletorn');
    act(() => setLivePlateTuning('plate_battletorn', 'artScale', 1.25));
    expect(plateTuningOf('plate_battletorn')).toEqual({ ...before, artScale: 1.25 });
    const look = livePlateLook('plate_battletorn')!;
    expect(look.artScale).toBe(1.25);
    expect(look.interiorSx).toBeCloseTo(before.interiorSx * 1.25, 3);
    expect(look.interiorSy).toBeCloseTo(before.interiorSy * 1.25, 3);
  });

  it('Reset drops every unsaved edit, back to what is saved', () => {
    act(() => { setLivePlateTuning('plate_goop', 'frameY', 0.05); setLivePlateTuning('plate_honey', 'frameX', 0.1); });
    act(() => clearLivePlateTuning());
    expect(livePlateLook('plate_goop')).toBe(CARD_PLATE_LOOKS.plate_goop);
    expect(livePlateLook('plate_honey')).toBe(CARD_PLATE_LOOKS.plate_honey);
  });
});
