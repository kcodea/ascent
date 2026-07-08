import type { MomentKind } from './choreo/kinds';
import type { Cue } from './choreo/score';
import { getScore, setCue } from './choreo/score';
import { clampOffset, allowsNegative } from './choreo/timelineMath';
import { CH_COLOR, CH_DESC, AT_DESC } from './choreoLabels';

/**
 * The Choreography timeline (choreographer phase 4) — one LANE per cue, each with a shared center vertical
 * 0-line marking the cue's ANCHOR (start / contact / landed). A chip left of 0 = negative offset (fire BEFORE
 * the anchor — the smack-lead); right of 0 = positive (fire after). Drag a chip to set its offset; the numeric
 * rows below edit the same value + the anchor/scaled/enabled toggles. Offset-relative (not absolute time) so
 * every cue's "now" lines up on one clean vertical, and negative/positive read at a glance. The empty
 * name/anchor spacers on the scale row keep the "0 ms" tick over the same center line the chips ride.
 */

export function ChoreoTimeline({ kind, onChange }: { kind: MomentKind; onChange: () => void }) {
  const cues = getScore()[kind];
  // Symmetric ms window around 0: the largest |offset| (floor 300, + headroom) so chips never hug the edge.
  const maxAbs = Math.max(300, ...cues.map((c) => Math.abs(c.offset ?? 0) + 40));
  /** Chip center as a % across the lane track: 0ms = 50% (the zero line); ±maxAbs → 4%/96% (a 4% margin). */
  const pct = (offset: number): number => 50 + (offset / maxAbs) * 46;

  const drag = (c: Cue) => (e: React.PointerEvent): void => {
    const track = (e.currentTarget as HTMLElement).closest<HTMLElement>('.choreo-lane-track');
    if (!track) return;
    const msPerPx = (2 * maxAbs) / track.clientWidth;
    const startX = e.clientX;
    const startOff = c.offset ?? 0;
    const move = (ev: PointerEvent): void => {
      const off = clampOffset(Math.round(startOff + (ev.clientX - startX) * msPerPx), c.at);
      setCue(kind, c.ch, { offset: off });
      onChange();
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  };

  return (
    <div className="choreo-tl">
      {/* scale row: empty name/anchor spacers so the −/0/+ ruler sits over the track area — the "0 ms" tick
          lands on the same center vertical the chips ride. */}
      <div className="choreo-tl-scale">
        <span className="choreo-lane-name" />
        <span className="choreo-lane-at" />
        <div className="choreo-tl-ruler">
          <span style={{ left: `${pct(-maxAbs)}%` }}>−{maxAbs}</span>
          <span style={{ left: '50%' }} className="choreo-tl-zero">0&nbsp;ms</span>
          <span style={{ left: `${pct(maxAbs)}%` }}>+{maxAbs}</span>
        </div>
      </div>
      {cues.map((c) => {
        const off = c.offset ?? 0;
        return (
          <div className={`choreo-lane${c.enabled === false ? ' off' : ''}`} key={c.ch}>
            <span className="choreo-lane-name" style={{ color: CH_COLOR[c.ch] }} title={CH_DESC[c.ch]}>{c.ch}</span>
            <span className="choreo-lane-at" title={AT_DESC[c.at]}>{c.at}</span>
            <div className="choreo-lane-track">
              {!allowsNegative(c.at) && (
                <div
                  className="choreo-neg-block"
                  title={`A ${c.at} cue can't fire before the moment begins — negative offsets aren't possible here, so this side is greyed out.`}
                />
              )}
              <div className="choreo-zero" />
              <div
                className="choreo-chip"
                style={{ left: `${pct(off)}%`, background: CH_COLOR[c.ch] }}
                onPointerDown={drag(c)}
                title={`${c.ch} — fires at ${c.at}${off === 0 ? '' : off > 0 ? ` +${off}ms` : ` ${off}ms`}. Drag to retime. ${CH_DESC[c.ch]}`}
              >{off === 0 ? '0' : off > 0 ? `+${off}` : `${off}`}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
