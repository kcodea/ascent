/**
 * SET 3 KOBOLDS (owner batch 2026-10-22): what the moving numbers show.
 *
 * Rosey prints its CURRENT per-Ruby grant in place of +2/+1 once it has improved (the live-text rule); the Refreshes
 * owed to its next step are the integer counter under the card (`stepProgress`'s refresh branch), never prose (owner:
 * integers only). Zapdash wears the shared Pummel badge (total mod 10). Frack Attack's 3-attack meter is an N/3 counter.
 */
import { describe, expect, it } from 'vitest';
import { liveCardText } from './instView';
import { stepProgress } from './cardText';

const base = { tier: 6, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0 };
const live = (id: string, eotTick: number | undefined, golden = false) => {
  const r = liveCardText(id, { ...base, golden, eotTick } as never);
  return golden ? r.goldenText ?? r.text : r.text;
};

describe('Rosey: the current grant in place, the countdown as the counter', () => {
  it('prints the authored +2/+1 until the first step, then the live grant', () => {
    expect(live('k3_rosey', 0)).toBe('When you cast a **Ruby**, this gains **+2/+1** permanently. Improves every **3** Refreshes.');
    expect(live('k3_rosey', 2)).toContain('**+2/+1**');
    expect(live('k3_rosey', 3)).toContain('{{+4/+2}}');
    expect(live('k3_rosey', 7)).toContain('{{+6/+3}}');
    expect(live('k3_rosey', 3, true)).toContain('{{+8/+4}}');
    expect(live('k3_rosey', 7)).not.toMatch(/\bmore\b|\d+\/\d+(?!\/)/);
  });

  it('counts the Refreshes toward the next step as the plain integer N/3, no "Refresh" word (owner 2026-10-22)', () => {
    // "change rosey to our typical x/3 setup. we dont want to show 'refreshes' etc in our counter text"
    expect(stepProgress('k3_rosey', { eotTick: 0 })).toEqual({ current: 0, total: 3 });
    expect(stepProgress('k3_rosey', { eotTick: 1 })).toEqual({ current: 1, total: 3 });
    expect(stepProgress('k3_rosey', { eotTick: 3 })).toEqual({ current: 3, total: 3 }); // the step lands on 3/3
    expect(stepProgress('k3_rosey', { eotTick: 4 })).toEqual({ current: 1, total: 3 });
    expect(stepProgress('k3_rosey', {}), 'no counter in combat (Refreshes are a Shop thing)').toBeNull();
  });
});

describe('Zapdash and Frack Attack wear their meters', () => {
  it('Zapdash: the Pummel badge reads the lifetime tally mod 12 (Pummel (12) since 2026-10-27)', () => {
    expect(stepProgress('k3_zapdash', { damageDealt: 23 })).toMatchObject({ current: 11, total: 12 });
  });
  it('Frack Attack: the friendly-attack meter as N/3', () => {
    expect(stepProgress('k3_frackattack', { attackSeen: 0 })).toMatchObject({ current: 0, total: 3 });
    expect(stepProgress('k3_frackattack', { attackSeen: 4 })).toMatchObject({ current: 1, total: 3 });
  });
});
