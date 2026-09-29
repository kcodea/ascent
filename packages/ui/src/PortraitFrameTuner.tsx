import { heroArt } from './art';
import { PortraitFrame, pfClass, usePortraitFrame } from './portraitFrame/PortraitFrame';
import { clearFitOverride, SPEC, type PortraitSide } from './portraitFrame/portraitFrameConfig';
import { TunerPanel } from './TunerPanel';
import { TUNERS_RESET_EVENT } from './tunerSchema';

/** The preview sizes: a ladder / match row icon, a Career portrait, and the large in-game portrait. */
const SIZES = [
  { px: 48, label: 'Row icon' },
  { px: 96, label: 'Medium' },
  { px: 176, label: 'In-game' },
] as const;

function PreviewDisc({ side, heroId, px }: { side: PortraitSide; heroId: string; px: number }): JSX.Element {
  const frame = usePortraitFrame(side);
  const art = heroArt(heroId);
  return (
    <div className={`pfprev-disc${pfClass(frame)}`} style={{ width: px, height: px, ...frame?.hostStyle }}>
      <div className="pfprev-clip">
        {art && <img decoding="sync" className="pfprev-art" src={art} alt="" draggable={false} />}
      </div>
      <PortraitFrame frame={frame} />
    </div>
  );
}

/** Live preview: your frame at three sizes, then the opponents' frame (which follows yours while "Same for
 *  everyone" is on). "Current" shows the bare disc, since today's look differs per surface. */
function PortraitFramePreview(): JSX.Element {
  return (
    <div>
      {(['self', 'opp'] as const).map((side) => (
        <div key={side}>
          <div className="pfprev">
            {SIZES.map((s) => (
              <div className="pfprev-cell" key={s.px}>
                <PreviewDisc side={side} heroId={side === 'self' ? 'albus' : 'cassen'} px={s.px} />
                <span className="pfprev-cap">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="pfprev-row">{side === 'self' ? 'Your frame' : 'Opponents\' frame'}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * DEV tuner for HERO PORTRAIT FRAMES (owner ask 2026-09-29): pick the ring your portrait and your opponents'
 * portraits wear on every surface (hero select, the shop and combat portraits, Now Facing, the lobby rail, the
 * end screen, Career, the ladder pages, match details), and fit it over the round art. Production keeps
 * today's look until a choice is baked into `portraitFrameConfig.ts`.
 */
export function PortraitFrameTuner(): JSX.Element {
  return (
    <TunerPanel
      spec={{
        ...SPEC,
        readout: () => <PortraitFramePreview />,
        actions: [{ label: 'Clear frame override', run: () => { clearFitOverride(); window.dispatchEvent(new CustomEvent(TUNERS_RESET_EVENT)); }, hint: 'The frame picked in Fit applies to goes back to the global fit.' }],
      }}
    />
  );
}
