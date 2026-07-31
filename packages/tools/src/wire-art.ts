/**
 * `npm run art:wire` — copy Set 2 minion art into `packages/ui/src/art/minions/<cardId>.png`.
 *
 * STRICT NAME MATCH ONLY. A source file is wired only when its PascalCase filename matches a card's NAME
 * exactly (after stripping punctuation/spaces). Anything unmatched is REPORTED, never guessed — guessing from an
 * un-attributed file is how art ends up on the wrong card and nobody notices.
 *
 * `<Name>2.png` is wired as the `<cardId>2` variant, matching the existing pup/shaper convention.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { CARD_INDEX, poolFor } from '@game/content';

const SRC = 'C:/Game Assets/Ascent Art/Set 2 Minions';
const DEST = 'packages/ui/src/art/minions';
const DIRS = ['Beasts', 'Demons', 'Dragons', 'Dwarves', 'Kobolds', 'Neutral'];
const APPLY = process.argv.includes('--apply');
/** Every art file already in the repo is 512x512 — the card frame never shows more. */
const ART_PX = 512;

/**
 * EXPLICIT ALIASES — source filename (normalized) → card id.
 *
 * Only for files that ARE attributed but whose name doesn't match: a misspelling, or art still carrying a card's
 * OLD name after a rename. That is not the same as guessing from an un-attributed file (a UUID, `content3.png`),
 * which stays unwired on purpose. Every entry here is a case with exactly one plausible card, listed so it can
 * be reviewed rather than buried in matching logic.
 */
const ALIASES: Record<string, string> = {
  // misspelled in the source
  chiurgeon: 'dw_chirurgeon',            // missing the second 'r'
  oatshieldorin: 'dw_orin',              // missing the 'h'
  salvatoremckluskey: 'salvatore',        // extra 'e'
  candlelightbulwark: 'k_candleback',     // card is Candleback Bulwark
  copperspellsword: 'n2_coppercoat',      // card is Coppercoat Spellsword
  gemforgefiend: 'k_gemgorge',            // card is Gemgorge Fiend
  babyrex: 'trexbaby',                    // token is T-Rex Baby
  zyffbetrayer: 'zyff',
  jenkinsandfi: 'jensenfi',               // renamed Jenkins -> Jensen
  malphas: 'dm_malphas',
  orivax: 'd2_orivax',
  // art still under a card's PRE-RENAME name (all renamed 2026-07-29)
  grandgourmand: 'dm_gourmand',           // -> Bob Blart
  hungerling: 'dm_hungerling',            // -> Demon Horse
  selectiveglutton: 'dm_glutton',          // -> Chipper
  roaringmatriarch: 'd2_matriarch',        // -> Bathing Matriarch
  scalefeatherdrake: 'd2_scalefeather',    // -> Mushy
  drachronicler: 'd2_chronicler',          // -> Scalefeather
  // 2026-07-30 art redo — attributed files whose filename does not match the current card name:
  bighuggies: 'dm_velvet',           // file reads "BigHuggies"; the card is Bug Huggies — flagged to the owner
  gemshard: 'gemheart-shard',        // the Gemheart Golem token, named in the source after its id
  groveweaveralt: 'b2_groveweaver',  // "GroveweaverAlt2" -> the b2_groveweaver2 variant slot
  cinderchancellor: 'dm_chancellor', // pre-rename name; RougeRogue.png wins the base slot, this fills `2`
  // (no alias for DenkeeperOona: a KingOona.png under the CURRENT name also exists, and an alias would race it —
  //  whichever copied last would win. The current-name file is authoritative.)
};

/** Normalize for comparison: letters+digits only, lowercased. "Broad-Axe Brakka" -> "broadaxebrakka" */
const norm = (s: string): string => s.replace(/[^a-z0-9]/gi, '').toLowerCase();

// Every set-2 card (minions AND tokens — tokens have art too), keyed by normalized name.
const byName = new Map<string, string>();
for (const c of poolFor('set2').all) byName.set(norm(c.name), c.id);
for (const c of Object.values(CARD_INDEX)) if (c) byName.set(norm(c.name), c.id); // tokens live outside the pool

const wired: string[] = [];
const unmatched: string[] = [];
const matches: { src: string; label: string; id: string; exact: boolean }[] = [];
const webpJobs: Promise<unknown>[] = [];
for (const dir of DIRS) {
  const full = join(SRC, dir);
  if (!existsSync(full)) { console.log(`missing source dir: ${dir}`); continue; }
  for (const file of readdirSync(full).filter((f) => /\.(png|webp)$/i.test(f))) {
    const stem = file.replace(/\.(png|webp)$/i, '');
    // `Alt` and a trailing `2` both mean "the second art for this card" — the loader keys variants as `<id>2`.
    const isVariant = /(2|Alt)$/i.test(stem);
    const base = stem.replace(/(2|Alt)$/i, '');
    const key = norm(base);
    const exact = byName.get(key);
    const id = exact ?? ALIASES[key];
    if (!id) { unmatched.push(`${dir}/${file}`); continue; }
    matches.push({ src: join(full, file), label: `${dir}/${file}`, id: `${id}${isVariant ? '2' : ''}`, exact: !!exact });
  }
}
// PRECEDENCE, not readdir order. Two files can target one card — its CURRENT name and its pre-rename name both
// sitting in the folder — and whichever copied last used to win by directory-listing luck. Alias (stale-name)
// matches copy FIRST so an exact current-name match always lands on top of them.
matches.sort((a, b) => Number(a.exact) - Number(b.exact));
for (const m of matches) {
  wired.push(`${m.label}  ->  ${m.id}.png`);
  if (!APPLY) continue;
  // The PNG is written RESIZED, not copied. Vite's glob emits every matched file, so the masters ship in the
  // bundle even though `indexArt` never selects a .png when a .webp exists — 145 raw masters were 322MB against
  // 20MB of webp. Downscaling costs nothing visible (the frame renders at 512) and takes the dead weight with it.
  webpJobs.push(sharp(m.src).resize(ART_PX, ART_PX, { fit: 'cover' }).png().toFile(join(DEST, `${m.id}.png`)));
  // REGENERATE THE WEBP. `indexArt` in @game/ui resolves `.webp` over `.png` for the same id, so dropping in a
  // fresh PNG beside a stale WEBP changes nothing on screen — the old art keeps winning and the wiring looks
  // like it worked. Every copy therefore rewrites its sibling webp from the new source.
  //
  // Resized to ART_PX, which is what every pre-existing art file in the repo already is. The masters are
  // ~1254px; shipping them raw quadrupled each file (78KB -> 350KB across ~150 assets) for pixels the card
  // frame never shows. Performance is the north star — this is a load-time regression, not a polish detail.
  webpJobs.push(sharp(m.src).resize(ART_PX, ART_PX, { fit: 'cover' }).webp({ quality: 90 }).toFile(join(DEST, `${m.id}.webp`)));
}
if (APPLY) {
  await Promise.all(webpJobs);
  console.log(`\nregenerated ${webpJobs.length} .webp siblings (the loader prefers webp over png)`);
}
// Surface every card that two or more sources targeted, so an overwrite is visible rather than inferred.
const byTarget = new Map<string, string[]>();
for (const m of matches) byTarget.set(m.id, [...(byTarget.get(m.id) ?? []), m.label]);
const contested = [...byTarget].filter(([, v]) => v.length > 1);

console.log(`\nMATCHED ${wired.length}:`);
for (const w of wired) console.log(`  ${w}`);
if (contested.length > 0) {
  console.log(`\nCONTESTED ${contested.length} (several sources target one card; the LAST listed wins):`);
  for (const [id, srcs] of contested) console.log(`  ${id}.png  <-  ${srcs.join('  ,  ')}`);
}
console.log(`\nUNMATCHED ${unmatched.length} (reported, never guessed):`);
for (const u of unmatched) console.log(`  ${u}`);
// Which set-2 minions still have NO art at all?
const haveArt = new Set(readdirSync(DEST).map((f) => f.replace(/\.(png|webp)$/, '').replace(/2$/, '')));
const missing = poolFor('set2').all.filter((c) => !c.spell && !c.ruby && !haveArt.has(c.id)).map((c) => `${c.name} (${c.id})`);
console.log(`\nSET-2 MINIONS WITH NO ART ${missing.length}:`);
for (const m of missing) console.log(`  ${m}`);
console.log(APPLY ? '\n(applied)' : '\n(dry run — pass --apply to copy)');
