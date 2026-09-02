import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The authoritative End-of-Turn player's half of the Reliquary fix (owner report 2026-09-01). The batch side
 * is pinned in `sim/reliquaryBeats.test.ts`; these pin what the player DOES with a minion-sourced rune beat and
 * an `echoFired` consequence, as source pins — the player is a hook over live DOM (no jsdom in this repo).
 */
const REPLAY = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../Recruit.tsx'), 'utf8');

describe('a minion-sourced RUNE beat (Reliquary / Lasting Cadence / Combat Prowess)', () => {
  it("draws the rune's ribbon to the acting minion AS the beat lands, from the beat's identity", () => {
    const i = REPLAY.indexOf('onBeatActivate: (beat) => {');
    expect(i).toBeGreaterThan(-1);
    const block = REPLAY.slice(i, i + 1800);
    expect(block.includes("beat.policyKey?.startsWith('rune:')"), 'keyed on the rune identity, not on an effect name').toBe(true);
    expect(block.includes("presenterCtx.questTendril('rune', runeId, uid, 0)"), 'the same ribbon the rune-sourced consequences draw').toBe(true);
  });
});

describe('the commit after the beats replays nothing', () => {
  it('advances every legacy per-action FX tracker past the committed seqs (the Rubies / tendrils already played on their beats)', () => {
    const i = REPLAY.indexOf('eotPadFiredRef.current = true;'); // the authoritative End-of-Turn completion
    expect(i).toBeGreaterThan(-1);
    const block = REPLAY.slice(i, i + 2600);
    expect(block.includes('captureRecruitSeqs(committed, prevRecruitSeqs.current)'), 'the moment-cue runner (Ruby cascades) must not replay at commit').toBe(true);
    expect(block.includes('prevFxSeq.current = committed.recruitFxSeq'), 'the buff tendril watcher must not replay at commit').toBe(true);
  });
});

describe('the Echo skull on its beat', () => {
  it('plays the skull on the Echo minion and marks it pre-fired so the commit-time stamp never replays it', () => {
    const i = REPLAY.indexOf('echoFired: (uid) => {');
    expect(i, 'the presenter exists').toBeGreaterThan(-1);
    const block = REPLAY.slice(i, i + 900);
    expect(block.includes('preFiredEchoRef.current.add(uid)'), 'dedupes the legacy shopDeathFx stamp').toBe(true);
    expect(block.includes('pixiFx.deathrattle('), 'the same skull-shatter combat and the shop destroy play').toBe(true);
    expect(block.includes('cfg.echoEnabled'), 'honours the shop death FX tuner').toBe(true);
  });
});
