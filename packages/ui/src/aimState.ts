/**
 * THE LIVE AIM, as a plain record (owner 2026-10-15: spectators see every animation). `pixiFx.setAimLine` and
 * `clearAimLine` are the one chokepoint for the aim line of every targeting gesture (a spell cast from hand, the hero
 * power, Equipment, a targeted Battlecry), so they write it here; the spectator tap reads it (no Pixi import), and the
 * watch screen draws the same line through the same `setAimLine`.
 */
export interface AimSnapshot {
  from: { x: number; y: number };
  onTarget: boolean;
  /** The aim effect when it is not the default (`ruby-target` for a Ruby cast). */
  defId?: string;
}

export const liveAim: { current: AimSnapshot | null } = { current: null };
