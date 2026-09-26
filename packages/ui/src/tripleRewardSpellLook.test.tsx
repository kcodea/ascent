// @vitest-environment jsdom
/**
 * THE TRIPLE REWARD LOOKS EXACTLY LIKE A SPELL IN HAND (owner 2026-09-25: "i also want the triple reward card to
 * look exactly like a shop spell card. the frame, the pill location, everything should be exactly the same as a
 * spell in hand").
 *
 * The reward (`discoverspell`) used to be excluded from the authored square spell frame and wore a bespoke gold
 * `.triplecard` skin. It now goes down the SAME `Card` render path as any spell. This pins that: rendered as a
 * hand card, its DOM skeleton (every element's tag + classes, in order) is identical to a regular Discover spell's,
 * and none of the old bespoke look survives in the classes or the stylesheet.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardCard } from '@game/sim';
import { Card } from './Card';
import { instView } from './instView';
import { mount } from './renderedText.mount';

const HERE = dirname(fileURLToPath(import.meta.url));

const handCard = (cardId: string, uid: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false, grantedTier: 3 }) as BoardCard;

/** Tag + class list of the root and every descendant, in document order — the card's visual skeleton. */
const skeleton = (root: Element): string[] =>
  [root, ...root.querySelectorAll('*')].map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].sort().join('.')}`);

describe('Triple Reward renders through the spell-in-hand path', () => {
  const m = mount(<div />);
  afterAll(() => m.unmount());

  const render = (cardId: string): Element => {
    const view = instView(handCard(cardId, `u-${cardId}`), 3, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { inHand: true });
    m.render(<Card card={view} uid={`u-${cardId}`} plated forceFull />);
    return m.container.querySelector('.card')!;
  };

  it('wears the authored square spell frame and no bespoke triple skin', () => {
    const el = render('discoverspell');
    expect(el.classList.contains('spellcard')).toBe(true);
    expect(el.classList.contains('spellframe')).toBe(true);
    expect(el.classList.contains('triplecard')).toBe(false);
    expect(el.querySelector('.ctype.spell')?.textContent).toContain('Spell');
    // Still carries its live, grant-tier-frozen text (one tier above the tier it was granted at).
    expect(el.querySelector('.desc')?.textContent).toContain('Tier 4');
  });

  it('has the identical DOM skeleton to a regular Discover spell in hand', () => {
    const reward = skeleton(render('discoverspell'));
    const spell = skeleton(render('invitationabove'));
    expect(reward).toEqual(spell);
  });

  it('keeps only the arrival-coalesce marker (no styling hook)', () => {
    const el = render('discoverspell');
    expect(el.hasAttribute('data-triple-reward')).toBe(true);
    expect(render('invitationabove').hasAttribute('data-triple-reward')).toBe(false);
    const css = readFileSync(join(HERE, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/\.triplecard|data-triple-reward/);
  });
});
