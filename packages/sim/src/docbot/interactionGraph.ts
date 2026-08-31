/**
 * DOC BOT 2.0 WP F — the INTERACTION GRAPH + APPLICABILITY ENGINE (blueprint §10.2; work-package-plan.md WP F).
 *
 * A pure data module: `buildInteractionGraph(contracts)` derives nodes and edges from the ContentContract
 * registry (the caller passes `allContracts()` — the registry never rides @game/sim's entrypoint toward the
 * web bundle, the D-2 trap). Deterministic: pure function of its input, stable sort everywhere; deriving
 * twice must produce identical output (pinned in interactionGraph.test.ts).
 *
 * NODES (§10.2's list): content objects, trigger families, effect families, keywords, persistence modes,
 * copy modes, counters, multipliers, zones, phase boundaries — plus ONE addition, `channel:<id>`, the join
 * substrate. JUDGEMENT CALL, documented: §10.2's "produces event consumed by" edge is realized as the JOIN
 * through a channel node (producer → channel → consumer) instead of materialized content×content edges.
 * That is what makes candidate-pair generation O(channels) instead of the all-pairs brute force §10.3
 * forbids, and the applicability engine (`candidatePairs`) IS that join.
 *
 * EDGES (§10.2's vocabulary): produces, consumes (the two halves of produces-consumed-by), multiplies,
 * copies, shares-counter, moves-zones, changes-target-pool, changes-category — plus the structural `has`
 * (content → keyword/persistence/zone membership, so those §10.2 nodes are not orphans). `suppresses` and
 * `replaces` are in the vocabulary but no contract field states either today — the derivation emits ZERO of
 * them and `graphStats` reports the empty kinds honestly rather than inventing edges (§4.3).
 *
 * CHANNEL MAPPING is best-effort and HONEST: every trigger event maps to a channel through
 * CHANNEL_OF_TRIGGER; an event the table does not know lands in `unmappedTriggers` on the stats — a visible
 * to-do list, never a silent drop.
 */
import type { ContentContract } from '@game/rules/contracts/schema';

export type InteractionNodeKind =
  | 'content' | 'trigger-family' | 'effect-family' | 'keyword' | 'persistence-mode'
  | 'copy-mode' | 'counter' | 'multiplier' | 'zone' | 'phase-boundary' | 'channel';

export interface InteractionNode {
  id: string;
  kind: InteractionNodeKind;
}

export type InteractionEdgeKind =
  | 'produces' // content → channel: this object's effects/body emit events on the channel
  | 'consumes' // channel → content: a trigger of this object listens on the channel
  | 'multiplies' // content → trigger-family: a declared triggerMultiplier
  | 'copies' // content → copy-mode
  | 'suppresses' // vocabulary reserved; no derivable substrate today (emitted count: 0)
  | 'replaces' // vocabulary reserved; no derivable substrate today (emitted count: 0)
  | 'changes-target-pool' // content → keyword:all-tribes (universalTribe — the #c8a214d7 aura class)
  | 'shares-counter' // content → counter node (threshold triggers, per-N formulas)
  | 'changes-category' // content → effect-family for transform/convert factories
  | 'moves-zones' // content → zone for consume/bounce/return/sell-ish factories
  | 'has'; // structural membership: content → keyword / persistence-mode / phase-boundary

export interface InteractionEdge {
  from: string;
  to: string;
  kind: InteractionEdgeKind;
  /** For produces/consumes: the shared channel id (the join key). */
  channel?: string;
  note?: string;
}

export interface InteractionGraph {
  nodes: InteractionNode[];
  edges: InteractionEdge[];
}

/** Trigger event → the channel its payload rides. Best-effort, honest: unmapped events are REPORTED. */
export const CHANNEL_OF_TRIGGER: Readonly<Record<string, string>> = {
  // Equipment is granted as a body ENTERS PLAY (and re-granted at the rebuild), so it shares the summon
  // channel with every other arrival-driven trigger — that is what an Equip minion interacts with.
  equip: 'summon',
  onDeath: 'death',
  avenge: 'death',
  onKill: 'death',
  onSummon: 'summon',
  summonOverflow: 'summon',
  onPlay: 'play',
  orbit: 'play',
  orbitFired: 'play',
  battlecryTriggered: 'play',
  cardsPlayed: 'play',
  chooseOnePlayed: 'play',
  cast: 'spell-cast',
  spellCast: 'spell-cast',
  spellCastOnThis: 'spell-cast',
  onBuy: 'buy',
  cardsBought: 'buy',
  spellBought: 'buy',
  onSell: 'sell',
  minionSold: 'sell',
  onConsume: 'consume',
  onAttack: 'attack',
  onGainAttack: 'stat-change',
  onDamaged: 'damage',
  friendlyDemonDealtDamage: 'damage',
  onLoseDivineShield: 'shield-break',
  goldSpent: 'gold',
  onGainCard: 'card-gain',
  onRubyPlayed: 'ruby',
  rubyPlayedAnywhere: 'ruby',
  onGetRuby: 'ruby',
  rubyCast: 'ruby',
  shopRefreshed: 'shop-refresh',
  heroPower: 'hero-power',
};

/** Phase-boundary trigger events — these are moments, not producer→consumer channels; they become
 *  phase-boundary nodes with `has` edges instead of channel joins. */
export const PHASE_TRIGGERS: ReadonlySet<string> = new Set(['startOfCombat', 'endOfTurn', 'startOfTurn', 'passive']);

const CARD_TYPES: ReadonlySet<string> = new Set(['minion', 'spell', 'token', 'gift', 'henchman']);
const BODY_TYPES: ReadonlySet<string> = new Set(['minion', 'token', 'henchman']);

/** Effect kinds that PRODUCE events on a channel (best-effort classifiers over factory-id vocabulary). */
function producedChannels(c: ContentContract): Map<string, string> {
  const out = new Map<string, string>(); // channel → note
  if (BODY_TYPES.has(c.contentType)) {
    out.set('death', 'a body can die in combat');
    out.set('attack', 'a body attacks in combat');
    out.set('damage', 'a body deals combat damage');
  }
  if (CARD_TYPES.has(c.contentType)) {
    out.set('play', 'a card can be played from hand');
    if (c.contentType !== 'token' && c.contentType !== 'gift') out.set('buy', 'shop stock can be bought');
    if (BODY_TYPES.has(c.contentType)) out.set('sell', 'a fielded body can be sold');
  }
  if (c.contentType === 'spell') out.set('spell-cast', 'casting this spell emits the spell-cast channel');
  for (const e of c.effects ?? []) {
    if (e.summons || /summon/i.test(e.kind)) out.set('summon', `effect '${e.kind}' summons`);
    if (/cast/i.test(e.kind) && !/castOn/i.test(e.kind)) out.set('spell-cast', `effect '${e.kind}' casts`);
    if (/consume/i.test(e.kind)) out.set('consume', `effect '${e.kind}' consumes`);
    if (/ruby/i.test(e.kind)) out.set('ruby', `effect '${e.kind}' touches the Ruby channel`);
    if (/gold|ember/i.test(e.kind)) out.set('gold', `effect '${e.kind}' moves Gold`);
    if (/refresh|reroll/i.test(e.kind)) out.set('shop-refresh', `effect '${e.kind}' rolls the shop`);
    if (/grant|conjure|discover/i.test(e.kind)) out.set('card-gain', `effect '${e.kind}' adds cards to hand`);
  }
  if (c.contentType === 'hero-power') out.set('hero-power', 'an activated power emits the hero-power channel');
  return out;
}

/** Multiplier family → the trigger events it folds into (the shared vocabulary of triggerMultiplier). */
export const MULTIPLIER_FAMILY_TRIGGERS: Readonly<Record<string, string[]>> = {
  battlecry: ['onPlay', 'battlecryTriggered'],
  deathrattle: ['onDeath'],
  rally: ['onAttack'],
  endOfTurn: ['endOfTurn'],
  startOfCombat: ['startOfCombat'],
  avenge: ['avenge'],
};

const contentNode = (id: string): string => `content:${id}`;

/** Build the graph. Pure; both node and edge lists come back SORTED (byte-stable derivation). */
export function buildInteractionGraph(contracts: readonly ContentContract[]): InteractionGraph {
  const nodes = new Map<string, InteractionNodeKind>();
  const edges: InteractionEdge[] = [];
  const addNode = (id: string, kind: InteractionNodeKind): string => {
    const existing = nodes.get(id);
    if (existing && existing !== kind) return id; // first kind wins; ids are namespaced so this cannot happen
    nodes.set(id, kind);
    return id;
  };
  const addEdge = (e: InteractionEdge): void => { edges.push(e); };

  for (const c of [...contracts].sort((a, b) => (a.contentId < b.contentId ? -1 : 1))) {
    const me = addNode(contentNode(c.contentId), 'content');

    // consumes: trigger events → channels (or phase-boundary nodes).
    for (const t of c.triggers ?? []) {
      const event = t.event.startsWith('objective:') ? t.event.slice('objective:'.length) : t.event;
      addNode(`trigger:${t.event}`, 'trigger-family');
      addEdge({ from: me, to: `trigger:${t.event}`, kind: 'has', note: 'listens on this trigger family' });
      if (PHASE_TRIGGERS.has(event)) {
        addNode(`phase:${event}`, 'phase-boundary');
        addEdge({ from: me, to: `phase:${event}`, kind: 'has', note: 'fires at this phase boundary' });
        continue;
      }
      const channel = CHANNEL_OF_TRIGGER[event];
      if (!channel) continue; // reported by graphStats.unmappedTriggers — never silent
      addNode(`channel:${channel}`, 'channel');
      addEdge({ from: `channel:${channel}`, to: me, kind: 'consumes', channel, note: `trigger '${t.event}'` });
      if (t.threshold !== undefined) {
        addNode(`counter:threshold:${event}`, 'counter');
        addEdge({ from: me, to: `counter:threshold:${event}`, kind: 'shares-counter', note: `threshold ${t.threshold}` });
      }
    }

    // produces: what this object emits, per the classifier above.
    for (const [channel, note] of [...producedChannels(c).entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      addNode(`channel:${channel}`, 'channel');
      addEdge({ from: me, to: `channel:${channel}`, kind: 'produces', channel, note });
    }

    // effect families + category changes + zone moves + counters-from-formulas.
    for (const e of c.effects ?? []) {
      addNode(`factory:${e.kind}`, 'effect-family');
      addEdge({ from: me, to: `factory:${e.kind}`, kind: 'has', note: 'effect family membership' });
      if (/transform|convert/i.test(e.kind)) {
        addEdge({ from: me, to: `factory:${e.kind}`, kind: 'changes-category', note: 'transform/convert factory' });
      }
      if (/consume|bounce|return|tohand|recall/i.test(e.kind)) {
        addNode('zone:hand', 'zone');
        addNode('zone:board', 'zone');
        addEdge({ from: me, to: 'zone:hand', kind: 'moves-zones', note: `effect '${e.kind}' moves bodies between zones` });
      }
      if (e.amount?.kind === 'formula' && (e.amount.formula === 'per-n-counter' || e.amount.formula === 'escalating')) {
        addNode(`counter:${e.amount.formula}`, 'counter');
        addEdge({ from: me, to: `counter:${e.amount.formula}`, kind: 'shares-counter', note: e.amount.description });
      }
    }

    // multipliers (§10.2 'multiplies').
    if (c.multiplier) {
      addNode(`multiplier:${c.contentId}`, 'multiplier');
      addEdge({ from: me, to: `multiplier:${c.contentId}`, kind: 'has', note: 'declares a triggerMultiplier' });
      for (const fam of [...c.multiplier.families].sort()) {
        for (const trig of MULTIPLIER_FAMILY_TRIGGERS[fam] ?? []) {
          addNode(`trigger:${trig}`, 'trigger-family');
          addEdge({
            from: me, to: `trigger:${trig}`, kind: 'multiplies', channel: CHANNEL_OF_TRIGGER[trig],
            note: `family '${fam}' ×(1+${c.multiplier.extra})${c.multiplier.stacks ? ' stacking' : ''}`,
          });
        }
        if (!MULTIPLIER_FAMILY_TRIGGERS[fam]) {
          addEdge({ from: me, to: `trigger:${fam}`, kind: 'multiplies', note: `family '${fam}' has no trigger mapping — visible gap` });
          addNode(`trigger:${fam}`, 'trigger-family');
        }
      }
    }

    // copy modes, both ends (§10.2 'copies').
    if (c.copyPolicy) {
      addNode(`copy-mode:${c.copyPolicy.mode}`, 'copy-mode');
      addEdge({ from: me, to: `copy-mode:${c.copyPolicy.mode}`, kind: 'copies', note: 'copier: stated copy policy' });
    }
    if (c.copySubject) {
      addNode('copy-mode:subject', 'copy-mode');
      addEdge({ from: me, to: 'copy-mode:subject', kind: 'copies', note: 'copied subject: states what rides/sheds' });
    }

    // keywords, persistence, target-pool changes (§10.2 nodes kept connected via structural `has`).
    for (const k of c.keywords ?? []) {
      addNode(`keyword:${k}`, 'keyword');
      addEdge({ from: me, to: `keyword:${k}`, kind: 'has' });
    }
    for (const p of c.persistence ?? []) {
      addNode(`persistence:${p}`, 'persistence-mode');
      addEdge({ from: me, to: `persistence:${p}`, kind: 'has' });
    }
    if ((c.tags ?? []).includes('universal-tribe')) {
      addNode('keyword:all-tribes', 'keyword');
      addEdge({ from: me, to: 'keyword:all-tribes', kind: 'changes-target-pool', note: 'universalTribe — every tribe predicate must include it (the #c8a214d7 class)' });
    }
  }

  const nodeList = [...nodes.entries()].map(([id, kind]) => ({ id, kind }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const edgeKey = (e: InteractionEdge): string => `${e.from}|${e.to}|${e.kind}|${e.channel ?? ''}|${e.note ?? ''}`;
  const dedup = new Map(edges.map((e) => [edgeKey(e), e]));
  const edgeList = [...dedup.values()].sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : 1));
  return { nodes: nodeList, edges: edgeList };
}

// ── Structural validation (the sabotage surface: a doctored edge must fail HERE) ─────────────────────────

const EDGE_KINDS: ReadonlySet<InteractionEdgeKind> = new Set([
  'produces', 'consumes', 'multiplies', 'copies', 'suppresses', 'replaces',
  'changes-target-pool', 'shares-counter', 'changes-category', 'moves-zones', 'has',
]);

/** Every edge endpoint must exist as a node, every kind must be in the §10.2-derived vocabulary, and every
 *  produces/consumes edge must name its channel and point at (or from) a channel node. Empty = valid. */
export function graphErrors(g: InteractionGraph): string[] {
  const errors: string[] = [];
  const ids = new Set(g.nodes.map((n) => n.id));
  const kinds = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const seen = new Set<string>();
  for (const n of g.nodes) {
    if (seen.has(n.id)) errors.push(`duplicate node '${n.id}'`);
    seen.add(n.id);
  }
  for (const e of g.edges) {
    if (!ids.has(e.from)) errors.push(`edge ${e.kind} from unknown node '${e.from}'`);
    if (!ids.has(e.to)) errors.push(`edge ${e.kind} to unknown node '${e.to}'`);
    if (!EDGE_KINDS.has(e.kind)) errors.push(`edge kind '${e.kind}' outside the §10.2 vocabulary`);
    if (e.kind === 'produces') {
      if (!e.channel) errors.push(`produces edge ${e.from}→${e.to} names no channel`);
      if (kinds.get(e.to) !== 'channel') errors.push(`produces edge ${e.from}→${e.to} must target a channel node`);
    }
    if (e.kind === 'consumes') {
      if (!e.channel) errors.push(`consumes edge ${e.from}→${e.to} names no channel`);
      if (kinds.get(e.from) !== 'channel') errors.push(`consumes edge ${e.from}→${e.to} must originate at a channel node`);
    }
  }
  return errors;
}

// ── The applicability engine (§10.3's precondition: candidates ONLY where a shared channel exists) ───────

export interface CandidatePair {
  a: string; // producer contentId
  b: string; // consumer contentId
  channel: string;
}

export interface CandidateReport {
  /** The naive all-pairs product this engine replaces: C(contentCount, 2). */
  naivePairs: number;
  /** Distinct producer→channel→consumer pairs (a ≠ b). */
  candidatePairs: number;
  perChannel: Record<string, { producers: number; consumers: number; pairs: number }>;
  /** Trigger events with no channel mapping — the visible to-do list (§4.3), never a silent drop. */
  unmappedTriggers: string[];
}

/** Enumerate candidate pairs through the channel join. Deterministic (sorted). The report carries the
 *  naive-vs-candidate comparison the WP F brief demands. */
export function candidatePairs(
  g: InteractionGraph,
  contracts: readonly ContentContract[],
): { pairs: CandidatePair[]; report: CandidateReport } {
  const producersBy = new Map<string, string[]>();
  const consumersBy = new Map<string, string[]>();
  for (const e of g.edges) {
    if (e.kind === 'produces' && e.channel) {
      const id = e.from.replace(/^content:/, '');
      (producersBy.get(e.channel) ?? producersBy.set(e.channel, []).get(e.channel)!).push(id);
    }
    if (e.kind === 'consumes' && e.channel) {
      const id = e.to.replace(/^content:/, '');
      (consumersBy.get(e.channel) ?? consumersBy.set(e.channel, []).get(e.channel)!).push(id);
    }
  }
  const pairs: CandidatePair[] = [];
  const perChannel: CandidateReport['perChannel'] = {};
  const seen = new Set<string>();
  for (const channel of [...new Set([...producersBy.keys(), ...consumersBy.keys()])].sort()) {
    const producers = [...new Set(producersBy.get(channel) ?? [])].sort();
    const consumers = [...new Set(consumersBy.get(channel) ?? [])].sort();
    let n = 0;
    for (const a of producers) {
      for (const b of consumers) {
        if (a === b) continue;
        const key = `${a}|${b}|${channel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ a, b, channel });
        n++;
      }
    }
    perChannel[channel] = { producers: producers.length, consumers: consumers.length, pairs: n };
  }

  const contentCount = contracts.length;
  const unmapped = new Set<string>();
  for (const c of contracts) {
    for (const t of c.triggers ?? []) {
      const event = t.event.startsWith('objective:') ? t.event.slice('objective:'.length) : t.event;
      if (!PHASE_TRIGGERS.has(event) && !CHANNEL_OF_TRIGGER[event]) unmapped.add(t.event);
    }
  }
  return {
    pairs,
    report: {
      naivePairs: (contentCount * (contentCount - 1)) / 2,
      candidatePairs: pairs.length,
      perChannel,
      unmappedTriggers: [...unmapped].sort(),
    },
  };
}

/** Graph size + honesty stats for the report line. */
export function graphStats(g: InteractionGraph): {
  nodes: number; edges: number;
  nodesByKind: Record<string, number>; edgesByKind: Record<string, number>;
} {
  const nodesByKind: Record<string, number> = {};
  for (const n of g.nodes) nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1;
  const edgesByKind: Record<string, number> = { suppresses: 0, replaces: 0 };
  for (const e of g.edges) edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1;
  return { nodes: g.nodes.length, edges: g.edges.length, nodesByKind, edgesByKind };
}
