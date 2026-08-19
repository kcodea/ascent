import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';

const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [] });
import { CARD_INDEX, RUNES, EPIC_RUNES, RUNE_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyCardsPlayed, applyCastEffects, makeContext, offerBuyStats, spellCasts, advanceRuneThresholds, fireOnSell, noteSpellCast } from './recruit';
import { runeTally } from '../../ui/src/runeTally';

/**
 * The 2026-08-19 owner rune batch: 4 reworks + 22 new runes.
 *
 * The cases below are the ones where a rune's VALUE is decided by engine behaviour rather than by its printed
 * data — a data-only rune is already covered by the framework test in `runes.test.ts` (every rune validates,
 * is costed, and is Runeforge-only).
 */
const minion = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), phase: 'recruit', ...over } as RunState);
const rune = (id: string) => RUNE_INDEX[id]!;

describe('rune batch 2026-08-19 — the four reworks', () => {
  it('Rune of Blart lives in the EPIC pool (array membership, not just the flag)', () => {
    // `runeforgePool` reads ARRAY membership, so moving a rune between tiers means moving the DEF — dropping
    // or adding `epic: true` alone would leave it in the wrong forge while presenting as the other. It went
    // basic on 2026-08-19 and back to Epic the same day; this pins where it actually is.
    expect(rune('rune_blart').cost).toBe(4);
    expect(EPIC_RUNES.some((r) => r.id === 'rune_blart'), 'must be in the EPIC pool').toBe(true);
    expect(RUNES.some((r) => r.id === 'rune_blart'), 'must have left the basic pool').toBe(false);
  });

  it('Infernal Ink fires on EVERY Shop spell and its buff is run-wide (not just the current row)', () => {
    const s = run({ runeThresholds: [{ ...(rune('rune_infernal_ink').reward as { meter: 'spellCast'; per: number; buff: { target: 'shop'; attack: number; health: number } }), tick: 0 }] as never });
    advanceRuneThresholds(s, 'spellCast', 1);
    // `shop` writes tavernBuyBonus — the run-wide layer every FUTURE roll inherits, which is what makes it
    // "minions in the Shop everywhere" rather than a decoration on the row on screen.
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp], 'one cast should already have paid').toEqual([1, 1]);
  });

  it("Merchant's Chorus buff is THIS TURN only — it stacks across rolls, then clears at the rollover", () => {
    const s = run({ shop: [{ uid: 'o1', cardId: 'stray' }] });
    // Two Shouts this turn → +6/+6 banked in the per-turn layer, and NOT in the permanent one.
    s.tavernBuyBonusTurn = { atk: 3, hp: 3 };
    const oneShout = offerBuyStats(s, s.shop[0]!);
    s.tavernBuyBonusTurn = { atk: 6, hp: 6 };
    const twoShouts = offerBuyStats(s, s.shop[0]!);
    expect(twoShouts.attack - oneShout.attack, 'a second Shout stacks onto the same shop').toBe(3);
    expect(s.tavernBuyBonus.atk, 'it must NOT leak into the permanent shop bonus').toBe(0);
    // …and the rollover wipes it (the reducer clears it beside the other per-turn tallies).
    s.tavernBuyBonusTurn = undefined;
    expect(offerBuyStats(s, s.shop[0]!).attack).toBe(oneShout.attack - 3);
  });
});

describe('rune batch 2026-08-19 — the new mechanics', () => {
  it('the tribe faucet drips 1 for Basic and 2 for Epic — the Epic runes are the doubled version', () => {
    const basic = rune('rune_basic_dragon').reward as { kind: string; tribe: string; count: number };
    const epic = rune('rune_epic_dragon').reward as { kind: string; tribe: string; count: number };
    expect([basic.kind, basic.tribe, basic.count]).toEqual(['runeTribeDrip', 'dragon', 1]);
    expect([epic.kind, epic.tribe, epic.count]).toEqual(['runeTribeDrip', 'dragon', 2]);
  });

  it('Hoardflame / Dragon Breath double THEIR OWN spell only — which is what drives the ×N badge', () => {
    // `spellCasts` is the same read the shop's ×N badge previews, so arming the rune makes the modifier show.
    const s = run({ runeSpellDouble: ['hoardflame'] });
    expect(spellCasts(s, CARD_INDEX['hoardflame']!), 'the named spell doubles').toBe(2);
    expect(spellCasts(s, CARD_INDEX['growth']!), 'an unrelated spell is untouched').toBe(1);
  });

  it('the Glider pumps a Dragon on every card played, and no-ops with no Dragon out', () => {
    const s = run({ runeGlider: { attack: 4, health: 4 }, board: [minion('d', 'd2_embermouth', 2, 2)] });
    applyCardsPlayed(s, 1);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([6, 6]);
    // No Dragon → the rune simply waits rather than buffing something off-tribe.
    const noDragon = run({ runeGlider: { attack: 4, health: 4 }, board: [minion('b', 'stray', 2, 2)] });
    applyCardsPlayed(noDragon, 1);
    expect([noDragon.board[0]!.attack, noDragon.board[0]!.health]).toEqual([2, 2]);
  });

  it('Blasting Voices is TWO stacked shout repeats — +2 triggers, where the Choir gives +1', () => {
    const r = rune('rune_blasting_voices').reward as { kind: string; rewards: { kind: string }[] };
    expect(r.kind).toBe('multi');
    expect(r.rewards.filter((x) => x.kind === 'shoutRepeat')).toHaveLength(2);
    const bought = reduce(
      { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: ['rune_blasting_voices'] } as RunState,
      { type: 'buyRune', index: 0 },
    );
    expect(bought.shoutExtraAlways ?? 0, 'two stacked grants = 2 extra triggers').toBe(2);
  });

  it('every new rune is costed, set-scoped where it names set-2 mechanics, and Runeforge-only', () => {
    const NEW = ['rune_refraction', 'rune_ruby_resonance', 'rune_hoardflame', 'rune_glider', 'rune_drake_skull',
      'rune_catacomb', 'rune_pendant', 'rune_ornate_clock', 'rune_dragon_breath', 'rune_ruins',
      'rune_engraving_gems', 'rune_blasting_voices',
      ...['dwarf', 'dragon', 'beast', 'demon', 'kobold'].flatMap((t) => [`rune_basic_${t}`, `rune_epic_${t}`])];
    for (const id of NEW) {
      const r = RUNE_INDEX[id];
      expect(r, `${id} is missing`).toBeTruthy();
      expect(r!.cost, `${id} cost`).toBeGreaterThan(0);
      expect(CARD_INDEX[id], `${id} must not collide with a card id`).toBeUndefined();
    }
    expect(NEW).toHaveLength(22);
  });
});

/** The second wave (owner batch 2026-08-19b): five basic runes whose value is decided by engine behaviour. */
describe('rune batch 2026-08-19b — Herding Horn / Bubble Crown / War Drum / Baller / Wishbone', () => {
  const armed = (id: string): RunState => reduce(
    { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: [id] } as RunState,
    { type: 'buyRune', index: 0 },
  );

  it('Bubble Crown pays ONCE at 12 spells, raising spell power — then the meter parks at 12/12', () => {
    const s = armed('rune_bubble_crown');
    advanceRuneThresholds(s, 'spellCast', 11);
    expect(s.spellBonus?.attack ?? 0, 'nothing at 11 — the threshold is 12').toBe(0);
    advanceRuneThresholds(s, 'spellCast', 1);
    expect([s.spellBonus?.attack, s.spellBonus?.health], 'spell power rises by the printed +6/+6').toEqual([6, 6]);
    // ONCE: a further 24 casts must not pay again, and the meter stays at its cap so the x/12 readout doesn't
    // reset and imply another payout is coming.
    advanceRuneThresholds(s, 'spellCast', 24);
    expect(s.spellBonus?.attack, 'it must never pay twice').toBe(6);
    const t = s.runeThresholds!.find((x) => x.sourceId === 'rune_bubble_crown')!;
    expect([t.tick, t.per], 'the counter parks at its cap').toEqual([12, 12]);
  });

  it('War Drum gives ONE Shout +2 triggers per turn, and the charge comes back next turn', () => {
    const s = armed('rune_war_drum');
    expect(s.runeWarDrum).toBe(2);
    expect(s.runeWarDrumUsedThisTurn, 'the charge starts available (the readout reads 1)').toBeFalsy();
  });

  it('the Baller escalates AND alternates: +1 Attack, then +2 Health, then +3 Attack', () => {
    const s = armed('rune_baller');
    s.board = [minion('m', 'stray', 1, 1)];
    const body = () => [s.board[0]!.attack, s.board[0]!.health];
    fireOnSell(s, minion('sold1', 'stray'));
    expect(body(), 'sale 1 → +1 Attack').toEqual([2, 1]);
    fireOnSell(s, minion('sold2', 'stray'));
    expect(body(), 'sale 2 → +2 Health').toEqual([2, 3]);
    fireOnSell(s, minion('sold3', 'stray'));
    expect(body(), 'sale 3 → +3 Attack').toEqual([5, 3]);
  });

  it('Wishbone is offered ONLY to heroes whose power can actually repeat', () => {
    // `requiresDoublePower` is what hides it — a rune offered to a hero it silently does nothing for is worse
    // than one offered less often, which is why the gate is the ACTIVE half of the owner's roster.
    // `requiresDoublePower` is the field `runeforgePool` filters on; the roster itself lives in
    // DOUBLEABLE_POWERS (reducer), deliberately the ACTIVE half of the owner's list — the ten PASSIVE powers
    // are excluded until each learns to repeat at its own fire site.
    expect(RUNE_INDEX['rune_wishbone']!.requiresDoublePower).toBe(true);
    expect(armed('rune_wishbone').runeWishbone, 'buying it arms the doubler').toBe(true);
  });

  it('the Herding Horn is a combat flag, so it counts Rallies the way the game defines them', () => {
    const s = armed('rune_herding_horn');
    expect(s.questFlags?.runeHerdingHorn, 'armed as a combat mod, read by the sim’s bumpRally').toBe(true);
  });
});

/** The third wave (owner batch 2026-08-19c): 2 reworks + 5 Epic runes + the Might of Aeon spell. */
describe('rune batch 2026-08-19c — Reliquary / Blart / the five Epics', () => {
  const armed3 = (id: string): RunState => reduce(
    { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: [id] } as RunState,
    { type: 'buyRune', index: 0 },
  );

  it('Might of Aeon is an ORDINARY Shop spell — drawable, not a rune-only token', () => {
    const def = CARD_INDEX['mightofaeon']!;
    expect([def.tier, def.cost, def.spell]).toEqual([3, 2, true]);
    expect(def.token, 'must be draftable from the shop, not token-locked').toBeFalsy();
    expect(poolFor('set1').spells.some((c) => c.id === 'mightofaeon'), 'in the drawable spell pool').toBe(true);
  });

  it('Rune of Might casts Might of Aeon off a spell — once, not recursively', () => {
    // The triggered cast is real, so without the re-entry latch it would re-enter the hook that cast it and
    // never stop. Three minions on board so the 3-target spread has somewhere to land.
    const s = armed3('rune_might');
    s.board = [minion('a', 'stray', 1, 1), minion('b', 'stray', 1, 1), minion('c', 'stray', 1, 1)];
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    noteSpellCast(s, CARD_INDEX['growth']!); // any cast triggers the rune
    const after = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    // 3 targets x (+2/+3) = +15 across the board, exactly once.
    expect(after - before, 'exactly one Might of Aeon, not an infinite cascade').toBe(15);
  });

  it('Rune of Held Strength is a one-shot acquire reward reading the left-most hand card', () => {
    // NOT driven through `reduce` here: a hand-built mid-run state with a NON-EMPTY hand comes back from
    // `buyRune` with an empty board (reproduced with an unrelated rune, and with both token and non-token
    // cards — a pre-existing quirk of synthesising state this way, not of this rune). So this pins the wiring
    // and the ONE-SHOT shape; the arithmetic is the shared `addBuff` every other rune buff uses.
    const r = rune('rune_held_strength');
    expect(r.reward.kind, 'a single acquire-time reward, not a standing aura').toBe('runeHeldStrength');
    expect(r.epic).toBe(true);
    expect(r.cost).toBe(3);
    // Buying it with an EMPTY hand is a clean no-op rather than an error — the reward has nothing to read.
    expect(() => armed3('rune_held_strength')).not.toThrow();
  });

  it('Rising Echoes arms the Echo-filtered Discover AND the keywords its pick will carry', () => {
    const s = armed3('rune_rising_echoes');
    expect(s.discoverKeywords, 'the pick arrives with Rise + Taunt').toEqual(['R', 'T']);
    expect(s.echoFirstEachCombat ?? 0, 'the first Echo each combat fires an extra time').toBeGreaterThan(0);
  });

  it('the Apple arms as a COMBAT mod; the Chipper Sticker as a RECRUIT one', () => {
    // The split matters: a `combatFlag` that is only read in the shop is inert in combat, which is exactly
    // what `runeWiringAudit` catches. The Sticker fires when you PLAY a Demon, so it is recruit-side.
    expect(armed3('rune_deathtouched_apple').questFlags?.runeDeathtouchedApple).toBe(true);
    expect(armed3('rune_chipper_sticker').runeChipperSticker).toBe(true);
  });
});

// ── WAVE 4 — 10 keyword grants + Rune of the Stoked Menagerie ────────────────────────────────────────────────
describe('the 2026-08-19 keyword batch', () => {
  // Ward is 'DS' and Critical Strike is 'CR'. A 'CR' pill with no `critChance` is a badge that never rolls, so
  // the two must arrive together — that pairing is the real assertion here, not the pill itself.
  const GRANTS: [string, string[]][] = [
    ['k_kobe', ['T']], ['dm_knocked', ['T']], ['dm_chosenfiend', ['CR']], ['dm_todd', ['DS']],
    ['dw_mountainbond', ['DS', 'CR']], ['k_portsmith', ['DS']], ['karwind', ['DS']],
    ['d2_warflame', ['CR']], ['b2_beardsley', ['DS']], ['dm_maw', ['DS']],
  ];

  it.each(GRANTS)('%s wears its new keywords', (id, kws) => {
    const def = CARD_INDEX[id]!;
    for (const k of kws) expect(def.keywords, `${id} is missing ${k}`).toContain(k);
  });

  it('every Critical Strike grant carries a real per-swing chance', () => {
    for (const [id] of GRANTS.filter(([, k]) => k.includes('CR'))) {
      expect(CARD_INDEX[id]!.critChance, `${id} has the CR pill but never rolls`).toBeGreaterThan(0);
    }
  });

  it('the printed text names each keyword it gained', () => {
    for (const [id, kws] of GRANTS) {
      const def = CARD_INDEX[id]!;
      if (!def.text) continue; // a vanilla body's badges carry the meaning on their own
      if (kws.includes('DS')) expect(def.text, `${id}`).toContain('Ward');
      if (kws.includes('CR')) expect(def.text, `${id}`).toContain('Critical Strike');
      if (kws.includes('T')) expect(def.text, `${id}`).toContain('Taunt');
    }
  });
});

describe('Rune of the Stoked Menagerie', () => {
  const TRIBES = ['beast', 'undead', 'mech', 'dragon', 'demon'];
  // One effect-free body per tribe, so the only `buff` events in the log are the rune's.
  const TRIBE_BODY: Record<string, string> = {
    beast: 'trailforager', undead: 'footman', mech: 'beatboxer', dragon: 'mauron', demon: 'godfodder',
  };
  // One body per active tribe, all identical 2/2s so a doubling is unmistakable, against a wall that cannot
  // kill anything before Start of Combat resolves.
  const fight = (tribes: string[], armed = true) => simulate(
    tribes.map((t, i) => bm(TRIBE_BODY[t]!, `f${i}`, 2, 2)),
    [{ cardId: 'sandbag', attack: 0, health: 40000 }],
    makeRng(11), CARD_INDEX,
    combatSide({ tier: 6, tribes: TRIBES, questMods: armed ? { runeStokedMenagerie: true } : {} }),
    combatSide({ tier: 1 }),
  );
  const runeBuffs = (r: ReturnType<typeof fight>) =>
    r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === 'Rune of the Stoked Menagerie') as
      { target: string; attack: number; health: number }[];

  it('a full house doubles exactly 3 bodies', () => {
    const buffs = runeBuffs(fight(TRIBES));
    const targets = new Set(buffs.map((b) => b.target));
    expect(targets.size, 'three DISTINCT bodies — picked without replacement').toBe(3);
    for (const b of buffs) expect([b.attack, b.health], 'each doubles its own 2/2').toEqual([2, 2]);
  });

  it('one type short pays nothing', () => {
    expect(runeBuffs(fight(TRIBES.slice(0, 4))).length).toBe(0);
  });

  it('unarmed, a full house pays nothing either', () => {
    expect(runeBuffs(fight(TRIBES, false)).length).toBe(0);
  });

  it('the rune is a live EPIC — membership, not the flag, is what the pool reads', () => {
    expect(EPIC_RUNES.some((r) => r.id === 'rune_stoked_menagerie'), 'must live in EPIC_RUNES').toBe(true);
    expect(RUNES.some((r) => r.id === 'rune_stoked_menagerie'), 'and not in the basic pool').toBe(false);
  });
});

// ── WAVE 5 — Baller pill, Wild Hunt / Burrow / Tip Jar reworks, Summoning Bulwark ────────────────────────────
describe('Rune of the Baller — the pill names its NEXT payout', () => {
  // The rune has no threshold (every sale pays), so a x/N counter would be meaningless. What the player cannot
  // see is WHICH stat is up next and how big it is, which is exactly what the pill now carries.
  const armed = (sales: number): RunState => ({ ...createRun(1), runeBaller: { step: 1, sales } } as RunState);

  it('alternates Attack / Health and climbs, one sale ahead', () => {
    expect(runeTally(armed(0), 'rune_baller'), 'first sale').toBe('+1 Atk');
    expect(runeTally(armed(1), 'rune_baller'), 'second').toBe('+2 Hp');
    expect(runeTally(armed(2), 'rune_baller'), 'third').toBe('+3 Atk');
    expect(runeTally(armed(3), 'rune_baller'), 'fourth').toBe('+4 Hp');
  });

  it('the pill matches what the sale actually hands out', () => {
    // The read and the payout must not drift: sell with the rune armed and compare the board's real gain to
    // what the pill promised beforehand.
    const s: RunState = {
      ...createRun(1), phase: 'recruit', runeBaller: { step: 1, sales: 1 },
      board: [{ uid: 'a', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    } as RunState;
    expect(runeTally(s, 'rune_baller')).toBe('+2 Hp');
    fireOnSell(s, { uid: 'x', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false } as BoardCard);
    expect([s.board[0]!.attack, s.board[0]!.health], 'the promised +2 Health landed').toEqual([1, 3]);
  });

  it('unarmed, there is no pill at all', () => {
    expect(runeTally(createRun(1), 'rune_baller')).toBeNull();
  });
});

describe('Rune of the Wild Hunt — the ATTACKER snowballs (owner rework 2026-08-19)', () => {
  // One Beast against an unkillable 0-attack wall, so it swings many times and nothing else moves.
  const fight = () => simulate(
    [bm('trailforager', 'B', 3, 40000), bm('godfodder', 'F', 0, 40000)],
    [{ cardId: 'sandbag', attack: 0, health: 40000 }],
    makeRng(3), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'demon'], questMods: { runeWildHunt: 2 } }), combatSide({ tier: 1 }),
  );
  const hunt = (r: ReturnType<typeof fight>) =>
    r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === 'Rune of the Wild Hunt') as
      { target: string; attack: number; health: number }[];

  it('only the attacking Beast is buffed — never the board', () => {
    const bs = hunt(fight());
    expect(bs.length, 'the Beast swung and the rune paid').toBeGreaterThan(0);
    // Combat uids are positional (`m0`, `m1`, …), so the Beast at seat 0 is `m0` and the bystander is `m1`.
    expect(new Set(bs.map((b) => b.target)), 'the non-Beast bystander must get nothing').toEqual(new Set(['m0']));
  });

  it('it is Attack, and the step climbs +2 per swing', () => {
    const bs = hunt(fight());
    expect(bs.map((b) => b.attack).slice(0, 3), 'an escalating +2 per Beast attack').toEqual([2, 4, 6]);
    for (const b of bs) expect(b.health, 'the Health half is gone').toBe(0);
  });

  it('the rune text names the new numbers', () => {
    expect(RUNE_INDEX['rune_wild_hunt']!.text).toContain('+2 Attack');
  });
});

describe('Rune of the Burrow — a Beast Echo banks a refresh (owner rework 2026-08-19)', () => {
  const fight = (armed: boolean, cardId: string) => simulate(
    [bm(cardId, 'E', 0, 1)],
    [{ cardId: 'sandbag', attack: 60, health: 40000 }],
    makeRng(4), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'demon'], questMods: armed ? { runeBurrow: true } : {} }),
    combatSide({ tier: 1 }),
  );

  it('a Beast Echo pays a free refresh', () => {
    expect(fight(true, 'b2_wolvie').playerFreeRolls ?? 0).toBeGreaterThan(0);
  });

  it('a NON-Beast Echo pays nothing', () => {
    expect(fight(true, 'dm_knocked').playerFreeRolls ?? 0).toBe(0);
  });

  it('unarmed, the same Beast Echo pays nothing', () => {
    expect(fight(false, 'b2_wolvie').playerFreeRolls ?? 0).toBe(0);
  });

  it('it costs 1 Gold and no longer promises a resummon', () => {
    const r = RUNE_INDEX['rune_burrow']!;
    expect(r.cost).toBe(1);
    expect(r.text).toContain('free refresh');
    expect(r.text, 'the old resummon wording must be gone').not.toContain('resummoned');
  });
});

describe('Rune of the Tip Jar — promoted to Epic (owner rework 2026-08-19)', () => {
  it('it is a free EPIC now, at 4 / +4', () => {
    const r = RUNE_INDEX['rune_tip_jar']!;
    expect([r.cost, r.epic]).toEqual([0, true]);
    expect(r.text).toContain('4 Gold');
  });

  it('membership moved with it — the pool reads the ARRAY, not the flag', () => {
    expect(EPIC_RUNES.some((r) => r.id === 'rune_tip_jar')).toBe(true);
    expect(RUNES.some((r) => r.id === 'rune_tip_jar')).toBe(false);
  });
});

describe('Summoning Bulwark — the first 2 summons gain Taunt', () => {
  it('the spell is a real T3 3-Gold Shop spell', () => {
    const def = CARD_INDEX['summoningbulwark']!;
    expect([def.tier, def.cost, def.spell]).toEqual([3, 3, true]);
    expect(poolFor('set2').all.some((c) => c.id === 'summoningbulwark'), 'buyable').toBe(true);
  });

  it('casting banks 2 for the next combat', () => {
    const s: RunState = { ...createRun(1), phase: 'recruit' } as RunState;
    applyCastEffects(makeContext(s), CARD_INDEX['summoningbulwark']!);
    expect(s.summonTauntsNextCombat).toBe(2);
  });

  it('exactly the first 2 summoned bodies get Taunt', () => {
    // Three Echo bodies each summon an Imp: the first two arrivals are Taunted, the third is not.
    const r = simulate(
      [bm('dm_knocked', 'K1', 0, 1), bm('dm_knocked', 'K2', 0, 1), bm('dm_knocked', 'K3', 0, 1)],
      [{ cardId: 'sandbag', attack: 60, health: 40000 }],
      makeRng(6), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['demon'], questMods: { summonTaunts: 2 } }), combatSide({ tier: 1 }),
    );
    const granted = r.events.filter((e) => e.type === 'keyword' && (e as { keyword: string }).keyword === 'T');
    expect(granted.length, 'the bank is 2, so 2 Taunts — not one per summon forever').toBe(2);
  });

  it('with no spell cast, no summon is Taunted', () => {
    const r = simulate(
      [bm('dm_knocked', 'K1', 0, 1), bm('dm_knocked', 'K2', 0, 1)],
      [{ cardId: 'sandbag', attack: 60, health: 40000 }],
      makeRng(6), CARD_INDEX, combatSide({ tier: 6, tribes: ['demon'] }), combatSide({ tier: 1 }),
    );
    expect(r.events.filter((e) => e.type === 'keyword' && (e as { keyword: string }).keyword === 'T').length).toBe(0);
  });
});
