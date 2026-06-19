import { useGame } from './store';

/**
 * PvE win screen — shown when a run reaches `phase === 'victory'` (survived the final wave,
 * CONFIG.maxWave). "Play Again" starts over via the hero picker, like the game-over flow.
 */
export function Victory() {
  const run = useGame((s) => s.run);
  const startHeroSelect = useGame((s) => s.startHeroSelect);
  return (
    <div className="over victory">
      <div className="box">
        <div className="eyebrow">The summit is yours</div>
        <h1 className="disp">VICTORY</h1>
        <div className="final disp">{run.wave}</div>
        <div className="fcap">Waves Survived</div>
        <button className="btn go" onClick={() => startHeroSelect()}>
          Play Again
        </button>
      </div>
    </div>
  );
}
