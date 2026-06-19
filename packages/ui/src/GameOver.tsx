import { useGame } from './store';

export function GameOver() {
  const run = useGame((s) => s.run);
  const startHeroSelect = useGame((s) => s.startHeroSelect);
  return (
    <div className="over">
      <div className="box">
        <div className="eyebrow">The tide takes you</div>
        <h1 className="disp">FALLEN</h1>
        <div className="final disp">{run.wave}</div>
        <div className="fcap">Waves Reached</div>
        <button className="btn go" onClick={() => startHeroSelect()}>
          Begin a New Ascent
        </button>
      </div>
    </div>
  );
}
