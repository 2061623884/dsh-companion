const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), { createHash } = require('node:crypto');
const net = require('node:net'), { pathToFileURL } = require('node:url');
const { RuntimeClient } = require('../dist/test/runtime/client');
const { RuntimeConnection } = require('../dist/test/runtime/connection');
const runtime = path.resolve('runtime'), execute = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stopped(pid) {
  for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; } await sleep(100); }
  assert.fail(`Owned runtime ${pid} did not stop`);
}

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
  const connection = new RuntimeConnection({ runtimeDirectory: runtime, dataHome: home, assetsDirectory: path.resolve('dist') });
  const base = await connection.start();
  assert.equal((await fetch(base + '/?dsh-companion=1')).status, 200);
  clients[0].dispose(); await sleep(5300); process.kill(a.pid, 0);
  await connection.dispose(); clients[1].dispose(); await stopped(a.pid);
});

test('one-time import preserves source, excludes queued work and credentials, and does not resync configuration', { timeout: 30000 }, async t => {
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
  const yaml = require('js-yaml'), credentials = yaml.load(await fs.readFile(path.join(home, '.credentials.yaml'), 'utf8'));
  assert.notEqual(credentials.records['client-connection/browser-session'].payload.secret, 'do-not-import');
  assert.equal(credentials.refs.FIXTURE_API_KEY, 'fixture-only');
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

test('rapid migration failure preserves stage and error code for the first client', { timeout: 10000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-fast-fail-'));
  const source = path.join(directory, 'desktop'); await fs.mkdir(source);
  await fs.writeFile(path.join(source, '.credentials.yaml'), 'null');
  const client = new RuntimeClient(runtime, path.join(directory, 'home'), source); t.after(() => client.dispose());
  await assert.rejects(client.acquire(), /import.*DSH_IMPORT_CREDENTIAL_SCHEMA/);
  await fs.writeFile(path.join(source, '.credentials.yaml'), JSON.stringify({ version: 1, refs: {}, records: {} }));
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
    socket.on('error', reject); socket.on('connect', () => socket.write(JSON.stringify({ type: 'attach', version: '0.3.0' }) + '\n'));
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
  const before = await old.acquire(); old.dispose();
  const next = new RuntimeClient(runtime, home, source); t.after(() => next.dispose());
  const after = await next.acquire(); assert.notEqual(before.pid, after.pid);
  assert.throws(() => process.kill(before.pid, 0), { code: 'ESRCH' }); next.dispose(); await stopped(after.pid);
});
