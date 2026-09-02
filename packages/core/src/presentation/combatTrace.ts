/**
 * DOC BOT 2.0 WP C — the COMBAT SEMANTIC TRACE ADAPTER (blueprint §7, canonical-schemas.md §4).
 *
 * Combat joins the unified semantic envelope through this PURE, POST-HOC adapter over the structured
 * `CombatEvent` log — the same zero-engine-change technique `coverageKeysFor` proved. The 26-type union in
 * `types.ts` (the shared boundary) is untouched; `simulate()` is untouched; nothing here runs during
 * resolution. Determinism is structural: the trace is a pure function of the event array, and event ids are
 * derived from the array index (`combat:<actionId>:<seq>`, mirroring the recruit collector's
 * `event:<actionId>:<seq>` convention) — same log in, byte-identical trace out.
 *
 * HONESTY RULES (§4.3 no-silent-uncertainty, §7.4):
 *   · Absent causality is ABSENT — an event whose emitter stamped no source/key gets no source/cause,
 *     never a guessed one. `COMBAT_TRACE_COVERAGE` states, per event family, exactly which envelope fields
 *     this adapter can and cannot derive, and why.
 *   · `cause.stepRootEventId` is STEP GROUPING (the first event of the same resolution step), not proven
 *     causal parenthood — true combat trigger-stack parenting needs the simulate() chokepoint
 *     instrumentation (WP C wave 2+ per the plan) and is deliberately not faked here.
 *   · The user-facing narration string on `sc` events (`text`) is NEVER copied into the trace — the trace
 *     derives from structured fields only (§7.4 constraint 5).
 */
import type { CombatEvent, CombatResult, Side } from '../types';

/** A participant reference. `uid` when the log carries an instance uid; `label` when the emitter only
 *  stamped a display name (e.g. a `buff` event's source — 'Rune of Overflow'); `cardId` where the log
 *  carries content identity (summons, toHand, ascend targets). Never both fabricated from each other. */
export interface CombatTraceRef {
  uid?: string;
  cardId?: string;
  label?: string;
  side?: Side;
}

export interface CombatSemanticEvent {
  /** `combat:<actionId>:<seq>` — deterministic under a seeded run (batch-local index, no time/uuid). */
  eventId: string;
  eventType: CombatEvent['type'];
  phase: 'combat';
  /** The event's index in the log — the deterministic id component. */
  seq: number;
  /** The simulator's atomic-resolution-step stamp, when present (real sim output always carries it). */
  step?: number;
  /** The AoE pass ("wave") stamp, when the emitting effect wrapped a pass (`ctx.wave`). */
  wavePass?: number;
  source?: CombatTraceRef;
  target?: CombatTraceRef;
  /** Inferable causality only — see the header honesty rules. */
  cause?: {
    /** The registry key of the minion effect that emitted this (`factory:<do>:<on>`), when stamped. */
    key?: string;
    /** The card that ran that effect, when stamped. */
    srcCard?: string;
    /** Emitted inside an Avenge handler. */
    avenge?: true;
    /** The eventId of the FIRST event sharing this event's `step` — grouping evidence, NOT proven parenting. */
    stepRootEventId?: string;
  };
  /** Single-axis magnitude where the family has one (dmg amount, attack swing, improve tick, …). */
  amount?: number;
  /** Post-event values the log itself carries (never recomputed): dmg's remainingHp. */
  after?: { remainingHp?: number };
  /** Family-specific structured fields, copied verbatim from the log (no narration strings). */
  detail?: Record<string, string | number | boolean>;
}

/** How completely the adapter can populate the envelope for one event family. Values are honest claims the
 *  determinism test checks against real output: 'always' = every event of the family carries it; 'sometimes'
 *  = present only when the emitter stamped it; 'never' = the log has no substrate (the note says what's
 *  missing and where it would come from). */
export interface CombatTraceCoverage {
  source: 'always' | 'sometimes' | 'never';
  target: 'always' | 'sometimes' | 'never';
  amount: 'always' | 'sometimes' | 'never';
  note: string;
}

/** Per-family field coverage — `Record` keyed on the union's discriminant, so ADDING a CombatEvent type
 *  without declaring its trace coverage is a TYPE error, not a silently-uncovered family. */
export const COMBAT_TRACE_COVERAGE: Record<CombatEvent['type'], CombatTraceCoverage> = {
  sc: { source: 'always', target: 'never', amount: 'never', note: 'source uid always; the narration string is deliberately dropped (§7.4) — magnitudes inside it are NOT derivable; a structured amount needs emit-site fields (future instrumentation)' },
  attack: { source: 'always', target: 'always', amount: 'always', note: 'attacker/defender uids + swing; crit in detail' },
  dmg: { source: 'sometimes', target: 'always', amount: 'always', note: 'source uid only when the emitter stamped one (truly sourceless damage omits it); after.remainingHp from the log' },
  proccrit: { source: 'always', target: 'never', amount: 'always', note: 'amount = the multiplier; the repeated effect itself is in the following buff events (step grouping links them)' },
  spellcast: { source: 'never', target: 'never', amount: 'always', note: 'a side-scoped counter tick — no per-minion source in the log; amount = running total, side in detail' },
  shield: { source: 'never', target: 'always', amount: 'never', note: 'shield break carries no breaker uid — the attacker is inferable only via step grouping' },
  shieldUp: { source: 'sometimes', target: 'always', amount: 'never', note: 'granter only via key/srcCard stamps when present' },
  poison: { source: 'never', target: 'always', amount: 'never', note: 'poisoner not in the event — the dmg event beside it carries the source uid' },
  reborn: { source: 'never', target: 'always', amount: 'never', note: 'a Rise return; hp/attack in detail; re-slot anchor (after) in detail when stamped' },
  death: { source: 'never', target: 'always', amount: 'never', note: 'killer not in the event — the killing dmg event carries it; side + rise flag in detail' },
  reveal: { source: 'never', target: 'always', amount: 'never', note: 'stealth loss on the target itself' },
  tribeAura: { source: 'sometimes', target: 'never', amount: 'sometimes', note: 'a side-wide aura wash — no single target by design; attack/health in detail; source only via key/srcCard stamps' },
  keyword: { source: 'sometimes', target: 'always', amount: 'never', note: 'granter uid when stamped; keyword in detail' },
  keywordLost: { source: 'sometimes', target: 'always', amount: 'never', note: 'stripper uid when stamped; keyword in detail' },
  venomLost: { source: 'never', target: 'always', amount: 'never', note: 'venom spent by the target itself' },
  summon: { source: 'sometimes', target: 'always', amount: 'never', note: 'summoner uid when stamped; target = the summoned minion (uid + cardId); board index in detail' },
  ascend: { source: 'never', target: 'always', amount: 'never', note: 'self-transform; the destination cardId in detail (into)' },
  buff: { source: 'always', target: 'always', amount: 'never', note: 'source is a display LABEL, not a uid (the emit sites pass names) — carried as label, never coerced to a uid; attack/health in detail (two-axis, no single amount)' },
  improve: { source: 'never', target: 'always', amount: 'always', note: 'accrual delta; display magnitude in detail when it differs' },
  rally: { source: 'always', target: 'always', amount: 'never', note: 'the rallier and the minion whose effect it fires' },
  shout: { source: 'always', target: 'always', amount: 'never', note: 'a combat Shout re-fire: the re-triggering unit and the owner of the Shout; one event per fire (Drakko x gild)' },
  maxGold: { source: 'never', target: 'always', amount: 'always', note: 'the Avenge payoff target + amount; the granter only via key/srcCard stamps' },
  toHand: { source: 'sometimes', target: 'always', amount: 'never', note: 'target = the granted card (cardId, no uid — hand cards get uids at settle); granter uid when stamped' },
  hpGrant: { source: 'never', target: 'always', amount: 'always', note: 'live text tick on the target itself' },
  spellProgress: { source: 'never', target: 'always', amount: 'always', note: 'live tally tick on the target itself' },
  questTrigger: { source: 'never', target: 'never', amount: 'never', note: 'a badge-pulse marker — flag + side in detail; the quest/rune id resolves via content, post-hoc' },
  questComplete: { source: 'never', target: 'never', amount: 'never', note: 'questId + side in detail' },
};

const defined = <T extends Record<string, unknown>>(o: T): T => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

/** Build a `detail` record from possibly-absent structured fields; absent stays absent (stripped). */
const det = (o: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> =>
  defined(o) as Record<string, string | number | boolean>;

/** The family-specific projection: structured fields only, never the narration string. */
function project(e: CombatEvent): Pick<CombatSemanticEvent, 'source' | 'target' | 'amount' | 'after' | 'detail'> {
  switch (e.type) {
    case 'sc':
      return defined({ source: { uid: e.source }, detail: det({ cast: e.cast, side: e.side, grantsEcho: e.grantsEcho }) });
    case 'attack':
      return defined({ source: { uid: e.attacker }, target: { uid: e.defender }, amount: e.swing, detail: det({ crit: e.crit }) });
    case 'dmg':
      return defined({ ...(e.source ? { source: { uid: e.source } } : {}), target: { uid: e.target }, amount: e.amount, after: { remainingHp: e.remainingHp } });
    case 'proccrit':
      return { source: { uid: e.source }, amount: e.mult };
    case 'spellcast':
      return { amount: e.count, detail: { side: e.side } };
    case 'shield':
    case 'shieldUp':
    case 'poison':
    case 'reveal':
    case 'venomLost':
      return { target: { uid: e.target } };
    case 'reborn':
      return defined({ target: { uid: e.target }, detail: det({ hp: e.hp, attack: e.attack, after: e.after }) });
    case 'death':
      return defined({ target: { uid: e.target, side: e.side }, detail: det({ side: e.side, rise: e.rise }) });
    case 'tribeAura':
      return defined({ detail: det({ side: e.side, tribe: e.tribe, attack: e.attack, health: e.health, aura: e.aura }) });
    case 'keyword':
    case 'keywordLost':
      return defined({ ...(e.source ? { source: { uid: e.source } } : {}), target: { uid: e.target }, detail: { keyword: e.keyword } });
    case 'summon':
      return defined({ ...(e.source ? { source: { uid: e.source } } : {}), target: { uid: e.minion.uid, cardId: e.minion.cardId, side: e.side }, detail: { index: e.index } });
    case 'ascend':
      return { target: { uid: e.target }, detail: { into: e.into } };
    case 'buff':
      return defined({ source: { label: e.source }, target: { uid: e.target }, detail: det({ attack: e.attack, health: e.health, ruby: e.ruby }) });
    case 'improve':
      return defined({ target: { uid: e.target }, amount: e.amount, detail: det({ display: e.display }) });
    case 'rally':
      return { source: { uid: e.source }, target: { uid: e.target } };
    case 'shout':
      return { source: { uid: e.source }, target: { uid: e.target } };
    case 'maxGold':
      return { target: { uid: e.target, side: e.side }, amount: e.amount, detail: { side: e.side } };
    case 'toHand':
      return defined({ ...(e.source ? { source: { uid: e.source } } : {}), target: { cardId: e.cardId, side: e.side }, detail: { side: e.side } });
    case 'hpGrant':
    case 'spellProgress':
      return { target: { uid: e.target }, amount: e.amount };
    case 'questTrigger':
      return { detail: { flag: e.flag, side: e.side } };
    case 'questComplete':
      return { detail: { questId: e.questId, side: e.side } };
  }
}

/**
 * Translate a combat log into the semantic envelope. Pure and deterministic: same `events` array (and
 * `actionId`) in, byte-identical trace out — the standing determinism test stableStringifies two runs.
 *
 * `actionId` defaults to `'faceOmen'` (the action whose resolution produced every real combat); pass the
 * scenario/report action id to keep ids namespaced when several fights ride one report.
 */
export function combatSemanticTrace(
  events: readonly CombatEvent[],
  opts?: { actionId?: string },
): CombatSemanticEvent[] {
  const actionId = opts?.actionId ?? 'faceOmen';
  const stepRoot = new Map<number, string>();
  return events.map((e, seq) => {
    const eventId = `combat:${actionId}:${seq}`;
    let stepRootEventId: string | undefined;
    if (e.step !== undefined) {
      const root = stepRoot.get(e.step);
      if (root === undefined) stepRoot.set(e.step, eventId);
      else stepRootEventId = root;
    }
    const cause = defined({ key: e.key, srcCard: e.srcCard, avenge: e.avenge, stepRootEventId });
    return defined({
      eventId,
      eventType: e.type,
      phase: 'combat' as const,
      seq,
      step: e.step,
      wavePass: e.wave,
      ...project(e),
      ...(Object.keys(cause).length ? { cause } : {}),
    });
  });
}

/** Convenience over a full result — the shape scenario runners and the report panel hold. */
export const combatResultSemanticTrace = (
  result: Pick<CombatResult, 'events'>,
  opts?: { actionId?: string },
): CombatSemanticEvent[] => combatSemanticTrace(result.events, opts);
