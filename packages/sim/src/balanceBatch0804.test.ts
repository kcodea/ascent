import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNE_INDEX, RUNES, poolFor, SETS } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { applyEndOfTurn } from './recruit';

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

describe("Rope Wrangler — End of Turn casts Lasso, scaling with Gold spent (owner rework 2026-08-18)", () => {
  // The +2/+2 self-buff is GONE. The single End-of-Turn effect casts Lasso, plus one more cast per 6 Gold spent
  // this turn, capped at 5 casts. Golden multiplies the cast count (then caps). Each cast bumps `spellsCast` /
  // `spellsThisTurn`, so the cast count is read off the `spellsCast` delta.
  const wrangler = (gold: number, golden = false): RunState => ({
    ...createRun(1), phase: 'recruit', embers: 10, shop: [],
    board: [{ ...card('rw', 'ropewrangler', 5, 4), golden }],
    goldSpentThisTurn: gold, spellsCast: 0, spellsThisTurn: 0,
  });

  it('casts Lasso once with no Gold spent this turn (min 1)', () => {
    const s = wrangler(0);
    applyEndOfTurn(s);
    expect(s.spellsCast, 'one Lasso cast').toBe(1);
    expect(s.spellsThisTurn).toBe(1);
    // The self-buff is gone: the Wrangler's stats are untouched by its own End of Turn.
    const rw = s.board.find((c) => c.uid === 'rw')!;
    expect([rw.attack, rw.health], 'no self-buff any more').toEqual([5, 4]);
  });

  it('adds one cast per 6 Gold spent this turn (12 Gold → 3 casts)', () => {
    const s = wrangler(12);
    applyEndOfTurn(s);
    expect(s.spellsCast, '1 + floor(12/6) = 3 casts').toBe(3);
  });

  it('caps the total at 5 casts however much Gold was spent', () => {
    const s = wrangler(600); // 1 + 100 → capped
    applyEndOfTurn(s);
    expect(s.spellsCast, 'hard cap of 5').toBe(5);
  });

  it('golden multiplies the cast count, then caps at 5', () => {
    // 12 Gold → base 3 casts × golden 2 = 6 → capped at 5.
    const s = wrangler(12, true);
    applyEndOfTurn(s);
    expect(s.spellsCast, '(1 + 12/6) × 2 = 6, capped at 5').toBe(5);
    // A dry golden turn: base 1 × 2 = 2 casts, under the cap.
    const dry = wrangler(0, true);
    applyEndOfTurn(dry);
    expect(dry.spellsCast, 'golden with no Gold spent → 2 casts').toBe(2);
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
    expect(lead.health - 3, '+2 Health × 3 cards (owner balance 2026-08-15)').toBe(6);
  });

  /**
   * ITEMIZED (owner ask 2026-08-29): *"give +1/+2 and repeat for every card played this turn, so the animation
   * triggers for every card played rapidly … much more exciting than 1 single animation."*
   *
   * The stat total is unchanged, which is the point — so the assertion that matters is the FX SHAPE, not the
   * numbers. Without the per-card nesting, `captureBuffFx`'s before/after diff collapses the whole loop back
   * into a single event and the animation is exactly as it was.
   */
  it('itemizes the grant: one FX wave per card played, both ends together in each', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20, tier: 5,
      // Kringle at one end and a second Dwarf at the other, so each wave has TWO recipients.
      board: [card('k', 'dw_foreman'), card('mid', 'dw_brunni'), card('r', 'dw_brunni')],
      playedThisTurn: ['a', 'b', 'c'],
      recruitBuffFx: [],
    };
    applyEndOfTurn(s);

    const mine = s.recruitBuffFx.filter((e) => e.sourceCardId === 'dw_foreman');
    const waves = [...new Set(mine.map((e) => e.fxWave))];
    expect(waves, 'three cards played → three waves, tagged 0,1,2 so the UI can stagger between them')
      .toEqual([0, 1, 2]);
    // Kringle is the LEFT end and buffs itself, but a source never draws a tendril to itself (`captureBuffFx`
    // skips it — self-buffs use the pulse channel), so the recorded target each wave is the right-most Dwarf.
    for (const w of waves) {
      const inWave = mine.filter((e) => e.fxWave === w);
      expect(inWave.every((e) => e.attack === 1 && e.health === 2),
        `wave ${w} carries the per-card grant, not the lump total`).toBe(true);
    }

    // …and KRINGLE'S OWN contribution still sums to what the single lump gave. Measured from its recorded
    // events rather than from the board, because the other Dwarf on this board has an End-of-Turn buff of its
    // own — reading final stats would be measuring both cards and calling it Kringle's.
    const toRight = mine.filter((e) => e.targetUid === 'r');
    expect([
      toRight.reduce((n, e) => n + e.attack, 0),
      toRight.reduce((n, e) => n + e.health, 0),
    ], 'three waves of +1/+2 sum to the same +3/+6 the single lump gave').toEqual([3, 6]);
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

describe('combat-minted rubies settle through the real mint', () => {
  // This block used to pin Candle Conduit's onGetRuby cast; its 2026-08-07 rework retired that behaviour
  // (it is now the every-Ruby bounce, tested in rubies.test.ts). What must SURVIVE the rework is the mint
  // path itself: a combat Ruby carry-back still lands real Rubies in hand at settle.
  it('a combat mintRubies carry-back mints real Rubies at settle', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat',
      board: [card('cc', 'k_candleconduit', 5, 5)],
      hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
        initial: { player: [], enemy: [] }, playerRubyMints: 2 },
    };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length, 'the rubies landed in hand').toBe(2);
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
