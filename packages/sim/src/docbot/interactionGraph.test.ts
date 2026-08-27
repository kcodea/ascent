/**
 * DOC BOT 2.0 WP F — the interaction-graph GATE lane (blueprint §10.2; work-package-plan.md WP F).
 *
 * Gates:
 *  · derivation determinism (§4.4) — deriving the graph twice from the same registry is byte-identical;
 *  · structural integrity — every edge endpoint exists, every kind is in the §10.2-derived vocabulary,
 *    produces/consumes edges carry their channel;
 *  · §10.2 node coverage — every node kind the blueprint lists actually appears (a derivation regression
 *    that silently drops a kind fails here);
 *  · applicability (§10.3's precondition) — candidate pairs come ONLY from shared channels and are a real
 *    reduction of the naive all-pairs product; unmapped triggers are ONLY the namespaced hero/objective
 *    events (a NEW ordinary trigger with no channel mapping fails the gate, §4.3);
 *  · sabotage (§4.5) — a doctored edge (unknown endpoint, alien kind, channel-less produces) is DETECTED.
 */
import { describe, expect, it } from 'vitest';
import { allContracts } from '@game/rules/contracts';
import { stableStringify } from '../qaScenario';
import {
  buildInteractionGraph, candidatePairs, graphErrors, graphStats,
  type InteractionEdge, type InteractionNodeKind,
} from './interactionGraph';

const CONTRACTS = allContracts();
const GRAPH = buildInteractionGraph(CONTRACTS);
const CANDIDATES = candidatePairs(GRAPH, CONTRACTS);

describe('interaction graph (§10.2) — derivation', () => {
  it('is deterministic: two derivations are byte-identical (§4.4)', () => {
    const again = buildInteractionGraph(CONTRACTS);
    expect(stableStringify(again)).toBe(stableStringify(GRAPH));
  });

  it('is structurally valid (edge endpoints, vocabulary, channels)', () => {
    expect(graphErrors(GRAPH)).toEqual([]);
  });

  it('covers every §10.2 node kind the registry can express', () => {
    const stats = graphStats(GRAPH);
    const expectKinds: InteractionNodeKind[] = [
      'content', 'trigger-family', 'effect-family', 'keyword', 'persistence-mode',
      'copy-mode', 'counter', 'multiplier', 'zone', 'phase-boundary', 'channel',
    ];
    for (const k of expectKinds) {
      expect(stats.nodesByKind[k] ?? 0, `no '${k}' nodes derived — a §10.2 kind silently vanished`).toBeGreaterThan(0);
    }
    // One content node per contract — the graph never drops or invents content.
    expect(stats.nodesByKind['content']).toBe(CONTRACTS.length);
    // suppresses/replaces have no derivable substrate today: exactly zero, reported, never invented (§4.3).
    expect(stats.edgesByKind['suppresses']).toBe(0);
    expect(stats.edgesByKind['replaces']).toBe(0);
    // multiplies edges exist (the multiplier roster is non-empty in both sets).
    expect(stats.edgesByKind['multiplies'] ?? 0).toBeGreaterThan(0);
  });

  it('scale sanity: the graph is registry-sized, not degenerate', () => {
    expect(GRAPH.nodes.length).toBeGreaterThan(CONTRACTS.length); // content + derived kinds
    expect(GRAPH.edges.length).toBeGreaterThan(GRAPH.nodes.length);
  });
});

describe('applicability engine (§10.3 precondition: shared channel, never all-pairs)', () => {
  it('candidate pairs are a real reduction of the naive product, and the report balances', () => {
    const { report, pairs } = CANDIDATES;
    expect(report.naivePairs).toBe((CONTRACTS.length * (CONTRACTS.length - 1)) / 2);
    expect(report.candidatePairs).toBe(pairs.length);
    expect(report.candidatePairs).toBeGreaterThan(0);
    expect(report.candidatePairs).toBeLessThan(report.naivePairs / 2); // the join must prune hard
    const perChannelSum = Object.values(report.perChannel).reduce((n, c) => n + c.pairs, 0);
    expect(perChannelSum).toBe(report.candidatePairs);
    for (const p of pairs.slice(0, 200)) expect(p.a).not.toBe(p.b);
  });

  it('unmapped triggers are ONLY the namespaced hero/objective events — an ordinary trigger with no channel fails here (§4.3)', () => {
    const ordinary = CANDIDATES.report.unmappedTriggers.filter((t) => !/^(hero:|objective:)/.test(t));
    expect(ordinary, `ordinary trigger(s) with no CHANNEL_OF_TRIGGER mapping: ${ordinary.join(', ')} — map them (or classify as phase triggers), never let them fall out of the join silently`).toEqual([]);
  });

  it('is deterministic', () => {
    const again = candidatePairs(buildInteractionGraph(CONTRACTS), CONTRACTS);
    expect(stableStringify(again)).toBe(stableStringify(CANDIDATES));
  });
});

describe('interaction graph — sabotage (§4.5)', () => {
  it('a doctored edge with an unknown endpoint is detected', () => {
    const doctored = { nodes: GRAPH.nodes, edges: [...GRAPH.edges, { from: 'content:ghost-card', to: 'channel:death', kind: 'produces', channel: 'death' } as InteractionEdge] };
    expect(graphErrors(doctored).some((e) => e.includes('ghost-card'))).toBe(true);
  });

  it('a doctored edge kind outside the §10.2 vocabulary is detected', () => {
    const first = GRAPH.edges[0]!;
    const doctored = { nodes: GRAPH.nodes, edges: [{ ...first, kind: 'teleports' as InteractionEdge['kind'] }] };
    expect(graphErrors(doctored).some((e) => e.includes("'teleports'"))).toBe(true);
  });

  it('a produces edge stripped of its channel is detected', () => {
    const produces = GRAPH.edges.find((e) => e.kind === 'produces')!;
    const rest: InteractionEdge = { ...produces };
    delete (rest as { channel?: string }).channel;
    const doctored = { nodes: GRAPH.nodes, edges: [rest] };
    expect(graphErrors(doctored).some((e) => e.includes('names no channel'))).toBe(true);
  });
});
