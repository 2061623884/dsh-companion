const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { buildSync } = require('esbuild');
const code = buildSync({ entryPoints: ['src/sidebar/client/layout-adapter.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
function fixture(initial = {}) {
  const listeners = new Set(), timers = new Map(), opened = [], traces = [], module = { exports: {} };
  let byId = initial;
  const element = () => ({ children: [], dataset: {}, append(...items) { this.children.push(...items); }, remove() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, removeAttribute() {} });
  vm.runInNewContext(code, { module, exports: module.exports, document: { body: element(), head: element(), createElement: element,
    createTextNode: value => value, querySelector: () => null }, MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    performance, setTimeout(fn, ms) { timers.set(fn, ms); return fn; }, clearTimeout(fn) { timers.delete(fn); } });
  const layout = module.exports.createSidebarLayout({ layout: { closeRightbar() {}, selectPanel() {}, panelInfo: { subscribe: () => () => {} } },
    sessions: { list: { getSnapshot: () => ({ byId }), subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } } },
    workspaces: { create: async () => ({ workspaceId: 'current-workspace', path: 'C:\\Workspace' }) },
    uiWorkspace: { openWorkspace: async id => { opened.push(id); } } }, () => {}, stage => traces.push(stage), () => {}, () => {});
  layout.setContext({ workspacePath: 'c:\\Workspace', workspaceName: 'fixture', reference: null });
  return { layout, opened, traces, timers, publish(value) { byId = value; for(const fn of [...listeners]) fn(); } };
}
const selected = { current: { id: 'current', cwd: 'C:\\Workspace', retainedBy: { mainView: 1 } } };
const flush = () => new Promise(resolve => setImmediate(resolve));
test('binding compares canonical paths and preserves an already restored session', async () => {
  const f = fixture(selected); await flush(); assert.deepEqual(f.opened, []); assert.ok(f.traces.includes('workspace-bind')); f.layout.dispose();
});
test('binding joins native restoration instead of opening a competing blank', async () => {
  const f = fixture(); await flush(); assert.deepEqual(f.opened, []);
  f.publish(selected); await flush(); assert.deepEqual(f.opened, []); assert.ok(f.traces.includes('workspace-bind'));
  assert.equal(f.timers.size, 0); f.layout.dispose();
});
test('an empty native selection cannot indefinitely block opening the editor workspace', async () => {
  const f = fixture(); await flush(); const [finish, delay] = [...f.timers][0]; assert.equal(delay, 200); finish();
  await flush(); assert.deepEqual(f.opened, ['current-workspace']); assert.ok(f.traces.includes('workspace-bind')); f.layout.dispose();
});
test('disposing during restoration removes the wait and never opens another session', async () => {
  const f = fixture(); await flush(); f.layout.dispose(); await flush(); assert.equal(f.timers.size, 0); assert.deepEqual(f.opened, []);
});
