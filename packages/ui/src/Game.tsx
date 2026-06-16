import './styles.css';
import { Recruit } from './Recruit';
import { Arena } from './Arena';
import { GameOver } from './GameOver';
import { StatusBar } from './StatusBar';
import { useGame } from './store';

/** Root of the playable game. The StatusBar (Embers · Hero · Resolve) is rooted at
 *  the bottom across every phase; the phase swaps recruit ↔ combat arena above it. */
export function Game() {
  const phase = useGame((s) => s.run.phase);
  return (
    <>
      {phase === 'combat' ? (
        <Arena />
      ) : (
        <>
          <Recruit />
          {phase === 'gameover' && <GameOver />}
        </>
      )}
      <StatusBar />
    </>
  );
}
