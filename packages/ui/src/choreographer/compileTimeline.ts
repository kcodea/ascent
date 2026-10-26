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
import { REPEAT_PACING, isLongChain, repeatChainCapMs, repeatChainSchedule, type RepeatTickPace } from './repeatPacing';
import type {
  AuthoredBeatConfig,
  CompiledBeat,
  CompiledConsequenceDelivery,
  CompiledTimeline,
  NormalizedTimelineInput,
  PresentationMode,
  ResolvedBeatConfig,
  TimelineDiagnostic,
  TimelineSourceNode,
} from './timelineTypes';
import type { TriggerSourceRef } from '@game/core';

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

  const makeBeat = (
    node: TimelineSourceNode,
    startMs: number,
    lane: 'source' | 'reaction',
    parentBeatId?: string,
    pace?: { scale: number; accent: boolean; sharesSlot: boolean },
    chainLink?: { index: number; count: number; from: TriggerSourceRef },
  ): CompiledBeat => {
    const { value: authored, provenance } = resolved.get(node.id)!;
    // A chain link (R-SHRIEKER-BEATS-01) takes the chain's slot shape first: its delivery waits for the link cue
    // to land, and its hold and recovery are trimmed so a wide board stays snappy.
    const linkedValue = chainLink ? chainLinkTiming(authored) : authored;
    // A paced repeat tick (R-REPEAT-04) plays the same beat SHAPE, scaled: every offset shrinks by one factor,
    // so the delivery still lands inside the beat and the stagger still reads as a wave.
    const value = pace && pace.scale !== 1 ? scaleTiming(linkedValue, pace.scale) : linkedValue;
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
      ...(pace ? { pace: { scale: pace.scale, accent: pace.accent, sharesSlot: pace.sharesSlot } } : {}),
      ...(chainLink ? { chainLink } : {}),
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
    const value = beat.config; // the beat's own (possibly repeat-paced) timing
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
    const children = childrenOf.get(parentNode.id) ?? [];
    // A SEQUENTIAL parent (registry `children: 'sequential'`, R-SHRIEKER-BEATS-01) plays its nested triggers one
    // beat at a time, in gameplay order: each starts once the previous one has completed AND recovered, so its
    // consequences land on their own beat instead of all at the parent's delivery. Silent children still deliver
    // but take no slot. The parent stretches over the whole chain (below), which is what advances the root cursor.
    const sequential = parentNode.childOrder === 'sequential';
    const linked = sequential ? children.filter((c) => resolved.get(c.id)!.value.mode !== 'silent') : [];
    let siblingCursor = parentBeat.deliveryMs;
    for (const child of children) {
      const { value } = resolved.get(child.id)!;
      const link = sequential && value.mode !== 'silent' ? linked.indexOf(child) : -1;
      const start = link >= 0 ? siblingCursor : resolveAnchorStart(child, parentBeat.deliveryMs, parentBeat);
      // A silent reaction still delivers its consequences (the projection must update) but occupies no time.
      // A reaction inside a PACED repeat tick is paced with it, or it would stretch the tick back out.
      const beat = makeBeat(child, start, 'reaction', parentBeat.id, parentBeat.pace, link >= 0 ? { index: link, count: linked.length, from: parentNode.source } : undefined);
      placeConsequences(child, beat);
      placeChildren(child, beat);
      if (link >= 0) siblingCursor = Math.max(siblingCursor, beat.recoveryEndMs);
      if (value.mode !== 'silent' && beat.completionMs > parentBeat.completionMs) {
        parentBeat.completionMs = beat.completionMs;
        parentBeat.recoveryEndMs = beat.completionMs + parentBeat.config.recoveryMs;
      }
    }
    // The chain's last link has a recovery of its own before the next root may start.
    if (sequential && siblingCursor > parentBeat.recoveryEndMs) parentBeat.recoveryEndMs = siblingCursor;
  };

  // ── Pass 4–5: root order + placement ─────────────────────────────────────────────────────────────────
  let cursorMs = 0;
  const ordered = orderRoots(roots, diagnostics);
  // REPEAT CHAIN PACING (owner 2026-09-27, R-REPEAT-04): End of Turn only. The previous paced tick, so a batched
  // tick can share its slot's start.
  const schedules = new Map<string, RepeatTickPace[]>();
  // SEVERAL LONG CHAINS SHARE ONE BUDGET (R-REPEAT-05): count this End of Turn's long chains first, so four Kringles
  // split the phase's repeat budget instead of each taking the full single-chain cap.
  const longChains = new Set<string>();
  if (input.phase === 'endOfTurn') {
    for (const node of ordered) {
      if (node.simultaneousGroupId) continue;
      const key = repeatPaceKeyOf(node, resolved.get(node.id)!.value);
      if (key && isLongChain(node.repeat!.count)) longChains.add(key);
    }
  }
  const longCapMs = repeatChainCapMs(longChains.size);
  let prevPaced: { key: string; index: number; startMs: number } | null = null;
  let i = 0;
  while (i < ordered.length) {
    const node = ordered[i];
    const groupId = node.simultaneousGroupId;
    const pace = input.phase === 'endOfTurn' && !groupId ? repeatPaceOf(node, resolved.get(node.id)!.value, schedules, longCapMs) : null;
    if (pace) {
      const prev: { key: string; index: number; startMs: number } | null = prevPaced;
      const shares: boolean = pace.tick.sharesSlot && prev !== null && prev.key === pace.key && prev.index === pace.index - 1;
      const start: number = shares && prev ? prev.startMs : resolveAnchorStart(node, cursorMs);
      const beat = makeBeat(node, start, 'source', undefined, { scale: pace.scale, accent: pace.tick.accent, sharesSlot: shares });
      placeConsequences(node, beat);
      placeChildren(node, beat);
      cursorMs = Math.max(cursorMs, beat.recoveryEndMs);
      prevPaced = { key: pace.key, index: pace.index, startMs: start };
      i += 1;
      continue;
    }
    prevPaced = null;
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

  // Deterministic output ordering — never rely on insertion order surviving a refactor. Ties break on the TIMELINE
  // position before the id, so the ticks of one batched repeat slot (same start) stay in tick order.
  const placedOrder = new Map(beats.map((b, k) => [b.id, k]));
  beats.sort((a, b) => a.startMs - b.startMs || (a.pace && b.pace ? placedOrder.get(a.id)! - placedOrder.get(b.id)! : 0) || a.nodeId.localeCompare(b.nodeId));
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

/**
 * SEQUENTIAL CHAIN PACING (owner 2026-10-10, R-SHRIEKER-BEATS-01: "every shout minion that triggers an effect gets
 * their own beat from left to right"). One link = one triggered Shout: the parent's link tendril leaves as the link
 * starts and lands at `linkLeadMs` (the authored `tendril-trail-dragon` ribbon is 210 ms, its target burst at 210),
 * the link's consequences deliver just after it lands, then a short hold and recovery before the next link.
 *
 * The slot is ~480 ms (230 delivery, 420 completion, 60 recovery) against a plain own beat's 710 (120 / 540 / 170):
 * a 6-Shout board reads in ~2.9 s, a gilded double pass in ~5.8 s. The delivery is a FLOOR (a slower authored beat
 * keeps its delivery) and the hold / recovery are CEILINGS (a snappier authored beat keeps its own), so tuning a
 * Shout's beat in the Lab still applies inside the chain. Every named marker moves with the delivery.
 */
export const CHAIN_LINK_PACING = {
  /** When the link cue (Shrieker's tendril) reaches the link's source: the ribbon's travel time. */
  linkLeadMs: 210,
  deliveryMs: 230,
  completionMs: 420,
  recoveryMs: 60,
} as const;

function chainLinkTiming(v: ResolvedBeatConfig): ResolvedBeatConfig {
  const deliveryOffsetMs = Math.max(v.deliveryOffsetMs, CHAIN_LINK_PACING.deliveryMs);
  const shift = deliveryOffsetMs - v.deliveryOffsetMs;
  const markers: Record<string, number> = {};
  for (const [key, ms] of Object.entries(v.deliveryMarkers)) markers[key] = ms + shift;
  return {
    ...v,
    deliveryOffsetMs,
    completionOffsetMs: Math.max(deliveryOffsetMs, Math.min(v.completionOffsetMs + shift, CHAIN_LINK_PACING.completionMs)),
    recoveryMs: Math.min(v.recoveryMs, CHAIN_LINK_PACING.recoveryMs),
    deliveryMarkers: markers,
  };
}

/** Every offset of a resolved beat, scaled by one factor (a paced repeat tick). Mode, anchor and repeat mode stay. */
function scaleTiming(v: ResolvedBeatConfig, k: number): ResolvedBeatConfig {
  const markers: Record<string, number> = {};
  for (const [key, ms] of Object.entries(v.deliveryMarkers)) markers[key] = ms * k;
  return {
    ...v,
    deliveryOffsetMs: v.deliveryOffsetMs * k,
    completionOffsetMs: v.completionOffsetMs * k,
    recoveryMs: v.recoveryMs * k,
    targetStaggerMs: v.targetStaggerMs * k,
    repeatGapMs: v.repeatGapMs * k,
    deliveryMarkers: markers,
  };
}

/**
 * The pace of one root node, or null when it is not a paced repeat tick. A tick is paced when it is an own
 * beat that carries a repeat of 2 or more (a "Repeat for every …" tick, a Chronos repeat, a rune replay), keyed
 * by its source + identity + count so two chains never share a schedule slot.
 */
function repeatPaceKeyOf(node: TimelineSourceNode, value: ResolvedBeatConfig): string | null {
  const rep = node.repeat;
  if (!rep || rep.count < 2 || rep.index < 0 || rep.index >= rep.count) return null;
  if (value.mode !== 'ownBeat') return null;
  const full = value.completionOffsetMs + value.recoveryMs;
  if (!(full > 0)) return null;
  const s = node.source;
  return `${s.kind}:${s.id}:${s.uid ?? ''}:${node.policyKey ?? node.trigger}:${rep.count}:${full}`;
}

function repeatPaceOf(
  node: TimelineSourceNode,
  value: ResolvedBeatConfig,
  schedules: Map<string, RepeatTickPace[]>,
  /** The cap a LONG chain gets this End of Turn (R-REPEAT-05, `repeatChainCapMs`). */
  longCapMs: number = REPEAT_PACING.capMs,
): { key: string; index: number; scale: number; tick: RepeatTickPace } | null {
  const key = repeatPaceKeyOf(node, value);
  if (!key) return null;
  const rep = node.repeat!;
  const full = value.completionOffsetMs + value.recoveryMs;
  let schedule = schedules.get(key);
  if (!schedule) { schedule = repeatChainSchedule(rep.count, full, REPEAT_PACING, isLongChain(rep.count) ? longCapMs : REPEAT_PACING.capMs); schedules.set(key, schedule); }
  const tick = schedule[rep.index]!;
  return { key, index: rep.index, scale: tick.spanMs / full, tick };
}
