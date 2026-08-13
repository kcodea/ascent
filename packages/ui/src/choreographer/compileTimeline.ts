/**
 * BEAT CHOREOGRAPHER PR 2 — the shared timeline compiler (blueprint §11).
 *
 * ONE compiler, consumed by BOTH the live player and the tool. That is not a tidiness preference: two
 * compilers is exactly how the current Beat Lab ended up previewing a sequence the game never plays. If this
 * file is the only thing that turns events into milliseconds, the tool cannot lie about the game.
 *
 * Hard requirement: PURE and DETERMINISTIC. No DOM measurement, no clock, no random, no React state. Same
 * input + same config ⇒ byte-identical output (asserted in the tests).
 *
 * The two behaviours that fix what the owner actually saw on screen:
 *
 *   - **Nested reactions do not advance the root cursor** (§11 pass 6). A folded cue used to consume a full
 *     sequential slot, so every King-Oona-style modifier inserted a fake pause. Now a reaction is placed
 *     INSIDE its parent's envelope, and only EXTENDS the parent if it genuinely overruns.
 *   - **Consequences land at a delivery marker** (§11 pass 7), not at `start + windup`. This is the mechanism
 *     that stops a buff appearing before the source that caused it has visibly acted.
 */
import type { BeatConfigSnapshot } from './resolveTiming';
import { EMPTY_CONFIG, clampTiming, resolveTiming, timingViolations } from './resolveTiming';
import type {
  AuthoredBeatConfig,
  CompiledBeat,
  CompiledConsequenceDelivery,
  CompiledTimeline,
  NormalizedTimelineInput,
  PresentationMode,
  TimelineDiagnostic,
  TimelineSourceNode,
} from './timelineTypes';

export interface CompileOptions {
  config?: BeatConfigSnapshot;
  /** Unsaved session edits from the tool — always win over the committed file. */
  draft?: Record<string, AuthoredBeatConfig>;
  /** Unsaved reclassifications (folded ↔ own beat). */
  modeDraft?: Record<string, PresentationMode>;
  /**
   * Runtime-supplied absolute anchor times (attack contact, death completion, summon appearance). Combat
   * owns these — the compiler never invents them. Missing anchor ⇒ diagnostic + fall back to sequential.
   */
  anchors?: Record<string, number>;
}

/** Topological order over dependency edges, stable and cycle-tolerant (a cycle is reported, not thrown). */
function orderRoots(roots: TimelineSourceNode[], diagnostics: TimelineDiagnostic[]): TimelineSourceNode[] {
  // Authoritative baseline: step, then emission sequence. Dependencies can only ever DELAY a node, never
  // promote one ahead of gameplay order.
  const base = [...roots].sort((a, b) => a.step - b.step || a.sequence - b.sequence);
  const byId = new Map(base.map((n) => [n.id, n]));
  const state = new Map<string, 'visiting' | 'done'>();
  const out: TimelineSourceNode[] = [];

  const visit = (node: TimelineSourceNode): void => {
    const s = state.get(node.id);
    if (s === 'done') return;
    if (s === 'visiting') {
      diagnostics.push({ severity: 'error', code: 'dependencyCycle', message: `Dependency cycle involving '${node.id}' — presentation order falls back to gameplay order.`, nodeId: node.id });
      return;
    }
    state.set(node.id, 'visiting');
    for (const dep of node.dependencyIds) {
      const d = byId.get(dep);
      if (d) visit(d);
    }
    state.set(node.id, 'done');
    out.push(node);
  };
  for (const n of base) visit(n);
  return out;
}

export function compileTimeline(input: NormalizedTimelineInput, options: CompileOptions = {}): CompiledTimeline {
  const config = options.config ?? EMPTY_CONFIG;
  const diagnostics: TimelineDiagnostic[] = [...input.diagnostics];
  const anchors = options.anchors ?? {};

  // ── Pass 1–2: validate + resolve config ──────────────────────────────────────────────────────────────
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const resolved = new Map<string, ReturnType<typeof resolveTiming>>();
  for (const node of input.nodes) {
    if (node.phase !== input.phase) {
      diagnostics.push({ severity: 'error', code: 'phaseMismatch', message: `'${node.id}' is phase '${node.phase}' inside a '${input.phase}' timeline.`, nodeId: node.id });
    }
    const r = resolveTiming(node, config, options.draft, options.modeDraft);
    const bad = timingViolations(r.value);
    if (bad.length) {
      diagnostics.push({ severity: 'error', code: 'invalidTiming', message: `${node.source.label ?? node.source.id}: ${bad.join(', ')} — clamped.`, nodeId: node.id });
      r.value = clampTiming(r.value);
    }
    resolved.set(node.id, r);
  }

  // ── Pass 3: causal groups. Parent relation beats policy guesswork (§11 pass 3): a node with a real parent
  // is a reaction even if its mode says ownBeat — gameplay's causality is not overridable by config.
  const childrenOf = new Map<string, TimelineSourceNode[]>();
  const roots: TimelineSourceNode[] = [];
  for (const node of input.nodes) {
    // Guard against a parent chain that loops back on itself before we recurse over it.
    let hops = 0;
    let cur: TimelineSourceNode | undefined = node;
    const chain = new Set<string>();
    while (cur?.parentId && hops++ < 64) {
      if (chain.has(cur.id)) break;
      chain.add(cur.id);
      cur = byId.get(cur.parentId);
    }
    if (hops >= 64 || (cur && chain.has(cur.id) && cur.parentId)) {
      diagnostics.push({ severity: 'error', code: 'parentCycle', message: `Parent chain from '${node.id}' does not terminate; treating it as a root.`, nodeId: node.id });
      roots.push(node);
      continue;
    }
    if (node.parentId && byId.has(node.parentId)) {
      (childrenOf.get(node.parentId) ?? childrenOf.set(node.parentId, []).get(node.parentId)!).push(node);
    } else {
      roots.push(node);
    }
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.step - b.step || a.sequence - b.sequence);

  const beats: CompiledBeat[] = [];
  const deliveries: CompiledConsequenceDelivery[] = [];
  const beatById = new Map<string, CompiledBeat>();

  const makeBeat = (node: TimelineSourceNode, startMs: number, lane: 'source' | 'reaction', parentBeatId?: string): CompiledBeat => {
    const { value, provenance } = resolved.get(node.id)!;
    const beat: CompiledBeat = {
      id: `beat:${node.id}`,
      nodeId: node.id,
      parentBeatId,
      mode: value.mode,
      lane,
      startMs,
      deliveryMs: startMs + value.deliveryOffsetMs,
      completionMs: startMs + value.completionOffsetMs,
      recoveryEndMs: startMs + value.completionOffsetMs + value.recoveryMs,
      source: node.source,
      trigger: node.trigger,
      family: node.family,
      policyKey: node.policyKey,
      repeat: node.repeat ? { ...node.repeat, mode: value.repeatMode } : undefined,
      config: value,
      provenance,
      runtimeRef: node.runtimeRef,
    };
    beats.push(beat);
    beatById.set(node.id, beat);
    return beat;
  };

  /** Resolve a start time from an anchor (§8.2). Unknown runtime anchors degrade to sequential + report. */
  const resolveAnchorStart = (node: TimelineSourceNode, cursorMs: number, parent?: CompiledBeat): number => {
    const { value } = resolved.get(node.id)!;
    const off = value.anchor.offsetMs ?? 0;
    switch (value.anchor.kind) {
      case 'phaseStart': return off;
      case 'afterPreviousBeat': return cursorMs + off;
      case 'withParentActivation': return (parent?.startMs ?? cursorMs) + off;
      case 'atParentDelivery': return (parent?.deliveryMs ?? cursorMs) + off;
      case 'atAttackContact':
      case 'afterDeathCompletes':
      case 'whenSummonAppears':
      case 'afterAllStartOfCombat': {
        // Runtime markers the ENGINE owns. The compiler displays them symbolically and refuses to fabricate
        // one — an invented contact time would desync presentation from the attack it belongs to.
        const at = anchors[value.anchor.kind];
        if (at === undefined) {
          diagnostics.push({ severity: 'warn', code: 'unknownAnchor', message: `'${value.anchor.kind}' is not supplied for this scenario; '${node.id}' falls back to sequential placement.`, nodeId: node.id });
          return cursorMs + off;
        }
        return at + off;
      }
    }
  };

  /** Pass 7 — place one beat's consequences at their delivery markers, staggered per target group. */
  const placeConsequences = (node: TimelineSourceNode, beat: CompiledBeat): void => {
    const { value } = resolved.get(node.id)!;
    // Stagger counts PER MARKER: two effects delivering at different markers should not stagger each other.
    const seenPerMarker = new Map<string, number>();
    for (const c of node.consequences) {
      const markerOffset = c.deliveryKey === 'primary' ? value.deliveryOffsetMs : value.deliveryMarkers[c.deliveryKey];
      if (markerOffset === undefined && c.deliveryKey !== 'primary') {
        // A named marker with no authored offset falls back to primary delivery — correct and truthful, but
        // worth surfacing so a typo'd deliveryKey doesn't silently behave like `primary` forever.
        diagnostics.push({ severity: 'info', code: 'unknownAnchor', message: `Delivery marker '${c.deliveryKey}' is not defined for ${node.source.label ?? node.source.id}; using primary delivery.`, nodeId: node.id });
      }
      const staggerIndex = seenPerMarker.get(c.deliveryKey) ?? 0;
      seenPerMarker.set(c.deliveryKey, staggerIndex + 1);
      const base = beat.startMs + (markerOffset ?? value.deliveryOffsetMs);
      deliveries.push({
        id: `deliver:${c.id}`,
        beatId: beat.id,
        atMs: base + staggerIndex * value.targetStaggerMs,
        staggerIndex,
        consequence: c,
      });
    }
  };

  /**
   * Pass 6 — nested reactions. Placed inside the parent, and they NEVER advance the root cursor. If a child
   * genuinely runs past its parent, the parent's completion (and recovery) stretch to cover it, and the
   * extension propagates up the ancestry — the readable behaviour, without a fake sequential pause.
   */
  const placeChildren = (parentNode: TimelineSourceNode, parentBeat: CompiledBeat): void => {
    for (const child of childrenOf.get(parentNode.id) ?? []) {
      const { value } = resolved.get(child.id)!;
      const start = resolveAnchorStart(child, parentBeat.deliveryMs, parentBeat);
      // A silent reaction still delivers its consequences (the projection must update) but occupies no time.
      const beat = makeBeat(child, start, 'reaction', parentBeat.id);
      placeConsequences(child, beat);
      placeChildren(child, beat);
      if (value.mode !== 'silent' && beat.completionMs > parentBeat.completionMs) {
        parentBeat.completionMs = beat.completionMs;
        parentBeat.recoveryEndMs = beat.completionMs + parentBeat.config.recoveryMs;
      }
    }
  };

  // ── Pass 4–5: root order + placement ─────────────────────────────────────────────────────────────────
  let cursorMs = 0;
  const ordered = orderRoots(roots, diagnostics);
  let i = 0;
  while (i < ordered.length) {
    const node = ordered[i];
    const groupId = node.simultaneousGroupId;
    // Simultaneous roots share a start and advance the cursor to the LATEST recovery end (§11 pass 5).
    const group = [node];
    if (groupId) {
      while (i + group.length < ordered.length && ordered[i + group.length].simultaneousGroupId === groupId) {
        group.push(ordered[i + group.length]);
      }
    }
    const start = resolveAnchorStart(node, cursorMs);
    let groupEnd = cursorMs;
    for (const member of group) {
      const beat = makeBeat(member, start, 'source');
      placeConsequences(member, beat);
      placeChildren(member, beat);
      // A silent root contributes its consequences but consumes no timeline — that is what `silent` means.
      if (beat.mode !== 'silent') groupEnd = Math.max(groupEnd, beat.recoveryEndMs);
    }
    cursorMs = Math.max(cursorMs, groupEnd);
    i += group.length;
  }

  // Deterministic output ordering — never rely on insertion order surviving a refactor.
  beats.sort((a, b) => a.startMs - b.startMs || a.nodeId.localeCompare(b.nodeId));
  deliveries.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));

  const durationMs = Math.max(
    0,
    ...beats.map((b) => b.recoveryEndMs),
    ...deliveries.map((d) => d.atMs),
  );

  return {
    id: input.id,
    phase: input.phase,
    durationMs,
    beats,
    consequenceDeliveries: deliveries,
    diagnostics,
    configRevision: config.revision ?? 'default',
  };
}
