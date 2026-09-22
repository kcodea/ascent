/**
 * ENFORCEMENT integrity + the §10.3 approved-but-unenforced queue + sabotage cases.
 *
 *  · Every declared enforcement resolves for real: scenario/property refs exist ON DISK (fs-checked at
 *    test time, rooted at the repo), oracle refs name a known lane whose backing file also exists. A
 *    renamed or deleted pinning test fails HERE, loudly — an enforcement ref can never rot silently.
 *  · The approved-but-unenforced queue is a TWO-SIDED ratchet: the count can only move through this pin,
 *    downward by adding a probe (or an honest `manual` classification), upward only with a new approved
 *    rule that genuinely has no probe yet.
 *  · Sabotage (§3.5): a fabricated rule with a nonexistent ref / unknown lane / reason-less manual must
 *    fail the validator for the intended reason — proving the oracle can actually catch the bug shape.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allRules } from './index';
import {
  ENFORCEMENT_LANES, RULE_ENFORCEMENT, enforcementErrors, enforcementOf, unenforcedApproved,
} from './enforcement';
import { RETIRED_RULES } from './registry/retired';
import { AUTO_RETIRED_RULES } from './registry/retired.generated';

// packages/rules/src → three levels up = the repo root.
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const env = { fileExists: (p: string) => existsSync(resolve(ROOT, p)) };

describe('enforcement refs are real (anti-rot)', () => {
  it('every oracle lane names a backing file that exists', () => {
    for (const [lane, def] of Object.entries(ENFORCEMENT_LANES)) {
      expect(env.fileExists(def.file), `lane '${lane}' backs onto missing file '${def.file}'`).toBe(true);
      expect(def.what.length, `lane '${lane}' has no description`).toBeGreaterThan(10);
    }
  });

  it('every live rule enforcement validates (refs exist, lanes known, manual carries a reason)', () => {
    for (const r of allRules()) {
      const enf = enforcementOf(r);
      if (!enf) continue;
      expect(enforcementErrors(r.id, enf, env)).toEqual([]);
    }
  });

  it('every RULE_ENFORCEMENT key refers to a live rule (a stale key means the rule left the board)', () => {
    const live = new Set(allRules().map((r) => r.id));
    for (const id of Object.keys(RULE_ENFORCEMENT)) {
      expect(live.has(id), `RULE_ENFORCEMENT['${id}'] enforces a rule that no longer exists — move it to the retired entry or delete it`).toBe(true);
    }
  });

  it('every hand-retired ruling carries validating enforcement (implemented rulings keep their pins machine-checkable)', () => {
    for (const r of RETIRED_RULES) {
      expect(r.enforcement, `${r.id}: hand-retired without enforcement — a resolved ruling must name its pin`).toBeTruthy();
      expect(enforcementErrors(r.id, r.enforcement!, env)).toEqual([]);
    }
    // Auto tombstones (stale/rejected questions) have nothing to pin — but any that DO declare must validate.
    for (const r of AUTO_RETIRED_RULES) {
      if (r.enforcement) expect(enforcementErrors(r.id, r.enforcement, env)).toEqual([]);
    }
  });
});

describe('the approved-but-unenforced queue (§10.3, two-sided ratchet)', () => {
  it('exactly the honest gaps remain — move this pin only by adding a probe or a new approved rule', () => {
    const queue = unenforcedApproved(allRules()).map((r) => r.id).sort();
    // R-AURA-01: no probe yet pins the behavioral aura contract (future-eligibles, plain-copy reception,
    //            zone coverage/lifetime) — auraFx.test.ts checks the FX stamp, not the contract.
    // R-PLAY-01: no single probe pins the played-card definition's negative half (buy/generate/draw/
    //            reorder/triggered-cast do not count as plays).
    expect(queue).toEqual(['R-AURA-01', 'R-PLAY-01']);
  });
});

/**
 * OPEN PINS — a rule whose currentBehaviour says PARTIAL because the test that would pin the missing half
 * is still in flight on another branch. A note in a PR body is not a gate: nothing fails if the ref is never
 * appended. This is the gate. Each entry names the file the rule is waiting for; the moment that file lands
 * on disk, the rule must cite it or this test reddens. Delete the entry when you append the ref.
 */
const OPEN_PINS: { rule: string; ref: string; why: string }[] = [
  {
    rule: 'R-AVWIN-12',
    ref: 'packages/ui/src/avengeSummonReadout.test.ts',
    why: "PR #1618 (the Reclaim insert + the combat readout). The one current ref pins the ORDINARY summon path (the #1176 baseline stamp, which is already R-AVWIN-01 ground); neither half R-AVWIN-12 adds is pinned until this file lands.",
  },
];

describe('open pins (a PARTIAL rule cannot quietly stay unpinned)', () => {
  it('every open pin names a live rule', () => {
    const live = new Map(allRules().map((r) => [r.id, r]));
    for (const p of OPEN_PINS) {
      expect(live.has(p.rule), `open pin names rule '${p.rule}', which is not live — retire the entry`).toBe(true);
      expect(p.why.length, `open pin ${p.rule} gives no reason`).toBeGreaterThan(20);
    }
  });

  it('once the awaited test exists on disk, its rule cites it', () => {
    const live = new Map(allRules().map((r) => [r.id, r]));
    for (const p of OPEN_PINS) {
      if (!env.fileExists(p.ref)) continue; // still in flight — the rule stays honestly PARTIAL
      const refs = enforcementOf(live.get(p.rule)!)?.refs ?? [];
      expect(refs, `${p.ref} has landed: append it to ${p.rule}'s enforcement refs, flip its currentBehaviour to Conforms, and delete its OPEN_PINS entry`)
        .toContain(p.ref);
    }
  });
});

describe('sabotage (§3.5): the validator fails for the intended reason', () => {
  it('a fabricated approved rule with a nonexistent scenario ref fails', () => {
    const errs = enforcementErrors('R-FAKE-01', { kind: 'scenario', refs: ['packages/sim/src/doesNotExist.test.ts'] }, env);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('does not exist on disk');
  });

  it('an oracle ref to an unknown lane fails', () => {
    const errs = enforcementErrors('R-FAKE-02', { kind: 'oracle', refs: ['imaginaryLane'] }, env);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('not a known lane');
  });

  it("a 'manual' classification without a reason fails; with a reason it stands", () => {
    expect(enforcementErrors('R-FAKE-03', { kind: 'manual', refs: [] }, env).length).toBe(1);
    expect(enforcementErrors('R-FAKE-03', { kind: 'manual', refs: [], reason: 'purely visual layout ruling' }, env)).toEqual([]);
  });

  it('an empty non-manual refs list enforces nothing and fails', () => {
    const errs = enforcementErrors('R-FAKE-04', { kind: 'property', refs: [] }, env);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('declares no refs');
  });
});
