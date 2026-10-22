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

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Release acceptance requires Windows x64');
const root = process.cwd(), metadata = await releaseMetadata(root), output = path.join(root, '.test-work/release');
const archive = path.join(output, metadata.filename), bytes = await readFile(archive);
const sha256 = createHash('sha256').update(bytes).digest('hex');
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
  const fixture = await prepareTestWorkspace(root), profile = path.join(fixture.directory, 'profile'), extensions = path.join(fixture.directory, 'extensions');
  const harness = path.join(fixture.directory, 'harness'), resultFile = path.join(fixture.directory, 'result.json');
  await mkdir(harness); await writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'release-harness', publisher: 'synthetic',
    version: '0.0.0', engines: { vscode: manifest.engines.vscode }, main: './index.cjs' }));
  await writeFile(path.join(harness, 'index.cjs'), 'exports.activate = () => {};\n');
  const debugServer = net.createServer(); await new Promise(resolve => debugServer.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {net.AddressInfo} */ (debugServer.address()).port;
  await new Promise(resolve => debugServer.close(resolve));
  const isolated = ['--user-data-dir', profile, '--extensions-dir', extensions];
  const launcher = resolveCliPathFromVSCodeExecutablePath(code, 'win32-x64-archive');
  const relativeCLI = (await readFile(launcher, 'utf8')).match(/"%~dp0([^"\r\n]*\\resources\\app\\out\\cli\.js)"/i)?.[1];
  if (!relativeCLI) throw new Error('RELEASE_EDITOR_CLI_UNRESOLVED');
  const cli = path.resolve(path.dirname(launcher), relativeCLI);
  if (path.relative(path.dirname(code), cli).startsWith('..')) throw new Error('RELEASE_EDITOR_CLI_OUTSIDE_INSTALL');
  // Invoke the editor's actual CLI through Electron's Node mode, with no shell quoting.
  let stage = 'install';
  try {
    await execute(code, [cli, ...isolated, '--install-extension', archive, '--force'],
      { windowsHide: true, timeout: 120000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: fixture.desktop } });
    stage = 'run';
    await execute(code, [...isolated, '--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
      '--remote-debugging-port=' + port, '--extensionDevelopmentPath=' + harness,
      '--extensionTestsPath=' + path.join(root, 'tests/native-release.cjs'), fixture.workspace], { windowsHide: true, timeout: 150000,
      env: { ...process.env, DSH_HOME: fixture.desktop, DSH_RELEASE_ROOT: root, DSH_RELEASE_EXTENSION_ID: metadata.id,
        DSH_RELEASE_EXTENSIONS: extensions, DSH_RELEASE_DEBUG_PORT: String(port), DSH_RELEASE_RESULT: resultFile } });
  } catch (error) {
    const failure = /** @type {{stdout?: string, stderr?: string}} */ (error);
    await writeFile(path.join(output, 'native-' + version + '.log'), (failure.stdout || '') + (failure.stderr || ''));
    try {
      const probe = JSON.parse(await readFile(resultFile, 'utf8'));
      const phase = Number.isInteger(probe.phase) && probe.phase >= 0 && probe.phase <= 10 ? probe.phase : -1;
      const frames = Number.isInteger(probe.iframeTargets) && probe.iframeTargets >= 0 && probe.iframeTargets <= 100 ? probe.iframeTargets : -1;
      const prompts = Number.isInteger(probe.interceptedPrompts) && probe.interceptedPrompts >= 0 && probe.interceptedPrompts <= 10 ? probe.interceptedPrompts : -1;
      console.error('Release installed probe: phase=' + phase + ', frames=' + frames + ', prompts=' + prompts);
    } catch (probeError) {
      if (/** @type {NodeJS.ErrnoException} */ (probeError).code !== 'ENOENT') throw probeError;
      console.error('Release installed probe: result unavailable');
    }
    throw new Error('RELEASE_INSTALLED_' + stage.toUpperCase() + '_FAILED_' + version);
  }
  const result = JSON.parse(await readFile(resultFile, 'utf8'));
  if (!Number.isInteger(result.runtimePid) || result.runtimePid <= 0) throw new Error('RELEASE_RUNTIME_PID_MISSING');
  for (let attempt = 0; attempt < 150; attempt++) {
    try { process.kill(result.runtimePid, 0); }
    catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error;
      result.ownedRuntimeExited = true; break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  delete result.runtimePid;
  if (!result.ownedRuntimeExited) throw new Error('RELEASE_RUNTIME_EXIT_TIMEOUT');
  const sessions = path.join(profile, 'User/globalStorage', metadata.id, 'dsh/sessions');
  const headers = await Promise.all((await readdir(sessions, { recursive: true })).filter(file => file.endsWith('session.v4.jsonl.zstd'))
    .map(async file => JSON.parse(zstdDecompressSync(await readFile(path.join(sessions, file))).toString('utf8').split('\n')[0])));
  // First-use UI can also create an empty default session. Check the session actually submitted.
  const submitted = headers.filter(header => header.id === result.promptSessionId);
  result.workspaceBound = submitted.length === 1 && submitted[0].cwd?.toLowerCase() === path.join(fixture.directory, 'b').toLowerCase();
  if (result.vscodeVersion !== version || !result.installedPackage || !result.workspaceBound || !result.unsavedReference ||
    !result.draftRestored || !result.desktopUnchanged || !result.ownedRuntimeExited || !result.sharedLogin || !result.sharedSignOut || !result.loadingDismissed ||
    result.interceptedPrompts !== 1 || result.generationCalls !== 0) throw new Error('RELEASE_INSTALLED_SMOKE_INCOMPLETE');
  results.push(result); console.log('Installed VSIX acceptance passed: VS Code ' + version);
}
if (createHash('sha256').update(await readFile(archive)).digest('hex') !== sha256) throw new Error('RELEASE_ARCHIVE_CHANGED_DURING_TEST');
await writeFile(path.join(output, 'installed-check.json'), JSON.stringify({ version: metadata.version, sha256, results }, null, 2) + '\n');
