import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

if (process.platform !== 'win32') throw new Error('Native CI requires Windows');
const environmentFile = process.env.GITHUB_ENV;
if (!environmentFile) throw new Error('Native CI preparation requires GITHUB_ENV');
const { vscodeVersion } = JSON.parse(await readFile(new URL('./ci-tools.json', import.meta.url), 'utf8'));
const executable = await downloadAndUnzipVSCode({ version: vscodeVersion, platform: 'win32-x64-archive',
  cachePath: path.resolve('.test-work/vscode'),
  reporter: { report() {}, error(error) { console.error(error); } } });
await appendFile(environmentFile, 'VSCODE_EXECUTABLE=' + executable + '\n');
console.log('Prepared VS Code ' + vscodeVersion + ' for isolated native acceptance');
