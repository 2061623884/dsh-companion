import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
const frame = await build({ entryPoints: ['src/sidebar/client/frame-bridge.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', write: false });
const actions = await build({ entryPoints: ['src/sidebar/client/connection-actions.ts'], bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', write: false });
const define = { __DSH_FRAME_BRIDGE__: JSON.stringify(frame.outputFiles[0].text), __DSH_CONNECTION_ACTIONS__: JSON.stringify(actions.outputFiles[0].text) };
await Promise.all([
  build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], sourcemap: false, define }),
  build({ entryPoints: ['src/sidebar/client/dsh-adapter.ts'], outfile: 'dist/sidebar.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', sourcemap: false }),
  ...['desktop/connection', 'desktop/client', 'desktop/updates', 'references/reference-controller', 'context/editor-context', 'sidebar/view', 'protocol', 'sidebar/client/bridge', 'sidebar/client/reference-display', 'sidebar/client/input-adapter'].map(name => build({ entryPoints: [`src/${name}.ts`], outfile: `dist/test/${name}.js`, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], define })),
  build({ entryPoints: ['tests/fixtures/legacy-runtime/client.ts'], outfile: 'dist/test/legacy-runtime/client.js', bundle: true, platform: 'node', format: 'cjs', target: 'node22' }),
  copyFile('src/sidebar/client/sidebar.css', 'dist/sidebar.css'),
  copyFile('src/sidebar/client/bootstrap.js', 'dist/bootstrap.js'),
]);
