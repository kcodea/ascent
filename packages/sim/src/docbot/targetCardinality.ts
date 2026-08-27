/**
 * DOC BOT — the TARGET / CARDINALITY oracle (handoff §7.4).
 *
 * Tranche 1 proves the printed MAGNITUDE lands on SOME recipient; this oracle proves it lands on the RIGHT
 * NUMBER of the RIGHT BODIES — the "right amount, wrong body" class magnitude alone cannot see. Each
 * tranche-1 shop-lane subject is re-driven through the SAME fixtures (tribeRow / shoutRow / shopBase,
 * shared with `textOracle.ts` so the two oracles can never measure different circumstances), and the result
 * is normalized into an `ObservedGrant` — source, recipients[], amounts, permanence surface, phase — whose
 * recipient COUNT and ELIGIBILITY are compared against the parsed printed target language.
 *
 * §7.5 discipline: the target prose becomes a checkable predicate ONLY where the wording is unambiguous
 * ("your minions", "your Beasts", "other friendly minions", "a friendly Dragon", "adjacent minions",
 * "left-most"). Anything else parses to null and lands in the typed ambiguous-prose queue — a text-quality
 * finding, never an invented expectation. Combat-lane subjects are out of this oracle's shop lanes and are
 * counted as a typed lane exclusion, not silently green.
 */
import { CARD_INDEX } from '@game/content';
import type { CardDef, Tribe } from '@game/core';
import { reduce } from './../reducer';
import { applyEndOfTurn } from './../recruit';
import type { RunState, BoardCard } from './../state';
import { stripMarkers, tribeRow, shoutRow, shopBase, type OracleSubject } from './textOracle';

// ────────────────────────────────────────── the target grammar ──────────────────────────────────────────

/** singular/plural printed tribe word → the engine tribe id. "minion(s)" carries no tribe constraint. */
const TRIBE_PRINTS: ReadonlyArray<readonly [RegExp, string | null]> = [
  [/\bminions?\b/i, null],
  [/\bBeasts?\b/, 'beast'],
  [/\bDemons?\b/, 'demon'],
  [/\bDragons?\b/, 'dragon'],
  [/\bDwar(?:f|ves)\b/, 'dwarf'],
  [/\bKobolds?\b/, 'kobold'],
  [/\bMechs?\b/, 'mech'],
  [/\bUndead\b/, 'undead'],
];

export type TargetSpec =
  | { kind: 'single'; tribe: string | null }
  | { kind: 'all'; tribe: string | null; other: boolean }
  | { kind: 'adjacent' }
  | { kind: 'aimed-plus-neighbours' } // "a minion and its neighbours" — the aim plus its 1-2 flanks
  | { kind: 'edge'; side: 'left' | 'right' }
  | { kind: 'self' };

/**
 * Parse the FIRST unambiguous target phrase of a printed stat-buff text into a checkable predicate, or null
 * (ambiguous prose → the typed queue, §7.5). Order matters: the specific shapes ("adjacent", "left-most",
 * "other") outrank the broad ones, and "a friendly X" (cardinality ONE) is checked before "your Xs"
 * (cardinality ALL-eligible).
 */
export function parseTargetSpec(text: string): TargetSpec | null {
  const t = stripMarkers(text);
  const adj = /\badjacent (?:minions|friends)\b/i.exec(t);
  if (adj) return { kind: 'adjacent' };
  if (/\ba minion and its neighbou?rs\b/i.test(t)) return { kind: 'aimed-plus-neighbours' };
  const edge = /\b(left|right)-most(?: friendly)? minion\b/i.exec(t);
  if (edge) return { kind: 'edge', side: edge[1]!.toLowerCase() as 'left' | 'right' };
  if (/\bthis minion gains\b|\bgains? \+\d+\/\+\d+\b.*\bitself\b/i.test(t)) return { kind: 'self' };
  const single = /\b(?:a|an|another|one) friendly ([A-Z][a-z]+|minion)\b|\bGive a (minion)\b/.exec(t);
  if (single) {
    const word = single[1] ?? single[2]!;
    for (const [re, tribe] of TRIBE_PRINTS) if (re.test(word)) return { kind: 'single', tribe };
    return null; // "a friendly Something" naming no known tribe — ambiguous, queue it
  }
  const all = /\b(?:your|all(?: of)? your) (other )?([A-Z][a-z]+s?|minions)\b/.exec(t);
  if (all) {
    const word = all[2]!;
    for (const [re, tribe] of TRIBE_PRINTS) if (re.test(word)) return { kind: 'all', tribe, other: !!all[1] };
    return null; // "your Imps" / "your Shop spells" — a token/aura population, not this fixture's board
  }
  return null;
}

// ────────────────────────────────────────── observation ──────────────────────────────────────────

/** §7.4's normalized effect result: who granted, who received, how much, on which surface. */
export interface ObservedGrant {
  source: string; // subject card id
  recipients: Array<{ uid: string; cardId: string; tribe: string; position: number; isSelf: boolean; attack: number; health: number }>;
  permanent: boolean; // shop-phase board stats persist — always true on this surface
  phase: 'recruit';
}

export type GrantObservation =
  | { outcome: 'observed'; grant: ObservedGrant; boardAfterBodies: Array<{ uid: string; cardId: string; tribe: string }>; selfPosition: number }
  | { outcome: 'refused' }
  | { outcome: 'silent' };

const bodies = (s: RunState): Array<{ uid: string; cardId: string; tribe: string }> =>
  s.board.map((c) => ({ uid: c.uid, cardId: c.cardId, tribe: c.tribe }));

const clone = (s: RunState): RunState => ({ ...s, board: s.board.map((c) => ({ ...c })) } as RunState);

function recipientsOf(before: RunState, after: RunState, selfUid: string | null, source: string): ObservedGrant {
  const pre = new Map(before.board.map((c) => [c.uid, c] as const));
  const recipients: ObservedGrant['recipients'] = [];
  after.board.forEach((c, i) => {
    const b = pre.get(c.uid);
    if (!b) return; // arrivals are creations, not grant recipients
    const da = c.attack - b.attack;
    const dh = c.health - b.health;
    if (da !== 0 || dh !== 0) recipients.push({ uid: c.uid, cardId: c.cardId, tribe: c.tribe, position: i, isSelf: c.uid === selfUid, attack: da, health: dh });
  });
  return { source, recipients, permanent: true, phase: 'recruit' };
}

/** SPELL lane observation: same fixture and drive as tranche 1's `runSpellLane`. */
export function observeSpellGrant(def: CardDef): GrantObservation {
  const board = tribeRow();
  const tgtTribe = (def as { targetTribe?: string }).targetTribe;
  if (tgtTribe) board[0] = { ...board[0]!, tribe: tgtTribe as Tribe };
  const s0 = shopBase(board);
  const pre = clone(s0);
  const inHand: BoardCard = { uid: 'tcSpell', cardId: def.id, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard;
  const s1 = reduce({ ...s0, hand: [inHand] }, { type: 'play', uid: 'tcSpell', targetUid: 'fix0' });
  if (s1.hand.some((c) => c.uid === 'tcSpell')) return { outcome: 'refused' };
  const grant = recipientsOf(pre, s1, null, def.id);
  if (grant.recipients.length === 0) return { outcome: 'silent' };
  return { outcome: 'observed', grant, boardAfterBodies: bodies(s1), selfPosition: -1 };
}

/** SHOUT lane observation: play the minion (aim fix0 when it targets), self-deltas measured against def. */
export function observeShoutGrant(def: CardDef): GrantObservation {
  const board = shoutRow();
  const tgtTribe = (def as { targetTribe?: string }).targetTribe;
  if (tgtTribe) board[0] = { ...board[0]!, tribe: tgtTribe as Tribe };
  const s0 = shopBase(board);
  const pre = clone(s0);
  const inHand: BoardCard = {
    uid: 'tcPlay', cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health,
    keywords: [...def.keywords], golden: false,
  } as BoardCard;
  let s1 = reduce({ ...s0, hand: [inHand] }, { type: 'play', uid: 'tcPlay' });
  if (s1.pendingTarget?.uid === 'tcPlay') s1 = reduce(s1, { type: 'battlecryTarget', targetUid: 'fix0' });
  if (s1.hand.some((c) => c.uid === 'tcPlay')) return { outcome: 'refused' };
  const grant = recipientsOf(pre, s1, 'tcPlay', def.id);
  const selfAt = s1.board.findIndex((c) => c.uid === 'tcPlay');
  const self = selfAt >= 0 ? s1.board[selfAt]! : null;
  if (self && (self.attack !== def.attack || self.health !== def.health)) {
    grant.recipients.push({ uid: 'tcPlay', cardId: def.id, tribe: self.tribe, position: selfAt, isSelf: true, attack: self.attack - def.attack, health: self.health - def.health });
  }
  if (grant.recipients.length === 0) return { outcome: 'silent' };
  return { outcome: 'observed', grant, boardAfterBodies: bodies(s1), selfPosition: selfAt };
}

/** EOT lane observation: the subject sits FIRST on the staged board; `applyEndOfTurn` fires the dispatcher. */
export function observeEotGrant(def: CardDef): GrantObservation {
  const subj: BoardCard = {
    uid: 'tcEot', cardId: def.id, tribe: def.tribe, attack: def.attack, health: def.health,
    keywords: [...def.keywords], golden: false,
  } as BoardCard;
  const s = shopBase([subj, ...shoutRow()]);
  const pre = clone(s);
  applyEndOfTurn(s);
  const grant = recipientsOf(pre, s, 'tcEot', def.id);
  if (grant.recipients.length === 0) return { outcome: 'silent' };
  return { outcome: 'observed', grant, boardAfterBodies: bodies(s), selfPosition: s.board.findIndex((c) => c.uid === 'tcEot') };
}

// ────────────────────────────────────────── reconciliation ──────────────────────────────────────────

const eligible = (r: { tribe: string; cardId: string }, tribe: string | null): boolean => {
  if (!tribe) return true;
  if (r.tribe === tribe) return true; // instance tribe is authoritative in the shop
  const d = CARD_INDEX[r.cardId];
  return !!d && (d.tribe2 === tribe || !!d.universalTribe);
};

/**
 * Compare the observed recipient set against the parsed target predicate: COUNT and ELIGIBILITY both bind.
 * `boardAfter` supplies the eligible population for 'all' shapes; `selfPosition` anchors 'adjacent'/'self'.
 */
export function reconcileTargets(
  spec: TargetSpec,
  grant: ObservedGrant,
  boardAfter: Array<{ uid: string; cardId: string; tribe: string }>,
  selfPosition: number,
  aimedPosition = -1,
): string[] {
  const problems: string[] = [];
  const rs = grant.recipients;
  switch (spec.kind) {
    case 'single': {
      if (rs.length !== 1) problems.push(`cardinality: printed ONE target, observed ${rs.length} recipient(s) [${rs.map((r) => r.cardId).join(', ')}]`);
      for (const r of rs) if (!eligible(r, spec.tribe)) problems.push(`eligibility: printed a friendly ${spec.tribe}, observed ${r.cardId} (${r.tribe})`);
      break;
    }
    case 'all': {
      const want = boardAfter.filter((c, i) => eligible(c, spec.tribe) && !(spec.other && i === selfPosition));
      const wantUids = new Set(want.map((c) => c.uid));
      for (const r of rs) {
        if (!wantUids.has(r.uid)) problems.push(`eligibility: ${r.cardId} (${r.tribe}${r.isSelf ? ', self' : ''}) received but is outside "your ${spec.other ? 'other ' : ''}${spec.tribe ?? 'minion'}s"`);
      }
      const gotUids = new Set(rs.map((r) => r.uid));
      for (const c of want) {
        if (!gotUids.has(c.uid)) problems.push(`cardinality: eligible ${c.cardId} (${c.tribe}) did NOT receive — printed "your ${spec.tribe ?? 'minion'}s" reaches every eligible body`);
      }
      break;
    }
    case 'adjacent': {
      const wantPos = new Set([selfPosition - 1, selfPosition + 1]);
      for (const r of rs) if (!wantPos.has(r.position)) problems.push(`eligibility: ${r.cardId} at position ${r.position} is not adjacent to the subject at ${selfPosition}`);
      const expected = [...wantPos].filter((p) => p >= 0 && p < boardAfter.length).length;
      if (rs.length !== expected) problems.push(`cardinality: printed adjacent minions (${expected} exist), observed ${rs.length}`);
      break;
    }
    case 'aimed-plus-neighbours': {
      const want = new Set([aimedPosition - 1, aimedPosition, aimedPosition + 1].filter((p) => p >= 0 && p < boardAfter.length));
      for (const r of rs) if (!want.has(r.position)) problems.push(`eligibility: ${r.cardId} at position ${r.position} is neither the aimed minion (${aimedPosition}) nor a neighbour`);
      if (rs.length !== want.size) problems.push(`cardinality: printed the aim plus its neighbours (${want.size} bodies), observed ${rs.length}`);
      break;
    }
    case 'edge': {
      const pos = spec.side === 'left' ? 0 : boardAfter.length - 1;
      if (rs.length !== 1) problems.push(`cardinality: printed the ${spec.side}-most minion, observed ${rs.length} recipient(s)`);
      for (const r of rs) if (r.position !== pos) problems.push(`eligibility: printed the ${spec.side}-most (position ${pos}), observed ${r.cardId} at ${r.position}`);
      break;
    }
    case 'self': {
      if (rs.length !== 1 || !rs[0]!.isSelf) problems.push(`printed a self-gain, observed [${rs.map((r) => `${r.cardId}${r.isSelf ? ' (self)' : ''}`).join(', ')}]`);
      break;
    }
  }
  return problems;
}

export type CardinalityOutcome =
  | { outcome: 'reconciled' }
  | { outcome: 'mismatch'; problems: string[] }
  | { outcome: 'silent' }
  | { outcome: 'refused' }
  | { outcome: 'out-of-lane' } // combat-lane subject — no shop drive (typed + counted in the test)
  | { outcome: 'ambiguous' }; // no unambiguous target predicate (typed + pinned in the test)

export function runCardinalitySubject(subject: OracleSubject): CardinalityOutcome {
  const def = CARD_INDEX[subject.cardId]!;
  if (subject.lane === 'combat') return { outcome: 'out-of-lane' };
  const spec = parseTargetSpec(def.text);
  if (!spec) return { outcome: 'ambiguous' };
  const obs = subject.lane === 'spell' ? observeSpellGrant(def)
    : subject.lane === 'shout' ? observeShoutGrant(def)
    : observeEotGrant(def);
  if (obs.outcome !== 'observed') return { outcome: obs.outcome };
  // Both targeted lanes aim `fix0` (the tranche-1 convention) — its after-board position anchors the
  // aimed-plus-neighbours predicate.
  const aimedPosition = obs.boardAfterBodies.findIndex((c) => c.uid === 'fix0');
  const problems = reconcileTargets(spec, obs.grant, obs.boardAfterBodies, obs.selfPosition, aimedPosition);
  return problems.length ? { outcome: 'mismatch', problems } : { outcome: 'reconciled' };
}

// ────────────────────────────────────────── excuses ──────────────────────────────────────────

export interface TargetExcuse {
  /**
   *  'channel-grant'  — the grant lands on a run-wide channel (spell power / Imp aura / shop enchants), not
   *                     board bodies — there is no recipient set to count.
   *  'compound-effects' — the card's OTHER effects also move stats in the same drive, so the measured
   *                     recipient set is the union of several grants and no single predicate covers it.
   *  'conditional'    — the grant demands state the clean fixture cannot supply.
   *  'needs-triage'   — found, not yet ruled. Tolerated, reported, pinned.
   *  'confirmed-bug-pending-fix' — a VERIFIED wrong-body/wrong-count bug with a repro; the fix PR deletes it.
   */
  kind: 'channel-grant' | 'compound-effects' | 'conditional' | 'needs-triage' | 'confirmed-bug-pending-fix';
  why: string;
}

/** Seeded from the oracle's first full run (2026-08-27) — every entry INVESTIGATED before excusal. */
export const TARGET_EXCUSED: Readonly<Record<string, TargetExcuse>> = {
  k_alchemist: {
    kind: 'channel-grant',
    why: 'its Shout ("Your Rubies gain +1/+1") writes the run-wide Ruby aura channel (`rubyBonus`) — tranche 1 reconciles the magnitude against the channel delta, but there is no board recipient set for this oracle to count (the fixture board holds no Ruby-carrying body)',
  },
};
