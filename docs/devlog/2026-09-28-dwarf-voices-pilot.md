# Dwarf voices pilot, bound through the By-card view

**2026-09-28.** The first generated unit sounds ship: 11 Dwarves, 22 clips (7 spoken On Play lines in the five Dwarf
cast voices, 4 On Play grunts, 11 On Death sounds). The owner picked take 1 of each. The Review tab's Keep / Reject
clicks did not reach the tracker, which is still open.

**Owner ask:** every generated clip must show under its card in the FX workbench's "By card" view. The old plan
(`audio/cards/<id>.mp3`, played by `sfx.cardVoice`) would have played in game but never appeared there. So card clips
now go through the same path as the workbench's own import:

- `vo-lines.json`: a card clip has `"dest": "card"`, and its id names the slot (`dw_orin` = On Play,
  `dw_orin.death` = On Death). The five Dwarf cast voices default to it.
- `vo:approve` writes `audio/fx/vo-<card>[-death].mp3`, a one-layer Sound def `fx/defs/sfx-vo-<card>[-death].json`,
  and the binding in `choreo/bindings.json` (`minionPlayed` / `spellCast` / `death`). It refuses when the slot is
  already bound to another sound, so a hand-picked sound is never replaced.
- In game, On Play rides the `minionPlayed` recruit cue and On Death rides the combat score's `bindingFor(cardId,
  'death')`. A sound layer's lifetime ceiling is the def's duration + 3.5 s, so a 1.9 s line is never cut.

Next: the owner listens in game and sets the mix, then the other 19 Dwarves.
