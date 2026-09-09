import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '../index';

/**
 * RUNE OF WARDING × ENGRAVE (Bug Board 7130a89b, 2026-09-09).
 *
 * The player put a Dragon right-most beside a Transcendant and held Rune of Warding; the tripled Health
 * showed in combat and was gone at the next shop. The rune's Start-of-Combat block tripled Health by direct
 * assignment (`lead.health += gain`) and hand-emitted the buff event, bypassing `ctx.buff` — the ONE place
 * Engrave (the Transcendant adjacency aura and the EG keyword) is resolved into `permaGain`. Every other
 * Start-of-Combat rune grant already goes through `ctx.buff`; Warding now does too.
 */
const sim = (player: BoardMinion[], seed = 5) =>
  simulate(player, [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, questMods: { runeWarding: true } as never }), combatSide());

describe('Rune of Warding through the Engrave path', () => {
  it('a warded Dragon beside a Transcendant KEEPS its tripled Health — the gain carries back as Engraved', () => {
    const r = sim([
      { cardId: 'd2_transcendence', attack: 3, health: 4, sourceUid: 'T' },
      { cardId: 'd2_broodfire', attack: 4, health: 6, keywords: [], sourceUid: 'D' }, // right-most, adjacent, a Dragon
    ]);
    const lead = r.initial.player[1]!;
    const buff = r.events.find((e) => e.type === 'buff' && e.target === lead.uid && e.health > 0) as { health: number } | undefined;
    expect(buff?.health, 'still TRIPLES').toBe(12);
    const perma = r.playerPermaBuffs?.find((p) => p.sourceUid === 'D');
    expect(perma, 'the rune\'s gain must reach the run board').toBeDefined();
    expect(perma).toMatchObject({ attack: 0, health: 12, engraved: true });
  });

  it('with no Transcendant beside it the tripling stays combat-only (no permaGain), exactly as before', () => {
    const r = sim([
      { cardId: 'sandbag', attack: 0, health: 10, sourceUid: 'W' },
      { cardId: 'd2_broodfire', attack: 4, health: 6, keywords: [], sourceUid: 'D' },
    ]);
    expect(r.events.some((e) => e.type === 'buff' && e.health === 12)).toBe(true);
    expect(r.playerPermaBuffs?.find((p) => p.sourceUid === 'D')).toBeUndefined();
  });

  it('an Engraved (EG) right-most minion keeps the tripling too, and maxHealth rises with it', () => {
    const r = sim([{ cardId: 'sandbag', attack: 0, health: 10, keywords: ['EG'], sourceUid: 'E' }]);
    expect(r.playerPermaBuffs?.find((p) => p.sourceUid === 'E')).toMatchObject({ health: 20 });
    const body = r.initial.player[0]!;
    expect(r.events.some((e) => e.type === 'buff' && e.target === body.uid && e.health === 20)).toBe(true);
  });
});
