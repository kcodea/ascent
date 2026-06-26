import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';

/**
 * The title screen — the game's front door, shown at boot and after a run ends. Routes into the two
 * modes (Ascent / Practice) or opens Settings. A single store flag (`showTitle`) drives it, no router;
 * picking a mode opens the hero picker (Ascent: 3 random; Practice: the whole roster).
 */
export function Title({ onSettings }: { onSettings: () => void }) {
  const showTitle = useGame((s) => s.showTitle);
  const startAscent = useGame((s) => s.startAscent);
  const startPractice = useGame((s) => s.startPractice);
  const openLeaderboard = useGame((s) => s.openLeaderboard);
  if (!showTitle) return null;

  return (
    <div className="titlescreen">
      <div className="titlebox">
        <div className="eyebrow">Roguelike auto-battler</div>
        <h1 className="disp titledisp">ASCENT</h1>
        <div className="titlemodes">
          <button className="titlebtn primary" onClick={() => { sfx.pulse(); startAscent(); }}>
            <span className="tbname">Ascent</span>
            <span className="tbdesc">The scored climb — survive the rising threat as long as you can.</span>
          </button>
          <button className="titlebtn" onClick={() => { sfx.pulse(); startPractice(); }}>
            <span className="tbname">Practice</span>
            <span className="tbdesc">Any hero · unlimited Resolve · 3× clock · ends after 15 rounds.</span>
          </button>
        </div>
        <div className="titleactions">
          <button className="titlesettings" onClick={() => { sfx.pulse(); openLeaderboard(); }} title="Leaderboard">
            <Icon name="crown" /> Leaderboard
          </button>
          <button className="titlesettings" onClick={onSettings} title="Settings">
            <Icon name="gear" /> Settings
          </button>
        </div>
      </div>
    </div>
  );
}
