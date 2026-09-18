// @vitest-environment jsdom
/**
 * TERM COLOURING — every tribe name and every glossary term in rules text renders inside a coloured `<b>`
 * (owner ask 2026-09-18: "make sure that every tribe name or mechanic name in card text is coloured
 * appropriately … Seedling Spirit's 'Spirit' in text isn't, and Collapse should also be a coloured keyword").
 *
 * Root cause of the miss: colouring was bold-driven — only a `**…**`-wrapped term got the `.desc b` tribe colour,
 * so any term the author left plain rendered as body text. `colourTerms` now wraps the rest. This file pins:
 *   1. the pass itself (wraps, skips already-styled text, idempotent, word-bounded, case-sensitive);
 *   2. a SWEEP of every card / gilded / Choose One branch / rune / hero-power text through the real pipelines;
 *   3. the rendered DOM for Seedling Spirit (the reported card) through the real `Card`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_CARDS, CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { HEROES } from '@game/sim';
import { Card, mdBold, rulesHtml, type CardView } from './Card';
import { COLOURED_TERMS, colourTerms, uncolouredTerms } from './termColour';
import { descTextOf, mount, normWs, plainOf } from './renderedText.mount';

describe('colourTerms', () => {
  it('wraps a plain tribe name and a plain glossary term in a coloured <b>', () => {
    expect(colourTerms('summon a random Spirit from your hand.')).toBe('summon a random <b class="term tribe">Spirit</b> from your hand.');
    expect(colourTerms('then Collapse it.')).toBe('then <b class="term">Collapse</b> it.');
    expect(colourTerms('Equip Comet (4): …')).toBe('<b class="term">Equip</b> Comet (4): …');
  });
  it('covers plurals of every tribe', () => {
    for (const w of ['Beasts', 'Dragons', 'Mechs', 'Undead', 'Demons', 'Kobolds', 'Dwarves', 'Celestials', 'Spirits']) {
      expect(colourTerms(`give your ${w} +1/+1`)).toContain(`<b class="term tribe">${w}</b>`);
    }
  });
  it('leaves text that is already inside an element alone (bold, markers) and is idempotent', () => {
    const bolded = '<b>Rally:</b> summon a <b>Spirit</b>.';
    expect(colourTerms(bolded)).toBe(bolded);
    const marker = 'give your <span class="descup">Beasts +3/+3</span>';
    expect(colourTerms(marker)).toBe(marker);
    const once = colourTerms('Discover a Beast.');
    expect(colourTerms(once)).toBe(once);
  });
  it('is word-bounded and case-sensitive (no "Mechanic", no lowercase verbs)', () => {
    expect(colourTerms('Mechanical Jouster rises again')).toBe('Mechanical Jouster rises again');
    expect(colourTerms('the spirit of the mech')).toBe('the spirit of the mech');
  });
  it('the vocabulary includes every tribe and the three owner-named pills', () => {
    for (const t of ['Beast', 'Dragon', 'Mech', 'Undead', 'Demon', 'Kobold', 'Dwarf', 'Celestial', 'Spirit', 'Collapse', 'Starform', 'Equip']) {
      expect(COLOURED_TERMS, t).toContain(t);
    }
  });
});

describe('every tribe / mechanic term in every rules text renders coloured', () => {
  const failures: string[] = [];
  const check = (owner: string, text: string | undefined, render: (s: string) => string): void => {
    if (!text) return;
    const html = render(text);
    const left = uncolouredTerms(html);
    if (left.length) failures.push(`${owner}: ${left.join(', ')} — ${html}`);
  };
  it('card bodies (printed + gilded + Choose One branches) through the card pipeline', () => {
    for (const c of ALL_CARDS) {
      check(c.id, c.text, rulesHtml);
      check(`${c.id} (gilded)`, c.goldenText, rulesHtml);
      for (const o of c.chooseOne ?? []) { check(`${c.id} option`, o.text, rulesHtml); check(`${c.id} option (gilded)`, o.goldenText, rulesHtml); }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
  it('rune text and hero-power text through mdBold (tips, Compendium, hero select)', () => {
    for (const r of [...RUNES, ...EPIC_RUNES]) check(`rune ${r.id}`, r.text, mdBold);
    for (const h of HEROES) check(`hero ${h.id}`, h.power.text, mdBold);
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

describe('rendered DOM — Seedling Spirit (the reported card)', () => {
  const m = mount(null);
  afterAll(() => m.unmount());
  const view = (id: string): CardView => {
    const d = CARD_INDEX[id]!;
    return { name: d.name, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: d.keywords, text: d.text ?? '', goldenText: d.goldenText };
  };
  it("renders 'Spirit' inside a .desc b (coloured) and keeps the text content intact", () => {
    m.render(<Card card={view('sp3_seedling')} forceFull />);
    const bolds = [...m.container.querySelectorAll('.desc b')].map((b) => normWs(b.textContent ?? ''));
    expect(bolds).toContain('Spirit');
    expect(descTextOf(m.container)).toBe(plainOf(CARD_INDEX['sp3_seedling']!.text));
  });
  it('a Collapse card renders Collapse coloured', () => {
    const c = ALL_CARDS.find((x) => /(?<![A-Za-z])Collapse(?![A-Za-z])/.test(x.text ?? '') && !/\*\*[^*]*Collapse[^*]*\*\*/.test(x.text ?? ''));
    expect(c, 'a card with a plain (un-bolded) Collapse').toBeDefined();
    m.render(<Card card={view(c!.id)} forceFull />);
    const bolds = [...m.container.querySelectorAll('.desc b')].map((b) => normWs(b.textContent ?? ''));
    expect(bolds.some((b) => /Collapse/.test(b))).toBe(true);
  });
});
