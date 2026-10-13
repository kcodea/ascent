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
 *    Publishing and bookmarking change nothing when they are refused, and say so.
 *  - WHETHER IT IS KNOWN. A publish or an unpublish that could not reach the server may still have landed (the answer
 *    was lost, not the request). Whether the player's text is public is not something to guess at: that sentence never
 *    says nothing was changed, it says to check again. A delete is the same (the author's own, and the team's): one
 *    whose answer never came may have landed, so it never says the guide was not deleted.
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
/** A publish or unpublish whose answer never came: it may have landed. */
const MAY_HAVE_CHANGED = `${NO_SERVER} Check again in a moment to see whether it changed.`;

export function guideErrorMessage(code: string, field?: string, about: GuideErrorAbout = {}): string {
  const action = about.action ?? 'save';
  if (action === 'import') {
    return code === 'offline' ? `${NO_SERVER} Nothing was imported.` : 'Something went wrong importing the guides. Nothing was imported.';
  }
  if (action === 'delete') {
    switch (code) {
      // The answer was lost, not the request: the delete may have landed.
      case 'offline': return `${NO_SERVER} Check again in a moment to see whether it was deleted.`;
      case 'sign_in_required':
      case 'unauthenticated': return SIGN_IN;
      case 'not_allowed': return NOT_ALLOWED;
      case 'not_found': return NO_LONGER;
      default: return 'Something went wrong deleting the guide. It was not deleted.';
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
      case 'offline': return MAY_HAVE_CHANGED;
      default: return 'Something went wrong. Nothing was changed.';
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
      case 'offline': return MAY_HAVE_CHANGED;
      default: return 'Something went wrong. Nothing was changed.';
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
      case 'offline': return `${NO_SERVER} Nothing was changed.`;
      default: return 'Something went wrong. Nothing was changed.';
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
      default: return 'Something went wrong. The report was not sent.';
    }
  }
  if (action === 'moderate') {
    switch (code) {
      case 'not_allowed': return 'Only Team Ascent can do that.';
      case 'not_found': return NO_LONGER;
      case 'sign_in_required':
      case 'unauthenticated': return SIGN_IN;
      // Hide, unhide, dismiss and carry-over may have landed before the answer was lost.
      default: return code === 'offline' ? `${NO_SERVER} Check again in a moment to see whether it changed.` : 'Something went wrong. Check again in a moment to see whether it changed.';
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
