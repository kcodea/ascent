/** Pause / settings overlay (Esc). Trimmed to what players actually need: combat pacing (first, owner ask
 *  2026-10-08), audio (the MASTER row always shown, and an "Advanced Controls" button since 2026-10-08 that expands
 *  three channels, each a slider + mute: Game sounds (sfx.ts), Music (music.ts) and the Announcer (announcer.ts);
 *  collapsed by default, its open state remembered in localStorage), the opponent-cosmetics switch, the effects
 *  frame cap, Quit back to the main menu, and — in the Electron shell only — a fullscreen toggle + Quit game (see
 *  `desktop.ts`; the web build has no shell to close).
 *
 *  LAYOUT RULES (owner asks 2026-10-08): a button is only as wide as its label and carries nothing else; any
 *  explanation is a note on the same line, to the button's right.
 *  An on/off setting is a row with a toggle SWITCH (red track off, knob left; green track on, knob right), never a
 *  checkmark. A pick-one setting is a dropdown (`SettingSelect`), not a row of buttons.
 *
 *  The ARENA BOARD PICKER is gone (owner ask 2026-08-22). It offered three backdrops; the game ships one, and
 *  `boardConfig.ts` — whose only consumers were this menu and a side-effect import — was retired with it, so
 *  the stylesheet's `--board` is now the single source of the arena art. Resolution and board dimming went the
 *  same way in 2026-07-14. The HUD's quick-mute sits behind the enemy frame, so the dependable audio controls
 *  live here, in a modal nothing can obscure. */

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { isDesktop, quitGame, toggleFullscreen } from './desktop';
import { getVolume, isMuted, setVolume, sfx, toggleMute } from './sfx';
import { getMusicVolume, isMusicMuted, setMusicVolume, toggleMusicMute } from './music';
import { getAnnouncerVolume, isAnnouncerMuted, setAnnouncerVolume, toggleAnnouncerMute } from './announcer';
import { getMasterVolume, isMasterMuted, setMasterVolume, toggleMasterMute } from './audio/master';
import { useGame } from './store';
import { FPS_CAP_OPTIONS, fpsCapLabel } from './fpsCap';
import { perfThresholds } from './perfMonitor';
import { endReplay } from './replay/replayPlayer';

export function EscMenu({ onClose }: { onClose: () => void }) {
  const openTitle = useGame((s) => s.openTitle);
  const replaying = useGame((s) => s.replaying);
  // ACCOUNT row (owner ask 2026-09-21): Sign in / Sign out moved here from the Title's top-right chip. The
  // AccountPanel only ever renders over the Title (its own gate), so the Sign-in button is offered on the title
  // and in-game the row just says where to go; Sign out is safe anywhere (it only resets the local identity).
  const onTitle = useGame((s) => s.showTitle);
  const account = useGame((s) => s.account);
  const signOutAccount = useGame((s) => s.signOutAccount);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const signedIn = !account.anonymous && !!account.email;
  // Where the modal was opened FROM decides its primary action (the menu sidebar can open it from every ladder
  // page and the mode picker, not only from a run — review 2026-09-21): a replay leaves the replay; a title
  // surface (a ladder page or a picker view over the title) goes to the main menu; the main menu itself has
  // nowhere to go, so the section is omitted; a run saves & quits.
  const onPage = useGame((s) => s.showCareer || s.showRankings || s.showLeaderboard || s.showRecentGames || s.showCollection || s.titleView !== 'menu');
  const primary: 'replay' | 'menu' | 'none' | 'run' = replaying ? 'replay' : onTitle ? (onPage ? 'menu' : 'none') : 'run';
  // Audio is owned by sfx.ts (persisted to localStorage); mirror it into local state so the slider +
  // mute button re-render as they change. Dragging the slider previews the level on release.
  const [vol, setVol] = useState(getVolume());
  const [muted, setMuted] = useState(isMuted());
  const [musicVol, setMusicVol] = useState(getMusicVolume());
  const [musicMuted, setMusicMuted] = useState(isMusicMuted());
  const [announcerVol, setAnnouncerVol] = useState(getAnnouncerVolume());
  const [announcerMuted, setAnnouncerMuted] = useState(isAnnouncerMuted());
  const [masterVol, setMasterVol] = useState(getMasterVolume());
  const [masterMuted, setMasterMuted] = useState(isMasterMuted());
  // ADVANCED CONTROLS (owner asks 2026-09-23, 2026-10-08): Master always shows; one button expands / collapses the
  // three channels under it. Collapsed by default; the choice is remembered per browser.
  const [audioOpen, setAudioOpen] = useState(readAudioPanelOpen);
  const toggleAudioPanel = (): void => {
    const next = !audioOpen;
    setAudioOpen(next);
    try { localStorage.setItem(AUDIO_PANEL_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    sfx.pulse();
  };
  // Combat pacing — how fast the combat replay animates (owner moved this here from the in-combat HUD
  // 2026-08-11). Live store value; the arena's beat clock + CSS read it.
  const combatSpeed = useGame((s) => s.combatSpeed);
  const setCombatSpeed = useGame((s) => s.setCombatSpeed);
  const combatRampUp = useGame((s) => s.combatRampUp);
  const setCombatRampUp = useGame((s) => s.setCombatRampUp);
  // SKINS (owner 2026-09-28): an OPPONENT-only display switch. Your own equipped skins always show.
  const showOpponentSkins = useGame((s) => s.showOpponentSkins);
  const setShowOpponentSkins = useGame((s) => s.setShowOpponentSkins);
  const fpsCap = useGame((s) => s.fpsCap);
  const setFpsCap = useGame((s) => s.setFpsCap);
  const displayHz = perfThresholds().refreshHz;
  // Desktop only (see desktop.ts): the browser build has no shell to close. Two-tap confirm —
  // closing the app mid-run is the most destructive button in here.
  const [confirmQuit, setConfirmQuit] = useState(false);

  return (
    <div className="escov" onPointerDown={onClose}>
      <div className="escpanel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="esch disp">Settings</div>
        {primary !== 'none' && <div className="escsec">{primary === 'replay' ? 'Replay' : primary === 'menu' ? 'Menu' : 'Run'}</div>}
        {/* SAVE & QUIT — promoted to the top and styled as the primary action (owner ask 2026-08-24). The
            run is already saved continuously; this button makes that explicit and one obvious tap. During a
            REPLAY the quit path must END THE PLAYBACK first (owner report 2026-08-19: quitting left the replay
            HUD floating over the title) — endReplay restores the snapshot, then opening the title wins. From a
            ladder page / the picker there is nothing to save: the same openTitle, labelled for what it does. */}
        {primary === 'replay' && (
          <ActionButton
            label="Leave replay"
            note="Back to the main menu. The replay closes."
            primary
            onPress={() => { endReplay(); openTitle(); onClose(); }}
          />
        )}
        {primary === 'menu' && (
          <ActionButton
            label="Main menu"
            note="Closes this page and returns to the main menu."
            primary
            onPress={() => { openTitle(); onClose(); }}
          />
        )}
        {primary === 'run' && (
          <ActionButton
            label="Save & Quit"
            note="Saves this exact moment and returns to the menu. Continue picks up right here."
            primary
            onPress={() => { openTitle(); onClose(); }}
          />
        )}
        {/* COMBAT leads the settings (owner ask 2026-10-08): the speed is the one players reach for mid-run. */}
        <div className="escsec">Combat</div>
        <div className="escvol">
          <span className="evl">{combatRampUp ? 'Start speed' : 'Speed'}</span>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={combatSpeed}
            aria-label="Combat replay speed"
            onChange={(e) => setCombatSpeed(Number(e.target.value))}
          />
          <span className="evv">{combatSpeed.toFixed(1)}×</span>
        </div>
        <ToggleRow
          label="Auto-ramp speed"
          note="Long fights speed up, then ease back down for the finish."
          on={combatRampUp}
          onToggle={() => { setCombatRampUp(!combatRampUp); sfx.pulse(); }}
        />
        <div className="escsec">Audio</div>
        {/* MASTER (owner ask 2026-09-26) scales every channel (audio/master.ts); its mute leaves the channel mutes as
            they are. Under it, ADVANCED CONTROLS opens the three channels: "Game sounds" is the SFX level (sfx.ts),
            "Music" the background music (music.ts), "Announcer" the voice lines (announcer.ts). Each row is its
            slider + its mute; none touches another. */}
        <div className="escaudio">
          <AudioChannel
            label="Master"
            volume={masterVol}
            muted={masterMuted}
            onVolume={(v) => { setMasterVol(v); setMasterVolume(v); }}
            onRelease={() => sfx.buy()}
            onToggleMute={() => { const m = toggleMasterMute(); setMasterMuted(m); if (!m) sfx.pulse(); }}
          />
          <button
            className={`escbtn escdisclose pressable${audioOpen ? ' open' : ''}`}
            onPointerDown={toggleAudioPanel}
            aria-expanded={audioOpen}
            aria-controls="esc-audio-panel"
          >
            <span className="ebl">Advanced Controls</span>
            <svg className="escchev" viewBox="0 0 16 16" aria-hidden><path d="M3.5 6l4.5 4.5L12.5 6" /></svg>
          </button>
          {audioOpen && (
            <div className="escaudio-adv" id="esc-audio-panel">
              <AudioChannel
                label="Game sounds"
                volume={vol}
                muted={muted}
                onVolume={(v) => { setVol(v); setVolume(v); }}
                onRelease={() => sfx.buy()}
                onToggleMute={() => setMuted(toggleMute())}
              />
              <AudioChannel
                label="Music"
                volume={musicVol}
                muted={musicMuted}
                onVolume={(v) => { setMusicVol(v); setMusicVolume(v); }}
                onToggleMute={() => { setMusicMuted(toggleMusicMute()); sfx.pulse(); }}
              />
              <AudioChannel
                label="Announcer"
                volume={announcerVol}
                muted={announcerMuted}
                onVolume={(v) => { setAnnouncerVol(v); setAnnouncerVolume(v); }}
                onToggleMute={() => { setAnnouncerMuted(toggleAnnouncerMute()); sfx.pulse(); }}
              />
            </div>
          )}
        </div>
        {/* One switch for EVERY opponent cosmetic (2026-09-28): their skins and, since hero attacks became cosmetics,
            the attack they strike you with. Same stored setting (`showOpponentSkins`), renamed to say so. */}
        <div className="escsec">Cosmetics</div>
        <ToggleRow
          label="Show opponent cosmetics"
          note="Off shows other players in their default art and hero attack. Your own cosmetics always show."
          on={showOpponentSkins}
          onToggle={() => { setShowOpponentSkins(!showOpponentSkins); sfx.pulse(); }}
        />
        <div className="escsec">Performance</div>
        {/* EFFECTS FRAME CAP (owner ask 2026-09-04; a dropdown named "Max Frame Rate" since 2026-10-08). Caps the Pixi
            effects + GSAP clocks ONLY — CSS (hover, drag, fly-ins, floats, the wipe) runs at the display refresh and the
            app has no lever over it (Electron caps frame rate for offscreen windows only). The owner expected a
            whole-game 60 fps on a 360 Hz display and saw no change, hence the note pointing at the GPU driver's per-app
            limit. An option above the display's refresh does nothing — the window is vsynced. "Display" = uncapped. */}
        <div className="escvol escselectrow">
          <span className="evl" id="esc-fps-label">Max Frame Rate</span>
          <SettingSelect
            labelledBy="esc-fps-label"
            value={fpsCap}
            options={FPS_CAP_OPTIONS.map((cap) => ({
              value: cap,
              label: fpsCapLabel(cap, displayHz),
              dim: cap > 0 && displayHz > 0 && cap > displayHz + 1,
            }))}
            onChange={(cap) => { if (fpsCap !== cap) { setFpsCap(cap); sfx.pulse(); } }}
          />
        </div>
        <div className="escnote">Caps combat effects and card motion only. The rest of the game runs at your display's refresh. To cap the whole game, use your GPU driver's per-app frame limit. Options above your display's refresh have no effect.</div>
        {/* Desktop shell only. The run is saved continuously, so closing the app loses nothing — but it is
            still the one button that ends the session, hence the confirm. */}
        {isDesktop() && (
          <>
            <div className="escsec">Game</div>
            <ActionButton
              label="Toggle fullscreen"
              note="Borderless fullscreen by default. F11 does the same."
              onPress={() => { toggleFullscreen(); }}
            />
            <ActionButton
              label={confirmQuit ? 'Tap again to quit' : 'Quit game'}
              note="Closes ASCENT. Your run stays saved."
              danger={confirmQuit}
              onPress={() => { if (!confirmQuit) { setConfirmQuit(true); return; } quitGame(); }}
            />
          </>
        )}
        <div className="escsec">Account</div>
        {signedIn ? (
          <ActionButton
            label="Sign out"
            note={`Signed in as ${account.email}`}
            onPress={() => { sfx.pulse(); void signOutAccount(); }}
          />
        ) : onTitle ? (
          <ActionButton
            label="Sign in"
            note="Save your progress. Email only, no password."
            // The panel paints ABOVE this modal (z 540 vs 500); close the modal first so it does not linger underneath.
            onPress={() => { sfx.pulse(); onClose(); openAccountPanel(); }}
          />
        ) : (
          <div className="escnote">Not signed in. Sign in from the main menu to keep your progress across devices.</div>
        )}
        <button className="escclose pressable" onPointerDown={onClose}>Resume</button>
      </div>
    </div>
  );
}

const AUDIO_PANEL_KEY = 'ascent.audiopanel';
function readAudioPanelOpen(): boolean {
  try { return localStorage.getItem(AUDIO_PANEL_KEY) === '1'; } catch { return false; }
}

/** A button that carries only its label; its explanation is a note OUTSIDE it, on the same line to its right
 *  (owner asks 2026-10-08), tied to the button for screen readers via aria-describedby. */
function ActionButton({ label, note, primary, danger, onPress }: {
  label: string;
  note?: string;
  primary?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const noteId = useId();
  return (
    <div className="escline">
      <button
        className={`escbtn pressable${primary ? ' escbtn-primary' : ''}${danger ? ' danger' : ''}`}
        onPointerDown={onPress}
        aria-describedby={note ? noteId : undefined}
      >
        <span className="ebl">{label}</span>
      </button>
      {note && <div className="escnote eschint" id={noteId}>{note}</div>}
    </div>
  );
}

/** An on/off setting (owner ask 2026-10-08): the whole row is the switch. OFF = knob left over a red track,
 *  ON = knob right over a green track. The knob slides on `transform` only. */
function ToggleRow({ label, note, on, onToggle }: {
  label: string;
  note?: string;
  on: boolean;
  onToggle: () => void;
}) {
  const noteId = useId();
  return (
    <div className="escline">
      <button
        className={`escbtn esctoggle pressable${on ? ' is-on' : ''}`}
        role="switch"
        aria-checked={on}
        aria-describedby={note ? noteId : undefined}
        onPointerDown={onToggle}
      >
        <span className="ebl">{label}</span>
        <span className="escswitch" aria-hidden><span className="escknob" /></span>
      </button>
      {note && <div className="escnote eschint" id={noteId}>{note}</div>}
    </div>
  );
}

export interface SettingOption<T> { value: T; label: string; dim?: boolean }

/** A pick-one dropdown in the panel's navy/gold (owner ask 2026-10-08: "a dropdown select rather than a bunch of
 *  buttons"). Hand-rolled rather than a native `<select>`, whose OS popup would break the game's look and drop the
 *  gauntlet cursor. The list opens under the trigger, inside the panel (no portal: the panel already lives in the
 *  stage). Closes on a pick, on Escape, and on a press anywhere outside it (a CAPTURE listener, because the panel
 *  stops pointerdown from bubbling). Keyboard: arrows move between options, Enter / Space picks. */
export function SettingSelect<T extends string | number>({ value, options, onChange, labelledBy }: {
  value: T;
  options: SettingOption<T>[];
  onChange: (v: T) => void;
  labelledBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    // Focus the chosen option so the arrows start from it.
    listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  const pick = (v: T): void => {
    setOpen(false);
    onChange(v);
    triggerRef.current?.focus();
  };
  const onListKey = (e: ReactKeyboardEvent): void => {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
      items[next]?.focus();
    } else if (e.key === 'Escape') {
      // Close the list only; the menu itself stays open.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className={`escselect${open ? ' open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        className="escselect-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelledBy}
        onPointerDown={() => { setOpen((o) => !o); sfx.pulse(); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }}
      >
        <span className="escselect-value">{current.label}</span>
        <svg className="escchev" viewBox="0 0 16 16" aria-hidden><path d="M3.5 6l4.5 4.5L12.5 6" /></svg>
      </button>
      {open && (
        <div className="escselect-list" role="listbox" id={listId} aria-labelledby={labelledBy} ref={listRef} onKeyDown={onListKey}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              role="option"
              aria-selected={o.value === value}
              className={`escselect-opt${o.value === value ? ' on' : ''}${o.dim ? ' dim' : ''}`}
              onPointerDown={() => pick(o.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(o.value); } }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One channel of the Audio section: its label, its slider (disabled while muted) and its mute pill. The global
 *  gauntlet rule paints the cursor on the button; nothing here sets its own. */
function AudioChannel({ label, volume, muted, onVolume, onRelease, onToggleMute }: {
  label: string;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onRelease?: () => void;
  onToggleMute: () => void;
}) {
  return (
    <div className="escvol">
      <span className="evl">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(volume * 100)}
        disabled={muted}
        aria-label={`${label} volume`}
        onChange={(e) => onVolume(Number(e.target.value) / 100)}
        onPointerUp={onRelease}
      />
      <span className="evv">{muted ? 'Off' : `${Math.round(volume * 100)}`}</span>
      <button
        className={`escmute pressable${muted ? ' on' : ''}`}
        onPointerDown={onToggleMute}
        aria-pressed={muted}
        aria-label={muted ? `Unmute ${label.toLowerCase()}` : `Mute ${label.toLowerCase()}`}
      >
        {muted ? 'Muted' : 'Mute'}
      </button>
    </div>
  );
}
