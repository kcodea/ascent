/**
 * TUTORIAL RUNES (owner ask 2026-08-22) — the course teaches the rune system on rounds 6 and 9.
 *
 * The offers are AUTHORED, not drawn: a coached step can only say what a rune does for runes the course
 * chose, and the live forge picks at random from ~300. These pin the two things an authored offer can get
 * wrong and no type would catch — a rune id that does not resolve, and a price the round cannot pay.
 */
import { describe, expect, it } from 'vitest';
import { RUNE_INDEX } from '@game/content';
import { LEARN_ASCENT } from './index';

const turnsWithRunes = LEARN_ASCENT.turns.filter((t) => t.runeOffer);

describe('the course offers runes on rounds 6 and 9', () => {
  it('exactly those two rounds, basic then epic', () => {
    expect(turnsWithRunes.map((t) => t.turn)).toEqual([6, 9]);
    expect(turnsWithRunes[0]!.runeOffer!.epic ?? false, 'round 6 is the BASIC forge').toBe(false);
    expect(turnsWithRunes[1]!.runeOffer!.epic, 'round 9 is the EPIC forge').toBe(true);
  });

  it('every offered rune id resolves to a real rune', () => {
    for (const t of turnsWithRunes) {
      for (const id of t.runeOffer!.runes) {
        expect(RUNE_INDEX[id], `round ${t.turn} offers "${id}", which no rune provides`).toBeTruthy();
      }
    }
  });

  it('the epic round offers EPIC runes and the basic round does not', () => {
    for (const id of turnsWithRunes[0]!.runeOffer!.runes) expect(RUNE_INDEX[id]!.epic ?? false, `${id} is basic`).toBe(false);
    for (const id of turnsWithRunes[1]!.runeOffer!.runes) expect(RUNE_INDEX[id]!.epic, `${id} is epic`).toBe(true);
  });

  it('no rune is offered twice across the course', () => {
    const all = turnsWithRunes.flatMap((t) => t.runeOffer!.runes);
    expect(new Set(all).size, 'a repeat would teach nothing the second time').toBe(all.length);
  });

  it('every offer is affordable — a forge the round cannot pay for is a dead end', () => {
    // The steps HARD-GATE on buying one, so an unaffordable offer would soft-lock the course. Cheapest in
    // each offer must be within a plausible round budget (the course reaches these rounds with ~10 Gold).
    for (const t of turnsWithRunes) {
      const cheapest = Math.min(...t.runeOffer!.runes.map((id) => RUNE_INDEX[id]!.cost));
      expect(cheapest, `round ${t.turn}'s cheapest rune costs ${cheapest}`).toBeLessThanOrEqual(6);
    }
  });

  it('their texts are short enough to read in a coached beat', () => {
    for (const t of turnsWithRunes) {
      for (const id of t.runeOffer!.runes) {
        expect(RUNE_INDEX[id]!.text.replace(/\*\*/g, '').length, `${id} is a wall of text for a first-timer`).toBeLessThan(90);
      }
    }
  });

  it('a forge round LEADS with its rune step — the forge owns the screen from the first frame', () => {
    // The Runeforge is queued at turn start (`pendingBasicForge` → `openNextStartOfTurnModal`), not opened by
    // the player. So any step placed before the rune step is coached at a screen the player cannot act on:
    // the owner hit exactly this on round 6, where step 40 asked them to buy Kennelmaster while the Runeforge
    // was up and the connector pointed at bare board.
    for (const turn of LEARN_ASCENT.turns.filter((t) => t.runeOffer)) {
      const first = turn.steps[0]!;
      expect(first.completion.kind, `round ${turn.turn} opens on the Runeforge but its first step is ${first.id}`)
        .toBe('ownsRunes');
    }
  });
});
