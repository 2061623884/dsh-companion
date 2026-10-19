const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util'), { createHash } = require('node:crypto');
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
  await fs.writeFile(filename, 'invalid source after first migration');
  const next = new RuntimeClient(runtime, home, source); t.after(() => next.dispose());
  const second = await next.acquire();
  assert.equal(await fs.readFile(path.join(home, 'profiles/companion/cordis.patch.yml'), 'utf8'), patch);
  next.dispose(); await stopped(second.pid);
});
