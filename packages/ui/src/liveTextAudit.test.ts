// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CARD_INDEX, poolFor, type SetId } from '@game/content';
import { createRun, type BoardCard, type RunState, type ShopCard } from '@game/sim';
import * as cardText from './cardText';
import { conjuredView, discoverCardText, handCardView, handLiveOf, liveOptsFromRun, shopOfferOpts, shopView, tokenRefView } from './Recruit';

/**
 * THE LIVE-TEXT RULE, ENFORCED (CLAUDE.md): a card whose magnitude depends on live run/combat state must print
 * the number it will actually produce right now — never the base rate alone.
 *
 * Groveweaver broke it (owner report 2026-07-25): its summon grant grows with every spell cast, but the printed
 * "+2/+4" never moved. The owner asked for an audit of the rest of Set 2, and an audit that lives only in a
 * chat message rots — so it lives here, as a test that fails when a NEW scaling card ships without a helper.
 *
 * How it works: any effect that reads a per-instance accrual field is a card whose printed magnitude can drift.
 * Each one must either be covered by a cardText helper or be listed below with the reason it doesn't need one.
 */

/** Factory ids that SIZE their grant from a per-instance accrual (`summonBonus` and friends). */
const SCALING_FACTORIES = new Set([
  'summonBuffTribeAsym',      // Groveweaver — grows per spell cast
  'scBeastAura',              // Kennelmaster — grows per Avenge
  'buffOnSummon',
  'rallyTribeAuraGrowing',    // Trophy Stalker
  'summonBuffTribeImprove',   // Mama Bear
  'onSummonTribeBuffThenDouble', // Denkeeper Oona — flat half grows per Avenge
]);

/**
 * Cards exempt from needing a text helper, each with the reason. An exemption is a claim that the printed text
 * is ALREADY honest — not a licence to skip the rule.
 */
const EXEMPT: Record<string, string> = {
  // Oona's own text names the doubling, and the flat half is shown by the Avenge counter on the card plate.
  b2_oona: 'the printed +1/+1 is the base of an Avenge-improved grant, surfaced by the Avenge meter',
};

/** Which helper covers which factory. */
const COVERED_BY: Record<string, (id: string) => string | null> = {
  summonBuffTribeAsym: (id) => cardText.asymSummonBuffText(id, 3),
  scBeastAura: (id) => cardText.summonBuffText(id, 3),
  buffOnSummon: (id) => cardText.summonBuffText(id, 3),
  rallyTribeAuraGrowing: (id) => cardText.summonBuffText(id, 3),
  summonBuffTribeImprove: (id) => cardText.summonImproveText(id, 3, false),
  onSummonTribeBuffThenDouble: () => null, // exempt above
};

describe('live card text — every scaling card prints its CURRENT value', () => {
  const scaling = Object.values(CARD_INDEX).filter((c) =>
    (c.effects ?? []).some((e) => SCALING_FACTORIES.has(e.do)),
  );

  it('the sweep actually finds cards (guards against a vacuous audit)', () => {
    expect(scaling.length).toBeGreaterThan(3);
  });

  it.each(
    Object.values(CARD_INDEX)
      .filter((c) => (c.effects ?? []).some((e) => SCALING_FACTORIES.has(e.do)))
      .map((c) => [c.name, c.id] as const),
  )('%s prints a live value once it has accrued', (_name, id) => {
    if (EXEMPT[id]) return;
    const def = CARD_INDEX[id]!;
    const eff = def.effects.find((e) => SCALING_FACTORIES.has(e.do))!;
    const live = COVERED_BY[eff.do]?.(id) ?? null;
    expect(live, `${def.name} (${eff.do}) has no cardText helper — its printed magnitude will go stale`).not.toBeNull();
    // A helper that returns the text unchanged is worse than none: it looks covered and isn't.
    expect(live, `${def.name}: the helper returned the printed text without injecting a live value`).toContain('{{');
  });

  it('Groveweaver specifically — the card that prompted the audit', () => {
    // The MECHANIC was fine all along: one spell raises the accrual and the next Beast really does land
    // bigger. What was broken was the printed rate, which never moved — so the card looked like it wasn't
    // improving. Numbers per the owner's 2026-08-04 balance: base +3/+3, +2/+2 per spell.
    const base = CARD_INDEX['b2_groveweaver']!.text;
    expect(base, 'the printed base rate').toContain('+3/+3');
    expect(cardText.asymSummonBuffText('b2_groveweaver', 0), 'no accrual → printed text is correct').toBeNull();
    expect(cardText.asymSummonBuffText('b2_groveweaver', 2), 'after one spell').toContain('{{+5/+5}}');
    expect(cardText.asymSummonBuffText('b2_groveweaver', 4), 'after two').toContain('{{+7/+7}}');
    expect(cardText.asymSummonBuffText('b2_groveweaver', 2, true), 'golden doubles the live value').toContain('{{+10/+10}}');
  });
});

/**
 * R-TEXT-SURFACES-01 — ONE CARD, ONE NUMBER, ON EVERY SURFACE (owner 2026-10-14):
 *
 *   *"also lantern light doesnt show updated spell power related affects if it's in shop, only in hand. make sure we
 *   fix all of this"*
 *
 * Every surface a card can be read on is built here exactly as the screen builds it (the exported builders the
 * component itself calls), under run states that move every live input at once (spell power, tier, Ruby / Clue /
 * Star Crash / Growth bonuses, Gold spent, spells cast, cards played, rune rule notes, a banked next-spell bonus), and
 * must print the SAME text as the reference chain:
 *
 *   - spells: the HAND copy (`handCardView`) is the reference; the Shop row offer, the Shop SPELL SLOT, Discover, the
 *     hover popup of a card that references it, and the combat cast preview / hand fly-in must match it;
 *   - minions: the Discover option is the reference (an unowned offer, no per-instance accruals); the Shop row offer and
 *     a minion conjured into hand must match it.
 *
 * Root cause found (2026-10-14): the spell slot built its own opts literal and dropped `tier` (Lantern Light printed
 * "+1/+1 for each Tavern Tier" in the slot), and the Shop spell branch built its own `spellDisplayText` extras, the
 * hover popup its own `spellLive` subset: each starved a different live value. All of them now go through
 * `liveOptsFromRun` + `liveCardText`.
 */
const SETS_SWEPT: SetId[] = ['set1', 'set2', 'set3', 'set4'];

/** Run states that move every run-wide live input the text chain reads. */
function liveRuns(set: SetId): RunState[] {
  const base = createRun(7, undefined, 'practice', undefined, set);
  const played = poolFor(set).buyable.slice(0, 4).map((c) => c.id);
  return [
    { ...base, tier: 4, spellBonus: { attack: 2, health: 3 } } as RunState,
    {
      ...base, tier: 5, spellBonus: { attack: 1, health: 1 }, nextSpellBonus: { attack: 2, health: 2 },
      rubyBonus: { attack: 2, health: 1 }, clueBonus: 2, starCrashBonus: { attack: 1, health: 2 }, growthBonus: 2,
      goldSpentThisTurn: 7, goldSpent: 40, goldPouchValue: 2, spellsThisTurn: 2, spellsCast: 9, rubyCasts: 4,
      playedThisTurn: played, runeGambleBoth: true, runeMatriarch: true, runeVaultkeeper: true,
    } as RunState,
  ];
}

const handInst = (cardId: string): BoardCard =>
  ({ uid: `h-${cardId}`, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, keywords: [...CARD_INDEX[cardId]!.keywords], golden: false } as BoardCard);
const offerOf = (cardId: string): ShopCard => ({ uid: `o-${cardId}`, cardId, atk: 0, hp: 0 } as ShopCard);
const sellState = (run: RunState) => ({ runeBartering: run.runeBartering, runeStacks: run.runeStacks, ancientsEnabled: run.ancientsEnabled, heroId: run.heroId });

describe('R-TEXT-SURFACES-01: a card prints the same live text on every surface', () => {
  it('Lantern Light in the Shop spell slot prints its live total, as in hand (the owner report)', () => {
    const run = { ...createRun(7, undefined, 'practice', undefined, 'set1'), tier: 4, spellBonus: { attack: 2, health: 3 } } as RunState;
    const slot = shopView(offerOf('lanternlight'), shopOfferOpts(run, offerOf('lanternlight'), { cardBuffsLive: run.cardBuffs ?? {} })).text;
    expect(slot).toContain('{{+6/+7}}');
    expect(slot).not.toContain('for each');
    expect(handCardView(run, handInst('lanternlight'), handLiveOf(run, run.cardBuffs ?? {}, sellState(run))).text).toBe(slot);
  });

  it('the Shop row, the spell slot, Discover and the hand are built by the shared builders', () => {
    const src = fs.readFileSync(path.join(__dirname, 'Recruit.tsx'), 'utf8');
    expect(src).toContain('shopView(run.spell, shopOfferOpts(run, run.spell, { cardBuffsLive, eotShopStats }))');
    expect(src).toContain('shopOfferOpts(run, o, { cardBuffsLive, eotShopStats }, base)');
    expect(src).toContain('const lt = discoverCardText(run, c.id, cardBuffsLive);');
    expect(src).toContain('handCardView(run, m, live, handStatOverride(m))');
  });

  for (const set of SETS_SWEPT) {
    it(`${set}: every spell prints the hand's live text in the Shop row, spell slot, Discover, hover popup and cast preview`, () => {
      const fails: string[] = [];
      let live = 0;
      for (const run of liveRuns(set)) {
        const cb = run.cardBuffs ?? {};
        const hl = handLiveOf(run, cb, sellState(run));
        const refLive = { ...liveOptsFromRun(run), cardBuffs: cb };
        const spellLive = { a: 0, h: 0, ftb: 0, ftbH: 0, goldSpent: 0 };
        for (const def of poolFor(set).all.filter((c) => c.spell && !c.ruby)) {
          const hand = handCardView(run, handInst(def.id), hl).text;
          if (hand !== def.text) live++;
          const surfaces: Record<string, string> = {
            'shop row / spell slot': shopView(offerOf(def.id), shopOfferOpts(run, offerOf(def.id), { cardBuffsLive: cb })).text,
            discover: discoverCardText(run, def.id, cb).text,
            'hover popup': tokenRefView(def.id, cb, run.impBuff, spellLive, run.rubyBonus, undefined, run.clueBonus, run.starCrashBonus, refLive).text,
            'cast preview / fly-in': conjuredView(def.id, run)!.text,
          };
          for (const [where, text] of Object.entries(surfaces)) {
            if (text !== hand) fails.push(`${def.name} [${where}] tier ${run.tier}: "${text}" but in hand "${hand}"`);
          }
        }
      }
      expect(live, 'the run states actually move spell text').toBeGreaterThan(3);
      expect(fails.slice(0, 20)).toEqual([]);
    });

    it(`${set}: every minion offer prints Discover's live text in the Shop row and when conjured into hand`, () => {
      const fails: string[] = [];
      for (const run of liveRuns(set)) {
        const cb = run.cardBuffs ?? {};
        for (const def of poolFor(set).all.filter((c) => !c.spell && !c.ruby)) {
          const ref = discoverCardText(run, def.id, cb).text;
          const surfaces: Record<string, string> = {
            'shop row': shopView(offerOf(def.id), shopOfferOpts(run, offerOf(def.id), { cardBuffsLive: cb })).text,
            'conjured into hand': conjuredView(def.id, run)!.text,
          };
          for (const [where, text] of Object.entries(surfaces)) {
            if (text !== ref) fails.push(`${def.name} [${where}] tier ${run.tier}: "${text}" but on Discover "${ref}"`);
          }
        }
      }
      expect(fails.slice(0, 20)).toEqual([]);
    });
  }
});
