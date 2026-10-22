const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), { createHash } = require('node:crypto');
const net = require('node:net'), { pathToFileURL } = require('node:url');
const { RuntimeClient } = require('../../dist/test/runtime/client');
const { RuntimeConnection } = require('../../dist/test/runtime/connection');
const runtime = path.resolve('runtime'), execute = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stopped(pid) {
  for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; } await sleep(100); }
  assert.fail(`Owned runtime ${pid} did not stop`);
}

test('startup retries a control pipe closed before its readiness reply', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-control-eof-'));
  const home = path.join(directory, 'home');
  const identity = createHash('sha256').update(path.resolve(home).toLowerCase()).digest('hex').slice(0, 32);
  let attempts = 0;
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => {
      if (++attempts === 1) { socket.end(); return; }
      socket.write(JSON.stringify({ type: 'ready', version: require('../../runtime/package.json').version, pid: process.pid, port: 12345 }) + '\n');
    });
  });
  await new Promise(resolve => server.listen(`\\\\.\\pipe\\dsh-companion-${identity}`, resolve));
  const client = new RuntimeClient(runtime, home, path.join(directory, 'none'));
  t.after(async () => { client.dispose(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  assert.deepEqual(await client.acquire(), { pid: process.pid, port: 12345 });
  assert.equal(attempts, 2);
});

test('a VS Code lowercase drive path can persist the preview confirmation across restart', { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-welcome-regression-'));
  const home = path.join(directory, 'home'), source = path.join(directory, 'no-source');
  const nativePath = runtime.replace(/^[A-Z]:/, value => value.toLowerCase());
  const client = new RuntimeClient(nativePath, home, source); t.after(() => client.dispose());
  const connection = new RuntimeConnection({ runtimeDirectory: nativePath, dataHome: home, desktopHome: source, assetsDirectory: path.resolve('dist'), acquire: () => client.acquire() });
  t.after(() => connection.dispose());
  const base = await connection.start(), first = await client.acquire();
  async function rpc(base, method, args) {
    const response = await fetch(base + '/api/settings/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ type: 'client-request', rpcId: require('node:crypto').randomUUID(), method: 'settings/' + method, payload: { args } }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  }
  const result = await rpc(base, 'mutate', { ns: 'ui-settings-general', ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-09-28.1' }], expectedRevision: 0 });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.value.value.welcomeNoticeVersion, '2026-09-28.1');
  await connection.dispose(); client.dispose(); await stopped(first.pid);
  const next = new RuntimeClient(runtime, home, source); t.after(() => next.dispose());
  const reopened = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, desktopHome: source, assetsDirectory: path.resolve('dist'), acquire: () => next.acquire() });
  t.after(() => reopened.dispose());
  const again = await rpc(await reopened.start(), 'describe', {});
  assert.equal(again.value.namespaces.find(item => item.ns === 'ui-settings-general').value.welcomeNoticeVersion, '2026-09-28.1');
  const second = await next.acquire(); await reopened.dispose(); next.dispose(); await stopped(second.pid);
});

test('bundled runtime cold-starts without desktop, shares windows and exits only after last lease', { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-runtime-'));
  const home = path.join(directory, 'home'), source = path.join(directory, 'no-desktop');
  const clients = [new RuntimeClient(runtime, home, source), new RuntimeClient(runtime, home, source)];
  t.after(() => clients.forEach(client => client.dispose()));
  const [a, b] = await Promise.all(clients.map(client => client.acquire()));
  assert.equal(a.pid, b.pid); assert.equal(a.port, b.port);
  const independent = new RuntimeClient(runtime, path.join(directory, 'separate-home'), source);
  t.after(() => independent.dispose());
  const separate = await independent.acquire();
  assert.notEqual(separate.pid, a.pid); assert.notEqual(separate.port, a.port);
  independent.dispose(); await stopped(separate.pid); process.kill(a.pid, 0);
  const connection = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, desktopHome: source, assetsDirectory: path.resolve('dist') });
  t.after(() => connection.dispose());
  const base = await connection.start();
  assert.equal((await fetch(base + '/?dsh-companion=1')).status, 200);
  // Without desktop data the shared store is created where desktop DSH would own it; Companion home keeps no copy.
  await fs.access(path.join(source, '.credentials.yaml'));
  await assert.rejects(fs.access(path.join(home, '.credentials.yaml')), { code: 'ENOENT' });
  clients[0].dispose(); await sleep(5300); process.kill(a.pid, 0);
  await connection.dispose(); clients[1].dispose(); await stopped(a.pid);
});

test('one-time import preserves source, shares desktop credentials, excludes queued work, and does not resync configuration', { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-import-'));
  const source = path.join(directory, 'desktop'), home = path.join(directory, 'home');
  await execute(path.join(runtime, 'bin/node.exe'), ['--expose-internals', 'tests/runtime-fixture.mjs', runtime, source], { windowsHide: true });
  const filename = path.join(source, 'profiles/desktop/cordis.patch.yml');
  const before = createHash('sha256').update(await fs.readFile(filename)).digest('hex');
  const client = new RuntimeClient(runtime, home, source); t.after(() => client.dispose());
  const first = await client.acquire();
  const report = JSON.parse(await fs.readFile(path.join(home, 'migration.json')));
  assert.equal(report.historySessions, 1); assert.equal(report.attachmentFiles, 1);
  assert.ok(report.skipped.some(item => item.id === 'pending' && item.code === 'PENDING_OR_INTERRUPTED'));
  // The runtime serves the desktop store: the desktop browser grant authenticates, and no copy exists.
  await assert.rejects(fs.access(path.join(home, '.credentials.yaml')), { code: 'ENOENT' });
  const shared = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, desktopHome: source, assetsDirectory: path.resolve('dist'), acquire: () => client.acquire() });
  t.after(() => shared.dispose());
  assert.equal((await fetch(await shared.start() + '/?dsh-companion=1')).status, 200);
  await shared.dispose();
  const patch = await fs.readFile(path.join(home, 'profiles/companion/cordis.patch.yml'), 'utf8');
  assert.doesNotMatch(patch, /resumeSessionId|unsafe|schedule/);
  const settings = JSON.parse(await fs.readFile(path.join(home, 'profiles/companion/.dsh-workbuddy-connect/settings.json')));
  assert.equal(settings.autoCheckInCN, false); assert.equal(settings.autoCheckInAI, false);
  await assert.rejects(fs.access(path.join(home, 'profiles/companion/.dsh-workbuddy-connect/.workbuddy-auth.json')));
  assert.equal(createHash('sha256').update(await fs.readFile(filename)).digest('hex'), before);
  client.dispose(); await stopped(first.pid);
  const prefix = (await fs.readdir(path.join(source, 'attachments/v1/objects')))[0];
  const attachment = (await fs.readdir(path.join(source, 'attachments/v1/objects', prefix))).find(name => /^[a-f0-9]{64}$/.test(name));
  const relative = path.join('attachments/v1/objects', prefix, attachment);
  await fs.writeFile(path.join(home, relative), 'interrupted partial attachment');
  await execute(path.join(runtime, 'bin/node.exe'), ['--expose-internals', 'tests/runtime-fixture.mjs', runtime, source, 'finish'], { windowsHide: true });
  await fs.writeFile(filename, 'invalid source after first migration');
  const next = new RuntimeClient(runtime, home, source); t.after(() => next.dispose());
  const second = await next.acquire();
  assert.equal(await fs.readFile(path.join(home, 'profiles/companion/cordis.patch.yml'), 'utf8'), patch);
  const retried = JSON.parse(await fs.readFile(path.join(home, 'migration.json')));
  assert.equal(retried.historySessions, 2); assert.equal(retried.skipped.length, 0);
  assert.deepEqual(await fs.readFile(path.join(home, relative)), await fs.readFile(path.join(source, relative)));
  next.dispose(); await stopped(second.pid);
});

test('desktop account sign-in is shared live through the desktop credential store', { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-shared-login-'));
  const source = path.join(directory, 'desktop'), home = path.join(directory, 'home'), store = path.join(source, '.credentials.yaml');
  await fs.mkdir(source);
  const document = { version: 1, refs: {}, records: {
    'client-connection/browser-session': { kind: 'grant', payload: { version: 1, secret: Buffer.alloc(32, 9).toString('base64url') } },
    'deepseek-account-platform/default': { kind: 'grant', payload: { version: 1, token: 'synthetic-token', issuer: 'https://platform.deepseek.com' } },
  } };
  await fs.writeFile(store, JSON.stringify(document));
  const client = new RuntimeClient(runtime, home, source); t.after(() => client.dispose());
  const connection = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, desktopHome: source, assetsDirectory: path.resolve('dist'), acquire: () => client.acquire() });
  t.after(() => connection.dispose());
  const base = await connection.start(), address = await client.acquire();
  async function state() {
    const response = await fetch(base + '/api/account/getState', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ type: 'client-request', rpcId: require('node:crypto').randomUUID(), method: 'account/getState', payload: { args: {} } }) });
    assert.equal(response.status, 200); const message = await response.json();
    assert.equal(message.result.ok, true, JSON.stringify(message.result.error)); return message.result.value.status;
  }
  // Signed in on desktop means signed in here, with no login prompt and no copy in Companion home.
  assert.equal(await state(), 'credential-stored');
  assert.ok(require('js-yaml').load(await fs.readFile(store, 'utf8')).records['deepseek-account-platform/default']);
  await assert.rejects(fs.access(path.join(home, '.credentials.yaml')), { code: 'ENOENT' });
  // A desktop sign-out reaches the running runtime through the store's watcher.
  delete document.records['deepseek-account-platform/default'];
  await fs.writeFile(store, JSON.stringify(document));
  let status;
  for (let i = 0; i < 50 && (status = await state()) !== 'signed-out'; i++) await sleep(100);
  assert.equal(status, 'signed-out');
  await connection.dispose(); client.dispose(); await stopped(address.pid);
});

test('a different account platform preserves the shared desktop login and rejects startup', { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-platform-mismatch-'));
  const source = path.join(directory, 'desktop'), home = path.join(directory, 'home'), store = path.join(source, '.credentials.yaml');
  await fs.mkdir(source);
  const document = JSON.stringify({ version: 1, refs: {}, records: {
    'client-connection/browser-session': { kind: 'grant', payload: { version: 1, secret: Buffer.alloc(32, 9).toString('base64url') } },
    'deepseek-account-platform/default': { kind: 'grant', payload: { version: 1, token: 'synthetic-token', issuer: 'https://synthetic-platform.invalid' } },
  } });
  await fs.writeFile(store, document);
  const client = new RuntimeClient(runtime, home, source); t.after(() => client.dispose());
  try {
    await assert.rejects(client.acquire(), /DSH_ACCOUNT_PLATFORM_MISMATCH/);
  } finally {
    assert.equal(await fs.readFile(store, 'utf8'), document, 'startup must never remove or rewrite the shared login');
  }
  client.dispose();
  // Matching the effective profile setting, rather than changing the credential,
  // allows the same home and grant to be used on the next start.
  await fs.writeFile(path.join(home, 'profiles/companion/cordis.patch.yml'), JSON.stringify([
    { id: 'deepseek-account', config: { platformOrigin: 'https://synthetic-platform.invalid' } },
  ]));
  const next = new RuntimeClient(runtime, home, source); t.after(() => next.dispose());
  const ready = await next.acquire();
  assert.equal(await fs.readFile(store, 'utf8'), document);
  next.dispose(); await stopped(ready.pid);
});

test('rapid migration failure preserves stage and error code for the first client', { timeout: 10000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-fast-fail-'));
  const source = path.join(directory, 'desktop'), patch = path.join(source, 'cordis.patch.yml');
  await fs.mkdir(source); await fs.writeFile(patch, '{}');
  const client = new RuntimeClient(runtime, path.join(directory, 'home'), source); t.after(() => client.dispose());
  await assert.rejects(client.acquire(), /import.*DSH_IMPORT_PATCH_SCHEMA/);
  await fs.writeFile(patch, '[]');
  const ready = await client.acquire(); client.dispose(); await stopped(ready.pid);
});

test('owner pipe stays bound while the last-client shutdown saves its runtime', { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-owner-'));
  const home = path.join(directory, 'home'), profile = path.join(home, 'profiles/companion'), marker = path.join(directory, 'saving');
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(home, 'migration.json'), JSON.stringify({ version: 1, skipped: [] }));
  await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
  await fs.writeFile(path.join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'delay', name: pathToFileURL(path.resolve('tests/slow-dispose.mjs')).href, config: { marker } }] }]));
  const client = new RuntimeClient(runtime, home, path.join(directory, 'none')); t.after(() => client.dispose());
  const first = await client.acquire(); client.dispose();
  for (let i = 0; i < 100; i++) { try { await fs.access(marker); break; } catch (error) { if (error.code !== 'ENOENT') throw error; } await sleep(100); }
  await fs.access(marker); process.kill(first.pid, 0);
  const identity = createHash('sha256').update(path.resolve(home).toLowerCase()).digest('hex').slice(0, 32);
  const reply = await new Promise((resolve, reject) => {
    const socket = net.connect(`\\\\.\\pipe\\dsh-companion-${identity}`);
    socket.on('error', reject); socket.on('connect', () => socket.write(JSON.stringify({ type: 'attach', version: require('../../runtime/package.json').version }) + '\n'));
    socket.once('data', value => { socket.destroy(); resolve(JSON.parse(value)); });
  });
  assert.equal(reply.type, 'stopping');
  const next = new RuntimeClient(runtime, home, path.join(directory, 'none')); t.after(() => next.dispose());
  const second = await next.acquire(); assert.notEqual(second.pid, first.pid);
  assert.throws(() => process.kill(first.pid, 0), { code: 'ESRCH' }); next.dispose(); await stopped(second.pid);
});

test('an upgraded client waits for the old runtime grace instead of failing or booting beside it', { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-upgrade-'));
  const oldRuntime = path.join(directory, 'runtime'), home = path.join(directory, 'home'), source = path.join(directory, 'none');
  await fs.mkdir(oldRuntime);
  for (const name of ['host.mjs', 'import.mjs']) await fs.copyFile(path.join(runtime, name), path.join(oldRuntime, name));
  for (const name of ['bin', 'node_modules']) await fs.symlink(path.join(runtime, name), path.join(oldRuntime, name), 'junction');
  const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'package.json'))); manifest.version = '0.2.9';
  await fs.writeFile(path.join(oldRuntime, 'package.json'), JSON.stringify(manifest));
  const old = new RuntimeClient(oldRuntime, home, source); t.after(() => old.dispose());
  const before = await old.acquire();
  const next = new RuntimeClient(runtime, home, source); t.after(() => next.dispose());
  await assert.rejects(next.acquire(), /其他 VS Code 窗口.*DSH_RUNTIME_VERSION_IN_USE/);
  process.kill(before.pid, 0); old.dispose();
  const after = await next.acquire(); assert.notEqual(before.pid, after.pid);
  assert.throws(() => process.kill(before.pid, 0), { code: 'ESRCH' }); next.dispose(); await stopped(after.pid);
});
