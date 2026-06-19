import './styles.css';
import { useEffect, useState } from 'react';
import { Recruit } from './Recruit';
import { GameOver } from './GameOver';
import { Victory } from './Victory';
import { HeroSelect } from './HeroSelect';
import { StatusBar } from './StatusBar';
import { Inspect } from './Inspect';
import { EscMenu } from './EscMenu';
import { Icon } from './Icon';
import { useGame } from './store';

/** Root of the playable game. `Recruit` owns the board and stays mounted across every
 *  phase — combat plays out *in place* (the shop closes, the enemies arrive, the
 *  warband / hero / HUD never move). The StatusBar (Embers · Hero · Resolve) and the
 *  game-over overlay layer on top. The Esc menu drives the display-resolution scaler. */
export function Game() {
  const phase = useGame((s) => s.run.phase);
  const [menuOpen, setMenuOpen] = useState(false);
  const [res, setRes] = useState<string>(() => {
    try { return localStorage.getItem('ascent-res') || 'fit'; } catch { return 'fit'; }
  });

  // Apply the resolution box (a [data-res] attribute drives the --gw/--gh letterbox) + persist it.
  useEffect(() => {
    const root = document.documentElement;
    if (res === 'fit') root.removeAttribute('data-res');
    else root.setAttribute('data-res', res);
    try { localStorage.setItem('ascent-res', res); } catch { /* ignore */ }
  }, [res]);

  // Esc toggles the menu — but if the menu is closed and a card is being inspected, let the
  // inspect overlay claim Esc (it closes itself) instead of opening the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen((open) => {
        if (open) return false;
        if (useGame.getState().inspect) return false;
        return true;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Recruit />
      {phase === 'gameover' && <GameOver />}
      {phase === 'victory' && <Victory />}
      <StatusBar />
      <Inspect />
      <button className="gearbtn" onPointerDown={() => setMenuOpen(true)} title="Settings (Esc)" aria-label="Settings">
        <Icon name="gear" />
      </button>
      {menuOpen && <EscMenu res={res} onRes={setRes} onClose={() => setMenuOpen(false)} />}
      {/* Topmost layer: the pre-run hero picker (self-gates on heroChoices). */}
      <HeroSelect />
    </>
  );
}
