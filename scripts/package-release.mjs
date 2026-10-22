import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { releaseMetadata } from './release-metadata.mjs';

const root = process.cwd(), metadata = await releaseMetadata(root);
await mkdir('.test-work/release', { recursive: true });
execFileSync(process.execPath, ['node_modules/@vscode/vsce/vsce', 'package', '--target', metadata.target,
  '--no-dependencies', '--allow-missing-repository', '--skip-license',
  '--out', path.join('.test-work/release', metadata.filename)], { cwd: root, windowsHide: true, stdio: 'inherit' });
