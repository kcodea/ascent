# Card Mechanic Medallions — SVG → authored PNG art

**Date:** 2026-09-21
**Owner ask (Mike):** The card mechanic medallion is currently a monochrome CSS/SVG glyph; replace it with
authored full-colour PNG art. Apply it everywhere the *mechanic* icon shows. Provide a dev tuner for the
medallion's size and placement.

## 1. Summary

Each minion card shows a **mechanic medallion** (`.cgem`) — the card's primary mechanic as a gold-tinted inline
SVG glyph chosen by `resolveMechIcon`. This replaces that glyph with authored **PNG art** (downscaled to webp),
keyed **by mechanic** so the same swap also drives the compendium/glossary. Mechanics without art keep their SVG
(a hybrid that upgrades per-mechanic as art arrives). A dev **tuner** controls medallion size/placement.

The swap is **presentation + a small content addition**: it also adds one new mechanic (`spend`) and gives
`rebirth` its own glyph (it currently borrows Rise's), because the art distinguishes them.

## 2. Why key by MECHANIC, not glyph

`Icon` is called with a **glyph name** (`<Icon name="sword">`), and many glyph names are **generic and reused
outside mechanics** — `sword` (attack), `skull` (death), `shield` (defense), `star` (ratings), `eye` (scout),
`sc`, `target`, etc. appear in Career, LobbyPanel, OpponentFrame, QuestCard, Recruit, and more. Swapping the
PNG globally in `Icon` by glyph name would clobber all those non-mechanic uses.

The mechanic icon renders in exactly **two** mechanic-keyed places:
- the card medallion — `Card.tsx` `.cgem`, via `resolveMechIcon(view)`;
- the compendium/glossary — `MinionBook.tsx:172`, via `m.glyph` while iterating `MECHANICS`.

Both already have the **mechanic**, so we key the PNG by mechanic id at those two sites only. Generic `Icon`
uses are untouched.

## 3. Decisions (locked with owner)

| Question | Decision |
|---|---|
| Scope | Medallion + compendium (the two mechanic-keyed sites). Generic `Icon` glyphs unchanged. |
| Keying | By **mechanic id**, not glyph (so `rise`≠`rebirth`, and generic glyphs are safe). |
| Uncovered mechanics | **Hybrid** — keep the current SVG glyph; each upgrades to PNG when its art exists. |
| `rebirth` | Gets its own glyph `rebirth` (today it borrows `rise`); wire `rebirth.png`. |
| `spend` | **New mechanic** — "when you spend X gold, do Y" (e.g. Tapkeeper), detected via the `goldSpent` trigger; glyph `spend`; wire `spend.png`. |
| `pummel`, `equip` | Set 3 mechanics not yet in code — **stage nothing this PR**; wire when those mechanics land. |
| Tuner | A dev tuner for medallion size + placement (+ the art's own scale/offset), same pattern as `milestoneFrameConfig`. |

## 4. Asset mapping (mechanic id → source PNG → shipped webp)

Source: `C:\Users\micha\Desktop\Reference Art\Medallions\*.png` (gold faceted art, transparent, ~1240²).
Downscaled to webp under `apps/web/public/medallions/<mechanicId>.webp` (BASE_URL-safe, like `public/frames/`).

| mechanic id | source png | webp |
|---|---|---|
| shout | shout.png | medallions/shout.webp |
| echo | echo.png | echo.webp |
| startCombat | startturn.png | startCombat.webp |
| endTurn | endturn.png | endTurn.webp |
| avenge | avenge.png | avenge.webp |
| rally | rally.png | rally.webp |
| chooseOne | chooseone.png | chooseOne.webp |
| cleave | cleave.png | cleave.webp |
| crit | crit.png | crit.webp |
| flurry | flurry.png | flurry.webp |
| rise | rise.png | rise.webp |
| rebirth | rebirth.png | rebirth.webp |
| attachment | attachment.png | attachment.webp |
| watcher | watcher.png | watcher.webp |
| spend | spend.png | spend.webp |

Held for Set 3 (no mechanic yet): `pummel.png`, `equip.png`.
No PNG (keep SVG): slaughter, bleed, overflow, taunt, ward, execute, immune, stealth, consume, fodder, engraved,
discover.

## 5. Architecture

Presentation + one small content addition. Files:

### 5.1 `packages/ui/src/mechMedallion.ts` (new)
The single source of truth for "which mechanics have PNG art".
- `MECH_MEDALLION_PNGS: ReadonlySet<string>` — the 15 mechanic ids above.
- `mechMedallionSrc(mechanicId: string): string | null` — `${BASE_URL}medallions/<id>.webp` if in the set, else
  null. Pure/isomorphic (guarded for no-`document` like other config modules).

### 5.2 `resolveMechIcon` → return the mechanic, not just its glyph (`mechIcon.ts`)
Change `resolveMechIcon` to `resolveMech(view): Mechanic | null` (or return `{ id, glyph }`). The medallion needs
the id (for the PNG) and the glyph (for the SVG fallback). Update the one caller (`Card.tsx`). Keep a thin
`resolveMechIcon` returning `.glyph` if any other caller needs the glyph string (grep first).

### 5.3 `MechMedallion` render — a shared helper used at both sites
Given a mechanic id + glyph: render `<img decoding="sync" class="cgem-img" src={mechMedallionSrc(id)}>` when a PNG
exists, else `<Icon name={glyph} />`. Used by:
- `Card.tsx` inside `.cgem` (replacing the current `<Icon>`), preserving the pulse/glow `::before`/`::after`
  classes on the `.cgem` wrapper.
- `MinionBook.tsx` glossary rows (currently `{ icon: m.glyph }`) → render the PNG when present.

### 5.4 `mechanics.ts` + glossary (content addition)
- Add `{ id: 'spend', term: 'Spend', glyph: 'spend', detect: hasOn('goldSpent'), termRe: /spend .*gold|gold spent/i, order: ~20 }`
  and a `keywordGlossary` entry (required — `glossaryDefOf` throws otherwise). Confirm the exact trigger id
  against Tapkeeper (`set2/dwarves.ts`); `cardsBought` is a sibling — include if the mechanic means both (owner
  to confirm during impl).
- Change `rebirth` glyph from `'rise'` to `'rebirth'`.
- `Icon.tsx`: add SVG entries for `rebirth` and `spend` (defensive fallbacks; PNGs normally cover them). `rebirth`
  can reuse the `rise` SVG; `spend` a simple coin/gold glyph.

### 5.5 CSS (`styles.css`)
- `.cgem > .cgem-img { width/height: <medallion size vars>; object-fit: contain; }` — sized by the tuner vars,
  centred like the SVG. The `.cgem` pulse/glow layers are unchanged (they wrap the art). Static paint only.
- Full-colour PNG replaces the gold `currentColor` SVG; the gold tint styling no longer applies to framed art.

### 5.6 Tuner — `medallionConfig.ts` + `MedallionTuner.tsx` (new), registered
Schema-driven tuner (mirror `milestoneFrameConfig.ts` / `equipSlotConfig.ts`):
- **Size** (medallion diameter/scale), **X/Y placement** (offset of `.cgem` in the frame), and the **art inset**
  (the PNG's scale within the medallion box). Global (one medallion per card); a compact-card variant only if the
  owner asks.
- CSS custom properties (`--cgem-size`, `--cgem-dx`, `--cgem-dy`, `--cgem-art-scale`) read by `styles.css`;
  values ship via DEFAULTS. Registered in `tunerAll.ts`, `PANEL_EMBLEMS`, and `DevMenu.tsx` (🎖️).
- Live preview: a small grid of the wired mechanic medallions (like the milestone tuner's preview) so size/
  placement are visible while dragging.

## 6. Testing & verification
- Headless unit test for `mechMedallion.ts` (`mechMedallionSrc` returns a URL for wired ids, null otherwise).
- `mechIcon.test.ts` / `mechanics.test.ts` update for the `resolveMech` signature change, the new `spend`
  mechanic, and `rebirth`'s glyph. `mechIcon.test.ts:56` builds a `registryGlyphs` set — update expectations.
- Confirm `spend` detection on a real card (Tapkeeper) via the existing mech-detection tests.
- Commit each webp with its wiring (memory: art-without-commit ships blank).
- Visual: owner eyeballs medallions on real cards + tunes size/placement (dev tuner); generic icons unaffected.
- Gates: `npm run typecheck && npm run lint && npm test && npm run build:web`.
- Patch notes: player-facing entry (medallions are a visible UI change).

## 7. Scope / non-goals
- Generic (non-mechanic) `Icon` glyphs are NOT touched.
- `pummel`/`equip` art is NOT wired this PR (their mechanics don't exist yet).
- The 12 uncovered mechanics keep their SVG (no new art authored here).
- No change to mechanic *detection/ordering* beyond adding `spend` and `rebirth`'s glyph.

## 8. Files
- Create: `packages/ui/src/mechMedallion.ts` (+ test), `packages/ui/src/medallionConfig.ts`,
  `packages/ui/src/MedallionTuner.tsx`, `apps/web/public/medallions/*.webp` (15).
- Modify: `packages/ui/src/mechIcon.ts`, `packages/ui/src/Card.tsx`, `packages/ui/src/MinionBook.tsx`,
  `packages/ui/src/mechanics.ts`, `packages/ui/src/keywordGlossary.ts`, `packages/ui/src/Icon.tsx`,
  `packages/ui/src/styles.css`, `packages/ui/src/tunerAll.ts`, `packages/ui/src/tunerSchema.ts`,
  `packages/ui/src/DevMenu.tsx`, `packages/ui/src/patchNotes.ts`, tests.
