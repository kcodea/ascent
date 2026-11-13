/**
 * MAGICIAN'S MAGIC HAT on the hero power button (owner 2026-11-10, R-DUOS-MAGICIAN-01: "Add a counter for magician and
 * when it activates, the hero power should get an obvious animation / glow that it's going to fire. You can use the hero
 * power ready animation for this").
 *
 * One pure view model for every screen that renders the power (my Shop, my teammate's view of my board, combat): the
 * counter badge's text, whether the button wears the existing READY treatment, and the tip's status line. All of it
 * reads `magicHatView`, the same read the buy itself gates on, so the badge can never promise a copy the buy would not
 * send. Null when the run does not wield the hat.
 */
import { activePowers, magicHatView, type RunState } from '@game/sim';

export interface MagicHatBadge {
  /** The counter above the power: buys toward the hat, "2/3". */
  tally: string;
  /** The next buy sends the copy AND the Shop is open: the button wears the ready call until that buy. Never in combat
   *  (no card can be bought there, so a glow would be stale). */
  ready: boolean;
  /** The next card bought sends the copy (any phase): the hat is one buy short of full, or full, with a copy left. */
  active: boolean;
  /** Full, but this turn's two copies are spent: it sends on the first buy of the next turn. The badge does not look ready. */
  capped: boolean;
  /** The tip's short status line. */
  status: string;
}

type HatRun = Pick<RunState, 'heroId' | 'phase' | 'wave' | 'magicHatBuys' | 'magicHatSent' | 'magicHatSentWave' | 'ancientsEnabled' | 'ancients'> & Parameters<typeof activePowers>[0];

export function magicHatBadge(run: HatRun, slot = 0): MagicHatBadge | null {
  if (activePowers(run)[slot]?.kind !== 'magicHat') return null;
  const hat = magicHatView(run);
  const tally = `${hat.count}/${hat.need}`;
  const status = hat.active ? `${tally} · ready` : hat.capped ? `${tally} · sends next turn` : tally;
  return { tally, ready: hat.active && run.phase === 'recruit', active: hat.active, capped: hat.capped, status };
}
