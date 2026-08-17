/**
 * TUTORIAL — first-use lesson definitions (data).
 *
 * A lesson is the STABLE RULE for a mechanic (blueprint §8.2.2): its title, definition, optional prediction
 * and result copy. It is separate from a course STEP (which says what to do right now) so the same Rally
 * lesson can be reused by a step, a contextual hint, or a future tribe primer. Completion state
 * (New → Introduced → Demonstrated) is tracked per-profile in the UI (`ui/tutorial/tutorialProfile`); this
 * file only defines the rules.
 */

/** A lesson's presentation depth on a repeat encounter after it's been demonstrated. */
export type TutorialLessonRepeat = 'none' | 'keywordPulse' | 'compactReminder';

export interface TutorialLesson {
  id: string;
  /** The keyword/concept slug, matching a lesson-flag key. */
  concept: string;
  title: string;
  /** The stable rule sentence, styled with the game's keyword vocabulary. */
  definition: string;
  /** What WILL happen, shown before the effect resolves (Predict). */
  prediction?: string;
  /** What just happened, shown after it settles (Confirm). */
  result?: string;
  repeat: TutorialLessonRepeat;
  /** Optional Glossary entry to deep-link. */
  glossaryEntryId?: string;
}

/**
 * The canonical lesson-flag keys tracked at profile level, so a later course never reteaches a universal
 * interaction the player already demonstrated. This is the union the profile's `lessonFlags` is keyed by.
 * Kept as a const array (not just a type) so the UI can iterate/validate it. Extend as later rounds land.
 */
export const TUTORIAL_LESSON_KEYS = [
  // Core actions (the universal game verbs).
  'inspect_card',
  'buy_minion',
  'play_minion',
  'use_hero_power',
  'end_turn',
  'tavern_up',
  'sell_minion',
  'reorder_minion',
  'refresh_shop',
  'buy_spell',
  'cast_spell',
  'freeze_shop',
  'gild_minion',
  'forge_basic_rune',
  'forge_epic_rune',
  'replace_on_full_board',
  'read_health_loss', // "read_resolve_loss" in the blueprint — renamed with Resolve → Health
  'read_elimination',
  'read_post_game',
  // Mechanic keywords (taught on first actionable encounter).
  'keyword_rally',
  'keyword_echo',
  'keyword_shout',
  'keyword_start_of_combat',
  'keyword_end_of_turn',
  'keyword_discover',
  'attack_first_override',
] as const;

export type TutorialLessonKey = (typeof TUTORIAL_LESSON_KEYS)[number];
