# 2026-09-09 — Prismatic Pick: branch 1 Discovers a Choose One card

**Owner ask (2026-09-09):** "change Prismatic Pick's first option to *Discover a Choose One card* instead of get
a random one."

- `content/equipment.ts` — `PRISMATIC_PICK` option 0 now fires a new recruit factory, **`discoverChooseOne`**
  (`params: { count: 1 }`, `gildedParams: { count: 2 }`), with the option and headline texts updated. Branch 2
  (the both-halves charges) is untouched.
- `discoverChooseOne` (recruit.ts) queues a **pool Discover** over every Choose One card the run's set can draw,
  minions AND spells — the same candidate rule `grantRandomChooseOne` (Flagrunner, still in use) applies. A
  gilded Pick queues the Discover twice, the second behind the first. Gilding rides `gildedParams` (an
  Equipment Choose One branch is handed a non-gilded self), so there is one gilding channel, as before.
- The pool Discover's spell filter now admits **Choose One spells** alongside Gifts: an explicit id pool that
  names Crest of the Climb / Facetwright's Choice / Field Maneuvers means them; the minion-only default still
  protects every caller that never meant to offer a spell.
- Registered in the factory union and schema whitelist; contracts registry + docbot report regenerated.
- Tests: `prismaticPick.test.ts` branch 1 now asserts three Choose One picks and no hand grant; a new gilded
  case pins the queued second Discover.
