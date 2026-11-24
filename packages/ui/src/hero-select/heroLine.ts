/**
 * NO START BUTTON (owner + Mike 2026-11-24: "what if we removed the start button and instead just had it reveal the portrait,
 * have the character say their line, and then auto go into the head to board animation"; R-LOCATION-07). When the game goes.
 */
/** A hero with no line (or one that has not decoded) holds the stage this long (ms). */
export const NO_LINE_MS = 1300;
/** The launch begins this long before the line ends: building the game takes about this long, so the frame opens as they finish. */
export const LEAD_MS = 520;
/** However short the line, the hero is looked at this long after they have started to speak (ms). */
export const LEAST_MS = 900;
/** A line so long it would be a wait does not hold the game up past this (ms). */
export const MOST_MS = 5000;

/** How long after the line starts the launch begins (ms). */
export function goAfterLine(seconds: number | null): number {
  const line = seconds === null || !(seconds > 0) ? NO_LINE_MS : seconds * 1000 - LEAD_MS;
  return Math.min(MOST_MS, Math.max(LEAST_MS, line));
}
