/**
 * Player copy for Versus errors on the party home and its pages (the store's own strings stay as they are for the shipped
 * Versus screens). One helper, so the home and the Versus page builder say the same thing.
 */
const PLAYER_COPY: Record<string, string> = {
  "This build's game server isn't deployed yet. Run the pack or select a local server.": 'Versus is offline right now. Try again soon.',
  'You are already in a room. Leave it first.': 'You are already in a Versus room. Return to it or leave it first.',
};

/** The store's Versus error, in plain player words (unknown errors pass through unchanged). */
export function playerVersusError(text: string | null | undefined): string | null {
  if (!text) return null;
  return PLAYER_COPY[text] ?? text;
}
