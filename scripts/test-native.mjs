import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareTestWorkspace } from './prepare-test-workspace.mjs';

if (process.platform !== 'win32') throw new Error('Native acceptance currently requires Windows');
let code = process.env.VSCODE_EXECUTABLE;
if (!code) {
  const local = process.env.LOCALAPPDATA;
  if (!local) throw new Error('Set VSCODE_EXECUTABLE to the Microsoft VS Code executable');
  code = path.join(local, 'Programs/Microsoft VS Code/Code.exe');
}
await access(code);
const root = process.cwd(), fixture = await prepareTestWorkspace(root), execute = promisify(execFile);
for (const [entry, resultFile] of [['native-runner.cjs', 'native-result.json'], ['native-reliability.cjs', 'native-reliability-result.json'], ['native-loading.cjs', 'native-loading-result.json']]) {
  const started = Date.now();
  await execute(code, ['--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
    '--user-data-dir', path.join(fixture.directory, entry + '-profile'), '--extensions-dir', path.join(fixture.directory, 'extensions'),
    '--extensionDevelopmentPath', root, '--extensionTestsPath', path.join(root, 'tests', entry), fixture.workspace],
  { windowsHide: true, timeout: 120000, env: { ...process.env, DSH_HOME: fixture.desktop } });
  const resultPath = path.join(root, '.test-work', resultFile), info = await stat(resultPath);
  if (info.mtimeMs < started) throw new Error('Native acceptance did not write a fresh result: ' + entry);
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  if (entry === 'native-runner.cjs' ? result.actualWebviewRoundtrip !== true :
    entry === 'native-loading.cjs' ? result.cases.length !== 2 :
    result.ownedRuntimeExited !== true || result.cases.length !== 2) {
    throw new Error('Native acceptance did not complete: ' + entry);
  }
  console.log(entry + ': passed');
}
