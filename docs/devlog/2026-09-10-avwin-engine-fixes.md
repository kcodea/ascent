# 2026-09-10 — Doc Bot findings fixed: R-AVWIN-02 / R-AVWIN-10 in the engine, Xerox + Selfless text, kennel contract

After the 2026-09-10 merge stack the owner ran Doc Bot and asked for every finding fixed. The two release
blockers were the approved-but-violated Avenge window rules, pinned since 2026-08-27.

## R-AVWIN-02 — the summoning death does not count

Both combat death paths (`killOrReborn`'s Rise branch and the regular death path in `simulate.ts`) fired the
Echo BEFORE incrementing `deaths[side]`. A source the Echo summoned stamped `avengeBaseline = deaths[side]` on
arrival, so the death that created it sat INSIDE its window — an Echo-summoned Avenge (4) paid after three
further deaths. The increment now happens before the Echo; the avenge broadcast still fires after it, so
resolution order is unchanged.

## R-AVWIN-10 — a source dying in a batch observes none of it

Clash deaths resolve sequentially (cleave victims → target → attacker) and the avenge dispatch guard checked
only `minion.dead`. A mortally wounded source whose own death was still queued observed the batch-mates
resolved before it and could fire while dying. The bus handler now skips an `avenge` effect on a source at
≤0 Health.

## What moved with them

- `temporalWindow.test.ts`: `KNOWN_VIOLATIONS` is empty; both pins flipped to the ruled expectations, and the
  two R-AVWIN-01 fixtures updated (a source summoned by the third death now opens its window at 3, the
  summoning death included). The AVWIN-02 fixture's friendly sandbag shrank to 8 Health so death 7 — the
  promised first Ward — is reachable.
- The graduated fixture `avenge-dying-source-batch-pin.json` asserts ZERO avenge fires (the ruling).
- The vertical slice: its two defect classes no longer fire live; `verticalSlice.test.ts` proves both
  detectors on a DOCTORED report (§4.5), and the live run emits the two advisory classes only. The text-defect
  detector now reads the LIVE Xerox text.
- `approved.ts`: R-AVWIN-02/10 `currentBehaviour` → conforms; `contractOracle.test.ts` expects no release
  blockers; `final-report.md` headline rows updated.

## Text and contracts

- Xerox: "Summon an exact copy of a friendly minion." (LG-COPY-01; the slice's original text-defect exemplar).
- Selfless Sentinel: "Ward" (LG-KEYWORD-01; the last "Divine Shield" texts).
- Kennelmaster's curated contract gained the Start of Combat leg the text always printed; its
  `KNOWN_TEXT_MISMATCH` pin (wrong-trigger) and Xerox's (confirmed-defect-pending-fix) are deleted.
- `UNRESOLVED_CAP` 563 → 565: both objects left verified-mismatch for the unresolved queue (the parser cannot
  fully resolve either text yet) — a conscious move, named in the test.
