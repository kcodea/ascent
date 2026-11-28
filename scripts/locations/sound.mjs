// The sequence's sounds (ElevenLabs): only the names given, or whatever is missing. The key is read at run time from .env.secrets and never
// printed; it is a shared account, so report the credits a run uses.
//   node scripts/locations/sound.mjs [name...]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const DIR = process.env.OUT ?? 'apps/web/public/locations/sfx/'; mkdirSync(DIR, { recursive: true });
const key = readFileSync(process.env.SECRETS ?? '.env.secrets', 'utf8').match(/^ELEVENLABS_API_KEY\s*=\s*"?([^"\r\n]+)/m)[1].trim();
const only = process.argv.slice(2);
const CUES = {
  charge: [1.0, 0.45, 'A magical crystal charging with energy: a smooth rising shimmering swell that grows steadily louder and brighter, glassy resonance, fantasy game, no impact at the end, no music'],
  'ride-outskirts': [4.0, 0.3, 'Seamless loop of continuous steady high speed magical wind rush, airy whoosh with bright sparkling glassy shimmer, constant even volume the whole time, no impact, no music'],
  'ride-underbelly': [4.0, 0.3, 'Seamless loop of continuous steady high speed deep arcane wind rush, low airy rumble with soft dark shimmer, constant even volume the whole time, no impact, no music'],
  'ride-scrapyard': [4.0, 0.3, 'Seamless loop of continuous steady high speed wind rush with a warm low furnace roar and soft metallic ember shimmer, constant even volume the whole time, no impact, no music'],
  'ride-terys': [4.0, 0.3, 'Seamless loop of continuous steady high speed magical wind rush, bright regal airy whoosh with warm golden shimmer and soft glassy harmonic resonance, constant even volume the whole time, no impact, no music, no voices'],
  'ride-runebarriers': [4.0, 0.3, 'Seamless loop of continuous steady high speed magical wind rush, deep resonant arcane hum with bright crystalline rune shimmer, constant even volume the whole time, no impact, no music'],
  gather: [1.1, 0.45, 'Hundreds of small glass shards rushing together, reverse suction swell accelerating and rising quickly to a sudden cut off, magical, no impact'],
  impact: [3.0, 0.4, 'Clean deep cinematic boom, soft round sub bass hit with a clear crystal bell ring on top, long smooth reverb tail, undistorted, moderate volume, single hit at the start, no music'],
  wave: [1.6, 0.45, 'A huge wave of magical energy rolling outward, a wide sweeping low whoosh passing over you with wind gust and soft sparkling tail, no impact'],
  weld: [1.3, 0.4, 'Many glass pieces sealing together one after another in a fast soft cascade of tiny crystalline clicks and chimes, delicate, magical'],
  'ambience-outskirts': [6.0, 0.3, 'Seamless loop of peaceful countryside: constant gentle breeze in leaves, distant waterfall, a few birds chirping, clear and present'],
  'ambience-underbelly': [8.0, 0.3, 'Seamless loop of an uneasy crowd commotion in an underground cavern market: constant restless murmuring and muttering, unintelligible tense voices, scuffling feet, chains and crates clattering, dark low rumble, constant even volume the whole time'],
  'ambience-scrapyard': [8.0, 0.35, 'Seamless loop, loud, close and clearly present: a blacksmith forge fire roaring and crackling, big leather bellows breathing, rhythmic hammering on metal a short way off, heavy chains clinking and wooden beams creaking, constant even volume the whole time, no voices, no music'],
  'ambience-runebarriers': [8.0, 0.3, 'Seamless loop of a great magical barrier humming softly: deep warm resonant arcane drone with gentle crackling energy and faint crystal tones, high mountain wind and a distant waterfall, constant even volume the whole time, no music'],
  'ambience-terys': [8.0, 0.3, 'Seamless loop, close and clearly present: a great magical portal humming softly, warm bright resonant hum with gentle shimmering sparkle, a soft breeze in leaves and cloth banners fluttering, distant waterfalls, a few birds, constant even volume the whole time, no voices, no music'],
  'arrive-terys': [3.5, 0.45, 'A majestic heavenly choir and warm brass swell rising to a bright triumphant sustained chord, shimmering harp and bell sparkle on top, fantasy game arrival, close and clearly present, no words, no drums'],
  title: [2.4, 0.4, 'A warm majestic magical shimmer reveal, soft low brass-like swell with golden sparkling chime tail, fantasy game title appears, gentle, not loud'],
  poster: [1.0, 0.4, 'A gentle soft wind whoosh, smooth swell in and out, like a light breeze passing a hanging cloth banner, airy, rounded, quiet, no impact, no crackle, no music'],
};
for (const [n, [dur, infl, text]] of Object.entries(CUES)) {
  if (only.length ? !only.includes(n) : existsSync(DIR + n + '.mp3')) continue;
  const r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ text, duration_seconds: dur, prompt_influence: infl, ...(/^(ride|amb)/.test(n) ? { loop: true, model_id: 'eleven_text_to_sound_v2' } : {}) }) });
  if (!r.ok) { console.log(n, 'FAILED', r.status, (await r.text()).slice(0, 200)); if (r.status === 401 || r.status === 403) break; continue; }
  const b = Buffer.from(await r.arrayBuffer()); writeFileSync(DIR + n + '.mp3', b); console.log(n, 'ok', (b.length / 1024).toFixed(0) + ' KB');
}

// the game's announcer voice, read slower than its usual 0.89 so nothing is rushed
for (const [n, text] of [['vo-outskirts', 'Welcome to the Outskirts.'], ['vo-underbelly', 'The Underbelly... awaits.'], ['vo-scrapyard', 'Ahh... the Scrapyards.'], ['vo-runebarriers', 'The great Rune Barriers.']]) {
  if (process.argv.length > 2 ? !process.argv.includes(n) : existsSync(DIR + n + '.mp3')) continue;
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/GFNPDbkiJBcXfkZZsunT/with-timestamps?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.78, similarity_boost: 0.75, style: 0.45, use_speaker_boost: true, speed: 0.78 } }) });
  if (!r.ok) { console.log(n, r.status, (await r.text()).slice(0, 250)); continue; }
  const j = await r.json(); writeFileSync(DIR + n + '.mp3', Buffer.from(j.audio_base64, 'base64')); const a = j.alignment; console.log(n, a.characters.map((c, i) => (i === 0 || a.characters[i - 1] === ' ' ? `${a.character_start_times_seconds[i].toFixed(2)}:` : '') + c).join(''), 'ends', a.character_end_times_seconds.at(-1).toFixed(2));
}
