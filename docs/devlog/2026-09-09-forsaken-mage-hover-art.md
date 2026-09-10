# 2026-09-09 — Forsaken Mage counts every spell; hand-hover popup re-clamp; Clue + Undead art

Three owner asks from the Set 3 Neutrals follow-up.

## Forsaken Mage: "a spell", not "a Shop spell"

Rubies, Tower Shields and Clues now grow the Undead Aura (+4 Attack per cast) like a Shop spell. Gifts already
reached every `spellCast` watcher through `noteSpellCast`; a **Ruby** did not — Rune of the Spellstone's
`countRubyAsShopSpell` is a run-wide "a Ruby IS a Shop spell" rule and fires everything, which is too broad
for one card. So: a `spellCast` effect may OPT IN with `params.includeRubies: true`, and the reducer's Ruby
path calls `fireSpellCastWatchersForRuby` (watchers only — no counters, thresholds or copy memory; Rubies keep
their own meter) unless Spellstone already fired them all. Forsaken Mage is the only opt-in today; a test pins
that list so a second one is a deliberate addition. Combat-played Rubies (Kobold effects mid-fight) do not
reach it — the combat `spellCast` bus event carries side + count only; noted as a follow-up if it ever matters.

## The hand-hover popup floated over the board

`showRefTip` clamps the popup's `top` against an ESTIMATED height (plate aspect × card width × zoom × plate
scale). The estimate overshoots the rendered cluster, and a HAND card sits near the bottom of the screen — so
the bottom clamp shoved the popup ~200px above the card, over the shop row (owner screenshot: Defender →
Tower Shield). Card.tsx now measures the mounted `.cardref` in a layout effect and re-settles `top` once
against the real height (`cardTop` rides on `refPos`). Verified in the dev server: popup top = card top.

## Art

Clue's master landed (`art/spells/clue.webp`; `ART_PENDING` for the Neutrals is empty; ratchet 1115 → 1120).
The whole `Set 3 Minions/Undead` folder was re-run through `optimize-art` by name → id; only the Hierophant
and Warden Rodrick masters had actually changed (the rest re-encoded byte-identical). Four unattributed
UUID-named files in that folder were left alone (no card to wire them to). The eager art glob means a NEW
file (Clue) needs a dev-server restart to show; replaced files show on reload.
