# 2026-11-17 One wording for repeating Gold-spend triggers

**Owner ruling:** "yes unify the text as every N gold spent." Every repeating spend trigger now reads
"Every **N Gold** spent, <effect>." instead of "When you spend **N Gold**, <effect>." Text only, no behaviour change.

Changed: Coinfire, Tapkeeper, Mountainbond, Billings, Dwarf King Brill, Stardust Peddler, Feastmaster Vhal (archived);
runes Overtime, Showcase, Minted Gems, Dragon Hoard, Gold for Grub, Gemspam; Ancient of Fortune pairings for Brackus
("Every time you spend 50 Gold") and Cindy ("Spending 40 Gold refreshes"). Bulk Order, Rune of Spellslinging and the
other "Every N Gold spent" runes already matched.

Kept on purpose (different meaning): "for every N Gold spent this turn" scalers (Rope Wrangler, Patch Job), Ancient
Wanderer's run-total scaler, one-time goals and locks ("Spend 40 Gold to improve this", Summit's "locked until you
spend 70 Gold", Indy's "Recharges after you spend 75 Gold"), the once-per-turn rune "The first time you spend 8 Gold
each turn", and the per-spend "Whenever you spend Gold" triggers (no N).

The Spend glossary pill keyed on the bare word "spend"; its `detectRe` now also matches "Gold spent," (the comma keeps
"spent this turn" scalers out, as before). Pinned by `packages/ui/src/everyNGoldSpentWording.test.ts`.
