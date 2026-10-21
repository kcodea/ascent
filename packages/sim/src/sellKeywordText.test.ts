/**
 * R-TEXT-SELL-CAPS-01 (owner ruling 2026-10-21: "capitalized, it's a keyword"): wherever printed text means the SELL
 * action or trigger, the verb is the keyword form, bold and capitalised: **Sell**, **Sells**, **Selling**, or the
 * "**Sell:**" trigger lead (R-TEXT-09). Swept over every card (plain + Gilded, every set and the archive), every rune,
 * every Equipment, every hero power and every Ancient pairing line.
 *
 * Deliberately NOT covered: "sell value" (a noun, a property of the card, and the live-text helper for it keys on the
 * lower-case phrase), "sold" / "sales" (not the verb), and prose outside printed game text (patch notes, the rules
 * wiki, tutorial lines).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, RUNE_INDEX, EQUIPMENT_INDEX } from '@game/content';
import { HEROES } from './heroes';
import { ANCIENT_PAIRINGS } from './ancients';

const corpus: [string, string][] = [];
for (const c of Object.values(CARD_INDEX)) {
  corpus.push([`card ${c.id}`, c.text]);
  if (c.goldenText) corpus.push([`card ${c.id} (Gilded)`, c.goldenText]);
}
for (const r of Object.values(RUNE_INDEX)) corpus.push([`rune ${r.id}`, r.text]);
for (const e of Object.values(EQUIPMENT_INDEX)) {
  corpus.push([`equipment ${e.id}`, e.text]);
  if (e.goldenText) corpus.push([`equipment ${e.id} (Gilded)`, e.goldenText]);
}
for (const h of HEROES) if (h.power?.text) corpus.push([`hero power ${h.id}`, h.power.text]);
for (const [hero, byAncient] of Object.entries(ANCIENT_PAIRINGS)) {
  for (const [ancient, p] of Object.entries(byAncient ?? {})) {
    if (p?.offerText) corpus.push([`ancient ${hero}/${ancient} offer`, p.offerText]);
    if (p?.powerText) corpus.push([`ancient ${hero}/${ancient} power`, p.powerText]);
  }
}

/** Every use of the verb, with whether it sits inside a bold span. */
function sellUses(text: string): { word: string; bold: boolean }[] {
  const out: { word: string; bold: boolean }[] = [];
  text.split('**').forEach((seg, i) => {
    for (const m of seg.matchAll(/\b(sell|sells|selling)\b(?! value)/gi)) out.push({ word: m[0], bold: i % 2 === 1 });
  });
  return out;
}

describe('R-TEXT-SELL-CAPS-01: Sell is a keyword, bold and capitalised, in every printed text', () => {
  it('sweeps a real corpus', () => {
    expect(corpus.length).toBeGreaterThan(800);
    expect(corpus.filter(([, t]) => sellUses(t).length > 0).length).toBeGreaterThan(60);
  });

  it('no printed text uses a lower-case or un-bolded sell', () => {
    const bad = corpus.flatMap(([who, t]) =>
      sellUses(t).filter((u) => !u.bold || u.word[0] !== 'S').map((u) => `${who}: "${u.word}" in ${JSON.stringify(t)}`));
    expect(bad).toEqual([]);
  });
});
