import type { BoardMinion, CardDef, CombatEvent, Keyword, MinionSnapshot, QuestCombatMods, Side } from '../types';
import { socTwilightExtraFires } from '../types';

/**
 * NEXT-COMBAT SPELL BANKS, FOR BOTH SIDES (owner rulings 2026-10-07).
 *
 *   *"these should carry over."* — the next-combat spells a served board had banked.
 *   *"rallying offensive and marked target should work for opponents."*
 *   *"we need to show these spells being cast in a start of combat beat."*
 *
 * A next-combat spell is cast in the Shop and resolves in the NEXT fight. Several of them used to be player-only:
 * Fleeting Vigor, the banked keywords (Field Maneuvers / Last Stand / Executioner's Edge) and Open the Gates were
 * pre-baked by the reducer into the PLAYER's combat board and spent before the board snapshot was captured;
 * Marked Target edited the enemy board in the reducer; Rallying Offensive was a player-only `CombatConfig` flag.
 * A board served back as an opponent therefore fought without them. They now ride the side's `QuestCombatMods`
 * (captured by `snapshotBoard` like Weaken always was) and are applied HERE, inside `simulate`, for whichever
 * side holds them.
 *
 * `applyBankedOpeners` is the EXACT transform the reducer used to make for the player (same order, same numbers,
 * no RNG), run before the boards are instantiated, so the player's own fight resolves identically. The
 * presentation half (`openingEvents`) is the rewind `enterCombat` used to make for Fleeting Vigor, extended to
 * every bank: the starting snapshot shows the board BEFORE the spell, and the opening events land it (a cast
 * marker, then the buff / keyword / summon), so the fight visibly opens with the cast.
 */

/** The spell each `QuestCombatMods` bank came from — the card the Start of Combat cast beat shows. */
export const BANKED_SPELL_OF = {
  fleetingVigor: 'fleetingvigor',
  bankedImps: 'openthegates',
  markFoeRightmostTaunt: 'markedtarget',
  rallyDouble: 'rallyoffensive',
  weakenTargets: 'weaken',
  decoySigils: 'decoysigil',
  summonTaunts: 'summoningbulwark',
  solidGroundLeft: 'sp_solidground',
  containFirstEnemySummon: 'sp_containmentrune',
  stolenInitiative: 'sp_stoleninitiative',
  attackFirstNext: 'preemptive',
} as const satisfies Partial<Record<keyof QuestCombatMods, string>>;

/** The per-minion one-combat spell marks, and the spell that set each. */
export const BANKED_MARK_SPELL_OF = {
  bloodlust: 'bloodlust',
  partingCry: 'sp_partingcry',
  closedCasket: 'sp_closedcasket',
} as const satisfies Partial<Record<keyof BoardMinion, string>>;

/** Every `QuestCombatMods` key that is a NEXT-COMBAT bank: armed by a Shop cast for exactly one fight. A served
 *  board re-fought past its own round must not repeat them (`stripNextCombatBanks`). `solidGroundStat` and
 *  `bankedKeywords` ride along with their banks. */
export const NEXT_COMBAT_BANK_KEYS = [
  ...Object.keys(BANKED_SPELL_OF),
  'solidGroundStat',
  'bankedKeywords',
] as readonly (keyof QuestCombatMods)[];

/** Every per-minion one-combat mark (the spell marks above plus Bloodlust's welded Rally). */
export const NEXT_COMBAT_MARK_KEYS = ['bloodlust', 'bloodlustRally', 'partingCry', 'closedCasket'] as const satisfies readonly (keyof BoardMinion)[];

/** A fresh copy of `mods` without any next-combat bank. Never mutates its input. */
export function stripNextCombatBanks(mods: QuestCombatMods): QuestCombatMods {
  const out: QuestCombatMods = { ...mods };
  for (const k of NEXT_COMBAT_BANK_KEYS) delete out[k];
  return out;
}

/** Copies of `minions` without their one-combat spell marks. Never mutates its input. */
export function stripNextCombatMarks(minions: readonly BoardMinion[]): BoardMinion[] {
  return minions.map((m) => {
    const c: BoardMinion = { ...m };
    for (const k of NEXT_COMBAT_MARK_KEYS) delete c[k];
    return c;
  });
}

/** The spell that banked a keyword grant: the grant's own `spellId`, else the keyword's only source today. */
export function bankedKeywordSpellId(g: { keyword: Keyword; spellId?: string }): string {
  if (g.spellId) return g.spellId;
  return g.keyword === 'R' ? 'laststand' : g.keyword === 'CR' ? 'executionersedge' : 'fieldmaneuvers';
}

/** The beat-policy identity every Start of Combat cast marker carries (`presentation/policies.ts`). */
export const BANKED_CAST_KEY = 'system:startOfCombat:bankedCast';

/** Board cap (mirrors the sim's `CONFIG.boardMax`; core has no CONFIG). */
const BOARD_MAX = 7;

/** What `applyBankedOpeners` did to one side — read back by `openingEvents` to rewind and narrate it. */
export interface OpenerRecord {
  fleeting: { attack: number; health: number; covered: number } | null;
  /** Board indices that GAINED a keyword (a native keyword gains nothing and is not narrated). */
  keywords: { index: number; keyword: Keyword; spellId: string }[];
  /** Board indices of the Imps that joined (appended). */
  imps: number[];
  /** The foe board index that gained Taunt from this side's Marked Target, or null. */
  marked: number | null;
  /** Whether this side held Marked Target at all (it is announced even when the foe had no body / already had Taunt). */
  markArmed: boolean;
}

// `keywords` stays ABSENT when absent: `instantiate` reads an absent list as "the card's printed keywords".
const cloneMinion = (m: BoardMinion): BoardMinion => (m.keywords ? { ...m, keywords: [...m.keywords] } : { ...m });

/**
 * Apply both sides' Start-of-Combat pre-bakes to COPIES of the boards. Order is the reducer's historical order
 * for the player (Fleeting Vigor, then keyword grants, then Open the Gates' Imps), each side in turn, and THEN
 * each side's Marked Target on its foe — so a foe's own Imps are already on the board and "right-most" means the
 * body that is right-most when the fight opens. No RNG.
 */
export function applyBankedOpeners(
  boards: Record<Side, readonly BoardMinion[]>,
  mods: Record<Side, QuestCombatMods>,
  impStats: Record<Side, { attack: number; health: number }>,
  cards: Record<string, CardDef>,
): { boards: Record<Side, BoardMinion[]>; records: Record<Side, OpenerRecord> } {
  const out: Record<Side, BoardMinion[]> = { player: boards.player.map(cloneMinion), enemy: boards.enemy.map(cloneMinion) };
  const blank = (): OpenerRecord => ({ fleeting: null, keywords: [], imps: [], marked: null, markArmed: false });
  const records: Record<Side, OpenerRecord> = { player: blank(), enemy: blank() };
  for (const side of ['player', 'enemy'] as const) {
    const m = mods[side];
    const board = out[side];
    const rec = records[side];
    // Rune of Twilight doubles Start-of-Combat effects, these banks included (owner report 2026-08-12), one
    // extra pass per Twilight copy — the same definition combat's own Start-of-Combat pass consults.
    const twilightMult = 1 + socTwilightExtraFires(m);
    const fv = m.fleetingVigor;
    if (fv && (fv.attack !== 0 || fv.health !== 0)) {
      const a = fv.attack * twilightMult;
      const h = fv.health * twilightMult;
      for (const b of board) { b.attack += a; b.health += h; }
      rec.fleeting = { attack: a, health: h, covered: board.length };
    }
    for (const g of m.bankedKeywords ?? []) {
      const b = board[g.index];
      if (!b) continue; // its minion was sold or died — nothing to grant
      b.keywords ??= [...(cards[b.cardId]?.keywords ?? [])];
      if (!b.keywords.includes(g.keyword)) {
        b.keywords.push(g.keyword);
        rec.keywords.push({ index: g.index, keyword: g.keyword, spellId: bankedKeywordSpellId(g) });
      }
      if (g.keyword === 'CR' && g.critChance !== undefined) b.critChance = g.critChance;
    }
    const impDef = cards['impscrap'];
    if ((m.bankedImps ?? 0) > 0 && impDef) {
      const room = Math.max(0, BOARD_MAX - board.length);
      const n = Math.min((m.bankedImps ?? 0) * twilightMult, room);
      // The Imp Aura is baked into a starting body (simulate re-adds it only to a from-base summon), so the
      // banked Imps carry the side's Imp Aura in, like any Imp the Shop summons.
      for (let k = 0; k < n; k++) {
        board.push({ cardId: 'impscrap', attack: impDef.attack + impStats[side].attack, health: impDef.health + impStats[side].health, keywords: [...impDef.keywords], golden: false });
        rec.imps.push(board.length - 1);
      }
    }
  }
  for (const side of ['player', 'enemy'] as const) {
    if (!mods[side].markFoeRightmostTaunt) continue;
    records[side].markArmed = true;
    const foe = out[side === 'player' ? 'enemy' : 'player'];
    const last = foe[foe.length - 1];
    if (!last) continue;
    const kws = last.keywords ?? [...(cards[last.cardId]?.keywords ?? [])];
    if (!kws.includes('T')) {
      last.keywords = [...kws, 'T'];
      records[side].marked = foe.length - 1;
    }
  }
  return { boards: out, records };
}

/** The Start of Combat cast markers for everything a side ARMED that has no opening effect of its own (it resolves
 *  later in the fight, or inside the Start-of-Combat pass): one per spell, in a fixed order. Weaken is excluded —
 *  its marker is emitted inline, right before the Weaken pass sets the Health. */
function armedCasts(side: Side, m: QuestCombatMods, board: readonly BoardMinion[], playerAttacksFirst: boolean): CombatEvent[] {
  const out: CombatEvent[] = [];
  const cast = (spellId: string, count?: number): void => { out.push({ type: 'bankedCast', side, spellId, ...(count && count > 1 ? { count } : {}), key: BANKED_CAST_KEY }); };
  if (m.rallyDouble) cast(BANKED_SPELL_OF.rallyDouble);
  // Pre-emptive Assault: the player's channel is still `CombatConfig.playerAttacksFirst` (an enemy's capture is
  // inert until the owner rules on both sides holding it), so only the side it actually applies to announces it.
  if (side === 'player' && playerAttacksFirst && m.attackFirstNext) cast(BANKED_SPELL_OF.attackFirstNext);
  if ((m.decoySigils ?? 0) > 0) cast(BANKED_SPELL_OF.decoySigils, m.decoySigils);
  if ((m.summonTaunts ?? 0) > 0) cast(BANKED_SPELL_OF.summonTaunts);
  if ((m.solidGroundLeft ?? 0) > 0) cast(BANKED_SPELL_OF.solidGroundLeft);
  if (m.containFirstEnemySummon) cast(BANKED_SPELL_OF.containFirstEnemySummon);
  if (m.stolenInitiative) cast(BANKED_SPELL_OF.stolenInitiative);
  for (const [mark, spellId] of Object.entries(BANKED_MARK_SPELL_OF) as [keyof typeof BANKED_MARK_SPELL_OF, string][]) {
    const n = board.filter((b) => b[mark]).length;
    if (n > 0) cast(spellId, n);
  }
  return out;
}

/**
 * THE OPENING: rewind the starting snapshots to the board BEFORE each bank, and return the events that land it,
 * side by side (player first). MUTATES `initial` (presentation only — the fight already resolved from the banked
 * board, and the replay is a pure fold of `(initial, events)`, so the fold reaches the identical board at the end of
 * the opening). Fleeting Vigor reproduces `enterCombat`'s historical rewind exactly (an `sc` line, then one `buff`
 * per covered minion); the other banks gain a `keyword` / `summon` event of their own. Every bank leads with its
 * `bankedCast` marker, the Start of Combat cast beat.
 */
export function openingEvents(
  initial: Record<Side, MinionSnapshot[]>,
  records: Record<Side, OpenerRecord>,
  mods: Record<Side, QuestCombatMods>,
  inputBoards: Record<Side, readonly BoardMinion[]>,
  playerAttacksFirst: boolean,
): CombatEvent[] {
  const events: CombatEvent[] = [];
  // Imps are removed from the starting snapshot first (they are the trailing entries), so the indices the
  // other rewinds use are the board's own.
  const impSnaps: Record<Side, MinionSnapshot[]> = { player: [], enemy: [] };
  for (const side of ['player', 'enemy'] as const) {
    const n = records[side].imps.length;
    if (n > 0) impSnaps[side] = initial[side].splice(initial[side].length - n, n);
  }
  for (const side of ['player', 'enemy'] as const) {
    const rec = records[side];
    const snaps = initial[side];
    if (rec.fleeting) {
      const { attack: a, health: h, covered } = rec.fleeting;
      events.push({ type: 'bankedCast', side, spellId: BANKED_SPELL_OF.fleetingVigor, key: BANKED_CAST_KEY });
      const buffed = snaps.slice(0, covered);
      const firstUid = buffed[0]?.uid;
      if (firstUid) {
        events.push({
          type: 'sc', source: firstUid,
          text: side === 'player' ? `Fleeting Vigor — your minions surge +${a}/+${h}` : `Fleeting Vigor: their minions surge +${a}/+${h}`,
        });
      }
      for (const s of buffed) {
        s.attack -= a; // rewind to the pre-Start-of-Combat board…
        s.health -= h;
        events.push({ type: 'buff', target: s.uid, attack: a, health: h, source: s.uid }); // …and land it here
      }
    }
    // One marker per granting spell, then its keywords.
    const bySpell = new Map<string, { index: number; keyword: Keyword }[]>();
    for (const k of rec.keywords) {
      const list = bySpell.get(k.spellId) ?? [];
      list.push(k);
      bySpell.set(k.spellId, list);
    }
    for (const [spellId, grants] of bySpell) {
      events.push({ type: 'bankedCast', side, spellId, ...(grants.length > 1 ? { count: grants.length } : {}), key: BANKED_CAST_KEY });
      for (const g of grants) {
        const s = snaps[g.index];
        if (!s) continue;
        s.keywords = s.keywords.filter((k) => k !== g.keyword);
        events.push({ type: 'keyword', target: s.uid, keyword: g.keyword });
      }
    }
    if (impSnaps[side].length > 0) {
      events.push({ type: 'bankedCast', side, spellId: BANKED_SPELL_OF.bankedImps, key: BANKED_CAST_KEY });
      // NOT pushed back into the starting snapshot: the `summon` lands each one at its committed board index.
      impSnaps[side].forEach((s, k) => { events.push({ type: 'summon', minion: s, side, index: snaps.length + k }); });
    }
  }
  // Marked Target after BOTH sides' openers, so a foe's banked Imp it marks has already been summoned.
  for (const side of ['player', 'enemy'] as const) {
    const rec = records[side];
    if (!rec.markArmed) continue;
    events.push({ type: 'bankedCast', side, spellId: BANKED_SPELL_OF.markFoeRightmostTaunt, key: BANKED_CAST_KEY });
    const foeSide: Side = side === 'player' ? 'enemy' : 'player';
    const foeSnaps = initial[foeSide];
    const s = rec.marked === null ? undefined
      : rec.marked < foeSnaps.length ? foeSnaps[rec.marked] : impSnaps[foeSide][rec.marked - foeSnaps.length];
    if (s) {
      s.keywords = s.keywords.filter((k) => k !== 'T');
      events.push({ type: 'keyword', target: s.uid, keyword: 'T' });
    }
  }
  for (const side of ['player', 'enemy'] as const) {
    events.push(...armedCasts(side, mods[side], inputBoards[side], playerAttacksFirst));
  }
  return events;
}
