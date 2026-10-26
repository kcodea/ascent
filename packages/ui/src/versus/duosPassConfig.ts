/**
 * THE DUOS PASS, every timing, size and colour on both screens (R-DUOS-PASS-05). Owner 2026-10-26: "can you make it
 * look more like magic/pixi stream and then a coalesce in hand? the flipping around just doesn't look great when it
 * comes in. in the same vein, when a card is dropped into the teammates portrait to pass, have it coalesce and turn
 * into a stream that enters the hero portrait and plays a simple little effect over the portrait".
 *
 * Read LIVE by `passLob.ts` at every pass, so a tuner change applies to the very next one (no reload). Dev-persisted
 * under `ascent.duosPass`; production always uses DEFAULTS, so the baked look only moves when the owner's copied values
 * are pasted in here. The stream's own shape (its width, glow, bursts, ripple, sounds) is the two committed FX defs
 * `duos-pass-send` / `duos-pass-arrive` (fx/defs, authored from the triple's `gild-trail`), tunable in the FX workbench;
 * the card's own dissolve and coalesce are the game's (`plateDissolve` / `plateCoalesce`, their own tuners).
 */
export interface DuosPassConfig {
  // ── SENDING: the card dissolves where you let go and streams into the teammate's portrait ──
  /** The card fades out over this while its plate dissolves (ms). */
  sendFadeMs: number;
  /** It shrinks to this as it fades (×). */
  sendFadeScale: number;
  /** The stream leaves this long after the release (ms), out of the dissolving card. */
  streamDelay: number;
  /** Where the stream leaves from: this share of the card's height above its centre (the dust rises off it). */
  streamFromY: number;
  /** The send stream's speed (× the def's authored flight). */
  sendSpeed: number;
  // ── THE COIN that follows it in from your Gold ──
  coinDelay: number;
  coinMs: number;
  coinArc: number;
  coinEnd: number;
  // ── THE PORTRAIT ──
  /** Its pop as the stream lands in it (or leaves it): size (× the peak) and time (ms). */
  catchScale: number;
  catchMs: number;
  // ── RECEIVING: a stream out of the portrait that coalesces into the card in your hand ──
  /** The arrival stream's speed (× the def's authored flight). */
  recvSpeed: number;
  /** The card starts to coalesce this long before the stream lands (ms), so the stream pours into the forming card. */
  coalesceLead: number;
  // ── COLOURS: the stream's palette, rim to core (both sides) ──
  cRim: string;
  cMid: string;
  cHot: string;
  cCore: string;
}

const DEFAULTS: DuosPassConfig = {
  sendFadeMs: 170,
  sendFadeScale: 0.9,
  streamDelay: 90,
  streamFromY: 0.38,
  sendSpeed: 1.1,
  coinDelay: 90,
  coinMs: 520,
  coinArc: 0.3,
  coinEnd: 0.45,
  catchScale: 1.07,
  catchMs: 360,
  recvSpeed: 1.2,
  coalesceLead: 60,
  cRim: '#0a4f63',
  cMid: '#1aa7c9',
  cHot: '#5fe3f5',
  cCore: '#d8fbff',
};
export { DEFAULTS as DUOS_PASS_DEFAULTS };

export const DUOS_PASS_COLOR_KEYS = ['cRim', 'cMid', 'cHot', 'cCore'] as const;
type ColorKey = (typeof DUOS_PASS_COLOR_KEYS)[number];
type NumKey = Exclude<keyof DuosPassConfig, ColorKey>;
export const DUOS_PASS_RANGES: Record<NumKey, [number, number, number]> = {
  sendFadeMs: [0, 600, 10],
  sendFadeScale: [0.5, 1, 0.01],
  streamDelay: [0, 400, 10],
  streamFromY: [-0.5, 0.5, 0.01],
  sendSpeed: [0.4, 2.5, 0.05],
  coinDelay: [0, 400, 10],
  coinMs: [200, 1200, 10],
  coinArc: [0, 0.8, 0.01],
  coinEnd: [0.1, 1, 0.01],
  catchScale: [1, 1.25, 0.01],
  catchMs: [100, 800, 10],
  recvSpeed: [0.4, 2.5, 0.05],
  coalesceLead: [-200, 400, 10],
};

const KEY = 'ascent.duosPass';
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function load(): DuosPassConfig {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const out: DuosPassConfig = { ...DEFAULTS };
    for (const k of Object.keys(DUOS_PASS_RANGES) as NumKey[]) if (typeof saved[k] === 'number') out[k] = saved[k] as number;
    for (const k of DUOS_PASS_COLOR_KEYS) if (isHex(saved[k])) out[k] = saved[k] as string;
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}
let cfg: DuosPassConfig = load();

function save(): void {
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage blocked: this session only */ }
}

export function getDuosPassConfig(): DuosPassConfig { return cfg; }
export function setDuosPassValue(key: keyof DuosPassConfig, value: number | string): void {
  if ((DUOS_PASS_COLOR_KEYS as readonly string[]).includes(key) ? !isHex(value) : typeof value !== 'number') return;
  cfg = { ...cfg, [key]: value };
  save();
}
export function resetDuosPassConfig(): void {
  cfg = { ...DEFAULTS };
  if (!import.meta.env.DEV) return;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The stream's palette as the FX recolour wants it (4 stops, rim to core, `0xRRGGBB`). */
export function streamPalette(c: DuosPassConfig = cfg): number[] {
  return [c.cRim, c.cMid, c.cHot, c.cCore].map((h) => parseInt(h.slice(1), 16));
}
