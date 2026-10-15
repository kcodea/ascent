/**
 * THE RANKED ENTRY (owner 2026-10-11, R-RANK-06). Owner, verbatim: "when clicking on the play section there should
 * be a confirmation that says: This is a ranked lobby, abandoning the match after this point will lose you MMR.
 * Would you like to proceed? ... from there, even at the hero select screen, if they go back, they should place as
 * if they came in eighth place and lose the associated mmr".
 *
 * Saying yes COMMITS the player to a rated game before any run exists. The commitment is this record: the ranked
 * run id the game will carry, the seed, and the hero offer rolled against it. It lives in the store
 * (`rankedEntry`) and in localStorage, so:
 *   - picking a hero CONSUMES it (the run takes its `runId` and becomes the save);
 *   - Back from hero select ABANDONS it: the id settles as an 8th through the rank queue (`RANKED_ENTRY_PLACEMENT`);
 *   - closing the game on hero select keeps it, and the next launch reopens hero select on the SAME heroes
 *     (owner 2026-10-11: "Reopen on the same heroes"), so closing is neither a penalty nor a free reroll.
 * One id from confirm to finish means the server (which settles a run id once) can never count an entry twice.
 * Pure + storage only, so the rule is tested without the store.
 */
import { DEFAULT_LOBBY_RULES, isHeroReroll, type HeroReroll } from '@game/sim';

const ENTRY_KEY = 'ascent.rankedentry';

export interface RankedEntry {
  /** The ranked identity minted at the confirmation. The run a hero pick builds carries it. */
  runId: string;
  /** The seed the hero offer was rolled against (the run is created from it). */
  seed: number;
  /** The offered heroes, in the order they were shown (AFTER the re-roll, when one was used). */
  heroChoices: string[];
  /** THE HERO RE-ROLL (owner 2026-10-15, R-HERO-REROLL-01): the entry's one re-roll, once spent. It persists with the
   *  entry, so closing the game on hero select neither refunds the re-roll nor undoes it. Absent = unused. */
  heroReroll?: HeroReroll;
  /** ISO time the player confirmed. */
  at: string;
}

/** Leaving hero select with nobody out is the lowest place of a full table (the `abandonPlacementOf` rule). */
export const RANKED_ENTRY_PLACEMENT = DEFAULT_LOBBY_RULES.seatCount;

/** The window's title, over the painted divider (owner 2026-10-12: the Compendium's title + underline structure).
 *  The wording is Claude's pick, not the owner's. */
export const RANKED_CONFIRM_TITLE = 'Ranked Lobby';
/** The confirmation's copy, the owner's words (2026-10-11). */
export const RANKED_CONFIRM_TEXT = 'This is a ranked lobby, abandoning the match after this point will lose you MMR. Would you like to proceed?';
export const RANKED_CONFIRM_YES = "Yes, let's go.";
export const RANKED_CONFIRM_NO = 'No, go back.';
/** How long "No, go back." plays the card's exit before it unmounts. Mirrors `rc-out` in styles.css. */
export const RANKED_CONFIRM_EXIT_MS = 160;

function isRankedEntry(x: unknown): x is RankedEntry {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.runId === 'string' && o.runId.length > 0
    && typeof o.seed === 'number' && Number.isInteger(o.seed)
    && Array.isArray(o.heroChoices) && o.heroChoices.length > 0 && o.heroChoices.every((h) => typeof h === 'string')
    && typeof o.at === 'string'
    && (o.heroReroll === undefined || isHeroReroll(o.heroReroll));
}

/**
 * The entry left by a session that closed on hero select, or null. `stillOfferable` is the caller's check that
 * this build can still offer those heroes for that seed (a hero pulled or reworked since): an entry that fails
 * it, or is malformed, is dropped at no cost, never settled.
 */
export function loadRankedEntry(stillOfferable: (entry: RankedEntry) => boolean): RankedEntry | null {
  try {
    const raw = localStorage.getItem(ENTRY_KEY);
    if (!raw) return null;
    const o: unknown = JSON.parse(raw);
    if (isRankedEntry(o) && stillOfferable(o)) return o;
  } catch { /* fall through: unreadable = no entry */ }
  clearRankedEntry();
  return null;
}

export function saveRankedEntry(entry: RankedEntry): void {
  try { localStorage.setItem(ENTRY_KEY, JSON.stringify(entry)); } catch { /* storage full: the entry still holds this session */ }
}

export function clearRankedEntry(): void {
  try { localStorage.removeItem(ENTRY_KEY); } catch { /* ignore */ }
}
