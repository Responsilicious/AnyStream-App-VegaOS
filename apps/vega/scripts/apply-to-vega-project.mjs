#!/usr/bin/env node
// Copies AnyStream's Vega shell and the shared core into a Vega project created with `vega project generate`.
//   node apps/vega/scripts/apply-to-vega-project.mjs <path-to-vega-project>
// The shell (apps/vega/src) becomes the project's src/; the core (packages/core) is installed as the package
// node_modules/@anystream/core, which is how the shell imports it in this repo too.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const repo = resolve(root, '..', '..');
const core = join(repo, 'packages', 'core');
const target = process.argv[2] ? resolve(process.argv[2]) : null;

if (!target || !existsSync(join(target, 'package.json'))) {
  console.error('Usage: node apps/vega/scripts/apply-to-vega-project.mjs <path-to-generated-vega-project>');
  process.exit(1);
}

// 1. The Vega shell becomes src/ (hlsjsplayer, PlayerBase and PlayerInterface come along when present locally).
cpSync(join(root, 'src'), join(target, 'src'), { recursive: true });
console.log('Copied apps/vega/src/ to src/');

// 2. The shared core goes in as a package. A fresh copy each time, so files deleted here disappear there too.
const coreTarget = join(target, 'node_modules', '@anystream', 'core');
rmSync(coreTarget, { recursive: true, force: true });
mkdirSync(coreTarget, { recursive: true });
for (const entry of ['package.json', 'src']) {
  cpSync(join(core, entry), join(coreTarget, entry), { recursive: true });
}
console.log('Installed packages/core as node_modules/@anystream/core');

// The launcher icon lives under assets/image and is referenced from manifest.toml as @image/icon.png.
if (existsSync(join(root, 'assets'))) {
  cpSync(join(root, 'assets'), join(target, 'assets'), { recursive: true });
  console.log('Copied assets/');
}

// 3. Entry point: make sure the generated index re-exports our App.
const entryCandidates = ['src/App.tsx', 'App.tsx'].map(p => join(target, p));
console.log(
  'Check that the generated entry file imports App from ./src/App (default export), ' +
    'found: ' + (entryCandidates.filter(existsSync).join(', ') || 'none'),
);

// 4. Dependencies the app needs at runtime.
const pkgPath = join(target, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.dependencies = pkg.dependencies ?? {};
const wanted = {
  'base-64': '1.0.0',
  '@xmldom/xmldom': '^0.8.10',
  'fastestsmallesttextencoderdecoder': '1.0.22',
  // Pure-JS Ed25519 for Plex sign-in: Vega's keplercrypto has no Ed25519.
  tweetnacl: '1.0.3',
};
for (const [name, version] of Object.entries(wanted)) {
  pkg.dependencies[name] = pkg.dependencies[name] ?? version;
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('Added runtime dependencies to package.json');

console.log(`
Next:
  1. In ${target}:  npm install
     npm install @amazon-devices/react-native-w3cmedia @amazon-devices/react-native-mmkv @amazon-devices/keplerscript-netmgr-lib @amazon-devices/keplercrypto
     (use the versions your generated template pins)
  2. Merge manifest.additions.toml into manifest.toml
  3. Install Amazon's hls.js (apps/vega/src/hlsjsplayer/README.md)
  4. npm run build:app, then run on the Vega Virtual Device or a Fire TV Stick 4K Select
`);
