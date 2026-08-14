/**
 * BEAT CHOREOGRAPHER PR 20 — the Combat tab: a real fight on the shared timeline, READ-ONLY.
 *
 * PR 16 publishes every resolved fight as a `CompiledTimeline` (`latestCombatTimeline`); this makes it visible.
 * READ-ONLY here by design: combat EDITING lives in the LIBRARY (its rows tune the fight when
 * `ascent.combatbeats` is on). This view is the inspector — see the fight on the shared timeline, and which
 * rows are keyed/tunable — not a second editor.
 *
 * Keyed rows (a `policyKey` badge) carry a real registry identity — quest/rune combat triggers AND the
 * minion combat class (PR 23) — so they are the rows the Library can tune once `ascent.combatbeats` is on.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../store';
import { fitScale, msToPx, rulerTicks } from './timelineMath';
import { combatBeatsEnabled } from '../choreographer/combatHolds';
import type { CompiledBeat } from '../choreographer/timelineTypes';

const LANE_TINT: Record<string, string> = { source: '#7fd18a', reaction: '#8ab6e0' };

/** Moment kinds → the owner's words. Unmapped kinds fall through as-is (honest beats pretty). */
const KIND_LABEL: Record<string, string> = {
  attackExchange: 'attack', damage: 'damage', shieldPop: 'shield break', shieldGain: 'shield',
  poisonTick: 'poison', venomSpent: 'venom', death: 'death', riseDeath: 'rise',
  scCast: 'start of combat', scNarrate: 'start of combat', summon: 'summon', buffWave: 'buff wave',
  reborn: 'reborn', ascend: 'ascend', rally: 'rally', toHand: 'to hand', maxGold: 'max gold',
  improve: 'improve', keyword: 'keyword', keywordLost: 'keyword lost', hpGrant: 'health',
  spellProgress: 'spell', reveal: 'reveal', tribeAura: 'aura', questTrigger: 'trigger', questComplete: 'quest complete',
};

/**
 * The track fills whatever width the (resizable) window gives it — a fixed 640px inside a stretched window
 * left a diagonal squeezed into the corner (owner report 2026-08-13, "resizing the window seems to kinda bug
 * out the sizing of the combat view").
 */
function useTrackWidth(): { hostRef: React.RefObject<HTMLDivElement>; trackW: number } {
  const hostRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(640);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // label column (280) + gaps; floor keeps a legible track in a tiny window.
      setTrackW(Math.max(320, Math.round(el.clientWidth - 310)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { hostRef, trackW };
}

function BeatRow({ b, pxPerMs, trackW }: { b: CompiledBeat; pxPerMs: number; trackW: number }): React.ReactElement {
  const left = msToPx(b.startMs, pxPerMs);
  const width = Math.max(2, msToPx(b.completionMs - b.startMs, pxPerMs));
  const deliveryX = msToPx(b.deliveryMs - b.startMs, pxPerMs);
  return (
    <div className="bl-cbt-row">
      <span className="bl-cbt-label" title={`${b.source.label ?? b.source.id} · ${b.trigger} · ${Math.round(b.startMs)}–${Math.round(b.completionMs)}ms`}>
        {/* An aggregate moment (a buff wave with no single owner) has no name of its own — its id IS the
            kind, and printing both read as a stutter ("buffWave buff wave"). Show the kind once. */}
        <span className="bl-cbt-name">{b.lane === 'reaction' ? '↳ ' : ''}{(b.source.label ?? b.source.id) === b.trigger ? '—' : b.source.label ?? b.source.id}</span>
        <span className="bl-kind">{KIND_LABEL[b.trigger] ?? b.trigger}</span>
        {b.policyKey && <span className="bl-cover" style={{ background: '#e0b34d' }} title={`${b.policyKey}
Keyed — tunable in the Library when ascent.combatbeats is on.`}>keyed</span>}
      </span>
      <div className="bl-cbt-track" style={{ width: trackW }}>
        <div
          className="bl-cbt-bar"
          style={{ left, width, background: LANE_TINT[b.lane] ?? '#888', opacity: b.lane === 'reaction' ? 0.7 : 0.9 }}
          title={`${b.source.label ?? b.source.id} · ${b.trigger}\nstart ${Math.round(b.startMs)}ms · delivery ${Math.round(b.deliveryMs)}ms · completion ${Math.round(b.completionMs)}ms`}
        >
          <i className="bl-cbt-delivery" style={{ left: deliveryX }} />
        </div>
      </div>
    </div>
  );
}

export function CombatTimelineView(): React.ReactElement {
  const timeline = useGame((s) => s.latestCombatTimeline);
  const { hostRef, trackW } = useTrackWidth();
  const pxPerMs = useMemo(() => fitScale(timeline?.durationMs ?? 0, trackW), [timeline, trackW]);
  const ticks = useMemo(() => rulerTicks(timeline?.durationMs ?? 0), [timeline]);

  if (!timeline) {
    return (
      <div className="bl-body">
        <div className="bl-empty">
          No fight captured yet — finish a combat and reopen this tab. Every resolved fight is adapted onto the
          same timeline vocabulary End of Turn uses (same compiler, same anchors), so the two phases read side
          by side.
        </div>
      </div>
    );
  }

  const keyed = timeline.beats.filter((b) => b.policyKey).length;
  return (
    <div className="bl-body" ref={hostRef}>
      <div className="bl-empty-banner" style={combatBeatsEnabled() ? { borderColor: '#4a6a4a', color: '#c4e0c4', background: 'rgba(74,106,74,0.12)' } : undefined}>
        {combatBeatsEnabled() ? (
          <>
            <b>LIVE — keyed rows pace real fights.</b> This is the last fight ({timeline.beats.length} beats ·{' '}
            {Math.round(timeline.durationMs)}ms · {keyed} keyed). <code>ascent.combatbeats</code> is on, so any row
            marked <span className="bl-cover" style={{ background: '#e0b34d', margin: '0 4px' }}>keyed</span>
            takes its hold from the Library — tune it there (with the LIVE draft, or committed) and the fight re-paces.
          </>
        ) : (
          <>
            <b>READ-ONLY display — the fight runs on its own runtime.</b> This is the last fight
            ({timeline.beats.length} beats · {Math.round(timeline.durationMs)}ms · {keyed} keyed). Rows marked
            <span className="bl-cover" style={{ background: '#e0b34d', margin: '0 4px' }}>keyed</span>
            are tunable one switch away: set <code>localStorage.ascent.combatbeats = '1'</code>, and their Library
            edits pace real fights. Everything else keeps its native combat scheduling.
          </>
        )}
      </div>
      <div className="bl-cbt-ruler" style={{ width: trackW, marginLeft: 290 }}>
        {ticks.map((t) => <span key={t} className="bl-tl-tick" style={{ left: msToPx(t, pxPerMs) }}>{t}</span>)}
      </div>
      {timeline.beats.map((b) => <BeatRow key={b.id} b={b} pxPerMs={pxPerMs} trackW={trackW} />)}
    </div>
  );
}
