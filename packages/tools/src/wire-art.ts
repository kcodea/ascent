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
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES, poolFor } from '@game/content';
import { HEROES } from '@game/sim';

const APPLY = process.argv.includes('--apply');
/**
 * `--only=<label>[,<label>]` — run just these jobs (e.g. `--only=heroes,hero powers`).
 *
 * Added 2026-08-22: the owner re-does one art family at a time ("re-wire the hero power art"), and a full
 * pass rewrites every minion, spell, quest and rune too — a diff nobody can review for the change actually
 * intended. Filtering keeps that work inside this pipeline (one resize, one precedence rule, one report)
 * instead of a hand-rolled script beside it, which is exactly what this file's header warns against.
 */
const ONLY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return null;
  return new Set(arg.slice('--only='.length).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
})();
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
/** RETIRED source files — attributed to a card that no longer exists, whose name now collides with a
 *  DIFFERENT card. Skipped outright: re-owning attributed art by name-accident is exactly the guessing the
 *  strict matcher exists to prevent. */
const RETIRED = new Set<string>([
  // Whelp.png was drawn for set 2's Whelp (Tamer's token, removed with Tamer 2026-08-02). Set 1's `whelpling`
  // token is ALSO named "Whelp", so the file exact-matches a card it was never made for — and overwrote its
  // existing art on the first run after the removal. The owner can re-attribute it deliberately if wanted.
  'whelp',
]);

const ALIASES: Record<string, string> = {
  // misspelled in the source
  // (`chiurgeon` alias retired 2026-07-31: the card is Ayves now, so Ayves.png matches by NAME and the old
  //  misspelled file would only compete for the same slot.)
  oatshieldorin: 'dw_orin',              // missing the 'h'
  salvatoremckluskey: 'salvatore',        // extra 'e'
  candlelightbulwark: 'k_candleback',     // card is Candleback Bulwark
  // Was 'n2_coppercoat' — an id that does not exist. Both CopperSpellsword.png and its Choose One branch
  // CopperSpellsword2.png wired to `n2_coppercoat*`, which no card ever asks for, so the art rendered nowhere
  // and the dead master sat in the repo. The card is `n2_spellsword` (found 2026-08-28 wiring the branch art).
  copperspellsword: 'n2_spellsword',      // card is Coppercoat Spellsword
  gemforgefiend: 'k_gemgorge',            // card is Gemgorge Fiend
  babyrex: 'trexbaby',                    // token is T-Rex Baby
  zyffbetrayer: 'zyff',
  jenkinsandfi: 'jensenfi',               // renamed Jenkins -> Jensen
  jensenandfi: 'jensenfi',                // the CURRENT filename; the card is 'Jensen & Fi' (the & normalises away)
  sylus: 'sylus',                         // card is 'Sylus the Reaper'; the file carries the short name
  malphas: 'dm_malphas',
  orivax: 'd2_orivax',
  // art still under a card's PRE-RENAME name (all renamed 2026-07-29).
  // (Mushy / Scalefeather dropped 2026-07-31: the owner supplied correctly-named files, so they match exactly
  //  and an alias for the old name would only compete with the current art.)
  grandgourmand: 'dm_gourmand',           // -> Bob Blart
  hungerling: 'dm_hungerling',            // -> Demon Horse
  selectiveglutton: 'dm_glutton',          // -> Chipper
  roaringmatriarch: 'd2_matriarch',        // -> Bathing Matriarch
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
/** Spell-art aliases — same doctrine: only files that ARE attributed but whose name doesn't match. */
const SPELL_ALIASES: Record<string, string> = {
  ironcladrequisition: 'ironcladreq', // id shortened; the art carries the full name
  preemptiveattack: 'preemptive',     // card is Pre-emptive ASSAULT; the art file says Attack
  rivalsreflections: 'rivalsreflection', // extra plural s
  triplereward: 'discoverspell',      // the Triple Reward token's id (a Discover token, not flagged `spell`)
  // (Cupcakes.png stays UNMATCHED on purpose: no card by that name exists — reported to the owner 2026-07-31.)
};

const RUNE_ALIASES: Record<string, string> = {
  // FULL-STEM alias, checked before the `2`-variant convention strips the suffix: `RuneOTheMenagerie2.png` is
  // the SET-2 TWIN's art (a different rune, `rune_menagerie_set2`), not a second-art variant of the set-1 rune.
  runeothemenagerie2: 'rune_menagerie_set2',
  runeothemenagerie: 'rune_menagerie',   // the source abbreviates "of the" to "O"
  runeofscale: 'rune_scale',             // owner ruling: the sheet's "Rune of Scale" IS Rune of Bulk Order
  runeofthemotherload: 'rune_motherlode', // misspelled in the source ("Motherload")
  spellofpillaging: 'rune_pillaging',     // authored as "Spell of..."; there is no such spell, and the rune matches
  runeofthecaravan: 'rune_strange_caravan', // art authored as "the Caravan"; the rune is "the Strange Caravan"
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

// Every SPELL (and Ruby) by normalized name, across all sets — the fourth job's index.
const spellsByName = new Map<string, string>();
for (const c of Object.values(CARD_INDEX)) if (c && (c.spell || c.ruby)) spellsByName.set(norm(c.name), c.id);

const runesByName = new Map<string, string>();
for (const r of [...RUNES, ...EPIC_RUNES]) {
  runesByName.set(norm(r.name), r.id);
  // The art folder is inconsistent about "Rune of X" vs "Rune of the X" — in both directions. That is a
  // systematic authoring variance across ~7 files, not seven separate typos, so it is absorbed here rather than
  // as seven alias entries. Registered only when it does not collide with a real rune name.
  const theless = noThe(r.name);
  if (theless !== norm(r.name) && !runesByName.has(theless)) runesByName.set(theless, r.id);
}

interface Job {
  label: string; src: string; dirs: string[]; dest: string; index: Map<string, string>; aliases: Record<string, string>;
  /** Per-job DENY list: a stale duplicate in THIS folder that must lose to a better source elsewhere. */
  skip?: Set<string>;
  /** Per-job ALLOW list (normalized stems). For a folder whose files mostly belong to a DIFFERENT job — the
   *  one token that lives among the hero-power art — so the job does not report every sibling as unmatched. */
  only?: Set<string>;
}
// Heroes wire by NAME and by ID both: several source files still carry a hero's PRE-RENAME name
// (BaggerBen.png → the hero now displayed as Rascal), and the filename happens to be the ID exactly.
const heroesByName = new Map<string, string>();
for (const h of HEROES) { heroesByName.set(norm(h.name), h.id); heroesByName.set(norm(h.id), h.id); }

/**
 * HERO-POWER art (added 2026-08-14): `Hero Powers/<HeroName>HP.png` → `art/powers/<heroId>`. This folder had
 * never been a job — the existing power art was hand-dropped — so a new hero shipped with a placeholder
 * diamond until someone remembered to copy a file by hand.
 *
 * Indexed by name+HP and id+HP ONLY, the same strict rule as every other job: a file whose stem doesn't
 * resolve to a live hero is REPORTED, never guessed. That deliberately leaves a handful of legacy files
 * unmatched (a retired hero, a couple of pre-rename names, one named for the POWER rather than the hero) —
 * they are already wired in the repo, so nothing is lost by not re-deriving them here.
 */
const heroPowersByName = new Map<string, string>();
for (const h of HEROES) {
  heroPowersByName.set(norm(`${h.name}HP`), h.id);
  heroPowersByName.set(norm(`${h.id}HP`), h.id);
}
/**
 * Per-VARIANT hero-power art: a few heroes swap their button image with run state, so one `<Name>HP.png` is
 * not enough. These are FULL-STEM aliases rather than index entries because aliases are resolved BEFORE the
 * `<Name>2` variant convention strips a trailing "2" — without that, `CassenHP2` was silently landing on the
 * `cassen2` variant slot instead of `cassen-gold`, so his Gold commission showed his plain art.
 *
 * Cia: one image per SUIT (the button shows the reward that is queued up).
 * Cassen: one image per COMMISSION (the button shows the one currently running).
 */
const HERO_POWER_ALIASES: Record<string, string> = {
  ciahearts: 'cia-hearts',
  ciaspades: 'cia-spades',
  ciadiamonds: 'cia-diamonds',
  ciaclubs: 'cia-clubs',
  // The Ace, added with Ayse's fifth suit (2026-08-22). Its art was hand-dropped, so the tool did not know
  // the mapping and a re-wire would have reported it unmatched and silently left the slot stale.
  ciaace: 'cia-ace',
  flashfirst: 'flash-first',
  flashlast: 'flash-last',
  // Named for the JOB, not numbered — the owner renamed these after the numbering proved unreadable.
  // Shed 1 turn, House 2, Bridge 3; Castle and Zeppelin are the two RARE jobs.
  cassenshed: 'cassen-spell',
  cassenhouse: 'cassen-gold',
  cassenbridge: 'cassen-discover',
  cassencastle: 'cassen-citadel',
  cassenzeppelin: 'cassen-fortress',
};

/** Quest-art aliases — same doctrine as the card ones: only files that ARE attributed but whose name does
 *  not match. One entry, a straight misspelling. (The other 13 unmatched named files are quests that no
 *  longer exist in the roster — retired set-1 designs — so they stay unwired ON PURPOSE.) */
const QUEST_ALIASES: Record<string, string> = {
  trohpyden: 'q_trophy_den', // 'Trohpy' — transposed letters in the source filename
};

// Quests index by NAME (the authored files are the quest's display name in PascalCase).
const questsByName = new Map<string, string>();
for (const q of QUEST_DEFS) { questsByName.set(norm(q.name), q.id); questsByName.set(noThe(q.name), q.id); }

const JOBS: Job[] = [
  {
    // SET-1 minions (owner ask 2026-08-03: "I refreshed some set 1 demons"). This folder had never been a
    // job, so set-1 portraits were only ever hand-dropped. Deliberately FIRST so that if a name exists in
    // both folders the SET-2 job below wins the slot — set 2 is the live set, and a set-1 file must never
    // silently take a set-2 card's art. Scoped to Demons for now: the other set-1 dirs are unaudited against
    // the current roster, and wiring them blind is exactly the silent-overwrite failure `RETIRED` exists for.
    label: 'set-1 minions', src: 'C:/Game Assets/Ascent Art/Set 1 Minions',
    dirs: ['Demons'], dest: 'packages/ui/src/art/minions', index: cardsByName, aliases: ALIASES,
  },
  {
    label: 'minions', src: 'C:/Game Assets/Ascent Art/Set 2 Minions',
    dirs: ['Beasts', 'Demons', 'Dragons', 'Dwarves', 'Kobolds', 'Neutral'],
    dest: 'packages/ui/src/art/minions', index: cardsByName, aliases: ALIASES,
  },
  {
    // Quest-reward minions are authored in their own folder but are still MINION art — same destination.
    label: 'quest-reward minions', src: 'C:/Game Assets/Ascent Art/Quests/Quest Reward Related Things',
    dirs: ['.'], dest: 'packages/ui/src/art/minions', index: cardsByName, aliases: ALIASES,
    // This folder's Lazarus.png is the OLD portrait; the CURRENT one lives in Set 2 Minions/Neutral and this
    // job runs later, so without the skip the stale file silently wins the slot (owner re-wire 2026-08-02).
    skip: new Set(['lazarus']),
  },
  {
    // Subfolders ("Hero Powers", "Old Artstyle") are deliberately NOT listed — powers have their own dest
    // and the old style must never overwrite the current portraits.
    label: 'heroes', src: 'C:/Game Assets/Ascent Art/Heroes',
    dirs: ['.'], dest: 'packages/ui/src/art/heroes', index: heroesByName, aliases: {},
  },
  {
    // HERO POWERS — the button art, its own destination (the portraits job above deliberately doesn't recurse).
    label: 'hero powers', src: 'C:/Game Assets/Ascent Art/Heroes/Hero Powers',
    dirs: ['.'], dest: 'packages/ui/src/art/powers', index: heroPowersByName, aliases: HERO_POWER_ALIASES,
  },
  {
    // TOKENS AUTHORED WITH A HERO POWER (owner batch 2026-08-23). Cindara's Whelp is summoned BY Hoard, so its
    // art was drawn alongside the power art and lives in that folder — but it is a real minion card, so it has
    // to land in the MINION destination and match against the card index, not the hero-power one. An `only`
    // list rather than a second full pass: without it this job would report every sibling `*HP.png` as
    // unmatched on every run, which is the kind of standing noise that trains you to ignore the report.
    label: 'hero-power tokens', src: 'C:/Game Assets/Ascent Art/Heroes/Hero Powers',
    dirs: ['.'], dest: 'packages/ui/src/art/minions', index: cardsByName, aliases: ALIASES,
    only: new Set(['cindarawhelp']),
  },
  {
    // QUEST art (owner ask 2026-08-02) — the folder was only mined for its "Quest Reward Related Things"
    // sub-folder before, so the quest cards themselves were never wired. `dirs: ['.']` deliberately does not
    // recurse: the sub-folder is its own job above, with a different destination.
    label: 'quests', src: 'C:/Game Assets/Ascent Art/Quests',
    dirs: ['.'], dest: 'packages/ui/src/art/quests', index: questsByName, aliases: QUEST_ALIASES,
  },
  {
    label: 'runes', src: 'C:/Game Assets/Ascent Art/Runes',
    dirs: ['.'], dest: 'packages/ui/src/art/runes', index: runesByName, aliases: RUNE_ALIASES,
  },
  {
    label: 'spells', src: 'C:/Game Assets/Ascent Art/Spells',
    dirs: ['.'], dest: 'packages/ui/src/art/spells', index: spellsByName, aliases: SPELL_ALIASES,
  },
];

const webpJobs: Promise<unknown>[] = [];
for (const job of JOBS) {
  if (ONLY && !ONLY.has(job.label.toLowerCase())) continue;
  const wired: string[] = [];
  const unmatched: string[] = [];
  const matches: { src: string; label: string; id: string; exact: boolean }[] = [];
  for (const dir of job.dirs) {
    const full = dir === '.' ? job.src : join(job.src, dir);
    if (!existsSync(full)) { console.log(`missing source dir: ${job.label}/${dir}`); continue; }
    for (const file of readdirSync(full).filter((f) => /\.(png|webp|jpe?g)$/i.test(f))) {
      // Strip a trailing GENERATOR INDEX (`Motherlode_00001_.png`): it is an export artifact of the art tool,
      // not part of the name, so removing it is normalisation rather than the guessing the matcher forbids —
      // the remaining stem still has to match a name EXACTLY (owner ask 2026-08-02: wire the quest folder).
      const stem = file.replace(/\.(png|webp|jpe?g)$/i, '').replace(/_\d+_$/, '');
      if (RETIRED.has(norm(stem))) continue; // attributed to a removed card — never re-owned by name-accident
      if (job.skip?.has(norm(stem))) continue; // per-job skip: a stale duplicate in THIS folder loses to the current source
      if (job.only && !job.only.has(norm(stem))) continue; // per-job allow list: this folder is mined for a few named files only
      // A FULL-STEM alias wins before the variant convention: some trailing digits are part of a distinct
      // id's name (RuneOTheMenagerie2 = the set-2 twin), not "second art for the same id".
      const fullAlias = job.aliases[norm(stem)];
      if (fullAlias) { matches.push({ src: join(full, file), label: dir === '.' ? file : `${dir}/${file}`, id: fullAlias, exact: false }); continue; }
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

// No `2$` strip here: a rune id can END in 2 (`rune_menagerie_set2`), and stripping it made the report
// claim that rune had no art forever, even after it wired.
const runeFiles = new Set(readdirSync('packages/ui/src/art/runes').map((f) => f.replace(/\.(png|webp)$/, '')));
const haveRuneArt = new Set([...runeFiles].map((f) => (runeFiles.has(f) ? f : f)).flatMap((f) => [f, f.replace(/2$/, '')]));
const missingRunes = [...RUNES, ...EPIC_RUNES].filter((r) => !haveRuneArt.has(r.id)).map((r) => `${r.name} (${r.id})`);
console.log(`\nRUNES WITH NO ART ${missingRunes.length}:`);
for (const m of missingRunes) console.log(`  ${m}`);

console.log(APPLY ? '\n(applied)' : '\n(dry run — pass --apply to write)');
