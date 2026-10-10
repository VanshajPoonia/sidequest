// Gemma 3 1B (instruction-tuned, q4) in this tab, through transformers.js.
// WebGPU when the browser has it, WASM otherwise. Same q4 weights either way, which
// are the weights tests/gemma.mjs measured.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

export const MODEL = 'onnx-community/gemma-3-1b-it-ONNX';
export const SIZE_MB = 860;

let gen = null;
let loading = null;
let device = null;
const listeners = new Set();

export const ready = () => gen !== null;
export const backend = () => device;

async function webgpu() {
  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}

export function load(onProgress) {
  if (onProgress) listeners.add(onProgress);
  loading ??= (async () => {
    const files = new Map();
    const progress_callback = (e) => {
      if (e.status !== 'progress' || !e.total) return;
      files.set(e.file, [e.loaded, e.total]);
      let l = 0, t = 0;
      for (const [a, b] of files.values()) { l += a; t += b; }
      listeners.forEach((fn) => fn(l / t));
    };
    const order = (await webgpu()) ? ['webgpu', 'wasm'] : ['wasm'];
    let lastErr;
    for (const d of order) {
      try {
        gen = await pipeline('text-generation', MODEL, { dtype: 'q4', device: d, progress_callback });
        device = d;
        return;
      } catch (err) { lastErr = err; }
    }
    throw lastErr;
  })().catch((err) => { loading = null; throw err; });
  return loading;
}

/** Greedy, short. Missions are one sentence; the checker rejects anything long anyway. */
export async function generate(messages) {
  const out = await gen(messages, { max_new_tokens: 64, do_sample: false });
  return out[0].generated_text.at(-1).content;
}
