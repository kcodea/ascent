import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNE_INDEX, RUNES, poolFor, SETS } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult } from '@game/core';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { applyEndOfTurn, fireRecruitDeathrattlesForTest } from './recruit';

const bm = (cardId: string, attack: number, health: number, extra?: Partial<BoardMinion>): BoardMinion =>
  ({ cardId, attack, health, ...extra } as BoardMinion);
const card = (uid: string, cardId: string, attack = 3, health = 3, extra?: Partial<BoardCard>): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false, ...extra });

/** The owner's 2026-08-04 balance batch — every behaviour change pinned. */

describe('Water Dragon — Avenge (3) copies the left-most hand Spell', () => {
  it('grants a copy of the left-most spell from the combat hand snapshot', () => {
    const r = simulate(
      [bm('d2_curator', 1, 9999), bm('feed', 1, 1), bm('feed', 1, 1), bm('feed', 1, 1)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX,
      combatSide({ tier: 4, handSpellIds: ['growth', 'mend'] }), combatSide({ tier: 4 }));
    // 3 friendly deaths → the Avenge fires and copies 'growth' (the left-most), not 'mend'.
    expect(r.playerHandGrants).toContain('growth');
    expect(r.playerHandGrants ?? []).not.toContain('mend');
  });

  it('a spell-less hand is a clean no-op (no random fallback)', () => {
    const r = simulate(
      [bm('d2_curator', 1, 9999), bm('feed', 1, 1), bm('feed', 1, 1), bm('feed', 1, 1)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    expect(r.playerHandGrants ?? []).toHaveLength(0);
  });
});

describe("Rope Wrangler — Echo summons a random minion from your hand (consumed)", () => {
  const fight = (handMinions: { uid: string; cardId: string; attack: number; health: number; keywords: never[]; golden: boolean }[]): CombatResult =>
    simulate(
      [bm('ropewrangler', 1, 1)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX,
      combatSide({ tier: 4, handMinions }), combatSide({ tier: 4 }));

  it('summons the hand minion with its LIVE stats and carries the consumption back', () => {
    const r = fight([{ uid: 'h1', cardId: 'pack', attack: 9, health: 9, keywords: [], golden: false }]);
    const sum = r.events.find((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'pack');
    expect(sum, 'the hand minion was summoned').toBeTruthy();
    expect((sum as { minion: { attack: number; health: number } }).minion.attack).toBe(9); // buffed stats, not base
    expect((sum as { minion: { health: number } }).minion.health).toBe(9);
    expect(r.playerHandSummoned).toEqual(['h1']); // settle removes it — the card fought, so it is spent
  });

  it('an empty / spell-only hand is a clean no-op', () => {
    const r = fight([]);
    expect(r.events.some((e) => e.type === 'summon')).toBe(false);
    expect(r.playerHandSummoned).toBeUndefined();
  });

  it('settle removes the summoned card from the run hand', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat',
      hand: [card('h1', 'pack'), card('h2', 'alley')],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
        initial: { player: [], enemy: [] }, playerHandSummoned: ['h1'] },
    };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.hand.map((c) => c.uid)).toEqual(['h2']);
  });

  it('the SHOP half (a Ryme/borrow-fired Echo) moves the hand card to the board, same card, same buffs', () => {
    const s: RunState = {
      ...createRun(1),
      board: [card('rw', 'ropewrangler')],
      hand: [card('h1', 'pack', 7, 7), card('sp', 'growth', 0, 1)], // the spell must never be picked
    };
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    const moved = s.board.find((c) => c.uid === 'h1');
    expect(moved, 'the hand minion reached the board').toBeTruthy();
    expect([moved!.attack, moved!.health]).toEqual([7, 7]);
    expect(s.hand.map((c) => c.uid)).toEqual(['sp']);
  });
});

describe('Chicken Brawl — Echo: a Charging Soldier that attacks immediately', () => {
  it('summons the soldier and it swings out of turn, before anyone else acts', () => {
    // The Brawl dies to RETALIATION from its own swing, so the soldier arrives on the player's turn and the
    // rotation would hand the next attack to the enemy. That makes this board the one that can tell an
    // immediate strike apart from a normal one: the soldier's swing must be the very NEXT attack.
    //
    // The looser "attacked at some point after arriving" assertion this replaces passed for the wrong reason
    // and hid a real bug for two days — the soldier had no charge at all and was simply taking its ordinary
    // turn (owner report 2026-08-06; root cause was a shadowed duplicate `dw_soldier` CardDef).
    const r = simulate(
      [bm('dw_chickenbrawl', 3, 1)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX, combatSide({ tier: 2 }), combatSide({ tier: 2 }));
    const sum = r.events.findIndex((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'dw_soldier');
    expect(sum, 'the soldier spawned').toBeGreaterThanOrEqual(0);
    const uid = (r.events[sum] as { minion: { uid: string } }).minion.uid;
    const nextAttack = r.events.slice(sum).find((e) => e.type === 'attack') as { attacker: string } | undefined;
    expect(nextAttack?.attacker, 'the first attack after it lands is its own').toBe(uid);
  });
});

describe('Kringle — +1/+1 per card played (owner balance 2026-08-04)', () => {
  it('the End of Turn grant now carries the Health half', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20, tier: 5,
      board: [card('k', 'dw_foreman'), card('d', 'dw_brunni')],
      playedThisTurn: ['a', 'b', 'c'],
    };
    applyEndOfTurn(s);
    const lead = s.board.find((c) => c.uid === 'k')!; // left-most Dwarf is Kringle itself
    expect(lead.attack - 3, '+1 Attack × 3 cards').toBe(3);
    expect(lead.health - 3, '+1 Health × 3 cards').toBe(3);
  });
});

describe('Rune of Distillation — "Spells", and now Rubies too', () => {
  it('a Ruby cast on a SHOP minion also lands on your left-most minion', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20, runeDistillation: true,
      board: [card('lead', 'pack', 2, 2)],
      hand: [card('r1', 'ruby', 1, 1)],
      shop: [{ uid: 'o1', cardId: 'alley' }],
    };
    s = reduce(s, { type: 'play', uid: 'r1', targetUid: 'o1' });
    expect(s.shop[0]!.atk ?? 0, 'the offer took the Ruby').toBe(1);
    const lead = s.board.find((c) => c.uid === 'lead')!;
    expect([lead.attack, lead.health], 'the left-most got the echoed Ruby').toEqual([3, 3]);
  });
});

describe('Candle Conduit fires for rubies gained IN COMBAT (settled through the real mint)', () => {
  it('a combat mintRubies carry-back triggers onGetRuby at settle', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat',
      board: [card('cc', 'k_candleconduit', 5, 5)],
      hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
        initial: { player: [], enemy: [] }, playerRubyMints: 2 },
    };
    const conduitId = s.board[0]!.cardId;
    expect(CARD_INDEX[conduitId], 'conduit id resolves').toBeTruthy();
    const before = s.board[0]!.attack + s.board[0]!.health;
    s = reduce(s, { type: 'settleCombat' });
    // 2 rubies minted → the conduit cast 2 rubies onto its (only) friendly Kobold — itself.
    const after = s.board.find((c) => c.uid === 'cc')!;
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length, 'the rubies landed in hand').toBe(2);
    expect(after.attack + after.health, 'the conduit reacted to the combat-gained rubies').toBeGreaterThan(before);
  });
});

describe('Goldcrafter (and reward cards generally) do not count as spells', () => {
  it('casting it advances no spell tally and leaves no copyable memory', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20, tier: 4,
      board: [card('t', 'pack')],
      hand: [card('g', 'goldcrafter', 0, 1)],
      spellsCast: 0, spellsThisTurn: 0,
    };
    s = reduce(s, { type: 'play', uid: 'g', targetUid: 't' });
    expect(s.board.find((c) => c.uid === 't')!.golden, 'the gild itself resolved').toBe(true);
    expect(s.spellsCast, 'not a spell — no tally').toBe(0);
    expect(s.spellsThisTurn).toBe(0);
    expect(s.firstSpellThisTurnId, 'no first-spell memory (Recurrence/Warden cannot copy it)').toBeUndefined();
    expect(s.lastSpellCastId, 'no last-spell memory (Steward/Recaller cannot copy it)').toBeUndefined();
    expect(s.playedThisTurn, 'still a CARD played').toContain('goldcrafter');
  });
});

describe('Strange Revision can be cast on Shop minions', () => {
  it('transforms the OFFER into a same-tier minion, bonus stats kept', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20, tier: 3,
      board: [], hand: [card('sr', 'strangerevision', 0, 1)],
      shop: [{ uid: 'o1', cardId: 'pack', atk: 2, hp: 2 }], // a buffed offer — the +2/+2 must survive
    };
    const beforeId = s.shop[0]!.cardId;
    s = reduce(s, { type: 'play', uid: 'sr', targetUid: 'o1' });
    const offer = s.shop[0]!;
    expect(offer.cardId, 'the offer became a different minion').not.toBe(beforeId);
    expect(CARD_INDEX[offer.cardId]!.tier, 'same tier').toBe(CARD_INDEX[beforeId]!.tier);
    expect(offer.atk, 'the +2 bonus attack re-based onto the new form').toBe(2);
    expect(offer.hp, 'the +2 bonus health re-based onto the new form').toBe(2);
  });
});

describe('the MINION ARCHIVE (owner 2026-08-04)', () => {
  const ARCHIVED = ['d2_broodlord', 'd2_runefire', 'dm_chancellor', 'k_wardstone', 'k_rubybroker'];

  it('archived cards are in NO set pool — they can never be drawn, offered or Discovered', () => {
    for (const setId of Object.keys(SETS)) {
      const pool = poolFor(setId as keyof typeof SETS);
      for (const id of ARCHIVED) {
        expect(pool.all.some((c) => c.id === id), `${id} leaked into ${setId}`).toBe(false);
      }
    }
  });

  it('…but every one still resolves through CARD_INDEX (saved runs / pinned boards / replays)', () => {
    for (const id of ARCHIVED) expect(CARD_INDEX[id], `${id} fell out of the index`).toBeTruthy();
  });

  it('Rune of the Brokerage is archived with its subject — offered never, owned still works', () => {
    expect([...RUNES, ...EPIC_RUNES].some((r) => r.id === 'rune_brokerage'), 'in a forge stock').toBe(false);
    expect(RUNE_INDEX['rune_brokerage'], 'fell out of the index — owned badges would break').toBeTruthy();
  });
});
