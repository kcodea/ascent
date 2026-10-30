import './styles.css';
// The shared tooltip look (owner 2026-10-02) + its DEV size dials. After styles.css so the skin owns the paint.
import './uiTheme.css'; // the shared colour tokens (--ui-*) for tooltips + HUD pills
import './tooltips.css';
import './touchUi.css'; // THE TOUCH UI: every rule keyed off html[data-touch-ui] (touch devices only, R-TOUCH-UISCALE-01)
import './phoneMenus.css'; // THE PHONE MENUS: each menu page laid out for a phone (html[data-touch-small][data-page-scale], R-PHONE-MENUS-03)
import './phoneLayout.css'; // THE PHONE LAYOUT: html[data-phone-layout] only (a phone in landscape, R-PHONE-LAYOUT-01)
import './runeCard.css'; // the forge card: rune cards + rune rack badges (owner reference 2026-10-07)
import './tooltipConfig';
import './boardEdgeConfig'; // side-effect: apply the ultrawide edge-blend vars (dev: persisted tune; prod: DEFAULTS)
import './healthPillConfig'; // side-effect: stamp the health-pill look on <html> (dev: persisted pick; prod: DEFAULT)
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSpectate } from './versus/spectate';
import { heldScreenKey } from './screenSwap';
import { Recruit } from './Recruit';
import { PERF_DOM_CONTAINERS } from './perfDomContainers';
import { EndScreen } from './EndScreen';
import { HeroSelect } from './HeroSelect';
import { VersusHeroSelectPause } from './versus/VersusHud';
import { HeroSelectWatch } from './hero-select/HeroSelectWatch';
import { HeroLaunchCurtain } from './hero-select/HeroLaunchCurtain';
import { GoodLuckIntro } from './goodLuck/GoodLuckIntro';
import { RuneforgeEntrancePreview } from './runeforgeEntrance/RuneforgeEntrancePreview';
import { DiscoverEntrancePreview } from './discoverEntrance/DiscoverEntrancePreview';
import { WipePreview } from './WipePreview';
import { Title } from './Title';
import { Leaderboard } from './Leaderboard';
import { Rankings } from './Rankings';
import { RecentGames } from './RecentGames';
import { CollectionScreen } from './progression/CollectionScreen';
import { CratePreview } from './progression/crateFx/CratePreview';
import { Career } from './Career';
import { PerfScreen } from './PerfScreen';
import { AvatarPicker } from './AvatarPicker';
import { TutorialController } from './tutorial/TutorialController';
import { CrashLogReadout } from './CrashLogReadout';
import { PerfLogReadout } from './PerfLogReadout';
import { PHONE_BENCH_ON } from './perfLogFlag';
// The on-device auto-bench (R-PHONE-BENCH-01): fetched only with ?phonebench=1.
const PhoneBenchCard = lazy(() => import('./PhoneBenchCard'));
import { installPerfLog } from './phonePerfLog';
import { CRASH_REPORT_TABLE, scheduleCrashReportUpload } from './crashReport';
import { anonRestInsert, supabaseClient } from './remoteBoards';
import { maybeStartLiveReplayFromUrl } from './liveReplay';
import { PHONE_GPU } from './phoneDiag';
import { AccountPanel } from './AccountPanel';
import { EmoteLayer } from './emotes/EmoteLayer';
import { PingLayer } from './pings/PingLayer';
import { StatusBar } from './StatusBar';
import { Inspect } from './Inspect';
import { RuneInspect } from './RuneInspect';
import { MinionBook } from './MinionBook';
import compendiumBookArt from './compendium-book.png';
import rulesQuestionArt from './rules-question.png';
import settingsArt from './settings-medallion.png';
import { SettingsPage } from './EscMenu';
import { PatchNotesPage } from './PatchNotesPage';
import { GameMenu, handleEscape, openMenu } from './GameMenu';
import { setFxScene, type FxScene } from './fx/fxBudget';
import { installPerfBench } from './perfBench';
import { ensureDefsReady } from './fx/playDef';
import { installNoNativeTooltips } from './noNativeTooltips';
import { BugReportModal } from './bug-report/BugReportModal';
import { installBugReportHotkey } from './bug-report/bugReportHotkey';
import { PerfHud } from './PerfHud';
import { phaseStartBetween } from './perfWarmup';
import { uploadRun } from './perfCloud';
import { toRun } from './perfStore';
import { isRealPlayRun } from './perfCaptureScope';

/** The sandbox's DEV panels: the Scene Builder, or — once opened from the title — the Stage Builder's board canvas +
 *  panel in its place. Loaded on demand so the Stage Builder and its store never reach the player chunk — in a
 *  production build `import.meta.env.DEV` is false, the ternary folds to `null` and the dynamic import is dropped. */
const SandboxDevPanels = import.meta.env.DEV
  ? lazy(() => import('./stageBuilder/StageBuilder').then((m) => ({ default: m.SandboxDevPanels })))
  : null;

/** DEV-only tools, loaded on demand (mobile load pass, 2026-10-18). They used to be STATIC imports rendered behind
 *  `import.meta.env.DEV &&`: the JSX folded away in a production build, but the modules (every tuner, the rules
 *  registry the Rulebook triage reads, the Balance Report) have top-level side effects, so Rollup kept them in the
 *  player chunk anyway. As `lazy()` behind the same ternary the dynamic import itself is dropped from production. */
const DevMenu = import.meta.env.DEV ? lazy(() => import('./DevMenu').then((m) => ({ default: m.DevMenu }))) : null;
const EditorOverlay = import.meta.env.DEV ? lazy(() => import('./uiEditor/EditorOverlay').then((m) => ({ default: m.EditorOverlay }))) : null;
const BugScenarioPanel = import.meta.env.DEV ? lazy(() => import('./bug-report/BugScenarioPanel').then((m) => ({ default: m.BugScenarioPanel }))) : null;
const BalancePanel = import.meta.env.DEV ? lazy(() => import('./BalancePanel').then((m) => ({ default: m.BalancePanel }))) : null;

/** Seconds of live recording an auto-share needs before it is worth a row. A reload is not a session. */
const MIN_AUTO_SHARE_SECONDS = 45;


/** Persist the perf choice, so closing the HUD in a dev client keeps it closed across reloads (the dev
 *  default only applies when no opinion is stored — see `enabledByFlag`). */
function setPerfFlag(on: boolean): void {
  try { localStorage.setItem('ascent.perf', on ? '1' : '0'); } catch { /* ignore */ }
}
import { perfMonitor, perfEnabledByFlag } from './perfMonitor';
import { ErrorBoundary } from './ErrorBoundary';
import { retryImport } from './retryImport';
import { ReplayOverlay } from './replay/ReplayOverlay';
import { ReplayDragGhost } from './replay/ReplayDragGhost';
import { ReplayCursorGhost } from './replay/ReplayCursorGhost';
import { SpectatorCursor } from './versus/SpectatorCursor';
import { RoundRail } from './replay/RoundRail';
import { PixiFxLayer } from './PixiFxLayer';
import { CastPreviewLayer } from './CastPreviewLayer';
import { discoverFx, pixiFx, warmDiscoverFx } from './pixiFx';
import { wipeFx } from './wipeFx';
import { applyFpsCap } from './fpsCap';
import { preloadRunArt } from './preloadPlan';
import { audioContext, onStopAllAudio, sfx } from './sfx';
import { cancelAnnouncer, setAnnouncerAudioContextProvider, setAnnouncerPackProvider, syncAnnouncer } from './announcer';
import { equippedAnnouncerPack } from './progression/announcerPack';
import { setMusicAudioContextProvider, syncMusic } from './music';
import { syncPhoneSfxPrewarm } from './audio/phonePrewarm';
import { useGame, isPreRun, inGameScreen } from './store';
import { RankedGate } from './rankedGate/RankedGate';
import { installStage, onStageChange, setStageInRun, setStageMenuZoom, stageFit, stageScale, stageViewport } from './stage';
import { installTouchInput } from './touchInput';
import { installTouchUi, touchUi } from './touchUi';
import { installTouchSlop } from './touchSlop';
import { installTouchKeyboard } from './touchKeyboard';
import { OwnSkins, RunSkins } from './skins/skins';
import { CloudMovedModal } from './CloudMovedModal';
import { installLivePublisher } from './live/livePublisher';
import { LiveGames } from './live/LiveGames';
import { LiveJoining, LiveWatchBar } from './live/LiveWatchBar';
import { SpectatorEndNotice } from './live/SpectatorEndNotice';
import { InviteNotice } from './friends/InviteNotice';
import { FriendsDock } from './friends/dock/FriendsDock';
import { FriendMenu } from './friends/FriendMenu';
import { startFriendsPresence } from './friends/friendsStore';
import { startDirectMessages } from './friends/dm/dmStore';
import { DmToast } from './friends/dm/DmToast';
import { installFriendInvites } from './friends/friendsGo';
// The tuned look (R-PRESENT-TUNED-01): every config module that applies its defaults at load, so a production build
// applies them too now that the DEV menu, their old importer, is DEV-only (the medallion circle came back).
import './tunedDefaults';

/** The FX budget scene a run state is in (see `fxBudget.ts`): the Discover overlay, else the shop, else none. */
function fxSceneOf(r: { discover?: unknown; phase?: string } | null | undefined): FxScene | null {
  return r?.discover ? 'discover' : r?.phase === 'recruit' ? 'shop' : null;
}

/** Root of the playable game. `Recruit` owns the board and stays mounted across every
 *  phase — combat plays out *in place* (the shop closes, the enemies arrive, the
 *  warband / hero / HUD never move). The StatusBar (Embers · Hero · Resolve) and the
 *  game-over overlay layer on top. The Esc menu drives the display-resolution scaler. */
/**
 * What counts as a MENU control for the two delegated sound cues — the hover tick and the click "thock".
 *
 * Hoisted so the two cannot drift: a control that ticks on hover and then goes silent under the finger (or the
 * reverse) reads as a bug in the sound, not as a deliberate distinction. Both listeners live in `Game`, mounted
 * once, rather than as props on every button — a new menu item cannot forget a cue it never had to opt into.
 *
 * Deliberately EXCLUDED via SKIP: the in-game shop and combat HUD controls, which are gameplay actions with
 * their own dedicated sounds rather than menu navigation, plus dev panels. Minion cards (`.card` divs) are not
 * buttons, so they never match SEL in the first place.
 */
const MENU_SFX_SEL = 'button, [role="button"], .disc-slot';
const MENU_SFX_SKIP = '[data-nohoversfx], [data-quiet], .devmenu, .desk, .heropowerbtn, .frzwrap, .tvbwrap, .rfbwrap, '
  + '.riftbtn, .etbwrap, .combatsummary, .combathud-skip, .combatspeed, .forge-reroll, '
  // SELECTION IS SILENT on the menus (owner 2026-10-16: "remove the blip sound effect from clicking around in menus -
  // like clicking between games, or between opponents"): picking a game, a lobby seat, a tab, a hero filter, a trend
  // range, a Leaderboard row. Real actions (Play, a mode, Replay, confirms, crates) keep their sounds.
  + '.gs-item, .gs-list, .lp-tile, .lp-back, .cv2-tab, .rg-chip, .cv2-seg-btn, .lb-seg-btn, .ct-seg button, .lb-trow-btn, .lb-podium, .colls-tab, .colls-chip';

export function Game() {
  const phase = useGame((s) => s.run.phase);
  const replayHasStream = useGame((s) => s.replaySession?.hasStream === true);
  const sandbox = useGame((s) => s.run.sandbox);
  const liveReplay = useGame((s) => s.liveReplay);
  // GOD MODE (owner 2026-10-08) rides the sandbox flag, but the DEV rig's panels never mount over it.
  const godMode = useGame((s) => s.run.godMode === true);
  const bugScenarioLoaded = useGame((s) => s.bugScenario !== null);
  const showBook = useGame((s) => s.showBook);
  const toggleBook = useGame((s) => s.toggleBook);
  const openRules = useGame((s) => s.openRules);
  // Recruit stays mounted across phases (combat plays out in place), so its closures/refs live for the whole
  // run. Starting a NEW run (pickHero / newRun → a fresh seed+hero) must give it a clean slate — otherwise a
  // callback captured under the previous run lingers (e.g. Disco Dan's locked-hand check false-locking a
  // uid-colliding card in the next hero's run). Key it on the run identity — stable within a run (seed +
  // heroId never change mid-run), so it only remounts when the run itself changes.
  // REPLAY VIEWER: the seek epoch is folded in so a replay SEEK remounts the recruit tree — every FX hook's
  // sequence-diff ref re-inits at the target frame, so a jump across 30 frames can't fire 30 stale effects
  // (buys/welds still replay during ordinary frame stepping, which never bumps the epoch). 0 outside replays.
  const liveRunKey = useGame((s) => `${s.run.seed}:${s.run.heroId}:${s.replaySeekEpoch}`);
  // VERSUS DUOS, THE TEAMMATE VIEW (owner 2026-10-29, "Option A"; R-DUOS-VIEW-NOREMOUNT-01): watching my teammate puts
  // THEIR run in the store (its own seed and hero), which used to change this key and rebuild the whole board twice a
  // swap. The key now HOLDS my own run's identity while the teammate view is open, so the swap re-renders in place.
  // What the remount used to reset (FX sequence watchers, diff snapshots, timers, the rows) is reset in Recruit on the
  // swap render instead (screenSwap.ts). The StatusBar and the EmoteLayer stay on the LIVE key: they are small, the hero
  // panel is a different hero anyway, and remounting them keeps their per-run refs (`prevHp`) honest for free.
  const watchingMate = useSpectate((s) => s.teammate === true);
  const runKeyRef = useRef(liveRunKey);
  runKeyRef.current = heldScreenKey(runKeyRef.current, liveRunKey, watchingMate);
  const runKey = runKeyRef.current;
  // See `isPreRun`: the board must not render (or tick) until a run is actually entered.
  const preRun = useGame(isPreRun);
  const heroPicking = useGame((s) => s.heroChoices !== null);
  // The Settings PAGE's flag lives in the store (`settingsOpen`) so the menu sidebar can open it from any page.
  const openSettings = useGame((s) => s.openSettings);
  // The gear names what it opens: the in-game menu in a game, the Settings page on the menus.
  const gearInGame = useGame(inGameScreen);
  const [perfOn, setPerfOn] = useState(perfEnabledByFlag);

  // The OS `title` tooltip never shows anywhere in the game (owner ruling 2026-09-18) — see noNativeTooltips.ts.
  useEffect(() => installNoNativeTooltips(), []);
  // `window.__bench` on a VITE_PERF_BENCH=1 build only (perfBench.ts): prod-bundle measurement handles.
  useEffect(() => installPerfBench(), []);
  // Load the FX primitives once, in EVERY build, so the authored defs actually play — for players as well as
  // in a dev session. This is the third of the three gates that used to keep defs off the shipped game (the
  // other two are the `import.meta.glob` in `fx/fxDefs.ts` and the dynamic import in `fx/playDef.ts`), and it
  // is the easy one to forget: without this call the primitives never register, so `canPlayDefs()` stays false
  // and EVERY def binding in the Score is silently inert — a whole combat with none of the authored effects and
  // no error to explain why, having shipped their bytes anyway. Do not re-add an `import.meta.env.DEV` guard
  // here. (The workbench's own `import('./primitives')` is separate and stays DEV-gated.)
  useEffect(() => {
    void ensureDefsReady();
  }, []);
  // FRIENDS (owner 2026-10-26, R-FRIENDS-05): the one presence + inbox beat (accounts only; 60 s visible, 120 s hidden),
  // and the built-in Versus room invite. Nothing runs for a guest or without a backend.
  useEffect(() => { installFriendInvites(); return startFriendsPresence(); }, []);
  // DIRECT MESSAGES (R-DM-01): the friends hub socket while a signed-in account has the game open.
  useEffect(() => startDirectMessages(), []);
  // LIVE REPLAY (perf tool): `?livereplay=<game id>` plays a recorded game back through the real UI.
  useEffect(() => { maybeStartLiveReplayFromUrl(); }, []);
  // LIVE RANKED LOBBY GAMES (2026-10-15): list the player's ranked lobby game and publish to its watchers (only while
  // someone watches; see live/livePublisher.ts).
  useEffect(() => installLivePublisher(), []);
  // PHONE CRASH REPORTS (R-TOUCH-CRASH-REPORT-01): a crash the crash log found on this load is sent to Supabase once, on
  // idle a few seconds after mount. A no-op on desktop (unless ?crashlog=1) and without a backend.
  useEffect(() => scheduleCrashReportUpload(() => {
    const c = supabaseClient();
    return c ? (row) => c.from(CRASH_REPORT_TABLE).insert([row]) : null;
  }, () => anonRestInsert(CRASH_REPORT_TABLE)), []);
  // THE PHONE PERF + FX LOG (R-PHONE-PERFLOG-01): frames per scene, WebGL / Pixi state and the FX ledger, sent to the same
  // table when the page goes hidden (and a session never sent, on the next load). A no-op on desktop without ?perflog=1.
  useEffect(() => installPerfLog(() => {
    const c = supabaseClient();
    return c ? (row) => c.from(CRASH_REPORT_TABLE).insert([row]) : null;
  }, () => anonRestInsert(CRASH_REPORT_TABLE)), []);

  // Perf HUD: start/stop the sampler with the toggle, and feed it the game context so every logged second
  // carries what was happening (a spike is only actionable if you know the phase + wave it landed in).
  //
  // RECORDING IS NOT THE SAME THING AS SHOWING THE HUD, and conflating them is why the shared tab was empty
  // (owner report 2026-08-31: *"we are NOT getting automatically delivered results to that table"*).
  //
  // This effect used to open with `if (!perfOn) { perfMonitor.stop(); return; }` — so the sampler AND the
  // end-of-game upload below both lived behind the HUD toggle. That toggle defaults to `import.meta.env.DEV`,
  // which is FALSE in a production build — and the desktop exe is a production build. So on the client both
  // devs actually play, nothing was ever sampled and the auto-share was never even subscribed: no rows, no
  // warning, nothing to notice. The upload could not fail, because it never ran.
  //
  // The sampler is now unconditional and `perfOn` governs exactly one thing: whether the HUD is rendered
  // (see the `{perfOn && <PerfHud …>}` below). The cost is a one-second tick and a passive pointermove
  // counter, which is what the telemetry is made of — a sampler that only runs when someone remembers to
  // open a dev panel is not telemetry.
  useEffect(() => {
    perfMonitor.registerContext(() => {
      const s = useGame.getState().run;
      return { phase: s.phase, wave: s.wave, ...(s.runeforgeOffer ? { overlay: 'runeforge' } : {}) };
    });
    // Input RATE. A high-polling-rate mouse delivers pointermove far above the frame rate; when a handler
    // turns each one into a state update, the render cost is invisible without this number next to it.
    const onMove = (): void => perfMonitor.count('pointermoves');
    window.addEventListener('pointermove', onMove, { passive: true });
    // DOM nodes by container, once a second — so the 2026-09-17 leak (100 → 1,027 nodes) names its row.
    perfMonitor.setDomContainers(PERF_DOM_CONTAINERS);
    perfMonitor.start();
    // WARM-UP at every phase start (owner report 2026-09-15: the opening spike "destroys the graph"). The
    // rule for what counts as a phase start is pure and tested in `perfWarmup.ts`; this is only the wiring.
    // LOBBY BACKGROUND MUSIC (owner ask 2026-09-23): the machine in `music.ts` is store-driven and React-free;
    // this is only the wiring. It routes through the SFX module's AudioContext (its own gains → destination, never
    // the SFX mute bus) and reads a handful of booleans per store update — nothing allocates on the hot path.
    setMusicAudioContextProvider(audioContext);
    syncMusic(useGame.getState());
    const unsubMusic = useGame.subscribe((st) => syncMusic(st));
    // PHONE SFX PREWARM (R-TOUCH-AUDIO-QUALITY-01): a phone decodes the clips the game is about to need ahead of
    // their first play (the heroes on offer, the hero, the cards in play). Desktop too since R-AUDIO-MEMORY-02: it no
    // longer holds the whole bank.
    syncPhoneSfxPrewarm(useGame.getState());
    const unsubSfxPrewarm = useGame.subscribe((st) => syncPhoneSfxPrewarm(st));
    // THE ANNOUNCER (owner ask 2026-09-23): same shape as the music (store-driven, React-free, its own gain on
    // the SFX context); a Skip's `stopAllAudio` cancels its queue + the playing line through the hook.
    setAnnouncerAudioContextProvider(audioContext);
    // The voice calling the game is the announcer cosmetic the player wears (2026-10-11); none = the default.
    setAnnouncerPackProvider(equippedAnnouncerPack);
    syncAnnouncer(useGame.getState(), null);
    const unsubAnnouncer = useGame.subscribe((st, prevSt) => syncAnnouncer(st, prevSt));
    const offStopHook = onStopAllAudio(() => cancelAnnouncer('skip'));
    // Seed the FX scene from the run this screen MOUNTS on: the subscription below only sees later changes, and the
    // Game screen usually mounts with the run already in the shop (a new run, a Continue).
    setFxScene(fxSceneOf(useGame.getState().run));
    const unsubWarm = useGame.subscribe((st, prevSt) => {
      if (st.run === prevSt.run) return;
      const start = phaseStartBetween(prevSt.run, st.run);
      if (start) perfMonitor.beginWarmup(start);
      // The FX budget's SCENE (`fxBudget.ts`): the Discover overlay carries its own, lower live-particle cap
      // (`maxParticlesDiscover`), and so does the rest of the shop (`maxParticlesShop`, 2026-09-30). Told here,
      // off the run state, so the FX layer never imports the store.
      const next = fxSceneOf(st.run);
      if (next !== fxSceneOf(prevSt.run)) setFxScene(next);
    });

    /**
     * AUTO-SHARE (owner ask 2026-08-29: "uploads to supabase and drops it into a performance viewer in game
     * for us" — and, asked directly, "this will auto upload after games right?").
     *
     * **AT THE END OF A GAME**, which is what "analytics of games" means: one row per completed game, holding
     * that game's whole timeline. The first version uploaded when the tab was hidden, which produced a row
     * per SITTING rather than per game — close enough to sound right and wrong in a way that matters, since
     * a row spanning two games and a menu cannot be compared against anything.
     *
     * ONLY COMPLETED GAMES (owner ask 2026-08-30: *"i also dont want to see abandoned games in that tab, only
     * completed games"*). The first version also published on tab-hide, so a half-played game left a row too.
     * That was defensible as "capture what we can" and wrong as analytics: an abandoned run's timeline stops
     * mid-shop, its phase mix is whatever the player happened to be doing, and it sits in the list looking
     * exactly like a real game next to games that can legitimately be compared with each other.
     *
     * Nothing replaces it. A game that is not finished is not a data point, and the honest way to have fewer
     * bad rows is to stop writing them — not to write them and filter on read.
     *
     * Guarded on MIN_AUTO_SHARE_SECONDS so a reload or a quick tab-out does not publish a five-second
     * nothing, and on `isRealPlayRun` so only real games are captured.
     */
    let shared = false;
    const publish = (note: string): void => {
      if (shared) return;
      const st = useGame.getState();
      if (!isRealPlayRun(st.run)) return;        // see `isRealPlayRun` — auto-capture is real games only
      const buckets = perfMonitor.history();
      if (buckets.filter((b) => !b.hidden).length < MIN_AUTO_SHARE_SECONDS) return;
      shared = true;
      // SAY SO WHEN IT FAILS. This was fire-and-forget, which meant a dev client that recorded a whole game
      // and then could not publish it — signed out is the common one, since `uploadRun` needs a user id for
      // the insert-own RLS policy — looked identical to one that never recorded at all. The first time that
      // mattered, the question it produced was "why are none of Mike's games in the shared tab", and nothing
      // anywhere had a answer. A dev tool may fail quietly; it may not fail invisibly.
      void uploadRun(
        toRun(buckets, {
          id: `${Date.now()}`,
          startedAt: Date.now() - buckets.length * 1000,
          build: `${__APP_VERSION__}+${__BUILD_SHA__}`,
          mode: st.run?.mode,
          heroId: st.run?.heroId,
          note,
        }),
        st.playerName || 'dev',
      ).then((r) => {
        if (r.kind === 'ok') return;
        const why = r.kind === 'notReady'
          ? 'the perf_runs table does not exist yet — run schema.sql'
          : r.error;
        console.warn(`[perf] this game was recorded but NOT shared: ${why}`);
      });
    };
    // The end of the game. Subscribed to the store rather than driven by this component's `phase` prop so the
    // upload fires once on the TRANSITION, not on every render while the end screen is up.
    const unsub = useGame.subscribe((st, prevSt) => {
      const p = st.run?.phase;
      if (p === prevSt.run?.phase) return;
      if (p !== 'gameover' && p !== 'victory') return;
      // A LOBBY run (the Play button's mode) ends in `gameover` whether the seat took 1st or was knocked out —
      // the lobby owns the outcome, so the row is labelled by the seat's placement, not by the phase name.
      const placement = st.run?.lobby?.seats[0]?.placement;
      publish(placement ? `game finished — placed ${placement}` : `game ${p === 'victory' ? 'won' : 'lost'}`);
    });

    return () => {
      window.removeEventListener('pointermove', onMove);
      unsub();
      unsubWarm();
      unsubMusic();
      unsubSfxPrewarm();
      unsubAnnouncer();
      offStopHook();
      setFxScene(null);
      perfMonitor.stop();
    };
  }, []);

  // UI-hover SFX: one delegated pointerover listener for the whole app (mounted once). Plays a soft cue when
  // the pointer ENTERS a MENU / selection control — any button (title / esc-menu / leaderboard / career menus,
  // hero-select `.herocard` buttons) plus Discover options (`.disc-slot`). Deliberately silent on the in-game
  // shop/combat HUD controls (hero power, freeze, refresh, tavern-up, rift, end-turn, summary, combat skip/speed,
  // rune-forge reroll) — those are gameplay actions, not menu navigation — and on minion cards (`.card` divs),
  // dev panels, and disabled controls. Per-target enter dedupe (skips moves within the same element); no time
  // throttle, so a fast sweep ticks every element it passes.
  useEffect(() => {
    const SEL = MENU_SFX_SEL;
    const SKIP = MENU_SFX_SKIP;
    let last: Element | null = null;
    // RATE LIMIT (UI refinement WS-7, 2026-10-16): a fast sweep across a column of plaques no longer stacks a burst of
    // overlapping ticks; one tick per 45 ms at most (the research's standard practice for hover sounds).
    let lastTickAt = -1e9;
    const onOver = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;                 // hover is a mouse/pen affordance only
      let el = (e.target as Element | null)?.closest?.(SEL) ?? null;
      // An offer option (Choose One / Discover) is a `.card[role="button"]` wrapped in a `.disc-slot` — BOTH
      // match SEL. The card's plate img is `pointer-events:none`, so its overhang resolves to the SLOT while the
      // frame resolves to the inner CARD; crossing between them double-ticked one option (owner report
      // 2026-08-19). Collapse any match sitting inside a slot to the slot itself, so each option ticks once.
      if (el) el = el.closest('.disc-slot') ?? el;
      if (el === last) return;                               // still within the same target (or still on nothing)
      last = el;
      if (!el || el.closest(SKIP) || (el as HTMLButtonElement).disabled) return;
      const now = performance.now();
      if (now - lastTickAt < 45) return;
      lastTickAt = now;
      sfx.uiHover();
    };
    window.addEventListener('pointerover', onOver, { passive: true });
    return () => window.removeEventListener('pointerover', onOver);
  }, []);

  // UI-CLICK SFX: the same set of controls, on the way DOWN. Hover ticks and activation plays its own cue, but
  // the press — the tactile moment itself — was silent everywhere except the title column, which had its own
  // copy of this listener. Now that every menu button, hero card, mode card, chip and row COMPRESSES under the
  // pointer (see `.pressable` and the card commit state), the sound belongs with the compression rather than
  // after the release, and it belongs to all of them rather than one screen.
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;                 // the cue belongs to a click, not a tap
      // AN OFFER'S OPTION (a Discover card, a Choose One option, a Rune in the forge): the press plays the pick's own
      // select cue INSTEAD of the thock (owner 2026-09-24: "i want the click sound replaced by this new sound"), and
      // arms the pick that follows to stay silent (see `sfx.pickPress`). A disabled option — a Rune you can't
      // afford — stays silent, exactly as the thock did.
      const pick = (e.target as Element | null)?.closest?.('[data-pick-sfx]') ?? null;
      if (pick) {
        // A viewer (a replay, a spectator hovering the watched player's forge) never picks, so it never hears a pick.
        if (pick.closest('.app.viewing')) return;
        if (!(pick as HTMLButtonElement).disabled && !pick.classList.contains('disabled')) sfx.pickPress();
        return;
      }
      const el = (e.target as Element | null)?.closest?.(MENU_SFX_SEL) ?? null;
      if (!el || el.closest(MENU_SFX_SKIP)) return;
      if ((el as HTMLButtonElement).disabled || el.classList.contains('disabled')) return;
      sfx.clickThock();
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
  // Console handles: toggle the HUD from anywhere (dev menu, devtools) without threading state through the
  // tree, and reach the monitor itself for triage — `__perf.summary()` / `__perf.exportLog()` are the two
  // you actually want when someone reports a hitch and the HUD isn't already up.
  useEffect(() => {
    const w = window as unknown as { __perfHud?: (on?: boolean) => void; __perf?: typeof perfMonitor };
    w.__perfHud = (on = true) => setPerfOn(on);
    w.__perf = perfMonitor;
    return () => { delete w.__perfHud; delete w.__perf; };
  }, []);

  // ART PIPE, run half (art pop-in fix 2026-09-29): the run's PINNED pool, up to one tier past the tavern first.
  // Keyed on a primitive so this re-runs only when the set / tribes / tier actually move (boot queued the rest).
  const runArtKey = useGame((s) => `${s.run.setId ?? 'set1'}|${(s.run.tribes ?? []).join(',')}|${s.run.tier}`);
  useEffect(() => { preloadRunArt(useGame.getState().run); }, [runArtKey]);
  // …and build the Discover overlay's separate Pixi app on idle, so the first Discover doesn't pay a ~60-108ms
  // WebGL-context stall mid-shop (see `warmDiscoverFx`).
  // A PHONE warms neither here: no FX context lives on its menus (R-TOUCH-GPU-MEMORY-01); PixiFxLayer warms the
  // Discover layer as hero select opens, and Recruit warms the wipe on mount.
  useEffect(() => { if (!PHONE_GPU) warmDiscoverFx(); }, []);
  // A PHONE's menus shrink the stage with CSS zoom, not a transform (stage.ts, R-TOUCH-GPU-MEMORY-01). No-op on desktop.
  // THE IN-GAME MENU (R-ESC-SIDEBAR-01) is a menu too: while it is open a phone fits the stage as on the menus, so the
  // sidebar and its pages get the phone page layout instead of being cropped by the in-run zoom. Once per open / close.
  const gameMenuOpen = useGame((s) => s.gameMenuOpen);
  useEffect(() => { setStageMenuZoom((preRun && !heroPicking) || gameMenuOpen); }, [preRun, heroPicking, gameMenuOpen]);
  // …and the phone zoom (R-PHONE-ZOOM-01) only once a run is on screen: hero select keeps the plain fit.
  useEffect(() => { setStageInRun(!preRun && !heroPicking && !gameMenuOpen); }, [preRun, heroPicking, gameMenuOpen]);
  // …and the screen-wipe's Pixi canvas the same way (perf 2026-10-10). Recruit warms it on mount, which put its
  // WebGL context creation (~200-450 ms, `getContext`) in the FIRST SHOP of the session as an unlabelled long task.
  // On idle at the title it is paid before any run; Recruit's own `warm()` then finds it ready (idempotent).
  useEffect(() => {
    if (PHONE_GPU) return;
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric(() => wipeFx.warm());
    else window.setTimeout(() => wipeFx.warm(), 1500);
  }, []);

  // Frame-rate cap (Settings → Performance): push the persisted choice onto the Pixi + GSAP clocks on mount
  // and whenever it changes. See fpsCap.ts for what it can and cannot cap.
  const fpsCap = useGame((s) => s.fpsCap);
  useEffect(() => { applyFpsCap(fpsCap); }, [fpsCap]);
  // The game now fills the window at a fixed 16:9 (no resolution picker → no `data-res`), draws one board
  // (`--board` = the CSS default), and applies no readability dim — so there's no res/scrim/board state to persist.

  // Uniform stage scale: --scale = the 16:9 stage height ÷ the 1440 design reference, as a UNITLESS number the CSS
  // multiplies every authored size/offset by. Set pre-paint + on every stage change. (CSS can't turn a length into
  // a unitless ratio, hence JS.)
  //
  // It reads the LAYOUT viewport from stage.ts, not the window: below the 1920×1080 design size the game lays out
  // AT the design size and `#root` is scaled down by one transform (owner ask 2026-09-26, "when the screen shrinks
  // our art pieces fly all over the place"). So the layout viewport is never smaller than 1920×1080, --gh never
  // under 1080 and --scale never under 0.75. That retired the old phone-only reflow (gh < 600: +36% cards, a 1.3×
  // wider board, re-tuned row drops, a bigger inspect popup, tighter gaps): a phone now shows the exact desktop
  // layout, uniformly smaller, so nothing can drift against the board art. Those vars stay at their identity
  // values (styles.css still multiplies them in) so no stylesheet rule had to change.
  useLayoutEffect(() => {
    const apply = (): void => {
      const { w, h } = stageViewport();
      // Cap at 1440 to match the PINNED CSS `--gh` (min(..., 1440px)): the stage never grows past the tuned
      // 2560×1440 reference, so `--scale` tops out at 1.0 in lockstep. Without this cap the CSS stage pinned but
      // JS still drove --scale above 1.0 on tall windows, so anything mixing `--bar` position (capped) with
      // `--scale` size (uncapped) — the hero panel: portrait, Health pill, rune chains — drifted off the board.
      // THE PHONE LAYOUT (R-PHONE-LAYOUT-01): the 2:1 box, cleared of the safe area exactly as the CSS box is, so
      // `--scale` IS the box's own height / 1440 and the composition cannot drift when the insets change.
      const f = stageFit();
      const ax = Math.max(f.safe.left, f.safe.right), ay = Math.max(f.safe.top, f.safe.bottom);
      // THE PHONE ZOOM (R-PHONE-ZOOM-01) pins the box at the design height (styles.css `html[data-phone-zoom]`).
      const gh = f.zoom ? 1080 : f.aspect ? Math.min(h - 2 * ay, (w - 2 * ax) / f.aspect, 1440) : Math.min(h, (w * 9) / 16, 1440); // matches the CSS --gh
      const scale = gh / 1440;
      document.documentElement.style.setProperty('--scale', String(scale));
      // Keep the WebGL combat particles proportional to the cards ON SCREEN. The Pixi renderers stay in screen
      // space (stage.ts), so fold the stage transform in: the on-screen scale is `--scale × s`. The FX px dials
      // were tuned at the owner's ~0.745 desktop scale, so divide that reference out → 1.0 on the owner's desktop.
      pixiFx.setScale((scale * stageScale()) / 0.745);
      // The Discover overlay's own controller: identity on desktop (as before), shrunk with a scaled stage.
      discoverFx.setScale(stageScale() === 1 ? 1 : (scale * stageScale()) / 0.745);
    };
    installStage();
    apply();
    return onStageChange(apply);
  }, []);

  // Esc toggles the menu — but if the menu is closed and a card is being inspected, let the
  // inspect overlay claim Esc (it closes itself) instead of opening the menu. The Minion Book
  // also claims Esc (closes itself) before the menu would open or close.
  // IN A GAME (R-ESC-SIDEBAR-01) the menu is the sidebar over the dimmed game; Esc again closes it with any page it
  // opened. On the menus Esc opens (and closes) the Settings page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      handleEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // BUG REPORTER (PR 1): the ONE application-level Ctrl+B listener (blueprint §5.3) — mounted here at the
  // root shell, not inside Recruit. All policy (excluded surfaces, the presentationTx toast, repeat-press
  // focus) lives in the store's `openBugReport`; the modal's own capture-phase handler claims Esc/Tab while
  // it is open, so the two listeners below never fire underneath it.
  useEffect(() => installBugReportHotkey(), []);
  // THE TOUCH UI (owner 2026-10-18, R-TOUCH-UISCALE-01): on a touch device with a scaled stage only, never a mouse.
  // The hit slop is installed BEFORE touchInput so the tap it replays on a control is what touchInput sees.
  useEffect(() => {
    const offUi = installTouchUi();
    const offSlop = installTouchSlop(() => touchUi().on);
    const offKb = installTouchKeyboard(() => touchUi().on);
    return () => { offKb(); offSlop(); offUi(); };
  }, []);
  // TOUCH (owner ask 2026-09-26): a finger tap reaches everything a mouse hover reaches; tap-away closes it.
  useEffect(() => installTouchInput(), []);

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
      {/* THE BOARD, and nothing of it before a run (owner ruling 2026-08-30: "no active game should be
          displayed or happening until the player actually enters a lobby").

          `showTitle: false` used to be the only gate, but it means "the title is closed", not "a run is on
          screen" — every entry path (`startPractice`, `startLobby`) drops it just
          to open a picker. With the board mounted behind the title, that uncovered the dormant run for as
          long as the next overlay took to paint: the flash on pressing Practice.

          Unmounting rather than hiding is the point. A hidden board still runs — Recruit owns the shop clock
          and the FX canvas keeps its ticker — and the ruling is "or happening", not just "displayed". */}
      {/* SKINS (2026-09-28): every card from here to <Inspect /> is YOURS (shop, hand, board, Discover, your combat
          row, the end screen, the cast preview, the Minion Book), so it paints with your skins: the run's recorded
          ones in a run, your live loadout before one. Opponent surfaces inside (the enemy combat row, the scouted
          board) open their own scope with THEIR recorded skins. A context, not a DOM node: nothing lays out. */}
      <OwnSkins live={preRun}>
      {!preRun && (
        <>
          <Recruit key={runKey} />
          {phase === 'gameover' && <EndScreen won={false} />}
          {phase === 'victory' && <EndScreen won={true} />}
        </>
      )}
      {/* Keyed on run identity like Recruit: the StatusBar's `prevHp` ref tracks Resolve across the run to
          float a "−X" when a wave breaks through. Without a key it persists across a new-run pick, so its ref
          holds the PREVIOUS run's HP — picking a hero with lower starting HP then floats a phantom "−X". */}
      {/* WebGL effects overlay (particle impacts, flashes) — a transparent full-viewport Pixi canvas drawn over
          the board; the combat replay fires effects into it at contact points.

          Mounted from the HERO PICKER onward, not only with the board. The canvas is inert until a fire — no
          run, no clock, nothing drawn — so it is outside the 2026-08-30 ruling above, and mounting it here is
          what gives the FX shader pre-warm (`playDef.ts`'s `schedulePrewarm`, which hangs off this canvas's
          renderer) the picker + ceremony seconds to compile in. Mounted with the board instead, every link
          landed on the shop's card fly-in (a 180–420 ms hitch, measured 2026-09-01); before the pre-warm ran
          at all, on the first minion played (0.6–0.8 s). One JSX position across both states, so the canvas
          survives the picker → board transition without a detach/re-attach (which would throw its compiled
          programs away with the context).

          NOW MOUNTED FOR THE WHOLE SESSION (gameplay perf 2026-10-10). Gating it on `!preRun || heroPicking`
          unmounted it on every return to the title, and `pixiFx.detach()` destroyed the GL contexts with every
          compiled program. So EACH new run rebuilt the contexts (`getContext`, ~760 ms measured across the FX
          canvases) and relinked every shader and filter program (`getProgramParameter`, ~860 ms) as unlabelled
          75-800 ms long tasks in its first shop, which is where the owner's 2026-10-10 report put its worst frames
          ("Shop w1", the last input a pointermove). Built once, as the game mounts behind the boot splash, the
          warm-up now runs before the title is even in hand, and every later run starts warm. The canvas stays
          inert (no ticker, nothing drawn) until something fires, so this is still outside the 2026-08-30 ruling.
          `heroPicking` is no longer read here. */}
      <PixiFxLayer gameplay={!preRun || heroPicking} inRun={!preRun} />
      {!preRun && <StatusBar key={`sb:${liveRunKey}`} />}
      {/* EMOTES (owner 2026-10-13): the right-click menu on your portrait, the bubbles, and the served seats' recorded
          emotes. One per run (keyed like the StatusBar), no per-frame work. */}
      {!preRun && <EmoteLayer key={`em:${liveRunKey}`} />}
      {/* LIVE PINGS (owner 2026-10-29): the right-click ping menu and the marks on their targets. */}
      {!preRun && <PingLayer />}
      {/* The cast preview (owner ask 2026-09-23): a rune's / minion's cast spell floating above its caster — one
          fixed, input-transparent layer serving the shop and the combat replay alike. */}
      {!preRun && <CastPreviewLayer />}
      {showBook && <MinionBook />}
      <Inspect />
      {/* A Runeforge offer's tap-to-inspect view (touch only, R-TOUCH-TAPINSPECT-01): renders nothing until a finger opens it. */}
      <RuneInspect />
      </OwnSkins>
      {/* THE CORNER BUTTONS (owner asks 2026-09-28/29), right to left beside the gear: the golden book (Compendium, the
          mouse twin of the Tab key) and the golden question mark (the Compendium opened straight onto its Rules page).
          Hidden during hero select, like Tab; shown on the home screen too (styles.css). Hover names each one. */}
      {!heroPicking && (
        <button className="rulesbtn gtip" data-tip="Rules" onClick={openRules} aria-label="Rules">
          <img decoding="sync" src={rulesQuestionArt} alt="" draggable={false} />
        </button>
      )}
      {!heroPicking && (
        <button className="bookbtn gtip" data-tip="Compendium" onClick={toggleBook} aria-label="Compendium">
          <img decoding="sync" src={compendiumBookArt} alt="" draggable={false} />
        </button>
      )}
      {/* The gear wears the book's navy/gold plaque and the gold tools medallion (owner ask 2026-10-08). */}
      <button className="gearbtn gtip" data-tip={gearInGame ? 'Menu' : 'Settings'} onPointerDown={() => openMenu()} aria-label={gearInGame ? 'Menu' : 'Settings'}>
        <img decoding="sync" src={settingsArt} alt="" draggable={false} />
      </button>
      {/* Build badge above the gear — version + short git SHA, so you can tell at a glance which build is live. */}
      <div className="version" aria-description={`ASCENT v${__APP_VERSION__} · build ${__BUILD_SHA__}`}>
        v{__APP_VERSION__} <span>{__BUILD_SHA__}</span>
      </div>
      {/* DEV-only tuning menu — one 🛠️ button opening every live tuner (stripped from production). */}
      {DevMenu && <Suspense fallback={null}><DevMenu /></Suspense>}
      {/* DEV-only in-run UI editor overlay — direct-manipulation move/resize/restyle of live UI, toggled
          from the DevMenu's "UI Edit Mode" action (stripped from production). */}
      {EditorOverlay && <Suspense fallback={null}><EditorOverlay /></Suspense>}
      {/* Scene Builder control panel — mounts alongside the live sandbox run (its own title-launched mode). While
          the Stage Builder (Gauntlet authoring) is open, its board canvas + panel take the Scene Builder's place. */}
      {SandboxDevPanels && sandbox && !godMode && !liveReplay && <Suspense fallback={null}><SandboxDevPanels /></Suspense>}
      {/* Bug-scenario report side panel (PR 4) — mounts with a loaded scenario. Independent of `sandbox`:
          a content-mismatch load is READ-ONLY (the run is never entered), but its evidence still shows. */}
      {BugScenarioPanel && bugScenarioLoaded && <Suspense fallback={null}><BugScenarioPanel /></Suspense>}
      {/* Frame-health HUD. Ships in production but stays dormant unless opted into (?perf=1 /
          localStorage / the dev menu) — a slowness report is only trustworthy against the prod build. */}
      {perfOn && <PerfHud onClose={() => { setPerfFlag(false); setPerfOn(false); }} />}
      {/* DEV-ONLY (owner 2026-08-24): the Balance Report reads dev/session telemetry and must not ship in the
          exe or itch repacks, which are production `build:web` bundles where `import.meta.env.DEV` is false. */}
      {BalancePanel && <Suspense fallback={null}><BalancePanel /></Suspense>}
      {/* Bug reporter (Ctrl+B) — self-gates on `bugReportOpen` / `bugReportToast`. Pausing is Recruit's
          `overlayOpen` job, not this component's. */}
      <BugReportModal />

      {/* Topmost layers: the pre-run hero picker (self-gates on heroChoices), and above it the title
          screen (self-gates on showTitle) — the front door into Ascent / Practice / Settings. */}
      <HeroSelect />
      {/* Another player's Hero Select, watched (the stands, Live Games, a Duos teammate's choices; R-SPECTATE-HEROSELECT-01).
          After my own so it draws over it, before the launch curtain so the curtain covers it. */}
      <HeroSelectWatch />
      {/* VERSUS: a pause during Hero Select shows its veil over the picker (R-VERSUS-RELIABLE-04; self-gates). */}
      <VersusHeroSelectPause />
      {/* Practice setup: a view of the title's mode screen now (Title.tsx, R-MENU-VIEW-SWAP-01), so choosing Practice
          shifts the content beside the sidebar instead of closing the whole menu and fading a new one in. */}
      {/* The hero-select launch curtain: mounted in Game (NOT in HeroSelect) so it survives the unmount
          pickHero causes, and after HeroSelect so it z-orders above it (blueprint §7). */}
      {/* The "Good Luck" game-start intro (owner ask 2026-09-24): a dimmed board with the words over it, begun by
          the curtain right after pickHero on a lobby / Practice start. Self-gates on its own store; it holds the
          shop clock while it plays. Mounted just before the curtain, which lifts off it. */}
      <GoodLuckIntro />
      {/* DEV: the Runeforge entrance tuner's sandbox forge (▶ Play). Renders nothing until a Play is pressed. */}
      <RuneforgeEntrancePreview />
      {/* DEV: the Discover entrance tuner's sandbox Discover (▶ Play). Renders nothing until Play is pressed. */}
      <DiscoverEntrancePreview />
      <WipePreview />
      <HeroLaunchCurtain />
      <Title onSettings={openSettings} />
      {/* THE RANKED GATE (owner 2026-10-12): "Yes, let's go." slams two doors shut over the mode picker and opens
          them on hero select. Mounted here, after the Title and the picker, because it must outlive the Title:
          the swap happens behind the shut doors. Renders nothing between gates. */}
      <RankedGate />
      {/* THE IN-GAME MENU (R-ESC-SIDEBAR-01): the sidebar over the dimmed game. Before the pages, so a page opened from
          it paints over it, and `.gmenu ~ .lbpage` (styles.css) draws those pages over the game without their backdrop. */}
      <GameMenu />
      <Leaderboard />
      <Rankings />
      <RecentGames />
      <LiveGames />
      {/* The watched player's held card (SpectatorCursor) is THEIR run's card: their skins (R-PROG-SKINS-17). */}
      <RunSkins><LiveWatchBar /></RunSkins>
      <LiveJoining />
      {/* A watched game's end (owner 2026-10-24, R-SPECTATE-END-01): the end gate opens on the menu with this over it. */}
      <SpectatorEndNotice />
      {/* A friend's invite (R-FRIENDS-04): a corner notice over the menus, never over a game. */}
      <InviteNotice />
      {/* THE FRIENDS DOCK (owner 2026-10-29, R-FRIENDS-DOCK-01 / -02): ONE instance for the whole app, bottom left, on
          every screen (title, menus, hero select, every game mode, spectating, replays), so open / closed, the tab and
          an open message survive every screen change. The friends list rises out of it, a friend's direct message
          beside it. Mounted after the menu pages so it paints over them. */}
      <FriendsDock />
      {/* A direct message whose conversation is not open (R-DM-03): a small toast above the Friends button. */}
      <DmToast />
      {/* The friend menu (R-FRIENDS-MENU-01): right-click / long press on a friend row in the dock. */}
      <FriendMenu />
      <Career />
      {/* The Collection page (2026-09-28). After Career in DOM order, so a Collection opened from your Career's
          Account Level card paints on top of it and Back returns there. */}
      <CollectionScreen />
      {/* The Patch Notes page (R-PATCHNOTES-PAGE-01): a sidebar page like Settings; its changelog chunk loads on first open. */}
      <PatchNotesPage />
      {/* The Settings page (R-ESC-SIDEBAR-01): a sidebar page like the others, last so it paints over a page it opened on. */}
      <SettingsPage />
      {/* DEV: the Crate opening tuner's practice crates (▶ Common … ▶ Legendary). Local only; renders nothing until
          a Play is pressed. `VITE_CRATE_PREVIEW=1` also bakes it into a PRODUCTION bundle, only so the opening can be
          profiled on the prod build (docs/performance.md); player builds never set it. */}
      {(import.meta.env.DEV || import.meta.env.VITE_CRATE_PREVIEW === '1') && <CratePreview />}
      {/* Perf analytics — self-gates on `showPerf`, renders nothing until opened from the dev menu. */}
      <PerfScreen />
      <AvatarPicker />
      <AccountPanel />
      {/* CROSS-DEVICE SAVES: "your game moved to another device" — self-gates on `cloudMoved`, blocks the stale run. */}
      <CloudMovedModal />
      {/* REPLAY VIEWER: the round rail (left) + the transport bar. Both self-gate on `replaySession`;
          the overlay mounts LAST so the transport controls float above everything (salvaged v1 order). */}
      {/* The drag ghost self-gates on `replayDragGhost` (only ever set mid-replay) and sits UNDER the
          transport chrome — a recorded hand replaying must never cover the viewer's controls. */}
      {/* The recorded cursor sits UNDER the drag ghost: while a card flies the ghost's fist is the hand. */}
      {/* Outside the main skin scope (they stack above the board), so they open the run's own: the drag ghost is the
          recorded player's held card and wears their skin (R-PROG-SKINS-17). A context, not a DOM node. */}
      <RunSkins>
      <ReplayCursorGhost />
      {/* A replay with a recorded spectator stream draws the hand exactly as the stands did (R-REPLAY-PLAYBACK-01). */}
      {replayHasStream && <SpectatorCursor />}
      <ReplayDragGhost />
      <RoundRail />
      <ReplayOverlay />
      </RunSkins>
      {/* Tutorial coaching overlay — self-gates on a `tutorial`-mode run; renders nothing otherwise. Mounted
          at the root (a sibling of `.app`) so its focus mask floats above everything without being z-trapped
          by `.app`'s stacking context. */}
      <TutorialController />
      {/* The phone crash log's readout (R-TOUCH-PLAY-MEMORY-01): renders nothing unless `?crashlog=1` or a crash in a
          standalone phone app. Counter-scaled so it reads at full size. */}
      <CrashLogReadout />
      <PerfLogReadout />
      {PHONE_BENCH_ON && <Suspense fallback={null}><PhoneBenchCard /></Suspense>}
      {/* First-launch welcome RETIRED as an auto-popup (owner 2026-08-17): the tutorial nudge now fires when a
          new player first hits Play (see Title's `onPlay` + tutorial prompt), not on load. */}
    </ErrorBoundary>
  );
}
