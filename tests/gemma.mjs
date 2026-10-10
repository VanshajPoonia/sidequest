// Runs the real Gemma against the real map and reproduces the README's numbers.
//
//   npm test                                             Gemma 3 1B, q4 (what ships)
//   MODEL=onnx-community/gemma-3-270m-it-ONNX npm test   the smaller one, for comparison
//
// The 24 stops: the six highest-scoring places around each of the four presets.
// Greedy decoding throughout, so every run prints the same table.
import { readFileSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';
import { toFeatures } from '../src/plan.js';
import { PLACES } from '../src/places.js';
import { namePrompt, groundedPrompt, clean, problems, writeMission, SYSTEM, WHO } from '../src/mission.js';

const MODEL = process.env.MODEL || 'onnx-community/gemma-3-1b-it-ONNX';
const gen = await pipeline('text-generation', MODEL, { dtype: 'q4' });
const generate = async (messages) => {
  const out = await gen(messages, { max_new_tokens: 64, do_sample: false });
  return out[0].generated_text.at(-1).content;
};

const cases = [];
for (const p of PLACES) {
  const features = toFeatures(JSON.parse(readFileSync(new URL(`../data/places/${p.id}.json`, import.meta.url))).elements);
  const top = [];
  for (const f of [...features].sort((a, b) => b.score - a.score)) {
    if (top.length < 6 && !top.some((t) => t.title === f.title || t.kind === f.kind)) top.push(f);
  }
  top.forEach((f, i) => cases.push({ place: p, f, who: ['solo', 'kids', 'dog'][i % 3] }));
}

const tally = () => ({ invented: 0, unanswerable: 0, unsafe: 0, long: 0, narration: 0, walker: 0, any: 0, examples: [] });
const byName = tally(), rulesOnly = tally(), byTags = tally(), shipped = tally();

// Same tags and rules, but no worked examples: isolates what the examples are worth.
const rulesPrompt = (f, who) => [{ role: 'user', content: `${SYSTEM}\n\nPlace:\n${f.facts.map(([k, v]) => `- ${k}: ${v}`).join('\n')}\nWalker: ${WHO[who]}\n\nWrite the mission.` }];
let retried = 0, fellBack = 0;
const add = (t, text, p, f) => {
  if (p.some((x) => x.type === 'invented')) t.invented++;
  if (p.some((x) => x.type === 'unsafe')) t.unsafe++;
  if (p.some((x) => x.type === 'unanswerable')) t.unanswerable++;
  if (p.some((x) => x.type === 'long')) t.long++;
  if (p.some((x) => x.type === 'narration' || x.type === 'walker')) t.narration++;
  if (p.length) { t.any++; t.examples.push(`${f.title}: "${text}"  <- ${p.map((x) => x.detail || x.type).join(', ')}`); }
};

console.log(`model: ${MODEL}, ${cases.length} stops\n`);
const t0 = Date.now();
for (const { place, f, who } of cases) {
  const a = clean(await generate(namePrompt(f, place, who)));
  add(byName, a, problems(a, f, who), f);
  const r = clean(await generate(rulesPrompt(f, who)));
  add(rulesOnly, r, problems(r, f, who), f);
  const b = clean(await generate(groundedPrompt(f, who)));
  add(byTags, b, problems(b, f, who), f);
  const m = await writeMission(generate, f, who);
  add(shipped, m.text, problems(m.text, f, who), f);
  if (m.attempts > 1 && !m.fallback) retried++;
  if (m.fallback) fellBack++;
  console.log(`${m.fallback ? 'FALLBACK' : `try ${m.attempts}`.padEnd(8)}  ${f.title.slice(0, 34).padEnd(34)}  ${m.text}`);
}

const N = cases.length;
const row = (name, t) => console.log(`${name.padEnd(36)} ${String(t.invented).padStart(2)}/${N} invented a name or date   ${String(t.unanswerable).padStart(2)}/${N} asked for a date the map lacks   ${String(t.narration).padStart(2)}/${N} not a mission/wrong walker   ${String(t.unsafe).padStart(2)}/${N} unsafe   ${String(t.long).padStart(2)}/${N} too long   ${String(N - t.any).padStart(2)}/${N} clean`);
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
row('name only + examples', byName);
row('tags, rules only, no examples', rulesOnly);
row('tags + 4 worked examples', byTags);
row('tags + checker + retry (shipped)', shipped);
console.log(`\nshipped: ${N - retried - fellBack} first try, ${retried} fixed on retry, ${fellBack} fell back to a template`);
console.log('\nname-only failures:\n  ' + byName.examples.join('\n  '));
console.log('\nrules-only failures:\n  ' + rulesOnly.examples.join('\n  '));
console.log('\ntags + examples failures:\n  ' + byTags.examples.join('\n  '));

const pass = shipped.any === 0 && fellBack <= N / 4;
console.log(pass ? '\nPASS' : '\nFAIL');
process.exit(pass ? 0 : 1);
