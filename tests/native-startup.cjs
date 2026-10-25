// Measure the actual SidebarView, runtime and Webview without touching user data.
const vscode = require('vscode'), fs = require('node:fs/promises'), path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
exports.run = async () => {
  const root = path.resolve(__dirname, '..'), directory = await fs.mkdtemp(path.join(root, '.test-work/startup-'));
  const { RuntimeClient } = require('../dist/test/runtime/client'), { RuntimeConnection } = require('../dist/test/runtime/connection');
  const { SidebarView } = require('../dist/test/sidebar/view'), { EditorContext } = require('../dist/test/context/editor-context');
  const source = path.join(directory, 'desktop'); await fs.mkdir(path.join(source, 'profiles/desktop'), { recursive: true });
  await fs.writeFile(path.join(source, 'profiles/desktop/cordis.patch.yml'), '[]\n');
  const runtime = path.join(root, 'runtime'), home = path.join(directory, 'home'), client = new RuntimeClient(runtime, home, source);
  const connection = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, desktopHome: source, assetsDirectory: directory, acquire: () => client.acquire() });
  const editor = new EditorContext(), cases = [];
  const previousOptions = process.env.NODE_OPTIONS, previousNetwork = process.env.DSH_WORKBUDDY_TEST_NETWORK;
  process.env.NODE_OPTIONS = '--import=' + pathToFileURL(path.join(root, 'tests/workbuddy-network-fixture.mjs'));
  process.env.DSH_WORKBUDDY_TEST_NETWORK = path.join(directory, 'network.json');
  let panel, sidebar;
  try {
    for(const name of ['sidebar.js', 'sidebar.css']) await fs.copyFile(path.join(root, 'dist', name), path.join(directory, name));
    await fs.writeFile(path.join(directory, 'bootstrap.js'), await fs.readFile(path.join(root, 'dist/bootstrap.js'), 'utf8') + `
      window.addEventListener('message',event=>{
        if(event.source!==parent||event.data?.type!=='startup-inspect')return;
        const resources=performance.getEntriesByType('resource');
        parent.postMessage({type:'startup-inspected',documentMs:Math.round(performance.now()),
          resources:resources.length,resourceBytes:resources.reduce((n,r)=>n+r.encodedBodySize,0),
          sessionCreates:resources.filter(r=>new URL(r.name).pathname==='/api/session/create').length,
          longestResources:resources.toSorted((a,b)=>b.duration-a.duration).slice(0,5).map(r=>({path:new URL(r.name).pathname,ms:Math.round(r.duration)}))},'*');
      });`);
    const file = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'main.py');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    for(let index = 0; index < 3; index++) {
      const started = performance.now(), sample = { mode: index === 0 ? 'cold' : 'warm-page', htmlWrites: 0 };
      panel = vscode.window.createWebviewPanel('dshStartupTest', 'DSH startup acceptance', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
      const actual = panel.webview;
      let base;
      const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Native startup did not reach usable chat')), 45000);
        actual.onDidReceiveMessage(message => {
          if(message.type === 'startup-inspected') { clearTimeout(timeout); sample.usableMs = Math.round(performance.now() - started); resolve(message); }
          if(message.type === 'ui-error') { clearTimeout(timeout); reject(new Error(message.code)); }
        });
      });
      const webview = new Proxy(actual, {
        get(target, key) { const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; },
        set(target, key, value) {
          if(key === 'html') {
            sample.htmlWrites++;
            if(value.includes('<iframe')) {
              value = value.replace('acquireVsCodeApi()', '(window.__startupApi=acquireVsCodeApi())');
              value = value.replace('</script>', `window.addEventListener('message',event=>{
                const iframe=document.querySelector('iframe');if(event.source!==iframe.contentWindow)return;
                if(event.data?.type==='ui-ready')iframe.contentWindow.postMessage({type:'startup-inspect'},'*');
                if(event.data?.type==='startup-inspected')window.__startupApi.postMessage(event.data);
              });</script>`);
            }
          }
          target[key] = value; return true;
        }
      });
      sidebar = new SidebarView(root, { start: async () => {
        base = await connection.start(); sample.backendReadyMs = Math.round(performance.now() - started);
        // Synthetic first-run notice only; no credentials and no model request.
        if(index === 0) await fetch(base + '/api/settings/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
          body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-welcome', method: 'settings/mutate', payload: { args: { ns: 'ui-settings-general',
            ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-09-28.1' }], expectedRevision: 0 } } }) });
        return base;
      } }, editor, { appendLine() {} });
      sidebar.resolveWebviewView({ webview, onDidDispose: panel.onDidDispose });
      Object.assign(sample, await ready); cases.push(sample);
      const htmlWrites = sample.htmlWrites;
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
      const reveal = performance.now(); panel.reveal();
      await new Promise(resolve => setTimeout(resolve, 100));
      sample.retainedRevealMs = Math.round(performance.now() - reveal);
      assert.equal(sample.htmlWrites, htmlWrites, 'showing the retained page must not reload it');
      panel.dispose(); panel = undefined; sidebar.dispose(); sidebar = undefined;
    }
  } finally {
    panel?.dispose(); sidebar?.dispose(); editor.dispose(); await connection.dispose(); client.dispose();
    if(previousOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previousOptions;
    if(previousNetwork === undefined) delete process.env.DSH_WORKBUDDY_TEST_NETWORK; else process.env.DSH_WORKBUDDY_TEST_NETWORK = previousNetwork;
    await fs.writeFile(path.join(root, '.test-work/native-startup-result.json'), JSON.stringify({ vscodeVersion: vscode.version, cases }, null, 2));
  }
  assert.equal(cases.length, 3);
  assert.ok(cases.slice(1).every(sample => sample.sessionCreates <= 1), 'reopening chat must not create an extra session after native restoration');
};
