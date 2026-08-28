/**
 * DOC BOT LANE `interactionFamilyMatrix` — the TRIGGER-FAMILY interaction matrix: how trigger families COMPOSE when one fires
 * through another, pinned at the family level so no card pair ever needs enumerating.
 *
 * Sibling of interactionMatrix.test.ts, which pins single multipliers, additivity and
 * eligibility. This file pins the RULED compositions — a fixture per pair whose semantics are already
 * established (code comment with an owner ruling, shared fold helper, or skill doc) — and refuses to guess
 * at the rest: every unruled-but-debatable pair is written up in docs/rulebook/interaction-ambiguities.md
 * for the owner, never invented here.
 *
 * ── COVERAGE TABLE (the honesty ledger — every family pair, no silent gaps) ─────────────────────────────
 *
 *  PAIR                                                  STATUS      EVIDENCE / WHERE
 *  battlecry × shop replay (Myra/Resonance/Last Word)    PINNED      P1–P2 — recruit.ts replayBattlecry uses
 *                                                                    drummerRepeats (1 + card multiplier); the
 *                                                                    play-only extras (Hoardwake / Warm Embers)
 *                                                                    deliberately do NOT apply ("Applies ONLY to
 *                                                                    real plays", playedShoutRepeats comment).
 *  battlecry × combat replay (PartingCry/Dawnclaw/Ryme/   PINNED      P9–P10 — owner APPROVE 2026-08-27
 *  Embercrest/AncestralRoar/SharedScripture/WarChorus)               (q-interact-combat-shout-multipliers): EVERY
 *                                                                    combat Shout re-fire folds drakkoRepeats —
 *                                                                    the flat paths were an omission, fixed.
 *                                                                    Rune paths pinned in runeBatch4T4 (Roar,
 *                                                                    Scripture) + runeBatch10 (War Chorus).
 *  battlecry multiplier × same-card copy (Drakko×2)      PINNED      P3 — non-stacking best-of + golden ×2
 *                                                                    (types.ts extraTriggerFires comment).
 *  battlecry multiplier × DIFFERENT non-stacking card    PINNED      R-MULT-01 (owner REVISE 2026-08-27) +
 *  (Drakko + Zyff; also Uron + Chronos on endOfTurn)                 R-MULT-02 (owner APPROVE 2026-08-28,
 *                                                                    q-interact2-32aa654f/faeb3c44): best-of
 *                                                                    across different non-stacking cards is the
 *                                                                    law in EVERY family. P12–P13 pin the
 *                                                                    endOfTurn + startOfCombat halves; was
 *                                                                    interaction-ambiguities.md Q1.
 *  deathrattle multiplier × multiplier (Sylus×2,         PINNED      P4 — stacking cards SUM, non-stacking take
 *  Sylus+Zyff)                                                       best, folds add (types.ts + zyff def comment,
 *                                                                    owner ruling 2026-07-08 "additive").
 *  deathrattle × forced fire (Deathsayer / Herald /      PINNED      P5–P6 — procs = (1 + additive echo extras)
 *  Echohorn — the no-death Echo)                                     × the FIRER's gild (factories.ts triggerEchoOn
 *                                                                    strict comment, "every Echo multiplier the
 *                                                                    side has × this minion's gild").
 *  deathrattle × forced fire (EMPTY GRAVES quest)        PINNED      P11 — owner APPROVE 2026-08-27
 *                                                                    (q-interact-empty-graves-flat): the forced
 *                                                                    Echo folds (1 + playerEchoExtras) × the
 *                                                                    marked body's gild, like every other
 *                                                                    forced-Echo path (simulate.ts).
 *  first-Echo bonus (Grave Contract / Last Rites /       AMBIGUOUS   interaction-ambiguities.md Q4 — a forced
 *  Catacomb) × a forced no-death Echo                                no-death Echo consumes the once-per-combat
 *                                                                    charge before any real death can use it.
 *  rally × rally doublers (card multiplier + Rallying    PINNED      P7 — ALL ADDITIVE: 1 + extraTriggerFires
 *  Offensive rune + Infinite Assembly …)                             ('rally') + rune extras (simulate.ts
 *                                                                    playerRallyExtras comment + the Uron rally
 *                                                                    tally owner report).
 *  rally × deathrattle (Echo-THROUGH-Rally, Deathsayer)  PINNED      P5 — MULTIPLICATIVE across families: each
 *                                                                    rally fire runs the full echo fold (each
 *                                                                    family multiplies at its own boundary —
 *                                                                    ascent-gameplay skill: "Apply it at exactly
 *                                                                    ONE boundary").
 *  rally × slaughter                                     NOT A       Distinct trigger families with separate folds
 *                                                        COMPOSITION (Law of Teeth grants both, but each applies
 *                                                                    at its own trigger — slaughter's fold is
 *                                                                    exercised by simulate.ts killExtra + existing
 *                                                                    combat tests; they never fire through each
 *                                                                    other).
 *  endOfTurn replay × startOfCombat multiplier           PINNED      No new fixture: both phases consult the ONE
 *  (Rune of Combat Prowess × Rune of Twilight)           ELSEWHERE   shared fold `socTwilightExtraFires` (types.ts;
 *                                                                    owner reversal 2026-08-20 "the two runes
 *                                                                    STACK"), consumed at recruit.ts ~9265 and the
 *                                                                    combat SC pass — a drift is structurally
 *                                                                    impossible without editing the shared helper.
 *  ruby bounce × ruby bounce (Resonance Idol / Rune of   PINNED      P8 — a bounce applies stats via
 *  the Conduit — the Candle Conduit no-rebounce guard)               `gainRubyStats` → addBuff directly, NEVER back
 *                                                                    through fireOnRubyPlayed ("NO fireOnRubyPlayed
 *                                                                    - the no-rebounce guard", recruit.ts), so
 *                                                                    bounce counts are exact and finite.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult } from '@game/core';
import { createRun, type BoardCard, type RunState } from '../index';
import { endOfTurnRepeats, fireOnRubyPlayed, replayBattlecry } from '../recruit';

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};

const base = (board: BoardCard[]): RunState => ({
  ...createRun(0x16f1, 'aster'), embers: 60, board, hand: [], shop: [],
} as RunState);

// Keywords come from the def — the RL keyword is the gate the rally-multiplier loops check on the attacker.
const bm = (cardId: string, uid: string, attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...over } as unknown as BoardMinion);

const summonsOf = (r: CombatResult, tokenId: string): number =>
  r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === tokenId).length;
const ralliesOf = (r: CombatResult): number => r.events.filter((e) => e.type === 'rally').length;

describe('Doc Bot — trigger-family interaction matrix', () => {
  // P1 — battlecry × shop replay: a replayed Shout honours the card multiplier (Drakko).
  it('P1: a REPLAYED Shout fires (1 + Drakko) times — the multiplier follows the trigger into the replay path', () => {
    const fire = (board: BoardCard[]): number => {
      const s = base(board);
      const probe = s.board.find((c) => c.cardId === 'footman')!;
      const before = probe.attack;
      replayBattlecry(s, s.board.find((c) => c.cardId === 'deathswarmer')!);
      return probe.attack - before; // Deathswarmer: +1 Undead Attack per fire
    };
    expect(fire([card('d', 'deathswarmer'), card('u', 'footman')]), 'control: one fire, +1').toBe(1);
    expect(fire([card('d', 'deathswarmer'), card('u', 'footman'), card('m', 'drummer')]),
      'with Drakko a replayed Shout must fire 2× (recruit.ts replayBattlecry → drummerRepeats)').toBe(2);
  });

  // P2 — battlecry × shop replay: play-only extras do NOT apply to replays (deliberate, documented).
  it('P2: Hoardwake-style play-only extras (`shoutExtraAlways`) do NOT multiply a replayed Shout', () => {
    const s = base([card('d', 'deathswarmer'), card('u', 'footman'), card('m', 'drummer')]);
    (s as { shoutExtraAlways?: number }).shoutExtraAlways = 1; // applies to PLAYED Shouts only (playedShoutRepeats)
    const before = s.board.find((c) => c.uid === 'u')!.attack;
    replayBattlecry(s, s.board.find((c) => c.uid === 'd')!);
    expect(s.board.find((c) => c.uid === 'u')!.attack - before,
      'a replay is not a play: drummerRepeats only ("Applies ONLY to real plays", recruit.ts)').toBe(2);
  });

  // P3 — same-card multiplier copies: non-stacking best-of; golden doubles the contribution.
  it('P3: two Drakkos are still +1 (non-stacking best-of); a GOLDEN Drakko is +2', () => {
    const fire = (extras: BoardCard[]): number => {
      const s = base([card('d', 'deathswarmer'), card('u', 'footman'), ...extras]);
      const before = s.board.find((c) => c.uid === 'u')!.attack;
      replayBattlecry(s, s.board.find((c) => c.uid === 'd')!);
      return s.board.find((c) => c.uid === 'u')!.attack - before;
    };
    expect(fire([card('m1', 'drummer'), card('m2', 'drummer')]),
      'two plain Drakkos: the single best copy counts (types.ts extraTriggerFires) — 2 fires, not 3').toBe(2);
    expect(fire([card('m1', 'drummer', { golden: true, attack: 4, health: 8 })]),
      'a golden Drakko contributes extra×2 — 3 fires').toBe(3);
  });

  // P4 — deathrattle multiplier × multiplier: stacking cards SUM; non-stacking adds its best on top.
  it('P4: Sylus+Sylus = 3 Echo fires (stacking sums); Sylus+Zyff = 3 (sum + best) — additive, never multiplicative', () => {
    const run = (mults: BoardMinion[]): number => {
      const r = simulate([bm('deathlesshand', 'p0', 1, 1), ...mults], [bm('cryptwolf', 'e0', 9, 60)],
        makeRng(11), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 5 }));
      return summonsOf(r, 'footman');
    };
    expect(run([bm('sylus', 'm1', 1, 99), bm('sylus', 'm2', 1, 99)]),
      'Sylus stacks: 1 base + 1 + 1 (owner ruling 2026-07-08: every doubler folds ADDITIVELY)').toBe(3);
    expect(run([bm('sylus', 'm1', 1, 99), bm('zyff', 'm2', 1, 99)]),
      'Sylus (sum) + Zyff (best): +2 Echoes — the zyff def comment pins exactly this board').toBe(3);
  });

  // P5 — Echo-THROUGH-Rally (Deathsayer): each rally fire runs the FULL echo fold — multiplicative across
  // families, additive within each.
  it('P5: Deathsayer × Sylus — every rally-forced Echo honours the echo multipliers (summons = 2 × rallies)', () => {
    const run = (withSylus: boolean): { rallies: number; summons: number } => {
      const board = [bm('deathlesshand', 'p0', 1, 99), bm('deathsayer', 'p1', 3, 99),
        ...(withSylus ? [bm('sylus', 'p2', 1, 99)] : [])];
      // The enemy can't fight back (0 Attack) and dies fast, so the rally count stays small and the board
      // cap (7) is never hit by the Footman summons.
      const r = simulate(board, [bm('cryptwolf', 'e0', 0, 6)], makeRng(3), CARD_INDEX,
        combatSide({ tier: 5 }), combatSide({ tier: 5 }));
      expect(r.result).toBe('win');
      return { rallies: ralliesOf(r), summons: summonsOf(r, 'footman') };
    };
    const plain = run(false);
    expect(plain.rallies, 'the fixture must produce at least one Deathsayer rally').toBeGreaterThanOrEqual(1);
    expect(plain.summons, 'control: one forced Echo per rally').toBe(plain.rallies);
    const doubled = run(true);
    expect(doubled.summons,
      'with Sylus each rally-forced Echo fires (1+1)× — factories.ts triggerEchoOn strict: "every Echo multiplier the side has"').toBe(doubled.rallies * 2);
  });

  // P6 — Echo-through-Rally × gild: the FIRER's gild multiplies the whole forced fire.
  it('P6: a GOLDEN Deathsayer forces its Echo (1 + extras) × 2 times — gild composes multiplicatively', () => {
    const board = [bm('deathlesshand', 'p0', 1, 99), bm('deathsayer', 'p1', 6, 99, { golden: true } as Partial<BoardMinion>)];
    const r = simulate(board, [bm('cryptwolf', 'e0', 0, 7)], makeRng(3), CARD_INDEX,
      combatSide({ tier: 5 }), combatSide({ tier: 5 }));
    const rallies = ralliesOf(r);
    expect(rallies).toBeGreaterThanOrEqual(1);
    expect(summonsOf(r, 'footman'),
      'golden Deathsayer: procs = (1 + 0 extras) × gild 2 (factories.ts: "× this minion\'s gild")').toBe(rallies * 2);
  });

  // P7 — rally × rally doublers: card multiplier (Uron) and rune override (Rallying Offensive) are ADDITIVE.
  it('P7: rally fires = 1 + Uron + Rallying Offensive — all additive (simulate.ts playerRallyExtras)', () => {
    const fires = (withUron: boolean, rallyDouble: boolean): number => {
      const board = [bm('supporter', 'p0', 2, 40), bm('emissary', 'p1', 2, 40),
        ...(withUron ? [bm('uron', 'p2', 7, 40)] : [])];
      // Enemy dies to the Supporter's FIRST strike, so exactly one rally moment is measured.
      const r = simulate(board, [bm('cryptwolf', 'e0', 0, 2)], makeRng(7), CARD_INDEX,
        combatSide({ tier: 5 }), combatSide({ tier: 5 }), { playerRallyDouble: rallyDouble });
      expect(r.result).toBe('win');
      // Supporter's Rally: +1/+2 to friendly Dragons. The sim assigns its own uids (`m0`…), so count fires
      // by the event's effect-identity stamp instead — one rallyBuff event per fire (the Emissary is the
      // only other Dragon).
      return r.events.filter((e) => e.type === 'buff'
        && (e as { key?: string }).key === 'factory:rallyBuff:onAttack').length;
    };
    expect(fires(false, false), 'control: one rally fire per attack').toBe(1);
    expect(fires(true, false), 'Uron: 1 + 1').toBe(2);
    expect(fires(true, true), 'Uron + Rallying Offensive: 1 + 1 + 1 — additive, never 1×2×2').toBe(3);
  });

  // P8 — bounce × bounce: the no-rebounce guard makes bounce counts exact and finite.
  it('P8: Ruby bounces (Resonance Idol + Rune of the Conduit) apply stats directly and NEVER re-bounce', () => {
    const totalDelta = (withRune: boolean): number => {
      // TWO idols: if a bounce landing on the second idol re-entered fireOnRubyPlayed, IT would bounce again
      // and the totals would exceed the exact count below.
      const s = base([card('a', 'k_resonance'), card('b', 'k_resonance'), card('c', 'footman')]);
      if (withRune) (s as { runeConduit?: boolean }).runeConduit = true;
      const sum = (): number => s.board.reduce((x, c) => x + c.attack + c.health, 0);
      const before = sum();
      fireOnRubyPlayed(s, s.board[0]!, 2, 2); // a 2/2 Ruby landed on idol A
      return sum() - before;
    };
    // Idol A's own bounce: 2 random OTHER friends × (2+2) = 8 stat points. No cascade — exact.
    expect(totalDelta(false), 'two bounces exactly (recruit.ts gainRubyStats: "NO fireOnRubyPlayed - the no-rebounce guard")').toBe(8);
    // Rune of the Conduit adds ONE side-wide extra bounce on top: 3 × (2+2).
    expect(totalDelta(true), 'rune adds exactly one more bounce — additive, still no cascade').toBe(12);
  });

  // P9 — battlecry × combat replay (Parting Cry): the dying cry folds the Battlecry multiplier.
  // Owner APPROVE 2026-08-27 (q-interact-combat-shout-multipliers) — was flat, previously ambiguity Q2.
  it('P9: Parting Cry × Drakko — the dying Shout fires (1 + Drakko) times, like Ryme and the shop replay', () => {
    const run = (withDrakko: boolean): number => {
      const board = [bm('alley', 'p0', 1, 1, { partingCry: true } as Partial<BoardMinion>),
        ...(withDrakko ? [bm('drummer', 'p1', 2, 99)] : [])];
      const r = simulate(board, [bm('cryptwolf', 'e0', 30, 60)], makeRng(5), CARD_INDEX,
        combatSide({ tier: 5 }), combatSide({ tier: 5 }));
      return summonsOf(r, 'stray'); // Pennycat's Shout: summon a Stray — one per fire
    };
    expect(run(false), 'control: the cry fires once').toBe(1);
    expect(run(true),
      'with Drakko the cry fires 2× (simulate.ts Parting Cry branch folds drakkoRepeats — owner ruling q-interact-combat-shout-multipliers)').toBe(2);
  });

  // P10 — battlecry × combat replay (the arena `replayShout` verb, Embercrest): the fold lives INSIDE the
  // combat verb, mirroring the shop's replayBattlecry → drummerRepeats boundary, so every arena consumer
  // inherits it. Owner APPROVE 2026-08-27 (q-interact-combat-shout-multipliers).
  it('P10: Embercrest (arena replayShout) × Drakko — each re-triggered Shout fires (1 + Drakko) times', () => {
    const run = (withDrakko: boolean): { triggers: number; fires: number } => {
      const board = [bm('d2_embercrest', 'p0', 2, 60), bm('emissary', 'p1', 2, 60),
        ...(withDrakko ? [bm('drummer', 'p2', 2, 60)] : [])];
      const r = simulate(board, [bm('cryptwolf', 'e0', 0, 4)], makeRng(7), CARD_INDEX,
        combatSide({ tier: 6 }), combatSide({ tier: 6 }));
      expect(r.result).toBe('win');
      // One narration per re-trigger (the arena body), one +2/+2 buff per FIRE (Emissary's Battlecry) —
      // the ratio is the fold.
      const triggers = r.events.filter((e) => e.type === 'sc' && /triggers .*Shout/.test((e as { text?: string }).text ?? '')).length;
      const fires = r.events.filter((e) => e.type === 'buff'
        && (e as { attack?: number }).attack === 2 && (e as { health?: number }).health === 2).length;
      return { triggers, fires };
    };
    const plain = run(false);
    expect(plain.triggers, 'the fixture must produce at least one Embercrest re-trigger').toBeGreaterThanOrEqual(1);
    expect(plain.fires, 'control: one fire per re-trigger').toBe(plain.triggers);
    const folded = run(true);
    expect(folded.fires,
      'with Drakko each re-trigger fires 2× (factories.ts replayShout folds drakkoRepeats — owner ruling q-interact-combat-shout-multipliers)').toBe(folded.triggers * 2);
  });

  // P11 — Empty Graves' forced Echo × the Echo multipliers + the marked body's gild.
  // Owner APPROVE 2026-08-27 (q-interact-empty-graves-flat) — was flat, previously ambiguity Q3.
  it('P11: Empty Graves × Sylus / gild — the forced Echo folds (1 + echo extras) × the marked body\'s gild', () => {
    // The marked body is the LEFT-MOST living minion at Start of Combat (the cryptwolf); Footman Captain
    // (deathlesshand) is the left-most Echo it forces. Each marked attack emits one `questTrigger` — as does
    // the Start-of-Combat grant itself, hence the `- 1` in every ratio below.
    const graves = (withSylus: boolean, goldenMarked: boolean): { triggers: number; summons: number } => {
      const board = [bm('cryptwolf', 'p0', 1, 99, goldenMarked ? ({ golden: true } as Partial<BoardMinion>) : {}),
        bm('deathlesshand', 'p1', 0, 99), ...(withSylus ? [bm('sylus', 'p2', 0, 99)] : [])];
      // The enemy dies to the marked body's FIRST swing, so the fixture measures exactly one forced trigger
      // and the Footman summons can never hit the 7-slot board cap.
      const r = simulate(board, [bm('cryptwolf', 'e0', 0, 1)], makeRng(3), CARD_INDEX,
        combatSide({ tier: 5, questMods: { emptyGraves: true } }), combatSide({ tier: 5 }));
      const triggers = r.events.filter((e) => e.type === 'questTrigger'
        && (e as { flag?: string }).flag === 'emptyGraves' && (e as { side?: string }).side === 'player').length;
      return { triggers, summons: summonsOf(r, 'footman') };
    };
    const plain = graves(false, false);
    // The Start-of-Combat GRANT also announces via the same `questTrigger` flag — one announcement, then one
    // per marked attack, hence the `- 1` in every ratio.
    expect(plain.triggers, 'the fixture must produce a marked-body attack').toBeGreaterThanOrEqual(2);
    expect(plain.summons, 'control: one forced Echo per marked attack').toBe(plain.triggers - 1);
    const sylus = graves(true, false);
    expect(sylus.summons,
      'with Sylus each forced Echo fires (1+1)× — owner ruling q-interact-empty-graves-flat').toBe((sylus.triggers - 1) * 2);
    const gilded = graves(false, true);
    expect(gilded.summons,
      'a GILDED marked body doubles the whole forced fire, like triggerEcho\'s gild fold').toBe((gilded.triggers - 1) * 2);
  });

  // P12 — endOfTurn × endOfTurn multipliers. Owner APPROVE 2026-08-28 (q-interact2-32aa654f /
  // q-interact2-faeb3c44, standing rule R-MULT-02): the endOfTurn family composes by the SAME law as the
  // ruled ones — non-stacking cards collapse to the single best (Gilded counting double), and the one-shot
  // extras add on top of that fold. This was ambiguity Q1's second half (Uron + Chronos), now ruled.
  it('P12: End-of-Turn fires = 1 + best non-stacking multiplier — Uron + Chronos collapse to 2×, never 3×', () => {
    const reps = (board: BoardCard[], oneShot = false): number => {
      const s = base(board);
      if (oneShot) (s as { extraEotThisTurn?: boolean }).extraEotThisTurn = true; // Chrono Staff's per-turn extra
      return endOfTurnRepeats(s);
    };
    expect(reps([card('a', 'footman')]), 'control: End of Turn fires once').toBe(1);
    expect(reps([card('a', 'chronos')]), 'Chronos alone: 1 + 1').toBe(2);
    expect(reps([card('a', 'uron')]), 'Uron alone: 1 + 1 (the same family, a different card)').toBe(2);
    expect(reps([card('a', 'chronos'), card('b', 'uron')]),
      'R-MULT-02: two DIFFERENT non-stacking cards of one family collapse to best-of — 2×, not 3×').toBe(2);
    expect(reps([card('a', 'chronos', { golden: true })]), 'gild doubles the contribution (1 + 2)').toBe(3);
    expect(reps([card('a', 'chronos', { golden: true }), card('b', 'uron')]),
      'best-of picks the golden Chronos (2), not the sum of both cards').toBe(3);
    expect(reps([card('a', 'chronos'), card('b', 'uron')], true),
      'the one-shot extra adds ON TOP of the collapsed fold — 1 + best(1) + 1').toBe(3);
  });

  // P13 — startOfCombat × the same multiplier, in the OTHER phase: the family-agnostic law holds in combat
  // too (R-MULT-02). Kennelmaster's Start of Combat gives Beasts +1 Attack; Uron makes the pass run twice.
  it('P13: Start of Combat fires 1 + Uron times — the same fold, in combat (R-MULT-02)', () => {
    const scBuffs = (withUron: boolean): number => {
      const board = [bm('kennel', 'p0', 1, 99), bm('cryptwolf', 'p1', 1, 99),
        ...(withUron ? [bm('uron', 'p2', 7, 99)] : [])];
      const r = simulate(board, [bm('cryptwolf', 'e0', 0, 40)], makeRng(5), CARD_INDEX,
        combatSide({ tier: 6 }), combatSide({ tier: 6 }));
      // One +1/+0 buff per Beast per Start-of-Combat pass — count the grants landing on the Crypt Wolf.
      return r.events.filter((e) => e.type === 'buff'
        && (e as { target?: string }).target === r.initial.player[1]!.uid
        && (e as { attack?: number }).attack === 1 && (e as { health?: number }).health === 0).length;
    };
    const plain = scBuffs(false);
    expect(plain, 'control: the Start-of-Combat aura grants once per Beast').toBe(1);
    expect(scBuffs(true),
      'with Uron the whole Start-of-Combat pass runs twice (simulate.ts scReps = 1 + extraTriggerFires)').toBe(2);
  });
});
