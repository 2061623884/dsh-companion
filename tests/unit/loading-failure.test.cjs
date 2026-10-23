const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const fs = require('node:fs'), path = require('node:path'), { buildSync } = require('esbuild'), Module = require('node:module');
const original = Module._load;
Module._load = function(name, ...args) { return name === 'vscode' ? {} : original.call(this, name, ...args); };
const { frameHtml } = require('../../dist/test/sidebar/view');
Module._load = original;

function wrapper() {
  const messages = [], timers = new Map(), attributes = new Map(), events = {};
  const status = { textContent: '' }, retry = { hidden: true, addEventListener: (name, fn) => { events[name] = fn; } };
  const loading = { setAttribute: (key, value) => attributes.set(key, value), querySelector: () => status };
  const peer = { postMessage() {} }, frame = { src: 'http://127.0.0.1:1234/', contentWindow: peer, inert: true, setAttribute() {}, addEventListener() {} };
  let receive;
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(frameHtml('http://127.0.0.1:1234', path.resolve('media/whale.svg')))[1];
  vm.runInNewContext(script, { URL, window: { origin: 'webview-origin', addEventListener(name, fn) { if(name === 'message') receive = fn; } },
    document: { querySelector: () => frame, getElementById: id => id === 'dsh-companion-retry' ? retry : loading,
      body: { classList: { contains: () => false } }, documentElement: {} },
    acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class { observe() {} }, setTimeout(fn, ms) { timers.set(fn, ms); return fn; }, clearTimeout(fn) { timers.delete(fn); } });
  return { messages, timers, attributes, status, retry, frame, click: () => events.click(),
    send: data => receive({ source: peer, origin: 'http://127.0.0.1:1234', data: { source: 'dsh-companion-sidebar', ...data } }) };
}

test('a CSS resource error from the real layout reaches its failure callback', () => {
  const handlers = {}, element = () => ({ append() {}, remove() {}, setAttribute() {}, addEventListener(name, fn) { handlers[name] = fn; } });
  const body = { ...element(), dataset: {} }, module = { exports: {} }, failures = [];
  const code = buildSync({ entryPoints: ['src/sidebar/client/layout-adapter.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  vm.runInNewContext(code, { module, exports: module.exports, document: { body, head: { append() {} }, createElement: element, createTextNode: value => value },
    MutationObserver: class { observe() {} }, requestAnimationFrame() { return 1; } });
  module.exports.createSidebarLayout({ layout: { closeRightbar() {}, panelInfo: { subscribe: () => () => {} } }, sessions: { list: { subscribe: () => () => {} } } },
    () => {}, () => {}, () => {}, code => failures.push(code));
  assert.equal(typeof handlers.error, 'function', 'stylesheet errors need a failure exit');
  handlers.error(); assert.deepEqual(failures, ['DSH_UI_STYLE_FAILED']);
});

test('UI failure keeps the iframe blocked, explains the failure and offers retry', () => {
  const f = wrapper(); f.send({ type: 'ui-error', code: 'DSH_UI_STYLE_FAILED' });
  assert.equal(f.attributes.has('data-error'), true); assert.match(f.status.textContent, /样式/);
  assert.equal(f.frame.inert, true); assert.equal(f.retry.hidden, false); assert.equal(f.timers.size, 0);
  f.send({ type: 'ui-ready' }); assert.equal(f.frame.inert, true, 'late readiness must not reveal a failed page');
  f.click(); assert.equal(f.messages.at(-1).type, 'retry');
});

test('adapter initialization exceptions emit a safe failure event', () => {
  const outgoing = [], code = fs.readFileSync('dist/sidebar.js', 'utf8');
  const ctx = { effect: run => run() };
  vm.runInNewContext(code, { window: { addEventListener() {}, __ModuleLoader__: { load(definition) {
    definition.factory().apply({ root: { plugin(plugin) { plugin.apply(ctx); } } });
  } } }, parent: { postMessage: message => outgoing.push(message) } });
  assert.equal(outgoing.at(-1).type, 'ui-error'); assert.equal(outgoing.at(-1).code, 'DSH_UI_ADAPTER_FAILED');
});

test('untrusted failure events cannot change the UI and readiness clears the deadline', () => {
  const f = wrapper(); f.send({ type: 'ui-error', code: 'unknown' });
  assert.equal(f.attributes.has('data-error'), false); assert.equal(f.timers.size, 1);
  f.send({ type: 'ui-ready' }); assert.equal(f.timers.size, 0); assert.equal(f.frame.inert, false);
  f.send({ type: 'ui-error', code: 'DSH_UI_STYLE_FAILED' }); assert.equal(f.attributes.has('data-error'), false);
});

test('a page that never becomes ready reaches an error instead of exposing an unusable iframe', () => {
  const f = wrapper(); assert.equal(f.timers.size, 1);
  const [timeout, duration] = [...f.timers][0]; assert.ok(duration > 0 && duration <= 60000); timeout();
  assert.equal(f.attributes.has('data-error'), true); assert.match(f.status.textContent, /超时/);
  assert.equal(f.frame.inert, true); assert.equal(f.retry.hidden, false);
});
