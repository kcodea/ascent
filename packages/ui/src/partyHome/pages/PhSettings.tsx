/**
 * SETTINGS under the APP SHELL (party home prototype, DEV only; owner 2026-11-02: "all of these menus should get revamped to
 * work with the new setup", "take a lot of inspiration from valorant's menus"). EscMenu.tsx's `SettingsPage` swaps this in
 * while the "Party home (prototype)" switch is on and the player is on the menus; off, or in a game, Settings is exactly as
 * before (`SettingsPanel`).
 *
 * THE LAYOUT (Valorant's settings): the page header carries the CATEGORY TABS (Game, Audio, Video, Social, Account), so a
 * tab always fits one screen. Each tab is a column of sections; each setting is ONE ROW: its name and a short note on the
 * left, its control on the right (a switch, a slider with its number, a dropdown, a button). The last tab is remembered on
 * this device (a convenience, localStorage).
 *
 * EVERY SETTING OF `SettingsPanel` IS HERE, wired to the same stores and the same calls (the parity test,
 * phSettings.test.tsx, fails when one is added there and not here):
 *   Game     combat speed, auto-ramp, lobby reveal, Quit game (desktop)
 *   Audio    Master, Game sounds, Music, Announcer: each a slider and a mute (all four shown: the tab has room, so the old
 *            "Advanced Controls" fold is not needed here)
 *   Video    board backdrop, max frame rate, fullscreen (desktop), touch UI size (touch), phone diagnostics (phones)
 *   Social   opponent cosmetics, spectator emotes, lobby chat, friends activity, the message filter
 *   Account  sign in / sign out
 *
 * Static paint. The switch knob slides on `transform` only. No `cursor` here (the gauntlet rule paints it).
 */
import { useId, useState, type ReactNode } from 'react';
import { isDesktop, quitGame, toggleFullscreen } from '../../desktop';
import { getVolume, isMuted, setVolume, sfx, toggleMute } from '../../sfx';
import { getMusicVolume, isMusicMuted, setMusicVolume, toggleMusicMute } from '../../music';
import { getAnnouncerVolume, isAnnouncerMuted, setAnnouncerVolume, toggleAnnouncerMute } from '../../announcer';
import { getMasterVolume, isMasterMuted, setMasterVolume, toggleMasterMute } from '../../audio/master';
import { useGame } from '../../store';
import { FPS_CAP_OPTIONS, fpsCapLabel } from '../../fpsCap';
import { BACKDROPS, BACKDROP_IDS, getBackdrop, setBackdrop, type BackdropId, backdropThumbUrl } from '../../backdrop';
import { perfThresholds } from '../../perfMonitor';
import { setSpectatorEmotesOn, useSpectatorEmotePrefs } from '../../versus/spectatorEmotes';
import { setFilterMessages, setShowActivity, useFriendsPrefs } from '../../friends/friendsPrefs';
import { setLobbyChatEnabled, useLobbyChat } from '../../lobbyChat/lobbyChatStore';
import { setLobbyRevealEnabled, useLobbyRevealEnabled } from '../../lobbyReveal/lobbyRevealStore';
import { isTouchDevice, touchText } from '../../touchInput';
import { TOUCH_UI_LABEL, TOUCH_UI_SIZES, setTouchUiSize, touchUi, type TouchUiSize } from '../../touchUi';
import { PHONE_DIAG_FLAGS, PHONE_GPU, activeDiagLabel, saveDiagFlags, storedDiagFlags, type PhoneDiagFlags } from '../../phoneDiag';
import { PhButton, PhPage, PhSelect, PhSlider, PhSwitch, PhTabs } from '../kit';
import './phSettings.css';

export type SettingsTab = 'game' | 'audio' | 'video' | 'social' | 'account';
export const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'audio', label: 'Audio' },
  { id: 'video', label: 'Video' },
  { id: 'social', label: 'Social' },
  { id: 'account', label: 'Account' },
];
export const SETTINGS_TAB_KEY = 'ascent.settings.tab';
function readTab(): SettingsTab {
  try { const v = localStorage.getItem(SETTINGS_TAB_KEY); return SETTINGS_TABS.some((t) => t.id === v) ? (v as SettingsTab) : 'game'; } catch { return 'game'; }
}

export function PhSettings({ initialTab }: { initialTab?: SettingsTab } = {}) {
  const [tab, setTab] = useState<SettingsTab>(() => initialTab ?? readTab());
  const pick = (t: SettingsTab): void => {
    sfx.tick(); setTab(t);
    try { localStorage.setItem(SETTINGS_TAB_KEY, t); } catch { /* a convenience only */ }
  };
  return (
    <PhPage className="phs" wide title="Settings" tabs={<PhTabs label="Settings" value={tab} onChange={pick} tabs={SETTINGS_TABS} />}>
      <div className="phs-col" role="tabpanel" aria-label={SETTINGS_TABS.find((t) => t.id === tab)!.label}>
        {tab === 'game' && <GameTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'video' && <VideoTab />}
        {tab === 'social' && <SocialTab />}
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
  const [confirmQuit, setConfirmQuit] = useState(false);
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
      {isDesktop() && (
        <Section title="Application">
          <ButtonRow label="Quit game" note="Closes ASCENT. Your run stays saved."
            button={<PhButton variant={confirmQuit ? 'primary' : 'plate'} size="s" onClick={() => { if (!confirmQuit) { setConfirmQuit(true); return; } quitGame(); }}>
              {confirmQuit ? 'Press again to quit' : 'Quit game'}
            </PhButton>} />
        </Section>
      )}
    </>
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
  return (
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
  );
}

function VideoTab() {
  const fpsCap = useGame((s) => s.fpsCap);
  const setFpsCap = useGame((s) => s.setFpsCap);
  const displayHz = perfThresholds().refreshHz;
  const touchDevice = isTouchDevice();
  const [touchSize, setTouchSize] = useState<TouchUiSize>(() => touchUi().size);
  const [backdrop, setBackdropPick] = useState<BackdropId>(getBackdrop);
  return (
    <>
      <Section title="Board">
        <SelectRow label="Board backdrop" note="What lies behind the board. Saved on this device." thumbAspect="16 / 9" value={backdrop}
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

function SocialTab() {
  const showOpponentSkins = useGame((s) => s.showOpponentSkins);
  const setShowOpponentSkins = useGame((s) => s.setShowOpponentSkins);
  const spectatorEmotesOn = useSpectatorEmotePrefs((s) => s.on);
  const lobbyChatOn = useLobbyChat((s) => s.enabled);
  const showActivity = useFriendsPrefs((s) => s.showActivity);
  const filterMessages = useFriendsPrefs((s) => s.filterMessages);
  return (
    <>
      <Section title="In a game">
        <ToggleRow label="Show opponent cosmetics" note="Off shows other players in their default art and hero attack. Your own cosmetics always show."
          on={showOpponentSkins} onToggle={() => { setShowOpponentSkins(!showOpponentSkins); sfx.pulse(); }} />
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

function AccountTab() {
  const onTitle = useGame((s) => s.showTitle);
  const account = useGame((s) => s.account);
  const signOutAccount = useGame((s) => s.signOutAccount);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const signedIn = !account.anonymous && !!account.email;
  return (
    <Section title="Account">
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

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="phs-sec">
      <header className="phs-sechead"><h2>{title}</h2>{note && <p>{note}</p>}</header>
      <div className="phs-rows">{children}</div>
    </section>
  );
}

function Row({ label, note, labelId, noteId, children }: { label: string; note?: string; labelId: string; noteId: string; children: ReactNode }) {
  return (
    <div className="phs-row">
      <div className="phs-what">
        <span className="phs-name" id={labelId}>{label}</span>
        {note && <span className="phs-note" id={noteId}>{note}</span>}
      </div>
      <div className="phs-ctl">{children}</div>
    </div>
  );
}

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
function SelectRow<T extends string | number>({ label, note, value, options, onChange, thumbAspect }: {
  label: string; note?: string; value: T; options: { value: T; label: ReactNode; thumb?: string; preview?: string; dim?: boolean; reason?: string }[]; onChange: (v: T) => void; thumbAspect?: string;
}) {
  const id = useId();
  return (
    <Row label={label} note={note} labelId={`${id}l`} noteId={`${id}n`}>
      <PhSelect className="phs-select" label={label} value={value} options={options} onChange={onChange} thumbAspect={thumbAspect} />
    </Row>
  );
}

function ButtonRow({ label, note, button }: { label: string; note?: string; button: ReactNode }) {
  const id = useId();
  return <Row label={label} note={note} labelId={`${id}l`} noteId={`${id}n`}>{button}</Row>;
}

function InfoRow({ label, note }: { label: string; note?: string }) {
  const id = useId();
  return <Row label={label} note={note} labelId={`${id}l`} noteId={`${id}n`}>{null}</Row>;
}
