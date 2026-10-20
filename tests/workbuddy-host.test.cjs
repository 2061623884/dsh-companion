const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const { RuntimeClient } = require('../dist/test/runtime/client');
const { RuntimeConnection } = require('../dist/test/runtime/connection');

test('actual bundled host discovers desktop WorkBuddy auth and protects it through HTTP logout', { timeout: 45000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workbuddy-host-'));
  const source = path.join(directory, 'desktop'), home = path.join(directory, 'home');
  const authDirectory = path.join(source, 'profiles/desktop/.dsh-workbuddy-connect');
  await fs.mkdir(authDirectory, { recursive: true });
  const filename = path.join(authDirectory, '.workbuddy-auth.json');
  const auth = JSON.stringify({ version: 1, region: 'cn', auth: { accessToken: 'fixture-borrowed-access',
    refreshToken: 'fixture-refresh-must-never-be-used', expiresAt: Math.floor(Date.now() / 1000) + 60,
    domain: 'copilot.tencent.com' }, account: { uid: 'fixture-user' } });
  await fs.writeFile(filename, auth);
  const previous = process.env.NODE_OPTIONS, previousNetwork = process.env.DSH_WORKBUDDY_TEST_NETWORK;
  const requestsFile = path.join(directory, 'requests.json');
  process.env.NODE_OPTIONS = `${previous || ''} --import=${pathToFileURL(path.resolve('tests/workbuddy-network-fixture.mjs'))}`;
  process.env.DSH_WORKBUDDY_TEST_NETWORK = requestsFile;
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    if (previousNetwork === undefined) delete process.env.DSH_WORKBUDDY_TEST_NETWORK; else process.env.DSH_WORKBUDDY_TEST_NETWORK = previousNetwork;
  });
  const client = new RuntimeClient(path.resolve('runtime'), home, source);
  const connection = new RuntimeConnection({ runtimeDirectory: path.resolve('runtime'), dataHome: home,
    assetsDirectory: path.resolve('dist'), acquire: () => client.acquire() });
  t.after(async () => { await connection.dispose(); client.dispose(); });
  const base = await connection.start(), address = await client.acquire();
  const response = await fetch(base + '/plugins/dsh-workbuddy-connect/status');
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.status, 'signed-in');
  assert.ok(status.models.some(model => model.id === 'fixture-workbuddy'));
  const logout = await fetch(base + '/plugins/dsh-workbuddy-connect/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, 'x-workbuddy-login-key': status.loginKey }, body: JSON.stringify({ action: 'logout' }) });
  const result = await logout.json();
  assert.equal(result.status, 'failed'); assert.match(result.message, /只读/);
  assert.equal((await (await fetch(base + '/plugins/dsh-workbuddy-connect/status')).json()).status, 'signed-in');
  await connection.dispose(); client.dispose();
  for (let i = 0; i < 100; i++) {
    try { process.kill(address.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') break; throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await fs.readFile(filename, 'utf8'), auth);
  for (const file of ['.dsh-workbuddy-connect/.workbuddy-auth.json', 'profiles/companion/.dsh-workbuddy-connect/.workbuddy-auth.json']) {
    await assert.rejects(fs.access(path.join(home, file)), { code: 'ENOENT' });
  }
  const requests = JSON.parse(await fs.readFile(requestsFile));
  assert.ok(requests.some(request => request.path === '/console/enterprises/personal/models'));
  assert.equal(requests.filter(request => /refresh/.test(request.path) || request.refreshHeader).length, 0);
});
