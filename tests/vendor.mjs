// The vendored TouchGrass judge is exactly what SOURCE.json says it is. Edit it in
// proof-of-grass and run `npm run sync-judge`, never by hand here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FILES } from '../scripts/sync-judge.mjs';

const dir = new URL('../vendor/touchgrass-judge/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('SOURCE.json', dir)));
assert.deepEqual(Object.keys(source.files).sort(), [...FILES].sort());
for (const [name, hash] of Object.entries(source.files)) {
  const actual = createHash('sha256').update(readFileSync(new URL(name, dir))).digest('hex');
  assert.equal(actual, hash, `vendor/touchgrass-judge/${name} was edited by hand. Change it in proof-of-grass and run npm run sync-judge.`);
}
console.log(`ok  vendored judge ${source.version} matches ${source.repo}@${source.commit.slice(0, 7)}\n`);
