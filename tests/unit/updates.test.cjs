const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { DesktopUpdates, updateCheckInterval } = require('../../dist/test/desktop/updates');

async function fixture(t, version = '0.2.1-rc.2', config) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-update-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  if (config !== undefined) { await fs.mkdir(path.join(directory, 'resources')); await fs.writeFile(path.join(directory, 'resources/app-update.yml'), config); }
  return async () => ({ executable: path.join(directory, 'DeepSeek Harness.exe'), version });
}

test('missing Desktop needs installation without contacting a feed', async () => {
  const updates = new DesktopUpdates({ discover: async () => ({ executable: null, version: null }), request: async () => { assert.fail('network request'); } });
  assert.deepEqual(await updates.check(), { state: 'not-installed' }); updates.dispose();
});

test('compares actual release versions including rc numbers and local test suffixes', async t => {
  for (const [installed, latest, state] of [
    ['0.2.1-rc.9', '0.2.1-rc.10', 'available'], ['0.2.1-rc.3.20261026.1', '0.2.1-rc.3', 'current'],
    ['0.2.1-rc.3.20261026.1', '0.2.1-rc.4', 'available'], ['0.2.1-rc.3', '0.2.1', 'available'], ['0.2.1', '0.2.1', 'current'],
  ]) {
    const updates = new DesktopUpdates({ discover: await fixture(t, installed), request: async url => {
      assert.equal(url, 'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml'); return 'version: ' + latest;
    } });
    assert.deepEqual(await updates.check(), { state, installed, latest, channel: 'nightly' }); updates.dispose();
  }
});

test('uses the installed stable channel and only the official feed origin', async t => {
  const updates = new DesktopUpdates({ discover: await fixture(t, '0.2.0', 'channel: latest\nurl: https://untrusted.invalid/\n'), request: async url => {
    assert.equal(url, 'https://download.deepseek.com/dsh-desk/feeds/win-x64/latest.yml'); return 'version: 0.2.1';
  } });
  assert.equal((await updates.check()).state, 'available'); updates.dispose();
});

test('joins concurrent checks, caches success, and manual checks reread an updated installation', async t => {
  let finish, requests = 0, now = 0, installed = '0.2.1-rc.2';
  const discover = await fixture(t);
  const updates = new DesktopUpdates({ discover: async () => ({ ...await discover(), version: installed }), now: () => now,
    request: () => { requests++; return new Promise(resolve => { finish = resolve; }); } });
  const first = updates.check(); assert.equal(updates.check(true), first);
  while (!finish) await new Promise(setImmediate);
  finish('version: 0.2.1-rc.3'); await first;
  await updates.check(); assert.equal(requests, 1);
  installed = '0.2.1-rc.3'; finish = undefined;
  const manual = updates.check(true); while (!finish) await new Promise(setImmediate); finish('version: 0.2.1-rc.3');
  assert.equal((await manual).state, 'current'); assert.equal(requests, 2);
  now += updateCheckInterval; finish = undefined;
  const expired = updates.check(); while (!finish) await new Promise(setImmediate); finish('version: 0.2.1-rc.4');
  assert.equal((await expired).state, 'available'); assert.equal(requests, 3); updates.dispose();
});

test('network or invalid feed failures never become a current-version result or cached success', async t => {
  let calls = 0;
  const updates = new DesktopUpdates({ discover: await fixture(t), request: async () => {
    if (++calls === 1) throw new Error('synthetic offline');
    return calls === 2 ? 'version: invalid' : 'version: 0.2.1-rc.3';
  } });
  await assert.rejects(updates.check(), /offline/); await assert.rejects(updates.check(), /有效版本号/);
  assert.equal((await updates.check()).state, 'available'); assert.equal(calls, 3); updates.dispose();
});

test('invalid installed metadata fails before network access', async t => {
  for (const [version, config] of [[null, undefined], ['not-a-version', undefined], ['0.2.1', 'channel: other'], ['0.2.1', 'null']]) {
    const updates = new DesktopUpdates({ discover: await fixture(t, version, config), request: async () => { assert.fail('network request'); } });
    await assert.rejects(updates.check()); updates.dispose();
  }
});

test('disposal cancels an in-flight request and cannot schedule another check', async t => {
  let entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const updates = new DesktopUpdates({ discover: await fixture(t), request: (_url, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); entered();
  }) });
  const check = updates.check(); await reached; updates.dispose();
  await assert.rejects(check, { name: 'AbortError' }); await assert.rejects(updates.check(), /关闭/);
});

test('a failed HTTP feed and an interrupted response both reject without an unhandled stream error', async t => {
  const { EventEmitter } = require('node:events');
  for (const statusCode of [503, 200]) {
    const response = Object.assign(new EventEmitter(), { statusCode, resume() {} });
    const request = new EventEmitter();
    t.mock.method(require('node:https'), 'get', (_url, _options, callback) => {
      setImmediate(() => { callback(response); response.emit('error', new Error('synthetic interrupted response')); });
      return request;
    });
    const updates = new DesktopUpdates({ discover: await fixture(t) });
    await assert.rejects(updates.check(), statusCode === 503 ? /HTTP 503/ : /interrupted response/);
    updates.dispose(); t.mock.restoreAll();
  }
});
