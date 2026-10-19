import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Packaging requires Windows x64');
const version = '24.21.0';
const archive = `node-v${version}-win-x64.zip`;
const expected = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541';
const cache = resolve('.test-work', `node-${version}`);
await mkdir(cache, { recursive: true });
const zip = join(cache, archive);
let data;
try { data = await readFile(zip); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
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
