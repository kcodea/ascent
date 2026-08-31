import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX } from '@game/content';
import { makeRng } from '@game/core';
import { createRun, poolOf, reduce, type Action, type BoardCard, type RunState } from '../index';
import { tierSlots } from '../shop';

/**
 * DOC BOT LANE `shopCapacity` — the Shop row never grows past its slot count.
 *
 * ── The owner's ruling (2026-08-31) ───────────────────────────────────────────────────────────────────────
 *
 * Off player report 5c5b50a0: *"rune of open enrollement overflows the shop. there are too many minions
 * available. the extra minion doesnt remove a different option from the shop so othere are 7 options instead
 * of 6."*
 *
 * *"the shop should never overflow beyond its capacity, it should only ever replace available slots with
 * affected minions or spells etc."*
 *
 * So capacity is an INVARIANT, not a property of any one effect: `tierSlots(tier)` minion offers, and an
 * effect that wants to put something in the row displaces an offer rather than appending one.
 *
 * ── Two detectors, because one is not enough ──────────────────────────────────────────────────────────────
 *
 * 1. **BEHAVIOURAL.** Drive real runs through random legal actions and assert the row after every action.
 *    This is what actually catches the bug, and it catches it wherever it comes from — the guilty effect
 *    never has to be named.
 *
 * 2. **STATIC.** Every site that can push into `state.shop` is listed with the reason it cannot overflow. The
 *    behavioural half only sees paths a driven run reaches; the Fodder path below needs a Demon on board AND
 *    queued Fodder AND a held modal, which random play may not assemble in 60 steps. A new `shop.push` with
 *    no bound fails here the day it is written, which is the half that scales.
 */

/** The invariant: minion offers in the row, which is what `tierSlots` sizes. */
function minionOffers(s: RunState): number {
  return s.shop.filter((o) => {
    const d = CARD_INDEX[o.cardId];
    return d && !d.spell && !d.ruby;
  }).length;
}

/**
 * The same action generator `conservationLaws` drives its runs with — modal-first, then a weighted mix.
 * Copied rather than shared on purpose: a fuzz lane's action mix is part of ITS coverage, and one lane
 * widening the mix should not silently change what another lane exercises.
 */
function nextAction(s: RunState, rng: { int(n: number): number }): Action {
  if (s.discover) return { type: 'discover', index: rng.int(Math.max(1, s.discover.length)) };
  if (s.chooseOne) return { type: 'chooseOne', index: rng.int(2) };
  if (s.pendingTarget) {
    const t = s.board[rng.int(Math.max(1, s.board.length))] ?? s.board[0];
    return t ? { type: 'battlecryTarget', targetUid: t.uid } : { type: 'faceOmen' };
  }
  if (s.questOffer) return { type: 'buyQuest', index: rng.int(Math.max(1, s.questOffer.length)) };
  if (s.powerOffer) return { type: 'pickPower', index: rng.int(Math.max(1, s.powerOffer.heroIds.length)) };
  if (s.runeforgeOffer) return rng.int(3) === 0 ? { type: 'skipRuneforge' } : { type: 'buyRune', index: rng.int(Math.max(1, s.runeforgeOffer.length)) };
  if (s.scoutedNextOpponent?.length) return { type: 'closeScout' };
  if (s.phase === 'combat') return { type: 'resolveCombat' };
  if (s.lastCombat && !s.combatSettled && s.phase !== 'recruit') return { type: 'settleCombat' };
  const roll = rng.int(100);
  if (roll < 24 && s.shop.length > 0) return { type: 'buy', uid: s.shop[rng.int(s.shop.length)]!.uid };
  if (roll < 44 && s.hand.length > 0) {
    const c = s.hand[rng.int(s.hand.length)]!;
    const target = s.board[rng.int(Math.max(1, s.board.length))];
    return { type: 'play', uid: c.uid, ...(target ? { targetUid: target.uid } : {}) };
  }
  if (roll < 54 && s.board.length > 0) return { type: 'sell', uid: s.board[rng.int(s.board.length)]!.uid };
  if (roll < 68) return { type: 'roll' };   // weighted UP: Refresh is the trigger the reported rune rides
  if (roll < 74) return { type: 'upgrade' };
  if (roll < 84) return { type: 'freeze' };
  return { type: 'faceOmen' };
}

describe('Doc Bot — the Shop never overflows its capacity', () => {
  it('holds across 8 seeds x 80 random legal actions', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = makeRng(0x5409 + seed);
      let s = createRun(seed * 7717);
      for (let step = 0; step < 80; step++) {
        const a = nextAction(s, rng);
        const next = reduce(s, a);
        if (next.phase === 'recruit') {
          expect(
            minionOffers(next),
            `seed ${seed} step ${step} after ${a.type}: the Shop holds ${minionOffers(next)} minion offers `
            + `at tier ${next.tier}, which allows ${tierSlots(next.tier)}`,
          ).toBeLessThanOrEqual(tierSlots(next.tier));
        }
        s = next;
      }
    }
  });

  it('the rune that caused the report cannot overflow, at every tier', () => {
    // Rune of Open Enrollment fires after a Refresh. Driven directly rather than hoping random play buys it:
    // this is the exact reported path, and it must hold at every shop size, not just the tier reported.
    //
    // THE BOARD IS LOAD-BEARING. `appendDominantTypeOffer` opens with `dominantBoardTribe(s)` and returns on
    // null, so an empty board makes the rune a no-op and this test vacuous — it passed against the ORIGINAL
    // bug until the board was added, which is exactly the trap the sabotage check below exists to expose.
    for (let tier = 1; tier <= 6; tier++) {
      const base = createRun(0x0e11 + tier);
      const tribal = poolOf(base).buyable.find((c) => !c.spell && !c.ruby && c.tribe && c.tribe !== 'neutral');
      expect(tribal, 'the pool must offer a tribal minion for the rune to have a dominant type').toBeTruthy();
      const body = (uid: string): BoardCard => ({
        uid, cardId: tribal!.id, tribe: tribal!.tribe,
        attack: tribal!.attack, health: tribal!.health, keywords: [], golden: false,
      } as BoardCard);
      let s = {
        ...base, tier, runeOpenEnrollment: true, embers: 999,
        board: [body('b1'), body('b2')],
      } as RunState;
      for (let i = 0; i < 6; i++) s = reduce(s, { type: 'roll' } as Action);
      expect(
        minionOffers(s),
        `tier ${tier}: ${minionOffers(s)} offers for ${tierSlots(tier)} slots after repeated Refreshes`,
      ).toBeLessThanOrEqual(tierSlots(tier));
    }
  });

  /**
   * Every site that can push into `state.shop`, with why it is bounded. A new one fails this until it is
   * declared — which is a prompt to check the bound, not a chore to silence.
   */
  const PUSH_SITES: Record<string, string> = {
    'shop.ts topUpTavern': 'the loop condition IS the bound — `while (state.shop.length < slots)`',
    'reducer.ts appendDominantTypeOffer': 'fills a free slot when short, otherwise REPLACES the right-most '
      + 'minion offer (owner ruling 2026-08-31, the fix for report 5c5b50a0)',
    'reducer.ts pendingTavern Fodder': 'UNBOUNDED, and known: queued Fodder is pushed for a Demon to eat and '
      + 'is normally consumed in the same breath. `holdFodderConsume` can defer that behind a start-of-turn '
      + 'modal, which is the window where a player could see an over-long row. Flagged for an owner ruling '
      + 'rather than changed unasked, because bounding it would change Demon behaviour',
  };

  it('every `shop.push` site is declared with its bound', () => {
    // CODE lines only — a comment quoting `shop.push` (this file's own header does) is not a push site.
    const isCode = (ln: string): boolean => {
      const t = ln.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    };
    const files = ['../shop.ts', '../reducer.ts'].map((f) => readFileSync(join(__dirname, f), 'utf8'));
    const pushes = files.reduce(
      (n, src) => n + src.split(String.fromCharCode(10))
        .filter((ln) => isCode(ln) && /\.shop\.push\(/.test(ln)).length,
      0,
    );
    expect(
      pushes,
      `${pushes} \`shop.push\` site(s) in shop.ts + reducer.ts, but ${Object.keys(PUSH_SITES).length} declared. `
      + 'A new one must be added to PUSH_SITES with the reason it cannot overflow',
    ).toBe(Object.keys(PUSH_SITES).length);
  });
});
