const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReferenceController } = require('../dist/test/references/reference-controller');
const { isClientMessage } = require('../dist/test/protocol');
const file = { kind: 'file', uri: 'file:///project/main.py', name: 'main.py', version: 1 };
const selection = { ...file, kind: 'selection', range: '1:2-1:5', startLine: 2, endLine: 2,
  content: 'abc', filePath: '/project/main.py', language: 'python', unsaved: true };
class Draft {
  id = 'session-1'; text = 'keep typed text'; refs = []; pending = false; editable = true; seq = 0;
  snapshot() { return { editable: this.editable, pending: this.pending, references: this.refs }; }
  replaceAutomatic(value) {
    this.refs = this.refs.filter(item => !item.value.auto);
    if (value) this.refs.push({ id: String(++this.seq), value });
    return true;
  }
  remove(id) { const found = this.refs.find(item => item.id === id); this.refs = this.refs.filter(item => item !== found); return !!found; }
}
test('cancelled selection remains cancelled across edits, new range on same line returns', () => {
  const c = new ReferenceController(async () => assert.fail('selection must not reread file'), () => {}), d = new Draft();
  c.sync(selection, d); assert.equal(d.refs[0].value.content, 'abc');
  assert.equal(c.remove(d, d.refs[0].id), true);
  c.sync({ ...selection, version: 2, content: 'def' }, d); assert.equal(d.refs.length, 0);
  c.sync({ ...selection, range: '1:6-1:9' }, d); assert.equal(d.refs.length, 1);
  assert.equal(d.text, 'keep typed text');
});
test('selection is immutable snapshot; full-file serialization uses latest unsaved buffer', async () => {
  let reads = 0;
  const c = new ReferenceController(async uri => { reads++; return { uri, filePath: '/project/main.py', language: 'python', unsaved: true, content: 'latest buffer' }; }, () => {});
  const d = new Draft(); c.sync(selection, d);
  const payload = await c.serialize(d.refs[0].value, new AbortController().signal);
  assert.match(payload, /"content":"abc"/); assert.match(payload, /"unsaved":true/); assert.equal(reads, 0);
  assert.doesNotMatch(payload, /ownerSessionId|contextKey|"auto"/);
  c.sync(file, d);
  assert.match(await c.serialize(d.refs[0].value, new AbortController().signal), /latest buffer/);
  assert.equal(reads, 1);
});
test('serialization and pending admission do not reinsert; failure restoration preserves manual refs and text', async () => {
  let finish;
  const c = new ReferenceController(() => new Promise(resolve => finish = resolve), () => {}), d = new Draft();
  d.refs.push({ id: 'manual', value: { ...file, auto: false } });
  c.sync(file, d); const sent = d.refs.find(item => item.value.auto);
  const serialization = c.serialize(sent.value, new AbortController().signal);
  d.refs = d.refs.filter(item => !item.value.auto);
  c.sync(file, d); assert.equal(d.refs.length, 1);
  finish({ content: 'buffer' }); await serialization;
  d.pending = true; c.sync(file, d); assert.equal(d.refs.length, 1);
  d.refs.push(sent); d.pending = false; c.sync(file, d);
  assert.equal(d.refs.length, 2); assert.equal(d.text, 'keep typed text');
  d.refs = d.refs.filter(item => item !== sent); // keyboard deletion after failure
  c.sync(file, d); c.sync({ ...file, version: 3 }, d); assert.equal(d.refs.length, 1);
});
test('successful send permits the next automatic reference and sessions isolate dismissal', async () => {
  const c = new ReferenceController(async () => ({ content: 'x' }), () => {}), d = new Draft();
  c.sync(file, d); await c.serialize(d.refs[0].value, new AbortController().signal);
  d.refs = []; c.sync(file, d); assert.equal(d.refs.length, 1);
  c.remove(d, d.refs[0].id); const another = new Draft(); another.id = 'session-2';
  c.sync(file, another); assert.equal(another.refs.length, 1); c.sync(file, d); assert.equal(d.refs.length, 0);
});
test('abort fails visibly and noneditable draft is untouched', async () => {
  const c = new ReferenceController(async () => assert.fail(), () => {}), d = new Draft();
  d.editable = false; c.sync(file, d); assert.equal(d.refs.length, 0);
  d.editable = true; c.sync(file, d);
  const signal = AbortSignal.abort(); await assert.rejects(c.serialize(d.refs[0].value, signal), { name: 'AbortError' });
});
test('diagnostic boundary rejects source text as stage and invalid durations', () => {
  assert.equal(isClientMessage({ type: 'trace', stage: 'print(secret)', durationMs: 1 }), false);
  assert.equal(isClientMessage({ type: 'trace', stage: 'send-feedback', durationMs: Infinity }), false);
  assert.equal(isClientMessage({ type: 'trace', stage: 'send-feedback', durationMs: 4 }), true);
});
