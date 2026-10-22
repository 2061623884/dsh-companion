import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { releaseMetadata } from './release-metadata.mjs';
import { releaseSource } from './release-source.mjs';

const root = process.cwd(), metadata = await releaseMetadata(root);
await mkdir('.test-work/release', { recursive: true });
const source = await releaseSource(root), receipt = '.test-work/release/build-source.json';
await rm(receipt, { force: true });
execFileSync(process.execPath, ['node_modules/@vscode/vsce/vsce', 'package', '--target', metadata.target,
  '--no-dependencies', '--allow-missing-repository', '--skip-license',
  '--out', path.join('.test-work/release', metadata.filename)], { cwd: root, windowsHide: true, stdio: 'inherit' });
if (JSON.stringify(source) !== JSON.stringify(await releaseSource(root))) throw new Error('RELEASE_SOURCE_CHANGED_DURING_PACKAGE');
const sha256 = createHash('sha256').update(await readFile(path.join('.test-work/release', metadata.filename))).digest('hex');
await writeFile(receipt, JSON.stringify({ ...source, sha256 }, null, 2) + '\n');
