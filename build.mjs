import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
const frame = await build({ entryPoints: ['src/sidebar/client/frame-bridge.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', write: false });
const define = { __DSH_FRAME_BRIDGE__: JSON.stringify(frame.outputFiles[0].text) };
await Promise.all([
  build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], sourcemap: false, define }),
  build({ entryPoints: ['src/sidebar/client/dsh-adapter.ts'], outfile: 'dist/sidebar.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', sourcemap: false }),
  ...['runtime/connection', 'runtime/client', 'references/reference-controller', 'context/editor-context', 'sidebar/view', 'protocol', 'sidebar/client/bridge', 'sidebar/client/reference-display', 'sidebar/client/input-adapter'].map(name => build({ entryPoints: [`src/${name}.ts`], outfile: `dist/test/${name}.js`, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], define })),
  copyFile('src/sidebar/client/sidebar.css', 'dist/sidebar.css'),
  copyFile('src/sidebar/client/bootstrap.js', 'dist/bootstrap.js'),
]);
