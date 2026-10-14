// @vitest-environment jsdom
/**
 * A SPELL NAMES ITS KIND (owner 2026-10-09): every spell-like card wears its kind's crystal medallion where the
 * old purple type pill sat, and prints that kind where a minion prints its tribe — Shop Spell, Ruby or Gift.
 * A Ruby is not a Shop Spell, and a Gift (a rune/hero hand-out, read off the DEF) is neither.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { BoardCard } from '@game/sim';
import { Card } from './Card';
import { instView } from './instView';
import { mount } from './renderedText.mount';

const handCard = (cardId: string, uid: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false, grantedTier: 3 }) as BoardCard;

describe('spell kind: medallion + tribe-line label', () => {
  const m = mount(<div />);
  afterAll(() => m.unmount());

  const render = (cardId: string, opts: { plated: boolean }): Element => {
    const view = instView(handCard(cardId, `u-${cardId}`), 3, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { inHand: true });
    m.render(<Card card={view} uid={`u-${cardId}`} plated={opts.plated} forceFull />);
    return m.container.querySelector('.card')!;
  };

  it.each([
    ['invitationabove', 'spell', 'Shop Spell'],
    ['ruby', 'ruby', 'Ruby'],
    ['gift_allowance', 'gift', 'Gift'],
  ])('%s wears the %s medallion and reads "%s" (plated and unplated)', (cardId, med, label) => {
    for (const plated of [true, false]) {
      const el = render(cardId, { plated });
      const medallion = el.querySelector('.ctype.spell.spellmed')!;
      expect(medallion.getAttribute('data-med')).toBe(med);
      expect(medallion.getAttribute('aria-label')).toBe(label);
      expect(medallion.querySelector('img')?.getAttribute('src')).toContain(`medallions/${med}.webp`);
      const kind = el.querySelector('.spellkind')!;
      expect(kind.textContent).toBe(label);
      expect(kind.getAttribute('data-kind')).toBe(med);
      expect(kind.classList.contains(plated ? 'plate-tribe' : 'dtribe')).toBe(true);
      // The old text pill is gone.
      expect(el.textContent).not.toMatch(/✦ Spell|◆ Ruby/);
    }
  });

  // Set 4 (owner 2026-10-14): a Whisper wears its own medallion (the three cyan arcs) in the spell shard's box, and its
  // kind line reads Whisper (the kind attr stays 'spell', so its colour and seat match a Shop spell).
  it('a Whisper wears the whisper medallion and reads "Whisper" (plated and unplated)', () => {
    for (const plated of [true, false]) {
      const el = render('w4_tome', { plated });
      const medallion = el.querySelector('.ctype.spell.spellmed')!;
      expect(medallion.getAttribute('data-med')).toBe('whisper');
      expect(medallion.getAttribute('aria-label')).toBe('Whisper');
      expect(medallion.querySelector('img')?.getAttribute('src')).toContain('frames/whisper-medallion.webp');
      expect(el.querySelector('.spellkind')!.textContent).toBe('Whisper');
    }
  });

  // Owner 2026-10-14: "add the whispergilded frame for gilded whispers - keep the spellframe and the whisper badge etc as
  // is". A Gilded granter's Whisper (`whisperMult` 2) swaps ONLY the hand plate to the gold one.
  it('a Gilded Whisper wears the gold Whisper plate; the arch and the medallion stay the Whisper ones', () => {
    for (const mult of [1, 2]) {
      const inst = { ...handCard('w4_tome', `u-g${mult}`), ...(mult > 1 ? { whisperMult: mult } : {}) } as BoardCard;
      const view = instView(inst, 3, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { inHand: true });
      m.render(<Card card={view} uid={`u-g${mult}`} plated forceFull />);
      const el = m.container.querySelector('.card')!;
      expect(el.querySelector('img.cardplate')?.getAttribute('src')).toContain(mult > 1 ? 'frames/cardplate-whisper-gilded.webp' : 'frames/cardplate-whisper.webp');
      expect(el.querySelector('.cframe-img:not(.cshadow)')?.getAttribute('src')).toContain('frames/whisper-spell-frame.webp');
      expect(el.querySelector('.spellmed img')?.getAttribute('src')).toContain('frames/whisper-medallion.webp');
    }
  });
});
