import type { LobbyRevealConfig } from './lobbyRevealConfig';

/**
 * THE LOBBY REVEAL — the pure half (owner ask 2026-10-31). No React, no DOM, no store: which game starts get a reveal,
 * who stands on the stage and in what order, where each portrait lands, and the timeline. `LobbyReveal.tsx` turns this
 * into one pass of WAAPI animations; everything here is testable without a browser.
 */

/** The run fields the decision reads: a structural slice, so tests need no full RunState. */
export interface RevealRunSlice {
  mode?: string;
  sandbox?: boolean;
  godMode?: true | undefined;
  wave: number;
  phase?: string;
  lobby?: { seats: readonly RevealSeatSlice[] } | null;
}

export interface RevealSeatSlice {
  id: string;
  heroId: string;
  label: string;
}

/**
 * Does THIS game start get the reveal? A real new game whose screen has a table to build: a ranked or casual lobby,
 * Practice, or any Versus match (1v1, Group, Duos, Ranked Duos), on its opening turn. Never the Scene Builder sandbox,
 * God Mode (its table is hidden), the tutorial (its own coaching), a Gauntlet (one authored foe and no rail), or a
 * replay. Off when the player turned "Lobby reveal" off in Settings.
 */
export function shouldPlayLobbyReveal(run: RevealRunSlice | null | undefined, opts: { replaying?: boolean; enabled?: boolean } = {}): boolean {
  if (!run || opts.replaying || opts.enabled === false) return false;
  if (run.sandbox || run.godMode === true) return false;
  if (run.mode !== 'lobby' && run.mode !== 'practice' && run.mode !== 'versus') return false;
  if (run.wave !== 1) return false;
  return (run.lobby?.seats.length ?? 0) >= 2;
}

/** How the stage is laid out. `table`: one line-up (a lobby, Practice, Versus Group). `teams`: the line-up in pairs
 *  (Versus Duos, Ranked Duos). `duel`: two heroes facing off (a Versus 1v1, which has no rail). */
export type RevealLayout = 'table' | 'teams' | 'duel';

export interface RevealEntry {
  seatId: string;
  heroId: string;
  /** The player's name. */
  label: string;
  /** The seat on this screen (yours, or the watched player's for a spectator). */
  you: boolean;
  /** The team index in a Duos layout (seat s0+s1 = 0, s2+s3 = 1, ...); 0 elsewhere. */
  team: number;
}

/** A Duos team of a seat id: `s0`+`s1`, `s2`+`s3`, ... (the rail's own rule, `duosRailTeamOf`). */
export const revealTeamOf = (id: string): number => {
  const n = Number(id.replace(/^\D+/, ''));
  return Number.isFinite(n) ? Math.floor(n / 2) : 99;
};

export function revealLayoutFor(mode: string | undefined, seats: number, opts: { duos?: boolean; group?: boolean } = {}): RevealLayout {
  if (mode === 'versus' && opts.duos) return 'teams';
  // The Versus 1v1 block: two seats and not a group match (the rail's own `versusDuelLayout`).
  if (mode === 'versus' && !opts.group && seats === 2) return 'duel';
  return 'table';
}

/**
 * Who stands on the stage, left to right (owner 2026-10-31: "The goal of the animation is to show the player who they are
 * facing"). A table: your opponents in seat order with YOU in the middle of the line-up (highlighted), so the eye lands
 * on you and reads outward to who you face. A duel: you on the left, your opponent on the right. A Duos layout: team by
 * team, your team first, so teammates stand side by side.
 */
export function revealEntries(seats: readonly RevealSeatSlice[], layout: RevealLayout): RevealEntry[] {
  const you = seats[0]?.id;
  const all = seats.map((s) => ({ seatId: s.id, heroId: s.heroId, label: s.label, you: s.id === you, team: layout === 'teams' ? revealTeamOf(s.id) : 0 }));
  if (layout === 'duel') return all;
  if (layout === 'table') {
    const me = all.filter((e) => e.you);
    const rest = all.filter((e) => !e.you);
    const mid = Math.floor(rest.length / 2);
    return [...rest.slice(0, mid), ...me, ...rest.slice(mid)];
  }
  const mine = you ? revealTeamOf(you) : 0;
  // A stable sort: teams in index order with mine first; inside a team, seat order.
  return all
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.team === mine ? -1 : 0) - (b.e.team === mine ? -1 : 0) || a.e.team - b.e.team || a.i - b.i)
    .map((x) => x.e);
}

/**
 * Where one portrait lands: CSS selectors, tried in order, the first match on screen wins. A lobby / Group / Duos seat
 * lands on its rail row (every rail look marks it `.lobbyseat[data-seat]`). The Versus 1v1 has no rail: the opponent
 * lands on their portrait in the opponent block (`.vsfoe-face`), you on your own hero portrait under the board.
 */
export function revealTargetSelectors(entry: Pick<RevealEntry, 'seatId' | 'you'>, layout: RevealLayout): string[] {
  const seat = `[data-seat="${entry.seatId}"]`;
  if (layout === 'duel') return entry.you ? ['.statusbar .hero .herolunge', `.lobbyrail .lobbyseat${seat}`] : [`.vsfoe-face${seat}`, `.lobbyrail .lobbyseat${seat}`];
  return [`.lobbyrail .lobbyseat${seat}`];
}

/** Whether the slot is hidden until its portrait lands. Not your own hero portrait in a 1v1: it is the board's own
 *  socketed portrait, and hiding it would leave the socket's dark hole on screen; the flight lands on it as it is. */
export function revealHidesSlot(entry: Pick<RevealEntry, 'you'>, layout: RevealLayout): boolean {
  return !(layout === 'duel' && entry.you);
}

/** What becomes visible when a portrait lands: a Duos team slot holds both rows, so it appears with the first of them. */
export function revealShowSelectorFor(layout: RevealLayout): string | null {
  return layout === 'teams' ? '.lobbyteamslot' : null;
}

/** Inside a slot, the portrait the flight lands ON: the rail row's face (every rail look), the 1v1 block's disc. */
export const REVEAL_FACE_SELECTOR = '.lobbyface, .lrv-tileart, .combatopp-portrait';

/** The round slice, which settles in last (the rail's round header; the 1v1's Round plate). */
export const REVEAL_HEAD_SELECTORS = ['.lobbyrailhead', '.vsfoe-roundline'] as const;

/** The beats of one play, in ms from the start. Pure, so the ordering is testable without a DOM. */
export interface RevealTimeline {
  /** Each portrait's entrance start, by stage index. */
  enterAt: number[];
  /** The line-up is complete. */
  fullAt: number;
  /** Each portrait's take-off, by stage index. */
  flyAt: number[];
  /** Each portrait reaching its slot (the crossfade starts). */
  landAt: number[];
  /** The dim starts lifting (with the first take-off). */
  dimOutAt: number;
  /** The round slice starts settling (after the last landing). */
  headAt: number;
  /** The reveal is over: the overlay unmounts and hands on to the Good Luck intro (or the clock). */
  endAt: number;
}

/**
 * The beats for `n` portraits. Under reduced motion there is no rise and no flight: the line-up fades in as one, holds
 * briefly, fades out while the rail fades in, so the whole thing stays a calm ~1.2 s.
 */
export function revealTimeline(c: LobbyRevealConfig, n: number, reduced: boolean): RevealTimeline {
  const count = Math.max(0, n);
  const start = Math.max(0, c.startDelayMs);
  if (reduced) {
    const fade = 300;
    const fullAt = start + fade;
    const out = fullAt + Math.min(Math.max(0, c.holdMs), 600);
    const all = (t: number): number[] => Array.from({ length: count }, () => t);
    return { enterAt: all(start), fullAt, flyAt: all(out), landAt: all(out), dimOutAt: out, headAt: out, endAt: out + fade };
  }
  const entrance = Math.max(0, c.entranceMs);
  const enterAt = Array.from({ length: count }, (_, i) => start + i * Math.max(0, c.revealStaggerMs));
  const fullAt = (count ? enterAt[count - 1]! : start) + entrance;
  const takeoff = fullAt + Math.max(0, c.holdMs);
  const flyAt = Array.from({ length: count }, (_, i) => takeoff + i * Math.max(0, c.flyStaggerMs));
  const fly = Math.max(1, c.flyMs);
  const landAt = flyAt.map((t) => t + fly);
  const lastLand = count ? landAt[count - 1]! : takeoff;
  const headAt = lastLand + Math.max(0, c.landMs);
  return { enterAt, fullAt, flyAt, landAt, dimOutAt: takeoff, headAt, endAt: headAt + Math.max(0, c.headSettleMs) };
}

/** Where the sequence is at `t` ms. The overlay's state machine: idle → reveal → fly → settle → done. */
export type RevealPhase = 'idle' | 'reveal' | 'fly' | 'settle' | 'done';
export function revealPhaseAt(t: number, tl: RevealTimeline): RevealPhase {
  if (t < 0) return 'idle';
  if (t >= tl.endAt) return 'done';
  if (t >= tl.headAt) return 'settle';
  if (t >= tl.dimOutAt) return 'fly';
  return 'reveal';
}

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * One flight as WAAPI keyframes: a quadratic arc from the stage portrait's centre to the slot's centre, bowed UP by
 * `arc` px (a flight to a slot lower on screen still lifts first), the portrait shrinking to the slot's size on the way
 * (a uniform scale, the smaller of the slot's two ratios, so a round face fits a rectangular slice). Sampled into
 * `steps` keyframes with the ease already applied to the PATH parameter, so the animation itself runs linear and the
 * motion is one smooth curve. Transform only: compositor work, no layout or paint per frame.
 */
export function arcKeyframes(from: Rect, to: Rect, arc: number, steps = 14): Keyframe[] {
  const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
  const tx = to.left + to.width / 2, ty = to.top + to.height / 2;
  const s1 = from.width > 0 && from.height > 0 ? Math.min(to.width / from.width, to.height / from.height) : 1;
  // The control point: midway, lifted by `arc` above the higher of the two ends.
  const cx = (fx + tx) / 2, cy = Math.min(fy, ty) - Math.max(0, arc);
  const out: Keyframe[] = [];
  const n = Math.max(2, Math.round(steps));
  for (let i = 0; i <= n; i++) {
    const u = easeInOutCubic(i / n);
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    const x = a * fx + b * cx + c * tx - fx;
    const y = a * fy + b * cy + c * ty - fy;
    const s = 1 + (s1 - 1) * u;
    out.push({ offset: i / n, transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)})` });
  }
  return out;
}

export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * A SPECTATOR's reveal (owner brief: "Spectators see it too when they join at the start; late joiners skip it"). The
 * stands play it only when they watched the player's Hero Select and the screen then turns to that player's opening
 * shop, within a short window. Arriving later (no Hero Select seen first) never plays it.
 */
export const SPECTATOR_REVEAL_WINDOW_MS = 4000;
export function spectatorShouldReveal(sawHeroSelectAt: number | null, now: number, run: RevealRunSlice | null | undefined, enabled = true): boolean {
  if (sawHeroSelectAt == null || now - sawHeroSelectAt > SPECTATOR_REVEAL_WINDOW_MS) return false;
  if (!run || run.phase !== 'recruit') return false;
  return shouldPlayLobbyReveal(run, { enabled });
}
