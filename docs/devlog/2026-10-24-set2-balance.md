# 2026-10-24: Set 2 balance adjustment (7 cards) + Engraved wording

**Owner request (verbatim):** "set 2 balance adjustment: tunneller rik -> rally: get a random ruby; cave cutter ->
choose one: give your rubies +1/+1 or get 4 rubies; Scrapper -> T2, stats to 3/1 echo: your rubies gain +1 attack;
gem carver -> T4; beev -> when a beast attacks give it and this +2/+1; big huggies -> taunt. echo: get 2 staff of
guels; big brain billy -> buff to +2/+2; change engraved keyword to say Keeps all stats and effects gained during
combat."

**What shipped (data only, ids unchanged, existing primitives).**

| Card | id | Change |
|---|---|---|
| Tunneller Rik | `k_tunnelcharger` | `rallyGetRubies` count 2 -> 1 (random, Gilded 2) |
| Cave Cutter | `k_veinbreaker` | strength branch `rubyStatGain` +2/+1 -> +1/+1 (Gilded +2/+2); 4 plain Rubies unchanged |
| Scrapper | `k_faultline` | T3 5/1 -> T2 3/1; `deathrattleRubyStatGain` +1/+1 -> +1/+0 (Gilded +2 Attack) |
| Gem Carver | `k_gemheart` | T3 -> T4, nothing else |
| Beev | `b2_beev` | `onTribeAttackBuffAttackerAndSelf` +2/+2 -> +2/+1 (Gilded +4/+2) |
| Big Huggies | `dm_velvet` | Echo grant `sp_picnic` -> `staffofguel`, count 2 (Gilded 4); keeps Taunt |
| Big Brain Billy | `dw_bigbrainbilly` | `spellCastBuffSelf` +1/+1 -> +2/+2 (Gilded +4/+4) |

None of these print a live-scaling value, so no `cardText.ts` helper is involved; the printed numbers are the params.
"Staff of Guels" is written "Staves of Guel" (the plural an archived card already used).

**Engraved.** Glossary def is now "Keeps all stats and effects gained during combat." The engine keeps combat STATS
(R-ENGRAVE-02) and the combat KEYWORDS in `ENGRAVE_KEEPS_KEYWORDS` (R-ENGRAVE-03). It does NOT carry back a triggered
ability grafted mid-fight, nor Engraved itself or trigger labels. Engine unchanged; the gap is flagged to the owner in
R-ENGRAVE-04. The rules-wiki "What does Engraved do?" answer now mentions kept keywords; the four wiki entries'
fingerprints were re-pinned.

**Tests.** `packages/sim/src/set2Balance1024.test.ts` (shop + combat, plain + Gilded, per card);
`packages/ui/src/engravedWording1024.test.ts`. Older batch suites re-pinned to the new numbers.

**Oracle.** R-SET2-BAL-1024-01 (triggers.ts), R-ENGRAVE-04 (persistence.ts).

**Ops.** Content change: redeploy versus-resolve after merge.
