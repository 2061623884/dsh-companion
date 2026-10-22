// Run through npm run test:native for a fresh synthetic workspace/profile.
const vscode = require('vscode'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
exports.run = async () => {
  const root = path.resolve(__dirname, '..'), { EditorContext } = require('../dist/test/context/editor-context');
  const { SidebarView, frameHtml } = require('../dist/test/sidebar/view');
  const extension = vscode.extensions.getExtension('local-development.dsh-companion');
  await extension.activate();
  const context = new EditorContext(), folder = vscode.workspace.workspaceFolders[1];
  const uri = vscode.Uri.joinPath(folder.uri, 'main.py');
  const document = await vscode.workspace.openTextDocument(uri), editor = await vscode.window.showTextDocument(document);
  await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '# UNSAVED_CONTEXT\n'));
  editor.selection = new vscode.Selection(0, 2, 0, 9);
  const selection = context.snapshot();
  assert.equal(selection.workspacePath, folder.uri.fsPath);
  assert.equal(selection.reference.kind, 'selection'); assert.equal(selection.reference.content, 'UNSAVED');
  assert.equal(selection.reference.range, '0:2-0:9'); assert.equal(selection.reference.unsaved, true);
  const latest = await context.read(uri.toString()); assert.match(latest.content, /^# UNSAVED_CONTEXT/);
  assert.ok(!fs.readFileSync(uri.fsPath, 'utf8').includes('UNSAVED_CONTEXT'));
  await vscode.commands.executeCommand('workbench.action.focusSideBar');
  assert.equal(context.snapshot().reference.uri, uri.toString());
  await assert.rejects(context.read(vscode.Uri.file(path.join(root, '..', 'not-in-workspace.py')).toString()), /只能引用/);
  const messages = [], received = new vscode.EventEmitter(), disposed = new vscode.EventEmitter();
  const view = { webview: { html: '', options: {}, onDidReceiveMessage: received.event, postMessage: async value => { messages.push(value); return true; } }, onDidDispose: disposed.event };
  const sidebar = new SidebarView(root, { start: async () => 'http://127.0.0.1:12345' }, context, { appendLine() {} });
  sidebar.resolveWebviewView(view); await new Promise(resolve => setTimeout(resolve, 10));
  received.fire({ type: 'ready' }); assert.equal(messages[0].context.reference.content, 'UNSAVED');
  received.fire({ type: 'read-reference', uri: uri.toString(), requestId: 'native-1' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(messages.find(message => message.requestId === 'native-1').value.content, /UNSAVED_CONTEXT/);
  assert.match(frameHtml('http://127.0.0.1:12345', path.join(root, 'media/whale.svg')), /event\.origin\s*!==\s*window\.origin/);
  sidebar.dispose(); context.dispose(); received.dispose(); disposed.dispose();
  // Exercise the shipped wrapper in an actual VS Code webview, not a simulated window.postMessage.
  const bridgeContext = new EditorContext(), http = require('node:http'), bridgeEvents = [];
  const server = http.createServer((req, res) => {
    bridgeEvents.push({ request: req.url });
    res.setHeader('content-type', 'text/html');
    res.end(`<html><body><script>
const post=data=>parent.postMessage({source:'dsh-companion-sidebar',...data},'*');
window.addEventListener('message',event=>{if(event.source!==parent)return;const data=event.data;
if(data.type==='editor-context')post({type:'read-reference',requestId:'real-transport',uri:data.context.reference.uri});
if(data.type==='reference-result'&&data.requestId==='real-transport'&&data.value.content.includes('UNSAVED_CONTEXT'))post({type:'trace',stage:'reference-roundtrip',durationMs:0,bytes:data.value.content.length});});post({type:'hello'});
</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const panel = vscode.window.createWebviewPanel('dshCompanionTransportTest', 'DSH bridge test', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
  let bridgeMs;
  try {
    const started = performance.now();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { fs.writeFileSync(path.join(root, '.test-work', 'bridge-debug.json'), JSON.stringify(bridgeEvents)); reject(new Error('Actual webview bridge did not complete')); }, 10000);
      panel.webview.onDidReceiveMessage(async message => {
        bridgeEvents.push({ type: message.type });
        if (message.type === 'ready') await panel.webview.postMessage({ type: 'context', context: bridgeContext.snapshot() });
        if (message.type === 'read-reference') await panel.webview.postMessage({ type: 'reference-result', requestId: message.requestId, value: await bridgeContext.read(message.uri) });
        if (message.type === 'trace' && message.stage === 'reference-roundtrip') { clearTimeout(timeout); bridgeMs = Math.round(performance.now() - started); resolve(); }
      });
      panel.webview.html = frameHtml(`http://127.0.0.1:${server.address().port}`, path.join(root, 'media/whale.svg'));
    });
  } finally { panel.dispose(); bridgeContext.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await vscode.commands.executeCommand('dshCompanion.open');
  await new Promise(resolve => setTimeout(resolve, 6000));
  fs.writeFileSync(path.join(root, '.test-work', 'native-result.json'), JSON.stringify({ vscodeVersion: vscode.version, multiRoot: true,
    unsavedSelection: true, latestBuffer: true, focusRetained: true, outsideFileBlocked: true, hostBridgeWithActualEditor: true,
    openCommandCompleted: true, actualWebviewRoundtrip: true, webviewLoadAndRoundtripMs: bridgeMs,
    note: 'Real editor and shipped frame wrapper transport verified; native DSH GUI validated separately with intercepted prompts.' }, null, 2));
};
const nativeRun = exports.run;
exports.run = async () => { try { await nativeRun(); } catch (error) { fs.writeFileSync(path.resolve(__dirname, '../.test-work/native-error.txt'), error.stack); throw error; } };
