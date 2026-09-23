import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { detectCardKeywords } from './detectCardKeywords';
import { KEYWORD_GLOSSARY } from './keywordGlossary';

const ids = (card: { keywords: any[]; text: string }) => detectCardKeywords(card).map((e) => e.id);

describe('detectCardKeywords', () => {
  it('returns badge keywords in glossary order (Taunt before Ward)', () => {
    expect(ids({ keywords: ['DS', 'T'], text: '' })).toEqual(['taunt', 'ward']);
  });

  it('detects terms from the text, in glossary order not text order', () => {
    // Echo is declared before Choose One in the glossary.
    expect(ids({ keywords: [], text: '**Echo:** do a thing. **Choose One:** a or b.' }))
      .toEqual(['echo', 'chooseone']);
  });

  it('unions badge + text and de-dupes (Ward named AND badged appears once)', () => {
    expect(ids({ keywords: ['DS'], text: 'Gain **Ward**.' })).toEqual(['ward']);
  });

  it('matches classic aliases in raw text (Deathrattle -> echo)', () => {
    expect(ids({ keywords: [], text: '**Deathrattle:** boom.' })).toEqual(['echo']);
  });

  it('respects word boundaries (Warden does not match Ward; Uprising not Rise)', () => {
    expect(ids({ keywords: [], text: 'The Warden watches the Uprising.' })).toEqual([]);
  });

  it('returns [] for a vanilla card', () => {
    expect(ids({ keywords: [], text: '' })).toEqual([]);
  });

  // The three owner-worded pills (2026-09-18): Equip fires on the "**Equip <Name> (cost):**" text every Equipment
  // minion prints (no schema badge); Collapse + Starform fire on their nouns. Wording is pinned verbatim.
  it('Equip / Starform / Collapse pills: detection + the owner wording', () => {
    const lens = CARD_INDEX['ce3_lensgrinder']!; // "**Equip Stellar Lens (2):** create a **Starform**, …"
    const found = detectCardKeywords({ keywords: lens.keywords, text: lens.text ?? '' });
    expect(found.map((d) => d.id)).toEqual(['equip', 'starform']); // glossary order: Build & shop before Spells & tokens
    expect(found.find((d) => d.id === 'equip')!.def).toBe('Can be triggered once per turn, per equipment, for a cost.');
    expect(found.find((d) => d.id === 'starform')!.def).toBe('A minion that occupies a Shop slot and stays in place until purchased or destroyed. Purchasing a Starform grants stats to the left-most Celestial.');
    expect(ids({ keywords: [], text: '**Shout:** Collapse your **Starform**.' })).toEqual(['shout', 'starform', 'collapse']);
    expect(KEYWORD_GLOSSARY.find((d) => d.id === 'collapse')!.def).toBe("Grant 50% of your Starform's stats to 3 Celestials and destroy it.");
    // "Equipment" (the noun) alone is not the Equip pill — it is its own (2026-09-18); a rune saying "an Equip minion" is Equip.
    expect(ids({ keywords: [], text: 'its Equipment costs 0.' })).toEqual(['equipment']);
    expect(ids({ keywords: [], text: '**Discover** an Equip minion.' })).toEqual(['discover', 'equip']);
  });

  // The 2026-09-18 true-up: lower-case phrases raise a pill through `detectRe` (never coloured), Compendium-only
  // rows never do, and the Amplified pill fires on the verb as well as the state.
  it('detectRe phrases, Compendium-only rows, Amplify/Amplified', () => {
    expect(ids({ keywords: [], text: '**Rally:** summon a random Spirit from your hand.' })).toEqual(['rally', 'summonfromhand']);
    expect(ids({ keywords: [], text: 'After you play an **Attachment** from hand, get a random Shop spell.' })).toEqual(['attachment', 'shopspell']);
    expect(ids({ keywords: [], text: 'gains +1 Attack permanently.' })).toEqual(['permanent']);
    expect(ids({ keywords: [], text: 'Improve this by **+2/+2** when you cast a Shop spell.' })).toEqual(['improve', 'shopspell']);
    expect(ids({ keywords: [], text: '**Amplify** your Equipment. **Start of Turn:** repeat this.' })).toEqual(['startofturn', 'equipment', 'amplified']);
    expect(ids({ keywords: [], text: 'Whenever another minion is summoned, gain +1/+1.' })).toEqual([]); // no Watcher pill
  });

  // PUMMEL (owner keyword 2026-09-21): "**Pummel (40):** …" (Han Gover) and "**Pummel (6):** …" (Goldvein) raise the
  // Pummel pill off the word on its boundary, the number stays in the card text (it is the threshold X, not a
  // buff number), and the definition is the owner's. Declared like Avenge (N).
  it('Pummel (X) pills: Han Gover (40) and Goldvein (6) raise the pill; the wording is pinned', () => {
    const gover = CARD_INDEX['dw3_hangover']!;
    const vein = CARD_INDEX['k3_goldvein']!;
    expect(gover.text).toBe('**Pummel (40):** Get a **Dwarven Ale**. (Once per combat)');
    expect(vein.text).toBe('**Pummel (6):** Gain **3 Gold** next turn. (Once per combat)');
    expect(ids({ keywords: gover.keywords, text: gover.text ?? '' })).toEqual(['pummel', 'ale']);
    expect(ids({ keywords: vein.keywords, text: vein.text ?? '' })).toEqual(['pummel']);
    expect(ids({ keywords: gover.keywords, text: gover.goldenText ?? '' })).toEqual(['pummel', 'ale']);
    expect(KEYWORD_GLOSSARY.find((d) => d.id === 'pummel')!.def).toBe('Pummel (X): Triggers each time this minion has dealt another X damage. The damage count carries over between combats.');
    expect(KEYWORD_GLOSSARY.find((d) => d.id === 'pummel')!.section).toBe('triggers');
    // Word boundary: "Pummeled" / "pummel" (lower-case verb) never raise it.
    expect(ids({ keywords: [], text: 'It gets Pummeled. You pummel it.' })).toEqual([]);
  });

  // SELL (owner keyword 2026-09-23): "any card that operates on a 'When you sell this' should now say 'Sell: xyz'
  // with sell being a highlighted keyword … put a pill in for Sell that says 'Triggers when this minion is sold.'"
  // Every `onSell` minion prints the keyword form and raises the pill; the wording is the owner's verbatim. The pill
  // fires ONLY on the keyword form: the verb in a sell spell ("Sell a friendly minion") and the sell-value line
  // ("Sells for 2 Gold") are ordinary text and never raise a pill that says "this minion".
  it('Sell pills: every onSell minion reads "Sell: …" and raises the pill; the verb never does', () => {
    const SELLERS = ['hoardwhelp', 'salvatore', 'd2_riverdrake', 'k_beggy', 'k_pouchpincher', 'n2_salesman', 'sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler'];
    for (const id of SELLERS) {
      const c = CARD_INDEX[id]!;
      expect(c.effects.some((e) => e.on === 'onSell'), id).toBe(true);
      expect(c.text, id).toMatch(/\*\*Sell:\*\* /);
      expect(c.goldenText, id).toMatch(/\*\*Sell:\*\* /);
      expect(ids({ keywords: c.keywords, text: c.text ?? '' }), id).toContain('sell');
      expect(ids({ keywords: c.keywords, text: c.goldenText ?? '' }), id).toContain('sell');
    }
    expect(CARD_INDEX['salvatore']!.text).toBe('**Sell:** **Discover** 2 Tier 6 minions.');
    expect(CARD_INDEX['k_beggy']!.text).toBe('**Sell:** get **2 Rubies**.');
    expect(CARD_INDEX['sp3_grovereveler']!.text).toBe('**Sell:** give your minions **+1/+1**, then increase that by 1.');
    const def = KEYWORD_GLOSSARY.find((d) => d.id === 'sell')!;
    expect(def.def).toBe('Triggers when this minion is sold.');
    expect(def.section).toBe('triggers');
    // Only the keyword form: the bare verb, the sell-value sentence and a lower-case "sell" never raise it.
    expect(ids({ keywords: [], text: 'Sell a friendly minion. Give its stats to **2 random** friendly minions.' })).toEqual([]);
    expect(ids({ keywords: [], text: 'Sells for **2 Gold**.' })).toEqual([]);
    expect(ids({ keywords: [], text: 'The next minion you **sell** this turn sells for 3 Gold.' })).toEqual([]);
    expect(ids({ keywords: [], text: 'When you sell a **Demon**, this gains its stats.' })).toEqual([]);
    expect(ids({ keywords: [], text: '**Sell:** get **6 Gold**. **End of Turn:** get a random Tier 1 Spell or Minion.' })).toEqual(['endofturn', 'sell']);
  });
});
