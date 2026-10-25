const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { buildSync } = require('esbuild');
const code = buildSync({ entryPoints: ['src/sidebar/client/layout-adapter.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
function fixture() {
  const timers = new Map(), frames = new Map(); let next = 0, toggles = 0;
  class Element {
    constructor(kind) { this.kind = kind; this.children = []; this.dataset = {}; this.attrs = new Map(); this.events = new Map(); }
    append(...items) { this.children.push(...items); } remove() {}
    setAttribute(key, value) { this.attrs.set(key, value); } hasAttribute(key) { return this.attrs.has(key); }
    removeAttribute(key) { this.attrs.delete(key); } toggleAttribute(key, value) { value ? this.attrs.set(key, '') : this.attrs.delete(key); }
    addEventListener(key, fn) { this.events.set(key, fn); } removeEventListener(key) { this.events.delete(key); }
    closest(selector) { return selector.includes('#dsh-companion-toolbar') ? this.kind === 'nav' ? this : null : selector.includes('data-row-key') && this.kind === 'row' ? this : null; }
    querySelector() { return center; }
  }
  const body = new Element('body'), nav = new Element('nav'), slot = new Element(), root = new Element(), center = new Element(), row = new Element('row');
  slot.parentElement = nav; nav.parentElement = root; nav.nextElementSibling = center;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Element, document: { body, head: new Element(), createElement: () => new Element(), createTextNode: s => s,
    querySelector: selector => selector === '[data-slot="sidebar"]' ? slot : null }, MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame(fn) { const id = ++next; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, performance,
    matchMedia: query => ({ matches: query.includes('max-width'), addEventListener() {}, removeEventListener() {} }) });
  const layout = module.exports.createSidebarLayout({ layout: { closeRightbar() {}, selectPanel() {}, toggleSidebar() { toggles++; root.toggleAttribute('data-sidebar-collapsed', !root.hasAttribute('data-sidebar-collapsed')); }, panelInfo: { subscribe: () => () => {} } },
    sessions: { list: { subscribe: () => () => {} } } }, () => {}, () => {}, () => {}, () => {});
  function frame() { const work = [...frames]; frames.clear(); for (const [, fn] of work) fn(); }
  function tick() { const work = [...timers]; timers.clear(); for (const [, timer] of work) timer.fn(); }
  frame(); root.removeAttribute('data-sidebar-collapsed'); layout.scheduleSync(); frame();
  return { layout, root, nav, center, row, body, frame, tick, timers, frames, toggles: () => toggles,
    dispatch(type, event) { body.events.get(type)?.(event); } };
}
test('pointer returning during automatic exit reverses closing instead of hiding navigation', () => {
  const f = fixture();
  f.dispatch('pointerout', { pointerType: 'mouse', target: f.nav, relatedTarget: f.center }); f.tick();
  f.dispatch('pointerover', { target: f.nav }); f.tick(); f.frame();
  assert.equal(f.root.hasAttribute('data-sidebar-collapsed'), false); f.layout.dispose();
});
test('disposing after session selection cancels its deferred drawer close', () => {
  const f = fixture(), before = f.toggles();
  f.dispatch('click', { target: f.row }); f.layout.dispose(); f.frame(); f.tick();
  assert.equal(f.toggles(), before); assert.equal(f.timers.size, 0);
});

test('pointer reentry does not reverse the explicit close after selecting a session', () => {
  const f = fixture();
  f.dispatch('click', { target: f.row }); f.frame();
  f.dispatch('pointerover', { target: f.nav }); f.tick(); f.frame();
  assert.equal(f.root.hasAttribute('data-sidebar-collapsed'), true); f.layout.dispose();
});
