/**
 * DOC BOT 2.0 WP E — the conservative partial parser over printed text (blueprint §11.1).
 *
 * Grown from the three tranche grammars (textOracle's stat-buff parse, textOracleSummons' summon-clause
 * parse, targetCardinality's target-language) + the keyword/trigger lexicons, and on 2026-09-11 by the
 * histogram-driven coverage pass (docs/devlog/2026-09-11-docbot-text-parser-coverage.md). Strategy, honest by
 * construction (§4.3):
 *
 *   sentence by sentence → peel leading gates (conditions, phase gates), one trigger prefix (TRIGGER_LEXICON /
 *   CADENCE_PREFIX_RE) or conditional clause (CONDITIONAL_LEXICON) → then PREFIX-PARSE the effect body:
 *   anchored recognizers consume from the left; the FIRST position no recognizer accepts ends the parse of
 *   that sentence and the whole remainder lands in `unresolvedPhrases`, verbatim, with its span. A recognizer
 *   never guesses — a clause it half-understands is a clause it does not consume. Modifier tails a recognized
 *   effect carries ("permanently", "this combat", "(max 3)") are consumed and LISTED in `consumedModifiers`,
 *   so nothing the grammar read is invisible.
 *
 * Subject-first sentences ("your left-most minion attacks immediately", "Your Rubies gain +1 Attack") are
 * read by parsing a target phrase as the SUBJECT and dispatching the remainder through the same recognizers
 * in their third-person forms; the effect records `subject` separately from `target`.
 *
 * The parser is pure over the text string (plus CARD_INDEX name resolution for named cards) — no engine
 * state, no RNG, no side effects. It reads STRIPPED text (bold/live-value markers removed) so parsing is
 * stable across presentation markers.
 */
import { stripMarkers } from '../textOracle';
import { resolveTokenName } from '../textOracleSummons';
import { CADENCE_LEXICON, CADENCE_PREFIX_RE, CONDITIONAL_LEXICON, TRIGGER_LEXICON, keywordNameTable } from './lexicon';
import { COUNT_RE, countOf, targetPhrase } from './targets';
import type {
  ParsedAmount, ParsedCadence, ParsedEffect, ParsedGamePhase, ParsedLimit, ParsedPersistence, ParsedRandomness,
  ParsedScaler, ParsedTarget, ParsedTextContract, ParsedTrigger, TextSpan,
} from './types';

const span = (stripped: string, start: number, end: number): TextSpan =>
  ({ start, end, text: stripped.slice(start, end) });

// ── shared sub-grammars ──────────────────────────────────────────────────────────────────────────────────

/** "+A/+H" | "+N Attack" | "+N Health" | "+N more Health" — the T1 pair grammar, position-anchored. */
function statToken(s: string): { attack: number; health: number; len: number; at: number } | null {
  const m = /\+(\d+)\/\+(\d+)|\+(\d+) (?:more )?Attack|\+(\d+) (?:more )?Health/.exec(s);
  if (!m) return null;
  const at = m.index;
  const len = m[0].length;
  if (m[1] !== undefined) return { attack: Number(m[1]), health: Number(m[2]), len, at };
  if (m[3] !== undefined) return { attack: Number(m[3]), health: 0, len, at };
  return { attack: 0, health: Number(m[4]!), len, at };
}

const SELF: ParsedTarget = { cardinality: 'exactly', count: 1, scope: 'self', friendly: true };
const capNum = (w: string): number => (w === 'twice' ? 2 : w === 'three times' ? 3 : w === 'again' ? 1 : Number(/\d+/.exec(w)?.[0] ?? 1));

// ── effect recognizers (anchored; return the consumed length or null) ────────────────────────────────────

interface Rec { effect: Omit<ParsedEffect, 'span'>; len: number }
/** Context the loop hands each recognizer: the previous effect in this sentence (for elided verbs). */
interface Ctx { prev: ParsedEffect | null }

const KEYWORD_TABLE = keywordNameTable();

/** Keyword names at the start of `s` ("Taunt", "Ward and Taunt", "Critical Strike (50%)", "Immune while attacking"). */
function keywordRun(s: string): { letters: string[]; len: number } | null {
  let pos = 0;
  const letters: string[] = [];
  for (;;) {
    const rest = s.slice(pos);
    let hit: { name: string; code: string } | null = null;
    const imm = /^Immune while attacking/.exec(rest);
    if (imm) hit = { name: imm[0], code: 'IMM' };
    else {
      for (const [name, code] of KEYWORD_TABLE) {
        if (rest.startsWith(name) && !/^[\w]/.test(rest.slice(name.length))) { hit = { name, code }; break; }
      }
    }
    if (!hit) break;
    let len = hit.name.length;
    const pct = /^ \(\d+%\)/.exec(rest.slice(len));
    if (pct) len += pct[0].length;
    letters.push(hit.code);
    pos += len;
    const joiner = /^(?:, | and |, and )(?=[A-Z])/.exec(s.slice(pos));
    if (!joiner) break;
    pos += joiner[0].length;
  }
  return letters.length ? { letters, len: pos } : null;
}

/** A parenthetical the keyword line may carry: "(attach to any minion)", "(first 2 attacks each combat)". */
const KEYWORD_NOTE = /^\s*\((?:attach to any minion|first \d+ attacks each combat)\)/;

function recKeywordLine(s: string, ctx: Ctx): Rec | null {
  if (ctx.prev) return null; // after a conjunction a bare keyword is an elided grant, not a keyword line
  const run = keywordRun(s);
  if (!run) return null;
  let len = run.len;
  const note = KEYWORD_NOTE.exec(s.slice(len));
  if (note) len += note[0].length;
  // Only a run that consumes the whole fragment (bar trailing punctuation) is a bare keyword line.
  if (/^[.\s]*$/.test(s.slice(len))) return { effect: { kind: 'keyword-line', keywords: run.letters }, len: s.length };
  // "Engraved — keeps its combat gains." — the Engraved gloss.
  const gloss = /^ — keeps its combat gains\.?$/.exec(s.slice(len));
  if (gloss) return { effect: { kind: 'keyword-line', keywords: run.letters }, len: s.length };
  return null;
}

/** "<target> are/is Engraved" / "All stats are Engraved" — the Engraved grant in its subject-first form. */
function recEngraved(s: string): Rec | null {
  const all = /^All stats are Engraved\b/.exec(s);
  if (all) return { effect: { kind: 'grant-keyword', keywords: ['EG'], verb: 'are', target: SELF }, len: all[0].length };
  const tp = targetPhrase(s, { allowPronoun: false });
  if (!tp) return null;
  const m = /^ (?:are|is) Engraved\b/.exec(s.slice(tp.len));
  if (!m) return null;
  return { effect: { kind: 'grant-keyword', keywords: ['EG'], verb: 'are', target: tp.target }, len: tp.len + m[0].length };
}

const GIVE_VERBS = 'Give|Gives|Grant|Grants|grant|grants|Gain|Gains|Improve|Improves|Improving|Engrave|Engraves|improve|improving|give|gives|gain|gains|get|gets|Get|Gets|has|Has|have|Have';

function recStatBuff(s: string): Rec | null {
  const m = new RegExp(`^(${GIVE_VERBS})\\b\\s*`).exec(s);
  if (!m) return null;
  const verb = m[1]!.toLowerCase();
  let pos = m[0].length;
  // "give you" is never a stat grant.
  if (/^you\b/.test(s.slice(pos))) return null;
  // Optional target phrase between verb and the stat token ("give your Beasts +1/+1").
  const tp = targetPhrase(s.slice(pos));
  // "improve your Imp Aura BY +2/+2" — the Improve verb takes a "by" between target and amount;
  // "give it an extra +4/+4" / "give it a permanent …" — article fillers.
  if (tp) pos += tp.len + (/^\s*(?:by |an extra |a permanent |permanent |permanently )?/.exec(s.slice(pos + tp.len))?.[0].length ?? 0);
  else {
    const filler = /^(?:this by |by |an extra |permanently |double the )/.exec(s.slice(pos));
    if (filler) pos += filler[0].length;
  }
  const rest = s.slice(pos);
  const st = statToken(rest);
  if (!st || st.at > 1) return null; // the stat pair must sit right here — anything between is unread
  pos += st.at + st.len;
  const amount: ParsedAmount = { attack: st.attack, health: st.health };
  const effect: Omit<ParsedEffect, 'span'> = {
    kind: 'stat-buff', amount, verb,
    ...(tp ? { target: tp.target } : /^(?:gain|has|have)/.test(verb) ? { target: SELF } : {}),
  };
  return { effect, len: pos };
}

/** An elided-verb stat pair after a conjunction ("…, or +4 Health" / "gain Ward and +7/+7" / "or your
 *  Fodder +2/+2"). Only legal when a previous effect in the sentence supplies the verb. */
function recElidedStat(s: string, ctx: Ctx): Rec | null {
  if (!ctx.prev) return null;
  let pos = 0;
  const tp = targetPhrase(s, { allowPronoun: false });
  if (tp) pos = tp.len + (/^\s*/.exec(s.slice(tp.len))?.[0].length ?? 0);
  const st = statToken(s.slice(pos));
  if (!st || st.at !== 0) return null;
  pos += st.len;
  const verb = ctx.prev.verb ?? 'give';
  return {
    effect: { kind: 'stat-buff', amount: { attack: st.attack, health: st.health }, verb, ...(tp ? { target: tp.target } : ctx.prev.target ? { target: ctx.prev.target } : {}) },
    len: pos,
  };
}

/** An elided-verb keyword after a conjunction ("…, or Flurry and +3 Attack" / "+2/+3 and Taunt"). */
function recElidedKeyword(s: string, ctx: Ctx): Rec | null {
  if (!ctx.prev) return null;
  if (ctx.prev.kind !== 'stat-buff' && ctx.prev.kind !== 'grant-keyword' && ctx.prev.kind !== 'token-body') return null;
  const run = keywordRun(s);
  if (!run) return null;
  if (!/^(?:[.,;)]|$| and \+| for | if | this| next| permanently)/.test(s.slice(run.len))) return null;
  return { effect: { kind: 'grant-keyword', keywords: run.letters, verb: ctx.prev.verb ?? 'give', ...(ctx.prev.target ? { target: ctx.prev.target } : {}) }, len: run.len };
}

/** An elided-verb target after a conjunction: "give X Taunt, and an adjacent minion too" / "cast 2 Rubies on this and
 *  adjacent Kobolds" / "gains its stats — or the next Imp you summon". Legal only after an effect of a kind that takes a
 *  second target. */
function recElidedTarget(s: string, ctx: Ctx): Rec | null {
  if (!ctx.prev) return null;
  const kinds = new Set(['grant-keyword', 'stat-transfer', 'cast-ruby', 'cast-spell', 'discover', 'get-card']);
  if (!kinds.has(ctx.prev.kind)) return null;
  const tp = targetPhrase(s, { allowPronoun: false });
  if (!tp) return null;
  if (!/^(?: too)?(?=[.,;]|$)/.test(s.slice(tp.len))) return null;
  const { span: _s, ...rest } = ctx.prev;
  void _s;
  const named = ctx.prev.kind === 'discover' || ctx.prev.kind === 'get-card';
  return { effect: { ...rest, target: tp.target, ...(named ? { refName: s.slice(0, tp.len), refId: undefined, summonCount: tp.target.count ?? 1 } : {}) }, len: tp.len + (/^ too/.test(s.slice(tp.len)) ? 4 : 0) };
}

/** "trigger your left-most Shout, then your left-most Echo" — the elided second trigger object. */
function recElidedTrigger(s: string, ctx: Ctx): Rec | null {
  if (ctx.prev?.kind !== 'trigger-other') return null;
  const hit = recTriggerOther(`trigger ${s}`);
  if (!hit || hit.len <= 8) return null;
  return { effect: hit.effect, len: hit.len - 8 };
}

/** "gain an Equipment charge" / "gain 2 Equipment charges". */
function recEquipCharge(s: string): Rec | null {
  const m = new RegExp(`^[Gg]ains? (${COUNT_RE}) Equipment charges?`).exec(s);
  if (!m) return null;
  return { effect: { kind: 'action', action: 'equipment-charge', verb: 'gain', amount: { value: countOf(m[1]!), unit: 'charges' } }, len: m[0].length };
}

function recGrantKeyword(s: string): Rec | null {
  const m = /^(Give|Gives|Gain|Gains|give|gives|gain|gains|grant|grants|Grant)\b\s*/.exec(s);
  if (!m) return null;
  let pos = m[0].length;
  const tp = targetPhrase(s.slice(pos));
  if (tp) pos += tp.len + (/^\s*(?:an? |permanent |its )*/.exec(s.slice(pos + tp.len))?.[0].length ?? 0);
  else {
    const art = /^(?:an? |permanent )+/.exec(s.slice(pos));
    if (art) pos += art[0].length;
  }
  const run = keywordRun(s.slice(pos));
  if (!run) return null;
  pos += run.len;
  const effect: Omit<ParsedEffect, 'span'> = {
    kind: 'grant-keyword', keywords: run.letters, verb: m[1]!.toLowerCase(),
    ...(tp ? { target: tp.target } : m[1]!.toLowerCase().startsWith('gain') ? { target: SELF } : {}),
  };
  return { effect, len: pos };
}

/** "give <target> All types" — the all-tribes grant (Anomaly Reactor). */
function recAllTypes(s: string): Rec | null {
  const m = /^(Give|give) /.exec(s);
  if (!m) return null;
  const tp = targetPhrase(s.slice(m[0].length));
  if (!tp) return null;
  const t = /^ All types( — it counts as every tribe and gets all of their buffs)?/.exec(s.slice(m[0].length + tp.len));
  if (!t) return null;
  return { effect: { kind: 'grant-keyword', keywords: ['ALL_TYPES'], verb: 'give', target: tp.target }, len: m[0].length + tp.len + t[0].length };
}

/** "summon a Charging Soldier that (gains this minion's Attack and) attacks immediately" — the summon-and-charge tail. */
const SUMMON_CHARGE_TAIL = /^ that (?:gains? this minion['’]s Attack and )?attacks? immediately/;

function recSummon(s: string): Rec | null {
  const head = /^(?:[Rr]e)?[Ss]ummons?(?: and gets?)?\s+/.exec(s);
  if (!head) return null;
  const body = s.slice(head[0].length);
  if (/^(?:an? |another )?(?:exact |plain )?cop(?:y|ies)/.test(body)) return null; // "Summon a copy of …" belongs to the copy recognizer
  // The named-token path first: "[N] [Gilded] [A/H] [Gilded] Name [with Keywords] [that attacks immediately]".
  const nm = new RegExp(`^(?:(${COUNT_RE})\\s+)?(?:(?:Golden|Gilded)\\s+)?(?:(\\d+)\\/(\\d+)\\s+)?(?:(?:Golden|Gilded)\\s+)?([A-Z][\\w'’-]*(?:\\s+[A-Z][\\w'’-]*)*)`).exec(body);
  if (nm) {
    let pos = head[0].length + nm[0].length;
    const count = nm[1] ? countOf(nm[1]) : 1;
    const stats: ParsedAmount | undefined = nm[2] ? { attack: Number(nm[2]), health: Number(nm[3]) } : undefined;
    let keywords: string[] | undefined;
    const withKw = /^ with /.exec(s.slice(pos));
    if (withKw) {
      const run = keywordRun(s.slice(pos + withKw[0].length));
      if (run) { keywords = run.letters; pos += withKw[0].length + run.len; }
    }
    const charge = SUMMON_CHARGE_TAIL.exec(s.slice(pos));
    if (charge) pos += charge[0].length;
    const id = resolveTokenName(nm[4]!);
    return {
      effect: {
        kind: 'summon', summonCount: count,
        ...(id ? { refId: id } : { refName: nm[4]! }),
        ...(stats ? { amount: stats } : {}), ...(keywords ? { keywords } : {}),
        ...(charge ? { action: 'attacks-immediately' } : {}),
      },
      len: pos,
    };
  }
  // Otherwise a target phrase: "summon them" / "summon the highest-Health minion from your hand" / "summon a random Beast".
  const tp = targetPhrase(body);
  if (!tp) return null;
  let pos = head[0].length + tp.len;
  const withKw = /^ with /.exec(s.slice(pos));
  let keywords: string[] | undefined;
  if (withKw) {
    const run = keywordRun(s.slice(pos + withKw[0].length));
    if (run) { keywords = run.letters; pos += withKw[0].length + run.len; }
  }
  const charge = SUMMON_CHARGE_TAIL.exec(s.slice(pos));
  if (charge) pos += charge[0].length;
  return {
    effect: {
      kind: 'summon', summonCount: tp.target.count ?? 1, target: tp.target,
      ...(tp.target.random ? { verb: 'summon-random' } : {}), ...(keywords ? { keywords } : {}),
      ...(charge ? { action: 'attacks-immediately' } : {}),
    },
    len: pos,
  };
}

function recGold(s: string): Rec | null {
  const m = new RegExp(`^(?:[Gg]ains?|[Gg]ets?)\\s+(${COUNT_RE}) (?:extra |additional )?Gold\\b(?! (?:Pouch|Font))(?: next (?:turn|shop)| immediately| this turn)?`).exec(s);
  if (m) return { effect: { kind: 'gain-gold', amount: { value: countOf(m[1]!), unit: 'gold' }, verb: /gain/i.test(m[0]) ? 'gain' : 'get' }, len: m[0].length };
  const mx = /^(?:[Gg]ain \+?(\d+) max(?:imum)? Gold|[Rr]aise your maximum Gold by (\d+)|[Ii]ncrease your maximum Gold by (\d+)|you have \+?(\d+) max Gold(?: each turn)?)\b/.exec(s);
  if (mx) {
    const v = Number(mx[1] ?? mx[2] ?? mx[3] ?? mx[4]);
    if (Number.isFinite(v)) return { effect: { kind: 'gain-gold', amount: { value: v, unit: 'max-gold' }, verb: 'gain' }, len: mx[0].length };
  }
  return null;
}

/** "gain a free refresh" / "Gain 2 free rerolls" / "gain 2 free refreshes next turn". */
function recRefreshGain(s: string): Rec | null {
  const m = new RegExp(`^(?:[Gg]ains?|[Gg]ets?)\\s+(${COUNT_RE}) free (?:refresh(?:es)?|rerolls?)\\b`).exec(s);
  if (!m) return null;
  return { effect: { kind: 'gain-refresh', amount: { value: countOf(m[1]!), unit: 'refresh' }, verb: 'gain' }, len: m[0].length };
}

/** "Refresh the Shop" / "refresh it" / "Refresh the tavern — fill it with Shop spells instead of minions". */
function recRefresh(s: string): Rec | null {
  const m = /^[Rr]efresh (?:the Shop|the tavern|the shop|it)(?: with (?:plain copies of your last opponent's board|minions of its type))?(?: — fill it with Shop spells instead of minions)?/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'refresh', verb: 'refresh' }, len: m[0].length };
}

/** A name list: "Tier 4, 5, and 6 minion" / "Beast, Demon, Dragon, Mech, and Undead" / "Tier 1, Tier 3 and Tier 5 minion". */
const NAME_STOP = '(?:and|then|that|for|next|at|every|in|instead|on|with|twice|each|when|whenever|after|if|to)';
// "of that Tier" stays inside a name; any other "that …" opens a relative clause the name does not own.
const NAME_WORDS = `[A-Za-z0-9][\\w'’-]*(?: of that [\\w'’-]+| (?!${NAME_STOP}\\b)[\\w'’-]+)*`;
const NAME_LIST = `${NAME_WORDS}(?:, (?=Tier \\d|[A-Z0-9])${NAME_WORDS})*(?:,? and (?=Tier \\d|[A-Z0-9])[\\w'’-]+(?: (?!(?:and|then|or|that|for|next|at|every|in|instead|on|with|twice|each|when|whenever|after|if)\\b)[\\w'’-]+)*)?`;

function recDiscover(s: string): Rec | null {
  const m = new RegExp(`^[Dd]iscover (an? |two |\\d+ )?(${NAME_LIST})(?=[.,;(]|$| )`).exec(s);
  if (!m) return null;
  let len = m[0].length;
  const tail = /^(?: to wield this turn| to keep for the rest of the run| for it to become)/.exec(s.slice(len));
  if (tail) len += tail[0].length;
  return { effect: { kind: 'discover', refName: m[2]!.trim(), verb: 'discover', ...(m[1] ? { summonCount: countOf(m[1].trim()) } : {}) }, len };
}

function recCopy(s: string): Rec | null {
  const m = new RegExp(`^(?:[Gg]ets?|[Aa]dds?|[Ss]ummons?|[Rr]esummons?|[Cc]op(?:y|ies)|[Cc]laim|[Pp]lay|[Rr]eturns?|attaches)\\s+(?:(${COUNT_RE}|another)\\s+)?(?:(exact|plain)\\s+)?cop(?:y|ies)?\\b`).exec(s);
  const m2 = /^[Cc]op(?:y|ies)\b/.exec(s);
  if (!m && !m2) return null;
  const mode = (m?.[2] as 'exact' | 'plain' | undefined) ?? (/\bexact cop/.test(s) ? 'exact' : /\bplain cop/.test(s) ? 'plain' : 'unmarked');
  // Consume through "of <thing>" when present; through the head otherwise.
  const head = (m ?? m2)![0].length;
  const of = /^(?:y|ies)?\s*(?:of ([^.,;]+?))?(?=[.,;]|$| (?:when|on|onto|to your|without|exactly|twice|to your hand))/.exec(s.slice(head));
  let len = head + (of?.[0].length ?? 0);
  const named = of?.[1]?.trim();
  const id = named ? resolveTokenName(named.replace(/^(?:this minion|a friendly minion|the minion.*)$/, '')) : null;
  let target: ParsedTarget | undefined;
  if (!named) {
    // "copy it onto this too" / "Copy your leftmost Echo when summoned" / "play a copy on 2 random friendly minions".
    const tp = targetPhrase(s.slice(len).replace(/^ /, ''));
    if (tp && /^ /.test(s.slice(len))) { target = tp.target; len += 1 + tp.len; }
  }
  const onto = /^(?: twice)? (?:on(?! your board| board)|onto|to(?! your hand)) /.exec(s.slice(len));
  if (onto) {
    const tp = targetPhrase(s.slice(len + onto[0].length));
    if (tp) { target = target ?? tp.target; len += onto[0].length + tp.len; }
  }
  const tail = /^(?: exactly — stats, buffs and improvements included| without Echo| to your hand)/.exec(s.slice(len));
  if (tail) len += tail[0].length;
  return {
    effect: {
      kind: 'copy', copyMode: mode, verb: (m ?? m2)![0].split(/\s/)[0]!.toLowerCase(),
      ...(m?.[1] ? { summonCount: m[1] === 'another' ? 1 : countOf(m[1]) } : {}),
      ...(id ? { refId: id } : named ? { refName: named } : {}),
      ...(target ? { target } : {}),
    },
    len,
  };
}

/** "get a Gold Pouch" / "get 2 random Kobolds" / "Get Den Mother" / "get another" / "gives you a random Dwarven Ale"
 *  / "Start (the game) with a Reflector" / "get a random Shop spell of its tier to your hand". */
function recGetCard(s: string): Rec | null {
  const another = /^[Gg]et another\b/.exec(s);
  if (another) {
    let len = another[0].length;
    const tail = /^(?: every \d+ turns| in \d+ turns)/.exec(s.slice(len));
    if (tail) len += tail[0].length;
    return { effect: { kind: 'get-card', verb: 'get', summonCount: 1, refName: 'another' }, len };
  }
  const mm = new RegExp(`^(?:[Gg]ets?|[Aa]dds?|[Gg]ives? you|Start (?:the game )?with)\\s+(?:(${COUNT_RE})\\s+)?(random\\s+)?(${NAME_LIST})(\\s+to your (?:hand|next(?: \\d+)? shops?|next tavern))?(?=[.,;(]|$| )`).exec(s);
  if (!mm) return null;
  const named = mm[3]!.trim();
  if (/^(?:Gold|copy|copies)$/.test(named)) return null;
  if (!mm[1] && !mm[2] && !/^[A-Z]/.test(named)) return null; // "get another" / "Get Den Mother" — a bare name needs a capital
  const id = resolveTokenName(named);
  const count = mm[1] ? countOf(mm[1]) : 1;
  let len = mm[0].length;
  const tail = /^(?: that has learned it| every \d+ turns| in \d+ turns| at End of Turn)/.exec(s.slice(len));
  if (tail) len += tail[0].length;
  let keywords: string[] | undefined;
  const withKw = /^ with /.exec(s.slice(len));
  if (withKw) {
    const run = keywordRun(s.slice(len + withKw[0].length));
    if (run) { keywords = run.letters; len += withKw[0].length + run.len; }
  }
  return {
    effect: {
      kind: 'get-card', verb: 'get', summonCount: count,
      ...(id ? { refId: id } : { refName: named }),
      ...(keywords ? { keywords } : {}),
      ...(mm[2] ? { target: { cardinality: 'exactly', count, scope: named.toLowerCase(), random: true } } : {}),
    },
    len,
  };
}

/** "cast 2 Rubies on your minions" / "Cast a Ruby on each of your Kobolds" / "cast 3 permanent Rubies on this". */
function recCastRuby(s: string): Rec | null {
  const m = new RegExp(`^[Cc]asts?\\s+(${COUNT_RE})\\s+(permanent\\s+)?Rub(?:y|ies)\\b`).exec(s);
  if (!m) return null;
  let len = m[0].length;
  let target: ParsedTarget | undefined;
  const on = /^ on /.exec(s.slice(len));
  if (on) {
    const tp = targetPhrase(s.slice(len + on[0].length));
    if (tp) { target = tp.target; len += on[0].length + tp.len; }
  }
  return { effect: { kind: 'cast-ruby', verb: 'cast', amount: { value: countOf(m[1]!), unit: 'rubies' }, ...(m[2] ? { keywords: ['permanent'] } : {}), ...(target ? { target } : {}) }, len };
}

function recCast(s: string): Rec | null {
  const m = new RegExp(`^[Cc]asts?\\s+(?:(${COUNT_RE})\\s+)?(?:(random)\\s+)?(?:(stat-granting)\\s+)?(?:(Dwarven Ales?|Shop spells?)|(the (?:left-most|first|last) (?:Shop )?spell (?:in your hand|you cast this turn)|the Shop spell this (?:was taught|learned)|every remembered spell|it|them)|([A-Z][\\w'’-]*(?: (?:of )?[A-Z][\\w'’-]*)*))(?=[.,;]|$| )`).exec(s);
  if (m && / to ascend/.test(s.slice(m[0].length, m[0].length + 10))) return null; // a quest condition, not a cast
  if (!m) return null;
  const name = (m[6] ?? m[4])?.trim();
  const id = name ? resolveTokenName(name) : null;
  let len = m[0].length;
  let target: ParsedTarget | undefined;
  const on = /^ on /.exec(s.slice(len));
  if (on) {
    const tp = targetPhrase(s.slice(len + on[0].length));
    if (tp) { target = tp.target; len += on[0].length + tp.len; }
  }
  let times: number | undefined;
  const again = /^ (again|twice|three times|\d+ times)\b/.exec(s.slice(len));
  if (again) { times = capNum(again[1]!) + (again[1] === 'again' ? 1 : 0); len += again[0].length; }
  return {
    effect: {
      kind: 'cast-spell', verb: 'cast',
      ...(id ? { refId: id } : { refName: name ?? m[5]! }),
      ...(m[1] ? { summonCount: countOf(m[1]) } : {}),
      ...(m[2] ? { target: { cardinality: 'exactly', count: m[1] ? countOf(m[1]) : 1, scope: (name ?? m[5]!).toLowerCase(), random: true } } : {}),
      ...(target ? { target } : {}),
      ...(times ? { amount: { value: times, unit: 'casts' } } : {}),
    },
    len,
  };
}

function recDamage(s: string): Rec | null {
  const m = /^[Dd]eals?\s+(?:(\d+) damage|(?:its |this minion's )Attack(?:\s*\+\s*\d+)?)/.exec(s);
  if (m) {
    let len = m[0].length;
    let target: ParsedTarget | undefined;
    const to = /^ to /.exec(s.slice(len));
    if (to) {
      const all = /^(?:ALL|all) minions(?: except [^.,]+)?/.exec(s.slice(len + to[0].length));
      if (all) { target = { cardinality: 'all', scope: all[0].toLowerCase().replace(/\s+/g, '-') }; len += to[0].length + all[0].length; }
      else {
        const tp = targetPhrase(s.slice(len + to[0].length));
        if (tp) { target = tp.target; len += to[0].length + tp.len; }
      }
    }
    return { effect: { kind: 'deal-damage', ...(m[1] ? { amount: { value: Number(m[1]), unit: 'damage' } } : {}), ...(target ? { target } : {}) }, len };
  }
  const d = /^Damages (?:an adjacent unit|both adjacent units) when attacking/.exec(s);
  if (d) return { effect: { kind: 'deal-damage', verb: 'damages', target: { cardinality: /both/.test(d[0]) ? 'all' : 'exactly', ...(/both/.test(d[0]) ? {} : { count: 1 }), scope: 'adjacent' } }, len: d[0].length };
  return null;
}

/** "Your <family> (effects) trigger/cast/… twice | an additional time | N more times" — the multiplier-print
 *  family (the LG-TWICE-01 surface), grown to its subject-first cousins ("The first spell you cast each turn
 *  casts twice", "your next spell casts 2 additional times", "They cast twice", "One Shout triggers 2 extra
 *  times per turn", "Your Rubies all bounce an additional time"). `value` is the number of EXTRA fires printed. */
function recMultiplierPrint(s: string): Rec | null {
  const m = /^(?:([Yy]our|The next|The first|[Yy]our first|[Yy]our next|One|They|It|it)\s+)?([\w'’ ,-]+?)?\s*(?:effects?\s+)?(?:all\s+|also\s+)?([Tt]riggers?|[Pp]rocs?|[Ff]ires?|[Cc]asts?|[Mm]agnetizes?|[Bb]ounces?|[Ii]mproves?)\s+(?:an?\s+)?(twice|three times|again|\d+ times|additional times?|extra time|(?:one|two|\d+)\s+(?:more|additional|extra)\s+times?)\b/.exec(s);
  if (!m) return null;
  if (!m[1] && m[2]) return null; // verb-first only when nothing precedes the verb (a subject-first dispatch)
  const tail = m[4]!;
  const extra = tail === 'twice' ? 1
    : tail === 'three times' ? 2
      : tail === 'again' ? 1
        : /^\d+ times$/.test(tail) ? Number(/\d+/.exec(tail)![0]) - 1
          : /^(?:additional|extra)/.test(tail) ? 1
            : (() => { const n = /^(one|two|\d+)/.exec(tail)![1]!; return n === 'one' ? 1 : n === 'two' ? 2 : Number(n); })();
  const subjectText = `${m[1] ?? ''} ${m[2] ?? ''}`.trim();
  return {
    effect: {
      kind: 'multiplier-print', verb: m[3]!.toLowerCase().replace(/s$/, ''),
      amount: { value: extra, unit: 'extra-fires' },
      target: { cardinality: 'all', scope: subjectText.toLowerCase().replace(/\s+/g, '-') || 'self', friendly: true },
    },
    len: m[0].length,
  };
}

/** "It also casts on a random friendly minion" / "also casts on adjacent Dragons" / "also cast on your left-most minion". */
function recAlsoCast(s: string): Rec | null {
  const m = /^(?:It |They |Spells and Rubies cast on this |Rubies played on your left-most minion |Spells cast on Shop minions )?also casts?(?: (twice|\d+ times))? on /.exec(s);
  if (!m) return null;
  const tp = targetPhrase(s.slice(m[0].length));
  if (!tp) return null;
  return { effect: { kind: 'also-cast', verb: 'cast', target: tp.target, ...(m[1] ? { amount: { value: capNum(m[1]), unit: 'casts' } } : {}) }, len: m[0].length + tp.len };
}

/** "trigger your left-most Echo (twice)" / "Trigger adjacent minions' Battlecries" / "trigger its Shout" /
 *  "trigger all your Rally effects" / "also trigger their Echo at Start of Combat" — effects that fire
 *  ANOTHER object's trigger. */
function recTriggerOther(s: string): Rec | null {
  const m = /^(?:also )?[Tt]riggers?\s+(?:a friendly minion's|an adjacent minion's|both adjacent minions'|this minion['’]s|a|an|your|all your|all of your|both|all|its|their|the)?\s*(?:(\d+|two|three) )?(?:adjacent |both adjacent |an adjacent |your Dragon |Dragon |left-most |right-most |adjacent minions['’]? |friendly )?(Shouts?|Echo(?:es)?|Deathrattles?|Battlecr(?:y|ies)|Rally effects?|Rall(?:y|ies)|Start of Combat|End of Turn effects?|effects?)\b(?: and (?:Rally|Shout|Echo))?(?:\s+\(Deathrattle\))?(?:\s+(?:minion's|minions['’]?)\s+\w+)?(?:\s+(?:twice|\d+ times|again))?(?:\s+each)?(?:\s+at (?:Start of Combat|the start of your next shop))?(?: to reset this)?/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'trigger-other', verb: 'trigger', refName: m[2]!, ...(m[1] ? { summonCount: countOf(m[1]) } : {}) }, len: m[0].length };
}

/** "trigger it" / "trigger its effect" / "trigger its Shout before being sold" — pronoun forms. */
function recTriggerPronoun(s: string): Rec | null {
  const m = /^[Tt]riggers?\s+(?:it|its effect|its (?:Shout|Echo))\b(?: (?:twice|again))?(?: at the start of your next shop| before being sold)?/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'trigger-other', verb: 'trigger', refName: 'it' }, len: m[0].length };
}

function recAttackNow(s: string): Rec | null {
  const m = /^(?:[Ii]t |[Tt]his minion |[Yy]ou )?attacks?(?:\s+(?:(?:twice|\d+ times) )?(?:immediately|first)\b(?: at the start of next combat| after the enemy's first attack| next fight| when summoned)?(?: and gains? Ward)?|(?=[.,;]|$))/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'attack-immediately', ...(/gains? Ward/.test(m[0]) ? { keywords: ['DS'] } : {}) }, len: m[0].length };
}

/** "give this minion's Attack to 2 other friendly minions" / "give <target> this minion's Health" / "gains its
 *  stats" / "gain the stats of the highest-Health minion in your hand" / "give your other minions 50% of this
 *  minion's stats" / "gives half its stats to <target>" / "give its stats to <target>" — stat transfers. */
function recStatTransfer(s: string): Rec | null {
  const SRC = "(?:(?:double |twice |half |\\d+% of )?(?:this minion['’]s|its|their|the same|the(?! (?:Attack|Health|stats) of)|your left-most Demon['’]s|the right-most Shop minion['’]s|the left-most minion card in your hand's) (?:Attack|Health|stats)|(?:(?:double|twice|half|\\d+% of) )?(?:the )?(?:stats|Attack|Health) of (?:this minion|the [\\w' -]+? in your hand|your strongest Dragon['’]s stats|[^.,;]+?)(?=[.,;]| to | this combat| for that combat|$)|stats equal to \\d+% of your strongest Dragon['’]s stats|stats equal to its Ruby bonuses|the stats of the left-most minion card in your hand|Health equal to half its Attack)";
  // give <src> to <target>
  let m = new RegExp(`^(?:[Gg]ives?|[Gg]rant) ${SRC} to `).exec(s);
  if (m) {
    const tp = targetPhrase(s.slice(m[0].length));
    if (tp) return { effect: { kind: 'stat-transfer', verb: 'give', target: tp.target, refName: m[0].replace(/^(?:[Gg]ives?|[Gg]rant) /, '').replace(/ to $/, '') }, len: m[0].length + tp.len };
  }
  // give <target> <src>
  m = /^(?:[Gg]ives?|[Gg]rants?) /.exec(s);
  if (m) {
    const tp = targetPhrase(s.slice(m[0].length));
    if (tp) {
      const src = new RegExp(`^ ${SRC}`).exec(s.slice(m[0].length + tp.len));
      if (src) return { effect: { kind: 'stat-transfer', verb: 'give', target: tp.target, refName: src[0].trim() }, len: m[0].length + tp.len + src[0].length };
    }
  }
  // gain(s) <src>
  m = new RegExp(`^(?:[Gg]ains?|[Gg]ets?) ${SRC}`).exec(s);
  if (m) return { effect: { kind: 'stat-transfer', verb: 'gain', target: SELF, refName: m[0].replace(/^(?:[Gg]ains?|[Gg]ets?) /, '') }, len: m[0].length };
  // spit its stats onto <target> / split its Ruby bonus stats among <target>
  m = /^(?:spit its stats onto|split its Ruby bonus stats among|give its stats to) /.exec(s);
  if (m) {
    const tp = targetPhrase(s.slice(m[0].length));
    if (tp) return { effect: { kind: 'stat-transfer', verb: 'give', target: tp.target, refName: 'its stats' }, len: m[0].length + tp.len };
  }
  return null;
}

/** "double its stats" / "triple its Health" / "double the stats of 3 random minions" / "double your right-most
 *  minion's stats" / "gain double their Health when summoned in combat". */
function recStatMultiply(s: string): Rec | null {
  const x = /^(?:[Gg]ains? )?(\d)× stats(?: from all sources)?/.exec(s);
  if (x) return { effect: { kind: 'stat-multiply', verb: 'gain', amount: { value: Number(x[1]), unit: 'factor' }, target: SELF, refName: 'stats' }, len: x[0].length };
  const m = /^(?:gains? )?(double|triple) (?:(its|their|this minion['’]s|your right-most minion['’]s) (stats|Attack|Health)|the (stats|Attack|Health) of )/.exec(s);
  if (!m) return null;
  const factor = m[1] === 'double' ? 2 : 3;
  let len = m[0].length;
  let target: ParsedTarget = /right-most/.test(m[0]) ? { cardinality: 'exactly', count: 1, scope: 'your-right-most-minion', friendly: true } : SELF;
  if (m[4]) {
    const tp = targetPhrase(s.slice(len));
    if (!tp) return null;
    target = tp.target; len += tp.len;
  }
  return { effect: { kind: 'stat-multiply', verb: m[1], amount: { value: factor, unit: 'factor' }, target, refName: m[3] ?? m[4] }, len };
}

/** "Set a minion's stats to 20/20" / "set its stats to 7/7" / "set a random enemy's Health to 1" / "Set the first enemy
 *  minion summoned next combat to 1/1" / "Set your Armor to 5". */
function recSetStats(s: string): Rec | null {
  let m = /^[Ss]et (?:its|their|your) (stats|Health|Attack|Armor) to (\d+)(?:\/(\d+))?/.exec(s);
  if (m) return { effect: { kind: 'set-stats', verb: 'set', refName: m[1], target: SELF, amount: m[3] ? { attack: Number(m[2]), health: Number(m[3]) } : { value: Number(m[2]), unit: m[1]!.toLowerCase() } }, len: m[0].length };
  m = /^[Ss]et /.exec(s);
  if (m) {
    const tp = targetPhrase(s.slice(m[0].length));
    if (tp) {
      const to = /^ to (\d+)(?:\/(\d+))?/.exec(s.slice(m[0].length + tp.len));
      const stat = /['’]s (stats|Health|Attack)$/.exec(s.slice(m[0].length, m[0].length + tp.len));
      if (to) return { effect: { kind: 'set-stats', verb: 'set', target: tp.target, refName: stat?.[1] ?? 'stats', amount: to[2] ? { attack: Number(to[1]), health: Number(to[2]) } : { value: Number(to[1]), unit: (stat?.[1] ?? 'stats').toLowerCase() } }, len: m[0].length + tp.len + to[0].length };
    }
  }
  return null;
}

/** "It Consumes a minion in the Shop" / "adjacent minions each Consume a Fodder" / "Consume the right-most minion in
 *  the Shop" / "a Demon consumes the 2 right-most minions in the Shop" / "Devour a friendly minion". */
function recConsume(s: string): Rec | null {
  let pos = 0;
  let subject: ParsedTarget | undefined;
  const sp = targetPhrase(s);
  if (sp && /^ (?:each )?[Cc]onsumes? /.test(s.slice(sp.len))) { subject = sp.target; pos = sp.len + 1; }
  const m = /^(?:each )?(?:[Cc]onsumes?|[Dd]evours?) /.exec(s.slice(pos));
  if (!m) return null;
  pos += m[0].length;
  const tp = targetPhrase(s.slice(pos));
  if (!tp) return null;
  pos += tp.len;
  return { effect: { kind: 'consume', verb: 'consume', target: tp.target, summonCount: tp.target.count ?? 1, ...(subject ? { subject } : {}) }, len: pos };
}

/** Recognized game actions over a target. Each verb names the shape it accepts; a verb with an unknown
 *  argument shape is not consumed. */
function recAction(s: string): Rec | null {
  const withTarget = (verb: string, action: string, tails: RegExp | null = null): Rec | null => {
    const m = new RegExp(`^${verb} `).exec(s);
    if (!m) return null;
    const tp = targetPhrase(s.slice(m[0].length));
    if (!tp) return null;
    let len = m[0].length + tp.len;
    if (tails) { const t = tails.exec(s.slice(len)); if (t) len += t[0].length; }
    return { effect: { kind: 'action', action, verb: verb.toLowerCase(), target: tp.target }, len };
  };
  return withTarget('[Ss]teal', 'steal', /^ from the (?:Shop|tavern)/)
    ?? (() => { const m = /^Swap a minion['’]s Attack and Health/.exec(s); return m ? { effect: { kind: 'action' as const, action: 'swap-stats', verb: 'swap', target: { cardinality: 'exactly' as const, count: 1, scope: 'minion' } }, len: m[0].length } : null; })()
    ?? withTarget('[Ss]wap', 'swap', /^ with (?:a random minion in the (?:Shop|tavern))/)
    ?? withTarget('[Dd]estroy', 'destroy', /^(?: \(procs its Deathrattle\)| to(?= Discover))/)
    ?? withTarget('[Tt]ake', 'steal')
    ?? withTarget('[Rr]emove', 'remove')
    ?? withTarget('[Ss]ell', 'sell')
    ?? withTarget('[Tt]ransform', 'transform', /^ into (?:random Tier \d+ minions|a random minion(?: of the same tier| one Tier higher)?|random minions one Tier higher)/)
    ?? withTarget('[Uu]pgrade', 'transform', /^ to a random minion one tier higher/)
    ?? withTarget('[Rr]eturn', 'return-to-hand', /^ to your hand/)
    ?? withTarget('[Gg]ild', 'gild')
    ?? (() => { const m = /^[Mm]ake /.exec(s); if (!m) return null; const tp = targetPhrase(s.slice(m[0].length)); if (!tp) return null; const g = /^ (?:Golden|golden|Gilded)/.exec(s.slice(m[0].length + tp.len)); return g ? { effect: { kind: 'action' as const, action: 'gild', verb: 'make', target: tp.target }, len: m[0].length + tp.len + g[0].length } : null; })()
    ?? withTarget('[Mm]agnetize onto', 'magnetize')
    ?? (() => { const m = /^(?:[Mm]agnetize|attach|Attach|also attaches) /.exec(s); if (!m) return null; const tp = targetPhrase(s.slice(m[0].length)); if (!tp) return null; const onto = /^ (?:onto|to) /.exec(s.slice(m[0].length + tp.len)); if (!onto) return null; const tp2 = targetPhrase(s.slice(m[0].length + tp.len + onto[0].length)); if (!tp2) return null; return { effect: { kind: 'action' as const, action: 'magnetize', verb: 'magnetize', target: tp2.target, subject: tp.target, summonCount: tp.target.count ?? 1 }, len: m[0].length + tp.len + onto[0].length + tp2.len }; })()
    ?? withTarget('[Mm]ark', 'mark')
    ?? withTarget('[Aa]rchive', 'archive')
    ?? withTarget('[Ss]cout', 'scout')
    ?? withTarget('[Kk]eep', 'keep', /^ through refreshes/)
    ?? withTarget('[Tt]each', 'teach', /^ to a Mage-Pup/)
    ?? (() => { const m = /^Remove ([A-Z][\w ]*?(?: and [A-Z]\w*)?) from the target(?: before striking)?/.exec(s); if (!m) return null; const run = keywordRun(m[1]!); return run ? { effect: { kind: 'action' as const, action: 'remove-keyword', verb: 'remove', keywords: run.letters, target: { cardinality: 'exactly' as const, count: 1, scope: 'target' } }, len: m[0].length } : null; })()
    ?? (() => { const m = /^[Vv]isit (?:an additional |the )?(?:Epic )?(?:Forge|Runeforge)(?: on turn \d+| next turn instead of turn \d+)?/.exec(s); return m ? { effect: { kind: 'action' as const, action: 'visit-forge', verb: 'visit' }, len: m[0].length } : null; })()
    ?? (() => { const m = /^Invest (\d+) Gold/.exec(s); return m ? { effect: { kind: 'action' as const, action: 'invest', verb: 'invest', amount: { value: Number(m[1]), unit: 'gold' } }, len: m[0].length } : null; })()
    ?? (() => { const m = /^Roll a die/.exec(s); return m ? { effect: { kind: 'action' as const, action: 'roll', verb: 'roll' }, len: m[0].length } : null; })()
    ?? (() => { const m = /^Remember the first Shop spell you cast each turn/.exec(s); return m ? { effect: { kind: 'action' as const, action: 'remember', verb: 'remember' }, len: m[0].length } : null; })()
    ?? (() => { const m = /^(?:then )?reset\b/.exec(s); return m ? { effect: { kind: 'action' as const, action: 'reset', verb: 'reset' }, len: m[0].length } : null; })()
    ?? (() => { const m = /^transforms? into a copy of it\b/.exec(s); return m ? { effect: { kind: 'action' as const, action: 'transform', verb: 'transform', target: SELF }, len: m[0].length } : null; })();
}

/** "Choose a friendly minion." / "Target a Demon." / "choose one of two Passages" / "Choose a commission". */
function recChoose(s: string): Rec | null {
  const m = /^(?:[Cc]hoose|[Tt]arget) /.exec(s);
  if (!m) return null;
  const special = /^(?:one of two (?:Passages|Errands)|a commission)/.exec(s.slice(m[0].length));
  if (special) return { effect: { kind: 'choose-target', verb: m[0].trim().toLowerCase(), refName: special[0] }, len: m[0].length + special[0].length };
  const tp = targetPhrase(s.slice(m[0].length));
  if (!tp) return null;
  return { effect: { kind: 'choose-target', verb: m[0].trim().toLowerCase(), target: tp.target }, len: m[0].length + tp.len };
}

/** Cost / sell-value sentences: "Shop spells cost 1 less this turn" / "Sells for 2 Gold" / "Costs 11 Gold, reduced by 1
 *  each turn" / "Reduce the cost of upgrading the Shop by 5" / "each use costs 1 more Gold" / "The first is free". */
function recCost(s: string): Rec | null {
  let m = /^(?:(?:[Ss]ells?|sell) for|[Cc]osts?) (\d+)(g| Gold| less| more| additional Gold)?(?:, plus (\d+)g for every ([^.,]+))?(?:, reduced by (\d+) (?:each turn|when [^.,]+))?(?: — reduced by (\d+) when [^.,]+)?/.exec(s);
  if (m) {
    const eff: Omit<ParsedEffect, 'span'> = { kind: 'cost-mod', verb: /sell/i.test(m[0]) ? 'sells-for' : 'costs', amount: { value: Number(m[1]), unit: (m[2] ?? ' Gold').trim().replace(/^g$/, 'Gold').toLowerCase() } };
    if (m[3]) eff.scaler = { per: m[4]!, amount: { value: Number(m[3]), unit: 'gold' }, span: { start: 0, end: 0, text: '' } };
    return { effect: eff, len: m[0].length };
  }
  m = /^[Rr]educe (?:the cost of upgrading the Shop|your Shop['’]s upgrade cost|its cost) by (\d+)/.exec(s);
  if (m) return { effect: { kind: 'cost-mod', verb: 'reduce', amount: { value: Number(m[1]), unit: 'less' }, refName: /upgrad/.test(m[0]) ? 'upgrade' : 'it' }, len: m[0].length };
  m = /^(?:each use costs (\d+) more Gold|The first is free|(?:are|is) free)/.exec(s);
  if (m) return { effect: { kind: 'cost-mod', verb: 'costs', amount: m[1] ? { value: Number(m[1]), unit: 'more' } : { value: 0, unit: 'gold' } }, len: m[0].length };
  return null;
}

/** "Improves +3/+3 every 3 Beasts summoned" / "Improve this by +1/+1 every 5 times" / "This improves by +1/+1 each time it
 *  triggers" / "Every Conductor played improves this by +2/+3" / "then increase that by 1" / "Improves every 8 attacks"
 *  / "improving by +1/+1 per 4 Shop spells cast with this on board" / "Improve this permanently". */
function recImprove(s: string): Rec | null {
  const m = /^(?:(?:This |this |it )?[Ii]mproves?(?: this)?(?: by)?|[Ii]mproving by|Every ([A-Z][\w ]*?) played improves this by|(?:then )?increase that by|Upgrades|Recharges|[Ii]mproves? future ([A-Z]\w+) by)\s*(?:(\+\d+\/\+\d+|\+\d+ (?:Attack|Health)|\+\d+|\d+)(?: (?:or \+\d+ (?:Attack|Health)))?)?\s*(?:\(random\))?\s*(?:permanently)?\s*(?:(?:every|each|after every|per|for each|for every|whenever|after) ([^.,;()]+?))?(?=\s*(?:[.,;(]|$| \(twice as much\)| and))/.exec(s);
  if (!m || m[0].trim().length < 7) return null;
  if (/^(?:Improve|improve) (?:your|a|an|\d|two|three)/.test(s)) return null; // "Improve your Imps by …" is a stat-buff
  let amount: ParsedAmount | undefined;
  if (m[3]) {
    const st = statToken(m[3]);
    amount = st ? { attack: st.attack, health: st.health } : { value: Number(m[3].replace('+', '')), unit: 'step' };
  }
  let cadence: ParsedCadence | undefined;
  if (m[4]) {
    const n = /^(\d+)\s+/.exec(m[4]);
    cadence = { ...(n ? { every: Number(n[1]) } : {}), of: m[4].replace(/^\d+\s+/, '').trim() };
  } else if (m[1]) cadence = { every: 1, of: `${m[1]} played` };
  else if (/increase that/.test(m[0])) cadence = { every: 1, of: 'each trigger' };
  let len = m[0].length;
  const tail = /^ \(twice as much\)/.exec(s.slice(len));
  if (tail) len += tail[0].length;
  return { effect: { kind: 'improvement', verb: /Upgrades/.test(m[0]) ? 'upgrades' : /Recharges/.test(m[0]) ? 'recharges' : 'improve', ...(amount ? { amount } : {}), ...(cadence ? { cadence } : {}), ...(m[2] ? { refName: `future ${m[2]}` } : {}) }, len };
}

/** "Repeat every Start of Turn" / "Repeat at Start of Turn" / "Repeats every 3 turns" / "Repeat for every Dragon you
 *  control" / "End of Turn: repeat this" / "recast for every Demon you control". */
function recRepeat(s: string): Rec | null {
  const m = /^(?:[Rr]epeats?|recast)(?: this)?(?: (?:every|at) (Start of Turn|end of turn|(\d+) turns)| for (?:every|each) ([^.,;]+))?(?=[.,;]|$)/.exec(s);
  if (!m || m[0].length < 6) return null;
  const eff: Omit<ParsedEffect, 'span'> = { kind: 'repeat', verb: 'repeat' };
  if (m[1]) eff.cadence = { ...(m[2] ? { every: Number(m[2]) } : {}), of: m[1].replace(/^\d+ /, '') };
  if (m[3]) eff.scaler = { per: m[3], span: { start: 0, end: 0, text: '' } };
  return { effect: eff, len: m[0].length };
}

/** "A 1/1 Beast token." / "A 3/2 Dragon that attacks immediately when summoned." / "A 0/2 Beast with Taunt." */
function recTokenBody(s: string): Rec | null {
  const m = /^A (?:(\d+)\/(\d+))?(?: ?([A-Z]\w+(?: [A-Z]\w+)?))?(?: token)?(?: with |(?= that attacks immediately when summoned)|(?=[.]|$))/.exec(s);
  if (!m || (!m[1] && !/ that attacks immediately when summoned| token/.test(s))) return null;
  let len = m[0].length;
  const charge = /^ that attacks immediately when summoned/.exec(s.slice(len));
  if (charge) len += charge[0].length;
  let keywords: string[] | undefined;
  if (/ with $/.test(m[0])) {
    const run = keywordRun(s.slice(len));
    if (!run) return null;
    keywords = run.letters; len += run.len;
  }
  return { effect: { kind: 'token-body', ...(m[1] ? { amount: { attack: Number(m[1]), health: Number(m[2]) } } : {}), ...(m[3] ? { refName: m[3] } : {}), ...(keywords ? { keywords } : {}), ...(charge ? { action: 'attacks-immediately' } : {}) }, len };
}

/** "Your Gemheart Golems gain Echo: …" / "Your Dragons with Shout gain "Echo: …" / "gains Rally: …" — an ability grant;
 *  the granted body is parsed on by the loop. */
function recGrantAbility(s: string): Rec | null {
  const its = /^gains? its Echo\b(?: twice)?/.exec(s);
  if (its) return { effect: { kind: 'grant-ability', verb: 'gain', refName: 'its Echo' }, len: its[0].length };
  const v = /^(?:gains?|gives?) /.exec(s);
  let pos = v?.[0].length ?? 0;
  let target: ParsedTarget | undefined;
  if (v && /^gives?/.test(v[0])) {
    const tp = targetPhrase(s.slice(pos));
    if (!tp) return null;
    target = tp.target; pos += tp.len + 1;
  }
  const m = /^["“]?(Echo|Rally|Shout|Start of Combat|Deathrattle|Battlecry)\s*[:：]\s*/.exec(s.slice(pos));
  if (!m || (!v && !/^["“]/.test(s))) return null;
  return { effect: { kind: 'grant-ability', verb: v ? v[0].trim() : 'gain', refName: m[1], ...(target ? { target } : {}) }, len: pos + m[0].length };
}

/** "Your Start of Combat effects also trigger at End of Turn" — a whole-family re-trigger. */
function recAlsoTriggerAt(s: string): Rec | null {
  const m = /^Your (Start of Combat|End of Turn|Rally|Echo|Shout) effects also trigger at (End of Turn|Start of Combat)/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'trigger-other', verb: 'trigger', refName: m[1], action: `at-${m[2]!.toLowerCase().replace(/\s+/g, '-')}` }, len: m[0].length };
}

/** "gains both effects" / "gain both Choose One effects" / "give both effects" / "gain both —". */
function recChooseBoth(s: string): Rec | null {
  const m = /^(?:gains?|give) both(?: (?:Choose One )?effects| —)?/.exec(s);
  if (!m) return null;
  return { effect: { kind: 'choose-both', verb: 'gain' }, len: m[0].length };
}

/** Whole-sentence rules notes that carry no magnitude. Tight list; anything else stays unresolved. */
const NOTES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Needs a free board slot$/, 'room-required'],
  [/^Progress carries between turns$/, 'progress-carries'],
  [/^Dwarven Ales do not count$/, 'excludes-ales'],
  [/^This triggers first$/, 'triggers-first'],
  [/^You cannot play it until next turn$/, 'locked-until-next-turn'],
  [/^It is locked until you spend \d+ Gold$/, 'locked-until-spend'],
  [/^Each unlocks when you reach its Shop tier$/, 'locked-until-tier'],
  [/^It replaces your current one$/, 'replaces'],
  [/^It keeps its bonus stats$/, 'keeps-bonus-stats'],
  [/^Next turn it is yours to keep$/, 'keep-next-turn'],
  [/^Henchman$/, 'henchman'],
  [/^Y?ou (?:need only|only need) 2 copies(?: of cards)? to Gild(?: them)?$/, 'gild-at-2'],
  [/^Magnetic — welds onto a Mech, which then grants the buff \(stacks\)$/, 'magnetic-weld'],
  [/^This power then locks for that many turns$/, 'locks-for-roll'],
  [/^(?:Cast \d+ Shop spells|Grant stats \d+ times in combat) to ascend$/, 'ascend-condition'],
];
function recNote(s: string): Rec | null {
  const body = s.replace(/[.\s]+$/, '');
  for (const [re, action] of NOTES) if (re.test(body)) return { effect: { kind: 'note', action }, len: s.length };
  return null;
}

/** Whole-sentence limits: "Once per combat." / "3 times per combat." / "Usable twice per turn." / "(Twice per combat)". */
function recLimitSentence(s: string): Rec | null {
  const m = /^\(?(?:Usable )?(Once|Twice|once|twice|\d+ times|\d+ uses)(?: per (turn|combat|game|run))?\)?\.?$/.exec(s.trim());
  if (!m) return null;
  return { effect: { kind: 'note', action: 'limit', amount: { value: /^once$/i.test(m[1]!) ? 1 : /^twice$/i.test(m[1]!) ? 2 : Number(/\d+/.exec(m[1]!)![0]), unit: m[2] ? `per-${m[2]}` : 'total' } }, len: s.length };
}

/** Subject-first dispatch: a target phrase as SUBJECT, then a third-person verb the recognizers accept. */
function recSubjectFirst(s: string, ctx: Ctx): Rec | null {
  // "The first Shop spell you cast each turn …" / "Your first Rally each combat …" — the first-per-window subject.
  let subject: ParsedTarget | null = null;
  let len = 0;
  const first = /^(?:The|Your|the|your) (first|next)(?: (\d+))? (.+?)(?: (each (?:turn|combat)|every turn|this turn|next combat|in combat))?(?=(?<!\byou|\bthat|\bspell|\bRuby|\bAle) (?:also |permanently |all |each )?(?:gives?|casts?|triggers?|returns?|gains?|refills|splits|fills|contains?|are|come|summons?|sells?|costs?|attacks?|gets?|has|have|improves?|transforms?|attaches|bounce|[Cc]onsumes?)\b)/.exec(s);
  if (first) {
    subject = { cardinality: 'exactly', count: first[2] ? Number(first[2]) : 1, scope: `${first[1]}-${first[3]!.toLowerCase().replace(/\s+/g, '-')}` };
    len = first[0].length;
  } else {
    const tp = targetPhrase(s);
    if (!tp) return null;
    if (!/^ (?:also |permanently |all |each )?(?:gives?|casts?|triggers?|returns?|gains?|refills|splits|fills|contains?|are|come|summons?|sells?|costs?|attacks?|gets?|has|have|improves?|transforms?|attaches|bounce|[Cc]onsumes?)\b/.test(s.slice(tp.len))) return null;
    subject = tp.target;
    len = tp.len;
  }
  const rest = s.slice(len).replace(/^ /, '');
  const gap = s.slice(len).length - rest.length;
  const adverb = /^(?:also|permanently|each) /.exec(rest);
  const body = adverb ? rest.slice(adverb[0].length) : rest;
  for (const rec of BODY_RECOGNIZERS) {
    const hit = rec(body, ctx);
    if (hit) {
      const eff = { ...hit.effect, subject };
      // A subject-first grant with no object, or a self-scoped one ('gains +1 Attack'), lands on the subject.
      if ((eff.kind === 'stat-buff' || eff.kind === 'grant-keyword' || eff.kind === 'stat-transfer' || eff.kind === 'stat-multiply' || eff.kind === 'attack-immediately' || eff.kind === 'cost-mod')
        && (!eff.target || eff.target.scope === 'self')) eff.target = subject;
      return { effect: eff, len: len + gap + (adverb?.[0].length ?? 0) + hit.len };
    }
  }
  return null;
}

/** Order matters: copy outranks get-card ("get a copy of …"); stat-transfer before stat-buff ("give this minion's
 *  Attack to …" would otherwise fail the stat token); grant-keyword after stat-buff (both start with give/gain —
 *  stat wins only when a stat token follows); multiplier-print before trigger-other; cast-ruby before cast. */
const BODY_RECOGNIZERS: ReadonlyArray<(s: string, ctx: Ctx) => Rec | null> = [
  recKeywordLine, recEngraved, recAllTypes, recImprove, recStatTransfer, recStatMultiply, recStatBuff, recGrantAbility, recGrantKeyword,
  recChooseBoth, recCopy, recSummon, recRefreshGain, recGold, recDiscover, recAlsoTriggerAt, recMultiplierPrint, recAlsoCast,
  recTriggerOther, recTriggerPronoun, recAttackNow, recGetCard, recCastRuby, recCast, recDamage, recSetStats, recConsume, recAction,
  recChoose, recRefresh, recCost, recRepeat, recTokenBody, recEquipCharge, recNote, recLimitSentence, recElidedStat, recElidedKeyword, recElidedTarget,
  recElidedTrigger,
];
const RECOGNIZERS: ReadonlyArray<(s: string, ctx: Ctx) => Rec | null> = [...BODY_RECOGNIZERS, recSubjectFirst];

// ── sentence-level modifiers (recorded from anywhere in the sentence; never block consumption) ───────────

const PERSISTENCE_TABLE: ReadonlyArray<readonly [RegExp, ParsedPersistence['kind']]> = [
  [/\bpermanently\b|\bpermanent\b/, 'permanent'],
  [/\bthis turn\b/, 'this-turn'],
  [/\bnext turn\b/, 'next-turn'],
  [/\b(?:for the )?next combat(?: only)?\b/, 'next-combat'],
  [/\bthis combat\b|\bin combat\b|\bfor the rest of combat\b|\bfor that combat\b/, 'this-combat'],
  [/\b(?:for the rest of the|this|the) (?:run|game)\b/, 'run-wide'],
];

function collectModifiers(sentence: string, base: number, stripped: string, out: {
  limits: ParsedLimit[]; persistence: ParsedPersistence[]; randomness: ParsedRandomness[]; phases: ParsedGamePhase[];
}): void {
  for (const [re, kind] of PERSISTENCE_TABLE) {
    const m = re.exec(sentence);
    if (m) out.persistence.push({ kind, display: m[0], span: span(stripped, base + m.index, base + m.index + m[0].length) });
  }
  const lim = /\bup to (\d+)|\((\d+) max\)|\b(?:[Oo]nce|Usable once) per (turn|combat|game|run|shop)\b|\b(\d+|Twice|twice) (?:times |uses )?per (?:combat|turn)\b|\bmax (\d+)\b|\b[Tt]he first (\d+)\b|\bThe next (\d+)\b|\((\d+) times\)|\(Once\)/.exec(sentence);
  if (lim) {
    const n = Number(lim[1] ?? lim[2] ?? (lim[4] ? (/twice/i.test(lim[4]) ? 2 : lim[4]) : undefined) ?? lim[5] ?? lim[6] ?? lim[7] ?? lim[8] ?? (lim[0] === '(Once)' ? 1 : NaN));
    out.limits.push({
      kind: lim[3] ? 'once-per' : lim[4] ? 'times-per' : lim[6] ? 'first-n' : lim[7] ? 'next-n' : lim[1] ? 'up-to-n' : 'max-n',
      ...(Number.isFinite(n) ? { n } : {}),
      ...(lim[3] ? { per: lim[3] as ParsedLimit['per'] } : {}),
      span: span(stripped, base + lim.index, base + lim.index + lim[0].length),
    });
  }
  // "The first Shop spell you cast each turn …" / "Your first 2 Refreshes each turn …" — a first-per-window subject is a
  // trigger limit even when no digit is printed.
  const fpw = /\b(?:The|Your|the|your) (first|next)(?: (\d+))? [^.;]*?\b(?:each (turn|combat)|this (turn)|every (turn)|in (combat)|next (combat))\b/.exec(sentence);
  if (fpw && !lim) {
    out.limits.push({
      kind: fpw[1] === 'next' ? 'next-n' : 'first-n', n: fpw[2] ? Number(fpw[2]) : 1,
      per: (fpw[3] ?? fpw[4] ?? fpw[5] ?? fpw[6] ?? fpw[7]) as ParsedLimit['per'],
      span: span(stripped, base + fpw.index, base + fpw.index + fpw[0].length),
    });
  }
  const rnd = /\brandom(?:ly)?\b/i.exec(sentence);
  if (rnd) out.randomness.push({ kind: 'random', span: span(stripped, base + rnd.index, base + rnd.index + rnd[0].length) });
  const choice = /\b(?:Discover|Choose)\b/.exec(sentence);
  if (choice) out.randomness.push({ kind: 'player-choice', span: span(stripped, base + choice.index, base + choice.index + choice[0].length) });
  if (/\bIn combat\b|\bin combat\b|\(shop or combat\)/.test(sentence)) out.phases.push(/\(shop or combat\)/.test(sentence) ? 'both' : 'combat');
  if (/\bin the Shop\b/.test(sentence)) out.phases.push('shop');
}

/** Tails a recognized effect may carry. Each is consumed AND listed in `consumedModifiers`. */
const EFFECT_TAIL = new RegExp('^\\s*(?:,\\s*)?(?:'
  + 'permanently|this turn|next turn|this run|this game|for the rest of the (?:run|game)|for the rest of combat|for the next combat|for that combat|for this turn'
  + '|next combat only|\\(next combat only\\)|next combat|this combat|next fight|next shop|in combat|during combat|in the shop|even in the shop|in the far right position'
  + '|to your hand|from your hand|\\(\\d+ max\\)|\\(max \\d+\\)|\\(\\d+ times\\)|\\(Once\\)|\\((?:Once|Twice|\\d+ times|\\d+ uses) per (?:turn|combat)\\)|— up to \\d+ \\w+ a combat'
  + '|twice|three times|\\d+ times|each|too|immediately|instead|as Rubies|before this attacks|before striking|before being sold|after you play them|next to it'
  + '|when summoned in combat|when summoned|when there is room|when you have room|when you first have room|at End of Turn|at Start of Combat|at the start of your next shop|at the start of next combat'
  + '|for the next \\d+ turns|every turn|each turn|per turn|\\(shop or combat\\)|\\(random\\)|\\(as room allows\\)|\\(Deathrattle\\)|\\(up to Tier \\d+\\)|\\(up to your tavern tier\\)'
  + '|\\(at least \\+\\d+\\/\\+\\d+\\)|\\(\\+\\d+\\/\\+\\d+ during combat\\)|\\(can\'t die from that attack\\)|\\(costs \\d+\\)|\\(twice as much\\)|— even in the shop —|with (?:Taunt|Ward)(?: and (?:Taunt|Ward))?'
  + '|only in combat|if it is a (?:Kobold|Dragon)|if none are alive|if you play it this turn|with this on board|while Pack Leader is on the board|while attacking|and it attacks first|plus (?:double )?this minion\'s Rubies'
  + '|\\(procs its Deathrattle\\)|\\(takes no damage back\\)|on your board|that has learned it|from the Shop|from the tavern|of that Tier|of the same Tier|in the Shop|on this|onto this|to them|on them'
  + ')(?=[\\s.,;)]|$)');

/** Scalers: "for each Spirit you played this turn" / "for every 3 Gold you have spent this run" / "per Gold spent this
 *  turn" / "plus +1/+1 for each Dragon you played this turn" / "equal to your Imp Aura" / "plus your Reveler bonus". */
const SCALER_RE = /^\s*(?:,\s*)?(?:(?:plus|and) (\+\d+\/\+\d+|\+\d+ (?:Attack|Health)|\d+) )?(?:(for each|for every|per) (?:(\d+) )?([^.,;()]+?)|equal to ((?:double |twice )?(?:your \w+ Aura|the Fodder consumed this turn))|(?:plus (twice )?your Reveler bonus))(?=\s*(?:[.,;(]|$| \(at least| this combat| next turn))/;

// ── the parser ───────────────────────────────────────────────────────────────────────────────────────────

/** Split into sentences, tracking offsets into the stripped text. Leading whitespace is trimmed (the first
 *  parser's mid-text "Taunt. Echo: …" gap — every prefix after the first sentence failed on the space). */
function sentences(stripped: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  const re = /[^.!;]+[.!;]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const lead = /^\s*/.exec(m[0])![0].length;
    const text = m[0].slice(lead).replace(/\s+$/, '');
    // A stray closing quote after a quoted ability ("…Shout." ") is punctuation, not a sentence.
    if (text.length && !/^["”]+\.?$/.test(text)) out.push({ text, start: m.index + lead });
  }
  return out;
}

export function parseObjectText(rawText: string | undefined): ParsedTextContract {
  const stripped = stripMarkers(rawText ?? '').trim();
  const parsed: ParsedTextContract = {
    triggers: [], targets: [], effects: [], amounts: [], limits: [], persistence: [], randomness: [],
    phaseRestrictions: [], unresolvedPhrases: [], keywordLine: [], conditions: [], scalers: [], consumedModifiers: [],
    fullyParsed: true, stripped,
  };
  if (!stripped) return parsed;

  const mods = { limits: parsed.limits, persistence: parsed.persistence, randomness: parsed.randomness, phases: parsed.phaseRestrictions };
  const consume = (start: number, end: number): void => { parsed.consumedModifiers.push(span(stripped, start, end)); };

  for (const sent of sentences(stripped)) {
    let pos = 0;
    const body = sent.text;
    collectModifiers(body, sent.start, stripped, mods);

    // Leading gates: phase gates, aura gates, limits, conditions — any number, in any order.
    for (;;) {
      const gate = /^(?:In combat|While on your board|While this is in your hand|Once per turn|Twice per turn|Once used|For each ([^,]+)|For every (\d+ )?([^,]+)|If ([^,]+)|if ([^,]+)|The first time (?:each turn )?(you [^,]+)),\s*/.exec(body.slice(pos));
      if (!gate) break;
      const g = span(stripped, sent.start + pos, sent.start + pos + gate[0].length);
      if (gate[6] !== undefined) {
        let event = 'conditional:unknown';
        for (const [re, ev] of CONDITIONAL_LEXICON) if (re.test(gate[6])) { event = ev; break; }
        parsed.triggers.push({ event, display: 'The first time', span: g });
        parsed.limits.push({ kind: 'first-n', n: 1, per: 'turn', span: g });
        if (event === 'conditional:unknown') parsed.unresolvedPhrases.push(g);
      } else if (gate[4] !== undefined || gate[5] !== undefined) parsed.conditions.push(g);
      else if (gate[1] !== undefined || gate[3] !== undefined) {
        const sc: ParsedScaler = { per: (gate[1] ?? gate[3])!.trim(), ...(gate[2] ? { every: Number(gate[2]) } : {}), span: g };
        parsed.scalers.push(sc);
      } else if (/^While/.test(gate[0])) parsed.conditions.push(g);
      else consume(g.start, g.end);
      pos += gate[0].length;
    }

    // One leading trigger prefix (two when an Equip opens a Choose One window).
    let matchedTrigger = false;
    for (let pass = 0; pass < 2; pass += 1) for (const t of TRIGGER_LEXICON) {
      const m = t.re.exec(body.slice(pos));
      if (!m) continue;
      const events = t.event.split('+');
      for (const ev of events) {
        parsed.triggers.push({
          event: ev, display: t.display,
          ...(m[1] !== undefined ? { threshold: Number(m[1]) } : {}),
          span: span(stripped, sent.start + pos, sent.start + pos + m[0].length),
        });
      }
      pos += m[0].length + (/^\s*/.exec(body.slice(pos + m[0].length))?.[0].length ?? 0);
      matchedTrigger = true;
      break;
    }
    // A cadence prefix ("Every 5 Gold spent, …").
    if (!matchedTrigger) {
      const cad = CADENCE_PREFIX_RE.exec(body.slice(pos));
      if (cad) {
        let event = 'conditional:unknown';
        for (const [re, ev] of CADENCE_LEXICON) if (re.test(cad[2]!.trim())) { event = ev; break; }
        const n = cad[1] === 'third' ? 3 : cad[1] === '5th' ? 5 : cad[1] === 'other' ? 2 : Number(cad[1]);
        const trigSpan = span(stripped, sent.start + pos, sent.start + pos + cad[0].length);
        parsed.triggers.push({ event, display: 'Every N', threshold: n, span: trigSpan });
        if (event === 'conditional:unknown') parsed.unresolvedPhrases.push(trigSpan);
        pos += cad[0].length;
        matchedTrigger = true;
      }
    }

    // Or a conditional clause ("When you buy a minion, …").
    if (!matchedTrigger) {
      const cond = /^(When(?:ever)?|After|Each time|Every time|when(?:ever)?|after)\s+([^,]+),\s*/.exec(body.slice(pos));
      if (cond) {
        let event = 'conditional:unknown';
        for (const [re, ev] of CONDITIONAL_LEXICON) {
          if (re.test(cond[2]!)) { event = ev; break; }
        }
        const trigSpan = span(stripped, sent.start + pos, sent.start + pos + cond[0].length);
        parsed.triggers.push({ event, display: cond[1]!, span: trigSpan });
        if (event === 'conditional:unknown') parsed.unresolvedPhrases.push(trigSpan);
        pos += cond[0].length;
      }
    }

    // A trailing conditional ("…, when a friendly minion attacks") is read as a trigger too; handled via tails.
    // Prefix-parse the effect body.
    const ctx: Ctx = { prev: null };
    for (;;) {
      const lead = /^\s*(?:,?\s*(?:and then|and also|and|then|[Aa]lso|or)\s+|[,—;]\s*|\.\s*)*/.exec(body.slice(pos));
      if (lead) pos += lead[0].length;
      if (pos >= body.length || /^[.\s]*$/.test(body.slice(pos))) break;
      // A leading adverb the effect carries ('permanently give the Shop +1/+1') — consumed and listed.
      const adv = /^(?:permanently|also) (?=[a-zA-Z])/.exec(body.slice(pos));
      if (adv) { consume(sent.start + pos, sent.start + pos + adv[0].length); pos += adv[0].length; }
      // An inline condition mid-sentence ("…, if you control a Spirit, …" / "Start of Combat: if …, give …").
      const inl = /^(?:[Ii]f ([^,]+)|when(?:ever)? ([^,]+)),\s*/.exec(body.slice(pos));
      if (inl) {
        const g = span(stripped, sent.start + pos, sent.start + pos + inl[0].length);
        if (inl[1] !== undefined) parsed.conditions.push(g);
        else {
          let event = 'conditional:unknown';
          for (const [re, ev] of CONDITIONAL_LEXICON) if (re.test(inl[2]!)) { event = ev; break; }
          parsed.triggers.push({ event, display: 'when', span: g });
          if (event === 'conditional:unknown') parsed.unresolvedPhrases.push(g);
        }
        pos += inl[0].length;
        continue;
      }
      let hit: Rec | null = null;
      for (const rec of RECOGNIZERS) {
        hit = rec(body.slice(pos), ctx);
        if (hit) break;
      }
      if (!hit) {
        // Everything from here to the sentence end is unread — one honest span, verbatim.
        const restText = body.slice(pos).replace(/\s+$/, '');
        parsed.unresolvedPhrases.push(span(stripped, sent.start + pos, sent.start + pos + restText.length));
        break;
      }
      const eff: ParsedEffect = { ...hit.effect, span: span(stripped, sent.start + pos, sent.start + pos + hit.len) };
      parsed.effects.push(eff);
      ctx.prev = eff;
      if (eff.kind === 'keyword-line' && eff.keywords) parsed.keywordLine.push(...eff.keywords);
      if (eff.amount) parsed.amounts.push(eff.amount);
      if (eff.target) parsed.targets.push(eff.target);
      if (eff.scaler) { eff.scaler.span = eff.span; parsed.scalers.push(eff.scaler); }
      pos += hit.len;
      // Tolerated trailing modifiers already collected sentence-wide; consume the common tails so a
      // recognized effect's known modifier suffix does not read as an unresolved span — and list each.
      for (;;) {
        const sc = SCALER_RE.exec(body.slice(pos));
        if (sc) {
          const scaler: ParsedScaler = {
            per: sc[4] ?? sc[5] ?? 'Reveler bonus',
            ...(sc[3] ? { every: Number(sc[3]) } : {}),
            ...(sc[1] ? { amount: (() => { const st = statToken(sc[1]!); return st ? { attack: st.attack, health: st.health } : { value: Number(sc[1]), unit: 'step' }; })() } : {}),
            span: span(stripped, sent.start + pos, sent.start + pos + sc[0].length),
          };
          if (!eff.scaler) eff.scaler = scaler;
          parsed.scalers.push(scaler);
          pos += sc[0].length;
          continue;
        }
        const tm = EFFECT_TAIL.exec(body.slice(pos));
        if (tm) {
          consume(sent.start + pos, sent.start + pos + tm[0].length);
          pos += tm[0].length;
          continue;
        }
        // A trailing conditional clause ("… when a friendly minion attacks" / "… whenever you play a Dragon").
        const tc = /^\s*(?:,\s*)?(when(?:ever)?|after|every) ([^.,;()]+?)(?=[.,;)]|$)/.exec(body.slice(pos));
        if (!tc) break;
        let event = 'conditional:unknown';
        for (const [re, ev] of CONDITIONAL_LEXICON) if (re.test(tc[2]!)) { event = ev; break; }
        const g = span(stripped, sent.start + pos, sent.start + pos + tc[0].length);
        parsed.triggers.push({ event, display: tc[1]!, span: g });
        if (event === 'conditional:unknown') parsed.unresolvedPhrases.push(g);
        pos += tc[0].length;
      }
    }
  }

  parsed.fullyParsed = parsed.unresolvedPhrases.length === 0;
  return parsed;
}
