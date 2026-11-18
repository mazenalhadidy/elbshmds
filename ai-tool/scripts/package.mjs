// Builds the READY-TO-USE folder for a Windows PC: no "npm install", only Node.js is needed.
//   npm run package   ->  release/wa-debt-checker/   (+ release/wa-debt-checker.zip when `zip` exists)
// The local server and its libraries become ONE file (local/server.mjs); the page is copied as it is.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'release', 'wa-debt-checker');
fs.rmSync(path.join(ROOT, 'release'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'local'), { recursive: true });

await build({
  entryPoints: [path.join(ROOT, 'local', 'server.mjs')],
  outfile: path.join(OUT, 'local', 'server.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20', minify: false, legalComments: 'none',
  // some libraries still use require(): give the ES module one
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
fs.cpSync(path.join(ROOT, 'public'), path.join(OUT, 'public'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'local', 'config.example.json'), path.join(OUT, 'local', 'config.example.json'));
fs.copyFileSync(path.join(ROOT, 'scripts', 'start.cmd'), path.join(OUT, 'START.cmd'));
fs.copyFileSync(path.join(ROOT, 'scripts', 'READ-ME.txt'), path.join(OUT, 'READ-ME.txt'));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(OUT, 'local', 'version.txt'), version + '\n');
try { execFileSync('zip', ['-qr', 'wa-debt-checker.zip', 'wa-debt-checker'], { cwd: path.join(ROOT, 'release') }); } catch { /* no zip tool: the folder is enough */ }
console.log('ready:', OUT);
