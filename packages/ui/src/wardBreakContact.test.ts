import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CombatEvent } from '@game/core';
import { buildBeats, RESULT_TYPES } from './combatBeats';

/**
 * THE WARD BREAK PLAYS AT CONTACT (owner report 2026-09-26: "i feel like the ward lost isnt playing when a normal
 * ward breaks"). `ward-lost-blast` is meant to burst at the lunge's contact (`onImpactAuras`), but the lunge only
 * scanned the ATTACK beat for `shield` events, and `buildBeats` puts the swing's hit (dmg / shield / death) in the
 * NEXT beat. So the scan found nothing and the burst fell through to the result moment's `auraBreak` cue, ~300ms
 * after contact, behind the death dissolve. Measured live on the dev build: 313ms late before, 2ms after.
 */
const ev = (e: Partial<CombatEvent> & { type: CombatEvent['type'] }): CombatEvent => e as CombatEvent;

describe('Ward break at the lunge contact', () => {
  it('the swing’s Ward break lives in the RESULT beat right after the attack beat (why the lunge must look ahead)', () => {
    const events = [
      ev({ type: 'attack', attacker: 'a', defender: 'd' } as never),
      ev({ type: 'dmg', target: 'd', amount: 2, source: 'a' } as never),
      ev({ type: 'shield', target: 'a' } as never),
      ev({ type: 'death', target: 'd' } as never),
    ];
    const beats = buildBeats(events);
    expect(beats[0]).toMatchObject({ start: 0, end: 1 });
    expect(beats[1]!.start).toBe(beats[0]!.end);
    expect(RESULT_TYPES.has(beats[1]!.primary.type)).toBe(true);
    const inResult = events.slice(beats[1]!.start, beats[1]!.end).some((e) => e.type === 'shield');
    expect(inResult).toBe(true);
  });

  it('the lunge claims the result beat’s Ward breaks, and the result moment skips what was claimed', () => {
    const replay = readFileSync(join(__dirname, 'useCombatReplay.ts'), 'utf8');
    expect(replay).toContain('const hitIsThisSwing = !!hit && hit.start === cur.end && RESULT_TYPES.has(hit.primary.type);');
    expect(replay).toContain("if (e?.type === 'shield') { wardTargets.push(e.target); contactWardIdxRef.current.add(i); }");
    expect(replay).toContain('onShieldBreak: (uid, i) => { if (i !== undefined && contactWardIdxRef.current.delete(i)) return;');
    const score = readFileSync(join(__dirname, 'choreo', 'score.ts'), 'utf8');
    expect(score).toContain("if (e?.type === 'shield') ctx.onShieldBreak(e.target, i);");
  });
});
