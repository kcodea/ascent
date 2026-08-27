import { useMemo, useState } from 'react';
import { SETS } from '@game/content';
import { HEROES } from '@game/sim';
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

function BugScenarioPanelInner() {
  const scenario = useGame((s) => s.bugScenario);
  const [collapsed, setCollapsed] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('bugscenario');

  const capsule = scenario?.capsule;
  const eventLines = useMemo(
    () => (capsule?.combat ? combatEventLines(capsule.combat.result) : []),
    [capsule],
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
        </div>
      )}
    </div>
  );
}
