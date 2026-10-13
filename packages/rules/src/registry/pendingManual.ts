/**
 * HAND-AUTHORED pending rulings — ONE open card (q-guides-team-flag-account, 2026-10-12).
 * Before it: the 2026-08-27 triage round 2 drained the board, and the one card added since
 * (q-gangplank-self-buff, 2026-09-09) was decided the same day → R-TARGET-01 + a tombstone.
 *
 * The 24 cards that lived here (q-runedup-1..8 families, q-copy-gilded-badge, q-carry-demand-encore,
 * q-carry-warm-embers-double-dip, q-snap-impbank/rallyspreadatk/one-combat-marks/granted-effects/
 * echostripped, the four q-order-* ambiguities and the four q-interact-* ambiguities) were ALL decided by
 * the owner on 2026-08-27 (decisions.json). Each is tombstoned with its full disposition in
 * registry/retired.ts; the standing rules the rulings established live in registry/approved/<domain>.ts
 * (R-RUNEDUP-01..08, R-ORD-01/02, R-MULT-01, R-SHOUT-01).
 *
 * Unlike pending.generated.ts this file is NOT rewritten by `npm run rules:seed` — cards added here
 * survive every reseed untouched, and a decided card must be removed BY HAND with a hand tombstone in
 * registry/retired.ts (enforced by rules.test.ts). Same schema, same board, same decision flow as the
 * generated queue: decisions.json applies to these ids exactly as to generated ones. Every future card
 * must be self-contained (owner format feedback 2026-08-26): verbatim printed text, what the code does
 * TODAY (re-verified in source), one concrete example, and explicit click semantics.
 *
 * 2026-10-12: no longer empty. ONE card, `q-guides-team-flag-account`: the whole-branch review of the community
 * guides' moderation step found that two fixes had settled, in code and in tests, a rule the owner was never asked
 * about (which account is drawn the team's own controls). It is a QUESTION, not an approved rule: no owner words
 * exist for it. Its `sourceQueue` is `codeReview`, because no Doc Bot scan produced it.
 */
import type { GameRule } from '../schema';

/** The board's compact click tail (the same marks the generated cards end with), built from code points. */
const mark = String.fromCharCode;
const CLICK_TAIL = ` ${mark(0x2014)} ${mark(0x2713)} yes ${mark(0xb7)} ${mark(0x2715)} no (say why) ${mark(0xb7)} ${mark(0x270e)} your wording`;

export const MANUAL_PENDING: GameRule[] = [
  {
    id: 'q-guides-team-flag-account',
    title: 'Guides: what is drawn only for Team Ascent is drawn only for the account that holds the team flag',
    statement:
      'Anything drawn only for Team Ascent (Hide, Unhide, Delete, Edit on a Team Ascent guide, Import, the Reports pill, '
      + "the lobby rail's Edit) is drawn only for the account that holds the team flag, never for the next account on the "
      + `same device.${CLICK_TAIL}`,
    domain: 'foundation',
    status: 'needs-ruling',
    evidence: [
      { kind: 'code', ref: 'packages/ui/src/guides/CompendiumGuides.tsx', quote: 'On the team, only while the store holds the flag for THIS account: never the last account\'s (WHOSE GUIDES).' },
      { kind: 'code', ref: 'packages/ui/src/LobbyPanel.tsx', quote: 'The team flag belongs to the account the store read it for (`mineOwner`), like the player\'s own guides' },
      { kind: 'test', ref: 'packages/ui/src/guides/guidesReport.test.tsx', quote: "the next account is offered none of the team's buttons while the store still holds the last account's team flag" },
      { kind: 'test', ref: 'packages/ui/src/guides/lobbyGuidesRail.test.tsx' },
    ],
    currentBehaviour:
      'Since 2026-10-12 (branch feat/guides-moderation). The guides store keeps ONE team flag, with the user id it was read '
      + 'for (`mineOwner`). The Compendium Guides tab draws the team-only controls only while that id is the account signed '
      + 'in right now (`team = teamHeld && mineIsMine` in CompendiumGuides.tsx); the lobby rail gates its Edit the same way '
      + '(`ownsMine` in LobbyPanel.tsx). So if account A (on the team) signs out and account B signs in on the same device, '
      + 'and the store has not yet read for B, B is drawn none of these controls even though the store still holds A\'s flag. '
      + 'The server refuses every one of these writes for B in any case (the SQL checks the team table for the verified '
      + 'caller); this rule is about what is DRAWN. Pinned by guidesReport.test.tsx, guidesReportsPanel.test.tsx and '
      + 'lobbyGuidesRail.test.tsx.',
    recommendation:
      'Approve: keep it as built. A control that the server would refuse should not be drawn, and one account must never '
      + 'see what another account on the same device was allowed.',
    cardText:
      'Not a card. The controls in question, as drawn: on a player\'s guide card "Hide" / "Unhide" and "Delete"; on a Team '
      + 'Ascent guide card "Edit"; in the Guides toolbar "Import built-in guides" and the "Reports" pill; in the lobby rail, '
      + '"Edit" on a Team Ascent guide.',
    example:
      'Example: Mike (on the team) opens the Compendium, Guides, Community: every player guide shows Hide and Delete, and the '
      + 'toolbar shows the Reports pill. He signs out and a friend signs in on the same PC before the game has read the '
      + 'guides again. Today: the friend sees no Hide, no Delete and no Reports pill at once, and only Bookmark, Report and '
      + 'Duplicate. The other way to build it (rejecting this) would leave Mike\'s buttons on the friend\'s screen until the '
      + 'next read; pressing one would answer "Only Team Ascent can do that."',
    sourceQueue: 'codeReview',
  },
];
