import { CARD_INDEX } from '@game/content';
import { SET3_UNDEAD_RUNES, SKELETON_TOKEN_ID, SPEAR_WARDEN_ID, rankAndFileTaunts } from '@game/core';
import { addBuff, captureBuffFx, cardBuff, isTribe, makeContext, type SocRuneReplay } from './recruit';
import { runeStacksOf } from './runeDup';
import { procRuneId, type BoardCard, type RunState } from './state';

/**
 * ── SET 3 NEW-CONCEPT RUNES, UNDEAD (owner review 2026-11-23) — the Shop halves ────────────────────────────────────
 *
 * One home for the Shop-side hooks, so each chokepoint in `recruit.ts` / `reducer.ts` is a single call. The combat
 * halves live in `simulate.ts` under "SET 3 UNDEAD RUNES"; the numbers in core/src/set3UndeadRunes.ts. Every grant is
 * per copy held (`runeStacksOf`).
 *
 *  - Shallow Graves: the first Undead bought each turn gains Rise (`applyOnBuy`, the buy chokepoint). Shop only.
 *    Both per-turn fields reset in the reducer's turn setup.
 *  - Grave Tithe: combat only (it counts the Rises of a combat).
 *  - Dead Weight: a Shop Overflow (`fireSummonOverflow`) raises the Undead Aura +2 Attack.
 *  - Rank and File: Footmen and Spear Wardens carry Taunt (`applyRuneGrafts`, every board / hand arrival).
 *  - Bone Pile / Night Watch: Start of Combat runes; their Shop twins are the Start of Combat replays (Combat Prowess /
 *    Lasting Cadence, `socRuneReplaysOf`).
 *  - Second Burial: a body that came back by a Shop Rise (`riseReturn`) and is destroyed in the Shop again
 *    (`afterShopDestroy`) leaves a Skeleton with its Attack.
 *  - Requiem: every Shop writer of the Undead Aura calls `requiemOnAuraRise`; the turn's cap is shared with combat.
 *  - Undying Legion: combat only (an Avenge rune, like every Avenge rune).
 */

/** SHALLOW GRAVES: the bought card is the turn's first Undead (All-types counts) -> it gains Rise. A card that already
 *  has Rise does not spend the charge (there is nothing to give it). */
export function shallowGravesOnBuy(state: RunState, bought: BoardCard): void {
  if (!state.questFlags?.runeShallowGraves || state.shallowGravesUsedThisTurn) return;
  const def = CARD_INDEX[bought.cardId];
  if (!def || def.spell || !isTribe(bought, 'undead') || bought.keywords.includes('R')) return;
  state.shallowGravesUsedThisTurn = true;
  bought.keywords = [...bought.keywords, 'R'];
  procRuneId(state, 'rune_shallow_graves');
}

/** DEAD WEIGHT: one Shop Overflow. The Lantern channel rises (+2 Attack per copy), through the shared raiser so the
 *  Soul Furnace and Requiem hear it. */
export function deadWeightOnOverflow(state: RunState, raise: (state: RunState, attack: number) => void): void {
  if (!state.questFlags?.runeDeadWeight) return;
  procRuneId(state, 'rune_dead_weight');
  raise(state, SET3_UNDEAD_RUNES.deadWeightAttack * runeStacksOf(state, 'rune_dead_weight'));
}

/** RANK AND FILE: a friendly Footman / Spear Warden (board or hand) carries Taunt. Idempotent. */
export function rankAndFileGraft(state: RunState, card: BoardCard): void {
  if (!state.questFlags?.runeRankAndFile || !rankAndFileTaunts(card.cardId) || card.keywords.includes('T')) return;
  card.keywords = [...card.keywords, 'T'];
}

/** REQUIEM: how many more Aura rises it pays on this turn (the combat budget is what the Shop left). */
export function requiemLeftThisTurn(state: RunState): number {
  return Math.max(0, SET3_UNDEAD_RUNES.requiemPerTurn - (state.requiemUsedThisTurn ?? 0));
}

/** REQUIEM, Shop half: the Undead Aura just rose (any Shop writer). Your board Undead gain +1/+1 per copy (a Shop buff
 *  is permanent), while the turn's budget lasts. The grant is a plain buff, never an Aura rise, so it cannot loop. */
export function requiemOnAuraRise(state: RunState): void {
  if (!state.questFlags?.runeRequiem || requiemLeftThisTurn(state) <= 0) return;
  state.requiemUsedThisTurn = (state.requiemUsedThisTurn ?? 0) + 1;
  procRuneId(state, 'rune_requiem');
  const undead = state.board.filter((c) => isTribe(c, 'undead'));
  if (undead.length === 0) return;
  const n = runeStacksOf(state, 'rune_requiem');
  const g = SET3_UNDEAD_RUNES.requiem;
  captureBuffFx(state, undefined, 'spell', () => {
    for (const c of undead) addBuff(c, 'Requiem', g.attack * n, g.health * n);
  });
}

/** SECOND BURIAL: remember a body that came back by a Shop Rise (its fresh uid), so its next Shop death counts. */
export function secondBurialNoteRise(state: RunState, risen: BoardCard): void {
  if (!state.questFlags?.runeSecondBurial) return;
  const live = new Set(state.board.map((c) => c.uid));
  state.secondBurialRisen = [...(state.secondBurialRisen ?? []).filter((u) => live.has(u)), risen.uid];
}

/** SECOND BURIAL, Shop half: a destroyed body that already Rose leaves a Skeleton with its Attack (the Anvilshade
 *  floor: the Skeleton's printed Attack is raised to the body's, the Undead Aura stays on top), right-most, per copy
 *  held. A plain summon: a full board overflows it (the combat half's rule). */
export function secondBurialOnShopDeath(state: RunState, destroyed: BoardCard): void {
  if (!state.questFlags?.runeSecondBurial || !state.secondBurialRisen?.includes(destroyed.uid)) return;
  state.secondBurialRisen = state.secondBurialRisen.filter((u) => u !== destroyed.uid);
  const skel = CARD_INDEX[SKELETON_TOKEN_ID];
  if (!skel) return;
  procRuneId(state, 'rune_second_burial');
  for (let k = 0; k < runeStacksOf(state, 'rune_second_burial'); k++) {
    const body = makeContext(state).summon(skel, '');
    const lift = Math.max(0, destroyed.attack - skel.attack);
    if (body && lift > 0) addBuff(body, 'Second Burial', lift, 0);
  }
}

/** The Shop twins of the two Start of Combat summon runes, for the Combat Prowess / Lasting Cadence replays. */
export function set3UndeadSocReplays(state: RunState): SocRuneReplay[] {
  const f = state.questFlags;
  const out: SocRuneReplay[] = [];
  // BONE PILE: a Skeleton for every 2 Undead on the board (counted once), per copy. Plain summons: a
  // full board overflows them, as in combat.
  if (f?.runeBonePile) out.push({ id: 'rune_bone_pile', kind: 'rune', label: 'Bone Pile', fire: (st) => {
    const skel = CARD_INDEX[SKELETON_TOKEN_ID];
    if (!skel) return;
    const n = Math.floor(st.board.filter((c) => isTribe(c, 'undead')).length / SET3_UNDEAD_RUNES.bonePilePer) * runeStacksOf(st, 'rune_bone_pile');
    for (let k = 0; k < n; k++) makeContext(st).summon(skel, '');
  } });
  // NIGHT WATCH: a Spear Warden with double its bonus: its summon carries the Warden enchant once, and the rune adds
  // it once more (a permanent Shop buff at the enchant's current size), per copy. A plain summon.
  if (f?.runeNightWatch) out.push({ id: 'rune_night_watch', kind: 'rune', label: 'Night Watch', fire: (st) => {
    const knit = CARD_INDEX[SPEAR_WARDEN_ID];
    if (!knit) return;
    for (let k = 0; k < runeStacksOf(st, 'rune_night_watch'); k++) {
      const body = makeContext(st).summon(knit, '');
      const bonus = cardBuff(st, SPEAR_WARDEN_ID);
      if (body && (bonus.attack > 0 || bonus.health > 0)) addBuff(body, 'Night Watch', bonus.attack, bonus.health);
    }
  } });
  return out;
}
