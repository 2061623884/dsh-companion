import { mkdir, mkdtemp, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { releaseMetadata } from './release-metadata.mjs';
import { releaseSource } from './release-source.mjs';

const root = process.cwd(), metadata = await releaseMetadata(root);
await mkdir('.test-work/release', { recursive: true });
const source = await releaseSource(root), receipt = '.test-work/release/build-source.json';
await rm(receipt, { force: true });
// Stage only distributable files: VSCE otherwise walks cached runtimes before applying ignores.
const stage = await mkdtemp(path.join(root, '.test-work/vsix-source-'));
for (const file of ['.vscodeignore', 'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'media/whale.svg', 'dist/extension.js', 'dist/sidebar.js', 'dist/bootstrap.js', 'dist/sidebar.css']) {
  await mkdir(path.dirname(path.join(stage, file)), { recursive: true });
  await copyFile(path.join(root, file), path.join(stage, file));
}
execFileSync(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'package', '--target', metadata.target,
  '--no-dependencies', '--allow-missing-repository', '--skip-license',
  '--out', path.join(root, '.test-work/release', metadata.filename)], { cwd: stage, windowsHide: true, stdio: 'inherit' });
if (JSON.stringify(source) !== JSON.stringify(await releaseSource(root))) throw new Error('RELEASE_SOURCE_CHANGED_DURING_PACKAGE');
const sha256 = createHash('sha256').update(await readFile(path.join('.test-work/release', metadata.filename))).digest('hex');
await writeFile(receipt, JSON.stringify({ ...source, sha256 }, null, 2) + '\n');
