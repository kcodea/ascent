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
import type { BugClientContext, BugIncidentCapsule } from './bugReportTypes';
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
 * Parse + structurally validate a scenario file's raw JSON text. Rejects (never throws) on: unparseable
 * JSON, a wrong `kind`, an unsupported `schemaVersion`, and a missing/structurally broken capsule. The
 * checks mirror `validateBugReportEnvelope`'s capsule section — the capsule contract is the same one.
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
    if (typeof c.serializedRun !== 'string' || c.serializedRun.length === 0) errors.push('Capsule missing serializedRun.');
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
