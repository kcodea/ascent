/**
 * BEAT SYSTEM PR 4 — the READ-ONLY Beat Lab viewer.
 *
 * "Start with truth, not tooling" (blueprint §30): before any timing editor exists, this shows the exact
 * source-attributed batch the recruit reducer emitted for the last action — the trigger/consequence tree with
 * real source ids, resolution steps, policies, and parent nesting. If this reads correctly, the event stream
 * is trustworthy and the editor (later PRs) becomes straightforward; if it doesn't, we fix the stream first.
 *
 * Dev-only: mounted behind `import.meta.env.DEV` by the Dev Menu, and it only ever READS `latestBatch` from the
 * store (published by `dispatch` in DEV — PR 3). No editing, no persistence, no gameplay effect.
 */
import { useMemo } from 'react';
import type { ConsequenceEvent, GamePresentationEvent, PresentationBatch, SourceTriggerEvent } from '@game/core';
import { useGame } from '../store';
import './beatLab.css';

const isTrigger = (e: GamePresentationEvent): e is SourceTriggerEvent => e.type === 'sourceTrigger';

const POLICY_TINT: Record<string, string> = {
  ownBeat: 'var(--bl-ownbeat)',
  foldedCue: 'var(--bl-folded)',
  passive: 'var(--bl-passive)',
  intentionallySilent: 'var(--bl-silent)',
};

/** A one-line human summary of a consequence, so the tree is readable without decoding the union. */
function describe(c: ConsequenceEvent): string {
  const t = 'target' in c && c.target ? `${c.target.zone}${c.target.uid ? `:${c.target.uid}` : ''}` : '';
  switch (c.type) {
    case 'statsChanged': return `stats ${c.attack >= 0 ? '+' : ''}${c.attack}/${c.health >= 0 ? '+' : ''}${c.health} → ${t}${c.channel && c.channel !== 'ordinary' ? ` (${c.channel})` : ''}`;
    case 'keywordChanged': return `${c.gained ? 'gain' : 'lose'} ${c.keyword} → ${t}`;
    case 'cardSummoned': return `summon ${c.cardId} → ${t}`;
    case 'cardDestroyed': return `destroy ${t}`;
    case 'cardTransformed': return `transform ${t} → ${c.toCardId}`;
    case 'cardGranted': return `grant ${c.cardId} → ${t}`;
    case 'spellResolved': return `spell ${c.cardId}${c.copied ? ' (copy)' : ''}`;
    case 'resourceChanged': return `${c.resource} ${c.amount >= 0 ? '+' : ''}${c.amount}${c.valueAfter !== undefined ? ` → ${c.valueAfter}` : ''}`;
    case 'shopChanged': return `shop ${c.change} ${t}`;
    case 'auraChanged': return `aura ${c.aura} ${c.amount >= 0 ? '+' : ''}${c.amount}`;
    case 'counterChanged': return `counter ${c.counter} ${c.amount >= 0 ? '+' : ''}${c.amount}`;
    case 'rubyPlayed': return `ruby ×${c.count} → ${t}`;
    default: return (c as { type: string }).type;
  }
}

interface Node { trigger: SourceTriggerEvent; consequences: ConsequenceEvent[]; children: Node[] }

/** Assemble the flat event list into a trigger tree (consequences + child triggers hang off their parentId). */
function buildTree(batch: PresentationBatch): { roots: Node[]; orphans: ConsequenceEvent[] } {
  const nodes = new Map<string, Node>();
  const roots: Node[] = [];
  const orphans: ConsequenceEvent[] = [];
  for (const e of batch.events) if (isTrigger(e)) nodes.set(e.id, { trigger: e, consequences: [], children: [] });
  for (const e of batch.events) {
    if (isTrigger(e)) {
      const parent = e.parentId ? nodes.get(e.parentId) : undefined;
      (parent ? parent.children : roots).push(nodes.get(e.id)!);
    } else {
      const parent = e.parentId ? nodes.get(e.parentId) : undefined;
      if (parent) parent.consequences.push(e);
      else orphans.push(e);
    }
  }
  return { roots, orphans };
}

function TriggerNode({ node, depth }: { node: Node; depth: number }): React.ReactElement {
  const t = node.trigger;
  return (
    <div className="bl-node" style={{ marginLeft: depth * 18 }}>
      <div className="bl-trigger">
        <span className="bl-step">step {t.step}</span>
        <span className="bl-policy" style={{ background: POLICY_TINT[t.policy] ?? '#666' }}>{t.policy}</span>
        <span className="bl-source">{t.source.label ?? t.source.id}</span>
        <span className="bl-kind">{t.source.kind}/{t.trigger}</span>
        {t.repeatCount ? <span className="bl-repeat">×{(t.repeatIndex ?? 0) + 1}/{t.repeatCount}</span> : null}
      </div>
      {node.consequences.map((c) => (
        <div key={c.id} className="bl-cons">↳ {describe(c)}</div>
      ))}
      {node.children.map((ch) => <TriggerNode key={ch.trigger.id} node={ch} depth={depth + 1} />)}
    </div>
  );
}

export function BeatLab({ onClose }: { onClose: () => void }): React.ReactElement {
  const batch = useGame((s) => s.latestBatch);
  const revision = useGame((s) => s.beatRevision);
  const tree = useMemo(() => (batch ? buildTree(batch) : null), [batch]);

  return (
    <div className="bl-overlay" role="dialog" aria-label="Beat Lab">
      <div className="bl-topbar">
        <span className="bl-title">Beat Lab</span>
        <span className="bl-mode">read-only viewer</span>
        <span className="bl-meta">
          {batch ? `${batch.actionId} · ${batch.events.length} events · rev ${revision}` : 'no batch captured yet'}
        </span>
        <button className="bl-close" onClick={onClose} aria-label="Close Beat Lab">✕</button>
      </div>
      <div className="bl-body">
        {!batch && (
          <div className="bl-empty">
            Play a Shout in the shop to capture a batch. (Only migrated triggers emit so far — PR 3 wired the
            <code> onPlay</code> Shout path; more triggers arrive in later PRs.)
          </div>
        )}
        {tree && (
          <>
            {tree.roots.length === 0 && <div className="bl-empty">This action produced no source-attributed triggers.</div>}
            {tree.roots.map((n) => <TriggerNode key={n.trigger.id} node={n} depth={0} />)}
            {tree.orphans.length > 0 && (
              <div className="bl-orphans">
                <div className="bl-orphan-h">unparented consequences ({tree.orphans.length})</div>
                {tree.orphans.map((c) => <div key={c.id} className="bl-cons">• {describe(c)}</div>)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
