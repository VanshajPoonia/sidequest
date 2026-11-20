// Photo proof in the browser. The TouchGrass judge (vendor/touchgrass-judge) runs CLIP on
// this phone, so a photo is checked before anything leaves it. src/proof.js decides
// what counts at each kind of stop.
import { createJudge } from '../vendor/touchgrass-judge/browser.js';
import { ELSEWHERE, SCREEN } from '../vendor/touchgrass-judge/vocab.js';
import { PLACES, THING, verdict } from './proof.js';

const judge = createJudge({ vocabulary: 'data/proof-classes.json' });

export const SIZE_MB = 89;
export const ready = () => judge.ready();
export const load = (onProgress) => judge.load(onProgress);

const NAME = Object.fromEntries([...PLACES, ...ELSEWHERE, ...SCREEN].map((c) => [c.id, c.names[0]]));

/** Check one photo for one stop: the verdict, what the judge saw, and a small thumbnail. */
export async function prove(blob, stop) {
  const [ranked, thumb] = await Promise.all([judge.rank(blob), thumbnail(blob)]);
  return {
    ...verdict(ranked, stop.kind),
    thumb,
    top: ranked.slice(0, 3).map((r) => ({ id: r.id, name: NAME[r.id] ?? r.id, p: r.p })),
  };
}

/** Why a photo was turned away, in words a walker can act on. */
export function explain(v, stop) {
  if (v.reason === 'screen') return 'That looks like a photo of a screen. Point the camera at the real thing.';
  if (v.reason === 'elsewhere') return `That looks like ${NAME[v.top.id]}, not the outdoors. Proof has to be taken at the stop.`;
  const thing = THING[stop.kind] ?? 'the place';
  return `That reads as ${NAME[v.top.id]}. Get ${thing} in the frame and try again.`;
}

/** A square JPEG small enough to send with a proof. */
export async function thumbnail(blob, size = 160) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.7);
}
