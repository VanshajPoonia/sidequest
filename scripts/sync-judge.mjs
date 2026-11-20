// Copy the TouchGrass judge into vendor/touchgrass-judge from its home repo,
// github.com/VanshajPoonia/proof-of-grass (folder judge/).
//
//   npm run sync-judge                       the latest commit on main
//   npm run sync-judge -- <commit or branch>  a pinned version
//   npm run sync-judge -- --from ../V        a local checkout
//
// It records the commit and a hash of every file in SOURCE.json. tests/vendor.mjs fails
// if a vendored file is edited by hand, so changes go to proof-of-grass first.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'VanshajPoonia/proof-of-grass';
export const FILES = ['core.js', 'vocab.js', 'browser.js', 'node.mjs', 'frames.json', 'README.md', 'LICENSE'];
const OUT = new URL('../vendor/touchgrass-judge/', import.meta.url);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fromGitHub(ref) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub said ${res.status} for ${ref}`);
  const commit = (await res.json()).sha;
  const files = {};
  for (const f of FILES) {
    const path = f === 'LICENSE' ? 'LICENSE' : `judge/${f}`;
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${commit}/${path}`);
    if (!r.ok) throw new Error(`${r.status} fetching ${path}`);
    files[f] = Buffer.from(await r.arrayBuffer());
  }
  return { commit, files };
}

function fromCheckout(dir) {
  const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', 'judge', 'LICENSE'], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`${dir} has uncommitted changes in judge/. Commit them first so SOURCE.json points at real code.`);
  const files = {};
  for (const f of FILES) files[f] = readFileSync(join(dir, f === 'LICENSE' ? 'LICENSE' : `judge/${f}`));
  return { commit, files };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const from = args.indexOf('--from');
  const { commit, files } = from >= 0 ? fromCheckout(args[from + 1]) : await fromGitHub(args[0] || 'main');

  mkdirSync(OUT, { recursive: true });
  const hashes = {};
  for (const [name, buf] of Object.entries(files)) {
    writeFileSync(new URL(name, OUT), buf);
    hashes[name] = sha256(buf);
  }
  const version = files['core.js'].toString().match(/VERSION = '([^']+)'/)?.[1];
  writeFileSync(new URL('SOURCE.json', OUT), JSON.stringify({ repo: `https://github.com/${REPO}`, path: 'judge', commit, version, files: hashes }, null, 2) + '\n');
  console.log(`vendored the TouchGrass judge ${version} from ${REPO}@${commit.slice(0, 7)}`);
}
