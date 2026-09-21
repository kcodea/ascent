import { useEffect, useState } from 'react';
import { useDraggablePanel } from '../useDraggablePanel';
import { PixiFxLayer } from '../PixiFxLayer';
import { isPreRun, useGame } from '../store';
import { sfx } from '../sfx';
import { RANK_FIXTURES, type RankFixture } from './fixtures';
import { RankScreen } from './RankScreen';
import { planRankSequence, sequenceDurationMs } from './rankSequence';

/**
 * DEV-only RANK SCREEN PREVIEW (blueprint §10.5: fixture-driven previews) — plays the post-game rank screen
 * for every fixture state (gain, loss, gate unlocked, promotion won, medal promotion, promotion failed,
 * demotion game set up / lost, floor, Ascendant uncapped, pending, retryable, rejected, unrated) over the live app, so the owner
 * can review each variant without playing eight games. The overlay is the SAME chrome + component the real
 * end screen mounts (`.heroselect.endscreen.lobbyend.rankend` → `RankScreen`), in `preview` mode so it never
 * writes the presentation-consumed marker. "Pending → confirmed" exercises the arrival path (a result landing
 * while the screen is up). CONTINUE on the previewed screen plays the real cross-fade exit (the clone fades
 * over the title, exactly as it will over the menu after a run). Stripped from production with the rest of the dev menu.
 */
export function RankScreenPreview(): JSX.Element {
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('rankscreen');
  const [fixture, setFixture] = useState<RankFixture | null>(null);
  const [reduced, setReduced] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [arrival, setArrival] = useState(false);
  // From the TITLE there is no FX canvas (Game mounts `PixiFxLayer` only with the board / picker), so the
  // rank-up / down-rank defs would silently fall back to the fade. Mount the layer here while a fixture is open
  // so the owner sees the real hits (promotion, and the `demo-lost-division` / `demo-lost` demotion fixtures); with a run
  // up the game's own layer is already attached and this stays out.
  const preRun = useGame(isPreRun);

  // "Pending → confirmed": mount the gain fixture as pending, then flip it confirmed after a beat.
  useEffect(() => {
    if (!arrival || !fixture) return;
    const id = window.setTimeout(() => setArrival(false), 1500);
    return () => window.clearTimeout(id);
  }, [arrival, fixture, replayKey]);

  const open = (f: RankFixture, viaArrival = false): void => {
    setFixture(f);
    setArrival(viaArrival);
    setReplayKey((k) => k + 1);
  };
  const close = (): void => { setFixture(null); setArrival(false); };

  const shown = fixture && arrival ? { ...fixture, submission: 'pending' as const, result: null, current: fixture.result?.before ?? null } : fixture;

  return (
    <>
      <div className="sfxmix tunerpanel rankpreview" ref={panelRef} style={panelStyle}>
        <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>
          <span className="tuner-emblem" aria-hidden="true">🏆</span>
          <b className="tuner-title">Rank Screen</b>
          <span>dev · post-game fixtures</span>
        </div>
        <div className="rankpreview-body">
          <label className="tuner-preview">
            <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
            Reduced motion (short fade, no travel)
          </label>
          <div className="rankpreview-list">
            {RANK_FIXTURES.map((f) => {
              const ms = f.result ? sequenceDurationMs(planRankSequence(f.result)) : 0;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`sfxmix-copy rankpreview-btn${fixture?.id === f.id ? ' on' : ''}`}
                  title={`${f.expect}${ms ? ` · ~${(ms / 1000).toFixed(1)} s` : ''}`}
                  onClick={() => open(f)}
                >
                  <span className="rankpreview-btn-l">{f.label}</span>
                  {ms > 0 && <span className="rankpreview-btn-ms">{(ms / 1000).toFixed(1)}s</span>}
                </button>
              );
            })}
          </div>
          <div className="lunge-btns">
            <button type="button" className="sfxmix-copy" onClick={() => open(RANK_FIXTURES[0]!, true)} title="Mount as pending, then confirm the gain result after 1.5 s — the arrival path">
              Pending → confirmed
            </button>
            <button type="button" className="sfxmix-copy" onClick={() => fixture && open(fixture, arrival)} disabled={!fixture} title="Play the open fixture again from the top">
              Replay
            </button>
            <button type="button" className="sfxmix-copy" onClick={close} disabled={!fixture} title="Hard-close the overlay. CONTINUE on the screen itself plays the real cross-fade exit.">Close screen</button>
          </div>
          <div className="lunge-btns rankpreview-cues">
            <button type="button" className="sfxmix-copy" onClick={() => sfx.rankProgress()}>♪ progress</button>
            <button type="button" className="sfxmix-copy" onClick={() => sfx.rankGate()}>♪ gate</button>
            <button type="button" className="sfxmix-copy" onClick={() => sfx.rankPromote()}>♪ promote</button>
            <button type="button" className="sfxmix-copy" onClick={() => sfx.rankMedal()}>♪ medal</button>
          </div>
        </div>
      </div>
      {shown && preRun && <PixiFxLayer />}
      {shown && (
        <div className={`heroselect endscreen lobbyend rankend rankend-preview${shown.placement === 1 ? ' won' : ''}`}>
          <div className="hsbox endbox">
            <RankScreen
              key={`${shown.id}:${replayKey}`}
              placement={shown.placement}
              seatCount={8}
              submission={shown.submission}
              result={shown.result}
              current={shown.current}
              error={shown.error}
              unratedReason={shown.submission === 'unrated' ? 'Practice' : undefined}
              runId={`preview:${shown.id}`}
              onContinue={close}
              onRetry={shown.submission === 'retryable' ? () => open(RANK_FIXTURES[0]!, true) : undefined}
              preview
              reducedMotion={reduced}
            />
          </div>
        </div>
      )}
    </>
  );
}
