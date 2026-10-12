/**
 * GUIDES: a save's refusal, as the sentence the player reads. The server answers with a stable code and, for text
 * rules, the FIELD it refused (never the word). Player voice: what they see and can do, not how it is built.
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

export function guideErrorMessage(code: string, field?: string): string {
  const part = field ? PART[field] : undefined;
  switch (code) {
    case 'blocked_text':
      if (part === 'nicknames') return 'The nicknames have a word that is not allowed.';
      return `The ${part ?? 'guide'} has a word that is not allowed.`;
    case 'reserved_name': return 'That "by" line is reserved. Pick another name.';
    case 'bad_guide': return `Check the ${part ?? 'guide'}.`;
    case 'sign_in_required':
    case 'unauthenticated': return 'Sign in to write guides.';
    case 'not_allowed': return 'You cannot change this guide.';
    case 'not_found': return 'This guide no longer exists.';
    case 'conflict': return 'Someone else saved this guide while you were editing.';
    case 'too_many_guides': return `You already have ${GUIDE_LIMITS.guidesPerPlayer} guides. Delete one to make room.`;
    case 'rate_limited': return 'That is a lot of saves. Try again in a little while.';
    case 'offline': return 'Could not reach the server. Your guide is kept on this device.';
    case 'unavailable': return 'Guides cannot be saved yet. Try again later.';
    default: return 'Something went wrong saving the guide. Your text is still here.';
  }
}
