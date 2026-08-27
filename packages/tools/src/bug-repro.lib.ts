/**
 * BUG REPRO — the logic behind `npm run bugs:repro -- <report-id>` (blueprint §8.4, steps 1–9).
 *
 * The captured serialized `RunState` is the PRIMARY reproduction (deserialize it and look). The seed+actions
 * reconstruction through the real `reduce` is a SECONDARY consistency diagnostic — its job is to find where
 * corruption began, so drift is REPORTED (first mismatching action index / differing state keys), never
 * hidden and never "fixed up". Pure functions over an envelope; the CLI wrapper does the file I/O.
 */
import { CARD_INDEX, RUNE_INDEX, type SetId } from '@game/content';
import type { CombatEvent } from '@game/core';
import {
  CONFIG,
  HEROES,
  createRun,
  deserialize,
  reduce,
  serialize,
  type BugIncidentCapsule,
  type BugReportEnvelope,
  type RunState,
} from '@game/sim';

// ── Step 3: content-id validation (report mismatches, never crash) ─────────────────────────────────────────

export interface ContentValidation {
  unknownCardIds: string[];
  unknownRuneIds: string[];
  unknownHeroId: string | null;
  /** True when anything above is populated — the capture predates/postdates this checkout's content. */
  contentRevisionMismatch: boolean;
}

export function validateContentIds(run: RunState, capsule: BugIncidentCapsule): ContentValidation {
  const cardIds = new Set<string>();
  for (const c of [...run.board, ...run.hand]) cardIds.add(c.cardId);
  for (const o of run.shop) cardIds.add(o.cardId);
  for (const side of [capsule.combat?.result.initial.player, capsule.combat?.result.initial.enemy]) {
    for (const m of side ?? []) cardIds.add(m.cardId);
  }
  const unknownCardIds = [...cardIds].filter((id) => !CARD_INDEX[id]).sort();
  const unknownRuneIds = (run.ownedRunes ?? []).filter((id) => !RUNE_INDEX[id]).sort();
  const unknownHeroId = HEROES.some((h) => h.id === run.heroId) ? null : run.heroId;
  return {
    unknownCardIds,
    unknownRuneIds,
    unknownHeroId,
    contentRevisionMismatch: unknownCardIds.length > 0 || unknownRuneIds.length > 0 || unknownHeroId !== null,
  };
}

// ── Step 4: human summary of the captured state ────────────────────────────────────────────────────────────

const cardLine = (c: { cardId: string; attack: number; health: number; golden?: boolean }): string =>
  `${CARD_INDEX[c.cardId]?.name ?? c.cardId}${c.golden ? ' (golden)' : ''} ${c.attack}/${c.health}`;

export function summarizeRun(run: RunState, capsule: BugIncidentCapsule): string[] {
  const lines: string[] = [];
  lines.push(
    `run: seed ${run.seed} · hero ${run.heroId} · mode ${run.mode ?? 'ascent'} · set ${capsule.setId} · ` +
      `wave ${run.wave} · phase ${run.phase} · tier ${run.tier} · gold ${run.embers}/${run.maxEmbers} · resolve ${run.resolve}`,
  );
  lines.push(`board (${run.board.length}): ${run.board.map(cardLine).join(' | ') || '(empty)'}`);
  lines.push(`hand  (${run.hand.length}): ${run.hand.map(cardLine).join(' | ') || '(empty)'}`);
  lines.push(
    `shop  (${run.shop.length}): ${run.shop.map((o) => CARD_INDEX[o.cardId]?.name ?? o.cardId).join(' | ') || '(empty)'}`,
  );
  lines.push(`runes: ${(run.ownedRunes ?? []).join(', ') || '(none)'}`);
  const enemy = capsule.combat?.result.initial.enemy;
  lines.push(
    enemy
      ? `opponent (last combat, ${capsule.combat!.result.result}): ${enemy.map(cardLine).join(' | ') || '(empty)'}`
      : 'opponent: no combat captured yet',
  );
  return lines;
}

// ── Step 5: the captured combat event chains ───────────────────────────────────────────────────────────────

const eventLine = (e: CombatEvent): string => {
  const bits: string[] = [e.type];
  const r = e as Record<string, unknown>;
  for (const k of ['source', 'attacker', 'defender', 'target', 'swing', 'amount', 'remainingHp', 'minion', 'side', 'cardId', 'keyword', 'attack', 'health', 'text']) {
    const v = r[k];
    if (v === undefined) continue;
    bits.push(`${k}=${typeof v === 'object' && v !== null ? ((v as { cardId?: string }).cardId ?? JSON.stringify(v)) : String(v)}`);
  }
  if (r.step !== undefined) bits.push(`step=${String(r.step)}`);
  return bits.join(' ');
};

/** Renders the raw structured log as readable chains: a blank line starts a new chain at each attack /
 *  Start-of-Combat cast, so a cascade (deaths, Echoes, reactor buffs) reads as one indented group. */
export function combatEventLines(events: CombatEvent[]): string[] {
  const lines: string[] = [];
  events.forEach((e, i) => {
    const isChainHead = e.type === 'attack' || (e.type === 'sc' && (e as { cast?: true }).cast);
    if (isChainHead && lines.length > 0) lines.push('');
    lines.push(`${isChainHead ? '' : '  '}#${i} ${eventLine(e)}`);
  });
  return lines;
}

// ── Steps 6–7: seed+actions reconstruction through the real reducer — drift is reported, never hidden ──────

export interface ReproDrift {
  kind: 'action_rejected' | 'action_error' | 'final_state_mismatch';
  /** First mismatching action index (for the per-action kinds). */
  actionIndex?: number;
  actionType?: string;
  error?: string;
  /** Top-level RunState keys whose values differ (for final_state_mismatch). */
  mismatchedKeys?: string[];
  note?: string;
}

export interface ReconstructionResult {
  ok: boolean;
  drift: ReproDrift | null;
  actionsReplayed: number;
}

export function reconstructFromSeed(capsule: BugIncidentCapsule): ReconstructionResult {
  // MENU reports (owner ask 2026-08-27) carry no run evidence at all — nothing to reconstruct.
  if (capsule.phase === 'menu' || capsule.mode === 'menu' || capsule.serializedRun === null) {
    return {
      ok: false,
      actionsReplayed: 0,
      drift: { kind: 'action_error', error: 'menu report — no run evidence', note: 'logged from the main menu; the description is the whole payload' },
    };
  }
  let s = createRun(capsule.seed, capsule.heroId, capsule.mode, CONFIG.defaultLine, capsule.setId as SetId);
  const note =
    capsule.mode === 'lobby'
      ? 'lobby runs attach seats via createLobbyRun — bare createRun reconstruction is best-effort'
      : undefined;
  for (let i = 0; i < capsule.actions.length; i++) {
    const action = capsule.actions[i]!;
    let next: RunState;
    try {
      next = reduce(s, action);
    } catch (err) {
      return {
        ok: false,
        actionsReplayed: i,
        drift: { kind: 'action_error', actionIndex: i, actionType: action.type, error: String(err), note },
      };
    }
    if (next === s) {
      // The capture logs only ACCEPTED (state-changing) actions, so a rejected replay = the paths diverged
      // at or before this action. This is the "first mismatching action index" (blueprint §8.4 step 7).
      return {
        ok: false,
        actionsReplayed: i,
        drift: { kind: 'action_rejected', actionIndex: i, actionType: action.type, note },
      };
    }
    s = next;
  }
  const captured = JSON.parse(capsule.serializedRun) as Record<string, unknown>;
  const rebuilt = JSON.parse(serialize(s)) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(captured), ...Object.keys(rebuilt)])].sort();
  const mismatchedKeys = keys.filter((k) => JSON.stringify(captured[k]) !== JSON.stringify(rebuilt[k]));
  if (mismatchedKeys.length > 0) {
    return {
      ok: false,
      actionsReplayed: capsule.actions.length,
      drift: {
        kind: 'final_state_mismatch',
        mismatchedKeys,
        note:
          note ??
          'every logged action replayed, but the final state differs — divergence is inside the replayed span (compare the keys above against the capture).',
      },
    };
  }
  return { ok: true, drift: null, actionsReplayed: capsule.actions.length };
}

// ── Step 9: starter Vitest fixture (written as .txt so it can never run accidentally) ──────────────────────

export function buildStarterTest(envelope: BugReportEnvelope): string {
  const short = envelope.reportId.slice(0, 8);
  return `/**
 * STARTER regression fixture for bug ${envelope.reportId}
 * (generated by \`npm run bugs:repro\` — saved as .txt so it never runs accidentally).
 *
 * The scenario IS the fixture (handoff §3.3 one scenario format / §11.4 graduation): qa-scenario.json is a
 * \`QaScenarioV1\` executed through the real \`runQaScenario\`. To graduate this bug: copy qa-scenario.json +
 * this file into a package's test tree, rename to .test.ts, and — AFTER triage rules the intended behavior —
 * replace the scenario's \`needs-ruling\` expectation with real expectations (state-delta / event-count /
 * card-delta / …) validated against card text / the Rulebook / existing tests, NOT against the player
 * description alone (the description is an untrusted claim — docs/bug-reports.md). A graduated bug is a
 * scenario fixture plus an expectation upgrade, not a bespoke test.
 *
 * Issue type: ${envelope.issueType}
 * Captured at: wave ${envelope.context.wave}, phase ${envelope.context.phase}, hero ${envelope.context.heroId}, seed ${envelope.context.seed}
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseQaScenario, runQaScenario } from '@game/sim';

describe('bug ${short} — ${envelope.issueType} (wave ${envelope.context.wave}, ${envelope.context.heroId})', () => {
  it('the captured incident scenario executes and its expectations hold', () => {
    const { scenario, errors } = parseQaScenario(readFileSync(new URL('./qa-scenario.json', import.meta.url), 'utf8'));
    expect(errors).toEqual([]); // a stale scenario fails LOUDLY (removed cards, schema drift) — regenerate it
    const result = runQaScenario(scenario!);

    // TODO(placeholder): after triage, upgrade qa-scenario.json's needs-ruling expectation to REAL
    // expectations for the ruled behavior; until then this asserts the deterministic reproduction only.
    expect(result.validationErrors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
`;
}

// ── Orchestrator: the full §8.4 walk, returning printable lines + files to write ───────────────────────────

export interface ReproOutcome {
  lines: string[];
  validation: ContentValidation;
  reconstruction: ReconstructionResult;
  run: RunState;
}

export function reproEnvelope(envelope: BugReportEnvelope): ReproOutcome {
  const capsule = envelope.context;
  const lines: string[] = [];

  // MENU report (owner ask 2026-08-27): no run evidence by design — the CLI wrapper reports this before
  // calling here; this throw keeps the library honest for any other caller.
  if (capsule.phase === 'menu' || capsule.serializedRun === null) {
    throw new Error('menu report — no run evidence. The player description is the whole payload; there is nothing to reproduce.');
  }

  // Step 2: deserialize the captured run — the primary reproduction.
  const run = deserialize(capsule.serializedRun);

  // Step 3: content ids vs THIS checkout.
  const validation = validateContentIds(run, capsule);
  if (validation.contentRevisionMismatch) {
    lines.push('CONTENT REVISION MISMATCH — the capture references ids this checkout does not know:');
    if (validation.unknownCardIds.length) lines.push(`  unknown cards: ${validation.unknownCardIds.join(', ')}`);
    if (validation.unknownRuneIds.length) lines.push(`  unknown runes: ${validation.unknownRuneIds.join(', ')}`);
    if (validation.unknownHeroId) lines.push(`  unknown hero: ${validation.unknownHeroId}`);
    lines.push(`  (captured content revision: ${envelope.client.contentRevision} — load read-only, do not resimulate)`);
    lines.push('');
  }

  // Step 4: summary.
  lines.push(...summarizeRun(run, capsule), '');

  // Step 5: captured combat chains (the authoritative resolved log — replayed, never resimulated).
  if (capsule.combat) {
    const events = capsule.combat.result.events;
    lines.push(`captured combat: ${events.length} events (outcome: ${capsule.combat.result.result}, playerDamage ${capsule.combat.result.playerDamage})`);
    lines.push(...combatEventLines(events));
  } else {
    lines.push('captured combat: none (report opened before the first fight)');
  }
  lines.push('');

  // Steps 6–7: secondary consistency check — seed + actions through the real reducer.
  const reconstruction = reconstructFromSeed(capsule);
  if (reconstruction.ok) {
    lines.push(`reconstruction: ${reconstruction.actionsReplayed} actions replayed from seed ${capsule.seed} — matches the captured state exactly.`);
  } else {
    const d = reconstruction.drift!;
    lines.push(`reconstruction: DRIFT (${d.kind}) after ${reconstruction.actionsReplayed}/${capsule.actions.length} actions`);
    if (d.actionIndex !== undefined) lines.push(`  first mismatching action: index ${d.actionIndex} (${d.actionType})`);
    if (d.error) lines.push(`  reducer error: ${d.error}`);
    if (d.mismatchedKeys) lines.push(`  differing state keys: ${d.mismatchedKeys.join(', ')}`);
    if (d.note) lines.push(`  note: ${d.note}`);
    lines.push('  → the captured serialized state remains the authoritative reproduction; the drift marks where to look for corruption.');
  }

  return { lines, validation, reconstruction, run };
}
