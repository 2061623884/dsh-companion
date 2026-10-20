// Opt-in actual installed VS Code + desktop account acceptance. No generation.
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url'), { createHash } = require('node:crypto'), assert = require('node:assert/strict');
exports.run = async () => {
  const root = path.resolve(__dirname, '..');
  const { RuntimeClient } = require('../dist/test/runtime/client'), { RuntimeConnection } = require('../dist/test/runtime/connection');
  const { frameHtml } = require('../dist/test/sidebar/view');
  const extension = vscode.extensions.getExtension('local-development.dsh-companion');
  const runtime = path.join(extension.extensionPath, 'runtime');
  const { importDesktopData } = await import(pathToFileURL(path.join(runtime, 'import.mjs')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-native-workbuddy-')), home = path.join(directory, 'home');
  // Initialize an owned empty home first: borrow auth without reimporting any
  // real desktop configuration, keys or history into this test directory.
  await importDesktopData(path.join(directory, 'no-source'), home);
  const source = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const sourceFile = path.join(source, 'profiles/desktop/.dsh-workbuddy-connect/.workbuddy-auth.json');
  const digest = value => createHash('sha256').update(value).digest('hex');
  const before = digest(await fs.readFile(sourceFile));
  for (const name of ['bootstrap.js', 'sidebar.js', 'sidebar.css']) await fs.copyFile(path.join(extension.extensionPath, 'dist', name), path.join(directory, name));
  await fs.appendFile(path.join(directory, 'bootstrap.js'), `
fetch('/plugins/dsh-workbuddy-connect/status').then(response=>response.json()).then(value=>parent.postMessage({source:'dsh-companion-sidebar',type:'trace',stage:value.status==='signed-in'?'workbuddy-signed-in':'workbuddy-failed',durationMs:0,bytes:value.models?.length||0},'*'));
`);
  const requestsFile = path.join(directory, 'requests.json');
  const previous = process.env.NODE_OPTIONS, previousNetwork = process.env.DSH_WORKBUDDY_TEST_NETWORK;
  process.env.NODE_OPTIONS = (previous || '') + ' --import=' + pathToFileURL(path.join(root, 'tests/workbuddy-readonly-guard.mjs'));
  process.env.DSH_WORKBUDDY_TEST_NETWORK = requestsFile;
  const client = new RuntimeClient(runtime, home, source);
  const connection = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, assetsDirectory: directory, acquire: () => client.acquire() });
  let panel, address;
  const result = { installedVersion: extension.packageJSON.version, vscodeVersion: vscode.version };
  try {
    const started = performance.now(), base = await connection.start(); address = await client.acquire();
    result.readyMs = Math.round(performance.now() - started);
    let status;
    for (let i = 0; i < 30; i++) {
      status = await (await fetch(base + '/plugins/dsh-workbuddy-connect/status')).json();
      if (status.catalog?.source === 'live') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(status.status, 'signed-in'); assert.equal(status.catalog?.source, 'live');
    result.signedInAutomatically = true; result.liveModelCount = status.models.length;
    const logout = await (await fetch(base + '/plugins/dsh-workbuddy-connect/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, 'x-workbuddy-login-key': status.loginKey }, body: JSON.stringify({ action: 'logout' }) })).json();
    assert.equal(logout.status, 'failed'); assert.match(logout.message, /只读/); result.logoutProtected = true;
    panel = vscode.window.createWebviewPanel('dshWorkBuddyAcceptance', 'DSH WorkBuddy read-only check', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native WorkBuddy webview did not confirm sign-in')), 15000);
      panel.webview.onDidReceiveMessage(message => {
        if (message.type !== 'trace') return;
        if (message.stage === 'workbuddy-signed-in') { clearTimeout(timer); result.nativeWebviewSignedIn = true; result.nativeWebviewModelCount = message.bytes; resolve(); }
        if (message.stage === 'workbuddy-failed') { clearTimeout(timer); reject(new Error('Native WorkBuddy status was signed out')); }
      });
      panel.webview.html = frameHtml(base);
    });
  } finally {
    panel?.dispose(); await connection.dispose(); client.dispose();
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    if (previousNetwork === undefined) delete process.env.DSH_WORKBUDDY_TEST_NETWORK; else process.env.DSH_WORKBUDDY_TEST_NETWORK = previousNetwork;
    if (address) for (let i = 0; i < 120; i++) {
      try { process.kill(address.pid, 0); }
      catch (error) { if (error.code === 'ESRCH') { result.ownedRuntimeExited = true; break; } throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    result.desktopCredentialUnchanged = before === digest(await fs.readFile(sourceFile));
    const requests = JSON.parse(await fs.readFile(requestsFile));
    result.refreshRequests = requests.filter(item => /\/auth\//.test(item.path) || item.refreshHeader).length;
    result.generationRequests = requests.filter(item => /chat\/completions/.test(item.path)).length;
    result.requests = requests;
    result.credentialCopied = false;
    for (const name of ['.dsh-workbuddy-connect/.workbuddy-auth.json', 'profiles/companion/.dsh-workbuddy-connect/.workbuddy-auth.json']) {
      try { await fs.access(path.join(home, name)); result.credentialCopied = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fs.writeFile(path.join(root, '.test-work/workbuddy-native.json'), JSON.stringify(result, null, 2));
  }
  assert.equal(result.desktopCredentialUnchanged, true); assert.equal(result.refreshRequests, 0);
  assert.equal(result.generationRequests, 0); assert.equal(result.credentialCopied, false); assert.equal(result.ownedRuntimeExited, true);
};
