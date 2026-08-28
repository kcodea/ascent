# 2026-08-28 — the Aura vocabulary: run-wide buffs read as Auras

**Owner ruling** (decision `q-word-lg-scope-01`, REVISE), verbatim:

> this is correct, however we want to re-brand the "wherever they are" vocabulary to Aura's instead. i.e. Buff
> your Undead Army Aura +4/+1, or Buff your Imp Aura +4/+4 etc.

The Sitting-3 wording deck had asked which of the two live scope tails should win — "wherever they are" (15
texts) or "everywhere" (3). The owner picked neither: the run-wide reach becomes a **noun**.

## The rule

A grant that reaches a tribe/class beyond the board — board, hand, Shop, and copies acquired later — names an
**Aura**, in the shape `your <Tribe-singular> Aura`:

- `**Echo:** give your **Beast Aura** **+8/+8**.`
- `**Avenge (3):** improve your **Imp Aura** by **+6/+6**.`

The retired tails ("wherever they are", "wherever it is", "everywhere") no longer appear in any printed text.
This is **wording only** — every number, target and timing is byte-identical to what shipped before, and no
engine identifier, effect id or `auraFx` path moved. The Aura noun is a text term; the engine's aura code is
older than the word and was deliberately left alone.

## Carriers rewritten (11 objects, 18 text legs)

Minions: Kennelmaster (`kennel`), Trophy Stalker, Grim, Armadiyo (`b2_armadiyo`), Deathswarmer, Forsaken Mage
(`forsakenweaver`), Attachment Mechanic (`scrapherald`), Chorus Engine. Spell: Lantern of Souls. Runes: Rune of
Summoning, Rune of the Cinder Ledger. Plus the DERIVED text: `questText.ts`'s `tribeAura` / `scalingTribeAura`
reward lines and the `runeCinderLedger` flag line, and the docbot slice's pinned `kennel` text contract.

Two carriers used the minority "everywhere" spelling (Attachment Mechanic, Lantern of Souls) and were folded
into the same shape. Nothing resisted the pattern — a happy accident of the ruling's shape, since every carrier
was already `<verb> your <tribe> <stats> <tail>`.

## What kept the live-text rule honest

The scaling carriers (Kennelmaster's Start-of-Combat Attack aura, Trophy Stalker's growing Rally) print their
CURRENT magnitude through `cardText.ts`'s `summonBuffText`, which injects into the bold `**+N Attack**` /
`**+N/+N**` token by regex. The rewrite deliberately KEPT those tokens in place and only replaced the target
noun + tail, so both chains (`liveCardText` and `Unit.tsx`) still land. A new assertion in `cardText.test.ts`
pins both halves — the injected live number AND the Aura noun — so a future re-word that drops the token can't
silently strand the printed value.

## Parser + guide

- `LG-SCOPE-01` moved from `contested`/`seeded` to **`approved`**, quoting the owner ruling, with a predicate
  that flags any text reintroducing a retired tail. It is the first owner-approved guide entry, so
  `rules.test.ts`'s "no entry may be approved" assertion became "approved requires an owner decision in
  evidence".
- The `TERM_VARIANTS` pair became `Aura` vs the retired tails. Candidate B now has zero corpus hits, so the
  Sitting-3 deck **self-retired** the question (11 → 10 cards) exactly as designed.
- `textParse`'s `targetPhrase` learned the Aura target (`your <Tribe> Aura` → scope `your-<tribe>-aura`),
  placed ahead of the generic `your …` shape which would otherwise eat "your Beast" and strand "Aura".
  `recStatBuff` also learned the optional `by` between target and amount ("improve your Imp Aura **by** +6/+6").

**Sweep before → after:** parsed-equivalent **358 → 364**, unresolved-parse **534 → 528**, verified-mismatch
**9 → 9** (the same pinned nine). The rebrand made the corpus *more* machine-readable, not less.

## Grow-loudly guard

`textParse.test.ts` gained an "Aura vocabulary" lane: no live printed text may contain a retired scope tail;
every printed "Aura" must ride the canonical shape; the guide entry must stay approved-with-predicate; the
wording question must stay retired; and the rewritten carriers' printed NUMBERS are pinned to what they were
before the rebrand — the mechanical-neutrality proof.

## Not touched

The owner's own **Rise / Reborn → Rebirth** rename (LG-KEYWORD-02) is reserved and in flight; nothing here went
near it. `decisions.json` was not edited from this branch — the owner's ruling is being recorded in their own
working copy.
