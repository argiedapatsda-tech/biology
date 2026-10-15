// Bundles _holo/holo.js (+ only the parts of three.js it uses) into assets/holo-bg.js.
//   node _holo/build.mjs <path to esbuild package> <path to three.module.js>
// DNA data: python _holo/gen_dna.py _holo/ref/1bna.pdb _holo/dna_data.js 24
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [esbuildPath, threePath] = process.argv.slice(2);
const esbuild = createRequire(import.meta.url)(esbuildPath);
await esbuild.build({
  entryPoints: [path.join(here, 'holo.js')],
  bundle: true, minify: true, format: 'iife', target: 'es2020',
  alias: { three: threePath },
  outfile: path.join(here, '..', 'assets', 'holo-bg.js'),
  banner: { js: '/* Biology hologram background (three.js r160 subset, MIT). Source: _holo/holo.js */' },
  logLevel: 'info'
});
