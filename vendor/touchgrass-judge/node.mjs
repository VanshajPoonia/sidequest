// The judge in Node: builds vocabularies with CLIP's text tower, and embeds test photos
// with the vision tower at the same q8 precision the browser runs. Needs the
// @huggingface/transformers package; the browser half (browser.js) does not.
import {
  AutoTokenizer, CLIPTextModelWithProjection,
  AutoProcessor, CLIPVisionModelWithProjection, RawImage,
} from '@huggingface/transformers';
import { classPrompts, centroid } from './core.js';
import { TEMPLATES, ELSEWHERE, SCREEN } from './vocab.js';

export const DEFAULT_MODEL = 'Xenova/clip-vit-base-patch32';
export { RawImage };

const texts = new Map();
const visions = new Map();

export async function embedTexts(list, model = DEFAULT_MODEL, batch = 32) {
  if (!texts.has(model)) {
    texts.set(model, {
      tok: await AutoTokenizer.from_pretrained(model),
      net: await CLIPTextModelWithProjection.from_pretrained(model, { dtype: 'fp32' }),
    });
  }
  const { tok, net } = texts.get(model);
  const out = [];
  for (let i = 0; i < list.length; i += batch) {
    const inputs = tok(list.slice(i, i + batch), { padding: true, truncation: true });
    const { text_embeds } = await net(inputs);
    out.push(...text_embeds.tolist());
  }
  return out;
}

/** A file path, a URL, or a RawImage already in memory. */
export async function embedImage(image, model = DEFAULT_MODEL, dtype = 'q8') {
  if (!visions.has(model)) {
    visions.set(model, {
      proc: await AutoProcessor.from_pretrained(model),
      net: await CLIPVisionModelWithProjection.from_pretrained(model, { dtype }),
    });
  }
  const { proc, net } = visions.get(model);
  const raw = image instanceof RawImage ? image : await RawImage.read(image);
  const { image_embeds } = await net(await proc(raw));
  return image_embeds.tolist()[0];
}

const asImage = async (x) => (x instanceof RawImage ? x : await RawImage.read(x)).rgb();

/**
 * A photo shown on a device: `photo` cropped to fill `rect` ([x0, y0, x1, y1]) inside
 * `frame`, a real photo of a screen. This is how the tests fake "a phone showing grass".
 */
export async function onScreen(frame, photo, [x0, y0, x1, y1]) {
  const [f, p] = await Promise.all([asImage(frame), asImage(photo)]);
  const w = x1 - x0, h = y1 - y0;
  const s = Math.min(p.width / w, p.height / h);
  const cw = Math.floor(w * s), ch = Math.floor(h * s);
  const cx = Math.floor((p.width - cw) / 2), cy = Math.floor((p.height - ch) / 2);
  const fit = await (await p.crop([cx, cy, cx + cw - 1, cy + ch - 1])).resize(w, h);
  const data = new Uint8ClampedArray(f.data);
  for (let y = 0; y < h; y++) {
    data.set(fit.data.subarray(y * w * 3, (y + 1) * w * 3), ((y0 + y) * f.width + x0) * 3);
  }
  return new RawImage(data, f.width, f.height, 3);
}

/**
 * One direction per class. `items` are your own classes ({ id, names }); the shared
 * elsewhere and screen classes are added after them unless you pass `extra`.
 */
export async function buildClasses(items, { model = DEFAULT_MODEL, templates = TEMPLATES, extra = [...ELSEWHERE, ...SCREEN] } = {}) {
  const all = [...items.map((c) => ({ kind: 'item', ...c })), ...extra];
  const classes = [];
  for (const c of all) classes.push({ id: c.id, kind: c.kind, vec: centroid(await embedTexts(classPrompts(c, templates), model)) });
  return classes;
}

/** The JSON file browser.js loads. Rounded to 5 places, which keeps it small and changes no verdict. */
export function vocabularyFile(classes, { model = DEFAULT_MODEL, templates = TEMPLATES } = {}) {
  const round = (v) => v.map((x) => Math.round(x * 1e5) / 1e5);
  return JSON.stringify({ model, templates, classes: classes.map((c) => ({ ...c, vec: round(c.vec) })) });
}
