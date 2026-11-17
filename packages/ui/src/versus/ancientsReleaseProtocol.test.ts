/**
 * TRIPWIRE (R-ANCIENTS-RELEASE-01, R-VERSUS-WORKER-RULES-01): turning the Ancients release switch on changes Versus fight
 * rules with no card, rune or quest change, so the Versus Worker protocol must move with it. With the switch OFF the
 * protocol stays 3; the PR that flips `ANCIENTS_LIVE` must bump `VERSUS_CF_PROTOCOL` to 4 (and deploy that Worker).
 */
import { describe, expect, it } from 'vitest';
import { ANCIENTS_LIVE } from '@game/sim';
import { VERSUS_CF_PROTOCOL } from '@game/versus-cf/protocol';

describe('the Ancients switch and the Versus Worker protocol move together', () => {
  /** The Worker protocol the builds without Ancients play on (2026-11-16). */
  const PROTOCOL_WITHOUT_ANCIENTS = 3;
  it(ANCIENTS_LIVE ? 'switch ON: the Worker protocol is past the pre-Ancients one' : 'switch OFF: nothing to bump yet', () => {
    if (ANCIENTS_LIVE) expect(VERSUS_CF_PROTOCOL).toBeGreaterThan(PROTOCOL_WITHOUT_ANCIENTS);
    else expect(VERSUS_CF_PROTOCOL).toBeGreaterThanOrEqual(PROTOCOL_WITHOUT_ANCIENTS);
  });
});
