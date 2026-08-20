import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import type { CardView } from './Card';
import { resolveMechIcon } from './mechIcon';
import { MECHANICS } from './mechanics';

// A minimal CardView from a real card def (the resolver only reads cardId, keywords, text).
const view = (cardId: string): CardView => {
  const d = CARD_INDEX[cardId]!;
  return { name: d.name, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: d.keywords, text: d.text ?? '' };
};

describe('resolveMechIcon', () => {
  it('real Shout → battlecry; onSummon watcher → eye (not battlecry)', () => {
    expect(resolveMechIcon(view('havendrake'))).toBe('battlecry');
    expect(resolveMechIcon(view('mamabear'))).toBe('eye');
  });
  it('watcher that mentions "Shout" → eye, never battlecry', () => {
    // Embermouth Whelp: text "After you trigger a **Shout**, gain +1/+1." A naive text match would
    // see "Shout" and pick battlecry; the resolver detects OWNED mechanics (no onPlay effect here),
    // so it resolves to the watcher glyph. It owns no other mechanic, so eye is unambiguous.
    expect(resolveMechIcon(view('d2_embermouth'))).toBe('eye');
  });
  it('Karwind (Ward + Shout-watcher, text leads with Ward) → shield, not battlecry', () => {
    // Karwind now carries Ward (keywords ['DS']) and a battlecryTriggered watcher. Its text reads
    // "**Ward.** Whenever a **Shout** triggers, …", so by first-mention Ward wins. It has no onPlay
    // effect, so it is never battlecry — the point the original example guarded.
    expect(resolveMechIcon(view('karwind'))).toBe('shield');
  });
  it('keyword-only empty-text card → its keyword glyph', () => {
    expect(resolveMechIcon(view('bronzewarden'))).toBe('shield'); // Guardian Drake, DS (+CR), no text
  });
  it('multi-mechanic in text → first mentioned wins', () => {
    // b2_armadiyo text: "**Taunt. Echo:** …" — Taunt appears first.
    expect(resolveMechIcon(view('b2_armadiyo'))).toBe('taunt');
  });
  it('Choose One → choose1; Engraved → engrave', () => {
    expect(resolveMechIcon(view('shaper'))).toBe('choose1');
    expect(resolveMechIcon(view('thundeer'))).toBe('engrave');
  });
  it('vanilla token → null (blank badge)', () => {
    expect(resolveMechIcon(view('pup'))).toBeNull();
  });
});

describe('no-tribe invariant', () => {
  it('no minion resolves to a tribe-only glyph; every result is a registry glyph or null', () => {
    const registryGlyphs = new Set(MECHANICS.map((m) => m.glyph));
    const tribeOnly = new Set(['paw', 'flame', 'gear', 'crown', 'clock', 'anvil']);
    for (const c of ALL_CARDS) {
      if ((c as { spell?: unknown }).spell || (c as { ruby?: unknown }).ruby) continue; // no medallion
      const g = resolveMechIcon(view(c.id));
      if (g === null) continue;
      expect(tribeOnly.has(g), `${c.id} → ${g}`).toBe(false);
      expect(registryGlyphs.has(g), `${c.id} → ${g}`).toBe(true);
    }
  });
});
