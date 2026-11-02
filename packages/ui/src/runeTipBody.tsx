import { RUNE_INDEX } from '@game/content';
import { runeLiveStateOfRun, type RunState, type RuneLiveState } from '@game/sim';
import { mdBold } from './Card';
import { questRewardLiveText } from './questText';
import { runeTally } from './runeTally';
import { liveRuneText } from './runeText';

/**
 * THE RUNE TOOLTIP'S CONTENTS, one copy for every surface that shows a rune's badge tip (owner ask 2026-11-01:
 * "mouseover on runes here is important, and it should show any relevant values if the player has value shown on
 * their runes etc"; R-RAIL-SCOUT-RUNE-TIP-02).
 *
 * The player's own rune rack (QuestBadges) and the lobby rail's scout card print the SAME tip: the rune's name, its
 * text with the CURRENT value folded in (`liveRuneText`), the live reward line where the reward names something only
 * the run knows (Rune of Recollection's spell), and the state pill with the rune's live meter (`runeTally`).
 *
 * What each surface knows decides how live it is:
 *  - `run`: a whole run (your own rack; your own seat on the rail, or the watched player's when spectating). Every
 *    value is live, the meters included.
 *  - `live` / `firstSpellId` only: a captured board (every other seat on the rail). The snapshot carries the grown
 *    combat values (Wild Hunt, Packcraft, Beastial Swarm, Borrowed Flame) and the turn's first spell, but not the
 *    Shop meters, so those print their base and the pill shows no meter.
 */
export interface RuneTipSource {
  /** The run itself, when the surface holds it: every value and meter is read off it. */
  run?: RunState;
  /** The grown value of self-improving runes. Defaults to the run's own when `run` is given. */
  live?: RuneLiveState | null;
  /** The first spell cast this turn, for a captured board (`run` answers this itself). Absent = unknown: no line. */
  firstSpellId?: string;
  /** A meter the surface already computed (QuestBadges folds the combat delta in). Defaults to `runeTally(run)`. */
  tally?: string | null;
}

export interface RuneTipLines {
  name: string;
  /** Rune text with the live value in place (markdown bold, for `mdBold`). */
  text: string;
  /** "Now: a copy of X", or null when the reward has nothing live to say (or the surface cannot know it). */
  liveLine: string | null;
  /** The state pill: "Rune · active", plus the live meter when there is one. */
  state: string;
}

/** The tip's lines for one rune from one source. Pure; the scout card's test reads it directly. */
export function runeTipLines(runeId: string, src: RuneTipSource): RuneTipLines | null {
  const rune = RUNE_INDEX[runeId];
  if (!rune) return null;
  const { run } = src;
  const live = src.live !== undefined ? src.live : run ? runeLiveStateOfRun(run) : null;
  const tally = src.tally !== undefined ? src.tally : run ? runeTally(run, runeId) : null;
  // A whole run always knows its first spell (none cast yet is an answer); a captured board only when it recorded it.
  const liveLine = run
    ? questRewardLiveText(rune.reward, { firstSpellId: run.firstSpellThisTurnId })
    : src.firstSpellId ? questRewardLiveText(rune.reward, { firstSpellId: src.firstSpellId }) : null;
  return {
    name: rune.name,
    text: liveRuneText(rune.id, rune.text, live),
    liveLine,
    state: `Rune · active${tally ? ` · ${tally}` : ''}`,
  };
}

/** The tip's inner markup (the host supplies the `.questbadge-tip` wrapper and its placement). */
export function RuneTipBody({ runeId, src }: { runeId: string; src: RuneTipSource }): JSX.Element | null {
  const l = runeTipLines(runeId, src);
  if (!l) return null;
  return (
    <>
      <b>{l.name}</b>
      <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(l.text) }} />
      {l.liveLine ? <span className="questbadge-tip-live">{l.liveLine}</span> : null}
      <span className="questbadge-tip-state">{l.state}</span>
    </>
  );
}
