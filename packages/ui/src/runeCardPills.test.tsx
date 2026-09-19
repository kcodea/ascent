// @vitest-environment jsdom
/**
 * A rune's hover shows the glossary pills its text raises (owner ask 2026-09-18: the Amplified pill must show
 * on "every card/rune/equipment whose text says Amplified" — the rune included). Rune of Amplification grants
 * no card, so before this its hover showed nothing at all; now the `KeywordDefs` column floats beside it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { RUNE_INDEX } from '@game/content';
import { RuneCard } from './RuneCard';
import { mount } from './renderedText.mount';

describe('RuneCard hover — glossary pills', () => {
  const m = mount(null);
  afterAll(() => m.unmount());

  const hoverPills = async (runeId: string): Promise<string[]> => {
    const rune = RUNE_INDEX[runeId]!;
    m.render(<RuneCard rune={rune} affordable onBuy={() => {}} />);
    const btn = m.container.querySelector('button.runecard')!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); // React synthesises onMouseEnter from mouseover
      // The reveal is on a 220ms timer (the same debounce a card hover uses).
      await new Promise((r) => setTimeout(r, 300));
    });
    return [...document.body.querySelectorAll('.cardref .kwbox-name')].map((n) => n.textContent ?? '');
  };

  it('Rune of Amplification floats Equipment + Amplified, with the owner wording', async () => {
    expect(RUNE_INDEX['rune_amplification']!.text).toBe('**Equipment** you do not use becomes **Amplified**.');
    const names = await hoverPills('rune_amplification');
    expect(names).toEqual(['Equipment', 'Amplified']);
    const defs = [...document.body.querySelectorAll('.cardref .kwbox-def')].map((n) => n.textContent);
    expect(defs).toContain('An Amplified Equipment will trigger its effect twice for no additional gold.');
  });

  it('Rune of the Grand Workshop floats Start of Turn + Equipment + Amplified', async () => {
    expect(await hoverPills('rune_grand_workshop')).toEqual(['Start of Turn', 'Equipment', 'Amplified']);
  });
});
