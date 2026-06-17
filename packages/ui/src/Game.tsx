import './styles.css';
import { Recruit } from './Recruit';
import { GameOver } from './GameOver';
import { StatusBar } from './StatusBar';
import { Inspect } from './Inspect';
import { useGame } from './store';

/** Root of the playable game. `Recruit` owns the board and stays mounted across every
 *  phase — combat plays out *in place* (the shop closes, the enemies arrive, the
 *  warband / hero / HUD never move). The StatusBar (Embers · Hero · Resolve) and the
 *  game-over overlay layer on top. */
export function Game() {
  const phase = useGame((s) => s.run.phase);
  return (
    <>
      <Recruit />
      {phase === 'gameover' && <GameOver />}
      <StatusBar />
      <Inspect />
    </>
  );
}
