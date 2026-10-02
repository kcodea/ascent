/**
 * REPLAY V2 — the recorded End of Turn (owner report 2026-10-02, verbatim: "noticing a gap in the replay system -
 * when watching this back, the end of turn with lasting cadence etc wasnt showing any animation or beats at all").
 *
 * Root cause: live End of Turn is a PresentationBatch the Choreographer plays from the End Turn click, before
 * `faceOmen` commits. The replay recorded only the fight's frame, so playback jumped from the last shop action
 * straight to combat with no beats. The fix records the batch on the fight's frame (`CombatFrame.eot`) and the
 * player hands it to Recruit (`replayEotCue`) before the fight renders.
 *
 * Covered here: capture through the REAL store's prepare/commit path, the recorded batch compiling to one beat
 * per Lasting Cadence Rally, the player holding the fight until the beats report done, pause/seek behaviour, and
 * an old recording (no `eot`) still going straight to its fight.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  combatFrameOf, createRun, eotRecordOf, prepareActionWithPresentation, shopFrameOf,
  type CombatFrame, type ReplayV2, type RunState,
} from '@game/sim';
import { compileTimeline } from '../choreographer/compileTimeline';
import { normalizePresentationBatch } from '../choreographer/adapters/presentationBatchAdapter';
import { endReplay, pauseReplay, resumeReplay, seekReplay, startReplay } from './replayPlayer';
import { useGame } from '../store';

const CADENCE = 'rune:rune_lasting_cadence:endOfTurn';

/** A Shop with three Rally minions under Rune of Lasting Cadence (the owner's report). */
function cadenceRun(): RunState {
  const base = createRun(3, 'warden');
  return {
    ...base,
    phase: 'recruit',
    board: Array.from({ length: 3 }, (_, i) => ({
      uid: `r${i}`, cardId: 'd2_cinderchef', tribe: 'dragon', attack: 1, health: 3, keywords: ['RL'], golden: false,
    })),
    runeLastingCadence: true,
  } as RunState;
}

/** shop(turnStart @0) then fight(@6000), the fight carrying the End of Turn pressed at 2000 (or none). */
function makeReplay(withEot: boolean): { replay: ReplayV2; fight: CombatFrame } {
  const before = cadenceRun();
  const tx = prepareActionWithPresentation(before, { type: 'faceOmen' });
  const fight = combatFrameOf(before, tx.after, 6000);
  if (withEot) fight.eot = eotRecordOf(tx.batch, 2000, tx.after)!;
  return {
    fight,
    replay: {
      version: 2, seed: before.seed, heroId: before.heroId, mode: 'lobby', author: 'brackus', patch: 'test',
      frames: [shopFrameOf(before, 'turnStart', 0), fight],
      result: { placement: 1, record: { wins: 0, losses: 0, draws: 0 }, finalBoard: null },
    },
  };
}

const cadenceBeats = (fight: CombatFrame): number =>
  compileTimeline(normalizePresentationBatch(fight.eot!.batch)).beats.filter((b) => b.policyKey === CADENCE).length;

describe('capture: the fight frame records the End of Turn it followed', () => {
  it('eotRecordOf keeps an End-of-Turn batch (deep-cloned) and drops an empty or non-EoT one', () => {
    const before = cadenceRun();
    const tx = prepareActionWithPresentation(before, { type: 'faceOmen' });
    const rec = eotRecordOf(tx.batch, 1234, tx.after)!;
    expect(rec.atMs).toBe(1234);
    expect(rec.batch).toEqual(tx.batch);
    expect(rec.batch).not.toBe(tx.batch);
    expect(eotRecordOf(null, 0, tx.after)).toBeNull();
    expect(eotRecordOf({ ...tx.batch!, events: [] }, 0, tx.after)).toBeNull();
    expect(eotRecordOf({ ...tx.batch!, phase: 'recruit' }, 0, tx.after)).toBeNull();
  });

  it('the REAL store: End Turn through prepare then commit stamps `eot` on the fight frame, at or before the fight time', () => {
    const prev = useGame.getState();
    try {
      useGame.setState({ run: cadenceRun(), replayFrames: [], presentationTx: null });
      useGame.getState().preparePresentationAction({ type: 'faceOmen' });
      useGame.getState().commitPresentationAction();
      const fight = useGame.getState().replayFrames.find((f): f is CombatFrame => f.kind === 'combat');
      expect(fight, 'the fight was recorded').toBeDefined();
      expect(fight!.eot, 'and the End of Turn that led into it').toBeDefined();
      expect(fight!.eot!.atMs).toBeLessThanOrEqual(fight!.tMs);
      expect(cadenceBeats(fight!), 'one Lasting Cadence beat per Rally minion').toBe(3);
      // Survives the trip through JSON (drafts and uploads are JSON).
      const round = JSON.parse(JSON.stringify(fight)) as CombatFrame;
      expect(cadenceBeats(round)).toBe(3);
    } finally {
      useGame.setState({ run: prev.run, replayFrames: prev.replayFrames, presentationTx: null });
    }
  });
});

describe('playback: the recorded End of Turn plays before the fight', () => {
  afterEach(() => { endReplay(); vi.useRealTimers(); });

  it('holds the shop until End Turn was pressed, cues the recorded beats, and renders the fight only once they finish', () => {
    vi.useFakeTimers();
    const { replay, fight } = makeReplay(true);
    startReplay(replay);
    expect(useGame.getState().replaySession?.index).toBe(0);
    expect(useGame.getState().replayEotCue).toBeNull();

    vi.advanceTimersByTime(1999);
    expect(useGame.getState().replayEotCue, 'not before End Turn was pressed').toBeNull();
    vi.advanceTimersByTime(1);
    const cue = useGame.getState().replayEotCue;
    expect(cue, 'End Turn pressed: the beats are cued').not.toBeNull();
    expect(cue!.eot.batch).toEqual(fight.eot!.batch);
    const beats = compileTimeline(normalizePresentationBatch(cue!.eot.batch)).beats.filter((b) => b.policyKey === CADENCE);
    expect(beats, 'the cued batch compiles to one Lasting Cadence beat per Rally').toHaveLength(3);
    expect(useGame.getState().replaySession?.index, 'the shop stays on screen while the beats play').toBe(0);
    expect(useGame.getState().run.phase).toBe('recruit');

    vi.advanceTimersByTime(10_000);
    expect(useGame.getState().replaySession?.index, 'the fight waits for the beats').toBe(0);

    useGame.setState({ replayEotDone: cue!.key }); // Recruit reports the batch played
    expect(useGame.getState().replaySession?.index).toBe(1);
    expect(useGame.getState().run.phase).toBe('combat');
    expect(useGame.getState().replayEotCue, 'the cue clears with the fight render').toBeNull();
  });

  it('a pause mid-beats lets them finish; resume renders the fight', () => {
    vi.useFakeTimers();
    startReplay(makeReplay(true).replay);
    vi.advanceTimersByTime(2000);
    const cue = useGame.getState().replayEotCue!;
    pauseReplay();
    expect(useGame.getState().replayEotCue, 'pausing does not cancel the beats').not.toBeNull();
    useGame.setState({ replayEotDone: cue.key });
    expect(useGame.getState().replaySession?.index, 'paused: no advance').toBe(0);
    resumeReplay();
    expect(useGame.getState().replaySession?.index).toBe(1);
  });

  it('a seek drops the cue, and a stale completion cannot advance the replay', () => {
    vi.useFakeTimers();
    startReplay(makeReplay(true).replay);
    vi.advanceTimersByTime(2000);
    const cue = useGame.getState().replayEotCue!;
    seekReplay(0);
    expect(useGame.getState().replayEotCue).toBeNull();
    expect(useGame.getState().replaySession?.index).toBe(0);
    useGame.setState({ replayEotDone: cue.key });
    expect(useGame.getState().replaySession?.index, 'the stale key is ignored').toBe(0);
  });

  it('an OLD recording (no `eot`) goes straight to its fight at the recorded time, as before', () => {
    vi.useFakeTimers();
    startReplay(makeReplay(false).replay);
    vi.advanceTimersByTime(5999);
    expect(useGame.getState().replaySession?.index).toBe(0);
    vi.advanceTimersByTime(1);
    expect(useGame.getState().replayEotCue).toBeNull();
    expect(useGame.getState().replaySession?.index).toBe(1);
  });
});
