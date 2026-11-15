# 2026-11-15: announcer variety, wave 2 (50 new takes on 41 moments)

Owner: "lets add more lines", then, shown the drafts in the tracker, "generate all of the voice lines".

- **What shipped:** 50 new takes on the 41 moments that had exactly one line (the deck from the same day does nothing
  for a one-line moment). Listed in the tracker (Announcer Script Desk, `lines`, noted "Variety wave 2").
- **Four voices:** every take exists in the default voice and in `lemon`, `underdweller` and `little-inu` (200
  clips, 4,396 characters), one take each, levelled to -20 LUFS with `normalizeFile`. The default-voice lines are
  recorded in `packages/tools/vo-lines.json`; pack lines are not (their ids would collide), as in the Lemon recipe.
- **No game logic changed.** A once-per-game moment still speaks once per game: the new takes change WHICH line you
  hear, and with the deck you now hear each of a moment's lines before one repeats.
- **Every line is true wherever its moment fires** (R-TEXT-ANNOUNCER-01) and none speaks to a fight's odds or result
  before the verdict (R-TEXT-ANNOUNCER-02). `five-win-streak-2` and `minion-hits-100-stats-2` name a value their
  moment guarantees (the fifth win; a stat reaching 100).
- **Not listened to:** the owner approved the wording, not the audio. A take that reads badly aloud is replaced by
  deleting its clip in all four folders and re-running the generator for that id.
- **Still one line:** the moments not in this wave (the card specials, Lobby standings pairs already covered, Round 7,
  Big Spender and the keyed hero / tribe lines).
