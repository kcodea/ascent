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
  it('Karwind (Ward + Shout-watcher, text leads with Ward) → shield, not battlecry', () => {
    // Karwind now carries Ward (keywords ['DS']) and a battlecryTriggered watcher. Its text reads
    // "**Ward.** Whenever a **Shout** triggers, …", so by first-mention Ward wins. It has no onPlay
    // effect, so it is never battlecry — the point the original example guarded.
    expect(resolveMech(view('karwind'))?.glyph).toBe('shield');
  });
  it('keyword-only empty-text card → its keyword glyph', () => {
    expect(resolveMech(view('bronzewarden'))?.glyph).toBe('shield'); // Guardian Drake, DS (+CR), no text
  });
  it('multi-mechanic in text → first mentioned wins', () => {
    // b2_armadiyo text: "**Taunt. Echo:** …" — Taunt appears first.
    expect(resolveMech(view('b2_armadiyo'))?.glyph).toBe('taunt');
  });
  it('Choose One → choose1; Engraved → engrave', () => {
    expect(resolveMech(view('shaper'))?.glyph).toBe('choose1');
    expect(resolveMech(view('thundeer'))?.glyph).toBe('engrave');
  });
  it('vanilla token → null (blank badge)', () => {
    expect(resolveMech(view('pup'))).toBeNull();
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
