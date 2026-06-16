import './styles.css';
import { Recruit } from './Recruit';
import { Arena } from './Arena';
import { GameOver } from './GameOver';
import { useGame } from './store';

/** Root of the playable game: recruit → combat arena → recruit/game-over. */
export function Game() {
  const phase = useGame((s) => s.run.phase);
  if (phase === 'combat') return <Arena />;
  return (
    <>
      <Recruit />
      {phase === 'gameover' && <GameOver />}
    </>
  );
}
