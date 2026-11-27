import { useCallback, useRef, useState } from 'react';
import { PACK_REWARD_EVERY, packRewardAfter, type ClaimRewardOutcome, type OwnedPack, type PackRewardState } from '@game/progression';
import { labRewardPack, type LabState } from './shopLabData';

/**
 * THE LAB'S PACK REWARD (dev only): the count toward the free Legendary Pack and its claim, answered the way the server
 * will (one reward per claim, never two for the same request id). It starts a few purchases short, so a session sees the
 * reward come up without buying fifteen packs first.
 */
export const LAB_REWARD_START: PackRewardState = { progress: PACK_REWARD_EVERY - 3, ready: 0 };

export function useLabReward(stateRef: { readonly current: LabState }, setState: (next: LabState) => void) {
  const [reward, setRewardRaw] = useState<PackRewardState>(LAB_REWARD_START);
  const rewardRef = useRef(reward);
  const setReward = useCallback((next: PackRewardState): void => { rewardRef.current = next; setRewardRaw(next); }, []);
  const claimed = useRef(new Map<string, readonly OwnedPack[]>());
  /** `packs` more purchased packs count toward the reward. */
  const count = useCallback((packs: number): void => { if (packs > 0) setReward(packRewardAfter(rewardRef.current, packs)); }, [setReward]);
  const claim = useCallback(async (requestId: string): Promise<ClaimRewardOutcome> => {
    const again = claimed.current.get(requestId);
    if (again) return { status: 'ok', packs: again };
    const r = rewardRef.current;
    if (r.ready <= 0) return { status: 'error', reason: 'none' };
    setReward({ ...r, ready: r.ready - 1 });
    const packs = [labRewardPack()];
    claimed.current.set(requestId, packs);
    const cur = stateRef.current;
    setState({ ...cur, hand: [...cur.hand, ...packs] });
    return { status: 'ok', packs };
  }, [setReward, setState, stateRef]);
  const reset = useCallback((): void => { claimed.current.clear(); setReward(LAB_REWARD_START); }, [setReward]);
  return { reward: { rarity: 'legendary' as const, every: PACK_REWARD_EVERY, ...reward }, count, claim, reset };
}
