import './styles.css';
import { useEffect, useState } from 'react';
import { Recruit } from './Recruit';
import { EndScreen } from './EndScreen';
import { HeroSelect } from './HeroSelect';
import { Title } from './Title';
import { Leaderboard } from './Leaderboard';
import { Career } from './Career';
import { AvatarPicker } from './AvatarPicker';
import { FontLab } from './FontLab';
import { StatusBar } from './StatusBar';
import { Inspect } from './Inspect';
import { MinionBook } from './MinionBook';
import { EscMenu } from './EscMenu';
import { SfxMixer } from './SfxMixer';
import { LungeTuner } from './LungeTuner';
import { TauntTuner } from './TauntTuner';
import { Icon } from './Icon';
import { ErrorBoundary } from './ErrorBoundary';
import { PixiFxLayer } from './PixiFxLayer';
import { pixiFx } from './pixiFx';
import { warmArt } from './art';
import { useGame } from './store';

/** Root of the playable game. `Recruit` owns the board and stays mounted across every
 *  phase — combat plays out *in place* (the shop closes, the enemies arrive, the
 *  warband / hero / HUD never move). The StatusBar (Embers · Hero · Resolve) and the
 *  game-over overlay layer on top. The Esc menu drives the display-resolution scaler. */
export function Game() {
  const phase = useGame((s) => s.run.phase);
  const showBook = useGame((s) => s.showBook);
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
  // inspect overlay claim Esc (it closes itself) instead of opening the menu. The Minion Book
  // also claims Esc (closes itself) before the menu would open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useGame.getState();
      if (st.showBook) { st.closeBook(); return; }
      setMenuOpen((open) => {
        if (open) return false;
        if (st.inspect) return false;
        return true;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tab toggles the Compendium — from the title (browse the whole set) or in a run (scoped to it). Not
  // during hero select. `preventDefault` stops the browser's focus-cycling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const st = useGame.getState();
      if (st.heroChoices) return;
      e.preventDefault();
      st.toggleBook();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ErrorBoundary>
      <Recruit />
      {/* WebGL effects overlay (particle impacts, flashes) — a transparent full-viewport Pixi
          canvas drawn over the board; the combat replay fires effects into it at contact points. */}
      <PixiFxLayer />
      {phase === 'gameover' && <EndScreen won={false} />}
      {phase === 'victory' && <EndScreen won={true} />}
      <StatusBar />
      {showBook && <MinionBook />}
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
      {import.meta.env.DEV && <TauntTuner />}
      {/* DEV: fire an unmissable Pixi FX burst at screen center + log diagnostics. */}
      {import.meta.env.DEV && (
        <button
          className="fxtest-btn"
          onPointerDown={() => pixiFx.test()}
          title="Fire a test Pixi effect at screen center"
        >
          Test FX
        </button>
      )}
      {/* Topmost layers: the pre-run hero picker (self-gates on heroChoices), and above it the title
          screen (self-gates on showTitle) — the front door into Ascent / Practice / Settings. */}
      <HeroSelect />
      <Title onSettings={() => setMenuOpen(true)} />
      <Leaderboard />
      <Career />
      <AvatarPicker />
      <FontLab />
    </ErrorBoundary>
  );
}
