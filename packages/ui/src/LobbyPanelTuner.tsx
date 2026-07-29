import { useState } from 'react';
import {
  LOBBY_PANEL_KEYS,
  LOBBY_PANEL_RANGES,
  LOBBY_PANEL_DESC,
  getLobbyPanelConfig,
  resetLobbyPanelConfig,
  setLobbyPanelValue,
  type LobbyPanelConfig,
  type LobbyPanelKey,
} from './lobbyPanelConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the LOBBY RAIL (`lobbyPanelConfig.ts`) — the 8-seat table down the right edge of
 * the stage. Panel scale, row scale and font size are separate dials (owner ask 2026-07-29), because they trade
 * off against each other: bigger text in the same box means fewer rows fit, and scaling the whole panel to fix
 * the text also moves it off the board edge.
 *
 * Applies LIVE through `--lby-*` vars on `:root` — no reload and no re-render, since the rail's rules read them
 * directly. "Copy" grabs the JSON to paste back as the shipped defaults. Stripped from production, where the
 * rail renders the baked defaults via each rule's CSS fallback.
 */
const LABELS: Record<LobbyPanelKey, string> = {
  scale: 'panel · scale',
  width: 'panel · width',
  right: 'panel · right gap',
  top: 'panel · top %',
  height: 'panel · height %',
  rowScale: 'rows · scale',
  fontScale: 'rows · font size',
  foeScale: 'next foe · scale',
};

export function LobbyPanelTuner() {
  const [cfg, setCfg] = useState<LobbyPanelConfig>(getLobbyPanelConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('lobbypanel');

  const set = (k: LobbyPanelKey, v: number): void => {
    setLobbyPanelValue(k, v);
    setCfg({ ...getLobbyPanelConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getLobbyPanelConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetLobbyPanelConfig(); setCfg({ ...getLobbyPanelConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Lobby Rail <span>dev · live · drag</span></div>
      {LOBBY_PANEL_KEYS.map((k) => {
        const [min, max, step] = LOBBY_PANEL_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={LOBBY_PANEL_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
