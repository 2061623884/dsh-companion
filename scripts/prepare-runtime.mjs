import { mkdir, writeFile, readFile, copyFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path, { resolve, join } from 'node:path';
import { build, version as bundlerVersion } from 'esbuild';
import { prepareWorkBuddy } from './prepare-workbuddy.mjs';
import { prepareStartupLeaves } from './prepare-startup-leaves.mjs';
import { prepareSharedLogin } from './prepare-shared-login.mjs';
import { prepareStartupResolution } from './prepare-startup-resolution.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Packaging requires Windows x64');
const { version, archiveSha256: expected } = JSON.parse(await readFile('runtime/node-version.json', 'utf8'));
const archive = `node-v${version}-win-x64.zip`;
const cache = resolve('.test-work', `node-${version}`);
await mkdir(cache, { recursive: true });
const zip = join(cache, archive);
let data;
try { data = await readFile(zip); }
catch (error) {
  if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  const response = await fetch(`https://nodejs.org/dist/v${version}/${archive}`);
  if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
  await writeFile(zip, data);
}
if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error('Node checksum mismatch');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  '& { param($archive,$destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }', zip, cache], { windowsHide: true });
await mkdir('runtime/bin', { recursive: true });
await copyFile(join(cache, `node-v${version}-win-x64/node.exe`), 'runtime/bin/node.exe');
await copyFile(join(cache, `node-v${version}-win-x64/LICENSE`), 'runtime/bin/NODE-LICENSE');
console.log(`Bundled Node ${version}, verified SHA256`);

// TypeBox is a pure ESM leaf. Shared chunks preserve identity across all public
// entry points; the original entry paths keep their adjacent TypeScript types.
const directory = await realpath('runtime/node_modules/typebox');
const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
const entries = [...new Set(Object.values(manifest.exports).map(entry => entry.import))];
const bundled = await build({ entryPoints: entries.map(entry => join(directory, entry)), outdir: join(directory, 'companion-bundle'),
  outbase: join(directory, 'build'), bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'node24', keepNames: true,
  outExtension: { '.js': '.mjs' }, metafile: true, write: false, legalComments: 'inline' });
for (const file of bundled.outputFiles) {
  await mkdir(path.dirname(file.path), { recursive: true }); await writeFile(file.path, file.contents);
}
for (const entry of entries) {
  const original = join(directory, entry), output = join(directory, 'companion-bundle', path.relative(join(directory, 'build'), original));
  let relative = path.relative(path.dirname(original), output).replaceAll('\\', '/');
  if (!relative.startsWith('.')) relative = './' + relative;
  const metadata = Object.values(bundled.metafile.outputs).find(item => item.entryPoint && resolve(item.entryPoint).toLowerCase() === original.toLowerCase());
  if (!metadata) throw new Error('TypeBox public entry missing from bundler output');
  await writeFile(original, `export * from ${JSON.stringify(relative)};\n` + (metadata.exports.includes('default') ? `export { default } from ${JSON.stringify(relative)};\n` : ''));
}
await writeFile('runtime/bundle-manifest.json', JSON.stringify({ tool: `esbuild ${bundlerVersion}`, package: manifest.name, version: manifest.version,
  sourceFiles: Object.keys(bundled.metafile.inputs).length, publicEntries: entries.length,
  outputFiles: bundled.outputFiles.map(file => path.relative(directory, file.path).replaceAll('\\', '/')) }, null, 2));
console.log(`Prepared ${manifest.name} ${manifest.version}: ${Object.keys(bundled.metafile.inputs).length} files into ${bundled.outputFiles.length} shared ESM files`);
await prepareWorkBuddy(resolve('runtime'));
await prepareSharedLogin(resolve('runtime'));
await prepareStartupLeaves(resolve('runtime'));
await prepareStartupResolution(resolve('runtime'));
