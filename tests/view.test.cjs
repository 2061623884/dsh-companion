const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
const load = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? { commands: { executeCommand: async () => {} }, env: {}, workspace: { getConfiguration: () => ({ get: () => false }) } } : load.call(this, name, ...args);
};
const { SidebarView } = require('../dist/test/sidebar/view');
Module._load = load;
const file = { kind: 'file', uri: 'file:///a.py', name: 'a.py', version: 1 };
function webview() {
  let receive, dispose; const messages = [];
  return { messages, receive: value => receive(value), close: () => dispose(),
    value: { webview: { onDidReceiveMessage: callback => { receive = callback; return { dispose() {} }; }, postMessage: async value => { messages.push(value); return true; } }, onDidDispose: callback => { dispose = callback; } } };
}
test('multiple manual references queued before ready arrive in order without overwrite', async () => {
  let reference = file;
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference }) };
  const sidebar = new SidebarView(path.resolve('.'), { start: async () => 'http://127.0.0.1:1234' }, editor, {}), view = webview();
  sidebar.resolveWebviewView(view.value); await new Promise(resolve => setImmediate(resolve));
  await sidebar.referenceCurrent(); reference = { ...file, uri: 'file:///b.py', name: 'b.py' }; await sidebar.referenceCurrent();
  assert.equal(view.messages.length, 0); view.receive({ type: 'ready' });
  assert.deepEqual(view.messages.filter(value => value.type === 'manual-reference').map(value => value.reference.name), ['a.py', 'b.py']);
  view.receive({ type: 'ready' }); assert.equal(view.messages.filter(value => value.type === 'manual-reference').length, 2);
  sidebar.dispose();
});
test('a file read from a disposed page cannot deliver into its replacement', async () => {
  let finish;
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference: file }), read: () => new Promise(resolve => { finish = resolve; }) };
  const sidebar = new SidebarView(path.resolve('.'), { start: async () => 'http://127.0.0.1:1234' }, editor, {}), first = webview();
  sidebar.resolveWebviewView(first.value); await new Promise(resolve => setImmediate(resolve));
  first.receive({ type: 'read-reference', requestId: '1', uri: file.uri }); first.close();
  const next = webview(); sidebar.resolveWebviewView(next.value); finish({ content: 'old page' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(next.messages.length, 0);
  sidebar.dispose();
});
