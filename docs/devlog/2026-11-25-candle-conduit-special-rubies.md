# 2026-11-25: Candle Conduit, and Special Rubies

Owner: "add candle conduit to set 2 and wire its new art", and "\"random ruby\" becomes \"Special Ruby\" and is ALWAYS a non-standard Ruby".

- **Special Ruby** (R-RUBY-SPECIAL-01): one draw list for both phases (`SPECIAL_RUBY_IDS`), every text, the glossary, the rules wiki and the hover preview
  (one of the five, like the Ales). Factory ids keep the old word.
- **Candle Conduit** (R-CONDUIT-01): the archived card, unchanged, appended to `SET2_KOBOLDS_LATE`. It had no combat half; it now casts live, and the settle
  mints hold it (`withGemSagesHeld`), like Gem Sage. A latch stops a Ruby gotten from its own cast from casting again.
- Behaviour to know: a Ruby won in a fight now pays its cast in that fight (combat only), not permanently at settle as the archived card did.
