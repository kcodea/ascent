/**
 * THE PER-DOMAIN APPROVED REGISTRY — structure + the 2026-09-23 split proof.
 *
 * The monolith `registry/approved.ts` (94 rules, one chronological tail every PR appended to) was split into
 * one file per `RuleDomain` by `scripts/split-registry.mjs`. This lane keeps three things true forever:
 *
 *  · `APPROVED_RULES` IS the concatenation of the domain files in `APPROVED_DOMAIN_ORDER` (no rule can be
 *    filed and yet missing from the registry, and the order is the fixed one — never chronological).
 *  · every rule in `<domain>.ts` declares that domain (a misfiled rule is a test failure naming the move).
 *  · every id that was live at the split is still accounted for — live or explicitly retired — because
 *    ids are stable and never recycled (owner rule; CLAUDE.md "Bug fixes become rules"). This is the
 *    "id for id" half of the migration proof; the byte-for-byte half (each rule's source text unchanged,
 *    canonical hash 940ce4d2… identical before and after) was measured by the script and is recorded in
 *    docs/devlog/2026-09-23-generated-rule-counts-registry-split.md.
 *
 * SABOTAGE (measured 2026-09-23): pointing the record's `combat` slot at `COPYING_RULES` reddened three of
 * the four cases — the misfile case with "R-COPY-01 declares domain 'copying' but is filed in
 * approved/combat.ts — move it to approved/copying.ts", the concatenation case (duplicate ids), and the
 * ids-never-vanish case (R-CEL-01 gone).
 */
import { describe, expect, it } from 'vitest';
import { APPROVED_BY_DOMAIN, APPROVED_DOMAIN_ORDER, APPROVED_RULES } from './index';
import { RETIRED_IDS } from '../retired';
import { AUTO_RETIRED_IDS } from '../retired.generated';

/** Every approved id at the moment of the split (registry sha256 940ce4d2d1c6…, 94 rules). Ids are
 *  stable and never recycled, so this list only ever GROWS in meaning — a vanished id means a rule was
 *  deleted instead of retired, which is the one move the registry forbids. */
const IDS_AT_SPLIT = [
  'R-CEL-01', 'R-PLAY-01', 'R-COPY-01', 'R-COPY-02', 'R-AURA-01', 'R-AVWIN-01',
  'R-AVWIN-02', 'R-AVWIN-03', 'R-AVWIN-04', 'R-AVWIN-05', 'R-AVWIN-06', 'R-AVWIN-07',
  'R-AVWIN-08', 'R-AVWIN-09', 'R-AVWIN-10', 'R-AVWIN-11', 'R-RUNEDUP-01', 'R-RUNEDUP-02',
  'R-RUNEDUP-03', 'R-RUNEDUP-04', 'R-RUNEDUP-05', 'R-RUNEDUP-06', 'R-RUNEDUP-07', 'R-RUNEDUP-08',
  'R-ORD-01', 'R-ORD-02', 'R-MULT-01', 'R-SHOUT-01', 'R-TURN-01', 'R-GILD-01',
  'R-GILD-02', 'R-RISE-01', 'R-MULT-02', 'R-TIER-01', 'R-GIFT-01', 'R-RALLY-01',
  'R-RALLY-02', 'R-SHOP-01', 'R-REFLECT-01', 'R-RUNE-SUM-01', 'R-HAND-01', 'R-RISE-02',
  'R-ENGRAVE-01', 'R-TARGET-01', 'R-HAND-02', 'R-RISE-03', 'R-TEXT-01', 'R-AURA-02',
  'R-RISE-04', 'R-RISE-05', 'R-HAND-03', 'R-ARMOR-01', 'R-RAND-01', 'R-ORD-03',
  'R-ORD-04', 'R-TEXT-02', 'R-TEXT-03', 'R-HAND-04', 'R-MULT-03', 'R-SHOP-02',
  'R-PROV-01', 'R-TARGET-02', 'R-TARGET-03', 'R-PUMMEL-01', 'R-MULT-04', 'R-AVWIN-12',
  'R-HOLD-01', 'R-TEXT-04', 'R-SNAP-01', 'R-RANK-01', 'R-RANK-02', 'R-TEXT-05',
  'R-LOBBY-01', 'R-TEXT-06', 'R-TEXT-07', 'R-TEXT-08', 'R-MULT-05', 'R-SHOP-03',
  'R-RANK-03', 'R-PRESENT-01', 'R-LOBBY-02', 'R-HALL-01', 'R-LOBBY-03', 'R-RANK-04',
  'R-REPORT-01', 'R-PRESENT-02', 'R-EQUIP-01', 'R-PRESENT-03', 'R-PRESENT-04', 'R-CAREER-01',
  'R-REPEAT-01', 'R-REPORT-02', 'R-PRESENT-05', 'R-LOBBY-04',
];

describe('registry/approved — one file per domain', () => {
  it('APPROVED_RULES is exactly the domain files concatenated in APPROVED_DOMAIN_ORDER', () => {
    const expected = APPROVED_DOMAIN_ORDER.flatMap((d) => APPROVED_BY_DOMAIN[d].map((r) => r.id));
    expect(APPROVED_RULES.map((r) => r.id)).toEqual(expected);
    expect(new Set(expected).size, 'duplicate approved id across domain files').toBe(expected.length);
  });

  it('the order lists every domain of the record exactly once (and nothing else)', () => {
    expect([...APPROVED_DOMAIN_ORDER].sort()).toEqual(Object.keys(APPROVED_BY_DOMAIN).sort());
    expect(new Set(APPROVED_DOMAIN_ORDER).size).toBe(APPROVED_DOMAIN_ORDER.length);
  });

  it('every rule is filed under the domain it declares', () => {
    for (const domain of APPROVED_DOMAIN_ORDER) {
      for (const r of APPROVED_BY_DOMAIN[domain]) {
        expect(r.domain, `${r.id} declares domain '${r.domain}' but is filed in approved/${domain}.ts — move it to approved/${r.domain}.ts`).toBe(domain);
      }
    }
  });

  it('every id live at the 2026-09-23 split is still live (or explicitly retired) — ids never vanish', () => {
    const live = new Set(APPROVED_RULES.map((r) => r.id));
    expect(IDS_AT_SPLIT.length).toBe(94);
    for (const id of IDS_AT_SPLIT) {
      expect(live.has(id) || RETIRED_IDS.has(id) || AUTO_RETIRED_IDS.has(id), `${id} was approved at the split and is now neither live nor retired`).toBe(true);
    }
  });
});
