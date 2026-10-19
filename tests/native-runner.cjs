// Run with Code --extensionDevelopmentPath . --extensionTestsPath tests/native-runner.cjs .test-work/fixtures.code-workspace
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
  assert.ok(frameHtml('http://127.0.0.1:12345').includes("event.source!==null"));
  sidebar.dispose(); context.dispose(); received.dispose(); disposed.dispose();
  await vscode.commands.executeCommand('dshCompanion.open');
  await new Promise(resolve => setTimeout(resolve, 6000));
  fs.writeFileSync(path.join(root, '.test-work', 'native-result.json'), JSON.stringify({ vscodeVersion: vscode.version, multiRoot: true,
    unsavedSelection: true, latestBuffer: true, focusRetained: true, outsideFileBlocked: true, hostBridgeWithActualEditor: true,
    openCommandCompleted: true, note: 'Editor and host bridge tested in real Extension Host; bridge transport injected, DOM validated separately.' }, null, 2));
};
