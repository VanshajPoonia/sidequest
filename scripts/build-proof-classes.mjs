// Precompute the photo judge's vocabulary for stops and ship it as
// data/proof-classes.json, so a phone only downloads CLIP's vision tower.
// Re-run after editing PLACES in src/proof.js:  npm run build-proof
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLACES } from '../src/proof.js';
import { buildClasses, vocabularyFile } from '../vendor/touchgrass-judge/node.mjs';

export const buildProof = () => buildClasses(PLACES);

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const classes = await buildProof();
  writeFileSync(new URL('../data/proof-classes.json', import.meta.url), vocabularyFile(classes));
  console.log(`wrote data/proof-classes.json: ${classes.length} classes`);
}
