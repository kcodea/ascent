// @vitest-environment jsdom
/**
 * A rune's hover previews each card it grants or names ONCE (owner report 2026-10-23, Lantern Keeper: "this
 * doesnt need both previews"). Lantern Keeper's reward is a `grant` of Lantern of Souls now plus a
 * `recurringGrant` of it every 2 turns, and the collector listed both, so two identical spell cards floated.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { RUNES, RUNE_INDEX } from '@game/content';
import { RuneCard, previewIdsOf } from './RuneCard';
import { mount } from './renderedText.mount';

describe('RuneCard hover — one preview per card', () => {
  const m = mount(null);
  afterAll(() => m.unmount());

  it('Lantern Keeper previews Lantern of Souls once', () => {
    expect(previewIdsOf(RUNE_INDEX['rune_lantern_keeper']!)).toEqual([{ id: 'lanternofsouls' }]);
  });

  it('no rune previews the same card twice (a grant + a recurring grant, or a grant also named in previewCards)', () => {
    const dupes: string[] = [];
    for (const r of RUNES) {
      const keys = previewIdsOf(r).map((x) => `${x.id}${x.golden ? ':gold' : ''}`);
      if (new Set(keys).size !== keys.length) dupes.push(`${r.id}: ${keys.join(', ')}`);
    }
    expect(dupes).toEqual([]);
  });

  it('the rendered hover shows exactly one Lantern of Souls', async () => {
    m.render(<RuneCard rune={RUNE_INDEX['rune_lantern_keeper']!} affordable onBuy={() => {}} />);
    const btn = m.container.querySelector('button.runecard')!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300)); // the 220ms hover debounce
    });
    const inner = document.body.querySelector('.cardref .cardref-inner')!;
    expect(inner, 'the hover popup opened').not.toBeNull();
    const names = [...inner.querySelectorAll('.card')].map((n) => n.textContent ?? '').filter((t) => t.includes('Lantern of Souls'));
    expect(names).toHaveLength(1);
  });
});
