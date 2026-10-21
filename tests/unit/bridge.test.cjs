const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  let listener; const outgoing = [], contexts = [], references = [], themes = [], timers = new Set();
  const parent = { postMessage(message) { outgoing.push(message); } }, module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('dist/test/sidebar/client/bridge.js', 'utf8'), { module, exports: module.exports, parent,
    window: { addEventListener(event, callback) { listener = callback; }, removeEventListener(event, callback) { if (listener === callback) listener = undefined; } },
    performance, setTimeout(callback) { timers.add(callback); return callback; }, clearTimeout(callback) { timers.delete(callback); } });
  const bridge = module.exports.createEditorBridge({ context: value => contexts.push(value), reference: value => references.push(value), theme: value => themes.push(value) });
  return { bridge, outgoing, contexts, references, themes, timers, receive(data, source = parent) { listener?.({ source, data: { source: 'dsh-companion-host', ...data } }); } };
}
test('editor bridge routes only its parent and correlates interleaved file reads', async () => {
  const f = fixture(); f.bridge.ready(); assert.equal(f.outgoing[0].type, 'hello');
  f.receive({ type: 'editor-context', context: 'untrusted' }, {}); assert.equal(f.contexts.length, 0);
  f.receive({ type: 'editor-context', context: { workspaceName: 'fixture' } });
  f.receive({ type: 'editor-reference', reference: { name: 'fixture.py' } });
  f.receive({ type: 'sidebar-theme', tokens: {}, dark: true, contrast: false });
  assert.equal(f.contexts.length, 1); assert.equal(f.references.length, 1); assert.equal(f.themes.length, 1);
  const one = f.bridge.readReference('file:///one.py', new AbortController().signal);
  const two = f.bridge.readReference('file:///two.py', new AbortController().signal);
  const requests = f.outgoing.filter(message => message.type === 'read-reference');
  f.receive({ type: 'reference-result', requestId: requests[1].requestId, value: { content: 'two' } });
  f.receive({ type: 'reference-result', requestId: requests[0].requestId, value: { content: 'one' } });
  assert.equal((await one).content, 'one'); assert.equal((await two).content, 'two'); assert.equal(f.timers.size, 0);
  f.bridge.dispose();
});
test('editor bridge cancellation, timeout and disposal reject reads and release their resources', async () => {
  const f = fixture(), controller = new AbortController();
  const cancelled = assert.rejects(f.bridge.readReference('file:///cancel.py', controller.signal), /取消/); controller.abort(); await cancelled;
  const timedOut = assert.rejects(f.bridge.readReference('file:///timeout.py', new AbortController().signal), /超时/);
  [...f.timers][0](); await timedOut;
  const closed = assert.rejects(f.bridge.readReference('file:///closed.py', new AbortController().signal), /关闭/); f.bridge.dispose(); await closed;
  f.receive({ type: 'reference-result', requestId: '3', value: { content: 'late' } }); assert.equal(f.timers.size, 0);
});
