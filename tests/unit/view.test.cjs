const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
const load = Module._load;
Module._load = function (name, ...args) {
  return name === 'vscode' ? { commands: { executeCommand: async () => {} }, env: {}, workspace: { getConfiguration: () => ({ get: () => false }) } } : load.call(this, name, ...args);
};
const { SidebarView, frameHtml } = require('../../dist/test/sidebar/view');
Module._load = load;
const file = { kind: 'file', uri: 'file:///a.py', name: 'a.py', version: 1 };

test('missing and stopped desktop screens offer the corresponding user action', async () => {
  for (const [code,action] of [['DSH_DESKTOP_NOT_INSTALLED','install-desktop'],['DSH_DESKTOP_NOT_RUNNING','open-desktop']]) {
    const editor={onChange:()=>({dispose(){}}),snapshot:()=>({reference:null})};
    const sidebar=new SidebarView(path.resolve('.'),{start:async()=>{throw Object.assign(new Error('Synthetic desktop status'),{code});}},editor,{appendLine(){}}), view=webview();
    sidebar.resolveWebviewView(view.value);await new Promise(resolve=>setImmediate(resolve));
    assert.match(view.value.webview.html,new RegExp('data-action="'+action+'"'));
    assert.doesNotMatch(view.value.webview.html,/<iframe|不依赖桌面/);sidebar.dispose();
  }
});
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
    document: { querySelector: () => frame, getElementById: () => ({ addEventListener() {} }), body: { classList: { contains: () => false } }, documentElement: {} },
    acquireVsCodeApi: () => ({ postMessage: view.receive }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class { observe() {} }, setTimeout: () => 0, clearTimeout() {} });
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
  const loading = { setAttribute: (key, value) => attrs.set(key, value), addEventListener() {} };
  const html = frameHtml('http://127.0.0.1:1234', path.resolve('media/whale.svg'));
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)[1];
  vm.runInNewContext(script, { URL, window: { origin: 'webview-origin', addEventListener(event, callback) { onMessage = callback; } },
    document: { querySelector: () => frame, getElementById: () => loading, body: { classList: { contains: () => false } }, documentElement: {} },
    acquireVsCodeApi: () => ({ postMessage() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }), MutationObserver: class { observe() {} },
    setTimeout: () => 0, clearTimeout() {} });
  const send = (type, source = target, origin = 'http://127.0.0.1:1234') => onMessage({ source, origin, data: { source: 'dsh-companion-sidebar', type } });
  onLoad(); send('hello'); send('ui-ready', {}); send('ui-ready', target, 'http://other.invalid');
  assert.equal(attrs.has('data-ready'), false); assert.equal(frame.inert, true);
  send('ui-ready');
  assert.equal(attrs.has('data-ready'), true); assert.equal(attrs.get('aria-hidden'), 'true'); assert.equal(frame.inert, false);
  assert.equal(frameAttrs.get('aria-busy'), 'false');
});

test('an explicit UI retry reconnects the backend and starts a fresh blocked page', async () => {
  let reconnects = 0;
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference: file }) };
  const sidebar = new SidebarView(path.resolve('.'), { start: async () => 'http://127.0.0.1:1234',
    reconnect: async () => { reconnects++; return 'http://127.0.0.1:1234'; } }, editor, { appendLine() {} }), view = webview();
  sidebar.resolveWebviewView(view.value); await new Promise(resolve => setImmediate(resolve));
  view.receive({ type: 'ui-error', code: 'DSH_UI_STYLE_FAILED' }); view.receive({ type: 'retry' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reconnects, 1); assert.match(view.value.webview.html, /<iframe inert/);
  view.receive({ type: 'ready' }); assert.equal(view.messages.at(-1).type, 'context');
  sidebar.dispose();
});

test('desktop recovery preserves the page, pending references and a reference read already in flight', async () => {
  let reconnect, finishRead, finishFocus, reconnects = 0;
  const startIntents = [];
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference: file }),
    read: () => new Promise(resolve => { finishRead = resolve; }) };
  const connection = { start: async () => 'http://127.0.0.1:1234',
    reconnect: options => { reconnects++; startIntents.push(options?.startDesktop); return new Promise(resolve => { reconnect = resolve; }); } };
  const sidebar = new SidebarView(path.resolve('.'), connection, editor, { appendLine() {} }), view = webview();
  sidebar.resolveWebviewView(view.value); await new Promise(resolve => setImmediate(resolve));
  view.receive({ type: 'ready' });
  const html = view.value.webview.html;
  view.receive({ type: 'read-reference', requestId: 'pending-read', uri: file.uri });
  sidebar.show = () => new Promise(resolve => { finishFocus = resolve; });
  const reference = sidebar.referenceCurrent();
  const outage = Object.assign(new Error('Synthetic outage'), { code: 'DSH_DESKTOP_NOT_READY' });
  const recovery = sidebar.desktopUnavailable(outage);
  assert.equal(sidebar.desktopUnavailable(outage), recovery, 'one recovery loop owns this outage');
  assert.equal(reconnects, 1);
  assert.deepEqual(startIntents, [false], 'automatic recovery must not undo an explicit Desktop quit');
  assert.equal(view.value.webview.html, html, 'outage must not replace the iframe owning session selection and drafts');
  finishFocus(); await reference;
  finishRead({ content: 'synthetic unsaved content' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.messages.filter(message => message.type === 'manual-reference').length, 1);
  assert.equal(view.messages.find(message => message.requestId === 'pending-read').value.content, 'synthetic unsaved content');
  reconnect('http://127.0.0.1:1234'); await recovery;
  assert.equal(view.value.webview.html, html, 'transport recovery must not reload the page');
  assert.deepEqual(view.messages.filter(message => message.type === 'connection-status').map(message => message.state), ['reconnecting', 'available']);
  sidebar.dispose();
});

test('failed recovery leaves the existing page usable and an explicit reconnect still preserves it', async () => {
  let attempts = 0;
  const startIntents = [];
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference: file }) };
  const sidebar = new SidebarView(path.resolve('.'), { start: async () => 'http://127.0.0.1:1234', reconnect: async options => {
    startIntents.push(options?.startDesktop);
    if (++attempts === 1) throw Object.assign(new Error('Synthetic ambiguous Host'), { code: 'DSH_DESKTOP_MULTIPLE' });
    return 'http://127.0.0.1:1234';
  } }, editor, { appendLine() {} }), view = webview();
  sidebar.resolveWebviewView(view.value); await new Promise(resolve => setImmediate(resolve));
  view.receive({ type: 'ready' });
  const html = view.value.webview.html;
  await sidebar.desktopUnavailable(Object.assign(new Error('Synthetic outage'), { code: 'DSH_DESKTOP_NOT_READY' }));
  assert.equal(view.messages.at(-1).state, 'unavailable');
  assert.equal(view.value.webview.html, html);
  view.receive({ type: 'reconnect' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.deepEqual(startIntents, [false, true]);
  assert.equal(view.messages.at(-1).state, 'available');
  assert.equal(view.value.webview.html, html);
  sidebar.dispose();
});

test('an old recovery cannot update a replacement page', async () => {
  let completeRecovery;
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference: file }) };
  const sidebar = new SidebarView(path.resolve('.'), { start: async () => 'http://127.0.0.1:1234',
    reconnect: () => new Promise(resolve => { completeRecovery = resolve; }) }, editor, { appendLine() {} });
  const first = webview(); sidebar.resolveWebviewView(first.value); await new Promise(resolve => setImmediate(resolve));
  first.receive({ type: 'ready' });
  const recovery = sidebar.desktopUnavailable(Object.assign(new Error('Synthetic outage'), { code: 'DSH_DESKTOP_NOT_READY' }));
  first.close();
  const replacement = webview(); sidebar.resolveWebviewView(replacement.value); await new Promise(resolve => setImmediate(resolve));
  completeRecovery('http://127.0.0.1:1234'); await recovery;
  assert.equal(replacement.messages.some(message => message.type === 'connection-status'), false);
  sidebar.dispose();
});

test('the reconnect-backend command preserves a ready page instead of reloading its draft container', async () => {
  const startIntents = [];
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference: file }) };
  const sidebar = new SidebarView(path.resolve('.'), { start: async () => 'http://127.0.0.1:1234', reconnect: async options => {
    startIntents.push(options?.startDesktop); return 'http://127.0.0.1:1234';
  } }, editor, { appendLine() {} }), view = webview();
  sidebar.resolveWebviewView(view.value); await new Promise(resolve => setImmediate(resolve));
  view.receive({ type: 'ready' });
  const html = view.value.webview.html;
  await sidebar.refresh();
  assert.ok(view.value.webview.html === html, 'the reconnect command must preserve the current page');
  assert.deepEqual(startIntents, [true]);
  assert.equal(view.messages.at(-1).state, 'available');
  sidebar.dispose();
});

test('a user reconnect during automatic recovery requests startup on the next attempt without another loop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = [], startIntents = [];
  const editor = { onChange: () => ({ dispose() {} }), snapshot: () => ({ reference: file }) };
  const sidebar = new SidebarView(path.resolve('.'), { start: async () => 'http://127.0.0.1:1234', reconnect: options => {
    startIntents.push(options.startDesktop);
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  } }, editor, { appendLine() {} }), view = webview();
  t.after(() => sidebar.dispose());
  sidebar.resolveWebviewView(view.value); await new Promise(resolve => setImmediate(resolve));
  view.receive({ type: 'ready' });
  const html = view.value.webview.html;
  const outage = Object.assign(new Error('Synthetic outage'), { code: 'DSH_DESKTOP_NOT_RUNNING' });
  const automatic = sidebar.desktopUnavailable(outage), explicit = sidebar.refresh();
  assert.equal(explicit, automatic);
  assert.deepEqual(startIntents, [false]);
  pending[0].reject(outage); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(1500); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(startIntents, [false, true]);
  pending[1].resolve('http://127.0.0.1:1234'); await automatic;
  assert.ok(view.value.webview.html === html);
  const next = sidebar.desktopUnavailable(outage);
  assert.deepEqual(startIntents, [false, true, false], 'the consumed user request must not authorize later automatic starts');
  pending[2].resolve('http://127.0.0.1:1234'); await next;
});
