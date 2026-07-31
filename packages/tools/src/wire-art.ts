/**
 * `npm run art:wire` — wire authored art into `packages/ui/src/art/<kind>/<id>.png` (+ a `.webp` sibling).
 *
 * STRICT NAME MATCH ONLY. A source file is wired only when its PascalCase filename matches a card's or a rune's
 * NAME exactly (after stripping punctuation/spaces). Anything unmatched is REPORTED, never guessed — guessing
 * from an un-attributed file is how art ends up on the wrong card and nobody notices.
 *
 * `<Name>2.png` / `<Name>Alt.png` wire as the `<id>2` variant, matching the existing pup/shaper convention.
 *
 * THREE JOBS, ONE PIPELINE. Runes and quest-reward minions were added 2026-07-31. They share the resize, the
 * webp regeneration, the alias-loses-to-exact precedence and the reporting rather than getting their own
 * script — those four are exactly the parts that would drift apart if copied, and three of them were bugs
 * found the hard way on the minion pass (devlog 2026-07-30).
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { CARD_INDEX, EPIC_RUNES, RUNES, poolFor } from '@game/content';

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
  // 2026-07-30 art redo — attributed files whose filename does not match the current card name.
  // (`bighuggies` needed an alias while the card was mis-named "Bug Huggies"; the owner corrected the NAME to
  //  Big Huggies on 2026-07-31, so the filename matches exactly now and the alias is gone.)
  gemshard: 'gemheart-shard',        // the Gemheart Golem token, named in the source after its id
  groveweaveralt: 'b2_groveweaver',  // "GroveweaverAlt2" -> the b2_groveweaver2 variant slot
  cinderchancellor: 'dm_chancellor', // pre-rename name; RougeRogue.png wins the base slot, this fills `2`
  // 2026-07-31 renames. Hellrider and Lastlight now match their cards by name exactly, so they need no entry
  // (and RevolvingMaw.png correctly stops matching anything — Hellrider.png is the current art). Only Void
  // Curator's art is still filed under its old name.
  tallymonger: 'dm_tallymonger',     // -> Void Curator
  // (no alias for DenkeeperOona: a KingOona.png under the CURRENT name also exists, and an alias would race it —
  //  whichever copied last would win. The current-name file is authoritative.)
};

/** Rune-art aliases — same doctrine as ALIASES: only for files that ARE attributed but whose name does not
 *  match a rune exactly. */
const RUNE_ALIASES: Record<string, string> = {
  runeothemenagerie: 'rune_menagerie',   // the source abbreviates "of the" to "O"
  runeofscale: 'rune_scale',             // owner ruling: the sheet's "Rune of Scale" IS Rune of Bulk Order
  runeofthemotherload: 'rune_motherlode', // misspelled in the source ("Motherload")
  spellofpillaging: 'rune_pillaging',     // authored as "Spell of..."; there is no such spell, and the rune matches
};

/** Normalize for comparison: letters+digits only, lowercased. "Broad-Axe Brakka" -> "broadaxebrakka" */
const norm = (s: string): string => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
/** As `norm`, minus a standalone "the". The rune art folder disagrees with the rune list about "Rune of X" vs
 *  "Rune of the X" in BOTH directions, so the word is dropped from both sides rather than aliasing seven files
 *  one at a time. Word-bounded — stripping a bare "the" would corrupt any name containing those letters. */
const noThe = (s: string): string => norm(s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\bthe\b/gi, ' '));

// Every set-2 card (minions AND tokens — tokens have art too) plus every set-1 card, since the quest-reward
// folder draws on both. Keyed by normalized name.
const cardsByName = new Map<string, string>();
for (const c of poolFor('set2').all) cardsByName.set(norm(c.name), c.id);
for (const c of Object.values(CARD_INDEX)) if (c) cardsByName.set(norm(c.name), c.id);

const runesByName = new Map<string, string>();
for (const r of [...RUNES, ...EPIC_RUNES]) {
  runesByName.set(norm(r.name), r.id);
  // The art folder is inconsistent about "Rune of X" vs "Rune of the X" — in both directions. That is a
  // systematic authoring variance across ~7 files, not seven separate typos, so it is absorbed here rather than
  // as seven alias entries. Registered only when it does not collide with a real rune name.
  const theless = noThe(r.name);
  if (theless !== norm(r.name) && !runesByName.has(theless)) runesByName.set(theless, r.id);
}

interface Job { label: string; src: string; dirs: string[]; dest: string; index: Map<string, string>; aliases: Record<string, string> }
const JOBS: Job[] = [
  {
    label: 'minions', src: 'C:/Game Assets/Ascent Art/Set 2 Minions',
    dirs: ['Beasts', 'Demons', 'Dragons', 'Dwarves', 'Kobolds', 'Neutral'],
    dest: 'packages/ui/src/art/minions', index: cardsByName, aliases: ALIASES,
  },
  {
    // Quest-reward minions are authored in their own folder but are still MINION art — same destination.
    label: 'quest-reward minions', src: 'C:/Game Assets/Ascent Art/Quests/Quest Reward Related Things',
    dirs: ['.'], dest: 'packages/ui/src/art/minions', index: cardsByName, aliases: ALIASES,
  },
  {
    label: 'runes', src: 'C:/Game Assets/Ascent Art/Runes',
    dirs: ['.'], dest: 'packages/ui/src/art/runes', index: runesByName, aliases: RUNE_ALIASES,
  },
];

const webpJobs: Promise<unknown>[] = [];
for (const job of JOBS) {
  const wired: string[] = [];
  const unmatched: string[] = [];
  const matches: { src: string; label: string; id: string; exact: boolean }[] = [];
  for (const dir of job.dirs) {
    const full = dir === '.' ? job.src : join(job.src, dir);
    if (!existsSync(full)) { console.log(`missing source dir: ${job.label}/${dir}`); continue; }
    for (const file of readdirSync(full).filter((f) => /\.(png|webp|jpe?g)$/i.test(f))) {
      const stem = file.replace(/\.(png|webp|jpe?g)$/i, '');
      // `Alt` and a trailing `2` both mean "the second art for this id" — the loader keys variants as `<id>2`.
      const isVariant = /(2|Alt)$/i.test(stem);
      const base = stem.replace(/(2|Alt)$/i, '');
      const key = norm(base);
      const exact = job.index.get(key) ?? job.index.get(noThe(base));
      const id = exact ?? job.aliases[key];
      const label = dir === '.' ? file : `${dir}/${file}`;
      if (!id) { unmatched.push(label); continue; }
      matches.push({ src: join(full, file), label, id: `${id}${isVariant ? '2' : ''}`, exact: !!exact });
    }
  }
  // PRECEDENCE, not readdir order. Two files can target one id — a CURRENT name and a pre-rename name both in
  // the folder — and whichever copied last used to win by directory-listing luck. Alias matches copy FIRST so
  // an exact current-name match always lands on top of them.
  matches.sort((a, b) => Number(a.exact) - Number(b.exact));
  for (const m of matches) {
    wired.push(`${m.label}  ->  ${m.id}.png`);
    if (!APPLY) continue;
    // Both outputs are written RESIZED, never copied. `indexArt` in @game/ui resolves `.webp` over `.png` for
    // the same id, so a fresh PNG beside a stale WEBP would change nothing on screen; and Vite's glob emits
    // every matched file, so raw masters would ship in the bundle for pixels the frame never shows.
    webpJobs.push(sharp(m.src).resize(ART_PX, ART_PX, { fit: 'cover' }).png().toFile(join(job.dest, `${m.id}.png`)));
    webpJobs.push(sharp(m.src).resize(ART_PX, ART_PX, { fit: 'cover' }).webp({ quality: 90 }).toFile(join(job.dest, `${m.id}.webp`)));
  }
  // Surface every id that two or more sources targeted, so an overwrite is visible rather than inferred.
  const byTarget = new Map<string, string[]>();
  for (const m of matches) byTarget.set(m.id, [...(byTarget.get(m.id) ?? []), m.label]);
  const contested = [...byTarget].filter(([, v]) => v.length > 1);

  console.log(`\n=== ${job.label.toUpperCase()} — matched ${wired.length}, unmatched ${unmatched.length} ===`);
  for (const w of wired) console.log(`  ${w}`);
  if (contested.length > 0) {
    console.log(`  CONTESTED ${contested.length} (several sources target one id; the LAST listed wins):`);
    for (const [id, srcs] of contested) console.log(`    ${id}.png  <-  ${srcs.join('  ,  ')}`);
  }
  if (unmatched.length > 0) {
    console.log('  UNMATCHED (reported, never guessed):');
    for (const u of unmatched) console.log(`    ${u}`);
  }
}
if (APPLY) await Promise.all(webpJobs);

// What still has NO art at all?
const haveMinionArt = new Set(readdirSync('packages/ui/src/art/minions').map((f) => f.replace(/\.(png|webp)$/, '').replace(/2$/, '')));
const missingMinions = poolFor('set2').all.filter((c) => !c.spell && !c.ruby && !haveMinionArt.has(c.id)).map((c) => `${c.name} (${c.id})`);
console.log(`\nSET-2 MINIONS WITH NO ART ${missingMinions.length}:`);
for (const m of missingMinions) console.log(`  ${m}`);

const haveRuneArt = new Set(readdirSync('packages/ui/src/art/runes').map((f) => f.replace(/\.(png|webp)$/, '').replace(/2$/, '')));
const missingRunes = [...RUNES, ...EPIC_RUNES].filter((r) => !haveRuneArt.has(r.id)).map((r) => `${r.name} (${r.id})`);
console.log(`\nRUNES WITH NO ART ${missingRunes.length}:`);
for (const m of missingRunes) console.log(`  ${m}`);

console.log(APPLY ? '\n(applied)' : '\n(dry run — pass --apply to write)');
