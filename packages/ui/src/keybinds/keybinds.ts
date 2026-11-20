/**
 * KEY BINDINGS (owner 2026-11-20: "we need a keybindings area for people to change keybinds for any keyboard related
 * bindings"; R-SETTINGS-KEYBINDS-01).
 *
 * THE ONE REGISTRY of the game's rebindable keyboard actions. Every handler asks `matchesAction(id, e)` instead of
 * naming a key, so a binding changed in Settings applies at once everywhere and no key is hardcoded at a call site.
 * Each action holds up to two keys (a primary and an optional second, e.g. the chat's Enter and Y).
 *
 * KEYS are `KeyboardEvent.key` values, normalised: a single character is lower case ('c', ']', '1'), the space bar
 * is 'Space', named keys keep their name ('Tab', 'Enter', 'ArrowLeft'). The key a player SEES on their keyboard is
 * what they bind, on any layout. A binding never fires with Ctrl, Cmd or Alt held (those combos belong to the browser
 * and the OS); Shift is allowed (so a held Shift never kills the chat key).
 *
 * FIXED, never rebindable: Escape (the universal back / Settings key, R-ESC-SIDEBAR-01), Ctrl+B (report a bug) and F11
 * (fullscreen, the desktop shell's). Escape cancels a rebind in progress; modifier keys alone are ignored.
 *
 * CONFLICTS SWAP: binding a key another action holds hands that action the key being replaced (or clears its slot
 * when there was none), and `rebind` says who was moved so the page can say so. No two actions ever share a key.
 *
 * Saved on this device only (localStorage, try/catch; only the changed actions are stored). Cheap: handlers read the
 * map from `getState()` on a key press; only the Settings page and the few key hints subscribe.
 */
import { create } from 'zustand';

export type KeyActionId =
  | 'compendium'
  | 'duosPeek'
  | 'lobbyChat'
  | 'spectateNext'
  | 'spectatePrev'
  | 'spectateSeat1'
  | 'spectateSeat2'
  | 'spectateSeat3'
  | 'spectateSeat4'
  | 'replayPlayPause'
  | 'replayStepBack'
  | 'replayStepForward'
  | 'replayRoundStart'
  | 'replayRoundEnd';

export type KeyGroup = 'game' | 'spectate' | 'replay';
export const KEY_GROUPS: readonly { id: KeyGroup; label: string }[] = [
  { id: 'game', label: 'In a game' },
  { id: 'spectate', label: 'Spectating' },
  { id: 'replay', label: 'Replays' },
];

export interface KeyAction {
  id: KeyActionId;
  label: string;
  note?: string;
  group: KeyGroup;
  /** Default keys: the primary, then an optional second. */
  defaults: readonly string[];
}

/**
 * Defaults are the keys the game always used. NEW: Next and Previous player while spectating, E and Q: letters next to
 * the 1 to 4 seat keys under the left hand, free in every mode (no other action, and no browser shortcut without a
 * modifier), and they stand down while typing like every letter binding.
 */
export const KEY_ACTIONS: readonly KeyAction[] = [
  { id: 'compendium', label: 'Compendium', note: 'Opens and closes the Compendium.', group: 'game', defaults: ['c'] },
  { id: 'duosPeek', label: 'Peek at teammate', note: 'Duos: hold to watch your teammate\'s board, let go to come back.', group: 'game', defaults: ['Tab'] },
  { id: 'lobbyChat', label: 'Open lobby chat', note: 'Opens the chat for everyone in the game.', group: 'game', defaults: ['Enter', 'y'] },
  { id: 'spectateNext', label: 'Next player', note: 'Watch the next player still in.', group: 'spectate', defaults: ['e'] },
  { id: 'spectatePrev', label: 'Previous player', note: 'Watch the previous player still in.', group: 'spectate', defaults: ['q'] },
  { id: 'spectateSeat1', label: 'Watch player 1', group: 'spectate', defaults: ['1'] },
  { id: 'spectateSeat2', label: 'Watch player 2', group: 'spectate', defaults: ['2'] },
  { id: 'spectateSeat3', label: 'Watch player 3', group: 'spectate', defaults: ['3'] },
  { id: 'spectateSeat4', label: 'Watch player 4', group: 'spectate', defaults: ['4'] },
  { id: 'replayPlayPause', label: 'Play or pause', group: 'replay', defaults: ['Space'] },
  { id: 'replayStepBack', label: 'Step back', group: 'replay', defaults: ['ArrowLeft'] },
  { id: 'replayStepForward', label: 'Step forward', group: 'replay', defaults: ['ArrowRight'] },
  { id: 'replayRoundStart', label: 'Start of round', group: 'replay', defaults: ['Home'] },
  { id: 'replayRoundEnd', label: 'End of round', group: 'replay', defaults: ['End'] },
];

export const KEY_ACTION_INDEX: Readonly<Record<KeyActionId, KeyAction>> = Object.freeze(
  Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a])) as Record<KeyActionId, KeyAction>,
);

/** The spectator's direct seat keys, in seat order. */
export const SPECTATE_SEAT_ACTIONS: readonly KeyActionId[] = ['spectateSeat1', 'spectateSeat2', 'spectateSeat3', 'spectateSeat4'];

/** Keys that can never be bound. */
export const FIXED_KEYS: readonly { key: string; label: string; note: string }[] = [
  { key: 'Escape', label: 'Esc', note: 'Back, and opens Settings. Always Esc.' },
  { key: 'Ctrl+B', label: 'Ctrl+B', note: 'Report a problem.' },
  { key: 'F11', label: 'F11', note: 'Fullscreen in the desktop app.' },
];
const UNBINDABLE = new Set(['Escape', 'F11', 'Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'Dead', 'Unidentified', 'Process', 'ContextMenu']);

/** The normalised key of a keyboard event (see the header). */
export function normKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  return key.length === 1 ? key.toLowerCase() : key;
}
export const keyOfEvent = (e: Pick<KeyboardEvent, 'key'>): string => normKey(e.key);

/** Can this key be bound? */
export const bindableKey = (key: string): boolean => !!key && !UNBINDABLE.has(key);

const NAMED: Readonly<Record<string, string>> = {
  Space: 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Enter: 'Enter', Tab: 'Tab',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
};
/** How a key reads on screen ('c' -> 'C', 'ArrowLeft' -> 'Left'). */
export function keyLabel(key: string | null | undefined): string {
  if (!key) return '';
  if (NAMED[key]) return NAMED[key]!;
  return key.length === 1 ? key.toUpperCase() : key;
}

// ── the store ─────────────────────────────────────────────────────────────────────────────────────────────

const STORE_KEY = 'ascent.keybinds.v1';
type Binds = Readonly<Record<KeyActionId, readonly string[]>>;

const defaults = (): Record<KeyActionId, readonly string[]> =>
  Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, [...a.defaults]])) as unknown as Record<KeyActionId, readonly string[]>;

const sameKeys = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((k, i) => k === b[i]);

/** Saved overrides over the defaults; anything malformed, unknown or duplicated falls back to the defaults. */
function read(): Binds {
  const out = defaults();
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    for (const a of KEY_ACTIONS) {
      const keys = (v as Record<string, unknown>)[a.id];
      if (!Array.isArray(keys)) continue;
      const clean = keys.filter((k): k is string => typeof k === 'string' && bindableKey(k)).slice(0, 2);
      out[a.id] = clean;
    }
    // A hand-edited or older save that doubles a key: drop it from the later action, never fire two actions.
    const seen = new Set<string>();
    for (const a of KEY_ACTIONS) {
      out[a.id] = out[a.id].filter((k) => (seen.has(k) ? false : (seen.add(k), true)));
    }
  } catch { /* storage unavailable or corrupt: the defaults */ }
  return out;
}

function write(binds: Binds): void {
  const changed: Partial<Record<KeyActionId, readonly string[]>> = {};
  for (const a of KEY_ACTIONS) if (!sameKeys(binds[a.id], a.defaults)) changed[a.id] = binds[a.id];
  try {
    if (Object.keys(changed).length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(changed));
  } catch { /* storage unavailable: the binding lasts this session */ }
}

export const useKeybinds = create<{ binds: Binds }>(() => ({ binds: read() }));

/** The keys bound to an action (primary first). */
export const keysOf = (id: KeyActionId): readonly string[] => useKeybinds.getState().binds[id];

/** Does this key press trigger this action? Never with Ctrl, Cmd or Alt held. */
export function matchesAction(id: KeyActionId, e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return keysOf(id).includes(keyOfEvent(e));
}

/** For a key-UP: is this key one of the action's (modifiers ignored, a release always ends a hold)? */
export const isActionKey = (id: KeyActionId, e: Pick<KeyboardEvent, 'key'>): boolean => keysOf(id).includes(keyOfEvent(e));

/** Which action holds a key, if any. */
export function actionOfKey(key: string): KeyActionId | null {
  const b = useKeybinds.getState().binds;
  for (const a of KEY_ACTIONS) if (b[a.id].includes(key)) return a.id;
  return null;
}

export interface RebindResult {
  ok: boolean;
  /** The action that held the key before, now given the replaced key (or nothing). */
  swappedWith?: KeyActionId;
  /** The key that action now has in that slot, if any. */
  gave?: string | null;
  reason?: 'unbindable';
}

/** Bind `key` to slot 0 (primary) or 1 (second) of an action. A key another action holds is swapped (see header). */
export function rebind(id: KeyActionId, slot: 0 | 1, rawKey: string): RebindResult {
  const key = normKey(rawKey);
  if (!bindableKey(key)) return { ok: false, reason: 'unbindable' };
  const cur = useKeybinds.getState().binds;
  const mine = [...cur[id]];
  const at = Math.min(slot, mine.length); // a second key on an action with none yet lands first
  const old = mine[at] ?? null;
  if (old === key) return { ok: true };
  const next: Record<KeyActionId, readonly string[]> = { ...cur };
  let swappedWith: KeyActionId | undefined;
  let gave: string | null | undefined;
  const holder = actionOfKey(key);
  if (holder === id) {
    // Moving my own key between my two slots: swap them.
    const other = mine.indexOf(key);
    mine[other] = old ?? key;
    mine[at] = key;
    next[id] = [...new Set(mine)];
  } else {
    if (holder) {
      const theirs = [...cur[holder]];
      const i = theirs.indexOf(key);
      if (old && !theirs.includes(old)) theirs[i] = old; else theirs.splice(i, 1);
      next[holder] = theirs;
      swappedWith = holder;
      gave = old && theirs.includes(old) ? old : null;
    }
    mine[at] = key;
    next[id] = mine;
  }
  useKeybinds.setState({ binds: next });
  write(next);
  return { ok: true, swappedWith, gave };
}

/** Clear an action's second key (the primary can be replaced, never left empty from the page). */
export function clearSecondKey(id: KeyActionId): void {
  const cur = useKeybinds.getState().binds;
  if (cur[id].length < 2) return;
  const next = { ...cur, [id]: cur[id].slice(0, 1) };
  useKeybinds.setState({ binds: next });
  write(next);
}

/** One action back to its defaults. Any other action holding one of those keys loses it (no shared keys). */
export function resetBinding(id: KeyActionId): void {
  const cur = useKeybinds.getState().binds;
  const want = KEY_ACTION_INDEX[id].defaults;
  const next: Record<KeyActionId, readonly string[]> = { ...cur, [id]: [...want] };
  for (const a of KEY_ACTIONS) {
    if (a.id === id) continue;
    if (next[a.id].some((k) => want.includes(k))) next[a.id] = next[a.id].filter((k) => !want.includes(k));
  }
  useKeybinds.setState({ binds: next });
  write(next);
}

export function resetAllBindings(): void {
  const next = defaults();
  useKeybinds.setState({ binds: next });
  write(next);
}

export const isDefaultBinding = (id: KeyActionId, binds: Binds = useKeybinds.getState().binds): boolean => sameKeys(binds[id], KEY_ACTION_INDEX[id].defaults);

/** The primary key's label, reactive (key hints: "Compendium (C)", the seat chips' numbers). '' when unbound. */
export const useKeyLabel = (id: KeyActionId): string => useKeybinds((s) => keyLabel(s.binds[id][0]));

/** Non-reactive form. */
export const keyLabelOf = (id: KeyActionId): string => keyLabel(keysOf(id)[0]);

/** A Settings key button is waiting for a key: Esc cancels it (the Esc handlers stand down), nothing else fires. */
let capturing = false;
export const keyCaptureActive = (): boolean => capturing;
export function setKeyCapture(on: boolean): void { capturing = on; }

/** Tests: re-read storage. */
export function reloadKeybindsForTest(): void {
  useKeybinds.setState({ binds: read() });
}
