/**
 * The single source of truth for the minion mechanic vocabulary: how to detect each mechanic (from effect
 * data + keywords + chooseOne), its medallion glyph, and its glossary text. Consumed by BOTH the medallion
 * resolver (mechIcon.ts) and the Compendium glossary (MinionBook.tsx) so they can never drift.
 */
import type { CardDef, EffectDef, Keyword } from '@game/core';

/** The card fields a predicate needs. A full CardDef satisfies it; the resolver builds one per CardView. */
export interface MechInput {
  keywords: Keyword[];
  effects: EffectDef[];
  chooseOne?: CardDef['chooseOne'];
  text: string;
}

export interface Mechanic {
  id: string;
  term: string;              // player-facing name (glossary)
  glyph: string;             // Icon.tsx name
  def: string;               // one-line glossary rule
  detect: (m: MechInput) => boolean;
  termRe?: RegExp;           // how the term appears in text (raw + renamed) — used ONLY to order multi-mechanic cards
  kw?: Keyword;              // set for keyword-based mechanics — used to break ties by keyword order
  order: number;             // final global tiebreak
}

export function toMechInput(c: CardDef): MechInput {
  return { keywords: c.keywords, effects: c.effects, chooseOne: c.chooseOne, text: c.text ?? '' };
}

/** Factories whose name alone fixes the keyword they grant (moved verbatim from MinionBook). */
const FIXED_GRANT: Record<string, Keyword> = {
  deathrattleGrantReborn: 'R',
  deathrattleGrantShield: 'DS',
  scGrantShieldTribe: 'DS',
  onShieldBreakGrantShield: 'DS',
};

/** Does this card GRANT keyword `code` (Mumi → Rise, Selfless Sentinel → Ward, …)? Reads fixed-grant
 *  factories + any params.keyword(s), across top-level and Choose-One effects. */
function grantsKeyword(m: MechInput, code: Keyword): boolean {
  const effs = [...m.effects, ...(m.chooseOne?.flatMap((o) => o.effects) ?? [])];
  return effs.some((e) => {
    if (FIXED_GRANT[e.do] === code) return true;
    const p = e.params as { keyword?: string; keywords?: string[] } | undefined;
    return p?.keyword === code || (Array.isArray(p?.keywords) && p.keywords.includes(code));
  });
}

/** A keyword-code predicate — carries the keyword OR grants it (mirrors the glossary). */
export const kwMatch = (code: Keyword) => (m: MechInput): boolean =>
  m.keywords.includes(code) || grantsKeyword(m, code);

const hasOn = (on: EffectDef['on']) => (m: MechInput): boolean => m.effects.some((e) => e.on === on);
const hasDo = (re: RegExp) => (m: MechInput): boolean => m.effects.some((e) => re.test(e.do));

/**
 * The registry. `order` is only consulted for the rare card whose several own-mechanics have no text term;
 * lower wins. Triggers are ordered ahead of passive keywords. Watcher is appended in Task 2.
 */
export const MECHANICS: Mechanic[] = [
  // — Triggers (fire on the card's own play/death/turn/kill/etc.) —
  { id: 'shout', term: 'Shout', glyph: 'battlecry', def: 'Fires when you play this minion from your hand.', detect: hasOn('onPlay'), termRe: /battlecr(?:y|ies)|shouts?/i, order: 10 },
  { id: 'echo', term: 'Echo', glyph: 'echo', def: 'Fires when this minion dies.', detect: hasOn('onDeath'), termRe: /deathrattles?|echoe?s?/i, order: 11 },
  { id: 'startCombat', term: 'Start of Combat', glyph: 'fist', def: 'Fires once, the moment the battle begins.', detect: kwMatch('SC'), kw: 'SC', termRe: /start of combat/i, order: 12 },
  { id: 'endTurn', term: 'End of Turn', glyph: 'sc', def: 'Fires at the end of each recruit turn, before you fight.', detect: hasOn('endOfTurn'), termRe: /end of turn/i, order: 13 },
  { id: 'avenge', term: 'Avenge', glyph: 'skull', def: 'Fires after every N of your minions die in a combat.', detect: hasOn('avenge'), termRe: /\bavenge\b/i, order: 14 },
  { id: 'rally', term: 'Rally', glyph: 'sword', def: 'Fires each time this minion attacks.', detect: kwMatch('RL'), kw: 'RL', termRe: /\brally\b|\brallies\b/i, order: 15 },
  { id: 'slaughter', term: 'Slaughter', glyph: 'slaughter', def: 'Fires each time this minion kills an enemy minion.', detect: kwMatch('SL'), kw: 'SL', termRe: /\bslaughters?\b/i, order: 16 },
  { id: 'bleed', term: 'Bleed', glyph: 'poison', def: "Marks enemies at Start of Combat; every few attacks, they each take this minion's Attack.", detect: hasDo(/^scArmBleed$/), termRe: /\bbleed\b/i, order: 17 },
  { id: 'chooseOne', term: 'Choose One', glyph: 'choose1', def: 'Pick one of two effects as you play the minion.', detect: (m) => !!m.chooseOne, termRe: /choose one/i, order: 18 },
  // — Combat keywords —
  { id: 'taunt', term: 'Taunt', glyph: 'taunt', def: 'Enemies must attack this minion first.', detect: kwMatch('T'), kw: 'T', termRe: /\btaunt\b/i, order: 30 },
  { id: 'ward', term: 'Ward', glyph: 'shield', def: 'Blocks the first hit it would take, then breaks.', detect: kwMatch('DS'), kw: 'DS', termRe: /divine shields?|\bwards?\b/i, order: 31 },
  { id: 'execute', term: 'Execute', glyph: 'execute', def: 'Destroys any minion it damages — spent after one hit.', detect: kwMatch('V'), kw: 'V', termRe: /venomous|\bexecutes?\b/i, order: 32 },
  { id: 'flurry', term: 'Flurry', glyph: 'windfury', def: 'Attacks twice each turn.', detect: kwMatch('W'), kw: 'W', termRe: /windfury|flurr(?:y|ies)/i, order: 33 },
  { id: 'crit', term: 'Critical Strike', glyph: 'target', def: 'Each attack has a chance to deal double damage.', detect: kwMatch('CR'), kw: 'CR', termRe: /critical strike/i, order: 34 },
  { id: 'rise', term: 'Rise', glyph: 'rise', def: 'The first time it dies, it returns once with 1 Health.', detect: kwMatch('R'), kw: 'R', termRe: /reborn|\brises?\b/i, order: 35 },
  { id: 'cleave', term: 'Cleave', glyph: 'cleave', def: 'Also damages the minions beside its target.', detect: kwMatch('C'), kw: 'C', termRe: /\bcleaves?\b/i, order: 36 },
  { id: 'immune', term: 'Immune', glyph: 'immune', def: "Can't take damage.", detect: kwMatch('IMM'), kw: 'IMM', termRe: /\bimmune\b/i, order: 37 },
  { id: 'stealth', term: 'Stealth', glyph: 'stealth', def: "Can't be attacked until it has attacked once.", detect: kwMatch('ST'), kw: 'ST', termRe: /\bstealth\b/i, order: 38 },
  // — Build & shop —
  { id: 'attachment', term: 'Attachment', glyph: 'magnetic', def: 'Play it onto a friendly minion to merge its stats and keywords in.', detect: kwMatch('M'), kw: 'M', termRe: /magneti[cz]e?[sd]?|attachments?|\battaches?\b|\battach\b/i, order: 40 },
  { id: 'consume', term: 'Consume', glyph: 'consume', def: 'Devours your Fodder to grow.', detect: kwMatch('CN'), kw: 'CN', termRe: /\bconsumes?\b/i, order: 41 },
  { id: 'fodder', term: 'Fodder', glyph: 'fodder', def: 'A cheap token your minions consume for stats.', detect: kwMatch('FD'), kw: 'FD', termRe: /\bfodder\b/i, order: 42 },
  { id: 'engraved', term: 'Engraved', glyph: 'engrave', def: 'Stat gains during combat carry back to your board.', detect: kwMatch('EG'), kw: 'EG', termRe: /engraved?/i, order: 43 },
  { id: 'discover', term: 'Discover', glyph: 'star', def: 'Peek at three cards and add one to your hand.', detect: hasDo(/discover/i), termRe: /\bdiscover\b/i, order: 44 },
];
