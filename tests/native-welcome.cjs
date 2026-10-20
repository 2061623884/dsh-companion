// Opt-in real VS Code Webview check. Uses an empty owned home and no model calls.
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
exports.run = async () => {
  const root = path.resolve(__dirname, '..');
  const { RuntimeClient } = require('../dist/test/runtime/client');
  const { RuntimeConnection } = require('../dist/test/runtime/connection');
  const { frameHtml } = require('../dist/test/sidebar/view');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-native-welcome-check-'));
  for (const name of ['bootstrap.js', 'sidebar.js', 'sidebar.css']) await fs.copyFile(path.join(root, 'dist', name), path.join(directory, name));
  await fs.appendFile(path.join(directory, 'bootstrap.js'), `
(() => {
  const started = performance.now(); let clickedAt;
  const post = stage => parent.postMessage({source:'dsh-companion-sidebar',type:'trace',stage,durationMs:performance.now()-(clickedAt ?? started)},'*');
  const timer = setInterval(() => {
    const heading = [...document.querySelectorAll('h1,h2,h3')].find(element => /预览版说明|Preview Notice/.test(element.textContent));
    if (heading && clickedAt === undefined) {
      const button = [...heading.closest('[role=dialog]').querySelectorAll('button')].find(element => /继续|Continue/.test(element.textContent));
      if (button) { post('welcome-visible'); clickedAt=performance.now(); button.click(); }
    }
    if (clickedAt !== undefined && !heading) { clearInterval(timer); post('welcome-dismissed'); }
    if (document.body.textContent.includes('暂时无法保存确认状态')) { clearInterval(timer); post('welcome-failed'); }
  }, 100);
})();`);
  const runtime = path.join(root, 'runtime'), home = path.join(directory, 'home');
  const client = new RuntimeClient(runtime, home, path.join(directory, 'no-source'));
  const connection = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, assetsDirectory: directory, acquire: () => client.acquire() });
  let panel; const traces = [];
  try {
    const started = performance.now(), base = await connection.start();
    traces.push({ stage: 'runtime-ready', ms: Math.round(performance.now() - started) });
    panel = vscode.window.createWebviewPanel('dshWelcomeAcceptance', 'DSH confirmation check', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview confirmation did not complete')), 15000);
      panel.webview.onDidReceiveMessage(message => {
        if (message.type !== 'trace') return;
        traces.push({ stage: message.stage, ms: Math.round(message.durationMs) });
        if (message.stage === 'welcome-dismissed') { clearTimeout(timer); resolve(); }
        if (message.stage === 'welcome-failed') { clearTimeout(timer); reject(new Error('Preview confirmation could not be saved')); }
      });
      panel.webview.html = frameHtml(base);
    });
    const response = await fetch(base + '/api/settings/describe', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ type: 'client-request', rpcId: require('node:crypto').randomUUID(), method: 'settings/describe', payload: { args: {} } }) });
    const result = (await response.json()).result;
    assert.equal(result.ok, true);
    assert.equal(result.value.namespaces.find(item => item.ns === 'ui-settings-general').value.welcomeNoticeVersion, '2026-09-28.1');
    traces.push({ stage: 'confirmation-persisted' });
  } finally {
    await fs.writeFile(path.join(root, '.test-work/welcome-native.json'), JSON.stringify(traces, null, 2));
    panel?.dispose(); await connection.dispose(); client.dispose();
  }
};
