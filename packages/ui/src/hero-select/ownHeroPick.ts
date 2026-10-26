/**
 * MY HERO PICK, as my own Hero Select is playing it (R-SPECTATE-HEROSELECT-01). Hero Select keeps its pick in its own
 * ceremony machine (a component reducer), so the screen reports it here for the publishers that send my Hero Select to
 * the people watching me (`versus/versusStore.ts`, `live/livePublisher.ts`). Null while nothing is picked.
 */
import { create } from 'zustand';

export const useOwnHeroPick = create<{ heroId: string | null }>(() => ({ heroId: null }));

export function setOwnHeroPick(heroId: string | null): void {
  if (useOwnHeroPick.getState().heroId !== heroId) useOwnHeroPick.setState({ heroId });
}
