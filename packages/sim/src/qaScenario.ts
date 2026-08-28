/**
 * QA SCENARIO V1 — the ONE serializable scenario envelope (Docbot handoff §4, Workstream A).
 *
 * This is the keystone contract Scene Builder exports, Docbot scans emit, bug-report repro converts into,
 * and regression tests check in. THREE RULES bind everything here (handoff §3, non-negotiable):
 *
 *   · ONE ENGINE. `runQaScenario` executes through the REAL `reduce` / `faceOmen` combat path — never a
 *     second implementation of card behaviour. A combat scenario is resolved by pinning the opponent into
 *     `servedBoards` and dispatching the real `faceOmen` action, exactly as a live turn does.
 *   · NO EXECUTABLE EXPECTATIONS. Scenario files are pure JSON; the expectation vocabulary below is closed
 *     and validated. A need the vocabulary can't express becomes a `needs-ruling` entry, not embedded JS.
 *   · DETERMINISTIC RESULTS. Running the same scenario twice produces a byte-equivalent normalized result:
 *     no wall-clock, no Math.random, order-insensitive stringify (`stableStringify`), and the runner pins the
 *     wave's opponent before executing so the session-global opponent pool can never leak into the outcome.
 *
 * Versioning: `schemaVersion` is literal `1`. Any other version FAILS validation loudly — migrations are an
 * explicit act (write the migrator, bump the literal), never a silent best-effort parse.
 */
import type { CombatEvent, GamePresentationEvent } from '@game/core';
import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX, SETS } from '@game/content';
import { CONFIG } from './config';
import { deserialize, missingCardIds, serialize, type Action, type RunState } from './state';
import { reduceWithPresentation } from './reducer';
import type { BoardSnapshot } from './snapshot';
import { HEROES } from './heroes';

// ── JSON-safe primitives ───────────────────────────────────────────────────────────────────────────────────

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Order-insensitive, undefined-stripping stringify — the docbot `stable()` pattern (see playScan.ts for why
 *  plain JSON.stringify is a trap: key insertion order is history-dependent). The normalization backbone. */
export const stableStringify = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
};

/** 32-bit FNV-1a over a string, rendered as 8 hex chars — the WP C state-hash rail. Pure, dependency-free,
 *  and cheap enough to run per accepted action (the ring buffer's cost is measured in bug-report PR notes). */
export const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

// ── The envelope ───────────────────────────────────────────────────────────────────────────────────────────

/** The output of `serialize(runState)` — a JSON string, carried opaque so the envelope survives run-state
 *  field churn without a schema bump (deserialize heals missing fields against a fresh run). */
export type SerializedRunState = string;

export type QaScenarioSource = 'generated' | 'scene-builder' | 'bug-report' | 'regression' | 'retro';
export type QaScenarioMode = 'recruit' | 'combat' | 'lobby';

/**
 * WP C (canonical-schemas.md §1) — one entry of a bounded ACTION TRAIL: an exact recorded action plus the
 * observational reproduction rails around it. `state` remains the checkpoint; a trail replays from it.
 * Every rail field is OPTIONAL per entry — old capsules/scenarios without them stay valid, and an absent
 * rail is honestly absent (never fabricated, §4.3). The rails are read from state (`rngCursor` is a plain
 * serialized field; the hashes are `fnv1a(normalizeRunState(s))`) — recording them consumes NO rng and
 * mutates nothing (the traceNeutrality lane is the standing proof).
 *
 * Deliberately NOT here (deferred, recorded as a judgement call in the WP C devlog): per-roll `rngRecords`
 * (§4.4's makeRng tap — the cursor rail already pinpoints the first divergent action without wrapping the
 * generator) and `resolvedTargets` (no emission substrate yet).
 */
export interface RecordedActionWindow {
  action: Action;
  /** `state.rngCursor` immediately BEFORE the action was reduced. */
  rngCursorBefore?: number;
  /** `fnv1a(normalizeRunState(state))` immediately before / after the action. */
  stateHashBefore?: string;
  stateHashAfter?: string;
}

export interface QaScenarioV1 {
  schemaVersion: 1;
  /** Stable identity — the fixture filename stem by convention (`recruit-emissary-buff`). */
  id: string;
  title: string;
  source: QaScenarioSource;
  /** The run seed — must match the serialized state's own seed (validated; a mismatch is a corrupt file). */
  seed: number;
  /** The pinned card set — must match the serialized state's `setId` (validated). */
  setId: string;
  mode: QaScenarioMode;
  state: SerializedRunState;
  /** The single action to execute (recruit/lobby). Combat mode executes the real `faceOmen` hand-off; an
   *  explicit action there must BE `faceOmen` (validated) — combat is never resolved by a side path. */
  action?: Action;
  /** WP C (§8.2 exact shop/recruit reproduction) — a bounded ACTION TRAIL replacing the single-action
   *  limitation for reports that need sequencing. `state` remains the checkpoint; the trail replays from it
   *  through the real reducer, and any recorded rails (rng cursor / state hashes) are verified per action —
   *  the FIRST divergent action is reported precisely (`QaScenarioResult.firstDivergence`). Mutually
   *  exclusive with `action` (validated). Recruit/lobby modes only — combat resolves through the one
   *  `faceOmen` hand-off (a trail may itself END in a `faceOmen` entry). */
  actions?: RecordedActionWindow[];
  /** WP C (§8.1) — a captured semantic-trace fragment: EVIDENCE of what a run produced, never an oracle
   *  (expectations stay in `expectations`). Entries are recruit presentation events and/or combat semantic
   *  events from the trace adapter; carried opaque (JSON) so envelope validation doesn't chase their unions. */
  observedSemantic?: JsonValue[];
  combat?: {
    /** The exact enemy board — pinned into `servedBoards` so the REAL reducer path serves it verbatim. */
    opponent: BoardSnapshot;
    /** UI hint for Scene Builder playback (PR 2); the headless runner ignores it. */
    visibleEventIndex?: number;
  };
  /** Explicit, composable, validated — never executable (§4.3). Plural by design: one scenario routinely
   *  asserts a delta AND an invariant AND an event count. */
  expectations?: QaExpectation[];
  ruleIds?: string[];
  /** Content this scenario is ABOUT (for finding-attribution) — every id must resolve today. */
  contentIds?: string[];
  /** HUMAN-FACING provenance only — nothing keys off these. */
  metadata?: {
    createdAt?: string;
    appVersion?: string;
    /** DEPRECATED as an identity: no writer sets it, and `semanticRevision` below (which carries the build
     *  sha as its first component, plus the content/rules/schema revisions) is the machine identity every
     *  producer actually stamps. Left in the shape because removing a validated optional field would break
     *  older files for nothing; treat any value here as a human note (WP H migration audit, D-9j). */
    commit?: string;
    reportId?: string;
    notes?: string;
  };
  /** §16 identity of the environment this scenario was captured/evaluated under (canonical-schemas.md §1/§5;
   *  computed by `semanticRevision()` in semanticRevision.ts). OPTIONAL — the entire existing corpus stays
   *  valid; checked-in curated fixtures generally OMIT it (it moves on every content change and drift
   *  reporting is WP C/G work), while emitted results and findings stamp it. */
  semanticRevision?: string;
  /** §8.1 provenance — the machine-usable chain graduation (§14) walks: which finding/report/scenario this
   *  one came from. OPTIONAL, additive (canonical-schemas.md §1). `metadata.reportId` stays for humans. */
  provenance?: {
    kind?: QaScenarioSource;
    reportId?: string;
    findingFingerprint?: string;
    parentScenarioId?: string;
    minimizedFrom?: string;
  };
}

// ── Expectations (§4.3 — the closed vocabulary) ────────────────────────────────────────────────────────────

/** Selects a card by AUTHORED identity — content id first, runtime uid only as a last resort (uids are
 *  generated and don't survive re-authoring a setup; content id + zone + nth-match does). */
export interface QaCardSelector {
  cardId: string;
  /** Which zone to look in (default 'board'). */
  zone?: 'board' | 'hand' | 'shop';
  /** The nth card matching `cardId` in that zone, 0-based (default 0). */
  index?: number;
  /** Last-resort runtime uid — only for states whose uids were authored deliberately (Scene Builder). */
  uid?: string;
}

/** Shallow field-equality filter on an event object (`where: { side: 'player' }`). */
export type QaPredicateSpec = Record<string, JsonValue>;

export type QaExpectation =
  /** A dotted path into the AFTER run-state equals a JSON value (`path: 'embers'`, `path: 'board.0.attack'`,
   *  `path: 'lastCombat.result'`). */
  | { kind: 'state-delta'; path: string; equals: JsonValue }
  /** Exactly `count` emitted events of `type === event` (combat log + recruit presentation events pooled),
   *  optionally filtered by shallow field equality. */
  | { kind: 'event-count'; event: string; count: number; where?: QaPredicateSpec }
  /** The selected card's stats changed by exactly this much between before and after. Omitted stat = assert
   *  unchanged (a delta of 0). */
  | { kind: 'card-delta'; selector: QaCardSelector; attack?: number; health?: number }
  /** Exactly `count` summons (combat `summon` events + recruit `cardSummoned` events), optionally of one card. */
  | { kind: 'summon-count'; cardId?: string; count: number }
  /** The action changed nothing (normalized before === normalized after) — the refused-action contract. */
  | { kind: 'no-op' }
  /** Reachable but unruled — recorded and surfaced, never silently blessed (§3.4). Always "passes" while
   *  flagging the scenario's result as needing an owner ruling. */
  | { kind: 'needs-ruling'; question: string }
  /** A named structural invariant from `QA_INVARIANTS` holds on the after-state. */
  | { kind: 'invariant'; id: string };

const EXPECTATION_KINDS = new Set<QaExpectation['kind']>([
  'state-delta', 'event-count', 'card-delta', 'summon-count', 'no-op', 'needs-ruling', 'invariant',
]);

// ── Invariants ─────────────────────────────────────────────────────────────────────────────────────────────

/** The named structural invariants an `invariant` expectation can reference. `check` returns null when the
 *  invariant holds, or a human-readable violation. Grow this registry; never inline invariant logic in files. */
export const QA_INVARIANTS: Record<string, { title: string; check: (s: RunState) => string | null }> = {
  'embers-non-negative': {
    title: 'Gold (embers) never goes negative',
    check: (s) => (s.embers >= 0 ? null : `embers is ${s.embers}`),
  },
  'board-within-cap': {
    title: `Board never exceeds ${CONFIG.boardMax} minions`,
    check: (s) => (s.board.length <= CONFIG.boardMax ? null : `board has ${s.board.length} minions`),
  },
  'stats-finite': {
    title: 'Every board/hand card has finite, non-NaN stats',
    check: (s) => {
      for (const c of [...s.board, ...s.hand]) {
        if (!Number.isFinite(c.attack) || !Number.isFinite(c.health)) return `${c.cardId} (${c.uid}) is ${c.attack}/${c.health}`;
      }
      return null;
    },
  },
};

// ── Validation ─────────────────────────────────────────────────────────────────────────────────────────────

const SOURCES = new Set<QaScenarioSource>(['generated', 'scene-builder', 'bug-report', 'regression', 'retro']);
const MODES = new Set<QaScenarioMode>(['recruit', 'combat', 'lobby']);

/** EXHAUSTIVE map of the Action union's discriminants — a `Record` keyed on `Action['type']` so adding an
 *  action to the union without listing it here is a TYPE error, not a silently-permissive validator. */
const ACTION_TYPES: Record<Action['type'], true> = {
  combatEscalationPreview: true, combatSpellCastPreview: true, combatFriendlyDeathPreview: true,
  combatBladeAttackPreview: true, buy: true, buyHenchman: true, play: true, sell: true, roll: true,
  freeze: true, upgrade: true, reposition: true, reorderShop: true, reorderHand: true, heroPower: true,
  pickPower: true, discover: true, buyQuest: true, buyRune: true, skipRuneforge: true, rerollRuneforge: true,
  resolveShopDeath: true,
  chooseOne: true, cancelChoice: true, battlecryTarget: true, closeScout: true, faceOmen: true, settleCombat: true,
  resolveCombat: true, devGrant: true,
};

/** Does this id resolve in ANY content index (card, rune, quest)? */
const contentIdResolves = (id: string): boolean =>
  !!CARD_INDEX[id] || !!RUNE_INDEX[id] || !!QUEST_INDEX[id];

/**
 * Validate a raw parsed value as a `QaScenarioV1`. Every error is ACTIONABLE — it names the field and the
 * offending value, so a stale fixture tells you which card/rune/quest to fix rather than crashing later
 * inside `CARD_INDEX[id]` (the §4.6 acceptance criterion).
 */
export function validateQaScenario(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['scenario is not a JSON object'];
  const s = raw as Partial<QaScenarioV1> & { schemaVersion?: unknown };

  // Version FIRST, and loud: an unknown version must not be half-validated (the migration guard).
  if (s.schemaVersion !== 1) {
    return [`unsupported schemaVersion ${JSON.stringify(s.schemaVersion)} — this build understands version 1 only; migrate the scenario explicitly (do not hand-edit the version field)`];
  }

  if (typeof s.id !== 'string' || s.id.length === 0) errors.push('id must be a non-empty string');
  if (typeof s.title !== 'string' || s.title.length === 0) errors.push('title must be a non-empty string');
  if (typeof s.source !== 'string' || !SOURCES.has(s.source as QaScenarioSource)) {
    errors.push(`source ${JSON.stringify(s.source)} is not one of ${[...SOURCES].join(' | ')}`);
  }
  if (typeof s.seed !== 'number' || !Number.isFinite(s.seed)) errors.push('seed must be a finite number');
  if (typeof s.setId !== 'string' || !(s.setId in SETS)) {
    errors.push(`setId ${JSON.stringify(s.setId)} is not a known set (${Object.keys(SETS).join(', ')})`);
  }
  if (typeof s.mode !== 'string' || !MODES.has(s.mode as QaScenarioMode)) {
    errors.push(`mode ${JSON.stringify(s.mode)} is not one of ${[...MODES].join(' | ')}`);
  }

  // The serialized state: parseable, and consistent with the envelope's own seed/set claims.
  if (typeof s.state !== 'string') {
    errors.push('state must be the serialize() string of a RunState');
  } else {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(s.state) as Record<string, unknown>;
    } catch {
      errors.push('state is not valid JSON');
    }
    if (parsed) {
      if (typeof s.seed === 'number' && parsed.seed !== s.seed) {
        errors.push(`seed mismatch: envelope says ${s.seed}, serialized state says ${String(parsed.seed)}`);
      }
      if (typeof s.setId === 'string' && parsed.setId !== undefined && parsed.setId !== s.setId) {
        errors.push(`setId mismatch: envelope says ${s.setId}, serialized state says ${String(parsed.setId)}`);
      }
      const heroId = parsed.heroId;
      if (typeof heroId === 'string' && !HEROES.some((h) => h.id === heroId)) {
        errors.push(`state.heroId ${JSON.stringify(heroId)} is not a live hero`);
      }
      // Card-reference integrity WITHOUT hydrating: board/hand/shop card ids must resolve today.
      for (const zone of ['board', 'hand', 'shop'] as const) {
        const cards = parsed[zone];
        if (!Array.isArray(cards)) continue;
        for (const c of cards) {
          const id = (c as { cardId?: unknown }).cardId;
          if (typeof id === 'string' && !CARD_INDEX[id]) {
            errors.push(`state.${zone} references unknown card id '${id}' — the card was removed or renamed; regenerate the scenario`);
          }
        }
      }
    }
  }

  if (s.action !== undefined) {
    const t = (s.action as { type?: unknown }).type;
    if (typeof t !== 'string' || !(t in ACTION_TYPES)) {
      errors.push(`action.type ${JSON.stringify(t)} is not a known Action type`);
    } else if (t === 'devGrant') {
      const id = (s.action as { id?: unknown }).id;
      if (typeof id !== 'string' || !(RUNE_INDEX[id] || QUEST_INDEX[id])) {
        errors.push(`devGrant id ${JSON.stringify(id)} resolves to no rune or quest`);
      }
    }
  }

  if (s.actions !== undefined) {
    if (!Array.isArray(s.actions) || s.actions.length === 0) {
      errors.push('actions, when present, must be a non-empty array of RecordedActionWindow entries');
    } else {
      if (s.action !== undefined) errors.push('action and actions are mutually exclusive — a trail replaces the single action');
      if (s.mode === 'combat') errors.push("mode 'combat' resolves through the one faceOmen hand-off — use mode 'recruit'/'lobby' for an action trail (it may end in a faceOmen entry)");
      for (const [i, w] of s.actions.entries()) {
        const t = (w as { action?: { type?: unknown } }).action?.type;
        if (typeof t !== 'string' || !(t in ACTION_TYPES)) {
          errors.push(`actions[${i}].action.type ${JSON.stringify(t)} is not a known Action type`);
        }
        const cur = (w as { rngCursorBefore?: unknown }).rngCursorBefore;
        if (cur !== undefined && (typeof cur !== 'number' || !Number.isFinite(cur))) {
          errors.push(`actions[${i}].rngCursorBefore must be a finite number when present`);
        }
        for (const k of ['stateHashBefore', 'stateHashAfter'] as const) {
          const h = (w as unknown as Record<string, unknown>)[k];
          if (h !== undefined && (typeof h !== 'string' || h.length === 0)) {
            errors.push(`actions[${i}].${k} must be a non-empty string when present`);
          }
        }
      }
    }
  }
  if (s.observedSemantic !== undefined && !Array.isArray(s.observedSemantic)) {
    errors.push('observedSemantic, when present, must be an array');
  }

  if (s.mode === 'combat') {
    if (!s.combat?.opponent) errors.push("mode 'combat' requires combat.opponent (the exact enemy BoardSnapshot)");
    if (s.action && (s.action as { type?: string }).type !== 'faceOmen') {
      errors.push("mode 'combat' resolves through the real faceOmen hand-off — an explicit action must be { type: 'faceOmen' }");
    }
  }
  if (s.combat?.opponent) {
    const minions = (s.combat.opponent as { minions?: unknown }).minions;
    if (!Array.isArray(minions)) errors.push('combat.opponent.minions must be an array');
    else {
      for (const m of minions) {
        const id = (m as { cardId?: unknown }).cardId;
        if (typeof id !== 'string' || !CARD_INDEX[id]) {
          errors.push(`combat.opponent references unknown card id ${JSON.stringify(id)} — regenerate the scenario against current content`);
        }
      }
    }
  }

  for (const id of s.contentIds ?? []) {
    if (!contentIdResolves(id)) errors.push(`contentIds entry '${id}' resolves to no card, rune, or quest`);
  }

  if (s.semanticRevision !== undefined && (typeof s.semanticRevision !== 'string' || s.semanticRevision.length === 0)) {
    errors.push('semanticRevision, when present, must be a non-empty string');
  }
  if (s.provenance !== undefined) {
    if (!s.provenance || typeof s.provenance !== 'object' || Array.isArray(s.provenance)) {
      errors.push('provenance, when present, must be an object');
    } else {
      const kind = (s.provenance as { kind?: unknown }).kind;
      if (kind !== undefined && (typeof kind !== 'string' || !SOURCES.has(kind as QaScenarioSource))) {
        errors.push(`provenance.kind ${JSON.stringify(kind)} is not one of ${[...SOURCES].join(' | ')}`);
      }
    }
  }

  for (const [i, e] of (s.expectations ?? []).entries()) {
    const kind = (e as { kind?: unknown }).kind;
    if (typeof kind !== 'string' || !EXPECTATION_KINDS.has(kind as QaExpectation['kind'])) {
      errors.push(`expectations[${i}].kind ${JSON.stringify(kind)} is not in the closed vocabulary (${[...EXPECTATION_KINDS].join(', ')})`);
      continue;
    }
    const exp = e as QaExpectation;
    if (exp.kind === 'invariant' && !QA_INVARIANTS[exp.id]) {
      errors.push(`expectations[${i}] references unknown invariant '${exp.id}' (known: ${Object.keys(QA_INVARIANTS).join(', ')})`);
    }
    if (exp.kind === 'card-delta' && !CARD_INDEX[exp.selector?.cardId ?? '']) {
      errors.push(`expectations[${i}] selector.cardId ${JSON.stringify(exp.selector?.cardId)} is not a known card`);
    }
    if (exp.kind === 'summon-count' && exp.cardId !== undefined && !CARD_INDEX[exp.cardId]) {
      errors.push(`expectations[${i}].cardId ${JSON.stringify(exp.cardId)} is not a known card`);
    }
    if (exp.kind === 'state-delta' && (typeof exp.path !== 'string' || exp.path.length === 0)) {
      errors.push(`expectations[${i}].path must be a non-empty dotted path`);
    }
    if (exp.kind === 'needs-ruling' && (typeof exp.question !== 'string' || exp.question.length === 0)) {
      errors.push(`expectations[${i}].question must be a non-empty string`);
    }
  }

  return errors;
}

// ── Normalization ──────────────────────────────────────────────────────────────────────────────────────────

/** Per-ACTION scratch fields `reduce()` resets on its input before cloning — they are presentation plumbing
 *  with action-local lifetime, so they are stripped from the normalized states (they'd otherwise make the
 *  before-snapshot depend on WHEN it was taken relative to the dispatch). `log`/`beats` ride along per the
 *  playScan NOISE precedent. */
const VOLATILE_KEYS = new Set([
  'recruitBuffFx', 'aleGranted', 'auraFx', 'veinstormStamped', 'weldFxBaseSeq',
  'presentation', 'fx', 'beats', 'log',
]);

/** Normalize a run-state for comparison/inclusion: JSON round-trip (drops undefined + functions), strip the
 *  per-action volatile keys, stable-stringify. Deliberately does NOT strip rngCursor/uidCounter — they are
 *  deterministic, and hiding them would hide real divergence. */
export function normalizeRunState(s: RunState): string {
  const o = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  for (const k of VOLATILE_KEYS) delete o[k];
  return stableStringify(o);
}

/** WP C — the per-action state-hash rail: FNV-1a over the normalized run state. Both sides of the exact-
 *  reproduction comparison (the ring buffer's recorder and the replay verifier) MUST use this one function,
 *  so a hash mismatch always means the states diverged, never that two callers normalized differently. */
export const hashRunState = (s: RunState): string => fnv1a(normalizeRunState(s));

// ── The runner ─────────────────────────────────────────────────────────────────────────────────────────────

export interface QaExpectationResult {
  expectation: QaExpectation;
  pass: boolean;
  /** Human-readable evidence: what was expected, what was observed. */
  detail: string;
}

export interface QaScenarioResult {
  scenarioId: string;
  /** Valid AND every expectation passed. `needs-ruling` entries do not fail `ok` — they surface instead. */
  ok: boolean;
  validationErrors: string[];
  /** Normalized (stable, volatile-stripped) run-state before/after execution. Empty on validation failure. */
  before: string;
  after: string;
  /** Recruit-side presentation events emitted by the executed action (empty when none / combat-only). */
  events: GamePresentationEvent[];
  /** The full combat event log, when the scenario resolved a fight. */
  combatLog?: CombatEvent[];
  combatOutcome?: string;
  expectationResults: QaExpectationResult[];
  /** Open owner questions raised by `needs-ruling` expectations — uncertainty stays visible (§3.4). */
  needsRuling: string[];
  refs: { contentIds: string[]; ruleIds: string[] };
  /** Deterministic reproduction command (the CLI resolves bare ids in the checked-in scenarios directory). */
  repro: string;
  /** Compact human summary — what ran, what it observed, verdicts. */
  summary: string;
  /** §16 identity the run was evaluated under — the caller's stamp (runQaScenario opts) or, failing that,
   *  the scenario's own recorded revision. Absent when neither supplied one (legacy callers unchanged). */
  semanticRevision?: string;
  /** WP C — when the scenario carried an action TRAIL with recorded rails, the FIRST action whose observed
   *  rail (rng cursor before, or state hash before/after) differed from the recording. Absent when the trail
   *  replayed exactly (or carried no rails). A divergence fails `ok` — the recording no longer reproduces. */
  firstDivergence?: {
    actionIndex: number;
    actionType: string;
    rail: 'rng-cursor-before' | 'state-hash-before' | 'state-hash-after' | 'action-rejected';
    expected: string;
    observed: string;
  };
}

const failResult = (scenario: Partial<QaScenarioV1>, errors: string[]): QaScenarioResult => ({
  scenarioId: typeof scenario.id === 'string' ? scenario.id : '(invalid)',
  ok: false,
  validationErrors: errors,
  before: '',
  after: '',
  events: [],
  expectationResults: [],
  needsRuling: [],
  refs: { contentIds: scenario.contentIds ?? [], ruleIds: scenario.ruleIds ?? [] },
  repro: `npm run docbot:scenario -- ${typeof scenario.id === 'string' ? scenario.id : '<path>'}`,
  summary: `INVALID: ${errors.join(' · ')}`,
});

/** Resolve a dotted path (`board.0.attack`) against a plain-JSON object graph. */
function valueAtPath(root: unknown, path: string): unknown {
  let v: unknown = root;
  for (const seg of path.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[seg];
  }
  return v;
}

function selectCard(s: RunState, sel: QaCardSelector): { attack: number; health: number } | null {
  const zone = sel.zone ?? 'board';
  if (zone === 'shop') {
    // Shop offers carry BUFFS (atk/hp) on top of the def's printed base — reconstitute the effective stats
    // the buy path would bake, so a shop-buff expectation reads the number the player sees.
    const c = sel.uid ? s.shop.find((x) => x.uid === sel.uid) : s.shop.filter((x) => x.cardId === sel.cardId)[sel.index ?? 0];
    if (!c) return null;
    const def = CARD_INDEX[c.cardId];
    const mult = c.golden ? 2 : 1;
    return { attack: (def?.attack ?? 0) * mult + (c.atk ?? 0), health: (def?.health ?? 0) * mult + (c.hp ?? 0) };
  }
  const cards = zone === 'hand' ? s.hand : s.board;
  const c = sel.uid ? cards.find((x) => x.uid === sel.uid) : cards.filter((x) => x.cardId === sel.cardId)[sel.index ?? 0];
  return c ? { attack: c.attack ?? 0, health: c.health ?? 0 } : null;
}

/**
 * Execute a validated scenario through the real engine and evaluate its expectations (§4.4).
 *
 * Pure in the sense that matters: no wall clock, no ambient randomness, no reads of session-global stores —
 * the wave's opponent is PINNED before dispatch (the scenario's own opponent in combat mode; a procedural
 * `null` pin otherwise when the state carries none), so the module-global opponent pool that `nextOpponent`
 * would consult can never reach the result. Byte-equivalent output across runs is a tested contract.
 */
export function runQaScenario(
  scenario: QaScenarioV1,
  /** `semanticRevision`: the CURRENT §16 identity, stamped on the result. INJECTED rather than imported —
   *  computing it here would pull the rules registry through this module into the web bundle (store.ts
   *  loads scenarios; see semanticRevision.ts's bundle-hygiene note / current-state map D-2). */
  opts?: { semanticRevision?: string },
): QaScenarioResult {
  const validationErrors = validateQaScenario(scenario);
  if (validationErrors.length > 0) return failResult(scenario, validationErrors);

  // Hydrate through the ONE sanctioned door: deserialize heals the save against a fresh run of the same
  // seed/hero, exactly as Continue does. Then the missing-ids check the HUD relies on.
  const state = deserialize(scenario.state);
  const missing = missingCardIds(state);
  if (missing.length > 0) {
    return failResult(scenario, missing.map((id) => `hydrated state references unknown card id '${id}'`));
  }

  // HERMETIC OPPONENT PIN — before any dispatch, so neither reduce()'s boundary pin nor faceOmen's serve can
  // consult the session-global opponent pool. Key-presence semantics match the reducer's own (`null` = the
  // procedural threat).
  if (scenario.mode === 'combat') {
    state.servedBoards = { ...(state.servedBoards ?? {}), [state.wave]: scenario.combat!.opponent };
  } else if (!(state.wave in (state.servedBoards ?? {}))) {
    state.servedBoards = { ...(state.servedBoards ?? {}), [state.wave]: null };
  }

  const before = normalizeRunState(state);

  // Execute — the REAL paths only. Combat mode is the real end-of-turn hand-off; recruit/lobby dispatch the
  // scenario's action (or nothing: a pure state-assertion scenario is legal).
  const action: Action | undefined = scenario.mode === 'combat' ? { type: 'faceOmen' } : scenario.action;
  let after: RunState = state;
  let events: GamePresentationEvent[] = [];
  let firstDivergence: QaScenarioResult['firstDivergence'];
  if (scenario.actions?.length) {
    // WP C exact ACTION-TRAIL replay: every entry through the real reducer, each recorded rail verified as
    // we go. The trail keeps executing past a divergence (the final state is still evidence), but only the
    // FIRST divergent action is reported — that is the pinpoint the whole-history drift check couldn't give.
    for (const [i, w] of scenario.actions.entries()) {
      const diverge = (rail: NonNullable<QaScenarioResult['firstDivergence']>['rail'], expected: string, observed: string): void => {
        if (!firstDivergence) firstDivergence = { actionIndex: i, actionType: w.action.type, rail, expected, observed };
      };
      // The hermetic wave pin, per dispatched action (a trail may cross faceOmen into later waves) — same
      // key-presence semantics as the boundary pin above. Applied BEFORE the rail checks: the recorder
      // contract is pin-then-record, so recorded and observed hashes cover identical states.
      if (!(after.wave in (after.servedBoards ?? {}))) {
        after.servedBoards = { ...(after.servedBoards ?? {}), [after.wave]: null };
      }
      if (w.rngCursorBefore !== undefined && after.rngCursor !== w.rngCursorBefore) {
        diverge('rng-cursor-before', String(w.rngCursorBefore), String(after.rngCursor));
      }
      if (w.stateHashBefore !== undefined) {
        const h = hashRunState(after);
        if (h !== w.stateHashBefore) diverge('state-hash-before', w.stateHashBefore, h);
      }
      const { state: next, batch } = reduceWithPresentation(after, w.action, true);
      if (next === after) diverge('action-rejected', 'accepted (the recording logs only accepted actions)', 'rejected (reducer returned the same state)');
      if (batch) events = events.concat(batch.events);
      after = next;
      if (w.stateHashAfter !== undefined) {
        const h = hashRunState(after);
        if (h !== w.stateHashAfter) diverge('state-hash-after', w.stateHashAfter, h);
      }
    }
  } else if (action) {
    const { state: next, batch } = reduceWithPresentation(state, action, true);
    after = next;
    events = batch?.events ?? [];
  }

  const afterNorm = normalizeRunState(after);
  const combat = scenario.mode === 'combat' ? after.lastCombat : undefined;
  const afterJson = JSON.parse(JSON.stringify(after)) as Record<string, unknown>;
  // The pooled event stream expectations count over: recruit presentation events + the combat log.
  const pooledEvents: Array<Record<string, unknown>> = [
    ...(events as unknown as Array<Record<string, unknown>>),
    ...((combat?.events ?? []) as unknown as Array<Record<string, unknown>>),
  ];

  const beforeState = deserialize(scenario.state); // untouched copy for delta expectations

  const needsRuling: string[] = [];
  const expectationResults: QaExpectationResult[] = (scenario.expectations ?? []).map((exp): QaExpectationResult => {
    switch (exp.kind) {
      case 'state-delta': {
        const observed = valueAtPath(afterJson, exp.path);
        const pass = stableStringify(observed ?? null) === stableStringify(exp.equals);
        return { expectation: exp, pass, detail: `path '${exp.path}': expected ${stableStringify(exp.equals)}, observed ${stableStringify(observed ?? null)}` };
      }
      case 'event-count': {
        const where = exp.where ?? {};
        const n = pooledEvents.filter((e) => e.type === exp.event
          && Object.entries(where).every(([k, v]) => stableStringify(e[k] ?? null) === stableStringify(v))).length;
        return { expectation: exp, pass: n === exp.count, detail: `events of type '${exp.event}'${exp.where ? ` where ${stableStringify(exp.where)}` : ''}: expected ${exp.count}, observed ${n}` };
      }
      case 'card-delta': {
        const b = selectCard(beforeState, exp.selector);
        const a = selectCard(after, exp.selector);
        if (!b || !a) return { expectation: exp, pass: false, detail: `selector ${stableStringify(exp.selector)} matched no card ${!b ? 'before' : 'after'} execution` };
        const dA = a.attack - b.attack;
        const dH = a.health - b.health;
        const pass = dA === (exp.attack ?? 0) && dH === (exp.health ?? 0);
        return { expectation: exp, pass, detail: `'${exp.selector.cardId}' delta: expected +${exp.attack ?? 0}/+${exp.health ?? 0}, observed +${dA}/+${dH} (${b.attack}/${b.health} → ${a.attack}/${a.health})` };
      }
      case 'summon-count': {
        const n = pooledEvents.filter((e) => {
          if (e.type === 'summon') {
            const cid = (e.minion as { cardId?: unknown } | undefined)?.cardId;
            return exp.cardId === undefined || cid === exp.cardId;
          }
          if (e.type === 'cardSummoned') return exp.cardId === undefined || e.cardId === exp.cardId;
          return false;
        }).length;
        return { expectation: exp, pass: n === exp.count, detail: `summons${exp.cardId ? ` of '${exp.cardId}'` : ''}: expected ${exp.count}, observed ${n}` };
      }
      case 'no-op': {
        const pass = before === afterNorm;
        return { expectation: exp, pass, detail: pass ? 'state unchanged (normalized before === after)' : 'state CHANGED — normalized before/after differ' };
      }
      case 'needs-ruling': {
        needsRuling.push(exp.question);
        return { expectation: exp, pass: true, detail: `NEEDS RULING: ${exp.question}` };
      }
      case 'invariant': {
        const inv = QA_INVARIANTS[exp.id]!;
        const violation = inv.check(after);
        return { expectation: exp, pass: violation === null, detail: violation === null ? `invariant '${exp.id}' holds` : `invariant '${exp.id}' VIOLATED: ${violation}` };
      }
    }
  });

  const failed = expectationResults.filter((r) => !r.pass);
  const ok = failed.length === 0 && !firstDivergence;
  const repro = `npm run docbot:scenario -- ${scenario.id}`;
  const trailLabel = scenario.actions?.length
    ? ` · trail of ${scenario.actions.length} actions`
    : action ? ` · action ${action.type}` : ' · no action (state assertions only)';
  const summaryLines = [
    `${ok ? 'PASS' : 'FAIL'} · ${scenario.id} · ${scenario.title}`,
    `mode ${scenario.mode} · seed ${scenario.seed} · set ${scenario.setId}${trailLabel}`,
    ...(firstDivergence ? [`  ✗ DIVERGED at action #${firstDivergence.actionIndex} (${firstDivergence.actionType}) on rail ${firstDivergence.rail}: recorded ${firstDivergence.expected}, observed ${firstDivergence.observed}`] : []),
    ...(combat ? [`combat: ${combat.result} · ${combat.events.length} events · playerDamage ${combat.playerDamage}`] : []),
    `expectations: ${expectationResults.length - failed.length}/${expectationResults.length} passed`,
    ...failed.map((r) => `  ✗ ${r.detail}`),
    ...needsRuling.map((q) => `  ? needs ruling: ${q}`),
  ];

  return {
    scenarioId: scenario.id,
    ok,
    validationErrors: [],
    before,
    after: afterNorm,
    events,
    ...(combat ? { combatLog: combat.events, combatOutcome: combat.result } : {}),
    expectationResults,
    needsRuling,
    refs: { contentIds: scenario.contentIds ?? [], ruleIds: scenario.ruleIds ?? [] },
    repro,
    summary: summaryLines.join('\n'),
    ...(opts?.semanticRevision ?? scenario.semanticRevision
      ? { semanticRevision: opts?.semanticRevision ?? scenario.semanticRevision }
      : {}),
    ...(firstDivergence ? { firstDivergence } : {}),
  };
}

/** Parse + validate a scenario file's text. Returns the scenario or the (loud) validation errors. */
export function parseQaScenario(text: string): { scenario?: QaScenarioV1; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  const errors = validateQaScenario(raw);
  return errors.length > 0 ? { errors } : { scenario: raw as QaScenarioV1, errors: [] };
}

/** Re-serialize a hydrated run-state for embedding in a scenario (the Scene Builder export path, PR 2). */
export const serializeForScenario = (s: RunState): SerializedRunState => serialize(s);
