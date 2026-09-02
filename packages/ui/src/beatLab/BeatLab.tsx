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
import { labSchedule, activeBeatIndex } from './labSchedule';
import { mergeOverrides, SHIPPED_OVERRIDES, SHIPPED_POLICY_OVERRIDES, type BeatTimingOverrides, type BeatPolicyOverrides } from './beatTiming';
import { BeatLibrary } from './BeatLibrary';
import { CombatTimelineView } from './CombatTimelineView';
import { migrateV1Patch } from '../choreographer/resolveTiming';
import beatDefaults from './beat-defaults.json';
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
    case 'echoFired': return `echo fires ${c.cardId} @ ${t}`;
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
export function BatchPlayer({ batch, overrides, policyOverrides = {}, resetKey, onSelectTrigger, selectedId }: {
  batch: PresentationBatch;
  overrides: BeatTimingOverrides;
  policyOverrides?: BeatPolicyOverrides;
  /** Changing this rewinds the playhead (a new capture arrived / a different fixture selected). */
  resetKey: string | number;
  onSelectTrigger?: (t: SourceTriggerEvent) => void;
  selectedId?: string | null;
}): React.ReactElement {
  // ONE ENGINE (PR 18): the preview schedules through the SAME compiler + committed config live playback
  // uses, so what the Lab shows is what the game plays — nesting, staggers and family templates included.
  const schedule = useMemo(
    () => labSchedule(batch, overrides, policyOverrides),
    [batch, overrides, policyOverrides],
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
  // Per-consequence landing times come straight from the compiled deliveries — STAGGERED, so a multi-target
  // wave lands one by one in the tree exactly as it does on the board.
  const consequenceMsById = schedule.consequenceAtMs;
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


/**
 * CHOREOGRAPHER PR 12 — write the config in the format the GAME reads.
 *
 * The Lab authors in v1 terms (windup / hold / recovery) because that is what its editor exposes, but the
 * live compiler reads v2 (delivery / completion + modes) and `beat-defaults.json` is a v2 file. Committing v1
 * would have replaced that file wholesale, silently discarding any `templates` a v2 author had added — the
 * tool quietly destroying work it cannot see. Converting on write keeps one format on disk.
 *
 * The mapping is the documented lossless one: delivery = windup, completion = windup + hold.
 */
/** Whatever `templates` the committed file already carries — preserved across a Lab write. */
const SHIPPED_TEMPLATES: Record<string, unknown> = (beatDefaults as { templates?: Record<string, unknown> }).templates ?? {};

function toV2File(
  timings: Record<string, { windupMs?: number; holdMs?: number; recoveryMs?: number }>,
  policies: Record<string, string>,
): { version: 2; templates: Record<string, unknown>; overrides: Record<string, unknown>; policies: Record<string, string> } {
  const overrides: Record<string, unknown> = {};
  for (const [key, patch] of Object.entries(timings)) overrides[key] = migrateV1Patch(patch);
  return {
    version: 2,
    // Templates are not editable from this surface yet, so anything already committed is PRESERVED verbatim
    // rather than dropped on the floor by a write that only knows about overrides.
    templates: SHIPPED_TEMPLATES,
    overrides,
    policies,
  };
}

/**
 * Window-chrome prefs (position / size / text size) — PURE UI preferences, so unlike timing drafts they are
 * fine to persist in localStorage: they say how the owner likes the window, not how the game should pace.
 * Owner report 2026-08-13: the fixed full-screen inset forced closing the Lab to play at all.
 */
interface LabUiPrefs { left: number; top: number; width: number; height: number; fontPx: number }
const UI_PREFS_KEY = 'ascent.beatlab.ui';
function loadUiPrefs(): LabUiPrefs {
  const fallback: LabUiPrefs = {
    left: Math.round(window.innerWidth * 0.06),
    top: Math.round(window.innerHeight * 0.06),
    width: Math.round(window.innerWidth * 0.88),
    height: Math.round(window.innerHeight * 0.88),
    fontPx: 12,
  };
  try {
    const raw = JSON.parse(localStorage.getItem(UI_PREFS_KEY) ?? '') as Partial<LabUiPrefs>;
    const p = { ...fallback, ...raw };
    // Clamp into the current viewport — a saved position from a bigger monitor must not strand the window
    // (and its close button) off-screen.
    p.width = Math.min(Math.max(520, p.width), window.innerWidth - 16);
    p.height = Math.min(Math.max(320, p.height), window.innerHeight - 16);
    p.left = Math.min(Math.max(0, p.left), window.innerWidth - 120);
    p.top = Math.min(Math.max(0, p.top), window.innerHeight - 60);
    p.fontPx = Math.min(18, Math.max(10, p.fontPx));
    return p;
  } catch { return fallback; }
}
const saveUiPrefs = (p: LabUiPrefs): void => { try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ } };

export function BeatLab({ onClose }: { onClose: () => void }): React.ReactElement {
  // ── window chrome: drag the topbar to move, native CSS handle (bottom-right) to resize, slider for text ──
  const [ui, setUi] = useState<LabUiPrefs>(loadUiPrefs);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => saveUiPrefs(ui), [ui]);
  // Native `resize: both` changes the element without telling React — observe it so the size persists.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setUi((u) => (Math.abs(r.width - u.width) > 1 || Math.abs(r.height - u.height) > 1 ? { ...u, width: Math.round(r.width), height: Math.round(r.height) } : u));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const onBarPointerDown = (e: React.PointerEvent): void => {
    // Buttons/inputs on the bar keep their own behavior; empty bar space is the move handle.
    if ((e.target as Element).closest('button, input, select')) return;
    dragRef.current = { dx: e.clientX - ui.left, dy: e.clientY - ui.top };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onBarPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current;
    if (!d) return;
    setUi((u) => ({
      ...u,
      left: Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - 120),
      top: Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - 40),
    }));
  };
  const onBarPointerUp = (): void => { dragRef.current = null; };

  const batch = useGame((s) => s.latestBatch);
  const revision = useGame((s) => s.beatRevision);
  const beatDraftLive = useGame((s) => s.beatDraftLive);
  const setBeatDraft = useGame((s) => s.setBeatDraft);
  const setBeatDraftLive = useGame((s) => s.setBeatDraftLive);
  const [mode, setMode] = useState<'capture' | 'library' | 'combat'>('capture');
  // The session DRAFT: sparse timing overrides, edited from either mode, pacing all Beat Lab playback.
  // Session-only (a reload starts from shipped timings — blueprint §17.2), but it SURVIVES closing and
  // reopening the Lab: the store's published copy is the source on mount. Owner report 2026-08-13 — the
  // workflow is tune → close → play, and a fresh empty Lab was silently clobbering the published draft.
  const [draft, setDraft] = useState<BeatTimingOverrides>(() => (useGame.getState().beatDraft?.timings as BeatTimingOverrides) ?? {});
  // Parallel policy draft (the folded↔own toggle) — same lifecycle as timing.
  const [policyDraft, setPolicyDraft] = useState<BeatPolicyOverrides>(() => (useGame.getState().beatDraft?.policies as BeatPolicyOverrides) ?? {});
  const draftCount = Object.keys(draft).length + Object.keys(policyDraft).length;

  // CHOREOGRAPHER PR 19 — publish the draft for LIVE playback (blueprint §15). Always published (it is
  // ephemeral store state, not a save), but the game only READS it when the owner flips the Live toggle —
  // and a persistent banner marks every End Turn it paces. Deliberately kept when the Lab closes, so the
  // workflow is: tune → close the Lab → play the real turn → judge.
  useEffect(() => {
    setBeatDraft(draftCount > 0 ? { timings: draft, policies: policyDraft } : null);
  }, [draft, policyDraft, draftCount, setBeatDraft]);

  const copyDraft = (): void => { void navigator.clipboard?.writeText(JSON.stringify(toV2File(draft, policyDraft), null, 2)); };

  // Commit the draft to the git-tracked beat-defaults.json (DEV endpoint). Folds the draft OVER the existing
  // committed defaults (field-level), so committing accumulates rather than replacing. On success the static
  // import + HMR reloads the new baseline; the session draft is cleared (now baked into SHIPPED_OVERRIDES).
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const commitDraft = async (): Promise<void> => {
    const merged = mergeOverrides(SHIPPED_OVERRIDES, draft);
    const mergedPolicies = { ...SHIPPED_POLICY_OVERRIDES, ...policyDraft };
    try {
      const res = await fetch('/__beat-lab/defaults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: JSON.stringify(toV2File(merged, mergedPolicies)) }),
      });
      const out = await res.json() as { ok: boolean; path?: string; error?: string };
      setCommitMsg(out.ok ? `committed → ${out.path}` : `commit failed: ${out.error}`);
      if (out.ok) { setDraft({}); setPolicyDraft({}); }
    } catch (e) {
      setCommitMsg(`commit failed: ${(e as Error).message}`);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="bl-overlay"
      role="dialog"
      aria-label="Beat Lab"
      style={{ left: ui.left, top: ui.top, width: ui.width, height: ui.height, fontSize: ui.fontPx }}
    >
      <div
        className="bl-topbar bl-draggable"
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        title="Drag to move · resize from the bottom-right corner"
      >
        <span className="bl-title">Beat Lab</span>
        <button className={`bl-tab${mode === 'capture' ? ' bl-tab-on' : ''}`} onClick={() => setMode('capture')}>Capture</button>
        <button className={`bl-tab${mode === 'library' ? ' bl-tab-on' : ''}`} onClick={() => setMode('library')}>Library</button>
        <button className={`bl-tab${mode === 'combat' ? ' bl-tab-on' : ''}`} onClick={() => setMode('combat')} title="The last resolved fight on the shared timeline (read-only)">Combat</button>
        {draftCount > 0 && <span className="bl-draft">draft: {draftCount} key{draftCount === 1 ? '' : 's'}</span>}
        <button
          className={`bl-tab${beatDraftLive ? ' bl-tab-on' : ''}`}
          style={beatDraftLive ? { borderColor: '#e0b34d', color: '#e0b34d' } : undefined}
          onClick={() => setBeatDraftLive(!beatDraftLive)}
          title="Pace the REAL game with this draft (uncommitted). A banner shows while it is on; committed values are unaffected."
        >
          {beatDraftLive ? '● LIVE' : 'Live'}
        </button>
        {draftCount > 0 && <button className="bl-tbtn" onClick={copyDraft} title="Copy the sparse timing overrides as JSON">Copy JSON</button>}
        {draftCount > 0 && <button className="bl-tbtn" onClick={() => void commitDraft()} title="Write the overrides to beat-defaults.json (dev only)">Commit to repo</button>}
        {draftCount > 0 && <button className="bl-tbtn" onClick={() => { setDraft({}); setPolicyDraft({}); }} title="Discard every draft override">Reset all</button>}
        {commitMsg && <span className="bl-prov">{commitMsg}</span>}
        <span className="bl-meta">
          {mode === 'capture'
            ? batch ? `${batch.actionId} · ${batch.events.length} events · rev ${revision}` : 'no batch captured yet'
            : mode === 'library' ? 'every registered beat — no playing required'
            : 'the last resolved fight, read-only'}
        </span>
        <label className="bl-fontslider" title={`Text size: ${ui.fontPx}px`}>
          <span>A</span>
          <input type="range" min={10} max={18} step={1} value={ui.fontPx} onChange={(e) => setUi((u) => ({ ...u, fontPx: Number(e.target.value) }))} />
          <span style={{ fontSize: 15 }}>A</span>
        </label>
        <button className="bl-close" onClick={onClose} aria-label="Close Beat Lab">✕</button>
      </div>
      {mode === 'capture' && (
        batch
          ? <BatchPlayer batch={batch} overrides={draft} policyOverrides={policyDraft} resetKey={revision} />
          : <div className="bl-body"><div className="bl-empty">
              Play a card, cast a spell, use a hero power, or end a turn to capture that action's beats. Every
              class of automatic effect emits source-attributed events now — End of Turn, Shouts, casts,
              quest/rune rewards, Start of Combat, hero powers, and the whole minion combat class. Use the
              <b> Library</b> tab to browse and tune any of them without playing, or <b>Combat</b> to inspect
              the last fight.
            </div></div>
      )}
      {mode === 'library' && <BeatLibrary draft={draft} setDraft={setDraft} policyDraft={policyDraft} setPolicyDraft={setPolicyDraft} />}
      {mode === 'combat' && <CombatTimelineView />}
    </div>
  );
}
