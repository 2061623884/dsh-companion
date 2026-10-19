// Opt-in integration check. Requires desktop DSH to be fully exited first.
// Opens the desktop window to verify singleton reuse; never stops the shared backend.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process'), { createHash } = require('node:crypto');
const { DesktopConnection } = require('../dist/test/desktop/connection');
const powershell = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
function inventory() {
  return JSON.parse(powershell(String.raw`
$ErrorActionPreference = 'Stop'
$all = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'")
$shells = @($all | Where-Object { $_.CommandLine -notmatch '--type=|--expose-internals|[\\/]dsh-desktop-host[\\/]lib[\\/]' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId; @{ pid = $p.Id; visible = ($p.MainWindowHandle -ne 0) } })
$hosts = @($all | Where-Object { $_.CommandLine -match '[\\/]dsh-desktop-host[\\/]lib[\\/]index\.js' } | ForEach-Object { @{ pid = $_.ProcessId; parentPid = $_.ParentProcessId } })
@{ shells = $shells; hosts = $hosts } | ConvertTo-Json -Compress -Depth 4`));
}
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
function preservedData() {
  const directory = path.join(home, 'profiles/desktop');
  return { config: ['cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml'].map(name => createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')),
    history: fs.readdirSync(path.join(home, 'sessions')).sort() };
}
(async () => {
  const initial = inventory();
  assert.equal(initial.shells.length, 0, 'Fully exit desktop DSH before running this opt-in check');
  assert.equal(initial.hosts.length, 0);
  const preserved = preservedData(), connections = [];
  const makeConnection = () => { const connection = new DesktopConnection({ assetsDirectory: path.resolve(__dirname, '../dist') }); connections.push(connection); return connection; };
  try {
    const begin = performance.now();
    const urls = await Promise.all([makeConnection().start(), makeConnection().start()]);
    const startupMs = Math.round(performance.now() - begin), hidden = inventory();
    assert.equal(hidden.hosts.length, 1); assert.equal(hidden.shells.length, 1); assert.equal(hidden.shells[0].visible, false);
    for (const url of urls) { const response = await fetch(url + '/?dsh-companion=1'); assert.equal(response.status, 200); assert.match(await response.text(), /__dsh_companion\/bootstrap.js/); }
    for (const connection of connections.splice(0)) await connection.dispose();
    await makeConnection().start();
    assert.deepEqual(inventory().hosts, hidden.hosts, 'Closing and reopening the plugin must reuse the backend');
    powershell(String.raw`$ErrorActionPreference = 'Stop'; $shell = Get-CimInstance Win32_Process -Filter "ProcessId=${hidden.shells[0].pid}"; Start-Process -FilePath $shell.ExecutablePath -WindowStyle Hidden`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const desktop = inventory();
    assert.deepEqual(desktop.hosts, hidden.hosts, 'Opening desktop must retain the exact backend PID');
    assert.equal(desktop.shells.length, 1); assert.equal(desktop.shells[0].visible, true);
    await makeConnection().start();
    assert.deepEqual(inventory().hosts, hidden.hosts, 'Opening plugin after desktop must reuse the same backend');
    assert.deepEqual(preservedData(), preserved, 'Desktop plugin configuration and history IDs must be preserved');
    const result = { startupMs, concurrentClients: 2, hiddenStartup: true, pluginFirstThenDesktop: true, desktopFirstThenPlugin: true,
      reopenPluginReusesBackend: true, backendCount: 1, sameBackendPid: true, configurationHashesUnchanged: true,
      historyIdsUnchanged: true, modelCalled: false, ownedTestShellPid: hidden.shells[0].pid, backendPid: hidden.hosts[0].pid };
    fs.mkdirSync(path.join(__dirname, '../.test-work'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '../.test-work/windows-startup.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await Promise.all(connections.map(connection => connection.dispose())); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
