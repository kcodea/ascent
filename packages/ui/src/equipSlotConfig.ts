import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV tuner for the EQUIPMENT SLOT — the seat, the frame around it, the three floating readouts, and the
 * selector rail (owner asks 2026-08-28: "I want a tuner for the equipment slot… i'll tune the sizing/space
 * for it", then "add the size/position of this art in relation to the equipment button. add customization for
 * the cost pill and name pill size/positioning so i can lock that in as well", then "add a tuner for that so
 * i can change the positioning and size of the equipment changer").
 *
 * ── Why one panel and not four ────────────────────────────────────────────────────────────────────────────
 *
 * Every dial here answers the same question — where does this sit relative to the Equipment button — and they
 * are judged against each other, not in isolation: the cost pill's seat only means anything once the frame is
 * placed, because it is being dropped into the frame's boss. Splitting them across panels would mean dragging
 * two windows around to compare two numbers. They are GROUPED instead, which the TunerPanel renders as
 * headings.
 *
 * ── Why this slot is separate from the second hero power ──────────────────────────────────────────────────
 *
 * Equipment first shipped riding the `.heropanel2` seat with a `.beside` nudge, on the assumption that a hero
 * rarely has a second power. Void has TWO, and the pair collided the moment one appeared. A borrowed seat also
 * meant nudging the Second Power tuner silently moved Equipment, which is not something either dial says it
 * does. So Equipment gets `--eqs-*` of its own.
 *
 * Offsets are reference px at the 1440 stage — the CSS multiplies by `--scale`, so every seat holds its place
 * at each resolution (the ceremony-layout rule the rest of the HUD follows).
 */
export interface EquipSlotConfig {
  // ── The seat ────────────────────────────────────────────────────────────────────────────────────────────
  /** Horizontal offset from the hero panel's seat (reference px; positive = right). */
  x: number;
  /** Vertical offset (reference px; positive = down, so ABOVE the hero is negative). */
  y: number;
  /** Uniform scale on the whole Equipment block. */
  scale: number;

  // ── The frame (EquipmentFrame.png) ──────────────────────────────────────────────────────────────────────
  /** 1 draws the frame around the button, 0 leaves the bare circle it shipped with. */
  frameOn: number;
  /** Frame offset from the button's centre (reference px). */
  frameX: number;
  frameY: number;
  /** Frame size as a multiple of the button's own box — 1 means exactly as wide as the button. */
  frameScale: number;
  /** 1 puts the frame BEHIND the art (a backing plate), 0 in front of it (a surround the art sits under). */
  frameBehind: number;

  // ── Arriving and leaving ────────────────────────────────────────────────────────────────────────────────
  /** ms the slot takes to fade IN when an Equipment is acquired. */
  fadeInMs: number;
  /**
   * ms the slot takes to fade OUT when the last source dies or is sold (owner ask 2026-08-28: "add a brief
   * fade in/fade out for the equipment so it doesn't simply disappear immediately").
   *
   * This one is load-bearing beyond the look: the panel renders off `run.equipment`, so the leaving copy is
   * kept alive by a timer of exactly this length. Lower it and the fade is cut short; raise it and a stale
   * picture of a lost Equipment lingers on screen. `StatusBar` reads it at the moment the Equipment goes, so
   * the timer and the CSS can never disagree.
   */
  fadeOutMs: number;

  // ── The sheen ───────────────────────────────────────────────────────────────────────────────────────────
  /** 1 sweeps a band of light across the Equipment ART when the slot's picture changes, 0 never. */
  sheenOn: number;
  /**
   * ms relative to the SLOT BURST — negative fires the sheen EARLIER than the burst, positive later.
   *
   * Anchored to the burst rather than to the cue so "earlier" means something: the cue is time zero, and an
   * offset before it could only clamp. The burst is the moment the icon lands, which is what the sheen is
   * reacting to.
   */
  sheenDelayMs: number;
  /** How long the band takes to cross. Lower is faster. */
  sheenSpeedMs: number;
  /** Band width as a percentage of the art circle — a wide band reads as a wash, a narrow one as a glint. */
  sheenSize: number;
  /** 0 sweeps left → right, 1 right → left. */
  sheenDir: number;
  /** 1 plays the sheen clip, 0 silences it. */
  sheenSfxOn: number;
  /** Volume of the sheen clip, as a multiple of its normal level. */
  sheenSfxVolume: number;
  /** ms relative to the SLOT BURST for the clip — negative is earlier, same anchor as the visual. */
  sheenSfxDelayMs: number;

  // ── The three floating readouts ─────────────────────────────────────────────────────────────────────────
  /** Gold cost — the frame has a round boss at its top-left that this is meant to drop into. */
  costX: number;
  costY: number;
  costScale: number;
  /** The Equipment's name — the frame has a plaque along its bottom edge. */
  nameX: number;
  nameY: number;
  nameScale: number;
  /** Uses left this turn. Tunable for the same reason the other two are: the frame moved under it. */
  usesX: number;
  usesY: number;
  usesScale: number;

  // ── The selector rail ───────────────────────────────────────────────────────────────────────────────────
  /** Rail offset from the slot (reference px) — X is the gap out to its right, Y raises or lowers it. */
  railX: number;
  railY: number;
  /** Rail size. */
  railScale: number;
  /**
   * Volume of the pick sound, as a multiple of the clip's normal level (owner ask 2026-08-28: "i added an sfx
   * for equipment select when a new equipment is picked from the rail. can you add its volume to the
   * equipment slot tuner").
   *
   * Applied ON TOP of the category and per-clip gains in `audio/config`, so muting the UI bus still mutes it
   * and this dial only decides how loud the pick reads against the rest of the slot's sounds. 0 silences it.
   */
  selectVolume: number;
  /**
   * How long the rail LINGERS after the pointer leaves, in ms.
   *
   * Owner report: "it needs more leeway on moving the mouse over to the panel to select an equipment. it fades
   * before i can mouse over an option every single time." Two things fixed that and this is the second — the
   * first is that the gap between slot and rail is now part of the rail's own hover box rather than dead
   * space, so crossing it no longer drops the hover at all. The grace period covers the rest: leaving the
   * slot's corner diagonally, or overshooting the rail and coming back.
   */
  railGraceMs: number;
}

/**
 * THE OWNER'S TUNED VALUES, baked 2026-08-28 — these are shipped placement, not starting guesses. The seat
 * moved a long way left and up from where it was first dropped; the frame, cost pill and name pill were all
 * judged correct as authored and kept at their neutral offsets, so a zero here means "measured and left
 * alone", not "never looked at".
 */
const DEFAULTS: EquipSlotConfig = {
  x: -248, y: -260, scale: 0.99,

  frameOn: 1, frameX: 0, frameY: 0, frameScale: 1.42, frameBehind: 0,

  // "Brief" — long enough not to pop, short enough that a sold minion's slot is gone before the next click.
  // Out is slower than in: arriving is one of several things happening at once on a play, while leaving is
  // the only thing moving and reads as abrupt at the same speed.
  fadeInMs: 180, fadeOutMs: 260,

  // Lands just after the icon does, and crosses briskly — it is a reaction to the new art, not a flourish of
  // its own. Sized as a glint rather than a wash so the art stays readable underneath.
  sheenOn: 1, sheenDelayMs: 60, sheenSpeedMs: 620, sheenSize: 38, sheenDir: 0,
  sheenSfxOn: 1, sheenSfxVolume: 0.5, sheenSfxDelayMs: 60,

  costX: 0, costY: 0, costScale: 1,
  nameX: 0, nameY: 0, nameScale: 1,
  usesX: 0, usesY: 0, usesScale: 1.29,

  railX: 10, railY: 0, railScale: 1.18,
  // 320 → 80 (owner tuning, 2026-08-31). The generous grace was set when a rail that vanished early was the
  // bug being fixed; with the rail's placement settled, a quarter-second of lingering reads as the menu
  // refusing to close. Still non-zero, so crossing the gap between the button and the rail does not drop it.
  railGraceMs: 80,
  // Well under the clip's own level: the pick is a confirmation, not an event. It fires on a hover-menu
  // click, so it is the one sound here a player can trigger repeatedly while just browsing.
  selectVolume: 0.3,
};

const RANGES: Record<keyof EquipSlotConfig, [number, number, number]> = {
  x: [-400, 500, 1],
  y: [-500, 300, 1],
  scale: [0.4, 1.6, 0.01],

  frameOn: [0, 1, 1],
  frameX: [-120, 120, 1],
  frameY: [-120, 120, 1],
  frameScale: [0.8, 2.6, 0.01],
  frameBehind: [0, 1, 1],

  fadeInMs: [0, 900, 10],
  fadeOutMs: [0, 900, 10],

  sheenOn: [0, 1, 1],
  sheenDelayMs: [-400, 900, 10],
  sheenSpeedMs: [120, 2000, 10],
  sheenSize: [10, 120, 1],
  sheenDir: [0, 1, 1],
  sheenSfxOn: [0, 1, 1],
  sheenSfxVolume: [0, 2, 0.05],
  sheenSfxDelayMs: [-400, 900, 10],

  costX: [-160, 160, 1],
  costY: [-160, 160, 1],
  costScale: [0.3, 2.2, 0.01],
  nameX: [-160, 160, 1],
  nameY: [-160, 160, 1],
  nameScale: [0.3, 2.2, 0.01],
  usesX: [-160, 160, 1],
  usesY: [-160, 160, 1],
  usesScale: [0.3, 2.2, 0.01],

  railX: [-40, 260, 1],
  railY: [-200, 200, 1],
  railScale: [0.5, 1.8, 0.01],
  railGraceMs: [0, 1200, 20],
  selectVolume: [0, 2, 0.05],
};

export { DEFAULTS as EQUIP_SLOT_DEFAULTS };

const KEY = 'ascent.equipslot';

let cfg: EquipSlotConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<EquipSlotConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getEquipSlotConfig(): EquipSlotConfig {
  return cfg;
}

/** CSS var name per dial — one map, so `applyEquipSlotVars` cannot drift from the stylesheet. */
const VARS: Record<keyof EquipSlotConfig, string> = {
  x: '--eqs-x', y: '--eqs-y', scale: '--eqs-scale',
  frameOn: '--eqf-on', frameX: '--eqf-x', frameY: '--eqf-y', frameScale: '--eqf-scale',
  frameBehind: '--eqf-behind',
  fadeInMs: '--eqs-fade-in', fadeOutMs: '--eqs-fade-out',
  sheenSpeedMs: '--eqsh-speed', sheenSize: '--eqsh-size', sheenDir: '--eqsh-dir',
  // Read at FIRE time by StatusBar / sfx, not painted (see the empty entries at the end of VARS).
  sheenOn: '', sheenDelayMs: '', sheenSfxOn: '', sheenSfxVolume: '', sheenSfxDelayMs: '',
  costX: '--eqc-x', costY: '--eqc-y', costScale: '--eqc-scale',
  nameX: '--eqn-x', nameY: '--eqn-y', nameScale: '--eqn-scale',
  usesX: '--equ-x', usesY: '--equ-y', usesScale: '--equ-scale',
  railX: '--eqr-x', railY: '--eqr-y', railScale: '--eqr-scale', railGraceMs: '--eqr-grace',
  // Read at FIRE time by `sfx.equipmentSelect`, not painted — there is nothing for CSS to do with a volume.
  selectVolume: '',
};

export function applyEquipSlotVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const [key, v] of Object.entries(VARS) as [keyof EquipSlotConfig, string][]) {
    if (!v) continue; // a dial the stylesheet has no use for (see VARS)
    // The timing dials are the ones the stylesheet needs a UNIT on — they feed durations and delays.
    const ms = key === 'railGraceMs' || key === 'fadeInMs' || key === 'fadeOutMs' || key === 'sheenSpeedMs';
    root.setProperty(v, ms ? `${cfg[key]}ms` : String(cfg[key]));
  }
}

export function setEquipSlotValue(key: keyof EquipSlotConfig, value: number | string): void {
  cfg = { ...cfg, [key]: Number(value) };
  applyEquipSlotVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetEquipSlotConfig(): void {
  cfg = { ...DEFAULTS };
  applyEquipSlotVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** [label, unit, hint, group] per dial. Declaration order below IS render order. */
const SPECS: Record<keyof EquipSlotConfig, [string, string | undefined, string, string]> = {
  x: ['Offset X', 'px', 'Right of the hero panel seat. Reference px — scales with the stage.', 'Seat'],
  y: ['Offset Y', 'px', 'Down from the seat — NEGATIVE puts it above the hero.', 'Seat'],
  scale: ['Scale', '×', 'Size of the whole Equipment block — everything below moves with it.', 'Seat'],

  frameOn: ['Show frame', undefined, '1 draws the frame around the button, 0 leaves the bare circle.', 'Frame'],
  frameX: ['Frame X', 'px', 'Frame offset from the button centre.', 'Frame'],
  frameY: ['Frame Y', 'px', 'Frame offset from the button centre.', 'Frame'],
  frameScale: ['Frame size', '×', 'Multiple of the button own box — 1 is exactly button-sized, so the frame needs more than 1 to sit AROUND it.', 'Frame'],
  fadeInMs: ['Fade in', 'ms', 'How long the slot takes to appear when you equip something.', 'Arriving & leaving'],
  sheenOn: ['Show sheen', undefined, '1 sweeps a band of light across the Equipment art when the picture changes, 0 never.', 'Sheen'],
  sheenDelayMs: ['Sheen timing', 'ms', 'Relative to the slot burst — NEGATIVE fires the sheen earlier than the burst, positive later.', 'Sheen'],
  sheenSpeedMs: ['Sheen speed', 'ms', 'How long the band takes to cross. Lower is faster.', 'Sheen'],
  sheenSize: ['Sheen width', '%', 'Band width as a share of the art circle. Narrow reads as a glint, wide as a wash.', 'Sheen'],
  sheenDir: ['Direction', undefined, '0 sweeps left → right, 1 right → left.', 'Sheen'],
  sheenSfxOn: ['Sheen sound', undefined, '1 plays the sheen clip, 0 silences it — for judging the sweep alone.', 'Sheen'],
  sheenSfxVolume: ['Sheen volume', '×', "Multiple of the clip's normal level. Rides on top of the UI bus.", 'Sheen'],
  sheenSfxDelayMs: ['Sheen sound timing', 'ms', 'Same anchor as the visual: negative is earlier than the slot burst. Audio clock, so it cannot drift.', 'Sheen'],

  fadeOutMs: ['Fade out', 'ms', 'How long it takes to go when the last source dies or is sold. Also how long the leaving copy is kept alive, so the fade and the timer cannot disagree.', 'Arriving & leaving'],

  frameBehind: ['Behind art', undefined, '1 puts the frame behind the icon (a backing plate), 0 in front (a surround the icon sits under).', 'Frame'],

  costX: ['Cost X', 'px', 'The Gold cost pill. The frame has a round boss at its top-left made for it.', 'Cost pill'],
  costY: ['Cost Y', 'px', 'Down from where the pill sits today.', 'Cost pill'],
  costScale: ['Cost size', '×', 'Size of the cost pill.', 'Cost pill'],

  nameX: ['Name X', 'px', 'The Equipment name. The frame has a plaque along its bottom edge.', 'Name pill'],
  nameY: ['Name Y', 'px', 'Down from where the name sits today.', 'Name pill'],
  nameScale: ['Name size', '×', 'Size of the name text.', 'Name pill'],

  usesX: ['Uses X', 'px', 'The uses-left tally. Tunable because the frame moved under it too.', 'Uses tally'],
  usesY: ['Uses Y', 'px', 'Down from where the tally sits today.', 'Uses tally'],
  usesScale: ['Uses size', '×', 'Size of the tally.', 'Uses tally'],

  railX: ['Rail gap', 'px', 'How far the selector sits out to the right. This whole gap is hoverable — crossing it does not drop the rail.', 'Selector rail'],
  railY: ['Rail Y', 'px', 'Raises or lowers the rail against the slot.', 'Selector rail'],
  railScale: ['Rail size', '×', 'Size of the selector rows.', 'Selector rail'],
  railGraceMs: ['Linger', 'ms', 'How long the rail stays after the pointer leaves. Covers a diagonal exit or an overshoot — raise it if it still fades too early.', 'Selector rail'],
  selectVolume: ['Pick volume', '×', 'How loud the pick sound is, as a multiple of its normal level. Rides on top of the UI bus, so 0 silences just this one.', 'Selector rail'],
};

const controls: TunerControl<Extract<keyof EquipSlotConfig, string>>[] =
  (Object.keys(SPECS) as (keyof EquipSlotConfig)[]).map((key) => {
    const [label, unit, hint, group] = SPECS[key];
    const [min, max, step] = RANGES[key];
    return { key, label, unit, hint, group, min, max, step } as TunerControl<Extract<keyof EquipSlotConfig, string>>;
  });

/**
 * Replay the sheen on the LIVE slot without needing to swap Equipment for it.
 *
 * The sheen fires only when the slot's art actually changes, which is correct in play and painful to tune:
 * judging a 60ms offset would otherwise mean buying a second Equipment and swapping back and forth. This
 * re-plays the exact band the real trigger mounts — same class, same CSS, same clip — by hand.
 */
function testSheen(): void {
  if (typeof document === 'undefined') return;
  const wrap = document.querySelector<HTMLElement>('.equipslot .hpb-artwrap');
  if (!wrap) return; // no Equipment on screen; the panel note says one is needed
  wrap.querySelectorAll('.equipsheen').forEach((n) => { n.remove(); });
  const burst = 140; // the slot burst's own default; the real cue reads it from the Equip FX tuner
  window.setTimeout(() => {
    const band = document.createElement('span');
    band.className = `equipsheen${cfg.sheenDir === 1 ? ' rev' : ''}`;
    band.addEventListener('animationend', () => { band.remove(); });
    wrap.appendChild(band);
  }, Math.max(0, burst + cfg.sheenDelayMs));
  if (cfg.sheenSfxOn) void import('./sfx').then((m) => {
    m.sfx.equipmentSheen(cfg.sheenSfxVolume, Math.max(0, burst + cfg.sheenSfxDelayMs));
  });
}

export const SPEC: TunerSpec<EquipSlotConfig> = {
  id: 'equipslot',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Equipment Slot',
  note: 'dev · live · needs an Equip minion',
  read: getEquipSlotConfig,
  write: (key, value) => setEquipSlotValue(key, value),
  reset: resetEquipSlotConfig,
  defaults: DEFAULTS,
  controls,
  actions: [{
    label: '▶ sheen',
    hint: 'Replays the sweep on the Equipment currently in the slot, at the tuned offset and with its clip. Needs an Equipment on screen.',
    run: testSheen,
  }],
};

// Apply at load so the seat is live before the first paint (the boardConfig-era pattern).
applyEquipSlotVars();
