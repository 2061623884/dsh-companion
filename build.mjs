import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], sourcemap: false }),
  build({ entryPoints: ['src/sidebar/client/dsh-adapter.js'], outfile: 'dist/sidebar.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', sourcemap: false }),
  ...['desktop/connection', 'references/reference-controller', 'context/editor-context', 'sidebar/view', 'protocol'].map(name => build({ entryPoints: [`src/${name}.ts`], outfile: `dist/test/${name}.js`, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'] })),
  copyFile('src/sidebar/client/sidebar.css', 'dist/sidebar.css'),
  copyFile('src/sidebar/client/bootstrap.js', 'dist/bootstrap.js'),
]);
