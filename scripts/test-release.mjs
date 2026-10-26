import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';
import net from 'node:net';
import path from 'node:path';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import { prepareTestWorkspace } from './prepare-test-workspace.mjs';
import { releaseMetadata } from './release-metadata.mjs';
import { passedInstalledAcceptance } from './installed-acceptance.mjs';
import { desktopFixture, desktopRpc } from '../tests/desktop-fixture.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Release acceptance requires Windows x64');
const root = process.cwd(), metadata = await releaseMetadata(root), output = path.join(root, '.test-work/release');
const archive = path.join(output, metadata.filename), sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
const checked = JSON.parse(await readFile(path.join(output, 'archive-check.json'), 'utf8'));
if (checked.sha256 !== sha256 || checked.version !== metadata.version) throw new Error('RELEASE_ARCHIVE_CHECK_REQUIRED');
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const minimum = manifest.engines.vscode.match(/^\^(\d+\.\d+\.\d+)$/)?.[1];
if (!minimum) throw new Error('RELEASE_MINIMUM_EDITOR_UNRESOLVED');
const { vscodeVersion } = JSON.parse(await readFile('scripts/ci-tools.json', 'utf8'));
const execute = promisify(execFile), results = [];
for (const version of new Set([minimum, vscodeVersion])) {
  const code = await downloadAndUnzipVSCode({ version, platform: 'win32-x64-archive', cachePath: path.join(root, '.test-work/vscode'),
    reporter: { report() {}, error(error) { console.error(error); } } });
  const workspace = await prepareTestWorkspace(), desktop = await desktopFixture(root);
  const profile = path.join(workspace.directory, 'profile'), extensions = path.join(workspace.directory, 'extensions');
  const harness = path.join(workspace.directory, 'harness'), resultFile = path.join(workspace.directory, 'result.json');
  await mkdir(harness); await writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'release-harness', publisher: 'synthetic',
    version: '0.0.0', engines: { vscode: manifest.engines.vscode }, main: './index.cjs' }));
  await writeFile(path.join(harness, 'index.cjs'), 'exports.activate = () => {};\n');
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {net.AddressInfo} */ (server.address()).port;
  await new Promise(resolve => server.close(resolve));
  const isolated = ['--user-data-dir', profile, '--extensions-dir', extensions];
  const launcher = resolveCliPathFromVSCodeExecutablePath(code, 'win32-x64-archive');
  const relative = (await readFile(launcher, 'utf8')).match(/"%~dp0([^"\r\n]*\\resources\\app\\out\\cli\.js)"/i)?.[1];
  if (!relative) throw new Error('RELEASE_EDITOR_CLI_UNRESOLVED');
  const cli = path.resolve(path.dirname(launcher), relative);
  if (path.relative(path.dirname(code), cli).startsWith('..')) throw new Error('RELEASE_EDITOR_CLI_OUTSIDE_INSTALL');
  try {
    await execute(code, [cli, ...isolated, '--install-extension', archive, '--force'],
      { cwd: path.dirname(code), windowsHide: true, timeout: 120000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: desktop.home } });
    await execute(code, [...isolated, '--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
      '--remote-debugging-port=' + port, '--extensionDevelopmentPath=' + harness,
      '--extensionTestsPath=' + path.join(root, 'tests/native-release.cjs'), workspace.workspace], { cwd: path.dirname(code), windowsHide: true, timeout: 150000,
      env: { ...process.env, DSH_HOME: desktop.home, DSH_RELEASE_ROOT: root, DSH_RELEASE_EXTENSION_ID: metadata.id,
        DSH_RELEASE_EXTENSIONS: extensions, DSH_RELEASE_DEBUG_PORT: String(port), DSH_RELEASE_RESULT: resultFile,
        DSH_DESKTOP_ADDRESS: desktop.address, DSH_DESKTOP_NETWORK: desktop.network } });
    const result = JSON.parse(await readFile(resultFile, 'utf8'));
    process.kill(desktop.pid, 0);
    await desktopRpc(desktop.home, desktop.address, 'session/list', { _request: {} });
    result.desktopSurvivesDisconnect = true;
    const sessions = path.join(desktop.home, 'sessions');
    const headers = await Promise.all((await readdir(sessions, { recursive: true })).filter(file => file.endsWith('session.v4.jsonl.zstd'))
      .map(async file => JSON.parse(zstdDecompressSync(await readFile(path.join(sessions, file))).toString('utf8').split('\n')[0])));
    const submitted = headers.filter(header => header.id === result.promptSessionId);
    result.workspaceBound = submitted.length === 1 && submitted[0].cwd?.toLowerCase() === path.join(workspace.directory, 'b').toLowerCase();
    if (!passedInstalledAcceptance(result, version)) throw new Error('RELEASE_INSTALLED_SMOKE_INCOMPLETE');
    results.push(result); console.log('Desktop-connected VSIX acceptance passed: VS Code ' + version);
  } catch (error) {
    const failure = /** @type {{stdout?: string, stderr?: string, message: string}} */ (error);
    await writeFile(path.join(output, 'native-' + version + '.log'), failure.message + '\n' + (failure.stdout || '') + (failure.stderr || ''));
    throw new Error('RELEASE_INSTALLED_FAILED_' + version);
  } finally { await desktop.stop(); }
}
if (createHash('sha256').update(await readFile(archive)).digest('hex') !== sha256) throw new Error('RELEASE_ARCHIVE_CHANGED_DURING_TEST');
await writeFile(path.join(output, 'installed-check.json'), JSON.stringify({ version: metadata.version, sha256, results }, null, 2) + '\n');
