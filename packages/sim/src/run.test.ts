import { describe, it, expect } from 'vitest';
import { makeRng, type CombatResult, type Keyword } from '@game/core';
import { BUYABLE_CARDS, CARD_INDEX, QUEST_INDEX, SPELL_CARDS } from '@game/content';
import {
  CONFIG,
  POOL_QUANTITIES,
  createRun,
  reduce,
  serialize,
  deserialize,
  selectThreat,
  buildEnemyBoard,
  pickOpponent,
  isServableBoard,
  registerOpponents,
  buildBootstrapPool,
  generateQuestOffer,
  questTierForWave,
  lossDamageCap,
  runRecord,
  isCalibrationRound,
  lineResult,
  OPPONENT_POOL,
  type BoardSnapshot,
  boardManaBonus,
  THREAT_IDS,
  addBuff,
  cardBuff,
  endOfTurnRepeats,
  offerBuyStats,
  undeadBuyBonus,
  getHero,
  spellStatBonus,
  spellAttackBonus,
  spellHealthBonus,
  spellDisplayText,
  rateBoardForWave,
  buildWaveLadders,
  ratingBand,
  BAND_COUNT,
  sellValueOf,
  type BoardCard,
  type RunState,
} from './index';
import type { BoardMinion } from '@game/core';
import { applyEndOfTurn, applyGoldSpent, spellCasts, spellCostReduction } from './recruit';
import { rollShop } from './shop';

/** Play greedily until the run ends (game over OR victory at maxWave): buy, play, else face omen. */
function playToEnd(seed: number): RunState {
  let s = createRun(seed);
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 10000) {
    if (s.questOffer) {
      s = reduce(s, { type: 'buyQuest', index: 0 }); // quest shop (waves 4/8/12): buy a quest to open the turn
    } else if (s.chooseOne) {
      s = reduce(s, { type: 'chooseOne', index: 0 }); // resolve a pending Choose One (Runic Beetle / Wildwood Shaper)
    } else if (s.pendingTarget) {
      s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); // pick a target (Runic Beetle / Toxin Tender)
    } else if (s.discover) {
      s = reduce(s, { type: 'discover', index: 0 }); // resolve a pending Discover (triple reward / Discover spell)
    } else if (s.phase === 'combat') {
      s = reduce(s, { type: 'resolveCombat' });
    } else if (s.hand.length > 0 && s.board.length < 7) {
      s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    } else if (s.embers >= 3 && s.board.length + s.hand.length < 7) {
      s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    } else {
      s = reduce(s, { type: 'faceOmen' });
    }
  }
  return s;
}

describe('run loop (@game/sim)', () => {
  it('createRun is deterministic', () => {
    expect(serialize(createRun(42))).toEqual(serialize(createRun(42)));
  });

  it('opens with the handoff economy defaults', () => {
    const s = createRun(1);
    expect(s.embers).toBe(3);
    expect(s.resolve).toBe(30);
    expect(s.tier).toBe(1);
    expect(s.upgradeCost).toBe(5);
    expect(s.shop.length).toBe(3); // tier 1 → 3 slots
    expect(s.hand.length).toBe(0);
    expect(s.board.length).toBe(0);
  });

  it('buy moves a card to the hand for 3 embers (without mutating input)', () => {
    const s0 = createRun(1);
    const s1 = reduce(s0, { type: 'buy', uid: s0.shop[0]!.uid });
    expect(s1.embers).toBe(0);
    expect(s1.hand.length).toBe(1);
    expect(s1.board.length).toBe(0);
    expect(s1.shop.length).toBe(2);
    expect(s0.hand.length).toBe(0); // pure: original untouched
  });

  it('play moves a card from the hand onto the board', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.hand.length).toBe(0);
    expect(s.board.length).toBe(1);
  });

  it('reposition moves a board minion to a new index', () => {
    const mk = (uid: string, cardId: string): BoardCard => ({
      uid, cardId, tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false,
    });
    let s: RunState = { ...createRun(1), board: [mk('a', 'sandbag'), mk('b', 'alley'), mk('c', 'frontdrake')] };
    s = reduce(s, { type: 'reposition', uid: 'c', toIndex: 0 });
    expect(s.board.map((m) => m.uid)).toEqual(['c', 'a', 'b']);
  });

  it('reorderHand rearranges the hand (cosmetic — count preserved)', () => {
    const mk = (uid: string, cardId: string): BoardCard => ({
      uid, cardId, tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false,
    });
    let s: RunState = { ...createRun(1), hand: [mk('a', 'sandbag'), mk('b', 'alley'), mk('c', 'frontdrake')] };
    s = reduce(s, { type: 'reorderHand', uid: 'a', toIndex: 2 });
    expect(s.hand.map((m) => m.uid)).toEqual(['b', 'c', 'a']);
    expect(s.hand).toHaveLength(3);
    s = reduce(s, { type: 'reorderHand', uid: 'missing', toIndex: 0 }); // no-op on an unknown uid
    expect(s.hand.map((m) => m.uid)).toEqual(['b', 'c', 'a']);
  });

  it('rejects a buy without enough embers', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid }); // embers → 0
    const next = reduce(s, { type: 'buy', uid: s.shop[0]?.uid ?? 'x' });
    expect(next).toBe(s); // no-op returns the same reference
  });

  it('sell returns 1 ember', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'sell', uid: s.board[0]!.uid });
    expect(s.board.length).toBe(0);
    expect(s.embers).toBe(1);
  });

  it('roll costs 1 ember and keeps 3 offers at tier 1', () => {
    const s = reduce(createRun(1), { type: 'roll' });
    expect(s.embers).toBe(2);
    expect(s.shop.length).toBe(3);
  });

  it('freeze preserves the shop into the next wave', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'freeze' });
    const frozen = s.shop.map((c) => c.cardId);
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    if (s.phase === 'recruit') {
      expect(s.shop.map((c) => c.cardId)).toEqual(frozen);
      expect(s.frozen).toBe(false);
    }
  });

  it('faceOmen enters combat; resolveCombat advances or ends the run', () => {
    let s = createRun(1);
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'faceOmen' });
    expect(s.phase).toBe('combat');
    expect(s.lastCombat).toBeDefined();
    // Recruit actions are inert mid-combat.
    expect(reduce(s, { type: 'roll' })).toBe(s);
    const wave = s.wave;
    s = reduce(s, { type: 'resolveCombat' });
    expect(['recruit', 'gameover']).toContain(s.phase);
    if (s.phase === 'recruit') expect(s.wave).toBe(wave + 1);
  });

  it("carries Guel's on-board spellProgress into the combat snapshot (so the live combat text scales, not stuck at base)", () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 0,
      board: [{ uid: 'gl', cardId: 'guel', tribe: 'neutral', attack: 4, health: 40, keywords: [], golden: true, spellProgress: 8 }],
      hand: [],
    };
    s = reduce(s, { type: 'faceOmen' });
    const guel = s.lastCombat?.initial.player.find((m) => m.cardId === 'guel');
    expect(guel?.spellProgress).toBe(8); // was undefined — combat card text read at base (+2/+2 golden, not +6/+6)
  });

  it("Lord of the Risen's Rise Again grants a one-combat Rise, no-ops on an existing Rise, and strips at settle", () => {
    let s: RunState = {
      ...createRun(1, 'risen'),
      board: [{ uid: 'm1', cardId: 'drone', tribe: 'mech', attack: 2, health: 30, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'm1' });
    expect(s.board[0]!.keywords).toContain('R'); // Rise granted (shows the pill + enters the combat snapshot)
    expect(s.board[0]!.tempReborn).toBe(true);
    expect(s.heroReady).toBe(false); // once per turn — charge spent
    // A minion that already has Rise is an invalid target — no-op, no charge spent.
    const again: RunState = { ...s, heroReady: true };
    expect(reduce(again, { type: 'heroPower', uid: 'm1' })).toBe(again);
    // Fight → settle: the temp Rise is stripped (one combat only), like Maw's temp Ward.
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    const m = s.board.find((c) => c.uid === 'm1');
    expect(m?.keywords ?? []).not.toContain('R');
    expect(m?.tempReborn).toBe(false);
  });

  it('Pre-emptive Assault: casting sets the one-fight initiative flag; settling the combat clears it', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm1', cardId: 'drone', tribe: 'mech', attack: 2, health: 30, keywords: [], golden: false }],
      hand: [{ uid: 'sp1', cardId: 'preemptive', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      embers: 10,
    };
    s = reduce(s, { type: 'play', uid: 'sp1' }); // playing a spell from hand casts it
    expect(s.attackFirstNext).toBe(true); // the flag arms for the next fight
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.attackFirstNext).toBe(false); // one fight only — cleared at settle
  });

  it('Nimbus: Battlecry makes the next Tavern spell cast twice, then the charge is spent', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm1', cardId: 'drone', tribe: 'mech', attack: 2, health: 3, keywords: [], golden: false }],
      hand: [
        { uid: 'n1', cardId: 'nimbus', tribe: 'neutral', attack: 5, health: 4, keywords: [], golden: false },
        { uid: 'g1', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ],
      embers: 10,
    };
    s = reduce(s, { type: 'play', uid: 'n1' }); // Nimbus battlecry arms the charge
    expect(s.nextSpellMult).toBe(2);
    s = reduce(s, { type: 'play', uid: 'g1' }); // cast Growth (+3/+4) — doubled to +6/+8
    const m = s.board.find((c) => c.uid === 'm1')!;
    expect([m.attack, m.health]).toEqual([2 + 6, 3 + 8]); // two casts of +3/+4
    expect(s.nextSpellMult).toBeUndefined(); // charge spent
  });

  it('Vineweaver Drake: End of Turn casts Growth an escalating number of times', () => {
    const s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'v', cardId: 'vineweaver', tribe: 'dragon', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 't', cardId: 'drone', tribe: 'mech', attack: 0, health: 50, keywords: [], golden: false },
      ],
    };
    applyEndOfTurn(s); // 1st End of Turn → cast Growth once (+3/+4 to all)
    let t = s.board.find((c) => c.uid === 't')!;
    expect([t.attack, t.health]).toEqual([3, 54]);
    applyEndOfTurn(s); // 2nd End of Turn → cast Growth twice more (+6/+8)
    t = s.board.find((c) => c.uid === 't')!;
    expect([t.attack, t.health]).toEqual([9, 62]); // 1 + 2 = 3 total casts of +3/+4
  });

  it('Wayfinder: Battlecry discovers from an active tribe you do not control', () => {
    let s: RunState = {
      ...createRun(1),
      tier: 6,
      tribes: ['beast', 'dragon'],
      board: [{ uid: 'b', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
      hand: [{ uid: 'w', cardId: 'wayfinder', tribe: 'neutral', attack: 4, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'w' });
    // beast is controlled (Pennycat on board); dragon is the only uncontrolled active tribe → all options are dragons
    expect(s.discover?.length ?? 0).toBeGreaterThan(0);
    for (const id of s.discover ?? []) {
      const def = CARD_INDEX[id]!;
      expect(def.tribe === 'dragon' || def.tribe2 === 'dragon').toBe(true);
    }
  });

  it('Patch Job: +3/+3 baseline, plus +3/+3 per 7 Gold spent this turn', () => {
    const mk = (goldSpentThisTurn: number): RunState => ({
      ...createRun(1), goldSpentThisTurn, embers: 10,
      board: [{ uid: 'm1', cardId: 'drone', tribe: 'mech', attack: 2, health: 3, keywords: [], golden: false }],
      hand: [{ uid: 'p1', cardId: 'patchjob', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    });
    // 0 Gold spent → the baseline +3/+3.
    let s = reduce(mk(0), { type: 'play', uid: 'p1', targetUid: 'm1' });
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([2 + 3, 3 + 3]);
    // 14 Gold spent → baseline + two 7-Gold steps = ×3 → +9/+9.
    s = reduce(mk(14), { type: 'play', uid: 'p1', targetUid: 'm1' });
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([2 + 9, 3 + 9]);
  });

  it('Patch Job display shows the CURRENT total based on Gold spent this turn', () => {
    expect(spellDisplayText('patchjob', 0, 0, 0, 0)).toBe(CARD_INDEX['patchjob']!.text); // no Gold → just the baseline text
    expect(spellDisplayText('patchjob', 0, 0, 0, 14)).toContain('{{Now +9/+9.}}'); // 14 Gold → baseline + 2 steps = +9/+9
    expect(spellDisplayText('patchjob', 2, 0, 2, 14)).toContain('{{Now +15/+15.}}'); // + spell power lifts each unit (+5 × 3)
  });

  it('Field Mechanic: Battlecry adds a Patch Job to hand', () => {
    let s: RunState = {
      ...createRun(1),
      board: [],
      hand: [{ uid: 'f1', cardId: 'fieldmechanic', tribe: 'mech', attack: 2, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'f1' });
    expect(s.hand.some((c) => c.cardId === 'patchjob')).toBe(true);
  });

  it('Abyssal Feeder: End of Turn — adjacent minions each consume a Fodder', () => {
    const s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'L', cardId: 'drone', tribe: 'mech', attack: 2, health: 5, keywords: [], golden: false },
        { uid: 'F', cardId: 'abyssalfeeder', tribe: 'demon', attack: 7, health: 6, keywords: [], golden: false },
        { uid: 'R', cardId: 'drone', tribe: 'mech', attack: 2, health: 5, keywords: [], golden: false },
      ],
    };
    applyEndOfTurn(s);
    expect(s.board.find((c) => c.uid === 'L')!.attack).toBeGreaterThan(2); // consumed a Fodder → gained its stats
    expect(s.board.find((c) => c.uid === 'R')!.attack).toBeGreaterThan(2);
    expect(s.board.find((c) => c.uid === 'F')!.attack).toBe(7); // the Feeder itself doesn't consume
  });

  it('Pack Leader: Start of Combat buffs Beasts +2/+2, improved +2/+2 per Beast played this turn', () => {
    let s: RunState = {
      ...createRun(1),
      playedThisTurn: ['alley', 'alley'], // 2 Beasts played this recruit turn (frozen into the fight)
      board: [
        { uid: 'pl', cardId: 'packleader', tribe: 'beast', attack: 2, health: 4, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'faceOmen' }); // grant = base 2 + 2 × 2 played = +6/+6
    expect(s.lastCombat!.events.some((e) => e.type === 'buff' && e.attack === 6 && e.health === 6)).toBe(true);
  });

  it('Pack Leader with no Beasts played this turn grants only the base +2/+2', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'pl', cardId: 'packleader', tribe: 'beast', attack: 2, health: 4, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.lastCombat!.events.some((e) => e.type === 'buff' && e.attack === 2 && e.health === 2)).toBe(true);
  });

  it('Graverobber: Battlecry destroys a targeted friendly, procs its Deathrattle + grants a spell of its tier', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 't', cardId: 'broodmother', tribe: 'dragon', attack: 2, health: 5, keywords: [], golden: false }], // T4, DR: summon 2 Whelps
      hand: [{ uid: 'g', cardId: 'graverobber', tribe: 'undead', attack: 4, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' }); // Graverobber to board + pendingTarget
    s = reduce(s, { type: 'battlecryTarget', targetUid: 't' }); // destroy the Whelpmother
    expect(s.board.find((c) => c.uid === 't')).toBeUndefined(); // destroyed
    expect(s.board.filter((c) => c.cardId === 'twilightwhelp').length).toBe(2); // its Deathrattle summoned 2 Whelps
    expect(s.hand.some((c) => CARD_INDEX[c.cardId]?.spell && CARD_INDEX[c.cardId]?.tier === 4)).toBe(true); // a tier-4 spell (Whelpmother is T4)
  });

  it('Graverobber on Mumi fires its Deathrattle out of combat — a friendly Undead gains Rise', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'm', cardId: 'mumi', tribe: 'undead', attack: 5, health: 1, keywords: [], golden: false }, // DR: give a friendly Undead Rise
        { uid: 'u', cardId: 'karthus', tribe: 'undead', attack: 8, health: 3, keywords: [], golden: false }, // the highest-Attack Undead carry
      ],
      hand: [{ uid: 'g', cardId: 'graverobber', tribe: 'undead', attack: 4, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' });
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'm' }); // destroy Mumi → its Deathrattle should fire
    expect(s.board.find((c) => c.uid === 'm')).toBeUndefined(); // Mumi destroyed
    expect(s.board.find((c) => c.uid === 'u')?.keywords).toContain('R'); // the highest-Attack friendly Undead got Rise
  });

  it('Graverobber on Grim fires its Deathrattle out of combat (buffs Beasts by the run tally)', () => {
    let s: RunState = {
      ...createRun(1), deathrattlesTriggered: 2, // 2 prior Echoes; Grim's own death makes the live tally 3
      board: [
        { uid: 'grim', cardId: 'grim', tribe: 'beast', attack: 7, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'g', cardId: 'graverobber', tribe: 'undead', attack: 4, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' });
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'grim' });
    expect(s.board.find((c) => c.uid === 'grim')).toBeUndefined(); // destroyed
    // Grim's Deathrattle: +N/+N per Deathrattle this game (tally = 3 incl. its own death) → the Beast gets +3/+3.
    expect(s.board.find((c) => c.uid === 'b')!.attack).toBe(1 + 3);
  });

  it('Sylus the Reaper doubles a Graverobber-fired Deathrattle in the shop', () => {
    // Grim's Deathrattle (buff Beasts by the run tally) fires once + once per Sylus. tally = 1 (Grim's own
    // death), so each fire is +1/+1 → the Beast gets +2/+2 with one Sylus.
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'sy', cardId: 'sylus', tribe: 'neutral', attack: 3, health: 3, keywords: [], golden: false },
        { uid: 'grim', cardId: 'grim', tribe: 'beast', attack: 7, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'g', cardId: 'graverobber', tribe: 'undead', attack: 4, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' });
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'grim' });
    expect(s.board.find((c) => c.uid === 'b')!.attack).toBe(1 + 2); // +1/+1 fired twice (once + one Sylus)
  });

  it('reward-exclusive spells (Feed the Alpha) never enter the shop spell pool', () => {
    expect(SPELL_CARDS.some((c) => c.id === 'feedalpha')).toBe(false);
    expect(BUYABLE_CARDS.some((c) => c.id === 'trailforager' || c.id === 'trophystalker')).toBe(false);
  });

  it('Squirl Scout: Battlecry spreads +N/+N to random friendlies, once per Beast owned, snowballing per Scout', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
      hand: [
        { uid: 'sq', cardId: 'squirlscout', tribe: 'beast', attack: 3, health: 3, keywords: [], golden: false },
        { uid: 'sq2', cardId: 'squirlscout', tribe: 'beast', attack: 3, health: 3, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'sq' });
    expect(s.squirlScoutBuff).toBe(3); // first Scout → grant size 3
    // 3 Beasts owned (2 Pennycats + the Scout) × +3/+3 = +9/+9 total, spread across the board.
    const baseAtk = 1 + 1 + 3; // the three Beasts' base Attack
    expect(s.board.reduce((n, c) => n + c.attack, 0)).toBe(baseAtk + 9);
    expect(s.board.reduce((n, c) => n + c.health, 0)).toBe(baseAtk + 9);
    // A second Scout raises the run-wide grant to 6.
    s = reduce(s, { type: 'play', uid: 'sq2' });
    expect(s.squirlScoutBuff).toBe(6);
  });

  it('buying an Undead/Beast bakes the run-wide Attack aura exactly once (no double-count)', () => {
    // Undead buy: undeadBuyAtk applied once (previously double-counted at buy).
    let u: RunState = { ...createRun(1), embers: 10, undeadBuyAtk: 3, shop: [{ uid: 'o', cardId: 'karthus' }] };
    u = reduce(u, { type: 'buy', uid: 'o' });
    expect(u.hand.find((c) => c.cardId === 'karthus')!.attack).toBe(CARD_INDEX.karthus!.attack + 3);
    // Beast buy: Squirl Scout's beastBuyAtk now bakes on a bought Beast too (previously missed).
    let b: RunState = { ...createRun(1), embers: 10, beastBuyAtk: 2, shop: [{ uid: 'o', cardId: 'alley' }] };
    b = reduce(b, { type: 'buy', uid: 'o' });
    expect(b.hand.find((c) => c.cardId === 'alley')!.attack).toBe(CARD_INDEX.alley!.attack + 2);
  });

  it('Scrap Herald: Battlecry gives Magnetics +2/+2 wherever (board + hand), stacking for future ones', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'c', cardId: 'cling', tribe: 'mech', attack: 1, health: 1, keywords: ['M'], golden: false }],
      hand: [
        { uid: 'sh', cardId: 'scrapherald', tribe: 'mech', attack: 2, health: 3, keywords: [], golden: false },
        { uid: 'h', cardId: 'cling', tribe: 'mech', attack: 1, health: 1, keywords: ['M'], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'sh' });
    const c = s.board.find((x) => x.uid === 'c')!;
    const h = s.hand.find((x) => x.uid === 'h')!;
    expect([c.attack, c.health]).toEqual([3, 3]); // current board Magnetic +2/+2
    expect([h.attack, h.health]).toEqual([3, 3]); // current hand Magnetic +2/+2
    expect([s.magneticBuyAtk, s.magneticBuyHp]).toEqual([2, 2]); // stacks — future Magnetics inherit it
  });

  it('Moe / guaranteed attachment: rollShop forces a Magnetic offer while the counter is active, then decrements', () => {
    const s: RunState = { ...createRun(1), tier: 6, guaranteedAttachmentShops: 2 };
    rollShop(s);
    expect(s.shop.some((o) => CARD_INDEX[o.cardId]?.keywords.includes('M'))).toBe(true); // guaranteed Magnetic
    expect(s.guaranteedAttachmentShops).toBe(1); // decremented
    rollShop(s);
    expect(s.shop.some((o) => CARD_INDEX[o.cardId]?.keywords.includes('M'))).toBe(true);
    expect(s.guaranteedAttachmentShops).toBe(0); // counter exhausted
    rollShop(s);
    expect(s.guaranteedAttachmentShops).toBe(0); // stays 0 — no more forced Magnetics
  });

  it('a shop offer with a set cost (Moe Attachment) buys at that discounted price', () => {
    let s: RunState = { ...createRun(1), embers: 5, shop: [{ uid: 'o', cardId: 'alley', cost: 2 }], hand: [] };
    s = reduce(s, { type: 'buy', uid: 'o' });
    expect(s.embers).toBe(3); // charged the offer's 2, not the flat minion cost
    expect(s.hand.some((c) => c.cardId === 'alley')).toBe(true);
  });

  it('Spark Plug: casting gives your entire board +5/+5 twice (+10/+10)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'drone', tribe: 'mech', attack: 2, health: 3, keywords: [], golden: false }],
      hand: [{ uid: 'sp', cardId: 'sparkplug', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      embers: 10,
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([2 + 10, 3 + 10]); // two +5/+5 casts
  });

  it('The Godfodder Choose One — option 0 buffs Fodder (no target), option 1 defers to a target', () => {
    // Option 0: buff Fodder run-wide, resolves immediately (per-option target absent → no prompt).
    let a: RunState = {
      ...createRun(1),
      hand: [{ uid: 'g', cardId: 'godfodder', tribe: 'demon', attack: 3, health: 2, keywords: [], golden: false }],
    };
    a = reduce(a, { type: 'play', uid: 'g' });
    expect(a.chooseOne).toBeDefined();
    a = reduce(a, { type: 'chooseOne', index: 0 });
    expect(a.pendingTarget).toBeUndefined(); // option 0 does NOT prompt for a target
    expect(a.cardBuffs?.fred?.attack).toBe(1); // the Fodder (Fred) card type enchanted +1/+1
    // Option 1: consume — defers to a friendly target (per-option target: 'friendly').
    let b: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'drone', tribe: 'mech', attack: 2, health: 3, keywords: [], golden: false }],
      hand: [{ uid: 'g', cardId: 'godfodder', tribe: 'demon', attack: 3, health: 2, keywords: [], golden: false }],
    };
    b = reduce(b, { type: 'play', uid: 'g' });
    b = reduce(b, { type: 'chooseOne', index: 1 });
    expect(b.pendingTarget).toBeDefined(); // option 1 prompts for a target
    b = reduce(b, { type: 'battlecryTarget', targetUid: 'm' });
    expect(b.board.find((c) => c.uid === 'm')!.attack).toBeGreaterThan(2); // consumed a Fodder → gained stats
  });

  it('Safety Deposit Box casts (untargeted) without throwing and banks +2 Gold for next turn', () => {
    // Regression: it reuses Hoarder's `battlecryBonusGoldNextTurn`, whose only self-dependency is the golden
    // multiplier. An untargeted spell has no `self`, so `gold(self)` used to throw (undefined.golden) and the
    // cast silently no-op'd (the box looked "unplayable"). `gold` is now null-safe (a spell is never golden).
    let s: RunState = {
      ...createRun(1),
      embers: 10,
      hand: [{ uid: 'sp', cardId: 'depositbox', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' }); // untargeted spell → casts immediately
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(false); // consumed (it actually resolved)
    expect(s.bonusEmbersNextTurn).toBe(2);
  });

  it('upgrade raises the tier and resets the cost to the next target', () => {
    let s = createRun(1);
    s = { ...s, embers: 20 };
    s = reduce(s, { type: 'upgrade' });
    expect(s.tier).toBe(2);
    expect(s.embers).toBe(15); // 20 - 5
    expect(s.upgradeCost).toBe(7); // cost to reach T3
  });

  it('enemy boards are deterministic per (threat, wave)', () => {
    const s = createRun(7);
    const a = buildEnemyBoard(s.threat, s.wave, makeRng(12345));
    const b = buildEnemyBoard(s.threat, s.wave, makeRng(12345));
    expect(a).toEqual(b);
  });

  it('threat selection avoids immediate repeats', () => {
    for (const prev of THREAT_IDS) {
      expect(selectThreat(2, makeRng(99), prev)).not.toBe(prev);
    }
  });

  // --- recruit effects: buy → hand (onBuy) → play → board (onSummon + Battlecry) ---

  it('Brightwing Broker buffs minions bought after it (+1/+2, in hand)', () => {
    const s0: RunState = {
      ...createRun(1),
      embers: 3,
      board: [{ uid: 'br', cardId: 'broker', tribe: 'neutral', attack: 3, health: 4, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'sandbag' }],
    };
    const s1 = reduce(s0, { type: 'buy', uid: 'x' });
    const bought = s1.hand.find((c) => c.cardId === 'sandbag');
    expect(bought?.attack).toBe(1); // 0 + 1, applied on buy
    expect(bought?.health).toBe(6); // 4 + 2 (Target Dummy is 0/4, Broker gives +1/+2)
  });

  it('Alleycur Battlecry summons a Stray only when played', () => {
    let s: RunState = { ...createRun(1), embers: 3, board: [], hand: [], shop: [{ uid: 'x', cardId: 'alley' }] };
    s = reduce(s, { type: 'buy', uid: 'x' });
    expect(s.hand.some((c) => c.cardId === 'alley')).toBe(true);
    expect(s.board.length).toBe(0); // Battlecry has not fired yet
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.some((c) => c.cardId === 'alley')).toBe(true);
    expect(s.board.some((c) => c.cardId === 'stray')).toBe(true);
  });

  it("a Kennelmaster triple folds its accrued Avenge bonus into the golden's summon bonus", () => {
    // Kennelmaster's Beast buff is now a Start-of-Combat aura (+(1 + summonBonus)/+(same)); the recruit
    // triple still carries the accrual, so the golden's summonBonus = base (1) + the two highest copies'
    // bonuses. Three copies (bonuses 2 / 1 / 0) → golden summonBonus 1 + 2 + 1 = 4.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'k1', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false, summonBonus: 2 },
        { uid: 'k2', cardId: 'kennel', tribe: 'beast', attack: 1, health: 4, keywords: [], golden: false, summonBonus: 1 },
      ],
      hand: [{ uid: 'k3', cardId: 'kennel', tribe: 'beast', attack: 1, health: 4, keywords: [], golden: false, summonBonus: 0 }],
    };
    s = reduce(s, { type: 'play', uid: 'k3' }); // 3 Kennelmasters → triple → one golden in hand
    const golden = [...s.board, ...s.hand].find((c) => c.cardId === 'kennel' && c.golden);
    expect(golden?.summonBonus).toBe(4); // base 1 + top-two bonuses (2 + 1)
  });

  it("persists a Kennelmaster's Avenge improvement across combat (whole-run)", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [{ uid: 'k', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false, summonBonus: 0 }],
      lastCombat: {
        events: [],
        result: 'win',
        playerDamage: 0,
        playerDeathrattles: 0,
        enemyDeaths: 0,
        initial: { player: [], enemy: [] },
        playerSummonBonus: [{ sourceUid: 'k', bonus: 2 }],
      },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.uid === 'k')?.summonBonus).toBe(2); // carried back from combat
  });

  it('spells cast in combat (Taragosa) permanently bump the run spellsCast at settle', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat', spellsCast: 5,
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerSpellsCast: 3 },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.spellsCast).toBe(8); // 5 (run) + 3 (cast in combat) — permanent, so Guel keeps improving
  });

  it('Tara ascends to Taragosa once granted stats 20 times in combat (at settle), keeping its stats', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat',
      board: [{ uid: 't', cardId: 'tara', tribe: 'dragon', attack: 9, health: 9, keywords: ['EG'], golden: false }],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerAscendCount: [{ sourceUid: 't', count: 20 }] },
    };
    s = reduce(s, { type: 'resolveCombat' });
    const t = s.board.find((c) => c.uid === 't');
    expect(t?.cardId).toBe('taragosa'); // ascended…
    expect([t?.attack, t?.health]).toEqual([9, 9]); // …keeping its accumulated stats
  });

  it('Tara banks ascend progress across combats — under 20 it stays Tara', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat',
      board: [{ uid: 't', cardId: 'tara', tribe: 'dragon', attack: 3, health: 3, keywords: ['EG'], golden: false }],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerAscendCount: [{ sourceUid: 't', count: 12 }] },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.uid === 't')?.cardId).toBe('tara'); // 12 < 20
    expect(s.board.find((c) => c.uid === 't')?.ascendProgress).toBe(12); // progress banked toward next time
  });

  it('tripling a Kennelmaster combines its accrued Avenge buffs', () => {
    // Two Kennelmasters at +6/+6 (summonBonus 5) and +4/+4 (summonBonus 3) + a fresh one →
    // the golden's buff is the combined +10/+10 (summonBonus 9 = base 1 + top-two 5 + 3).
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [
        { uid: 'k1', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false, summonBonus: 5 },
        { uid: 'k2', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false, summonBonus: 3 },
      ],
      shop: [{ uid: 'x', cardId: 'kennel' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' }); // the 3rd copy completes the triple
    const golden = s.hand.find((c) => c.cardId === 'kennel' && c.golden);
    expect(golden?.summonBonus).toBe(9); // base 1 + (5 + 3) → grants +10/+10
  });

  it("tripling a Flowing Monk combines the two highest copies' CURRENT grants into the golden's start", () => {
    // Copies granting +10/+10 (summonBonus 20 → step 4) and +4/+4 (summonBonus 5 → step 1) + a fresh third →
    // the golden grants 10 + 4 = +14/+14: its own golden base 4 plus a flat overflowBonus of 10. The overflow
    // countdown starts fresh (summonBonus unset → "5 to go").
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [
        { uid: 'm1', cardId: 'monk', tribe: 'neutral', attack: 4, health: 5, keywords: [], golden: false, summonBonus: 20 },
        { uid: 'm2', cardId: 'monk', tribe: 'neutral', attack: 4, health: 5, keywords: [], golden: false, summonBonus: 5 },
      ],
      shop: [{ uid: 'x', cardId: 'monk' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' }); // the 3rd copy completes the triple
    const golden = s.hand.find((c) => c.cardId === 'monk' && c.golden);
    expect(golden).toBeDefined();
    expect(golden?.overflowBonus).toBe(10); // (10 + 4) − the golden's own base grant of 4
    expect(golden?.summonBonus).toBeUndefined(); // countdown resets — 5 overflows to the next step
    // A fresh triple carries NO flat bonus — three +2/+2 monks combine to exactly the +4/+4 golden base.
    let f: RunState = {
      ...createRun(2),
      embers: 3,
      hand: [
        { uid: 'f1', cardId: 'monk', tribe: 'neutral', attack: 4, health: 5, keywords: [], golden: false },
        { uid: 'f2', cardId: 'monk', tribe: 'neutral', attack: 4, health: 5, keywords: [], golden: false },
      ],
      shop: [{ uid: 'y', cardId: 'monk' }],
    };
    f = reduce(f, { type: 'buy', uid: 'y' });
    expect(f.hand.find((c) => c.cardId === 'monk' && c.golden)?.overflowBonus).toBeUndefined();
  });

  it('Wildwood Shaper: Choose One — buff Beasts +1/+3 OR summon a Stray (golden doubles)', () => {
    // Playing it pauses for the pick, then the chosen option resolves.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'sh', cardId: 'shaper', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sh' });
    expect(s.chooseOne).toBeDefined(); // waits for the choice
    s = reduce(s, { type: 'chooseOne', index: 1 }); // summon a Stray
    expect(s.board.filter((c) => c.cardId === 'stray').length).toBe(1);
    expect(s.chooseOne).toBeUndefined();

    // Golden + summon → two Strays.
    let g: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'sh', cardId: 'shaper', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: true }],
    };
    g = reduce(g, { type: 'play', uid: 'sh' });
    g = reduce(g, { type: 'chooseOne', index: 1 });
    expect(g.board.filter((c) => c.cardId === 'stray').length).toBe(2);

    // The other option buffs your Beasts +1/+3 (includes self).
    let b: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'sh', cardId: 'shaper', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    };
    b = reduce(b, { type: 'play', uid: 'sh' });
    b = reduce(b, { type: 'chooseOne', index: 0 });
    const shaper = b.board.find((c) => c.cardId === 'shaper');
    expect([shaper?.attack, shaper?.health]).toEqual([3, 5]); // 2/2 + 1/3
  });

  it('a summoned Stray inherits the run-wide Beast Attack aura (Squirl Scout)', () => {
    // beastBuyAtk is the run-wide "Beasts +N Attack wherever" aura. A Stray summoned by Alleycat's Battlecry
    // must come in at 1+N Attack, same bake as a bought/conjured Beast — the summon path used to skip it.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [], beastBuyAtk: 2,
      hand: [{ uid: 'al', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'al' });
    const stray = s.board.find((c) => c.cardId === 'stray');
    expect(stray?.attack).toBe(1 + 2); // 1/1 Stray + the +2 Beast Attack aura
    expect(stray?.health).toBe(1); // aura is Attack-only
  });

  it('Runic Beetle: Choose One, then pick a friendly Beast to give it Rise or Flurry', () => {
    const setup = (): RunState => ({
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'p', cardId: 'pack', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false },
        { uid: 'o', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }, // a 2nd Beast
      ],
      hand: [{ uid: 'rb', cardId: 'beetle', tribe: 'beast', attack: 3, health: 1, keywords: [], golden: false }],
    });
    let s = setup();
    s = reduce(s, { type: 'play', uid: 'rb' });
    expect(s.chooseOne).toBeDefined(); // waits for the buff pick
    s = reduce(s, { type: 'chooseOne', index: 0 }); // pick Rise → now defers to a target
    expect(s.chooseOne).toBeUndefined();
    expect(s.pendingTarget).toBeDefined(); // waiting for the player to choose the Beast
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'o' }); // give it to the Alleycat (not the highest-Attack Beast)
    expect(s.pendingTarget).toBeUndefined();
    expect(s.board.find((c) => c.uid === 'o')?.keywords).toContain('R'); // the CHOSEN Beast got it
    expect(s.board.find((c) => c.uid === 'p')?.keywords).not.toContain('R'); // not the auto-pick
    // The other option grants Flurry to the chosen Beast.
    let f = setup();
    f = reduce(f, { type: 'play', uid: 'rb' });
    f = reduce(f, { type: 'chooseOne', index: 1 }); // Flurry
    f = reduce(f, { type: 'battlecryTarget', targetUid: 'p' });
    expect(f.board.find((c) => c.uid === 'p')?.keywords).toContain('W');
  });

  it('Runic Beetle with no other Beast auto-grants the buff to itself (no target step)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'rb', cardId: 'beetle', tribe: 'beast', attack: 3, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'rb' });
    s = reduce(s, { type: 'chooseOne', index: 0 }); // no other Beast → resolves now, on itself
    expect(s.pendingTarget).toBeUndefined();
    expect(s.board.find((c) => c.cardId === 'beetle')?.keywords).toContain('R');
  });

  it('Money Maker: every 2 turns conjures a Gold Pouch or Safety Deposit Box', () => {
    const s: RunState = {
      ...createRun(1), hand: [],
      board: [{ uid: 'mm', cardId: 'moneymaker', tribe: 'mech', attack: 1, health: 1, keywords: [], golden: false }],
    };
    applyEndOfTurn(s); // turn 1 — cadence tick 1, not due
    expect(s.hand.length).toBe(0);
    applyEndOfTurn(s); // turn 2 — cadence tick 2, due → conjures one
    expect(s.hand.length).toBe(1);
    expect(['emberpouch', 'depositbox']).toContain(s.hand[0]!.cardId);
  });

  it('Gildmaster: Golden Gild combines a pair into a golden copy in hand (costs 3, once per turn)', () => {
    let s: RunState = {
      ...createRun(1), heroId: 'gildmaster', embers: 5, heroReady: true, shop: [], hand: [],
      board: [
        { uid: 'a1', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'a2', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'heroPower', uid: 'x' }); // untargeted — finds the double itself
    const all = [...s.hand, ...s.board];
    expect(all.find((c) => c.cardId === 'alley' && c.golden)).toBeDefined(); // one golden Alleycat…
    expect(all.filter((c) => c.cardId === 'alley' && !c.golden)).toHaveLength(0); // …the pair consumed
    expect(s.embers).toBe(2); // 5 - 3 cost
    expect(s.heroPowerUses).toBe(1);
    expect(s.heroReady).toBe(false); // spent this turn
  });

  it('Gildmaster: with no double, the power is a no-op and spends nothing', () => {
    let s: RunState = {
      ...createRun(1), heroId: 'gildmaster', embers: 5, heroReady: true, shop: [], hand: [],
      board: [{ uid: 'a1', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'x' });
    expect([...s.hand, ...s.board].some((c) => c.golden)).toBe(false);
    expect(s.embers).toBe(5); // no charge
    expect(s.heroPowerUses ?? 0).toBe(0); // not counted
    expect(s.heroReady).toBe(true); // still available
  });

  it('Gildmaster: capped at 2 total uses across the game', () => {
    let s: RunState = {
      ...createRun(1), heroId: 'gildmaster', embers: 20, heroReady: true, heroPowerUses: 2, shop: [], hand: [],
      board: [
        { uid: 'a1', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'a2', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'heroPower', uid: 'x' }); // already used twice → blocked
    expect([...s.hand, ...s.board].some((c) => c.golden)).toBe(false);
    expect(s.embers).toBe(20);
  });

  it('Apples: SPELL Choose One — buff this shop +1/+3 OR bank +2/+4 for the next shop', () => {
    // Option 0 — buff the current tavern offers. Playing a Choose-One spell pauses (spell stays in hand).
    let s: RunState = {
      ...createRun(1), embers: 5,
      hand: [{ uid: 'ap', cardId: 'apples', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      shop: [{ uid: 'o1', cardId: 'alley' }, { uid: 'o2', cardId: 'pack' }],
    };
    s = reduce(s, { type: 'play', uid: 'ap' });
    expect(s.chooseOne).toMatchObject({ cardId: 'apples', spell: true });
    expect(s.hand.some((c) => c.uid === 'ap')).toBe(true); // not consumed yet
    s = reduce(s, { type: 'chooseOne', index: 0 });
    expect(s.chooseOne).toBeUndefined();
    expect(s.hand.some((c) => c.uid === 'ap')).toBe(false); // cast + consumed
    expect([s.shop[0]!.atk, s.shop[0]!.hp]).toEqual([1, 3]); // this shop's offers buffed

    // Option 1 — bank +2/+4 for the NEXT roll; the current shop is untouched, the buff lands on refresh.
    let g: RunState = {
      ...createRun(1), embers: 5,
      hand: [{ uid: 'ap', cardId: 'apples', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      shop: [{ uid: 'o1', cardId: 'alley' }],
    };
    g = reduce(g, { type: 'play', uid: 'ap' });
    g = reduce(g, { type: 'chooseOne', index: 1 });
    expect(g.nextShopBuff).toEqual({ attack: 2, health: 4 });
    expect([g.shop[0]!.atk ?? 0, g.shop[0]!.hp ?? 0]).toEqual([0, 0]); // current shop NOT buffed
    g = reduce(g, { type: 'roll' });
    expect(g.nextShopBuff).toBeUndefined();
    expect(g.shop.length > 0 && g.shop.every((o) => (o.atk ?? 0) === 2 && (o.hp ?? 0) === 4)).toBe(true);
  });

  it('Dragon Battlecries bake into stats when played', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'w', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: ['SC'], golden: false }],
      shop: [{ uid: 'x', cardId: 'cleric' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board.find((c) => c.cardId === 'frontdrake')?.attack).toBe(4); // 2 + 2
    const cleric = s.board.find((c) => c.cardId === 'cleric');
    expect(cleric?.attack).toBe(5); // 3 + 2 (Battlecry includes self)
    expect(cleric?.health).toBe(7); // 4 + 3
  });

  it("Ritualist's End of Turn buffs all Fodder — existing copies and the run-level card buff", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'recruit',
      embers: 0,
      shop: [],
      board: [
        { uid: 'r', cardId: 'ritualist', tribe: 'demon', attack: 2, health: 5, keywords: [], golden: false },
        { uid: 'f1', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false },
      ],
      hand: [{ uid: 'f2', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false }],
    };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn fires Ritualist before combat
    expect(s.cardBuffs.fred).toEqual({ attack: 2, health: 2 }); // +2/+2 persists for the run
    const f1 = s.board.find((c) => c.uid === 'f1');
    expect([f1?.attack, f1?.health]).toEqual([3, 3]); // Fodder on the board buffed now (1/1 + 2/2)
    const f2 = s.hand.find((c) => c.uid === 'f2');
    expect([f2?.attack, f2?.health]).toEqual([3, 3]); // Fodder in the hand too
  });

  it('Fodder found after a Ritualist proc carries the run buff — bought from the tavern', () => {
    let s: RunState = { ...createRun(1), embers: 3, shop: [{ uid: 'sf', cardId: 'fred' }], hand: [], board: [], cardBuffs: { fred: { attack: 2, health: 2 } } };
    s = reduce(s, { type: 'buy', uid: 'sf' });
    const bought = s.hand.find((c) => c.cardId === 'fred');
    expect([bought?.attack, bought?.health]).toEqual([3, 3]); // base 1/1 + the +2/+2 run buff
  });

  it('a Demon consuming buffed Fodder gains the buffed stats', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [{ uid: 'd', cardId: 'maw', tribe: 'demon', attack: 2, health: 2, keywords: ['CN'], golden: false }],
      cardBuffs: { fred: { attack: 2, health: 2 } },
      pendingTavern: ['fred'],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' }); // advance → next tavern injects Fred → the Demon eats it
    const eater = s.board.find((c) => c.cardId === 'maw');
    // The Demon eats a (1+2)/(1+2) Fred → +3/+3 → 5/5
    expect([eater?.attack, eater?.health]).toEqual([5, 5]);
    // the consume record carries the Fodder's *buffed* stats (3/3) so the eat animation shows them
    expect(s.fodderEaten?.[0]).toMatchObject({ fodderId: 'fred', attack: 3, health: 3 });
  });

  it('Koron — every 7 Gold spent, buffs Fodder +1/+1 and queues a Fodder (no longer touches Imps)', () => {
    // Drive applyGoldSpent directly: the reducer's roll path would refresh the tavern (draining
    // pendingTavern into the shop, where the on-board Koron eats it), hiding the queued Fodder.
    const s: RunState = {
      ...createRun(1),
      pendingTavern: [],
      board: [{ uid: 'ac', cardId: 'acid', tribe: 'demon', attack: 8, health: 8, keywords: [], golden: false }],
    };
    applyGoldSpent(s, 6); // 6 Gold — under the 7-Gold threshold
    expect(s.cardBuffs?.fred ?? { attack: 0, health: 0 }).toEqual({ attack: 0, health: 0 }); // not yet
    applyGoldSpent(s, 1); // crosses 7 → Koron procs once
    expect(s.cardBuffs?.fred).toEqual({ attack: 1, health: 1 }); // Fodder enchant run-wide
    expect(s.pendingTavern).toEqual(['fred']); // a Fodder queued into the next tavern
    expect(s.impBuff ?? { attack: 0, health: 0 }).toEqual({ attack: 0, health: 0 }); // Imps NOT affected
  });

  it('Imp Overseer Battlecry gives your Imps +2/+2 run-wide (board Imps + the impBuff carry for future ones)', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'recruit',
      board: [{ uid: 'i1', cardId: 'impscrap', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false }],
      hand: [{ uid: 'o', cardId: 'impoverseer', tribe: 'demon', attack: 3, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'o' });
    const imp = s.board.find((c) => c.uid === 'i1')!;
    expect([imp.attack, imp.health]).toEqual([3, 3]); // 1/1 Imp + 2/2
    expect(s.impBuff).toEqual({ attack: 2, health: 2 }); // run-wide, so Imps made later inherit it
  });

  it('Rope Wrangler — End of Turn casts Lasso, stealing a tavern minion into hand', () => {
    const s: RunState = {
      ...createRun(1),
      board: [{ uid: 'w', cardId: 'ropewrangler', tribe: 'neutral', attack: 5, health: 6, keywords: [], golden: false }],
      hand: [],
      shop: [{ uid: 's1', cardId: 'sandbag' }],
    };
    applyEndOfTurn(s);
    expect(s.hand.some((c) => c.cardId === 'sandbag')).toBe(true); // Lasso stole it into hand
    expect(s.shop.length).toBe(0); // …and it left the tavern
  });

  it('Crypt Scribe — End of Turn conjures 2 random spells to hand', () => {
    const s: RunState = {
      ...createRun(1),
      board: [{ uid: 'c', cardId: 'cryptscribe', tribe: 'undead', attack: 5, health: 5, keywords: [], golden: false }],
      hand: [],
    };
    applyEndOfTurn(s);
    expect(s.hand.length).toBe(2);
    expect(s.hand.every((c) => CARD_INDEX[c.cardId]?.spell)).toBe(true); // both are spells
  });

  it('a frozen tavern tops up empty slots + a missing spell after combat', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      frozen: true,
      shop: [{ uid: 'keep', cardId: 'alley' }], // one frozen offer; the rest were bought away
      spell: null, // …and the spell was bought
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.shop.length).toBe(3); // tier 1 → 3 slots, topped up from the 1 frozen offer
    expect(s.shop[0]!.uid).toBe('keep'); // the frozen offer is preserved, still first
    expect(s.spell).not.toBeNull(); // the missing spell is filled in
    expect(s.frozen).toBe(false); // freeze is consumed for the new turn
  });

  it('a frozen tavern still delivers Soulfeeder-queued Fodder (not stranded)', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      frozen: true,
      board: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
      pendingTavern: ['fred'], // queued by Soulfeeder's Battlecry last turn
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.board.find((c) => c.cardId === 'feed')!.attack).toBe(3); // the demon ate the queued Fred (+1/+1)
    expect(s.pendingTavern).toEqual([]); // queue cleared — not stranded by the freeze
  });

  it('triples are checked at shop-start — a combat hand-grant that completes a triple combines without a buy/play', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [
        { uid: 'c1', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
        { uid: 'c2', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
      ],
      hand: [],
      // The Deathrattle-granted 3rd copy lands in the hand at settle — completing a triple the player never
      // had a buy/play to trigger. The shop-start check must combine it as the new wave opens.
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerHandGrants: ['cleric'] },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    const clerics = [...s.board, ...s.hand].filter((c) => c.cardId === 'cleric');
    expect(clerics.length).toBe(1); // all 3 combined
    expect(clerics[0]!.golden).toBe(true); // …into one golden
  });

  it("Bane's Fodder enchant from combat persists — settleCombat applies it run-wide", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [{ uid: 'f', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false }],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerFodderBuffGain: { attack: 2, health: 2 } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.cardBuffs?.fred).toEqual({ attack: 2, health: 2 }); // run-wide enchant → future Fodder inherit it
    const fred = s.board.find((c) => c.uid === 'f')!;
    expect([fred.attack, fred.health]).toEqual([1 + 2, 1 + 2]); // the Fodder already on board got it too
  });

  it('tripling Tara keeps the HIGHEST ascend progress (lowest "to go"), not a reset', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 't1', cardId: 'tara', tribe: 'dragon', attack: 3, health: 3, keywords: ['EG'], golden: false, ascendProgress: 12 },
        { uid: 't2', cardId: 'tara', tribe: 'dragon', attack: 3, health: 3, keywords: ['EG'], golden: false, ascendProgress: 5 },
      ],
      hand: [{ uid: 't3', cardId: 'tara', tribe: 'dragon', attack: 3, health: 3, keywords: ['EG'], golden: false, ascendProgress: 8 }],
    };
    s = reduce(s, { type: 'play', uid: 't3' }); // 3rd Tara → triple
    const golden = [...s.board, ...s.hand].find((c) => c.cardId === 'tara' && c.golden);
    expect(golden).toBeDefined();
    expect(golden!.ascendProgress).toBe(12); // max of {12, 5, 8} — the copy closest to ascending
  });

  it('Tara carries its prior ascend progress into combat (so the live tracker shows the total, not just this fight)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 't', cardId: 'tara', tribe: 'dragon', attack: 9, health: 9, keywords: ['EG'], golden: false, ascendProgress: 10 }],
    };
    s = reduce(s, { type: 'faceOmen' });
    const tara = s.lastCombat?.initial.player.find((m) => m.cardId === 'tara');
    expect(tara?.ascendProgress).toBe(10); // seeded from the run board, not reset to 0 each combat
  });

  it('a combat card grant (Sporebat / Ryme→Sea Urchin) lands the actual carried card at settle, with run buffs', () => {
    let s: RunState = {
      ...createRun(1), tier: 3, undeadBuyAtk: 2,
      cardBuffs: { cleric: { attack: 1, health: 1 } },
      phase: 'combat', hand: [],
      // Combat already picked these specific cards (a toHand event animated them in); settle just adds them.
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, playerHandGrants: ['cleric', 'karthus'] },
    };
    s = reduce(s, { type: 'resolveCombat' });
    const cleric = s.hand.find((c) => c.cardId === 'cleric')!;
    const karthus = s.hand.find((c) => c.cardId === 'karthus')!;
    expect(cleric).toBeDefined();
    expect([cleric.attack, cleric.health]).toEqual([CARD_INDEX.cleric!.attack + 1, CARD_INDEX.cleric!.health + 1]); // run-wide cardBuff
    expect(karthus.attack).toBe(CARD_INDEX.karthus!.attack + 2); // Undead bond (undeadBuyAtk) baked in
  });

  it('Ryme-deferred economy Battlecries replay through their recruit factory at settle (Soulfeeder + Hoarder)', () => {
    let s: RunState = {
      ...createRun(1), phase: 'combat', hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] },
        // 3 economy battlecries Ryme re-fired in combat: 2 Soulfeeders (one golden) + 1 Hoarder.
        playerDeferredBattlecries: [{ cardId: 'feed', golden: false }, { cardId: 'feed', golden: true }, { cardId: 'hoarder', golden: false }] },
    };
    const goldBefore = s.bonusEmbersNextTurn ?? 0;
    s = reduce(s, { type: 'settleCombat' }); // settle WITHOUT advancing, so the queued Fodder isn't injected/cleared yet
    // Soulfeeder queues Fodder into the next tavern: 1 (non-golden) + 2 (golden) = 3 Fred.
    expect((s.pendingTavern ?? []).filter((id) => id === 'fred').length).toBe(3);
    // Hoarder grants +1 Gold next turn (its recruit factory ran with full RunState access).
    expect((s.bonusEmbersNextTurn ?? 0) - goldBefore).toBe(1);
  });

  it('Soulfeeder queues Fodder only once — it does not re-proc on later rounds', () => {
    let s: RunState = {
      ...createRun(1),
      resolve: 999, maxResolve: 999,
      embers: 0, shop: [],
      hand: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
      board: [],
    };
    s = reduce(s, { type: 'play', uid: 'sf' });
    const atk = () => s.board.find((c) => c.cardId === 'feed')!.attack;
    expect(atk()).toBe(2);
    const seen: number[] = [];
    for (let r = 0; r < 4; r++) {
      s = reduce(s, { type: 'faceOmen' });
      s = reduce(s, { type: 'resolveCombat' });
      seen.push(atk());
    }
    // ate one Fred on the first refresh (2 → 3), then never again — no per-round re-proc
    expect(seen).toEqual([3, 3, 3, 3]);
    expect(s.pendingTavern).toEqual([]);
  });

  it('Buddy Buddy adds a random Tier 1 minion to your hand (golden adds two)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [],
      hand: [{ uid: 'b', cardId: 'buddy', tribe: 'neutral', attack: 3, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'b' });
    expect(s.board.find((c) => c.cardId === 'buddy')).toBeDefined();
    const gained = s.hand;
    expect(gained.length).toBe(1); // one random T1 minion granted to hand
    expect(CARD_INDEX[gained[0]!.cardId]?.tier).toBe(1);

    // golden Buddy Buddy grants two
    let g: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [],
      hand: [{ uid: 'bg', cardId: 'buddy', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: true }],
    };
    g = reduce(g, { type: 'play', uid: 'bg' });
    // two random T1 minions (the golden also grants its usual Discover spell, so ignore that one)
    expect(g.hand.filter((c) => c.cardId !== 'discoverspell').length).toBe(2);
  });

  it('Karwind buffs your Dragons whenever a Battlecry triggers', () => {
    // Play Hoard Cleric (Dragon Battlecry +2/+3 to dragons) with Karwind on board: the Cleric's
    // Battlecry buffs Karwind +2/+3, then the battlecry-triggered proc gives Dragons +1/+2.
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [{ uid: 'k', cardId: 'karwind', tribe: 'dragon', attack: 2, health: 12, keywords: [], golden: false }],
      hand: [{ uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c' });
    const k = s.board.find((c) => c.uid === 'k')!;
    expect([k.attack, k.health]).toEqual([6, 17]); // 2/12 +2/+3 (Cleric) +2/+2 (Karwind proc)
  });

  it('Karwind procs once per Battlecry fire — Drakko doubling triggers it twice', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [
        { uid: 'k', cardId: 'karwind', tribe: 'dragon', attack: 2, health: 12, keywords: [], golden: false },
        { uid: 'd', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false },
      ],
      hand: [{ uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c' });
    const k = s.board.find((c) => c.uid === 'k')!;
    // Cleric Battlecry fires 2× (+4/+6) and Karwind procs 2× (+2/+2 each = +4/+4): 2/12 → 10/22
    expect([k.attack, k.health]).toEqual([10, 22]);
  });

  it('Money Bot raises max mana while on board; selling it removes the income', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [{ uid: 'mb', cardId: 'moneybot', tribe: 'mech', attack: 3, health: 3, keywords: ['M'], golden: false }],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    expect(boardManaBonus(s)).toBe(1);
    s = reduce(s, { type: 'resolveCombat' }); // advance a turn → start with base max + the bonus
    expect(s.embers).toBe(s.maxEmbers + 1);
  });

  it('Money Bot magnetized into a Mech passes on its mana; selling the host removes it (survives a triple)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [{ uid: 'mb', cardId: 'moneybot', tribe: 'mech', attack: 3, health: 3, keywords: ['M'], golden: false }],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'mb', toIndex: 0 }); // magnetize onto the Spare Part Drone
    expect(s.board.length).toBe(1); // merged, not a new slot
    expect(s.board[0]!.manaBonus).toBe(1); // the host absorbed Money Bot's income
    expect(boardManaBonus(s)).toBe(1);
    s = reduce(s, { type: 'sell', uid: 'd' }); // sell the host
    expect(boardManaBonus(s)).toBe(0); // income gone with it
  });

  it('Better Bot magnetizes its Rally onto a Mech, and it stacks (+5 each)', () => {
    let s: RunState = {
      ...createRun(1),
      hand: [
        { uid: 'bb1', cardId: 'betterbot', tribe: 'mech', attack: 6, health: 4, keywords: ['M', 'RL'], golden: false },
        { uid: 'bb2', cardId: 'betterbot', tribe: 'mech', attack: 6, health: 4, keywords: ['M', 'RL'], golden: false },
      ],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'bb1', toIndex: 0 }); // weld onto the Drone
    expect(s.board.length).toBe(1); // merged, not a new slot
    expect(s.board[0]!.rallyMechAtk).toBe(5); // host now grants +5 to other Mechs on attack
    s = reduce(s, { type: 'play', uid: 'bb2', toIndex: 0 }); // weld a 2nd Better Bot → stacks
    expect(s.board[0]!.rallyMechAtk).toBe(10); // +5 each → +10
  });

  it('Speedy is Magnetic — it welds its keyword onto a host Mech', () => {
    // Speedy welds Windfury.
    let sp: RunState = {
      ...createRun(1),
      hand: [{ uid: 'mag', cardId: 'speedy', tribe: 'mech', attack: 4, health: 4, keywords: ['W', 'M'], golden: false }],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 4, health: 4, keywords: [], golden: false }],
    };
    sp = reduce(sp, { type: 'play', uid: 'mag', toIndex: 0 });
    expect(sp.board[0]!.keywords).toContain('W');
  });

  it('Combinator magnetizes a random Magnetic Mech onto 1 friendly Mech at end of turn (golden: 2)', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'recruit',
      embers: 0,
      shop: [],
      board: [
        { uid: 'cmb', cardId: 'combinator', tribe: 'mech', attack: 6, health: 7, keywords: [], golden: false },
        { uid: 'd1', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'd2', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
      ],
    };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn fires Combinator before combat
    const d1 = s.board.find((c) => c.uid === 'd1')!;
    const d2 = s.board.find((c) => c.uid === 'd2')!;
    const cmb = s.board.find((c) => c.uid === 'cmb')!;
    const welded = [d1, d2].filter((m) => m.attack > 2);
    expect(welded.length).toBe(1); // non-golden welds exactly one Mech (golden would weld two)
    // The host (2/1) gained a random Magnetic Mech's body: Cling (2/2), Money Bot (3/3),
    // Speedy (4/4), Harry Botter (1/5) or Better Bot (6/4).
    const profiles = [[2 + 2, 1 + 2], [2 + 3, 1 + 3], [2 + 4, 1 + 4], [2 + 1, 1 + 5], [2 + 6, 1 + 4]];
    expect(profiles).toContainEqual([welded[0]!.attack, welded[0]!.health]);
    expect([cmb.attack, cmb.health]).toEqual([6, 7]); // self is not a target
  });

  it('a golden Combinator welds onto 2 RANDOM Mechs — the pair varies by seed, not the highest-Attack', () => {
    const everBuffed = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) {
      let s: RunState = {
        ...createRun(seed),
        phase: 'recruit',
        embers: 0,
        shop: [],
        board: [
          { uid: 'cmb', cardId: 'combinator', tribe: 'mech', attack: 6, health: 7, keywords: [], golden: true },
          { uid: 'm1', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false },
          { uid: 'm2', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false },
          { uid: 'm3', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false },
          { uid: 'm4', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false },
        ],
      };
      s = reduce(s, { type: 'faceOmen' });
      const buffed = s.board.filter((c) => c.uid.startsWith('m') && c.attack > 2).map((c) => c.uid);
      expect(buffed.length).toBe(2); // exactly `targets` (2) Mechs welded each run
      buffed.forEach((u) => everBuffed.add(u));
    }
    // Over 24 seeds the chosen pair shifts around — the old highest-Attack logic would always pick m1/m2.
    expect(everBuffed.size).toBeGreaterThan(2);
  });

  it('Chronos triggers End-of-Turn effects an extra time', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'recruit',
      embers: 0,
      shop: [],
      board: [
        { uid: 'r', cardId: 'ritualist', tribe: 'demon', attack: 2, health: 5, keywords: [], golden: false },
        { uid: 'ch', cardId: 'chronos', tribe: 'neutral', attack: 1, health: 6, keywords: [], golden: false },
        { uid: 'f', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false },
      ],
    };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn fires Ritualist twice (Chronos +1)
    expect(s.cardBuffs.fred).toEqual({ attack: 4, health: 4 }); // +2/+2 applied twice
    const f = s.board.find((c) => c.uid === 'f')!;
    expect([f.attack, f.health]).toEqual([5, 5]); // the on-board Fred: 1/1 + 4/4
  });

  it('Magnetic merges a Cling Drone onto a friendly Mech (no new slot)', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
      shop: [{ uid: 'x', cardId: 'cling' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid, toIndex: 0 }); // drop onto the Mech
    expect(s.board.length).toBe(1); // merged, not added
    expect(s.hand.length).toBe(0);
    const drone = s.board[0]!;
    expect(drone.attack).toBe(4); // 2 + 2
    expect(drone.health).toBe(3); // 1 + 2
    expect(drone.keywords).toContain('DS');
    expect(drone.keywords).toContain('M'); // the welded host IS now an Attachment (owner ruling 2026-07-08)
  });

  it('a Mech Magnetic can weld onto a Chaos Attachment host (the all-type body counts as a Mech)', () => {
    // Regression: a Chaos Attachment's printed tribe is 'neutral' (+ universalTribe), so the old tribe-match
    // missed it and a normal Mech magnetic couldn't weld onto it. The host being all-type must accept any magnetic.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'host', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M', 'R'], golden: false }],
      hand: [{ uid: 'cl', cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'cl', toIndex: 0 }); // weld the Mech magnetic onto the all-type host
    expect(s.board.length).toBe(1); // merged, no new slot
    expect(s.hand.length).toBe(0);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([3, 3]); // 1/1 host + Cling 2/2
  });

  it('magnetizing fires summon-buffs first: Mama Bear buffs the Chaos Attachment, then it welds onto the host', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'mb', cardId: 'mamabear', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false },
        { uid: 'host', cardId: 'gnash', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false },
      ],
      hand: [{ uid: 'sym', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sym', toIndex: 1 }); // weld onto the Gnasher host (universalTribe → any non-neutral)
    expect(s.board.length).toBe(2); // merged, no new slot
    const host = s.board.find((c) => c.uid === 'host')!;
    // Attachment 1/1 + Den Mother (recruit +1/+1, universalTribe counts as a Beast) = 2/2, welded onto the 5/5 host → 7/7.
    expect([host.attack, host.health]).toEqual([7, 7]);
  });

  it('Chaos Attachment is Magnetic Reborn — welding it grants the host Reborn', () => {
    expect(CARD_INDEX.symbioticattachment!.keywords).toContain('R'); // the token itself carries Reborn
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'host', cardId: 'gnash', tribe: 'beast', attack: 5, health: 5, keywords: [], golden: false }],
      // The real token (from the Chaos hero power) carries M + R.
      hand: [{ uid: 'sym', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M', 'R'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sym', toIndex: 0 }); // weld onto the host
    const host = s.board.find((c) => c.uid === 'host')!;
    expect(host.keywords).toContain('R'); // Reborn rides along on the weld
    expect(host.keywords).toContain('M'); // the welded host IS now an Attachment (owner ruling 2026-07-08)
    expect([host.attack, host.health]).toEqual([6, 6]); // 5/5 host + the Attachment's 1/1
  });

  it('a welded host becomes an Attachment and inherits the run-wide Attachment aura (owner ruling 2026-07-08)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      magneticBuyAtk: 2, magneticBuyHp: 3, // Scrap Herald's run-wide Attachment aura is active
      board: [{ uid: 'host', cardId: 'drone', tribe: 'mech', attack: 5, health: 5, keywords: [], golden: false }],
      hand: [{ uid: 'cl', cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'cl', toIndex: 0 }); // weld the Magnetic onto the host
    const host = s.board.find((c) => c.uid === 'host')!;
    expect(host.keywords).toContain('M'); // now an Attachment → picks up the aura
    // 5/5 host + Cling 2/2 (weld) + Attachment aura +2/+3 (baked once, on first becoming Magnetic) = 9/10.
    expect([host.attack, host.health]).toEqual([9, 10]);
  });

  it('Nimbus doubles a Discover-spell: Tribe Portal under a Nimbus charge opens two Discovers', () => {
    let s: RunState = {
      ...createRun(1), tier: 4, embers: 0, shop: [],
      nextSpellMult: 2, // a Nimbus charge is active
      board: [{ uid: 'b', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }], // gives Tribe Portal a dominant type
      hand: [{ uid: 'tp', cardId: 'tribeportal', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'tp' });
    expect(s.discover).toBeDefined(); // first Discover opens
    expect(s.discoverQueue?.length ?? 0).toBe(1); // the 2nd is queued (Nimbus doubled the cast)
    expect(s.nextSpellMult).toBeUndefined(); // charge spent
  });

  it('Heckbinder (Demon/Mech) magnetizes onto a Demon or a Mech, but not other tribes', () => {
    const heck = (): BoardCard => ({ uid: 'h', cardId: 'heckbinder', tribe: 'demon', attack: 3, health: 3, keywords: ['M'], golden: false });
    // onto a Demon → merges (+3/+3)
    let d: RunState = { ...createRun(1), embers: 0, shop: [], hand: [heck()], board: [{ uid: 't', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }] };
    d = reduce(d, { type: 'play', uid: 'h', toIndex: 0 });
    expect(d.board.length).toBe(1);
    expect([d.board[0]!.attack, d.board[0]!.health]).toEqual([5, 5]);
    // onto a Mech → merges
    let m: RunState = { ...createRun(1), embers: 0, shop: [], hand: [heck()], board: [{ uid: 't', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }] };
    m = reduce(m, { type: 'play', uid: 'h', toIndex: 0 });
    expect(m.board.length).toBe(1);
    expect([m.board[0]!.attack, m.board[0]!.health]).toEqual([5, 4]);
    // onto a Beast → no merge; plays as its own 3/3 body
    let b: RunState = { ...createRun(1), embers: 0, shop: [], hand: [heck()], board: [{ uid: 't', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }] };
    b = reduce(b, { type: 'play', uid: 'h', toIndex: 0 });
    expect(b.board.length).toBe(2);
  });

  it('a Mech-magnetic card (Cling Drone) can magnetize ONTO Heckbinder — it counts as a Mech', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      hand: [{ uid: 'c', cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false }],
      board: [{ uid: 'h', cardId: 'heckbinder', tribe: 'demon', attack: 3, health: 3, keywords: ['M'], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c', toIndex: 0 });
    expect(s.board.length).toBe(1); // merged onto Heckbinder (a Demon/Mech)
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([5, 5]); // 3/3 + 2/2
  });

  it('magnetizing a GOLDEN Magnetic still grants the triple Discover', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      hand: [{ uid: 'c', cardId: 'cling', tribe: 'mech', attack: 4, health: 4, keywords: ['M'], golden: true }],
      board: [{ uid: 'd', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c', toIndex: 0 });
    expect(s.board.length).toBe(1); // merged, no board slot taken
    expect(s.hand.some((h) => h.cardId === 'discoverspell')).toBe(true); // golden "play" still grants the Discover
  });

  it('a Magnetic minion dropped off a Mech plays as a normal body', () => {
    let s: RunState = { ...createRun(1), embers: 3, hand: [], board: [], shop: [{ uid: 'x', cardId: 'cling' }] };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); // no target → normal play
    expect(s.board.length).toBe(1);
    expect(s.board[0]!.cardId).toBe('cling');
  });

  it('Magnetic does not merge onto a non-Mech', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [{ uid: 'g', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false }],
      shop: [{ uid: 'x', cardId: 'cling' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid, toIndex: 0 });
    expect(s.board.length).toBe(2); // placed as its own minion
    expect(s.board.some((c) => c.cardId === 'cling')).toBe(true);
  });

  it('Fred (Fodder) is not in the buyable shop pool', () => {
    expect(BUYABLE_CARDS.some((c) => c.id === 'fred')).toBe(false);
  });

  it('Soulfeeder Battlecry queues Fodder into the next tavern', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      hand: [],
      board: [],
      shop: [{ uid: 'x', cardId: 'feed' }],
      pendingTavern: [],
    };
    s = reduce(s, { type: 'buy', uid: 'x' });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); // Soulfeeder Battlecry
    expect(s.pendingTavern).toContain('fred'); // queued for the next refresh, not placed now
    expect(s.board.some((c) => c.cardId === 'fred')).toBe(false);
  });

  it('a Demon devours Fodder entering the tavern', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      board: [{ uid: 'd', cardId: 'maw', tribe: 'demon', attack: 2, health: 2, keywords: ['CN'], golden: false }],
      pendingTavern: ['fred'],
    };
    s = reduce(s, { type: 'roll' }); // tavern refresh injects the Fodder, then the Demon eats it
    expect(s.shop.some((o) => o.cardId === 'fred')).toBe(false); // eaten, not left in the tavern
    const eater = s.board.find((c) => c.cardId === 'maw');
    expect([eater?.attack, eater?.health]).toEqual([3, 3]); // 2/2 + 1×(1/1)
  });


  it('Maw of the Pit queues a Fodder into the next tavern at End of Turn', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'maw', tribe: 'demon', attack: 4, health: 5, keywords: ['T'], golden: false }],
      pendingTavern: [],
    };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn fires → Maw queues a Fodder for the next tavern
    expect(s.pendingTavern).toContain('fred');
  });

  it('a golden Maw of the Pit queues two Fodder at End of Turn', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'maw', tribe: 'demon', attack: 8, health: 10, keywords: ['T'], golden: true }],
      pendingTavern: [],
    };
    s = reduce(s, { type: 'faceOmen' });
    expect((s.pendingTavern ?? []).filter((c) => c === 'fred')).toHaveLength(2);
  });

  it('Archmagus Guel buffs 2 other friends when you cast a tavern spell', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 5,
      hand: [{ uid: 'sp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      board: [
        { uid: 'g', cardId: 'guel', tribe: 'neutral', attack: 2, health: 3, keywords: [], golden: false },
        { uid: 'a', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'sp' }); // cast Mana Pouch (a tavern spell)
    const a = s.board.find((c) => c.uid === 'a');
    const b = s.board.find((c) => c.uid === 'b');
    const g = s.board.find((c) => c.uid === 'g');
    expect([a?.attack, a?.health]).toEqual([2, 2]); // both *other* friends get +1/+1
    expect([b?.attack, b?.health]).toEqual([2, 2]);
    expect([g?.attack, g?.health]).toEqual([2, 3]); // Guel itself does not
  });

  it('Flowing Monk buffs a friend when a summon overflows the full board', () => {
    const filler = (uid: string): BoardCard => ({ uid, cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false });
    let s: RunState = {
      ...createRun(1),
      embers: 5,
      hand: [{ uid: 'al', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
      board: [
        { uid: 'mk', cardId: 'monk', tribe: 'neutral', attack: 1, health: 4, keywords: [], golden: false },
        filler('f1'), filler('f2'), filler('f3'), filler('f4'), filler('f5'),
      ],
    };
    // 6 minions → playing Alleycat makes 7, then its Stray Battlecry summon overflows → Monk procs.
    s = reduce(s, { type: 'play', uid: 'al' });
    expect(s.board.some((c) => c.buffs?.some((b) => b.source === 'Flowing Monk'))).toBe(true);
  });

  it('Fodder with no Demon on board is wasted — never enters the tavern, never stored', () => {
    let s: RunState = { ...createRun(1), embers: 3, board: [], pendingTavern: ['fred'] };
    s = reduce(s, { type: 'roll' });
    expect(s.shop.some((o) => o.cardId === 'fred')).toBe(false); // no Demon → wasted, doesn't clutter the shop
    expect(s.pendingTavern).toEqual([]); // and not stored for later
  });

  it('always offers one spell on the right of the shop', () => {
    const s = createRun(1);
    expect(s.spell).not.toBeNull();
    expect(CARD_INDEX[s.spell!.cardId]?.spell).toBe(true);
  });

  it('buys a spell into the hand at its own cost (not the minion cost)', () => {
    let s: RunState = { ...createRun(1), embers: 5, spell: { uid: 'sp', cardId: 'spiritfire' } };
    const def = CARD_INDEX[s.spell!.cardId]!;
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    expect(s.embers).toBe(5 - (def.cost ?? 0)); // Spirit Fire costs 2, not 3
    expect(s.hand.some((c) => c.cardId === 'spiritfire')).toBe(true);
    expect(s.spell).toBeNull(); // slot empties until the next roll
  });

  it('Spirit Fire buffs the targeted friend +4/+4, is consumed, and counts as a cast', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 5,
      spell: { uid: 'sp', cardId: 'spiritfire' },
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    const spell = s.hand.find((c) => c.cardId === 'spiritfire')!;
    s = reduce(s, { type: 'play', uid: spell.uid, targetUid: 'm' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([5, 5]); // 1/1 + 4/4
    expect(s.hand.some((c) => c.cardId === 'spiritfire')).toBe(false); // no board slot — consumed
    expect(s.spellsCast).toBe(1);
  });

  it('a targeted spell played with no valid target is not cast', () => {
    let s: RunState = { ...createRun(1), embers: 5, board: [], spell: { uid: 'sp', cardId: 'spiritfire' } };
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    const spell = s.hand.find((c) => c.cardId === 'spiritfire')!;
    const after = reduce(s, { type: 'play', uid: spell.uid }); // no targetUid
    expect(after.hand.some((c) => c.cardId === 'spiritfire')).toBe(true); // stays in hand
    expect(after.spellsCast).toBe(0);
  });

  it('Growth buffs every friendly minion (+3/+4, untargeted)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'a', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'gnash', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
      ],
      hand: [{ uid: 'g', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' }); // no target — buffs the whole board
    expect([s.board.find((c) => c.uid === 'a')!.attack, s.board.find((c) => c.uid === 'a')!.health]).toEqual([4, 5]);
    expect([s.board.find((c) => c.uid === 'b')!.attack, s.board.find((c) => c.uid === 'b')!.health]).toEqual([5, 6]);
    expect(s.hand.some((c) => c.cardId === 'growth')).toBe(false); // consumed
    expect(s.spellsCast).toBe(1);
  });

  it('Channeling the Devourer removes the target and feeds its stats to a random other friend', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'eat', cardId: 'gnash', tribe: 'beast', attack: 6, health: 5, keywords: [], golden: false },
        { uid: 'recip', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'd', cardId: 'devour', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'd', targetUid: 'eat' }); // devour the 6/5
    expect(s.board.find((c) => c.uid === 'eat')).toBeUndefined(); // devoured
    const recip = s.board.find((c) => c.uid === 'recip')!;
    expect([recip.attack, recip.health]).toEqual([7, 6]); // 1/1 + the devoured 6/5
    expect(s.devourFx).toEqual({ toUid: 'recip', attack: 6, health: 5 }); // projectile hint for the UI
  });

  it('Lantern Light gives the target +Tier/+Tier (scales with Tavern Tier)', () => {
    let s: RunState = {
      ...createRun(1),
      tier: 3,
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
      hand: [{ uid: 'll', cardId: 'lanternlight', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'll', targetUid: 'm' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([4, 4]); // 1/1 + Tier 3
    expect(s.hand.some((c) => c.cardId === 'lanternlight')).toBe(false); // consumed
  });

  it('Fodder Treatment sells the target (+Gold) and feeds its stats to the left-most Demon', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      board: [
        { uid: 'd', cardId: 'maw', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false },
        { uid: 'fodder', cardId: 'sandbag', tribe: 'neutral', attack: 4, health: 5, keywords: [], golden: false },
      ],
      hand: [{ uid: 'ft', cardId: 'foddertreatment', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'ft', targetUid: 'fodder' });
    expect(s.board.find((c) => c.uid === 'fodder')).toBeUndefined(); // sold
    const demon = s.board.find((c) => c.uid === 'd')!;
    expect([demon.attack, demon.health]).toEqual([7, 8]); // 3/3 + the sold 4/5
    expect(s.embers).toBe(1); // counts as a sell → +1 Gold
  });

  it('Fodder Treatment with no Demon still sells the minion (+Gold); the stats are wasted', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      board: [{ uid: 'fodder', cardId: 'sandbag', tribe: 'neutral', attack: 4, health: 5, keywords: [], golden: false }],
      hand: [{ uid: 'ft', cardId: 'foddertreatment', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'ft', targetUid: 'fodder' });
    expect(s.board).toHaveLength(0); // sold, nothing to feed
    expect(s.embers).toBe(1);
  });

  it('Resonance re-triggers a Battlecry minion but fizzles (kept) on a non-Battlecry target', () => {
    const s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'bc', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }, // Battlecry: summon a Stray
        { uid: 'plain', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'ps', cardId: 'resonance', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    const onPlain = reduce(s, { type: 'play', uid: 'ps', targetUid: 'plain' });
    expect(onPlain.hand.some((c) => c.cardId === 'resonance')).toBe(true); // no Battlecry → fizzles, kept
    const onBc = reduce(s, { type: 'play', uid: 'ps', targetUid: 'bc' });
    expect(onBc.hand.some((c) => c.cardId === 'resonance')).toBe(false); // consumed
    expect([...onBc.board, ...onBc.hand].filter((c) => c.cardId === 'stray').length).toBeGreaterThanOrEqual(1);
  });

  it('Chrono Staff makes End-of-Turn effects fire one extra time (stacks with Chronos, not itself)', () => {
    const withChronos = {
      ...createRun(1),
      board: [{ uid: 'c', cardId: 'chronos', tribe: 'neutral', attack: 1, health: 6, keywords: [], golden: false }],
    } as RunState;
    expect(endOfTurnRepeats(withChronos)).toBe(2); // 1 + Chronos
    expect(endOfTurnRepeats({ ...withChronos, extraEotThisTurn: true })).toBe(3); // + Chrono Staff (stacks)
    // Casting the staff sets the per-turn flag; casting twice doesn't stack with itself.
    let s: RunState = {
      ...createRun(1),
      hand: [{ uid: 'cs', cardId: 'chronostaff', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'cs' });
    expect(s.extraEotThisTurn).toBe(true);
    expect(endOfTurnRepeats(s)).toBe(2); // no Chronos → 1 + staff
  });

  it('Steward of Spells — End of Turn copies the most recent spell cast (golden: 2 copies)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'st', cardId: 'stewardofspells', tribe: 'neutral', attack: 3, health: 7, keywords: [], golden: false },
        { uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'sp', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm' }); // cast Spirit Fire → records the last spell
    expect(s.lastSpellCastId).toBe('spiritfire');
    applyEndOfTurn(s); // Steward conjures a copy
    expect(s.hand.filter((c) => c.cardId === 'spiritfire')).toHaveLength(1);
    // Golden Steward → 2 copies.
    const g: RunState = {
      ...createRun(1),
      board: [{ uid: 'st', cardId: 'stewardofspells', tribe: 'neutral', attack: 3, health: 7, keywords: [], golden: true }],
      lastSpellCastId: 'spiritfire',
    };
    applyEndOfTurn(g);
    expect(g.hand.filter((c) => c.cardId === 'spiritfire')).toHaveLength(2);
  });

  it('Steward of Spells does nothing when no spell has been cast yet', () => {
    const s: RunState = {
      ...createRun(1),
      board: [{ uid: 'st', cardId: 'stewardofspells', tribe: 'neutral', attack: 3, health: 7, keywords: [], golden: false }],
    };
    applyEndOfTurn(s);
    expect(s.hand).toHaveLength(0); // no lastSpellCastId → no copy
  });

  it('Tara is Tier 4', () => {
    expect(CARD_INDEX.tara!.tier).toBe(4);
  });

  it('Consume — a targeted Demon creates and eats a Fodder (its stats feed the Demon, tavern untouched)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'd', cardId: 'maw', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false }],
      shop: [{ uid: 's1', cardId: 'sandbag' }],
      hand: [{ uid: 'cn', cardId: 'consume', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'cn', targetUid: 'd' });
    expect(s.shop).toHaveLength(1); // the tavern is untouched — Consume makes its own Fodder
    const demon = s.board.find((c) => c.uid === 'd')!;
    const fred = CARD_INDEX.fred!;
    expect([demon.attack, demon.health]).toEqual([3 + fred.attack, 3 + fred.health]); // gained the Fodder's 1/1
    expect(s.fodderEaten?.[0]).toMatchObject({ fodderId: 'fred' }); // the eat animation plays
    expect(s.hand.some((c) => c.cardId === 'consume')).toBe(false); // consumed
  });

  it("Consume's created Fodder carries the run-wide Fodder enchant — the Demon gains the buffed value", () => {
    const fred = CARD_INDEX.fred!;
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'd', cardId: 'maw', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false }],
      cardBuffs: { fred: { attack: 2, health: 2 } }, // Fodder enchanted +2/+2 run-wide (Ritualist/Bane)
      hand: [{ uid: 'cn', cardId: 'consume', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'cn', targetUid: 'd' });
    const demon = s.board.find((c) => c.uid === 'd')!;
    // eats a (1+2)/(1+2) Fodder → +3/+3 (maw's fodder multiplier is 1)
    expect([demon.attack, demon.health]).toEqual([3 + fred.attack + 2, 3 + fred.health + 2]);
  });

  it('offerBuyStats: a consumed offer is worth its CURRENT value — base + run buff + per-offer buff + Staff of Guel, BASE ×2 golden; held keeps its body', () => {
    const meal = CARD_INDEX.gnash!;
    const base: RunState = {
      ...createRun(1),
      cardBuffs: { gnash: { attack: 1, health: 1 } }, // persistent run enchant (Ritualist-style)
      tavernBuyBonus: { atk: 2, hp: 2 }, // Staff of Guel (applies to non-Fodder offers)
    };
    // base + run buff (1/1) + per-offer buff (3/4) + Staff of Guel (2/2)
    expect(offerBuyStats(base, { uid: 'o', cardId: 'gnash', atk: 3, hp: 4 }))
      .toEqual({ attack: meal.attack + 1 + 3 + 2, health: meal.health + 1 + 4 + 2 });
    // golden offer (Golden Touch) doubles the BASE only — the run/offer/Staff buffs stay single (like a gild)
    expect(offerBuyStats(base, { uid: 'o', cardId: 'gnash', atk: 3, hp: 4, golden: true }))
      .toEqual({ attack: meal.attack * 2 + 1 + 3 + 2, health: meal.health * 2 + 1 + 4 + 2 });
    // a Displacement-stashed (held) minion is worth its full preserved body, untouched by run/offer buffs
    expect(offerBuyStats(base, { uid: 'o', cardId: 'gnash', held: { uid: 'h', cardId: 'gnash', tribe: 'beast', attack: 40, health: 30, keywords: [], golden: false } }))
      .toEqual({ attack: 40, health: 30 });
  });

  it('Golden Touch makes a random tavern minion Golden; it buys in Golden with doubled stats', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 5,
      shop: [{ uid: 's1', cardId: 'sandbag' }],
      hand: [{ uid: 'gt', cardId: 'goldentouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'gt' }); // untargeted — gilds the (only) offer
    expect(s.shop[0]!.golden).toBe(true);
    s = reduce(s, { type: 'buy', uid: 's1' });
    const bought = s.hand.find((c) => c.cardId === 'sandbag')!;
    const base = CARD_INDEX.sandbag!;
    expect(bought.golden).toBe(true);
    expect([bought.attack, bought.health]).toEqual([base.attack * 2, base.health * 2]); // gild doubles the stats
  });

  it('Displacement swaps a friendly minion with a random tavern minion', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
      shop: [{ uid: 's1', cardId: 'gnash' }],
      hand: [{ uid: 'dp', cardId: 'displacement', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'dp', targetUid: 'm' });
    expect(s.board).toHaveLength(1);
    expect(s.board[0]!.cardId).toBe('gnash'); // the tavern minion swapped onto the board
    expect(s.shop.some((o) => o.cardId === 'sandbag')).toBe(true); // the displaced minion went to the tavern
    expect(s.shop.some((o) => o.cardId === 'gnash')).toBe(false); // and left it
    expect(s.hand.some((c) => c.cardId === 'displacement')).toBe(false); // consumed
  });

  it('Displacement only swaps with a tavern MINION, never a spell', () => {
    // Tavern holds a spell AND a minion — the swap must always pick the minion, never pull a spell onto the board.
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
      shop: [{ uid: 's1', cardId: 'spiritfire' }, { uid: 's2', cardId: 'gnash' }],
      hand: [{ uid: 'dp', cardId: 'displacement', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'dp', targetUid: 'm' });
    expect(s.board[0]!.cardId).toBe('gnash'); // the minion swapped in, not the spell
    expect(s.shop.some((o) => o.cardId === 'spiritfire')).toBe(true); // the spell stayed in the tavern, untouched
  });

  it('Displacement fizzles (keeps the spell) when the tavern has no minion', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
      shop: [{ uid: 's1', cardId: 'spiritfire' }], // only a spell in the tavern
      hand: [{ uid: 'dp', cardId: 'displacement', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'dp', targetUid: 'm' });
    expect(s.board[0]!.cardId).toBe('sandbag'); // board unchanged — no swap
    expect(s.hand.some((c) => c.cardId === 'displacement')).toBe(true); // spell NOT consumed
  });

  it('Displacement preserves the displaced minion intact in the tavern; re-buying restores all its state', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 10,
      // a buffed + progressed minion (not base 1/1)
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 9, health: 8, keywords: ['T'], golden: false, summonBonus: 5 }],
      shop: [{ uid: 's1', cardId: 'gnash' }],
      hand: [{ uid: 'dp', cardId: 'displacement', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'dp', targetUid: 'm' });
    const offer = s.shop.find((o) => o.cardId === 'sandbag')!;
    expect(offer.held).toBeDefined();
    expect([offer.held!.attack, offer.held!.health]).toEqual([9, 8]); // full stats preserved (not reset to base)
    expect(offer.held!.summonBonus).toBe(5); // progression preserved
    s = reduce(s, { type: 'buy', uid: offer.uid }); // re-buy → returns intact
    const back = s.hand.find((c) => c.cardId === 'sandbag')!;
    expect([back.attack, back.health]).toEqual([9, 8]);
    expect(back.summonBonus).toBe(5);
    expect(back.keywords).toContain('T');
    expect(s.embers).toBe(7); // 10 − minionCost (3)
  });

  it('Displacement does NOT fire the swapped-in minion’s Battlecry', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
      shop: [{ uid: 's1', cardId: 'alley' }], // Alleycat — Battlecry: summon a Stray
      hand: [{ uid: 'dp', cardId: 'displacement', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'dp', targetUid: 'm' });
    expect(s.board[0]!.cardId).toBe('alley'); // swapped in
    expect(s.board.some((c) => c.cardId === 'stray')).toBe(false); // its Battlecry did NOT fire (no Stray)
  });

  it('Darah Displace swaps a friendly minion with a random tavern minion (spends the charge)', () => {
    let s: RunState = {
      ...createRun(1, 'darah'),
      heroReady: true,
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
      shop: [{ uid: 's1', cardId: 'gnash' }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'm' });
    expect(s.board[0]!.cardId).toBe('gnash'); // swapped in
    expect(s.shop.some((o) => o.cardId === 'sandbag')).toBe(true); // displaced to the tavern
    expect(s.heroReady).toBe(false); // once-per-turn charge spent
  });

  it('Displacement cannot target a golden minion — fizzles, keeps the spell in hand', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: true }],
      shop: [{ uid: 's1', cardId: 'gnash' }],
      hand: [{ uid: 'dp', cardId: 'displacement', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'dp', targetUid: 'm' });
    expect(s.board[0]!.cardId).toBe('sandbag'); // unchanged — no swap
    expect(s.board[0]!.golden).toBe(true);
    expect(s.shop.some((o) => o.cardId === 'gnash')).toBe(true); // tavern minion stayed
    expect(s.hand.some((c) => c.cardId === 'displacement')).toBe(true); // spell NOT consumed
  });

  it('Darah Displace cannot target a golden minion — no swap, charge not spent', () => {
    let s: RunState = {
      ...createRun(1, 'darah'),
      heroReady: true,
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: true }],
      shop: [{ uid: 's1', cardId: 'gnash' }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'm' });
    expect(s.board[0]!.cardId).toBe('sandbag'); // unchanged — golden can't be displaced
    expect(s.shop.some((o) => o.cardId === 'gnash')).toBe(true); // tavern minion stayed
    expect(s.heroReady).toBe(true); // no-op → charge NOT spent
  });

  it('Spell Cart fills the tavern with (distinct) spells; the next roll restocks minions', () => {
    let s: RunState = {
      ...createRun(1),
      tier: 5,
      embers: 99,
      shop: [{ uid: 'm1', cardId: 'sandbag' }, { uid: 'm2', cardId: 'gnash' }],
      hand: [{ uid: 'sc', cardId: 'spellcart', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sc' }); // untargeted cast
    expect(s.shop.length).toBeGreaterThan(0);
    expect(s.shop.every((o) => CARD_INDEX[o.cardId]?.spell)).toBe(true); // every offer is now a spell
    const ids = s.shop.map((o) => o.cardId);
    expect(new Set(ids).size).toBe(ids.length); // distinct
    s = reduce(s, { type: 'roll' });
    expect(s.shop.some((o) => !CARD_INDEX[o.cardId]?.spell)).toBe(true); // minions again
  });

  it('a spell offer from Spell Cart buys into the hand at its own cost', () => {
    let s: RunState = {
      ...createRun(1),
      tier: 5,
      embers: 10,
      shop: [{ uid: 'sp1', cardId: 'spiritfire' }], // a spell offer in the minion row (cost 2)
      hand: [],
    };
    s = reduce(s, { type: 'buy', uid: 'sp1' });
    expect(s.hand.some((c) => c.cardId === 'spiritfire')).toBe(true); // bought into hand
    expect(s.shop.some((o) => o.cardId === 'spiritfire')).toBe(false); // left the shop
    expect(s.embers).toBe(8); // 10 − Spirit Fire's cost (2)
  });

  it('Ember Pouch gains an Ember when cast (net-neutral after its 1 cost)', () => {
    let s: RunState = { ...createRun(1), embers: 5, spell: { uid: 'sp', cardId: 'emberpouch' } };
    s = reduce(s, { type: 'buy', uid: s.spell!.uid }); // pay 1 → 4
    expect(s.embers).toBe(4);
    const pouch = s.hand.find((c) => c.cardId === 'emberpouch')!;
    s = reduce(s, { type: 'play', uid: pouch.uid }); // untargeted → gain 1 → 5
    expect(s.embers).toBe(5);
    expect(s.hand.some((c) => c.cardId === 'emberpouch')).toBe(false); // consumed
    expect(s.spellsCast).toBe(1);
  });

  it('Bulwark gives a friend +0/+1 and Taunt', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 5,
      spell: { uid: 'sp', cardId: 'bulwark' },
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    const spell = s.hand.find((c) => c.cardId === 'bulwark')!;
    s = reduce(s, { type: 'play', uid: spell.uid, targetUid: 'm' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([2, 3]); // +0/+1
    expect(m.keywords).toContain('T'); // and Taunt
  });

  // --- Spell batch -------------------------------------------------------------------------------

  const castOnBoard = (spellId: string, board: BoardCard[], targetUid?: string, hero?: string): RunState => {
    let s: RunState = {
      ...createRun(1, hero), embers: 0, shop: [], board,
      hand: [{ uid: 'sp', cardId: spellId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', ...(targetUid ? { targetUid } : {}) });
    return s;
  };
  const oneNeutral = (uid = 'm', over: Partial<BoardCard> = {}): BoardCard => ({
    uid, cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false, ...over,
  });

  it('Shatter gives +2/+4 and toggles Taunt (grant when absent, remove when present)', () => {
    // No Taunt → Shatter grants it.
    const grant = castOnBoard('shatter', [oneNeutral('m', { keywords: [] })], 'm');
    const a = grant.board.find((c) => c.uid === 'm')!;
    expect([a.attack, a.health]).toEqual([4, 6]); // 2/2 + 2/4
    expect(a.keywords).toContain('T');
    // Already Taunt → Shatter strips it (and still applies the stats).
    const strip = castOnBoard('shatter', [oneNeutral('m', { keywords: ['T'] })], 'm');
    const b = strip.board.find((c) => c.uid === 'm')!;
    expect([b.attack, b.health]).toEqual([4, 6]);
    expect(b.keywords).not.toContain('T');
  });

  it('Shatter (target: any) buffs a tavern offer, and the buff bakes in when bought', () => {
    let s: RunState = {
      ...createRun(1), embers: 5, board: [],
      shop: [{ uid: 'o', cardId: 'alley' }],
      hand: [{ uid: 'sp', cardId: 'shatter', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o' });
    const offer = s.shop.find((o) => o.uid === 'o')!;
    expect([offer.atk, offer.hp]).toEqual([2, 4]); // Shatter's +2/+4 folded onto the ShopCard
    expect(offer.keywords).toContain('T'); // + Taunt
    s = reduce(s, { type: 'buy', uid: 'o' }); // Alleycat 1/1 + the offer buff bakes in
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health]).toEqual([3, 5]); // 1/1 + 2/4
    expect(bought.keywords).toContain('T');
  });

  it('Front to Back escalates linearly (+2/+2, then +4/+4, …) and the run tally climbs', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [oneNeutral('m', { attack: 0, health: 1 })],
      hand: [
        { uid: 's1', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
        { uid: 's2', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'm' }); // +2/+2
    expect(s.frontToBackBonus).toBe(2);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([2, 3]);
    s = reduce(s, { type: 'play', uid: 's2', targetUid: 'm' }); // +(2+2) = +4/+4
    expect(s.frontToBackBonus).toBe(4);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([6, 7]); // 2/3 + 4/4
  });

  it('Front to Back adds spell power (Rohan) on top of its flat escalation', () => {
    // Rohan's amplify is +1 at wave 1 → first cast is +(step 2 + escalation 0 + power 1) = +3/+3.
    const s = castOnBoard('fronttoback', [oneNeutral('m', { attack: 0, health: 1 })], 'm', 'rohan');
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([3, 4]); // 0/1 + 3/3
    expect(s.frontToBackBonus).toBe(2); // the escalation climbs by a FLAT 2 (spell power is not part of it)
    // The grant (slot 0) scales with escalation + spell power; the improvement (slot 1) is a constant +2/+2
    // — spell power is a flat add to every grant, NOT a per-cast increment, so it never inflates "Improve".
    expect(spellDisplayText('fronttoback', 0, 0)).toBe('Give a minion **+2/+2**. Improve this by **+2/+2**.'); // base — no boost
    // +1 spell power, no escalation: grant 2+0+1=3 green; improve stays +2/+2.
    expect(spellDisplayText('fronttoback', 1, 0)).toBe('Give a minion **{{+3/+3}}**. Improve this by **+2/+2**.');
    // Escalated (+2) AND +1 power: grant 2+2+1=5 green; improve stays +2/+2.
    expect(spellDisplayText('fronttoback', 1, 2)).toBe('Give a minion **{{+5/+5}}**. Improve this by **+2/+2**.');
    // Escalated only (+4), no power: grant 2+4=6 green; improve stays +2/+2.
    expect(spellDisplayText('fronttoback', 0, 4)).toBe('Give a minion **{{+6/+6}}**. Improve this by **+2/+2**.');
  });

  it('Front to Back: two casts grow by a flat +2 step (plus flat spell power on each grant)', () => {
    // +1 spell power (Rohan), two casts on the same target. Cast 1: +(2+0+1)=+3/+3. Cast 2: +(2+2+1)=+5/+5.
    // The escalation step is a flat +2 (spell power adds +1 to each grant, but not to the step).
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], heroId: 'rohan',
      board: [oneNeutral('m', { attack: 0, health: 0 })],
      hand: [
        { uid: 's1', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
        { uid: 's2', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'm' });
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([3, 3]); // +3/+3
    s = reduce(s, { type: 'play', uid: 's2', targetUid: 'm' });
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([8, 8]); // 3/3 + 5/5 (grew by step 2 + power 1)
  });

  it('Mana Font raises max Mana permanently but does NOT refill current Mana', () => {
    let s: RunState = {
      ...createRun(1), embers: 2, maxEmbers: 4, shop: [],
      hand: [{ uid: 'sp', cardId: 'manafont', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.maxEmbers).toBe(5); // +1 permanent
    expect(s.embers).toBe(2); // current Mana untouched — no top-up this turn
  });

  it('Nadja Mana Font (hero power): untargeted, +1 max Mana, costs 3 Mana', () => {
    let s: RunState = { ...createRun(1, 'nadja'), embers: 5, maxEmbers: 5 };
    expect(s.heroReady).toBe(true);
    s = reduce(s, { type: 'heroPower' }); // no uid — the power is untargeted
    expect(s.maxEmbers).toBe(6); // +1 permanent max
    expect(s.embers).toBe(2); // spent 3 to use it
    expect(s.heroReady).toBe(false); // once per turn
  });

  it('Nadja Mana Font (hero power): no-op when you cannot afford 3 Mana', () => {
    const s: RunState = { ...createRun(1, 'nadja'), embers: 2, maxEmbers: 5 };
    const after = reduce(s, { type: 'heroPower' });
    expect(after.maxEmbers).toBe(5); // unchanged — couldn't afford the cost
    expect(after.embers).toBe(2);
  });

  it('Mana Font pushes max Mana PAST the cap (uncapped scaling)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, maxEmbers: CONFIG.embersCap, shop: [],
      hand: [{ uid: 'sp', cardId: 'manafont', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.maxEmbers).toBe(CONFIG.embersCap + 1); // no cap on Mana Font — it scales past the normal ceiling
  });

  it('Refreshing Texts banks 2 free rerolls, spent before Mana on a roll', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, freeRolls: 0, shop: [],
      hand: [{ uid: 'sp', cardId: 'refreshtexts', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.freeRolls).toBe(2);
    s = reduce(s, { type: 'roll' }); // free — no Mana charged
    expect(s.freeRolls).toBe(1);
    expect(s.embers).toBe(0);
    s = reduce(s, { type: 'roll' });
    expect(s.freeRolls).toBe(0);
    expect(s.embers).toBe(0); // still free
    const before = s.embers;
    const noMana = reduce(s, { type: 'roll' }); // no free rolls + 0 Mana → no-op
    expect(noMana).toBe(s);
    expect(noMana.embers).toBe(before);
  });

  it('Eyes of Aresmar gilds a Tier-4-or-lower minion (doubling BASE only), but no-ops above Tier 4', () => {
    // Target Dummy is Tier 1 → gilds. At base (0/4) that's 0/8, golden flag set.
    const ok = castOnBoard('aresmar', [oneNeutral('m', { attack: 0, health: 4, keywords: ['T'] })], 'm');
    const low = ok.board.find((c) => c.uid === 'm')!;
    expect(low.golden).toBe(true);
    expect([low.attack, low.health]).toEqual([0, 8]); // base 0/4 doubled
    // A BUFFED target gilds its BASE only: a Target Dummy (base 0/4) buffed to 6/10 gilds to 0/8 + the +6/+6
    // buff = 6/14 — NOT 12/20 (the old double-everything bug the owner hit with Eyes).
    const buffed = castOnBoard('aresmar', [oneNeutral('m', { attack: 6, health: 10, buffs: [{ source: 'Fortify', attack: 6, health: 6, count: 1 }] })], 'm');
    const b = buffed.board.find((c) => c.uid === 'm')!;
    expect([b.attack, b.health]).toEqual([6, 14]);
    // Grim is Tier 6 → above the cap → the spell is consumed but does nothing.
    const no = castOnBoard('aresmar', [{ uid: 'g', cardId: 'grim', tribe: 'beast', attack: 7, health: 1, keywords: [], golden: false }], 'g');
    const high = no.board.find((c) => c.uid === 'g')!;
    expect(high.golden).toBe(false);
    expect([high.attack, high.health]).toEqual([7, 1]); // untouched
  });

  it('Tribes Choice conjures a minion of the target’s tribe to hand', () => {
    // Target a Beast → the conjured card must be a Beast (up to the tavern tier).
    let s: RunState = {
      ...createRun(1), tier: 6, embers: 0, shop: [],
      board: [{ uid: 'b', cardId: 'gnash', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [{ uid: 'sp', cardId: 'tribeschoice', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'b' });
    const conjured = s.hand.find((c) => c.cardId !== 'tribeschoice');
    expect(conjured).toBeDefined();
    const def = CARD_INDEX[conjured!.cardId]!;
    expect(def.tribe === 'beast' || def.tribe2 === 'beast').toBe(true);
    expect(def.tier).toBeLessThanOrEqual(6);
  });

  it('Tribes Choice fizzles on a neutral target (neutral is no longer a type)', () => {
    // Target a neutral minion → no type to roll, so nothing is conjured (the spell still casts + leaves hand).
    let s: RunState = {
      ...createRun(1), tier: 6, embers: 0, shop: [],
      board: [{ uid: 'n', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false }],
      hand: [{ uid: 'sp', cardId: 'tribeschoice', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'n' });
    expect(s.hand.find((c) => c.cardId !== 'tribeschoice')).toBeUndefined(); // no neutral handed out
  });

  it('Summon Stone conjures a random Tier 1 minion to hand', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'summonstone', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    const conjured = s.hand.find((c) => c.cardId !== 'summonstone');
    expect(conjured).toBeDefined();
    expect(CARD_INDEX[conjured!.cardId]!.tier).toBe(1);
  });

  it('Frontdrake conjures a Dragon every 3 turns (End-of-Turn counter)', () => {
    // Pool seeded with one Dragon (Hoard Cleric) + dragon active, so the cadence grant has a draw.
    const frontdrake: BoardCard = { uid: 'f', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false };
    const s: RunState = {
      ...createRun(1), tier: 6, hand: [], board: [frontdrake],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool: { cleric: 5 },
    };
    applyEndOfTurn(s); // turn 1 — counts, no grant
    applyEndOfTurn(s); // turn 2 — counts, no grant
    expect(s.hand.length).toBe(0);
    applyEndOfTurn(s); // turn 3 — cadence hits → conjure a Dragon
    expect(s.hand.map((c) => c.cardId)).toEqual(['cleric']);
    expect(frontdrake.eotTick).toBe(3);
  });

  it('a Frontdrake triple keeps the furthest-along cadence (a copy about to proc keeps that timing)', () => {
    // Three Frontdrakes at eotTick 2 / 1 / 0 → the golden inherits the cadence POSITION of the furthest
    // (2, one shy of every:3), so this turn's End of Turn still lands the cadence.
    let s: RunState = {
      ...createRun(1), tier: 6, embers: 3, board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool: { cleric: 5 },
      hand: [
        { uid: 'f1', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false, eotTick: 2 },
        { uid: 'f2', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false, eotTick: 1 },
      ],
      shop: [{ uid: 'x', cardId: 'frontdrake' }], // fresh — eotTick 0
    };
    s = reduce(s, { type: 'buy', uid: 'x' }); // the 3rd copy completes the triple
    const golden = s.hand.find((c) => c.cardId === 'frontdrake' && c.golden)!;
    expect(golden.eotTick).toBe(2); // furthest-along position kept (not reset, not the absolute max-of-something-else)
    // And this turn's End of Turn lands the cadence (2 → 3 → conjure a Dragon).
    s = { ...s, board: [golden], hand: [] };
    applyEndOfTurn(s);
    expect(golden.eotTick).toBe(3);
    expect(s.hand.map((c) => c.cardId)).toContain('cleric');
  });

  it('Den Mother buffs each Beast you PLAY, improving the buff by +1/+1 each time (recruit)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'mb', cardId: 'mamabear', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false }],
      hand: [
        { uid: 'b1', cardId: 'pack', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }, // Deathrattle only — no summon on play
        { uid: 'b2', cardId: 'grim', tribe: 'beast', attack: 7, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'b1' }); // first Beast played → +1/+1
    expect(s.board.find((c) => c.uid === 'b1')!.attack).toBe(2 + 1); // 3
    s = reduce(s, { type: 'play', uid: 'b2' }); // next Beast → buff improved to +2/+2
    expect(s.board.find((c) => c.uid === 'b2')!.attack).toBe(7 + 2); // 9
  });

  it('a universalTribe token (Chaos Attachment) receives a tribe summon-buff (Mama Bear)', () => {
    // Regression: the Chaos hero-power token counts as EVERY tribe, so playing it must trigger
    // tribe-gated summon buffs. Before the fix the recruit factories only matched tribe/tribe2, so the
    // token was silently skipped (the reported "didn't get Mama Bear stats" bug).
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'mb', cardId: 'mamabear', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false },
      ],
      hand: [
        { uid: 'sym', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M'], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'sym' }); // standalone play (no weld target) → Mama Bear's summon buff fires
    const sym = s.board.find((c) => c.uid === 'sym')!;
    // Den Mother (+1/+1) treats the universalTribe token as a Beast. (Kennelmaster's Beast buff is now a
    // Start-of-Combat aura, so it no longer fires when a minion is summoned in the shop.)
    expect(sym.attack).toBe(1 + 1); // 2
    expect(sym.health).toBe(1 + 1); // 2
  });

  it('a Mama Bear triple picks up the accrual at its current value — no reset, no double', () => {
    // Two Mama Bears at summonBonus 6 and 3 + a fresh one → the golden keeps the HIGHEST (6), NOT the
    // Kennelmaster-style sum (which would be 9) and NOT 0. Its bigger +6/+6 step comes from being golden.
    let s: RunState = {
      ...createRun(1), embers: 3,
      hand: [
        { uid: 'm1', cardId: 'mamabear', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false, summonBonus: 6 },
        { uid: 'm2', cardId: 'mamabear', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false, summonBonus: 3 },
      ],
      shop: [{ uid: 'x', cardId: 'mamabear' }],
    };
    s = reduce(s, { type: 'buy', uid: 'x' }); // the 3rd copy completes the triple
    const golden = s.hand.find((c) => c.cardId === 'mamabear' && c.golden)!;
    expect(golden.summonBonus).toBe(6); // current value preserved, not 9 (sum) or 0 (reset)
    // Played, it grants (base 1 + accrual 6) × 2 golden = +14/+14 to the next Beast played.
    s = reduce(s, { type: 'play', uid: golden.uid }); // golden Mama Bear → board
    s = { ...s, hand: [{ uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'a' });
    expect(s.board.find((c) => c.uid === 'a')!.attack).toBe(1 + 14);
  });

  it('Sea Urchin Battlecry offers a Discover of Beasts only (up to tavern tier)', () => {
    // Pool mixes Beasts + a Dragon (cleric); the Discover must offer only Beasts.
    let s: RunState = {
      ...createRun(1), tier: 4, embers: 0, shop: [], board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      pool: { alley: 5, pack: 5, kennel: 5, raptor: 5, cleric: 5 },
      hand: [{ uid: 'u', cardId: 'seaurchin', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'u' });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) {
      const def = CARD_INDEX[id]!;
      expect(def.tribe === 'beast' || def.tribe2 === 'beast').toBe(true); // cleric (Dragon) is never offered
    }
  });

  it('a pending Discover blocks other board actions until resolved (B2 minimize safety)', () => {
    const base: RunState = {
      ...createRun(1), embers: 5, discover: ['alley', 'raptor', 'pack'],
      shop: [{ uid: 'x', cardId: 'gnash' }],
    };
    // Buy / roll are no-ops while a Discover is pending (same state ref) — inspecting can't invalidate it.
    expect(reduce(base, { type: 'roll' })).toBe(base);
    expect(reduce(base, { type: 'buy', uid: 'x' })).toBe(base);
    // The resolving action still works.
    const s = reduce(base, { type: 'discover', index: 0 });
    expect(s.discover).toBeUndefined();
    expect(s.hand.some((c) => c.cardId === 'alley')).toBe(true);
  });

  it('Sea Urchin cannot Discover itself', () => {
    // Pool is all Beasts INCLUDING Sea Urchin — the Discover must still never offer another Sea Urchin.
    let s: RunState = {
      ...createRun(1), tier: 4, embers: 0, shop: [], board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      pool: { seaurchin: 5, raptor: 5, gryphon: 5, alley: 5, pack: 5 },
      hand: [{ uid: 'u', cardId: 'seaurchin', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'u' });
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.discover).not.toContain('seaurchin'); // the source is excluded from its own Discover
  });

  it('card-driven Discover weighs every tier evenly; only the golden reward (topTierFirst) peeks the top tier', () => {
    // Tier-2 beasts (kennel/pack/shaper) give a 3-card top tier; alley (T1) is the low control. The OLD
    // floor-walk showed ONLY the top tier; now a card Discover weighs every tier ≤ target evenly.
    const pool = { kennel: 9, pack: 9, shaper: 9, alley: 9 };
    const base: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool,
    };
    // Sea Urchin at tavern tier 2 → uniform up to 2: the Tier-1 beast IS offered across seeds.
    let urchinLowSeen = false;
    for (let seed = 1; seed <= 50 && !urchinLowSeen; seed++) {
      const s = reduce(
        { ...base, tier: 2, rngCursor: seed, hand: [{ uid: 'u', cardId: 'seaurchin', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false }] },
        { type: 'play', uid: 'u' },
      );
      if ((s.discover ?? []).includes('alley')) urchinLowSeen = true;
    }
    expect(urchinLowSeen).toBe(true); // a Tier-1 beast IS offered → the high-tier floor-walk is gone

    // Golden/triple reward (discoverspell) at tier 1 → peeks tier 2 (topTierFirst): never drops below the top.
    const goldTiers = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      const s = reduce(
        { ...base, tier: 1, rngCursor: seed, hand: [{ uid: 'd', cardId: 'discoverspell', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] },
        { type: 'play', uid: 'd' },
      );
      for (const id of s.discover ?? []) goldTiers.add(CARD_INDEX[id]!.tier);
    }
    expect([...goldTiers]).toEqual([2]); // exclusively the peeked (top) tier — the reward keeps its bias
  });

  it('Tribe Portal Discovers a minion of your most common board tribe', () => {
    // Board is Beast-dominant (2 Beasts vs 1 Dragon) → the Discover offers only Beasts.
    let s: RunState = {
      ...createRun(1), tier: 4, embers: 0, shop: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      pool: { alley: 5, pack: 5, cleric: 5, knit: 5 },
      board: [
        { uid: 'b1', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b2', cardId: 'pack', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'd1', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 4, keywords: [], golden: false },
      ],
      hand: [{ uid: 'sp', cardId: 'tribeportal', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) {
      const def = CARD_INDEX[id]!;
      expect(def.tribe === 'beast' || def.tribe2 === 'beast').toBe(true);
    }
  });

  it('Corpse Board Discovers a Deathrattle minion only', () => {
    // Pool mixes Deathrattle minions (pack, manasaber) with non-Deathrattle ones (alley, cleric).
    let s: RunState = {
      ...createRun(1), tier: 5, embers: 0, shop: [], board: [],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'],
      pool: { pack: 5, manasaber: 5, alley: 5, cleric: 5 },
      hand: [{ uid: 'sp', cardId: 'corpseboard', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) {
      const def = CARD_INDEX[id]!;
      expect(def.effects.some((e) => e.on === 'onDeath' && e.do.startsWith('deathrattle'))).toBe(true);
    }
  });

  it('Perfect Vision sets a friendly minion to 20/20', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 4, keywords: ['T'], golden: false }],
      hand: [{ uid: 'sp', cardId: 'perfectvision', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm' });
    const t = s.board.find((c) => c.uid === 'm')!;
    expect([t.attack, t.health]).toEqual([20, 20]);
  });

  it('Apples (Choose One → this shop) buffs the current offers +1/+3, and a buy bakes it in', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, frozen: false,
      shop: [{ uid: 'x', cardId: 'alley' }, { uid: 'y', cardId: 'pack' }],
      hand: [{ uid: 'sp', cardId: 'apples', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    s = reduce(s, { type: 'chooseOne', index: 0 }); // "Give the shop +1/+3"
    expect(s.shop.every((o) => o.atk === 1 && o.hp === 3)).toBe(true); // both offers buffed
    s = { ...s, embers: 10 };
    s = reduce(s, { type: 'buy', uid: 'x' }); // Alleycat 1/1 + Apples +1/+3
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health]).toEqual([2, 4]);
  });

  it('Fleeting Vigor banks a Start-of-Combat buff applied to the next combat, then spent', () => {
    let s: RunState = {
      ...createRun(1), embers: 0,
      hand: [{ uid: 'sp', cardId: 'fleetingvigor', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.fleetingVigor).toEqual({ attack: 2, health: 1 }); // banked
    s = reduce(s, { type: 'faceOmen' }); // combat: the buff lands on the combat board, then is spent
    const startSandbag = s.lastCombat?.initial.player.find((m) => m.cardId === 'sandbag');
    expect([startSandbag?.attack, startSandbag?.health]).toEqual([3, 2]); // 1/1 + Fleeting Vigor 2/1
    expect(s.fleetingVigor).toEqual({ attack: 0, health: 0 }); // spent after the fight
    // …and it's telegraphed as a Start-of-Combat narration (otherwise the pre-baked buff is invisible).
    expect(s.lastCombat?.events[0]).toMatchObject({ type: 'sc', text: expect.stringContaining('Fleeting Vigor') });
  });

  it('undeadBuyBonus applies the run-wide undead Attack bonus to any new Undead (universalTribe counts)', () => {
    const s = { ...createRun(1), undeadBuyAtk: 3 };
    expect(undeadBuyBonus(s, CARD_INDEX.spore!)).toBe(3); // Undead
    expect(undeadBuyBonus(s, CARD_INDEX.symbioticattachment!)).toBe(3); // universalTribe counts as Undead
    expect(undeadBuyBonus(s, CARD_INDEX.kennel!)).toBe(0); // Beast — not Undead
  });

  it('a Discovered Undead carries the run-wide undead Attack bonus (undeadBuyAtk), like a buy', () => {
    let s: RunState = { ...createRun(1), undeadBuyAtk: 3, discover: ['spore'] };
    s = reduce(s, { type: 'discover', index: 0 });
    const got = s.hand.find((c) => c.cardId === 'spore')!;
    expect(got.attack).toBe(2 + 3); // Sporeling base 2 + undeadBuyAtk 3
    expect(got.health).toBe(1); // Health unaffected (Sporeling is a 2/1)
  });

  it("Sporeling's Deathrattle procs on every Battlecry you trigger in the shop — and counts toward the Deathrattle tally", () => {
    let s: RunState = createRun(1);
    s.board = [{ uid: 'sp', cardId: 'spore', tribe: 'undead', attack: 2, health: 1, keywords: [], golden: false }];
    s.hand = [{ uid: 'h1', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }];
    s = reduce(s, { type: 'play', uid: 'h1' }); // Alleycat's Battlecry fires → Sporeling's rattle procs
    const spore = s.board.find((c) => c.uid === 'sp')!;
    expect([spore.attack, spore.health]).toEqual([3, 2]); // fed the board (incl. itself) +1/+1
    expect(s.board.find((c) => c.cardId === 'alley')!.attack).toBe(2); // Alleycat got it too (1 → 2)
    expect(s.deathrattlesTriggered).toBe(1); // the proc counts as a played Deathrattle (feeds Grim)
  });

  it("Heckbinder's Fodder aura is LIVE: new Fodder reads +1/+2 while it's on the board, back to base once it's gone", () => {
    const s: RunState = createRun(1);
    s.board = [{ uid: 'hb', cardId: 'heckbinder', tribe: 'demon', attack: 3, health: 3, keywords: ['M'], golden: false }];
    expect(cardBuff(s, 'fred')).toEqual({ attack: 1, health: 2 });
    // Golden doubles; a welded host (fodderAuraBonus) counts the same way.
    s.board = [{ uid: 'host', cardId: 'drone', tribe: 'mech', attack: 5, health: 5, keywords: [], golden: false, fodderAuraBonus: { attack: 1, health: 2 } }];
    expect(cardBuff(s, 'fred')).toEqual({ attack: 1, health: 2 });
    s.board = []; // aura leaves with the body — future Fodder is back to base
    expect(cardBuff(s, 'fred')).toEqual({ attack: 0, health: 0 });
    expect(cardBuff(s, 'alley')).toEqual({ attack: 0, health: 0 }); // non-Fodder never reads the aura
  });

  it('Chaos hero power grants a token at the START of every 5th turn, tripling it on the spot', () => {
    let s: RunState = {
      ...createRun(1, 'chaos'),
      wave: 4, phase: 'combat', // resolveCombat → advanceCombat → wave 5 → Chaos grants the 3rd token
      board: [],
      hand: [
        { uid: 't1', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M'], golden: false },
        { uid: 't2', cardId: 'symbioticattachment', tribe: 'neutral', attack: 1, health: 1, keywords: ['M'], golden: false },
      ],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.wave).toBe(5); // start of the 5th turn
    expect(s.hand.filter((c) => c.cardId === 'symbioticattachment' && c.golden)).toHaveLength(1); // 3 → 1 golden, now
    expect(s.hand.filter((c) => c.cardId === 'symbioticattachment' && !c.golden)).toHaveLength(0);
    expect(s.chaosGrantSeq).toBeGreaterThan(0); // the grant bumped the UI fly-in signal
    expect(s.chaosGrantUid).toBeDefined();
  });

  it('Chaos hero power does NOT grant on a non-5th turn', () => {
    let s: RunState = {
      ...createRun(1, 'chaos'),
      wave: 5, phase: 'combat', // → wave 6, not a multiple of 5 → no grant
      board: [], hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.wave).toBe(6);
    expect(s.hand.filter((c) => c.cardId === 'symbioticattachment')).toHaveLength(0);
  });

  it('Sergeant: every recruit Attack-gain improves its Deathrattle HP grant (+2 per event, golden +4)', () => {
    // The reported bug: two Forsaken Weavers buffing Sergeant on a spell cast are two separate Attack-gain
    // events, so they improve the Deathrattle twice — not once, and not by the Attack amount.
    const sgt: BoardCard = { uid: 'sg', cardId: 'sergeant', tribe: 'undead', attack: 6, health: 6, keywords: [], golden: false };
    addBuff(sgt, 'Forsaken Weaver', 2, 0); // 1st Weaver → +2
    expect(sgt.hpGrantBonus).toBe(2);
    addBuff(sgt, 'Forsaken Weaver', 2, 0); // 2nd Weaver, same spell → +2 again
    expect(sgt.hpGrantBonus).toBe(4);
    addBuff(sgt, 'Mend', 0, 3); // a Health-only buff is NOT an Attack-gain → no improvement
    expect(sgt.hpGrantBonus).toBe(4);
    // Golden Sergeant improves +4 per event.
    const golden: BoardCard = { uid: 'g', cardId: 'sergeant', tribe: 'undead', attack: 12, health: 12, keywords: [], golden: true };
    addBuff(golden, 'Deathswarmer', 1, 0);
    expect(golden.hpGrantBonus).toBe(4);
  });

  it('Staff of Guel permanently buffs every minion bought from the tavern (+2/+2), not Discovered ones', () => {
    let s: RunState = {
      ...createRun(1), embers: 4, board: [],
      shop: [{ uid: 'x', cardId: 'alley' }],
      hand: [{ uid: 'sp', cardId: 'staffofguel', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.tavernBuyBonus).toEqual({ atk: 2, hp: 2 }); // run-wide buy buff, set on cast
    expect(spellDisplayText('staffofguel', 1)).toContain('{{+3/+3}}'); // +2/+2 + 1 spell power, live
    s = reduce(s, { type: 'buy', uid: 'x' }); // Alleycat 1/1 + the run-wide buy buff
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health]).toEqual([3, 3]); // 1/1 + 2/2
    // A Discovered minion does NOT get it (tavern purchases only).
    s = reduce({ ...s, discover: ['sandbag'] }, { type: 'discover', index: 0 });
    const disc = s.hand.find((c) => c.cardId === 'sandbag')!;
    expect([disc.attack, disc.health]).toEqual([0, 4]); // Target Dummy base (0/4), unbuffed
  });

  it('Staff of Guel also enchants Fodder run-wide (Demons eat bigger Fodder); no double on a bought Fodder', () => {
    let s: RunState = {
      ...createRun(1), embers: 4,
      board: [{ uid: 'bf', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: ['FD'], golden: false }],
      shop: [{ uid: 'f', cardId: 'fred' }],
      hand: [{ uid: 'sp', cardId: 'staffofguel', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    // The Fodder type is enchanted run-wide (+2/+2), like Ritualist's End-of-Turn buff…
    expect(s.cardBuffs?.fred).toEqual({ attack: 2, health: 2 });
    // …and Fodder already on the board gets it immediately.
    const onBoard = s.board.find((c) => c.cardId === 'fred')!;
    expect([onBoard.attack, onBoard.health]).toEqual([3, 3]);
    // Buying a Fodder applies the Staff buff ONCE (via the enchant), not twice.
    s = reduce(s, { type: 'buy', uid: 'f' });
    const bought = s.hand.find((c) => c.cardId === 'fred')!;
    expect([bought.attack, bought.health]).toEqual([3, 3]); // 1/1 + 2/2, not +4/+4
  });

  it('Undead Army completes a triple (its conjured copies are checked, not just minion plays)', () => {
    let s: RunState = {
      ...createRun(1), tier: 3, embers: 0, board: [],
      tribes: ['undead'],
      pool: { spore: 5 }, // the only buyable Undead → Undead Army deterministically conjures 2 Sporelings
      hand: [
        { uid: 'k', cardId: 'spore', tribe: 'undead', attack: 5, health: 1, keywords: [], golden: false },
        { uid: 'sp', cardId: 'undeadarmy', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    // 1 in hand + 2 conjured = 3 → combine into one golden Sporeling, no stragglers left.
    const all = [...s.hand, ...s.board];
    expect(all.find((c) => c.cardId === 'spore' && c.golden)).toBeDefined();
    expect(all.filter((c) => c.cardId === 'spore' && !c.golden)).toHaveLength(0);
  });

  it('Sprout Discovers a Tier 1 minion; Help Wanted Discovers a Battlecry minion', () => {
    const sprout = castOnBoard('sprout', []);
    expect(sprout.discover).toBeDefined();
    for (const id of sprout.discover!) expect(CARD_INDEX[id]!.tier).toBe(1);
    let s: RunState = {
      ...createRun(1), tier: 6, embers: 0, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'helpwanted', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.discover).toBeDefined();
    for (const id of s.discover!) {
      const def = CARD_INDEX[id]!;
      expect(def.effects.some((e) => e.on === 'onPlay') || !!def.chooseOne).toBe(true); // a Battlecry
    }
  });

  it('Lantern of Souls raises the run-wide Undead attack bonus', () => {
    const s = castOnBoard('lanternofsouls', []);
    expect(s.undeadAttackBonus).toBe(3);
    expect(s.undeadHealthBonus).toBe(0); // no spell power → a pure Attack buff
    // A second cast stacks.
    const s2 = castOnBoard('lanternofsouls', []);
    let t: RunState = { ...s2, hand: [{ uid: 'sp2', cardId: 'lanternofsouls', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    t = reduce(t, { type: 'play', uid: 'sp2' });
    expect(t.undeadAttackBonus).toBe(6);
  });

  it('Lantern of Souls scales with spell power (+4/+1 at +1) and the card shows it', () => {
    // Rohan amplifies +1 at wave 1 → base +3 Attack becomes +4 Attack / +1 Health.
    const s = castOnBoard('lanternofsouls', [], undefined, 'rohan');
    expect(s.undeadAttackBonus).toBe(4);
    expect(s.undeadHealthBonus).toBe(1);
    // The card text reflects the live value (green {{…}}); the base shows just +3 Attack.
    expect(spellDisplayText('lanternofsouls', 0)).toContain('+3 Attack');
    expect(spellDisplayText('lanternofsouls', 1)).toContain('{{+4/+1}}');
  });

  it('Mend heals the hero 5 (capped at max Resolve, no overheal)', () => {
    // Below max → heals 5.
    let s: RunState = {
      ...createRun(1), resolve: 20, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'mend', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' }); // untargeted
    expect(s.resolve).toBe(25); // 20 + 5
    expect(s.hand.some((c) => c.cardId === 'mend')).toBe(false); // consumed
    // Near max → can't overheal past the hero's max Resolve (30).
    let t: RunState = {
      ...createRun(1), resolve: 28, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'mend', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    t = reduce(t, { type: 'play', uid: 'sp' });
    expect(t.resolve).toBe(getHero(t.heroId).resolve); // clamped to 30, not 33
  });

  it('Undead Army conjures 2 copies of one random Undead to the hand', () => {
    // A run always has all 5 tribes active today, so Undead is buyable.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'sp', cardId: 'undeadarmy', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    const conjured = s.hand.filter((c) => c.cardId !== 'undeadarmy');
    expect(conjured.length).toBe(2); // two copies
    expect(conjured[0]!.cardId).toBe(conjured[1]!.cardId); // …of the SAME card
    const def = CARD_INDEX[conjured[0]!.cardId]!;
    expect(def.tribe === 'undead' || def.tribe2 === 'undead').toBe(true); // an Undead
  });

  it('Lasso steals a random minion from the tavern into the hand (fizzles on an empty shop)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, board: [],
      shop: [{ uid: 'o1', cardId: 'alley' }, { uid: 'o2', cardId: 'alley' }],
      hand: [{ uid: 'sp', cardId: 'lasso', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    expect(s.shop.length).toBe(1); // one offer was removed from the tavern
    expect(s.hand.some((c) => c.cardId === 'alley')).toBe(true); // …and landed in the hand (free)
    expect(s.hand.some((c) => c.cardId === 'lasso')).toBe(false); // the spell is consumed
    // Empty shop → the spell fizzles gracefully (consumed, nothing stolen).
    let empty: RunState = {
      ...createRun(1), embers: 0, board: [], shop: [],
      hand: [{ uid: 'sp', cardId: 'lasso', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    empty = reduce(empty, { type: 'play', uid: 'sp' });
    expect(empty.hand.some((c) => c.cardId === 'lasso')).toBe(false); // consumed, no crash
  });

  it('hero power can buff a tavern offer, and the buff is baked in when bought', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 3,
      heroReady: true,
      board: [],
      shop: [{ uid: 'x', cardId: 'alley' }], // Alleycat is a 1/1
    };
    s = reduce(s, { type: 'heroPower', uid: 'x' }); // Fortify a *tavern* minion
    expect([s.shop[0]?.atk, s.shop[0]?.hp]).toEqual([1, 1]);
    expect(s.heroReady).toBe(false);
    s = reduce(s, { type: 'buy', uid: 'x' });
    const bought = s.hand.find((c) => c.cardId === 'alley')!;
    expect([bought.attack, bought.health]).toEqual([2, 2]); // 1/1 + the Fortify buff
  });

  it('spells never triple (three copies stay separate)', () => {
    const spell = (uid: string) => ({ uid, cardId: 'spiritfire', tribe: 'neutral' as const, attack: 0, health: 1, keywords: [], golden: false });
    let s: RunState = { ...createRun(1), embers: 3, hand: [spell('a'), spell('b'), spell('c')], shop: [{ uid: 'x', cardId: 'alley' }] };
    s = reduce(s, { type: 'buy', uid: 'x' }); // buying a minion runs checkTriples
    expect(s.hand.filter((c) => c.cardId === 'spiritfire').length).toBe(3); // not combined
    expect(s.hand.some((c) => c.cardId === 'spiritfire' && c.golden)).toBe(false);
  });

  it('spells cannot be sold', () => {
    const s: RunState = { ...createRun(1), embers: 0, hand: [{ uid: 'a', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    const after = reduce(s, { type: 'sell', uid: 'a' });
    expect(after.embers).toBe(0); // no +1
    expect(after.hand.some((c) => c.cardId === 'spiritfire')).toBe(true); // stays in hand
  });

  const threeSandbags = (): RunState => {
    const mk = (uid: string): BoardCard => ({
      uid, cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false,
    });
    let s: RunState = { ...createRun(1), embers: 0, board: [], shop: [], hand: [mk('a'), mk('b'), mk('c')] };
    s = reduce(s, { type: 'play', uid: 'a' });
    s = reduce(s, { type: 'play', uid: 'b' });
    s = reduce(s, { type: 'play', uid: 'c' }); // the third completes the triple
    return s;
  };

  it('three copies combine into a golden 2x minion in hand — no Discover yet', () => {
    const s = threeSandbags();
    const golden = [...s.board, ...s.hand].find((c) => c.golden);
    expect(golden?.cardId).toBe('sandbag');
    expect(golden?.attack).toBe(0); // 0 × 2
    expect(golden?.health).toBe(8); // 4 × 2 (base stats doubled)
    expect([...s.board, ...s.hand].filter((c) => c.cardId === 'sandbag' && !c.golden).length).toBe(0);
    expect(s.discover).toBeUndefined(); // the Discover comes from the spell, not the triple
  });

  it('playing the golden grants a Discover spell; playing that spell opens the Discover', () => {
    let s = threeSandbags();
    const golden = s.hand.find((c) => c.golden)!;
    s = reduce(s, { type: 'play', uid: golden.uid }); // golden → board + Discover spell to hand
    const spell = s.hand.find((c) => c.cardId === 'discoverspell');
    expect(spell).toBeDefined();
    expect(s.discover).toBeUndefined(); // not until the spell is played
    s = reduce(s, { type: 'play', uid: spell!.uid });
    expect(s.discover?.length).toBe(3);
    expect(s.hand.some((c) => c.cardId === 'discoverspell')).toBe(false); // spell consumed, no board slot
  });

  it('Discover adds the chosen card to the hand and clears the offer', () => {
    let s: RunState = { ...createRun(1), hand: [], discover: ['frontdrake', 'cleric', 'weaver'] };
    s = reduce(s, { type: 'discover', index: 1 });
    expect(s.hand.some((c) => c.cardId === 'cleric')).toBe(true);
    expect(s.discover).toBeUndefined();
  });

  it('a golden minion bakes its Battlecry in at doubled magnitude', () => {
    let s: RunState = {
      ...createRun(1),
      embers: 0,
      shop: [],
      board: [{ uid: 'w', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: ['SC'], golden: false }],
      hand: [{ uid: 'gc', cardId: 'cleric', tribe: 'dragon', attack: 2, health: 6, keywords: [], golden: true }],
    };
    s = reduce(s, { type: 'play', uid: 'gc' }); // golden Hoard Cleric: Dragons +4/+6 (doubled)
    expect(s.board.find((c) => c.cardId === 'frontdrake')?.attack).toBe(6); // 2 + 4
    expect(s.board.find((c) => c.cardId === 'frontdrake')?.health).toBe(7); // 1 + 6
  });

  it('a run draws 5 distinct tribes and the shop only offers them (+ neutral)', () => {
    const s = createRun(7);
    expect(s.tribes.length).toBe(5);
    expect(new Set(s.tribes).size).toBe(5);
    const allowed = new Set<string>([...s.tribes, 'neutral']);
    for (const offer of s.shop) {
      expect(allowed.has(CARD_INDEX[offer.cardId]!.tribe)).toBe(true);
    }
  });

  it('selling adds embers even at the turn income (no max-embers cap)', () => {
    let s: RunState = {
      ...createRun(1), // embers 3 == maxEmbers 3 (start of turn)
      board: [{ uid: 'x', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false }],
    };
    expect(s.embers).toBe(3);
    s = reduce(s, { type: 'sell', uid: 'x' });
    expect(s.embers).toBe(4); // +1, uncapped (previously capped at maxEmbers → bug)
  });

  it('Hoarder sells for a flat 2 Gold (golden 4)', () => {
    let s: RunState = {
      ...createRun(1), wave: 5, embers: 0,
      board: [{ uid: 'h', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'sell', uid: 'h' });
    expect(s.embers).toBe(2);
    let g: RunState = {
      ...createRun(1), wave: 5, embers: 0,
      board: [{ uid: 'h', cardId: 'hoarder', tribe: 'neutral', attack: 4, health: 4, keywords: [], golden: true }],
    };
    g = reduce(g, { type: 'sell', uid: 'h' });
    expect(g.embers).toBe(4); // golden sells for 4
  });

  it("Hoarder's Battlecry banks bonus Gold for next turn (golden 2×)", () => {
    let s: RunState = {
      ...createRun(1), embers: 0, board: [],
      hand: [{ uid: 'h', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'h' });
    expect(s.bonusEmbersNextTurn).toBe(1); // banked +1 for next turn
    let g: RunState = {
      ...createRun(1), embers: 0, board: [],
      hand: [{ uid: 'h', cardId: 'hoarder', tribe: 'neutral', attack: 4, health: 4, keywords: [], golden: true }],
    };
    g = reduce(g, { type: 'play', uid: 'h' });
    expect(g.bonusEmbersNextTurn).toBe(2); // golden banks 2
  });

  it('Robin banks +1 Gold for NEXT turn per minion sold (stacks; other heroes do not)', () => {
    let s: RunState = {
      ...createRun(1, 'robin'),
      board: [
        { uid: 'a', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'c', cardId: 'frontdrake', tribe: 'dragon', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    for (const uid of ['a', 'b', 'c']) s = reduce(s, { type: 'sell', uid });
    expect(s.bonusEmbersNextTurn).toBe(3); // each sell banks +1 for next turn (consumed + reset at turn start, like Hoarder)
    // A non-Robin hero banks nothing from the same sells.
    let w: RunState = {
      ...createRun(1, 'warden'),
      board: [{ uid: 'a', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
    };
    w = reduce(w, { type: 'sell', uid: 'a' });
    expect(w.bonusEmbersNextTurn ?? 0).toBe(0);
  });

  it('Black Belt Brian Battlecry Discovers a spell — 3 spell ids offered', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'bb', cardId: 'blackbelt', tribe: 'neutral', attack: 3, health: 5, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'bb' });
    expect(s.discover?.length).toBe(3);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.spell).toBe(true); // every offer is a spell
    expect(new Set(s.discover).size).toBe(3); // distinct
  });

  it('a golden Black Belt Brian Discovers TWICE — each pick re-opens a fresh spell Discover', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [{ uid: 'bb', cardId: 'blackbelt', tribe: 'neutral', attack: 6, health: 10, keywords: [], golden: true }],
    };
    s = reduce(s, { type: 'play', uid: 'bb' });
    expect(s.discover?.length).toBe(3); // the first Discover is open
    expect(s.discoverQueue).toEqual([{ kind: 'spell' }]); // a second spell Discover is queued
    s = reduce(s, { type: 'discover', index: 0 }); // pick the first spell
    expect(s.discover?.length).toBe(3); // the second Discover opened from the queue
    expect(s.discoverQueue).toEqual([]); // queue drained
    s = reduce(s, { type: 'discover', index: 0 }); // pick the second spell
    expect(s.discover).toBeUndefined(); // both done
    const handSpells = s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell);
    expect(handSpells.length).toBe(2); // two spells Discovered into the hand
  });

  it('Drakko the Drummer makes a played Black Belt Brian Discover 2 spells (sequential, via the queue)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'bb', cardId: 'blackbelt', tribe: 'neutral', attack: 3, health: 5, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'bb' }); // Brian's Battlecry fires twice (Drakko) → 2 spell Discovers
    expect(s.discover?.length).toBe(3); // first Discover open
    expect(s.discoverQueue).toEqual([{ kind: 'spell' }]); // second Discover queued by the doubled Battlecry
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover?.length).toBe(3); // second Discover opened from the queue
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover).toBeUndefined(); // both resolved
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell).length).toBe(2); // two spells in hand
  });

  it('a golden Black Belt Brian + Drakko the Drummer Discovers 4 spells', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'bb', cardId: 'blackbelt', tribe: 'neutral', attack: 6, health: 10, keywords: [], golden: true }],
    };
    // Fires twice (Drakko); each fire queues 1 base + 1 golden spell Discover → 4 total (1 open, 3 queued).
    s = reduce(s, { type: 'play', uid: 'bb' });
    expect(s.discover?.length).toBe(3);
    expect(s.discoverQueue?.length).toBe(3);
    for (let i = 0; i < 4 && s.discover; i++) s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover).toBeUndefined();
    expect(s.discoverQueue).toEqual([]);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell).length).toBe(4);
  });

  it('a Battlecry minion fires twice with a Drummer — observable via Soulfeeder queuing 2 Fodder', () => {
    // Soulfeeder's Battlecry queues 1 Fodder; with a Drakko the Drummer out it fires twice → 2 Fodder.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
      pendingTavern: [],
    };
    s = reduce(s, { type: 'play', uid: 'sf' });
    expect((s.pendingTavern ?? []).filter((id) => id === 'fred')).toHaveLength(2);
  });

  it('Yazzus does NOT multiply Help Wanted — Discover spells are untargeted (one Discover, nothing queued)', () => {
    const cast = (yazzGolden?: boolean): RunState => {
      const s: RunState = {
        ...createRun(1), embers: 0, shop: [], tier: 4,
        board: [{ uid: 'y', cardId: 'yazzus', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: !!yazzGolden }],
        hand: [{ uid: 'hw', cardId: 'helpwanted', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      };
      return reduce(s, { type: 'play', uid: 'hw' });
    };
    for (const golden of [false, true]) {
      const s = cast(golden);
      expect(s.discover?.length).toBe(3); // a single Discover opens
      expect(s.discoverQueue ?? []).toEqual([]); // nothing queued — Yazzus only multiplies aimed spells
    }
  });

  it('Yazzus does NOT multiply Triple Reward — it opens only one Discover', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], tier: 3,
      board: [{ uid: 'y', cardId: 'yazzus', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: true }],
      hand: [{ uid: 'tr', cardId: 'discoverspell', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'tr' });
    expect(s.discover?.length).toBe(3); // a single Discover opens
    expect(s.discoverQueue ?? []).toEqual([]); // nothing queued — Triple Reward isn't a player-cast spell
  });

  it('a golden Hoarder (from a triple) sells for a flat 4 Gold', () => {
    let s: RunState = {
      ...createRun(1), wave: 1, embers: 0, shop: [],
      hand: [
        { uid: 'h1', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'h2', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'h3', cardId: 'hoarder', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'h1' }); // playing the 3rd completes the triple → golden Hoarder
    const golden = [...s.board, ...s.hand].find((c) => c.cardId === 'hoarder' && c.golden)!;
    const after = reduce({ ...s, embers: 0 }, { type: 'sell', uid: golden.uid });
    expect(after.embers).toBe(4); // golden sells for a flat 4
  });

  it('Yazzus makes an aimed spell resolve twice (golden: three times)', () => {
    // Spirit Fire (+4/+4, targeted) with a Yazzus present resolves 2× → +8/+8 on the target.
    const board = (yazzGolden?: boolean): BoardCard[] => [
      { uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
      { uid: 'y', cardId: 'yazzus', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: !!yazzGolden },
    ];
    const cast = (yazzGolden?: boolean): RunState => {
      let s: RunState = {
        ...createRun(1), embers: 0, shop: [], board: board(yazzGolden),
        hand: [{ uid: 'sf', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      };
      s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'm' });
      return s;
    };
    const two = cast(false).board.find((c) => c.uid === 'm')!;
    expect([two.attack, two.health]).toEqual([9, 9]); // 1/1 + (4/4 × 2)
    const three = cast(true).board.find((c) => c.uid === 'm')!;
    expect([three.attack, three.health]).toEqual([13, 13]); // 1/1 + (4/4 × 3)
    expect(cast(false).spellsCast).toBe(2); // the effect (and tally) repeats per Yazzus multiplier
  });

  it('Yazzus does NOT multiply an untargeted board spell (Growth resolves once)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 'y', cardId: 'yazzus', tribe: 'neutral', attack: 6, health: 8, keywords: [], golden: false },
      ],
      hand: [{ uid: 'g', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([4, 5]); // 1/1 + 3/4 ONCE — Yazzus ignores untargeted spells
    expect(s.spellsCast).toBe(1);
  });

  it('without a Yazzus a spell resolves once', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
      hand: [{ uid: 'g', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'g' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([4, 5]); // 1/1 + 3/4 once
  });

  it('tripling combines current stats (top two) and unions keywords', () => {
    const mk = (uid: string, attack: number, health: number, keywords: ('V' | 'T')[]): BoardCard => ({
      uid, cardId: 'sandbag', tribe: 'neutral', attack, health, keywords, golden: false,
    });
    // 1/1 Venomous · 2/3 · 1/3  →  3/6 Venomous
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], board: [],
      hand: [mk('a', 1, 1, ['V']), mk('b', 2, 3, []), mk('c', 1, 3, [])],
    };
    s = reduce(s, { type: 'play', uid: 'a' });
    s = reduce(s, { type: 'play', uid: 'b' });
    s = reduce(s, { type: 'play', uid: 'c' });
    const golden = [...s.board, ...s.hand].find((c) => c.golden)!;
    expect(golden.attack).toBe(3); // 2 + 1 (top two attacks)
    expect(golden.health).toBe(6); // 3 + 3 (top two healths)
    expect(golden.keywords).toContain('V'); // keyword retained across the combine
  });

  it('Drakko the Drummer makes a Battlecry fire twice', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'al', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'al' }); // Alleycat Battlecry: summon a Stray → fires twice
    expect(s.board.filter((c) => c.cardId === 'stray').length).toBe(2);
  });

  it('a golden Drakko triples Battlecries', () => {
    // Hoard Cleric (+2/+3 to Dragons, incl. self) — avoids token triples. Golden Drakko fires it 3×.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [{ uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: true }],
      hand: [{ uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'c' });
    const cleric = s.board.find((c) => c.cardId === 'cleric');
    expect([cleric?.attack, cleric?.health]).toEqual([7, 12]); // 1/3 + 3×(+2/+3)
  });

  it('multiple Drakkos do NOT stack (still fires twice)', () => {
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [],
      board: [
        { uid: 'd1', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false },
        { uid: 'd2', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false },
      ],
      hand: [{ uid: 'al', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'al' }); // two Drakkos → still 2x → 2 Strays
    expect(s.board.filter((c) => c.cardId === 'stray').length).toBe(2);
  });

  it('Drakko hero quest: buying 5 Battlecry minions grants Drakko the Drummer (once per game)', () => {
    let s: RunState = { ...createRun(1, 'drakko'), embers: 99, board: [], hand: [], shop: [] };
    const buyBattlecry = (n: number): void => {
      const uid = `x${n}`;
      s = { ...s, shop: [{ uid, cardId: 'alley' }] }; // Alleycat has a Battlecry
      s = reduce(s, { type: 'buy', uid });
    };
    for (let i = 0; i < 4; i++) buyBattlecry(i);
    expect(s.drakkoBuys).toBe(4);
    expect(s.hand.some((c) => c.cardId === 'drummer')).toBe(false); // not yet
    expect(s.heroPowerSpent).toBe(false);
    buyBattlecry(4); // the 5th completes the quest
    expect(s.drakkoBuys).toBe(5);
    expect(s.hand.some((c) => c.cardId === 'drummer')).toBe(true); // Drakko the Drummer granted
    expect(s.heroPowerSpent).toBe(true); // quest done — stops counting
    // A non-Battlecry buy (Target Dummy) never advances the quest.
    let t: RunState = { ...createRun(1, 'drakko'), embers: 99, board: [], hand: [], shop: [{ uid: 'd', cardId: 'sandbag' }] };
    t = reduce(t, { type: 'buy', uid: 'd' });
    expect(t.drakkoBuys).toBe(0);
  });

  it('a full scripted run is deterministic end to end', () => {
    expect(serialize(playToEnd(999))).toEqual(serialize(playToEnd(999)));
  });

  it('a run reaches game over with a valid score', () => {
    const s = playToEnd(3);
    expect(s.phase).toBe('gameover');
    expect(s.wave).toBeGreaterThanOrEqual(1);
    expect(s.resolve).toBe(0);
  });

  it('save/load round-trips', () => {
    const s = createRun(5);
    expect(serialize(deserialize(serialize(s)))).toEqual(serialize(s));
  });

  it('deserialize heals a save missing later-added fields (heal-by-construction)', () => {
    // Simulate an OLD save: strip fields that shipped after it was written. The former hand-maintained
    // heal list missed exactly these — a missing `history` crashed the HUD's runRecord, a missing
    // `spellCostMod` NaN'd Gold on the first spell buy. The defaults-merge must zero them all.
    const s = createRun(11);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.history;
    delete raw.tavernBuyBonus;
    delete raw.spellCostMod;
    delete raw.freeRolls;
    delete raw.runDamage;
    delete raw.runProcs;
    const healed = deserialize(JSON.stringify(raw));
    expect(healed.history).toEqual([]);
    expect(healed.tavernBuyBonus).toEqual({ atk: 0, hp: 0 });
    expect(healed.spellCostMod).toBe(0);
    expect(healed.freeRolls).toBe(0);
    expect(runRecord(healed)).toEqual({ wins: 0, losses: 0, draws: 0 }); // used to throw
    // What the save DID carry wins the merge…
    expect(healed.seed).toBe(11);
    expect(healed.board).toEqual(s.board);
    expect(healed.shop).toEqual(s.shop);
    // …and a spell buy produces real (non-NaN) Gold.
    if (healed.spell) {
      const after = reduce(healed, { type: 'buy', uid: healed.spell.uid });
      expect(Number.isNaN(after.embers)).toBe(false);
    }
  });

  it('deserialize does NOT grant a pre-Armor save the hero armor (armor heals to 0, not the default)', () => {
    const s = createRun(11);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.armor;
    delete raw.maxArmor;
    const healed = deserialize(JSON.stringify(raw));
    expect(healed.armor).toBe(0);
    expect(healed.maxArmor).toBe(0);
  });

  it('addBuff accumulates per source with a count, and ignores keyword-only (0/0) grants', () => {
    const card: BoardCard = { uid: 'x', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false };
    addBuff(card, 'Spirit Fire', 3, 3);
    addBuff(card, 'Spirit Fire', 3, 3);
    addBuff(card, 'Karwind', 1, 2);
    addBuff(card, 'Plaguebringer', 0, 0); // keyword-only → not listed as a stat buff
    expect([card.attack, card.health]).toEqual([2 + 6 + 1, 1 + 6 + 2]);
    expect(card.buffs).toEqual([
      { source: 'Spirit Fire', attack: 6, health: 6, count: 2 },
      { source: 'Karwind', attack: 1, health: 2, count: 1 },
    ]);
  });

  it('Hunter procs from a recruit Attack-gain (Warden Fortify) → +Health to the board', () => {
    let s: RunState = {
      ...createRun(1), tier: 3, heroReady: true,
      board: [
        { uid: 'h', cardId: 'hunter', tribe: 'dragon', attack: 5, health: 7, keywords: [], golden: false },
        { uid: 'a', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'heroPower', uid: 'h' }); // Fortify +3/+3 → Hunter gains Attack → +2 Health to the board
    const hunter = s.board.find((c) => c.uid === 'h')!;
    const ally = s.board.find((c) => c.uid === 'a')!;
    expect(hunter.attack).toBe(5 + 3); // Fortify +3 Attack (tier 3)
    expect(ally.health).toBe(3 + 2); // Hunter's onGainAttack → +2 Health
    expect(hunter.health).toBe(7 + 3 + 2); // Fortify +3 Health + Hunter's own +2 (it buffs the whole board incl. itself)
  });

  it('Hunter procs from ANY shop Attack gain — a Growth spell, not just Fortify (boundary dispatch)', () => {
    let s: RunState = {
      ...createRun(1), embers: 10, shop: [],
      hand: [{ uid: 'g', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      board: [
        { uid: 'h', cardId: 'hunter', tribe: 'dragon', attack: 5, health: 7, keywords: [], golden: false },
        { uid: 'a', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'g' }); // Growth: +3/+4 to the board → Hunter gains Attack → +2 Health to all
    const hunter = s.board.find((c) => c.uid === 'h')!;
    const ally = s.board.find((c) => c.uid === 'a')!;
    expect(hunter.attack).toBe(5 + 3); // Growth +3 Attack
    expect(ally.health).toBe(3 + 4 + 2); // Growth +4 + Hunter's onGainAttack +2
    expect(hunter.health).toBe(7 + 4 + 2); // Growth +4 + Hunter's own +2
  });

  it('a shop action with no board Attack gain does NOT proc Hunter (Mend heals the hero)', () => {
    let s: RunState = {
      ...createRun(1), embers: 10, shop: [], resolve: 1,
      // Mend heals the hero — it raises no board minion's Attack, so Hunter's reactor must stay silent.
      hand: [{ uid: 'm', cardId: 'mend', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      board: [
        { uid: 'h', cardId: 'hunter', tribe: 'dragon', attack: 5, health: 7, keywords: [], golden: false },
        { uid: 'a', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'm' });
    const hunter = s.board.find((c) => c.uid === 'h')!;
    const ally = s.board.find((c) => c.uid === 'a')!;
    expect(ally.health).toBe(3); // no Attack gain anywhere → Hunter added nothing
    expect(hunter.health).toBe(7); // unchanged
  });

  it('hero Fortify records its source on the buffed minion (inspect breakdown)', () => {
    let s: RunState = {
      ...createRun(7),
      heroReady: true,
      board: [{ uid: 'd', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'd' });
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([3, 2]);
    expect(s.board[0]!.buffs).toEqual([{ source: 'Fortify', attack: 1, health: 1, count: 1 }]);
  });

  it('Karwind flame-flags the Dragons its battlecry-trigger buffs', () => {
    let s: RunState = {
      ...createRun(7),
      embers: 99,
      board: [
        { uid: 'k', cardId: 'karwind', tribe: 'dragon', attack: 2, health: 12, keywords: [], golden: false },
        { uid: 'd', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'p', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'p' }); // Hoard Cleric's Battlecry → triggers Karwind
    expect(s.karwindFlash).toContain('d');
    expect(s.karwindFlash).toContain('k');
    const dragon = s.board.find((c) => c.uid === 'd')!;
    expect(dragon.buffs?.some((b) => b.source === 'Karwind')).toBe(true);
  });

  it('a triple merges the buff breakdown onto the golden (so it itemizes in inspect)', () => {
    const buffed = (uid: string): BoardCard => {
      const c: BoardCard = { uid, cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false };
      addBuff(c, 'Spirit Fire', 3, 3); // each copy +3/+3 before combining
      return c;
    };
    let s: RunState = { ...createRun(1), board: [], hand: [buffed('a'), buffed('b'), buffed('c')] };
    s = reduce(s, { type: 'play', uid: 'a' }); // 3rd copy lands → triple combines
    const golden = [...s.board, ...s.hand].find((c) => c.golden);
    expect(golden).toBeDefined();
    expect([golden!.attack, golden!.health]).toEqual([6, 14]); // base 0/4 ×2 = 0/8, + merged +6/+6
    expect(golden!.buffs).toEqual([{ source: 'Spirit Fire', attack: 6, health: 6, count: 2 }]);
  });

  it('createRun stocks the finite pool with the per-tier quantities', () => {
    const s = createRun(11);
    // Some copies of a T1 neutral may already sit in the opening shop, so pool-remaining + offered = stock.
    const inShop = s.shop.filter((o) => o.cardId === 'sandbag').length;
    expect((s.pool['sandbag'] ?? 0) + inShop).toBe(POOL_QUANTITIES[1]);
    expect(CONFIG.maxTier).toBe(6);
  });

  it('Discover (Triple Reward) only offers cards with copies left — respects the finite pool', () => {
    // Exhaust the pool to a single eligible card; a Discover then can't offer any 0-copy card — the bug
    // that let you exceed a card's stock (e.g. an 8th Grim from a 6-copy pool).
    let s: RunState = { ...createRun(1), tier: 6 };
    const keep = Object.keys(s.pool).find((id) => (CARD_INDEX[id]?.tier ?? 0) >= 5) ?? Object.keys(s.pool)[0]!;
    for (const id of Object.keys(s.pool)) s.pool[id] = id === keep ? 5 : 0;
    s.hand = [{ uid: 'd', cardId: 'discoverspell', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }];
    s = reduce(s, { type: 'play', uid: 'd' });
    expect(s.discover).toBeDefined();
    for (const id of s.discover!) expect(s.pool[id]).toBeGreaterThan(0); // never an exhausted (0-copy) card
  });

  it('the finite pool conserves copies across buy / reroll / sell', () => {
    // Total pooled copies = remaining pool + pooled cards held in shop / hand / board (golden = 3).
    // Buying, rerolling and selling only move copies between those buckets — the total is invariant.
    const poolTotal = (s: RunState): number => {
      const owned = (c: BoardCard): number => (c.cardId in s.pool ? (c.golden ? 3 : 1) : 0);
      let total = Object.values(s.pool).reduce((a, b) => a + b, 0);
      for (const o of s.shop) if (o.cardId in s.pool) total += 1;
      for (const c of s.hand) total += owned(c);
      for (const c of s.board) total += owned(c);
      return total;
    };
    let s = createRun(7);
    const initial = poolTotal(s);
    if (s.shop[0]) s = reduce({ ...s, embers: 50 }, { type: 'buy', uid: s.shop[0].uid });
    expect(poolTotal(s)).toBe(initial); // buy: shop → hand
    for (let i = 0; i < 6; i++) s = reduce({ ...s, embers: 50 }, { type: 'roll' });
    expect(poolTotal(s)).toBe(initial); // reroll: discarded offers return, fresh ones drawn
    if (s.hand[0]) s = reduce(s, { type: 'sell', uid: s.hand[0].uid });
    expect(poolTotal(s)).toBe(initial); // sell: held copy → pool
  });

  it('selling a minion returns its copy to the shared pool (a golden returns three)', () => {
    let s: RunState = {
      ...createRun(3),
      board: [{ uid: 'x', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false }],
    };
    const before = s.pool['sandbag'] ?? 0;
    s = reduce(s, { type: 'sell', uid: 'x' });
    expect(s.pool['sandbag']).toBe(before + 1);

    let g: RunState = {
      ...createRun(3),
      board: [{ uid: 'g', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 8, keywords: ['T'], golden: true }],
    };
    const gBefore = g.pool['sandbag'] ?? 0;
    g = reduce(g, { type: 'sell', uid: 'g' });
    expect(g.pool['sandbag']).toBe(gBefore + 3);
  });

  it('a card with no copies left is never offered; a fully exhausted pool offers nothing', () => {
    let s = createRun(5);
    // Drain every pooled card to 0 except the neutral Target Dummy (always T1-eligible).
    const drained: Record<string, number> = {};
    for (const id of Object.keys(s.pool)) drained[id] = id === 'sandbag' ? 5 : 0;
    s = { ...s, pool: drained, shop: [], tier: 1 };
    for (let r = 0; r < 8; r++) {
      s = reduce({ ...s, embers: 50 }, { type: 'roll' });
      expect(s.shop.length).toBeGreaterThan(0);
      for (const offer of s.shop) expect(offer.cardId).toBe('sandbag'); // only the stocked card appears
    }
    const empty: Record<string, number> = {};
    for (const id of Object.keys(s.pool)) empty[id] = 0;
    s = reduce({ ...s, pool: empty, shop: [], embers: 50 }, { type: 'roll' });
    expect(s.shop.length).toBe(0); // nothing left → no offers conjured from an empty pool
  });

  it('faceOmen computes deterministic outcome odds (win/draw/lose sum to 1)', () => {
    const setup = (): RunState => ({
      ...createRun(42),
      phase: 'recruit',
      embers: 0,
      shop: [],
      board: [
        { uid: 'a', cardId: 'gnash', tribe: 'beast', attack: 6, health: 6, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 2, health: 4, keywords: ['C'], golden: false },
      ],
    });
    const odds = reduce(setup(), { type: 'faceOmen' }).lastCombat!.odds!;
    expect(odds).toBeDefined();
    expect(odds.win + odds.draw + odds.lose).toBeCloseTo(1, 6);
    expect(odds.win).toBeGreaterThanOrEqual(0);
    expect(odds.lose).toBeGreaterThanOrEqual(0);
    // Deterministic: the same seed + wave re-derives identical odds (own RNG stream).
    expect(reduce(setup(), { type: 'faceOmen' }).lastCombat!.odds).toEqual(odds);
    // Average loss damage: 0 when nothing lost, otherwise a positive, round-capped mean.
    expect(odds.avgLossDamage).toBeGreaterThanOrEqual(0);
    if (odds.lose > 0) expect(odds.avgLossDamage).toBeLessThanOrEqual(lossDamageCap(1));
    else expect(odds.avgLossDamage).toBe(0);
  });
});

describe('hero powers (@game/sim)', () => {
  const mk = (uid: string, attack: number, health: number): BoardCard => ({
    uid, cardId: 'sandbag', tribe: 'neutral', attack, health, keywords: [], golden: false,
  });

  it('createRun defaults to the Warden and accepts a chosen hero', () => {
    expect(createRun(1).heroId).toBe('warden');
    expect(createRun(1, 'indy').heroId).toBe('indy');
    expect(createRun(1).heroPowerSpent).toBe(false);
  });

  it("Warden's Fortify scales with Tavern Tier (+Tier/+Tier) and spends the wave charge", () => {
    let s: RunState = { ...createRun(1), tier: 3, heroReady: true, board: [mk('a', 2, 2)] };
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.board[0]!.attack).toBe(5); // 2 + tier(3)
    expect(s.board[0]!.health).toBe(5);
    expect(s.board[0]!.buffs).toEqual([{ source: 'Fortify', attack: 3, health: 3, count: 1 }]);
    expect(s.heroReady).toBe(false);
    // Second use this wave is rejected (charge spent).
    expect(reduce(s, { type: 'heroPower', uid: 'a' })).toBe(s);
  });

  it("Warden's Fortify on a tavern offer carries +Tier (baked in when bought)", () => {
    let s: RunState = { ...createRun(1), tier: 2, heroReady: true };
    const offerUid = s.shop[0]!.uid;
    s = reduce(s, { type: 'heroPower', uid: offerUid });
    const offer = s.shop.find((c) => c.uid === offerUid)!;
    expect(offer.atk).toBe(2);
    expect(offer.hp).toBe(2);
  });

  it("Indy's Gild doubles a minion's BASE stats (not its buffs), turns it golden, once per game", () => {
    // Target Dummy (base 0/4) buffed to 5/9 by a +5/+5. Gilding doubles the BASE only → 0/4 → 0/8, plus the
    // +5/+5 buff = 5/13 — NOT 10/18 (the old bug that doubled the whole current stat line).
    const buffed: BoardCard = { uid: 'a', cardId: 'sandbag', tribe: 'neutral', attack: 5, health: 9, keywords: [], golden: false, buffs: [{ source: 'Fortify', attack: 5, health: 5, count: 1 }] };
    let s: RunState = { ...createRun(1, 'indy'), board: [buffed, mk('b', 2, 2)] };
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.board[0]!.golden).toBe(true);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([5, 13]); // base 0/4 doubled + the +5/+5 buff kept
    expect(s.board[0]!.buffs).toEqual([{ source: 'Fortify', attack: 5, health: 5, count: 1 }, { source: 'Gild', attack: 0, health: 4, count: 1 }]);
    expect(s.heroPowerSpent).toBe(true);
    // Once per *game*: recharging the per-wave flag must not re-enable it.
    s = { ...s, heroReady: true };
    expect(reduce(s, { type: 'heroPower', uid: 'b' })).toBe(s);
  });

  it("Indy's Gild no-ops (no charge spent) on an already-golden minion", () => {
    const s: RunState = { ...createRun(1, 'indy'), board: [{ ...mk('a', 3, 4), golden: true }] };
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(after).toBe(s); // rejected → same reference
    expect(after.heroPowerSpent).toBe(false); // charge preserved for a real target
  });

  it("Myra's Pulse re-fires a friendly minion's Battlecry, once per turn (from turn 3)", () => {
    // Hoard Cleric's Battlecry buffs all your Dragons +2/+3 (includes itself).
    const cleric = (): BoardCard => ({
      uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false,
    });
    let s: RunState = { ...createRun(1, 'myra'), wave: 3, board: [cleric()] }; // Pulse unlocks turn 3
    s = reduce(s, { type: 'heroPower', uid: 'c' });
    expect(s.board[0]!.attack).toBe(3); // 1 + 2
    expect(s.board[0]!.health).toBe(6); // 3 + 3
    expect(s.board[0]!.buffs).toEqual([{ source: 'Hoard Cleric', attack: 2, health: 3, count: 1 }]);
    expect(s.heroReady).toBe(false);
    // Once per turn: a second use this wave is rejected.
    expect(reduce(s, { type: 'heroPower', uid: 'c' })).toBe(s);
  });

  it("Myra's Pulse no-ops (no charge spent) on a minion with no Battlecry", () => {
    const s: RunState = { ...createRun(1, 'myra'), wave: 3, board: [mk('a', 2, 2)] }; // sandbag = vanilla
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(after).toBe(s); // rejected → same reference
    expect(after.heroReady).toBe(true); // charge preserved
  });

  it("Myra's Pulse is locked until turn 3", () => {
    const cleric = (): BoardCard => ({
      uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false,
    });
    // Turn 1: locked — the power is rejected (no charge spent, no Battlecry replay).
    const w1: RunState = { ...createRun(1, 'myra'), wave: 1, board: [cleric()] };
    expect(reduce(w1, { type: 'heroPower', uid: 'c' })).toBe(w1);
    // Turn 3: unlocked — the Battlecry re-fires (+2/+3).
    let w3: RunState = { ...createRun(1, 'myra'), wave: 3, board: [cleric()] };
    w3 = reduce(w3, { type: 'heroPower', uid: 'c' });
    expect(w3.board[0]!.attack).toBe(3);
    expect(w3.heroReady).toBe(false);
  });

  it("Myra's Pulse can complete a triple — a replayed Battlecry's summon golden-combines", () => {
    // Two Strays already down; replaying Alleycat's Battlecry summons the third → triple → a golden
    // Stray lands in the hand. Regression: hero powers used to skip the triple check entirely, so a
    // power-summoned third copy never combined.
    const s: RunState = {
      ...createRun(1, 'myra'),
      wave: 3,
      board: [
        { uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 's1', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
        { uid: 's2', cardId: 'stray', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    // The three Strays combined → none left loose on the board…
    expect(after.board.filter((c) => c.cardId === 'stray' && !c.golden).length).toBe(0);
    // …and a golden Stray (2/2 = top-two of three 1/1s) is now in the hand.
    const golden = after.hand.find((c) => c.cardId === 'stray' && c.golden);
    expect(golden).toBeDefined();
    expect([golden!.attack, golden!.health]).toEqual([2, 2]);
    expect(after.heroReady).toBe(false); // charge spent
  });

  it("createRun seeds the run with the hero's Resolve (HP)", () => {
    for (const id of ['warden', 'indy', 'myra']) {
      const s = createRun(1, id);
      expect(s.resolve).toBe(getHero(id).resolve);
      expect(s.maxResolve).toBe(getHero(id).resolve);
    }
  });

  it("Djinn's Cadence procs a friendly minion's End of Turn now (once per turn)", () => {
    // Ritualist's End of Turn buffs every Fodder +2/+2; Fred is Fodder.
    const board = (): BoardCard[] => [
      { uid: 'r', cardId: 'ritualist', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false },
      { uid: 'f', cardId: 'fred', tribe: 'demon', attack: 1, health: 1, keywords: [], golden: false },
    ];
    let s: RunState = { ...createRun(1, 'djinn'), board: board() };
    s = reduce(s, { type: 'heroPower', uid: 'r' });
    const fred = s.board.find((c) => c.uid === 'f')!;
    expect(fred.attack).toBe(3); // 1 + 2
    expect(fred.health).toBe(3);
    expect(s.heroReady).toBe(false);
    expect(reduce(s, { type: 'heroPower', uid: 'r' })).toBe(s); // once per turn
  });

  it("Djinn's Cadence no-ops (no charge) on a minion with no End of Turn effect", () => {
    const s: RunState = { ...createRun(1, 'djinn'), board: [mk('a', 2, 2)] }; // sandbag = vanilla
    const after = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(after).toBe(s);
    expect(after.heroReady).toBe(true);
  });

  it("Djinn proccing Frontdrake pays off on the proc turn WITHOUT advancing its cadence", () => {
    // eotTick 2 = one shy of every:3, so THIS turn's End of Turn would proc. Djinn fires it now: it conjures
    // a Dragon but must NOT advance the counter (it stays 2, so the natural End of Turn still procs too).
    const f: BoardCard = { uid: 'f', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false, eotTick: 2 };
    let s: RunState = {
      ...createRun(1, 'djinn'), tier: 6, hand: [], board: [f],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool: { cleric: 5 },
    };
    s = reduce(s, { type: 'heroPower', uid: 'f' });
    expect(s.hand.map((c) => c.cardId)).toEqual(['cleric']); // granted on the proc turn
    expect(s.board.find((c) => c.uid === 'f')!.eotTick).toBe(2); // cadence NOT advanced by the Djinn replay
  });

  it("Djinn proccing Frontdrake off its proc turn grants nothing (and still doesn't advance the cadence)", () => {
    // eotTick 1 → not the proc turn. The replay grants no Dragon and leaves the counter at 1.
    const f: BoardCard = { uid: 'f', cardId: 'frontdrake', tribe: 'dragon', attack: 2, health: 1, keywords: [], golden: false, eotTick: 1 };
    let s: RunState = {
      ...createRun(1, 'djinn'), tier: 6, hand: [], board: [f],
      tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], pool: { cleric: 5 },
    };
    s = reduce(s, { type: 'heroPower', uid: 'f' });
    expect(s.hand.length).toBe(0); // off-cadence → no Dragon
    expect(s.board.find((c) => c.uid === 'f')!.eotTick).toBe(1); // unchanged
  });

  it('Rohan amplifies stat-granting spells (+1 at turn 1, scaling), hero-gated', () => {
    const cast = (heroId: string, wave: number): BoardCard => {
      let s: RunState = {
        ...createRun(1, heroId), wave, board: [mk('t', 2, 2)],
        hand: [{ uid: 'sf', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }],
      };
      s = reduce(s, { type: 'play', uid: 'sf', targetUid: 't' });
      return s.board[0]!;
    };
    // Spirit Fire = +4/+4. Rohan adds +1 at turn 1 → +5/+5 (2/2 → 7/7).
    expect(cast('rohan', 1).attack).toBe(7);
    // Scales: +2 at turn 4 → +6/+6 (→ 8/8).
    expect(cast('rohan', 4).attack).toBe(8);
    // Hero-gated: a non-Rohan gets the base +4/+4 (→ 6/6).
    expect(cast('warden', 1).attack).toBe(6);
  });

  it('Soren marks one minion for resummon (clearing any previous mark)', () => {
    let s: RunState = { ...createRun(1, 'soren'), board: [mk('a', 2, 2), mk('b', 3, 3)] };
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.board.find((c) => c.uid === 'a')!.resummon).toBe(true);
    expect(s.board.find((c) => c.uid === 'b')!.resummon ?? false).toBe(false);
    expect(s.heroReady).toBe(false);
  });

  it("Soren's mark carries into combat (marked minion destroyed + resummoned)", () => {
    // Pack Scrounger marked → at start of combat it dies (Deathrattle → 2 Pups) and a copy returns.
    let s: RunState = {
      ...createRun(1, 'soren'),
      board: [{ uid: 'p', cardId: 'pack', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'p' });
    s = reduce(s, { type: 'faceOmen' });
    const ev = s.lastCombat!.events;
    expect(ev.some((e) => e.type === 'summon' && e.minion.cardId === 'pup')).toBe(true); // Deathrattle fired
    expect(ev.some((e) => e.type === 'summon' && e.minion.cardId === 'pack')).toBe(true); // copy resummoned
  });

  it("Nadja's Mana Font raises max Mana by 1 (uncapped), spending the once-per-turn charge", () => {
    let s: RunState = { ...createRun(1, 'nadja'), maxEmbers: 4, heroReady: true };
    s = reduce(s, { type: 'heroPower', uid: 'x' }); // untargeted — uid is ignored
    expect(s.maxEmbers).toBe(5); // +1 permanent
    expect(s.heroReady).toBe(false); // charge spent (not once-per-game)
    // A second use this turn is rejected (charge spent).
    expect(reduce(s, { type: 'heroPower', uid: 'x' })).toBe(s);
    // Scales PAST the Mana cap — Nadja's Mana Font is uncapped.
    let capped: RunState = { ...createRun(1, 'nadja'), maxEmbers: CONFIG.embersCap, heroReady: true };
    capped = reduce(capped, { type: 'heroPower', uid: 'x' });
    expect(capped.maxEmbers).toBe(CONFIG.embersCap + 1); // no cap — exceeds the normal ceiling
  });

  it("Cassen's Collision banks enemy kills and grants a top-type minion at 5 (neutral isn't a type)", () => {
    // A Beast-dominant board → the grant is a Beast of your tavern tier. Neutral is NOT counted as a type.
    const beast = (uid: string): BoardCard => ({
      uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false,
    });
    // 3 banked + 2 this combat = 5 → one grant, kills back to 0.
    let s: RunState = {
      ...createRun(1, 'cassen'),
      phase: 'combat',
      cassenKills: 3,
      board: [beast('a'), beast('b')],
      hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 2, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.cassenKills).toBe(0); // 5 spent on the grant
    expect(s.hand.length).toBe(1); // a minion was conjured to the hand
    const granted = CARD_INDEX[s.hand[0]!.cardId]!;
    expect([granted.tribe, granted.tribe2]).toContain('beast'); // of the board's most common (non-neutral) tribe
    expect(granted.tier).toBeLessThanOrEqual(s.tier); // bound by your tavern tier

    // Under 5 → no grant, kills simply bank.
    let t: RunState = {
      ...createRun(1, 'cassen'),
      phase: 'combat',
      cassenKills: 0,
      board: [beast('a')],
      hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 3, initial: { player: [], enemy: [] } },
    };
    t = reduce(t, { type: 'resolveCombat' });
    expect(t.cassenKills).toBe(3); // banked, not spent
    expect(t.hand.length).toBe(0); // nothing granted yet
  });

  it("Cassen's Collision does nothing for other heroes", () => {
    let s: RunState = {
      ...createRun(1, 'warden'), // not Cassen
      phase: 'combat',
      cassenKills: 0,
      board: [{ uid: 'a', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: ['T'], golden: false }],
      hand: [],
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 9, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.cassenKills).toBe(0); // never accrues for a non-Collision hero
    expect(s.hand.length).toBe(0);
  });
});

describe('PvE course + record (@game/sim)', () => {
  // A run plays a fixed course of `courseRounds` rounds; it completes the course (→ victory) unless Resolve
  // hits 0 (→ gameover). Record is decoupled from the win condition. Drive a settled combat of a known
  // result: craft lastCombat + dispatch resolveCombat (settles + runs the terminal check). High Resolve so
  // a loss survives and the run keeps climbing.
  const winShell: CombatResult = { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
  const loseShell: CombatResult = { ...winShell, result: 'lose', playerDamage: 3 };
  const resolveWith = (over: Partial<RunState>, last: CombatResult): RunState =>
    reduce({ ...createRun(1), resolve: 100, maxResolve: 100, phase: 'combat', combatSettled: false, lastCombat: last, ...over }, { type: 'resolveCombat' });

  it('completing the final course round ends the run in victory (whatever the record)', () => {
    // The last round settles at wave === courseRounds → victory, even on a loss (Resolve survives).
    const s = resolveWith({ wave: CONFIG.courseRounds, history: Array(CONFIG.courseRounds - 1).fill('lose') }, loseShell);
    expect(s.phase).toBe('victory');
  });

  it('does NOT win early by piling up wins — the course must complete', () => {
    // Many wins but not yet the final round: a win here just advances to the next round.
    const s = resolveWith({ wave: 6, history: Array(15).fill('win') }, winShell);
    expect(s.phase).toBe('recruit');
    expect(s.wave).toBe(7);
  });

  it('the penultimate round advances, not yet victory', () => {
    const s = resolveWith({ wave: CONFIG.courseRounds - 1, history: Array(CONFIG.courseRounds - 2).fill('win') }, winShell);
    expect(s.phase).toBe('recruit');
    expect(s.wave).toBe(CONFIG.courseRounds);
  });

  it('losing with Resolve to 0 is a game over, before the course completes', () => {
    const s = resolveWith({ wave: 8, resolve: 1, maxResolve: 1, armor: 0, history: Array(5).fill('win') }, { ...loseShell, playerDamage: 5 });
    expect(s.phase).toBe('gameover');
  });

  it('Armor: heroes start with 15 (Warden / Robin / Chaos / Drakko start with 8)', () => {
    expect(getHero('warden').armor).toBe(8);
    expect(getHero('robin').armor).toBe(8);
    expect(getHero('chaos').armor).toBe(8);
    expect(getHero('drakko').armor).toBe(8);
    expect(getHero('indy').armor).toBe(15);
    expect(getHero('darah').armor).toBe(15);
    const s = createRun(1, 'indy');
    expect(s.armor).toBe(15);
    expect(s.maxArmor).toBe(15);
  });

  it('Armor absorbs a loss before Resolve; overflow chips Resolve', () => {
    // Armor 8 vs a 5-damage loss → armor 3, Resolve untouched.
    const a = resolveWith({ wave: 8, resolve: 30, maxResolve: 30, armor: 8, maxArmor: 8, history: Array(5).fill('win') }, { ...loseShell, playerDamage: 5 });
    expect(a.armor).toBe(3);
    expect(a.resolve).toBe(30);
    expect(a.phase).toBe('recruit');
    // Armor 8 vs a 12-damage loss → armor 0, 4 overflows onto Resolve.
    const b = resolveWith({ wave: 8, resolve: 30, maxResolve: 30, armor: 8, maxArmor: 8, history: Array(5).fill('win') }, { ...loseShell, playerDamage: 12 });
    expect(b.armor).toBe(0);
    expect(b.resolve).toBe(26);
  });

  it('Armor: game over needs both Armor and Resolve gone', () => {
    // Resolve 3 + Armor 5: a 4-damage hit is fully eaten by Armor → survive.
    const survive = resolveWith({ wave: 8, resolve: 3, maxResolve: 3, armor: 5, maxArmor: 5, history: Array(5).fill('win') }, { ...loseShell, playerDamage: 4 });
    expect(survive.phase).toBe('recruit');
    // A hit through both → game over.
    const dead = resolveWith({ wave: 8, resolve: 3, maxResolve: 3, armor: 5, maxArmor: 5, history: Array(5).fill('win') }, { ...loseShell, playerDamage: 20 });
    expect(dead.phase).toBe('gameover');
    expect(dead.resolve).toBe(0);
  });

  it('Armor: deserialize heals pre-Armor saves to 0', () => {
    const old: Record<string, unknown> = { ...createRun(1) };
    delete old.armor; delete old.maxArmor;
    const healed = deserialize(JSON.stringify(old));
    expect(healed.armor).toBe(0);
    expect(healed.maxArmor).toBe(0);
  });

  it('runRecord counts only the scored rounds — calibration rounds (1–2) do not count', () => {
    // history = [cal1, cal2, r3, r4, r5]; the two calibration entries are excluded from the record.
    const record = runRecord({ ...createRun(1), history: ['lose', 'lose', 'win', 'win', 'lose'] });
    expect(record).toEqual({ wins: 2, losses: 1, draws: 0 });
    expect(isCalibrationRound(2)).toBe(true);
    expect(isCalibrationRound(3)).toBe(false);
  });

  it('a new run gets the default par line', () => {
    expect(createRun(1).line).toBe(CONFIG.defaultLine);
  });

  it('lineResult grades a finished course against the par (covered / exceeded / missed / flawless)', () => {
    const scored = CONFIG.courseRounds - CONFIG.calibrationRounds; // 15
    const finish = (wins: number): RunState => ({
      ...createRun(1), line: 9, phase: 'victory',
      history: [...Array(CONFIG.calibrationRounds).fill('lose'), ...Array(wins).fill('win'), ...Array(scored - wins).fill('lose')],
    });
    expect(lineResult(finish(9)).status).toBe('covered');
    expect(lineResult(finish(11))).toMatchObject({ status: 'exceeded', delta: 2 });
    expect(lineResult(finish(7))).toMatchObject({ status: 'missed', delta: -2 });
    expect(lineResult(finish(scored)).status).toBe('flawless'); // won every scored round
  });

  it('lineResult treats covering par as a win even when the run died before the finish', () => {
    const scored = CONFIG.courseRounds - CONFIG.calibrationRounds; // 15
    // Died (Resolve 0) but had already beaten par 9 with 11 scored wins → a win, not a failure.
    const diedButCovered: RunState = {
      ...createRun(1), line: 9, phase: 'gameover',
      history: [...Array(CONFIG.calibrationRounds).fill('lose'), ...Array(11).fill('win'), ...Array(scored - 11).fill('lose')],
    };
    expect(lineResult(diedButCovered)).toMatchObject({ status: 'exceeded', delta: 2 });
  });

  it('lineResult marks a run that died under par as failed', () => {
    const s: RunState = { ...createRun(1), line: 9, phase: 'gameover', history: ['win', 'win', 'win', 'win', 'lose'] };
    expect(lineResult(s).status).toBe('failed'); // only 2 scored wins (< par 9), and died
  });
});

describe('spell stat bonus + display (@game/sim)', () => {
  it('spellStatBonus aggregates active sources (Rohan scales; others = 0)', () => {
    expect(spellStatBonus(createRun(1, 'warden'))).toBe(0);
    expect(spellStatBonus({ ...createRun(1, 'rohan'), wave: 1 })).toBe(1);
    expect(spellStatBonus({ ...createRun(1, 'rohan'), wave: 4 })).toBe(2);
  });

  it('spellDisplayText substitutes the effective value (green via {{…}}); base text otherwise', () => {
    // No bonus → unchanged base text.
    expect(spellDisplayText('spiritfire', 0)).toBe('Give a friendly minion **+4/+4**.');
    // +1 bonus → the value updates and is highlighted.
    expect(spellDisplayText('spiritfire', 1)).toBe('Give a friendly minion **{{+5/+5}}**.');
    expect(spellDisplayText('bulwark', 1)).toBe('Give a friendly minion **{{+1/+2}}** and **Taunt**.');
    // A non-stat spell (Gold Pouch) is untouched even with a bonus.
    expect(spellDisplayText('emberpouch', 2)).toBe('Gain **1 Gold**.');
  });

  it('a welded spell-power aura (spellAuraBonus) boosts spells while the host is on board', () => {
    // No spellAura card exists in the set today (Harry Botter was removed 2026-07-05), but the welded-aura
    // channel stays live: an old save (or a future aura card) whose host carries `spellAuraBonus` still
    // boosts every stat spell through spellStatBonus — generic over the field, not the card.
    expect(spellStatBonus({ ...createRun(1), board: [] })).toBe(0);
    const one: RunState = {
      ...createRun(1),
      board: [{ uid: 'h', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false, spellAuraBonus: 1 }],
    };
    expect(spellStatBonus(one)).toBe(1);
    expect(spellAttackBonus(one)).toBe(1);
    expect(spellHealthBonus(one)).toBe(1);
    const two: RunState = {
      ...createRun(1),
      board: [{ uid: 'h', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: [], golden: false, spellAuraBonus: 2 }],
    };
    expect(spellStatBonus(two)).toBe(2); // stacked welds → +2/+2
  });

  it('the displayed value matches what a cast actually grants (Rohan, turn 1)', () => {
    const s = { ...createRun(1, 'rohan'), wave: 1 };
    const bonus = spellStatBonus(s);
    // Spirit Fire's base is +4/+4; with Rohan's turn-1 bonus the card shows +5/+5 and a cast grants +5/+5.
    expect(spellDisplayText('spiritfire', bonus)).toContain('+5/+5');
    let r: RunState = {
      ...s, board: [{ uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [{ uid: 'sf', cardId: 'spiritfire', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }],
    };
    r = reduce(r, { type: 'play', uid: 'sf', targetUid: 't' });
    expect(r.board[0]!.attack).toBe(7); // 2 + (4 base + 1 Rohan bonus)
    expect(r.board[0]!.health).toBe(7);
  });
});

describe('Spirit Pup → Spirit Worgen (@game/sim)', () => {
  const pouch = (i: number): BoardCard =>
    ({ uid: `s${i}`, cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
  const pup = (): BoardCard =>
    ({ uid: 'p', cardId: 'spiritpup', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false });
  const worgen = (): BoardCard =>
    ({ uid: 'w', cardId: 'spiritworgen', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false });
  const whelp = (uid: string): BoardCard =>
    ({ uid, cardId: 'frontdrake', tribe: 'dragon', attack: 1, health: 1, keywords: [], golden: false });
  const worgenAtk = (s: RunState): number => s.board.find((c) => c.uid === 'w')!.attack;

  it('the Pup transforms after 10 spells on board, keeping its stats (no buff on transform)', () => {
    let s: RunState = { ...createRun(1), board: [pup()], hand: Array.from({ length: 10 }, (_, i) => pouch(i)) };
    for (let i = 0; i < 9; i++) s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.board[0]!.cardId).toBe('spiritpup'); // 9 spells — not yet
    expect(s.board[0]!.spellProgress).toBe(9);
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); // 10th
    expect(s.board[0]!.cardId).toBe('spiritworgen'); // transformed, stats kept (no retroactive buff)
    expect(s.board[0]!.attack).toBe(4);
    expect(s.board[0]!.health).toBe(6);
  });

  it('tripling Spirit Pups keeps the highest spell progress (lowest spells-left)', () => {
    // Three Pups at 8 / 2 / 5 progress → the golden inherits 8 (just 2 spells from evolving).
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'p1', cardId: 'spiritpup', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false, spellProgress: 8 },
        { uid: 'p2', cardId: 'spiritpup', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false, spellProgress: 2 },
      ],
      hand: [
        { uid: 'p3', cardId: 'spiritpup', tribe: 'beast', attack: 4, health: 6, keywords: [], golden: false, spellProgress: 5 },
      ],
    };
    s = reduce(s, { type: 'play', uid: 'p3' }); // 3rd Pup → triple → golden in hand
    const golden = s.hand.find((c) => c.cardId === 'spiritpup' && c.golden);
    expect(golden).toBeDefined();
    expect(golden!.spellProgress).toBe(8); // max(8, 2, 5) — keeps the closest-to-evolving
    expect(s.triplesMade).toBe(1); // run-wide triples tally bumped by the merge
  });

  it("the Worgen's End-of-Turn gain: +2/+2 per Beast/Dragon played, improved +1/+1 per spell cast", () => {
    const s: RunState = {
      ...createRun(1),
      board: [worgen()],
      playedThisTurn: ['alley', 'alley', 'cleric'], // 2 Beasts (Pennycat) + 1 Dragon (Hoard Cleric) = 3
      spellsThisTurn: 1, // per-unit +2/+2 → +3/+3
    };
    applyEndOfTurn(s);
    expect(worgenAtk(s)).toBe(4 + 9); // (2 + 1 spell) × 3 played = +9

    // No plays this turn → no gain; the buff lands at End of Turn, not on play.
    let s2: RunState = { ...createRun(1), board: [worgen()], hand: [whelp('d')] };
    s2 = reduce(s2, { type: 'play', uid: 'd' }); // 1 Dragon played
    expect(worgenAtk(s2)).toBe(4); // nothing yet
    applyEndOfTurn(s2);
    expect(worgenAtk(s2)).toBe(4 + 2); // +2 for the 1 Dragon (no spells)
  });

  it('the Worgen ignores a played neutral (only Beasts/Dragons count)', () => {
    let s: RunState = {
      ...createRun(1), board: [worgen()],
      hand: [{ uid: 'x', cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'x' });
    applyEndOfTurn(s);
    expect(worgenAtk(s)).toBe(4); // a neutral doesn't count → no End-of-Turn gain
  });

  it('spellsThisTurn resets each wave', () => {
    let s: RunState = { ...createRun(1), resolve: 100, maxResolve: 100, hand: [pouch(0), pouch(1)] };
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    expect(s.spellsThisTurn).toBe(2);
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.spellsThisTurn).toBe(0); // reset on advance to the next wave
  });

  it("a Taurus-engraved neighbor's combat gains carry back to the run board (settleCombat)", () => {
    // The carry-back the task flags: a minion whose run-board card has NO 'EG' keyword (Taurus granted EG
    // only on its combat clone) must still keep its gains, labelled "Engraved". settleCombat applies
    // playerPermaBuffs by the entry's own `engraved` flag — never re-checking the run-board card's keywords.
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [
        { uid: 'n', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }, // no EG
      ],
      lastCombat: {
        events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
        initial: { player: [], enemy: [] },
        playerPermaBuffs: [{ sourceUid: 'n', attack: 5, health: 5, engraved: true }],
      },
    };
    s = reduce(s, { type: 'resolveCombat' });
    const card = s.board.find((c) => c.uid === 'n')!;
    expect([card.attack, card.health]).toEqual([6, 6]); // base 1/1 + the carried-back +5/+5
    expect(card.buffs?.some((b) => b.source === 'Engraved' && b.attack === 5 && b.health === 5)).toBe(true);
  });

  it('Flowing Monk gift (engraved: false) still labels the carry-back "Flowing Monk"', () => {
    // Regression guard: a non-EG carrier that received Flowing Monk's overflow gift carries back labelled
    // "Flowing Monk", exactly as before the refactor (the `engraved` flag steers only the label).
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [{ uid: 'm', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
      lastCombat: {
        events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
        initial: { player: [], enemy: [] },
        playerPermaBuffs: [{ sourceUid: 'm', attack: 3, health: 3, engraved: false }],
      },
    };
    s = reduce(s, { type: 'resolveCombat' });
    const card = s.board.find((c) => c.uid === 'm')!;
    expect(card.buffs?.some((b) => b.source === 'Flowing Monk' && b.attack === 3)).toBe(true);
  });

  it('Bane: each Battlecry you trigger gives Fodder +2/+2 run-wide (+4/+4 golden)', () => {
    // Bane subscribes to `battlecryTriggered` (Karwind's hook). Playing Soulfeeder (a Battlecry) fires once
    // → Bane enchants the Fodder card type +2/+2. A golden Bane does +4/+4.
    const setup = (golden: boolean): RunState => ({
      ...createRun(1), embers: 0, shop: [], pendingTavern: [],
      board: [{ uid: 'b', cardId: 'bane', tribe: 'dragon', attack: 12, health: 12, keywords: [], golden }],
      hand: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
    });
    const s = reduce(setup(false), { type: 'play', uid: 'sf' });
    expect(s.cardBuffs.fred).toEqual({ attack: 2, health: 2 }); // one battlecry → +2/+2
    expect(s.karwindFlash).toContain('b'); // Bane flashes itself so the proc reads even with no Fodder out
    const g = reduce(setup(true), { type: 'play', uid: 'sf' });
    expect(g.cardBuffs.fred).toEqual({ attack: 4, health: 4 }); // golden → +4/+4
  });

  it('Bane: triggering N Battlecries buffs Fodder +N/+N (and respects Drakko doubling)', () => {
    // Play three *distinct* Battlecry minions (distinct ids → no triple combine) → Bane procs three times
    // → Fodder +3/+3. Then with a Drakko the Drummer on board, a single Battlecry fires twice → Bane procs
    // per fire → +2/+2 from one play.
    let s: RunState = {
      ...createRun(1), embers: 0, shop: [], pendingTavern: [],
      board: [{ uid: 'b', cardId: 'bane', tribe: 'dragon', attack: 12, health: 12, keywords: [], golden: false }],
      hand: [
        { uid: 'f1', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }, // Battlecry: add Fodder
        { uid: 'f2', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 3, keywords: [], golden: false }, // Battlecry: buff Dragons
        { uid: 'f3', cardId: 'cleric', tribe: 'dragon', attack: 4, health: 4, keywords: [], golden: false }, // Battlecry: buff Dragons (2nd cleric)
      ],
    };
    s = reduce(s, { type: 'play', uid: 'f1' });
    s = reduce(s, { type: 'play', uid: 'f2' });
    s = reduce(s, { type: 'play', uid: 'f3' });
    expect(s.cardBuffs.fred).toEqual({ attack: 6, health: 6 }); // N=3 battlecries × +2/+2 → +6/+6

    // Drakko doubling: one Battlecry fire becomes two → Bane procs twice for a single play.
    let d: RunState = {
      ...createRun(1), embers: 0, shop: [], pendingTavern: [],
      board: [
        { uid: 'b', cardId: 'bane', tribe: 'dragon', attack: 12, health: 12, keywords: [], golden: false },
        { uid: 'dr', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 4, keywords: [], golden: false },
      ],
      hand: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false }],
    };
    d = reduce(d, { type: 'play', uid: 'sf' });
    expect(d.cardBuffs.fred).toEqual({ attack: 4, health: 4 }); // 1 play × 2 fires (Drakko) × +2/+2 → +4/+4
  });
});

describe('opponent pool (M3 step 2 — serve real boards)', () => {
  it('pickOpponent matches by WAVE, prefers real boards, widens to the closest, null only on an empty pool', () => {
    const mk = (over: Partial<BoardSnapshot>): BoardSnapshot => ({
      v: 1, wave: 3, heroId: 'warden', resolve: 25, tier: 2, triples: 0, tribes: [], threat: 'horde', power: 20,
      minions: [{ cardId: 'frontdrake', attack: 10, health: 10, keywords: [] }], seed: 0, ...over,
    });
    const house3 = mk({ wave: 3, origin: 'house', power: 20 });
    const self3 = mk({ wave: 3, origin: 'self', author: 'Sam', power: 20 });
    const house6 = mk({ wave: 6, origin: 'house', power: 50 });
    // Same wave (development stage) → prefers the REAL (self) board over the house board.
    expect(pickOpponent(3, 20, makeRng(7), [house3, self3])?.author).toBe('Sam');
    // No board at wave 5 → widens to the closest available wave (6), never null on a non-empty pool.
    expect(pickOpponent(5, 50, makeRng(7), [house3, house6])?.wave).toBe(6);
    // Empty pool → null (the caller falls back to the procedural threat).
    expect(pickOpponent(3, 20, makeRng(7), [])).toBeNull();
  });

  it('pickOpponent source priority: Supabase (remote) > local player > synthetic, fully random within the tier (no power bias)', () => {
    const mk = (over: Partial<BoardSnapshot>): BoardSnapshot => ({
      v: 1, wave: 3, heroId: 'warden', resolve: 25, tier: 2, triples: 0, tribes: [], threat: 'horde', power: 20,
      minions: [{ cardId: 'frontdrake', attack: 10, health: 10, keywords: [] }], seed: 0, ...over,
    });
    const remote3 = mk({ wave: 3, origin: 'self', author: 'Net', power: 999, remote: true }); // far-off power on purpose
    const self3 = mk({ wave: 3, origin: 'self', author: 'Me', power: 20 });
    const synth3 = mk({ wave: 3, origin: 'synthetic', power: 20 });
    // The live shared (remote) board wins even though its power is nowhere near yours — power no longer weights the pick.
    expect(pickOpponent(3, 20, makeRng(7), [synth3, self3, remote3])?.author).toBe('Net');
    // No remote at this wave → a local player board is preferred over the synthetic floor.
    expect(pickOpponent(3, 20, makeRng(7), [synth3, self3])?.author).toBe('Me');
    // Only synthetic available → serve it (graceful floor).
    expect(pickOpponent(3, 20, makeRng(7), [synth3])?.origin).toBe('synthetic');
    // Fully random within a tier: across many seeds, both same-tier remote boards get served (not pinned to one).
    const a = mk({ wave: 3, origin: 'self', author: 'A', power: 20, remote: true });
    const b = mk({ wave: 3, origin: 'self', author: 'B', power: 20, remote: true });
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) seen.add(pickOpponent(3, 20, makeRng(seed), [a, b])!.author!);
    expect(seen).toEqual(new Set(['A', 'B']));
  });

  it('the sim default pool is empty → headless/tests fight procedural omens (the app injects the bootstrap)', () => {
    expect(OPPONENT_POOL.length).toBe(0); // empty here keeps headless runs deterministic-procedural
    const s: RunState = {
      ...createRun(1),
      wave: 3,
      board: [{ uid: 'a', cardId: 'kennel', tribe: 'beast', attack: 4, health: 5, keywords: [], golden: false }],
    };
    const enemy = reduce(s, { type: 'faceOmen' }).lastCombat!.initial.enemy;
    expect(enemy.length).toBeGreaterThan(0);
    expect(enemy.every((m) => m.cardId === 'omen')).toBe(true); // empty pool → procedural omens
  });

  it('a populated pool serves a real captured board through faceOmen (not the procedural omen)', () => {
    const boards = buildBootstrapPool([1, 2]); // generate while the pool is still empty (bot faces procedural)
    OPPONENT_POOL.push(...boards);
    try {
      const target = boards.find((b) => b.minions.length > 0)!;
      const half = Math.max(1, Math.round(target.power / 2));
      const s: RunState = {
        ...createRun(1),
        wave: target.wave,
        board: [{ uid: 'a', cardId: 'kennel', tribe: 'beast', attack: half, health: half, keywords: [], golden: false }],
      };
      const enemy = reduce(s, { type: 'faceOmen' }).lastCombat!.initial.enemy;
      expect(enemy.length).toBeGreaterThan(0);
      expect(enemy.some((m) => m.cardId !== 'omen')).toBe(true); // a real captured board, not procedural
    } finally {
      OPPONENT_POOL.length = 0; // restore the empty default so the rest of the suite stays procedural
    }
  });

  it('isServableBoard rejects boards referencing a card this build no longer has (stale capture)', () => {
    const known: BoardSnapshot = {
      v: 1, wave: 3, heroId: 'warden', resolve: 25, tier: 2, triples: 0, tribes: [], threat: 'horde', power: 20,
      minions: [{ cardId: 'frontdrake', attack: 5, health: 5, keywords: [] }], seed: 0,
    };
    const stale: BoardSnapshot = { ...known, minions: [{ cardId: 'lifebinder', attack: 9, health: 9, keywords: [] }] };
    expect(isServableBoard(known)).toBe(true);
    expect(isServableBoard(stale)).toBe(false); // 'lifebinder' was removed → unfightable
  });

  it('registerOpponents drops stale boards so they never enter the served pool', () => {
    const known: BoardSnapshot = {
      v: 1, wave: 3, heroId: 'warden', resolve: 25, tier: 2, triples: 0, tribes: [], threat: 'horde', power: 20,
      minions: [{ cardId: 'frontdrake', attack: 5, health: 5, keywords: [] }], seed: 0,
    };
    const stale: BoardSnapshot = { ...known, minions: [{ cardId: 'lifebinder', attack: 9, health: 9, keywords: [] }] };
    try {
      registerOpponents([known, stale]);
      expect(OPPONENT_POOL).toHaveLength(1);
      expect(OPPONENT_POOL[0]!.minions[0]!.cardId).toBe('frontdrake'); // only the fightable board got through
    } finally {
      OPPONENT_POOL.length = 0;
    }
  });

  it('faceOmen never hard-locks on a stale served board — it falls back to the procedural threat', () => {
    // Bypass registerOpponents' filter to force the worst case: a stale board IS in the live pool. Serving it
    // would throw `Unknown card` in instantiate (the old "froze on End of Turn" bug); the fallback must catch
    // it and resolve combat anyway. (This is the belt-and-suspenders behind the load-time filter.)
    const stale: BoardSnapshot = {
      v: 1, wave: 3, heroId: 'warden', resolve: 25, tier: 2, triples: 0, tribes: [], threat: 'horde', power: 20,
      minions: [{ cardId: 'lifebinder', attack: 9, health: 9, keywords: [] }], seed: 0,
    };
    OPPONENT_POOL.push(stale); // raw push — skips the filter on purpose
    try {
      const s: RunState = {
        ...createRun(1),
        wave: 3,
        turnStartPower: 20,
        board: [{ uid: 'a', cardId: 'kennel', tribe: 'beast', attack: 10, health: 10, keywords: [], golden: false }],
      };
      let next!: RunState;
      expect(() => { next = reduce(s, { type: 'faceOmen' }); }).not.toThrow();
      expect(next.phase).toBe('combat'); // combat resolved (didn't strand the turn in recruit)
      const enemy = next.lastCombat!.initial.enemy;
      expect(enemy.length).toBeGreaterThan(0);
      expect(enemy.every((m) => m.cardId !== 'lifebinder')).toBe(true); // fell back to a fightable board
      expect(next.lastCombat!.odds).toBeDefined(); // odds computed on the fallback board too
    } finally {
      OPPONENT_POOL.length = 0;
    }
  });

  it('loss damage = opponent tier + the SUM of surviving enemy tiers (procedural uses the player tier)', () => {
    // An empty board guarantees a loss with the whole enemy surviving → damage = tier + Σ(survivor tiers).
    const s: RunState = { ...createRun(1), wave: 4, tier: 3, board: [] };
    const next = reduce(s, { type: 'faceOmen' });
    expect(next.lastCombat!.result).toBe('lose');
    const enemy = next.lastCombat!.initial.enemy;
    const tierSum = enemy.reduce((sum, m) => sum + (CARD_INDEX[m.cardId]?.tier ?? 1), 0);
    expect(tierSum).toBeGreaterThan(0);
    expect(next.lastCombat!.playerDamage).toBe(Math.min(3 + tierSum, 10)); // s.tier + Σ tiers, capped (wave 4 → 10)
  });

  it('loss damage is capped by round — a low-power, high-tier board exceeds the early cap', () => {
    // A 1/1 Gnasher (T6) board: low power (matches an empty board) but raw damage tier 6 + surviving T6 = 12.
    const board: BoardSnapshot = {
      v: 1, wave: 1, heroId: 'warden', resolve: 30, tier: 6, triples: 0, tribes: [], threat: 'horde', power: 2,
      minions: [{ cardId: 'gnash', attack: 1, health: 1 }], seed: 0,
    };
    OPPONENT_POOL.push(board);
    try {
      const s: RunState = { ...createRun(1), wave: 1, board: [] };
      const next = reduce(s, { type: 'faceOmen' });
      expect(next.lastCombat!.result).toBe('lose');
      expect(next.lastCombat!.playerDamage).toBe(5); // raw 12 capped to 5 at wave 1
    } finally {
      OPPONENT_POOL.length = 0;
    }
  });

  it('lossDamageCap rises by round: 5 (≤3), 10 (4–6), 15 (7+)', () => {
    expect([1, 2, 3].map(lossDamageCap)).toEqual([5, 5, 5]);
    expect([4, 5, 6].map(lossDamageCap)).toEqual([10, 10, 10]);
    expect([7, 12, 30].map(lossDamageCap)).toEqual([15, 15, 15]);
  });

  it('Practice mode: a loss costs no Resolve (unlimited health), and the run keeps going through the course', () => {
    let s: RunState = {
      ...createRun(1, 'warden', 'practice'),
      wave: 5, phase: 'combat', resolve: 30,
      lastCombat: { events: [], result: 'lose', playerDamage: 10, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.resolve).toBe(30); // unlimited — no Resolve lost on a loss
    expect(s.phase).toBe('recruit'); // wave 5 < courseRounds → keep climbing
  });

  it('Practice mode ends after the final course round regardless of W/L (shares Ascent\'s course length)', () => {
    let s: RunState = {
      ...createRun(1, 'warden', 'practice'),
      wave: CONFIG.courseRounds, phase: 'combat',
      lastCombat: { events: [], result: 'lose', playerDamage: 10, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('gameover'); // course complete — the practice session ends
  });

  it('settleCombat keeps the same lastCombat reference (the UI replay must not restart)', () => {
    let s: RunState = {
      ...createRun(1),
      wave: 2,
      board: [{ uid: 'a', cardId: 'kennel', tribe: 'beast', attack: 2, health: 3, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.phase).toBe('combat');
    const ref = s.lastCombat;
    s = reduce(s, { type: 'settleCombat' });
    expect(s.combatSettled).toBe(true);
    expect(s.phase).toBe('combat'); // settle stays in combat; advancing is the End Combat click
    expect(s.lastCombat).toBe(ref); // SAME object → the replay hook (keyed on the reference) can't reset
  });
});

describe('Beatboxer — mimics magnetizations (M3 content)', () => {
  const clingHand = (uid: string): BoardCard => ({ uid, cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false });

  it('mimics a magnetization onto another mech (Beatboxer gains the stats too)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: false },
      ],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 }); // magnetize the Cling onto the drone (index 0)
    const host = s.board.find((c) => c.uid === 'host')!;
    const bb = s.board.find((c) => c.uid === 'bb')!;
    expect([host.attack, host.health]).toEqual([4, 3]); // host welded +2/+2
    expect([bb.attack, bb.health]).toEqual([10, 10]); // Beatboxer mimicked it (8/8 +2/+2)
  });

  it('a golden Beatboxer mimics each magnetization twice', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: true },
      ],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 });
    const bb = s.board.find((c) => c.uid === 'bb')!;
    expect([bb.attack, bb.health]).toEqual([12, 12]); // golden → 8/8 + 2×(2/2)
  });

  it('magnetizing directly onto Beatboxer counts once (no self-mimic)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: false }],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 }); // weld onto Beatboxer itself
    const bb = s.board.find((c) => c.uid === 'bb')!;
    expect([bb.attack, bb.health]).toEqual([10, 10]); // 8/8 + 2/2 once, not doubled
  });

  it("a Beatboxer's mimicked Cling copy also stacks the Cling improvement", () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: false },
      ],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 }); // 1 Cling onto the drone; Beatboxer mimics a copy
    expect(s.cardBuffs?.cling).toEqual({ attack: 2, health: 2 }); // host weld (1) + Beatboxer's copy (1)
  });

  it("a golden Beatboxer's two Cling copies both stack", () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        { uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        { uid: 'bb', cardId: 'beatboxer', tribe: 'mech', attack: 8, health: 8, keywords: [], golden: true },
      ],
      hand: [clingHand('m')],
    };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 });
    expect(s.cardBuffs?.cling).toEqual({ attack: 3, health: 3 }); // host (1) + golden Beatboxer's 2 copies
  });
});

describe('spell offers respect the tavern tier (M3 fix)', () => {
  it('never offers a spell above the current tier', () => {
    let s: RunState = { ...createRun(1), tier: 2, embers: 200 };
    let sawSpell = false;
    for (let i = 0; i < 40; i++) {
      s = reduce(s, { type: 'roll' });
      if (s.spell) {
        sawSpell = true;
        expect(CARD_INDEX[s.spell.cardId]!.tier).toBeLessThanOrEqual(2); // the T5 Devourer can't appear at T2
      }
    }
    expect(sawSpell).toBe(true);
  });
});

describe('Cling Drones improve per magnetization (M3 content)', () => {
  it('a magnetized Cling improves Cling Drones +1/+1 (enchantment + clings already in hand grow)', () => {
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'host', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false }],
      hand: [
        { uid: 'm1', cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false },
        { uid: 'm2', cardId: 'cling', tribe: 'mech', attack: 2, health: 2, keywords: ['M'], golden: false }, // stays in hand
      ],
    };
    s = reduce(s, { type: 'play', uid: 'm1', toIndex: 0 }); // magnetize m1 onto the drone
    expect(s.cardBuffs?.cling).toEqual({ attack: 1, health: 1 }); // persistent enchantment grew
    const m2 = s.hand.find((c) => c.uid === 'm2')!;
    expect([m2.attack, m2.health]).toEqual([3, 3]); // the Cling still in hand grew too
  });

  it('Combinator forks into different Magnetic Mechs across seeds (random pick from the whole magnetic pool)', () => {
    // The host (2/1) gains the rolled magnetic mech's body — so its attack jumps by that mech's base attack.
    // Derive the valid jumps from the live pool so this stays correct as magnetic mechs are added/changed.
    const magneticAtks = new Set(
      Object.values(CARD_INDEX)
        .filter((c) => (c.tribe === 'mech' || c.tribe2 === 'mech') && c.keywords.includes('M'))
        .map((c) => c.attack),
    );
    expect(magneticAtks.size).toBeGreaterThan(1); // sanity: there are several magnetic mechs to roll
    const deltaAtk = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      let s: RunState = {
        ...createRun(seed),
        board: [
          { uid: 'comb', cardId: 'combinator', tribe: 'mech', attack: 6, health: 7, keywords: [], golden: false },
          { uid: 'd1', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
          { uid: 'd2', cardId: 'drone', tribe: 'mech', attack: 2, health: 1, keywords: ['DS'], golden: false },
        ],
      };
      s = reduce(s, { type: 'faceOmen' });
      const welded = s.board.filter((c) => c.uid.startsWith('d') && c.attack > 2);
      expect(welded.length).toBe(1); // non-golden welds exactly one host
      const da = welded[0]!.attack - 2;
      expect(magneticAtks.has(da)).toBe(true); // welded one of the build's Magnetic Mechs
      deltaAtk.add(da);
    }
    expect(deltaAtk.size).toBeGreaterThan(1); // it's RANDOM — not always the same bot
  });
});

describe('content batch: new minions (@game/sim)', () => {
  const card = (uid: string, cardId: string, tribe: BoardCard['tribe'], a: number, h: number, extra: Partial<BoardCard> = {}): BoardCard =>
    ({ uid, cardId, tribe, attack: a, health: h, keywords: [], golden: false, ...extra });

  // Minimal CombatResult shell for the carry-back settleCombat tests — only the fields settleCombat reads
  // matter; the carry-back channels are layered per test.
  const combatShell = (over: Partial<CombatResult>): CombatResult => ({
    events: [],
    result: 'win',
    playerDamage: 0,
    playerDeathrattles: 0,
    enemyDeaths: 0,
    initial: { player: [], enemy: [] },
    ...over,
  });

  it('a triple keeps welded magnetic fields — Better Bot Rally + Harry Botter aura survive the combine', () => {
    // Three Drones: one carries a welded Better Bot Rally, one a welded Harry Botter aura. Playing the
    // third triggers the triple — the golden must inherit BOTH welded attachments (the Better-Bot bug).
    let s: RunState = {
      ...createRun(1),
      hand: [card('d3', 'drone', 'mech', 2, 1, { keywords: ['DS'] })],
      board: [
        card('d1', 'drone', 'mech', 7, 1, { keywords: ['DS'], rallyMechAtk: 5 }),
        card('d2', 'drone', 'mech', 2, 6, { keywords: ['DS'], spellAuraBonus: 1 }),
      ],
    };
    s = reduce(s, { type: 'play', uid: 'd3', toIndex: 2 }); // 3rd Drone → triple → golden in hand
    const golden = [...s.hand, ...s.board].find((c) => c.cardId === 'drone' && c.golden);
    expect(golden).toBeDefined();
    expect(golden!.rallyMechAtk).toBe(5); // Better Bot's welded Rally carried through (was dropped before)
    expect(golden!.spellAuraBonus).toBe(1); // a welded spell-power aura carried through
  });

  it('Archmagus Guel scales PER-INSTANCE: +1/+1 per 4 spells cast while HE is on board (golden ×2)', () => {
    // emberpouch (Gain 1 Gold) doesn't touch minions, so the OTHER friend's gain is purely Guel's.
    // The step counter is the instance's `spellProgress` (spells cast with this Guel on board), NOT the
    // run-wide spellsCast (owner ruling 2026-07-05: no improvement unless he's on board).
    const cast = (spellProgress: number, golden: boolean): RunState =>
      reduce(
        {
          ...createRun(1),
          embers: 99,
          board: [card('g', 'guel', 'neutral', 2, 3, { golden, spellProgress }), card('t', 'drone', 'mech', 2, 2)],
          hand: [card('sp', 'emberpouch', 'neutral', 0, 0)],
        },
        { type: 'play', uid: 'sp' },
      );
    const buffed = (s: RunState): [number, number] => {
      const t = s.board.find((c) => c.uid === 't')!;
      return [t.attack - 2, t.health - 2];
    };
    expect(buffed(cast(0, false))).toEqual([1, 1]); // cast → 1 on-board spell, step 0 → base +1/+1
    expect(buffed(cast(3, false))).toEqual([2, 2]); // cast → 4 on-board spells, step 1 → +2/+2
    expect(buffed(cast(7, false))).toEqual([3, 3]); // cast → 8 on-board spells, step 2 → +3/+3
    expect(buffed(cast(7, true))).toEqual([6, 6]); // golden: (1 + 2) × 2 → +6/+6
  });

  it("Guel's improvement ignores spells cast BEFORE he was on board (and combat casts tick him at settle)", () => {
    // 7 run-wide casts pre-date this Guel (step 1 under the OLD rule) — a fresh copy still grants base +1/+1.
    let s: RunState = {
      ...createRun(1),
      embers: 99,
      spellsCast: 7,
      board: [card('g', 'guel', 'neutral', 2, 3), card('t', 'drone', 'mech', 2, 2)],
      hand: [card('sp', 'emberpouch', 'neutral', 0, 0)],
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    const t = s.board.find((c) => c.uid === 't')!;
    expect([t.attack - 2, t.health - 2]).toEqual([1, 1]); // base grant — the 7 pre-board casts don't count
    expect(s.board.find((c) => c.uid === 'g')?.spellProgress).toBe(1); // his own tally started fresh
    // Combat casts (Taragosa) tick the on-board Guel's tally at settle — he was on board for the fight.
    s = { ...s, phase: 'combat', lastCombat: combatShell({ playerSpellsCast: 3 }) };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.board.find((c) => c.uid === 'g')?.spellProgress).toBe(4); // 1 (shop) + 3 (combat)
    expect(s.spellsCast).toBe(11); // the run-wide counter still advances (8 + 3)
  });

  it('Hoard Cleric (cleric) Battlecry gives your Dragons +2/+3', () => {
    let s: RunState = {
      ...createRun(1),
      board: [
        card('d', 'frontdrake', 'dragon', 2, 1), // another Dragon on board
        card('n', 'sandbag', 'neutral', 0, 4), // a non-Dragon: untouched
      ],
      hand: [card('hc', 'cleric', 'dragon', 3, 4)],
    };
    s = reduce(s, { type: 'play', uid: 'hc' });
    const dragon = s.board.find((c) => c.uid === 'd')!;
    expect([dragon.attack, dragon.health]).toEqual([4, 4]); // 2/1 → 4/4
    const cleric = s.board.find((c) => c.uid === 'hc')!;
    expect([cleric.attack, cleric.health]).toEqual([5, 7]); // includes self: 3/4 → 5/7
    const neutral = s.board.find((c) => c.uid === 'n')!;
    expect([neutral.attack, neutral.health]).toEqual([0, 4]); // non-Dragon untouched
  });

  it('Cinderwing Matron (cinder) Battlecry raises the run spell HEALTH bonus; a later Spirit Fire grants +4/+5', () => {
    let s: RunState = {
      ...createRun(1),
      board: [card('t', 'sandbag', 'neutral', 2, 2)],
      hand: [card('cw', 'cinder', 'dragon', 5, 5), card('sf', 'spiritfire', 'neutral', 0, 0)],
    };
    s = reduce(s, { type: 'play', uid: 'cw' });
    expect(s.spellBonus).toEqual({ attack: 0, health: 1 }); // +1 spell Health
    expect(spellAttackBonus(s)).toBe(0); // Attack unchanged (warden hero amplify = 0)
    expect(spellHealthBonus(s)).toBe(1);
    // Spirit Fire (+4/+4) now grants +4/+5 (Health bonus folds onto Health only).
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 't' });
    const target = s.board.find((c) => c.uid === 't')!;
    expect([target.attack, target.health]).toEqual([6, 7]); // 2/2 + 4/5
    // And the card text shows the effective Health bump (Attack unchanged).
    expect(spellDisplayText('spiritfire', spellAttackBonus(s), 0, spellHealthBonus(s))).toBe('Give a friendly minion **{{+4/+5}}**.');
  });

  it('a golden Cinderwing Matron grants +2 spell Health', () => {
    let s: RunState = { ...createRun(1), board: [], hand: [card('cw', 'cinder', 'dragon', 10, 10, { golden: true })] };
    s = reduce(s, { type: 'play', uid: 'cw' });
    expect(s.spellBonus).toEqual({ attack: 0, health: 2 });
  });

  it("Skullblade's spell-power carry-back lands in settleCombat: spellBonus.attack += 1, next spell +5/+4", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [card('t', 'sandbag', 'neutral', 2, 2)],
      hand: [card('sf', 'spiritfire', 'neutral', 0, 0)],
      lastCombat: combatShell({ playerSpellPower: { attack: 1, health: 0 } }),
    };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.spellBonus).toEqual({ attack: 1, health: 0 }); // carried back
    // A Spirit Fire (+4/+4) now grants +5/+4 (Attack bonus folds onto Attack only).
    s = { ...s, phase: 'recruit' };
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 't' });
    const target = s.board.find((c) => c.uid === 't')!;
    expect([target.attack, target.health]).toEqual([7, 6]); // 2/2 + 5/4
  });

  it('Grave Knit (knit) run-wide +3/+2 carry-back lands in settleCombat — board, hand, and future copies', () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [card('k1', 'knit', 'undead', 3, 2)],
      hand: [card('k2', 'knit', 'undead', 3, 2)],
      lastCombat: combatShell({ playerCardBuffs: [{ cardId: 'knit', attack: 3, health: 2 }] }),
    };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.cardBuffs.knit).toEqual({ attack: 3, health: 2 }); // run-wide enchant recorded
    expect([s.board.find((c) => c.uid === 'k1')!.attack, s.board.find((c) => c.uid === 'k1')!.health]).toEqual([6, 4]); // board copy
    expect([s.hand.find((c) => c.uid === 'k2')!.attack, s.hand.find((c) => c.uid === 'k2')!.health]).toEqual([6, 4]); // hand copy
    // A FUTURE copy bought from the tavern carries the enchant too. Use a clean board/hand (the two
    // existing Grave Knits above would otherwise triple with the buy into a golden, doubling its stats).
    let s2: RunState = { ...createRun(1), embers: 9, board: [], hand: [], cardBuffs: { knit: { attack: 3, health: 2 } }, shop: [{ uid: 'x', cardId: 'knit' }] };
    s2 = reduce(s2, { type: 'buy', uid: 'x' });
    const bought = s2.hand.find((c) => c.cardId === 'knit')!;
    expect([bought.attack, bought.health]).toEqual([6, 4]); // 3/2 base + 3/2 run buff
  });

  it("Grave Knit's run-wide buff stacks across combat deaths (+3/+2 each)", () => {
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      combatSettled: false,
      board: [card('k1', 'knit', 'undead', 3, 2)],
      hand: [],
      // Two Grave Knits died this combat → the carried entry already sums to +6/+4.
      lastCombat: combatShell({ playerCardBuffs: [{ cardId: 'knit', attack: 6, health: 4 }] }),
    };
    s = reduce(s, { type: 'settleCombat' });
    expect(s.cardBuffs.knit).toEqual({ attack: 6, health: 4 });
    expect([s.board.find((c) => c.uid === 'k1')!.attack, s.board.find((c) => c.uid === 'k1')!.health]).toEqual([9, 6]); // 3/2 + 6/4
  });

  it('Bane (Dragon/Demon) is consumed as a Demon — it eats Fodder from the tavern via tribe2', () => {
    // Bane on the board (primary Dragon, tribe2 Demon). Fred queued for the next tavern must be brought
    // out (injectPendingTavern's demon check) and devoured by Bane (consumeTavernFodder's demon check),
    // both now recognizing tribe2 === 'demon'. resolveCombat advances → next tavern injects + consumes.
    let s: RunState = {
      ...createRun(1),
      phase: 'combat',
      board: [card('bane', 'bane', 'dragon', 12, 12)],
      pendingTavern: ['fred'],
      lastCombat: combatShell({}),
    };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.shop.find((o) => o.cardId === 'fred')).toBeUndefined(); // Fred eaten — left the tavern
    const bane = s.board.find((c) => c.uid === 'bane')!;
    expect([bane.attack, bane.health]).toEqual([13, 13]); // 12/12 + Fred's 1/1
    expect(s.fodderEaten?.[0]).toMatchObject({ eaterUid: 'bane', fodderId: 'fred' }); // Bane recorded as the eater
  });

});

describe('wave-relative board strength rating (@game/sim)', () => {
  const vanilla = (n: number, atk: number, hp: number, kw?: BoardMinion['keywords']): BoardMinion[] =>
    Array.from({ length: n }, () => (kw ? { cardId: 'alley', attack: atk, health: hp, keywords: kw } : { cardId: 'alley', attack: atk, health: hp }));
  // Build the per-wave ladders ONCE (running the bot is the slow part). A small seed/fidelity set still
  // spans weak→strong at each wave for these assertions.
  const ladders = buildWaveLadders([1, 42], [0.3, 0.7, 1.0]);
  const waves = [...ladders.keys()].sort((a, b) => a - b);
  const lowWave = waves[0]!;
  const highWave = waves[waves.length - 1]!;
  const avgPower = (w: number): number => {
    const L = ladders.get(w)!;
    return L.reduce((s, b) => s + b.reduce((p, m) => p + m.attack + m.health, 0), 0) / L.length;
  };

  it('is WAVE-RELATIVE — the ladder scales with the wave, so a fixed board rates no higher at a later wave (no saturation)', () => {
    expect(highWave).toBeGreaterThan(lowWave);
    expect(avgPower(highWave)).toBeGreaterThan(avgPower(lowWave)); // later waves calibrate against stronger boards
    const board = vanilla(5, 6, 6); // a fixed mid board
    const low = rateBoardForWave(board, lowWave, ladders);
    const high = rateBoardForWave(board, highWave, ladders);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThanOrEqual(low); // the SAME board is no stronger FOR a later wave — the old fixed gauntlet saturated to 1.0 and couldn't see this
  });

  it('rates 0 for empty, is monotonic in board strength at a fixed wave, and is deterministic', () => {
    expect(rateBoardForWave([], lowWave, ladders)).toBe(0);
    const weak = rateBoardForWave(vanilla(2, 1, 1), lowWave, ladders);
    const strong = rateBoardForWave(vanilla(7, 20, 30, ['DS', 'W']), lowWave, ladders);
    expect(weak).toBeLessThan(strong);
    expect(strong).toBeLessThanOrEqual(1);
    expect(rateBoardForWave(vanilla(2, 1, 1), lowWave, ladders)).toBe(weak); // same board+wave → same rating
  });

  it('ratingBand buckets 0..1 into BAND_COUNT bands', () => {
    expect(ratingBand(0)).toBe(0);
    expect(ratingBand(0.999)).toBe(BAND_COUNT - 1);
    expect(ratingBand(1)).toBe(BAND_COUNT - 1); // clamped, never out of range
  });
});

describe('quests (M3 framework)', () => {
  it('questTierForWave maps the quest-turns (4/8/12) and nothing else', () => {
    expect(questTierForWave(4)).toBe('lesser');
    expect(questTierForWave(8)).toBe('greater');
    expect(questTierForWave(12)).toBe('capstone');
    expect(questTierForWave(3)).toBeNull();
    expect(questTierForWave(5)).toBeNull();
    expect(questTierForWave(1)).toBeNull();
  });

  it('CONFIG.questsEnabled = false → the whole quest system goes dark (4/8/12 become normal shop turns)', () => {
    const prev = CONFIG.questsEnabled;
    CONFIG.questsEnabled = false;
    try {
      // The single gate short-circuits, so both the reducer's phase check and the offer generator go quiet.
      expect(questTierForWave(4)).toBeNull();
      expect(questTierForWave(8)).toBeNull();
      expect(generateQuestOffer({ ...createRun(1), wave: 4 })).toEqual([]);
      // …and a live advance INTO a quest-wave opens the NORMAL shop — no quest phase, no offer.
      let s: RunState = { ...createRun(1), wave: 3, phase: 'recruit', resolve: 999, maxResolve: 999, armor: 999, board: [{ uid: 't1', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false }] };
      s = reduce(s, { type: 'faceOmen' });
      s = reduce(s, { type: 'resolveCombat' });
      expect(s.wave).toBe(4);
      expect(s.questOffer).toBeUndefined();
      expect(s.shop.length).toBeGreaterThan(0);
    } finally {
      CONFIG.questsEnabled = prev;
    }
  });

  it('generateQuestOffer: 4 quests of the wave tier — exactly one neutral + 3 distinct tribes', () => {
    const offer = generateQuestOffer({ ...createRun(1), wave: 4 });
    expect(offer.length).toBe(4);
    const defs = offer.map((id) => QUEST_INDEX[id]!);
    expect(defs.every((q) => q.tier === 'lesser')).toBe(true);
    expect(defs.filter((q) => q.tribe === 'neutral').length).toBe(1); // neutral always, exactly one
    expect(new Set(defs.map((q) => q.tribe)).size).toBe(4); // 1 neutral + 3 distinct non-neutral tribes
    expect(new Set(offer).size).toBe(offer.length); // no duplicate quest within the offer
  });

  it('never re-offers a quest you already hold', () => {
    const first = generateQuestOffer({ ...createRun(1), wave: 4 });
    const taken = first.map((id) => ({ questId: id, progress: 0, completed: false }));
    const second = generateQuestOffer({ ...createRun(1), wave: 4, activeQuests: taken });
    expect(second.some((id) => first.includes(id))).toBe(false); // every slot is a fresh, un-taken quest
  });

  it('generateQuestOffer is deterministic (seeded off seed + wave) and empty off quest-waves', () => {
    expect(generateQuestOffer({ ...createRun(7), wave: 8 })).toEqual(generateQuestOffer({ ...createRun(7), wave: 8 }));
    expect(generateQuestOffer({ ...createRun(1), wave: 5 })).toEqual([]);
  });

  it('waves 8 & 12 guarantee your most-played tribe is offered', () => {
    const beastId = BUYABLE_CARDS.find((c) => c.tribe === 'beast')!.id;
    const beast = (uid: string): BoardCard => ({ uid, cardId: beastId, tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false });
    const offer = generateQuestOffer({ ...createRun(1), wave: 8, board: [beast('b1'), beast('b2'), beast('b3')] });
    expect(offer.map((id) => QUEST_INDEX[id]!.tribe)).toContain('beast');
  });

  it('advancing into wave 4 opens the quest shop with the tavern ALREADY rolled behind it (shop-informed pick)', () => {
    let s: RunState = { ...createRun(1), wave: 3, phase: 'recruit', resolve: 200 };
    s = reduce(s, { type: 'faceOmen' }); // → combat (empty board loses, but survives at 200 Resolve)
    s = reduce(s, { type: 'resolveCombat' }); // → advance to wave 4
    expect(s.wave).toBe(4);
    expect(s.questOffer?.length).toBe(4);
    // The shop is rolled UP FRONT now, so it can be inspected (minimized) while choosing the quest.
    expect(s.shop.length).toBeGreaterThan(0);
    // Locked: a normal tavern action is still a no-op (same state reference) while the quest offer is open.
    expect(reduce(s, { type: 'roll' })).toBe(s);
    // Buy the quest → it moves to activeQuests and the offer clears; the shop is already there (no re-roll).
    const shopBefore = s.shop.map((o) => o.uid);
    const bought = reduce(s, { type: 'buyQuest', index: 0 });
    expect(bought.questOffer).toBeUndefined();
    expect(bought.activeQuests?.length).toBe(1);
    expect(bought.activeQuests![0]!.questId).toBe(s.questOffer![0]);
    expect(bought.shop.map((o) => o.uid)).toEqual(shopBefore); // same shop — buyQuest didn't re-roll
  });

  it('an objective ticks on its tracked action and applies its reward at the threshold', () => {
    // q_forest_grove = objective "Summon 5 Beasts" → reward: a random Beast to hand. Playing a Beast that lands
    // cleanly (no Battlecry / summon buff / Magnetic / token-summon) ticks `summon` by exactly 1.
    const beast = BUYABLE_CARDS.find(
      (c) => c.tribe === 'beast' && !c.spell && !c.chooseOne && !c.target && !c.keywords.includes('M') && !c.effects.some((e) => e.on === 'onPlay' || e.on === 'onSummon'),
    )!;
    const mk = (uid: string): BoardCard => ({ uid, cardId: beast.id, tribe: beast.tribe, attack: beast.attack, health: beast.health, keywords: [...beast.keywords], golden: false });
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_forest_grove', progress: 3, completed: false }], hand: [mk('h1'), mk('h2')], board: [] };
    s = reduce(s, { type: 'play', uid: 'h1' });
    expect(s.activeQuests![0]!.progress).toBe(4);
    expect(s.activeQuests![0]!.completed).toBe(false);
    s = reduce(s, { type: 'play', uid: 'h2' });
    expect(s.activeQuests![0]!.completed).toBe(true); // 5th Beast summoned
    // Reward: a random Beast conjured to hand.
    expect(s.hand.some((c) => { const d = CARD_INDEX[c.cardId]; return d?.tribe === 'beast' || d?.tribe2 === 'beast'; })).toBe(true);
  });

  it('a full bot run passes cleanly through the quest turns (no soft-lock)', () => {
    const end = playToEnd(1);
    expect(['gameover', 'victory']).toContain(end.phase); // terminated, not stuck at the step cap
    // One quest bought per quest-turn REACHED (buys happen in recruit, before that wave's combat).
    expect(end.activeQuests?.length ?? 0).toBe([4, 8, 12].filter((w) => end.wave >= w).length);
  });

  it('a summon objective counts tokens, not just the played card (Pennycat = 2 toward the goal)', () => {
    // Forest Grove wants 5 Beast summons. Pennycat (beast, played) + its Stray (beast token) = 2 in ONE play —
    // the "every minion entering the board" rule. From progress 1, two plays (+2 each) clear the bar. Two copies
    // each → no triples.
    const mk = (uid: string): BoardCard => ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_forest_grove', progress: 1, completed: false }], hand: [mk('a1'), mk('a2')], board: [] };
    s = reduce(s, { type: 'play', uid: 'a1' });
    expect(s.activeQuests![0]!.progress).toBe(3); // 1 + (Pennycat + its summoned Stray)
    expect(s.activeQuests![0]!.completed).toBe(false);
    s = reduce(s, { type: 'play', uid: 'a2' });
    expect(s.activeQuests![0]!.completed).toBe(true); // 2 more entries clears the 5-Beast bar
  });

  it('a summon objective is tribe-gated: playing NEUTRAL minions does not tick "Summon 5 Beasts"', () => {
    const plain = BUYABLE_CARDS.find((c) => c.tribe === 'neutral' && !c.tribe2 && !c.chooseOne && !c.target && !c.effects.some((e) => e.on === 'onPlay' || e.on === 'onSummon'));
    if (!plain) return; // no vanilla neutral in the set — skip rather than false-fail
    const mk = (uid: string): BoardCard => ({ uid, cardId: plain.id, tribe: plain.tribe, attack: plain.attack, health: plain.health, keywords: [...plain.keywords], golden: false });
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_forest_grove', progress: 0, completed: false }], hand: [mk('n1'), mk('n2')], board: [] };
    s = reduce(s, { type: 'play', uid: 'n1' });
    s = reduce(s, { type: 'play', uid: 'n2' });
    expect(s.activeQuests![0]!.progress).toBe(0); // neutral summons don't count toward a Beast objective
  });

  it('Forest Grove: summoning 5 Beasts grants a random Beast and schedules a repeat', () => {
    // Pennycat (beast, played) + its Stray (beast token) = 2 Beast summons per play; from progress 1, two plays
    // clear the 5-Beast bar with no triple.
    const mk = (uid: string): BoardCard => ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_forest_grove', progress: 1, completed: false }], hand: [mk('m1'), mk('m2')], board: [] };
    for (const uid of ['m1', 'm2']) s = reduce(s, { type: 'play', uid });
    expect(s.activeQuests![0]!.completed).toBe(true);
    // Immediate reward: a random Beast landed in hand.
    expect(s.hand.some((c) => { const d = CARD_INDEX[c.cardId]; return !!d && (d.tribe === 'beast' || d.tribe2 === 'beast'); })).toBe(true);
    // …and the "repeat in 2 turns" is scheduled.
    expect(s.pendingQuestRewards).toEqual([{ questId: 'q_forest_grove', turnsLeft: 2 }]);
  });

  it('Forest Grove "repeat in 2 turns" re-grants the reward after two turn-advances', () => {
    const tank = (uid: string): BoardCard => ({ uid, cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false });
    const beastInHand = (st: RunState): boolean => st.hand.some((c) => { const d = CARD_INDEX[c.cardId]; return !!d && (d.tribe === 'beast' || d.tribe2 === 'beast'); });
    let s: RunState = { ...createRun(1), wave: 1, tier: 6, phase: 'recruit', resolve: 999, maxResolve: 999, armor: 999, board: [tank('t1')], hand: [], pendingQuestRewards: [{ questId: 'q_forest_grove', turnsLeft: 2 }] };
    // Turn advance #1: countdown 2 → 1, nothing granted yet.
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.pendingQuestRewards).toEqual([{ questId: 'q_forest_grove', turnsLeft: 1 }]);
    expect(beastInHand(s)).toBe(false);
    // Turn advance #2: 1 → 0 → fires (a random Beast reaches hand); the schedule clears.
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.pendingQuestRewards ?? []).toEqual([]);
    expect(beastInHand(s)).toBe(true);
  });

  it('a "Trigger N Shouts" objective ticks once per Battlecry fire (Echoing Roar)', () => {
    const mk = (uid: string): BoardCard => ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_echoing_roar', progress: 0, completed: false }], hand: [mk('a1'), mk('a2')], board: [] };
    s = reduce(s, { type: 'play', uid: 'a1' });
    expect(s.activeQuests![0]!.progress).toBe(1); // one Shout fired = one trigger
    s = reduce(s, { type: 'play', uid: 'a2' });
    expect(s.activeQuests![0]!.progress).toBe(2);
  });

  it('shout-repeat rewards stack ADDITIVELY with Drakko + each other + themselves (owner ruling 2026-07-08)', () => {
    // `lastShoutFires` is how many times the played Battlecry fired — the additive total across every source.
    const penny = (uid: string): BoardCard => ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
    // Drakko (drummer) + Warm Embers (first Shout each round triggers twice): first Shout = 1 + 1(Drakko) + 1(WE) = 3.
    let s: RunState = {
      ...createRun(1), tier: 6, phase: 'recruit', shoutFirstDoubleEachRound: true,
      board: [{ uid: 'd', cardId: 'drummer', tribe: 'neutral', attack: 3, health: 3, keywords: [], golden: false }],
      hand: [penny('p1')],
    };
    s = reduce(s, { type: 'play', uid: 'p1' });
    expect(s.lastShoutFires).toBe(3);

    // Golden Drakko (+2) + Hoardwake ×1 (+1 always) + Warm Embers (+1 first): first = 1+2+1+1 = 5; next = 1+2+1 = 4.
    let t: RunState = {
      ...createRun(1), tier: 6, phase: 'recruit', shoutFirstDoubleEachRound: true, shoutExtraAlways: 1,
      board: [{ uid: 'd', cardId: 'drummer', tribe: 'neutral', attack: 3, health: 3, keywords: [], golden: true }],
      hand: [penny('p1'), penny('p2')],
    };
    t = reduce(t, { type: 'play', uid: 'p1' });
    expect(t.lastShoutFires).toBe(5); // first Shout this round
    t = reduce(t, { type: 'play', uid: 'p2' });
    expect(t.lastShoutFires).toBe(4); // consecutive Shout (no Warm Embers freebie)
  });

  it('Drakko the Drummer makes a played Shout count TWICE toward a Shout objective', () => {
    let s: RunState = {
      ...createRun(1), tier: 6, phase: 'recruit',
      activeQuests: [{ questId: 'q_echoing_roar', progress: 0, completed: false }], // Trigger 6 Shouts
      board: [{ uid: 'd', cardId: 'drummer', tribe: 'neutral', attack: 3, health: 3, keywords: [], golden: false }], // Drakko: Battlecries fire twice
      hand: [{ uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }], // Pennycat: a Battlecry (Shout)
    };
    s = reduce(s, { type: 'play', uid: 'a' });
    expect(s.activeQuests![0]!.progress).toBe(2); // Drakko re-fires the Battlecry → 2 Shout triggers
  });

  it('Warm Embers: a banked charge makes the next played Shout trigger twice (Pennycat → 2 Strays), then reverts', () => {
    const mk = (uid: string): BoardCard => ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
    // Charged: Pennycat's Battlecry fires twice → 2 Strays; one charge is spent.
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', shoutDoubleCharges: 2, hand: [mk('a1')], board: [] };
    s = reduce(s, { type: 'play', uid: 'a1' });
    expect(s.board.filter((c) => c.cardId === 'stray').length).toBe(2);
    expect(s.shoutDoubleCharges).toBe(1);
    // Uncharged: the same play summons a single Stray (Drakko-free baseline).
    let t: RunState = { ...createRun(1), tier: 6, phase: 'recruit', shoutDoubleCharges: 0, hand: [mk('b1')], board: [] };
    t = reduce(t, { type: 'play', uid: 'b1' });
    expect(t.board.filter((c) => c.cardId === 'stray').length).toBe(1);
  });
});

describe('Dragon quests + reward minions', () => {
  const dragon = (uid: string, cardId = 'cleric', attack = 3, health = 3): BoardCard => ({ uid, cardId, tribe: 'dragon', attack, health, keywords: [], golden: false });

  it('Hoard Whelp — Sell: get 6 Gold (golden 12)', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', embers: 0, board: [{ uid: 'h', cardId: 'hoardwhelp', tribe: 'dragon', attack: 3, health: 2, keywords: [], golden: false }] };
    s = reduce(s, { type: 'sell', uid: 'h' });
    // base sell value + the on-sell 6 Gold.
    expect(s.embers).toBe(CONFIG.sellValue + 6);
  });

  it('Skybound Pact (tribeStats) advances by +Attack/+Health buffs granted to Dragons', () => {
    let s: RunState = {
      ...createRun(1), tier: 6, phase: 'recruit', embers: 10,
      activeQuests: [{ questId: 'q_skybound_pact', progress: 0, completed: false }],
      board: [dragon('d')], hand: [{ uid: 'gr', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'gr' }); // Growth: +3/+4 to the board Dragon → +7 stats
    expect(s.activeQuests![0]!.progress).toBe(7);
  });

  it('Hoardwake Ritual (shoutRepeat always) makes a played Shout fire an extra time', () => {
    // Two Trail Foragers on board; playing a Beast fires no Battlecry — use Pennycat (Battlecry: summon a Stray).
    let s: RunState = {
      ...createRun(1), tier: 6, phase: 'recruit', shoutExtraAlways: 1,
      hand: [{ uid: 'a', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }], board: [],
    };
    s = reduce(s, { type: 'play', uid: 'a' });
    // Pennycat's Battlecry fires twice (base + the permanent extra) → 2 Strays.
    expect(s.board.filter((c) => c.cardId === 'stray').length).toBe(2);
  });

  it('Skybound Archivist — End of Turn: weakest Dragon gains 20% of the strongest Dragon\'s stats', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [
        { uid: 'arc', cardId: 'skybound', tribe: 'dragon', attack: 5, health: 4, keywords: [], golden: false },
        { uid: 'strong', cardId: 'cleric', tribe: 'dragon', attack: 10, health: 10, keywords: [], golden: false },
        { uid: 'weak', cardId: 'cleric', tribe: 'dragon', attack: 1, health: 1, keywords: [], golden: false },
      ],
    };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn fires
    const weak = s.board.find((c) => c.uid === 'weak')!;
    expect([weak.attack, weak.health]).toEqual([1 + 2, 1 + 2]); // +20% of 10/10 = +2/+2
  });

  it("Taragosa's Heir copies every THIRD stat-gain of the strongest Dragon", () => {
    const buff = { uid: 'gr', cardId: 'growth', tribe: 'neutral' as const, attack: 0, health: 1, keywords: [], golden: false };
    let s: RunState = {
      ...createRun(1), tier: 6, phase: 'recruit', embers: 30,
      board: [
        { uid: 'heir', cardId: 'taragosaheir', tribe: 'dragon', attack: 7, health: 6, keywords: [], golden: false },
        { uid: 'strong', cardId: 'cleric', tribe: 'dragon', attack: 20, health: 20, keywords: [], golden: false },
      ],
      hand: [{ ...buff, uid: 'g1' }, { ...buff, uid: 'g2' }, { ...buff, uid: 'g3' }],
    };
    // Growth buffs both Dragons +3/+4 each cast. The strongest is 'strong'. 3rd gain → mirror +3/+4 onto the Heir.
    s = reduce(s, { type: 'play', uid: 'g1' });
    s = reduce(s, { type: 'play', uid: 'g2' });
    let heir = s.board.find((c) => c.uid === 'heir')!;
    expect([heir.attack, heir.health]).toEqual([7 + 6, 6 + 8]); // only Growth's own board buffs so far (no mirror yet)
    s = reduce(s, { type: 'play', uid: 'g3' });
    heir = s.board.find((c) => c.uid === 'heir')!;
    // 3rd gain mirrors the strongest's +3/+4 on top of the Heir's own Growth buffs (3 × +3/+4 = +9/+12) → + mirror +3/+4.
    expect([heir.attack, heir.health]).toEqual([7 + 9 + 3, 6 + 12 + 4]);
  });
});

describe('Beast quests (combat objectives + rewards)', () => {
  // A minimal settled CombatResult with an injectable quest tally, driven through the real `resolveCombat`
  // settle path — so combat-phase objectives advance exactly as they do after a live fight.
  const combatWith = (over: Partial<CombatResult>): CombatResult => ({
    events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
    initial: { player: [], enemy: [] }, ...over,
  });
  const zeroTally = () => ({ attack: 0, summonCombat: 0, slaughter: 0, attackByTribe: {}, summonCombatByTribe: {}, slaughterByTribe: {} });
  const settle = (quest: string, over: Partial<CombatResult>, extra?: Partial<RunState>): RunState =>
    reduce({ ...createRun(1), phase: 'combat', combatSettled: false, lastCombat: combatWith(over), activeQuests: [{ questId: quest, progress: 0, completed: false }], ...extra }, { type: 'resolveCombat' });

  it('Blood Trail (slaughter, any tribe) advances by the tally and arms the combat flag', () => {
    const s = settle('q_blood_trail', { enemyDeaths: 2, playerQuestTally: { ...zeroTally(), slaughter: 2, slaughterByTribe: { beast: 2 } } });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.questFlags?.bloodTrail).toBe(true);
  });

  it('Apex Hunt (slaughter WITH Beasts) counts only beast-attributed kills', () => {
    // 6 slaughters but only 3 by Beasts → the beast-narrowed objective sits at 3/4, incomplete.
    const s = settle('q_apex_hunt', { playerQuestTally: { ...zeroTally(), slaughter: 6, slaughterByTribe: { beast: 3 } } });
    expect(s.activeQuests![0]!.progress).toBe(3);
    expect(s.activeQuests![0]!.completed).toBe(false);
  });

  it('Den Marker (tribeAura) folds +3 Attack into the Beast aura + buffs current Beasts', () => {
    const beast: BoardCard = { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false };
    const s = settle('q_den_marker', { playerQuestTally: { ...zeroTally(), summonCombat: 8 } }, { board: [beast] });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.beastBuyAtk).toBe(3);
    expect(s.board[0]!.attack).toBe(4); // 1 base + 3 aura
  });

  it('Echoing Coop (deathrattle/Echo objective) reads the combat Deathrattle tally', () => {
    const s = settle('q_echoing_coop', { playerDeathrattles: 14 });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.questFlags?.echoingCoop).toBe(true);
  });

  it('The Old Hunt carry-back grows the Beast aura + buffs current Beasts', () => {
    const beast: BoardCard = { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false };
    const s = settle('q_capstone_neutral', { playerBeastBuyAtkGain: 21 }, { board: [beast] });
    expect(s.beastBuyAtk).toBe(21); // pumped even though the (neutral) active quest is unrelated
    expect(s.board[0]!.attack).toBe(23);
  });

  it('Feed the Alpha (recurringGrant) conjures its spell to hand every turn', () => {
    const tank: BoardCard = { uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false };
    let s: RunState = { ...createRun(1), wave: 1, tier: 6, phase: 'recruit', resolve: 999, maxResolve: 999, armor: 999, board: [tank], hand: [], questRecurringGrants: ['feedalpha'] };
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.some((c) => c.cardId === 'feedalpha')).toBe(true);
  });

  it("Trail Forager's sell value climbs +1 per Beast played", () => {
    const forager: BoardCard = { uid: 'f', cardId: 'trailforager', tribe: 'beast', attack: 1, health: 4, keywords: [], golden: false };
    const beast: BoardCard = { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false };
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', board: [forager], hand: [beast] };
    expect(sellValueOf(s.board[0]!)).toBe(2);
    s = reduce(s, { type: 'play', uid: 'b' });
    const f = s.board.find((c) => c.cardId === 'trailforager')!;
    expect(f.sellBonus).toBe(1);
    expect(sellValueOf(f)).toBe(3);
  });

  it('Feed the Alpha spell sells the target and feeds the right-most Beast', () => {
    const beastL: BoardCard = { uid: 'bl', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false };
    const fodder: BoardCard = { uid: 'fo', cardId: 'sandbag', tribe: 'neutral', attack: 3, health: 5, keywords: [], golden: false };
    const beastR: BoardCard = { uid: 'br', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false };
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', embers: 0, board: [beastL, fodder, beastR], hand: [{ uid: 'sp', cardId: 'feedalpha', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'fo' });
    expect(s.board.some((c) => c.uid === 'fo')).toBe(false); // sold
    expect(s.embers).toBe(sellValueOf(fodder)); // gained the sell value
    expect(s.board.find((c) => c.uid === 'br')!.attack).toBe(4); // right-most Beast got +3/+5
    expect(s.board.find((c) => c.uid === 'bl')!.attack).toBe(1); // left Beast untouched
  });
});

describe('Undead quests — combat-objective completion + reward application', () => {
  // A minimal winning combat result carrying the tallies a quest reads; `resolveCombat` settles it, advancing
  // the active combat quests. Optional carry-backs (max gold, survivors, …) default off.
  const settleWith = (s: RunState, over: Partial<CombatResult>): RunState =>
    reduce({ ...s, phase: 'combat', lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, ...over } as CombatResult }, { type: 'resolveCombat' });

  it('friendlyDeath objective + gainGold reward (Bone Ledger): 12 deaths → +10 Gold next shop', () => {
    const base: RunState = { ...createRun(1), tier: 6, activeQuests: [{ questId: 'q_bone_ledger', progress: 0, completed: false }] };
    // Baseline: settle the SAME fight with no quest, to read the next shop's Gold without the reward.
    const control = settleWith({ ...createRun(1), tier: 6 }, { playerDeaths: 12 });
    const s = settleWith(base, { playerDeaths: 12 });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.embers).toBe(control.embers + 10); // the 10 Gold is banked into the next shop
  });

  it('echoRepeat "always" reward (Funeral Engine) grants a permanent extra Echo trigger', () => {
    const s = settleWith({ ...createRun(1), tier: 6, activeQuests: [{ questId: 'q_funeral_engine', progress: 0, completed: false }] }, { playerDeathrattles: 20 });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.echoExtraAlways).toBe(1);
  });

  it('echoRepeat "firstEachCombat" reward (Grave Contract) arms the first-Echo bonus', () => {
    const s = settleWith({ ...createRun(1), tier: 6, activeQuests: [{ questId: 'q_grave_contract', progress: 0, completed: false }] }, { playerDeathrattles: 4 });
    expect(s.echoFirstEachCombat).toBe(1);
  });

  it('boneThrone reward (The Bone Throne) records its death step', () => {
    const s = settleWith({ ...createRun(1), tier: 6, activeQuests: [{ questId: 'q_the_bone_throne', progress: 0, completed: false }] }, { playerDeaths: 30 });
    expect(s.boneThroneStep).toBe(7);
  });

  it('a repeatable quest (Ossuary Rite) re-arms and grants once per threshold crossed', () => {
    // 25 Echo triggers vs a count-8 repeatable → grants 3 times, leaves 1 progress, stays active (not completed).
    const s = settleWith({ ...createRun(1), tier: 6, hand: [], activeQuests: [{ questId: 'q_ossuary_rite', progress: 0, completed: false }] }, { playerDeathrattles: 25 });
    expect(s.activeQuests![0]!.completed).toBe(false); // re-armed
    expect(s.activeQuests![0]!.progress).toBe(1); // 25 - 3×8
    expect(s.hand.filter((c) => c.cardId === 'ossuaryrite').length).toBe(3);
  });

  it('Grave Robber (sell 5) grants Crypt Broker — a reward-only token, never in the shop', () => {
    const mk = (uid: string) => ({ uid, cardId: 'pack', tribe: 'beast' as const, attack: 2, health: 2, keywords: [], golden: false });
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_grave_robber', progress: 4, completed: false }], board: [mk('b1')], hand: [] };
    s = reduce(s, { type: 'sell', uid: 'b1' });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.hand.some((c) => c.cardId === 'cryptbroker')).toBe(true);
    // Crypt Broker / Bone Taxer / Gravetwin / Ossuary Rite are token: true → excluded from the buyable pool.
    for (const id of ['cryptbroker', 'bonetaxer', 'gravetwin', 'ossuaryrite']) {
      expect(BUYABLE_CARDS.some((c) => c.id === id)).toBe(false);
    }
  });

  it('Crypt Broker Sell: conjures a random Echo minion to hand and triggers its Deathrattle now', () => {
    // Selling Crypt Broker gets a random Echo minion (a Deathrattle body) into hand and fires its Echo out of
    // combat — so the run Deathrattle tally rises even though nothing was in combat.
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', board: [{ uid: 'cb', cardId: 'cryptbroker', tribe: 'undead', attack: 1, health: 1, keywords: [], golden: false }], hand: [] };
    const drBefore = s.deathrattlesTriggered;
    s = reduce(s, { type: 'sell', uid: 'cb' });
    expect(s.hand.length).toBe(1); // the conjured Echo minion
    expect(CARD_INDEX[s.hand[0]!.cardId]!.effects.some((e) => e.on === 'onDeath')).toBe(true); // it IS an Echo minion
    expect(s.deathrattlesTriggered).toBe(drBefore + 1); // its Echo fired (tallied) out of combat
  });
});

describe('Mech/neutral quests — objectives, filtered grants, new rewards, cards', () => {
  const settleWith = (s: RunState, over: Partial<CombatResult>): RunState =>
    reduce({ ...s, phase: 'combat', lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, ...over } as CombatResult }, { type: 'resolveCombat' });
  const mag = (uid: string) => ({ uid, cardId: 'moneybot', tribe: 'mech' as const, attack: 3, health: 3, keywords: ['M'] as Keyword[], golden: false });

  it('playAttachment ticks on playing a Magnetic; Perfect Machine grants Perfect Core', () => {
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_perfect_machine', progress: 5, completed: false }], board: [], hand: [mag('h1')] };
    s = reduce(s, { type: 'play', uid: 'h1' });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.hand.some((c) => c.cardId === 'perfectcore')).toBe(true);
  });

  it('Scrap Contract counts only Mech sells → grants Scrap Vendor', () => {
    // A non-Mech sell does NOT advance it; a Mech sell does.
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_scrap_contract', progress: 0, completed: false }],
      board: [{ uid: 'beast', cardId: 'pack', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }, mag('m1'), mag('m2'), mag('m3')], hand: [] };
    s = reduce(s, { type: 'sell', uid: 'beast' });
    expect(s.activeQuests![0]!.progress).toBe(0); // a Beast sale doesn't count
    s = reduce(s, { type: 'sell', uid: 'm1' });
    s = reduce(s, { type: 'sell', uid: 'm2' });
    s = reduce(s, { type: 'sell', uid: 'm3' });
    expect(s.activeQuests![0]!.completed).toBe(true); // 3 Mech sales
    expect(s.hand.some((c) => c.cardId === 'scrapvendor')).toBe(true);
  });

  it('Last Rites (multi) grants a random ECHO minion + arms the first-Echo bonus', () => {
    const s = settleWith({ ...createRun(1), tier: 6, hand: [], activeQuests: [{ questId: 'q_last_rites', progress: 0, completed: false }] }, { playerDeathrattles: 14 });
    expect(s.echoFirstEachCombat).toBe(1);
    expect(s.hand.length).toBe(1);
    expect(CARD_INDEX[s.hand[0]!.cardId]!.effects.some((e) => e.on === 'onDeath')).toBe(true); // it IS an Echo minion
  });

  it('rally objective + rallyRepeat reward (Spark Permit): 3 Rallies → first-Rally bonus armed', () => {
    const s = settleWith({ ...createRun(1), tier: 6, activeQuests: [{ questId: 'q_spark_permit', progress: 0, completed: false }] }, { playerRallies: 3 });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.rallyFirstEachCombat).toBe(1);
  });

  it('Infinite Assembly (multi): 30 Rallies → a random Rally minion + permanent Rally doubler', () => {
    const s = settleWith({ ...createRun(1), tier: 6, hand: [], activeQuests: [{ questId: 'q_infinite_assembly', progress: 0, completed: false }] }, { playerRallies: 30 });
    expect(s.rallyExtraAlways).toBe(1);
    expect(s.hand.length).toBe(1);
    expect(CARD_INDEX[s.hand[0]!.cardId]!.keywords.includes('RL')).toBe(true); // it IS a Rally minion
  });

  it('Shared Circuit reward records its SoC Ward count; new reward cards are reward-only tokens', () => {
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_shared_circuit', progress: 13, completed: false }], board: [], hand: [mag('h1')] };
    s = reduce(s, { type: 'play', uid: 'h1' }); // 14th attachment
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.sharedCircuitWard).toBe(3);
    for (const id of ['scrapvendor', 'chorusengine', 'perfectcore']) {
      expect(BUYABLE_CARDS.some((c) => c.id === id)).toBe(false);
    }
  });
});

describe('Demon quests — consume/imp objectives, fodder reward, flags, cards', () => {
  const settleWith = (s: RunState, over: Partial<CombatResult>): RunState =>
    reduce({ ...s, phase: 'combat', lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, ...over } as CombatResult }, { type: 'resolveCombat' });
  const demon = (uid: string, cardId: string) => ({ uid, cardId, tribe: 'demon' as const, attack: 2, health: 2, keywords: [] as Keyword[], golden: false });

  it('consumeFodder objective + fodderReward (Small Offering): Herald feeds every Demon', () => {
    // Board Demon + Herald (played) = 2 Demons each Consume a Fodder → +2 Consumed.
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_small_offering', progress: 1, completed: false }], board: [demon('d1', 'feed')], hand: [demon('h1', 'heraldapoc')] };
    s = reduce(s, { type: 'play', uid: 'h1' });
    expect(s.activeQuests![0]!.completed).toBe(true); // 1 + 2 Consumed ≥ 3
    expect((s.pendingTavern ?? []).filter((id) => id === 'fred').length).toBe(2); // reward queued 2 Fodder
  });

  it('consumeStats objective (Maw of the Run) counts total Consumed stats → grants Run Maw', () => {
    let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', activeQuests: [{ questId: 'q_maw_of_the_run', progress: 196, completed: false }], board: [demon('d1', 'feed')], hand: [demon('h1', 'heraldapoc')] };
    s = reduce(s, { type: 'play', uid: 'h1' }); // 2 Fodder Consumed = 4 stats → 196 + 4 = 200
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.hand.some((c) => c.cardId === 'runmaw')).toBe(true);
  });

  it('summonImp objective (Imp Census) reads the combat imp tally → grants a random Demon', () => {
    const s = settleWith({ ...createRun(1), tier: 6, hand: [], activeQuests: [{ questId: 'q_imp_census', progress: 0, completed: false }] }, { playerImpsSummoned: 6 });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.hand.some((c) => { const d = CARD_INDEX[c.cardId]; return d?.tribe === 'demon' || d?.tribe2 === 'demon'; })).toBe(true);
  });

  it('Pit Without End (summonImp) arms its board-wipe Imp count; new cards are reward-only tokens', () => {
    const s = settleWith({ ...createRun(1), tier: 6, activeQuests: [{ questId: 'q_pit_without_end', progress: 39, completed: false }] }, { playerImpsSummoned: 1 });
    expect(s.activeQuests![0]!.completed).toBe(true); // 39 + 1 = 40
    expect(s.pitWithoutEndImps).toBe(3);
    for (const id of ['contractimp', 'heraldapoc', 'runmaw', 'implosion']) {
      expect(BUYABLE_CARDS.some((c) => c.id === id)).toBe(false);
    }
  });
});

describe('Rulebreaker quests — dupes, spell doubling, compound objective, cost mods', () => {
  const settleWith = (s: RunState, over: Partial<CombatResult>): RunState =>
    reduce({ ...s, phase: 'combat', lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] }, ...over } as CombatResult }, { type: 'resolveCombat' });

  it('Dupes: winRound completes it, then the first minion bought each turn is duplicated', () => {
    // Complete "Win 4 rounds".
    let s: RunState = { ...createRun(1), tier: 6, activeQuests: [{ questId: 'q_dupes', progress: 3, completed: false }] };
    s = settleWith(s, {});
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.dupeFirstBuyEachTurn).toBe(true);
    // Now a bought minion lands in hand TWICE (bought + dupe), and only for the first buy of the turn.
    s = { ...s, phase: 'recruit', embers: 20, hand: [], dupeUsedThisTurn: false, shop: [{ uid: 's1', cardId: 'pack' }, { uid: 's2', cardId: 'alley' }] };
    s = reduce(s, { type: 'buy', uid: 's1' });
    expect(s.hand.filter((c) => c.cardId === 'pack').length).toBe(2); // bought + dupe
    s = reduce(s, { type: 'buy', uid: 's2' });
    expect(s.hand.filter((c) => c.cardId === 'alley').length).toBe(1); // second buy is NOT duped
  });

  it('The Author\'s Hand compound objective completes when Shout, Echo, AND Rally each reach the count', () => {
    // Pre-loaded to 6/6/5 — one more Rally (from combat) tips it over and arms all four first-each doublers.
    const s = settleWith({ ...createRun(1), tier: 6, activeQuests: [{ questId: 'q_authors_hand', progress: 5, completed: false, subProgress: { shout: 6, echo: 6, rally: 5 } }] }, { playerRallies: 1 });
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.shoutFirstDoubleEachRound).toBe(true);
    expect(s.echoFirstEachCombat).toBe(1);
    expect(s.rallyFirstEachCombat).toBe(1);
    expect(s.slaughterFirstEachCombat).toBe(1);
  });

  it('spell-doubling rewards fold into the cast count', () => {
    const spell = SPELL_CARDS.find((c) => !c.singleCast && !c.target)!; // an untargeted spell (base 1 cast)
    expect(spellCasts({ ...createRun(1) }, spell)).toBe(1);
    expect(spellCasts({ ...createRun(1), spellDoubleAlways: true }, spell)).toBe(2); // Ancient Runes
    // Spell Thesis: first spell of the turn doubles, then reverts.
    const thesis = { ...createRun(1), spellFirstDoubleEachTurn: true, spellFirstUsedThisTurn: false };
    expect(spellCasts(thesis, spell)).toBe(2);
    expect(spellCasts(thesis, spell)).toBe(1); // consumed
  });

  it('Lazarus reduces shop spell cost while on the board; new cards are reward-only tokens', () => {
    expect(spellCostReduction({ ...createRun(1), spellCostMod: 0, board: [] } as RunState)).toBe(0);
    const withLaz = { ...createRun(1), spellCostMod: 0, board: [{ uid: 'l', cardId: 'lazarus', tribe: 'neutral' as const, attack: 5, health: 4, keywords: [] as Keyword[], golden: false }] } as RunState;
    expect(spellCostReduction(withLaz)).toBe(1);
    for (const id of ['lazarus', 'taurustruth', 'chimerus', 'goldcrafter']) {
      expect(BUYABLE_CARDS.some((c) => c.id === id)).toBe(false);
    }
  });
});

describe('triple: a welded host does not carry Magnetic into its golden', () => {
  const mk = (uid: string, cardId: string, kw: Keyword[]): BoardCard => ({ uid, cardId, tribe: 'mech', attack: 2, health: 2, keywords: kw, golden: false });

  it('Beatbot/Moe that gained M from attachments triples into a NON-Magnetic golden (it will not play as an Attachment)', () => {
    // One copy carries a welded 'M' (from receiving attachments); the base card (Beatbot) is not Magnetic.
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [mk('a', 'beatboxer', ['M'])], hand: [mk('b', 'beatboxer', []), mk('c', 'beatboxer', [])] };
    s = reduce(s, { type: 'play', uid: 'c' }); // 3rd copy hits the board → triples into a golden
    const golden = [...s.board, ...s.hand].find((cd) => cd.cardId === 'beatboxer' && cd.golden);
    expect(golden).toBeDefined();
    expect(golden!.keywords.includes('M')).toBe(false); // the welded M did NOT carry into the golden
  });

  it('a genuinely Magnetic base card (Money Bot) still keeps M through a triple', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [mk('x', 'moneybot', ['M'])], hand: [mk('y', 'moneybot', ['M']), mk('z', 'moneybot', ['M'])] };
    s = reduce(s, { type: 'play', uid: 'z' });
    const golden = [...s.board, ...s.hand].find((cd) => cd.cardId === 'moneybot' && cd.golden);
    expect(golden!.keywords.includes('M')).toBe(true);
  });
});

describe('quest fixes: recruit-summoned Imp buff + triple-on-quest-grant', () => {
  const mk = (uid: string, cardId: string): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
  };

  it('a recruit-summoned Imp inherits the run-wide Imp buff (Crypt Broker / Graverobber path)', () => {
    // Graverobber destroys Imp King out of combat → its Deathrattle summons Imps in the shop; those Imps must
    // carry the run-wide Imp aura (impBuff). Compare with vs without the aura to isolate its +3/+3.
    const impsWith = (impBuff: { attack: number; health: number }): BoardCard[] => {
      let s: RunState = { ...createRun(1), tier: 6, phase: 'recruit', impBuff, board: [mk('ik', 'impking')], hand: [mk('gr', 'graverobber')] };
      s = reduce(s, { type: 'play', uid: 'gr' });
      s = reduce(s, { type: 'battlecryTarget', targetUid: 'ik' });
      return s.board.filter((c) => c.cardId === 'impscrap');
    };
    const base = impsWith({ attack: 0, health: 0 });
    const buffed = impsWith({ attack: 3, health: 3 });
    expect(base.length).toBeGreaterThan(0);
    expect(buffed.length).toBe(base.length);
    expect(buffed[0]!.attack - base[0]!.attack).toBe(3); // the Imp aura landed on the summoned Imp
    expect(buffed[0]!.health - base[0]!.health).toBe(3);
  });

  it('completing a quest that grants your 3rd copy triples it into a golden', () => {
    let s: RunState = {
      ...createRun(1), tier: 6, phase: 'recruit',
      activeQuests: [{ questId: 'q_dark_bargain', progress: 4, completed: false }], // sell 5 → Get a Contract Imp
      board: [mk('sellme', 'pack')],
      hand: [mk('h1', 'contractimp'), mk('h2', 'contractimp')], // two copies already held
    };
    s = reduce(s, { type: 'sell', uid: 'sellme' }); // 5th sell → completes → grants the 3rd Contract Imp → triple
    expect(s.activeQuests![0]!.completed).toBe(true);
    const copies = [...s.board, ...s.hand].filter((c) => c.cardId === 'contractimp');
    expect(copies.length).toBe(1); // three combined into one
    expect(copies[0]!.golden).toBe(true);
  });
});
