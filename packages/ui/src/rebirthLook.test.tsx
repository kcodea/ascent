// @vitest-environment jsdom
/**
 * REBIRTH look v2 (owner 2026-09-26: "improve rebirth effect? its not noticeable and ugly").
 *  · IDLE: every card with Rebirth (`RB`) carries `.rebirthcard` and the flame crown (`.rebirth-crown`, the
 *    pre-rendered frames of `rebirthCrown.ts`); nothing else does.
 *  · TRIGGER: a `reborn { rebirth: true }` event tags the unit `rebirthing` (the re-form out of the fire), and
 *    `reformRebirth` binds the `rebirth-flame` def ONCE per call, recoloured to the tuner's colours, sized off the
 *    card HEIGHT (the slot's width is still ~0 at beat start), and raises the pillar of fire on the unit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./fx/playDef', () => ({ playDef: vi.fn(() => null) }));
import type { CombatEvent } from '@game/core';
import { playDef } from './fx/playDef';
import { Card, type CardView } from './Card';
import { mount } from './renderedText.mount';
import { CROWN_FRAMES, crownSvg, crownTongues, pillarSvg } from './rebirthCrown';
import { REBIRTH_DEFAULTS, getRebirthConfig, hexToNum, rebirthPalette } from './rebirthConfig';
import { reformRebirth } from './choreo/channels/aura';
import { animFor } from './useCombatReplay';

const playDefMock = vi.mocked(playDef);
afterEach(() => { playDefMock.mockClear(); document.body.innerHTML = ''; });

const view = (keywords: CardView['keywords']): CardView => ({
  name: 'Exgalloper', cardId: 'dw_exgalloper', tribe: 'beast', attack: 6, health: 6, keywords, text: '**Rebirth.**', tier: 5,
});

describe('Rebirth idle look', () => {
  it('a Rebirth card wears .rebirthcard and the flame crown (glow + every flame frame + embers)', () => {
    const m = mount(<Card card={view(['RB'])} uid="u1" />);
    const card = m.container.querySelector('.card')!;
    expect(card.classList.contains('rebirthcard')).toBe(true);
    const crown = card.querySelector('.archbox > .rebirth-crown');
    expect(crown, 'the crown lives in the archbox (behind the frame), not inside the clipped art').not.toBeNull();
    expect(crown!.querySelector('.rbc-glow')).not.toBeNull();
    expect(crown!.querySelectorAll('.rbc-frame')).toHaveLength(CROWN_FRAMES);
    expect(crown!.querySelectorAll('.rbc-ember')).toHaveLength(getRebirthConfig().emberCount);
    m.unmount();
  });

  it('no Rebirth, no crown: Rise keeps its own dome and never borrows the flame', () => {
    const m = mount(<Card card={view(['R'])} uid="u2" />);
    expect(m.container.querySelector('.rebirth-crown')).toBeNull();
    expect(m.container.querySelector('.card')!.classList.contains('rebirthcard')).toBe(false);
    expect(m.container.querySelector('.reborn-dome')).not.toBeNull();
    m.unmount();
  });

  it('the crown frames are distinct pre-rendered SVGs carrying the tuner colours', () => {
    const c = { deep: '#112233', hot: '#445566', core: '#778899' };
    const frames = Array.from({ length: CROWN_FRAMES }, (_, k) => crownSvg(k, c));
    expect(new Set(frames).size).toBe(CROWN_FRAMES); // each frame flickers to a new shape
    for (const f of frames) {
      expect(f.startsWith('<svg')).toBe(true);
      expect(f).toContain('#112233');
      expect(f).toContain('#445566');
      expect(f).toContain('#778899');
    }
    expect(crownSvg(0, c)).toBe(crownSvg(0, c)); // seeded: identical every load
    // Flame height scales every tongue.
    const a = crownTongues(1, 1), b = crownTongues(1, 1.4);
    expect(b[0]!.l / a[0]!.l).toBeCloseTo(1.4, 5);
    expect(pillarSvg(c)).toContain('#778899');
  });
});

describe('Rebirth trigger', () => {
  it('a rebirth tags the unit `rebirthing` on top of the shared re-entry; a Rise does not', () => {
    const rb = { type: 'reborn', target: 'a', hp: 5, attack: 5, keywords: [], rebirth: true } as CombatEvent;
    const rise = { type: 'reborn', target: 'b', hp: 1, attack: 1, keywords: [] } as CombatEvent;
    expect(animFor(rb)).toEqual({ a: 'reborn rebirthing' });
    expect(animFor(rise)).toEqual({ b: 'reborn' });
  });

  it('reformRebirth binds rebirth-flame ONCE, recoloured, sized off the card height, and raises the pillar on the unit', () => {
    document.body.innerHTML = '<div class="unit" id="host"><div class="card" data-uid="r9"></div></div>';
    reformRebirth({ cx: 100, cy: 200, w: 0, h: 240 }, 'r9');
    expect(playDefMock).toHaveBeenCalledTimes(1);
    const [id, anchors, opts] = playDefMock.mock.calls[0]!;
    expect(id).toBe('rebirth-flame');
    expect(anchors).toEqual({ target: { x: 100, y: 200 } });
    expect(opts?.uids).toEqual({ source: null, target: 'r9' });
    // w is 0 (the slot is still expanding) → the size comes from the height: 240 × 0.75 / 180 = 1.
    expect(opts?.scale).toBeCloseTo(REBIRTH_DEFAULTS.burstScale * 1, 5);
    expect(opts?.recolor).toEqual(rebirthPalette());
    const host = document.getElementById('host')!;
    expect(host.querySelectorAll('.rbpillar.back')).toHaveLength(1);
    expect(host.querySelectorAll('.rbpillar.front')).toHaveLength(1);
    expect(host.firstElementChild!.classList.contains('back'), 'the back column sits behind the card').toBe(true);
  });

  it('the palette is deep → mid → hot → core, from the tuner colours', () => {
    const p = rebirthPalette(REBIRTH_DEFAULTS)!;
    expect(p).toHaveLength(4);
    expect(p[0]).toBe(hexToNum(REBIRTH_DEFAULTS.colorB));
    expect(p[2]).toBe(hexToNum(REBIRTH_DEFAULTS.colorA));
    expect(p[3]).toBe(hexToNum(REBIRTH_DEFAULTS.colorCore));
    expect(rebirthPalette({ ...REBIRTH_DEFAULTS, colorA: 'nope' })).toBeUndefined();
  });
});
