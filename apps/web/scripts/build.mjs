// Bundles the web build with esbuild: `node scripts/build.mjs` writes dist/, `--serve` serves it with rebuilds.
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const serve = process.argv.includes('--serve');
const portArg = process.argv.find(a => a.startsWith('--port='));
const port = portArg ? Number(portArg.slice('--port='.length)) : 8080;

mkdirSync(out, { recursive: true });
copyFileSync(join(root, 'public', 'index.html'), join(out, 'index.html'));
copyFileSync(join(root, '..', 'vega', 'assets', 'image', 'icon.png'), join(out, 'icon.png'));

const options = {
  entryPoints: [join(root, 'src', 'index.tsx')],
  outfile: join(out, 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  sourcemap: true,
  minify: !serve,
  // The shared app imports 'react-native'; in the browser that is react-native-web plus the TV shims.
  alias: { 'react-native': join(root, 'src', 'rn', 'index.ts') },
  // Images the core require()s become files next to app.js; require() then returns their URL.
  loader: { '.png': 'file', '.jpg': 'file' },
  assetNames: 'assets/[name]-[hash]',
  // tweetnacl only reaches for Node's crypto when there is no window.crypto.
  external: ['crypto'],
  define: {
    __DEV__: serve ? 'true' : 'false',
    'process.env.NODE_ENV': serve ? '"development"' : '"production"',
  },
  logLevel: 'info',
};

if (serve) {
  const ctx = await context(options);
  await ctx.watch();
  const { hosts, port: actual } = await ctx.serve({ servedir: out, port, host: '0.0.0.0' });
  console.log(`AnyStream web: http://localhost:${actual}/ (also ${hosts.join(', ')})`);
} else {
  await build(options);
}
