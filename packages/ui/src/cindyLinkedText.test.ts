/**
 * CINDY × ANCIENT OF BONDS (R-ANCCINDY-06): both Linked cards say "Linked" in gold, in the same `((…))` status tag a
 * next-combat grant uses (the Card's gold `desctemp` marker), on every surface the shop chain draws, plain and Gilded.
 * A card that is not Linked has no tag.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard } from '@game/sim';
import { LINKED_TAG, instView } from './instView';
import { rulesHtml } from './Card';

const PLAIN = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && !c.ruby && c.effects.length === 0 && c.keywords.length === 0 && !c.chooseOne)!;
const minion = (extra: Partial<BoardCard> = {}): BoardCard => ({ uid: 'm', cardId: PLAIN.id, tribe: PLAIN.tribe, attack: PLAIN.attack, health: PLAIN.health, keywords: [], golden: false, ...extra });
const view = (c: BoardCard) => instView(c, 1, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { onBoard: true, sellState: createRun(7, 'indy') });

describe('a Linked card prints "Linked" in gold', () => {
  it('the tag rides the text of a Linked card, plain and Gilded', () => {
    const link = { id: 'grat3', a: 1, h: 1 };
    expect(view(minion({ duosLink: link })).text).toContain(LINKED_TAG);
    const gilded = view(minion({ duosLink: { ...link, g: true }, golden: true, attack: PLAIN.attack * 2, health: PLAIN.health * 2 }));
    expect(gilded.text).toContain(LINKED_TAG);
    if (gilded.goldenText !== undefined) expect(gilded.goldenText).toContain(LINKED_TAG);
  });

  it('renders as the gold status span (the next-combat tag look), in plain words', () => {
    expect(rulesHtml(`Text. ${LINKED_TAG}`)).toContain('<span class="desctemp">(Linked)</span>');
    expect(LINKED_TAG).not.toMatch(/—|--/);
  });

  it('no tag on a card that is not Linked (fails without the effect)', () => {
    expect(view(minion()).text).not.toContain('Linked');
  });
});
