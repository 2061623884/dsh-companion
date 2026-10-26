const { test } = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { buildSync } = require('esbuild');
const code = buildSync({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['vscode', './desktop/client', './desktop/connection', './desktop/updates', './context/editor-context', './sidebar/view'] }).outputFiles[0].text;
const flush = () => new Promise(setImmediate);

function extension(t, result, remembered) {
  const commands = new Map(), storage = new Map(remembered ? [['desktopUpdateNotified', remembered]] : []);
  const notices = [], warnings = [], logs = [], opened = [], checks = [];
  let tick, disposed = false, clear = false;
  const disposable = { dispose() {} };
  const modules = {
    vscode: { window: { createOutputChannel: () => ({ ...disposable, appendLine: line => logs.push(line) }),
      registerWebviewViewProvider: () => disposable, showInformationMessage: async (...args) => { notices.push(args); return '前往更新'; },
      showWarningMessage: async message => warnings.push(message) },
      commands: { registerCommand: (name, callback) => { commands.set(name, callback); return disposable; } },
      env: { openExternal: async url => opened.push(url) }, Uri: { parse: value => value } },
    './desktop/client': { desktopDownloadUrl: 'https://www.deepseek.com/harness/' },
    './desktop/connection': { DesktopConnection: class { async dispose() {} } },
    './context/editor-context': { EditorContext: class { dispose() {} } },
    './sidebar/view': { SidebarView: class { dispose() {} } },
    './desktop/updates': { updateCheckInterval: 123, DesktopUpdates: class {
      async check(manual) { checks.push(manual); if (result instanceof Error) throw result; return result; }
      dispose() { disposed = true; }
    } },
  };
  const module = { exports: {} }, context = { extensionPath: '.', subscriptions: [],
    globalState: { get: key => storage.get(key), update: async (key, value) => storage.set(key, value) } };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => modules[name] || require(name),
    setInterval: (callback, delay) => { assert.equal(delay, 123); tick = callback; return 1; }, clearInterval: () => { clear = true; } });
  module.exports.activate(context);
  const stop = () => { for (const item of context.subscriptions.splice(0)) item.dispose(); };
  t.after(stop);
  return { notices, warnings, logs, opened, storage, checks, commands, tick: () => tick(), stop,
    disposed: () => disposed && clear };
}

test('available Desktop updates notify once automatically, remain manually accessible, and open only the official page', async t => {
  const f = extension(t, { state: 'available', installed: '0.2.1-rc.2', latest: '0.2.1-rc.3', channel: 'nightly' });
  await flush(); assert.equal(f.notices.length, 1); assert.match(f.notices[0][0], /0.2.1-rc.2 → 0.2.1-rc.3/);
  assert.equal(f.storage.get('desktopUpdateNotified'), '0.2.1-rc.3');
  f.tick(); await flush(); assert.equal(f.notices.length, 1);
  await f.commands.get('dshCompanion.checkUpdates')(); assert.equal(f.notices.length, 2);
  assert.deepEqual(f.opened, ['https://www.deepseek.com/harness/', 'https://www.deepseek.com/harness/']);
  f.stop(); assert.equal(f.disposed(), true);
});

test('a remembered update is quiet until manual checking, and current versions have no automatic popup', async t => {
  const remembered = extension(t, { state: 'available', installed: '1.0.0', latest: '1.1.0' }, '1.1.0');
  const current = extension(t, { state: 'current', installed: '1.1.0', latest: '1.1.0' });
  await flush(); assert.equal(remembered.notices.length, 0); assert.equal(current.notices.length, 0);
  await current.commands.get('dshCompanion.checkUpdates')(); assert.match(current.notices[0][0], /无需更新/);
});

test('failed checks log a diagnostic and manual checks report failure instead of latest-version success', async t => {
  const f = extension(t, Object.assign(new Error('private diagnostics'), { code: 'ETIMEDOUT' }));
  await flush(); assert.equal(f.notices.length, 0); assert.equal(f.warnings.length, 0);
  await f.commands.get('dshCompanion.checkUpdates')(); assert.equal(f.warnings.length, 1);
  assert.match(f.warnings[0], /无法检查/); assert.match(f.logs[0], /ETIMEDOUT/);
  assert.ok(f.logs.every(line => !line.includes('private diagnostics')));
});
