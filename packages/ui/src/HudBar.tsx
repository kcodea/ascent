import { useGame } from './store';

/** Top bar: wordmark + the altitude (wave) meter. Currencies/hero live in the bottom StatusBar. */
export function HudBar() {
  const run = useGame((s) => s.run);
  return (
    <div className="bar">
      <div className="wm disp">ASCENT</div>
      <div className="alt">
        <span className="lbl">Altitude</span>
        <span className="w">WAVE {run.wave}</span>
        <span className="meter">
          <i style={{ width: `${Math.min(100, run.wave * 8)}%` }} />
        </span>
        <span className="lbl">Best {run.best}</span>
      </div>
      <div className="sp" />
    </div>
  );
}
