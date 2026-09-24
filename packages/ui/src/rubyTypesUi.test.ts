import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { BoardCard } from '@game/sim';
import { instView, liveCardText, rubyLiveText, type LiveTextParams } from './instView';
import { recruitMomentsSince } from './choreo/recruitMoments';
import { DARK_RUBY_CONSUME_DELAY_MS, RIPPLE_GEM_SPACING_MS, darkRubyGemSpacingMs, spaceLands } from './choreo/channels/rubyLanded';
import { cascade, scheduleLands } from './fx/land';

/**
 * The owner's Ruby batch (2026-09-24), presentation half:
 *   - every Ruby type prints its own rider sentence with the LIVE grant (hand and Discover surfaces);
 *   - Ripple's second cast and Dark Ruby's "Ruby -> consume -> Ruby" space their target's gems apart.
 */

const ruby = (cardId: string, attack: number, health: number): BoardCard =>
  ({ uid: 'r', cardId, tribe: 'neutral', attack, health, keywords: [], golden: false });

describe('Ruby live text — each type keeps its rider, the grant is live', () => {
  it('rubyLiveText swaps only the printed +A/+H', () => {
    expect(rubyLiveText('Give a minion **+1/+1**. If it is a **Kobold**, gain **2 Gold**.', '{{+3/+2}}'))
      .toBe('Give a minion **{{+3/+2}}**. If it is a **Kobold**, gain **2 Gold**.');
  });

  it('a Ruby in hand prints the stats it was minted with (green above its printed base)', () => {
    expect(instView(ruby('warding-ruby', 1, 2)).text).toBe('Give a minion **+1/+2**. If it is a **Kobold**, give it **Ward**.');
    expect(instView(ruby('warding-ruby', 2, 3)).text).toBe('Give a minion **{{+2/+3}}**. If it is a **Kobold**, give it **Ward**.');
    for (const id of ['golden-ruby', 'splintered-ruby', 'ripple-ruby', 'dark-ruby']) {
      const t = instView(ruby(id, 3, 3)).text;
      expect(t, id).toBe(CARD_INDEX[id]!.text.replace('**+1/+1**', '**{{+3/+3}}**'));
    }
  });

  it('a Ruby OFFERED as a card (Prismatic Pick\'s Discover) prints the grant it will be minted at', () => {
    const p = { tier: 1, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, rubyBonus: { attack: 2, health: 1 } } as unknown as LiveTextParams;
    expect(liveCardText('dark-ruby', p).text).toBe(CARD_INDEX['dark-ruby']!.text.replace('**+1/+1**', '**{{+3/+2}}**'));
    const none = { tier: 1, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0 } as unknown as LiveTextParams;
    expect(liveCardText('ripple-ruby', none).text).toBe(CARD_INDEX['ripple-ruby']!.text);
  });
});

describe('special-Ruby gem spacing', () => {
  it('the rubyLanded moment tags a Ripple / Dark target with its rider (the same action\'s rubyRiderFx)', () => {
    const src = {
      rubyLandedFxSeq: 1, rubyLandedFx: [{ uid: 'k', count: 2 }, { uid: 'x', count: 1 }],
      recruitFxSeq: undefined, recruitBuffFx: [], veinstormFxSeq: undefined, veinstormFx: undefined,
      shopBuffAllFxSeq: undefined, shopBuffAllFx: undefined,
      rubyRiderFx: [{ uid: 'k', rider: 'devour' as const }, { uid: 'g', rider: 'gold' as const }],
    } as unknown as Parameters<typeof recruitMomentsSince>[0];
    const [m] = recruitMomentsSince(src, {});
    expect(m!.recipients).toEqual([{ uid: 'k', count: 2, rider: 'devour' }, { uid: 'x', count: 1 }]);
  });

  it('Ripple: the second gem lands a clear beat after the first, not stacked behind it', () => {
    const lands = spaceLands(scheduleLands(cascade([{ uid: 'k', count: 2 }]), { gap: 100, beat: 50 }), () => RIPPLE_GEM_SPACING_MS);
    expect(lands.map((l) => l.at)).toEqual([0, RIPPLE_GEM_SPACING_MS]);
  });

  it('Dark Ruby: gem -> consume (after the first gem) -> gem as the ghost is pulled in', () => {
    const spacing = darkRubyGemSpacingMs(530);
    expect(spacing).toBe(DARK_RUBY_CONSUME_DELAY_MS + 530);
    const lands = spaceLands(scheduleLands(cascade([{ uid: 'a', count: 1 }, { uid: 'k', count: 2 }]), { gap: 100, beat: 50 }),
      (uid) => (uid === 'k' ? spacing : undefined));
    expect(lands.map((l) => [l.uid, l.at])).toEqual([['a', 0], ['k', 100], ['k', 100 + spacing]]);
  });
});
