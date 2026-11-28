/**
 * SETTINGS under the APP SHELL (party home prototype, DEV only; owner 2026-11-02: "all of these menus should get revamped to
 * work with the new setup", "take a lot of inspiration from valorant's menus"). EscMenu.tsx's `SettingsPage` swaps this in
 * while the "Party home (prototype)" switch is on and the player is on the menus; off, or in a game, Settings is exactly as
 * before (`SettingsPanel`).
 *
 * THE LAYOUT (Valorant's settings): the page header carries the CATEGORY TABS (Game, Audio, Video, Cosmetics, Social,
 * Keybindings, Account), so a
 * tab always fits one screen. Each tab is a column of sections; each setting is ONE ROW: its name and a short note on the
 * left, its control on the right (a switch, a slider with its number, a dropdown, a button). The last tab is remembered on
 * this device (a convenience, localStorage).
 *
 * EVERY SETTING OF `SettingsPanel` IS HERE, wired to the same stores and the same calls (the parity test,
 * phSettings.test.tsx, fails when one is added there and not here):
 *   Game     combat speed, auto-ramp, lobby reveal, Save and Quit Match (in a game), Quit game (desktop)
 *   Audio    Master, Game sounds, Music, Announcer: each a slider and a mute (all four shown: the tab has room, so the old
 *            "Advanced Controls" fold is not needed here); Hover sounds (shell only, 2026-11-20)
 *   Video    board backdrop, max frame rate, FPS counter (shell only, 2026-11-20), fullscreen (desktop), touch UI size (touch), phone diagnostics (phones)
 *   Cosmetics opponent cosmetics, then one switch per cosmetic category (shell only, R-SETTINGS-COSMETICS-01)
 *   Social   spectator emotes, lobby chat, friends activity, the message filter
 *   Keys     every rebindable key (shell only, R-SETTINGS-KEYBINDS-01; keybinds.ts), the fixed keys listed
 *   Account  sign in / sign out
 *
 * Static paint. The switch knob slides on `transform` only. No `cursor` here (the gauntlet rule paints it).
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { isDesktop, quitGame, toggleFullscreen } from '../../desktop';
import { getVolume, isMuted, setVolume, sfx, toggleMute } from '../../sfx';
import { getMusicVolume, isMusicMuted, setMusicVolume, toggleMusicMute } from '../../music';
import { getAnnouncerVolume, isAnnouncerMuted, setAnnouncerVolume, toggleAnnouncerMute } from '../../announcer';
import { getMasterVolume, isMasterMuted, setMasterVolume, toggleMasterMute } from '../../audio/master';
import { formatHandle, inGameScreen, useGame } from '../../store';
import { concedeAreaOf, leaveGame, leaveKindOf, settingsLeaveText } from '../../gameMenuParts';
import { useVersus } from '../../versus/versusStore';
import { useSpectate } from '../../versus/spectate';
import { isWatchingLive } from '../../live/liveWatch';
import { FPS_CAP_OPTIONS, fpsCapLabel } from '../../fpsCap';
import { BACKDROPS, BACKDROP_IDS, getBackdrop, setBackdrop, type BackdropId, backdropThumbUrl } from '../../backdrop';
import { perfThresholds } from '../../perfMonitor';
import { setSpectatorEmotesOn, useSpectatorEmotePrefs } from '../../versus/spectatorEmotes';
import { setFilterMessages, setShowActivity, useFriendsPrefs } from '../../friends/friendsPrefs';
import { setLobbyChatEnabled, useLobbyChat } from '../../lobbyChat/lobbyChatStore';
import { setLobbyRevealEnabled, useLobbyRevealEnabled } from '../../lobbyReveal/lobbyRevealStore';
import { reactiveCursorReady, setReactiveCursorEnabled, useReactiveCursorEnabled } from '../../reactiveCursor/reactiveCursor';
import { setAchievementPopupsOn, useAchievementPopupsOn } from '../../progression/achievementToastPrefs';
import { isTouchDevice, touchText } from '../../touchInput';
import { TOUCH_UI_LABEL, TOUCH_UI_SIZES, setTouchUiSize, touchUi, type TouchUiSize } from '../../touchUi';
import { PHONE_DIAG_FLAGS, PHONE_GPU, activeDiagLabel, saveDiagFlags, storedDiagFlags, type PhoneDiagFlags } from '../../phoneDiag';
import { PhButton, PhPage, PhSelect, PhSlider, PhSwitch, PhTabs } from '../kit';
import { COSMETIC_TOGGLE_ROWS, setCosmeticShown, showAllCosmetics, useCosmeticVisibility } from '../../cosmetics/cosmeticVisibility';
import { hoverSoundsOn, setHoverSoundsOn } from '../../audio/hoverSounds';
import { setFpsCounterOn, useFpsCounterOn } from '../../FpsCounter';
import { KeybindsTab } from './PhSettingsKeybinds';
import { InfoRow, Row, Section } from './phSettingsParts';
import './phSettings.css';

export type SettingsTab = 'game' | 'audio' | 'video' | 'cosmetics' | 'social' | 'keys' | 'account';
export const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
  { id: 'cosmetics', label: 'Cosmetics' },
  { id: 'social', label: 'Social' },
  { id: 'keys', label: 'Keybindings' },
  { id: 'account', label: 'Account' },
];
export const SETTINGS_TAB_KEY = 'ascent.settings.tab';
/** Every open starts on Game, the leftmost tab (R-PH-TAB-DEFAULT-01); a pick lasts for this visit only. */
function readTab(): SettingsTab {
  return SETTINGS_TABS[0]!.id;
}

export function PhSettings({ initialTab }: { initialTab?: SettingsTab } = {}) {
  const [tab, setTab] = useState<SettingsTab>(() => initialTab ?? readTab());
  const pick = (t: SettingsTab): void => {
    sfx.tick(); setTab(t);
  };
  return (
    <PhPage className="phs" wide title="Settings" tabs={<PhTabs label="Settings" value={tab} onChange={pick} tabs={SETTINGS_TABS} />}>
      <div className="phs-col" role="tabpanel" aria-label={SETTINGS_TABS.find((t) => t.id === tab)!.label}>
        {tab === 'game' && <GameTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'video' && <VideoTab />}
        {tab === 'cosmetics' && <CosmeticsTab />}
        {tab === 'social' && <SocialTab />}
        {tab === 'keys' && <KeybindsTab />}
        {tab === 'account' && <AccountTab />}
      </div>
    </PhPage>
  );
}

/* ── The tabs ── */

function GameTab() {
  const combatSpeed = useGame((s) => s.combatSpeed);
  const setCombatSpeed = useGame((s) => s.setCombatSpeed);
  const combatRampUp = useGame((s) => s.combatRampUp);
  const setCombatRampUp = useGame((s) => s.setCombatRampUp);
  const lobbyRevealOn = useLobbyRevealEnabled();
  const achPopupsOn = useAchievementPopupsOn();
  const [confirmQuit, setConfirmQuit] = useState(false);
  // In a game Settings carries the way out of it, above Quit game (owner 2026-11-08, R-SETTINGS-SAVEQUIT-01).
  const inGame = useGame(inGameScreen);
  return (
    <>
      <Section title="Combat">
        <SliderRow label={combatRampUp ? 'Start speed' : 'Speed'} note="How fast fights play out." aria="Combat replay speed"
          min={0.5} max={5} step={0.1} value={combatSpeed} shown={`${combatSpeed.toFixed(1)}×`} onChange={setCombatSpeed} />
        <ToggleRow label="Auto-ramp speed" note="Long fights speed up, then ease back down for the finish." on={combatRampUp}
          onToggle={() => { setCombatRampUp(!combatRampUp); sfx.pulse(); }} />
      </Section>
      <Section title="Lobby">
        <ToggleRow label="Lobby reveal" note="Shows every player's hero at the start of a game, then builds the rail." on={lobbyRevealOn}
          onToggle={() => { setLobbyRevealEnabled(!lobbyRevealOn); sfx.pulse(); }} />
      </Section>
      <Section title="Achievements">
        <ToggleRow label="Achievement pop-ups" note="Shows each achievement as you earn it, sliding in from the left." on={achPopupsOn}
          onToggle={() => { setAchievementPopupsOn(!achPopupsOn); sfx.pulse(); }} />
      </Section>
      {/* Desktop app only (a browser tab cannot close itself); also shown in dev builds so it can be seen while working in the
          browser, where it does nothing (owner 2026-11-06: "where is this quit button"). */}
      {(inGame || isDesktop() || import.meta.env.DEV) && (
        <Section title="Application">
          {inGame && <LeaveMatchRow />}
          {(isDesktop() || import.meta.env.DEV) && <ButtonRow label="Quit game" note={isDesktop() ? 'Closes ASCENT. Your run stays saved.' : 'Closes ASCENT in the desktop app. Does nothing in a browser.'}
            button={<PhButton variant="primary" size="l" className={confirmQuit ? 'phs-quit armed' : 'phs-quit'} onClick={() => { if (!confirmQuit) { setConfirmQuit(true); return; } quitGame(); }}>
              {confirmQuit ? 'Press again to quit' : 'Quit game'}
            </PhButton>} />}
        </Section>
      )}
    </>
  );
}

/** SAVE AND QUIT MATCH (owner 2026-11-08: "add a Save and Quit Match Button above Quit to Ascent ... in settings"): the
 *  in-game sidebar's leave, in Settings. Saves a solo or lobby game and returns to the menu; a Versus match concedes, a
 *  replay or a watched game leaves (each in its own words). Press twice, like Quit game. */
function LeaveMatchRow() {
  const watching = useSpectate((s) => s.active);
  const kind = useGame((s) => leaveKindOf(s, watching));
  const godMode = useGame((s) => s.run.godMode === true);
  const over = useVersus((s) => s.match?.phase === 'complete');
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const area = useVersus((s) => concedeAreaOf(s.match));
  const text = settingsLeaveText(kind, godMode, kind === 'watch' && isWatchingLive(), over, area);
  return (
    <ButtonRow label={text.label} note={text.note}
      button={<PhButton variant="primary" size="l" className={armed ? 'phs-quit armed' : 'phs-quit'}
        onClick={() => { sfx.pulse(); if (!armed) { setArmed(true); return; } setArmed(false); leaveGame(kind); }}>
        {armed ? text.confirm : text.label}
      </PhButton>} />
  );
}

function AudioTab() {
  const [masterVol, setMasterVol] = useState(getMasterVolume());
  const [masterMuted, setMasterMuted] = useState(isMasterMuted());
  const [vol, setVol] = useState(getVolume());
  const [muted, setMuted] = useState(isMuted());
  const [musicVol, setMusicVol] = useState(getMusicVolume());
  const [musicMuted, setMusicMuted] = useState(isMusicMuted());
  const [announcerVol, setAnnouncerVol] = useState(getAnnouncerVolume());
  const [announcerMuted, setAnnouncerMuted] = useState(isAnnouncerMuted());
  const [hover, setHover] = useState(hoverSoundsOn);
  return (
    <>
    <Section title="Volume">
      <AudioRow label="Master" note="Every sound in the game." volume={masterVol} muted={masterMuted}
        onVolume={(v) => { setMasterVol(v); setMasterVolume(v); }} onRelease={() => sfx.buy()}
        onToggleMute={() => { const m = toggleMasterMute(); setMasterMuted(m); if (!m) sfx.pulse(); }} />
      <AudioRow label="Game sounds" note="Cards, combat and buttons." volume={vol} muted={muted}
        onVolume={(v) => { setVol(v); setVolume(v); }} onRelease={() => sfx.buy()}
        onToggleMute={() => setMuted(toggleMute())} />
      <AudioRow label="Music" note="The menu and lobby music." volume={musicVol} muted={musicMuted}
        onVolume={(v) => { setMusicVol(v); setMusicVolume(v); }}
        onToggleMute={() => { setMusicMuted(toggleMusicMute()); sfx.pulse(); }} />
      <AudioRow label="Announcer" note="The announcer's voice lines." volume={announcerVol} muted={announcerMuted}
        onVolume={(v) => { setAnnouncerVol(v); setAnnouncerVolume(v); }}
        onToggleMute={() => { setAnnouncerMuted(toggleAnnouncerMute()); sfx.pulse(); }} />
    </Section>
    <Section title="Interface">
      <ToggleRow label="Hover sounds" note="The soft tick when the mouse moves onto a button. Clicks keep their sound." on={hover}
        onToggle={() => { const v = !hover; setHover(v); setHoverSoundsOn(v); sfx.pulse(); }} />
    </Section>
    </>
  );
}

function VideoTab() {
  const fpsCap = useGame((s) => s.fpsCap);
  const setFpsCap = useGame((s) => s.setFpsCap);
  const displayHz = perfThresholds().refreshHz;
  const touchDevice = isTouchDevice();
  const [touchSize, setTouchSize] = useState<TouchUiSize>(() => touchUi().size);
  const [backdrop, setBackdropPick] = useState<BackdropId>(getBackdrop);
  const fpsOn = useFpsCounterOn();
  return (
    <>
      <Section title="Board">
        <SelectRow label="Board backdrop" note="What lies behind the board. Saved on this device." thumbAspect="16 / 9"
          previewSide="left" previewSize={520} /* left of the list, twice the size (owner 2026-11-06) */ value={backdrop}
          options={BACKDROP_IDS.map((id) => ({ value: id, label: BACKDROPS[id].label, thumb: backdropThumbUrl(id), preview: backdropThumbUrl(id) }))}
          onChange={(id) => { if (id !== backdrop) { setBackdropPick(id); setBackdrop(id); sfx.pulse(); } }} />
      </Section>
      <Section title="Performance">
        {/* Caps the Pixi effects + GSAP clocks only (see SettingsPanel); an option above the display's refresh does nothing. */}
        <SelectRow label="Max frame rate" value={fpsCap}
          note={touchText(
            "Caps combat effects and card motion only. The rest of the game runs at your display's refresh. To cap the whole game, use your GPU driver's per-app frame limit. Options above your display's refresh have no effect.",
            "Caps combat effects and card motion only. The rest of the game runs at your screen's refresh. Options above your screen's refresh have no effect.",
          )}
          options={FPS_CAP_OPTIONS.map((cap) => {
            // Above the display's refresh: dimmed but still pickable (the refresh is measured, and can read low under load).
            const above = cap > 0 && displayHz > 0 && cap > displayHz + 1;
            return { value: cap, label: fpsCapLabel(cap, displayHz), ...(above ? { dim: true, reason: touchText("Above your display's refresh", "Above your screen's refresh") } : {}) };
          })}
          onChange={(cap) => { if (fpsCap !== cap) { setFpsCap(cap); sfx.pulse(); } }} />
        <ToggleRow label="Show FPS counter" note="A small frame rate readout in the top right corner." on={fpsOn}
          onToggle={() => { setFpsCounterOn(!fpsOn); sfx.pulse(); }} />
      </Section>
      {(isDesktop() || touchDevice) && (
        <Section title="Display">
          {isDesktop() && (
            <ButtonRow label="Fullscreen" note="Borderless fullscreen by default. F11 does the same."
              button={<PhButton size="s" onClick={() => { toggleFullscreen(); }}>Toggle fullscreen</PhButton>} />
          )}
          {touchDevice && (
            <SelectRow label="Touch UI size" note="Makes buttons, tabs and text bigger on a phone or tablet." value={touchSize}
              options={TOUCH_UI_SIZES.map((sz) => ({ value: sz, label: TOUCH_UI_LABEL[sz] }))}
              onChange={(sz) => { if (sz !== touchSize) { setTouchSize(sz); setTouchUiSize(sz); sfx.pulse(); } }} />
          )}
        </Section>
      )}
      {touchDevice && PHONE_GPU && <PhoneDiagnostics />}
    </>
  );
}

/** COSMETICS (R-SETTINGS-COSMETICS-01): the opponent switch, then one switch per category (cosmeticVisibility.ts). */
function CosmeticsTab() {
  const showOpponentSkins = useGame((s) => s.showOpponentSkins);
  const setShowOpponentSkins = useGame((s) => s.setShowOpponentSkins);
  const hidden = useCosmeticVisibility((s) => s.hidden);
  const reactiveCursorOn = useReactiveCursorEnabled();
  const anyHidden = Object.keys(hidden).length > 0;
  return (
    <>
      <Section title="Other players">
        <ToggleRow label="Show opponent cosmetics" note="Off shows other players in their default art and hero attack. Your own cosmetics always show."
          on={showOpponentSkins} onToggle={() => { setShowOpponentSkins(!showOpponentSkins); sfx.pulse(); }} />
      </Section>
      {reactiveCursorReady() && <Section title="Cursor">
        {/* R-CURSOR-REACTIVE-01 (owner 2026-11-27). Saved on this device. */}
        <ToggleRow label="Reactive Cursor" note="Your cursor takes the look of the tribe you have the most of on your board. A tie goes to the leftmost."
          on={reactiveCursorOn} onToggle={() => { setReactiveCursorEnabled(!reactiveCursorOn); sfx.pulse(); }} />
      </Section>}
      <Section title="Show cosmetics" note="Each switch applies to everyone, you included: your games, the lobby, replays and spectating. Off shows the default look. Nothing is unequipped.">
        {COSMETIC_TOGGLE_ROWS.map((r) => (
          <ToggleRow key={r.id} label={r.label} note={r.note} on={hidden[r.id] !== true}
            onToggle={() => { setCosmeticShown(r.id, hidden[r.id] === true); sfx.pulse(); }} />
        ))}
        {anyHidden && <ButtonRow label="Show everything" note="Turns every switch above back on."
          button={<PhButton size="s" onClick={() => { showAllCosmetics(); sfx.pulse(); }}>Show all</PhButton>} />}
      </Section>
    </>
  );
}

function SocialTab() {
  const spectatorEmotesOn = useSpectatorEmotePrefs((s) => s.on);
  const lobbyChatOn = useLobbyChat((s) => s.enabled);
  const showActivity = useFriendsPrefs((s) => s.showActivity);
  const filterMessages = useFriendsPrefs((s) => s.filterMessages);
  return (
    <>
      <Section title="In a game">
        <ToggleRow label="Spectator emotes"
          note={`Off hides the emotes of people watching your game. ${touchText('Right-click', 'Tap and hold')} a spectator in the top left to mute just them.`}
          on={spectatorEmotesOn} onToggle={() => { setSpectatorEmotesOn(!spectatorEmotesOn); sfx.pulse(); }} />
        <ToggleRow label="Lobby chat" note="The chat for everyone in a game: players and spectators. Off hides it."
          on={lobbyChatOn} onToggle={() => { setLobbyChatEnabled(!lobbyChatOn); sfx.pulse(); }} />
      </Section>
      <Section title="Friends">
        <ToggleRow label="Show friends what I'm doing" note="Off shows friends only Online, or In a game with its mode."
          on={showActivity} onToggle={() => { setShowActivity(!showActivity); sfx.pulse(); }} />
        <ToggleRow label="Filter bad words in messages" note="Hides swear words and slurs in messages from friends and in lobby chat."
          on={filterMessages} onToggle={() => { setFilterMessages(!filterMessages); sfx.pulse(); }} />
      </Section>
    </>
  );
}

/** How long the Copy button reads Copied. */
const COPIED_MS = 1600;

/** YOUR TAG (owner 2026-11-18: "display the player's account#1234 here so they know their username information";
 *  R-SETTINGS-ACCOUNT-TAG-01): the name with its tag, the handle friends type to add you, and a Copy button. */
function TagRow({ handle, guest }: { handle: string; guest: boolean }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(null), COPIED_MS);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = (): void => {
    sfx.pulse();
    let p: Promise<void>;
    try { p = navigator.clipboard.writeText(handle); } catch (e) { p = Promise.reject(e); }
    p.then(() => setCopied('yes'), () => setCopied('no'));
  };
  return (
    <ButtonRow label={handle} note={guest ? 'Your name and tag. Sign in to add friends.' : 'Your name and tag. Friends add you with this.'}
      button={<PhButton size="s" onClick={copy} aria-label={copied ? undefined : `Copy ${handle}`}>{copied === 'yes' ? 'Copied' : copied === 'no' ? 'Could not copy' : 'Copy'}</PhButton>} />
  );
}

function AccountTab() {
  const onTitle = useGame((s) => s.showTitle);
  const account = useGame((s) => s.account);
  const playerName = useGame((s) => s.playerName);
  const signOutAccount = useGame((s) => s.signOutAccount);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const signedIn = !account.anonymous && !!account.email;
  // Guests get a tag too once their name is claimed; with no tag yet (offline, no name) the row is left out.
  const handle = playerName && account.discriminator ? formatHandle(playerName, account.discriminator) : null;
  return (
    <Section title="Account">
      {handle && <TagRow handle={handle} guest={!signedIn} />}
      {signedIn ? (
        <ButtonRow label="Signed in" note={account.email ?? undefined}
          button={<PhButton size="s" onClick={() => { sfx.pulse(); void signOutAccount(); }}>Sign out</PhButton>} />
      ) : onTitle ? (
        <ButtonRow label="Not signed in" note="Save your progress. Email only, no password."
          // The account panel paints over the page (z 540 vs 470); the page stays under it.
          button={<PhButton variant="primary" size="s" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Sign in</PhButton>} />
      ) : (
        <InfoRow label="Not signed in" note="Sign in from the main menu to keep your progress across devices." />
      )}
    </Section>
  );
}

function PhoneDiagnostics() {
  const [flags, setFlags] = useState<PhoneDiagFlags>(() => storedDiagFlags());
  const now = activeDiagLabel();
  const next = activeDiagLabel(flags);
  return (
    <Section title="Phone diagnostics" note="For tracking down a crash. Each switch applies after Reload and stays on until you turn it off.">
      {PHONE_DIAG_FLAGS.map((f) => (
        <ToggleRow key={f.id} label={f.label} note={f.hint} on={!!flags[f.id]}
          onToggle={() => {
            const n: PhoneDiagFlags = { ...flags };
            if (n[f.id]) delete n[f.id]; else n[f.id] = 1;
            setFlags(n); saveDiagFlags(n); sfx.pulse();
          }} />
      ))}
      <ButtonRow label="Reload" note={`On now: ${now || 'none'}. After Reload: ${next || 'none'}.`}
        button={<PhButton size="s" onClick={() => { window.location.reload(); }}>Reload</PhButton>} />
    </Section>
  );
}

/* ── The building blocks: a section, and one row per setting (name + note left, control right) ── */

/** An on/off setting: the kit's switch (the owner's 2026-10-08 rule: off = knob left on red, on = knob right on green,
 *  with the word On or Off on it), its name and note on the left. */
function ToggleRow({ label, note, on, onToggle }: { label: string; note?: string; on: boolean; onToggle: () => void }) {
  return <div className="phs-row phs-togglerow"><PhSwitch checked={on} onChange={() => onToggle()} label={label} hint={note} /></div>;
}

/** A slider setting: the kit's slider (its value at the right), its name and note on the left. */
function SliderRow({ label, note, aria, min, max, step, value, shown, onChange, onRelease }: {
  label: string; note?: string; aria: string; min: number; max: number; step: number; value: number; shown: string;
  onChange: (v: number) => void; onRelease?: () => void;
}) {
  const id = useId();
  return (
    <Row label={label} note={note} labelId={`${id}l`} noteId={`${id}n`}>
      <PhSlider className="phs-slider" min={min} max={max} step={step} value={value} ariaLabel={aria} format={() => shown}
        onChange={onChange} onRelease={onRelease ? () => onRelease() : undefined} />
    </Row>
  );
}

/** An audio channel: the kit's slider with its Mute pairing (the slider dims while muted, the value reads Off). */
function AudioRow({ label, note, volume, muted, onVolume, onRelease, onToggleMute }: {
  label: string; note?: string; volume: number; muted: boolean; onVolume: (v: number) => void; onRelease?: () => void; onToggleMute: () => void;
}) {
  const id = useId();
  return (
    <Row label={label} note={note} labelId={`${id}l`} noteId={`${id}n`}>
      <PhSlider className="phs-slider" min={0} max={100} step={1} value={Math.round(volume * 100)} ariaLabel={`${label} volume`}
        format={(v) => (muted ? 'Off' : v)} onChange={(v) => onVolume(v / 100)} onRelease={onRelease ? () => onRelease() : undefined}
        muted={muted} onMute={onToggleMute} muteLabel={`${muted ? 'Unmute' : 'Mute'} ${label.toLowerCase()}`} />
    </Row>
  );
}

/** A pick-one setting: the kit's dropdown (its list opens in a layer above the page, so a section never clips it). */
function SelectRow<T extends string | number>({ label, note, value, options, onChange, thumbAspect, previewSide, previewSize }: {
  label: string; note?: string; value: T; options: { value: T; label: ReactNode; thumb?: string; preview?: string; dim?: boolean; reason?: string }[]; onChange: (v: T) => void; thumbAspect?: string;
  /** Where the big hover preview opens, and its width in shell units (the kit's defaults: auto, 260). */
  previewSide?: 'auto' | 'left' | 'right'; previewSize?: number;
}) {
  const id = useId();
  return (
    <Row label={label} note={note} labelId={`${id}l`} noteId={`${id}n`}>
      <PhSelect className="phs-select" label={label} value={value} options={options} onChange={onChange} thumbAspect={thumbAspect} previewSide={previewSide} previewSize={previewSize} />
    </Row>
  );
}

function ButtonRow({ label, note, button }: { label: string; note?: string; button: ReactNode }) {
  const id = useId();
  return <Row label={label} note={note} labelId={`${id}l`} noteId={`${id}n`}>{button}</Row>;
}

