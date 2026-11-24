/**
 * The store's side of the location reveal: what the gate reveals for the game being started (Ranked and Practice), and
 * PRACTICE'S OWN GATE (owner 2026-11-24: "make it so that the gates close and this all plays for practice mode as well").
 */
import { useGame } from '../store';
import { requestRankedGate, type RankedGateOptions } from '../rankedGate/rankedGateController';
import { pendingLocation, pendingReveal } from './pendingLocation';

/** Asked by the gate once its doors are shut and the screen behind has been swapped, so the pending game is in the store. */
export const revealForPending: NonNullable<RankedGateOptions['reveal']> = {
  location: () => pendingLocation(useGame.getState()),
  request: () => pendingReveal(useGame.getState()),
};

/** Start Practice from its setup: the doors close over it, and the hero picker is opened behind them. With no gate (reduced
 *  motion, a test) it opens at once. */
export function startPracticeThroughGate(): void {
  void requestRankedGate(() => {
    const g = useGame.getState();
    // The Heroes row reads Beginner when the draft has never been set: make that explicit before the offer is rolled.
    if (!g.practiceDraft.heroes) g.setPracticeDraft({ heroes: 'beginner' });
    useGame.setState({ showTitle: false, avatarPickerOpen: false });
    useGame.getState().confirmPracticeSetup();
  }, 'entry', { reveal: revealForPending });
}
