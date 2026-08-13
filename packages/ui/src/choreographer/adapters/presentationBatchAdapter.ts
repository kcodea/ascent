/**
 * BEAT CHOREOGRAPHER PR 2 — PresentationBatch → normalized timeline input (blueprint §8.1).
 *
 * The adapter is where raw gameplay emission becomes something the compiler can reason about: consequences
 * attached to their source, nested triggers linked to their parent, and every structural problem reported as a
 * DIAGNOSTIC rather than silently repaired. That last part is the whole point — a consequence with a missing
 * parent used to be invisible; now it is an orphan the coverage panel can show.
 *
 * This layer does no timing. It knows nothing about milliseconds.
 */
import type { ConsequenceEvent, PresentationBatch, PresentationPolicy, SourceTriggerEvent, ZoneTargetRef } from '@game/core';
import type {
  NormalizedTimelineInput,
  PresentationMode,
  TimelineConsequenceNode,
  TimelineDiagnostic,
  TimelineSourceNode,
} from '../timelineTypes';

/** Internal policy vocabulary → the four user-facing modes (§7.4). */
export function modeForPolicy(policy: PresentationPolicy): PresentationMode {
  switch (policy) {
    case 'ownBeat': return 'ownBeat';
    case 'foldedCue': return 'reactInsideParent';
    default: return 'silent'; // passive + intentionallySilent both present as nothing
  }
}

/** A consequence's targets, normalized to a list (most carry one; some carry none, e.g. an aura or resource). */
function targetsOf(e: ConsequenceEvent): ZoneTargetRef[] {
  const t = (e as { target?: ZoneTargetRef }).target;
  return t ? [t] : [];
}

export function normalizePresentationBatch(batch: PresentationBatch): NormalizedTimelineInput {
  const diagnostics: TimelineDiagnostic[] = [];
  const triggers: SourceTriggerEvent[] = [];
  const consequences: ConsequenceEvent[] = [];
  const seen = new Set<string>();

  for (const e of batch.events) {
    if (seen.has(e.id)) {
      diagnostics.push({ severity: 'error', code: 'duplicateId', message: `Two events share the id '${e.id}'.`, nodeId: e.id });
      continue;
    }
    seen.add(e.id);
    if (e.type === 'sourceTrigger') triggers.push(e);
    else consequences.push(e);
  }

  const byId = new Map<string, TimelineSourceNode>();
  const nodes: TimelineSourceNode[] = triggers.map((t) => {
    const node: TimelineSourceNode = {
      id: t.id,
      phase: t.phase,
      source: t.source,
      trigger: t.trigger,
      policyKey: t.policyKey,
      family: t.family,
      occurrenceKey: t.occurrenceKey,
      emittedPolicy: modeForPolicy(t.policy),
      step: t.step,
      sequence: t.sequence,
      parentId: t.parentId,
      dependencyIds: t.dependencyIds ?? [],
      simultaneousGroupId: t.simultaneousGroupId,
      repeat: t.repeatCount !== undefined ? { index: t.repeatIndex ?? 0, count: t.repeatCount } : undefined,
      consequences: [],
      runtimeAdapter: 'presentationBatch',
      runtimeRef: t,
    };
    byId.set(node.id, node);
    return node;
  });

  // PR 1 made identity explicit; anything still missing it is a REAL migration gap and must be visible.
  // Reconstructing a plausible key here is precisely the trap the blueprint names (§25), so we report instead.
  for (const n of nodes) {
    if (!n.policyKey) {
      diagnostics.push({ severity: 'warn', code: 'missingPolicyKey', message: `${n.source.label ?? n.source.id} (${n.trigger}) emits no policyKey — its gameplay resolver is not migrated, so it can only use policy/global timing.`, nodeId: n.id });
    } else if (!n.family) {
      diagnostics.push({ severity: 'warn', code: 'missingFamily', message: `${n.policyKey} carries no family, so family templates cannot apply.`, nodeId: n.id });
    }
    if (n.parentId && !byId.has(n.parentId)) {
      diagnostics.push({ severity: 'error', code: 'unknownParent', message: `Trigger '${n.id}' names parent '${n.parentId}', which is not in this batch.`, nodeId: n.id });
      n.parentId = undefined; // treat as a root rather than dropping the beat entirely
    }
    for (const dep of n.dependencyIds) {
      if (!byId.has(dep)) diagnostics.push({ severity: 'error', code: 'unknownDependency', message: `Trigger '${n.id}' depends on '${dep}', which is not in this batch.`, nodeId: n.id });
    }
  }
  // Steps are the authoritative coarse ordering — a decrease means the emitter's boundaries are inconsistent
  // and presentation could legally reorder things gameplay did not.
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i].step < nodes[i - 1].step) {
      diagnostics.push({ severity: 'error', code: 'decreasingStep', message: `Step goes backwards at '${nodes[i].id}' (${nodes[i - 1].step} → ${nodes[i].step}).`, nodeId: nodes[i].id });
      break; // one report is enough; the whole batch is suspect
    }
  }

  for (const c of consequences) {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    if (!parent) {
      diagnostics.push({ severity: 'warn', code: 'orphanConsequence', message: `A '${c.type}' consequence has no source trigger, so nothing on screen can claim credit for it.`, nodeId: c.id });
      continue;
    }
    const node: TimelineConsequenceNode = {
      id: c.id,
      kind: c.type,
      sequence: c.sequence,
      deliveryKey: c.deliveryKey ?? 'primary',
      targetRefs: targetsOf(c),
      payload: c,
      runtimeRef: c,
    };
    parent.consequences.push(node);
  }
  for (const n of nodes) n.consequences.sort((a, b) => a.sequence - b.sequence);

  return { phase: batch.phase, id: batch.id, nodes, diagnostics };
}
