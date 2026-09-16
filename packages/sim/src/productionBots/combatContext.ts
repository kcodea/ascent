import { CARD_INDEX } from '@game/content';
import { combatSide, type BoardMinion, type CombatSideState } from '@game/core';
import { CONFIG } from '../config';
import { poolOf } from '../cardPool';
import { alignmentsOf } from '../alignment';
import { buildPendingCombatQuests, questCombatMods } from '../reducer';
import { defIsTribe, handCardLocked, rubyStatBonus, spellAttackBonus, spellHealthBonus } from '../recruit';
import type { RunState } from '../state';

/**
 * THE FRIENDLY SIDE, PREPARED THE WAY THE REAL FIGHT PREPARES IT (balance roadmap B3).
 *
 * `fightScore` used to reduce the bot's board to `{cardId, attack, health, keywords, golden}` and hand `simulate`
 * a tier-only `combatSide({ tier })`. Every run-level scaler the reducer threads into the player's real fight —
 * spell power, Ruby casts, Reveler value, spell history, the Imp / Undead / Beast auras, fodder, quest mods, the
 * hand's minions for Rope Wrangler, per-instance accruals (Kennelmaster's summon bonus, Sergeant's HP grant,
 * Guel's tally, the Spirit tally), one-fight marks (bloodlust, partingCry, closedCasket, resummon), grafted
 * effects, the banked Start-of-Combat payouts (Fleeting Vigor, Open the Gates' Imps, banked keywords) — was
 * silently dropped, so the evaluator was scoring a materially different board from the one that would fight.
 *
 * This module mirrors `reducer.ts` `case 'faceOmen'` — the player-board mapping and the `combatSide({...})`
 * construction — field for field, in the same order, with the same comments trimmed. It is deliberately a
 * MIRROR rather than a call into the reducer: `faceOmen` is not separable today (it pins the opponent, resolves
 * the fight and stamps FX in one branch).
 *
 * TODO(B1-merge): replace with the shared reducer helper (`prepareCombatSide(run)` or its final name) the moment
 * B1's extraction lands, and delete this file. Until then, a scaler added to `faceOmen` must be added here too —
 * `combatContext.test.ts` pins the fields that exist today so a drift fails loudly rather than silently.
 */

export interface FriendlyCombatPrep {
  /** The board as combat instantiates it — per-instance state included, Start-of-Combat banks pre-baked. */
  bodies: BoardMinion[];
  /** The run-level side context, WITHOUT `poolIds` (derivable from the set; kept out of the projection so the
   *  fingerprint does not carry a few hundred card ids per node). `fightScore` re-attaches them. */
  side: Omit<CombatSideState, 'poolIds'>;
}

/** Mirror of the reducer's `player` mapping in `faceOmen`. */
function friendlyBodiesOf(s: RunState): BoardMinion[] {
  const playerAligns = alignmentsOf(s.board);
  const player: BoardMinion[] = s.board.map((b, bi) => ({
    cardId: b.cardId,
    attack: b.attack,
    health: b.health,
    align: playerAligns[bi],
    keywords: [...b.keywords],
    golden: b.golden,
    ...(b.addedTribes && b.addedTribes.length ? { addedTribes: [...b.addedTribes] } : {}),
    ...(b.bloodlust ? { bloodlust: true } : {}),
    ...(b.bloodlustRally ? { bloodlustRally: true } : {}),
    ...(b.chosenOption !== undefined ? { chosenOption: b.chosenOption } : {}),
    ...(b.taughtSpellId ? { taughtSpellId: b.taughtSpellId } : {}),
    summonBonus: b.summonBonus ?? 0,
    ...(b.chefGranted ? { chefGrantedLast: b.chefGranted } : {}),
    overflowBonus: b.overflowBonus,
    hpGrantBonus: b.hpGrantBonus ?? 0,
    ascendProgress: b.ascendProgress ?? 0,
    spellProgress: b.spellProgress,
    spiritTally: b.spiritTally,
    soldProgress: b.soldProgress,
    boardFirstSpellId: b.boardFirstSpellId,
    eotBonus: b.eotBonus,
    sellBonus: b.sellBonus,
    eotTick: b.eotTick,
    sourceUid: b.uid,
    rallyMechAtk: b.rallyMechAtk,
    rallySpellWeld: b.rallySpellWeld,
    resummon: b.resummon,
    partingCry: b.partingCry,
    closedCasket: b.closedCasket,
    ...(b.copiedEcho?.length ? { copiedEcho: b.copiedEcho } : {}),
    ...(b.grantedEffects?.length ? { grantedEffects: b.grantedEffects } : {}),
    ...(b.echoStripped ? { echoStripped: true } : {}),
    ...(b.impBank ? { impBank: { ...b.impBank } } : {}),
    ...(b.bloodbinderMode ? { bloodbinderMode: b.bloodbinderMode } : {}),
    ...(b.allTribes ? { universalTribe: true } : {}),
    buffs: b.buffs,
  }));

  // The banked Start-of-Combat payouts the reducer pre-bakes BEFORE `simulate` (Rune of Twilight doubles them).
  const twilightMult = s.questFlags?.runeTwilight ? 2 : 1;
  const fleeting = s.fleetingVigor && (s.fleetingVigor.attack !== 0 || s.fleetingVigor.health !== 0) ? s.fleetingVigor : null;
  if (fleeting) {
    for (const m of player) { m.attack += fleeting.attack * twilightMult; m.health += fleeting.health * twilightMult; }
  }
  for (const grant of s.pendingCombatKeywords ?? []) {
    const m = player.find((p) => p.sourceUid === grant.uid);
    if (!m) continue;
    m.keywords ??= [];
    if (!m.keywords.includes(grant.keyword)) m.keywords.push(grant.keyword);
    if (grant.keyword === 'CR' && grant.critChance !== undefined) m.critChance = grant.critChance;
  }
  if (s.pendingSCImps) {
    const impDef = CARD_INDEX['impscrap'];
    const room = Math.max(0, CONFIG.boardMax - player.length);
    const n = Math.min(s.pendingSCImps * twilightMult, room);
    for (let k = 0; k < n && impDef; k++) {
      player.push({ cardId: 'impscrap', attack: impDef.attack, health: impDef.health, keywords: [...impDef.keywords], golden: false });
    }
  }
  return player;
}

/** Mirror of the reducer's `playerState = combatSide({...})` in `faceOmen`, minus `poolIds`. */
function friendlySideOf(s: RunState): Omit<CombatSideState, 'poolIds'> {
  const beastsPlayed = (s.playedThisTurn ?? []).filter((id) => defIsTribe(CARD_INDEX[id], 'beast')).length;
  const spiritsPlayed = (s.playedThisTurn ?? []).filter((id) => defIsTribe(CARD_INDEX[id], 'spirit')).length;
  const { poolIds: _drop, ...side } = combatSide({
    spellsThisTurn: s.spellsThisTurn,
    firstSpellThisTurnId: s.firstSpellThisTurnId,
    spellsCast: s.spellsCast,
    rubyCasts: s.rubyCasts ?? 0,
    revelerX: s.revelerX ?? 0,
    deathrattles: s.deathrattlesTriggered,
    spellPowerAtk: spellAttackBonus(s),
    wildHuntGrown: s.runeWildHuntGrown ?? 0,
    spellPowerHp: spellHealthBonus(s),
    undeadAtk: s.undeadAttackBonus,
    undeadHp: s.undeadHealthBonus,
    undeadBuyAtk: s.undeadBuyAtk ?? 0,
    impAtk: s.impBuff?.attack ?? 0,
    conductorBuff: s.conductorBuff ?? 0,
    impHp: s.impBuff?.health ?? 0,
    fodderConsumedAtk: s.fodderConsumedThisTurn?.attack ?? 0,
    fodderConsumedHp: s.fodderConsumedThisTurn?.health ?? 0,
    beastBuyAtk: s.beastBuyAtk ?? 0,
    beastsPlayed,
    spiritsPlayed,
    cardsBoughtThisTurn: s.cardsBoughtThisTurn ?? 0,
    magneticAtk: s.magneticBuyAtk ?? 0,
    magneticHp: s.magneticBuyHp ?? 0,
    rubyBonus: rubyStatBonus(s),
    tier: s.tier,
    tribes: s.tribes,
    cardBuffs: s.cardBuffs ?? {},
    handSpellIds: s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell).map((c) => c.cardId),
    alesLastTurn: s.alesCastThisTurn ?? 0,
    spellEscalation: { attack: s.frontToBackBonus, health: s.frontToBackBonusH },
    lastSpellCastId: s.lastSpellCastId,
    rememberedSpellIds: s.rememberedSpellIds ?? [],
    spellhide: s.spellhidePending ?? [],
    growthBonus: s.growthBonus ?? 0,
    handMinions: s.hand
      .filter((c) => { const d = CARD_INDEX[c.cardId]; return !!d && !d.spell && !d.ruby; })
      .map((c) => ({ uid: c.uid, cardId: c.cardId, attack: c.attack, health: c.health, keywords: c.keywords, golden: c.golden, ...(handCardLocked(s, c) ? { locked: true } : {}) })),
    beastHuntExtra: s.beastHuntExtra ?? 0,
    beastRitualExtra: s.beastRitualExtra ?? 0,
    questMods: questCombatMods(s),
    pendingQuests: buildPendingCombatQuests(s),
  });
  void _drop;
  return side;
}

/**
 * The friendly side as the real fight would build it from THIS run, right now. Pure: reads `run`, allocates
 * fresh bodies, never mutates. Everything here is the player's OWN state — public information for the bot.
 */
export function friendlyCombatSideOf(run: RunState): FriendlyCombatPrep {
  return { bodies: friendlyBodiesOf(run), side: friendlySideOf(run) };
}

/** The set's pool ids, as the reducer passes them (`all`, not `buyable`). */
export function poolIdsOf(run: Pick<RunState, 'setId'>): string[] {
  return poolOf(run).all.map((c) => c.id);
}

/** Every `combatSide` key the reducer's `faceOmen` sets today — pinned by `combatContext.test.ts` against the
 *  reducer source so a scaler added there without being mirrored here fails the suite. */
export const MIRRORED_SIDE_KEYS: readonly string[] = [
  'poolIds', 'spellsThisTurn', 'firstSpellThisTurnId', 'spellsCast', 'rubyCasts', 'revelerX', 'deathrattles',
  'spellPowerAtk', 'wildHuntGrown', 'spellPowerHp', 'undeadAtk', 'undeadHp', 'undeadBuyAtk', 'impAtk',
  'conductorBuff', 'impHp', 'fodderConsumedAtk', 'fodderConsumedHp', 'beastBuyAtk', 'beastsPlayed',
  'spiritsPlayed', 'cardsBoughtThisTurn', 'magneticAtk', 'magneticHp', 'rubyBonus', 'tier', 'tribes',
  'cardBuffs', 'handSpellIds', 'alesLastTurn', 'spellEscalation', 'lastSpellCastId', 'rememberedSpellIds',
  'spellhide', 'growthBonus', 'handMinions', 'beastHuntExtra', 'beastRitualExtra', 'questMods', 'pendingQuests',
];
