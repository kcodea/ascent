import { CARD_INDEX } from '@game/content';
import { makeRng, type CardDef } from '@game/core';
import { castSpell, hatcherTier, instanceEffects, isTribe, keepWhisperCastDelta, mintWhisper, whisperMarksOf, withCastActor } from './recruit';
import { runeStacksOf } from './runeDup';
import { procRuneId, recordBounceFx, type BoardCard, type RunState } from './state';

/**
 * ── WHISPERS (Set 3 since 2026-10-14) — the lifecycle (owner 2026-10-13) ──────────────────────────────────────────────────────
 *
 * A WHISPER is a spell a card GRANTS (`grantWhisper` on the granting minion, naming the Whisper's card id). The owner's rules, verbatim intent:
 *
 *  1. A card that grants a Whisper gives you a copy in hand. When it is PLAYED FROM HAND the copy arrives at once
 *     (`grantWhispersOnPlay`, called by the reducer's minion play right after the body lands).
 *  2. If unused, the Whisper VANISHES at End of Turn and does not count as cast (`vanishWhispers`, called by
 *     `endRecruitTurn` right after the End-of-Turn triggers).
 *  3. At the start of your next turn you get a fresh copy again, as long as the granting card is still on your board
 *     (`grantWhisper` is a Start of Turn effect: the shared dispatcher, one Start-of-Turn beat per granter).
 *  4. Whispers are SPELLS and count as spells cast (like Rubies), but are NOT Shop spells: they are the Gift class.
 *  5. A Whisper's buff is NOT permanent: applied in the Shop, kept through that turn's combat, removed at the start
 *     of the next turn (`expireWhisperBuffs`, the first thing the turn flip does to the board). Engraved does not keep
 *     it (Engraved keeps stats gained IN combat). No card keeps Whisper stats yet; `keepWhisperBuffs` is the seam a
 *     future one calls.
 *
 * Every copy is its own grant: two Galas on the board give two Tomes; a Gilded granter's copy is worth double.
 */

/** The Whisper card id(s) a card grants (its `grantWhisper` markers), in printed order. */
export function whisperGrantsOf(card: BoardCard): string[] {
  return instanceEffects(card)
    .filter((e) => e.do === 'grantWhisper' && typeof e.params?.cardId === 'string')
    .map((e) => e.params!.cardId as string);
}

/** May this Whisper be cast on `target`? Every Whisper aims at any friendly minion except RIPPLE (Falx, 2026-10-14),
 *  which needs a minion with a Shout (the Resonance precedent: a Shout-less target refuses the cast, kept in hand). */
export function whisperTargetLegal(def: CardDef, target: BoardCard): boolean {
  if (!def.effects.some((e) => e.do === 'whisperReplayShout')) return true;
  return !!CARD_INDEX[target.cardId]?.effects.some((e) => e.on === 'onPlay');
}

/** Is this card definition a Whisper granter? (A def-level read for text and pickers.) */
export function defGrantsWhisper(def: CardDef | undefined): boolean {
  return !!def?.effects.some((e) => e.do === 'grantWhisper');
}

/** One granter's Whisper(s) into hand: one copy per marker, at the granter's multiplier (Gilded = double). */
export function grantWhisperFrom(state: RunState, granter: BoardCard): void {
  const stepping = instanceEffects(granter).some((e) => e.do === 'grantWhisper' && e.params?.tierStep === true);
  // Hatcher: the copy handed over on play is the CURRENT tier (no tick: a tick is a Start of Turn on the board).
  // The OWNER's grant (owner 2026-10-16): never tier-gated, so a Tier 5 Dragon on a Tier 4 board still grants its Whisper.
  for (const e of instanceEffects(granter)) {
    if (e.do !== 'grantWhisper' || typeof e.params?.cardId !== 'string') continue;
    const id = e.params.cardId as string;
    // `goldenCopies` (CueBee's Pass, R-DUOS-CARDS-05): a Gilded granter hands over 2 plain copies instead of a doubled one.
    if (e.params.goldenCopies === true) { mintWhisper(state, id, granter.golden ? 2 : 1, 1, undefined, true); continue; }
    mintWhisper(state, id, 1, granter.golden ? 2 : 1, stepping ? hatcherTier(granter) : undefined, true);
  }
}

/** Rule 1: the granting minion was just played from hand. */
export function grantWhispersOnPlay(state: RunState, card: BoardCard): void {
  if (!state.board.includes(card)) return;
  grantWhisperFrom(state, card);
}

/** Rule 2: every Whisper still in hand vanishes. Returns how many went (uncast, so nothing was counted). */
export function vanishWhispers(state: RunState): number {
  const before = state.hand.length;
  state.hand = state.hand.filter((c) => !CARD_INDEX[c.cardId]?.whisper);
  return before - state.hand.length;
}

/**
 * Rule 5: strip every TEMPORARY Whisper grant (board AND hand: a buffed minion can be returned to hand) — the stats
 * come off and so does the matching share of the `buffs` ledger, so the inspect breakdown keeps summing to the stats.
 * Attack never drops below 0; Health never below 1 (a minion that took Shop damage while buffed keeps its life).
 */
export function expireWhisperBuffs(state: RunState): void {
  for (const c of [...state.board, ...state.hand]) {
    if (c.seedEchoesTemp) c.seedEchoesTemp = undefined; // Seed: last turn's temporary Drake Pup Echoes go too
    // Bait / Warding Call: the keywords a Whisper added come off too (never one the body had of its own).
    if (c.whisperKeywords?.length) {
      const gone = c.whisperKeywords;
      c.keywords = c.keywords.filter((k) => !gone.includes(k));
      c.whisperKeywords = undefined;
    }
    const rows = c.whisperBuffs;
    if (!rows?.length) continue;
    for (const r of rows) {
      c.attack = Math.max(0, c.attack - r.attack);
      c.health = Math.max(1, c.health - r.health);
      const led = c.buffs?.find((b) => b.source === r.source);
      if (led) {
        led.attack -= r.attack;
        led.health -= r.health;
        led.count = Math.max(0, led.count - r.count);
      }
    }
    if (c.buffs) {
      c.buffs = c.buffs.filter((b) => b.count > 0 || b.attack !== 0 || b.health !== 0);
      if (c.buffs.length === 0) c.buffs = undefined;
    }
    c.whisperBuffs = undefined;
  }
}

/** The seam for a FUTURE card that keeps a Whisper's stats (none exists yet): drop the temporary marks, so the stats
 *  and their ledger rows simply stay, exactly like any permanent Shop buff. */
export function keepWhisperBuffs(card: BoardCard): void {
  card.whisperBuffs = undefined;
}

/** Combine the temporary Whisper marks of the copies a triple keeps, so the golden still sheds them next turn. */
export function mergeWhisperBuffs(cards: readonly BoardCard[]): BoardCard['whisperBuffs'] {
  const out: NonNullable<BoardCard['whisperBuffs']> = [];
  for (const c of cards) {
    for (const r of c.whisperBuffs ?? []) {
      const row = out.find((x) => x.source === r.source);
      if (row) { row.attack += r.attack; row.health += r.health; row.count += r.count; } else out.push({ ...r });
    }
  }
  return out.length > 0 ? out : undefined;
}

// ── HUM (Set 3, owner 2026-10-15): "The first Whisper cast on this is permanent." ─────────────────────────────────────
/** PER TURN (owner 2026-10-15: "first per turn"): Hum's keep count re-arms at every turn flip. The one switch: `false`
 *  makes it "per game" (the count is never cleared, so only the first 1 / 2 Whispers it ever receives are kept). */
export const HUM_PER_TURN = true;

/** A triple's Seed stacks and Hum latch: the SUM of every copy's stacks per lane, the highest keep count. */
export function seedEchoMerge(cards: readonly BoardCard[]): Pick<BoardCard, 'seedEchoes' | 'seedEchoesTemp' | 'whisperKeptThisTurn' | 'whisperKeywords' | 'whisperTick' | 'whisperKept' | 'lastingWordsUsedThisTurn'> {
  // Whisper keywords: a keyword is temporary on the golden only if every copy that carried it had it from a Whisper.
  const tempKw = [...new Set(cards.flatMap((c) => c.whisperKeywords ?? []))]
    .filter((k) => cards.every((c) => !c.keywords.includes(k) || (c.whisperKeywords ?? []).includes(k)));
  const tick = Math.max(0, ...cards.map((c) => c.whisperTick ?? 0)); // Hatcher: the furthest copy's progression (Tara's rule)
  const perm = cards.reduce((n, c) => n + (c.seedEchoes ?? 0), 0);
  const temp = cards.reduce((n, c) => n + (c.seedEchoesTemp ?? 0), 0);
  const kept = Math.max(0, ...cards.map((c) => c.whisperKeptThisTurn ?? 0));
  // Kept Whisper stats (Bequeathed Secrets' record): the golden SUMS the copies', as it sums their stats. Lasting Words'
  // per-turn latch: spent on the golden if it was spent on any copy (one body, one first Whisper this turn).
  const wkA = cards.reduce((n, c) => n + (c.whisperKept?.attack ?? 0), 0);
  const wkH = cards.reduce((n, c) => n + (c.whisperKept?.health ?? 0), 0);
  const lasting = cards.some((c) => c.lastingWordsUsedThisTurn);
  return {
    ...(wkA !== 0 || wkH !== 0 ? { whisperKept: { attack: wkA, health: wkH } } : {}),
    ...(lasting ? { lastingWordsUsedThisTurn: true } : {}),
    ...(perm > 0 ? { seedEchoes: perm } : {}),
    ...(temp > 0 ? { seedEchoesTemp: temp } : {}),
    ...(kept > 0 ? { whisperKeptThisTurn: kept } : {}),
    ...(tempKw.length > 0 ? { whisperKeywords: tempKw } : {}),
    ...(tick > 0 ? { whisperTick: tick } : {}),
  };
}

// ── SET 3 DRAGON RUNES, EPIC B (owner 2026-10-21): the from-hand Whisper hooks ────────────────────────────────────────
/**
 * ONE Whisper cast FROM HAND (the reducer's Whisper branch calls this once per cast: the first, every Yazzus repeat and
 * the Opened Vault's extra cast each count as one cast from hand). Around the shared `castSpell`:
 *
 *  - RUNE OF LASTING WORDS: the first such cast on each Dragon each turn is permanent. Snapshot the Dragon's Whisper
 *    marks, cast, then keep whatever this cast added (`keepWhisperCastDelta`, Hum's body). The latch is per Dragon
 *    (`lastingWordsUsedThisTurn`) and is spent by that first cast whatever it added (a Ripple has nothing to keep).
 *  - RUNE OF TWIN TONGUES: a TARGETED Whisper is then cast again on a random OTHER friendly Dragon it may legally land
 *    on (the run cursor), once per copy held. The copy is a full cast (counted, watcher-visible, at the same
 *    multiplier: it runs inside the reducer's `withWhisperMult`) cast BY the rune, so it is not from hand: Lasting
 *    Words never keeps it, and it never asks for another copy. No other Dragon: no copy.
 */
export function castWhisperFromHand(state: RunState, def: CardDef, target: BoardCard | undefined): void {
  const lasting = !!state.questFlags?.runeLastingWords && !!target && isTribe(target, 'dragon') && !target.lastingWordsUsedThisTurn;
  const before = lasting && target ? whisperMarksOf(target) : undefined;
  castSpell(state, def, target);
  if (before && target && state.board.includes(target)) {
    target.lastingWordsUsedThisTurn = true;
    if (keepWhisperCastDelta(target, before)) procRuneId(state, 'rune_lasting_words'); // the badge flashes only when it kept something
  }
  if (state.questFlags?.runeTwinTongues && target) twinTonguesCopy(state, def, target);
}

function twinTonguesCopy(state: RunState, def: CardDef, target: BoardCard): void {
  for (let k = 0; k < runeStacksOf(state, 'rune_twin_tongues'); k++) {
    const pool = state.board.filter((c) => c !== target && isTribe(c, 'dragon') && whisperTargetLegal(def, c));
    if (pool.length === 0) return;
    const rng = makeRng(state.rngCursor);
    const pick = pool[rng.int(pool.length)]!;
    state.rngCursor = rng.state();
    procRuneId(state, 'rune_twin_tongues');
    recordBounceFx(state, 'spell', target.uid, pick.uid); // the hop: the Whisper's target -> the twin Dragon
    withCastActor({ kind: 'rune', id: 'rune_twin_tongues' }, () => castSpell(state, def, pick));
  }
}

// Re-exported so the presentation can read a Whisper's live value without reaching into recruit internals.
export { whisperValue, whisperSpellsToNext, allSpellsCastThisGame, whisperMarksOf, humKeepCap, keepWhispersOnHum, hatcherTier, HATCHER_MAX_TIER, whisperStatBonusesOf } from './recruit';
