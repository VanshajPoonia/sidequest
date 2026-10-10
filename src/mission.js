// Turning one verified place into one small thing to do there.
//
// Gemma writes. This file decides whether to believe it. Shared by the app and
// tests/gemma.mjs, so the numbers in the README come from this exact code.

export const SYSTEM = `You write tiny outdoor missions for a walking game.
A mission is ONE sentence, under 30 words, telling the walker one thing to do at the place in about two minutes, using their eyes, ears and hands.
Start with a verb. Use only the facts given: never add names, dates, history or details that are not in the facts.
Only ask them to look for things that are certainly there: the place itself, what the facts say, and ordinary things like stone, light, shadows, trees, birds, sounds and the sky. Never send them to search for an object that might not exist.
Never suggest climbing, swimming, wading, picking plants, eating anything, feeding animals, or going inside a building.`;

export const WHO = {
  solo: 'an adult walking alone',
  kids: 'a parent with a young child (talk to the parent; call the child "your kid")',
  dog: 'someone walking their dog',
};

// Worked examples, as real conversation turns, one per kind of walker. A 1B model
// copies the *shape* of previous answers far more reliably than it follows a rule
// written in prose (tests/gemma.mjs measures exactly how much).
const EXAMPLES = [
  [[['Name', 'Old Mill'], ['Structure', 'windmill'], ['Dates from', '1820']], 'solo',
    'Find the Old Mill, count its sails, and guess which way the wind is blowing today.'],
  [[['Natural feature', 'tree'], ['Species', 'Quercus robur'], ['Common name', 'English oak']], 'kids',
    'Race your kid to the English oak and see if the two of you can reach all the way around its trunk.'],
  [[['Type', 'memorial'], ['Memorial type', 'plaque'], ['Inscription', 'Ada Lovelace 1815-1852 Mathematician lived here']], 'dog',
    'Find the plaque for Ada Lovelace and, while your dog inspects the railings, work out how old she was in 1852.'],
  [[['Name', 'Red Tomb'], ['Historic type', 'tomb']], 'solo',
    'Walk all the way around the Red Tomb and count how many arches it has.'],
];


const factLines = (facts) => facts.map(([k, v]) => `- ${k}: ${v}`).join('\n');
const ask = (facts, who) => `Place:\n${factLines(facts)}\nWalker: ${WHO[who]}\n\nWrite the mission.`;

function withExamples(question) {
  const turns = [];
  for (const [facts, who, mission] of EXAMPLES) {
    turns.push({ role: 'user', content: ask(facts, who) }, { role: 'assistant', content: mission });
  }
  turns[0] = { role: 'user', content: `${SYSTEM}\n\n${turns[0].content}` };
  return [...turns, { role: 'user', content: question }];
}

/** What ships: the place is described only by its OpenStreetMap tags. */
export function groundedPrompt(feature, who = 'solo') {
  return withExamples(ask(feature.facts, who));
}

/** The baseline the tests compare against: same rules and examples, but only the place's name. */
export function namePrompt(feature, place, who = 'solo') {
  return withExamples(ask([['Name', `${feature.title}, in ${place.name}, ${place.city}`]], who));
}

// ---- checking ------------------------------------------------------------------------

export function clean(text) {
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(mission|here'?s? (is )?(a|the|your) mission)\s*[:\-–]\s*/i, '')
    .split('\n').map((l) => l.trim()).filter(Boolean)[0]?.replace(/^["“'‘]|["”'’]$/g, '').trim() ?? '';
}

const UNSAFE = /\b(climb(s|ing)?|ascend(s|ing)?|scale the|swim(s|ming)?|wad(e|ing)|dive|jump (in|into|off|over)|pick (a|an|the|some|one)|picking|eat(s|ing)?|tast(e|ing)|lick|feed(s|ing)?|go inside|step inside|enter(s|ing)?|trespass(ing)?|break off|carve|dig|drink from|touch the water)\b/i;
const NARRATION = /^(you|your|the|a|an|this|that|these|those|it|its|there|he|she|they|we|i|my|our|walker|parent|adult)\b|\bthe (adult|parent|walker|child)\b/i;
const SECOND_SENTENCE = /[.!?]\s+\S/;
// "St. Columba" is one name, not two sentences, and the tags may spell it "St Columba".
const ABBR = /\b(st|mt|dr|mr|mrs|ms|no|ave|rd)\.(?=\s)/gi;
const plain = (s) => s.replace(ABBR, '$1');
const YEAR = /\b(1[0-9]{3}|20[0-9]{2})s?\b/g;
// A capitalised word that does not start a sentence is, in practice, a name.
const NAME = /(?<![.!?:;]\s*|^\s*|["“(]\s*)\b[A-Z][\p{L}'’-]+/gu;
const CHILD = /\b(kid|kids|child|children|son|daughter)\b/i;
// "Determine the original construction date": a small model's favourite filler, and
// impossible to do in a park when the map has no date to give.
const DATE_ASK = /\b(date|year|century|how old|exact time|when it was (built|made|opened|founded))\b/i;

/**
 * Everything wrong with a mission, as a list. Empty list = ship it.
 *
 * "Invented" means *not in the map data*, which is not quite the same as false: a
 * 1B model does know some history. But on a phone in a park there is no way to tell
 * a remembered fact from a plausible one, so anything the tags cannot back up is out.
 */
export function problems(original, feature, who = 'solo') {
  const out = [];
  if (!original) return [{ type: 'empty' }];
  const text = plain(original);
  const values = feature.facts.map(([, v]) => plain(v));
  const words = text.split(/\s+/).length;
  if (words > 35) out.push({ type: 'long', detail: `${words} words` });
  if (words < 5) out.push({ type: 'short', detail: `${words} words` });
  const known = values.join(' ').toLowerCase();
  // Whole words only: "Red" is not backed up by "buried" or "re-interred".
  const knownWords = new Set(known.split(/[^\p{L}\p{N}]+/u));
  // Judge the verbs, not the place: "Find the Swimming Pond" is fine.
  let verbs = text.toLowerCase();
  for (const v of values) verbs = verbs.split(v.toLowerCase()).join(' ');
  const unsafe = verbs.match(UNSAFE);
  if (unsafe) out.push({ type: 'unsafe', detail: unsafe[0] });
  // Small models love to describe the place instead of giving you something to do.
  if (who !== 'kids' && CHILD.test(verbs)) out.push({ type: 'walker', detail: text.match(CHILD)[0] });
  if (NARRATION.test(text) || SECOND_SENTENCE.test(verbs)) out.push({ type: 'narration', detail: text.split(/\s+/).slice(0, 2).join(' ') });

  if (!known.match(YEAR) && !/\bguess\b/i.test(text) && DATE_ASK.test(verbs)) out.push({ type: 'unanswerable', detail: verbs.match(DATE_ASK)[0] });

  for (const y of text.match(YEAR) || []) {
    if (!known.includes(y.replace(/s$/, ''))) out.push({ type: 'invented', detail: y });
  }
  for (const n of text.match(NAME) || []) {
    const parts = n.replace(/['’]s$/, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (parts.every((w) => w === 'i' || knownWords.has(w))) continue;
    out.push({ type: 'invented', detail: n });
  }
  return out;
}

function complaint(list, who) {
  return list.map((p) => ({
    invented: `It mentions "${p.detail}", which is not in the facts.`,
    unsafe: `It asks the walker to ${p.detail}, which is not allowed.`,
    unanswerable: `It asks for a ${p.detail}, but there is no date in the facts, so the walker cannot find one. Ask for something they can see, hear or touch.`,
    long: `It is too long (${p.detail}). Keep it under 30 words.`,
    walker: `There is no ${p.detail} on this walk. Write it for ${who} only.`,
    narration: 'It describes a scene instead of giving one instruction. Write a single sentence that starts with a verb, like Find, Count or Listen.',
    short: 'It is too short to be a mission.',
    empty: 'It was empty.',
  })[p.type]).join(' ');
}

// ---- the loop ------------------------------------------------------------------------

const FALLBACK = {
  tree: (f) => `Find ${f.title}, put a flat hand on the bark, and guess how old it is before you move on.`,
  plaque: () => 'Find the plaque and read every word of it out loud, slowly.',
  bench: () => 'Read the inscription on the bench, then sit on it for one full minute without your phone.',
  memorial: () => 'Find the memorial and read whatever is written on it, all of it.',
  water: () => 'Stand by the water and count every bird you can see in one minute.',
  viewpoint: () => 'Find the view, then name the farthest thing you can see.',
  fountain: () => 'Stand by the fountain, close your eyes, and count how many different sounds you can hear.',
  artwork: (f) => `Find ${f.title} and spot three details you would have walked straight past.`,
};
// Unnamed things are titled "A stone", "A fountain": mid-sentence that wants a small a.
const named = (f) => ({ ...f, title: f.title.replace(/^An? /, (a) => a.toLowerCase()) });
export const fallback = (f) => (FALLBACK[f.kind] || ((x) => `Find ${x.title} and spot three details you would have walked straight past.`))(named(f));

/**
 * Ask, check, and if the check fails, say exactly what was wrong and ask again.
 * Greedy decoding every time, so the same map gives the same quest and the test
 * numbers are reproducible. After `tries` rejections, a plain template takes over:
 * a boring mission beats an invented one.
 */
export async function writeMission(generate, feature, who = 'solo', tries = 3) {
  const messages = groundedPrompt(feature, who);
  const rejected = [];
  for (let i = 0; i < tries; i++) {
    const text = clean(await generate(messages));
    const p = problems(text, feature, who);
    if (!p.length) return { text, attempts: i + 1, rejected, fallback: false };
    rejected.push({ text, problems: p });
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: `${complaint(p, WHO[who])} Write the mission again, using only the facts.` });
  }
  return { text: fallback(feature), attempts: tries, rejected, fallback: true };
}

/** A name for the whole walk. Same rules: only words that came from the stops. */
export async function writeTitle(generate, stops) {
  const messages = [
    { role: 'system', content: 'You name walks. Reply with a title of 3 to 7 words and nothing else.' },
    { role: 'user', content: `The walk visits: ${stops.map((s) => s.title).join('; ')}. Name it.` },
  ];
  const text = clean(await generate(messages)).replace(/[.!]$/, '');
  const pseudo = { facts: stops.map((s) => ['', s.title]) };
  const bad = problems(text, pseudo).filter((p) => p.type !== 'short' || text.split(/\s+/).length < 2);
  return bad.length || text.length > 60 ? null : text;
}
