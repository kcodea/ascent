import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DevPanelContext } from './useDraggablePanel';
import { useGame } from './store';
import { SfxMixer } from './SfxMixer';
import { LungeTuner } from './LungeTuner';
import { CritFxTuner } from './CritFxTuner';
import { FlurrySwingTuner } from './FlurrySwingTuner';
import { CleaveFxTuner } from './CleaveFxTuner';
import { SwapFxTuner } from './SwapFxTuner';
import { SpellPowerFxTuner } from './SpellPowerFxTuner';
import { RubyPowerFxTuner } from './RubyPowerFxTuner';
import { CardPillsTuner } from './CardPillsTuner';
import { CardArtTuner } from './CardArtTuner';
import { LobbyPanelTuner } from './LobbyPanelTuner';
import { TitleLogoTuner } from './TitleLogoTuner';
import { LoadScreenTuner } from './LoadScreenTuner';
import { HeroDuelTuner } from './HeroDuelTuner';
import { RulebookTriage } from './RulebookTriage';
import { BugBoard } from './BugBoard';
import { QaWorkbench } from './QaWorkbench';
import { TitleVeilTuner } from './TitleVeilTuner';
import { BoardEdgeTuner } from './BoardEdgeTuner';
import { SecondPowerTuner } from './SecondPowerTuner';
import { CombatRampTuner } from './CombatRampTuner';
import { SpellBuffFxTuner } from './SpellBuffFxTuner';
import { StepProcFxTuner } from './StepProcFxTuner';
import { QuestTendrilTuner } from './QuestTendrilTuner';
import { HeroBuffFxTuner } from './HeroBuffFxTuner';
import { AuraFxTuner } from './AuraFxTuner';
import { ShopDeathFxTuner } from './ShopDeathFxTuner';
import { WeldFxTuner } from './WeldFxTuner';
import { BuffFxTuner } from './BuffFxTuner';
import { InfuseFxTuner } from './InfuseFxTuner';
import { ConsumeFxTuner } from './ConsumeFxTuner';
import { AimFxTuner } from './AimFxTuner';
import { DragTuner } from './DragTuner';
import { FlipTuner } from './FlipTuner';
import { WardTuner } from './WardTuner';
import { ExecuteTuner } from './ExecuteTuner';
import { ExecuteFxTuner } from './ExecuteFxTuner';
import { TrailTuner } from './TrailTuner';
import { SmokeTuner } from './SmokeTuner';
import { FloatTuner } from './FloatTuner';
import { StepCounterTuner } from './StepCounterTuner';
import { TitleTextTuner } from './TitleTextTuner';
import { UiThemeTuner } from './UiThemeTuner';
import { LayoutTuner } from './LayoutTuner';
import { ModePickTuner } from './ModePickTuner';
import { FrameTuner } from './FrameTuner';
import { BookTuner } from './BookTuner';
import { RefreshTuner } from './RefreshTuner';
import { FreezeTuner } from './FreezeTuner';
import { HeroFxTuner } from './HeroFxTuner';
import { BuffDrawerTuner } from './BuffDrawerTuner';
import { ReplayRailTuner } from './ReplayRailTuner';
import { HeroCeremonyTuner } from './HeroCeremonyTuner';
import { ChargeGlyphTuner } from './ChargeGlyphTuner';
import { RuneforgeBgTuner } from './RuneforgeBgTuner';
import { OpponentsBackplateTuner } from './OpponentsBackplateTuner';
import { RuneSheenTuner } from './RuneSheenTuner';
import { GlowTuner } from './GlowTuner';
import { AlignArcTuner } from './AlignArcTuner';
import { CardPlateTuner } from './CardPlateTuner';
import { CardTextTuner } from './CardTextTuner';
import { PlateDissolveTuner } from './PlateDissolveTuner';
import { PlateCoalesceTuner } from './PlateCoalesceTuner';
import { PlateGildTuner } from './PlateGildTuner';
import { EndTurnTuner } from './EndTurnTuner';
import { HeroPowerTuner } from './HeroPowerTuner';
import { TavernUpTuner } from './TavernUpTuner';
import { HeroPanelTuner } from './HeroPanelTuner';
import { pixiFx } from './pixiFx';
import { perfMonitor } from './perfMonitor';
import { FxWorkbench } from './fx/ui/Workbench';
import { BeatLab } from './beatLab/BeatLab';
import { ALL_TUNER_SPECS, resetAllTuners } from './tunerAll';
import { isUiEditMode, setUiEditMode } from './uiEditor/config';

/**
 * DEV-only Dev Tuning Menu — the single 🛠️ button that indexes every tuner panel.
 *
 * The list is GROUPED by what you are tuning, filterable by typing, and driven from the keyboard. It used to
 * be 53 entries in one flat, historically-ordered column wrapped into four 174px columns (~736px wide), where
 * the two Execute panels sat 22 rows apart under the same emoji. Grouping + search is the whole point of this
 * component; the panels themselves are untouched (still draggable, still localStorage-backed).
 *
 * `key` values are LOAD-BEARING and must never change: `useDraggablePanel(key)` persists each panel's dragged
 * position under it, so renaming a key silently resets where that panel opens. Labels are free to change.
 *
 * Mounted only in dev (see Game.tsx), so the whole menu — and every tuner — is stripped from production.
 */

type Tuner = {
  key: string;
  /** Display label. Free to change; the `key` is the stable identity. */
  label: string;
  /**
   * Emoji scanning cue, unique across the tuner list. The only repeats are deliberate: each Test action in
   * "Actions" wears the same glyph as the FX it fires (✨ Spell Power, ⚡ Critical Strike, 🌬️ Flurry Swing),
   * which is a pairing rather than a collision.
   */
  icon: string;
  C: () => JSX.Element | null;
  /**
   * One line answering "what does this tune?", shown on hover and folded into search.
   * Most labels here are insider shorthand — "Weld", "Step Proc", "Trail" name the internal effect, not the
   * thing you see on the board — so the label alone can't tell you whether it's the panel you want.
   */
  hint: string;
  /** Extra search terms — old names and synonyms, so muscle memory still finds a renamed panel. */
  alt?: string;
};

type Group = { id: string; title: string; items: Tuner[] };

const GROUPS: Group[] = [
  {
    id: 'stage',
    title: 'Stage & Layout',
    items: [
      { key: 'layout', icon: '📐', label: 'Scale & Layout', C: LayoutTuner, hint: 'Global board scale and per-region card positions' },
      { key: 'frame', icon: '🖼️', label: 'Card Frames', C: FrameTuner, hint: 'The gold oval on minions and purple square on spells' },
      { key: 'cardplate', icon: '🂠', label: 'Card Plate', C: CardPlateTuner, hint: "The hand card's backplate geometry" },
      { key: 'cardtext', icon: '🔤', label: 'Card Text', C: CardTextTuner, hint: 'Where the rules-text box sits on a card' },
      { key: 'cardpills', icon: '🏷️', label: 'Card Pills', C: CardPillsTuner, hint: 'Cost coin, tier badge, attack and health badges' },
      { key: 'cardart', icon: '🖌️', label: 'Card Art', C: CardArtTuner, hint: "One card's illustration: framing inside the window, plus hue/saturation/contrast" },
      { key: 'heropanel', icon: '🧍', label: 'Hero Panel', C: HeroPanelTuner, hint: 'The bottom-left hero tray' },
      { key: 'lobbypanel', icon: '🪑', label: 'Lobby Rail', C: LobbyPanelTuner, hint: 'The 8-seat table down the right edge' },
      { key: 'opponentsbackplate', icon: '🖼️', label: 'Opponents Backplate', C: OpponentsBackplateTuner, hint: 'The gilded frame art behind the lobby rail', alt: 'lobby rail backdrop backplate frame' },
      { key: 'secondpower', icon: '👥', label: 'Second Power', C: SecondPowerTuner, hint: "Void's second hero-power button — offset + scale", alt: 'void twin power position' },
      { key: 'boardedge', icon: '🌫️', label: 'Board Edge', C: BoardEdgeTuner, hint: 'The colour the board fades into on an ultrawide (wider than 16:9) window', alt: 'ultrawide margin side blend' },
      { key: 'modepick', icon: '🎛️', label: 'Play Mode Screen', C: ModePickTuner, hint: 'The MODE picker — each card, the art inside it, and the MODE title', alt: 'play screen mode picker' },
      { key: 'buffdrawer', icon: '🧪', label: 'Buffs Panel', C: BuffDrawerTuner, hint: 'The run-buffs pop-out' },
      { key: 'replayrail', icon: '🎞️', label: 'Replay Rail', C: ReplayRailTuner, hint: 'The replay round rail + metrics dock' },
      { key: 'heroceremony', icon: '🎭', label: 'Hero Ceremony', C: HeroCeremonyTuner, hint: 'The hero-select ceremony timeline — every delay and duration from click to Start Game', alt: 'hero select ceremony timing' },
      { key: 'book', icon: '📖', label: 'Compendium Palette', C: BookTuner, hint: 'Colours and scale of the card browser' },
      { key: 'runeforgebg', icon: '🪨', label: 'Runeforge Backdrop', C: RuneforgeBgTuner, hint: 'Size and position of the art behind the forge menus', alt: 'rune forge background' },
      { key: 'runesheen', icon: '💠', label: 'Rune Sheen', C: RuneSheenTuner, hint: 'The glossy overlay on the owned-rune nodes' },
      { key: 'titlelogo', icon: '🏔️', label: 'Title Logo', C: TitleLogoTuner, hint: 'The main-menu peak mark + ASCENT wordmark — size, spacing, and position', alt: 'main menu title wordmark' },
      { key: 'titleveil', icon: '🌒', label: 'Title Veil', C: TitleVeilTuner, hint: 'The dark navy gradient behind the main menu — colour, intensity and the bowed clear zone over the floating city', alt: 'main menu background darken vignette overlay' },
      { key: 'loadscreen', icon: '⏳', label: 'Load Screen', C: LoadScreenTuner, hint: 'The boot splash — resize the AscentIcon and size/position the loading bar. "Toggle load screen" re-shows it live', alt: 'boot loading splash screen' },
      { key: 'heroduel', icon: '⚔️', label: 'Hero Duel', C: HeroDuelTuner, hint: 'The post-combat sequence — foe portrait, attack pill, and the winning hero lunge. Has Test buttons', alt: 'combat end hero attack strike pill' },
    ],
  },
  {
    id: 'buttons',
    title: 'Buttons',
    items: [
      { key: 'refreshbtn', icon: '🔄', label: 'Refresh', C: RefreshTuner, hint: 'The refresh crystal', alt: 'reroll' },
      { key: 'freezebtn', icon: '❄️', label: 'Freeze', C: FreezeTuner, hint: "The freeze button's placement" },
      { key: 'herofx', icon: '🃏', label: 'Hero Card FX', C: HeroFxTuner, hint: "Ayse's Enchanted glow + Sable's Soulbind ring" },
      { key: 'endturnbtn', icon: '💎', label: 'End Turn', C: EndTurnTuner, hint: 'The standalone End Turn diamond', alt: 'face the omen' },
      { key: 'heropowerbtn', icon: '💠', label: 'Hero Power', C: HeroPowerTuner, hint: 'The hero power diamond' },
      { key: 'tavernupbtn', icon: '🍺', label: 'Tavern Up', C: TavernUpTuner, hint: 'The tavern-upgrade stone button', alt: 'upgrade tier' },
    ],
  },
  {
    id: 'feel',
    title: 'Card Feel',
    items: [
      { key: 'drag', icon: '🎴', label: 'Drag Feel', C: DragTuner, hint: 'Weight, tilt and lag while dragging a card' },
      { key: 'flip', icon: '🔀', label: 'Reposition', C: FlipTuner, hint: 'The slide when cards make room or close a gap', alt: 'flip slide reorder' },
      { key: 'glow', icon: '🔆', label: 'Hover Glow', C: GlowTuner, hint: 'The bright rim when you hover or select a card' },
      { key: 'alignarc', icon: '🌗', label: 'Alignment Arc', C: AlignArcTuner, hint: 'The Celestial Dawn/Dusk crescent beneath each minion' },
    ],
  },
  {
    id: 'strikes',
    title: 'Strikes',
    items: [
      { key: 'lunge', icon: '🗡️', label: 'Lunge', C: LungeTuner, hint: "The attacker's lunge into its target" },
      { key: 'speedramp', icon: '⏩', label: 'Speed Ramp', C: CombatRampTuner, hint: 'The auto speed-up curve during combat — grace, ramp-up, ceiling, ease-down', alt: 'combat replay pacing auto ramp' },
      { key: 'critfx', icon: '⚡', label: 'Critical Strike', C: CritFxTuner, hint: 'The crimson-gold crit flourish', alt: 'crit fx' },
      { key: 'flurryswing', icon: '🌬️', label: 'Flurry Swing', C: FlurrySwingTuner, hint: "The wind-slash sparkle on a Flurry minion's extra swing", alt: 'windfury' },
      { key: 'cleavefx', icon: '🪓', label: 'Cleave Slash', C: CleaveFxTuner, hint: 'The hit-stop and red gash a Cleave attacker plays' },
      { key: 'executefx', icon: '🩸', label: 'Execute Strike', C: ExecuteFxTuner, hint: 'The one-shot crescent slash when Execute kills', alt: 'venomous poison' },
    ],
  },
  {
    id: 'buffs',
    title: 'Buffs & Auras',
    items: [
      { key: 'bufffx', icon: '⬆️', label: 'Buff', C: BuffFxTuner, hint: 'What plays on a minion when something buffs it', alt: 'stat gain' },
      { key: 'spellbufffx', icon: '🔮', label: 'Spell Buff', C: SpellBuffFxTuner, hint: "The cue when a spell or Ruby's printed value goes up" },
      { key: 'spellpowerfx', icon: '✨', label: 'Spell Power', C: SpellPowerFxTuner, hint: 'The flourish when a spell resolves' },
      { key: 'rubypowerfx', icon: '♦️', label: 'Ruby Power', C: RubyPowerFxTuner, hint: 'The Ruby-strength flourish', alt: 'gem' },
      { key: 'herobufffx', icon: '🎆', label: 'Hero Buff Flash', C: HeroBuffFxTuner, hint: 'The shard blast and ripple over the hero portrait' },
      { key: 'aurafx', icon: '🌊', label: 'Aura Wave', C: AuraFxTuner, hint: 'The run-wide tribe-aura wave across the board' },
      { key: 'infusefx', icon: '🍖', label: 'Fodder Infusion', C: InfuseFxTuner, hint: 'The tendrils that send Fodder to the shop', alt: 'consume' },
      { key: 'consumefx', icon: '🍖', label: 'Consume FX', C: ConsumeFxTuner, hint: 'The eaten-minion shake / taffy / pull + bands' },
      { key: 'weldfx', icon: '🔩', label: 'Weld', C: WeldFxTuner, hint: 'An Attachment fusing onto its host minion', alt: 'magnetize attach' },
      { key: 'shopdeathfx', icon: '💀', label: 'Shop Death & Echo', C: ShopDeathFxTuner, hint: 'Deaths and Echo bursts in the shop — timings, position, and how long a borrowed minion lingers', alt: 'destroy funeral graverobber deathrattle' },
    ],
  },
  {
    id: 'counters',
    title: 'Counters & Progress',
    items: [
      { key: 'stepprocfx', icon: '🧮', label: 'Step Proc', C: StepProcFxTuner, hint: 'The flourish when a step counter fills' },
      { key: 'stepcounter', icon: '📈', label: 'Step Counter', C: StepCounterTuner, hint: 'The X/N numbers under a step-scaler card' },
      { key: 'titletext', icon: '🔤', label: 'Title Text', C: TitleTextTuner, hint: 'Reword the front page — wordmark and every menu plaque' },
      { key: 'uitheme', icon: '🎨', label: 'UI Theme', C: UiThemeTuner, hint: 'Colour scheme for the glass surfaces — 10 stock presets' },
      { key: 'questtendril', icon: '🏆', label: 'Quest Tendril', C: QuestTendrilTuner, hint: 'The gold ribbon a quest or rune reward throws' },
      { key: 'chargeglyph', icon: '🔋', label: 'Charge Glyph', C: ChargeGlyphTuner, hint: 'The end-of-turn charge glyph' },
    ],
  },
  {
    id: 'plate',
    title: 'Plate FX',
    items: [
      { key: 'platedissolve', icon: '🌀', label: 'Dissolve', C: PlateDissolveTuner, hint: "What plays when a hand card's backplate leaves", alt: 'plate' },
      { key: 'platecoalesce', icon: '🪄', label: 'Coalesce', C: PlateCoalesceTuner, hint: 'What plays when a card is generated into hand', alt: 'plate' },
      { key: 'plategild', icon: '👑', label: 'Gild', C: PlateGildTuner, hint: 'Three copies combining into a gilded card', alt: 'plate golden triple' },
    ],
  },
  {
    id: 'status',
    title: 'Status & World',
    items: [
      { key: 'ward', icon: '🔵', label: 'Ward Dome', C: WardTuner, hint: 'The glassy energy shell on a warded card', alt: 'divine shield' },
      { key: 'execute', icon: '☠️', label: 'Execute Aura', C: ExecuteTuner, hint: 'The rage aura on an Execute minion', alt: 'venomous poison' },
      { key: 'swapfx', icon: '↔️', label: 'Swap', C: SwapFxTuner, hint: 'The Displacement exchange arrows', alt: 'displacement' },
      { key: 'trail', icon: '🌠', label: 'Trail', C: TrailTuner, hint: 'The wisp trail behind a moving card' },
      { key: 'smoke', icon: '🌫️', label: 'Strike pulse', C: SmokeTuner, hint: 'The energy rings that ripple out of a melee clack', alt: 'smoke dust impact' },
      { key: 'float', icon: '🔢', label: 'Damage Float', C: FloatTuner, hint: 'The −N pills that pop over a struck unit' },
      { key: 'aimfx', icon: '🎯', label: 'Hero Aim', C: AimFxTuner, hint: 'The targeting line and its activation spark' },
    ],
  },
  {
    id: 'audio',
    title: 'Audio',
    items: [{ key: 'sfx', icon: '🎛️', label: 'Mixing Desk', C: SfxMixer, hint: 'Per-sample volumes, buses and compression', alt: 'sfx sound volume' }],
  },
];

const ALL: Tuner[] = GROUPS.flatMap((g) => g.items);

/** One-shot actions — they fire or open something rather than toggling a persistent panel. */
type Action = { id: string; icon: string; label: string; hint: string; run: () => void; live?: () => boolean };

export function DevMenu() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [wbOpen, setWbOpen] = useState(false);
  const [blOpen, setBlOpen] = useState(false);
  const [rbOpen, setRbOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const toggle = (key: string): void =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Close one tuner panel — invoked by that panel's ✕ button (via DevPanelContext). No-op if already closed.
  // Individual panels close ONLY via their ✕, or via "Close all" below; a click outside them does NOT dismiss.
  const close = useCallback((key: string): void =>
    setShown((s) => { if (!s.has(key)) return s; const n = new Set(s); n.delete(key); return n; }), []);

  const actions: Action[] = useMemo(() => [
    { id: 'perf', icon: '📊', label: 'Perf HUD', hint: 'Frame-health overlay — also available in prod via ?perf=1',
      run: () => (window as unknown as { __perfHud?: (on?: boolean) => void }).__perfHud?.(!perfMonitor.isRunning),
      live: () => perfMonitor.isRunning },
    { id: 'testfx', icon: '✨', label: 'Test FX', hint: 'Fire the spell-power flourish once on the board', run: () => pixiFx.test() },
    { id: 'testcrit', icon: '⚡', label: 'Test Crit', hint: 'Fire the critical-strike flourish once', run: () => pixiFx.testCrit() },
    { id: 'testflurry', icon: '🌬️', label: 'Test Flurry', hint: 'Fire the flurry wind-slash once', run: () => pixiFx.testFlurry() },
    { id: 'workbench', icon: '🎨', label: 'FX Workbench', hint: 'Author effects and bind them to combat moments', run: () => setWbOpen(true) },
    { id: 'uiedit', icon: '🎛️', label: 'UI Edit Mode', hint: 'Direct-manipulation editor for in-run UI',
      run: () => setUiEditMode(!isUiEditMode()), live: () => isUiEditMode() },
    { id: 'beatlab', icon: '🥁', label: 'Beat Lab', hint: 'Read-only viewer: the source-attributed trigger/consequence tree of the last action', run: () => setBlOpen(true) },
    { id: 'rulebook', icon: '📜', label: 'Rulebook Triage', hint: "The owner's ruling board — Doc Bot's queues as clickable Approve/Revise/Reject cards; clicks write decisions.json", run: () => setRbOpen(true) },
    { id: 'bugboard', icon: '🐛', label: 'Bug Board', hint: 'The bug inbox — triage player reports, hand-pick a stack, send the work order to Claude', run: () => setBugOpen(true) },
    { id: 'qaworkbench', icon: '🔬', label: 'QA Workbench', hint: "Doc Bot's review surface — findings inbox, content detail, trace comparison, interaction matrix, text queue", run: () => setQaOpen(true) },
    // Destructive and irreversible, so it asks first and names the number — and it says what it does NOT touch,
    // because "reset the tuners" could reasonably be read as including the audio levels.
    {
      id: 'resetall', icon: '♻️', label: 'Reset all tuners',
      hint: `Put every one of the ${ALL_TUNER_SPECS.length} tuner panels back to its shipped values`,
      run: () => {
        const ok = window.confirm(
          `Reset all ${ALL_TUNER_SPECS.length} tuner panels to the shipped values?\n\n`
          + 'Every value you have dialled on this machine is discarded — across every panel, not just the open '
          + 'ones. This cannot be undone.\n\n'
          + 'The SFX Mixing Desk is not affected.',
        );
        if (ok) resetAllTuners();
      },
    },
  ], []);

  // Filter across label, group title and the `alt` synonyms, so an old name still finds its panel.
  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!needle) return GROUPS;
    return GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((t) =>
          `${t.label} ${t.hint} ${t.alt ?? ''} ${g.title}`.toLowerCase().includes(needle)),
      }))
      .filter((g) => g.items.length > 0);
  }, [needle]);

  const visibleActions = useMemo(
    () => (needle ? actions.filter((a) => `${a.label} ${a.hint}`.toLowerCase().includes(needle)) : actions),
    [actions, needle],
  );

  // The keyboard walks ONE flat sequence over whatever is currently visible: tuners first, then actions.
  const flat = useMemo(
    () => [
      ...groups.flatMap((g) => g.items.map((t) => ({ kind: 'tuner' as const, id: t.key }))),
      ...visibleActions.map((a) => ({ kind: 'action' as const, id: a.id })),
    ],
    [groups, visibleActions],
  );

  useEffect(() => { setCursor(0); }, [needle]);
  useEffect(() => { if (open) searchRef.current?.focus(); else { setQ(''); setCursor(0); } }, [open]);

  // Keep the highlighted row in view while arrowing through a scrolling list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('.devmenu-item.cursor')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const activate = (i: number): void => {
    const hit = flat[i];
    if (!hit) return;
    if (hit.kind === 'tuner') toggle(hit.id);
    else actions.find((a) => a.id === hit.id)?.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); activate(cursor); }
  };

  // Click-outside closes the DEV TUNING DROPDOWN itself (not the tuner panels): a pointerdown outside the menu
  // and its 🛠️ toggle collapses the list. Only active while the dropdown is open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (t?.closest('.devmenu, .devmenu-btn')) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  let row = -1; // running index into `flat`, so each rendered row knows its keyboard position

  return (
    <>
      {/* The emoji IS the label, so the button needs a real accessible name — `title` alone is not reliably
          announced, and "hammer and wrench" is what a screen reader would otherwise read out. */}
      <button
        className={`devmenu-btn${shown.size ? ' has-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={shown.size
          ? `Dev tuning menu, ${shown.size} panel${shown.size === 1 ? '' : 's'} open`
          : 'Dev tuning menu'}
        aria-expanded={open}
        title={shown.size ? `Dev tuning menu — ${shown.size} panel${shown.size === 1 ? '' : 's'} open` : 'Dev tuning menu'}
      >
        <span aria-hidden>🛠️</span>
        {shown.size > 0 && <span className="devmenu-count" aria-hidden>{shown.size}</span>}
      </button>
      {open && (
        <div className="devmenu" onKeyDown={onKeyDown}>
          <div className="devmenu-top">
            <input
              ref={searchRef}
              className="devmenu-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${ALL.length} tuners…`}
              spellCheck={false}
            />
            {shown.size > 0 && (
              <button className="devmenu-closeall" onClick={() => setShown(new Set())} title="Close every open tuner panel">
                Close all ({shown.size})
              </button>
            )}
          </div>

          <div className="devmenu-list" ref={listRef}>
            {groups.map((g) => (
              <div className="devmenu-group" key={g.id}>
                <div className="devmenu-gh">{g.title}</div>
                {g.items.map((t) => {
                  row += 1;
                  const i = row;
                  return (
                    <button
                      key={t.key}
                      className={`devmenu-item${shown.has(t.key) ? ' on' : ''}${i === cursor ? ' cursor' : ''}`}
                      onPointerEnter={() => setCursor(i)}
                      onClick={() => toggle(t.key)}
                      title={t.hint}
                      aria-pressed={shown.has(t.key)}
                    >
                      <span className="devmenu-ic" aria-hidden>{t.icon}</span>
                      <span className="devmenu-lb">{t.label}</span>
                      <span className="devmenu-tick" aria-hidden>{shown.has(t.key) ? '✓' : ''}</span>
                    </button>
                  );
                })}
              </div>
            ))}

            {visibleActions.length > 0 && (
              <div className="devmenu-group" key="actions">
                <div className="devmenu-gh">Actions</div>
                {visibleActions.map((a) => {
                  row += 1;
                  const i = row;
                  return (
                    <button
                      key={a.id}
                      className={`devmenu-item action${i === cursor ? ' cursor' : ''}${a.live?.() ? ' on' : ''}`}
                      onPointerEnter={() => setCursor(i)}
                      onClick={a.run}
                      title={a.hint}
                    >
                      <span className="devmenu-ic" aria-hidden>{a.icon}</span>
                      <span className="devmenu-lb">{a.label}</span>
                      <span className="devmenu-tick" aria-hidden>{a.live?.() ? '✓' : '▸'}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* An empty state has to offer the way out, not just report the dead end. */}
            {groups.length === 0 && visibleActions.length === 0 && (
              <div className="devmenu-empty">
                Nothing matches “{q.trim()}”.
                <button className="devmenu-clear" onClick={() => { setQ(''); searchRef.current?.focus(); }}>
                  Clear search
                </button>
              </div>
            )}
          </div>

          {/* Spelled out rather than glyph-only, and "select" because Enter opens or closes a panel in the
              groups above but FIRES a one-shot in Actions — "toggle" was only true for one of the two. */}
          <div className="devmenu-foot">↑ ↓ move · Enter select · Esc close</div>
        </div>
      )}
      <DevPanelContext.Provider value={{ close }}>
        {ALL.map(({ key, C }) => (shown.has(key) ? <C key={key} /> : null))}
      </DevPanelContext.Provider>
      {/* Outside the provider on purpose: `DevPanelContext` exists so a DRAGGABLE tuner panel's ✕ can close
          itself by key (see `useDraggablePanel`). The workbench is a full-screen overlay that owns its own
          close, doesn't use that hook, and has no key in the groups above — wrapping it would imply a
          relationship it doesn't have. */}
      {wbOpen && <FxWorkbench onClose={() => setWbOpen(false)} />}
      {blOpen && <BeatLab onClose={() => setBlOpen(false)} />}
      {rbOpen && <RulebookTriage onClose={() => setRbOpen(false)} />}
      {bugOpen && <BugBoard onClose={() => setBugOpen(false)} />}
      {qaOpen && <QaWorkbench onClose={() => setQaOpen(false)} />}
      <BeatDraftBanner />
    </>
  );
}

/**
 * CHOREOGRAPHER PR 19 — the persistent "unsaved timings are pacing the real game" banner (blueprint §15).
 * Rendered by the DevMenu (always mounted in DEV) rather than the Lab, so it stays visible after the Lab
 * closes — the whole workflow is tune → close → play a real turn, and the banner is what keeps "why does the
 * game feel different" from ever being a mystery. Click it to turn the override off.
 */
function BeatDraftBanner(): React.ReactElement | null {
  const live = useGame((s) => s.beatDraftLive);
  const draft = useGame((s) => s.beatDraft);
  const setLive = useGame((s) => s.setBeatDraftLive);
  if (!live || !draft) return null;
  const n = Object.keys(draft.timings).length + Object.keys(draft.policies).length;
  return (
    <button
      onClick={() => setLive(false)}
      title="Uncommitted Beat Lab draft is pacing End of Turn. Click to disable."
      style={{
        position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 100001,
        background: 'rgba(224,179,77,0.92)', color: '#1a1408', border: '1px solid #8a6d1f', borderRadius: 6,
        font: '700 11px/1.6 ui-monospace, Consolas, monospace', padding: '2px 10px', cursor: 'pointer',
        letterSpacing: '0.06em',
      }}
    >
      ● DEV BEAT OVERRIDES ACTIVE — {n} draft key{n === 1 ? '' : 's'} pacing End of Turn (click to disable)
    </button>
  );
}
