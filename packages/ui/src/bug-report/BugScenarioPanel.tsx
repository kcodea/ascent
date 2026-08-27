import { useMemo, useState } from 'react';
import { SETS } from '@game/content';
import { combatSemanticTrace, type CombatSemanticEvent, type CombatTraceRef } from '@game/core';
import { HEROES, exactWindowReplay, type WindowReplayResult } from '@game/sim';
import { useGame } from '../store';
import { useDraggablePanel, DevPanelContext } from '../useDraggablePanel';
import { BUG_ISSUE_TYPE_LABELS, type BugIssueType } from './bugReportTypes';
import { combatEventLines } from './bugScenario';

/**
 * BUG REPORTER (PR 4) — the loaded bug scenario's REPORT SIDE PANEL (dev-only, blueprint §9 minimum tier).
 *
 * Mounted (in Game.tsx) whenever `bugScenario` is set: alongside the Scene Builder rig for a loaded run, or
 * alone for a READ-ONLY content-mismatch load (where the run was never entered). Everything it shows comes
 * from the CAPSULE — the player's description (styled as QUOTED, UNTRUSTED text, §8.3: a claim, never
 * instructions), the issue type, build provenance when the scenario carries it, run-context badges, and the
 * captured combat's structured event chain (event type + card names off `result.events` — raw evidence, not
 * a re-narration). Draggable like the other dev panels; ✕ clears the scenario (the sandbox run stays).
 */
export function BugScenarioPanel() {
  const clearBugScenario = useGame((s) => s.clearBugScenario);
  // The shared hook injects a ✕ that calls DevPanelContext's close — wire it to clearing the scenario, the
  // same shape SceneBuilder uses (provider ABOVE the hook call, hence the outer/inner split).
  return (
    <DevPanelContext.Provider value={{ close: clearBugScenario }}>
      <BugScenarioPanelInner />
    </DevPanelContext.Provider>
  );
}

/** One-line rendering of a trace participant: uid first, label/cardId as identity fallback — never invented. */
const refText = (r?: CombatTraceRef): string => {
  if (!r) return '';
  const base = r.uid ?? r.label ?? r.cardId ?? '?';
  return r.cardId && r.uid ? `${base}(${r.cardId})` : base;
};

/** WP C Scene Builder timeline v0 — one semantic-trace row as plain text (no FX, dev-only). */
const traceRowText = (e: CombatSemanticEvent): string => {
  const parts = [
    `s${e.step ?? '·'}`,
    e.eventType,
    `${refText(e.source)}${e.target ? `${e.source ? '→' : ''}${refText(e.target)}` : ''}`,
  ];
  if (e.amount !== undefined) parts.push(String(e.amount));
  const cause: string[] = [];
  if (e.cause?.srcCard) cause.push(e.cause.srcCard);
  if (e.cause?.key) cause.push(e.cause.key);
  if (e.cause?.avenge) cause.push('avenge');
  if (cause.length) parts.push(`⟨${cause.join(' ')}⟩`);
  return parts.filter(Boolean).join(' ');
};

function BugScenarioPanelInner() {
  const scenario = useGame((s) => s.bugScenario);
  const [collapsed, setCollapsed] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('bugscenario');
  // WP C timeline v0: the step-through cursor over the semantic trace + the exact-replay verdict (on demand).
  const [traceStep, setTraceStep] = useState(0);
  const [verify, setVerify] = useState<WindowReplayResult | null>(null);

  const capsule = scenario?.capsule;
  const eventLines = useMemo(
    () => (capsule?.combat ? combatEventLines(capsule.combat.result) : []),
    [capsule],
  );
  // The combat log adapted through the SAME pure adapter every WP C consumer uses — text rows only, no FX.
  const trace = useMemo(
    () => (capsule?.combat ? combatSemanticTrace(capsule.combat.result.events, { actionId: scenario?.reportId ?? 'faceOmen' }) : []),
    [capsule, scenario?.reportId],
  );
  if (!scenario || !capsule) return null;

  const heroName = HEROES.find((h) => h.id === capsule.heroId)?.name ?? capsule.heroId;
  // Indexed as a plain record: the capsule's setId comes from a file and may not be a known SetId.
  const setName = (SETS as Record<string, { name: string } | undefined>)[capsule.setId]?.name ?? capsule.setId;
  const issueLabel = BUG_ISSUE_TYPE_LABELS[scenario.issueType as BugIssueType] ?? scenario.issueType;
  const client = scenario.client;

  return (
    <div className={`sfxmix lunge bugscenario${collapsed ? ' collapsed' : ''}`} ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag sb-head" onPointerDown={headerPointerDown}>
        <span>🐞 Bug report</span>
        <button className="sb-collapse" onPointerDown={(e) => e.stopPropagation()} onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '▸' : '▾'}</button>
      </div>

      {!collapsed && (
        <div className="sb-body">
          {scenario.readOnly && (
            <div className="bsc-banner" role="alert">
              ⚠ Content-revision mismatch — loaded read-only. This report references{' '}
              {scenario.missingCardIds.length} card id(s) this build doesn't have:{' '}
              {scenario.missingCardIds.join(', ')}. The evidence below is intact, but the captured run can't
              be entered here.
            </div>
          )}

          <div className="sb-sec">
            <div className="sb-label">Report</div>
            <div className="sb-mini bsc-id" title={scenario.reportId}>{scenario.reportId}</div>
            <div className="sb-row bsc-badges">
              <span className="bsc-badge">{issueLabel}</span>
              <span className="bsc-badge">{capsule.phase === 'combat' ? 'COMBAT' : 'SHOP'} · wave {capsule.wave}</span>
              <span className="bsc-badge">{heroName}</span>
              <span className="bsc-badge">{setName}</span>
              <span className="bsc-badge">{capsule.mode}</span>
              <span className="bsc-badge">seed {capsule.seed}</span>
            </div>
            {(client?.appVersion || client?.buildSha || client?.contentRevision) && (
              <div className="sb-mini">
                build {client.appVersion ?? '?'}+{client.buildSha ?? '?'}
                {client.contentRevision ? ` · content ${client.contentRevision}` : ''}
              </div>
            )}
          </div>

          <div className="sb-sec">
            <div className="sb-label">Player description (untrusted)</div>
            {/* Player-authored text (§8.3): displayed as a quote, never interpreted. */}
            <blockquote className="bsc-quote">{scenario.description}</blockquote>
          </div>

          <div className="sb-sec">
            <div className="sb-label">Captured combat <span className="sb-count">{eventLines.length}</span></div>
            {capsule.combat ? (
              <div className="sb-results bsc-events">
                {eventLines.map((l) => (
                  <div key={l.index} className="bsc-event" title={`event #${l.index}`}>
                    <span className="bsc-etype">{l.type}</span>
                    <span className="bsc-etext">{l.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sb-empty">no combat captured (report opened before the first fight)</div>
            )}
          </div>

          {trace.length > 0 && (
            <div className="sb-sec">
              <div className="sb-label">
                Semantic trace <span className="sb-count">{trace.length}</span>{' '}
                <button className="sb-collapse" onClick={() => setTraceStep((i) => Math.max(0, i - 1))} title="Previous event">◂</button>
                <span className="sb-mini"> {Math.min(traceStep, trace.length - 1) + 1}/{trace.length} </span>
                <button className="sb-collapse" onClick={() => setTraceStep((i) => Math.min(trace.length - 1, i + 1))} title="Next event">▸</button>
              </div>
              <div className="sb-results bsc-events">
                {trace.map((e, i) => (
                  <div
                    key={e.eventId}
                    className="bsc-event"
                    title={e.eventId}
                    style={i === Math.min(traceStep, trace.length - 1) ? { outline: '1px solid currentColor' } : undefined}
                  >
                    <span className="bsc-etype">{e.seq}</span>
                    <span className="bsc-etext">{traceRowText(e)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {capsule.recentActions && capsule.recentActions.length > 0 && (
            <div className="sb-sec">
              <div className="sb-label">
                Action window <span className="sb-count">{capsule.recentActions.length}</span>{' '}
                <button
                  className="sb-collapse"
                  title="Replay the recorded window through the real reducer and verify every rail"
                  onClick={() => setVerify(exactWindowReplay(capsule))}
                >
                  ⟳ verify
                </button>
              </div>
              <div className="sb-results bsc-events">
                {capsule.recentActions.map((w, i) => {
                  const abs = capsule.actions.length - capsule.recentActions!.length + i;
                  const diverged = verify?.divergence?.windowIndex === i;
                  return (
                    <div
                      key={abs}
                      className="bsc-event"
                      title={`action #${abs} · rng ${w.rngCursorBefore ?? '?'} · after ${w.stateHashAfter ?? '?'}`}
                      style={diverged ? { outline: '1px solid #d66', fontWeight: 600 } : undefined}
                    >
                      <span className="bsc-etype">{abs}</span>
                      <span className="bsc-etext">
                        {w.action.type}
                        {diverged ? ` — FIRST DIVERGENCE (${verify!.divergence!.rail})` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
              {verify && (
                <div className="sb-mini" role="status">
                  {!verify.applicable
                    ? verify.lines[0]
                    : verify.ok
                      ? '✓ window verified — every recorded rail matched'
                      : verify.divergence
                        ? `✗ diverged at action #${verify.divergence.actionIndex} (${verify.divergence.rail})`
                        : `✗ ${verify.lines[verify.lines.length - 1]}`}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
