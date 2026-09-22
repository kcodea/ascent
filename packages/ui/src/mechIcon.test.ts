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
  it('Taunt and Ward never claim the medallion (frame / dome signify them instead)', () => {
    for (const c of ALL_CARDS) {
      if ((c as { spell?: unknown }).spell || (c as { ruby?: unknown }).ruby) continue; // no medallion
      const id = resolveMech(view(c.id))?.id;
      expect(id === 'taunt' || id === 'ward', `${c.id} → ${id}`).toBe(false);
    }
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
