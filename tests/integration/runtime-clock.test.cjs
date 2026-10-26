const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const { RuntimeClient } = require('../../dist/test/legacy-runtime/client');
const { DesktopConnection } = require('../../dist/test/desktop/connection');

test('signed runtime discovery and RPC tolerate a slightly slower receiver clock', { timeout: 30000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-clock-fixture-'));
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `${previous || ''} --import=${pathToFileURL(path.resolve('tests/runtime-clock-fixture.mjs'))}`;
  t.after(() => { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; });
  const home = path.join(directory, 'home'), runtime = path.resolve('runtime'), source = path.join(directory, 'no-desktop');
  const client = new RuntimeClient(runtime, home, source);
  const connection = new DesktopConnection({ runtimeDirectory: runtime, dataHome: home, desktopHome: source,
    assetsDirectory: path.resolve('dist'), acquire: () => client.acquire() });
  t.after(async () => { try { await connection.dispose(); } finally { client.dispose(); } });
  const base = await connection.start();
  const response = await fetch(base + '/api/settings/describe', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ type: 'client-request', rpcId: 'clock-fixture', method: 'settings/describe', payload: { args: {} } }) });
  assert.equal(response.status, 200);
  const message = await response.json();
  assert.equal(message.type, 'server-response');
  assert.equal(message.result.ok, true);
});
