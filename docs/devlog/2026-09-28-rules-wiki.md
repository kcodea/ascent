# 2026-09-28: Rules wiki (Compendium → Rules)

Owner ask: a thorough, searchable, casual FAQ so friends trying the game can look up how things work. Decisions:
in-game, inside the Compendium; mechanics only (no per-card pages); code-verified, with a tripwire; player-level
voice (no implementation talk). Spec: `docs/superpowers/specs/2026-09-28-rules-wiki-design.md`.

- **Where:** a **Rules** header button in the Compendium (sibling of Glossary, exclusive with it) swaps the body for
  `CompendiumRules.tsx`: a search box, topic chips (only for topics with entries), and accordion Q&As with See-also links.
- **Data:** `packages/ui/src/rulesWiki/<topic>.ts`, one file per topic so parallel authoring never conflicts.
  `searchWiki` ranks question > alias > answer hits, and every word must match.
- **Tripwire:** `rulesWiki.test.ts`. Each `covers` entry fingerprints an approved rule's statement or a glossary
  definition; a change reddens and names the answer to re-read plus the new fp. A keyword ratchet
  (`UNCOVERED_KEYWORDS`, which may only shrink) makes sure every glossary keyword eventually gets an answer.
- **Gotcha:** the component was first named `RulesWiki.tsx`, and on Windows `import './rulesWiki'` resolved to
  it instead of the `rulesWiki/` folder (case-insensitive FS). Hence `CompendiumRules.tsx`.
- **Found while verifying:** approved rule **R-TARGET-01** ("a random friendly X includes the source") is
  contradicted by **R-TARGET-03** and by the code (`arena.ts` `others()`, even for its own Gangplank example). The
  wiki follows R-TARGET-03. R-TARGET-01 should be amended or retired.

PR 1 ships 34 seed entries. Content batches follow.
