import { describe, expect, it } from 'vitest';
import { activeSet, EPIC_RUNES, RUNES, type SetId } from '@game/content';
import type { RuneDef } from '@game/core';
import { createRun, reduce, type RunState } from '../index';

/**
 * DOC BOT LANE `runeGrantImmediacy` — a rune that says "Get X" hands X over WHEN YOU TAKE IT.
 *
 * ── The bug (owner report 2026-09-01) ──────────────────────────────────────────────────────────────────────
 *
 *   *"rune of hoardflame did not grant me a hoardflame. can you please fix this?"*
 *
 * Rune of Hoardflame reads *"Get a Hoardflame. Repeat every Start of Turn."* Its reward was a bare
 * `recurringGrant`, and the recurrence pays at TURN SETUP — but the Runeforge opens partway THROUGH a shop
 * turn, after that setup has already run. So the sentence's first half delivered nothing and the rune you
 * had just paid for looked broken until the following turn.
 *
 * ── The class, not the instance ────────────────────────────────────────────────────────────────────────────
 *
 * This is the third time this exact shape has shipped: `runeTribeDrip` had it (owner report 2026-08-20,
 * "taking the rune granted nothing until the next turn"), Rune of Ruby Resonance had it before that, and
 * Hoardflame + Dragon Breath had it here. Every case is the same mistake — a reward kind that models the
 * RECURRENCE and quietly drops the promise of a payout NOW. A pinned test per rune would have caught none of
 * the later two, so this lane asks the general question of every rune in the game.
 *
 * Two halves, deliberately:
 *
 *  · REWARD-DERIVED (below): every rune whose reward names explicit `cards` through an immediate-family kind
 *    must actually place those cards. Structural — no text parsing — so it cannot be fooled by wording.
 *  · TEXT-DERIVED: every rune whose text OPENS with "Get …" must leave you holding something. This is the
 *    half that would have caught Hoardflame on the day it was authored, because it reads the promise the
 *    player reads rather than the reward kind the author picked. Runes that legitimately hand over something
 *    other than a card are enumerated with a reason — an unexplained entry is the finding.
 */

const ALL_RUNES: RuneDef[] = [...RUNES, ...EPIC_RUNES];

/**
 * Take the rune in a fresh, empty run — the same reward engine a real Runeforge purchase uses.
 *
 * PINNED TO A SET THE RUNE ACTUALLY BELONGS TO, AT MAX TIER. Two ways this harness could measure something
 * other than the rune:
 *  · A rune scoped to set 1 (Attachments, Fodder) draws from a pool that does not exist in a set-2 run, so
 *    grading it in the wrong set would report the set boundary as a broken grant. `sets` absent = every set.
 *  · A "N random <filter> minions" grant draws from `tier <= state.tier`, so at a fresh run's tier 1 the
 *    Attachment runes legitimately find nobody. Tier 6 is the state a Runeforge visit can actually be in.
 */
function take(runeId: string): RunState {
  const rune = ALL_RUNES.find((r) => r.id === runeId)!;
  const setId = (rune.sets?.[0] ?? activeSet().id) as SetId;
  const before = { ...createRun(1, undefined, undefined, undefined, setId), phase: 'recruit', tier: 6, hand: [], board: [] } as RunState;
  return reduce(before, { type: 'devGrant', kind: 'rune', id: runeId } as never) as RunState;
}

/** Everything the player is now holding or fielding. */
const held = (s: RunState): string[] => [...s.hand.map((c) => c.cardId), ...s.board.map((c) => c.cardId)];

/**
 * The card ids a reward tree promises IMMEDIATELY, by kind:
 *  · `grant`            — the plain "get this card" kind.
 *  · `recurringGrant`   — "get this, and again every turn" …but ONLY at the flat cadence. A rune with
 *                         `everyTurns` reads "Every N turns, get X", which promises nothing up front, and
 *                         paying one now would desync its badge countdown from its payout.
 *  · `multi`            — recurse; both of the bug's runes hide their grant inside one.
 * Rewards naming a random tier/tribe/filter instead of ids are covered by the text half below, which measures
 * "did anything arrive" rather than "did THIS arrive".
 */
function promisedCards(reward: unknown): string[] {
  const r = reward as { kind?: string; cards?: string[]; everyTurns?: number; rewards?: unknown[] };
  if (!r || typeof r !== 'object') return [];
  if (r.kind === 'multi') return (r.rewards ?? []).flatMap(promisedCards);
  if (r.kind === 'grant') return r.cards ?? [];
  if (r.kind === 'recurringGrant' && (r.everyTurns ?? 1) === 1) return r.cards ?? [];
  return [];
}

describe('Doc Bot — a rune with an immediate card grant actually grants it', () => {
  const named = ALL_RUNES.filter((r) => promisedCards(r.reward).length > 0);

  it('the lane has runes to check (a broken reward walk would silently pass)', () => {
    expect(named.length).toBeGreaterThan(40);
    // The two the owner reported. Named explicitly so a refactor that stopped classifying `recurringGrant`
    // as immediate would fail HERE, with the reason, rather than by quietly shrinking the sweep.
    expect(named.map((r) => r.id)).toEqual(expect.arrayContaining(['rune_hoardflame', 'rune_dragon_breath']));
  });

  it.each(named.map((r) => [r.id] as const))('%s places the card it names', (runeId) => {
    const rune = ALL_RUNES.find((r) => r.id === runeId)!;
    const holding = held(take(runeId));
    for (const cardId of promisedCards(rune.reward)) {
      expect(holding, `${runeId} ("${rune.text}") named ${cardId} but handed over nothing`).toContain(cardId);
    }
  });
});

describe('Doc Bot — a rune whose text OPENS with "Get" leaves you holding something', () => {
  /**
   * Runes that open with "Get" and legitimately hand over something that is not a card in hand or on board.
   * Each needs a REASON, because the whole point of the lane is that "this one is fine" must be argued rather
   * than assumed — that assumption is what let Hoardflame ship.
   */
  const NON_CARD: Record<string, string> = {
    rune_small_fortune: 'Gold, not a card — "Get 7 Gold immediately"',
    rune_muster: 'a Shop refresh, which fills the tavern row rather than your hand',
    rune_gemcutting: 'Rubies, which are minted to their own store rather than dealt as minions',
    rune_investment: 'conditional — "when you sell 2 minions", so nothing is owed on purchase',
    rune_trophy: 'conditional — the copy is of a minion you have not killed yet',
    rune_quick_study: 'explicitly deferred — "at End of Turn, for the next 2 turns"',
    rune_happy_birthday: 'a Gift Discover, which opens a choice rather than dealing a card',
  };

  /** Text with markdown stripped, so "Get a **Hoardflame**" and "Get a Hoardflame" read alike. */
  const plain = (r: RuneDef): string => r.text.replace(/\*\*/g, '').trim();
  const promisers = ALL_RUNES.filter((r) => /^get\b/i.test(plain(r)));

  it('every entry in the exemption list is still a rune that opens with "Get"', () => {
    // A stale exemption is a hole in the lane: the rune it named could be reworded to promise a card and
    // nobody would notice it had been excused.
    for (const id of Object.keys(NON_CARD)) {
      expect(promisers.map((r) => r.id), `${id} no longer opens with "Get" — drop the exemption`).toContain(id);
    }
  });

  it.each(promisers.filter((r) => !NON_CARD[r.id]).map((r) => [r.id] as const))(
    '%s hands over a card on purchase',
    (runeId) => {
      const rune = ALL_RUNES.find((r) => r.id === runeId)!;
      expect(
        held(take(runeId)).length,
        `"${plain(rune)}" promises a card NOW — either grant one on purchase, or add ${runeId} to NON_CARD with the reason`,
      ).toBeGreaterThan(0);
    },
  );
});
