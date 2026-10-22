import { CARD_INDEX } from '@game/content';
import { DRAGON_RUNES_BASIC, isShopPoolSpell, makeRng, type CardDef } from '@game/core';
import { poolOf } from './cardPool';
import { addBuff, captureBuffFx, conjureToHand, gainGold, improveReps, isTribe, mintWhisper } from './recruit';
import { runeStacksOf } from './runeDup';
import { procRuneId, runeGrantOverflow, type BoardCard, type RunState } from './state';

/**
 * ── SET 3 DRAGON RUNES, BASIC (owner 2026-10-21) — the Shop halves ─────────────────────────────────────────────────
 *
 * One home for the Shop-side hooks of the eleven Basic Dragon runes, so each chokepoint in `recruit.ts` / `reducer.ts`
 * is a single call. The combat halves live in `simulate.ts` under the same heading. Every number is per copy held
 * (`runeStacksOf`), the boolean-flag family rule (owner 2026-08-27).
 *
 *  - Runic Primer: 2 Runebinds when acquired (over the cap only then, R-HAND-RUNE-TURN-01) and at every Start of Turn.
 *    A rune source, so the Whisper tier gate applies (R-WHISPER-TIER-01: Runebind is Tier 2).
 *  - Clear Voices: the third DISTINCT Whisper cast from hand this turn pays 2 Gold, once per turn.
 *  - Spell-Fed Scales: a Shop Spell cast (R-SHOPSPELL-01, any caster) gives a random friendly Dragon +6/+7, permanent.
 *  - Borrowed Flame: a Whisper cast on a friendly Dragon gives it the current value, then the value improves.
 *  - Spell Tempering: every 4th Whisper cast improves the run's spell power +1/+1.
 *  - Open Treasury: the first spell bought each turn hands over a plain copy.
 *  - Defiant Wings: its Shop replay (Combat Prowess / Lasting Cadence) lives in `socRuneReplaysOf`.
 * Loose Tongues is data only (the `playDragon` threshold meter paying `grantRandomWhisper`).
 */

export const RUNIC_PRIMER_COUNT = 2;
export const CLEAR_VOICES_DISTINCT = 3;
export const CLEAR_VOICES_GOLD = 2;
export const SPELL_FED_SCALES = DRAGON_RUNES_BASIC.spellFedScales;
export const BORROWED_FLAME_BASE = 1;
export const SPELL_TEMPERING_PER = DRAGON_RUNES_BASIC.spellTemperingPer;
export const DEFIANT_WINGS = DRAGON_RUNES_BASIC.defiantWings;

const RUNEBIND_ID = 'w4_runebind';

/** Runic Primer's grant. `copies` = how many copies pay (1 at an acquisition: only the new copy pays then). */
export function payRunicPrimer(state: RunState, copies: number): void {
  if (copies <= 0) return;
  procRuneId(state, 'rune_runic_primer');
  mintWhisper(state, RUNEBIND_ID, RUNIC_PRIMER_COUNT * copies, 1, undefined, false, runeGrantOverflow());
}

/** Start of Turn: every copy held pays. */
export function runicPrimerTurnStart(state: RunState): void {
  if (!state.questFlags?.runeRunicPrimer) return;
  payRunicPrimer(state, runeStacksOf(state, 'rune_runic_primer'));
}

/** Clear Voices: a Whisper was just cast FROM HAND (the reducer's Whisper branch, after its casts resolved). */
export function clearVoicesOnHandCast(state: RunState, def: CardDef): void {
  if (!state.questFlags?.runeClearVoices || !def.whisper) return;
  const ids = state.clearVoicesIds ?? [];
  if (!ids.includes(def.id)) state.clearVoicesIds = [...ids, def.id];
  if (state.clearVoicesPaid || (state.clearVoicesIds ?? []).length < CLEAR_VOICES_DISTINCT) return;
  state.clearVoicesPaid = true;
  procRuneId(state, 'rune_clear_voices');
  gainGold(state, CLEAR_VOICES_GOLD * runeStacksOf(state, 'rune_clear_voices'));
}

/** A seeded pick of one friendly board Dragon (All-types included through `isTribe`). */
function randomBoardDragon(state: RunState, exclude?: BoardCard): BoardCard | undefined {
  const pool = state.board.filter((c) => c !== exclude && isTribe(c, 'dragon'));
  if (pool.length === 0) return undefined;
  const rng = makeRng(state.rngCursor);
  const pick = pool[rng.int(pool.length)]!;
  state.rngCursor = rng.state();
  return pick;
}

/** Spell-Fed Scales: `noteSpellCast` reports every cast; only a Shop-pool spell pays (Rubies, Gifts, Whispers and
 *  token spells never do). Each copy picks its own Dragon. No Dragon on board: nothing. */
export function spellFedScalesOnCast(state: RunState, spellDef: CardDef): void {
  if (!state.questFlags?.runeSpellFedScales || !isShopPoolSpell(spellDef, poolOf(state).all)) return;
  if (!state.board.some((c) => isTribe(c, 'dragon'))) return;
  procRuneId(state, 'rune_spell_fed_scales');
  captureBuffFx(state, undefined, 'spell', () => {
    for (let k = 0; k < runeStacksOf(state, 'rune_spell_fed_scales'); k++) {
      const d = randomBoardDragon(state);
      if (d) addBuff(d, 'Spell-Fed Scales', SPELL_FED_SCALES.attack, SPELL_FED_SCALES.health);
    }
  });
}

/** Borrowed Flame's value right now (per copy). */
export function borrowedFlameValue(state: Pick<RunState, 'runeBorrowedFlame'>): number {
  return state.runeBorrowedFlame ?? BORROWED_FLAME_BASE;
}

/**
 * ONE Whisper cast resolved in the Shop (`castSpell`, every cast: from hand, a Yazzus repeat, Whisp's echo). `target`
 * is the body it was cast on (still on the board), if any.
 */
export function whisperCastShop(state: RunState, def: CardDef, target: BoardCard | undefined): void {
  if (!def.whisper) return;
  const f = state.questFlags;
  // BORROWED FLAME: the Dragon the Whisper landed on gains the current value (per copy), then the rune improves.
  if (f?.runeBorrowedFlame && target && state.board.includes(target) && isTribe(target, 'dragon')) {
    const v = borrowedFlameValue(state) * runeStacksOf(state, 'rune_borrowed_flame');
    procRuneId(state, 'rune_borrowed_flame');
    captureBuffFx(state, undefined, 'spell', () => addBuff(target, 'Borrowed Flame', v, v));
    state.runeBorrowedFlame = borrowedFlameValue(state) + improveReps(state);
  }
  // SPELL TEMPERING: one tick per Whisper cast; every 4th raises the run's spell power.
  if (f?.runeSpellTempering) {
    state.runeSpellTemperingTick = (state.runeSpellTemperingTick ?? 0) + 1;
    while (state.runeSpellTemperingTick >= SPELL_TEMPERING_PER) {
      state.runeSpellTemperingTick -= SPELL_TEMPERING_PER;
      procRuneId(state, 'rune_spell_tempering');
      const n = improveReps(state) * runeStacksOf(state, 'rune_spell_tempering');
      state.spellBonus = { attack: (state.spellBonus?.attack ?? 0) + n, health: (state.spellBonus?.health ?? 0) + n };
    }
  }
}

/** Open Treasury: a spell was just bought (both buy paths reach `applySpellBought`). */
export function openTreasuryOnBuy(state: RunState, spellId: string): void {
  if (!state.questFlags?.runeOpenTreasury || state.openTreasuryUsed) return;
  const def = CARD_INDEX[spellId];
  if (!def?.spell) return;
  state.openTreasuryUsed = true;
  procRuneId(state, 'rune_open_treasury');
  conjureToHand(state, [def], runeStacksOf(state, 'rune_open_treasury'), runeGrantOverflow());
}

/** Defiant Wings' Shop replay (Combat Prowess / Lasting Cadence): 2 random friendly Dragons +3/+6 and Ward, per copy,
 *  permanent like every Shop replay. The two picks are distinct; fewer Dragons = all of them. */
export function defiantWingsShop(state: RunState): void {
  for (let k = 0; k < runeStacksOf(state, 'rune_defiant_wings'); k++) {
    const pool = state.board.filter((c) => isTribe(c, 'dragon'));
    if (pool.length === 0) return;
    const rng = makeRng(state.rngCursor);
    const picks: BoardCard[] = [];
    for (let i = 0; i < DEFIANT_WINGS.count && pool.length > 0; i++) picks.push(...pool.splice(rng.int(pool.length), 1));
    state.rngCursor = rng.state();
    for (const m of picks) {
      addBuff(m, 'Defiant Wings', DEFIANT_WINGS.attack, DEFIANT_WINGS.health);
      if (!m.keywords.includes('DS')) m.keywords = [...m.keywords, 'DS'];
    }
  }
}
