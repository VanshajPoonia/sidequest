// The judge in a browser tab: CLIP's vision tower through transformers.js, q8 on WASM,
// plus a vocabulary file of precomputed text directions (built by node.mjs), so the
// phone never downloads the text tower.
//
// Always WASM at q8, even where WebGPU exists. That is the exact setup the tests
// measure, and "what ships is what was tested" beats a few hundred milliseconds.
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
import { rank, judge } from './core.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

/** `vocabulary` is the URL of a vocabulary JSON file, or the parsed file itself. */
export function createJudge({ vocabulary }) {
  let vocab = null;
  let processor = null;
  let model = null;
  let loading = null;
  const listeners = new Set();

  async function download() {
    const files = new Map();
    const progress_callback = (e) => {
      if (e.status !== 'progress' || !e.total) return;
      files.set(e.file, [e.loaded, e.total]);
      let loaded = 0, total = 0;
      for (const [l, t] of files.values()) { loaded += l; total += t; }
      listeners.forEach((fn) => fn(loaded / total, total));
    };
    const v = typeof vocabulary === 'object' && !(vocabulary instanceof URL) ? vocabulary : await (await fetch(vocabulary)).json();
    const [proc, vision] = await Promise.all([
      AutoProcessor.from_pretrained(v.model, { progress_callback }),
      CLIPVisionModelWithProjection.from_pretrained(v.model, { dtype: 'q8', device: 'wasm', progress_callback }),
    ]);
    vocab = v;
    processor = proc;
    model = vision;
  }

  const api = {
    ready: () => model !== null,

    /** One download, however many callers ask for it. `onProgress(fraction, totalBytes)`. */
    load(onProgress) {
      if (onProgress) listeners.add(onProgress);
      loading ??= download().catch((err) => { loading = null; throw err; });
      return loading;
    },

    classes: () => vocab?.classes ?? null,

    /** Every class, most likely first: [{ id, kind, p, cos }]. */
    async rank(blob) {
      await api.load();
      const image = await RawImage.fromBlob(blob);
      const { image_embeds } = await model(await processor(image));
      return rank(image_embeds.data, vocab.classes);
    },

    /** The verdict for one claim (a class id, or a list of ids that would all count), plus the ranking. */
    async check(blob, claim, options) {
      const ranked = await api.rank(blob);
      return { ...judge(ranked, claim, options), ranked };
    },
  };
  return api;
}
