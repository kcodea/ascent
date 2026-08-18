/**
 * TUTORIAL — public surface of the course/scenario layer (`@game/sim`).
 *
 * The UI coaching layer imports from here. Course DATA (Learn Ascent), the omen/shop providers, and the
 * tutorial-lobby constructor are added alongside as they land; this index is the single seam.
 */
export * from './types';
export * from './lessons';
export { evalPredicate } from './evalPredicate';
export * from './learnAscent';
