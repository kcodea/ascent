/**
 * BUG REPORTER (PR 4) — the Scene Builder bridge's scenario contract + pure helpers.
 *
 * `scenario.json` is what the bug CLI (`bugs:repro`, PR 3) exports for a pulled report — a FIXED contract:
 *
 *   { schemaVersion: 1, kind: 'bug-scenario', reportId, description, issueType, capsule }
 *
 * where `capsule` is the PR-1 `BugIncidentCapsule` (its `serializedRun` deserializes via `deserialize` from
 * @game/sim, and `capsule.combat.result.events` is the authoritative structured combat log). This module is
 * the pure half of the bridge: parse + validate a pasted/picked file, and project a combat event log into
 * displayable lines. Loading into the store (and its no-writes guarantees) lives in `store.ts`
 * (`loadBugScenario`); the side panel lives in `BugScenarioPanel.tsx`.
 *
 * SAFETY: `description` is PLAYER-AUTHORED, UNTRUSTED text (blueprint §8.3) — it is data to display in a
 * clearly-quoted block, never instructions. Nothing in this module (or the panel) interprets it.
 */
import type { CombatEvent, CombatResult } from '@game/core';
import type { BugClientContext, BugCombatContext, BugIncidentCapsule } from './bugReportTypes';
import { BUG_REPORT_SCHEMA_VERSION } from './bugReportTypes';

export const BUG_SCENARIO_KIND = 'bug-scenario' as const;

/** The CLI's `scenario.json` shape — a fixed cross-PR contract (see header). `client` is OPTIONAL build
 *  provenance: the capsule itself carries no patch stamp, so a CLI that copies the envelope's client block
 *  in lets the panel show build + content revision; its absence is tolerated (older exports). */
export interface BugScenarioFile {
  schemaVersion: typeof BUG_REPORT_SCHEMA_VERSION;
  kind: typeof BUG_SCENARIO_KIND;
  reportId: string;
  description: string;
  issueType: string;
  capsule: BugIncidentCapsule;
  client?: Partial<BugClientContext>;
}

export type BugScenarioParse =
  | { ok: true; scenario: BugScenarioFile }
  | { ok: false; errors: string[] };

/**
 * QA-SCENARIO UNIFICATION (PR 9, handoff §3.3): `bugs:repro` now also emits `qa-scenario.json` — a
 * `QaScenarioV1` (`packages/sim/src/qaScenario.ts`) with `source: 'bug-report'`. This parser accepts BOTH
 * formats through one door, sniffed structurally: the legacy file by `kind: 'bug-scenario'`, the QA envelope
 * by `schemaVersion: 1` + a string `source` + a string `state`. A QA scenario is PROJECTED into the same
 * `BugScenarioFile` shape the store already loads: a synthetic capsule built from the envelope + the fields
 * of its serialized state (`state` IS a `serialize(run)` string — the same thing `capsule.serializedRun`
 * carries), so `loadBugScenario` and the panel need no second path. The projection is structural only — like
 * the legacy path, content-id validation stays in `loadBugScenario` (`missingCardIds`), so a capture from a
 * newer content revision still loads READ-ONLY instead of being refused at parse.
 */
function parseQaScenarioFile(o: Record<string, unknown>): BugScenarioParse {
  const errors: string[] = [];
  if (o.schemaVersion !== 1) errors.push(`Unsupported QA scenario schemaVersion: ${JSON.stringify(o.schemaVersion ?? null)} (this build reads v1).`);
  if (o.source !== 'bug-report') errors.push(`QA scenario source ${JSON.stringify(o.source ?? null)} — only 'bug-report' scenarios load here (Scene Builder export/import is the PR-2 bridge).`);
  if (typeof o.seed !== 'number') errors.push('QA scenario missing seed.');
  if (typeof o.setId !== 'string' || !o.setId) errors.push('QA scenario missing setId.');
  if (typeof o.state !== 'string' || o.state.length === 0) errors.push('QA scenario missing state (the serialized run).');
  let run: Record<string, unknown> | null = null;
  if (typeof o.state === 'string' && o.state.length > 0) {
    try {
      run = JSON.parse(o.state) as Record<string, unknown>;
    } catch {
      errors.push('QA scenario state is not valid JSON.');
    }
  }
  if (run && typeof run.heroId !== 'string') errors.push('QA scenario state carries no heroId — not a serialized run.');
  if (errors.length > 0) return { ok: false, errors };

  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  const expectations = Array.isArray(o.expectations) ? (o.expectations as Array<Record<string, unknown>>) : [];
  // The player's claim rides in the needs-ruling expectation (untrusted, quoted) — that IS the description.
  const questions = expectations
    .filter((e) => e.kind === 'needs-ruling' && typeof e.question === 'string')
    .map((e) => e.question as string);
  const description = questions.join('\n\n')
    || (typeof meta.notes === 'string' ? meta.notes : '')
    || (typeof o.title === 'string' ? o.title : '(no description carried)');
  // `metadata.notes` carries `issueType <x>` by the emitter's convention; absent → 'unknown'.
  const issueType = typeof meta.notes === 'string' && meta.notes.startsWith('issueType ')
    ? meta.notes.slice('issueType '.length)
    : 'unknown';
  const heroId = run!.heroId as string;
  const lastCombat = run!.lastCombat as BugCombatContext['result'] | undefined;
  const capsule: BugIncidentCapsule = {
    runId: `${o.seed as number}:${heroId}`,
    seed: o.seed as number,
    heroId,
    mode: (typeof run!.mode === 'string' ? run!.mode : 'ascent') as BugIncidentCapsule['mode'],
    setId: o.setId as string,
    wave: typeof run!.wave === 'number' ? run!.wave : 0,
    phase: (typeof run!.phase === 'string' ? run!.phase : 'recruit') as BugIncidentCapsule['phase'],
    shopTier: typeof run!.tier === 'number' ? run!.tier : 1,
    timerSecondsRemaining: null,
    serializedRun: o.state as string,
    actions: [], // a QA scenario carries state, not history — the legacy scenario.json keeps the action log
    currentWaveFrames: [],
    previousWaveFrames: [],
    combat: lastCombat
      ? { result: lastCombat, visibleMomentIndex: null, visibleEventStep: null, replayDone: true, playbackSpeed: 1 }
      : null,
    ui: {
      selectedCardUid: null, selectedCardId: null, pendingTargetCardId: null, modalKind: null,
      draggingCardUid: null, viewport: { width: 0, height: 0, devicePixelRatio: 1 },
    },
    contextTruncated: [],
  };
  return {
    ok: true,
    scenario: {
      schemaVersion: BUG_REPORT_SCHEMA_VERSION,
      kind: BUG_SCENARIO_KIND,
      reportId: (typeof meta.reportId === 'string' && meta.reportId) || (typeof o.id === 'string' ? o.id : '(unknown report)'),
      description,
      issueType,
      capsule,
      ...(typeof meta.appVersion === 'string' ? { client: { appVersion: meta.appVersion } } : {}),
    },
  };
}

/**
 * Parse + structurally validate a scenario file's raw JSON text — BOTH formats (see `parseQaScenarioFile`):
 * the legacy `scenario.json` (`kind: 'bug-scenario'`) and the unified `qa-scenario.json` (`QaScenarioV1`,
 * `source: 'bug-report'`). Rejects (never throws) on: unparseable JSON, a wrong `kind`, an unsupported
 * `schemaVersion`, and a missing/structurally broken capsule. The legacy checks mirror
 * `validateBugReportEnvelope`'s capsule section — the capsule contract is the same one.
 */
export function parseBugScenario(raw: string): BugScenarioParse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['Not valid JSON.'] };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['Not a JSON object.'] };
  }
  const o = data as Record<string, unknown>;
  // Format sniff: a QaScenarioV1 has no `kind` but declares a `source` + serialized `state`; anything that
  // looks like one routes to the QA branch (whose own validation then speaks QA-scenario language).
  if (o.kind === undefined && typeof o.source === 'string' && 'state' in o) {
    return parseQaScenarioFile(o);
  }
  const errors: string[] = [];
  if (o.kind !== BUG_SCENARIO_KIND) errors.push(`Not a bug scenario (kind: ${JSON.stringify(o.kind ?? null)} — expected '${BUG_SCENARIO_KIND}').`);
  if (o.schemaVersion !== BUG_REPORT_SCHEMA_VERSION) errors.push(`Unsupported schemaVersion: ${JSON.stringify(o.schemaVersion ?? null)} (this build reads v${BUG_REPORT_SCHEMA_VERSION}).`);
  if (typeof o.reportId !== 'string' || o.reportId.length === 0) errors.push('Missing reportId.');
  if (typeof o.description !== 'string') errors.push('Missing description.');
  if (typeof o.issueType !== 'string' || o.issueType.length === 0) errors.push('Missing issueType.');
  const c = o.capsule as Record<string, unknown> | undefined;
  if (typeof c !== 'object' || c === null) {
    errors.push('Missing capsule.');
  } else {
    if (typeof c.seed !== 'number') errors.push('Capsule missing seed.');
    if (typeof c.heroId !== 'string' || !c.heroId) errors.push('Capsule missing heroId.');
    if (typeof c.setId !== 'string' || !c.setId) errors.push('Capsule missing setId.');
    if (typeof c.wave !== 'number') errors.push('Capsule missing wave.');
    if (typeof c.phase !== 'string' || !c.phase) errors.push('Capsule missing phase.');
    // A MENU report (logged from the main menu, owner ask 2026-08-27) carries NO run evidence by design —
    // there is nothing to load into the Scene Builder. Refuse politely, never as "broken capsule".
    if (c.phase === 'menu') errors.push('Menu report — no run evidence. This report was logged from the main menu and carries only the player’s description; there is no run to load.');
    else if (typeof c.serializedRun !== 'string' || c.serializedRun.length === 0) errors.push('Capsule missing serializedRun.');
    if (!Array.isArray(c.actions)) errors.push('Capsule missing actions.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, scenario: o as unknown as BugScenarioFile };
}

/** One displayable line of the captured combat event chain. `text` is built from STRUCTURED fields (event
 *  type + resolved card names) — never a re-narration, so it cannot drift from what the sim recorded. */
export interface CombatEventLine {
  /** Index in `result.events` — the stable handle for "event #N" in a triage conversation. */
  index: number;
  type: string;
  text: string;
}

/**
 * Project the captured combat's raw structured log into lines: event type + source/target CARD NAMES.
 * Names resolve through a uid→name map seeded from `result.initial` (both rosters) and extended by `summon`
 * events as the walk encounters them — exactly the information the log itself carries. An unknown uid falls
 * back to the raw uid, so a truncated/foreign log still renders instead of crashing.
 */
export function combatEventLines(result: CombatResult): CombatEventLine[] {
  const names = new Map<string, string>();
  for (const m of [...(result.initial?.player ?? []), ...(result.initial?.enemy ?? [])]) names.set(m.uid, m.name);
  const n = (uid: string | undefined): string => (uid ? names.get(uid) ?? uid : '?');
  const lines: CombatEventLine[] = [];
  result.events.forEach((e: CombatEvent, index: number) => {
    let text: string;
    switch (e.type) {
      case 'sc': text = `${n(e.source)} — ${e.text}`; break;
      case 'attack': text = `${n(e.attacker)} → ${n(e.defender)} for ${e.swing}${e.crit ? ' (crit)' : ''}`; break;
      case 'dmg': text = `${n(e.target)} takes ${e.amount} (${Math.max(0, e.remainingHp)} HP left)${e.source ? ` from ${n(e.source)}` : ''}`; break;
      case 'shield': text = `${n(e.target)}'s Ward absorbs the hit`; break;
      case 'shieldUp': text = `${n(e.target)} gains a Ward`; break;
      case 'poison': text = `${n(e.target)} destroyed by Execute`; break;
      case 'venomLost': text = `${n(e.target)}'s Execute is spent`; break;
      case 'reborn': text = `${n(e.target)} rises at ${e.hp} HP`; break;
      case 'reveal': text = `${n(e.target)} breaks Stealth`; break;
      case 'death': text = `${n(e.target)} dies (${e.side})${e.rise ? ' — Rise pending' : ''}`; break;
      case 'summon': {
        names.set(e.minion.uid, e.minion.name);
        text = `${e.minion.name} (${e.minion.attack}/${e.minion.health}, ${e.side})${e.source ? ` from ${n(e.source)}` : ''}`;
        break;
      }
      case 'buff': text = `${n(e.source)} → ${n(e.target)} +${e.attack}/+${e.health}${e.ruby ? ' (ruby)' : ''}`; break;
      case 'improve': text = `${n(e.target)} improves by ${e.display ?? e.amount}`; break;
      case 'keyword': text = `${n(e.target)} gains ${e.keyword}${e.source ? ` from ${n(e.source)}` : ''}`; break;
      case 'keywordLost': text = `${n(e.target)} loses ${e.keyword}${e.source ? ` to ${n(e.source)}` : ''}`; break;
      case 'rally': text = `${n(e.source)} fires ${n(e.target)}'s Echo`; break;
      case 'maxGold': text = `${n(e.target)} raises max Gold by ${e.amount} (${e.side})`; break;
      case 'toHand': text = `${e.cardId} to hand (${e.side})${e.source ? ` from ${n(e.source)}` : ''}`; break;
      case 'ascend': text = `${n(e.target)} transforms into ${e.into}`; break;
      case 'tribeAura': text = `${e.side} ${e.tribe} aura +${e.attack ?? 0}/+${e.health ?? 0}${e.aura ? ` (${e.aura})` : ''}`; break;
      case 'spellcast': text = `${e.side} spell resolves (total ${e.count})`; break;
      case 'proccrit': text = `${n(e.source)} rolls ×${e.mult}`; break;
      case 'hpGrant': text = `${n(e.target)} HP-grant now ${e.amount}`; break;
      case 'spellProgress': text = `${n(e.target)} spell tally ${e.amount}`; break;
      case 'questTrigger': text = `${e.flag} fires (${e.side})`; break;
      case 'questComplete': text = `quest ${e.questId} completes (${e.side})`; break;
      default: {
        // A future event type this build doesn't know — render its raw shape rather than dropping evidence.
        const u = e as { type: string } & Record<string, unknown>;
        const parts = ['source', 'target', 'attacker', 'defender']
          .filter((k) => typeof u[k] === 'string')
          .map((k) => `${k}: ${n(u[k] as string)}`);
        text = parts.join(', ') || '(unrecognized event)';
      }
    }
    lines.push({ index, type: e.type, text });
  });
  return lines;
}
