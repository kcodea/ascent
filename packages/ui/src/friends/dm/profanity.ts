/**
 * THE MESSAGE FILTER (R-DM-04): masks common swear words and slurs in direct messages, on the READER's side, when the
 * Settings switch "Filter bad words in messages" is on (the default). The stored message is never changed, so turning
 * the switch off shows the original. Pure and cheap: one regex over a message, built once.
 *
 * Matching: whole words, case-insensitive, with common look-alike swaps undone first (0 -> o, 1 / ! -> i, 3 -> e,
 * 4 / @ -> a, 5 / $ -> s, 7 -> t), and letters repeated for emphasis collapsed ("fuuuck"). Each match is replaced by
 * asterisks of the same length, so the sentence keeps its shape. A short list on purpose: it catches the common words
 * without flagging ordinary ones (no substring matching: "class", "Scunthorpe" and "assassin" stay as they are).
 */

/** Word stems; a stem also matches its common endings (s, es, ed, er, ers, ing, in, y). */
const STEMS = [
  'fuck', 'fuk', 'fck', 'motherfuck', 'shit', 'bullshit', 'bitch', 'cunt', 'dick', 'dickhead', 'cock', 'cocksuck', 'prick',
  'pussy', 'asshole', 'arsehole', 'bastard', 'slut', 'whore', 'twat', 'wank', 'wanker', 'jizz', 'cum', 'dildo', 'retard',
  'fag', 'faggot', 'dyke', 'tranny', 'nigger', 'nigga', 'chink', 'spic', 'kike', 'gook', 'wetback', 'coon', 'kys',
];
/** Whole words only (no endings). */
const WORDS = ['ass', 'arse', 'tits', 'stfu', 'gtfo', 'wtf'];

const SWAPS: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't' };

const ENDINGS = '(?:s|es|ed|er|ers|ing|in|y)?';
const PATTERN = new RegExp(`^(?:(?:${STEMS.join('|')})${ENDINGS}|${WORDS.join('|')})$`);

/** A token as the filter compares it: look-alikes swapped, lowercased, repeated letters collapsed. */
function normal(token: string): string {
  let s = '';
  for (const ch of token.toLowerCase()) s += SWAPS[ch] ?? ch;
  return s.replace(/(.)\1+/g, '$1');
}

/** A token as the filter compares it, keeping doubled letters (a stem like "asshole" has them). */
function swapped(token: string): string {
  let s = '';
  for (const ch of token.toLowerCase()) s += SWAPS[ch] ?? ch;
  return s;
}

/** Is this one word a filtered word? */
export function isProfane(word: string): boolean {
  const w = word.replace(/^[^a-z0-9@$!]+|[^a-z0-9@$!]+$/gi, '');
  if (!w) return false;
  // "shit!" is "shit" shouting: a trailing run of ! is punctuation, not a look-alike i.
  return [w, w.replace(/!+$/, '')].some((v) => {
    if (!v) return false;
    const a = swapped(v);
    return PATTERN.test(a) || PATTERN.test(normal(v)) || PATTERN.test(a.replace(/(.)\1{2,}/g, '$1$1'));
  });
}

/** The message with every filtered word masked (`****`). Unchanged when nothing matches. */
export function maskProfanity(text: string): string {
  // Tokens: runs of letters, digits and the look-alike symbols; everything else is kept as it is.
  return text.replace(/[a-z0-9@$!]+/gi, (tok) => (isProfane(tok) ? '*'.repeat(tok.length) : tok));
}
