/**
 * BEAT SYSTEM — the Beat Lab (dev-only).
 *
 * PR 4 built the read-only CAPTURE viewer ("start with truth, not tooling"): the source-attributed
 * trigger/consequence tree of the last action, straight from the store's `latestBatch`. PR 6 added the
 * transport (play/step a schedule with the active beat highlighted). PR 7 adds the LIBRARY + timing editor:
 * browse every registered automatic effect without playing a card, edit its timing numerically as a sparse
 * session DRAFT (never persisted, never auto-active — the old pacing-tuner failure), and watch the result on
 * a synthetic preview through the same scheduler/player the capture uses.
 *
 * Nothing here touches gameplay: the game's live playback does not consume these timings yet (that's the
 * cutover); drafts pace only Beat Lab playback. `Copy JSON` exports the sparse overrides for source control
 * when a set is worth shipping.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConsequenceEvent, GamePresentationEvent, PresentationBatch, SourceTriggerEvent } from '@game/core';
import { useGame } from '../store';
import { scheduleBeats, activeBeatIndex } from './beatTimeline';
import { resolveBeatTiming, mergeOverrides, SHIPPED_OVERRIDES, type BeatTimingOverrides } from './beatTiming';
import { BeatLibrary } from './BeatLibrary';
import './beatLab.css';

const isTrigger = (e: GamePresentationEvent): e is SourceTriggerEvent => e.type === 'sourceTrigger';

export const POLICY_TINT: Record<string, string> = {
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
    case 'auraChanged': return `aura ${c.aura} ${c.attack !== undefined ? `+${c.attack}/+${c.health}` : (c.amount >= 0 ? '+' : '') + c.amount}`;
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

function TriggerNode({ node, depth, activeId, onSelect, selectedId, landed }: { node: Node; depth: number; activeId: string | null; onSelect?: (t: SourceTriggerEvent) => void; selectedId?: string | null; landed: (id: string) => boolean }): React.ReactElement {
  const t = node.trigger;
  return (
    <div className="bl-node" style={{ marginLeft: depth * 18 }}>
      <div
        className={`bl-trigger${t.id === activeId ? ' bl-active' : ''}${t.id === selectedId ? ' bl-selected' : ''}${onSelect ? ' bl-clickable' : ''}`}
        onClick={onSelect ? () => onSelect(t) : undefined}
      >
        <span className="bl-step">step {t.step}</span>
        <span className="bl-policy" style={{ background: POLICY_TINT[t.policy] ?? '#666' }}>{t.policy}</span>
        <span className="bl-source">{t.source.label ?? t.source.id}</span>
        <span className="bl-kind">{t.source.kind}/{t.trigger}</span>
        {t.repeatCount ? <span className="bl-repeat">×{(t.repeatIndex ?? 0) + 1}/{t.repeatCount}</span> : null}
      </div>
      {node.consequences.map((c) => (
        <div key={c.id} className={`bl-cons${landed(c.id) ? ' bl-cons-landed' : ' bl-cons-pending'}`}>
          {landed(c.id) ? <>↳ {describe(c)}</> : <>⋯ <span className="bl-pending-tag">pending until this beat fires</span></>}
        </div>
      ))}
      {node.children.map((ch) => <TriggerNode key={ch.trigger.id} node={ch} depth={depth + 1} activeId={activeId} onSelect={onSelect} selectedId={selectedId} landed={landed} />)}
    </div>
  );
}

/**
 * The shared batch player: schedule (with the draft's timings) → transport → tree with the active beat
 * highlighted. Used by Capture mode (the store's latest batch) and Library mode (a synthetic fixture batch).
 */
export function BatchPlayer({ batch, overrides, resetKey, onSelectTrigger, selectedId }: {
  batch: PresentationBatch;
  overrides: BeatTimingOverrides;
  /** Changing this rewinds the playhead (a new capture arrived / a different fixture selected). */
  resetKey: string | number;
  onSelectTrigger?: (t: SourceTriggerEvent) => void;
  selectedId?: string | null;
}): React.ReactElement {
  const schedule = useMemo(
    () => scheduleBeats(batch, (t) => resolveBeatTiming(t, overrides)),
    [batch, overrides],
  );
  const tree = useMemo(() => buildTree(batch), [batch]);

  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => { setPlayheadMs(0); setPlaying(false); }, [resetKey]);

  useEffect(() => {
    if (!playing) return;
    const tick = (ts: number): void => {
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      if (last != null) {
        setPlayheadMs((ms) => {
          const nextMs = ms + (ts - last);
          if (nextMs >= schedule.totalMs) { setPlaying(false); return schedule.totalMs; }
          return nextMs;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastTsRef.current = null; };
  }, [playing, schedule]);

  const activeIdx = activeBeatIndex(schedule.beats, playing || playheadMs > 0 ? playheadMs : -1);
  const activeId = activeIdx >= 0 ? schedule.beats[activeIdx]!.id : null;
  const beatCount = schedule.beats.length;

  const stepTo = (i: number): void => {
    if (i < 0 || i >= schedule.beats.length) return;
    setPlaying(false);
    setPlayheadMs(schedule.beats[i]!.startMs);
  };

  // BUG FIX (owner report 2026-08-12): a consequence LANDS at its beat's consequence point (start + windup),
  // so the timing visibly gates when the buff "goes out" — it was showing statically before, which read as
  // "the beat timing does nothing." At rest (fresh, playhead 0, not playing) show the final state; once you
  // play or scrub, each consequence is withheld until its beat fires.
  const consequenceMsById = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of schedule.beats) for (const c of b.consequences) m.set(c.id, b.consequenceMs);
    return m;
  }, [schedule]);
  const atRest = !playing && playheadMs === 0;
  const landed = (id: string): boolean => atRest || playheadMs >= (consequenceMsById.get(id) ?? 0);

  return (
    <>
      {beatCount > 0 && (
        <div className="bl-transport">
          <button className="bl-tbtn" onClick={() => stepTo(activeIdx - 1)} disabled={activeIdx <= 0} aria-label="Previous beat">⏮</button>
          <button className="bl-tbtn" onClick={() => { if (playheadMs >= schedule.totalMs) setPlayheadMs(0); setPlaying((p) => !p); }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '⏸' : '▶'}</button>
          <button className="bl-tbtn" onClick={() => stepTo(activeIdx + 1)} disabled={activeIdx >= beatCount - 1} aria-label="Next beat">⏭</button>
          <button className="bl-tbtn" onClick={() => { setPlaying(false); setPlayheadMs(0); }} aria-label="Rewind">⏹</button>
          <span className="bl-time">beat {Math.max(0, activeIdx + 1)}/{beatCount} · {Math.round(playheadMs)}/{Math.round(schedule.totalMs)}ms</span>
        </div>
      )}
      <div className="bl-body">
        {tree.roots.length === 0 && <div className="bl-empty">This batch produced no source-attributed triggers.</div>}
        {tree.roots.map((n) => <TriggerNode key={n.trigger.id} node={n} depth={0} activeId={activeId} onSelect={onSelectTrigger} selectedId={selectedId} landed={landed} />)}
        {tree.orphans.length > 0 && (
          <div className="bl-orphans">
            <div className="bl-orphan-h">unparented consequences ({tree.orphans.length})</div>
            {tree.orphans.map((c) => <div key={c.id} className="bl-cons">• {describe(c)}</div>)}
          </div>
        )}
      </div>
    </>
  );
}

export function BeatLab({ onClose }: { onClose: () => void }): React.ReactElement {
  const batch = useGame((s) => s.latestBatch);
  const revision = useGame((s) => s.beatRevision);
  const [mode, setMode] = useState<'capture' | 'library'>('capture');
  // The session DRAFT: sparse timing overrides, edited from either mode, pacing all Beat Lab playback.
  // Deliberately NOT persisted — reopening the Lab starts from shipped timings (blueprint §17.2).
  const [draft, setDraft] = useState<BeatTimingOverrides>({});
  const draftCount = Object.keys(draft).length;

  const copyDraft = (): void => { void navigator.clipboard?.writeText(JSON.stringify({ version: 1, timings: draft }, null, 2)); };

  // Commit the draft to the git-tracked beat-defaults.json (DEV endpoint). Folds the draft OVER the existing
  // committed defaults (field-level), so committing accumulates rather than replacing. On success the static
  // import + HMR reloads the new baseline; the session draft is cleared (now baked into SHIPPED_OVERRIDES).
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const commitDraft = async (): Promise<void> => {
    const merged = mergeOverrides(SHIPPED_OVERRIDES, draft);
    try {
      const res = await fetch('/__beat-lab/defaults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: JSON.stringify({ version: 1, timings: merged }) }),
      });
      const out = await res.json() as { ok: boolean; path?: string; error?: string };
      setCommitMsg(out.ok ? `committed → ${out.path}` : `commit failed: ${out.error}`);
      if (out.ok) setDraft({});
    } catch (e) {
      setCommitMsg(`commit failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="bl-overlay" role="dialog" aria-label="Beat Lab">
      <div className="bl-topbar">
        <span className="bl-title">Beat Lab</span>
        <button className={`bl-tab${mode === 'capture' ? ' bl-tab-on' : ''}`} onClick={() => setMode('capture')}>Capture</button>
        <button className={`bl-tab${mode === 'library' ? ' bl-tab-on' : ''}`} onClick={() => setMode('library')}>Library</button>
        {draftCount > 0 && <span className="bl-draft">draft: {draftCount} key{draftCount === 1 ? '' : 's'}</span>}
        {draftCount > 0 && <button className="bl-tbtn" onClick={copyDraft} title="Copy the sparse timing overrides as JSON">Copy JSON</button>}
        {draftCount > 0 && <button className="bl-tbtn" onClick={() => void commitDraft()} title="Write the overrides to beat-defaults.json (dev only)">Commit to repo</button>}
        {draftCount > 0 && <button className="bl-tbtn" onClick={() => setDraft({})} title="Discard every draft override">Reset all</button>}
        {commitMsg && <span className="bl-prov">{commitMsg}</span>}
        <span className="bl-meta">
          {mode === 'capture'
            ? batch ? `${batch.actionId} · ${batch.events.length} events · rev ${revision}` : 'no batch captured yet'
            : 'every registered beat — no playing required'}
        </span>
        <button className="bl-close" onClick={onClose} aria-label="Close Beat Lab">✕</button>
      </div>
      {mode === 'capture' && (
        batch
          ? <BatchPlayer batch={batch} overrides={draft} resetKey={revision} />
          : <div className="bl-body"><div className="bl-empty">
              Play a Shout or end a turn to capture a batch. (Migrated triggers so far: Shouts and the full
              End-of-Turn pass — board effects, recurring rewards, Coffers/Shopkeep, rubies, grants, auras.)
            </div></div>
      )}
      {mode === 'library' && <BeatLibrary draft={draft} setDraft={setDraft} />}
    </div>
  );
}
