import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult, type CombatSideState } from '../index';

/**
 * The 2026-08-07 batch: the combat spell resolver grows past the stat family, and four cards ride it —
 * Mage-Pup's Shout re-trigger, Sporebat's stored-spell Echo, Badgington's random targeted cast, and Quil's
 * newly-unlocked Discover/refresh/economy casts. Plus Candle Conduit's combat-side bounce.
 */
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 40000 }];

function fight(player: BoardMinion[], sideExtra: Partial<CombatSideState> = {}, seed = 5): CombatResult {
  return simulate(player, wall, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'kobold'], ...sideExtra }), combatSide({ tier: 1 }));
}
const scNotes = (r: CombatResult): string[] =>
  r.events.flatMap((e: CombatEvent) => (e.type === 'sc' ? [e.text] : []));

describe('the resolver beyond the stat family (owner ruling: only pure tavern work fizzles)', () => {
  // Quil is the driver: its Start of Combat casts the left-most held spell, whatever family it is.
  const quil = (spell: string): CombatResult => fight(
    [{ cardId: 'stray', attack: 1, health: 400 }, { cardId: 'b2_quil', attack: 7, health: 400 },
     { cardId: 'stray', attack: 1, health: 400 }],
    { handSpellIds: [spell] });

  it('a DISCOVER spell carries the cast back for settle to queue (no modal mid-fight)', () => {
    // Beyond the Summit / any discoverOnPlay spell. Find one from the index so the test tracks content.
    const disc = Object.values(CARD_INDEX).find((c) => c.spell && c.discoverOnPlay && !c.token);
    expect(disc, 'no discover spell in the index').toBeDefined();
    const r = quil(disc!.id);
    expect(r.playerDiscoverCasts).toEqual([disc!.id]);
  });

  it('a REFRESH spell banks a free roll instead of vanishing', () => {
    expect(quil('spellcart').playerFreeRolls ?? 0).toBeGreaterThan(0);
  });

  it('a GOLD spell pays out through the bonus-Gold channel', () => {
    expect(quil('emberpouch').playerBonusGold ?? 0).toBeGreaterThan(0);
  });

  it('a SPELL-POWER spell raises the power mid-fight', () => {
    const sp = Object.values(CARD_INDEX).find((c) => c.spell && !c.token && c.effects.some((e) => e.do === 'spellGainSpellPower'));
    expect(sp, 'no spell-power spell in the index').toBeDefined();
    const r = quil(sp!.id);
    expect((r.playerSpellPower?.attack ?? 0) + (r.playerSpellPower?.health ?? 0)).toBeGreaterThan(0);
  });

  it('pure tavern work still fizzles — Displacement does nothing', () => {
    const r = quil('displacement');
    expect(r.playerSpellsCast ?? 0).toBe(0); // never counted as a cast, because nothing resolved
  });
});

describe('Mage-Pup — a combat Shout re-trigger casts the taught spell (the owner-reported gap)', () => {
  it('Dawnclaw-style replay: Ryme dies, the Pup Shout fires, the taught Growth resolves', () => {
    const r = fight([
      { cardId: 'ryme', attack: 5, health: 1 },                                   // dies → replays neighbour Shouts
      { cardId: 'b2_magepup', attack: 2, health: 200, taughtSpellId: 'growth' },  // knows Growth
      { cardId: 'stray', attack: 1, health: 200 },
    ]);
    expect(scNotes(r).some((t) => /casts Growth/.test(t)), 'the taught spell never cast').toBe(true);
    expect(r.playerSpellsCast ?? 0).toBeGreaterThan(0); // a genuine cast — watchers and the tally see it
  });

  it('a taught TARGETED spell picks a random friendly, exactly like the recruit repeater path', () => {
    const r = fight([
      { cardId: 'ryme', attack: 5, health: 1 },
      { cardId: 'b2_magepup', attack: 2, health: 200, taughtSpellId: 'fronttoback' },
      { cardId: 'stray', attack: 1, health: 200 },
    ]);
    expect(scNotes(r).some((t) => /casts Front to Back/.test(t))).toBe(true);
    // …and the escalating spell's improvement carries back, per the Front-to-Back ruling.
    expect(r.playerSpellEscalationGain).toEqual({ attack: 2, health: 2 });
  });

  it('an untaught Pup is a clean no-op', () => {
    const r = fight([
      { cardId: 'ryme', attack: 5, health: 1 },
      { cardId: 'b2_magepup', attack: 2, health: 200 },
    ]);
    expect(r.playerSpellsCast ?? 0).toBe(0);
  });
});

describe('Sporebat — Echo casts the STORED spell on a random friendly Beast', () => {
  it('a targeted stored spell aims at a Beast; with no Beast alive it fizzles', () => {
    const stored = { lastSpellCastId: 'spiritfire' };
    const withBeast = fight([
      { cardId: 'sporebat', attack: 2, health: 1 },
      { cardId: 'pack', attack: 3, health: 400 }, // a Beast to aim at
    ], stored);
    expect(withBeast.playerSpellsCast ?? 0).toBe(1);
    const noBeast = fight([
      { cardId: 'sporebat', attack: 2, health: 1 },
      { cardId: 'k_crownvein', attack: 3, health: 400 }, // a Kobold — not a legal aim
    ], stored);
    expect(noBeast.playerSpellsCast ?? 0).toBe(0);
  });
});

describe('Badgington — Rally casts a random targeted spell on another Beast, and copies it', () => {
  it('casts, and the copy of THAT spell carries back to hand', () => {
    const r = fight([
      { cardId: 'badgington', attack: 30, health: 400 },
      { cardId: 'pack', attack: 1, health: 400 },
    ]);
    const grants = r.playerHandGrants ?? [];
    expect(grants.length, 'no copy was granted').toBeGreaterThan(0);
    expect(grants.every((id) => CARD_INDEX[id]?.spell && !!CARD_INDEX[id]?.target), 'a copy of a non-targeted spell').toBe(true);
  });

  it('alone on the board (no other Beast) it does nothing', () => {
    const r = fight([{ cardId: 'badgington', attack: 30, health: 400 }]);
    expect((r.playerHandGrants ?? []).length).toBe(0);
  });
});

describe('Candle Conduit — the combat-side bounce', () => {
  it('a combat Ruby play lands on its target AND one more minion', () => {
    // playRubyOn is exercised through Rune of Gemstorm (Avenge 2) — so the fixture needs two friendly deaths
    // to pace it: two 1-hp strays die to the wall, the Avenge fires once, and every living Kobold plays its
    // Rubies. Both boards carry TWO tanky Kobolds so the bounce always has a living recipient; the control
    // swaps the Conduit for a second Crownvein. Count the Ruby-tagged buff events.
    const enemy: BoardMinion[] = [{ cardId: 'omen', attack: 60, health: 40000 }];
    const board = (first: string): BoardMinion[] => [
      { cardId: first, attack: 5, health: 4000 },
      { cardId: 'k_crownvein', attack: 4, health: 4000 },
      { cardId: 'stray', attack: 1, health: 1 },
      { cardId: 'stray', attack: 1, health: 1 },
    ];
    const gm = { questMods: { runeGemstorm: 1 } as CombatSideState['questMods'] };
    const withConduit = simulate(board('k_candleconduit'), enemy, makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['kobold'], ...gm }), combatSide({ tier: 1 }));
    const without = simulate(board('k_crownvein'), enemy, makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['kobold'], ...gm }), combatSide({ tier: 1 }));
    const rubyLandings = (r: CombatResult): number =>
      r.events.filter((e: CombatEvent) => e.type === 'buff' && (e as { ruby?: true }).ruby).length;
    expect(rubyLandings(without), 'the Gemstorm fixture plays no Rubies — vacuous').toBeGreaterThan(0);
    expect(rubyLandings(withConduit)).toBe(rubyLandings(without) * 2); // every landing gains one bounce
  });
});
