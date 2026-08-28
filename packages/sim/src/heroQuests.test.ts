/**
 * HERO QUESTS — Fi & Coran's powers (owner spec 2026-08-21), ARCHIVED 2026-08-28.
 *
 * The owner retired the quest system: *"we have more or less retired quests for now… coran and fi should be
 * archived for now."* So this suite now has two jobs, and separating them is the whole point of the file:
 *
 *  1. **Prove the archive.** `questOfferPlan` is the single producer of a quest offer, and it returns null
 *     unconditionally. No hero, no mode, no seed and no wave can mint one, so `questOffer` is never set, the
 *     overlay never opens, `buyQuest` never has an index to take and `activeQuests` stays empty.
 *
 *  2. **Keep the rules that survive un-archiving under test.** Everything below the offer PLAN is untouched
 *     code: `generateQuestOffer`'s draw rules, the `journey` counter, and the seven reward payouts. Those are
 *     still exercised directly here — through `generateQuestOffer` (callable, just never reached in play) and
 *     through a seeded `activeQuests`, the same way `run.test.ts` has always driven quest rewards. Deleting
 *     them would have thrown away 14 hero quests' worth of live reward-engine coverage that the RUNES still
 *     depend on, since every rune pays out through `applyQuestReward` too.
 *
 * The rules pinned here are the ones a refactor could silently drop:
 *   · the offer is 2 options, hero-scoped, and never contains two variants of one family (Opening Act /
 *     Resonant Path are each three quests that read as one);
 *   · hero quests never leak into the universal turn-5/11 offers, and vice versa;
 *   · a spell play takes exactly ONE step (it reaches the reducer as `play` too — double counting is the trap);
 *   · each reward actually lands: the rune grant, the free first buy, Gild-at-2, Tier-7 (Discover AND ladder),
 *     the free Shop-tier step, and the Merchant's Road price.
 */
import { describe, expect, it } from 'vitest';
import { QUEST_DEFS, QUEST_INDEX } from '@game/content';
import { gildCopiesNeeded } from './heroes';
import { createRun, type RunState } from './state';
import { reduce } from './reducer';
import { generateQuestOffer, questOfferPlan } from './quests';

const heroIds = (hero: string): Set<string> =>
  new Set(QUEST_DEFS.filter((q) => q.heroQuest === hero).map((q) => q.id));

/** A run holding `questId` live at zero progress. Since the archive there is no offer to take, so the quest is
 *  seeded directly — exactly how `run.test.ts` has always driven objective/reward assertions. */
const holding = (hero: string, questId: string, seed = 1): RunState =>
  ({ ...createRun(seed, hero), activeQuests: [{ questId, progress: 0, completed: false }] });

/** The run's single active hero quest. */
const active = (s: RunState) => s.activeQuests![0]!;

/** Force-complete a hero quest: pre-load progress to one step short of `questId`, then play a minion. */
function completeVia(s: RunState, questId: string): RunState {
  const def = QUEST_INDEX[questId]!;
  const primed: RunState = {
    ...s,
    activeQuests: [{ questId, progress: def.objective.count - 1, completed: false }],
    embers: 20,
    board: [],
    hand: [{ uid: 'h1', cardId: 'b2_packstrider', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
  };
  return reduce(primed, { type: 'play', uid: 'h1', toIndex: 0 });
}

describe('the archive holds — no quest offer is reachable', () => {
  it('Fi and Coran open on NO offer, across many seeds and both modes', () => {
    for (const hero of ['fi', 'coran']) {
      for (const mode of [undefined, 'practice'] as const) {
        for (let seed = 1; seed <= 30; seed++) {
          const s = createRun(seed, hero, mode);
          expect(s.questOffer, `${hero} seed ${seed} (${mode ?? 'ascent'}) minted an offer`).toBeUndefined();
          expect(s.activeQuests ?? [], `${hero} seed ${seed} opened holding a quest`).toEqual([]);
        }
      }
    }
  });

  it('`questOfferPlan` returns null for EVERY hero on EVERY wave — the single producer, gated', () => {
    // The universal turns (5, 11), the retired quest-native turns (4, 10) and the hero-quest turn (1) all
    // resolve through this one function; sweeping the whole wave range proves none of them survives.
    for (const hero of ['fi', 'coran', 'warden', 'runesmith', 'chronoshero']) {
      for (let wave = 1; wave <= 12; wave++) {
        const s: RunState = { ...createRun(1, hero), wave };
        expect(questOfferPlan(s), `${hero} wave ${wave} produced a plan`).toBeNull();
      }
    }
  });

  it('a full run advances through waves 5 and 11 without ever opening a quest', () => {
    let s: RunState = createRun(9, 'warden');
    for (let i = 0; i < 12; i++) {
      s = reduce({ ...s, phase: 'combat', combatSettled: false, lastCombat: { result: 'win', events: [], playerDamage: 0, initial: { player: [], enemy: [] } } as never }, { type: 'resolveCombat' });
      expect(s.questOffer, `wave ${s.wave} opened a quest`).toBeUndefined();
      expect(s.activeQuests ?? []).toEqual([]);
    }
  });
});

describe('the offer GENERATOR keeps its rules (unreached in play; restored intact on un-archive)', () => {
  it('draws two options from that hero\'s own list, across many seeds', () => {
    for (const hero of ['fi', 'coran']) {
      const ids = heroIds(hero);
      for (let seed = 1; seed <= 30; seed++) {
        const offer = generateQuestOffer({ ...createRun(1, hero), seed, wave: 1 }, { heroQuest: hero });
        expect(offer).toHaveLength(2);
        for (const id of offer) expect(ids.has(id), `${hero} seed ${seed} offered ${id}`).toBe(true);
        expect(offer[0]).not.toBe(offer[1]);
      }
    }
  });

  it('never offers two variants of one family (Opening Act / Resonant Path)', () => {
    for (const hero of ['fi', 'coran']) {
      for (let seed = 1; seed <= 200; seed++) {
        const offer = generateQuestOffer({ ...createRun(1, hero), seed, wave: 1 }, { heroQuest: hero });
        const groups = offer.map((id) => QUEST_INDEX[id]!.variantGroup).filter(Boolean);
        expect(new Set(groups).size, `seed ${seed}: ${offer.join(', ')}`).toBe(groups.length);
      }
    }
  });

  it('every family variant is REACHABLE (the exclusion rule must not bias one out entirely)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      for (const id of generateQuestOffer({ ...createRun(1, 'fi'), seed, wave: 1 }, { heroQuest: 'fi' })) seen.add(id);
    }
    for (const v of ['hq_opening_act_shout', 'hq_opening_act_echo', 'hq_opening_act_rally']) {
      expect(seen.has(v), `${v} never offered in 400 seeds`).toBe(true);
    }
  });

  it('hero quests never appear in the universal turn-5/11 offers', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const wave of [5, 11] as const) {
        const s = { ...createRun(seed, 'warden'), wave };
        for (const id of generateQuestOffer(s, { bucket: wave })) {
          expect(QUEST_INDEX[id]!.heroQuest, `wave ${wave} seed ${seed} leaked ${id}`).toBeUndefined();
        }
      }
    }
  });
});

describe('the journey counter (drives every hero quest; still live for a legacy save)', () => {
  it('a MINION play, a SPELL cast and a SHOP upgrade each take one step', () => {
    let s: RunState = {
      ...holding('fi', 'hq_spare_forge'),
      embers: 20,
      tier: 1,
      board: [],
      hand: [
        { uid: 'm1', cardId: 'b2_packstrider', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'sp1', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ],
    };
    const p0 = active(s).progress;
    s = reduce(s, { type: 'play', uid: 'm1', toIndex: 0 });
    expect(active(s).progress).toBe(p0 + 1); // minion played
    s = reduce(s, { type: 'play', uid: 'sp1' });
    expect(active(s).progress).toBe(p0 + 2); // spell cast — exactly ONE step, not play+cast
    s = reduce(s, { type: 'upgrade' });
    expect(active(s).progress).toBe(p0 + 3); // shop upgraded
  });

  it('buying, selling and rolling are NOT steps', () => {
    let s: RunState = { ...holding('coran', 'hq_runic_passage'), embers: 20 };
    const p0 = active(s).progress;
    const offer = s.shop[0];
    if (offer) s = reduce(s, { type: 'buy', uid: offer.uid });
    s = reduce(s, { type: 'roll' });
    expect(active(s).progress).toBe(p0);
  });
});

describe('rewards (the reward engine stays live — the RUNES ride it)', () => {
  it('Spare Forge: completing hands over a random Basic Rune immediately', () => {
    const s = completeVia(createRun(1, 'fi'), 'hq_spare_forge');
    expect(active(s).completed).toBe(true);
    expect(s.ownedRunes?.length).toBe(1);
    expect(s.runeforgeOffer).toBeUndefined(); // handed over, not a forge visit
  });

  it('Runic Passage: an EPIC rune', () => {
    const s = completeVia(createRun(1, 'coran'), 'hq_runic_passage');
    expect(s.ownedRunes?.length).toBe(1);
  });

  it('First Pick: the first shop minion each turn is free, once per turn, sharing the Freedom marker', () => {
    let s = completeVia(createRun(1, 'fi'), 'hq_first_pick');
    expect(s.questFreeFirstBuy).toBe(true);
    s = { ...s, embers: 6, board: [], hand: [] };
    const minions = s.shop.filter((o) => !CARD_SPELL(o.cardId));
    expect(minions.length).toBeGreaterThan(1);
    const before = s.embers;
    s = reduce(s, { type: 'buy', uid: minions[0]!.uid });
    expect(s.embers).toBe(before); // free
    expect(s.freeBuyUsedThisTurn).toBe(true);
    const b2 = s.embers;
    s = reduce(s, { type: 'buy', uid: minions[1]!.uid });
    expect(s.embers).toBeLessThan(b2); // the second buy pays
  });

  it('Gilded Shortcut: Gild needs only 2 copies', () => {
    const s = completeVia(createRun(1, 'coran'), 'hq_gilded_shortcut');
    expect(s.gildCopies).toBe(2);
    expect(gildCopiesNeeded(s)).toBe(2);
  });

  it('Open Road: Tier 7 opens for the shop ladder, not just Discovers', () => {
    let s = completeVia(createRun(1, 'fi'), 'hq_open_road');
    expect(s.tier7Access).toBe(true);
    // The ladder itself: pay up from 6 → 7, which `maxTierFor` alone would refuse.
    s = { ...s, tier: 6, embers: 50, upgradeCost: 12 };
    s = reduce(s, { type: 'upgrade' });
    expect(s.tier).toBe(7);
  });

  it('Summit Passage: unlocks Tier 7 AND takes one free Shop step', () => {
    const s = completeVia({ ...createRun(1, 'coran'), tier: 3 }, 'hq_summit_passage');
    expect(s.tier7Access).toBe(true);
    expect(s.tier).toBe(4); // the free step
    expect(s.embers).toBe(20); // free — completeVia granted 20 and the play costs nothing
  });

  it("Merchant's Road: shop minions cost 2 Gold", () => {
    const s = completeVia(createRun(1, 'coran'), 'hq_merchants_road');
    expect(s.minionCostOverride).toBe(2);
  });
});

/** Is this shop offer a spell? (First Pick only frees MINIONS.) */
import { CARD_INDEX } from '@game/content';
function CARD_SPELL(cardId: string): boolean {
  const d = CARD_INDEX[cardId];
  return !!(d?.spell || d?.ruby);
}
