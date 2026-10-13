/**
 * GUIDES: a refused write, as the sentence the player reads. The server answers with a stable code and, for text
 * rules, the FIELD it refused (never the word). Player voice: what they see and can do, not how it is built.
 *
 * A sentence says only what is true for the thing that was refused:
 *  - WHICH ACTION. A save, a delete and the team's import each have their own words. A delete that could not reach
 *    the server speaks of the delete; it never speaks of saving. Publishing and unpublishing are two
 *    actions: a refused unpublish never tells the player to publish.
 *  - WHETHER ANYTHING WAS KEPT. A refused save writes the author's text to this device only when there are unsaved
 *    changes. "kept on this device" is said only when the caller says something was (`kept`); not told, it is not said.
 *  - WHETHER IT IS KNOWN. THE ONE RULE: no sentence says a write was NOT made unless the server answered a KNOWN
 *    REFUSAL for it (`KNOWN_REFUSALS`, below: the codes the SQL and the function answer when they refuse that action
 *    and change nothing). Any other answer may follow a write that landed: the answer never came (`offline`), it
 *    came and could not be read (`server`), the function could not read what the database answered after writing
 *    (`guide_malformed`) or lost the database's answer (`guide_failed`), or it is a code nobody knows. Whether a
 *    player's text is public, or a guide still exists, is not something to guess at: those sentences say to check
 *    again, and the screen that shows one reads the lists again. Only a lost answer says the server could not be
 *    reached. A report is the one exception in its words: a player has no way to check, and pressing again is safe
 *    (the server then says "already reported"), so it says to try again.
 */
import { GUIDE_LIMITS } from '@game/guides';

/** A server field name -> how the editor labels that part of the guide. */
const PART: Readonly<Record<string, string>> = {
  title: 'title',
  tagline: 'tagline',
  body: 'write-up',
  byline: '"by" line',
  aliases: 'nicknames',
  core: 'Core cards',
  enablers: 'Enablers',
  mentions: 'write-up',
  iconCard: 'art icon',
  tribes: 'tribes',
  pairsWith: 'tribes',
  sets: 'cards',
};

export type GuideAction = 'save' | 'delete' | 'import' | 'publish' | 'unpublish' | 'bookmark' | 'report' | 'moderate';

export interface GuideErrorAbout {
  /** What was refused. A save when not named. */
  action?: GuideAction;
  /** A save only: the author's text is on this device right now. Not said unless this is true. */
  kept?: boolean;
}

const SIGN_IN = 'Sign in to write guides.';
const NOT_ALLOWED = 'You cannot change this guide. Duplicate it to make your own.';
const NO_LONGER = 'This guide no longer exists.';
const NO_SERVER = 'Could not reach the server.';
const WRONG = 'Something went wrong.';
/** An answer that never came (`lost`), or one that is no known refusal: the write may have landed. */
const checkAgain = (lost: boolean, whether: 'it changed' | 'it was deleted' | 'they were imported'): string =>
  `${lost ? NO_SERVER : WRONG} Check again in a moment to see whether ${whether}.`;

/** What every action can be refused for: no account (a guest, or a token that did not verify). */
const WHO = ['sign_in_required', 'unauthenticated'] as const;

/**
 * THE KNOWN REFUSALS of each action: the codes the SQL functions raise, and the function answers before it calls
 * them, when they REFUSE that action and nothing is written (the raise words of supabase/migrations/2026-10-1*-guides*.sql
 * and `GUIDE_ERROR_STATUS` in packages/guides/src/server.ts). Written down once, here, and read by both sides: the
 * sentences below say "nothing was changed" (or name the refusal) only for these, and the screens read the lists again
 * for every answer that is NOT one of these (`isKnownRefusal`). `guideMessages.test.ts` holds the two together: a
 * code listed here has a sentence of its own, and a code not listed here never says the write was not made.
 *
 * Not listed, on purpose: `offline`, `server`, `unavailable` (the seam's own), `guide_failed`, `guide_malformed`
 * (the write may have landed), and the shape refusals this client never causes (`bad_id`, `bad_op`, `bad_set`,
 * `bad_ids`...). Those read "check again", which is true of them too, and cost one extra read.
 *
 * A save is not here: its sentences speak of the author's text, which is still in the editor either way.
 */
export const KNOWN_REFUSALS = {
  delete: new Set<string>([...WHO, 'not_allowed', 'not_found']),
  publish: new Set<string>([...WHO, 'not_allowed', 'not_found', 'blocked_text', 'reserved_name', 'guide_hidden', 'conflict', 'rate_limited']),
  unpublish: new Set<string>([...WHO, 'not_allowed', 'not_found']),
  bookmark: new Set<string>([...WHO, 'not_allowed', 'not_found', 'too_many_bookmarks', 'rate_limited']),
  import: new Set<string>([...WHO, 'not_allowed', 'bad_guides', 'bad_guide', 'blocked_text', 'reserved_name']),
  report: new Set<string>([...WHO, 'not_allowed', 'not_found', 'already_reported', 'report_limit', 'bad_report']),
  /** Hide, unhide, dismiss and carry-over. */
  moderate: new Set<string>([...WHO, 'not_allowed', 'not_found']),
} as const satisfies Readonly<Partial<Record<GuideAction, ReadonlySet<string>>>>;

/** Did the server refuse this `action` with a code that is known to mean nothing was written? Anything else (a lost
 *  answer, a failure, a code nobody knows) may follow a write that landed: the caller reads the lists again. */
export function isKnownRefusal(action: keyof typeof KNOWN_REFUSALS, code: string): boolean {
  return KNOWN_REFUSALS[action].has(code);
}

export function guideErrorMessage(code: string, field?: string, about: GuideErrorAbout = {}): string {
  const action = about.action ?? 'save';
  if (action === 'import') {
    // Every refusal of an import reads the same. Anything else may have landed.
    if (isKnownRefusal('import', code)) return 'Something went wrong importing the guides. Nothing was imported.';
    return checkAgain(code === 'offline', 'they were imported');
  }
  if (action === 'delete') {
    switch (code) {
      case 'sign_in_required':
      case 'unauthenticated': return SIGN_IN;
      case 'not_allowed': return NOT_ALLOWED;
      case 'not_found': return NO_LONGER;
      // The answer was lost, or it is no refusal: the delete may have landed.
      default: return checkAgain(code === 'offline', 'it was deleted');
    }
  }
  const part = field ? PART[field] : undefined;
  if (action === 'publish') {
    switch (code) {
      case 'blocked_text':
        if (field === 'forked') return 'The guide this one is based on has a name that is not allowed, so this copy cannot be published. Write it as a new guide instead.';
        return `The ${part ?? 'guide'} has a word that is not allowed. Edit the guide, then publish it.`;
      case 'reserved_name': return `The ${part ?? 'guide'} uses a reserved name. Edit the guide, then publish it.`;
      case 'guide_hidden': return 'Team Ascent has hidden this guide. It cannot be published.';
      case 'conflict': return 'This guide changed while it was being published. Try again.';
      case 'sign_in_required':
      case 'unauthenticated': return SIGN_IN;
      case 'not_allowed': return NOT_ALLOWED;
      case 'not_found': return NO_LONGER;
      case 'rate_limited': return 'That is a lot of changes. Try again in a little while.';
      // The answer was lost, or it is no refusal (the publish was made and its answer could not be read): it may
      // have landed.
      default: return checkAgain(code === 'offline', 'it changed');
    }
  }
  // Taking a guide back to private checks no text, so it is never refused for its words: nothing here asks the
  // player to edit or to publish.
  if (action === 'unpublish') {
    switch (code) {
      case 'sign_in_required':
      case 'unauthenticated': return SIGN_IN;
      case 'not_allowed': return NOT_ALLOWED;
      case 'not_found': return NO_LONGER;
      default: return checkAgain(code === 'offline', 'it changed');
    }
  }
  if (action === 'bookmark') {
    switch (code) {
      case 'too_many_bookmarks': return `You already have ${GUIDE_LIMITS.bookmarksPerPlayer} bookmarks. Remove one to make room.`;
      case 'rate_limited': return 'That is a lot of bookmarks. Try again in a little while.';
      case 'sign_in_required':
      case 'unauthenticated': return 'Sign in to bookmark guides.';
      case 'not_allowed': return 'This guide cannot be bookmarked.';
      case 'not_found': return 'This guide is no longer available.';
      // The answer was lost, or it is no refusal: the bookmark may have been added or removed.
      default: return checkAgain(code === 'offline', 'it changed');
    }
  }
  if (action === 'report') {
    switch (code) {
      case 'already_reported': return 'You already reported this guide.';
      case 'report_limit': return 'That is a lot of reports. Try again tomorrow.';
      case 'sign_in_required':
      case 'unauthenticated': return 'Sign in to report guides.';
      case 'not_allowed': return 'This guide cannot be reported.';
      case 'not_found': return 'This guide is no longer available.';
      case 'bad_report': return 'Check the report.';
      // The report may have landed before the answer was lost: a second try then says "already reported".
      case 'offline': return `${NO_SERVER} Try again in a moment; if it says you already reported this guide, it went through.`;
      // Anything else that is no refusal may have been sent too. Pressing again is safe, for the same reason.
      default: return `${WRONG} Try again in a moment.`;
    }
  }
  if (action === 'moderate') {
    switch (code) {
      case 'not_allowed': return 'Only Team Ascent can do that.';
      case 'not_found': return NO_LONGER;
      case 'sign_in_required':
      case 'unauthenticated': return SIGN_IN;
      // Hide, unhide, dismiss and carry-over may have landed before the answer was lost.
      default: return checkAgain(code === 'offline', 'it changed');
    }
  }
  const kept = about.kept === true;
  switch (code) {
    case 'blocked_text':
      if (part === 'nicknames') return 'The nicknames have a word that is not allowed.';
      return `The ${part ?? 'guide'} has a word that is not allowed.`;
    case 'reserved_name':
      return part === 'title' || part === 'tagline' ? `The ${part} uses a reserved name. Pick another.` : 'That "by" line is reserved. Pick another name.';
    case 'bad_guide': return `Check the ${part ?? 'guide'}.`;
    case 'sign_in_required':
    case 'unauthenticated': return SIGN_IN;
    case 'not_allowed': return NOT_ALLOWED;
    case 'not_found': return kept ? `${NO_LONGER} Your text is kept on this device.` : NO_LONGER;
    case 'conflict': return 'Someone else saved this guide while you were editing.';
    case 'too_many_guides': return `You already have ${GUIDE_LIMITS.guidesPerPlayer} guides. Delete one to make room.`;
    case 'rate_limited': return 'That is a lot of saves. Try again in a little while.';
    case 'offline': return kept ? `${NO_SERVER} Your guide is kept on this device.` : `${NO_SERVER} Try again.`;
    case 'unavailable': return 'Guides cannot be saved yet. Try again later.';
    default: return 'Something went wrong saving the guide. Your text is still here.';
  }
}
