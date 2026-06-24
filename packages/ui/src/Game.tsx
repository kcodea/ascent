import './styles.css';
import { useEffect, useState } from 'react';
import { Recruit } from './Recruit';
import { EndScreen } from './EndScreen';
import { HeroSelect } from './HeroSelect';
import { StatusBar } from './StatusBar';
import { Inspect } from './Inspect';
import { EscMenu } from './EscMenu';
import { SfxMixer } from './SfxMixer';
import { LungeTuner } from './LungeTuner';
import { Icon } from './Icon';
import { ErrorBoundary } from './ErrorBoundary';
import { warmArt } from './art';
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

  // Preload all card/hero art once, on idle, so the first shop renders with art already cached — kills the
  // cold-load "pop-in" (esp. the itch CDN, where each webp is a separate first-appearance round-trip).
  useEffect(() => { warmArt(); }, []);

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
    <ErrorBoundary>
      <Recruit />
      {phase === 'gameover' && <EndScreen won={false} />}
      {phase === 'victory' && <EndScreen won={true} />}
      <StatusBar />
      <Inspect />
      <button className="gearbtn" onPointerDown={() => setMenuOpen(true)} title="Settings (Esc)" aria-label="Settings">
        <Icon name="gear" />
      </button>
      {/* Build badge above the gear — version + short git SHA, so you can tell at a glance which build is live. */}
      <div className="version" title={`ASCENT v${__APP_VERSION__} · build ${__BUILD_SHA__}`}>
        v{__APP_VERSION__} <span>{__BUILD_SHA__}</span>
      </div>
      {menuOpen && <EscMenu res={res} onRes={setRes} onClose={() => setMenuOpen(false)} />}
      {/* DEV-only live tuners (stripped from production via the static env check). */}
      {import.meta.env.DEV && <SfxMixer />}
      {import.meta.env.DEV && <LungeTuner />}
      {/* Topmost layer: the pre-run hero picker (self-gates on heroChoices). */}
      <HeroSelect />
    </ErrorBoundary>
  );
}
