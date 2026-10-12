/**
 * GUIDES: a refused write, as the sentence the player reads. The server answers with a stable code and, for text
 * rules, the FIELD it refused (never the word). Player voice: what they see and can do, not how it is built.
 *
 * A sentence says only what is true for the thing that was refused:
 *  - WHICH ACTION. A save, a delete and the team's import each have their own words. A delete that could not reach
 *    the server says the guide was not deleted; it never speaks of saving.
 *  - WHETHER ANYTHING WAS KEPT. A refused save writes the author's text to this device only when there are unsaved
 *    changes. "kept on this device" is said only when the caller says something was (`kept`); not told, it is not said.
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

export type GuideAction = 'save' | 'delete' | 'import';

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

export function guideErrorMessage(code: string, field?: string, about: GuideErrorAbout = {}): string {
  const action = about.action ?? 'save';
  if (action === 'import') {
    return code === 'offline' ? `${NO_SERVER} Nothing was imported.` : 'Something went wrong importing the guides. Nothing was imported.';
  }
  if (action === 'delete') {
    switch (code) {
      case 'offline': return `${NO_SERVER} The guide was not deleted.`;
      case 'sign_in_required':
      case 'unauthenticated': return SIGN_IN;
      case 'not_allowed': return NOT_ALLOWED;
      case 'not_found': return NO_LONGER;
      default: return 'Something went wrong deleting the guide. It was not deleted.';
    }
  }
  const kept = about.kept === true;
  const part = field ? PART[field] : undefined;
  switch (code) {
    case 'blocked_text':
      if (part === 'nicknames') return 'The nicknames have a word that is not allowed.';
      return `The ${part ?? 'guide'} has a word that is not allowed.`;
    case 'reserved_name': return 'That "by" line is reserved. Pick another name.';
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
