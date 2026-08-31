/**
 * DOC BOT — the RUN-STATE CARRY-OVER scan (recruit→combat bridge), shared with `carryOver.test.ts`.
 *
 * The bug class (owner report 2026-08-26): Rune of the War Drum's charge lived ONLY on RunState
 * (`runeWarDrum` + the per-turn latch `runeWarDrumUsedThisTurn`) and was consumed ONLY by the recruit-side
 * Shout counter — an UNSPENT charge simply evaporated at combat, even though the owner's ruling is "if it is
 * not used in shop, then the first shout triggered in combat should work". Warm Embers' legacy
 * `shoutDoubleCharges` had the identical shape. Nothing could catch the class, because no instrument asked
 * the question: DOES THIS PER-TURN FIELD'S UNSPENT VALUE REACH THE COMBAT THAT ENDS THE TURN?
 *
 * The lane asks it mechanically, with a DERIVED subject list — never hand-curated:
 *   · The reducer's turn-rollover reset block is fenced by `PER-TURN-RESET BEGIN/END` marker comments; the
 *     test reads reducer.ts at run time and regexes every `s.<field> = …` clear between the markers, so ANY
 *     new per-turn field is auto-swept the day it lands. (`EXTRA_CARRY_SUBJECTS` below adds the known carry
 *     channels that are charge POOLS rather than per-turn clears — shoutDoubleCharges — which the marker
 *     block can never contain.)
 *   · For each field: resolve the SAME combat through the real reducer (`faceOmen`, which builds the combat
 *     side via `questCombatMods` — the actual bridge) with the field armed to a sentinel and unarmed, same
 *     seed, and diff the full serialized `lastCombat`. `oddsInput` is stripped first: it echoes the BUILT
 *     side state (questMods included), so comparing it would mark a threaded-but-UNCONSUMED field as
 *     differing and make the scan vacuous.
 *   · Identical output ⇒ the field needs an entry in `CARRY_OVER_EXCUSED` (a verifiable reason it has no
 *     combat meaning) or it counts as needs-triage. An excused field that now DOES differ is a stale excuse
 *     and fails. The needs-triage backlog is ratcheted in the test.
 *
 * The fixture stages a combat-TRIGGERED Shout on purpose: Rune of the Herald (`runeHerald`) fires every
 * friendly Echo at Start of Combat, Ryme's Echo re-fires its neighbour's Battlecry, and Pennycat (`alley`)
 * is that neighbour — so a Shout reliably fires inside `simulate()` and the War Drum carry has a consumer.
 * The base fixture also arms `runeWarDrum: 2`, so arming the LATCH (`runeWarDrumUsedThisTurn = true`)
 * visibly REMOVES the carry — the scan's own proof that the bridge exists.
 *
 * Residual, documented: per-INSTANCE per-turn clears inside the block (`c.spellsOnThisTurn`, rune-threshold
 * `t.usedThisTurn`, …) are not swept — the regex only matches top-level `s.<field>` assignments. They are a
 * different shape (per-card state rides the board snapshot into combat already).
 */
import { CARD_INDEX } from '@game/content';
import type { BoardCard, RunState } from './../state';
import { createRun } from './../state';
import { reduce } from './../reducer';

/** Carry channels that are charge POOLS (never cleared at rollover, so never inside the marker block) but
 *  belong to the same owner-ruled class: their unspent value must reach combat. */
export const EXTRA_CARRY_SUBJECTS: readonly string[] = ['shoutDoubleCharges'];

/** Parse the per-turn reset field names out of reducer.ts source (the test reads the file and passes the
 *  region text in, keeping this module fs-free like combatModScan). Matches top-level `s.<field> = …`
 *  assignments only — a nested `s.foo.bar = …` is per-instance state and out of scope. */
export function parseResetFields(regionSrc: string): string[] {
  const names = new Set<string>();
  for (const m of regionSrc.matchAll(/\bs\.([A-Za-z0-9_]+)\s*=[^=]/g)) names.add(m[1]!);
  return [...names];
}

/** Slice the fenced rollover block out of the reducer source; throws loudly if a marker went missing so a
 *  refactor can never silently blind the scan. */
export function resetRegion(reducerSrc: string): string {
  const begin = reducerSrc.indexOf('PER-TURN-RESET BEGIN');
  const end = reducerSrc.indexOf('PER-TURN-RESET END');
  if (begin < 0 || end < 0 || end <= begin) {
    throw new Error('carryOverScan: PER-TURN-RESET BEGIN/END markers not found in reducer.ts — restore them (or move them with the reset block), the carry-over scan derives its subject list from that region.');
  }
  return reducerSrc.slice(begin, end);
}

/** Type-appropriate arm values for the shaped fields; everything else arms with `2` (truthy for boolean
 *  gates, a real magnitude for counters). Shapes verified against state.ts on 2026-08-26. */
export const SENTINELS: Readonly<Record<string, unknown>> = {
  runeWarDrumUsedThisTurn: true, // arming the LATCH removes the base fixture's carry — the headline subject
  playedThisTurn: ['alley'],
  soldThisTurn: ['alley'],
  typesBoughtThisTurn: ['beast'],
  tradeInTribe: 'beast',
  spellhidePending: [{ spellId: 'growth', uid: 'pS0' }],
  fodderConsumedThisTurn: { attack: 2, health: 2 },
  runeTreasureMap: { turns: 3, gold: 5 },
  runeSpellEcho: { uses: 2, used: 0 },
  scoutedNextOpponent: [{ cardId: 'alley', attack: 2, health: 2 }],
  pendingSummonBuff: { tribe: 'beast', attack: 2, health: 2, source: 'scan' },
  tavernBuyBonusTurn: { atk: 2, hp: 2 },
  gorrBuys: ['alley'],
  firstShoutUid: 'pS0',
  firstSpellThisTurnId: 'growth',
  lastSpellThisTurnId: 'growth',
};

const bc = (cardId: string, uid: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};

/** The staged run: a combat-triggered Shout (Herald → Ryme's Echo → Pennycat's Battlecry), an Echo summoner
 *  (so summon-scoped carries have a consumer), and the War Drum armed with its charge UNSPENT. */
export function fixtureRun(): RunState {
  const s = createRun(7, 'drakko');
  return {
    ...s,
    board: [bc('alley', 'pS0'), bc('ryme', 'pS1'), bc('thunderingabomination', 'pS2')],
    hand: [],
    runeWarDrum: 2, // base: charge armed + unspent, so the latch subject can visibly remove the carry
    questFlags: { ...s.questFlags, runeHerald: true }, // SoC: trigger every friendly Echo → a guaranteed combat Shout
  };
}

/** Resolve the fixture's combat through the REAL reducer bridge (faceOmen → questCombatMods → simulate) and
 *  serialize the full result. `arm` doctors the state first (the armed lane); omitted = baseline. */
export function resolveFixture(arm?: (s: RunState) => void): string {
  const s = fixtureRun();
  arm?.(s);
  const after = reduce(s, { type: 'faceOmen' } as never);
  if (!after.lastCombat) throw new Error('carryOverScan: faceOmen did not resolve a combat — the fixture is broken');
  const lc = { ...(after.lastCombat as unknown as Record<string, unknown>) };
  // The side-state echo: it contains questMods verbatim, so keeping it would mark a threaded-but-UNCONSUMED
  // field as "differing" — the scan must only see combat CONSEQUENCES.
  delete lc.oddsInput;
  return JSON.stringify(lc);
}

export interface CarryOverScanResult {
  /** Fields whose armed sentinel changed the resolved combat — the carry bridge exists for them. */
  differing: string[];
  /** Fields whose armed sentinel changed nothing — each needs an excuse or counts as needs-triage. */
  identical: string[];
  /** Fields whose sentinel broke the resolve (a shape the scan can't fake) — must stay empty or be excused. */
  errored: string[];
}

export function carryOverScan(fields: readonly string[]): CarryOverScanResult {
  const baseline = resolveFixture();
  const differing: string[] = [];
  const identical: string[] = [];
  const errored: string[] = [];
  for (const f of fields) {
    try {
      const armed = resolveFixture((s) => { (s as unknown as Record<string, unknown>)[f] = f in SENTINELS ? SENTINELS[f] : 2; });
      (armed !== baseline ? differing : identical).push(f);
    } catch {
      errored.push(f);
    }
  }
  return { differing, identical, errored };
}

export interface CarryOverExcuse {
  /**
   *  'no-combat-meaning' — the field is pure shop/presentation bookkeeping; a fight has nothing to read it
   *                        for (say what it books).
   *  'combat-covered'    — the value the fight needs IS threaded, through a channel the fixture's diff can't
   *                        see or that reads a sibling field (cite the channel).
   *  'needs-staging'     — threaded into the combat side, but only a specific card/quest consumes it and the
   *                        generic fixture stages none (cite the consumer).
   *  'needs-triage'      — the scan found the gap; no ruling exists. Tolerated, counted, must not grow.
   */
  kind: 'no-combat-meaning' | 'combat-covered' | 'needs-staging' | 'needs-triage';
  /** One line a future reader can verify. */
  why: string;
}

/** The excuse table for IDENTICAL fields — same doctrine as PHASE_EXCUSED (phaseRegistry.ts): worklists
 *  re-derive from source; asymmetries get a verifiable reason; unknowns are needs-triage, counted and
 *  ratcheted in carryOver.test.ts. Seeded 2026-08-26 from a full run of the scan. */
export const CARRY_OVER_EXCUSED: Readonly<Record<string, CarryOverExcuse>> = {
  // ── pure shop-economy bookkeeping: no fight reads these ──
  goldSpentThisTurn: { kind: 'no-combat-meaning', why: 'Patch Job\'s per-turn Gold tally; combat has no Gold. (Baby Gastrid\'s combat gap is separately excused as state-missing in phaseRegistry.)' },
  runeTreasureMaps: { kind: 'no-combat-meaning', why: 'Treasure Map\'s pending Gold payouts (the array slot since the 2026-08-27 duplicate rulings); ticked and paid at turn start — pure shop economy, no fight reads a countdown.' },
  cardsBoughtThisTurn: { kind: 'needs-staging', why: 'threaded into the combat side (combatSide.cardsBoughtThisTurn) for Frenzied Excavator; the fixture stages none' },
  moonhowlTeachesThisTurn: { kind: 'no-combat-meaning', why: 'per-turn teach CAP for Moonhowl Mentor buys; teaching happens on the buy itself, never mid-fight' },
  windowShopRolls: { kind: 'no-combat-meaning', why: 'Window Shopping\'s free-roll tally; rolls are a shop action' },
  chooseBothCharges: { kind: 'no-combat-meaning', why: 'the armed "take BOTH halves" charges from Forked Crown; Choose One resolves when a HAND card is played in the shop, and a fight never plays one — the charge is spent or cleared before combat begins' },
  restockUsedThisTurn: { kind: 'no-combat-meaning', why: 'Restock\'s per-turn shop latch; shop-only' },
  bargainBinUsedThisTurn: { kind: 'no-combat-meaning', why: 'Bargain Bin\'s per-turn shop latch; shop-only' },
  collectorUsedThisTurn: { kind: 'no-combat-meaning', why: 'Collector\'s per-turn buy latch; shop-only' },
  tradeInTribe: { kind: 'no-combat-meaning', why: 'Trade-In\'s per-turn chosen tribe for the shop swap; shop-only' },
  typesBoughtThisTurn: { kind: 'no-combat-meaning', why: 'per-turn buy-type tally for threshold runes; buys are shop actions' },
  dupeUsedThisTurn: { kind: 'no-combat-meaning', why: 'Dupes\' first-buy-copy latch; buys are shop actions' },
  gorrBuys: { kind: 'no-combat-meaning', why: 'Gorr\'s per-turn minion-buy tally; buys are shop actions' },
  freeBuyUsedThisTurn: { kind: 'no-combat-meaning', why: 'Freedom rift\'s first-free-minion latch; buys are shop actions' },
  nextSellBonus: { kind: 'no-combat-meaning', why: 'Quick Sale\'s next-sell Gold bonus; sells are shop actions' },
  spellCostOffTurn: { kind: 'no-combat-meaning', why: 'Arcane Clearance\'s this-turn spell discount; costs are shop-only (R-TURN-01 conform: nothing in the combat half of the turn can pay a cost)' },
  minionCostOffTurn: { kind: 'no-combat-meaning', why: 'Friends and Family\'s this-turn minion discount; costs are shop-only (R-TURN-01 conform: nothing in the combat half of the turn can pay a cost)' },
  tavernBuyBonusTurn: { kind: 'no-combat-meaning', why: 'Merchant\'s Chorus\' this-turn SHOP-offer buff; enchants offers, not the fought board' },
  spellmarketUsedThisTurn: { kind: 'no-combat-meaning', why: 'Rune of the Spellmarket\'s once-per-turn shop feed; shop-only' },
  banquetUsedThisTurn: { kind: 'no-combat-meaning', why: 'Rune of the Banquet Hall\'s once-per-turn buy latch; shop-only' },
  contrabandRubyUsed: { kind: 'no-combat-meaning', why: 'Rune of Contraband\'s per-turn Ruby latch (shop Ruby casts); the combat Ruby lane has its own mods' },
  contrabandAleUsed: { kind: 'no-combat-meaning', why: 'Rune of Contraband\'s per-turn Ale latch; Ales are shop casts' },
  gemscriptSpellUsed: { kind: 'no-combat-meaning', why: 'Rune of Gemscript\'s per-turn first-spell latch; the spell-power it grants is already folded into the side at build' },
  gemscriptRubyUsed: { kind: 'no-combat-meaning', why: 'Rune of Gemscript\'s per-turn first-Ruby latch; same folding as the spell half' },
  sharedPourUsedThisTurn: { kind: 'no-combat-meaning', why: 'Shared Pour\'s per-turn Ale latch; Ales are shop casts' },
  aftermarketUsedThisTurn: { kind: 'no-combat-meaning', why: 'Aftermarket\'s per-turn sell latch; sells are shop actions' },
  hoardcallingUsedThisTurn: { kind: 'no-combat-meaning', why: 'Hoardcalling\'s per-turn buy latch; buys are shop actions' },
  consumeDoubleUsedThisTurn: { kind: 'no-combat-meaning', why: 'Bottomless Banquet\'s per-turn Consume latch; Consume is a shop mechanic' },
  attachmentsThisTurn: { kind: 'no-combat-meaning', why: 'Tempering/Replication\'s first-Attachment-each-turn gate; Attachments are played in the shop' },
  runeTreasureMap: { kind: 'no-combat-meaning', why: 'a Gold-payout countdown ticked at each new shop; pure economy' },
  scoutedNextOpponent: { kind: 'no-combat-meaning', why: 'Farseer\'s Report scouting DISPLAY (a MODAL — modalOpen() refuses faceOmen while it is set, which is why the scan records it as errored, not identical); the fight resolves from the real opponent, never the scout' },
  pendingSummonBuff: { kind: 'no-combat-meaning', why: 'Wolvie\'s one-shot NEXT-SUMMON buff; summons it waits for are shop plays, and it expires unspent at the rollover by design' },
  consumesThisTurn: { kind: 'no-combat-meaning', why: 'Endless Appetite\'s "first Consume each turn" gate; Consume is a shop mechanic' },
  extraEotThisTurn: { kind: 'needs-staging', why: 'Chrono Staff\'s one-shot End-of-Turn extra — folded into endOfTurnRepeats at faceOmen (stats bake before combat); the fixture stages no End-of-Turn minion' },

  // ── shop-side Shout/spell/echo latches whose COMBAT halves ride their own channels ──
  // (`shoutExtraTurn` — Demand an Encore — used to sit here as needs-triage; the owner ruled 2026-08-27
  //  (R-TURN-01) and it now CARRIES via questCombatMods.encoreExtra, so the scan sees it differ.)
  shoutFirstUsedThisTurn: { kind: 'combat-covered', why: 'Warm Embers\' per-turn FREEBIE latch (shoutFirstDoubleEachRound); the legacy charge POOL (shoutDoubleCharges) is the carried channel and the scan proves it differs. R-TURN-02: a charge consumed by a combat-triggered Shout and the next turn\'s fresh freebie are SEPARATE — no double-dip question here' },
  shoutsThisTurn: { kind: 'no-combat-meaning', why: 'Rune of Refrain\'s per-turn SHOP-Shout counter (progress display); combat Shout counting has its own event stream' },
  firstShoutUid: { kind: 'no-combat-meaning', why: 'Rune of Refrain\'s record of WHICH shop Shout was first; bookkeeping for the shop rune' },
  echoFirstUsedThisTurn: { kind: 'combat-covered', why: 'Grave Contract\'s per-turn SHOP-Echo latch; the combat half rides questMods.echoFirstEachCombat (its own per-combat latch in simulate)' },
  spellFirstUsedThisTurn: { kind: 'no-combat-meaning', why: 'Spell Thesis\' per-turn first-spell latch; spells are cast in the shop, combat casts ride the arena lane' },
  spellMultMark: { kind: 'no-combat-meaning', why: 'Orivax\'s per-turn re-arm marker for the shop spell multiplier' },
  grimoireMult: { kind: 'needs-staging', why: 'Living Grimoire\'s armed shop-cast multiplier; consumed by shop casts (the fixture casts none) — combat named-spell casts have their own lane' },
  runeSpellEcho: { kind: 'no-combat-meaning', why: 'Living Magic / Perfect Recall\'s per-turn shop-cast echo budget; shop casts only' },
  firstSpellThisTurnId: { kind: 'no-combat-meaning', why: 'Rune of Recurrence\'s record of the first shop spell; shop-only' },
  lastSpellThisTurnId: { kind: 'combat-covered', why: 'Recaller\'s shop-side record; the combat stored-spell lane reads combatSide.lastSpellCastId (s.lastSpellCastId), a different field, threaded at build' },
  rememberedThisTurn: { kind: 'no-combat-meaning', why: 'Runesnout Archivist\'s once-per-turn journal latch; recording happens in the shop, the JOURNAL itself is threaded (rememberedSpellIds)' },
  spellhideUsedThisTurn: { kind: 'no-combat-meaning', why: 'Rune of Spellhide\'s per-turn RECORD latch; recording happens on the shop cast, the recorded re-casts ride spellhidePending' },
  spellhidePending: { kind: 'needs-triage', why: 'threaded (combatSide.spellhide) but the SoC consumer matches combat `m.uid` against the RUN uid, which the reducer bridge carries on sourceUid — the re-cast can never land through the real bridge (scan finding 2026-08-26). Rune archived 2026-08-12, so no live impact; fix the match or retire the lane, with a ruling' },
  lastWordUsedThisTurn: { kind: 'no-combat-meaning', why: 'Rune of the Last Word\'s per-turn sold-Dragon latch; selling is a shop action' },
  rubyCastsThisTurn: { kind: 'no-combat-meaning', why: 'per-turn shop Ruby-cast tally for threshold runes; combat Ruby casts ride the arena lane' },

  // ── threaded into the side, but only a specific consumer reads it and the fixture stages none ──
  spellsThisTurn: { kind: 'needs-staging', why: 'threaded (combatSide.spellsThisTurn) for Runescale Drake-class readers; the fixture stages none' },
  playedThisTurn: { kind: 'needs-staging', why: 'threaded as beastsPlayed (Pack Leader) at the faceOmen build; the fixture stages no Pack Leader' },
  soldThisTurn: { kind: 'no-combat-meaning', why: 'Voicekeeper reads it during the SHOP phase; not threaded into the combat side' },
  alesCastThisTurn: { kind: 'needs-staging', why: 'threaded (combatSide.alesLastTurn) for Bucky\'s payout; the fixture stages no Bucky' },
  fodderConsumedThisTurn: { kind: 'needs-staging', why: 'threaded (combatSide.fodderConsumedAtk/Hp) for Abhorrent Horror\'s SoC window; the fixture stages none' },
};
