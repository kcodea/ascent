import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import type { CardView } from './Card';
import { resolveMech } from './mechIcon';
import { MECHANICS } from './mechanics';
import { GLOSSARY_MECHANIC_IDS } from './MinionBook';

// A minimal CardView from a real card def (the resolver only reads cardId, keywords, text).
const view = (cardId: string): CardView => {
  const d = CARD_INDEX[cardId]!;
  return { name: d.name, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: d.keywords, text: d.text ?? '' };
};

describe('resolveMech', () => {
  it('real Shout → battlecry; onSummon watcher → eye (not battlecry)', () => {
    expect(resolveMech(view('havendrake'))?.glyph).toBe('battlecry');
    expect(resolveMech(view('mamabear'))?.glyph).toBe('eye');
  });
  it('watcher that mentions "Shout" → eye, never battlecry', () => {
    // Embermouth Whelp: text "After you trigger a **Shout**, gain +1/+1." A naive text match would
    // see "Shout" and pick battlecry; the resolver detects OWNED mechanics (no onPlay effect here),
    // so it resolves to the watcher glyph. It owns no other mechanic, so eye is unambiguous.
    expect(resolveMech(view('d2_embermouth'))?.glyph).toBe('eye');
  });
  it('Karwind (Ward + Shout-watcher) → eye — Ward is excluded from the gem, so the watcher shows', () => {
    // Karwind carries Ward (keywords ['DS']) and a battlecryTriggered watcher. Ward is signified by the CSS dome,
    // so it is EXCLUDED from the medallion (owner ask 2026-09-22); the next owned mechanic — the watcher — wins.
    // It has no onPlay effect, so it is never battlecry.
    expect(resolveMech(view('karwind'))?.glyph).toBe('eye');
  });
  it('Ward-keyword card → its OTHER mechanic (Ward excluded from the gem)', () => {
    // bronzewarden (Guardian Drake) is DS (+CR), no text. Ward is excluded, so Crit takes the gem.
    expect(resolveMech(view('bronzewarden'))?.glyph).toBe('target');
  });
  it('multi-mechanic in text → first NON-excluded mention wins', () => {
    // b2_armadiyo text: "**Taunt. Echo:** …" — Taunt appears first but is excluded from the gem (shield frame),
    // so Echo, the next mention, takes the medallion.
    expect(resolveMech(view('b2_armadiyo'))?.glyph).toBe('echo');
  });
  it('Taunt, Ward and Flurry never claim the medallion (signified another way)', () => {
    for (const c of ALL_CARDS) {
      if ((c as { spell?: unknown }).spell || (c as { ruby?: unknown }).ruby) continue; // no medallion
      const id = resolveMech(view(c.id))?.id;
      expect(id === 'taunt' || id === 'ward' || id === 'flurry', `${c.id} → ${id}`).toBe(false);
    }
  });
  it('Blazer (Flurry + Rally) → rally, since Flurry is excluded from the gem', () => {
    expect(resolveMech(view('k_blazer'))?.glyph).toBe('sword'); // rally's glyph
    expect(resolveMech(view('k_blazer'))?.id).toBe('rally');
  });
  it('Start of Turn AND Start of Combat effects share the Start of Combat lightning medallion', () => {
    // Fel Conjurer — "Start of Turn: …" (on: 'startOfTurn', no SC keyword).
    expect(resolveMech(view('d2_felconjurer'))?.id).toBe('startCombat');
    // Arena Heckler — "Start of Combat: …" via an effect trigger (on: 'startOfCombat', no SC keyword).
    expect(resolveMech(view('arenaheckler'))?.id).toBe('startCombat');
  });
  it('a consume-watcher (Enigma) → watcher eye', () => {
    // Enigma — "When you consume a minion, …" (on: 'onConsume'): watches the consume, so it is a Watcher.
    expect(resolveMech(view('dm_jumbo'))?.id).toBe('watcher');
  });
  // Owner 2026-10-15: "eye should win > echo" (R-MEDAL-EYE-01). A body with both a Watcher trigger and an Echo wears
  // the eye, whatever the text order; the eye takes Echo's place, so a badge that beat the Echo (a leading Shout) still wins.
  it('Watcher (eye) outranks Echo: the printed cards with both wear the eye', () => {
    expect(resolveMech(view('spore'))?.id).toBe('watcher');      // Sporeling: "Deathrattle: ... Triggers each time you play a Battlecry."
    expect(resolveMech(view('sergeant'))?.id).toBe('watcher');   // Sergey: "Echo: ... Improve this whenever Sergey gains Attack."
    expect(resolveMech(view('ashen_heir'))?.id).toBe('watcher'); // Ashen Heir: "Whenever an Imp dies, ..."
    expect(resolveMech(view('k_alchemist'))?.id).toBe('shout');  // Alchemist Brisbane: its Shout leads the text
  });
  it('no printed minion that has both a Watcher trigger and an Echo resolves to Echo', () => {
    const echo = MECHANICS.find((m) => m.id === 'echo')!, watcher = MECHANICS.find((m) => m.id === 'watcher')!;
    const both = ALL_CARDS.filter((d) => {
      const input = { keywords: d.keywords, effects: d.effects ?? [], chooseOne: d.chooseOne, text: d.text ?? '' };
      return echo.detect(input) && watcher.detect(input);
    });
    expect(both.length).toBeGreaterThan(0);
    for (const d of both) expect(resolveMech(view(d.id))?.id, d.id).not.toBe('echo');
  });
  it('Choose One → choose1; Engraved → engrave', () => {
    expect(resolveMech(view('shaper'))?.glyph).toBe('choose1');
    expect(resolveMech(view('thundeer'))?.glyph).toBe('engrave');
  });
  it('vanilla token → null (blank badge)', () => {
    expect(resolveMech(view('pup'))).toBeNull();
  });
});

describe('Sell medallion (R-MEDAL-01)', () => {
  it('Traveling Salesman → the Sell medallion (not Discover)', () => {
    // "**Sell:** **Discover** …" — the Sell lead must out-order the Discover mention (owner 2026-09-25).
    expect(resolveMech(view('n2_salesman'))?.id).toBe('sell');
  });
  it('every minion whose text leads with "Sell:" and has an onSell effect resolves to the Sell medallion', () => {
    const sellCards = ALL_CARDS.filter((c) => /^(\*\*)?sell:/i.test(c.text ?? '') && (c.effects ?? []).some((e) => e.on === 'onSell'));
    expect(sellCards.length).toBeGreaterThanOrEqual(9); // Hoard Whelp, Salvatore, Salesman, River Drake, Beggy, …
    for (const c of sellCards) expect(resolveMech(view(c.id))?.id, c.id).toBe('sell');
  });
});

describe('glossary ↔ registry (no drift)', () => {
  it('every glossary mechanic row is backed by a MECHANICS entry', () => {
    const ids = new Set(MECHANICS.map((m) => m.id));
    for (const id of GLOSSARY_MECHANIC_IDS) expect(ids.has(id), `glossary row ${id}`).toBe(true);
  });
});

describe('no-tribe invariant', () => {
  it('no minion resolves to a tribe-only glyph; every result is a registry glyph or null', () => {
    const registryGlyphs = new Set(MECHANICS.map((m) => m.glyph));
    const tribeOnly = new Set(['paw', 'flame', 'gear', 'crown', 'clock', 'anvil']);
    for (const c of ALL_CARDS) {
      if ((c as { spell?: unknown }).spell || (c as { ruby?: unknown }).ruby) continue; // no medallion
      const g = resolveMech(view(c.id))?.glyph ?? null;
      if (g === null) continue;
      expect(tribeOnly.has(g), `${c.id} → ${g}`).toBe(false);
      expect(registryGlyphs.has(g), `${c.id} → ${g}`).toBe(true);
    }
  });
});
