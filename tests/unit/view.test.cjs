const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
const load = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? { commands: { executeCommand: async () => {} }, env: {}, workspace: { getConfiguration: () => ({ get: () => false }) } } : load.call(this, name, ...args);
};
const { SidebarView, frameHtml } = require('../../dist/test/sidebar/view');
Module._load = load;
const file = { kind: 'file', uri: 'file:///a.py', name: 'a.py', version: 1 };
test('the whale remains visible after backend readiness while the chat page loads', async () => {
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference: file }) };
  const sidebar = new SidebarView(path.resolve('.'), { start: async () => 'http://127.0.0.1:1234' }, editor, {}), view = webview();
  sidebar.resolveWebviewView(view.value);
  assert.match(view.value.webview.html, /class="digit-stream"/);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(view.value.webview.html, /<iframe/);
  assert.match(view.value.webview.html, /class="digit-stream"/, 'backend readiness must not remove the loading animation');
  sidebar.dispose();
});
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

test('iframe load cannot drain references before the adapter installs its listener', async () => {
  const vm = require('node:vm'), view = webview();
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference: file }) };
  const sidebar = new SidebarView(path.resolve('.'), { start: async () => 'http://127.0.0.1:1234' }, editor, {});
  sidebar.resolveWebviewView(view.value); await new Promise(resolve => setImmediate(resolve));
  await sidebar.referenceCurrent();
  let onMessage, onLoad, listening = false;
  const received = [], target = { postMessage(value) { if (listening) received.push(value); } };
  const frame = { src: 'http://127.0.0.1:1234/', contentWindow: target, addEventListener(event, callback) { if (event === 'load') onLoad = callback; } };
  view.value.webview.postMessage = async value => { onMessage({ origin: 'webview-origin', data: value }); return true; };
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(frameHtml('http://127.0.0.1:1234', path.resolve('media/whale.svg')))[1];
  vm.runInNewContext(script, { URL, window: { origin: 'webview-origin', addEventListener(event, callback) { onMessage = callback; } },
    document: { querySelector: () => frame, body: { classList: { contains: () => false } }, documentElement: {} },
    acquireVsCodeApi: () => ({ postMessage: view.receive }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class { observe() {} } });
  onLoad(); listening = true;
  onMessage({ source: target, origin: 'http://127.0.0.1:1234', data: { source: 'dsh-companion-sidebar', type: 'hello' } });
  assert.deepEqual(received.filter(value => value.type === 'editor-reference').map(value => value.reference.name), ['a.py']);
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

test('only the current iframe visual readiness reveals chat; load and handshake keep the whale', () => {
  const vm = require('node:vm'), attrs = new Map(), frameAttrs = new Map();
  let onMessage, onLoad;
  const target = { postMessage() {} }, frame = { src: 'http://127.0.0.1:1234/', contentWindow: target, inert: true,
    setAttribute: (key, value) => frameAttrs.set(key, value), addEventListener(event, callback) { if(event === 'load') onLoad = callback; } };
  const loading = { setAttribute: (key, value) => attrs.set(key, value) };
  const html = frameHtml('http://127.0.0.1:1234', path.resolve('media/whale.svg'));
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)[1];
  vm.runInNewContext(script, { URL, window: { origin: 'webview-origin', addEventListener(event, callback) { onMessage = callback; } },
    document: { querySelector: () => frame, getElementById: () => loading, body: { classList: { contains: () => false } }, documentElement: {} },
    acquireVsCodeApi: () => ({ postMessage() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }), MutationObserver: class { observe() {} } });
  const send = (type, source = target, origin = 'http://127.0.0.1:1234') => onMessage({ source, origin, data: { source: 'dsh-companion-sidebar', type } });
  onLoad(); send('hello'); send('ui-ready', {}); send('ui-ready', target, 'http://other.invalid');
  assert.equal(attrs.has('data-ready'), false); assert.equal(frame.inert, true);
  send('ui-ready');
  assert.equal(attrs.has('data-ready'), true); assert.equal(attrs.get('aria-hidden'), 'true'); assert.equal(frame.inert, false);
  assert.equal(frameAttrs.get('aria-busy'), 'false');
});
